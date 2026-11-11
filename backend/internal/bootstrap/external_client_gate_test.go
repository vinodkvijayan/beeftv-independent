package bootstrap

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/agentops"
)

// desktopHarness 按桌面形态打开运行时，并提供一个「像桌面界面那样」发请求的入口。
type desktopHarness struct {
	rt      *Runtime
	dataDir string
	t       *testing.T
}

func newDesktopHarness(t *testing.T) *desktopHarness {
	t.Helper()
	// The production route requires the packaged CLI before issuing credentials.
	// This fixture is beside Go's disposable test executable, never an installed app.
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	name := "beeftv"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	cliDir := filepath.Join(filepath.Dir(executable), "cli")
	cliPath := filepath.Join(cliDir, name)
	if _, err := os.Stat(cliPath); os.IsNotExist(err) {
		if err := os.MkdirAll(cliDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(cliPath, []byte("test CLI fixture"), 0o755); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Remove(cliPath); _ = os.Remove(cliDir) })
	}
	dir := t.TempDir()
	rt, err := Open(context.Background(), Config{Profile: ProfileDesktop, DataDir: dir, ListenAddr: "127.0.0.1:0", AutoMigrate: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rt.Close(context.Background()) })
	return &desktopHarness{rt: rt, dataDir: dir, t: t}
}

type requestOptions struct {
	method       string
	path         string
	body         string
	origin       string
	launchToken  string
	uiBootstrap  string
	clientID     string
	clientToken  string
	remoteAddr   string
	extraHeaders map[string]string
}

func (h *desktopHarness) call(options requestOptions) *httptest.ResponseRecorder {
	h.t.Helper()
	body := options.body
	if body == "" {
		body = "{}"
	}
	request := httptest.NewRequest(options.method, "http://127.0.0.1:54321/api"+options.path, strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:12345"
	if options.remoteAddr != "" {
		request.RemoteAddr = options.remoteAddr
	}
	request.Header.Set("Content-Type", "application/json")
	if options.origin != "" {
		request.Header.Set("Origin", options.origin)
	}
	if options.launchToken != "" {
		request.Header.Set("X-Desktop-Token", options.launchToken)
	}
	if options.uiBootstrap != "" {
		request.Header.Set("X-Beeftv-UI-Bootstrap", options.uiBootstrap)
	}
	if options.clientID != "" {
		request.Header.Set("X-Beeftv-Client", options.clientID)
		request.Header.Set("Authorization", "Bearer "+options.clientToken)
	}
	for name, value := range options.extraHeaders {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	h.rt.Handler().ServeHTTP(recorder, request)
	return recorder
}

// desktopUI 模拟受信任的桌面界面：启动令牌 + UI 引导密钥 + Wails 原生 Origin。
func (h *desktopHarness) desktopUI(method, path, body string) *httptest.ResponseRecorder {
	return h.call(requestOptions{method: method, path: path, body: body,
		origin: "wails://wails", launchToken: h.rt.LaunchToken(), uiBootstrap: h.rt.UIBootstrapToken()})
}

func decodeEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) (map[string]any, string) {
	t.Helper()
	var envelope struct {
		Data   map[string]any `json:"data"`
		Reason string         `json:"reason"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("Response is not valid JSON: %s", recorder.Body.String())
	}
	return envelope.Data, envelope.Reason
}

// 契约 B5：已登记客户端凭据可以免桌面启动令牌进入操作层，但只能进操作层。
func TestOpsGateAcceptsRegisteredClientWithoutLaunchToken(t *testing.T) {
	harness := newDesktopHarness(t)
	registration, token, err := agentops.NewClientRegistry(harness.dataDir).RegisterKind("codex", "codex", agentops.ClientReadOnly)
	if err != nil {
		t.Fatal(err)
	}

	listing := harness.call(requestOptions{method: "GET", path: "/ops", clientID: registration.ID, clientToken: token})
	if listing.Code != http.StatusOK {
		t.Fatalf("Registered clients should be able to list the operations and get %d %s", listing.Code, listing.Body.String())
	}

	// 操作入口也放行：这里画布不存在，所以失败原因必须是业务错误，不是被守卫拦下。
	operation := harness.call(requestOptions{method: "POST", path: "/ops/canvas.get",
		body: `{"params":{"canvasId":"missing"}}`, clientID: registration.ID, clientToken: token})
	if _, reason := decodeEnvelope(t, operation); reason == "desktop_token_required" {
		t.Fatalf("The registered client was blocked by the activation token guard at the operation entrance: %d %s", operation.Code, operation.Body.String())
	}

	// 生成单查询入口对已登记客户端放行，但批准入口必须拒绝客户端凭据自批。
	orders := harness.call(requestOptions{method: "GET", path: "/ops/orders", clientID: registration.ID, clientToken: token})
	if orders.Code != http.StatusOK {
		t.Fatalf("The registered client should be able to query the generated order and get %d %s", orders.Code, orders.Body.String())
	}
	selfApprove := harness.call(requestOptions{method: "POST", path: "/ops/orders/gp-test/approve", clientID: registration.ID, clientToken: token})
	if _, reason := decodeEnvelope(t, selfApprove); selfApprove.Code != http.StatusForbidden || reason != "agent_token_cannot_approve" {
		t.Fatalf("The client credential approval generated ticket should be rejected by agent_token_cannot_approve and get %d %s", selfApprove.Code, selfApprove.Body.String())
	}
	ownerTok, err := agentops.EnsureOwnerToken(harness.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	ownerApprove := harness.call(requestOptions{method: "POST", path: "/ops/orders/gp-missing/approve", extraHeaders: map[string]string{"X-Beeftv-Owner": ownerTok}})
	if _, reason := decodeEnvelope(t, ownerApprove); ownerApprove.Code != http.StatusNotFound || reason != "generation_order_not_found" {
		t.Fatalf("The native Owner credentials should be passed through the startup token guard into the generated single approval route, resulting in %d %s", ownerApprove.Code, ownerApprove.Body.String())
	}
}

// 伪造或不存在的凭据不能换来豁免：守卫回落到启动令牌，结果是 403。
func TestOpsGateRejectsBogusClientCredentials(t *testing.T) {
	harness := newDesktopHarness(t)
	registration, token, err := agentops.NewClientRegistry(harness.dataDir).Register("codex", agentops.ClientReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name        string
		clientID    string
		clientToken string
	}{
		{"Unregistered ID", "client-does-not-exist", token},
		{"The registered ID is matched with the wrong token", registration.ID, "0000000000000000"},
		{"Empty token", registration.ID, ""},
	}
	for _, item := range cases {
		recorder := harness.call(requestOptions{method: "GET", path: "/ops", clientID: item.clientID, clientToken: item.clientToken})
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("%s should be rejected and get %d %s", item.name, recorder.Code, recorder.Body.String())
		}
	}
}

// 凭据发行与助手运行面继续要求桌面身份，完整业务客户端不能进入。
func TestClientCredentialsOnOtherRoutesStillNeedLaunchToken(t *testing.T) {
	harness := newDesktopHarness(t)
	registration, token, err := agentops.NewClientRegistry(harness.dataDir).Register("codex", agentops.ClientReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ method, path string }{
		{"GET", "/agent-clients"},
		{"POST", "/agent-clients"},
		{"DELETE", "/agent-clients/" + registration.ID},
		{"POST", "/ops/clients"},
		{"GET", "/ops/clients"},
		{"POST", "/assistant/ui-session"},
		{"POST", "/assistant/chat"},
	} {
		recorder := harness.call(requestOptions{method: item.method, path: item.path, clientID: registration.ID, clientToken: token})
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("%s %s should not be open to client credentials, got %d", item.method, item.path, recorder.Code)
		}
		if _, reason := decodeEnvelope(t, recorder); reason != "desktop_token_required" {
			t.Fatalf("The failure reason for %s %s should be desktop_token_required, get %q", item.method, item.path, reason)
		}
	}
}

// 非本机来源即使带着有效客户端凭据也不豁免。
func TestOpsGateExemptionIsLoopbackOnly(t *testing.T) {
	harness := newDesktopHarness(t)
	registration, token, err := agentops.NewClientRegistry(harness.dataDir).Register("codex", agentops.ClientReadOnly)
	if err != nil {
		t.Fatal(err)
	}
	recorder := harness.call(requestOptions{method: "GET", path: "/ops",
		clientID: registration.ID, clientToken: token, remoteAddr: "203.0.113.7:44321"})
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("External sources should be rejected, getting %d %s", recorder.Code, recorder.Body.String())
	}
}

// 契约 B1/B2/B3 的完整一轮：桌面界面签发凭据 → 外部客户端可用 → 吊销后立即失效。
func TestAgentClientIssueUseAndRevoke(t *testing.T) {
	harness := newDesktopHarness(t)

	created := harness.desktopUI("POST", "/agent-clients", `{"kind":"codex","mode":"read-only","label":"我的 Codex"}`)
	if created.Code != http.StatusOK {
		t.Fatalf("The desktop interface should be able to issue credentials and get %d %s", created.Code, created.Body.String())
	}
	data, _ := decodeEnvelope(t, created)
	token, _ := data["token"].(string)
	if token == "" {
		t.Fatal("The signed response must carry a one-time token")
	}
	client, _ := data["client"].(map[string]any)
	clientID, _ := client["id"].(string)
	if clientID == "" {
		t.Fatalf("Signing response is missing client ID: %s", created.Body.String())
	}
	if client["kind"] != "codex" || client["mode"] != "read-only" {
		t.Fatalf("The kind/mode of the issuing response is wrong: %v", client)
	}
	if client["lastUsedAt"] != nil {
		t.Fatalf("Newly issued credentials should not have a usage time: %v", client["lastUsedAt"])
	}
	setup, _ := data["setup"].(map[string]any)
	command, _ := setup["command"].(string)
	if !strings.Contains(command, "codex mcp add") || !strings.Contains(command, "mcp serve") {
		t.Fatalf("codex access command is not available: %q", command)
	}
	if !strings.Contains(command, clientID) || !strings.Contains(command, token) {
		t.Fatal("The access command must bring the client's own credentials.")
	}
	if strings.Contains(command, harness.rt.LaunchToken()) {
		t.Fatal("The access command must not contain the desktop launch token")
	}
	if !strings.Contains(command, "--read-only") {
		t.Fatalf("The read-only client access command should carry --read-only: %q", command)
	}

	// 签发出来的凭据立刻能进操作层，不需要桌面启动令牌。
	used := harness.call(requestOptions{method: "GET", path: "/ops", clientID: clientID, clientToken: token})
	if used.Code != http.StatusOK {
		t.Fatalf("The newly issued credentials should be usable immediately, getting %d %s", used.Code, used.Body.String())
	}

	// 用过之后列表里要能看到最近使用时间，并且永远不返回 token 或哈希。
	listing := harness.desktopUI("GET", "/agent-clients", "")
	if listing.Code != http.StatusOK {
		t.Fatalf("The desktop interface should be able to list the clients and get %d %s", listing.Code, listing.Body.String())
	}
	if strings.Contains(listing.Body.String(), token) || strings.Contains(listing.Body.String(), "tokenHash") {
		t.Fatal("List leaked credentials")
	}
	listed, _ := decodeEnvelope(t, listing)
	clients, _ := listed["clients"].([]any)
	if len(clients) != 1 {
		t.Fatalf("Should have 1 client, got %d", len(clients))
	}
	first, _ := clients[0].(map[string]any)
	if first["lastUsedAt"] == nil {
		t.Fatal("Used credentials should record the last time they were used")
	}
	cli, _ := listed["cli"].(map[string]any)
	if _, ok := cli["path"].(string); !ok {
		t.Fatalf("The list must give the CLI path: %v", cli)
	}
	if _, ok := cli["available"].(bool); !ok {
		t.Fatalf("The list must indicate whether the CLI is available with the package: %v", cli)
	}
	if install, _ := cli["installCommand"].(string); install == "" {
		t.Fatal("The list must give the command to connect the CLI to PATH")
	}

	// 吊销：立刻失效，并从列表里消失。
	revoked := harness.desktopUI("DELETE", "/agent-clients/"+clientID, "")
	if revoked.Code != http.StatusOK {
		t.Fatalf("The desktop interface should be able to revoke credentials and get %d %s", revoked.Code, revoked.Body.String())
	}
	afterRevoke := harness.call(requestOptions{method: "GET", path: "/ops", clientID: clientID, clientToken: token})
	if afterRevoke.Code != http.StatusForbidden {
		t.Fatalf("Revoked credentials must be invalidated immediately, resulting in %d %s", afterRevoke.Code, afterRevoke.Body.String())
	}
	if _, reason := decodeEnvelope(t, afterRevoke); reason != "desktop_token_required" {
		t.Fatalf("Revoked credentials should fall back to starting the token guard, getting %q", reason)
	}
	emptyListing, _ := decodeEnvelope(t, harness.desktopUI("GET", "/agent-clients", ""))
	if remaining, _ := emptyListing["clients"].([]any); len(remaining) != 0 {
		t.Fatalf("Revoked clients should no longer appear in the list: %v", remaining)
	}
	// 重复吊销按未找到处理，不把存在性变成探测手段。
	if again := harness.desktopUI("DELETE", "/agent-clients/"+clientID, ""); again.Code != http.StatusNotFound {
		t.Fatalf("Repeated revocation should return not found, getting %d %s", again.Code, again.Body.String())
	}
}

// 读写模式的接入命令不带 --read-only，cursor/other 给的是 JSON 配置。
func TestAgentClientMissingCLIRejectsBeforeIssuingCredentials(t *testing.T) {
	harness := newDesktopHarness(t)
	listing := harness.desktopUI("GET", "/agent-clients", "")
	data, _ := decodeEnvelope(t, listing)
	cli := data["cli"].(map[string]any)
	cliPath := cli["path"].(string)
	if err := os.Remove(cliPath); err != nil {
		t.Fatal(err)
	}
	response := harness.desktopUI("POST", "/agent-clients", `{"kind":"claude-desktop","mode":"read-only"}`)
	if _, reason := decodeEnvelope(t, response); response.Code != http.StatusPreconditionFailed || reason != "cli_unavailable" {
		t.Fatalf("missing CLI must fail closed: %d %s", response.Code, response.Body.String())
	}
	listing = harness.desktopUI("GET", "/agent-clients", "")
	data, _ = decodeEnvelope(t, listing)
	cli = data["cli"].(map[string]any)
	if cli["available"] != false || cli["installCommand"] != "" || len(data["clients"].([]any)) != 0 {
		t.Fatalf("missing CLI must not issue credentials or a PATH fallback: %s", listing.Body.String())
	}
}

func TestAgentClientSetupShapes(t *testing.T) {
	harness := newDesktopHarness(t)
	for _, item := range []struct {
		kind      string
		mode      string
		wantKey   string
		wantInner string
	}{
		{"claude", "read-write", "command", "claude mcp add"},
		{"claude-desktop", "read-only", "json", "mcpServers"},
		{"cursor", "read-write", "json", "mcpServers"},
		{"other", "read-only", "json", "mcpServers"},
	} {
		recorder := harness.desktopUI("POST", "/agent-clients", `{"kind":"`+item.kind+`","mode":"`+item.mode+`"}`)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s issuance failed: %d %s", item.kind, recorder.Code, recorder.Body.String())
		}
		data, _ := decodeEnvelope(t, recorder)
		setup, _ := data["setup"].(map[string]any)
		value, _ := setup[item.wantKey].(string)
		if !strings.Contains(value, item.wantInner) {
			t.Fatalf("setup.%s for %s is not available: %q", item.kind, item.wantKey, value)
		}
		if item.wantKey == "json" {
			var config struct {
				Servers map[string]struct {
					Command string            `json:"command"`
					Env     map[string]string `json:"env"`
				} `json:"mcpServers"`
			}
			if err := json.Unmarshal([]byte(value), &config); err != nil {
				t.Fatal(err)
			}
			entry := config.Servers["beeftv"]
			if !filepath.IsAbs(entry.Command) || filepath.Base(filepath.Dir(entry.Command)) != "cli" {
				t.Fatalf("unsafe CLI command: %q", entry.Command)
			}
			if entry.Env["BEEFTV_DATA_DIR"] != harness.dataDir {
				t.Fatalf("wrong workspace directory: %q", entry.Env["BEEFTV_DATA_DIR"])
			}
		}
		if title, _ := setup["title"].(string); title == "" {
			t.Fatalf("The setup for %s is missing a header", item.kind)
		}
		if item.mode == "read-write" && strings.Contains(value, "--read-only") {
			t.Fatalf("The configuration of the read and write client should not include --read-only: %q", value)
		}
		if item.mode == "read-only" && !strings.Contains(value, "--read-only") {
			t.Fatalf("Read-only clients should be configured with --read-only:%q", value)
		}
	}
}

// 凭据管理需要桌面界面的信任链：单有启动令牌（没有 UI 引导密钥）不够。
func TestAgentClientRoutesNeedDesktopUITrust(t *testing.T) {
	harness := newDesktopHarness(t)
	recorder := harness.call(requestOptions{method: "GET", path: "/agent-clients",
		origin: "wails://wails", launchToken: harness.rt.LaunchToken()})
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("Only startup token should not be able to manage credentials, get %d %s", recorder.Code, recorder.Body.String())
	}
	if unknown := harness.call(requestOptions{method: "GET", path: "/agent-clients",
		origin: "wails://attacker", launchToken: harness.rt.LaunchToken(), uiBootstrap: harness.rt.UIBootstrapToken()}); unknown.Code != http.StatusForbidden {
		t.Fatalf("Unknown Origin should not be able to manage credentials, got %d", unknown.Code)
	}
}

// 无效 mode 必须在登记前就被拒绝，不能落下一条能力不明的记录。
func TestAgentClientRejectsUnknownMode(t *testing.T) {
	harness := newDesktopHarness(t)
	recorder := harness.desktopUI("POST", "/agent-clients", `{"kind":"codex","mode":"admin"}`)
	if recorder.Code == http.StatusOK {
		t.Fatalf("Illegal mode accepted: %s", recorder.Body.String())
	}
	if _, reason := decodeEnvelope(t, recorder); reason != "invalid_mode" {
		t.Fatalf("The reason for illegal mode should be invalid_mode and get %q", reason)
	}
	listing, _ := decodeEnvelope(t, harness.desktopUI("GET", "/agent-clients", ""))
	if clients, _ := listing["clients"].([]any); len(clients) != 0 {
		t.Fatalf("Failed issuance should not leave a record: %v", clients)
	}
}
