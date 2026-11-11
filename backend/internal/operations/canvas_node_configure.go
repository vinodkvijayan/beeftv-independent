package operations

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/canvas/capability"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/providerpreset"
)

func registerCanvasNodeConfigureOps(r *Registry) {
	properties := map[string]any{}
	for _, kind := range []string{"image", "video", "audio"} {
		descriptor, _ := capability.BuiltinRegistry().Resolve(kind)
		for name, field := range descriptor.PatchFields {
			if name == "title" || name == "content" {
				continue
			}
			property := map[string]any{"type": "string", "description": field.Description}
			switch name {
			case "count":
				property["type"] = "integer"
				property["description"] = "Number of pictures generated"
			case "generateAudio", "watermark", "transparentBackground":
				property["enum"] = []string{"true", "false"}
			case "model":
				property["description"] = "Full model key channelId::modelKey selected from model.catalog"
			case "size":
				property["description"] = "Image size or video aspect ratio. Video is selected from capabilityConfig.video.ratios in model.catalog, for example 16:9. Video resolution using vquality"
			case "vquality":
				property["description"] = "Video output resolution. Select from capabilityConfig.video.resolutions in model.catalog, e.g. 480p, 768p, 1080p"
			case "seconds":
				property["description"] = "Video output duration, in seconds. Select from capabilityConfig.video.duration in model.catalog, passed in as a string"
			}
			properties[name] = property
		}
	}
	params, _ := json.Marshal(map[string]any{"type": "object", "additionalProperties": false,
		"properties": map[string]any{"canvasId": map[string]any{"type": "string"}, "nodeId": map[string]any{"type": "string"},
			"kind": map[string]any{"type": "string", "enum": []string{"image", "video", "audio"}}, "expectedRevision": map[string]any{"type": "integer", "minimum": 1},
			"patch": map[string]any{"type": "object", "minProperties": 1, "additionalProperties": false, "properties": properties}},
		"required": []string{"canvasId", "nodeId", "kind", "expectedRevision", "patch"}})
	r.Register(Op{ReplaySafe: true, AssistantCanvas: true, ID: "canvas.node.configure", Summary: "Set the prompt word draft and generation parameters of the media node; do not start generation", Scope: ScopeCanvas, Params: params, Handler: opCanvasNodeConfigure})
}

func opCanvasNodeConfigure(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		CanvasID         string                     `json:"canvasId"`
		NodeID           string                     `json:"nodeId"`
		Kind             string                     `json:"kind"`
		ExpectedRevision int64                      `json:"expectedRevision"`
		Patch            map[string]json.RawMessage `json:"patch"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	if args.CanvasID == "" || args.NodeID == "" || args.ExpectedRevision <= 0 || len(args.Patch) == 0 {
		return nil, InvalidArg("invalid_params", "Requires canvas, node, type, current version and parameters")
	}
	if args.Kind != "image" && args.Kind != "video" && args.Kind != "audio" {
		return nil, InvalidArg("unsupported_node_kind", "Only media generation nodes support parameter configuration")
	}
	canvasRaw, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(canvasRaw, &doc); err != nil {
		return nil, AsError(err)
	}
	if revision := canvasRevision(doc); revision != args.ExpectedRevision {
		return nil, Conflict("revision_conflict", "The canvas has changed, please read again", map[string]any{"currentRevision": revision})
	}
	node := findDocNode(doc, args.NodeID)
	if node == nil {
		return nil, NotFound("node_not_found", "The node is not in the current canvas")
	}
	if node["type"] != args.Kind {
		return nil, InvalidArg("node_kind_mismatch", "The parameter type is inconsistent with the target node")
	}
	// 节点上已有的草稿参数先铺底、patch 再覆盖：只改 size 时也要能看出节点是不是正在拆图层。
	base := stringParameters(dependencyMetadata(node))
	patch, err := resolveGenerationDraft(ctx, args.Kind, args.Patch, base)
	if err != nil {
		return nil, err
	}
	if _, hasModel := patch["model"]; !hasModel {
		// 只改尺寸这类参数时 patch 里没有 model，用节点当前模型补上再校验，
		// 否则同一份规则只在换模型时才生效。
		if err := validateModelGenerationParameters(ctx.Domain, args.Kind, nodeSelectedModel(node), mergeParameters(base, stringParameters(patch))); err != nil {
			return nil, err
		}
	}
	if _, err := ctx.Domain.UpdateUserCanvasNodeFields(ctx.UserID, args.CanvasID, args.NodeID, patch, args.ExpectedRevision); err != nil {
		return nil, mapDomainError(err)
	}
	return canvasWriteResult(ctx, args.CanvasID, func(doc map[string]any) map[string]any {
		return map[string]any{"canvasId": args.CanvasID, "nodeId": args.NodeID, "node": findDocNode(doc, args.NodeID), "draftConfigured": true}
	})
}

// Single draft validator for a node edit and storyboard production preparation.
// base 是节点上已有的草稿参数（新建节点时为空），校验要看它和 patch 合并后的结果。
func resolveGenerationDraft(ctx *Context, kind string, raw map[string]json.RawMessage, base map[string]string) (map[string]any, error) {
	descriptor, _ := capability.BuiltinRegistry().Resolve(kind)
	patch := map[string]any{}
	for name, value := range raw {
		field, ok := descriptor.PatchFields[name]
		if !ok || name == "title" || name == "content" {
			return nil, InvalidArg("unsupported_field", "This type does not support parameters"+name)
		}
		if name == "count" {
			var count int
			if err := json.Unmarshal(value, &count); err != nil || count < 1 || count > 8 {
				return nil, InvalidArg("invalid_parameter", "count must be an integer from 1..8")
			}
			patch[name] = float64(count)
			continue
		}
		var text string
		if string(value) == "null" || json.Unmarshal(value, &text) != nil || len([]rune(text)) > field.MaxRunes {
			return nil, InvalidArg("invalid_parameter", name+" Must be a string of limited length")
		}
		if err := validateDraftValue(name, text); err != nil {
			return nil, err
		}
		patch[name] = text
	}
	if selected, exists := patch["model"]; exists {
		choice, err := ctx.Domain.ResolveAssistantGenerationModel(kind, selected.(string))
		if err != nil {
			return nil, mapDomainError(err)
		}
		if choice.KindMismatch {
			return nil, InvalidArg("generation_model_kind_mismatch", "The selected model does not support the media type")
		}
		if choice.ModelKey == "" || choice.Display == "" {
			return nil, PreconditionFailed("generation_model_unavailable", "The selected model is currently unavailable", nil)
		}
		patch["model"] = choice.ModelKey
		if err := validateModelGenerationParameters(ctx.Domain, kind, choice.ModelKey, mergeParameters(base, stringParameters(patch))); err != nil {
			return nil, err
		}
	}
	return patch, nil
}

// validateModelGenerationParameters 用与真实请求同一份型号族规则，在写草稿、
// 准备分镜和提交整片之前拦住模型不接受的尺寸；等上游拒绝时请求已经发出去了。
func validateModelGenerationParameters(domain Domain, kind, modelKey string, params map[string]string) error {
	if kind == "video" {
		return validateVideoResolutionParameter(domain, modelKey, params["vquality"])
	}
	if kind != "image" {
		return nil
	}
	modelName := strings.TrimSpace(modelKey)
	if i := strings.LastIndex(modelName, "::"); i >= 0 {
		modelName = strings.TrimSpace(modelName[i+2:])
	}
	family := providerpreset.SeedreamFamily(modelName)
	if family == "" {
		return nil
	}
	if _, err := providerpreset.ResolveSeedreamSize(family, params["size"], params["seedreamMode"] == "layers"); err != nil {
		return InvalidArg("invalid_parameter", err.Error())
	}
	return nil
}

// validateVideoResolutionParameter 的合法取值来自同一份模型目录，避免助手写入
// 目录里不存在的档位，直到提交生成才被上游拒绝。
func validateVideoResolutionParameter(domain Domain, modelKey, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	reader, ok := domain.(ModelCatalogReader)
	if !ok || reader == nil {
		return nil
	}
	catalog, err := reader.AgentModelCatalog()
	if err != nil || catalog == nil {
		return nil
	}
	_, model, found := findEstimateModel(catalog, modelKey)
	if !found {
		return nil
	}
	capability := estimateCapability(model.CapabilityConfig)
	if capability == nil || capability.Video == nil || len(capability.Video.Resolutions) == 0 {
		return nil
	}
	// auto/default/medium/high 是自动档位，不参与明确档位校验。
	if modelcatalog.IsAutomaticVideoResolution(value) {
		return nil
	}
	if modelcatalog.VideoResolutionNameRequest(capability.Video, value) != "" {
		return nil
	}
	return InvalidArg("invalid_parameter", "The current model does not support"+value+" resolution, optional"+strings.Join(capability.Video.Resolutions, "、"))
}

func stringParameters(values map[string]any) map[string]string {
	params := map[string]string{}
	for key, value := range values {
		if text, ok := value.(string); ok {
			params[key] = text
		}
	}
	return params
}

// mergeParameters 把节点现状和本次 patch 合并，patch 覆盖节点。只传 patch 会漏掉
// 「节点正在拆图层、这次只改尺寸」这类组合。
func mergeParameters(base, patch map[string]string) map[string]string {
	merged := make(map[string]string, len(base)+len(patch))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range patch {
		merged[key] = value
	}
	return merged
}

func validateDraftValue(name, value string) error {
	invalid := func() error { return InvalidArg("invalid_parameter", name+" The value of is invalid") }
	switch name {
	case "generateAudio", "watermark", "transparentBackground":
		if value != "true" && value != "false" {
			return invalid()
		}
	case "seconds", "audioSpeed", "audioPitch", "audioVolume":
		number, err := strconv.ParseFloat(value, 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return invalid()
		}
		if (name == "seconds" && (number <= 0 || number > 600)) || (name == "audioSpeed" && (number < 0.25 || number > 4)) ||
			(name == "audioPitch" && (number < -12 || number > 12)) || (name == "audioVolume" && (number < 0 || number > 2)) {
			return invalid()
		}
	case "audioFormat":
		if !strings.Contains("|mp3|wav|pcm|flac|aac|opus|ogg|m4a|", "|"+value+"|") {
			return invalid()
		}
	case "videoEditOperation":
		if !strings.Contains("|text_to_video|image_to_video|reference_to_video|extend|inpaint|replace_element|camera_motion|style_transfer|audio_to_video|compare_versions|concat|draft_to_final|", "|"+value+"|") {
			return invalid()
		}
	case "size", "quality", "vquality", "audioVoice":
		if strings.TrimSpace(value) == "" {
			return invalid()
		}
	}
	return nil
}
