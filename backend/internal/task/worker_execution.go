package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	localasset "infinite-canvas/backend/internal/asset"
	cw "infinite-canvas/backend/internal/canvasworkflow"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/mediatools"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/taskruntime"
)

func CanvasMediaDemuxer(mime string) string {
	switch mime {
	case "image/png":
		return "png_pipe"
	case "image/jpeg":
		return "jpeg_pipe"
	case "image/webp":
		return "webp_pipe"
	case "video/mp4", "video/quicktime":
		return "mov"
	case "video/webm":
		return "matroska"
	}
	return ""
}

func ProcessCanvasMedia(
	ctx context.Context,
	repo *repository.Repository,
	resources *localasset.Service,
	openResource func(userID, resourceID string) (*model.Resource, io.ReadCloser, error),
	deliver func(model.Task) error,
	logFn func(userID, taskID, level, msg, payload string) error,
	logInfo func(userID, taskID, msg, extra string),
	task *model.Task,
) error {
	var input CanvasMediaInput
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || !cw.IsMediaOperation(input.Node.OperationID) {
		return FailTimelineTask(repo, logInfo, task, "Processing failed", "Invalid media processing parameter")
	}
	var clean func()
	var artifact *os.File
	defer func() {
		if artifact != nil {
			_ = artifact.Close()
		}
		if clean != nil {
			clean()
		}
	}()
	resource, err := resources.RecoverOwned(task.UserID, task.ID+":0", func() (localasset.RecoveredArtifact, error) {
		source, body, err := openResource(task.UserID, input.ResourceID)
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		defer body.Close()
		format := CanvasMediaDemuxer(source.MimeType)
		if format == "" {
			return localasset.RecoveredArtifact{}, fmt.Errorf("This material format does not currently support automatic processing")
		}
		params, ext, mime, err := cw.MediaCommand(input.Node, source.Width, source.Height)
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		bin, err := mediatools.ResolveFFmpeg()
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		dir, err := os.MkdirTemp("", "beeftv-media-")
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		clean = func() { _ = os.RemoveAll(dir) }
		sourcePath := filepath.Join(dir, "source")
		file, err := os.Create(sourcePath)
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		_, copyErr := io.Copy(file, body)
		closeErr := file.Close()
		if copyErr != nil {
			return localasset.RecoveredArtifact{}, copyErr
		}
		if closeErr != nil {
			return localasset.RecoveredArtifact{}, closeErr
		}
		output := filepath.Join(dir, "result"+ext)
		args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-f", format, "-i", sourcePath}
		args = append(args, params...)
		args = append(args, output)
		if err = UpdateTimelineTaskProgress(repo, task, "Local media processing", 20); err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		cmd := exec.CommandContext(ctx, bin, args...)
		mediatools.HideConsole(cmd)
		if err = cmd.Run(); err != nil {
			return localasset.RecoveredArtifact{}, fmt.Errorf("Media processing failed, please check source file, crop range or audio track: %w", err)
		}
		artifact, err = os.Open(output)
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		var facts mediatools.MediaMetadata
		if input.Node.MediaType == "image" {
			config, _, decodeErr := image.DecodeConfig(artifact)
			if decodeErr != nil {
				return localasset.RecoveredArtifact{}, fmt.Errorf("The output image is invalid")
			}
			facts.Width, facts.Height = config.Width, config.Height
			if _, err = artifact.Seek(0, io.SeekStart); err != nil {
				return localasset.RecoveredArtifact{}, err
			}
		} else {
			facts, err = mediatools.ProbeLocal(ctx, output)
			if err != nil {
				return localasset.RecoveredArtifact{}, err
			}
			if input.Node.MediaType == "video" && !facts.HasVideo || input.Node.MediaType == "audio" && !facts.HasAudio {
				return localasset.RecoveredArtifact{}, fmt.Errorf("Processing result is missing required media track")
			}
		}
		info, err := artifact.Stat()
		if err != nil {
			return localasset.RecoveredArtifact{}, err
		}
		return localasset.RecoveredArtifact{Kind: input.Node.MediaType, FileName: "canvas-process" + ext, MimeType: mime, Size: info.Size(), Width: facts.Width, Height: facts.Height, DurationMs: facts.DurationMs, Body: artifact}, nil
	})
	if err != nil {
		return FailTimelineTask(repo, logInfo, task, "Processing failed", err.Error())
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	value := map[string]any{"resourceId": resource.ID, "mimeType": resource.MimeType, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs}
	payload, err := json.Marshal(map[string]any{input.Node.MediaType: value, "resourceId": resource.ID})
	if err != nil {
		return err
	}
	task.Status = model.TaskStatusSucceeded
	task.Stage = "Processing completed"
	task.Progress = 100
	task.ResultJSON = string(payload)
	now := time.Now()
	task.CompletedAt = &now
	if err := repo.SaveTaskCompletion(task, model.TaskStatusRunning, nil); err != nil {
		return err
	}
	if deliver != nil {
		if err := deliver(*task); err != nil && logFn != nil {
			_ = logFn(task.UserID, task.ID, "error", "Media processed successfully but delivery pending recovery", err.Error())
		}
	}
	return nil
}

func CanRunProviderTask(task model.Task) bool {
	if !strings.HasPrefix(task.Type, "video_") || strings.TrimSpace(task.InputJSON) == "" {
		return false
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return false
	}
	return modelcatalog.HasExecutableVideoConfig(input)
}

func ProcessGenerationTask(
	ctx context.Context,
	task model.Task,
	startTrace func(context.Context, model.Task) (context.Context, func(string)),
	traceReason func(error) string,
	decryptInput func(string) (string, error),
	bindExecCtx func(context.Context, model.Task) (context.Context, func()),
	recoverImageSub func(context.Context, model.Task) (map[string]interface{}, bool, error),
	processCanvasGen func(ctx context.Context, userID, projectID, taskType, prompt, inputJSON string) (map[string]interface{}, error),
) (result map[string]interface{}, canvasOps []map[string]interface{}, err error) {
	ctx, finishTrace := startTrace(ctx, task)
	defer func() { finishTrace(traceReason(err)) }()
	if err := ValidateType(task.Type); err != nil {
		return nil, nil, err
	}
	decryptedInput, err := decryptInput(task.InputJSON)
	if err != nil {
		return nil, nil, err
	}
	task.InputJSON = decryptedInput
	ctx, cleanup := bindExecCtx(ctx, task)
	defer cleanup()
	if result, recovered, err := recoverImageSub(ctx, task); recovered {
		return result, nil, err
	}
	if task.Type == "canvas_text" || task.Type == "canvas_image" || task.Type == "canvas_video" || task.Type == "canvas_audio" {
		result, err := processCanvasGen(ctx, task.UserID, task.ProjectID, task.Type, task.Prompt, task.InputJSON)
		return result, nil, err
	}
	if strings.HasPrefix(task.Type, "video_") {
		if !CanRunProviderTask(task) {
			return nil, nil, errors.New("Video task is missing executable model configuration")
		}
		result, err := processCanvasGen(ctx, task.UserID, task.ProjectID, task.Type, task.Prompt, task.InputJSON)
		return result, nil, err
	}
	return nil, nil, errors.New("There is no execution branch available for task type")
}

type WorkerExecuteDeps struct {
	Repo                  *repository.Repository
	Terminal              *taskruntime.Terminal
	Log                   func(userID, taskID, level, msg, payload string) error
	RunTimeline           func(*model.Task, context.Context) error
	RunRender             func(*model.Task, context.Context) error
	RunDepth              func(*model.Task, context.Context) error
	RunCanvasMedia        func(*model.Task, context.Context) error
	BeginRouteAttempt     func(*model.Task) (*model.RouteAttempt, error)
	ExecuteRoute          func(context.Context, *model.Task, *model.RouteAttempt) (RouteExecutionResult, error)
	PersistGeneratedMedia func(model.Task, map[string]interface{}) (map[string]interface{}, error)
	FinalizeTurnaround    func(model.Task, map[string]interface{}) (bool, error)
	DecryptTaskInput      func(string) (string, error)
	ShouldDeferImage      func(model.Task, error, bool) bool
	DeferImage            func(model.Task) error
	ResolveProviderConfig func(generation.Config) (generation.Config, error)
	ImageTaskEnded        func(error) bool
	SaveTaskCompletion    func(*model.Task, []byte, []byte, bool) error
}

func ExecuteClaimedTask(deps WorkerExecuteDeps, session taskruntime.Session) taskruntime.Outcome {
	task := session.Task()
	ctx := session.Context()
	if RetiredAgentTask(task) {
		err := deps.Terminal.Refuse(task, "Function is offline", RetiredAgentBoundaryMessage)
		return taskruntime.Outcome{Kind: taskruntime.KindRejected, Err: err, Applied: err == nil}
	}
	terminal := deps.Terminal
	_ = deps.Log(task.UserID, task.ID, "info", "Backend tasks start processing", "")
	if latest, latestErr := deps.Repo.Task(task.ID); latestErr == nil && latest.Status == model.TaskStatusCancelled {
		err := terminal.HandleAlreadyCancelled(*latest)
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: err, Applied: true}
	}

	if task.Type == model.TaskTypeTimelineTranscription {
		return SpecialTaskOutcome(session, deps.RunTimeline)
	}
	if task.Type == model.TaskTypeTimelineRender {
		return SpecialTaskOutcome(session, deps.RunRender)
	}
	if task.Type == model.TaskTypeDepthCapture {
		return SpecialTaskOutcome(session, deps.RunDepth)
	}
	if task.Type == model.TaskTypeCanvasMediaTransform {
		return SpecialTaskOutcome(session, deps.RunCanvasMedia)
	}

	task.Stage = "Call the generated model"
	task.Progress = 35
	if TaskUsesUpstreamReportedProgress(task.Type) {
		task.Stage = "Connecting to upstream"
		task.Progress = 0
	}
	if err := deps.Repo.UpdateTaskProgressForLease(task.ID, task.LeaseOwner, task.Stage, task.Progress); err != nil {
		return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: fmt.Errorf("Failed to update task progress, the task has not yet called the upstream: %w", err)}
	}
	routeAttempt, err := deps.BeginRouteAttempt(task)
	if err != nil {
		uncertain := modelcatalog.IsDispatchUncertain(err)
		termErr := terminal.MarkPreparationFailure(task, "Route preparation failed", err, uncertain, "Route preparation failed, the upstream request was not sent")
		kind := taskruntime.KindFailed
		if uncertain {
			kind = taskruntime.KindUncertain
		}
		return taskruntime.Outcome{Kind: kind, Err: termErr, Applied: TerminalWriteApplied(termErr, err)}
	}
	routeResult, stateErr := deps.ExecuteRoute(ctx, task, routeAttempt)
	if stateErr != nil {
		kind := taskruntime.KindFailed
		if modelcatalog.IsDispatchUncertain(stateErr) {
			kind = taskruntime.KindUncertain
		}
		return taskruntime.Outcome{Kind: kind, Err: stateErr, ProviderAccepted: strings.TrimSpace(task.ProviderRequestID) != ""}
	}
	if session.Lost() {
		return LeaseLostOutcome(session, strings.TrimSpace(task.ProviderRequestID) != "")
	}
	result, canvasOps, err := routeResult.Result, routeResult.CanvasOps, routeResult.Err
	providerSucceeded := routeResult.ProviderSucceeded
	providerAccepted := providerSucceeded || strings.TrimSpace(task.ProviderRequestID) != ""
	if err == nil {
		result, err = deps.PersistGeneratedMedia(*task, result)
	}
	if err == nil {
		_, err = deps.FinalizeTurnaround(*task, result)
	}
	if err != nil {
		channelSlotFailedBeforeRequest := false
		if code, _ := platform.ChannelSlotFailureDetails(err); code != "" {
			channelSlotFailedBeforeRequest = true
		}
		if session.Lost() {
			_ = deps.Log(task.UserID, task.ID, "warn", "The task lease expires, waiting for other workers to resume", session.LostErr().Error())
			return LeaseLostOutcome(session, providerAccepted)
		}
		decryptedInput, decryptErr := deps.DecryptTaskInput(task.InputJSON)
		if deps.ShouldDeferImage(*task, err, providerSucceeded) {
			deferErr := deps.DeferImage(*task)
			return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Err: deferErr, Applied: deferErr == nil, ProviderAccepted: true}
		}
		if decryptErr == nil && ShouldDeferVideoProviderTask(*task, decryptedInput, err, deps.ResolveProviderConfig) {
			stage := "Still generating in the background"
			message := "The waiting at the front desk is over, the upstream video is still being generated, and the original task will continue to be checked."
			var downloadErr generation.VideoDownloadError
			if errors.As(err, &downloadErr) {
				stage = "Retrieving generated results"
				message = "The video has been generated. The download is temporarily interrupted. The original task results will continue to be retrieved."
			}
			var pendingErr generation.StatePendingError
			if errors.As(err, &pendingErr) {
				stage = "Wait for upstream task synchronization"
				message = "The status of the upstream task has not been synchronized yet, and the original task will continue to be checked."
			}
			if task.FailureDiagnostics != nil {
				task.FailureDiagnostics.ExecutionResult = "pending"
			}
			if deferErr := deps.Repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, stage, 15*time.Second, task.FailureDiagnostics); deferErr != nil {
				return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: deferErr, ProviderAccepted: true}
			}
			_ = deps.Log(task.UserID, task.ID, "info", message, task.PollStage)
			return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Applied: true, ProviderAccepted: true}
		}
		if NewAPIChannel2TaskSyncExpired(*task, err, time.Now()) {
			err = errors.New("The upstream task has not been synchronized for a long time and automatic query has stopped. Please confirm the channel task status and try again.")
		}
		var imageRecovery generation.ImageRecoveryError
		if errors.Is(err, context.DeadlineExceeded) && !errors.As(err, &imageRecovery) {
			err = errors.New(TaskTimeoutMessage(task.Type))
		}
		outcome := ExecutionFailureOutcome(terminal, task, err, providerSucceeded, providerAccepted, channelSlotFailedBeforeRequest, deps.ImageTaskEnded)
		if outcome.Applied && task.Type == "canvas_image" && !task.IsUpscale() && task.RecoveryOutcome != nil {
			failed := *task
			failed.LeaseOwner = ""
			_ = deps.Repo.FinishFailedImageRecovery(failed, task.RecoveryOutcome, nil)
		}
		return outcome
	}
	latest, err := deps.Repo.Task(task.ID)
	if err != nil {
		return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: err, ProviderAccepted: providerAccepted}
	}
	if latest.Status == model.TaskStatusCancelled {
		termErr := terminal.HandleCancelledResult(*latest)
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: termErr, Applied: true, ProviderAccepted: providerAccepted}
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return PersistenceFailureOutcome(terminal, task, fmt.Errorf("Serialization task result failed: %w", err), providerAccepted)
	}
	opsJSON, err := json.Marshal(canvasOps)
	if err != nil {
		return PersistenceFailureOutcome(terminal, task, fmt.Errorf("Serialize canvas operation failed: %w", err), providerAccepted)
	}
	if session.Lost() {
		return LeaseLostOutcome(session, true)
	}
	if err := deps.SaveTaskCompletion(task, resultJSON, opsJSON, len(canvasOps) > 0); err != nil {
		if deps.ShouldDeferImage(*task, err, true) {
			deferErr := deps.DeferImage(*task)
			return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Err: deferErr, Applied: deferErr == nil, ProviderAccepted: true}
		}
		return PersistenceFailureOutcome(terminal, task, err, true)
	}
	termErr := terminal.HandleSuccess(task)
	return taskruntime.Outcome{Kind: taskruntime.KindCompleted, Err: termErr, Applied: true, ProviderAccepted: true}
}

func SpecialTaskOutcome(session taskruntime.Session, run func(*model.Task, context.Context) error) taskruntime.Outcome {
	err := run(session.Task(), session.Context())
	if session.Lost() {
		return LeaseLostOutcome(session, false)
	}
	if err == nil {
		return taskruntime.Outcome{Kind: taskruntime.KindCompleted, Applied: true}
	}
	if errors.Is(err, context.Canceled) {
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: err}
	}
	return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: err}
}

func LeaseLostOutcome(session taskruntime.Session, providerAccepted bool) taskruntime.Outcome {
	err := session.LostErr()
	if err == nil {
		err = taskruntime.ErrLeaseLost
	}
	kind := taskruntime.KindLeaseLost
	if providerAccepted {
		kind = taskruntime.KindUncertain
	}
	return taskruntime.Outcome{
		Kind:             kind,
		Err:              fmt.Errorf("The task lease expires and stops saving upstream results: %w", err),
		ProviderAccepted: providerAccepted,
	}
}

func ExecutionFailureOutcome(terminal *taskruntime.Terminal, task *model.Task, err error, providerSucceeded, providerAccepted, channelSlotFailedBeforeRequest bool, imageEnded func(error) bool) taskruntime.Outcome {
	if task != nil && task.Type == "canvas_image" && !task.IsUpscale() && imageEnded != nil && imageEnded(err) {
		noResult := "no_result"
		task.RecoveryOutcome = &noResult
	}
	termErr := terminal.HandleExecutionFailure(task, err, providerSucceeded, channelSlotFailedBeforeRequest)
	if errors.Is(err, context.Canceled) && termErr == nil {
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Applied: true, ProviderAccepted: providerAccepted}
	}
	kind := taskruntime.KindFailed
	var imageRecovery generation.ImageRecoveryError
	var unknown generation.SubmissionUnknownError
	if errors.As(err, &imageRecovery) || errors.As(err, &unknown) {
		kind = taskruntime.KindUncertain
	}
	return taskruntime.Outcome{Kind: kind, Err: termErr, Applied: TerminalWriteApplied(termErr, err), ProviderAccepted: providerAccepted}
}

func PersistenceFailureOutcome(terminal *taskruntime.Terminal, task *model.Task, err error, providerAccepted bool) taskruntime.Outcome {
	handled, termErr := terminal.HandleResultPersistenceFailure(task, err)
	if handled {
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: termErr, Applied: termErr == nil, ProviderAccepted: providerAccepted}
	}
	return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: termErr, Applied: TerminalWriteApplied(termErr, err), ProviderAccepted: providerAccepted}
}

func TerminalWriteApplied(termErr, cause error) bool {
	if termErr == nil {
		return true
	}
	var joined interface{ Unwrap() []error }
	if errors.As(termErr, &joined) {
		return false
	}
	return cause != nil && errors.Is(termErr, cause)
}

func TaskUsesUpstreamReportedProgress(taskType string) bool {
	return taskType == "canvas_image" || taskType == "canvas_video" || strings.HasPrefix(taskType, "video_")
}

func TaskFailureMessage(err error) string {
	if err == nil {
		return generation.PersistableTaskFailureMessage(err)
	}
	return kernel.TruncateRunes(generation.PersistableTaskFailureMessage(err), 2_000)
}

func TaskExecutionTimeoutWithMinutes(taskType string, videoMin, imageMin, audioMin, textMin, defaultMin int) time.Duration {
	switch {
	case strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_"):
		return max(time.Duration(videoMin)*time.Minute, 5*time.Minute)
	case strings.HasPrefix(taskType, "canvas_image"):
		return time.Duration(imageMin) * time.Minute
	case strings.HasPrefix(taskType, "canvas_audio"):
		return time.Duration(audioMin) * time.Minute
	case strings.HasPrefix(taskType, "canvas_text"):
		return time.Duration(textMin) * time.Minute
	case taskType == model.TaskTypeTimelineTranscription:
		return 20 * time.Minute
	case taskType == model.TaskTypeTimelineRender:
		return 60 * time.Minute
	case taskType == model.TaskTypeDepthCapture:
		return 2 * time.Hour
	default:
		return time.Duration(defaultMin) * time.Minute
	}
}

func ShouldDeferVideoProviderTask(task model.Task, decryptedInput string, err error, resolveConfig func(generation.Config) (generation.Config, error)) bool {
	var input generation.Input
	if json.Unmarshal([]byte(decryptedInput), &input) != nil {
		return false
	}
	providerRequestID := strings.TrimSpace(task.ProviderRequestID)
	if providerRequestID == "" || (!strings.HasPrefix(task.Type, "canvas_video") && !strings.HasPrefix(task.Type, "video_") && input.Upscale == nil) {
		return false
	}
	deferSignal := errors.Is(err, context.DeadlineExceeded)
	var dns *outbound.DNSResolutionError
	if errors.As(err, &dns) {
		deferSignal, _ = generation.RetryableVideoPollError(context.Background(), err)
	}
	var downloadErr generation.VideoDownloadError
	if errors.As(err, &downloadErr) {
		deferSignal, _ = generation.RetryableVideoPollError(context.Background(), downloadErr.Cause)
	}
	if task.StartedAt != nil && time.Since(*task.StartedAt) >= 24*time.Hour {
		return false
	}
	var pendingErr generation.StatePendingError
	if errors.As(err, &pendingErr) {
		deferSignal = strings.TrimSpace(pendingErr.TaskID) == providerRequestID && !NewAPIChannel2TaskSyncExpired(task, err, time.Now())
	}
	if !deferSignal {
		return false
	}
	if input.Config.ChannelID == "" && generation.IsBeefTVVideoConfig(context.Background(), input.Config) {
		return true
	}
	resolved, resolveErr := resolveConfig(input.Config)
	return resolveErr == nil && (resolved.InterfaceType == string(model.ChannelInterfaceNewAPIChannel2) || generation.IsBeefTVVideoConfig(context.Background(), resolved))
}

func NewAPIChannel2TaskSyncExpired(task model.Task, err error, now time.Time) bool {
	var pendingErr generation.StatePendingError
	if !errors.As(err, &pendingErr) || strings.TrimSpace(pendingErr.TaskID) == "" || strings.TrimSpace(pendingErr.TaskID) != strings.TrimSpace(task.ProviderRequestID) {
		return false
	}
	if task.StartedAt == nil {
		return true
	}
	return !now.Before(task.StartedAt.Add(NewAPIChannel2TaskSyncMaxAge))
}

func TaskTimeoutMessage(taskType string) string {
	if strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_") {
		return "The video generation timeout has expired. Please check the task center later or try again."
	}
	if strings.HasPrefix(taskType, "canvas_image") {
		return "Image generation timeout, please try again later."
	}
	return "Task execution timed out, please try again later."
}
