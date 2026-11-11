package generation

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var (
	localDatabaseErrorPattern = regexp.MustCompile(`(?i)(?:^|:\s*)(?:table\s+[a-z0-9_]+\s+has no column named\s+[a-z0-9_]+|no such (?:column|table):\s*[a-z0-9_.]+|(?:UNIQUE|NOT NULL|CHECK) constraint failed:\s*\S+|FOREIGN KEY constraint failed|database (?:is locked|is malformed)|database disk image is malformed|attempt to write a readonly database|disk I/O error)(?:\b|$)`)
	durationRangePattern      = regexp.MustCompile(`(?i)\bduration\s+(?:must\s+be|should\s+be|is\s+required\s+to\s+be)\s+(?:between\s+([0-9]+(?:\.[0-9]+)?)\s*(?:seconds?|secs?|s)?\s+and\s+([0-9]+(?:\.[0-9]+)?)|in\s+(?:the\s+)?range\s*\[?([0-9]+(?:\.[0-9]+)?)\s*[,–-]\s*([0-9]+(?:\.[0-9]+)?)\]?)\s*(?:seconds?|secs?|s)\b`)
	widthRangePattern         = regexp.MustCompile(`(?i)\bwidth\s+(?:must\s+be|should\s+be)\s+between\s+(\d+)\s*(?:px|pixels?)?\s+and\s+(\d+)\s*(?:px|pixels?)`)
	heightRangePattern        = regexp.MustCompile(`(?i)\bheight\s+(?:must\s+be|should\s+be)\s+between\s+(\d+)\s*(?:px|pixels?)?\s+and\s+(\d+)\s*(?:px|pixels?)`)
	aspectRangePattern        = regexp.MustCompile(`(?i)aspect(?:\s*ratio)?\s+(?:must\s+be|should\s+be)\s+between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)`)
	pixelRangePattern         = regexp.MustCompile(`(?i)(?:pixel(?:s)?(?:\s+count)?|total\s+pixels)\s+(?:must\s+be|should\s+be)\s+between\s+(\d+)\s+and\s+(\d+)`)
	requestTooLargePattern    = regexp.MustCompile(`(?i)(?:request\s+(?:body|entity|payload)|payload)\s+(?:is\s+)?too\s+large|(?:request|payload).{0,24}(?:exceeds?|larger than)`)
	singleFileTooLargePattern = regexp.MustCompile(`(?i)(?:file|image|video|audio)\s+too\s+large|(?:file|image|video|audio).{0,24}(?:exceeds?|larger than)\s+\d+`)
)

func isLocalDiskFullMessage(message string) bool {
	text := strings.ToLower(message)
	local := strings.Contains(text, "write local resource") || strings.Contains(text, "Failed to write generated content to resource storage") || strings.Contains(text, "database or disk is full") || strings.Contains(text, "本地磁盘空间不足")
	full := strings.Contains(text, "no space left on device") || strings.Contains(text, "not enough space on the disk") || strings.Contains(text, "disk full") || strings.Contains(text, "database or disk is full") || strings.Contains(text, "本地磁盘空间不足")
	return local && full
}

func WithDownloadFailure(failure Failure, taskID string) Failure {
	if failure.Category == CategoryLocalDiskFull || failure.Category == CategoryLocalCredential || failure.Category == CategoryLocalStorage {
		failure.TaskID = firstNonEmpty(failure.TaskID, taskID)
		return normalizeFailure(failure)
	}
	if failure.Category == CategoryAuth || failure.Category == CategoryPermission || failure.IsModeration() || failure.Category == CategoryInvalidParams || failure.Category == CategoryDeliveryFailed {
		failure.TaskID = firstNonEmpty(failure.TaskID, taskID)
		return normalizeFailure(failure)
	}
	failure.Category = CategoryDownloadFailed
	failure.Uncertain = true
	failure.Reason = ""
	failure.Action = ""
	failure.TaskID = firstNonEmpty(failure.TaskID, taskID)
	return normalizeFailure(failure)
}

func WithConcurrencyFailure(failure Failure) Failure {
	if failure.Structured && failure.Category != CategoryUnknown {
		return failure
	}
	failure.Category = CategoryConcurrency
	failure.Reason = ""
	failure.Action = ""
	return normalizeFailure(failure)
}

func CircuitOpenFailure() Failure {
	return normalizeFailure(Failure{
		Category: CategoryProviderUnavailable,
		Reason:   "The current channel has failed continuously and has been temporarily disconnected.",
		Action:   "Please try again later",
	})
}

func categoryFromProviderMessage(raw string) (FailureCategory, bool) {
	normalized := strings.ToLower(strings.TrimSpace(promptEchoPattern.ReplaceAllString(raw, "")))
	if _, ok := taskConstraintCopy(normalized); ok {
		return CategoryInvalidParams, true
	}
	if normalized == "" {
		return "", false
	}
	if f, ok := moderationErrorCopy("", normalized); ok {
		return f.Category, true
	}
	switch {
	case durationRangePattern.MatchString(normalized),
		widthRangePattern.MatchString(normalized),
		heightRangePattern.MatchString(normalized),
		aspectRangePattern.MatchString(normalized),
		pixelRangePattern.MatchString(normalized):
		return CategoryInvalidParams, true
	case requestTooLargePattern.MatchString(normalized) || singleFileTooLargePattern.MatchString(normalized) || strings.HasPrefix(normalized, "The amount of data requested exceeds the upper limit of the interface"):
		return CategoryInputTooLarge, true
	case strings.Contains(normalized, "thinking") && strings.Contains(normalized, "tool_choice"),
		strings.Contains(normalized, "reasoning") && strings.Contains(normalized, "tool_choice"),
		strings.Contains(normalized, "tool_choice") && (strings.Contains(normalized, "not support") || strings.Contains(normalized, "unsupported")):
		return CategoryInvalidParams, true
	case containsContentSafety(normalized):
		return moderationCategoryFromMessage(normalized), true
	case strings.Contains(normalized, "insufficient_quota") || ((strings.Contains(normalized, "quota") || strings.Contains(normalized, "balance") || strings.Contains(normalized, "额度") || strings.Contains(normalized, "余额") || strings.Contains(normalized, "欠费")) && !strings.Contains(normalized, "rate")):
		if strings.Contains(normalized, "arrearage") || strings.Contains(normalized, "billing_hard_limit") || strings.Contains(normalized, "供应商") {
			return CategoryQuotaUpstream, true
		}
		return CategoryQuotaUnknown, true
	case strings.Contains(normalized, "rate limit") || strings.Contains(normalized, "too many requests") || strings.Contains(normalized, "throttl") || strings.Contains(normalized, "频繁"):
		return CategoryThrottled, true
	case strings.Contains(normalized, "context length") || strings.Contains(normalized, "maximum context") || strings.Contains(normalized, "too many tokens") || strings.Contains(normalized, "max_tokens") || strings.Contains(normalized, "长度") && (strings.Contains(normalized, "最大") || strings.Contains(normalized, "超出")):
		return CategoryContextTooLong, true
	case strings.Contains(normalized, "model_not_found") || strings.Contains(normalized, "model not found") || strings.Contains(normalized, "does not exist") && strings.Contains(normalized, "model") || strings.Contains(normalized, "模型不存在") || strings.Contains(normalized, "Model or model interface does not exist") || strings.Contains(normalized, "405 method not allowed") || strings.Contains(normalized, "method not allowed") || strings.Contains(normalized, "http 405") || strings.Contains(normalized, "status 405"):
		return CategoryModelMissing, true
	case strings.Contains(normalized, "invalid api key") || strings.Contains(normalized, "incorrect api key") || strings.Contains(normalized, "authentication") || strings.Contains(normalized, "unauthorized") || strings.Contains(normalized, "鉴权失败"):
		return CategoryAuth, true
	case strings.Contains(normalized, "permission") && (strings.Contains(normalized, "denied") || strings.Contains(normalized, "model") || strings.Contains(normalized, "access")):
		return CategoryPermission, true
	case strings.Contains(normalized, "url error") || strings.Contains(normalized, "failed to download") || strings.Contains(normalized, "cannot fetch") || strings.Contains(normalized, "invalid image url") || strings.Contains(normalized, "无法读取"):
		return CategoryInputInaccessible, true
	case strings.Contains(normalized, "too large") || strings.Contains(normalized, "payload too large") || strings.Contains(normalized, "file size") || strings.Contains(normalized, "过大"):
		return CategoryInputTooLarge, true
	case strings.Contains(normalized, "invalid") || strings.Contains(normalized, "parameter") || strings.Contains(normalized, "argument") || strings.Contains(normalized, "请检查模型和参数"):
		return CategoryInvalidParams, true
	}
	return "", false
}

func containsContentSafety(normalized string) bool {
	if strings.Contains(normalized, "rejected by the safety system") || strings.Contains(normalized, "rejected as a result of our safety system") || strings.Contains(normalized, "rejected as a result of the safety system") || strings.Contains(normalized, "contentmoderationfailed") || strings.Contains(normalized, "invalidparameter.voilationcontent") || strings.Contains(normalized, "invalidparameter.violationcontent") || strings.Contains(normalized, "上游内容安全策略") {
		return true
	}
	if strings.Contains(normalized, "sensitive_words_detected") || strings.Contains(normalized, "content policy") || strings.Contains(normalized, "content safety") || strings.Contains(normalized, "safety policy") || strings.Contains(normalized, "data inspection") || strings.Contains(normalized, "prohibited_content") || strings.Contains(normalized, "内容安全审核") || strings.Contains(normalized, "内容审核未通过") {
		return true
	}
	if strings.Contains(normalized, "moderation") || strings.Contains(normalized, "blocked by") && (strings.Contains(normalized, "safety") || strings.Contains(normalized, "policy") || strings.Contains(normalized, "content")) {
		return true
	}
	if strings.Contains(normalized, "safety") && (strings.Contains(normalized, "blocked") || strings.Contains(normalized, "violat") || strings.Contains(normalized, "filter")) {
		return true
	}
	return false
}

func moderationCategoryFromMessage(normalized string) FailureCategory {
	if strings.Contains(normalized, "output") && (strings.Contains(normalized, "image") || strings.Contains(normalized, "video") || strings.Contains(normalized, "result")) || strings.Contains(normalized, "生成结果") {
		return CategoryModerationOutput
	}
	if strings.Contains(normalized, "reference image") || strings.Contains(normalized, "input image") || strings.Contains(normalized, "参考图") || strings.Contains(normalized, "参考图片") {
		return CategoryModerationReference
	}
	return CategoryModerationInput
}

func hasAuthoritativeProviderCode(fields extractedFields) bool {
	if _, ok := categoryFromProviderCode(fields.Code); ok && !genericProviderCode(fields.Code) {
		return true
	}
	if _, ok := categoryFromProviderCode(fields.Status); ok && !genericProviderCode(fields.Status) {
		return true
	}
	if _, ok := categoryFromProviderCode(fields.Type); ok && !genericProviderCode(fields.Type) {
		return true
	}
	return false
}

func specializeModeration(failure *Failure, fields extractedFields) {
	refinableCode := !hasAuthoritativeProviderCode(fields)
	if f, ok := persistedModerationCopy(fields.Message); ok && (failure.Category == f.Category || (refinableCode && (failure.Category == CategoryUnknown || failure.Category == CategoryInvalidParams))) {
		failure.Category, failure.Reason, failure.Action = f.Category, f.Reason, f.Action
		requestID, taskID := persistedReferenceIDs(fields.Message)
		failure.RequestID = firstNonEmpty(failure.RequestID, requestID)
		failure.TaskID = firstNonEmpty(failure.TaskID, taskID)
		return
	}
	if failure.RequestID == "" {
		failure.RequestID = requestIDFromMessage(fields.Message)
	}
	if failure.IsModeration() || ((failure.Category == CategoryUnknown || failure.Category == CategoryInvalidParams) && refinableCode) {
		if f, ok := moderationErrorCopy(fields.Code, sanitizeProviderText(fields.Message)); ok {
			failure.Category, failure.Reason, failure.Action = f.Category, f.Reason, f.Action
			return
		}
	}
	if !failure.IsModeration() {
		return
	}
	for _, code := range []string{fields.Code, fields.Type, fields.Status} {
		if _, ok := categoryCopies[FailureCategory(normalizeCode(code))]; ok {
			return
		}
	}
	normalized := strings.ToLower(fields.Message + " " + fields.Code)
	if (strings.Contains(normalized, "prompt") || strings.Contains(normalized, "提示词")) && (strings.Contains(normalized, "reference image") || strings.Contains(normalized, "input image") || strings.Contains(normalized, "参考")) {
		failure.Category = CategoryModerationInput
		failure.Reason = "The prompt word or reference material did not pass the content security review"
		failure.Action = "Please adjust the prompt words or reference materials and regenerate"
		return
	}
	failure.Category = moderationCategoryFromMessage(normalized)
}

func refineInvalidParams(failure *Failure, fields extractedFields) {
	if !hasAuthoritativeProviderCode(fields) && (failure.Category == CategoryUnknown || failure.Category == CategoryInvalidParams) {
		if category, ok := categoryFromProviderMessage(fields.Message); ok {
			failure.Category = category
		}
	}
	if failure.Category != CategoryInvalidParams {
		return
	}
	if category, ok := categoryFromProviderMessage(fields.Message); ok {
		switch category {
		case CategoryContextTooLong, CategoryInputInaccessible, CategoryInputTooLarge, CategoryModelMissing:
			failure.Category = category
		}
	}
}

func specializeThinkingToolChoice(failure *Failure, fields extractedFields) {
	if failure.Category != CategoryInvalidParams {
		return
	}
	normalized := strings.ToLower(fields.Message + " " + fields.Code)
	if ((strings.Contains(normalized, "thinking") || strings.Contains(normalized, "reasoning")) && strings.Contains(normalized, "tool_choice")) || (strings.Contains(normalized, "tool_choice") && (strings.Contains(normalized, "not support") || strings.Contains(normalized, "unsupported"))) {
		failure.Category = CategoryInvalidParams
		failure.Reason = "The current model is in thinking or reasoning mode and does not support forced tool calls."
		failure.Action = "Please use automatic tools to select or replace non-thinking mode models instead"
	}
}

func referenceDurationCopy(text string) (categoryCopy, bool) {
	if copy, ok := referenceAudioCopy(text, false); ok {
		return copy, true
	}
	// 当前提示写法：哪一项、现在多少、要改到多少，动作沿用后端给出的那句。
	if m := regexp.MustCompile(`^((?:paragraph \d+)?(?:reference)?(?:audio|video)(?:『[^』]*』)?)The duration is (\d+(?:\.\d+)?) seconds[,. ] needs to be changed to ([^;;]+)[;;](.+?). ?$`).FindStringSubmatch(text); len(m) == 5 {
		return categoryCopy{Reason: fmt.Sprintf("%s lasts %s seconds", m[1], m[2]), Action: fmt.Sprintf("Need to be changed to %s; %s", m[3], m[4])}, true
	}
	if m := regexp.MustCompile(`^The output duration is ([\d.]+) seconds[,. ]The current model only supports ([^;;]+)[;;](.+?). ?$`).FindStringSubmatch(text); len(m) == 4 {
		return categoryCopy{Reason: fmt.Sprintf("The output duration is %s seconds", m[1]), Action: fmt.Sprintf("The current model only supports %s; %s", m[2], m[3])}, true
	}
	if m := regexp.MustCompile(`^The (\d+) paragraph reference (audio|video) duration is (\d+(?:\.\d+)?) seconds[,. ] takes (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) seconds`).FindStringSubmatch(text); len(m) == 6 {
		return categoryCopy{Reason: fmt.Sprintf("The length of segment %s reference %s is %s seconds.", m[1], m[2], m[3]), Action: fmt.Sprintf("It takes %s–%s seconds; please crop or replace this material before submitting", m[4], m[5])}, true
	}
	if m := regexp.MustCompile(`^The duration of paragraph (\d+) reference (audio | video) cannot be read`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: fmt.Sprintf("The duration of segment %s reference %s cannot be read.", m[1], m[2]), Action: "Please re-import the material before submitting"}, true
	}
	if m := regexp.MustCompile(`^The reference material duration does not meet the model requirements. Please check each reference audio and video and adjust the non-compliant material to (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) seconds`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: "The duration of the reference material does not meet the model requirements", Action: fmt.Sprintf("Please check each reference audio and video, adjust the material that does not meet the requirements to %s–%s seconds and resubmit.", m[1], m[2])}, true
	}
	return categoryCopy{}, false
}

func specializeMediaConstraints(failure *Failure, fields extractedFields) {
	if failure.Category != CategoryUnknown && failure.Category != CategoryInvalidParams && failure.Category != CategoryInputTooLarge && failure.Category != CategoryInputInaccessible {
		return
	}
	message := promptEchoPattern.ReplaceAllString(fields.Message, "")
	if strings.EqualFold(fields.Code, "reference_unavailable") {
		failure.Category = CategoryInputInaccessible
		failure.Reason = firstNonEmpty(sanitizeProviderText(message), "The reference material cannot be read at the moment.")
		failure.Action = "Please try again later, or re-upload the reference material and try again"
		return
	}
	if strings.EqualFold(fields.Code, "invalid_upscale_source") {
		lower := strings.ToLower(message)
		if strings.Contains(lower, "video") {
			failure.Category = CategoryInvalidParams
			failure.Reason = "Super resolution video material does not meet the requirements"
			failure.Action = "Please try again with a valid MP4/MOV video within 5 minutes and 200MB."
			return
		}
		if strings.Contains(lower, "image") {
			failure.Category = CategoryInvalidParams
			failure.Reason = "Super score picture material does not meet the requirements"
			failure.Action = "Please use a JPEG/PNG/WebP image within 30MB and no more than 32 million pixels and try again."
			return
		}
	}
	if failure.Category == CategoryInvalidParams || failure.Category == CategoryUnknown {
		if copy, ok := persistedTaskConstraintCopy(message); ok {
			failure.Category, failure.Reason, failure.Action = CategoryInvalidParams, copy.Reason, copy.Action
			requestID, taskID := persistedReferenceIDs(message)
			if failure.RequestID == "" {
				failure.RequestID = requestID
			}
			if failure.TaskID == "" {
				failure.TaskID = taskID
			}
			return
		}
		if copy, ok := taskConstraintCopy(fields.Code + " " + message); ok {
			failure.Category, failure.Reason, failure.Action = CategoryInvalidParams, copy.Reason, copy.Action
			return
		}
	}
	if copy, ok := referenceMediaConstraintCopy(message); ok {
		if strings.Contains(copy.Reason, "过大") {
			failure.Category = CategoryInputTooLarge
		} else {
			failure.Category = CategoryInvalidParams
		}
		failure.Reason = copy.Reason
		failure.Action = copy.Action
		return
	}
	if match := heightRangePattern.FindStringSubmatch(message); len(match) == 3 {
		failure.Category = CategoryInvalidParams
		failure.Reason = "The height of the reference material does not meet the model requirements"
		failure.Action = fmt.Sprintf("Please adjust the height to %s–%s pixels and resubmit.", match[1], match[2])
		return
	}
	if match := widthRangePattern.FindStringSubmatch(message); len(match) == 3 {
		failure.Category = CategoryInvalidParams
		failure.Reason = "The width of the reference material does not meet the model requirements"
		failure.Action = fmt.Sprintf("Please adjust the width to %s–%s pixels and resubmit.", match[1], match[2])
		return
	}
	if match := aspectRangePattern.FindStringSubmatch(message); len(match) == 3 {
		failure.Category = CategoryInvalidParams
		failure.Reason = "The aspect ratio of the reference material does not meet the model requirements"
		failure.Action = fmt.Sprintf("Please adjust the aspect ratio to %s–%s and resubmit.", match[1], match[2])
		return
	}
	if match := pixelRangePattern.FindStringSubmatch(message); len(match) == 3 {
		failure.Category = CategoryInvalidParams
		failure.Reason = "The total number of pixels in the reference material does not meet the model requirements."
		failure.Action = fmt.Sprintf("Please adjust the width × height of the reference material to %s–%s pixels; modifying the generated resolution will not change the reference material.", match[1], match[2])
		return
	}
	if requestTooLargePattern.MatchString(message) || strings.EqualFold(fields.Code, "video_request_body_too_large") || strings.HasPrefix(message, "The amount of data requested exceeds the upper limit of the interface") {
		failure.Category = CategoryInputTooLarge
		failure.Reason = "The amount of data requested exceeds the upper limit of the interface"
		failure.Action = "Please reduce the number of reference materials or use publicly accessible material links before submitting."
		return
	}
	if singleFileTooLargePattern.MatchString(message) {
		failure.Category = CategoryInputTooLarge
		failure.Reason = "Single reference file is too large"
		failure.Action = "Please compress or replace the material before submitting it"
	}
}

func referenceMediaConstraintCopy(text string) (categoryCopy, bool) {
	text = strings.SplitN(strings.TrimSpace(text), ". Check number:", 2)[0]
	text, _ = stripGatewayRequestIDSuffix(text)
	if strings.HasPrefix(text, "The current channel requires online material links:") {
		reason, action, _ := strings.Cut(text, "。")
		return categoryCopy{Reason: reason, Action: action}, true
	}
	if strings.Contains(text, "The current model protocol requires public network material address") || strings.Contains(text, "Reference material for the current JSON video protocol cannot use embedded data") {
		return categoryCopy{Reason: "The current channel does not support the direct use of local materials.", Action: "Please use an accessible HTTPS asset link, or choose a channel that supports local assets"}, true
	}
	if strings.HasPrefix(text, "The current channel does not support the direct use of local materials.") {
		return categoryCopy{Reason: "The current channel does not support the direct use of local materials.", Action: "Please use an accessible HTTPS asset link, or choose a channel that supports local assets"}, true
	}
	if m := regexp.MustCompile(`^(Current model (?: Reference (?: Picture | Picture | Video | Audio) | (?: Support at most | At least required) \d+ (?: Zhang | Piece | Segment)? Reference (?: Picture | Picture | Video | Audio) | Only reference audio is not supported))[,. ](Please [^\n]+?)[. .]?$`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: m[1], Action: m[2]}, true
	}
	if m := regexp.MustCompile(`^(\d+th reference video frame rate cannot be read)`).FindStringSubmatch(text); len(m) == 2 {
		return categoryCopy{Reason: m[1], Action: "Please re-export the MP4/MOV video before uploading, making sure the file is complete and contains a valid video track"}, true
	}
	if m := regexp.MustCompile(`^(The average frame rate of the \d+th reference video is \d+(?:\.\d+)? FPS)[,. ](?:Required | Please re-export the reference video as )(\d+)–(\d+) FPS`).FindStringSubmatch(text); len(m) == 4 {
		return categoryCopy{Reason: m[1], Action: "Please re-export the reference video as" + m[2] + "–" + m[3] + " Submit after FPS"}, true
	}
	if m := regexp.MustCompile(`(?i)^(?:素材转换失败:\s*)?(?:frame rate|framerate|fps) must be between (\d+(?:\.\d+)?)\s*(?:fps)? and (\d+(?:\.\d+)?)[.\s]*$`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: "The frame rate of the reference video does not meet the requirements", Action: "Please re-export the reference video as" + m[1] + "–" + m[2] + " Submit after FPS"}, true
	}
	if strings.HasPrefix(text, "The reference video frame rate does not meet the requirements. Please re-export the reference video as") {
		parts := strings.SplitN(text, "。", 2)
		return categoryCopy{Reason: parts[0], Action: parts[1]}, true
	}
	if regexp.MustCompile(`(?i)^(?:(?:material conversion failed:\s*)?(?:unsupported (?:video |audio )?codec|(?:video |audio )?codec (?:is )?not supported)[.\s]*$|The reference material encoding is not supported by the current model.)`).MatchString(text) {
		return categoryCopy{Reason: "Reference material encoding is not supported by the current model", Action: "Please re-export the video to the common H.264 MP4 and the audio to MP3 or WAV before replacing the material; just modifying the file suffix will not work."}, true
	}
	if regexp.MustCompile(`(?i)^(?:asset (?:is )?(?:not ready|still processing)[.\s]*$|The reference material is still being processed.)`).MatchString(text) {
		return categoryCopy{Reason: "Reference material is still being processed", Action: "Please confirm and process the material library before generating it again. Do not upload or submit repeatedly."}, true
	}
	if regexp.MustCompile(`(?i)^(?:asset (?:access denied|permission denied|forbidden)[.\s]*$|无权访问参考素材。)`).MatchString(text) {
		return categoryCopy{Reason: "No access to reference material", Action: "Please use the account and channel that uploaded the material, or re-upload the original file; check the material permissions, no need to modify the prompt word"}, true
	}
	if m := regexp.MustCompile(`^(The total number of pixels in the reference material does not meet the model requirements). ((?: Please adjust the width × height of the reference material to) \d+–\d+ pixels[^{}]*)$`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: m[1], Action: m[2]}, true
	}

	if m := regexp.MustCompile(`^(The \d+th reference video (?:cannot be read|the format or address is not supported|the file is too large|the dimensions are \d+×\d+|the duration is \d+(?:\.\d+)? seconds|the total number of pixels is \d+(\d+×\d+)))[. ]([^{}]+)$`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: m[1], Action: m[2]}, true
	}

	if m := regexp.MustCompile(`^The reference material (width|height|aspect ratio) does not meet the model requirements. Please adjust (?:width|height|aspect ratio) to (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)( pixels | ) and resubmit`).FindStringSubmatch(text); len(m) == 5 {
		return categoryCopy{Reason: "Reference material" + m[1] + "Does not meet model requirements", Action: "please change" + m[1] + "Adjust to" + m[2] + "–" + m[3] + m[4] + "resubmit"}, true
	}
	if m := regexp.MustCompile(`^(\d+th reference video is \d+(?:\.\d+)? seconds) and takes (\d+)–(\d+) seconds`).FindStringSubmatch(text); len(m) == 4 {
		return categoryCopy{Reason: m[1], Action: "Please crop or replace this reference video with" + m[2] + "–" + m[3] + " seconds"}, true
	}
	if m := regexp.MustCompile(`^The (\d+) reference video[::]?(?:Reference video)?(?:Size|Duration)?(?:Download failed|Cannot read|Cannot read completely|Data cannot be read|Failed to read segmented|Changed during reading|Duration cannot be read|Dimensions cannot be read)`).FindStringSubmatch(text); len(m) == 2 {
		return categoryCopy{Reason: "No." + m[1] + " reference videos cannot be read", Action: "Please check the material link, or re-export the MP4/MOV file and import it"}, true
	}
	if m := regexp.MustCompile(`^The (\d+) reference video[::]?(?:reference video)?needs to be used`).FindStringSubmatch(text); len(m) == 2 {
		return categoryCopy{Reason: "No." + m[1] + " The reference video format or address is not supported", Action: "Please import an MP4/MOV file or use a publicly accessible HTTP/HTTPS video link"}, true
	}
	if m := regexp.MustCompile(`^The (\d+)th reference video[::]?(?:reference video)?The file cannot exceed (\d+)MB`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: "No." + m[1] + " Reference video file is too large", Action: "Please compress to" + m[2] + "Within MB or change the material"}, true
	}
	if m := regexp.MustCompile(`^(The \d+th reference video size is \d+×\d+), and the width and height need to be between (\d+)–(\d+) pixels`).FindStringSubmatch(text); len(m) == 4 {
		return categoryCopy{Reason: m[1], Action: "Please adjust the width and height of this reference video to" + m[2] + "–" + m[3] + " Pixel"}, true
	}
	if m := regexp.MustCompile(`^(The reference of \d+ (?:Picture|Video|Audio)(?:Width|Height|Aspect Ratio|Duration) is \d+(?:\.\d+)?(?: Pixels|Seconds)?)[,. ]requires ((?:at least | no more than) \d+(?:\.\d+)?(?: pixels | seconds)?)`).FindStringSubmatch(text); len(m) == 3 {
		action := "Please adjust the size or replace before submitting"
		if strings.Contains(m[1], "时长") {
			action = "Please crop or replace this material before submitting"
		}
		return categoryCopy{Reason: m[1], Action: "need" + m[2] + "；" + action}, true
	}
	if m := regexp.MustCompile(`^The (\d+) (piece|section) reference (picture|video|audio) (width|height) is (\d+) pixels[,. ] requires (\d+)–(\d+) pixels`).FindStringSubmatch(text); len(m) == 8 {
		return categoryCopy{Reason: fmt.Sprintf("The %s %s reference %s%s is the %s pixel", m[1], m[2], m[3], m[4], m[5]), Action: fmt.Sprintf("Requires %s–%s pixels; please resize or replace before submitting", m[6], m[7])}, true
	}
	if m := regexp.MustCompile(`^No. (\d+) (Zhang|Piece|Paragraph) Reference (Picture|Video|Audio) The aspect ratio is (\d+(?:\.\d+)?)[,. ]Requires (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)`).FindStringSubmatch(text); len(m) == 7 {
		return categoryCopy{Reason: fmt.Sprintf("The %s %s reference %s aspect ratio is %s", m[1], m[2], m[3], m[4]), Action: fmt.Sprintf("Requires %s–%s; please adjust the size or replace before submitting", m[5], m[6])}, true
	}
	if m := regexp.MustCompile(`^(The total number of pixels in the reference (?:Picture|Video|Audio) of \d+ (?:Picture|Video|Audio) is \d+ (\d+×\d+)), requiring ([^;]+) pixels`).FindStringSubmatch(text); len(m) == 3 {
		return categoryCopy{Reason: m[1], Action: fmt.Sprintf("Requires %s pixels; please adjust the size of this material or replace the original file. Modifying the generated resolution will not change the reference material.", m[2])}, true
	}
	if m := regexp.MustCompile(`^(\d+th reference video size cannot be read)`).FindStringSubmatch(text); len(m) == 2 {
		return categoryCopy{Reason: m[1], Action: "Please re-export MP4/MOV and then import"}, true
	}
	if m := regexp.MustCompile(`^No. (\d+) (sheet|piece|segment) reference (picture|video|audio) total pixels`).FindStringSubmatch(text); len(m) == 4 {
		return categoryCopy{Reason: fmt.Sprintf("The total number of pixels of reference %s %s and %s does not meet the current model requirements.", m[1], m[2], m[3]), Action: "Please adjust the size or replace before submitting"}, true
	}
	if m := regexp.MustCompile(`^No. (\d+) (pieces | paragraphs) reference (pictures | video | audio) file is too large [,. ]The current upper limit of a single model file is ([^;;]+)`).FindStringSubmatch(text); len(m) == 5 {
		return categoryCopy{Reason: fmt.Sprintf("No. %s %s reference %s file is too large", m[1], m[2], m[3]), Action: fmt.Sprintf("The current upper limit of a single model file is %s; please compress or replace it before submitting.", m[4])}, true
	}
	if strings.HasPrefix(text, "The total number of reference materials requested is too large") {
		return categoryCopy{Reason: "The total number of reference materials requested is too large", Action: "Please reduce the number of materials before submitting"}, true
	}
	return categoryCopy{}, false
}

func specializeDurationRange(failure *Failure, fields extractedFields) {
	if failure.Category != CategoryInvalidParams {
		return
	}
	// Only a provider's explicit numeric range with units becomes advice. Prompt
	// echoes are excluded so user input cannot invent a model constraint.
	message := promptEchoPattern.ReplaceAllString(fields.Message, "")
	match := durationRangePattern.FindStringSubmatch(message)
	if len(match) != 5 {
		return
	}
	minimum, maximum := firstNonEmpty(match[1], match[3]), firstNonEmpty(match[2], match[4])
	minValue, minErr := strconv.ParseFloat(minimum, 64)
	maxValue, maxErr := strconv.ParseFloat(maximum, 64)
	if minErr != nil || maxErr != nil || minValue < 0 || minValue >= maxValue || maxValue > 86400 {
		return
	}
	failure.Reason = "The video length does not meet the model requirements"
	failure.Action = fmt.Sprintf("Please adjust the duration to %s–%s seconds and try again.", minimum, maximum)
	if strings.Contains(message, "素材") || strings.Contains(strings.ToLower(message), "reference") || strings.Contains(strings.ToLower(message), "audio") {
		failure.Reason = "The duration of the reference material does not meet the model requirements"
		failure.Action = fmt.Sprintf("Please check each reference audio and video, adjust the material that does not meet the requirements to %s–%s seconds and resubmit.", minimum, maximum)
	}
}

func isNetworkText(value string) bool {
	return regexp.MustCompile(`(?i)\b(?:dial tcp|connection refused|connection reset|forcibly closed by the remote host|software caused connection abort|connection was aborted by the software in your host machine|wsaeconnreset|wsaeconnaborted|no such host|i/o timeout|network error|failed to fetch|fetch failed|socket hang up|econnrefused|econnreset|etimedout|连接模型服务失败)\b`).MatchString(value)
}

// Only canonical local error sentences qualify, after structured upstream errors
// have been classified. Request echoes must never become local policy failures.
func outboundPolicyCopy(message string) (categoryCopy, bool) {
	message, _, _ = strings.Cut(strings.TrimSpace(message), "。")
	switch message {
	case "Do not allow access to link-local, unspecified, or multicast addresses":
		return categoryCopy{
			Reason: "The model service address is blocked by the outbound security policy",
			Action: "This address belongs to the link local or cloud host metadata network segment, and the allow list cannot release it. Please use a loopback or LAN address instead",
		}, true
	case "Access to this machine or intranet address is not allowed", "Access to local machine, intranet or link-local address is not allowed", "Access to reserved or special purpose addresses is not allowed":
		return categoryCopy{
			Reason: "The model service address is blocked by the outbound security policy",
			Action: "Please check the service address of the channel; if you need to connect to a trusted local or intranet service, please contact the administrator to only add the host to the allow list and then restart the service.",
		}, true
	case "External service domain name resolution failed":
		return categoryCopy{
			Reason: "Model service domain name resolution failed",
			Action: "Please check whether the domain name in the channel service address is correct, and confirm that the device running BeefTV can connect to the Internet and resolve the domain name normally",
		}, true
	}
	return categoryCopy{}, false
}

func isMalformedText(value string) bool {
	return regexp.MustCompile(`(?i)(?: The interface returns non-JSON|No valid JSON is returned|invalid character|unexpected end of json|<!doctype|<html)`).MatchString(value)
}

func isDownloadText(value string) bool {
	return strings.Contains(value, "视频结果下载失败") || strings.Contains(value, "下载失败") && strings.Contains(value, "结果")
}

func isCancelledText(value string) bool {
	return strings.Contains(value, "任务已取消") || strings.Contains(value, "请求已取消") || strings.Contains(strings.ToLower(value), "context canceled")
}

func isResultsMissingText(value string) bool {
	return strings.Contains(value, "没有返回图片") || strings.Contains(value, "没有返回视频") || strings.Contains(value, "没有可用结果") || strings.Contains(value, "接口没有返回")
}

func applyTerminalMessageCategory(failure *Failure, message string) bool {
	switch {
	case isNetworkText(message):
		failure.Category = CategoryNetwork
		return true
	case isDownloadText(message):
		failure.Category = CategoryDownloadFailed
		failure.Uncertain = true
		return true
	case isCancelledText(message):
		failure.Category = CategoryCancelled
		return true
	case isResultsMissingText(message):
		failure.Category = CategoryResultsMissing
		return true
	default:
		return false
	}
}

func matchPersistedCategory(text string) FailureCategory {
	if strings.HasPrefix(text, "当前账号额度不足") {
		return CategoryQuotaUser
	}
	if strings.HasPrefix(text, "The prompt word or reference material did not pass the content security review") {
		return CategoryModerationInput
	}
	if strings.HasPrefix(text, "The video length does not meet the model requirements") {
		return CategoryInvalidParams
	}
	for category, copyText := range categoryCopies {
		if category == CategoryUnknown {
			continue
		}
		if strings.HasPrefix(text, copyText.Reason) {
			return category
		}
	}
	if strings.Contains(text, "真人形象") {
		return CategoryModerationReference
	}
	if strings.Contains(text, "Forced tool calls are not supported") {
		return CategoryInvalidParams
	}
	if strings.Contains(text, "May still be executed on the server side") || strings.Contains(text, "请勿立即重试") {
		return CategoryTimeout
	}
	return CategoryUnknown
}

var (
	infrastructureTextPattern    = regexp.MustCompile(`(?i)(?:Interface request failed|Request failed with status code|status(?:[_\s]+code)?\s*[:=]|Bad Gateway|Service Unavailable|Gateway Timeout|upstream_error|Material conversion failed:|No channel available|No channel available yet)`)
	persistedReferenceItemPrefix = regexp.MustCompile(`^Reference(?:picture|picture|video|audio|material) \d+：`)
)

func userFacingChineseCopy(raw string) (categoryCopy, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || htmlBodyPattern.MatchString(trimmed) || strings.ContainsAny(trimmed, "{}<>") {
		return categoryCopy{}, false
	}
	if urlPattern.MatchString(trimmed) || signedQueryPattern.MatchString(trimmed) || credentialHeaderPattern.MatchString(trimmed) || secretPattern.MatchString(trimmed) || promptEchoPattern.MatchString(trimmed) || diagnosticLocalPath.MatchString(trimmed) {
		return categoryCopy{}, false
	}
	if localDatabaseErrorPattern.MatchString(trimmed) || isLocalDiskFullMessage(trimmed) || infrastructureTextPattern.MatchString(trimmed) {
		return categoryCopy{}, false
	}
	if _, policy := outboundPolicyCopy(trimmed); policy {
		return categoryCopy{}, false
	}
	trimmed = strings.SplitN(trimmed, ". Check number:", 2)[0]
	trimmed, _ = stripGatewayRequestIDSuffix(trimmed)
	clean := sanitizeProviderText(trimmed)
	if clean == "" || strings.Contains(clean, "[已隐藏]") || strings.Contains(clean, "[路径已隐藏]") || !looksLikeUserFacingChinese(clean) {
		return categoryCopy{}, false
	}
	clean = strings.TrimSpace(strings.TrimRight(clean, "。"))
	switch clean {
	case "", "Request failed", "Operation failed", "Build failed", "Task failed", "Stopped", "call failed", "unknown error", "Parameter error", "Request parameter error", "Invalid parameter", "Invalid parameter", "Model service request failed":
		return categoryCopy{}, false
	}
	if clean == categoryCopies[CategoryUnknown].Reason+"。"+categoryCopies[CategoryUnknown].Action {
		return categoryCopy{}, false
	}
	if isNetworkText(clean) || isDownloadText(clean) || isCancelledText(clean) || isResultsMissingText(clean) {
		return categoryCopy{}, false
	}
	hanCount := 0
	for _, r := range clean {
		if unicode.Is(unicode.Han, r) {
			hanCount++
		}
	}
	if hanCount < 6 && !strings.ContainsAny(clean, "。，；：") {
		return categoryCopy{}, false
	}
	if reason, action, ok := strings.Cut(clean, "。"); ok && strings.TrimSpace(action) != "" {
		return categoryCopy{Reason: strings.TrimSpace(reason), Action: strings.TrimSpace(action)}, true
	}
	for _, sep := range []string{", please", ";please"} {
		if left, right, ok := strings.Cut(clean, sep); ok && strings.TrimSpace(left) != "" {
			return categoryCopy{Reason: strings.TrimSpace(left), Action: "please" + strings.TrimSpace(right)}, true
		}
	}
	return categoryCopy{Reason: clean}, true
}

func isActionableParameterCopy(copy categoryCopy) bool {
	reason := strings.TrimSpace(copy.Reason)
	action := strings.TrimSpace(copy.Action)
	for _, prefix := range []string{"please wait", "Please check", "Please inquire first", "Please contact support", "Please try again", "Click \""} {
		if strings.HasPrefix(action, prefix) {
			return false
		}
	}
	for _, generic := range []string{"Build failed", "Request failed", "Operation failed", "Task failed", "call failed", "Model service request failed", "Temporarily unavailable", "Service is busy", "System is busy", "Frequency", "Frequently", "Current limiting", "Concurrency"} {
		if strings.Contains(reason, generic) {
			return false
		}
	}
	hasSubject := false
	for _, subj := range []string{"model", "Reference", "Material", "pictures", "video", "Audio", "first frame", "last frame", "First and last frames", "File", "parameters", "Size", "resolution", "Proportion", "duration", "Frame rate", "encoding", "Format", "prompt word", "Unrecognized"} {
		if strings.Contains(reason, subj) {
			hasSubject = true
			break
		}
	}
	if !hasSubject {
		return false
	}
	for _, verb := range []string{"adjust", "reduce", "Replace", "Crop", "Re-export", "upload", "Remove", "Modify", "shorten", "Compression", "For pictures", "For video", "for audio"} {
		if strings.Contains(action, verb) {
			return true
		}
	}
	if action == "" {
		for _, kw := range []string{"Not supported", "Only supports", "Only supports", "Most supported", "At least required", "File not recognized"} {
			if strings.Contains(reason, kw) {
				return true
			}
		}
	}
	return false
}

func looksLikeUserFacingChinese(value string) bool {
	for _, r := range value {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func applyRetryable(failure *Failure) {
	switch failure.Category {
	case CategoryThrottled, CategoryProviderUnavailable, CategoryNetwork, CategoryTimeout, CategoryConcurrency, CategoryRequestNotSent:
		failure.Retryable = !failure.Uncertain
	default:
		failure.Retryable = false
	}
}
