package handler

import (
	"encoding/json"
	"testing"
)

// 回合失败后必须停止确认和后续轮次；报告仍要写出已完成/失败轮次的记录。
func TestE2EGenerationDriverStopsAfterTurnFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns the real agent host")
	}
	harness := newE2EGenerationHarness(t, true)
	out := t.TempDir()
	reportRaw := harness.runDriver(t, map[string]any{"failRound": 1, "outDir": out}, false)
	var report e2eGenerationReport
	if err := json.Unmarshal(reportRaw, &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Rounds) != 1 {
		t.Fatalf("Subsequent rounds should not continue after a failed round: %d", len(report.Rounds))
	}
	if report.Rounds[0].Status == "done" || report.Rounds[0].StopReason == "" {
		t.Fatalf("No error recorded for failed round: %+v", report.Rounds[0])
	}
	if len(report.Rounds[0].Confirmations) != 0 || len(report.Rounds[0].Tasks) != 0 {
		t.Fatalf("After the round failed, the plan was still confirmed or the task was created: %+v", report.Rounds[0])
	}
}
