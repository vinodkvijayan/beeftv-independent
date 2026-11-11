package modelcatalog

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/providerpreset"
)

func videoDurationSupported(value *VideoCapabilityConfig) bool {
	return value == nil || value.DurationSupported == nil || *value.DurationSupported
}

func defaultVideoCapabilityConfig(protocol string, modelName string) *VideoCapabilityConfig {
	video := &VideoCapabilityConfig{
		References:        VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MinImages: 0, MaxImages: 9, MaxImageBytes: 30 * 1024 * 1024, MaxVideos: 0, MaxVideoBytes: 0, MaxVideoDuration: 0, MaxAudios: 0, MaxAudioBytes: 0, MaxAudioDuration: 0},
		Duration:          VideoDurationConfig{Selection: "range", Min: 1, Max: 15, Step: 1, Default: 6},
		Ratios:            []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
		DefaultRatio:      "16:9",
		Resolutions:       []string{"480p", "720p", "1080p", "1440p", "2160p"},
		DefaultResolution: "720p",
		GenerateAudio:     VideoBooleanConfig{Supported: false, Default: false},
		Watermark:         VideoBooleanConfig{Supported: false, Default: false},
		Operations:        []string{"text_to_video", "image_to_video"},
		DefaultOperation:  "text_to_video",
	}
	switch model.ChannelInterfaceType(protocol) {
	case model.ChannelInterfaceVolcengineJiMengVideo:
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5}
		video.Resolutions = []string{"720p"}
	case model.ChannelInterfaceGeminiVeo:
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 6, 8}, Default: 6}
		video.Resolutions = []string{"720p", "1080p"}
	case model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineArkAgentPlanVideo:
		video.Operations = append(video.Operations, "reference_to_video")
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.References.MinVideoDuration, video.References.MinAudioDuration = 2, 2
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
		video.Resolutions = []string{"480p", "720p", "1080p"}
		name := strings.ToLower(strings.TrimSpace(modelName))
		parts := strings.Split(name, "/")
		name = parts[len(parts)-1]
		if name == "dreamina-seedance-2-0-fast" || strings.HasPrefix(name, "dreamina-seedance-2-0-fast-") || name == "dreamina-seedance-2-0-mini" || strings.HasPrefix(name, "dreamina-seedance-2-0-mini-") {
			video.Resolutions = []string{"480p", "720p"}
		}
	case model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, "video-generations-json":
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		if model.ChannelInterfaceType(protocol) == model.ChannelInterfaceNewAPIChannel1 {
			video.Resolutions = []string{"480p", "720p", "1080p"}
		}
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceXAIVideo:
		video.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	case model.ChannelInterfaceNovitaVideo:
		video.References.MaxImages, video.References.MaxImageBytes = 1, 10*1024*1024
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5}
		video.Ratios = []string{"16:9", "9:16", "1:1"}
		video.Resolutions = []string{"1080p"}
		video.DefaultResolution = "1080p"
	case model.ChannelInterfaceMiniMaxVideo:
		video.Operations = append(video.Operations, "reference_to_video")
		video.References.MaxImages = 9
		video.References.MaxImageBytes = 30 * 1024 * 1024
		video.References.MaxVideos = 3
		video.References.MaxVideoBytes = 50 * 1024 * 1024
		video.References.MaxVideoDuration = 15
		video.References.MaxAudios = 3
		video.References.MaxAudioBytes = 15 * 1024 * 1024
		video.References.MaxAudioDuration = 15
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}, Default: 5}
		video.Ratios = []string{"adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
		video.DefaultRatio = "16:9"
		video.Resolutions = []string{"768P", "2K"}
		video.DefaultResolution = "768P"
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
	case model.ChannelInterfaceAgnesVideo:
		video = applyModelSpecificVideoCapability(video, protocol, modelName)
	case "full-video":
		is25 := strings.HasSuffix(strings.ToLower(strings.TrimSpace(modelName)), "2.5")
		video.References.MaxImages = 9
		video.References.MaxVideos = 3
		video.References.MaxAudios = 3
		video.References.MaxVideoDuration = 15
		video.References.MaxAudioDuration = 15
		video.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 15, Step: 1, Default: 5}
		video.Resolutions = []string{"480p", "720p", "1080p"}
		if is25 {
			video.References.MaxImages = 30
			video.References.MaxVideos = 10
			video.References.MaxAudios = 10
			video.References.MaxVideoDuration = 30
			video.References.MaxAudioDuration = 30
			video.Duration.Max = 30
			video.Resolutions = []string{"480p", "720p"}
		}
		video.References.MaxVideoBytes = 100_000_000
		video.References.MaxAudioBytes = 100_000_000
		video.References.MinVideoDuration = 2
		video.References.MinAudioDuration = 2
		video.DefaultResolution = "480p"
		video.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
	}
	if protocol == "video-generations-json" {
		video.Duration.Default = 5
		if isSeedance25Model(modelName) {
			video.Resolutions = []string{"480p", "720p", "1080p"}
		} else {
			video.Resolutions = []string{"720p", "1080p"}
		}
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
		video.Operations = appendUniqueString(video.Operations, "reference_to_video")
	}
	if protocol == string(model.ChannelInterfaceNewAPIChannel2) {
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
		if contract, ok := providerpreset.BeefTVVideoContract(modelName); ok && contract.Protocol == protocol && contract.RequiresHTTPReferences && len(contract.Operations) > 0 {
			video.Operations = append([]string(nil), contract.Operations...)
			for kind, limit := range contract.MaxReferences {
				switch kind {
				case "image":
					video.References.MaxImages = limit
				case "video":
					video.References.MaxVideos = limit
				case "audio":
					video.References.MaxAudios = limit
				}
			}
		} else {
			video.Operations = appendUniqueString(video.Operations, "reference_to_video")
		}
	}
	if isSeedance2Family(protocol, modelName) {
		if model.ChannelInterfaceType(protocol) == model.ChannelInterfaceNewAPIVideo {
			video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		}
		video.References = overlayOfficialSeedance2References(video.References, isSeedance25Model(modelName))
		// 输出时长下限官方是 4 秒：2.0 为 4~15，2.5 为 4~30。
		if video.Duration.Selection == "range" && video.Duration.Min < documentedSeedanceOutputMinSeconds {
			video.Duration.Min = documentedSeedanceOutputMinSeconds
			if video.Duration.Default < documentedSeedanceOutputMinSeconds {
				video.Duration.Default = documentedSeedanceOutputMinSeconds
			}
		}
		video.Operations = appendUniqueString(video.Operations, "reference_to_video")
		video.ReturnLastFrame = VideoBooleanConfig{Supported: true, Default: false}
		if isSeedance2FastOrMiniModel(modelName) {
			filtered := make([]string, 0, len(video.Resolutions))
			for _, value := range video.Resolutions {
				norm := strings.ToLower(strings.TrimSpace(value))
				if norm == "480p" || norm == "720p" {
					filtered = append(filtered, value)
				}
			}
			if len(filtered) == 0 {
				filtered = []string{"480p", "720p"}
			}
			video.Resolutions = filtered
			if !containsCapabilityString(video.Resolutions, video.DefaultResolution) {
				if containsCapabilityString(video.Resolutions, "720p") {
					video.DefaultResolution = "720p"
				} else {
					video.DefaultResolution = video.Resolutions[0]
				}
			}
		}
		if isSeedance25Model(modelName) {
			video.TaskTypeConstraints = true
			if containsCapabilityString(video.Resolutions, "480p") {
				video.Draft = VideoBooleanConfig{Supported: true, Default: false}
				video.Operations = appendUniqueString(video.Operations, "draft_to_final")
			}
			video.Operations = appendUniqueString(video.Operations, "audio_to_video")
			video.Operations = appendUniqueString(appendUniqueString(video.Operations, "inpaint"), "extend")
			video.Ratios = appendUniqueString(video.Ratios, "adaptive")
			if video.Duration.Selection == "range" && video.Duration.Max < 30 {
				video.Duration.Max = 30
			}
		}
	}
	if isNativeDreaminaSeedance(protocol, modelName) || (model.IsVolcengineArkVideoProtocol(model.ChannelInterfaceType(protocol)) && isSeedance25Model(modelName)) {
		video.Duration.Selection = "enum"
		video.Duration.Min = 4
		video.Duration.Values = []int{-1}
		for seconds := 4; seconds <= video.Duration.Max; seconds++ {
			video.Duration.Values = append(video.Duration.Values, seconds)
		}
		video.Ratios = appendUniqueString(video.Ratios, "adaptive")
		if isSeedance25Model(modelName) {
			video.Operations = appendUniqueString(appendUniqueString(video.Operations, "inpaint"), "extend")
		}
	}
	return video
}

func mergeDraftVideoCapability(fallback, raw *VideoCapabilityConfig) *VideoCapabilityConfig {
	if raw == nil {
		return fallback
	}
	result := *raw
	if fallback != nil {
		if result.Duration.Selection == "" {
			result.Duration = fallback.Duration
		}
		if len(result.Operations) == 0 {
			result.Operations = append([]string(nil), fallback.Operations...)
		}
		if strings.TrimSpace(result.DefaultOperation) == "" || !containsCapabilityString(result.Operations, result.DefaultOperation) {
			if len(result.Operations) > 0 {
				result.DefaultOperation = result.Operations[0]
			} else {
				result.DefaultOperation = fallback.DefaultOperation
			}
		}
	}
	if result.Draft.Supported {
		result.Operations = appendUniqueString(result.Operations, "draft_to_final")
	}
	return &result
}

func applyModelSpecificVideoCapability(profile *VideoCapabilityConfig, protocol string, modelName string) *VideoCapabilityConfig {
	if profile == nil {
		return profile
	}
	normalizedProtocol := strings.TrimSpace(protocol)
	normalizedModel := strings.ToLower(strings.TrimSpace(modelName))
	if model.ChannelInterfaceType(normalizedProtocol) != model.ChannelInterfaceAgnesVideo {
		return profile
	}
	if normalizedModel != "agnes-video-2.5" && normalizedModel != "agnes-video-2.5-flash" {
		return profile
	}
	value := *profile
	value.References = profile.References
	flash := normalizedModel == "agnes-video-2.5-flash"
	value.References.MaxImages = 9
	value.References.MaxVideos = 3
	value.References.MaxAudios = 3
	value.References.MaxVideoBytes = 200 * 1024 * 1024
	value.References.MaxVideoDuration = 15
	value.References.MaxAudioBytes = 15 * 1024 * 1024
	value.References.MaxAudioDuration = 15
	if flash {
		value.References.MaxImages = 5
		value.References.MaxVideos = 0
		value.References.MaxVideoBytes = 0
		value.References.MaxVideoDuration = 0
	}
	value.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 12, Step: 1, Default: 5}
	value.Ratios = []string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
	value.DefaultRatio = "16:9"
	value.Resolutions = []string{"720P", "960P", "2K"}
	if flash {
		value.Resolutions = []string{"720P"}
	}
	value.DefaultResolution = "720P"
	value.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	value.Watermark = VideoBooleanConfig{Supported: false, Default: false}
	value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	value.DefaultOperation = "text_to_video"
	return &value
}

func validateVideoCapabilityConfig(value *VideoCapabilityConfig) error {
	if value.References.PromptMaxChars < 0 || value.References.PromptMaxChars > 1000000 {
		return kernel.BadAuthRequest("The maximum number of characters in the prompt word must be between 0 and 1000000. 0 means that it will be verified by the service provider.")
	}
	if value.References.PromptMaxUTF16Units < 0 || value.References.PromptMaxUTF16Units > 1000000 {
		return kernel.BadAuthRequest("The maximum number of UTF-16 units of the prompt word must be between 0-1000000, 0 means it will be verified by the service provider")
	}
	for name, number := range map[string]int{"Minimum number of image citations": value.References.MinImages, "Maximum number of image citations": value.References.MaxImages, "Maximum number of video citations": value.References.MaxVideos, "Maximum number of audio references": value.References.MaxAudios} {
		if number < 0 || number > 100 {
			return kernel.BadAuthRequest(name + "Must be between 0-100")
		}
	}
	if value.References.MinImages > value.References.MaxImages {
		return kernel.BadAuthRequest("The minimum number of image references cannot exceed the maximum number of image references")
	}
	if value.References.MaxImageBytes < 0 || value.References.MaxVideoBytes < 0 || value.References.MaxAudioBytes < 0 || value.References.MaxVideoDuration < 0 || value.References.MaxAudioDuration < 0 || value.References.MinVideoDuration < 0 || value.References.MinAudioDuration < 0 || value.References.MaxAudioTotalDuration < 0 || value.References.MaxVideoTotalDuration < 0 {
		return kernel.BadAuthRequest("Reference material limit cannot be less than 0")
	}
	if value.References.MinImageWidth < 0 || value.References.MaxImageWidth < 0 || value.References.MinImageHeight < 0 || value.References.MaxImageHeight < 0 || value.References.MinVideoWidth < 0 || value.References.MaxVideoWidth < 0 || value.References.MinVideoHeight < 0 || value.References.MaxVideoHeight < 0 {
		return kernel.BadAuthRequest("The reference material size limit cannot be less than 0")
	}
	if value.References.MinImageAspect < 0 || value.References.MaxImageAspect < 0 || value.References.MinVideoAspect < 0 || value.References.MaxVideoAspect < 0 || value.References.MinImagePixels < 0 || value.References.MaxImagePixels < 0 || value.References.MinVideoPixels < 0 || value.References.MaxVideoPixels < 0 {
		return kernel.BadAuthRequest("Referenced footage aspect ratio or pixel limit cannot be less than 0")
	}
	if (value.References.MaxVideoDuration > 0 && value.References.MinVideoDuration > value.References.MaxVideoDuration) || (value.References.MaxAudioDuration > 0 && value.References.MinAudioDuration > float64(value.References.MaxAudioDuration)) {
		return kernel.BadAuthRequest("The minimum duration of quoted material cannot exceed the maximum duration")
	}
	if err := validateVideoDuration(value.Duration); err != nil {
		return err
	}
	if len(value.Ratios) == 0 {
		if strings.TrimSpace(value.DefaultRatio) != "" {
			return kernel.BadAuthRequest("The default ratio cannot be set when the aspect ratio is not configured.")
		}
	} else if strings.TrimSpace(value.DefaultRatio) == "" || !containsCapabilityString(value.Ratios, value.DefaultRatio) {
		return kernel.BadAuthRequest("The default aspect ratio must be among the supported values")
	}
	if len(value.Resolutions) == 0 {
		if strings.TrimSpace(value.DefaultResolution) != "" {
			return kernel.BadAuthRequest("Default resolution cannot be set when output resolution is not configured")
		}
	} else if strings.TrimSpace(value.DefaultResolution) == "" || !containsCapabilityString(value.Resolutions, value.DefaultResolution) {
		return kernel.BadAuthRequest("The default output resolution must be among the supported values")
	}
	if len(value.Operations) == 0 || strings.TrimSpace(value.DefaultOperation) == "" || !containsCapabilityString(value.Operations, value.DefaultOperation) {
		return kernel.BadAuthRequest("Please configure at least one build mode and select the default mode")
	}
	for operation, limits := range value.OperationReferences {
		if !containsCapabilityString(value.Operations, operation) {
			return kernel.BadAuthRequest("The generation mode corresponding to the reference material restriction does not exist")
		}
		for _, count := range []*int{limits.MinImages, limits.MaxImages, limits.MaxVideos, limits.MaxAudios} {
			if count != nil && (*count < 0 || *count > 100) {
				return kernel.BadAuthRequest("Reference material limit must be between 0-100")
			}
		}
		refs := videoReferencesForOperation(value, operation)
		if refs.MinImages > refs.MaxImages {
			return kernel.BadAuthRequest("The minimum number of image references cannot exceed the maximum number of image references")
		}
	}
	return nil
}

func validateVideoDuration(value VideoDurationConfig) error {
	switch value.Selection {
	case "range":
		if math.IsNaN(value.FractionalMin) || math.IsInf(value.FractionalMin, 0) || value.FractionalMin != 0 && (!value.Continuous || value.FractionalMin < .92 || value.FractionalMin > float64(value.Min)) {
			return kernel.BadAuthRequest("Invalid video decimal duration range")
		}
		if value.Min < 1 || value.Max < value.Min || value.Max > 3600 || value.Step < 1 || value.Default < value.Min || value.Default > value.Max || !value.Continuous && (value.Default-value.Min)%value.Step != 0 {
			return kernel.BadAuthRequest("Invalid video duration range or default value")
		}
	case "enum":
		if len(value.Values) == 0 || len(value.Values) > 100 {
			return kernel.BadAuthRequest("Video fixed duration requires at least one option")
		}
		values := append([]int(nil), value.Values...)
		sort.Ints(values)
		for index, item := range values {
			if (item < 1 && item != -1) || item > 3600 || (index > 0 && values[index-1] == item) {
				return kernel.BadAuthRequest("Video fixed duration option is invalid or duplicate")
			}
		}
		if !containsInt(values, value.Default) {
			return kernel.BadAuthRequest("Video default duration must be a fixed duration option")
		}
	default:
		return kernel.BadAuthRequest("The video duration selection method only supports range or fixed value")
	}
	return nil
}

// applyFixedVideoResolution 让单档位 SKU 的预扣、恢复和上游请求保持同一分辨率。
func applyFixedVideoResolution(input *TaskInput, profile *VideoCapabilityConfig) {
	if input == nil || profile == nil || len(profile.Resolutions) != 1 {
		return
	}
	if resolution := videoResolutionNameRequest(profile, profile.Resolutions[0]); resolution != "" {
		input.Config.VQuality = resolution
	}
}

func validateReferenceDuration(kind string, index int, durationMs int64, minimum, maximum float64) error {
	if minimum <= 0 && maximum <= 0 {
		return nil
	}
	if durationMs <= 0 {
		return kernel.BadAuthRequest(fmt.Sprintf("The duration of paragraph %d reference %s cannot be read. Please re-import the material before submitting.", index+1, kind))
	}
	// 按实际违反的是下限还是上限给建议：2–15 秒的限制下，16 秒的素材要往短改。
	tooShort := durationMs < durationLimitMs(minimum)
	if tooShort || (maximum > 0 && durationMs > durationLimitMs(maximum)) {
		return kernel.BadAuthRequest(fmt.Sprintf("第 %d 段参考%s时长为 %.2f 秒，需要改到 %s；%s", index+1, kind, float64(durationMs)/1000, durationRequirement(minimum, maximum), durationFixAction(kind, tooShort)))
	}
	return nil
}

// durationRequirement 写成「2–15 秒」「2 秒以上」「15 秒以内」，说明要改成多少。
func durationRequirement(minimum, maximum float64) string {
	if minimum <= 0 {
		return formatDurationBound(maximum) + " Within seconds"
	}
	if maximum <= 0 {
		return formatDurationBound(minimum) + " more than seconds"
	}
	return formatDurationBound(minimum) + "–" + formatDurationBound(maximum) + " seconds"
}

// durationFixAction 按实际违反的是哪一侧给出可直接照做的下一步。
func durationFixAction(kind string, tooShort bool) string {
	noun := kind
	if tooShort {
		return "Please change to a longer one" + noun + "Submit later"
	}
	return "Please cut or replace it with a shorter one" + noun + "Submit later"
}

func validateVideoTask(profile *VideoCapabilityConfig, input TaskInput) error {
	if profile == nil {
		return kernel.BadAuthRequest("The current video model capability parameter is invalid")
	}
	if err := validateVideoReferenceMedia(profile, input); err != nil {
		return err
	}
	return validateVideoTaskParameters(profile, input)
}

func validateVideoTaskParameters(profile *VideoCapabilityConfig, input TaskInput) error {
	if profile == nil {
		return kernel.BadAuthRequest("The current video model capability parameter is invalid")
	}
	profile = tightenedVideoCapability(input.Config, profile)
	operation := videoTaskOperation(profile, input)
	if operation == "draft_to_final" {
		if !containsCapabilityString(profile.Operations, "draft_to_final") && !profile.Draft.Supported {
			return kernel.BadAuthRequest("The current video model does not support converting samples into high-definition films.")
		}
		if metadataString(input.Metadata, "videoDraftTaskId") == "" {
			return kernel.BadAuthRequest("The high-definition film needs to be associated with the completed audio sample task ID")
		}
		res := normalizeResolution(input.Config.VQuality)
		if res != "720p" && res != "1080p" {
			return kernel.BadAuthRequest("Converting samples to HD only supports 720p or 1080p resolution")
		}
		if len(profile.Resolutions) > 0 && videoResolutionNameRequest(profile, input.Config.VQuality) == "" {
			return kernel.BadAuthRequest("The output resolution is not within the support range of the current model")
		}
		return nil
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(input.Config.VideoSeconds), 64)
	allowed := false
	if err == nil && !math.IsNaN(seconds) && !math.IsInf(seconds, 0) {
		if profile.Duration.Continuous {
			allowed = seconds >= durationMinimum(profile.Duration) && seconds <= float64(profile.Duration.Max)
		} else if seconds == math.Trunc(seconds) {
			allowed = videoDurationAllowed(profile.Duration, int(seconds))
		}
	}
	if !allowed && videoDurationSupported(profile) {
		requirement := videoDurationRequirement(profile.Duration)
		if requirement == "" {
			return kernel.BadAuthRequest("The current model has no available output duration. Please set a duration of at least 4 seconds in the model capabilities before submitting.")
		}
		return kernel.BadAuthRequest(fmt.Sprintf("The output duration is %s seconds. The current model only supports %s; please change it to %s before submitting.", strings.TrimSpace(input.Config.VideoSeconds), requirement, requirement))
	}
	if input.Config.Size != "" && !(hasServerVideoCapability(input.Config) && len(profile.Ratios) == 0) && !videoRatioAllowed(profile.Ratios, input.Config.Size) {
		return kernel.BadAuthRequest("The aspect ratio is not within the support range of the current model")
	}
	if len(profile.Resolutions) > 0 && !isAutomaticVideoResolution(input.Config.VQuality) && videoResolutionNameRequest(profile, input.Config.VQuality) == "" {
		return kernel.BadAuthRequest("The output resolution is not within the support range of the current model")
	}
	if !containsCapabilityString(profile.Operations, operation) {
		return kernel.BadAuthRequest("The current video model does not support this generation mode")
	}
	if len(profile.OperationReferences) > 0 {
		return validateVideoReferenceCounts(videoReferencesForOperation(profile, metadataString(input.Metadata, "videoEditOperation")), input)
	}
	return nil
}

func videoDurationAllowed(value VideoDurationConfig, seconds int) bool {
	if seconds == -1 {
		return containsInt(value.Values, -1)
	}
	if value.Selection == "enum" {
		return containsInt(value.Values, seconds)
	}
	return float64(seconds) >= durationMinimum(value) && seconds <= value.Max && (value.Continuous || value.Step > 0 && (seconds-value.Min)%value.Step == 0)
}

func durationMinimum(value VideoDurationConfig) float64 {
	if value.Continuous && value.FractionalMin > 0 {
		return value.FractionalMin
	}
	return float64(value.Min)
}

// videoDurationRequirement 把模型支持的输出时长写成可直接照着改的说法：
// 「4–15 秒」「5、10 秒」「自动或 4–15 秒」。
func videoDurationRequirement(value VideoDurationConfig) string {
	if value.Selection == "enum" {
		parts := make([]string, 0, len(value.Values))
		manual := make([]string, 0, len(value.Values))
		for _, seconds := range value.Values {
			if seconds == -1 {
				parts = append(parts, "automatic")
				continue
			}
			manual = append(manual, strconv.Itoa(seconds))
		}
		if len(manual) > 0 {
			parts = append(parts, strings.Join(manual, "、")+" seconds")
		}
		if len(parts) == 0 {
			return ""
		}
		return strings.Join(parts, " or")
	}
	minimum := durationMinimum(value)
	maximum := float64(value.Max)
	if maximum > 0 {
		return formatDurationBound(minimum) + "–" + formatDurationBound(maximum) + " seconds"
	}
	return formatDurationBound(minimum) + " more than seconds"
}

func videoRatioAllowed(options []string, value string) bool {
	value = strings.TrimSpace(strings.ToLower(strings.ReplaceAll(value, "×", "x")))
	if containsCapabilityString(options, value) {
		return true
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return false
	}
	width, widthErr := strconv.ParseFloat(parts[0], 64)
	height, heightErr := strconv.ParseFloat(parts[1], 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return false
	}
	actual := width / height
	for _, option := range options {
		candidate := ratioValue(option)
		if candidate > 0 && absFloat(candidate-actual)/candidate < 0.01 {
			return true
		}
	}
	return false
}

func ratioValue(value string) float64 {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0
	}
	width, widthErr := strconv.ParseFloat(parts[0], 64)
	height, heightErr := strconv.ParseFloat(parts[1], 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0
	}
	return width / height
}

func normalizeResolution(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimSuffix(value, "p")
	if value == "2k" {
		return "1440p"
	}
	if value == "4k" {
		return "2160p"
	}
	return value + "p"
}

func ValidateVideoTask(profile *VideoCapabilityConfig, input TaskInput) error {
	return validateVideoTask(profile, input)
}

func ValidateVideoTaskParameters(profile *VideoCapabilityConfig, input TaskInput) error {
	return validateVideoTaskParameters(profile, input)
}

func ApplyFixedVideoResolution(input *TaskInput, profile *VideoCapabilityConfig) {
	applyFixedVideoResolution(input, profile)
}

func ApplyModelSpecificVideoCapability(profile *VideoCapabilityConfig, protocol, modelName string) *VideoCapabilityConfig {
	return applyModelSpecificVideoCapability(profile, protocol, modelName)
}

func VideoDurationSupported(value *VideoCapabilityConfig) bool {
	return videoDurationSupported(value)
}

func ValidateVideoCapabilityConfig(value *VideoCapabilityConfig) error {
	return validateVideoCapabilityConfig(value)
}

func NormalizeResolution(value string) string {
	return normalizeResolution(value)
}

func ValidateReferenceDuration(kind string, index int, durationMs int64, minimum, maximum float64) error {
	return validateReferenceDuration(kind, index, durationMs, minimum, maximum)
}
