package canvasworkflow

import (
	"fmt"
	"math"
	"strings"
)

type InputPort struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	MediaType string `json:"mediaType"`
	Required  bool   `json:"required"`
	Multiple  bool   `json:"multiple"`
}
type Field struct {
	Key     string        `json:"key"`
	Label   string        `json:"label"`
	Type    string        `json:"type"`
	Min     *float64      `json:"min,omitempty"`
	Max     *float64      `json:"max,omitempty"`
	Options []FieldOption `json:"options,omitempty"`
}
type FieldOption struct {
	Label        string `json:"label"`
	Value        string `json:"value"`
	Capabilities any    `json:"capabilities,omitempty"`
}
type Operation struct {
	UnavailableReason string      `json:"unavailableReason,omitempty"`
	ID                string      `json:"id"`
	Version           int         `json:"version"`
	Name              string      `json:"name"`
	OutputType        string      `json:"outputType"`
	Inputs            []InputPort `json:"inputs"`
	Fields            []Field     `json:"fields"`
}
type UpdateRequest struct {
	Name             string     `json:"name"`
	Description      string     `json:"description"`
	Definition       Definition `json:"definition"`
	ExpectedRevision int        `json:"expectedRevision"`
}
type Editor struct {
	Workflow   Template    `json:"workflow"`
	Operations []Operation `json:"operations"`
}

func Operations() []Operation {
	out := []Operation{}
	for _, kind := range []string{"image", "video", "audio", "text"} {
		out = append(out, Operation{ID: "generate." + kind, Version: 1, Name: "generate" + kind, OutputType: kind, Inputs: []InputPort{{"prompt", "prompt word", "text", false, true}, {"referenceImages", "Reference pictures", "image", false, true}, {"referenceVideos", "Reference video", "video", false, true}, {"referenceAudios", "Reference audio", "audio", false, true}}, Fields: []Field{{Key: "prompt", Label: "prompt word", Type: "textarea"}, {Key: "size", Label: "Size", Type: "string"}, {Key: "quality", Label: "quality", Type: "string"}, {Key: "videoSeconds", Label: "duration", Type: "number"}, {Key: "seed", Label: "seeds", Type: "number"}}})
	}
	out = append(out, Operation{ID: "video.depth", Version: 1, Name: "Deep extraction", OutputType: "video", Inputs: []InputPort{{"video", "video", "video", true, false}}, Fields: []Field{}}, Operation{ID: "video.trim", Version: 1, Name: "Video cropping", OutputType: "video", Inputs: []InputPort{{"video", "video", "video", true, false}}, Fields: []Field{{Key: "startSeconds", Label: "Start seconds", Type: "number"}, {Key: "endSeconds", Label: "end seconds", Type: "number"}}}, Operation{ID: "video.merge", Version: 1, Name: "Video splicing", OutputType: "video", Inputs: []InputPort{{"videos", "video clip", "video", true, true}}, Fields: []Field{}})
	names := map[string]string{"generate.image": "Generate pictures", "generate.video": "Generate video", "generate.audio": "Generate audio", "generate.text": "generate text"}
	for id, name := range map[string]string{"video.depth": "Deep motion capture", "video.trim": "video clip", "video.merge": "Merge selected videos"} {
		names[id] = name
	}
	for i := range out {
		if strings.HasPrefix(out[i].ID, "generate.") {
			out[i].Fields = append([]Field{{Key: "modelOption", Label: "model", Type: "select"}}, out[i].Fields...)
			if out[i].ID == "generate.video" {
				out[i].Fields = append(out[i].Fields, Field{Key: "vquality", Label: "clarity", Type: "select"})
			}
		}
		if name, ok := names[out[i].ID]; ok {
			out[i].Name = name
		}
	}
	return append(append(out, MediaOperations()...), ImageWorkflowOperations()...)
}
func OperationByID(id string) Operation {
	for _, op := range Operations() {
		if op.ID == id {
			return op
		}
	}
	return Operation{}
}
func ValidateOperation(n Node) error {
	op := OperationByID(n.OperationID)
	if op.ID == "" || n.OperationVersion != op.Version || n.MediaType != op.OutputType {
		return fmt.Errorf("Invalid operation version or output type for node %s", n.ID)
	}
	if strings.HasPrefix(op.ID, "generate.") && n.SourceTaskID == "" && (n.Config["modelOption"] == nil || strings.TrimSpace(fmt.Sprint(n.Config["modelOption"])) == "") {
		return fmt.Errorf("Node %s Please select the generated model", n.ID)
	}
	for key, value := range n.Config {
		found := false
		for _, f := range op.Fields {
			if f.Key == key {
				found = true
				if f.Type == "number" {
					number, ok := value.(float64)
					if !ok {
						if v, yes := value.(int); yes {
							number = float64(v)
							ok = true
						}
					}
					if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
						return fmt.Errorf("Node %s parameter %s must be a number", n.ID, key)
					}
				} else if _, ok := value.(string); !ok {
					return fmt.Errorf("Node %s Parameter %s must be text", n.ID, key)
				}
			}
		}
		if !found {
			return fmt.Errorf("Node %s does not support parameter %s", n.ID, key)
		}
	}
	if op.ID == "video.trim" {
		start := operationNumber(n.Config["startSeconds"])
		end := operationNumber(n.Config["endSeconds"])
		if start < 0 || end <= start {
			return fmt.Errorf("The clipping end time of node %s must be greater than the start time", n.ID)
		}
	}
	if strings.HasSuffix(op.ID, ".ai-upscale") {
		_, err := UpscaleRequest(n)
		return err
	}
	if op.ID == "image.describe" && strings.TrimSpace(fmt.Sprint(n.Config["modelOption"])) == "" {
		return fmt.Errorf("Please select a text model that supports image recognition")
	}
	return ValidateMediaConfig(n)
}

func operationNumber(value any) float64 {
	switch number := value.(type) {
	case float64:
		return number
	case int:
		return float64(number)
	}
	return 0
}
func ValidatePort(from, to Node, e Edge, edges []Edge) error {
	if e.FromPort != "output" || e.Order < 0 {
		return fmt.Errorf("Invalid output port or sequence for node %s", from.ID)
	}
	for _, p := range OperationByID(to.OperationID).Inputs {
		if e.ToPort == p.ID {
			if from.MediaType != p.MediaType {
				return fmt.Errorf("Node %s port %s material type mismatch", to.ID, p.ID)
			}
			for _, other := range edges {
				if other.To == e.To && other.ToPort == e.ToPort && other != e && (!p.Multiple || other.Order == e.Order) {
					return fmt.Errorf("The slot of node %s and port %s is duplicated.", to.ID, p.ID)
				}
			}
			return nil
		}
	}
	return fmt.Errorf("Input port %s of node %s is invalid", to.ID, e.ToPort)
}

// Normalize annotates legacy definitions without touching their private recipes.
func Normalize(d Definition) Definition {
	nodes := map[string]Node{}
	for i, n := range d.Nodes {
		if n.Role == "generation" {
			n.Role = "operation"
			n.OperationID = "generate." + n.MediaType
			n.OperationVersion = 1
		}
		if n.Role == "depth" {
			n.Role = "operation"
			n.OperationID = "video.depth"
			n.OperationVersion = 1
		}
		d.Nodes[i] = n
		nodes[n.ID] = n
	}
	counters := map[string]int{}
	for i, e := range d.Edges {
		if e.FromPort == "" {
			e.FromPort = "output"
		}
		if e.ToPort == "" {
			if nodes[e.To].OperationID == "video.depth" {
				e.ToPort = "video"
			} else if nodes[e.From].MediaType == "text" {
				e.ToPort = "prompt"
			} else {
				e.ToPort = "reference" + strings.ToUpper(nodes[e.From].MediaType[:1]) + nodes[e.From].MediaType[1:] + "s"
			}
			key := e.To + ":" + e.ToPort
			e.Order = counters[key]
			counters[key]++
		}
		d.Edges[i] = e
	}
	return d
}
