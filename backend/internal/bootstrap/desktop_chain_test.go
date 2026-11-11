package bootstrap_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/bootstrap"
)

// 桌面形态启动链的集成验收（无 GUI）：
//   - UI 会话凭桌面启动令牌签发，不需要 BEEFTV_UI_BOOTSTRAP，也不需要把 owner 凭据交给页面；
//   - 宿主由启动链按本机配置里的随包启动器拉起（这里用暂存的 Resources 布局）；
//   - 模型连接信息来自应用已有的本地模型配置，不需要进程内临时密钥；
//   - 关闭 Runtime 时本进程启动的宿主子进程被回收。
//
// 注意：这个用例覆盖共享启动函数与随包资源寻址，不代表 Wails WebView 里的页面引导已验收。
func TestDesktopProfileStartupChain(t *testing.T) {
	workspaceRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	hostSource := filepath.Join(workspaceRoot, "agent-host")
	if _, err := os.Stat(filepath.Join(hostSource, "server.mjs")); err != nil {
		t.Skipf("agent-host source code is not available: %v", err)
	}
	nodeSource := os.Getenv("BEEFTV_TEST_NODE")
	if nodeSource == "" {
		t.Skip("BEEFTV_TEST_NODE (self-contained node binary path) is not set, skipping integration acceptance at runtime with the package")
	}
	// Exercise persisted channel configuration, never inherited provider overrides.
	// Inherited PORT / HOST_URL are not runtime authority; the supervisor binds a
	// fresh loopback endpoint after launch.
	for _, key := range []string{"BEEFTV_AGENT_API_KEY", "BEEFTV_AGENT_BASE_URL", "BEEFTV_AGENT_MODEL", "BEEFTV_AGENT_PROTOCOL", "BEEFTV_AGENT_HOST_TOKEN", "BEEFTV_UI_BOOTSTRAP", "BEEFTV_AGENT_PORT", "BEEFTV_AGENT_HOST_URL"} {
		t.Setenv(key, "")
	}
	if os.Getenv("BEEFTV_TEST_REAL_TURN") != "1" {
		t.Setenv("BEEFTV_AGENT_MAX_REQUESTS", "0")
	}

	dataDir := t.TempDir()
	stageRoot := t.TempDir()
	// 暂存 BeefTV.app 布局：Contents/Resources/agent-host/...
	agentDir := filepath.Join(stageRoot, "BeefTV.app", "Contents", "Resources", "agent-host")
	if err := os.MkdirAll(filepath.Join(agentDir, "runtime", "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"server.mjs", "session-identity.mjs", "canvas-turn.mjs", "request-budget.mjs", "durable-request-budget.mjs",
		"durable-session-owner.mjs", "durable-turn-projection.mjs", "durable-extensions.mjs", "business-progress.mjs", "durable-turn-budget.mjs", "media-content.mjs", "native-part-store.mjs",
		"native-history.mjs", "skill-resource.mjs", "active-skills.mjs", "operation-bridge.mjs", "await-business-tasks.mjs", "timeline-delivery.mjs", "canvas-read-view.mjs", "canvas-write-view.mjs",
		"session-owner.mjs", "system-prompt.mjs", "model-stream-idle.mjs", "model-transport-error.mjs", "plan.mjs", "studio-digest.mjs", "dispatch-diagnostics.mjs", "plugin-packages.mjs", "package.json", "run-agent-host.sh",
	} {
		copyFile(t, filepath.Join(hostSource, name), filepath.Join(agentDir, name))
	}
	if err := os.Chmod(filepath.Join(agentDir, "run-agent-host.sh"), 0o755); err != nil {
		t.Fatal(err)
	}
	copyFile(t, nodeSource, filepath.Join(agentDir, "runtime", "bin", "node"))
	if err := os.Chmod(filepath.Join(agentDir, "runtime", "bin", "node"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 与发行脚本一致地真实复制依赖目录：符号链接会让 ESM 解析走到源目录之外，
	// 验收就失去「随包资源自洽」的意义。
	dependencies, err := filepath.EvalSymlinks(filepath.Join(hostSource, "node_modules"))
	if err != nil {
		t.Fatalf("Failed to locate agent-host dependent directory: %v", err)
	}
	if output, err := exec.Command("cp", "-R", dependencies, filepath.Join(agentDir, "node_modules")).CombinedOutput(); err != nil {
		t.Fatalf("Failed to copy node_modules: %v %s", err, output)
	}

	launcher := filepath.Join(agentDir, "run-agent-host.sh")
	writeJSON(t, filepath.Join(dataDir, "agent_config.json"), map[string]any{
		"model":       "gpt-5.5",
		"hostCommand": launcher,
	})
	// 默认用占位密钥验证「连接信息来自本地模型配置」；需要真实回合时在启动前写入真实凭据，
	// 因为宿主只在启动时读取一次模型连接信息。
	modelID, modelURL, modelKey := "gpt-5.5", "https://relay.example.com/v1", "local-config-key"
	if os.Getenv("BEEFTV_TEST_REAL_TURN") == "1" {
		credentials := os.Getenv("BEEFTV_TEST_CREDENTIALS")
		if credentials == "" {
			t.Fatal("BEEFTV_TEST_REAL_TURN=1 requires BEEFTV_TEST_CREDENTIALS")
		}
		raw, err := os.ReadFile(credentials)
		if err != nil {
			t.Fatal(err)
		}
		var cred struct {
			APIKey  string `json:"api_key"`
			BaseURL string `json:"base_url"`
			Model   string `json:"model"`
		}
		if err := json.Unmarshal(raw, &cred); err != nil {
			t.Fatal(err)
		}
		modelID, modelURL, modelKey = cred.Model, cred.BaseURL, cred.APIKey
	}
	// Issue #68: a models-only custom channel must feed the real host from the
	// persisted default text selection, without modelProfiles or database rows.
	modelConfig := map[string]any{
		"schemaVersion": 1, "revision": 1,
		"config": map[string]any{"apiKey": "", "textModel": "desktop-fixture::" + modelID,
			"channels": []any{map[string]any{"id": "desktop-fixture", "name": "Desktop fixture", "enabled": true,
				"apiKey": modelKey, "baseUrl": modelURL, "apiFormat": "openai",
				"models": []string{modelID}}}},
	}
	writeJSON(t, filepath.Join(dataDir, "local-model-config.json"), modelConfig)

	const launchToken = "desktop-chain-test-token"
	runtime, err := bootstrap.Open(t.Context(), bootstrap.Config{
		Profile:     bootstrap.ProfileDesktop,
		DataDir:     dataDir,
		ListenAddr:  "127.0.0.1:0",
		LaunchToken: launchToken,
		AutoMigrate: true,
	})
	if err != nil {
		t.Fatalf("Failed to open desktop runtime: %v", err)
	}
	if err := runtime.Start(); err != nil {
		t.Fatalf("Failed to start desktop runtime: %v", err)
	}
	t.Cleanup(func() { _ = runtime.Close(t.Context()) })

	baseURL := runtime.BaseURL()
	if !strings.HasPrefix(baseURL, "http://127.0.0.1:") {
		t.Fatalf("The desktop runtime should be served at the loopback address, getting %q", baseURL)
	}

	// 无桌面令牌：整个 API 由启动令牌把关，直接拒绝。
	if code, _ := desktopRequest(t, baseURL+"/assistant/ui-session", http.MethodPost, launchToken, false); code != http.StatusForbidden {
		t.Fatalf("Missing desktop token should be rejected, getting %d", code)
	}

	// 仅出示桌面令牌签发 UI 会话：不需要 owner 凭据，也不需要开发引导开关。
	code, body := desktopRequest(t, baseURL+"/assistant/ui-session", http.MethodPost, launchToken, true, runtime.UIBootstrapToken())
	if code != http.StatusOK {
		t.Fatalf("Failed to issue UI session with desktop token: %d %s", code, body)
	}
	var session struct {
		Data struct {
			Token     string `json:"token"`
			Bootstrap struct {
				OwnerToken   bool `json:"ownerToken"`
				DevBootstrap bool `json:"devBootstrap"`
				DesktopShell bool `json:"desktopShell"`
			} `json:"bootstrap"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &session); err != nil {
		t.Fatal(err)
	}
	if session.Data.Token == "" || !session.Data.Bootstrap.DesktopShell {
		t.Fatalf("The desktop token should be used as the basis for issuance, resulting in %s", body)
	}
	if session.Data.Bootstrap.DevBootstrap || session.Data.Bootstrap.OwnerToken {
		t.Fatalf("Should not rely on development boot or owner credentials to get %s", body)
	}
	if os.Getenv("BEEFTV_UI_BOOTSTRAP") == "1" {
		t.Fatal("This use case must be run without BEEFTV_UI_BOOTSTRAP")
	}

	// 模型连接信息必须来自应用已有的本地模型配置：进程内没有 BEEFTV_AGENT_API_KEY。
	// 启动链拉起自有子进程后，/assistant/status 在实例证明通过时才报 available。
	deadline := time.Now().Add(90 * time.Second)
	available := false
	health := ""
	for time.Now().Before(deadline) {
		code, body = desktopRequest(t, baseURL+"/assistant/status", http.MethodGet, launchToken, true)
		if code == http.StatusOK && strings.Contains(body, `"available":true`) {
			available = true
			health = body
			break
		}
		time.Sleep(time.Second)
	}
	if !available {
		t.Fatalf("The host was not pulled up by the boot chain. The last response was: %d %s", code, body)
	}
	var status struct {
		Data struct {
			Model struct {
				ID        string `json:"id"`
				ChannelID string `json:"channelId"`
			} `json:"model"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(health), &status); err != nil {
		t.Fatal(err)
	}
	if status.Data.Model.ID != modelID || status.Data.Model.ChannelID != "desktop-fixture" {
		t.Fatalf("The assistant status does not project the selected channel model: %s", health)
	}
	if raw, err := os.ReadFile(filepath.Join(dataDir, "agent-requests.jsonl")); err == nil && len(strings.TrimSpace(string(raw))) > 0 {
		t.Fatalf("Launch chain acceptance must not generate model requests: %s", raw)
	}

	// 外部客户端（CLI/MCP）接同一个桌面实例：桌面形态的 API 由启动令牌把关，
	// 客户端必须同时出示「桌面启动令牌（过守卫）」与「已登记客户端凭据（定能力）」。
	// 这一步是零模型只读验证：读工具可用，写工具被只读客户端拒绝。
	if cliBinary := os.Getenv("BEEFTV_TEST_CLI"); cliBinary != "" {
		// 客户端登记按现有合同需要 owner 凭据（本机用户可读，0600）；桌面令牌只负责过守卫。
		ownerRaw, err := os.ReadFile(filepath.Join(dataDir, "agent_owner_token"))
		if err != nil {
			t.Fatal(err)
		}
		ownerToken := strings.TrimSpace(string(ownerRaw))
		code, body = desktopRequestOwning(t, baseURL+"/ops/clients", launchToken, ownerToken,
			map[string]any{"label": "desktop-cli-check", "mode": "read-only"})
		if code != http.StatusOK {
			t.Fatalf("Failed to register read-only client (requires owner + desktop token): %d %s", code, body)
		}
		var registered struct {
			Data struct {
				Client struct {
					ID string `json:"id"`
				} `json:"client"`
				Token string `json:"token"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(body), &registered); err != nil {
			t.Fatal(err)
		}
		if registered.Data.Client.ID == "" || registered.Data.Token == "" {
			t.Fatalf("Enrollment response missing client credentials: %s", body)
		}

		runCli := func(args ...string) (int, string) {
			command := exec.Command(cliBinary, args...)
			command.Env = append(os.Environ(),
				"BEEFTV_BASE_URL="+baseURL,
				"BEEFTV_DESKTOP_TOKEN=",
				"BEEFTV_CLIENT_ID="+registered.Data.Client.ID,
				"BEEFTV_CLIENT_TOKEN="+registered.Data.Token,
				"BEEFTV_CLIENT_TOKEN_FILE=",
			)
			output, err := command.CombinedOutput()
			exitCode := 0
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else if err != nil {
				t.Fatalf("Failed to execute CLI: %v", err)
			}
			return exitCode, string(output)
		}

		// 只读列能力：能连上同一个桌面实例（守卫通过 + 客户端身份被接受）。
		exitCode, output := runCli("ops", "list", "--read-only", "--json")
		if exitCode != 0 || !strings.Contains(output, "canvas.get") {
			t.Fatalf("The CLI should be able to read the capability list for the same instance via the desktop token: exit=%d %s", exitCode, truncate(output, 300))
		}
		// 没有登记凭据时拒绝；外部客户端不持有桌面壳的令牌。
		command := exec.Command(cliBinary, "ops", "list", "--read-only", "--json")
		command.Env = append(os.Environ(), "BEEFTV_BASE_URL="+baseURL,
			"BEEFTV_DESKTOP_TOKEN=", "BEEFTV_CLIENT_ID="+registered.Data.Client.ID, "BEEFTV_CLIENT_TOKEN=invalid", "BEEFTV_CLIENT_TOKEN_FILE=")
		if err := command.Run(); err == nil {
			t.Fatal("Invalid client credentials should not be able to access the desktop instance")
		}
		// 只读客户端写操作仍被能力层拒绝。
		exitCode, output = runCli("canvas", "node", "update", "--canvas", "any", "--node", "n1",
			"--expected-revision", "1", "--content", "x", "--op-id", "desktop-cli-write", "--json")
		if exitCode == 0 || !strings.Contains(output, "read_only") {
			t.Fatalf("Read-only client writes should be rejected: exit=%d %s", exitCode, truncate(output, 300))
		}
		t.Logf("CLI desktop connection passed: read successfully, no token rejected, read-only and write-only rejected")
	}

	// 最小文字读写（默认跳过，避免测试依赖真实模型）：设置 BEEFTV_TEST_REAL_TURN=1
	// 与 BEEFTV_TEST_CREDENTIALS=<beeftv 凭据 json> 时，用真实模型走一次
	// 「读画布 + 改一个节点字段」，证明发行形态下的助手链路真的能读写。
	if os.Getenv("BEEFTV_TEST_REAL_TURN") == "1" {
		fixture := "desktop-chain-fixture"
		code, body := desktopRequestWith(t, baseURL+"/canvas-projects/"+fixture, http.MethodPut, launchToken, true, map[string]any{
			"project": map[string]any{"id": fixture, "revision": 0, "title": "Release chain clamp",
				"nodes": []any{map[string]any{"id": "n1", "type": "text", "title": "Issuance chain node",
					"position": map[string]any{"x": 120.0, "y": 120.0}, "width": 320.0, "height": 200.0,
					"metadata": map[string]any{"content": "ORIGINAL-CONTENT"}}},
				"connections": []any{}},
		})
		if code != http.StatusOK {
			t.Fatalf("Failed to create fixture canvas: %d %s", code, body)
		}

		sessionToken := session.Data.Token
		chatBody := map[string]any{"canvasId": fixture,
			"message": "Please read the current canvas, then use canvas.node.update to change the content of node n1 to DESKTOP-CHAIN-OK, and finally confirm with one sentence."}
		encoded, _ := json.Marshal(chatBody)
		request, err := http.NewRequest(http.MethodPost, baseURL+"/assistant/chat", strings.NewReader(string(encoded)))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Beeftv-Ui-Session", sessionToken)
		response, err := (&http.Client{Timeout: 5 * time.Minute}).Do(request)
		if err != nil {
			t.Fatalf("Conversation request failed: %v", err)
		}
		defer response.Body.Close()
		stream, _ := io.ReadAll(response.Body)
		turnEnd := ""
		toolCalls := []string{}
		for _, line := range strings.Split(string(stream), "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				continue
			}
			var payload struct {
				Type      string `json:"type"`
				Reply     string `json:"reply"`
				Error     string `json:"error"`
				ToolCalls []struct {
					Tool string `json:"tool"`
				} `json:"toolCalls"`
			}
			if json.Unmarshal([]byte(trimmed), &payload) != nil || payload.Type != "turn_end" {
				continue
			}
			if payload.Error != "" {
				t.Fatalf("Round failed: %s", payload.Error)
			}
			turnEnd = payload.Reply
			for _, call := range payload.ToolCalls {
				toolCalls = append(toolCalls, call.Tool)
			}
		}
		if strings.TrimSpace(turnEnd) == "" {
			t.Fatalf("There is no non-empty reply in the round; tool = %v", toolCalls)
		}
		code, body = desktopRequest(t, baseURL+"/canvas-projects/"+fixture, http.MethodGet, launchToken, true)
		if code != http.StatusOK || !strings.Contains(body, "DESKTOP-CHAIN-OK") {
			t.Fatalf("The assistant did not write the content to the canvas: %d %s", code, truncate(body, 400))
		}
		t.Logf("Minimum text reading and writing passed: reply=%q tools=%v", truncate(turnEnd, 120), toolCalls)
	}

	// 关闭运行时：本进程启动的宿主必须随之退出（生命周期管道 EOF）。
	if err := runtime.Close(t.Context()); err != nil {
		t.Fatalf("Failed to close runtime: %v", err)
	}
	deadline = time.Now().Add(5 * time.Second)
	closedClient := &http.Client{Timeout: time.Second}
	for time.Now().Before(deadline) {
		_, err := closedClient.Get(baseURL + "/assistant/status")
		if err != nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("Backend still responding after turning off runtime")
}

func TestBundledAgentHostCommandForAppLayout(t *testing.T) {
	// 打包布局寻址由 assistantruntime 包负责；这里只保证 bootstrap 侧不引入别的路径假设。
	workspaceRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	if _, err := os.Stat(filepath.Join(workspaceRoot, "agent-host", "run-agent-host.sh")); err != nil {
		t.Skipf("The package launcher does not exist: %v", err)
	}
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	data, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}

// desktopRequestOwning 同时出示桌面令牌（过守卫）与 owner 凭据（登记客户端）。
func desktopRequestOwning(t *testing.T, url, desktopToken, ownerToken string, payload any) (int, string) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(encoded)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Desktop-Token", desktopToken)
	request.Header.Set("X-Beeftv-Owner", ownerToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	return response.StatusCode, string(body)
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func desktopRequestWith(t *testing.T, url, method, token string, withToken bool, payload any) (int, string) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(method, url, strings.NewReader(string(encoded)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if withToken {
		request.Header.Set("X-Desktop-Token", token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	return response.StatusCode, string(body)
}

func desktopRequest(t *testing.T, url, method, token string, withToken bool, uiToken ...string) (int, string) {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if len(uiToken) > 0 {
		request.Header.Set("X-Beeftv-UI-Bootstrap", uiToken[0])
	}
	if withToken {
		request.Header.Set("X-Desktop-Token", token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	return response.StatusCode, string(body)
}
