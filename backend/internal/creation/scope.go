package creation

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func ValidateSubmissionScope(run *model.CreationRun, version int64, req TaskRequest) error {
	if run.Status == "paused" || run.Status == "cancelled" || run.Status == "completed" {
		return Conflict("Please resume creation tasks first")
	}
	if req.Type == "canvas_text" || req.Type == "text" {
		if req.ProjectID != "" && req.ProjectID != run.CanvasID {
			return Conflict("Canvas association mismatch for planning tasks")
		}
		return nil
	}
	if run.CanvasID == "" || req.ProjectID != run.CanvasID {
		return Conflict("Media tasks must be submitted to the current authoring canvas")
	}
	if run.ApprovedAt == nil || version != run.ApprovedProposalVersion || run.ApprovedProposalHash == "" {
		return Conflict("Please confirm the current plan first")
	}
	var ops []CanvasOp
	_ = json.Unmarshal([]byte(run.ApprovedOperationsJSON), &ops)
	nodeID := stringValue(req.Input["nodeId"])
	metadata, _ := req.Input["metadata"].(map[string]any)
	if nodeID == "" {
		nodeID = stringValue(metadata["nodeId"])
	}
	for _, op := range ops {
		if op.ID != nodeID || nodeID == "" {
			continue
		}
		if op.Type != "add_node" && op.Type != "update_node" {
			continue
		}
		meta := op.Metadata
		if nested, ok := op.Patch["metadata"].(map[string]any); ok {
			meta = MergeMaps(nested, meta)
		}
		prompt := stringValue(meta["prompt"])
		if prompt == "" {
			prompt = stringValue(meta["text"])
		}
		if strings.TrimSpace(req.Prompt) != strings.TrimSpace(prompt) || prompt == "" {
			return Conflict("The task prompt words have exceeded the approved plan")
		}
		if stringValue(meta["model"]) == "" || stringValue(meta["model"]) != req.Model {
			return Conflict("Model differs from approved plan")
		}
		config, _ := req.Input["config"].(map[string]any)
		for _, key := range []string{"size", "videoSeconds", "vquality", "quality"} {
			metadataKey := key
			if key == "videoSeconds" {
				metadataKey = "seconds"
			}
			approved := strings.TrimSpace(stringValue(meta[metadataKey]))
			candidate := strings.TrimSpace(stringValue(config[key]))
			if metadataKey == "quality" {
				approvedNorm := strings.ToLower(approved)
				candidateNorm := strings.ToLower(candidate)
				if (approvedNorm == "auto" || approvedNorm == "any" || approvedNorm == "") && (candidateNorm == "auto" || candidateNorm == "any" || candidateNorm == "") {
					continue
				}
				if approvedNorm == candidateNorm {
					continue
				}
			}
			if approved != "" && approved != candidate {
				return Conflict("Generated specifications differ from approved plan")
			}
		}
		refs, _ := meta["referenceNodeIds"].([]any)
		images, _ := req.Input["referenceImages"].([]any)
		if len(refs) != len(images) {
			return Conflict("The number of reference materials is different from the approved plan")
		}
		for index, ref := range refs {
			image, _ := images[index].(map[string]any)
			if stringValue(ref) != stringValue(image["id"]) {
				return Conflict("The reference material is different from the approved plan")
			}
		}
		for _, kind := range []string{"referenceVideos", "referenceAudios"} {
			if values, ok := req.Input[kind].([]any); ok && len(values) > 0 {
				return Conflict("No video or audio reference input has been authorized for this project")
			}
		}
		return nil
	}
	return Conflict("The task node is not within the scope of the approved plan")
}
