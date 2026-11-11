package operations_test

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/operations"
)

func TestDocumentCommitManualAndAgentInterleaving(t *testing.T) {
	h := newHarness(t)
	overlay := map[string]any{
		"id": h.canvasID, "title": "Manual full page",
		"nodes": []any{
			map[string]any{"id": "n1", "type": "image", "title": "handmade lens", "position": map[string]any{"x": 1, "y": 1},
				"width": 320, "height": 220, "metadata": map[string]any{"prompt": "handmade"}},
			map[string]any{"id": "n2", "type": "image", "title": "Shot 2", "position": map[string]any{"x": 2, "y": 2},
				"width": 320, "height": 220, "metadata": map[string]any{"prompt": "original 2"}},
		},
		"connections": []any{},
	}
	first, err := h.execute(t, operations.ManualCaller(false), "canvas.document.commit", "manual-doc-1", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revisionNow(t), "document": overlay,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Replayed || first.Caller != operations.CallerManual || first.Revision == 0 {
		t.Fatalf("Exception when submitting envelope manually: %#v", first)
	}
	agentRev := h.revisionNow(t)
	agent, err := h.execute(t, h.assistant(), "canvas.node.update", "agent-patch-1", map[string]any{
		"canvasId": h.canvasID, "nodeId": "n1", "expectedRevision": agentRev,
		"patch": map[string]any{"title": "Assistant name change"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if agent.Revision == first.Revision {
		t.Fatal("Helper writes should advance to revision")
	}
	_, err = h.execute(t, operations.ManualCaller(false), "canvas.document.commit", "manual-stale", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": first.Revision, "document": overlay,
	})
	if got := opErr(t, err); got.Code != operations.CodeConflict {
		t.Fatalf("Stale manual commit must conflict: %v", err)
	}
	raw, err := h.service.UserCanvasProject(h.userID, h.canvasID)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	nodes := stored["nodes"].([]any)
	title, _ := nodes[0].(map[string]any)["title"].(string)
	if title != "Assistant name change" {
		t.Fatalf("Stale manual submissions must not overwrite assistant changes: %s", raw)
	}
}

func TestDocumentCommitReplayAndPayloadConflict(t *testing.T) {
	h := newHarness(t)
	params := map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revisionNow(t),
		"document": map[string]any{"title": "Idempotent submission", "nodes": []any{}, "connections": []any{}},
	}
	first, err := h.execute(t, operations.ManualCaller(false), "canvas.document.commit", "doc-replay", params)
	if err != nil {
		t.Fatal(err)
	}
	before := h.revisionNow(t)
	replay, err := h.execute(t, operations.ExternalCaller(false), "canvas.document.commit", "doc-replay", params)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || replay.Revision != first.Revision {
		t.Fatalf("Lost response replay must read back the original result: %#v", replay)
	}
	if h.revisionNow(t) != before {
		t.Fatal("Replay advances canvas version")
	}
	var receipts int64
	if err := h.service.Database().Model(&model.AgentOpRecord{}).Where("user_id = ? AND op_id = ?", h.userID, "doc-replay").Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if receipts != 1 {
		t.Fatalf("There should be only one receipt for the same operation, getting %d", receipts)
	}
	_, err = h.execute(t, operations.ManualCaller(false), "canvas.document.commit", "doc-replay", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revision,
		"document": map[string]any{"title": "different content", "nodes": []any{}, "connections": []any{}},
	})
	if got := opErr(t, err); got.Reason != "operation_id_reused_with_different_payload" {
		t.Fatalf("Different payloads should conflict and get %v", err)
	}
}

func TestAssistantCannotCommitDocument(t *testing.T) {
	h := newHarness(t)
	for _, descriptor := range h.registry.List(h.assistant()) {
		if descriptor.ID == "canvas.document.commit" {
			t.Fatal("Assistant capability discovery must not contain full page document submissions")
		}
	}
	_, err := h.execute(t, h.assistant(), "canvas.document.commit", "assistant-doc", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revisionNow(t),
		"document": map[string]any{"title": "ultra vires", "nodes": []any{}, "connections": []any{}},
	})
	if got := opErr(t, err); got.Code != operations.CodePermissionDenied {
		t.Fatalf("Assistant performing full page submission should be rejected: %v", err)
	}
	empty := operations.AssistantCaller(&agentops.AssistantScope{}, false)
	_, err = h.execute(t, empty, "canvas.document.commit", "empty-scope-doc", map[string]any{
		"canvasId": h.canvasID, "expectedRevision": h.revisionNow(t),
		"document": map[string]any{"title": "empty range", "nodes": []any{}, "connections": []any{}},
	})
	if got := opErr(t, err); got.Code != operations.CodePermissionDenied {
		t.Fatalf("Full page submission performed with an empty assistant range should be rejected: %v", err)
	}
}

func TestDocumentCommitRequiresExpectedRevision(t *testing.T) {
	h := newHarness(t)
	_, err := h.execute(t, operations.ManualCaller(false), "canvas.document.commit", "missing-rev", map[string]any{
		"canvasId": h.canvasID, "document": map[string]any{"title": "Missing version"},
	})
	if got := opErr(t, err); got.Code != operations.CodeInvalidArgument {
		t.Fatalf("Missing expectedRevision should be rejected: %v", err)
	}
}

func TestCanvasCreateOperationAndReplay(t *testing.T) {
	h := newHarness(t)
	if _, err := h.execute(t, operations.AssistantCaller(&agentops.AssistantScope{CanvasID: h.canvasID, PermissionMode: "full-access"}, false), "canvas.create", "create-op-assistant", map[string]any{
		"title": "Built-in helpers should not be able to create canvases",
	}); err == nil {
		t.Fatal("expected assistant caller to be denied canvas.create")
	}
	created, err := h.execute(t, operations.ExternalCaller(false), "canvas.create", "create-op-1", map[string]any{
		"title": "Create canvas externally",
	})
	if err != nil {
		t.Fatalf("canvas.create: %v", err)
	}
	res, _ := created.Result.(map[string]any)
	canvasID, _ := res["canvasId"].(string)
	if canvasID == "" || res["title"] != "Create canvas externally" || created.Revision != 1 {
		t.Fatalf("unexpected canvas.create result: %#v", created)
	}
	replay, err := h.execute(t, operations.ExternalCaller(false), "canvas.create", "create-op-1", map[string]any{
		"title": "Create canvas externally",
	})
	if err != nil || !replay.Replayed {
		t.Fatalf("expected replay of canvas.create, got %#v (err=%v)", replay, err)
	}
	raw, err := h.service.UserCanvasProject(h.userID, canvasID)
	if err != nil {
		t.Fatalf("UserCanvasProject(%s): %v", canvasID, err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if _, ok := doc["nodes"].([]any); !ok {
		t.Fatalf("expected nodes array on created canvas: %s", raw)
	}
	if _, ok := doc["connections"].([]any); !ok {
		t.Fatalf("expected connections array on created canvas: %s", raw)
	}
	if _, err := h.execute(t, operations.ExternalCaller(false), "canvas.create", "create-op-dup", map[string]any{
		"canvasId": canvasID,
		"title":    "Duplicate ID canvas",
	}); err == nil {
		t.Fatal("expected canvas.create with existing canvasId to fail with conflict")
	}
	store := operations.NewStore(h.service.Database())
	writes, err := store.ListExternalCanvasWrites(h.userID, canvasID)
	if err != nil || len(writes) != 1 || writes[0].Op != "canvas.create" {
		t.Fatalf("expected external write record for canvas.create, got %+v (err=%v)", writes, err)
	}
	undone, err := store.UndoExternalCanvasWrite(t.Context(), h.service, h.userID, canvasID, "create-op-1")
	if err != nil || !undone.Undone {
		t.Fatalf("UndoExternalCanvasWrite(canvas.create): %+v (err=%v)", undone, err)
	}
	if _, err := h.service.UserCanvasProject(h.userID, canvasID); err == nil {
		t.Fatal("expected created canvas to be deleted after undo")
	}
	// 删除后若用相同 canvasId 重建新画布，旧 canvas.create 记录不得误删新建实例
	if _, err := h.execute(t, operations.ExternalCaller(false), "canvas.create", "create-op-2", map[string]any{
		"canvasId": "canvas-recreated",
		"title":    "first edition",
	}); err != nil {
		t.Fatalf("canvas.create first instance: %v", err)
	}
	if err := h.service.BindDomain(nil).(operations.CanvasProjectCreator).DeleteUserCanvasProject(h.userID, "canvas-recreated"); err != nil {
		t.Fatalf("DeleteUserCanvasProject: %v", err)
	}
	if _, err := h.execute(t, operations.ExternalCaller(false), "canvas.create", "create-op-3", map[string]any{
		"canvasId": "canvas-recreated",
		"title":    "Rebuild",
	}); err != nil {
		t.Fatalf("canvas.create second instance: %v", err)
	}
	if _, err := store.UndoExternalCanvasWrite(t.Context(), h.service, h.userID, "canvas-recreated", "create-op-2"); err == nil {
		t.Fatal("expected undo of superseded canvas.create to fail with conflict")
	}
	if _, err := h.service.UserCanvasProject(h.userID, "canvas-recreated"); err != nil {
		t.Fatalf("expected recreated canvas to remain intact: %v", err)
	}
}
