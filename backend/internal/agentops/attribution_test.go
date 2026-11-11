package agentops_test

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/model"
)

// 稳定 operationId 的跨回合重放不能把归属搬走：同一 opId 回读原结果时，
// 回执仍然属于最早执行它的那一轮，新回合不能借重放「认领」别人的写入。
func TestStableReplayDoesNotMoveTurnAttribution(t *testing.T) {
	h := newHarness(t)
	for _, turnID := range []string{"aaaabbbb", "ccccdddd"} {
		if _, err := h.service.BeginAssistantTurn(h.userID, h.canvasID, turnID, app.AssistantTurnInput{}); err != nil {
			t.Fatal(err)
		}
	}
	body := map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "stable identity", "type": "image"}}}
	params := mustRaw(t, body)
	first, err := h.registry.Execute(agentops.Request{Op: "canvas.nodes.create", OpID: "stable-op-1",
		UserID: "local", Params: params, TurnID: "aaaabbbb"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Replayed {
		t.Fatal("The first execution should not be a replay")
	}
	replay, err := h.registry.Execute(agentops.Request{Op: "canvas.nodes.create", OpID: "stable-op-1",
		UserID: "local", Params: params, TurnID: "ccccdddd"})
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || mustJSON(t, replay.Result) != mustJSON(t, first.Result) {
		t.Fatal("The same opId and the same payload must read back the original results.")
	}
	if record := lookupOpRecord(t, h, "stable-op-1"); record.TurnID != "aaaabbbb" {
		t.Fatalf("Replay cannot move ownership to the new round: %q", record.TurnID)
	}
}

// 没有回合归属的外部写入（CLI/MCP）保持 turn_id 为空，不会被误当成某轮助手的改动。
func TestExternalWriteHasNoTurnAttribution(t *testing.T) {
	h := newHarness(t)
	params := mustRaw(t, map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "external write", "type": "image"}}})
	if _, err := h.registry.Execute(agentops.Request{Op: "canvas.nodes.create", OpID: "external-op-1",
		UserID: "local", Params: params}); err != nil {
		t.Fatal(err)
	}
	if record := lookupOpRecord(t, h, "external-op-1"); record.TurnID != "" {
		t.Fatalf("External writes should not take turn ownership: %q", record.TurnID)
	}
}

// 严格解码：未知字段（含 patch/nodes 内部）整批拒绝，写入与幂等记录都不落地。
func TestStrictDecodeRejectsUnknownFieldsBeforeWriting(t *testing.T) {
	h := newHarness(t)
	cases := []struct {
		name, op, opID string
		build          func() map[string]any
		field          string
	}{
		{"Mix in unknown fields at the top level", "canvas.nodes.create", "unknown-top", func() map[string]any {
			return map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
				"nodes": []any{map[string]any{"title": "A", "type": "image"}}, "temperature": 0.7}
		}, "temperature"},
		{"Unknown fields are mixed into the patch", "canvas.node.update", "unknown-patch", func() map[string]any {
			return map[string]any{"canvasId": h.canvasID, "nodeId": "n1", "expectedRevision": h.revision,
				"patch": map[string]any{"title": "A", "temperature": 0.7}}
		}, "temperature"},
		{"Unknown fields are mixed in the nodes item", "canvas.nodes.create", "unknown-node", func() map[string]any {
			return map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
				"nodes": []any{map[string]any{"title": "A", "type": "image", "temperature": 0.7}}}
		}, "temperature"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := mustJSON(t, h.canvas(t))
			_, err := h.registry.Execute(agentops.Request{Op: tc.op, OpID: tc.opID, UserID: "local", Params: mustRaw(t, tc.build())})
			opErr := agentops.AsError(err)
			if opErr == nil || opErr.Code != agentops.CodeInvalidArgument || opErr.Reason != "unknown_field" {
				t.Fatalf("Unknown fields must be rejected in batches, resulting in %v", err)
			}
			if opErr.Details["field"] != tc.field {
				t.Fatalf("The unknown field name should be %s, and got %v", tc.field, opErr.Details["field"])
			}
			if after := mustJSON(t, h.canvas(t)); after != before {
				t.Fatal("Rejected requests cannot modify the canvas")
			}
			if countOpRecords(t, h, tc.opID) != 0 {
				t.Fatal("Rejected requests cannot leave idempotent records")
			}
		})
	}
}

// schema 的 operationId 与 envelope 的 opId 冲突必须明确拒绝，不能悄悄任选一个。
func TestOperationIDConflictIsExplicit(t *testing.T) {
	h := newHarness(t)
	body := map[string]any{"canvasId": h.canvasID, "expectedRevision": h.revision,
		"nodes": []any{map[string]any{"title": "A", "type": "image"}}, "operationId": "schema-id"}
	params := mustRaw(t, body)
	before := mustJSON(t, h.canvas(t))

	_, err := h.registry.Execute(agentops.Request{Op: "canvas.nodes.create", OpID: "envelope-id", UserID: "local", Params: params})
	opErr := agentops.AsError(err)
	if opErr == nil || opErr.Code != agentops.CodeInvalidArgument || opErr.Reason != "operation_id_conflict" {
		t.Fatalf("Two inconsistent idempotent identities must be rejected, resulting in %v", err)
	}
	if after := mustJSON(t, h.canvas(t)); after != before {
		t.Fatal("Conflicting requests cannot modify the canvas")
	}
	if countOpRecords(t, h, "envelope-id") != 0 || countOpRecords(t, h, "schema-id") != 0 {
		t.Fatal("Conflicting requests cannot be implemented into any idempotent records")
	}

	// 两边一致时按同一个身份执行并回放。
	first, err := h.registry.Execute(agentops.Request{Op: "canvas.nodes.create", OpID: "schema-id", UserID: "local", Params: params})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := h.registry.Execute(agentops.Request{Op: "canvas.nodes.create", OpID: "schema-id", UserID: "local", Params: params})
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || mustJSON(t, replay.Result) != mustJSON(t, first.Result) {
		t.Fatal("Retries with the same idempotent identity must read back the original results.")
	}
}

func mustRaw(t *testing.T, value any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func lookupOpRecord(t *testing.T, h *harness, opID string) model.AgentOpRecord {
	t.Helper()
	var record model.AgentOpRecord
	if err := h.service.Database().Where("user_id = ? AND op_id = ?", "local", opID).First(&record).Error; err != nil {
		t.Fatalf("Failed to read operation receipt: %v", err)
	}
	return record
}

func countOpRecords(t *testing.T, h *harness, opID string) int64 {
	t.Helper()
	var count int64
	if err := h.service.Database().Model(&model.AgentOpRecord{}).Where("user_id = ? AND op_id = ?", "local", opID).
		Count(&count).Error; err != nil {
		t.Fatalf("Statistics operation receipt failed: %v", err)
	}
	return count
}
