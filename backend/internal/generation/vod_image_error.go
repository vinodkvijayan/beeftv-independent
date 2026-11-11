package generation

import "strings"

var vodImageCopies = map[string]Failure{
	"capacity":        {Category: FailureCategory("concurrency"), Reason: "Image service is currently busy", Action: "Please try again later", Uncertain: false},
	"rate":            {Category: FailureCategory("throttled"), Reason: "Image service requests are too frequent", Action: "Please try again later", Uncertain: false},
	"channel_auth":    {Category: FailureCategory("permission"), Reason: "The current image service has not been authorized", Action: "Please contact support to check channel permissions and try again", Uncertain: false},
	"channel_config":  {Category: FailureCategory("permission"), Reason: "The current image service configuration is incorrect", Action: "Please contact support to check the service configuration and try again", Uncertain: false},
	"input_missing":   {Category: FailureCategory("input_inaccessible"), Reason: "The reference material does not exist or is no longer accessible", Action: "Please check and replace the reference material before regenerating", Uncertain: false},
	"invalid_params":  {Category: FailureCategory("invalid_params"), Reason: "Image generation parameters do not meet requirements", Action: "Please check the model, size, format and quantity before trying again", Uncertain: false},
	"invalid_media":   {Category: FailureCategory("invalid_params"), Reason: "The reference material format is not supported by the current model", Action: "Please convert the image format and replace the reference material", Uncertain: false},
	"duplicate":       {Category: FailureCategory("submission_uncertain"), Reason: "Detected that the same image task already exists", Action: "Please check the original task results first and do not submit again.", Uncertain: true},
	"create_unknown":  {Category: FailureCategory("submission_uncertain"), Reason: "It has not been confirmed whether the picture task was created successfully", Action: "Please contact support to verify the original task and do not submit it again.", Uncertain: true},
	"task_internal":   {Category: FailureCategory("async_failed"), Reason: "Image task failed due to model service internal error", Action: "Please keep the troubleshooting information and contact support to check the results before deciding whether to regenerate it.", Uncertain: false},
	"task_failed":     {Category: FailureCategory("async_failed"), Reason: "The model failed to complete this image generation", Action: "Please retain the troubleshooting information and contact support to check the cause before deciding whether to regenerate it.", Uncertain: false},
	"task_timeout":    {Category: FailureCategory("timeout"), Reason: "Image task execution timeout", Action: "Please contact support to check the original task results and do not regenerate immediately.", Uncertain: true},
	"cancelled":       {Category: FailureCategory("cancelled"), Reason: "Image task canceled", Action: "If you still need to generate it, please confirm and resubmit.", Uncertain: false},
	"query_failed":    {Category: FailureCategory("submission_uncertain"), Reason: "Temporarily unable to query image task results", Action: "Please check the original task later and do not submit it again", Uncertain: true},
	"query_rejected":  {Category: FailureCategory("submission_uncertain"), Reason: "The original image task query was rejected by the service", Action: "Please contact support to fix the query and do not submit it again.", Uncertain: true},
	"query_missing":   {Category: FailureCategory("submission_uncertain"), Reason: "The original image task cannot be found at the moment", Action: "Please contact support to check the task record and do not submit it repeatedly.", Uncertain: true},
	"query_auth":      {Category: FailureCategory("submission_uncertain"), Reason: "The image service does not have the right to query the original task at the moment.", Action: "Please contact support to check channel permissions and resume the query. Do not submit again.", Uncertain: true},
	"unknown":         {Category: FailureCategory("submission_uncertain"), Reason: "The result of the picture task has not yet been confirmed", Action: "Please check the original task first or contact support for verification. Do not submit again.", Uncertain: true},
	"partial":         {Category: FailureCategory("partial_success"), Reason: "Some pictures have been generated, but not all tasks have been completed.", Action: "Please contact support to retrieve the image and then decide whether to re-do it.", Uncertain: true},
	"results_missing": {Category: FailureCategory("results_missing"), Reason: "Image task ended, but no available images were returned", Action: "Please contact support to verify the original task and do not submit it again.", Uncertain: true},
	"download_failed": {Category: FailureCategory("download_failed"), Reason: "The image was generated but failed to download", Action: "Please contact support to retrieve the original image, do not regenerate it", Uncertain: true},
	"request_large":   {Category: FailureCategory("input_too_large"), Reason: "The amount of data requested by the image exceeds the service limit", Action: "Please reduce the reference material or compress the image and try again", Uncertain: false},
	"unsupported":     {Category: FailureCategory("model_missing"), Reason: "The current image service does not support this request", Action: "Please contact support to check model, interface and locale settings", Uncertain: false},
	"response_large":  {Category: FailureCategory("submission_uncertain"), Reason: "The data returned by the image service exceeds the upper limit of the interface", Action: "Please contact support to retrieve the results and do not submit again.", Uncertain: true},
	"source_busy":     {Category: FailureCategory("input_inaccessible"), Reason: "The resources required for the image task are being occupied", Action: "Please confirm that the reference material is available before trying again", Uncertain: false},
	"dry_run":         {Category: FailureCategory("invalid_params"), Reason: "This is a service check and no image generation is performed.", Action: "Please contact support to check the channel configuration and try again", Uncertain: false},
	"moderation":      {Category: FailureCategory("moderation_input"), Reason: "The prompt word or reference material did not pass the content security review", Action: "Please adjust the prompt words or reference materials and regenerate", Uncertain: false},
}

var vodImageStageCodes = map[string]map[string]string{
	"create": {
		"FailedOperation":                                   "create_unknown",
		"FailedOperation.InvalidVodUser":                    "channel_config",
		"InternalError":                                     "create_unknown",
		"InvalidParameter":                                  "invalid_params",
		"InvalidParameterValue.FileId":                      "input_missing",
		"InvalidParameterValue.SessionContextTooLong":       "channel_config",
		"InvalidParameterValue.SessionId":                   "duplicate",
		"InvalidParameterValue.SessionIdTooLong":            "channel_config",
		"InvalidParameterValue.SubAppId":                    "channel_config",
		"LimitExceeded.Quota":                               "capacity",
		"UnauthorizedOperation":                             "channel_auth",
		"ActionOffline":                                     "unsupported",
		"AuthFailure":                                       "channel_auth",
		"AuthFailure.InvalidAuthorization":                  "channel_auth",
		"AuthFailure.InvalidSecretId":                       "channel_auth",
		"AuthFailure.MFAFailure":                            "channel_auth",
		"AuthFailure.SecretIdNotFound":                      "channel_auth",
		"AuthFailure.SignatureExpire":                       "channel_auth",
		"AuthFailure.SignatureFailure":                      "channel_auth",
		"AuthFailure.TokenFailure":                          "channel_auth",
		"AuthFailure.UnauthorizedOperation":                 "channel_auth",
		"DryRunOperation":                                   "dry_run",
		"InvalidAction":                                     "unsupported",
		"InvalidParameterValue":                             "invalid_params",
		"InvalidRequest":                                    "invalid_params",
		"IpInBlacklist":                                     "channel_auth",
		"IpNotInWhitelist":                                  "channel_auth",
		"LimitExceeded":                                     "capacity",
		"MissingParameter":                                  "invalid_params",
		"NoSuchProduct":                                     "unsupported",
		"NoSuchVersion":                                     "unsupported",
		"RequestLimitExceeded":                              "rate",
		"RequestLimitExceeded.GlobalRegionUinLimitExceeded": "rate",
		"RequestLimitExceeded.IPLimitExceeded":              "rate",
		"RequestLimitExceeded.UinLimitExceeded":             "rate",
		"RequestSizeLimitExceeded":                          "request_large",
		"ResourceInUse":                                     "source_busy",
		"ResourceInsufficient":                              "capacity",
		"ResourceNotFound":                                  "input_missing",
		"ResourceUnavailable":                               "capacity",
		"ResponseSizeLimitExceeded":                         "response_large",
		"ServiceUnavailable":                                "capacity",
		"UnknownParameter":                                  "invalid_params",
		"UnsupportedOperation":                              "unsupported",
		"UnsupportedProtocol":                               "unsupported",
		"UnsupportedRegion":                                 "unsupported",
		"InvalidParameter.VoilationContent":                 "moderation",
		"InvalidParameter.ViolationContent":                 "moderation",
		"ContentModerationFailed":                           "moderation",
	},
	"task": {
		"RequestLimitExceeded":              "capacity",
		"InvalidParameter.VoilationContent": "moderation",
		"InvalidParameter.ViolationContent": "moderation",
		"InvalidParameterValue":             "invalid_params",
		"FailedOperation":                   "capacity",
		"InternalError":                     "task_internal",
		"InvalidParameter":                  "invalid_params",
		"InvalidParameter.MediaFormat":      "invalid_media",
		"ContentModerationFailed":           "moderation",
		"ResourceInsufficient":              "capacity",
		"ModelGenerateFailed":               "task_failed",
		"ResourceNotFound":                  "input_missing",
		"OperationCanceled":                 "cancelled",
		"TaskTimeout":                       "task_timeout",
	},
}

// VOD's creation and task codes have different meanings. Outer structured errors
// stay authoritative; saved messages are recognized only by our complete copy.
func genericVODCode(code string) bool {
	code = normalizeCode(code)
	return genericProviderCode(code) || code == "bad_response" || code == "bad_response_body"
}

func vodImageErrorCopy(code, text string) (Failure, bool) {
	if code == "access_denied" && strings.HasPrefix(text, "Your request triggered an upstream content security policy, Category: Content Security") {
		copy := vodImageCopies["moderation"]
		copy.FromCode = true
		return copy, true
	}
	key := ""
	if strings.HasPrefix(code, "vod_image_") {
		key = strings.TrimPrefix(code, "vod_image_")
	}
	providerCode := code
	if _, ok := vodImageCopies[key]; !ok {
		key = ""
		for candidate, copy := range vodImageCopies {
			if strings.HasPrefix(text, copy.Reason+"。"+copy.Action+"。") && (genericVODCode(code) || code == string(copy.Category) || code == "image_result_unknown" && copy.Uncertain) {
				key = candidate
				break
			}
		}
	}
	if key == "" {
		if !genericVODCode(code) {
			return Failure{}, false
		}
		stage := "create"
		rest := strings.TrimSpace(text)
		if strings.HasPrefix(rest, "VOD image task failed [") {
			stage = "task"
			rest = strings.TrimPrefix(rest, "VOD image task failed [")
			value, _, ok := strings.Cut(rest, "]:")
			if !ok {
				return Failure{}, false
			}
			providerCode = value
		} else if strings.HasPrefix(rest, "VOD ") {
			value, _, ok := strings.Cut(strings.TrimPrefix(rest, "VOD "), ":")
			if !ok || strings.ContainsAny(value, " []") {
				return Failure{}, false
			}
			providerCode = value
		} else {
			return Failure{}, false
		}
		key = vodImageStageCodes[stage][providerCode]
		if stage == "task" && (providerCode == "" || providerCode == "ModelGenerateFailed") && (strings.Contains(strings.ToLower(text), "rejected by the safety system") || strings.Contains(strings.ToLower(text), "rejected as a result of our safety system") || strings.Contains(strings.ToLower(text), "rejected as a result of the safety system")) {
			key = "moderation"
		}
		if key == "" {
			if stage == "task" {
				key = "task_failed"
			} else {
				key = "create_unknown"
			}
		}
	}
	copy, ok := vodImageCopies[key]
	if !ok {
		return Failure{}, false
	}
	copy.ProviderCode = sanitizeProviderCode(providerCode)
	copy.Structured = true
	copy.FromCode = true
	return copy, true
}
