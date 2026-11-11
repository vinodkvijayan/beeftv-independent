package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 结算与归属的边界回归：
// 1. 回执查询失败绝不能被当成「这一轮没有改动」——否则轮前文档会被清空、撤销失效；
// 2. 重复结算不能清掉已撤销/已结算的证据；
// 3. 没有推进版本的幂等写入（例如重复连线）不算这一轮的改动；
// 4. 只有 open 且属于同一用户的回合才能被内置宿主读取范围。

func TestFinalizeKeepsSnapshotWhenReceiptQueryFails(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "turns.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "local workspace"}).Error; err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), dir)
	doc := map[string]any{"id": "canvas-1", "title": "Undo return", "revision": 0,
		"nodes":       []any{map[string]any{"id": "n1", "type": "text", "title": "original node", "position": map[string]any{"x": 0, "y": 0}}},
		"connections": []any{}}
	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpsertUserCanvasProject("local", encoded); err != nil {
		t.Fatal(err)
	}
	canvasID := "canvas-1"
	turnID := "1100110011001100"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	after := appendNode(t, service, canvasID, "n2")
	recordTurnReceipt(t, service, turnID, "op-create-n2", "canvas.nodes.create",
		map[string]any{"canvasId": canvasID, "revision": after, "created": []any{map[string]any{"id": "n2", "title": "n2"}}})

	sqlDB, err := service.Database().DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	if err := service.FinalizeAssistantTurn(turnID); err == nil {
		t.Fatal("When the receipt query fails, the settlement must return an error instead of silently treating it as if there is no change.")
	}
	reopenedDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	reopened := NewLocal(repository.New(reopenedDB), dir)
	record, readErr := reopened.loadAssistantTurn(turnID)
	if readErr != nil {
		t.Fatalf("Round records must be kept: %v", readErr)
	}
	if record.State != assistantTurnStateOpen {
		t.Fatalf("The round should not be marked as settled after query failure, resulting in %q", record.State)
	}
	if len(record.Document) == 0 {
		t.Fatal("After the query fails, the previous document must be retained, otherwise the revocation will be invalid.")
	}
	if record.Change != nil {
		t.Fatal("Incomplete change summaries should not be written when a query fails")
	}
}

func TestFinalizeKeepsSnapshotWithoutReceiptDatabase(t *testing.T) {
	service, canvasID, _ := newAssistantTurnService(t)
	turnID := "7700770077007700"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	record, err := service.loadAssistantTurn(turnID)
	if err != nil {
		t.Fatal(err)
	}
	writeLegacyTurnFixture(t, service.dataDir, record)
	withoutRepository := &Service{dataDir: service.dataDir}
	if err := withoutRepository.FinalizeAssistantTurn(turnID); err == nil {
		t.Fatal("missing receipt database must fail settlement")
	}
	record, err = service.loadAssistantTurn(turnID)
	if err != nil || record.State != assistantTurnStateOpen || len(record.Document) == 0 {
		t.Fatalf("unavailable receipts must preserve open snapshot: %+v, %v", record, err)
	}
	if _, err := service.assistantTurnChangeFromReceipts(assistantTurnRecord{}); err == nil {
		t.Fatal("missing turn identity must fail receipt lookup")
	}
}

func TestFinalizeIsIdempotentAndPreservesEvidence(t *testing.T) {
	service, canvasID, _ := newAssistantTurnService(t)
	turnID := "2200220022002200"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	after := appendNode(t, service, canvasID, "n2")
	recordTurnReceipt(t, service, turnID, "op-create-n2", "canvas.nodes.create",
		map[string]any{"canvasId": canvasID, "revision": after, "created": []any{map[string]any{"id": "n2", "title": "n2"}}})
	settleTurn(t, service, turnID)

	first, err := service.loadAssistantTurn(turnID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Change == nil || len(first.Document) == 0 {
		t.Fatalf("The first settlement should leave a summary of changes and pre-round documents: %+v", first)
	}
	// 重复结算必须幂等：不能把已经确认的变更摘要或轮前文档清掉。
	settleTurn(t, service, turnID)
	second, err := service.loadAssistantTurn(turnID)
	if err != nil {
		t.Fatal(err)
	}
	if second.Change == nil || len(second.Document) == 0 || second.State != assistantTurnStateSettled {
		t.Fatalf("Duplicate settlement cleared the confirmed evidence: %+v", second)
	}

	if _, err := service.AssistantTurns().Undo("local", canvasID, turnID); err != nil {
		t.Fatalf("Undo failed: %v", err)
	}
	// 撤销之后再结算一次也不能抹掉「已撤销」这件事。
	settleTurn(t, service, turnID)
	third, err := service.loadAssistantTurn(turnID)
	if err != nil {
		t.Fatal(err)
	}
	if !third.Undone || len(third.Document) == 0 {
		t.Fatalf("The revoked evidence was cleared by repeated settlement: %+v", third)
	}
}

func TestFinalizeIgnoresIdempotentWriteThatDidNotAdvanceRevision(t *testing.T) {
	service, canvasID, before := newAssistantTurnService(t)
	turnID := "3300330033003300"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	// 重复连线：领域原样返回，revision 没有推进。它不能被算成本轮新建了连线。
	recordTurnReceipt(t, service, turnID, "op-duplicate-edge", "canvas.edge.create",
		map[string]any{"canvasId": canvasID, "revision": before, "created": false, "edgeId": "e-existing"})
	settleTurn(t, service, turnID)

	record, err := service.loadAssistantTurn(turnID)
	if err != nil {
		t.Fatal(err)
	}
	if record.Change != nil {
		t.Fatalf("Idempotent writes without pushing the version should not produce a change summary: %+v", record.Change)
	}
	if _, err := service.AssistantTurns().Undo("local", canvasID, turnID); err == nil {
		t.Fatal("Rounds without changes shall be refused revocation")
	} else if turnErr, ok := err.(*AssistantTurnError); !ok || turnErr.Reason != AssistantTurnReasonNoChange {
		t.Fatalf("Cancellation reason should be %s, got %v", AssistantTurnReasonNoChange, err)
	}
}

func TestFinalizeDeduplicatesIdempotentReplayOnSameRevision(t *testing.T) {
	service, canvasID, before := newAssistantTurnService(t)
	turnID := "6600660066006600"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	first := appendNode(t, service, canvasID, "n2")
	second := appendNode(t, service, canvasID, "n3")
	recordTurnReceipt(t, service, turnID, "op-create-n2", "canvas.nodes.create",
		map[string]any{"canvasId": canvasID, "revision": first, "created": []any{map[string]any{"id": "n2", "title": "n2"}}})
	recordTurnReceipt(t, service, turnID, "op-create-n3", "canvas.nodes.create",
		map[string]any{"canvasId": canvasID, "revision": second, "created": []any{map[string]any{"id": "n3", "title": "n3"}}})
	// 第二次写入之后又做了一次重复连线：同一版本上原样返回，不能被记成第二次改动。
	recordTurnReceipt(t, service, turnID, "op-duplicate-edge", "canvas.edge.create",
		map[string]any{"canvasId": canvasID, "revision": second, "created": false, "edgeId": "e-existing"})
	settleTurn(t, service, turnID)

	record, err := service.loadAssistantTurn(turnID)
	if err != nil {
		t.Fatal(err)
	}
	if record.Change == nil {
		t.Fatal("This round does advance the version and should have a summary of changes")
	}
	if len(record.Change.OperationIDs) != 2 {
		t.Fatalf("Idempotent replay of the same version should not generate a second receipt: %v", record.Change.OperationIDs)
	}
	if record.Change.RevisionBefore != before || record.Change.RevisionAfter != second {
		t.Fatalf("The change interval should be (%d, %d], and we get (%d, %d]", before, second,
			record.Change.RevisionBefore, record.Change.RevisionAfter)
	}
	if _, err := service.AssistantTurns().Undo("local", canvasID, turnID); err != nil {
		t.Fatalf("The multi-write round after deduplication should be reversible: %v", err)
	}
	if ids := nodeIDs(t, service, canvasID); len(ids) != 1 || ids[0] != "n1" {
		t.Fatalf("After revocation, we should return to the set of nodes before the round and get %v", ids)
	}
}

func TestVerifyOpenAssistantTurnInTxRejectsSettledRound(t *testing.T) {
	service, canvasID, _ := newAssistantTurnService(t)
	turnID := "aabbccddeeff0011"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	if err := service.Database().Transaction(func(tx *gorm.DB) error {
		return service.VerifyOpenAssistantTurnInTx(tx, "local", turnID, canvasID)
	}); err != nil {
		t.Fatalf("open turn must verify inside tx: %v", err)
	}
	settleTurn(t, service, turnID)
	err := service.Database().Transaction(func(tx *gorm.DB) error {
		return service.VerifyOpenAssistantTurnInTx(tx, "local", turnID, canvasID)
	})
	if err == nil {
		t.Fatal("settled turn must not verify as open inside operation tx")
	}
}

func TestAssistantTurnScopeRequiresOpenOwnedTurn(t *testing.T) {
	service, canvasID, _ := newAssistantTurnService(t)
	turnID := "4400440044004400"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	scope, ok, err := service.AssistantTurns().ScopeForHost("local", turnID)
	if err != nil || !ok {
		t.Fatalf("The opening round should have a readable range of: ok=%v err=%v", ok, err)
	}
	if scope.CanvasID != canvasID {
		t.Fatalf("The canvas in the range should be %s, and we get %s", canvasID, scope.CanvasID)
	}
	if _, ok, _ := service.AssistantTurns().ScopeForHost("other-user", turnID); ok {
		t.Fatal("Other users should not read the scope of this round")
	}
	settleTurn(t, service, turnID)
	if _, ok, _ := service.AssistantTurns().ScopeForHost("local", turnID); ok {
		t.Fatal("Settled rounds should no longer accept write attribution")
	}
	if _, ok, _ := service.AssistantTurns().ScopeForHost("local", "not-a-turn"); ok {
		t.Fatal("Unknown rounds should not be given a range")
	}
}

func TestCanvasAssociatedReferencesUseExistingParsers(t *testing.T) {
	// 画布关联的素材沿用既有媒体引用解析（resource:<id> + assetId），任务取生成批次的 taskId。
	// 这里直接验证解析本身：带未就绪资源引用的画布不会被领域写入口接受，所以不能靠 Upsert 造样本。
	raw, err := json.Marshal(map[string]any{
		"id": "canvas-1", "revision": 5,
		"nodes": []any{
			map[string]any{"id": "n1", "type": "image", "title": "lens",
				"metadata": map[string]any{"assetId": "asset-1", "storageKey": "resource:res-1",
					"generationBatch": map[string]any{"taskId": "task-1",
						"agentGenerationContinuation": map[string]any{"taskId": "task-2"}}}},
			map[string]any{"id": "n2", "type": "text", "title": "narration", "metadata": map[string]any{"assetId": "asset-ignored"}},
		},
		"connections": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	assets, tasks := canvasAssociatedReferences(raw)
	if !containsAll(assets, "asset-1") {
		t.Fatalf("Material association should reuse media reference analysis: %v", assets)
	}
	if containsAll(assets, "asset-ignored") {
		t.Fatalf("AssetIds without real resource references should not be treated as associated assets: %v", assets)
	}
	if !containsAll(tasks, "task-1", "task-2") {
		t.Fatalf("The task association should include batch generation and continuation tasks: %v", tasks)
	}
}

func TestBeginAssistantTurnPersistsVerifiedReferences(t *testing.T) {
	service, canvasID, _ := newAssistantTurnService(t)
	turnID := "5500550055005500"
	if _, err := service.BeginAssistantTurn("local", canvasID, turnID, AssistantTurnInput{
		SelectedNodeIDs: []string{"n1"}, AssetIDs: []string{"asset-explicit"}, CanvasIDs: []string{"canvas-ref"},
	}); err != nil {
		t.Fatal(err)
	}
	scope, ok, err := service.AssistantTurns().ScopeForHost("local", turnID)
	if err != nil || !ok {
		t.Fatalf("The opening round should have a readable range of: ok=%v err=%v", ok, err)
	}
	if !containsAll(scope.AssetIDs, "asset-explicit") {
		t.Fatalf("Explicit material references should go into range: %v", scope.AssetIDs)
	}
	if !containsAll(scope.CanvasIDs, "canvas-ref") {
		t.Fatalf("Extra canvas reference should go into scope: %v", scope.CanvasIDs)
	}
}

func writeLegacyTurnFixture(t *testing.T, dataDir string, record assistantTurnRecord) {
	t.Helper()
	dir := filepath.Join(dataDir, "assistant-turns")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{
		"turnId": record.TurnID, "userId": record.UserID, "canvasId": record.CanvasID,
		"revisionBefore": record.RevisionBefore, "createdAt": record.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z"),
		"state": record.State, "selectedNodeIds": record.SelectedNodeIDs,
		"referencedAssetIds": record.ReferencedAssetIDs, "referencedCanvasIds": record.ReferencedCanvasIDs,
		"associatedAssetIds": record.AssociatedAssetIDs, "associatedTaskIds": record.AssociatedTaskIDs,
		"undone": record.Undone, "change": record.Change, "document": record.Document,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, record.TurnID+".json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func containsAll(values []string, want ...string) bool {
	set := map[string]bool{}
	for _, value := range values {
		set[value] = true
	}
	for _, item := range want {
		if !set[item] {
			return false
		}
	}
	return true
}
