package agentops

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/securefile"
)

// 已有安装的登记文件没有 kind / lastUsedAt / revokedAt：升级后必须照旧能用，
// 不能因为多了字段就把用户已经配好的外部客户端全部作废。
func TestLoadsPreExistingRegistrationsWithoutNewFields(t *testing.T) {
	dir := t.TempDir()
	// 这份内容就是旧版本写出的形状。
	legacy := `[{"id":"client-legacy","label":"old codex","mode":"read-write","tokenHash":"` +
		hashToken("legacy-token") + `","createdAt":"2026-01-02T03:04:05Z"}]`
	if err := os.WriteFile(filepath.Join(dir, "agent_clients.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	registry := NewClientRegistry(dir)

	found, ok := registry.Lookup("client-legacy", "legacy-token")
	if !ok {
		t.Fatal("The old registration should continue to be valid")
	}
	if found.Mode != ClientReadWrite {
		t.Fatalf("The capability mode of the old registration should be retained, getting %q", found.Mode)
	}
	if found.Kind != ClientKindOther {
		t.Fatalf("The missing kind should be replaced by other, resulting in %q", found.Kind)
	}
	if found.Origin != "" {
		t.Fatalf("When the old registration does not have origin, it should always be regarded as manual, and it will get %q", found.Origin)
	}
	items := registry.List()
	if len(items) != 1 || items[0].ID != "client-legacy" {
		t.Fatalf("The old registration should appear in the list: %+v", items)
	}
	if err := registry.Revoke("client-legacy"); err != nil {
		t.Fatalf("The old registration should be revoked: %v", err)
	}
	if _, ok := registry.Lookup("client-legacy", "legacy-token"); ok {
		t.Fatal("The old registration remains valid after revocation")
	}
}

func TestOriginDistinguishesOneClickFromManualConnections(t *testing.T) {
	registry := NewClientRegistry(t.TempDir())
	oneClick, _, err := registry.RegisterClientOrigin("claude", "Claude Code", "one-click:claude", ClientReadWrite, ClientApprovalCaller)
	if err != nil {
		t.Fatal(err)
	}
	manual, _, err := registry.RegisterClient("claude", "Claude Code", ClientReadWrite, ClientApprovalCaller)
	if err != nil {
		t.Fatal(err)
	}
	items := registry.List()
	if len(items) != 2 {
		t.Fatalf("items = %+v", items)
	}
	origins := map[string]string{}
	for _, item := range items {
		origins[item.ID] = item.Origin
	}
	if origins[oneClick.ID] != "one-click:claude" {
		t.Fatalf("one-click origin = %q", origins[oneClick.ID])
	}
	if origins[manual.ID] != "" {
		t.Fatalf("manual origin = %q, want empty", origins[manual.ID])
	}
}

func TestRegisterKindLookupAndRevoke(t *testing.T) {
	registry := NewClientRegistry(t.TempDir())
	registration, token, err := registry.RegisterKind("codex", "", ClientReadOnly)
	if err != nil {
		t.Fatal(err)
	}
	if registration.Kind != ClientKindCodex {
		t.Fatalf("kind should be codex, get %q", registration.Kind)
	}
	// 没给名字时用来源分类兜底，界面上不会出现空白一行。
	if registration.Label != "codex" {
		t.Fatalf("Empty names should fall back to the source classification, getting %q", registration.Label)
	}
	if registration.LastUsedAt != nil {
		t.Fatal("The newly registered client should not have usage time")
	}

	if _, ok := registry.Lookup(registration.ID, token); !ok {
		t.Fatal("The credentials you just registered should be available")
	}
	// 命中后要记下最近使用时间，界面才能显示哪个客户端还在用。
	items := registry.List()
	if len(items) != 1 || items[0].LastUsedAt == nil {
		t.Fatalf("Used registrations should have lastUsedAt: %+v", items)
	}

	if _, ok := registry.Lookup(registration.ID, "wrong-token"); ok {
		t.Fatal("Error token should not pass")
	}
	if _, ok := registry.Lookup("client-unknown", token); ok {
		t.Fatal("Unregistered ID should not be passed")
	}

	if err := registry.Revoke(registration.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := registry.Lookup(registration.ID, token); ok {
		t.Fatal("Credentials remain valid after revocation")
	}
	if len(registry.List()) != 0 {
		t.Fatal("Revoked registrations should not appear in the list")
	}
	// 记录本身要留着：删行会让同一个 ID 有机会被后来的登记复用。
	raw, err := os.ReadFile(registry.path)
	if err != nil {
		t.Fatal(err)
	}
	var stored []ClientRegistration
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || stored[0].RevokedAt == nil {
		t.Fatalf("Revocation should leave a record with time: %s", raw)
	}
	if err := registry.Revoke(registration.ID); err == nil {
		t.Fatal("Duplicate revocation report not found")
	}
	if err := registry.Revoke(""); err == nil {
		t.Fatal("Empty IDs should be rejected")
	}
}

// 登记文件里只存哈希：原始 token 只在签发响应里出现一次。
func TestRegistryNeverStoresRawToken(t *testing.T) {
	registry := NewClientRegistry(t.TempDir())
	_, token, err := registry.RegisterKind("cursor", "cursor", ClientReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(registry.path)
	if err != nil {
		t.Fatal(err)
	}
	if len(token) == 0 {
		t.Fatal("token should be issued")
	}
	if strings.Contains(string(raw), token) {
		t.Fatal("The original token appears in the registration file")
	}
	if err := securefile.Verify(registry.path); err != nil {
		t.Fatalf("The registration file is not tightened to be readable only by the current user: %v", err)
	}
}

// owner 与宿主凭据是原始 token：新写的、以及旧版本按默认权限写下的，都要只有当前用户可读。
func TestAgentCredentialsAreRestrictedToTheCurrentUser(t *testing.T) {
	dir := t.TempDir()
	// 旧版本留下的宿主凭据：Unix 上是 0644，Windows 上继承目录权限。
	if err := os.WriteFile(HostTokenPath(dir), []byte("legacy-host-token"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(HostTokenPath(dir), 0o644); err != nil {
		t.Fatal(err)
	}
	EnsureAgentCredentials(dir)
	for _, path := range []string{OwnerTokenPath(dir), HostTokenPath(dir)} {
		if err := securefile.Verify(path); err != nil {
			t.Fatalf("%s: %v", filepath.Base(path), err)
		}
	}
	raw, err := os.ReadFile(HostTokenPath(dir))
	if err != nil || string(raw) != "legacy-host-token" {
		t.Fatalf("Existing host credentials have been overwritten: %q %v", raw, err)
	}
}

// lastUsedAt 是展示信息：每次读操作都落盘会把登记表变成热点，所以按节流写。
func TestLastUsedWritesAreThrottled(t *testing.T) {
	registry := NewClientRegistry(t.TempDir())
	registration, token, err := registry.RegisterKind("claude", "claude", ClientReadOnly)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := registry.Lookup(registration.ID, token); !ok {
		t.Fatal("The first query should pass")
	}
	first := registry.List()[0].LastUsedAt
	if first == nil {
		t.Fatal("The time of first use should be recorded")
	}
	for i := 0; i < 20; i++ {
		if _, ok := registry.Lookup(registration.ID, token); !ok {
			t.Fatal("Repeat queries should be passed")
		}
	}
	if got := registry.List()[0].LastUsedAt; !got.Equal(*first) {
		t.Fatalf("LastUsedAt should not be rewritten repeatedly within the throttling window: %v -> %v", first, got)
	}

	// 把时间推到节流窗口之外，下一次使用就应该刷新。
	stale := first.Add(-2 * lastUsedThrottle)
	items := registry.List()
	items[0].LastUsedAt = &stale
	items[0].TokenHash = hashToken(token)
	if err := registry.save(items); err != nil {
		t.Fatal(err)
	}
	if _, ok := registry.Lookup(registration.ID, token); !ok {
		t.Fatal("Queries outside the throttling window should go through")
	}
	if got := registry.List()[0].LastUsedAt; got == nil || !got.After(stale.Add(time.Minute)) {
		t.Fatalf("lastUsedAt should be refreshed outside the throttling window and get %v", got)
	}
}

func TestNormalizeClientKind(t *testing.T) {
	for input, want := range map[string]ClientKind{
		"codex": ClientKindCodex, "CLAUDE": ClientKindClaude, " cursor ": ClientKindCursor,
		"other": ClientKindOther, "": ClientKindOther, "admin": ClientKindOther,
	} {
		if got := NormalizeClientKind(input); got != want {
			t.Fatalf("NormalizeClientKind(%q) = %q, expects %q", input, got, want)
		}
	}
}

func TestNormalizeAndRegisterClientApprovalMode(t *testing.T) {
	for input, want := range map[string]ClientApprovalMode{
		"ask": ClientApprovalAsk, "ASK": ClientApprovalAsk,
		"caller": ClientApprovalCaller, "": ClientApprovalCaller,
		"auto": ClientApprovalAuto, " AUTO ": ClientApprovalAuto,
	} {
		if got, err := NormalizeClientApprovalMode(input); err != nil || got != want {
			t.Fatalf("NormalizeClientApprovalMode(%q) = %q, %v, expects %q, nil", input, got, err, want)
		}
	}
	if _, err := NormalizeClientApprovalMode("unknown"); err == nil {
		t.Fatal("NormalizeClientApprovalMode(\"unknown\") should report an error")
	}
	registry := NewClientRegistry(t.TempDir())
	for _, mode := range []ClientApprovalMode{ClientApprovalAsk, ClientApprovalCaller, ClientApprovalAuto} {
		reg, token, err := registry.RegisterClient("cli-"+string(mode), "codex", ClientReadWrite, mode)
		if err != nil {
			t.Fatal(err)
		}
		if reg.ApprovalMode != mode {
			t.Fatalf("registered ApprovalMode = %q, want %q", reg.ApprovalMode, mode)
		}
		lookedUp, ok := registry.Lookup(reg.ID, token)
		if !ok || lookedUp.ApprovalMode != mode {
			t.Fatalf("lookup ApprovalMode = %+v, want %q", lookedUp, mode)
		}
	}
}

// 登记文件读不出时，ListLive 必须报错，不能把「读不出」当成「没有凭据」；
// List 保持原来的宽松行为供只展示用的调用方使用。
func TestListLiveReportsUnreadableRegistry(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "agent_clients.json"), []byte("{bad-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	registry := NewClientRegistry(dir)
	if _, err := registry.ListLive(); err == nil {
		t.Fatal("Corrupt registration files should cause ListLive to report an error")
	}
	if items := registry.List(); len(items) != 0 {
		t.Fatalf("List should be kept loose returning an empty list, getting %d items", len(items))
	}
}
