package generation

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/beeftv"
	"infinite-canvas/backend/internal/outbound"
)

// FailureCategory 是生成失败的稳定机器可读类目。HTTP 状态只作兜底，不能单独当原因。
type FailureCategory string

const (
	CategoryAuth                FailureCategory = "auth"
	CategoryPermission          FailureCategory = "permission"
	CategoryQuotaUser           FailureCategory = "quota_user"
	CategoryQuotaUpstream       FailureCategory = "quota_upstream"
	CategoryQuotaUnknown        FailureCategory = "quota_unknown"
	CategoryQuotaLimit          FailureCategory = "quota_limit"
	CategoryModerationInput     FailureCategory = "moderation_input"
	CategoryModerationReference FailureCategory = "moderation_reference"
	CategoryModerationOutput    FailureCategory = "moderation_output"
	CategoryInvalidParams       FailureCategory = "invalid_params"
	CategoryLocalStorage        FailureCategory = "local_storage"
	CategoryLocalDiskFull       FailureCategory = "local_disk_full"
	CategoryLocalCredential     FailureCategory = "local_credential"
	CategoryContextTooLong      FailureCategory = "context_too_long"
	CategoryInputInaccessible   FailureCategory = "input_inaccessible"
	CategoryInputTooLarge       FailureCategory = "input_too_large"
	CategoryModelMissing        FailureCategory = "model_missing"
	CategoryThrottled           FailureCategory = "throttled"
	CategoryConcurrency         FailureCategory = "concurrency"
	CategoryProviderUnavailable FailureCategory = "provider_unavailable"
	CategoryNetwork             FailureCategory = "network"
	CategoryRequestNotSent      FailureCategory = "request_not_sent"
	CategoryTimeout             FailureCategory = "timeout"
	CategorySubmissionUncertain FailureCategory = "submission_uncertain"
	CategoryAsyncFailed         FailureCategory = "async_failed"
	CategoryCancelled           FailureCategory = "cancelled"
	CategoryPartialSuccess      FailureCategory = "partial_success"
	CategoryDownloadFailed      FailureCategory = "download_failed"
	CategoryDeliveryFailed      FailureCategory = "delivery_failed"
	CategoryResultsMissing      FailureCategory = "results_missing"
	CategoryMalformedResponse   FailureCategory = "malformed_response"
	CategoryUnknown             FailureCategory = "unknown"
)

// Failure 是归类后的可行动失败。UserMessage 给用户看；ErrorCode 给机器判断。
type Failure struct {
	Category        FailureCategory
	Reason          string
	Action          string
	ProviderCode    string
	ProviderMessage string
	Param           string
	RequestID       string
	TaskID          string
	HTTPStatus      int
	Retryable       bool
	Uncertain       bool
	Structured      bool
	FromCode        bool
}

type categoryCopy struct {
	Reason string
	Action string
}

var categoryCopies = map[FailureCategory]categoryCopy{
	CategoryLocalDiskFull:       {Reason: "Insufficient local disk space to save data", Action: "Please clean the disk where the BeefTV data directory is located; if there are already generated results, please retrieve the original task first and do not generate it again."},
	CategoryLocalCredential:     {Reason: "Failed to read local computing power credentials", Action: "Please check the workspace data directory and reconnect the computing account; do not delete the workspace key"},
	CategoryAuth:                {Reason: "Model service authentication failed", Action: "Please check the API Key and try again"},
	CategoryPermission:          {Reason: "The current channel does not have permission to use this model", Action: "Please change the model or check the channel permissions"},
	CategoryQuotaUser:           {Reason: "The available balance of the current account is insufficient", Action: "Please check the account balance, replenish the quota or adjust the token or package quota and try again"},
	CategoryQuotaUpstream:       {Reason: "The model supplier rejected the billing or credit related request", Action: "Please check the bill and credit limit with your supplier before deciding whether to try again."},
	CategoryQuotaUnknown:        {Reason: "The model service rejected billing or quota-related requests.", Action: "Please go to the current channel or model supplier to check the bill and limit before deciding whether to try again."},
	CategoryQuotaLimit:          {Reason: "The model call has reached the set usage limit", Action: "Please check the usage or budget limit of the current channel, adjust it and try again"},
	CategoryModerationInput:     {Reason: "The prompt word or reference material did not pass the content security review", Action: "Please adjust the prompt words or reference materials and regenerate"},
	CategoryModerationReference: {Reason: "The reference material failed the content security review", Action: "Please check and replace the reference material before regenerating"},
	CategoryModerationOutput:    {Reason: "The generated results failed content security review", Action: "Please adjust the prompt words or reference materials and regenerate"},
	CategoryInvalidParams:       {Reason: "Model does not accept current parameters", Action: "Please check the model, size, duration, format or quantity and try again"},
	CategoryLocalStorage:        {Reason: "The local database cannot be read or written", Action: "Please restart the application; if it still fails, please retain the troubleshooting information and contact support, and do not generate it again."},
	CategoryContextTooLong:      {Reason: "The input content exceeds the model length limit", Action: "Please shorten the prompt words or reduce the reference content and try again"},
	CategoryInputInaccessible:   {Reason: "Reference material cannot be read", Action: "Please check the material and try again"},
	CategoryInputTooLarge:       {Reason: "Reference material is too large", Action: "Please compress or replace the material and try again"},
	CategoryModelMissing:        {Reason: "The current model or interface is not available", Action: "Please check the model name and channel configuration"},
	CategoryThrottled:           {Reason: "Requests are too frequent", Action: "Please try again later"},
	CategoryConcurrency:         {Reason: "Too many simultaneous builds", Action: "Please wait until existing tasks are completed before trying again"},
	CategoryProviderUnavailable: {Reason: "Model service is temporarily unavailable", Action: "Please try again later"},
	CategoryNetwork:             {Reason: "Network connection failed", Action: "Please check the network and verify the status of the original task before deciding whether to regenerate it."},
	CategoryRequestNotSent:      {Reason: "Failed to connect to the service, this request has not been submitted yet", Action: "Please check the network or proxy and try again"},
	CategoryTimeout:             {Reason: "Model service response timed out", Action: "Please check the original task later and do not resubmit it immediately"},
	CategorySubmissionUncertain: {Reason: "The submission result has not yet been confirmed, and the upstream tasks may still be executed.", Action: "Please check the original task status first and do not resubmit immediately"},
	CategoryAsyncFailed:         {Reason: "Build task not completed", Action: "Please check the details and decide whether to try again"},
	CategoryCancelled:           {Reason: "Task canceled", Action: "You can resubmit according to the original input"},
	CategoryPartialSuccess:      {Reason: "Some results were generated, the rest failed", Action: "Please check the existing results before deciding whether to do it again"},
	CategoryDownloadFailed:      {Reason: "Failed to download generated results", Action: "Please reload later and do not resubmit immediately"},
	CategoryDeliveryFailed:      {Reason: "The video has been generated but cannot be retrieved at the moment", Action: "Please contact support to restore the film, and click \"Retrieve Results\" after restoration; there is no need to pay again to generate it."},
	CategoryResultsMissing:      {Reason: "Task ended but no results available", Action: "Please review the details before deciding whether to try again"},
	CategoryMalformedResponse:   {Reason: "The model service returned unresolved content", Action: "Please check the details and check the status of the original task before deciding whether to regenerate it."},
	CategoryUnknown:             {Reason: "Build failed", Action: "Please review the details before deciding whether to try again"},
}

func (f Failure) ErrorCode() string {
	if f.Category == "" {
		return string(CategoryUnknown)
	}
	return string(f.Category)
}

func (f Failure) UserMessage() string {
	reason, action := f.displayCopy()
	message := joinSentences(reason, action)
	if ids := f.debugIDLine(); ids != "" {
		message = joinSentences(message, ids)
	}
	return message
}

func (f Failure) IsModeration() bool {
	return f.Category == CategoryModerationInput || f.Category == CategoryModerationReference || f.Category == CategoryModerationOutput
}

func (f Failure) BlocksAutomaticRetry() bool {
	_, preparation := referencePreparationCopies[f.ProviderCode]
	if f.Uncertain || preparation {
		return true
	}
	switch f.Category {
	case CategoryThrottled, CategoryConcurrency, CategoryProviderUnavailable, CategoryCancelled, CategoryRequestNotSent:
		return false
	default:
		return true
	}
}

func (f Failure) displayCopy() (string, string) {
	if strings.TrimSpace(f.Reason) != "" {
		return strings.TrimSpace(f.Reason), strings.TrimSpace(f.Action)
	}
	copyText := categoryCopies[f.Category]
	if copyText.Reason == "" {
		copyText = categoryCopies[CategoryUnknown]
	}
	return copyText.Reason, copyText.Action
}

func (f Failure) debugIDLine() string {
	parts := make([]string, 0, 2)
	if id := sanitizeDebugID(f.TaskID); id != "" {
		parts = append(parts, "Task"+id)
	}
	if id := sanitizeDebugID(f.RequestID); id != "" {
		parts = append(parts, "Request"+id)
	}
	if len(parts) == 0 {
		return ""
	}
	return "Check number:" + strings.Join(parts, " · ")
}

func joinSentences(parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		part = strings.TrimRight(part, "。.;；")
		out = append(out, part)
	}
	if len(out) == 0 {
		return categoryCopies[CategoryUnknown].Reason + "。" + categoryCopies[CategoryUnknown].Action + "。"
	}
	if len(out) == 1 {
		return out[0]
	}
	return strings.Join(out, "。") + "。"
}

func (e HTTPError) Error() string {
	return ClassifyHTTP(e.StatusCode, e.Status, e.Body).UserMessage()
}

func (e PayloadError) Error() string {
	if strings.TrimSpace(e.message) != "" {
		return e.message
	}
	return ClassifyText(e.raw).UserMessage()
}

func ClassifyHTTP(status int, statusText string, body string) Failure {
	fields := extractProviderFields(body)
	if _, persisted := persistedReferencePreparationFailure(firstNonEmpty(fields.Message, body)); persisted {
		// Only the typed transport boundary may attest an unsent request. A
		// provider response cannot grant that proof by echoing our saved copy.
		return normalizeFailure(Failure{Category: CategorySubmissionUncertain, HTTPStatus: status, ProviderCode: sanitizeProviderCode(fields.Code)})
	}
	failure := ClassifyText(body)
	// This boundary handles provider responses, not local filesystem errors.
	if failure.Category == CategoryLocalDiskFull || failure.Category == CategoryLocalCredential {
		failure = Failure{Category: CategoryUnknown}
	}
	failure.HTTPStatus = status
	// Reservation failures also use HTTP 503; only explicit funding rejection identifies caller quota.
	if status == 402 && failure.ProviderCode == "video_reservation_failed" && strings.HasPrefix(failure.ProviderMessage, "insufficient balance for this video request") {
		failure.Category = CategoryQuotaUser
		failure.FromCode = true
		failure.Reason, failure.Action = "", ""
	}
	if failure.Category != CategoryUnknown && !failure.FromCode && ((status != 0 && !trustProviderMessageStatus(status)) || (htmlBodyPattern.MatchString(strings.TrimSpace(body)) && status >= 400)) {
		failure.Category = CategoryUnknown
		failure.Reason = ""
		failure.Action = ""
	}
	if !failure.FromCode && failure.Category == CategoryInvalidParams && status >= 400 && status != http.StatusBadRequest && status != http.StatusConflict && status != http.StatusUnprocessableEntity {
		failure.Category = CategoryUnknown
		failure.Reason = ""
		failure.Action = ""
	}
	if failure.Category == CategoryUnknown && !failure.FromCode {
		if category, ok := categoryFromHTTPStatus(status); ok {
			failure.Category = category
			failure.Reason = ""
			failure.Action = ""
		}
	}
	if status == 413 && failure.Category == CategoryInputTooLarge && !singleFileTooLargePattern.MatchString(body) && (failure.Reason == "" || failure.Reason == "参考素材过大") {
		failure.Reason = "The amount of data requested exceeds the upper limit of the interface"
		failure.Action = "Please reduce the number of reference materials or use publicly accessible material links before submitting."
	}
	if status == 524 && (failure.Category == CategoryUnknown || failure.Category == CategoryTimeout || failure.Category == CategoryProviderUnavailable || failure.Category == CategoryMalformedResponse) {
		failure.Category = CategoryTimeout
		failure.Uncertain = true
		failure.Reason = "The model service response timed out and the request may still be executed on the server."
		failure.Action = "Please check the original task or go to the supplier to check the status first. Do not resubmit immediately."
	}
	_ = statusText
	return normalizeFailure(failure)
}

func classifyHTTPErrorCause(err error) Failure {
	var httpErr HTTPError
	if errors.As(err, &httpErr) {
		return ClassifyHTTP(httpErr.StatusCode, httpErr.Status, httpErr.Body)
	}
	if err == nil {
		return normalizeFailure(Failure{Category: CategoryUnknown})
	}
	return ClassifyText(err.Error())
}

func ClassifyError(err error) Failure {
	if err == nil {
		return normalizeFailure(Failure{Category: CategoryUnknown})
	}
	var unknown SubmissionUnknownError
	if errors.As(err, &unknown) {
		return normalizeFailure(Failure{Category: CategorySubmissionUncertain, Uncertain: true, Retryable: false})
	}
	var managed *beeftv.MediaTaskError
	if errors.As(err, &managed) {
		category := FailureCategory(managed.Category)
		switch strings.ToLower(strings.TrimSpace(managed.Category)) {
		case "input":
			category = CategoryInvalidParams
		case "authorization":
			category = CategoryAuth
		case "upstream":
			category = CategoryAsyncFailed
		case "unknown":
			if managed.Pending() {
				category = CategorySubmissionUncertain
			} else {
				category = CategoryAsyncFailed
			}
		}
		if _, supported := categoryCopies[category]; !supported {
			category = CategoryUnknown
		}
		uncertain := category == CategorySubmissionUncertain || managed.Pending()
		failure := normalizeFailure(Failure{Category: category, Uncertain: uncertain, TaskID: sanitizeDebugID(managed.TaskID), ProviderCode: sanitizeProviderCode(managed.Code), ProviderMessage: DiagnosticSummary(managed.Message), Structured: true, FromCode: true})
		if !uncertain && strings.TrimSpace(managed.Message) != "" && managed.Message != "The original video task was unsuccessful. Please check the original task results and deductions." {
			textFailure := ClassifyText(managed.Message)
			if textFailure.Category != CategoryUnknown && (category == CategoryAsyncFailed || category == CategoryInvalidParams || category == CategoryUnknown) {
				failure.Category = textFailure.Category
				if textFailure.Reason != "" {
					failure.Reason = textFailure.Reason
				}
				if textFailure.Action != "" {
					failure.Action = textFailure.Action
				}
				failure = normalizeFailure(failure)
			} else if textFailure.Reason != "" && textFailure.Reason != categoryCopies[textFailure.Category].Reason {
				failure.Reason = textFailure.Reason
				if textFailure.Action != "" {
					failure.Action = textFailure.Action
				}
				failure = normalizeFailure(failure)
			}
		}
		return failure
	}
	var managedHTTP *beeftv.MediaHTTPError
	if errors.As(err, &managedHTTP) {
		failure := classifyHTTPErrorCause(legacyMediaError(err))
		failure.RequestID = firstNonEmpty(sanitizeDebugID(managedHTTP.RequestID), failure.RequestID)
		return failure
	}
	var protocolPreparation ProtocolPreparationError
	if errors.As(err, &protocolPreparation) {
		return normalizeFailure(Failure{Category: CategoryModelMissing, Reason: protocolPreparation.Error(), Action: "This request has not been submitted yet. Please check whether the plug-in of the selected model is installed, enabled and supports this generation type."})
	}
	if errors.Is(err, context.Canceled) {
		return normalizeFailure(Failure{Category: CategoryCancelled})
	}
	var referenceUpload *ReferenceUploadError
	if errors.As(err, &referenceUpload) {
		if referenceUpload.Meta.Stage != "put" && (referenceUpload.HTTPStatus == 400 || referenceUpload.HTTPStatus == 401 || referenceUpload.HTTPStatus == 402 || referenceUpload.HTTPStatus == 403) {
			failure := ClassifyError(referenceUpload.Cause)
			failure.RequestID = firstNonEmpty(referenceUpload.RequestID, failure.RequestID)
			if referenceUpload.HTTPStatus == 400 && referenceUpload.Meta.Index > 0 {
				itemLabel := referenceMediaLabel(referenceUpload.Meta.Kind, referenceUpload.Meta.Index-1)
				if itemLabel != "" {
					if failure.Reason != "" && !strings.Contains(failure.Reason, itemLabel) && !strings.Contains(failure.Reason, "个参考") && !strings.Contains(failure.Reason, "张参考") && !strings.Contains(failure.Reason, "段参考") {
						failure.Reason = itemLabel + "：" + failure.Reason
					}
					if failure.ProviderMessage != "" && !strings.Contains(failure.ProviderMessage, itemLabel) && !strings.Contains(failure.ProviderMessage, "个参考") && !strings.Contains(failure.ProviderMessage, "张参考") && !strings.Contains(failure.ProviderMessage, "段参考") {
						failure.ProviderMessage = itemLabel + "：" + failure.ProviderMessage
					}
				}
			}
			return failure
		}
		copy := referencePreparationCopies["reference_preupload_failed"]
		failure := normalizeFailure(Failure{Category: CategoryProviderUnavailable, ProviderCode: "reference_preupload_failed",
			Reason: copy.reason, Action: copy.action, HTTPStatus: referenceUpload.HTTPStatus, RequestID: referenceUpload.RequestID})
		failure.Retryable = false
		return failure
	}
	var notSent RequestNotSentError
	if errors.As(err, &notSent) || beeftv.IsDiscoveryTransportError(err) {
		return normalizeFailure(Failure{Category: CategoryRequestNotSent})
	}
	var preparation RequestPreparationError
	if errors.As(err, &preparation) {
		var storage ReferenceStoragePreparationError
		if errors.As(preparation.Cause, &storage) {
			failure := normalizeFailure(Failure{Category: CategoryProviderUnavailable, ProviderCode: "reference_media_upload_failed", Reason: "The reference material upload failed and the generation has not started yet.", Action: "Please check the object storage configuration and public read permissions and try again"})
			failure.Retryable = false
			return failure
		}
		failure := classifyHTTPErrorCause(preparation.Cause)
		if failure.ProviderCode == "image_reference_upload_failed" {
			failure.Category = CategoryProviderUnavailable
			failure.Uncertain = false
			failure.Reason = "The reference image upload failed and the generation has not started yet."
			failure.Action = "Please try again later"
			failure = normalizeFailure(failure)
			failure.Retryable = false
			return failure
		}
		return normalizeFailure(Failure{Category: CategoryInputInaccessible, Reason: "This request failed during preparation and was not sent to the model service.", Action: "Please check the reference material and generation parameters and try again"})
	}
	if _, echoed := persistedReferencePreparationFailure(err.Error()); echoed {
		return normalizeFailure(Failure{Category: CategorySubmissionUncertain})
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return normalizeFailure(Failure{Category: CategoryTimeout, Uncertain: true, Reason: "Model service response timed out, the request may still be executing", Action: "Please check the original task first and do not resubmit it immediately"})
	}
	var circuit CircuitOpenError
	if errors.As(err, &circuit) {
		return CircuitOpenFailure()
	}
	var decode ResponseDecodeError
	if errors.As(err, &decode) {
		failure := ClassifyError(decode.Err)
		if failure.Category == CategoryUnknown {
			failure = ClassifyText(decode.Error())
		}
		if failure.Category == CategoryUnknown {
			failure.Category = CategoryMalformedResponse
			failure.Reason = ""
			failure.Action = ""
		}
		return normalizeFailure(failure)
	}
	var pending StatePendingError
	if errors.As(err, &pending) {
		failure := classifyHTTPErrorCause(pending.Cause)
		failure.Category = CategorySubmissionUncertain
		failure.Uncertain = true
		failure.TaskID = firstNonEmpty(failure.TaskID, pending.TaskID)
		failure.Reason = ""
		failure.Action = ""
		return normalizeFailure(failure)
	}
	var dns *outbound.DNSResolutionError
	if errors.As(err, &dns) {
		failure := normalizeFailure(Failure{Category: CategoryNetwork, Reason: "Model service domain name resolution failed", Action: "Please check the network; for tasks that have been submitted, please continue to query the original task and do not regenerate it."})
		var networkError net.Error
		failure.Retryable = errors.As(dns, &networkError) && (networkError.Timeout() || networkError.Temporary())
		return failure
	}
	var httpErr HTTPError
	if errors.As(err, &httpErr) {
		return ClassifyHTTP(httpErr.StatusCode, httpErr.Status, httpErr.Body)
	}
	var payload PayloadError
	if errors.As(err, &payload) {
		raw := firstNonEmpty(payload.raw, payload.message)
		fields := extractProviderFields(raw)
		if _, echoed := persistedReferencePreparationFailure(firstNonEmpty(fields.Message, raw)); echoed {
			return normalizeFailure(Failure{Category: CategorySubmissionUncertain})
		}
		failure := ClassifyText(raw)
		if payload.message != "" && failure.Category == CategoryUnknown && !failure.Structured {
			return ClassifyText(payload.message)
		}
		return failure
	}
	return ClassifyText(err.Error())
}

func ClassifyText(raw string) Failure {
	if failure, ok := persistedReferencePreparationFailure(raw); ok {
		return failure
	}
	if copy, ok := persistedTaskConstraintCopy(raw); ok {
		requestID, taskID := persistedReferenceIDs(raw)
		return normalizeFailure(Failure{Category: CategoryInvalidParams, Reason: copy.Reason, Action: copy.Action, RequestID: requestID, TaskID: taskID, FromCode: true})
	}
	failure := Failure{Category: CategoryUnknown}
	text := strings.TrimSpace(raw)
	if text == "" {
		return normalizeFailure(failure)
	}
	if f, ok := persistedModerationCopy(text); ok {
		f.RequestID, f.TaskID = persistedReferenceIDs(text)
		return normalizeFailure(f)
	}
	if copy, ok := referenceDurationCopy(text); ok {
		requestID, taskID := persistedReferenceIDs(text)
		return normalizeFailure(Failure{Category: CategoryInvalidParams, Reason: copy.Reason, Action: copy.Action, RequestID: requestID, TaskID: taskID, FromCode: true})
	}
	if copy, ok := referenceMediaConstraintCopy(text); ok {
		requestID, taskID := persistedReferenceIDs(text)
		category := CategoryInvalidParams
		if copy.Action != "" && (strings.Contains(copy.Reason, "过大") || strings.Contains(copy.Action, "压缩")) {
			category = CategoryInputTooLarge
		}
		return normalizeFailure(Failure{Category: category, Reason: copy.Reason, Action: copy.Action, RequestID: requestID, TaskID: taskID, FromCode: true})
	}
	if htmlBodyPattern.MatchString(text) {
		if status := extractExplicitHTTPStatus(text); status != 0 {
			return ClassifyHTTP(status, "", "")
		}
		return normalizeFailure(Failure{Category: CategoryMalformedResponse})
	}
	fields := extractProviderFields(text)
	vodText := text
	if fields.hasStructured() || strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[") {
		vodText = fields.Message
	}
	if copy, ok := vodImageErrorCopy(fields.Code, vodText); ok {
		copy.RequestID, copy.TaskID = sanitizeDebugID(fields.RequestID), sanitizeDebugID(fields.TaskID)
		return normalizeFailure(copy)
	}
	// Inspect only the error message, never JSON request echoes or debug fields.
	databaseMessage := text
	if fields.hasStructured() || strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[") {
		databaseMessage = fields.Message
	}
	if localDatabaseErrorPattern.MatchString(databaseMessage) {
		return normalizeFailure(Failure{Category: CategoryLocalStorage, FromCode: true, RequestID: sanitizeDebugID(fields.RequestID), TaskID: sanitizeDebugID(fields.TaskID)})
	}
	if isLocalDiskFullMessage(databaseMessage) {
		return normalizeFailure(Failure{Category: CategoryLocalDiskFull, FromCode: true})
	}
	if fields.hasStructured() {
		if strings.Contains(fields.Message, "暂无可用渠道") || strings.Contains(fields.Message, "无可用渠道") {
			return normalizeFailure(Failure{Category: CategoryProviderUnavailable, Structured: true, ProviderCode: sanitizeProviderCode(fields.Code), ProviderMessage: sanitizeProviderText(fields.Message), RequestID: fields.RequestID})
		}
		if strings.EqualFold(fields.Code, "invalid_reference_audio") {
			copy, _ := referenceAudioCopy(fields.Message, true)
			return normalizeFailure(Failure{Category: CategoryInvalidParams, Reason: copy.Reason, Action: copy.Action, RequestID: fields.RequestID, TaskID: fields.TaskID, ProviderCode: fields.Code, Structured: true, FromCode: true})
		}
		if copy, ok := referenceDurationCopy(fields.Message); ok {
			return normalizeFailure(Failure{Category: CategoryInvalidParams, Reason: copy.Reason, Action: copy.Action, RequestID: fields.RequestID, TaskID: fields.TaskID, ProviderCode: sanitizeProviderCode(fields.Code), Structured: true, FromCode: true})
		}
		failure.Structured = true
		failure.ProviderCode = sanitizeProviderCode(fields.Code)
		failure.ProviderMessage = sanitizeProviderText(fields.Message)
		failure.Param = sanitizeProviderCode(fields.Param)
		failure.RequestID = sanitizeDebugID(fields.RequestID)
		failure.TaskID = sanitizeDebugID(fields.TaskID)
		if category, ok := categoryFromProviderCode(fields.Code, fields.Type, fields.Status); ok {
			failure.Category = category
			_, codeKnown := categoryFromProviderCode(fields.Code)
			_, statusKnown := categoryFromProviderCode(fields.Status)
			codeOrStatusAuthoritative := (codeKnown && !nonAuthoritativeInvalidParamsCode(fields.Code)) || (statusKnown && !nonAuthoritativeInvalidParamsCode(fields.Status))
			failure.FromCode = codeOrStatusAuthoritative || !genericProviderCode(fields.Type)
			refineInvalidParams(&failure, fields)
			specializeModeration(&failure, fields)
			specializeThinkingToolChoice(&failure, fields)
			specializeDurationRange(&failure, fields)
			specializeMediaConstraints(&failure, fields)
			if failure.Category != CategoryInvalidParams || failure.Reason != "" {
				failure.FromCode = true
			} else if !failure.FromCode && applyTerminalMessageCategory(&failure, fields.Message) {
				// Non-authoritative wrapper keeps FromCode=false so untrusted HTTP statuses (e.g. 503/403) still win.
			} else if copy, ok := userFacingChineseCopy(fields.Message); ok {
				failure.Reason, failure.Action = copy.Reason, copy.Action
			}
			return normalizeFailure(failure)
		}
		if category, ok := categoryFromProviderMessage(fields.Message + " " + fields.Type + " " + fields.Status); ok {
			failure.Category = category
			specializeModeration(&failure, fields)
			specializeThinkingToolChoice(&failure, fields)
			specializeDurationRange(&failure, fields)
			specializeMediaConstraints(&failure, fields)
			if failure.Reason != "" {
				failure.FromCode = true
			} else if failure.Category == CategoryInvalidParams {
				if copy, ok := userFacingChineseCopy(fields.Message); ok {
					failure.Reason, failure.Action = copy.Reason, copy.Action
				}
			}
			return normalizeFailure(failure)
		}
		if !applyTerminalMessageCategory(&failure, fields.Message) {
			if copy, ok := userFacingChineseCopy(fields.Message); ok && isActionableParameterCopy(copy) {
				failure.Category = CategoryInvalidParams
				failure.Reason, failure.Action = copy.Reason, copy.Action
			}
		}
		// JSON request echoes and debug fields are never classification input.
		return normalizeFailure(failure)
	}
	if strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[") {
		failure.Structured = true
		return normalizeFailure(failure)
	}
	if copy, ok := outboundPolicyCopy(text); ok {
		requestID, taskID := persistedReferenceIDs(text)
		return normalizeFailure(Failure{Category: CategoryNetwork, Reason: copy.Reason, Action: copy.Action,
			Structured: true, RequestID: requestID, TaskID: taskID, HTTPStatus: extractExplicitHTTPStatus(text)})
	}
	if matched := matchPersistedCategory(text); matched != CategoryUnknown {
		failure.Category = matched
		failure.FromCode = true
		failure.RequestID, failure.TaskID = persistedReferenceIDs(text)
		if matched == CategoryTimeout || matched == CategoryDownloadFailed || matched == CategorySubmissionUncertain {
			failure.Uncertain = true
		}
		return normalizeFailure(failure)
	}
	if isMalformedText(text) {
		failure.Category = CategoryMalformedResponse
		return normalizeFailure(failure)
	}
	if category, ok := categoryFromProviderMessage(text); ok {
		failure.Category = category
		failure.Structured = true
		if copy, ok := taskConstraintCopy(text); ok {
			failure.Reason, failure.Action = copy.Reason, copy.Action
		}
		specializeModeration(&failure, extractedFields{Message: text})
		specializeThinkingToolChoice(&failure, extractedFields{Message: text})
		specializeDurationRange(&failure, extractedFields{Message: text})
		specializeMediaConstraints(&failure, extractedFields{Message: text})
		if failure.Reason != "" {
			failure.FromCode = true
		}
		if status := extractExplicitHTTPStatus(text); status != 0 {
			failure.HTTPStatus = status
		}
		return normalizeFailure(failure)
	}
	if isNetworkText(text) {
		failure.Category = CategoryNetwork
		return normalizeFailure(failure)
	}
	if isDownloadText(text) {
		failure.Category = CategoryDownloadFailed
		failure.Uncertain = true
		return normalizeFailure(failure)
	}
	if isCancelledText(text) {
		failure.Category = CategoryCancelled
		return normalizeFailure(failure)
	}
	if isResultsMissingText(text) {
		failure.Category = CategoryResultsMissing
		return normalizeFailure(failure)
	}
	if status := extractExplicitHTTPStatus(text); status != 0 {
		return ClassifyHTTP(status, "", "")
	}
	if looksLikeUserFacingChinese(text) {
		reqID, taskID := persistedReferenceIDs(text)
		failure.RequestID = firstNonEmpty(failure.RequestID, reqID)
		failure.TaskID = firstNonEmpty(failure.TaskID, taskID)
		bodyWithoutDebug := strings.SplitN(text, ". Check number:", 2)[0]
		if persistedReferenceItemPrefix.MatchString(bodyWithoutDebug) {
			failure.Category = CategoryInvalidParams
			failure.FromCode = true
		}
		if copy, ok := userFacingChineseCopy(bodyWithoutDebug); ok {
			failure.Reason, failure.Action = copy.Reason, copy.Action
			if failure.Category == CategoryUnknown && isActionableParameterCopy(copy) {
				failure.Category = CategoryInvalidParams
			}
		} else {
			failure.Reason = sanitizeProviderText(bodyWithoutDebug)
			failure.Action = ""
		}
	}
	return normalizeFailure(failure)
}

func ClassifyAppError(status int, code int, reason string, message string) Failure {
	failure := ClassifyHTTP(status, "", firstNonEmpty(message, reason))
	if !failure.Structured && !failure.FromCode {
		category, matched := categoryFromProviderCode(reason)
		switch code {
		case 40301:
			category, matched = CategoryQuotaUnknown, true
		case 42901:
			category, matched = CategoryThrottled, true
		}
		if matched {
			failure.Category = category
			failure.FromCode = true
			failure.Reason, failure.Action = "", ""
		}
	}
	return normalizeFailure(failure)
}

func trustProviderMessageStatus(status int) bool {
	if status >= 200 && status < 300 {
		return true
	}
	switch status {
	case http.StatusBadRequest, http.StatusPaymentRequired, http.StatusConflict, http.StatusRequestEntityTooLarge, http.StatusUnprocessableEntity, http.StatusTooManyRequests, 451:
		return true
	}
	return false
}

func categoryFromHTTPStatus(status int) (FailureCategory, bool) {
	switch status {
	case http.StatusUnauthorized:
		return CategoryAuth, true
	case http.StatusForbidden:
		return CategoryPermission, true
	case http.StatusPaymentRequired:
		return CategoryQuotaUnknown, true
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		return CategoryModelMissing, true
	case http.StatusRequestTimeout, http.StatusGatewayTimeout, 524:
		return CategoryTimeout, true
	case http.StatusConflict:
		return CategoryInvalidParams, true
	case http.StatusRequestEntityTooLarge:
		return CategoryInputTooLarge, true
	case http.StatusUnprocessableEntity, http.StatusBadRequest:
		return CategoryInvalidParams, true
	case http.StatusTooManyRequests:
		return CategoryThrottled, true
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable:
		return CategoryProviderUnavailable, true
	}
	if status >= 500 {
		return CategoryProviderUnavailable, true
	}
	return CategoryUnknown, status != 0
}

func normalizeFailure(failure Failure) Failure {
	if failure.Category == "" {
		failure.Category = CategoryUnknown
	}
	if failure.IsModeration() {
		failure.Retryable = false
	}
	if failure.Category == CategorySubmissionUncertain {
		failure.Uncertain = true
	}
	applyRetryable(&failure)
	reason, action := failure.displayCopy()
	failure.Reason = reason
	failure.Action = action
	return failure
}
