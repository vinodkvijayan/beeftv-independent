package generation

import "strings"

func persistedTaskConstraintCopy(message string) (categoryCopy, bool) {
	for _, input := range []string{"video_first_frame_ratio_unreadable", "video_first_frame_ratio_unsupported", "video_first_frame_ratio_mismatch", "The video frame only supports the current incoming adaptive", "TaskTypeConstraint ratio first-frame", "TaskTypeConstraint duration", "TaskTypeConstraint ratio", "TaskTypeConstraint"} {
		copy, _ := taskConstraintCopy(input)
		if strings.HasPrefix(strings.TrimSpace(message), copy.Reason+"。"+copy.Action) {
			return copy, true
		}
	}
	return categoryCopy{}, false
}

func taskConstraintCopy(message string) (categoryCopy, bool) {
	m := strings.ToLower(message)
	if strings.Contains(m, "video_first_frame_ratio_unreadable") {
		return categoryCopy{Reason: "Unable to read the size of the first frame of the image", Action: "Please re-upload the PNG, JPEG or WebP image before generating"}, true
	}
	if strings.Contains(m, "video_first_frame_ratio_unsupported") {
		return categoryCopy{Reason: "The current channel cannot maintain the proportions of this first frame image", Action: "Please adjust the first frame to 1:1, 4:3, 3:4, 9:16, 16:9 or 21:9, or change the model"}, true
	}
	if strings.Contains(m, "video_first_frame_ratio_mismatch") {
		return categoryCopy{Reason: "The output ratio needs to be consistent with the first frame", Action: "Please use the ratio of the first frame, or adjust the size of the first frame image first"}, true
	}
	if strings.Contains(m, "视频画幅仅支持") && strings.Contains(m, "当前传入 adaptive") {
		return categoryCopy{Reason: "The current channel does not currently support adaptive frame", Action: "Please change the model when generating the first frame; please specify a fixed ratio before submitting the Vincent video."}, true
	}
	if !strings.Contains(m, "tasktypeconstraint") {
		return categoryCopy{}, false
	}
	if strings.Contains(m, "ratio") && (strings.Contains(m, "first-frame") || strings.Contains(m, "first_frame")) {
		return categoryCopy{Reason: "The screen ratio of the first and last frame modes must follow the first frame", Action: "Please select the adaptive scale before regenerating; if you need to specify the scale, please use the reference generation mode instead."}, true
	}
	if strings.Contains(m, "duration") {
		return categoryCopy{Reason: "The current task mode does not support the specified video duration.", Action: "When editing the video, please use the duration that follows the original video; if you need to generate a specified duration, please use the reference generation mode instead."}, true
	}
	if strings.Contains(m, "ratio") {
		return categoryCopy{Reason: "The screen ratio of the current mission mode needs to follow the input material", Action: "Please select the adaptive scale before regenerating; if you need to specify the scale, please use the reference generation mode instead."}, true
	}
	return categoryCopy{Reason: "Build parameters are incompatible with the current mission mode", Action: "Please check the selected mode; the first and last frames and extensions need to follow the material ratio, and editing needs to follow the original video duration"}, true
}
