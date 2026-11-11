package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type e2eBackendTask struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

func (h *e2eGenerationHarness) backendTasks() []e2eBackendTask {
	response, err := http.Get(h.serverURL + "/__tasks?canvasId=" + h.canvasID)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	var payload struct {
		Tasks []e2eBackendTask `json:"tasks"`
	}
	if json.NewDecoder(response.Body).Decode(&payload) != nil {
		return nil
	}
	return payload.Tasks
}

func (h *e2eGenerationHarness) confirmState() (bool, bool) {
	response, err := http.Get(h.serverURL + "/__confirm-state")
	if err != nil {
		return false, false
	}
	defer response.Body.Close()
	var payload struct {
		InFlight bool `json:"inFlight"`
		Locked   bool `json:"locked"`
	}
	if json.NewDecoder(response.Body).Decode(&payload) != nil {
		return false, false
	}
	return payload.InFlight, payload.Locked
}

// 确认请求在途时收到 SIGINT：收尾必须先停新确认、等 gate 锁和确认 Promise 结束，
// 再查询任务。最终报告要么列出新建任务并有取消尝试，要么明确标记确认结果未知；
// 不允许「后端有任务，报告却 pendingTasks 为空且未标记未知」。
func TestE2EGenerationDriverSettlesWhileConfirmInFlight(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns the real agent host")
	}
	t.Setenv("BEEFTV_REAL_GEN_TEST_CONFIRM_DELAY_MS", "2000")
	t.Setenv("BEEFTV_REAL_GEN_TEST_IMAGE_DELAY_MS", "3000")
	harness := newE2EGenerationHarness(t, true)
	out := t.TempDir()
	command, cancel, outDir, log := harness.prepareDriver(t, map[string]any{"outDir": out, "failCancel": true})
	defer cancel()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.Process != nil && command.ProcessState == nil {
			_ = command.Process.Kill()
		}
	})

	deadline := time.Now().Add(15 * time.Second)
	for {
		inFlight, locked := harness.confirmState()
		if inFlight && locked {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Confirm that the request does not enter the gate lock\n%s", redactSecret(log.String(), harness.upstreamKey))
		}
		time.Sleep(100 * time.Millisecond)
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
		t.Fatalf("Confirm that SIGINT does not exit within 25 seconds while in transit\n%s", redactSecret(log.String(), harness.upstreamKey))
	}

	raw, err := os.ReadFile(filepath.Join(outDir, "report.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report e2eGenerationReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	tasks := harness.backendTasks()
	if len(tasks) == 0 {
		t.Fatalf("It was confirmed that it was in progress but no task was created in the end, and the test did not cover the race condition.\n%s", redactSecret(log.String(), harness.upstreamKey))
	}
	if len(report.PendingTasks) == 0 && !report.ConfirmationOutcomeUnknown {
		t.Fatalf("The backend has %d tasks, but the report has neither pendingTasks nor flagged acknowledgments. The result is unknown: %+v", len(tasks), report)
	}
	if len(report.PendingTasks) > 0 && len(report.CancelAttempts) == 0 {
		t.Fatalf("pendingTasks has no corresponding cancellation attempt: %+v", report.CancelAttempts)
	}
	if len(report.RelatedProposalIDs) == 0 {
		t.Fatal("The report does not record the ID of the solution to be confirmed.")
	}
}
