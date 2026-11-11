package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/app"
)

// 真实宿主 + 真实 Go 业务层的效率测量（不用模拟器）。
//
// 默认用脚本化的假模型，只验证测量工具本身能跑通；设置 BEEFTV_REAL_BASELINE_URL / _KEY / _MODEL
// 后改走真实模型，需要调用方自己承担费用。结果写到 BEEFTV_REAL_BASELINE_OUT（默认临时目录）。
// 付费生成只登记方案，不会提交；模型目录来自下面写入的本地配置。
func TestAssistantEfficiencyBaselineOnRealBackend(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns the real agent host")
	}
	env := newAssistantTestEnv(t, nil)
	owner, err := env.service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	if err := env.service.SaveLocalModelConfig([]byte(`{"textModel":"baseline::deepseek-v4.1-flash","imageModel":"baseline::seedream-5-0-260128","videoModel":"baseline::seedance-2.0-fast","channels":[{"id":"baseline","enabled":true,"apiFormat":"openai","baseUrl":"http://127.0.0.1:9/v1","apiKey":"baseline-never-called","models":["deepseek-v4.1-flash","seedream-5-0-260128","seedance-2.0-fast"],"modelProfiles":[{"model":"deepseek-v4.1-flash","capability":"text","protocol":"chat-completion"},{"model":"seedream-5-0-260128","capability":"image","protocol":"openai-image"},{"model":"seedance-2.0-fast","capability":"video","protocol":"openai-videos"}]}]}`)); err != nil {
		t.Fatal(err)
	}
	env.beginTurn(t, "00000000000000aa", assistantTurnInput(nil, nil))
	if code, body := env.opsRaw("model.catalog", "", "00000000000000aa", `{"capabilities":["image","video"]}`); code != 200 || !strings.Contains(body, `"seedance-2.0-fast"`) || !strings.Contains(body, `"seedream-5-0-260128"`) {
		t.Fatalf("The model directory for measurement is empty or lacks image/video models, and the baseline will be distorted: %d %.300s", code, body)
	}
	canvases := []string{"base-new", "base-edit", "base-multi"}
	for _, id := range canvases {
		doc, _ := json.Marshal(map[string]any{"id": id, "title": id, "revision": 0, "nodes": []any{}, "connections": []any{}})
		if _, err := env.service.UpsertUserCanvasProject(owner.ID, doc); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/__begin", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ CanvasID, TurnID string }
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		revision, err := env.service.BeginAssistantTurn(owner.ID, body.CanvasID, body.TurnID, app.AssistantTurnInput{})
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(err.Error()))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"revision": revision})
	})
	mux.Handle("/", env.router)
	backend := httptest.NewServer(mux)
	defer backend.Close()

	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	out := os.Getenv("BEEFTV_REAL_BASELINE_OUT")
	if out == "" {
		out = t.TempDir()
	}
	provider := map[string]any{"fake": true}
	if url := os.Getenv("BEEFTV_REAL_BASELINE_URL"); url != "" {
		// 密钥不进配置文件：驱动直接读继承的环境变量 BEEFTV_REAL_BASELINE_KEY。
		provider = map[string]any{"baseUrl": url, "model": os.Getenv("BEEFTV_REAL_BASELINE_MODEL"), "api": "openai-completions"}
	}
	scenarios := []map[string]any{
		{"id": "new-short", "canvasId": "base-new", "messages": []string{"Help me make a 15-second vertical screen short film: a girl holding an umbrella walks through the neon lights on the street on a rainy night, divided into 2 shots. Use the cheapest model to come up with a solution."}},
		{"id": "small-edit", "canvasId": "base-edit", "messages": []string{"Create a new text node and write down the key points of tonight’s shooting: rainy night, neon lights, slow motion.", "Change the title of this node to \"Photography Points\"."}},
		{"id": "create-then-edit", "canvasId": "base-multi", "messages": []string{"Make a 3-shot short film storyboard and first frame plan, with the theme: Cat eating in the kitchen.", "Change the description of shot 2 to be more funny, just change this shot."}},
	}
	config, err := json.Marshal(map[string]any{"root": root, "directory": t.TempDir(), "backend": backend.URL + "/api", "beginUrl": backend.URL + "/__begin",
		"hostToken": assistantTestHostToken, "provider": provider, "scenarios": scenarios, "outDir": out, "maxRequests": 120, "turnTimeoutMs": 300000})
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, config, 0600); err != nil {
		t.Fatal(err)
	}
	// 总时限取 go test 自己的截止时间减去收尾余量，到点先请驱动正常退出（它会写出已经拿到的结果并关掉宿主）。
	ctx := context.Background()
	if deadline, ok := t.Deadline(); ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, deadline.Add(-30*time.Second))
		defer cancel()
	}
	command := exec.CommandContext(ctx, "node", filepath.Join(root, "agent-host/eval/real-go-driver.mjs"), configPath)
	command.Cancel = func() error { return command.Process.Signal(os.Interrupt) }
	command.WaitDelay = 20 * time.Second
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("measurement failed: %v\n%s", err, output)
	}
	t.Logf("results in %s\n%s", out, output)

	// 假模型模式下输出是确定的：用它守住请求数、用量、缓存、工具序列和回合状态的解析，不能只看退出码。
	if provider["fake"] == true {
		raw, err := os.ReadFile(filepath.Join(out, "raw.json"))
		if err != nil {
			t.Fatal(err)
		}
		var report struct {
			TotalRequests, AttributedRequests int
			Turns                             []struct {
				Status   string
				Requests []struct {
					Tools                                        []string
					PromptTokens, CachedTokens, CompletionTokens int
					UsageMissing                                 bool
				}
			}
		}
		if err := json.Unmarshal(raw, &report); err != nil {
			t.Fatal(err)
		}
		if len(report.Turns) != 5 || report.TotalRequests != 10 || report.AttributedRequests != 10 {
			t.Fatalf("Wrong number of rounds or requests: %+v", report)
		}
		for _, turn := range report.Turns {
			if turn.Status != "done" || len(turn.Requests) != 2 {
				t.Fatalf("Wrong round status or request number: %+v", turn)
			}
			first, second := turn.Requests[0], turn.Requests[1]
			if len(first.Tools) != 1 || first.Tools[0] != "model_catalog" || first.PromptTokens != 1000 || first.CachedTokens != 0 || first.CompletionTokens != 20 || first.UsageMissing {
				t.Fatalf("The first request parsing is incorrect: %+v", first)
			}
			if len(second.Tools) != 0 || second.CachedTokens != 900 || second.UsageMissing {
				t.Fatalf("The second request parsing is incorrect: %+v", second)
			}
		}
	}
}
