package assistantruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"infinite-canvas/backend/internal/assistant"
)

const fixtureEnv = "BEEFTV_ASSISTANT_RUNTIME_FIXTURE"

var platformProcessFixtures = map[string]func() int{}

func TestMain(m *testing.M) {
	if mode := strings.TrimSpace(os.Getenv(fixtureEnv)); mode != "" {
		os.Exit(runProcessFixture(mode))
	}
	os.Exit(m.Run())
}

func runProcessFixture(mode string) int {
	switch mode {
	case "sleep":
		waitForStopSignal()
		return 0
	case "exit0":
		return 0
	case "crash":
		return 2
	case "fail-listen":
		return 2
	case "http":
		return runHTTPFixture()
	case "supervisor":
		return runSupervisorFixture()
	default:
		if run := platformProcessFixtures[mode]; run != nil {
			return run()
		}
		fmt.Fprintf(os.Stderr, "unknown fixture %q\n", mode)
		return 1
	}
}

func runHTTPFixture() int {
	nonce := os.Getenv("BEEFTV_AGENT_INSTANCE_NONCE")
	if dataDir := os.Getenv("BEEFTV_AGENT_DATA_DIR"); dataDir != "" {
		_ = os.WriteFile(filepath.Join(dataDir, "child-env.txt"), []byte(strings.Join(os.Environ(), "\n")), 0o600)
		_ = os.WriteFile(filepath.Join(dataDir, "child-pid.txt"), []byte(strconv.Itoa(os.Getpid())), 0o600)
	}
	go func() {
		buf := make([]byte, 1)
		for {
			if _, err := os.Stdin.Read(buf); err != nil {
				fmt.Fprintf(os.Stderr, "fixture lifetime stdin ended: %v\n", err)
				os.Exit(0)
			}
		}
	}()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if nonce != "" && r.Header.Get(InstanceHeader) != nonce {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"ok":false,"reason":"instance_mismatch"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		busy := os.Getenv("BEEFTV_AGENT_BUSY") == "1"
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true, "busy": busy, "model": os.Getenv("BEEFTV_AGENT_MODEL"),
			"instance": InstanceProof(nonce),
		})
	})
	if fdRaw := strings.TrimSpace(os.Getenv("BEEFTV_AGENT_LISTEN_FD")); fdRaw != "" {
		fd, err := strconv.Atoi(fdRaw)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		listener, err := net.FileListener(os.NewFile(uintptr(fd), "listen"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if err := http.Serve(listener, mux); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	port := strings.TrimSpace(os.Getenv("BEEFTV_AGENT_PORT"))
	if port == "" {
		fmt.Fprintln(os.Stderr, "missing BEEFTV_AGENT_PORT")
		return 2
	}
	fmt.Fprintln(os.Stderr, "fixture listening on allocated loopback port")
	if err := http.ListenAndServe("127.0.0.1:"+port, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func runSupervisorFixture() int {
	dataDir := os.Getenv("BEEFTV_SUPERVISOR_DATA")
	config := HostConfig{HostCommand: os.Args[0], HostArgs: []string{}}
	encoded, err := json.Marshal(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := os.WriteFile(filepath.Join(dataDir, hostConfigFile), encoded, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	host := New(Options{
		DataDir:      dataDir,
		ReadyTimeout: 8 * time.Second,
		Environ: func() []string {
			out := make([]string, 0)
			for _, entry := range os.Environ() {
				if strings.HasPrefix(entry, fixtureEnv+"=") {
					continue
				}
				out = append(out, entry)
			}
			return append(out, fixtureEnv+"=http")
		},
	})
	if err := host.Launch(fixtureProvider(), "http://127.0.0.1:18090/api", ""); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	_ = os.WriteFile(filepath.Join(dataDir, "child-pid.txt"), []byte(strconv.Itoa(host.PID())), 0o600)
	// Publish readiness last; readers must never observe the PID file mid-truncate.
	_ = os.WriteFile(filepath.Join(dataDir, "endpoint.txt"), []byte(host.Endpoint()), 0o600)
	select {}
}

func fixtureProvider() assistant.Provider {
	return assistant.Provider{Model: "m", BaseURL: "https://example.invalid/v1", APIKey: "k", Protocol: "chat-completion"}
}

func waitForStopSignal() {
	notified := make(chan os.Signal, 1)
	signal.Notify(notified, os.Interrupt, syscall.SIGTERM)
	<-notified
}

func fixtureHost(t *testing.T, mode string) *Host {
	t.Helper()
	dataDir := t.TempDir()
	config := HostConfig{HostCommand: os.Args[0], HostArgs: []string{}}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, hostConfigFile), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	host := New(Options{
		DataDir:      dataDir,
		ReadyTimeout: 8 * time.Second,
		Environ: func() []string {
			return append(os.Environ(), fixtureEnv+"="+mode)
		},
	})
	t.Cleanup(func() { _ = host.Stop() })
	return host
}

func waitUntil(timeout time.Duration, ok func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ok() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return ok()
}

func TestHostStopReapsOwnChild(t *testing.T) {
	host := fixtureHost(t, "http")
	if err := host.Launch(fixtureProvider(), "http://127.0.0.1:18090/api", "desktop-shell-token"); err != nil {
		t.Fatalf("Failed to start test host: %v", err)
	}
	if host.PID() == 0 || !host.Running() {
		t.Fatal("The child process should be running")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := host.StopContext(ctx); err != nil {
		t.Fatalf("The shutdown hook should successfully stop the host started by this Host: %v", err)
	}
	if host.Running() {
		t.Fatal("Running should not still be reported after stopping")
	}
	if err := host.StopContext(context.Background()); err != nil {
		t.Fatalf("When there is no own host, the hook should be no-op, actual %v", err)
	}
	if launched, err := host.Ensure(fixtureProvider(), "http://127.0.0.1:18090/api", "desktop-shell-token", true); err == nil || launched || host.Running() {
		t.Fatalf("Status query during application exit must not restart the host: launched=%v err=%v", launched, err)
	}
}

func TestHostRestartReplacesChild(t *testing.T) {
	host := fixtureHost(t, "http")
	provider := fixtureProvider()
	if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	first := host.PID()
	if first == 0 {
		t.Fatal("Child process PID not logged")
	}
	if err := host.Restart(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatalf("Restart failed: %v", err)
	}
	if !host.Running() {
		t.Fatal("There should be new child processes after restarting")
	}
	second := host.PID()
	if second == 0 || second == first {
		t.Fatalf("Restart and change the PID, first=%d second=%d", first, second)
	}
}

func TestHostCrashIsReapedAndCanRelaunch(t *testing.T) {
	host := fixtureHost(t, "crash")
	provider := fixtureProvider()
	for attempt := 0; attempt < 2; attempt++ {
		if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err == nil {
			t.Fatal("A crashed child process must not be reported as ready")
		}
		if host.Running() || host.Endpoint() != "" {
			t.Fatal("Crash child processes should be recycled and must not leave reusable endpoints")
		}
	}
}

func TestSeparateHostsDoNotShareProcessOwnership(t *testing.T) {
	first := fixtureHost(t, "http")
	second := fixtureHost(t, "http")
	provider := fixtureProvider()
	if err := first.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	if err := second.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	firstPID, secondPID := first.PID(), second.PID()
	if firstPID == 0 || secondPID == 0 || firstPID == secondPID {
		t.Fatalf("The two Hosts should each hold child processes first=%d second=%d", firstPID, secondPID)
	}
	if err := first.Stop(); err != nil {
		t.Fatal(err)
	}
	if first.Running() {
		t.Fatal("Stopping first itself should not still be running")
	}
	if !second.Running() || second.PID() != secondPID {
		t.Fatal("Stopping first must not take away the child processes of second")
	}
}

func TestEnsureRestartsWhenFingerprintChangesAndIdle(t *testing.T) {
	host := fixtureHost(t, "http")
	original := fixtureProvider()
	if err := host.Launch(original, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	first := host.PID()
	updated := original
	updated.APIKey = "rotated"
	launched, err := host.Ensure(updated, "http://127.0.0.1:18090/api", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !launched {
		t.Fatal("Should be restarted when idle and fingerprint changes")
	}
	if host.PID() == first {
		t.Fatal("If the fingerprint changes and restarts, the PID should be replaced with a new one.")
	}
	launched, err = host.Ensure(updated, "http://127.0.0.1:18090/api", "", true)
	if err != nil || launched {
		t.Fatalf("The same fingerprint and when running Ensure should be no-op launched=%v err=%v", launched, err)
	}
}

func TestConcurrentLifecycleLeavesSingleOwnedChild(t *testing.T) {
	host := fixtureHost(t, "http")
	provider := fixtureProvider()
	if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	updated := provider
	updated.APIKey = "rotated"
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(3)
		go func() {
			defer wg.Done()
			_, _ = host.Ensure(provider, "http://127.0.0.1:18090/api", "", true)
		}()
		go func() {
			defer wg.Done()
			_, _ = host.Ensure(updated, "http://127.0.0.1:18090/api", "", false)
		}()
		go func() {
			defer wg.Done()
			_ = host.Restart(provider, "http://127.0.0.1:18090/api", "")
		}()
	}
	wg.Wait()
	if err := host.Stop(); err != nil {
		t.Fatal(err)
	}
	if host.Running() {
		t.Fatal("After the concurrent Ensure/Restart is completed, Stop must take away the host's child process.")
	}
	if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatalf("A single Wait constraint should still be able to start again after concurrency: %v", err)
	}
	if !host.Running() {
		t.Fatal("Start the child process again")
	}
}

func TestEnsureDoesNotRestartBusyHostOnFingerprintChange(t *testing.T) {
	host := fixtureHost(t, "http")
	original := fixtureProvider()
	if err := host.Launch(original, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	first := host.PID()
	updated := original
	updated.Model = "other"
	launched, err := host.Ensure(updated, "http://127.0.0.1:18090/api", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if launched {
		t.Fatal("Do not restart due to fingerprint changes when not idle")
	}
	if host.PID() != first {
		t.Fatal("PID should remain unchanged when not idle")
	}
}

func startOutsider(t *testing.T) *exec.Cmd {
	t.Helper()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "120", "127.0.0.1")
	} else {
		cmd = exec.Command("sleep", "120")
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	return cmd
}

func startForeignHealth(t *testing.T) (addr string, hits *int32) {
	t.Helper()
	var n int32
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"busy":false,"model":"foreign","instance":"not-ours"}`))
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return "http://" + listener.Addr().String(), &n
}

func TestFreshHostDoesNotAdoptForeignHealthyListener(t *testing.T) {
	foreign, hits := startForeignHealth(t)
	t.Setenv("BEEFTV_AGENT_HOST_URL", foreign)
	t.Setenv("BEEFTV_AGENT_PORT", "18500")
	host := New(Options{DataDir: t.TempDir()})
	if host.Endpoint() != "" || host.Running() {
		t.Fatal("The newly constructed Host must not claim existing listeners")
	}
	health := host.Probe(context.Background())
	if health.OK {
		t.Fatal("Probe must not treat external /health as its own child process")
	}
	if err := host.Stop(); err != nil {
		t.Fatal(err)
	}
	if *hits != 0 {
		t.Fatalf("Stop/Probe must not hit external listeners, hits=%d", *hits)
	}
	req, err := http.NewRequest(http.MethodGet, foreign+"/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatal("The external listener must still be running")
	}
}

func TestLaunchPinsPortAndDropsSpoofedOwnerOpenAI(t *testing.T) {
	host := fixtureHost(t, "http")
	host.opts.Environ = func() []string {
		return []string{
			"PATH=" + os.Getenv("PATH"),
			"HOME=" + os.Getenv("HOME"),
			fixtureEnv + "=http",
			"BEEFTV_AGENT_PORT=18500",
			"BEEFTV_OWNER_TOKEN=stolen-owner",
			"BEEFTV_AGENT_HOST_TOKEN=stolen-host",
			"OPENAI_API_KEY=sk-openai",
			"ANTHROPIC_API_KEY=sk-ant",
		}
	}
	host.opts.HostToken = func() string { return "pinned-host" }
	if err := host.Launch(fixtureProvider(), "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(host.dataDir(), "child-env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	childEnv := strings.Split(string(raw), "\n")
	if port := envValue(childEnv, "BEEFTV_AGENT_PORT"); port == "" || port == "18500" {
		t.Fatalf("The child process PORT must be the instance port pinned by the supervisor, resulting in %q", port)
	}
	if envValue(childEnv, "BEEFTV_OWNER_TOKEN") != "" {
		t.Fatal("Child processes must not see OWNER_TOKEN")
	}
	if envValue(childEnv, "BEEFTV_AGENT_HOST_TOKEN") != "pinned-host" {
		t.Fatalf("The child process host credentials should be overridden, getting %q", envValue(childEnv, "BEEFTV_AGENT_HOST_TOKEN"))
	}
	if envHasKey(childEnv, "OPENAI_API_KEY") || envHasKey(childEnv, "ANTHROPIC_API_KEY") {
		t.Fatal("Child processes must not inherit OPENAI/ANTHROPIC keys")
	}
	if host.Endpoint() == "http://127.0.0.1:18500" {
		t.Fatal("Endpoints must not fall within inherited 18500")
	}
}

func TestRestartFailureDoesNotReportSuccessOrKeepEndpoint(t *testing.T) {
	host := fixtureHost(t, "http")
	provider := fixtureProvider()
	if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	if host.Endpoint() == "" {
		t.Fatal("After successful startup, your own endpoint must be exposed")
	}
	host.opts.Environ = func() []string {
		return append(os.Environ(), fixtureEnv+"=fail-listen")
	}
	if err := host.Restart(provider, "http://127.0.0.1:18090/api", ""); err == nil {
		t.Fatal("Restarts that fail to be ready must not report success")
	}
	if host.Running() || host.Endpoint() != "" {
		t.Fatal("Reusable endpoints must not be left after a failed restart")
	}
}

func TestRelaunchDoesNotTalkToOldChild(t *testing.T) {
	host := fixtureHost(t, "http")
	provider := fixtureProvider()
	if err := host.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	firstPID := host.PID()
	firstURL := host.Endpoint()
	if firstPID == 0 || firstURL == "" {
		t.Fatal("Requires ready first-generation child processes")
	}
	if err := host.Restart(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	if host.PID() == firstPID || host.Endpoint() == firstURL {
		t.Fatalf("Restart must be replaced with a new instance pid=%d/%d url=%s/%s", firstPID, host.PID(), firstURL, host.Endpoint())
	}
	resp, err := http.Get(firstURL + "/health")
	if err == nil {
		resp.Body.Close()
		t.Fatal("The old child process must not continue to respond")
	}
}

func TestNewHostCannotAdoptPreviousEndpoint(t *testing.T) {
	first := fixtureHost(t, "http")
	provider := fixtureProvider()
	if err := first.Launch(provider, "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	owned := first.Endpoint()
	second := New(Options{DataDir: t.TempDir()})
	t.Cleanup(func() { _ = second.Stop() })
	if second.Endpoint() != "" || second.Probe(context.Background()).OK {
		t.Fatal("Another Host must not claim the endpoint of the previous instance")
	}
	if err := first.Stop(); err != nil {
		t.Fatal(err)
	}
	if _, err := http.Get(owned + "/health"); err == nil {
		t.Fatal("Old endpoints must not remain accessible after stopping")
	}
}

func TestProbeRejectsHealthyListenerWithoutMatchingInstance(t *testing.T) {
	foreign, hits := startForeignHealth(t)
	host := New(Options{DataDir: t.TempDir()})
	host.TestingUseOwnedEndpoint(foreign, "owned-nonce-value", "fp")
	health := host.Probe(context.Background())
	if health.OK {
		t.Fatal("When the instance proves that there is a mismatch, the external /health must not be regarded as its own child process.")
	}
	if *hits == 0 {
		t.Fatal("The Probe should hit the injected test endpoint and reject the proof")
	}
	if strings.Contains(fmt.Sprintf("%#v", health), "owned-nonce-value") {
		t.Fatal("Probe results must not contain instance nonce")
	}
}

func TestOwnedHealthJSONOmitsNonce(t *testing.T) {
	host := fixtureHost(t, "http")
	if err := host.Launch(fixtureProvider(), "http://127.0.0.1:18090/api", ""); err != nil {
		t.Fatal(err)
	}
	health := host.Probe(context.Background())
	if !health.OK || health.Instance == "" {
		t.Fatalf("Own child processes should be proven by examples: %#v", health)
	}
	req, err := host.NewChildRequest(context.Background(), http.MethodGet, "/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	nonce := req.Header.Get(InstanceHeader)
	if nonce == "" {
		t.Fatal("Subprocess requests must carry an instance nonce header")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), nonce) || strings.Contains(fmt.Sprintf("%#v", health), nonce) {
		t.Fatalf("health JSON or detection result contains nonce: %s", body)
	}
	if health.Instance == nonce {
		t.Fatal("The public instance field must be a proof and not a nonce")
	}
}
