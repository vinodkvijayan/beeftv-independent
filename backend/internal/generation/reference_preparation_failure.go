package generation

import "strings"

var referencePreparationCopies = map[string]struct{ reason, action string }{
	"image_reference_upload_failed": {"The reference image upload failed and the generation has not started yet.", "Please try again later"},
	"reference_media_upload_failed": {"The reference material upload failed and the generation has not started yet.", "Please check the object storage configuration and public read permissions and try again"},
	"reference_preupload_failed":    {"The reference material upload failed and the generation has not started yet.", "Please check the network or try again later"},
}

// Only the complete application-owned copy restores pre-submission evidence.
// A provider's upload error or a bare machine code does not prove it was unsent.
func persistedReferencePreparationFailure(raw string) (Failure, bool) {
	text := strings.TrimSpace(raw)
	requestID, taskID := persistedReferenceIDs(text)
	for code, copy := range referencePreparationCopies {
		failure := Failure{Category: CategoryProviderUnavailable, ProviderCode: code,
			Reason: copy.reason, Action: copy.action, RequestID: requestID, TaskID: taskID, FromCode: true}
		message := failure.UserMessage()
		if text == message || text == strings.TrimSuffix(message, "。") {
			return failure, true
		}
	}
	return Failure{}, false
}

// Manual retry is a deliberate new submission; preparation failures never
// authorize the automatic submission loop to send the same request again.
func (f Failure) BlocksManualRetry() bool {
	copy, ok := referencePreparationCopies[f.ProviderCode]
	if ok && !f.Uncertain && f.Category == CategoryProviderUnavailable && f.Reason == copy.reason && f.Action == copy.action {
		return false
	}
	return f.BlocksAutomaticRetry()
}
