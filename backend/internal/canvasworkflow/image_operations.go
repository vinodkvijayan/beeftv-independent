package canvasworkflow

import (
	"fmt"
	"infinite-canvas/backend/internal/topaz"
	"strings"
)

func ImageWorkflowOperations() []Operation {
	one, four := 1.0, 4.0
	out := []Operation{
		{ID: "image.select", Version: 1, Name: "Select image results", OutputType: "image", Inputs: []InputPort{{"images", "Candidate images", "image", true, true}}},
		{ID: "image.describe", Version: 1, Name: "Reverse prompt word", OutputType: "text", Inputs: []InputPort{{"image", "Reference pictures", "image", true, false}}, Fields: []Field{{Key: "modelOption", Label: "Graph recognition model", Type: "select"}, {Key: "prompt", Label: "Push back requirements", Type: "textarea"}}},
	}
	for _, kind := range []string{"image", "video"} {
		name, format := "AI super score", "png"
		if kind == "video" {
			name, format = "AI super score", "mp4"
		}
		presets := []FieldOption{}
		for _, mode := range topaz.Modes() {
			if mode.MediaType != kind {
				continue
			}
			label := map[string]string{"precision": "Fidelity enhancement", "generative": "Detailed reconstruction", "transparent": "Transparent picture"}[mode.Mode]
			for _, model := range mode.Models {
				presets = append(presets, FieldOption{Label: label + " · " + model, Value: mode.Mode + "|" + model})
			}
		}
		formats := []FieldOption{{Label: strings.ToUpper(format), Value: format}}
		if kind == "image" {
			formats = append(formats, FieldOption{Label: "JPEG", Value: "jpeg"})
		}
		out = append(out, Operation{ID: kind + ".ai-upscale", Version: 1, Name: name, OutputType: kind,
			Inputs: []InputPort{{kind, map[string]string{"image": "pictures", "video": "video"}[kind], kind, true, false}},
			Fields: []Field{{Key: "channelId", Label: "Super score channel", Type: "select"}, {Key: "preset", Label: "Super-resolution model", Type: "select", Options: presets}, {Key: "scale", Label: "magnification", Type: "number", Min: &one, Max: &four}, {Key: "outputFormat", Label: "Output format", Type: "select", Options: formats}},
		})
	}
	return out
}

func UpscaleRequest(n Node) (topaz.Request, error) {
	preset, _ := n.Config["preset"].(string)
	parts := strings.SplitN(preset, "|", 2)
	if len(parts) != 2 {
		return topaz.Request{}, fmt.Errorf("Please select a super-resolution model")
	}
	channel, _ := n.Config["channelId"].(string)
	format, _ := n.Config["outputFormat"].(string)
	r := topaz.Request{ResourceID: "workflow-input", ChannelID: channel, Mode: parts[0], Model: parts[1], Scale: operationNumber(n.Config["scale"]), OutputFormat: format}
	return r, topaz.Validate(r, n.MediaType)
}
