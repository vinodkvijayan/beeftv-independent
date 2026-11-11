package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/beeftv"
	"infinite-canvas/backend/internal/buildinfo"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/referencestorage"
	"infinite-canvas/backend/internal/repository"
)

const (
	ContentModerationErrorCode      = "sensitive_words_detected"
	ContentModerationRetryMessage   = "The content has not passed the security review. Please modify the prompt word or reference picture and regenerate it; the original task cannot be retried directly."
	SubmissionUncertainRetryMessage = "The submission result has not been confirmed yet. Please check the original task first and do not resubmit immediately."
	DownloadFailureRetryMessage     = "The download of the generated results failed. Please reload or query the original task first. Do not resubmit immediately."
	taskStageRequestNotSent         = "The request has not been submitted yet"
)

type AnalyticsKey struct{}

type AnalyticsContext = CallMeta

func TaskAnalyticsContext(task model.Task) AnalyticsContext {
	metadata := AnalyticsContext{
		UserID:            task.UserID,
		TaskID:            task.ID,
		ProjectID:         task.ProjectID,
		TaskType:          task.Type,
		TraceID:           task.TraceID,
		RequestID:         task.RequestID,
		Capability:        modelcatalog.CapabilityFromTaskType(task.Type),
		Operation:         task.Operation,
		Model:             task.Model,
		ProviderRequestID: task.ProviderRequestID,
	}
	var input struct {
		Mode   string `json:"mode"`
		Config Config `json:"config"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) == nil {
		metadata.ChannelID = firstNonEmpty(input.Config.ChannelID, modelcatalog.SystemChannelIDFromBaseURL(input.Config.BaseURL))
		metadata.Model = firstNonEmpty(input.Config.ChannelModelKey, input.Config.Model, metadata.Model)
		metadata.VideoSeconds, _ = strconv.Atoi(input.Config.VideoSeconds)
		if normalized := modelcatalog.NormalizeCapability(input.Mode); normalized != "" {
			metadata.Capability = normalized
		}
	}
	return metadata
}

func ResumedProviderRequestIDFromAnalytics(ctx context.Context) string {
	if id := ResumedProviderRequestID(ctx); id != "" {
		return id
	}
	metadata, _ := ctx.Value(AnalyticsKey{}).(AnalyticsContext)
	return strings.TrimSpace(metadata.ProviderRequestID)
}

func WithProviderRequestKind(ctx context.Context, requestKind string) context.Context {
	metadata, ok := ctx.Value(AnalyticsKey{}).(AnalyticsContext)
	if !ok {
		return WithRequestKind(ctx, requestKind)
	}
	metadata.RequestKind = requestKind
	ctx = context.WithValue(ctx, AnalyticsKey{}, metadata)
	return WithRequestKind(ctx, requestKind)
}

func CanonicalCallMeta(ctx context.Context) CallMeta {
	if runtime, ok := RuntimeFromContext(ctx); ok {
		if strings.TrimSpace(runtime.Call.UserID) != "" || strings.TrimSpace(runtime.Call.TaskID) != "" || strings.TrimSpace(runtime.Call.RequestKind) != "" || runtime.Call.ConcurrencyLimit != 0 {
			return runtime.Call
		}
	}
	metadata, _ := ctx.Value(AnalyticsKey{}).(AnalyticsContext)
	return metadata
}

func DefiniteMidjourneyCountRejection(err error) bool {
	var upstream HTTPError
	if !errors.As(err, &upstream) || upstream.StatusCode < 400 {
		return false
	}
	var body struct {
		TaskID string `json:"task_id"`
		ID     string `json:"id"`
		Error  struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			TaskID  string `json:"task_id"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(upstream.Body), &body) != nil || body.TaskID != "" || body.ID != "" || body.Error.TaskID != "" {
		return false
	}
	return body.Error.Code == "invalid_request" && strings.HasPrefix(strings.ToLower(strings.TrimSpace(body.Error.Message)), "midjourney generates four images per request; n must be 4 or omitted")
}

func ClassifyTaskFailure(err error) Failure {
	if err == nil {
		return ClassifyError(nil)
	}
	failure := ApplyAppFailureWrappers(err, ClassifyError(err))
	if failure.Category == CategoryInvalidParams && !failure.Uncertain && DefiniteMidjourneyCountRejection(err) {
		failure.Reason = "Midjourney requires one request to generate 4 images"
		failure.Action = "Please reselect the Midjourney model, use the fixed four settings and try again"
	}
	return failure
}

func ApplyAppFailureWrappers(err error, failure Failure) Failure {
	var imageRecovery ImageRecoveryError
	if errors.As(err, &imageRecovery) {
		failure.Category = CategorySubmissionUncertain
		failure.Uncertain = true
		failure.Reason = "Image result not confirmed yet, auto-recovery stopped"
		failure.Action = "Please keep task records and contact support to check the results. Do not submit again."
		var preparation ImagePreparationError
		if errors.As(err, &preparation) {
			failure.Reason = "The image submission record cannot be confirmed and automatic recovery has been stopped."
		}
		return failure
	}
	var preparation ImagePreparationError
	if errors.As(err, &preparation) {
		failure = ClassifyError(preparation.Cause)
		failure.Uncertain, failure.Retryable = false, false
		failure.Reason = preparation.Error()
		failure.Action = "Please keep the troubleshooting information and contact support to check local task records"
		return failure
	}
	var unknown SubmissionUnknownError
	if errors.As(err, &unknown) {
		failure.Category = CategorySubmissionUncertain
		failure.Uncertain, failure.Retryable = true, false
		failure.Reason, failure.Action = "", ""
		return failure
	}
	var download VideoDownloadError
	if errors.As(err, &download) {
		failure = WithDownloadFailure(failure, download.TaskID)
	}
	var pending StatePendingError
	if errors.As(err, &pending) {
		failure.Category = CategorySubmissionUncertain
		failure.Uncertain = true
		failure.TaskID = firstNonEmpty(failure.TaskID, pending.TaskID)
		failure.Reason = ""
		failure.Action = ""
	}
	var circuit CircuitOpenError
	if errors.As(err, &circuit) {
		return CircuitOpenFailure()
	}
	if code, _ := platform.ChannelSlotFailureDetails(err); code != "" {
		failure = WithConcurrencyFailure(failure)
	}
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr != nil {
		classified := ClassifyAppError(appErr.Status, appErr.Code, string(appErr.Reason), appErr.Message)
		if failure.Category == CategoryUnknown || classified.Category != CategoryUnknown {
			failure = classified
		}
	}
	return failure
}

func PersistableTaskFailureMessage(err error) string {
	return ClassifyTaskFailure(err).UserMessage()
}

func TaskFailureErrorCode(err error) string {
	return ClassifyTaskFailure(err).ErrorCode()
}

func PersistedFailureErrorCode(message string, stage string) string {
	if stage == taskStageRequestNotSent {
		return string(CategoryRequestNotSent)
	}
	failure := ClassifyText(message)
	if stage == "submission_unknown" {
		return string(CategorySubmissionUncertain)
	}
	return failure.ErrorCode()
}

func PersistedFailureBlocksRetry(message string, stage string) bool {
	if stage == taskStageRequestNotSent {
		return false
	}
	if stage == "submission_unknown" {
		return true
	}
	return ClassifyText(message).BlocksManualRetry()
}

func IsContentModerationFailure(value string) bool {
	if strings.Contains(strings.ToLower(value), ContentModerationErrorCode) {
		return true
	}
	return ClassifyTaskFailure(errors.New(value)).IsModeration()
}

var providerProgressKeys = []string{"progress", "progresspercent", "progresspercentage", "percent", "percentage", "completion", "completionpercent"}

var providerProgressContainers = []string{"data", "result", "task", "output", "operation", "response", "meta", "metadata"}

func SyncProviderTaskProgress(repo *repository.Repository, taskID string, responseBody []byte) {
	if repo == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	progress, ok := ProviderProgressFromResponse(responseBody)
	if !ok {
		return
	}
	if err := repo.UpdateTaskProviderProgress(taskID, progress); err != nil {
		log.Printf("provider progress sync failed: task_id=%s error=%v", taskID, err)
	}
}

func ProviderProgressFromResponse(responseBody []byte) (int, bool) {
	if len(responseBody) == 0 {
		return 0, false
	}
	var payload any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return 0, false
	}
	return findProviderProgress(payload, 0)
}

func findProviderProgress(value any, depth int) (int, bool) {
	if depth > 8 {
		return 0, false
	}
	switch current := value.(type) {
	case map[string]any:
		for _, wantedKey := range providerProgressKeys {
			for key, candidate := range current {
				if normalizeProviderProgressKey(key) != wantedKey {
					continue
				}
				if progress, ok := normalizeProviderProgressValue(candidate); ok {
					return progress, true
				}
			}
		}
		for _, wantedContainer := range providerProgressContainers {
			for key, nested := range current {
				if normalizeProviderProgressKey(key) != wantedContainer {
					continue
				}
				if progress, ok := findProviderProgress(nested, depth+1); ok {
					return progress, true
				}
			}
		}
	case []any:
		for _, nested := range current {
			if progress, ok := findProviderProgress(nested, depth+1); ok {
				return progress, true
			}
		}
	}
	return 0, false
}

func normalizeProviderProgressValue(value any) (int, bool) {
	var number float64
	explicitPercent := false
	switch current := value.(type) {
	case float64:
		number = current
	case string:
		text := strings.TrimSpace(current)
		if text == "" {
			return 0, false
		}
		explicitPercent = strings.HasSuffix(text, "%")
		text = strings.TrimSpace(strings.TrimSuffix(text, "%"))
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > 100 {
		return 0, false
	}
	if !explicitPercent && number > 0 && number < 1 {
		number *= 100
	}
	return int(math.Round(number)), true
}

func normalizeProviderProgressKey(value string) string {
	return strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(strings.ToLower(strings.TrimSpace(value)))
}

func WriteMediaPart(writer *multipart.Writer, field string, media Media) error {
	return writeMediaPart(writer, field, media)
}

func RecordProviderRequest(repo *repository.Repository, logCall func(model.ApiCallLog) error, req *http.Request, startedAt time.Time, statusCode int, responseBody []byte, requestErr error) {
	if req == nil || logCall == nil {
		return
	}
	call := CanonicalCallMeta(req.Context())
	status := model.ApiCallStatusSucceeded
	errorCode := ""
	errorText := ""
	if requestErr != nil || statusCode < 200 || statusCode >= 300 {
		status = model.ApiCallStatusFailed
		errorCode, errorText = ProviderRequestErrorDetails(requestErr)
	} else if businessCode, businessMessage, failed := ResponseBusinessFailure(responseBody); failed {
		status = model.ApiCallStatusFailed
		errorCode = businessCode
		errorText = businessMessage
	}
	requestKind := ProviderRequestKind(req.Method, req.URL.Path)
	if call.RequestKind != "" {
		requestKind = call.RequestKind
	}
	if status == model.ApiCallStatusSucceeded && (requestKind == "create" || requestKind == "poll") && (call.Capability == "image" || call.Capability == "video") {
		SyncProviderTaskProgress(repo, call.TaskID, responseBody)
	}
	if call.TaskID != "" && call.Capability == "video" && (requestKind == "create" || requestKind == "poll") && repo != nil {
		settlement := ExtractBeefTVVideoSettlementBytes(responseBody)
		if settlement.UsageState != nil || settlement.ReconcileDeadline != nil {
			_ = repo.UpdateTaskBeefVideoSettlement(call.TaskID, settlement.UsageState, settlement.ReconcileDeadline)
		}
	}
	apiFormat := "openai"
	if req.Header.Get("x-goog-api-key") != "" {
		apiFormat = "gemini"
	}
	callLog := model.ApiCallLog{
		UserID: call.UserID, TraceID: call.TraceID, RequestID: call.RequestID, ChannelID: call.ChannelID, TaskID: call.TaskID,
		Source: "backend-task", Capability: call.Capability, Operation: call.Operation,
		RequestKind: requestKind,
		APIFormat:   apiFormat, Method: req.Method, Path: req.URL.Path, Model: call.Model,
		Status: status, StatusCode: statusCode, DurationMs: time.Since(startedAt).Milliseconds(),
		ErrorCode: errorCode, Error: errorText, ConcurrencyLimit: call.ConcurrencyLimit, UpstreamURL: req.URL.Scheme + "://" + req.URL.Host + req.URL.Path,
		ProviderRequestID: call.ProviderRequestID, RequestContentType: req.Header.Get("Content-Type"), RequestBody: platform.RequestPayloadForLog(req), ResponseBody: platform.SanitizeAPICallPayload(responseBody, ""),
	}
	if code, message := platform.ChannelSlotFailureDetails(requestErr); code != "" {
		callLog.ErrorCode = code
		callLog.Error = message
	}
	if requestKind == "create" && call.Capability == "video" {
		callLog.VideoSeconds = call.VideoSeconds
		if callLog.VideoSeconds <= 0 {
			if strings.Contains(strings.ToLower(call.Model), "seedance") || strings.Contains(req.URL.Path, "/contents/generations/tasks") {
				callLog.VideoSeconds = 5
			} else {
				callLog.VideoSeconds = 6
			}
		}
	}
	EnrichAPICallLog(&callLog, responseBody)
	if call.Capability == "video" && requestKind != "create" && strings.TrimSpace(call.ProviderRequestID) != "" {
		callLog.ProviderRequestID = call.ProviderRequestID
	}
	_ = logCall(callLog)
}

func ProviderRequestErrorDetails(err error) (string, string) {
	if err == nil {
		return "", ""
	}
	if errors.Is(err, context.Canceled) {
		return "request_cancelled", "The task is canceled and the upstream request is interrupted."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "upstream_timeout", "Timeout waiting for upstream response"
	}
	return "", SafeProviderLogError(err)
}

func SafeProviderLogError(err error) string {
	var httpErr HTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("Upstream HTTP %d", httpErr.StatusCode)
	}
	return truncateRunes(err.Error(), 500)
}

func ProviderRequestKind(method string, path string) string {
	if method == http.MethodGet {
		if strings.HasSuffix(strings.TrimRight(path, "/"), "/content") || strings.Contains(path, "/download") {
			return "download"
		}
		return "poll"
	}
	if strings.Contains(path, "repair") {
		return "repair"
	}
	return "create"
}

func EnsureChatCompletionStreamUsageRequest(data []byte) ([]byte, error) {
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	stream, _ := payload["stream"].(bool)
	if !stream {
		return data, nil
	}
	if err := ensureChatCompletionStreamUsage(payload); err != nil {
		return nil, err
	}
	return json.Marshal(payload)
}

func PrepareBeefTVSeedanceReferencesForUser(ctx context.Context, userID string, input *Input, openResource func(userID, resourceID string) (*model.Resource, io.ReadCloser, error)) error {
	if input == nil || input.Mode != "video" || !IsBeefTVSeedancePreuploadConfig(ctx, input.Config) {
		return nil
	}
	return PrepareBeefTVVideoReferences(ctx, input.Config, input, func(kind string, media Media) ([]byte, string, bool, error) {
		return ReadBeefTVSeedanceMedia(userID, kind, media, openResource)
	})
}

func ReadBeefTVSeedanceMedia(userID string, kind string, media Media, openResource func(userID, resourceID string) (*model.Resource, io.ReadCloser, error)) ([]byte, string, bool, error) {
	if SkipBeefTVSeedanceMedia(media) {
		return nil, "", true, nil
	}
	if raw := firstNonEmpty(media.DataURL, media.URL); strings.HasPrefix(strings.TrimSpace(raw), "data:") {
		mimeType, data, err := DecodeProviderDataURL(raw)
		if err != nil {
			return nil, "", false, err
		}
		return data, firstNonEmpty(media.MimeType, mimeType), false, nil
	}
	if !strings.HasPrefix(media.StorageKey, "resource:") {
		return nil, "", true, nil
	}
	if media.Bytes > 0 {
		if err := ValidateBeefTVSeedanceMediaSize(kind, media.Bytes); err != nil {
			return nil, "", false, err
		}
	}
	resourceID := strings.TrimPrefix(media.StorageKey, "resource:")
	resource, body, err := openResource(userID, resourceID)
	if err != nil {
		return nil, "", false, fmt.Errorf("Failed to read task reference resources: %w", err)
	}
	defer body.Close()
	limit := BeefTVSeedanceKindMaxBytes(kind)
	data, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, "", false, fmt.Errorf("Failed to read task reference resources: %w", err)
	}
	return data, firstNonEmpty(media.MimeType, resource.MimeType), false, nil
}

type localReferenceStoragePort struct {
	localMode    func() bool
	dataDir      string
	openResource func(userID, resourceID string) (*model.Resource, io.ReadCloser, error)
}

func NewReferenceStoragePort(localMode func() bool, dataDir string, openResource func(userID, resourceID string) (*model.Resource, io.ReadCloser, error)) ReferenceStoragePort {
	return localReferenceStoragePort{localMode: localMode, dataDir: dataDir, openResource: openResource}
}

func (p localReferenceStoragePort) Enabled() (bool, error) {
	if p.localMode == nil || !p.localMode() {
		return false, nil
	}
	config, err := referencestorage.Load(p.dataDir)
	return config.Enabled, err
}

func (p localReferenceStoragePort) Upload(ctx context.Context, userID, resourceID string) (string, error) {
	if p.localMode == nil || !p.localMode() {
		return "", errors.New("Local material upload is not enabled in the current workspace")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	config, err := referencestorage.Load(p.dataDir)
	if err != nil {
		return "", errors.New("The reference material object storage configuration cannot be read.")
	}
	_, body, err := p.openResource(userID, resourceID)
	if err != nil {
		return "", errors.New("The reference material cannot be read, please check whether the material is still in the current workspace")
	}
	defer body.Close()
	temp := filepath.Join(p.dataDir, "cache", "tmp")
	if err := os.MkdirAll(temp, 0700); err != nil {
		return "", errors.New("Unable to prepare reference material, please check local disk")
	}
	file, err := os.CreateTemp(temp, "reference-generation-*")
	if err != nil {
		return "", errors.New("Unable to prepare reference material, please check local disk")
	}
	defer os.Remove(file.Name())
	_, copyErr := io.Copy(file, body)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return "", errors.New("Unable to save temporary reference material, please check local disk")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return referencestorage.Upload(ctx, config, file.Name(), ReferenceUploadObserver(ctx, "Reference material"))
}

type taskRequestEvidenceKey struct{}

type RequestEvidenceRecorder struct {
	mu          sync.Mutex
	diagnostics model.TaskFailureDiagnostics
}

func WithTaskRequestEvidence(ctx context.Context, previous ...*model.TaskFailureDiagnostics) (context.Context, *RequestEvidenceRecorder) {
	r := &RequestEvidenceRecorder{diagnostics: model.TaskFailureDiagnostics{Source: "unknown", Version: buildinfo.Current().Version, Platform: runtime.GOOS + "/" + runtime.GOARCH}}
	if len(previous) > 0 && previous[0] != nil {
		prior := SanitizeTaskDiagnostics(previous[0])
		r.diagnostics.Requests, r.diagnostics.OmittedRequests, r.diagnostics.Input = prior.Requests, prior.OmittedRequests, prior.Input
	}
	return context.WithValue(ctx, taskRequestEvidenceKey{}, r), r
}

func TaskRequestRecorder(ctx context.Context) *RequestEvidenceRecorder {
	r, _ := ctx.Value(taskRequestEvidenceKey{}).(*RequestEvidenceRecorder)
	return r
}

func (r *RequestEvidenceRecorder) Snapshot(completed bool) *model.TaskFailureDiagnostics {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.diagnostics.ExecutionResult = "failed"
	if completed {
		r.diagnostics.ExecutionResult = "completed"
	}
	return SanitizeTaskDiagnostics(&r.diagnostics)
}

func RecordTaskDiagnosticInput(ctx context.Context, input Input) {
	r := TaskRequestRecorder(ctx)
	if r == nil {
		return
	}
	quality := input.Config.Quality
	if input.Mode == "video" {
		quality = firstNonEmpty(input.Config.Quality, input.Config.VQuality)
	}
	d := &model.TaskDiagnosticInput{Protocol: input.Config.InterfaceType, Model: input.Config.Model, Size: input.Config.Size, Quality: quality, Count: input.Config.Count,
		PromptChars: utf8.RuneCountInString(input.Prompt), ImageCount: len(input.ReferenceImages), VideoCount: len(input.ReferenceVideos), AudioCount: len(input.ReferenceAudios)}
	for i, media := range input.ReferenceImages {
		if i == 16 {
			break
		}
		d.Images = append(d.Images, model.TaskDiagnosticMedia{Bytes: media.Bytes, Width: media.Width, Height: media.Height})
	}
	if input.ImageCapability != nil {
		d.ImageLimitsRecorded = true
		d.MaxImages, d.MaxImageBytes = input.ImageCapability.References.MaxImages, input.ImageCapability.References.MaxImageBytes
	}
	r.mu.Lock()
	r.diagnostics.Input = d
	r.mu.Unlock()
}

func RecordTaskRequestEvidence(req *http.Request, evidence model.TaskRequestEvidence, body []byte, err error) {
	r := TaskRequestRecorder(req.Context())
	if r == nil {
		return
	}
	evidence.Method = req.Method
	evidence.Operation = "other"
	switch {
	case strings.HasSuffix(req.URL.Path, "/images/edits"):
		evidence.Operation = "image_edit"
	case strings.HasSuffix(req.URL.Path, "/images/generations"):
		evidence.Operation = "image_generate"
	case req.Method == http.MethodGet:
		evidence.Operation = "query_or_download"
	case req.Method == http.MethodPost:
		evidence.Operation = "submit"
	}
	evidence.RequestBytes = req.ContentLength
	reference, isReference := ReferenceUploadFromContext(req.Context())
	if isReference {
		evidence.Operation = "reference_" + reference.Stage
		evidence.Attempt = reference.Attempt
		evidence.Summary = reference.Label()
	}
	responseLimited := evidence.Outcome == "response_limit"
	evidence.Outcome = "response_received"
	if err != nil {
		evidence.Outcome = "transport_error"
		if evidence.HTTPStatus >= 400 {
			evidence.Outcome = "http_error"
		}
		if errors.Is(err, context.Canceled) {
			evidence.Outcome = "cancelled"
		}
		if errors.Is(err, context.DeadlineExceeded) {
			evidence.Outcome = "timeout"
		}
		if !evidence.Dispatched && !errors.Is(err, context.Canceled) {
			evidence.Outcome = "not_dispatched"
		}
		failure := ClassifyTaskFailure(err)
		evidence.Summary = firstNonEmpty(failure.ProviderMessage, err.Error())
		evidence.ProviderCode = failure.ProviderCode
		evidence.RequestID = firstNonEmpty(failure.RequestID, evidence.RequestID)
	} else if _, _, failed := ResponseBusinessFailure(body); failed {
		evidence.Outcome = "business_error"
		failure := ClassifyText(string(body))
		evidence.ProviderCode, evidence.Summary = failure.ProviderCode, firstNonEmpty(failure.ProviderMessage, failure.UserMessage())
		evidence.RequestID = firstNonEmpty(failure.RequestID, evidence.RequestID)
	}
	if started, parseErr := time.Parse(time.RFC3339Nano, evidence.StartedAt); parseErr == nil {
		evidence.DurationMS = time.Since(started).Milliseconds()
	}
	if responseLimited {
		evidence.Outcome = "response_limit"
	}
	if isReference && err != nil {
		var upload *ReferenceUploadError
		if errors.As(err, &upload) {
			evidence.ProviderCode, evidence.RequestID = upload.Code, upload.RequestID
			evidence.Summary = upload.Error()
		} else {
			evidence.Summary = reference.Label() + "：" + DiagnosticSummary(err.Error())
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.diagnostics.Requests) == 8 {
		r.diagnostics.Requests = append(r.diagnostics.Requests[:1], r.diagnostics.Requests[2:]...)
		r.diagnostics.OmittedRequests++
	}
	r.diagnostics.Requests = append(r.diagnostics.Requests, evidence)
}

func CaptureTaskFailureDiagnostics(task *model.Task, err error, source string) {
	if err == nil {
		return
	}
	failure := ClassifyTaskFailure(err)
	d := &model.TaskFailureDiagnostics{Source: source, Summary: firstNonEmpty(failure.ProviderMessage, err.Error()),
		RequestID: failure.RequestID, ProviderTaskID: failure.TaskID, Param: failure.Param,
		Stage: task.Stage, CapturedAt: time.Now().Format(time.RFC3339Nano)}
	d.Version, d.Platform = buildinfo.Current().Version, runtime.GOOS+"/"+runtime.GOARCH
	if prior := task.FailureDiagnostics; prior != nil {
		d.Requests, d.OmittedRequests, d.Input, d.ExecutionResult = prior.Requests, prior.OmittedRequests, prior.Input, prior.ExecutionResult
	}
	if source == "local_result" {
		d.Stage = "local result processing"
		if failure.Category == CategoryLocalDiskFull {
			d.Stage = "Save build results (insufficient disk space)"
		}
	}
	if len(d.Requests) > 0 && d.Requests[len(d.Requests)-1].Outcome == "response_limit" {
		last := d.Requests[len(d.Requests)-1]
		d.Source, d.Stage, d.RequestID, d.HTTPStatus = "local_response", "Local response size verification", last.RequestID, last.HTTPStatus
	}
	var httpErr HTTPError
	var managedHTTP *beeftv.MediaHTTPError
	var managedTask *beeftv.MediaTaskError
	var payload PayloadError
	var appErr *kernel.AppError
	var upload *ReferenceUploadError
	var dns *outbound.DNSResolutionError
	var download VideoDownloadError
	switch {
	case errors.As(err, &upload):
		d.Source, d.Stage, d.Summary = "reference_upload", upload.Meta.Label(), upload.Error()
		d.FailedOperation, d.TransportPhase = "reference_"+upload.Meta.Stage, upload.TransportPhase
		d.HTTPStatus, d.ProviderCode, d.RequestID = upload.HTTPStatus, upload.Code, upload.RequestID
	case errors.As(err, &dns):
		d.Source, d.TransportPhase = "local_network", "dns"
		d.Stage = "Parse model service domain name"
		if errors.As(err, &download) || task.Stage == "Retrieving generated results" {
			d.Stage = "Retrieve generated results (DNS resolution)"
		} else if task.ProviderRequestID != "" {
			d.Stage = "Query the original task (DNS resolution)"
		}
	case errors.As(err, &httpErr):
		d.Source, d.HTTPStatus, d.ProviderCode = "upstream_http", httpErr.StatusCode, failure.ProviderCode
		d.RequestID = firstNonEmpty(failure.RequestID, httpErr.RequestID)
		var recoveryErr ImageRecoveryError
		if errors.As(err, &recoveryErr) {
			upstream := ClassifyHTTP(httpErr.StatusCode, "", httpErr.Body)
			d.Summary = firstNonEmpty(upstream.ProviderMessage, upstream.UserMessage())
		}
	case errors.As(err, &managedHTTP):
		d.Source, d.HTTPStatus, d.ProviderCode = "upstream_http", managedHTTP.StatusCode, failure.ProviderCode
		d.RequestID = firstNonEmpty(failure.RequestID, managedHTTP.RequestID)
	case errors.As(err, &managedTask):
		d.Source, d.ProviderCode = "upstream_response", failure.ProviderCode
		if len(d.Requests) > 0 {
			last := d.Requests[len(d.Requests)-1]
			d.RequestID, d.HTTPStatus = firstNonEmpty(d.RequestID, last.RequestID), last.HTTPStatus
		}
	case errors.As(err, &payload):
		d.Source, d.ProviderCode = "upstream_response", failure.ProviderCode
		if failure.Category == CategoryInputInaccessible {
			d.Stage = "Read reference material upstream"
		} else if task.ProviderRequestID != "" {
			d.Stage = "Upstream task processing"
		}
		if len(d.Requests) > 0 {
			last := d.Requests[len(d.Requests)-1]
			d.RequestID, d.HTTPStatus = firstNonEmpty(d.RequestID, last.RequestID), last.HTTPStatus
		}
	case errors.As(err, &appErr) && appErr.Status == 400 && source != "local_result":
		d.Source, d.Summary = "local_validation", appErr.Message
	}
	task.FailureDiagnostics = SanitizeTaskDiagnostics(d)
}

func EnsureFailedProviderAttemptLogged(repo *repository.Repository, task model.Task, taskErr error, decryptInput func(string) (string, error), userFacingMessage func(error) string, logCall func(model.ApiCallLog) error) {
	if repo == nil || strings.TrimSpace(task.ID) == "" || taskErr == nil {
		return
	}
	hasLog, err := repo.HasAPICallLogForTask(task.ID)
	if err != nil {
		log.Printf("provider attempt log lookup failed: task_id=%s error=%v", task.ID, err)
		return
	}
	if hasLog {
		return
	}
	decodedTask := task
	if decryptInput != nil {
		if decrypted, decryptErr := decryptInput(task.InputJSON); decryptErr == nil {
			decodedTask.InputJSON = decrypted
		}
	}
	metadata := TaskAnalyticsContext(decodedTask)
	now := time.Now()
	startedAt := now
	if task.StartedAt != nil && !task.StartedAt.IsZero() {
		startedAt = *task.StartedAt
	}
	path := "/task/provider-preflight"
	errorCode := "request_not_sent"
	statusCode := 0
	var httpErr HTTPError
	if errors.As(taskErr, &httpErr) {
		path = "/task/provider-request"
		errorCode = "provider_request_unlogged"
		statusCode = httpErr.StatusCode
	} else if strings.TrimSpace(metadata.ProviderRequestID) != "" {
		path = "/task/provider-state"
		errorCode = "provider_state_unlogged"
	}
	errMsg := ""
	if userFacingMessage != nil {
		errMsg = truncateRunes(userFacingMessage(taskErr), 2_000)
	}
	callLog := model.ApiCallLog{
		UserID:            metadata.UserID,
		TraceID:           metadata.TraceID,
		RequestID:         metadata.RequestID,
		ChannelID:         metadata.ChannelID,
		TaskID:            metadata.TaskID,
		Source:            "backend-task",
		Capability:        metadata.Capability,
		Operation:         metadata.Operation,
		RequestKind:       "create",
		APIFormat:         "internal",
		Method:            "INTERNAL",
		Path:              path,
		Model:             metadata.Model,
		Status:            model.ApiCallStatusFailed,
		StatusCode:        statusCode,
		DurationMs:        now.Sub(startedAt).Milliseconds(),
		ProviderRequestID: metadata.ProviderRequestID,
		ErrorCode:         errorCode,
		Error:             errMsg,
		StartedAt:         startedAt,
		CreatedAt:         now,
	}
	if logCall != nil {
		if err := logCall(callLog); err != nil {
			log.Printf("provider attempt log write failed: task_id=%s error=%v", task.ID, err)
		}
	}
}
