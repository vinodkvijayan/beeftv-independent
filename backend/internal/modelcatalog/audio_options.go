package modelcatalog

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

// AudioGenerationOptions describes choices exposed by the current speech path.
// Recommended voices are examples, not a closed validation list for custom IDs.
type AudioGenerationOptions struct {
	DefaultVoice          string             `json:"defaultVoice"`
	DefaultFormat         string             `json:"defaultFormat"`
	AllowCustomVoice      bool               `json:"allowCustomVoice"`
	Speed                 AudioSpeedOptions  `json:"speed"`
	Voices                []AudioVoiceOption `json:"voices"`
	InstructionsSupported bool               `json:"instructionsSupported"`
	Guidance              string             `json:"guidance"`
	Source                string             `json:"source"`
}

type AudioSpeedOptions struct {
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	Default float64 `json:"default"`
}

type AudioVoiceOption struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Gender      string `json:"gender"`
	Language    string `json:"language"`
	Description string `json:"description"`
}

func audioGenerationOptions(cm *model.ChannelModel) *AudioGenerationOptions {
	_, name := SplitModelKey(cm.ModelKey)
	if cm.Capability != "audio" || cm.Protocol != model.ChannelInterfaceOpenAIAudio || !strings.HasPrefix(strings.ToLower(name), "minimax-speech-") {
		return nil
	}
	return &AudioGenerationOptions{
		DefaultVoice: "male-qn-qingse", DefaultFormat: "mp3", AllowCustomVoice: true,
		Speed: AudioSpeedOptions{Min: 0.5, Max: 2, Default: 1},
		Voices: []AudioVoiceOption{
			{ID: "male-qn-qingse", Name: "Youthful youth", Gender: "male", Language: "zh-CN", Description: "young male voice"},
			{ID: "male-qn-jingying", Name: "elite youth", Gender: "male", Language: "zh-CN", Description: "Mature, professional male voice"},
			{ID: "Chinese (Mandarin)_Gentleman", Name: "Gentle male voice", Gender: "male", Language: "zh-CN", Description: "Suitable for calm narration and narrative"},
			{ID: "female-tianmei", Name: "sweet women", Gender: "female", Language: "zh-CN", Description: "Good for soft, friendly content"},
			{ID: "female-chengshu", Name: "mature women", Gender: "female", Language: "zh-CN", Description: "adult female voice"},
			{ID: "Chinese (Mandarin)_Soft_Girl", Name: "Soft girl", Gender: "female", Language: "zh-CN", Description: "Good for quiet, soothing content"},
		},
		InstructionsSupported: false,
		Guidance:              "audioVoice uses real IDs from the recommendation list, or a valid user-supplied custom voice ID; do not make up IDs based on natural language styles. The current MiniMax speech compatible path does not have access to audioInstructions free speech instructions, and cannot be relied on to control mood or pitch; use timbre and audioSpeed ​​to select expressions, and the mixing volume is set in the timeline. Prompt only contains the lines to be read, and does not include reading requirements. Recommended sounds are from the official catalog, actual availability is determined by configured channels.",
		Source:                "https://github.com/MiniMax-AI/skills/blob/main/skills/frontend-dev/references/minimax-voice-catalog.md",
	}
}
