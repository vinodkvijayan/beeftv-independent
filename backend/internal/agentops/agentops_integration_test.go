package agentops_test

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 自包含集成回归：真实临时 SQLite + 真实领域写入，验证事务/幂等/CAS/能力边界。
// 不依赖任何外部脚本或已运行的服务，正常 go test 即可验证核心。
type harness struct {
	registry *agentops.Registry
	userID   string
	canvasID string
	revision int64
	dataDir  string
	service  *app.Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "agentops.db")),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("Failed to open temporary library: %v", err)
	}
	// 与生产一致：SQLite 单连接池。任何"事务内再去根连接取数"的写法都会在这里自等死锁，
	// 从而让这类缺陷在 go test 中直接暴露，而不是只在运行时。
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("Failed to get the underlying connection: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "local workspace"}).Error; err != nil {
		t.Fatalf("Failed to create workspace: %v", err)
	}
	dataDir := t.TempDir()
	service := app.NewLocal(repository.New(db), dataDir)
	registry := agentops.NewRegistry(service, agentops.NewStore(db))
	agentops.RegisterDefaultOps(registry)

	canvasID := "integration-canvas"
	doc := map[string]any{
		"id": canvasID, "title": "Integrated regression canvas", "revision": 0,
		"nodes": []any{
			map[string]any{"id": "n1", "type": "image", "title": "Original shot 1", "position": map[string]any{"x": 1, "y": 1},
				"width": 320, "height": 220, "metadata": map[string]any{"prompt": "Original 1", "tag": "keep"}},
			map[string]any{"id": "n2", "type": "image", "title": "Original shot 2", "position": map[string]any{"x": 2, "y": 2},
				"width": 320, "height": 220, "metadata": map[string]any{"prompt": "original 2", "tag": "keep"}},
		},
		"connections": []any{map[string]any{"id": "e1", "fromNodeId": "n1", "toNodeId": "n2"}},
	}
	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("Failed to serialize canvas: %v", err)
	}
	if _, err := service.UpsertUserCanvasProject("local", encoded); err != nil {
		t.Fatalf("Failed to write to initial canvas: %v", err)
	}
	raw, err := service.UserCanvasProject("local", canvasID)
	if err != nil {
		t.Fatalf("Failed to read initial canvas: %v", err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("Failed to parse initial canvas: %v", err)
	}
	revision := int64(stored["revision"].(float64))
	return &harness{registry: registry, userID: "local", canvasID: canvasID, revision: revision, dataDir: dataDir, service: service}
}

func (h *harness) run(t *testing.T, op, opID string, params map[string]any, readOnly bool) (agentops.Result, error) {
	t.Helper()
	encoded, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("Serialization parameter failed: %v", err)
	}
	return h.registry.Execute(agentops.Request{Op: op, OpID: opID, UserID: h.userID, ReadOnly: readOnly, Params: encoded})
}

func (h *harness) canvas(t *testing.T) map[string]any {
	t.Helper()
	result, err := h.run(t, "canvas.get", "", map[string]any{"canvasId": h.canvasID}, false)
	if err != nil {
		t.Fatalf("Failed to read canvas: %v", err)
	}
	payload := result.Result.(map[string]any)
	return payload["canvas"].(map[string]any)
}

func opCode(t *testing.T, err error) agentops.Code {
	t.Helper()
	var opErr *agentops.Error
	if !errors.As(err, &opErr) {
		t.Fatalf("Expected structured operation error, got %v", err)
	}
	return opErr.Code
}

func TestWriteRequiresOperationIDAndRevision(t *testing.T) {
	h := newHarness(t)
	_, err := h.run(t, "canvas.nodes.create", "", map[string]any{"canvasId": h.canvasID,
		"expectedRevision": h.revision, "nodes": []any{map[string]any{"title": "A", "type": "image"}}}, false)
	if code := opCode(t, err); code != agentops.CodeInvalidArgument {
		t.Fatalf("Missing opId should be rejected, getting %v", code)
	}
	_, err = h.run(t, "canvas.node.update", "op-no-rev", map[string]any{"canvasId": h.canvasID,
		"nodeId": "n1", "patch": map[string]any{"prompt": "x"}}, false)
	if code := opCode(t, err); code != agentops.CodeInvalidArgument {
		t.Fatalf("Missing expectedRevision should reject, get %v", code)
	}
}

func TestIdempotentReplayAndConflict(t *testing.T) {
	h := newHarness(t)
	params := map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "Lens A", "type": "image"}, map[string]any{"title": "Lens B", "type": "image"}}}
	first, err := h.run(t, "canvas.nodes.create", "op-create", params, false)
	if err != nil {
		t.Fatalf("First creation failed: %v", err)
	}
	if first.Replayed {
		t.Fatal("The first execution should not be marked for replay")
	}
	second, err := h.run(t, "canvas.nodes.create", "op-create", params, false)
	if err != nil {
		t.Fatalf("Retry should read back the original result and get error: %v", err)
	}
	if !second.Replayed {
		t.Fatal("Same opId and same payload, the original result must be read back")
	}
	firstJSON, _ := json.Marshal(first.Result)
	secondJSON, _ := json.Marshal(second.Result)
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("The playback result should be the same as the first time:\n%s\n%s", firstJSON, secondJSON)
	}
	conflictParams := map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "Others", "type": "image"}}}
	_, err = h.run(t, "canvas.nodes.create", "op-create", conflictParams, false)
	if code := opCode(t, err); code != agentops.CodeConflict {
		t.Fatalf("Different payloads with the same opId should conflict and get %v", code)
	}
}

func TestLocalUpdateKeepsNonTargetDataAndBlocksStaleRevision(t *testing.T) {
	h := newHarness(t)
	before := h.canvas(t)
	beforeNodes := before["nodes"].([]any)
	beforeOther := mustJSON(t, beforeNodes[1])
	beforeConnections := mustJSON(t, before["connections"])

	if _, err := h.run(t, "canvas.node.update", "op-update", map[string]any{"canvasId": h.canvasID,
		"nodeId": "n1", "expectedRevision": h.revision, "patch": map[string]any{"prompt": "Change to night scene"}}, false); err != nil {
		t.Fatalf("Partial modification failed: %v", err)
	}
	after := h.canvas(t)
	afterNodes := after["nodes"].([]any)
	target := afterNodes[0].(map[string]any)
	metadata := target["metadata"].(map[string]any)
	if metadata["composerContent"] != "Change to night scene" {
		t.Fatalf("Target draft field not written: %v", metadata["composerContent"])
	}
	if metadata["prompt"] != "Original 1" {
		t.Fatalf("Historically submitted prompt words should not be overwritten: %v", metadata["prompt"])
	}
	if metadata["tag"] != "keep" {
		t.Fatalf("Non-target fields are corrupted: %v", metadata)
	}
	if mustJSON(t, afterNodes[1]) != beforeOther {
		t.Fatal("Non-target nodes are modified")
	}
	if mustJSON(t, after["connections"]) != beforeConnections {
		t.Fatal("The connection has been changed")
	}

	// 陈旧 revision：必须停写，且画布保持上一次成功写入的内容
	_, err := h.run(t, "canvas.node.update", "op-stale", map[string]any{"canvasId": h.canvasID,
		"nodeId": "n1", "expectedRevision": h.revision, "patch": map[string]any{"prompt": "should not be written"}}, false)
	// 陈旧 revision 由仓储原子谓词裁决，统一映射为 conflict + reason=stale_revision
	if code := opCode(t, err); code != agentops.CodeConflict {
		t.Fatalf("Stale revision should be conflict, got %v", code)
	}
	var staleErr *agentops.Error
	if errors.As(err, &staleErr) && staleErr.Reason != "stale_revision" {
		t.Fatalf("reason for stale revision should be stale_revision, get %q", staleErr.Reason)
	}
	final := h.canvas(t)
	finalDraft := final["nodes"].([]any)[0].(map[string]any)["metadata"].(map[string]any)["composerContent"]
	if finalDraft != "Change to night scene" {
		t.Fatalf("Stale writes should not be overwritten, getting %v", finalDraft)
	}
}

// 只读操作不接受幂等键：否则读也会开事务，在单连接池上自等死锁。
func TestReadOperationRejectsOperationID(t *testing.T) {
	h := newHarness(t)
	_, err := h.run(t, "canvas.get", "read-with-op-id", map[string]any{"canvasId": h.canvasID}, false)
	if code := opCode(t, err); code != agentops.CodeInvalidArgument {
		t.Fatalf("Read-only operations with opId should be rejected and get %v", code)
	}
	result, err := h.run(t, "canvas.get", "", map[string]any{"canvasId": h.canvasID}, false)
	if err != nil {
		t.Fatalf("Read-only operations should be available: %v", err)
	}
	if result.Replayed {
		t.Fatal("Read-only operations should not have replay markers")
	}
}

func TestReadOnlyClientCannotWriteAndCapabilityListIsFiltered(t *testing.T) {
	h := newHarness(t)
	_, err := h.run(t, "canvas.nodes.create", "op-ro", map[string]any{"canvasId": h.canvasID,
		"expectedRevision": h.revision, "nodes": []any{map[string]any{"title": "X", "type": "image"}}}, true)
	if code := opCode(t, err); code != agentops.CodeReadOnly {
		t.Fatalf("Read-only client writes should be rejected, getting %v", code)
	}
	readOnly := h.registry.List(agentops.Caller{ReadOnly: true})
	for _, descriptor := range readOnly {
		if !descriptor.ReadOnly {
			t.Fatalf("Read-only capability list mixed with write operations: %s", descriptor.ID)
		}
		if descriptor.ID == "skill.script.run" {
			t.Fatal("Read-only capability lists should not contain skill.script.run")
		}
	}
	if len(readOnly) != 21 {
		t.Fatalf("Read only operations should be 21 and get %d", len(readOnly))
	}
	if _, err := h.run(t, "canvas.get", "", map[string]any{"canvasId": h.canvasID}, true); err != nil {
		t.Fatalf("Read-only client read operations should be available: %v", err)
	}
}

func TestWriteOperationsExposeStableOperationIDInSchema(t *testing.T) {
	h := newHarness(t)
	for _, descriptor := range h.registry.List(agentops.Caller{}) {
		if descriptor.ReadOnly {
			continue
		}
		if !contains(string(descriptor.Params), "operationId") {
			t.Fatalf("The write operation schema is not exposed operationId: %s", descriptor.ID)
		}
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Serialization failed: %v", err)
	}
	return string(encoded)
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}

// 节点类型没有声明的可编辑字段必须给出稳定 reason unsupported_field，
// 并且不能推进 revision（整批不写）。结构节点（script/frame）的名称仍可改。
func TestUnsupportedNodeFieldIsMachineReadableAndDoesNotWrite(t *testing.T) {
	h := newHarness(t)
	_, err := h.run(t, "canvas.nodes.create", "op-structure", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "script node", "type": "script"}},
	}, false)
	if err != nil {
		t.Fatalf("Failed to create script node: %v", err)
	}
	canvas := h.canvas(t)
	revision := int64(canvas["revision"].(float64))
	var scriptID string
	for _, raw := range canvas["nodes"].([]any) {
		node := raw.(map[string]any)
		if node["type"] == "script" {
			scriptID = node["id"].(string)
		}
	}
	if scriptID == "" {
		t.Fatal("Script node not found")
	}

	opErr := func(err error) *agentops.Error {
		var typed *agentops.Error
		if !errors.As(err, &typed) {
			t.Fatalf("Expected structured operation error, got %v", err)
		}
		return typed
	}

	// title 是通用字段：结构节点改名必须成功。
	if _, err := h.run(t, "canvas.node.update", "op-title", map[string]any{
		"canvasId": h.canvasID, "nodeId": scriptID, "expectedRevision": revision,
		"patch": map[string]any{"title": "Rename script node"},
	}, false); err != nil {
		t.Fatalf("The structure node rename should be successful: %v", err)
	}
	afterTitle := h.canvas(t)
	if afterTitle["revision"].(float64) != float64(revision+1) {
		t.Fatalf("The name change should be pushed forward revision: %#v", afterTitle["revision"])
	}

	// 未声明字段：reason=unsupported_field，且 revision 不推进。
	_, err = h.run(t, "canvas.node.update", "op-unsupported", map[string]any{
		"canvasId": h.canvasID, "nodeId": scriptID, "expectedRevision": revision + 1,
		"patch": map[string]any{"content": "should not write"},
	}, false)
	if err == nil {
		t.Fatal("Undeclared fields should be rejected")
	}
	if reason := opErr(err).Reason; reason != "unsupported_field" {
		t.Fatalf("reason should be unsupported_field, actual %q", reason)
	}
	final := h.canvas(t)
	if final["revision"].(float64) != float64(revision+1) {
		t.Fatalf("Rejected updates should not be pushed forward revision: %#v", final["revision"])
	}
}
