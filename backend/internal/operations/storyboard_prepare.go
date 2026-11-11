package operations

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/canvas"
)

// storyboardTitleTemplateMaxRunes 与 schema 的 maxLength 一致；入口不执行 JSON Schema，长度在这里校验。
const storyboardTitleTemplateMaxRunes = 40

func registerStoryboardPreparation(r *Registry) {
	properties := map[string]any{
		"canvasId": map[string]any{"type": "string"}, "nodeId": map[string]any{"type": "string"},
		"expectedRevision": map[string]any{"type": "integer", "minimum": 1},
		"rowIds":           map[string]any{"type": "array", "minItems": 1, "maxItems": 8, "items": map[string]any{"type": "string"}},
		"script": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"title", "rows"}, "properties": map[string]any{
			"title": map[string]any{"type": "string", "minLength": 1},
			"rows":  map[string]any{"type": "array", "minItems": 1, "maxItems": 8, "items": map[string]any{"type": "object", "description": "Row ID and mirror number are assigned by the server", "properties": storyboardRowFieldSchemas}},
		}, "description": "Create a new storyboard (omit image/video and only create a storyboard)"},
		"referenceNodeIds": map[string]any{"type": "array", "maxItems": 4, "items": map[string]any{"type": "string"}},
		"image":            map[string]any{"type": "object", "properties": map[string]any{"model": map[string]any{"type": "string"}, "size": map[string]any{"type": "string"}, "title": map[string]any{"type": "string", "maxLength": storyboardTitleTemplateMaxRunes, "description": "Title template, {n} is the shot number, such as \"shot {n} first frame\"; omit the default \"shot {n} · first frame\""}}, "required": []string{"model"}},
		"video":            map[string]any{"type": "object", "properties": map[string]any{"model": map[string]any{"type": "string"}, "size": map[string]any{"type": "string"}, "generateAudio": map[string]any{"type": "string", "enum": []string{"true", "false"}}, "title": map[string]any{"type": "string", "maxLength": storyboardTitleTemplateMaxRunes, "description": "Title template, {n} is the lens number, such as \"Mirror {n} video\"; omit the default \"lens {n} · Video\""}}, "required": []string{"model", "generateAudio"}},
	}
	params, _ := json.Marshal(map[string]any{"type": "object", "additionalProperties": false, "properties": properties,
		"required": []string{"canvasId", "expectedRevision"}})
	r.Register(Op{ID: "canvas.script.prepare", Summary: "Prepare storyboard and optional first frame/video draft (without starting generation)", Scope: ScopeCanvas, ReplaySafe: true, AssistantCanvas: true, Params: params, Handler: opStoryboardPrepare})
}

func opStoryboardPrepare(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		CanvasID         string                     `json:"canvasId"`
		NodeID           string                     `json:"nodeId"`
		ExpectedRevision int64                      `json:"expectedRevision"`
		RowIDs           []string                   `json:"rowIds"`
		ReferenceNodeIDs []string                   `json:"referenceNodeIds"`
		Image            map[string]json.RawMessage `json:"image"`
		Video            map[string]json.RawMessage `json:"video"`
		Script           *canvas.StoryboardDraft    `json:"script"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	if strings.TrimSpace(args.CanvasID) == "" || args.ExpectedRevision <= 0 || (args.Script == nil && strings.TrimSpace(args.NodeID) == "") {
		return nil, InvalidArg("invalid_params", "Requires canvas, storyboard node and current version")
	}
	if args.Script != nil && (args.NodeID != "" || len(args.RowIDs) > 0 || strings.TrimSpace(args.Script.Title) == "" || len(args.Script.Rows) < 1 || len(args.Script.Rows) > 8) {
		return nil, InvalidArg("invalid_params", "The new storyboard requires a name and 1 to 8 lines of text. Existing storyboards cannot be specified at the same time.")
	}
	input := canvas.StoryboardPreparation{Script: args.Script, RowIDs: args.RowIDs, ReferenceNodeIDs: args.ReferenceNodeIDs}
	for _, item := range []struct {
		kind   string
		raw    map[string]json.RawMessage
		target *map[string]any
		title  *string
	}{{"image", args.Image, &input.Image, &input.ImageTitle}, {"video", args.Video, &input.Video, &input.VideoTitle}} {
		if item.raw == nil {
			continue
		}
		var selected string
		if json.Unmarshal(item.raw["model"], &selected) != nil || strings.TrimSpace(selected) == "" {
			return nil, InvalidArg("invalid_parameter", "Please select an explicit generation model")
		}
		if _, exists := item.raw["prompt"]; exists {
			return nil, InvalidArg("invalid_parameter", "Please fill in the storyboard prompt words in the corresponding storyboard line")
		}
		if _, exists := item.raw["seconds"]; exists {
			return nil, InvalidArg("invalid_parameter", "Please modify the corresponding storyboard line for the video duration.")
		}
		if _, exists := item.raw["count"]; exists {
			return nil, InvalidArg("invalid_parameter", "Create a first frame for each storyboard")
		}
		if item.kind == "video" {
			if _, exists := item.raw["generateAudio"]; !exists {
				return nil, InvalidArg("invalid_parameter", "Please clearly choose whether to generate sounds according to the needs of your work")
			}
		}
		if rawTitle, exists := item.raw["title"]; exists {
			var title string
			if string(rawTitle) == "null" || json.Unmarshal(rawTitle, &title) != nil {
				return nil, InvalidArg("invalid_parameter", "Draft title must be a string")
			}
			title = strings.TrimSpace(title)
			if title != "" && !strings.Contains(title, "{n}") {
				return nil, InvalidArg("invalid_parameter", "The draft title template must contain {n} to represent the shot number, for example \"shot {n} first frame\"")
			}
			if utf8.RuneCountInString(title) > storyboardTitleTemplateMaxRunes {
				return nil, InvalidArg("invalid_parameter", "Draft title template up to 40 words")
			}
			*item.title = title
			delete(item.raw, "title")
		}
		patch, err := resolveGenerationDraft(ctx, item.kind, item.raw, nil)
		if err != nil {
			return nil, err
		}
		*item.target = patch
	}
	_, prepared, err := ctx.Domain.PrepareUserCanvasStoryboard(ctx.UserID, args.CanvasID, args.NodeID, input, args.ExpectedRevision)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if prepared.ScriptNodeID != "" {
		args.NodeID = prepared.ScriptNodeID
	}
	return canvasWriteResult(ctx, args.CanvasID, func(map[string]any) map[string]any {
		return map[string]any{"canvasId": args.CanvasID, "nodeId": args.NodeID, "created": prepared.Created, "createdEdgeIds": prepared.CreatedEdgeIDs, "shots": prepared.Shots}
	})
}
