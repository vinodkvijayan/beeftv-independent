package operations_test

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/operations"
	"infinite-canvas/backend/internal/repository"
)

type harness struct {
	registry *operations.Registry
	service  *app.Service
	userID   string
	canvasID string
	revision int64
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "operations.db")),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "local workspace"}).Error; err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(repository.New(db), t.TempDir())
	registry := operations.NewRegistry(service, operations.NewStore(db))
	operations.RegisterDefaultOps(registry)
	canvasID := "ops-canvas"
	encoded, err := json.Marshal(map[string]any{
		"id": canvasID, "title": "Operation layer canvas", "revision": 0,
		"nodes": []any{
			map[string]any{"id": "n1", "type": "image", "title": "Shot 1", "position": map[string]any{"x": 1, "y": 1},
				"width": 320, "height": 220, "metadata": map[string]any{"prompt": "original"}},
			map[string]any{"id": "n2", "type": "image", "title": "Shot 2", "position": map[string]any{"x": 2, "y": 2},
				"width": 320, "height": 220, "metadata": map[string]any{"prompt": "original 2"}},
		},
		"connections": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpsertUserCanvasProject("local", encoded); err != nil {
		t.Fatal(err)
	}
	raw, err := service.UserCanvasProject("local", canvasID)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	return &harness{registry: registry, service: service, userID: "local", canvasID: canvasID, revision: int64(stored["revision"].(float64))}
}

func (h *harness) execute(t *testing.T, caller operations.Caller, op, opID string, params map[string]any) (operations.Result, error) {
	t.Helper()
	encoded, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	return h.registry.Execute(operations.Request{
		Op: op, OpID: opID, UserID: h.userID, Caller: caller, Params: encoded,
	})
}

func (h *harness) assistant() operations.Caller {
	return operations.AssistantCaller(&agentops.AssistantScope{
		CanvasID:  h.canvasID,
		AssetIDs:  map[string]bool{},
		CanvasIDs: map[string]bool{},
		TaskIDs:   map[string]bool{},
	}, false)
}

func (h *harness) revisionNow(t *testing.T) int64 {
	t.Helper()
	raw, err := h.service.UserCanvasProject(h.userID, h.canvasID)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	return int64(stored["revision"].(float64))
}

func opErr(t *testing.T, err error) *operations.Error {
	t.Helper()
	var typed *operations.Error
	if !errors.As(err, &typed) {
		t.Fatalf("Expected structured operation error, got %v", err)
	}
	return typed
}

func TestSameWriteOperationAcrossManualAssistantExternal(t *testing.T) {
	h := newHarness(t)
	callers := []struct {
		name   string
		caller operations.Caller
	}{
		{"manual", operations.ManualCaller(false)},
		{"assistant", h.assistant()},
		{"external", operations.ExternalCaller(false)},
	}
	for _, item := range callers {
		t.Run(item.name, func(t *testing.T) {
			revision := h.revisionNow(t)
			result, err := h.execute(t, item.caller, "canvas.nodes.create", "create-"+item.name, map[string]any{
				"canvasId": h.canvasID, "expectedRevision": revision,
				"nodes": []any{map[string]any{"title": "by" + item.name + "Create", "type": "image"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.Replayed || result.Caller != item.caller.Kind || result.Revision == 0 || result.OpID != "create-"+item.name {
				t.Fatalf("Envelope exception: %#v", result)
			}
			receipt := result.Receipt("")
			if receipt.OperationID != result.OpID || receipt.Revision != result.Revision || receipt.Caller != item.caller.Kind {
				t.Fatalf("Exception in receipt: %#v", receipt)
			}
		})
	}
}

func TestReplayAndConflictAreSharedAcrossCallers(t *testing.T) {
	h := newHarness(t)
	params := map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "Shared idempotence", "type": "image"}},
	}
	first, err := h.execute(t, operations.ManualCaller(false), "canvas.nodes.create", "shared-op", params)
	if err != nil {
		t.Fatal(err)
	}
	before := h.revisionNow(t)
	for _, caller := range []operations.Caller{h.assistant(), operations.ExternalCaller(false), operations.ManualCaller(false)} {
		replay, err := h.execute(t, caller, "canvas.nodes.create", "shared-op", params)
		if err != nil {
			t.Fatalf("%s playback failed: %v", caller.Kind, err)
		}
		if !replay.Replayed || replay.Revision != first.Revision {
			t.Fatalf("%s must read back the original result: %#v", caller.Kind, replay)
		}
	}
	if h.revisionNow(t) != before {
		t.Fatal("Playback advances canvas version")
	}
	_, err = h.execute(t, operations.ExternalCaller(false), "canvas.nodes.create", "shared-op", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "different content", "type": "image"}},
	})
	if got := opErr(t, err); got.Code != operations.CodeConflict || got.Reason != "operation_id_reused_with_different_payload" {
		t.Fatalf("Different payloads should conflict and get %v", err)
	}
}

func TestAuthorizationHappensBeforeReplay(t *testing.T) {
	h := newHarness(t)
	params := map[string]any{
		"canvasId": h.canvasID, "nodeId": "n1", "expectedRevision": h.revision,
		"patch": map[string]any{"title": "Title submitted"},
	}
	first, err := h.execute(t, operations.ManualCaller(false), "canvas.node.update", "auth-before-replay", params)
	if err != nil {
		t.Fatal(err)
	}
	before := h.revisionNow(t)
	_, err = h.execute(t, operations.ExternalCaller(true), "canvas.node.update", "auth-before-replay", params)
	if got := opErr(t, err); got.Code != operations.CodeReadOnly || got.Reason != "read_only_client" {
		t.Fatalf("Read-only playback should be rejected during authorization phase: %v", err)
	}
	foreign := operations.AssistantCaller(&agentops.AssistantScope{CanvasID: "other-canvas"}, false)
	_, err = h.execute(t, foreign, "canvas.node.update", "auth-before-replay", params)
	if got := opErr(t, err); got.Code != operations.CodePermissionDenied || got.Reason != "scope_denied" {
		t.Fatalf("Out-of-bounds assistant playback should be rejected during authorization phase: %v", err)
	}
	if h.revisionNow(t) != before {
		t.Fatal("Rejected replay change canvas")
	}
	replay, err := h.execute(t, operations.ManualCaller(false), "canvas.node.update", "auth-before-replay", params)
	if err != nil || !replay.Replayed || replay.Revision != first.Revision {
		t.Fatalf("Playback should still be performed after authorization is passed: %#v %v", replay, err)
	}
}

func TestAssistantCannotUseWorkspaceWideOps(t *testing.T) {
	h := newHarness(t)
	visible := map[string]bool{}
	for _, descriptor := range h.registry.List(h.assistant()) {
		visible[descriptor.ID] = true
		if !descriptor.ReadOnly && jsonContains(descriptor.Params, "operationId") {
			t.Fatalf("The helper schema should not require the model to fill in operationId: %s", descriptor.ID)
		}
	}
	if visible["asset.list"] || visible["canvas.search"] {
		t.Fatalf("The assistant saw the workspace level operation: %v", visible)
	}
	_, err := h.execute(t, h.assistant(), "asset.list", "", map[string]any{})
	if got := opErr(t, err); got.Code != operations.CodePermissionDenied {
		t.Fatalf("Assistant execution asset.list should be rejected: %v", err)
	}
	manual := h.registry.List(operations.ManualCaller(false))
	if len(manual) != 44 {
		t.Fatalf("The manual UI should see the full 44 capabilities: %d", len(manual))
	}
	foundDocumentCommit := false
	for _, descriptor := range manual {
		if descriptor.ID == "canvas.document.commit" {
			foundDocumentCommit = true
		}
	}
	if !foundDocumentCommit {
		t.Fatal("Manual UI must see canvas.document.commit")
	}
	if len(manual) <= len(visible) {
		t.Fatalf("Manual UI should see full capabilities: %d <= %d", len(manual), len(visible))
	}
	foundOperationID := false
	for _, descriptor := range manual {
		if !descriptor.ReadOnly && jsonContains(descriptor.Params, "operationId") {
			foundOperationID = true
		}
	}
	if !foundOperationID {
		t.Fatal("Manual UI write operation schema must contain operationId")
	}
}

func TestFailedWriteDoesNotLeaveReceipt(t *testing.T) {
	h := newHarness(t)
	_, err := h.execute(t, operations.ManualCaller(false), "canvas.nodes.create", "failed-write", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revision + 99,
		"nodes": []any{map[string]any{"title": "Should not place the order", "type": "image"}},
	})
	if err == nil {
		t.Fatal("Expired revisions must fail")
	}
	before := h.revisionNow(t)
	retry, replayErr := h.execute(t, operations.ExternalCaller(false), "canvas.nodes.create", "failed-write", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": before,
		"nodes": []any{map[string]any{"title": "Try again after failure", "type": "image"}},
	})
	if replayErr != nil {
		t.Fatalf("Failed writes should not leave a receipt: %v", replayErr)
	}
	if retry.Replayed {
		t.Fatal("The same operationId after failure should not be the playback")
	}
}

func TestPaidProposeRejectsIdempotencyKey(t *testing.T) {
	h := newHarness(t)
	_, err := h.execute(t, operations.ManualCaller(false), "canvas.generation.propose", "should-not-exist", map[string]any{
		"canvasId": h.canvasID, "nodeIds": []any{"n1"}, "kind": "image",
	})
	if got := opErr(t, err); got.Reason != "unexpected_op_id" {
		t.Fatalf("Read-only proposals should not be accepted opId: %v", err)
	}
}

func jsonContains(raw json.RawMessage, needle string) bool {
	body := string(raw)
	return strings.Contains(body, needle)
}
