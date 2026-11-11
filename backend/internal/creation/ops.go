package creation

import (
	"encoding/json"

	"infinite-canvas/backend/internal/canvas/capability"
	"infinite-canvas/backend/internal/kernel"
)

func ValidateOps(ops []CanvasOp) error {
	if len(ops) == 0 || len(ops) > 100 {
		return kernel.BadAuthRequest("Plan must contain between 1 and 100 explicit canvas actions")
	}
	if err := ValidateJSON(ops); err != nil {
		return err
	}
	ids := map[string]bool{}
	registry := capability.BuiltinRegistry()
	for _, op := range ops {
		switch op.Type {
		case "add_node":
			if op.ID == "" || ids[op.ID] {
				return kernel.BadAuthRequest("New nodes must use unique and stable IDs")
			}
			ids[op.ID] = true
			if _, ok := registry.Resolve(op.NodeType); !ok {
				return kernel.BadAuthRequest("This node type is not within the scope of this issue’s creation")
			}
		case "update_node":
			if op.ID == "" {
				return kernel.BadAuthRequest("Update node missing ID")
			}
			for key := range op.Patch {
				switch key {
				case "title", "position", "width", "height", "metadata":
				default:
					return kernel.BadAuthRequest("Schema contains unsupported node update fields")
				}
			}
		case "connect_nodes":
			if op.ID == "" || op.FromNodeID == "" || op.ToNodeID == "" {
				return kernel.BadAuthRequest("The connection must have a stable ID and two endpoints")
			}
		case "select_nodes":
		default:
			return kernel.BadAuthRequest("The creative plan only allows adding, connecting, updating and selecting nodes")
		}
	}
	return nil
}

func ApprovalBaseline(raw string, ops []CanvasOp) (string, error) {
	doc, err := parseDocument(raw)
	if err != nil {
		return "", err
	}
	nodes, err := documentObjects(doc["nodes"])
	if err != nil {
		return "", err
	}
	selected := []any{}
	for _, op := range ops {
		if op.Type != "update_node" {
			continue
		}
		node := nodes[op.ID]
		if node == nil {
			return "", Conflict("The node to be modified does not exist")
		}
		baseline := map[string]any{"id": op.ID}
		for key := range op.Patch {
			if key != "metadata" {
				baseline[key] = node[key]
			}
		}
		metadata, _ := node["metadata"].(map[string]any)
		patch, _ := op.Patch["metadata"].(map[string]any)
		saved := map[string]any{}
		for key := range MergeMaps(patch, op.Metadata) {
			saved[key] = metadata[key]
		}
		baseline["metadata"] = saved
		selected = append(selected, baseline)
	}
	value := map[string]any{"nodes": selected}
	if err = ValidateJSON(value); err != nil {
		return "", err
	}
	b, err := json.Marshal(value)
	return string(b), err
}
