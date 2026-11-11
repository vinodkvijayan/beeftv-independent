package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func (h *e2eGenerationHarness) videoTaskState() (int, int) {
	response, err := http.Get(h.serverURL + "/__tasks?canvasId=" + h.canvasID)
	if err != nil {
		return 0, 0
	}
	defer response.Body.Close()
	var payload struct {
		Tasks []struct {
			Type   string `json:"type"`
			Status string `json:"status"`
		} `json:"tasks"`
	}
	if json.NewDecoder(response.Body).Decode(&payload) != nil {
		return 0, 0
	}
	total, active := 0, 0
	for _, task := range payload.Tasks {
		if task.Type != "canvas_video" {
			continue
		}
		total++
		if task.Status == "queued" || task.Status == "running" {
			active++
		}
	}
	return total, active
}

// SIGINT 必须走与正常退出相同的收尾：查询、取消未结束任务、再查询、写报告。
func TestE2EGenerationDriverSettlesOnInterrupt(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns the real agent host")
	}
	harness := newE2EGenerationHarness(t, true)
	out := t.TempDir()
	command, cancel, outDir, log := harness.prepareDriver(t, map[string]any{
		"outDir": out, "failCancel": true, "videoTimeoutMs": 300000,
	})
	defer cancel()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.Process != nil && command.ProcessState == nil {
			_ = command.Process.Kill()
		}
	})

	deadline := time.Now().Add(30 * time.Second)
	for {
		total, active := harness.videoTaskState()
		if total >= 2 && active >= 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for the video task to enter the running state\n%s", redactSecret(log.String(), harness.upstreamKey))
		}
		time.Sleep(200 * time.Millisecond)
	}
	if err := command.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case <-done:
	case <-time.After(25 * time.Second):
		_ = command.Process.Kill()
		t.Fatalf("Driver did not exit within 25 seconds after SIGINT\n%s", redactSecret(log.String(), harness.upstreamKey))
	}

	raw, err := os.ReadFile(filepath.Join(outDir, "report.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report e2eGenerationReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	if report.Interrupted != "SIGINT" {
		t.Fatalf("Report that no interrupt signal was logged: %q", report.Interrupted)
	}
	if len(report.CancelAttempts) == 0 {
		t.Fatal("Report no cancellation attempt")
	}
	failedCancel := false
	for _, attempt := range report.CancelAttempts {
		if !attempt.Requested {
			failedCancel = true
		}
	}
	if !failedCancel {
		t.Fatalf("Simulation cancellation failure is not recorded: %+v", report.CancelAttempts)
	}
	if len(report.PendingTasks) == 0 {
		t.Fatal("The report does not list tasks that may still be run")
	}
}
