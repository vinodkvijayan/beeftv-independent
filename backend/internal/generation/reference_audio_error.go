package generation

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	audioDurationError  = regexp.MustCompile(`(?i)^reference audio (\d+) is (\d+(?:\.\d+)?) seconds; use audio between (\d+(?:\.\d+)?) and (\d+(?:\.\d+)?) seconds`)
	audioTotalError     = regexp.MustCompile(`(?i)^reference audio is (\d+(?:\.\d+)?) seconds in total; this model accepts at most (\d+(?:\.\d+)?) seconds of reference audio`)
	audioTotalPersisted = regexp.MustCompile(`^The total duration of the reference audio is (\d+(?:\.\d+)?) seconds[. , ](?:the|current) model supports up to (\d+(?:\.\d+)?) seconds`)
	audioNumberError    = regexp.MustCompile(`(?i)^reference audio (\d+)(?::| requires| exceeds)`)
	audioIssuePersisted = regexp.MustCompile(`^(Reference audio for paragraph \d+|Reference audio) (Cannot be downloaded|The format or duration cannot be read|The file is too large|Does not meet the model requirements).`)
	referenceDebugIDs   = regexp.MustCompile(`。排查编号：([^。]+)。?$`)
)

func persistedReferenceIDs(text string) (requestID, taskID string) {
	m := referenceDebugIDs.FindStringSubmatch(text)
	if len(m) != 2 {
		return
	}
	for _, part := range strings.Split(m[1], " · ") {
		if strings.HasPrefix(part, "请求 ") {
			requestID = sanitizeDebugID(strings.TrimPrefix(part, "Request"))
		}
		if strings.HasPrefix(part, "任务 ") {
			taskID = sanitizeDebugID(strings.TrimPrefix(part, "Task"))
		}
	}
	return
}

// Only measured numbers and known failure shapes enter user-facing copy.
func referenceAudioCopy(text string, invalidAudio bool) (categoryCopy, bool) {
	text = sanitizeProviderText(text)
	if m := audioDurationError.FindStringSubmatch(text); len(m) == 5 {
		return categoryCopy{Reason: fmt.Sprintf("The reference audio duration of segment %s is %s seconds.", m[1], m[2]), Action: fmt.Sprintf("It takes %s–%s seconds; please crop or replace this material before submitting", m[3], m[4])}, true
	}
	m := audioTotalError.FindStringSubmatch(text)
	if len(m) == 0 {
		m = audioTotalPersisted.FindStringSubmatch(text)
	}
	if len(m) == 3 {
		return categoryCopy{Reason: fmt.Sprintf("The total duration of the reference audio is %s seconds", m[1]), Action: fmt.Sprintf("This model supports up to %s seconds of reference audio; please crop or reduce the reference audio before submitting", m[2])}, true
	}
	label, issue := "Reference audio", ""
	numbered := audioNumberError.FindStringSubmatch(text)
	if len(numbered) == 2 {
		label = "No." + numbered[1] + " segment reference audio"
	}
	if persisted := audioIssuePersisted.FindStringSubmatch(text); len(persisted) == 3 {
		label, issue = persisted[1], persisted[2]
	} else if invalidAudio || len(numbered) == 2 {
		lower := strings.ToLower(text)
		switch {
		case strings.Contains(lower, "15 mib"), strings.Contains(lower, "byte limit"):
			issue = "File too large"
		case strings.Contains(lower, "duration could not be measured"), strings.Contains(lower, "invalid"), strings.Contains(lower, "unsupported"), strings.Contains(lower, "readable audio track"):
			issue = "The format or duration cannot be read"
		case strings.Contains(lower, "download"), strings.Contains(lower, "https url"), strings.Contains(lower, "url"), strings.Contains(lower, "redirect"):
			issue = "Unable to download"
		default:
			issue = "Does not meet model requirements"
		}
	}
	actions := map[string]string{
		"Unable to download":       "Please re-upload the audio and confirm that the material link is publicly accessible before submitting.",
		"The format or duration cannot be read": "Please re-export the audio as MP3 or WAV and make sure the file is complete and contains audio tracks before uploading",
		"File too large":       "Please compress or replace the audio to ensure that the file does not exceed the model size limit before submitting.",
		"Does not meet model requirements":    "Please check the duration, format and size of the reference audio and adjust it before submitting.",
	}
	if issue == "" {
		return categoryCopy{}, false
	}
	return categoryCopy{Reason: label + issue, Action: actions[issue]}, true
}
