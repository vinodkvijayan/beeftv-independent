package handler

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

type e2eReportConfirmation struct {
	Approved bool     `json:"approved"`
	Reason   string   `json:"reason"`
	TaskIDs  []string `json:"taskIds"`
}

type e2eReportOutput struct {
	ResourceID               string `json:"resourceId"`
	MaterializationErrorCode string `json:"materializationErrorCode"`
}

type e2eReportTask struct {
	ID      string            `json:"id"`
	Type    string            `json:"type"`
	Status  string            `json:"status"`
	Model   string            `json:"model"`
	Error   string            `json:"error"`
	Outputs []e2eReportOutput `json:"outputs"`
}

type e2eReportArtifact struct {
	File       string `json:"file"`
	ResourceID string `json:"resourceId"`
	Kind       string `json:"kind"`
	Mime       string `json:"mime"`
	Bytes      int64  `json:"bytes"`
}

type e2eReportRound struct {
	Round         int                     `json:"round"`
	Status        string                  `json:"status"`
	Message       string                  `json:"message"`
	Error         string                  `json:"error"`
	StopReason    string                  `json:"stopReason"`
	Confirmations []e2eReportConfirmation `json:"confirmations"`
	Tasks         []e2eReportTask         `json:"tasks"`
	Artifacts     []e2eReportArtifact     `json:"artifacts"`
}

// e2eGenerationReport 是驱动写出的最小可判定报告；只保留测评需要的字段。
type e2eGenerationReport struct {
	Mode        string           `json:"mode"`
	Rounds      []e2eReportRound `json:"rounds"`
	MediaReview struct {
		OK     bool   `json:"ok"`
		Model  string `json:"model"`
		Reason string `json:"reason"`
	} `json:"mediaReview"`
	PendingTasks []struct {
		ID                string `json:"id"`
		Type              string `json:"type"`
		Status            string `json:"status"`
		ProviderRequestID string `json:"providerRequestId"`
		PossiblyRunning   bool   `json:"possiblyRunning"`
	} `json:"pendingTasks"`
	CancelAttempts []struct {
		TaskID    string `json:"taskId"`
		Requested bool   `json:"requested"`
		Error     string `json:"error"`
	} `json:"cancelAttempts"`
	Interrupted                string   `json:"interrupted"`
	SettleError                string   `json:"settleError"`
	ShutdownError              string   `json:"shutdownError"`
	ConfirmationOutcomeUnknown bool     `json:"confirmationOutcomeUnknown"`
	RelatedProposalIDs         []string `json:"relatedProposalIds"`
	Issues                     []string `json:"issues"`
}

func assertCompleteGenerationReport(t *testing.T, raw []byte) {
	t.Helper()
	var report e2eGenerationReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	if gaps := generationReportGaps(report); len(gaps) > 0 {
		t.Fatalf("The actual generated result is incomplete: %s", strings.Join(gaps, "；"))
	}
}

func generationReportGapSummary(raw []byte) string {
	var report e2eGenerationReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return "report.json cannot be parsed:" + err.Error()
	}
	gaps := generationReportGaps(report)
	if len(gaps) == 0 {
		return "There are no identifiable gaps in the report"
	}
	return strings.Join(gaps, "；")
}

// generationReportGaps 同时服务假模式与真实模式：缺任何一项都返回具体缺口，
// 不允许“驱动退出码为 0 但没产物”通过。
func generationReportGaps(report e2eGenerationReport) []string {
	gaps := []string{}
	if len(report.Rounds) != 3 {
		gaps = append(gaps, fmt.Sprintf("The number of rounds required is 3, actual %d", len(report.Rounds)))
	}
	if !report.MediaReview.OK {
		gaps = append(gaps, "The film review model does not take effect:"+report.MediaReview.Reason)
	}
	images, videos, renders := 0, 0, 0
	for _, round := range report.Rounds {
		if round.Status != "done" || round.Error != "" {
			gaps = append(gaps, fmt.Sprintf("Round %d is not completed: %s %s", round.Round, round.Status, round.Error))
		}
		for _, task := range round.Tasks {
			if task.Status != "succeeded" {
				gaps = append(gaps, fmt.Sprintf("Task %s (%s) failed: %s", task.ID, task.Type, task.Status))
				continue
			}
			saved := false
			for _, output := range task.Outputs {
				if output.ResourceID != "" && output.MaterializationErrorCode == "" {
					saved = true
				}
			}
			if !saved {
				gaps = append(gaps, fmt.Sprintf("Task %s (%s) did not save a successful resource receipt", task.ID, task.Type))
				continue
			}
			switch {
			case task.Type == "canvas_image":
				images++
			case task.Type == "canvas_video":
				videos++
			case strings.Contains(task.Type, "timeline") || strings.Contains(task.Type, "render"):
				renders++
			}
		}
	}
	if images < 2 {
		gaps = append(gaps, fmt.Sprintf("The first frame picture task requires 2, actual %d", images))
	}
	if videos < 2 {
		gaps = append(gaps, fmt.Sprintf("The video task requires 2, actual %d", videos))
	}
	if renders < 1 {
		gaps = append(gaps, fmt.Sprintf("The film rendering task requires 1, actual %d", renders))
	}

	imageFiles, videoFiles, renderFiles := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, round := range report.Rounds {
		for _, item := range round.Artifacts {
			if item.Bytes <= 0 {
				gaps = append(gaps, "The product is empty:"+item.File)
				continue
			}
			key := item.ResourceID
			if key == "" {
				key = item.File
			}
			switch {
			case strings.HasPrefix(item.Mime, "image/"):
				imageFiles[key] = true
			case strings.HasPrefix(item.Mime, "video/"):
				if item.Kind == "render" || strings.Contains(filepath.Base(item.File), "render") {
					renderFiles[key] = true
				} else {
					videoFiles[key] = true
				}
			}
		}
	}
	if len(imageFiles) < 2 {
		gaps = append(gaps, fmt.Sprintf("The downloaded first frame requires 2, the actual one is %d", len(imageFiles)))
	}
	if len(videoFiles) < 2 {
		gaps = append(gaps, fmt.Sprintf("The downloaded video requires 2, actual %d", len(videoFiles)))
	}
	if len(renderFiles) < 1 {
		gaps = append(gaps, fmt.Sprintf("The downloaded film requires 1, actual %d", len(renderFiles)))
	}
	for _, issue := range report.Issues {
		if strings.TrimSpace(issue) != "" {
			gaps = append(gaps, "Driver issues:"+issue)
		}
	}
	if len(report.PendingTasks) > 0 {
		gaps = append(gaps, fmt.Sprintf("%d tasks may still be running at the end", len(report.PendingTasks)))
	}
	if strings.TrimSpace(report.Interrupted) != "" {
		gaps = append(gaps, "Operation was interrupted:"+report.Interrupted)
	}
	if report.ConfirmationOutcomeUnknown {
		gaps = append(gaps, "The confirmation result is unknown, related solutions:"+strings.Join(report.RelatedProposalIDs, ","))
	}
	if strings.TrimSpace(report.SettleError) != "" {
		gaps = append(gaps, "The closing query task failed:"+report.SettleError)
	}
	return gaps
}

func completeE2EReport() e2eGenerationReport {
	report := e2eGenerationReport{Mode: "fake"}
	report.MediaReview.OK = true
	report.MediaReview.Model = "gemini-3.8-flash"
	task := func(id, kind string, round, index int) e2eReportTask {
		return e2eReportTask{ID: id, Type: kind, Status: "succeeded",
			Outputs: []e2eReportOutput{{ResourceID: fmt.Sprintf("res-%d-%d", round, index)}}}
	}
	artifact := func(file, resourceID, kind, mime string) e2eReportArtifact {
		return e2eReportArtifact{File: file, ResourceID: resourceID, Kind: kind, Mime: mime, Bytes: 1024}
	}
	report.Rounds = []e2eReportRound{
		{Round: 1, Status: "done",
			Tasks:     []e2eReportTask{task("1-task-0", "canvas_image", 1, 0), task("1-task-1", "canvas_image", 1, 1)},
			Artifacts: []e2eReportArtifact{artifact("artifacts/01-image-a.png", "res-1-0", "image", "image/png"), artifact("artifacts/01-image-b.png", "res-1-1", "image", "image/png")}},
		{Round: 2, Status: "done",
			Tasks:     []e2eReportTask{task("2-task-0", "canvas_video", 2, 0), task("2-task-1", "canvas_video", 2, 1)},
			Artifacts: []e2eReportArtifact{artifact("artifacts/02-video-a.mp4", "res-2-0", "video", "video/mp4"), artifact("artifacts/02-video-b.mp4", "res-2-1", "video", "video/mp4")}},
		{Round: 3, Status: "done",
			Tasks:     []e2eReportTask{task("3-task-0", "timeline_render", 3, 0)},
			Artifacts: []e2eReportArtifact{artifact("artifacts/03-render-final.mp4", "res-3-0", "render", "video/mp4")}},
	}
	return report
}

func TestE2EGenerationReportRequiresArtifacts(t *testing.T) {
	if gaps := generationReportGaps(completeE2EReport()); len(gaps) > 0 {
		t.Fatalf("The complete report should have no gaps: %v", gaps)
	}

	t.Run("missing render", func(t *testing.T) {
		report := completeE2EReport()
		report.Rounds[2].Artifacts = nil
		report.Rounds[2].Tasks = nil
		gaps := generationReportGaps(report)
		if !strings.Contains(strings.Join(gaps, "|"), "成片") {
			t.Fatalf("Failure to complete the film must result in failure: %v", gaps)
		}
	})
	t.Run("missing first frame", func(t *testing.T) {
		report := completeE2EReport()
		report.Rounds[0].Artifacts = report.Rounds[0].Artifacts[:1]
		gaps := generationReportGaps(report)
		if !strings.Contains(strings.Join(gaps, "|"), "首帧") {
			t.Fatalf("Missing first frame must fail: %v", gaps)
		}
	})
	t.Run("failed task", func(t *testing.T) {
		report := completeE2EReport()
		report.Rounds[1].Tasks[0].Status = "failed"
		gaps := generationReportGaps(report)
		if !strings.Contains(strings.Join(gaps, "|"), "未成功") {
			t.Fatalf("The failed task must be judged as failed: %v", gaps)
		}
	})
	t.Run("media review missing", func(t *testing.T) {
		report := completeE2EReport()
		report.MediaReview.OK = false
		report.MediaReview.Reason = "protocol_unsupported"
		gaps := generationReportGaps(report)
		if !strings.Contains(strings.Join(gaps, "|"), "审片模型") {
			t.Fatalf("The film review model is not valid and must be judged as failure: %v", gaps)
		}
	})
	t.Run("pending task at exit", func(t *testing.T) {
		report := completeE2EReport()
		report.PendingTasks = append(report.PendingTasks, struct {
			ID                string `json:"id"`
			Type              string `json:"type"`
			Status            string `json:"status"`
			ProviderRequestID string `json:"providerRequestId"`
			PossiblyRunning   bool   `json:"possiblyRunning"`
		}{ID: "task-late", Status: "running", PossiblyRunning: true})
		gaps := generationReportGaps(report)
		if !strings.Contains(strings.Join(gaps, "|"), "可能仍在运行") {
			t.Fatalf("Tasks that are still running when exiting must be judged as failed: %v", gaps)
		}
	})
	t.Run("settle error", func(t *testing.T) {
		report := completeE2EReport()
		report.SettleError = "tasks_unavailable"
		gaps := generationReportGaps(report)
		if !strings.Contains(strings.Join(gaps, "|"), "收尾查询") {
			t.Fatalf("If the closing query fails, it must be judged as failure: %v", gaps)
		}
	})
}
