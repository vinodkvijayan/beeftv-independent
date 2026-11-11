package app

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestTaskFailureDiagnosticsPreserveLocalConstraint(t *testing.T) {
	task := &model.Task{ID: "task-local", Stage: "Calibration reference picture"}
	captureTaskFailureDiagnostics(task, BadAuthRequest("The current image model supports up to 2 reference images."), "unknown")
	d := taskSummaryForOutput(*task).FailureDiagnostics
	if d == nil || d.Source != "local_validation" || d.Summary != "The current image model supports up to 2 reference images." || d.ProviderCode != "" || d.CapturedAt == "" {
		t.Fatalf("diagnostics = %+v", d)
	}
}

func TestTaskFailureDiagnosticsDiskFullStage(t *testing.T) {
	task := &model.Task{ID: "task_12345678", Stage: "Processing"}
	captureTaskFailureDiagnostics(task, errors.New("Failed to write generated content to resource storage: write local resource: no space left on device"), "local_result")
	d := task.FailureDiagnostics
	if d == nil || d.Source != "local_result" || d.Stage != "Save build results (insufficient disk space)" || !strings.Contains(d.Summary, "no space left on device") {
		t.Fatalf("lost storage stage: %#v", d)
	}
}

func TestTaskFailureDiagnosticsPreserveHTTPHeaderAndRedact(t *testing.T) {
	task := &model.Task{ID: "task-http", Stage: "Generating"}
	err := providerHTTPError{StatusCode: 400, RequestID: "req-header-123", Body: `{"error":{"code":"invalid_size","param":"size","message":"size must be 1024x1024; Authorization: Bearer PRIVATE credential"}}`}
	captureTaskFailureDiagnostics(task, err, "unknown")
	d := taskForOutput(*task).FailureDiagnostics
	if d.Source != "upstream_http" || d.HTTPStatus != 400 || d.RequestID != "req-header-123" || d.ProviderCode != "invalid_size" || d.Param != "size" || !strings.Contains(d.Summary, "1024x1024") || strings.Contains(d.Summary, "PRIVATE") {
		t.Fatalf("diagnostics = %+v", d)
	}
	if taskSummaryForOutput(*task).FailureDiagnostics.Summary != d.Summary {
		t.Fatal("detail and summary disagree")
	}
}

func TestTaskTerminalPersistsDiagnosticBeforeReplacingError(t *testing.T) {
	task := &model.Task{ID: "task-terminal", Status: model.TaskStatusRunning, Stage: "Material download"}
	repo := &taskTerminalRepositoryStub{task: task}
	c := newTaskTerminalCoordinatorForTest(repo, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
	err := errors.New("cannot save /Users/private-name/image.png")
	if got := c.HandleExecutionFailure(task, err, true, false); !errors.Is(got, err) {
		t.Fatal(got)
	}
	if task.FailureDiagnostics == nil || task.FailureDiagnostics.Source != "local_result" || strings.Contains(task.FailureDiagnostics.Summary, "private-name") {
		t.Fatalf("diagnostics = %+v", task.FailureDiagnostics)
	}
}
