package generation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type referenceUploadContextKey struct{}

// ReferenceUploadMeta identifies a local preparation call without retaining a
// resource id, filename, payload or signed storage URL.
type ReferenceUploadMeta struct {
	Kind    string
	Index   int
	Stage   string
	Attempt int
}

func ReferenceUploadFromContext(ctx context.Context) (ReferenceUploadMeta, bool) {
	meta, ok := ctx.Value(referenceUploadContextKey{}).(ReferenceUploadMeta)
	return meta, ok
}

func (m ReferenceUploadMeta) Label() string {
	name := map[string]string{"image": "Reference picture", "video": "Reference video", "audio": "Reference audio"}[m.Kind]
	if name == "" {
		name = "Reference material"
	}
	if m.Index > 0 {
		name += fmt.Sprintf(" %d", m.Index)
	}
	stage := map[string]string{"create": "Apply to upload", "put": "Upload files", "resume": "Resume upload", "complete": "Confirm upload", "abort": "Cancel upload"}[m.Stage]
	label := strings.TrimSpace(name + " " + stage)
	if m.Attempt > 0 {
		label += fmt.Sprintf("(%d time)", m.Attempt)
	}
	return label
}

func withReferenceUpload(ctx context.Context, meta ReferenceUploadMeta) context.Context {
	return context.WithValue(ctx, referenceUploadContextKey{}, meta)
}

func referenceUploadStage(ctx context.Context, stage string) context.Context {
	meta, _ := ReferenceUploadFromContext(ctx)
	meta.Stage = stage
	return withReferenceUpload(WithRequestKind(ctx, "reference_"+stage), meta)
}

func referenceUploadAttempt(ctx context.Context, attempt int) context.Context {
	meta, _ := ReferenceUploadFromContext(ctx)
	meta.Attempt = attempt
	return withReferenceUpload(ctx, meta)
}

// ReferenceUploadError proves that preparation failed before model dispatch.
// Cause stays available in process; Error exposes only scrubbed diagnostic text.
type ReferenceUploadError struct {
	Meta           ReferenceUploadMeta
	HTTPStatus     int
	Code           string
	RequestID      string
	Detail         string
	Cause          error
	Dispatched     bool
	TransportPhase string
}

func (e *ReferenceUploadError) Error() string {
	return e.Meta.Label() + "Failure:" + DiagnosticSummary(e.Detail)
}
func (e *ReferenceUploadError) Unwrap() error { return e.Cause }
func (e *ReferenceUploadError) Is(target error) bool {
	return e.Meta.Stage == "put" && target == errBeefTVSeedanceUploadUnavailable
}

func referenceUploadError(ctx context.Context, cause error) *ReferenceUploadError {
	var upload *ReferenceUploadError
	if errors.As(cause, &upload) {
		return upload
	}
	meta, _ := ReferenceUploadFromContext(ctx)
	upload = &ReferenceUploadError{Meta: meta, Cause: cause, Detail: cause.Error()}
	var httpErr HTTPError
	if errors.As(cause, &httpErr) {
		upload.HTTPStatus, upload.RequestID = httpErr.StatusCode, sanitizeDebugID(httpErr.RequestID)
		fields := extractProviderFields(httpErr.Body)
		upload.Code = sanitizeProviderCode(fields.Code)
		upload.RequestID = firstNonEmpty(upload.RequestID, sanitizeDebugID(fields.RequestID))
		upload.Detail = firstNonEmpty(fields.Message, http.StatusText(httpErr.StatusCode))
	}
	upload.Detail = DiagnosticSummary(upload.Detail)
	return upload
}

func referenceUploadAddressError(ctx context.Context, cause error) *ReferenceUploadError {
	upload := referenceUploadError(referenceUploadStage(ctx, "put"), cause)
	upload.Code = "upload_address_invalid"
	// These are local DNS validation results, never upstream-provided messages.
	if strings.Contains(cause.Error(), "External service domain name resolution failed") || strings.Contains(cause.Error(), "There is no available address for the external service domain name") {
		upload.Code = "upload_transport_error"
	}
	return upload
}
