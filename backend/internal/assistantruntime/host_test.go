package assistantruntime

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"infinite-canvas/backend/internal/assistant"
)

func testProvider() assistant.Provider {
	return assistant.Provider{Model: "gpt-5.5", BaseURL: "https://beeftv.app/v1", APIKey: "test-key", Protocol: "chat-completion"}
}

func testPin(opsURL, desktop string) childPin {
	return childPin{OpsURL: opsURL, DesktopTok: desktop}
}

// 宿主把 BEEFTV_OPS_URL 当基址再拼 /ops，因此这里必须带 /api 前缀；
// 少了它宿主启动即因 404 退出，界面只会显示「创作助手暂时不可用」。
func TestHostEnvOpsURLKeepsAPIPrefix(t *testing.T) {
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "agent_host_token"), []byte("host-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "agent_owner_token"), []byte("owner-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_BACKEND_ADDR", "127.0.0.1:18090")
	t.Setenv("CANVAS_BACKEND_PORT", "")

	env := New(Options{DataDir: dataDir}).buildEnv(testProvider(), testPin("http://127.0.0.1:18090/api", "desktop-shell-token"))
	if got := envValue(env, "BEEFTV_OPS_URL"); got != "http://127.0.0.1:18090/api" {
		t.Fatalf("BEEFTV_OPS_URL should use explicit address, get %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_HOST_TOKEN"); got != "host-token" {
		t.Fatalf("BEEFTV_AGENT_HOST_TOKEN = %q", got)
	}
	if got := envValue(env, "BEEFTV_OWNER_TOKEN"); got != "" {
		t.Fatalf("BEEFTV_OWNER_TOKEN must not be injected into the child process, resulting in %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_DATA_DIR"); got != dataDir {
		t.Fatalf("BEEFTV_AGENT_DATA_DIR = %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_API_KEY"); got != "test-key" {
		t.Fatalf("BEEFTV_AGENT_API_KEY should be injected by the caller, getting %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_DESKTOP_TOKEN"); got != "desktop-shell-token" {
		t.Fatalf("Desktop mode should hand over the startup token to the host and get %q", got)
	}
}

// 显式注入的环境变量优先于渠道解析（开发与受控测试路径）；此时不需要应用服务。
func TestResolveAssistantProviderPrefersExplicitEnv(t *testing.T) {
	t.Setenv("BEEFTV_AGENT_API_KEY", "env-key")
	t.Setenv("BEEFTV_AGENT_BASE_URL", "https://env.example/v1")
	t.Setenv("BEEFTV_AGENT_MODEL", "env-model")
	t.Setenv("BEEFTV_AGENT_PROTOCOL", "claude-api")

	provider, reason := ResolveProvider(nil)
	if reason != "" {
		t.Fatalf("The unavailability reason should not be given when explicitly injecting, and %q is obtained.", reason)
	}
	if provider.APIKey != "env-key" || provider.BaseURL != "https://env.example/v1" || provider.Model != "env-model" || provider.Protocol != "claude-api" {
		t.Fatalf("Explicit injection should take precedence, getting %#v", provider)
	}
}

// 协议决定宿主使用哪个 pi-ai 适配器，也决定接口地址要不要带 /v1：
// OpenAI 兼容 SDK 在 baseURL 后直接拼路径，Anthropic SDK 自己拼 /v1/messages。
// 渠道已写明的版本前缀（/api/v3、/v4 等）原样保留，和生成任务打到同一个地址。
func TestAssistantHostEnvCarriesProtocolAndBaseURLShape(t *testing.T) {
	dataDir := t.TempDir()
	host := New(Options{DataDir: dataDir})
	cases := []struct {
		protocol string
		baseURL  string
		wantAPI  string
		wantBase string
	}{
		{"chat-completion", "https://beeftv.app", "openai-completions", "https://beeftv.app/v1"},
		{"chat-completion", "https://beeftv.app/v1/", "openai-completions", "https://beeftv.app/v1"},
		{"chat-completion", "https://gateway.example.com/api/v3", "openai-completions", "https://gateway.example.com/api/v3"},
		{"chat-completion", "https://gateway.example.com/api/paas/v4/", "openai-completions", "https://gateway.example.com/api/paas/v4"},
		{"chat-completion", "https://gateway.example.com/v1/chat/completions", "openai-completions", "https://gateway.example.com/v1"},
		{"responses", "https://beeftv.app", "openai-responses", "https://beeftv.app/v1"},
		{"responses", "https://gateway.example.com/api/v3", "openai-responses", "https://gateway.example.com/api/v3"},
		{"claude-api", "https://beeftv.app/v1", "anthropic-messages", "https://beeftv.app"},
		{"claude-api", "https://beeftv.app", "anthropic-messages", "https://beeftv.app"},
	}
	for _, item := range cases {
		env := host.buildEnv(assistant.Provider{Model: "m", BaseURL: item.baseURL, APIKey: "k", Protocol: item.protocol},
			testPin("http://127.0.0.1:18090/api", ""))
		if got := envValue(env, "BEEFTV_AGENT_API"); got != item.wantAPI {
			t.Fatalf("Protocol %s should be mapped to %s, resulting in %q", item.protocol, item.wantAPI, got)
		}
		if got := envValue(env, "BEEFTV_AGENT_BASE_URL"); got != item.wantBase {
			t.Fatalf("The interface address of protocol %s should be %s, getting %q", item.protocol, item.wantBase, got)
		}
	}
}

// 未配置启动命令时，启动链上的自动拉起必须是 no-op，不能让应用启动失败。
func TestStartIsNoopWithoutConfig(t *testing.T) {
	host := New(Options{DataDir: t.TempDir()})
	if err := host.Start("http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatalf("Application startup should not fail when the host is not configured: %v", err)
	}
	if host.Running() {
		t.Fatal("There should be no host process when not configured")
	}
}

// 打包布局：能从 Contents/MacOS/<exe> 推导出 Contents/Resources/agent-host，
// 不需要用户配置任何开发路径。
func TestBundledAgentHostCommandFollowsAppLayout(t *testing.T) {
	for _, goos := range []string{"darwin", "windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "Program Files", "BeefTV")
			executable := filepath.Join(root, "Contents", "MacOS", "BeefTV")
			hostDir := filepath.Join(root, "Contents", "Resources", "agent-host")
			node := filepath.Join(hostDir, "runtime", "bin", "node")
			if goos == "linux" {
				executable = filepath.Join(root, "BeefTV")
				hostDir = filepath.Join(root, "agent-host")
				node = filepath.Join(hostDir, "runtime", "bin", "node")
			}
			if goos == "windows" {
				executable = filepath.Join(root, "BeefTV.exe")
				hostDir = filepath.Join(root, "agent-host")
				node = filepath.Join(hostDir, "runtime", "node.exe")
			}
			if err := os.MkdirAll(filepath.Dir(node), 0o755); err != nil {
				t.Fatal(err)
			}
			entry := filepath.Join(hostDir, "server.mjs")
			for _, file := range []string{node, entry} {
				if err := os.WriteFile(file, []byte("fixture"), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			got := BundledConfig(executable, goos)
			if got.HostCommand != node || len(got.HostArgs) != 1 || got.HostArgs[0] != entry {
				t.Fatalf("invalid bundled command: %#v", got)
			}
			if err := os.Remove(node); err != nil {
				t.Fatal(err)
			}
			if got := BundledConfig(executable, goos); got.HostCommand != "" {
				t.Fatalf("missing runtime must not fall back to PATH: %#v", got)
			}
		})
	}
}

// 插件安装用随包 npm：路径与 scripts/package-agent-host.mjs 的 bundleNpmRuntime 一致。
func TestBundledNpmCommandUsesNpmShippedNextToNode(t *testing.T) {
	for _, goos := range []string{"darwin", "windows"} {
		t.Run(goos, func(t *testing.T) {
			root := t.TempDir()
			executable := filepath.Join(root, "Contents", "MacOS", "BeefTV")
			hostDir := filepath.Join(root, "Contents", "Resources", "agent-host")
			node := filepath.Join(hostDir, "runtime", "bin", "node")
			cli := filepath.Join(hostDir, "runtime", "lib", "node_modules", "npm", "bin", "npm-cli.js")
			if goos == "windows" {
				executable = filepath.Join(root, "BeefTV.exe")
				hostDir = filepath.Join(root, "agent-host")
				node = filepath.Join(hostDir, "runtime", "node.exe")
				cli = filepath.Join(hostDir, "runtime", "node_modules", "npm", "bin", "npm-cli.js")
			}
			for _, file := range []string{node, filepath.Join(hostDir, "server.mjs")} {
				if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, []byte("fixture"), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			if got := BundledNpmCommand(executable, goos); got != nil {
				t.Fatalf("a runtime without npm must not invent one: %#v", got)
			}
			if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(cli, []byte("fixture"), 0o644); err != nil {
				t.Fatal(err)
			}
			got := BundledNpmCommand(executable, goos)
			if len(got) != 2 || got[0] != node || filepath.Clean(got[1]) != cli {
				t.Fatalf("unexpected bundled npm command: %#v", got)
			}
		})
	}
}

func TestAgentHostReapsExitAndRestartsWithSpacedPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "directory with spaces")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(dir, "host-helper")
	if runtime.GOOS == "windows" {
		helper += ".exe"
	}
	src, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(helper, src, 0o755); err != nil {
		t.Fatal(err)
	}
	host := New(Options{
		DataDir:      dir,
		ReadyTimeout: 8 * time.Second,
		Environ:      func() []string { return append(os.Environ(), fixtureEnv+"=http") },
	})
	t.Cleanup(func() { _ = host.Stop() })
	if err := host.WriteConfig(HostConfig{HostCommand: helper}); err != nil {
		t.Fatal(err)
	}
	provider := fixtureProvider()
	if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	first := host.Endpoint()
	if first == "" || !host.Running() {
		t.Fatal("spaced host command should own a ready endpoint")
	}
	if err := host.Restart(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	if !host.Running() || host.Endpoint() == "" {
		t.Fatal("restart after spaced path must still own a ready child")
	}
}

// 操作层基址必须来自真实运行中的后端：桌面形态监听随机回环端口，
// 用环境变量猜端口会把宿主的探测指向错误位置（表现为「助手不可用」）。
func TestOpsBaseURLPrefersExplicitAddress(t *testing.T) {
	if got := opsBaseURL("http://127.0.0.1:54321", "127.0.0.1:9999"); got != "http://127.0.0.1:54321/api" {
		t.Fatalf("The explicit address should be taken and /api complemented, giving %q", got)
	}
	if got := opsBaseURL("http://127.0.0.1:54321/api", "127.0.0.1:9999"); got != "http://127.0.0.1:54321/api" {
		t.Fatalf("Already /api should not be spliced repeatedly to get %q", got)
	}
	if got := opsBaseURL("", "127.0.0.1:9999"); got != "http://127.0.0.1:9999/api" {
		t.Fatalf("When there is no explicit address, the environment variable should be returned and %q is obtained.", got)
	}
}

func TestBuildEnvStripsInheritedSecretsAndClearsBlankAuthority(t *testing.T) {
	dataDir := t.TempDir()
	host := New(Options{
		DataDir:   dataDir,
		HostToken: func() string { return "pinned-host" },
		Environ: func() []string {
			return []string{
				"PATH=/usr/bin:/opt/homebrew/bin",
				"HOME=/tmp",
				"BEEFTV_AGENT_PORT=18500",
				"BEEFTV_OWNER_TOKEN=stolen-owner",
				"BEEFTV_AGENT_HOST_TOKEN=stolen-host",
				"BEEFTV_OPS_URL=http://evil.example/api",
				"BEEFTV_AGENT_API_KEY=inherited-key",
				"OPENAI_API_KEY=sk-openai",
				"ANTHROPIC_API_KEY=sk-ant",
				"GEMINI_API_KEY=stolen-gemini",
				"BEEFTV_AGENT_MAX_TOKENS=1234",
				"BEEFTV_AGENT_THINKING=medium",
			}
		},
	})
	env := host.buildEnv(assistant.Provider{Model: "m", BaseURL: "https://example.invalid/v1", Protocol: "chat-completion"}, childPin{
		Port: 54321, Nonce: "nonce-value", ListenFD: "3", Lifetime: true,
		OpsURL: "http://127.0.0.1:18090/api", DesktopTok: "desk",
	})
	if got := envValue(env, "PATH"); got != "/usr/bin:/opt/homebrew/bin" {
		t.Fatalf("PATH must be preserved, getting %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_PORT"); got != "54321" {
		t.Fatalf("PORT must be nailed by the supervisor, getting %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_HOST_TOKEN"); got != "pinned-host" {
		t.Fatalf("Host credentials must override the inherited value, getting %q", got)
	}
	if got := envValue(env, "BEEFTV_OWNER_TOKEN"); got != "" {
		t.Fatalf("OWNER_TOKEN is not allowed to enter the child process and gets %q", got)
	}
	if got := envValue(env, "BEEFTV_OPS_URL"); got != "http://127.0.0.1:18090/api" {
		t.Fatalf("OPS_URL must be nailed, getting %q", got)
	}
	if got := envValue(env, "BEEFTV_AGENT_API_KEY"); got != "" {
		t.Fatalf("A blank authoritative key must clear the inherited value, resulting in %q", got)
	}
	if !envHasKey(env, "BEEFTV_AGENT_API_KEY") {
		t.Fatal("A blank authoritative key must be written with a null value and cannot be omitted")
	}
	if envValue(env, "OPENAI_API_KEY") != "" || envHasKey(env, "OPENAI_API_KEY") {
		t.Fatal("OPENAI_API_KEY in the environment must not be brought into the SDK")
	}
	if envValue(env, "ANTHROPIC_API_KEY") != "" || envHasKey(env, "ANTHROPIC_API_KEY") {
		t.Fatal("ANTHROPIC_API_KEY in the environment must not be brought into the SDK")
	}
	if envValue(env, "BEEFTV_AGENT_INSTANCE_NONCE") != "nonce-value" {
		t.Fatal("Instance nonce must be nailed")
	}
	if envValue(env, "BEEFTV_AGENT_LIFETIME_STDIN") != "1" {
		t.Fatal("Lifecycle pipeline tags must be nailed")
	}
	if envValue(env, "BEEFTV_AGENT_MAX_TOKENS") != "1234" {
		t.Fatalf("Non-authoritative tunables should be retained, resulting in %q", envValue(env, "BEEFTV_AGENT_MAX_TOKENS"))
	}
	if envValue(env, "BEEFTV_AGENT_THINKING") != "medium" {
		t.Fatalf("Thinking intensity should be retained, getting %q", envValue(env, "BEEFTV_AGENT_THINKING"))
	}
}

func TestWriteConfigUsesRestrictedPermissions(t *testing.T) {
	dataDir := t.TempDir()
	host := New(Options{DataDir: dataDir})
	if err := host.WriteConfig(HostConfig{Model: "m", HostCommand: "/bin/true"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dataDir, hostConfigFile))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if perm := info.Mode().Perm(); perm&0o077 != 0 {
			t.Fatalf("config permissions = %o, want 0600-class", perm)
		}
	}
	config, configured := host.EffectiveConfig()
	if !configured || config.HostCommand != "/bin/true" {
		t.Fatalf("effective config = %#v configured=%v", config, configured)
	}
}
