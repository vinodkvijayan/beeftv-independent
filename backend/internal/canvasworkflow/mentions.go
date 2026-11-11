package canvasworkflow

import (
	"fmt"
	"regexp"
)

var nodeMentionPattern = regexp.MustCompile(`@\[node:([^\]\s]+)\]`)

func NodeMentionToken(id string) string { return "@[node:" + id + "]" }

func PromptBinding(field string) bool { return field == "prompt" || field == "promptMention" }

func MediaField(kind string) string {
	switch kind {
	case "image":
		return "referenceImages"
	case "video":
		return "referenceVideos"
	case "audio":
		return "referenceAudios"
	}
	return ""
}

// Names are presentation only. Bind stable node identities to the provider's
// actual reference slots, without exposing that numbering in the editor.
func nodePromptBindings(prompt string, bindings []Binding, nodes map[string]Node, edges []Edge, target string) ([]Binding, error) {
	var mentions []Binding
	for _, match := range nodeMentionPattern.FindAllStringSubmatchIndex(prompt, -1) {
		id := prompt[match[2]:match[3]]
		node, exists := nodes[id]
		connected := false
		for _, edge := range edges {
			if edge.From == id && edge.To == target {
				connected = true
				break
			}
		}
		if !exists || !connected {
			return nil, BadRequest("The workflow node referenced by the prompt word has been disconnected or deleted, please select again.")
		}
		binding := Binding{NodeID: id, Field: "prompt", Index: match[0], Original: prompt[match[0]:match[1]]}
		if node.MediaType != "text" {
			index := -1
			for _, media := range bindings {
				if media.NodeID != id || media.Field != MediaField(node.MediaType) {
					continue
				}
				if index >= 0 && index != media.Index {
					return nil, BadRequest("node" + node.Title + " Corresponding to multiple reference locations, please keep a reference connection")
				}
				index = media.Index
			}
			if index < 0 {
				return nil, BadRequest("node" + node.Title + " No valid material reference created")
			}
			binding.Field = "promptMention"
			binding.ReferenceLabel = fmt.Sprintf("@%s%d", map[string]string{"image": "pictures", "video": "video", "audio": "Audio"}[node.MediaType], index+1)
		}
		mentions = append(mentions, binding)
	}
	return mentions, nil
}
