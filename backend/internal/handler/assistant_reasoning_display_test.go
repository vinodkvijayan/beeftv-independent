package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// 思考展示字段只经过 Go 转发，不由后端重建：这里用替身宿主验证
// 「流式 reasoning_snapshot 原样到页面」和「历史回合的 reasoning 不被改写」两条契约，
// 同时确认后端仍然覆盖它自己负责的 outputs/change 等字段。

func TestAssistantChatForwardsReasoningSnapshotsAndTerminalReasoning(t *testing.T) {
	var captured struct {
		TurnID string `json:"turnId"`
	}
	env := newAssistantTestEnv(t, func(env *assistantTestEnv) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			env.hostHits[r.URL.Path]++
			if r.URL.Path == "/health" {
				_, _ = w.Write([]byte(`{"ok":true,"busy":false,"instance":"` + assistantInstanceProof() + `"}`))
				return
			}
			if r.URL.Path != "/chat" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/x-ndjson")
			for _, segments := range []string{
				`[{"id":"live-1:0","text":"先看画布。","status":"streaming"}]`,
				`[{"id":"live-1:0","text":"先看画布，再确认顺序。","status":"done"}]`,
			} {
				_, _ = w.Write([]byte(`{"type":"reasoning_snapshot","segments":` + segments + "}\n"))
			}
			_, _ = w.Write([]byte(`{"type":"text_snapshot","text":"已经确认顺序。"}` + "\n"))
			line, _ := json.Marshal(map[string]any{"type": "turn_end", "turnId": captured.TurnID, "reply": "The order has been confirmed.",
				"toolCalls": []any{}, "proposals": []any{}, "change": nil,
				"reasoning": []any{map[string]any{"id": "reasoning:0", "text": "Look at the canvas first and then confirm the order.", "status": "done"}}})
			_, _ = w.Write(append(line, '\n'))
		})
	})
	useEnvProvider(t, "chat-completion")

	recorder := env.call(t, http.MethodPost, "/assistant/chat",
		`{"canvasId":"`+env.canvasID+`","message":"Think first before answering","selectedNodeIds":[]}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("The conversation should succeed: %d %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	// 每个思考增量逐行到达，客户端据此边到边显示。
	if strings.Count(body, `"type":"reasoning_snapshot"`) != 2 {
		t.Fatalf("Thinking snapshots must be forwarded line by line as is: %s", body)
	}
	if !strings.Contains(body, `"text":"Look at the canvas first, and then confirm the order."`) {
		t.Fatalf("Think about incremental content and don’t lose it: %s", body)
	}
	// turn_end 由后端重新编码（它要校验回合归属），新字段必须活下来。
	lines := strings.Split(strings.TrimSpace(body), "\n")
	var end map[string]any
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &end); err != nil {
		t.Fatalf("The final state line is not a valid JSON: %v %s", err, lines[len(lines)-1])
	}
	reasoning, _ := end["reasoning"].([]any)
	if len(reasoning) != 1 {
		t.Fatalf("The final state must bring this round of thinking: %v", end)
	}
	segment, _ := reasoning[0].(map[string]any)
	if segment["text"] != "Look at the canvas first and then confirm the order." || segment["status"] != "done" {
		t.Fatalf("The final state thinking fragment has the wrong shape: %v", segment)
	}
}

func TestAssistantHistoryKeepsReasoningWhileRewritingHostOwnedFields(t *testing.T) {
	env := newAssistantTestEnv(t, func(env *assistantTestEnv) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			env.hostHits[r.URL.Path]++
			if r.URL.Path == "/health" {
				_, _ = w.Write([]byte(`{"ok":true,"busy":false,"instance":"` + assistantInstanceProof() + `"}`))
				return
			}
			if r.URL.Path != "/history" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"sessionId": "durable:00000000-0000-0000-0000-000000000001",
				"turns": []any{map[string]any{"turnId": "settled-turn", "reply": "The order has been confirmed.",
					"outputs":   []any{map[string]any{"taskId": "host-forged-task"}},
					"reasoning": []any{map[string]any{"id": "reasoning:0", "text": "Look at the canvas first and then confirm the order.", "status": "done"}}}},
				"active": map[string]any{"turnId": "running-turn", "status": "running", "streamed": "The first text paragraph.",
					"reasoning": []any{map[string]any{"id": "live-1:0", "text": "Still thinking.", "status": "streaming"}}},
			})
		})
	})
	useEnvProvider(t, "chat-completion")

	payload := decodeEnvelope(t, env.call(t, http.MethodGet, "/assistant/history?canvasId="+env.canvasID, ""))
	turns, _ := payload["turns"].([]any)
	if len(turns) != 1 {
		t.Fatalf("A historical round should be returned: %v", payload)
	}
	turn, _ := turns[0].(map[string]any)
	reasoning, _ := turn["reasoning"].([]any)
	if len(reasoning) != 1 {
		t.Fatalf("Historical rounds must be kept in mind: %v", turn)
	}
	// 后端仍然覆盖它自己负责的字段：宿主伪造的回执不能被页面当成真实产物。
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "host-forged-task") {
		t.Fatalf("Host forged outputs must be overridden by the backend: %s", encoded)
	}
	active, _ := payload["active"].(map[string]any)
	if active["streamed"] != "The first text paragraph." {
		t.Fatalf("The text progress of the event round must be retained: %v", active)
	}
	activeReasoning, _ := active["reasoning"].([]any)
	if len(activeReasoning) != 1 {
		t.Fatalf("The active round must retain the thinking being generated: %v", active)
	}
}
