package runtimeinfo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMain(m *testing.M) {
	if runtime.GOOS != "windows" {
		os.Exit(m.Run())
	}
	home, err := os.MkdirTemp("", "beeftv-runtime-home-")
	if err != nil {
		panic(err)
	}
	if err := os.Setenv("USERPROFILE", home); err != nil {
		panic(err)
	}
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}

func testPath(t *testing.T, dataDir string) string {
	t.Helper()
	path, err := Path(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeTestInfo(t *testing.T, dataDir string, info Info) {
	t.Helper()
	_, hash, err := descriptorLocation(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	info.DataDirHash = hash
	encoded, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(testPath(t, dataDir), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestWriteDiscoverRemove(t *testing.T) {
	dir := t.TempDir()
	if _, found := Discover(dir); found {
		t.Fatal("Address should not be discovered without runtime file")
	}
	if err := Write(dir, "http://127.0.0.1:53211/api", "v1.6.1"); err != nil {
		t.Fatal(err)
	}
	info, found := Discover(dir)
	if !found {
		t.Fatal("The address written by this process should be found")
	}
	if info.BaseURL != "http://127.0.0.1:53211/api" || info.Version != "v1.6.1" {
		t.Fatalf("The content found is incorrect: %+v", info)
	}
	if info.PID != os.Getpid() {
		t.Fatalf("PID should be writing process, got %d", info.PID)
	}
	// 只给本机用户读：里面是当前工作区的入口地址。
	stat, err := os.Stat(testPath(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && stat.Mode().Perm() != 0o600 {
		t.Fatalf("At runtime the file permissions should be 0600 and I get %v", stat.Mode().Perm())
	}
	if err := Remove(dir); err != nil {
		t.Fatal(err)
	}
	if _, found := Discover(dir); found {
		t.Fatal("Address discovery should not continue after exiting")
	}
	// 重复清理是幂等的。
	if err := Remove(dir); err != nil {
		t.Fatal(err)
	}
}

// 进程已经退出的文件是过期信息：绝不能拿这个端口去连别的进程。
func TestDiscoverIgnoresDeadProcess(t *testing.T) {
	dir := t.TempDir()
	stale := Info{BaseURL: "http://127.0.0.1:53211/api", PID: deadPID(t), Version: "v1.0.0"}
	writeTestInfo(t, dir, stale)
	if _, found := Discover(dir); found {
		t.Fatal("Runtime files whose processes have exited should be ignored")
	}
}

// 不属于本进程的运行时文件不能被清掉：那会把另一个还在跑的实例的地址抹掉。
func TestRemoveLeavesAnotherInstanceAlone(t *testing.T) {
	dir := t.TempDir()
	other := Info{BaseURL: "http://127.0.0.1:53212/api", PID: os.Getpid() + 1}
	writeTestInfo(t, dir, other)
	if err := Remove(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(testPath(t, dir)); err != nil {
		t.Fatal("The runtime file of another instance was deleted")
	}
}

func TestDiscoverIgnoresGarbageAndEmptyBaseURL(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(testPath(t, dir), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, found := Discover(dir); found {
		t.Fatal("Corrupted runtime files should be ignored")
	}
	if err := Remove(dir); err == nil {
		t.Fatal("Damaged files cannot be proven to belong to this process and should not be deleted")
	}
	if _, err := os.Stat(testPath(t, dir)); err != nil {
		t.Fatal("Corrupted files accidentally deleted")
	}
	writeTestInfo(t, dir, Info{PID: os.Getpid()})
	if _, found := Discover(dir); found {
		t.Fatal("Runtime files without addresses should be ignored")
	}
}

func TestDefaultDataDirHonorsOverrides(t *testing.T) {
	t.Setenv("BEEFTV_DATA_DIR", "")
	t.Setenv("CANVAS_DESKTOP_DATA_DIR", filepath.Join("tmp", "desktop-data"))
	got, err := DefaultDataDir()
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join("tmp", "desktop-data") {
		t.Fatalf("Desktop data directory override should be used, resulting in %q", got)
	}
	// CLI 侧的显式指定优先级更高：用来连非默认目录的工作区。
	t.Setenv("BEEFTV_DATA_DIR", filepath.Join("tmp", "cli-data"))
	got, err = DefaultDataDir()
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join("tmp", "cli-data") {
		t.Fatalf("BEEFTV_DATA_DIR should take precedence, getting %q", got)
	}
}

func TestExplicitDataDirIgnoresHostAppData(t *testing.T) {
	realDir := t.TempDir()
	shadowDir := t.TempDir()
	t.Setenv("APPDATA", shadowDir)
	t.Setenv("XDG_CONFIG_HOME", shadowDir)
	t.Setenv("CANVAS_DESKTOP_DATA_DIR", shadowDir)
	t.Setenv("BEEFTV_DATA_DIR", realDir)
	if err := Write(realDir, "http://127.0.0.1:53211/api", "real"); err != nil {
		t.Fatal(err)
	}
	if err := Write(shadowDir, "http://127.0.0.1:53212/api", "shadow"); err != nil {
		t.Fatal(err)
	}
	info, ok := Discover("")
	if !ok || info.Version != "real" {
		t.Fatalf("explicit workspace must beat inherited host paths: %+v, found=%v", info, ok)
	}
	if err := os.Remove(testPath(t, realDir)); err != nil {
		t.Fatal(err)
	}
	if _, ok := Discover(""); ok {
		t.Fatal("missing explicit runtime must not fall back to host workspace")
	}
}

func TestProcessAlive(t *testing.T) {
	if !ProcessAlive(os.Getpid()) {
		t.Fatal("The current process should be determined to be alive")
	}
	if ProcessAlive(0) || ProcessAlive(-1) {
		t.Fatal("Illegal PID should not be judged as alive")
	}
	if ProcessAlive(deadPID(t)) {
		t.Fatal("Exited processes should not be considered alive")
	}
}

// deadPID 给出一个远超系统 PID 上限的值，当作确定不存在的进程。
// 这和 desktopupdate 的测试用同一招，不依赖外部命令，Windows 上也成立。
func deadPID(t *testing.T) int {
	t.Helper()
	return 987654321
}
