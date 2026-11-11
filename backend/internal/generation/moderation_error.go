package generation

import (
	"regexp"
	"strings"
)

var moderationCodePattern = regexp.MustCompile(`^(input|output)(text|image|video|audio)(?:sensitivecontentdetected|riskdetection)(?:\.(policyviolation|privacyinformation|deepfake))?$`)
var moderationSubjectPattern = regexp.MustCompile(`\b(input|output|reference)\s+(text|image|video|audio)\b`)
var moderationMessagePattern = regexp.MustCompile(`may contain sensitive information|includes sensitive content|content (?:safety|policy)|safety policy|copyright restrictions|may contain real person|counterfeit documents or credentials`)

// Ark codes encode direction, medium and cause independently. In this family
// PolicyViolation means copyright, while PrivacyInformation concerns likeness.
func moderationErrorCopy(code, message string) (Failure, bool) {
	m := moderationCodePattern.FindStringSubmatch(strings.ToLower(code))
	direction, media, cause := "", "", ""
	if len(m) != 0 {
		direction, media, cause = m[1], m[2], m[3]
	} else {
		message = strings.ToLower(message)
		if strings.Contains(message, "prompt or reference ") || strings.Contains(message, "prompt or input ") {
			return Failure{}, false
		}
		if strings.Contains(message, "output may contain sensitive information") {
			return Failure{Category: CategoryModerationOutput, Reason: "The generated results failed content security review", Action: "Please adjust the prompt words or reference materials and regenerate"}, true
		}
		m = moderationSubjectPattern.FindStringSubmatch(message)
		if len(m) == 0 || !moderationMessagePattern.MatchString(message) {
			return Failure{}, false
		}
		direction, media = m[1], m[2]
		if direction == "reference" {
			direction = "input"
		}
		switch {
		case strings.Contains(message, "copyright restrictions"):
			cause = "policyviolation"
		case strings.Contains(message, "may contain real person"):
			cause = "privacyinformation"
		case strings.Contains(message, "counterfeit documents or credentials"):
			cause = "deepfake"
		}
	}
	labels := map[string]string{"text": "Enter text", "image": "Reference pictures", "video": "Reference video", "audio": "Reference audio"}
	category := CategoryModerationReference
	if direction == "output" {
		labels = map[string]string{"text": "Generate text", "image": "Generate pictures", "video": "Generate video", "audio": "Generate audio"}
		category = CategoryModerationOutput
	} else if media == "text" {
		category = CategoryModerationInput
	}
	label := labels[media]
	f := Failure{Category: category, Reason: label + "Failed content security review", Action: "Please check and replace" + label + "regenerate after"}
	if direction == "output" {
		f.Action = "Please adjust the prompt word; if reference material is used, please check and replace it and then regenerate it."
	} else if media == "text" {
		f.Action = "Please adjust the prompt word and regenerate it."
	}
	switch cause {
	case "policyviolation":
		f.Reason = label + "Failed to pass upstream copyright review"
		if direction == "output" && media == "audio" {
			f.Action = "Please adjust the music or audio related prompt words; if reference audio is used, please check and replace it and regenerate it."
		}
	case "privacyinformation":
		f.Reason = label + "Failed privacy review"
		if direction == "input" && (media == "image" || media == "video") {
			f.Reason = label + "Suspected to contain a real person image, the model refuses to be generated"
		}
	case "deepfake":
		f.Reason = label + "Failed counterfeit content review"
	}
	return f, true
}

func persistedModerationCopy(text string) (Failure, bool) {
	for _, direction := range []string{"input", "output"} {
		for _, media := range []string{"text", "image", "video", "audio"} {
			for _, suffix := range []string{"", ".PolicyViolation", ".PrivacyInformation", ".DeepFake"} {
				f, _ := moderationErrorCopy(direction+media+"SensitiveContentDetected"+suffix, "")
				if strings.HasPrefix(text, f.Reason+"。"+f.Action+"。") {
					return f, true
				}
			}
		}
	}
	return Failure{}, false
}
