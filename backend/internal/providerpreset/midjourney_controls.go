package providerpreset

import (
	"fmt"
	"regexp"
	"strings"
)

var mjRatioFlag = regexp.MustCompile(`(?i)(?:^|\s)--(?:ar|aspect)\b(?:\s+([^\s]+))?`)
var mjUnsupportedFlag = regexp.MustCompile(`(?i)--(?:sd|q|quality|hd|draft|turbo|fast|relax|repeat|r|v|version|niji)(?:\s|=|$)`)

// The priced gateway model supports native standard output; only framing is encoded in the prompt.
func (c ImageContract) GenerationPrompt(prompt, size string) (string, error) {
	if c.Model != "midjourney-v8.2" || len(c.Presets) == 0 {
		return prompt, nil
	}
	pixels, err := c.PixelSize(size)
	if err != nil {
		return "", err
	}
	var selected ImagePreset
	for _, preset := range c.Presets {
		if preset.Size == pixels {
			selected = preset
			break
		}
	}
	if selected.Size == "" {
		return "", fmt.Errorf("The selected size is currently not supported by Midjourney")
	}
	for _, match := range mjRatioFlag.FindAllStringSubmatch(prompt, -1) {
		if match[1] != selected.Ratio {
			return "", fmt.Errorf("--ar/--aspect in the prompt word conflicts with the aspect ratio option, please unify and submit.")
		}
	}
	if mjUnsupportedFlag.MatchString(prompt) {
		return "", fmt.Errorf("The current official Midjourney channel only supports native standard files and does not support HD, quality, speed, version or duplicate parameters.")
	}
	prompt = mjRatioFlag.ReplaceAllString(prompt, " ")
	if strings.TrimSpace(prompt) == "" {
		return "", fmt.Errorf("Please enter a description of the image content")
	}
	prompt = strings.TrimSpace(prompt)
	if selected.Ratio != "1:1" {
		prompt += " --ar " + selected.Ratio
	}
	return prompt, nil
}
