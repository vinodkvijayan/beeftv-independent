package operations

import (
	"encoding/json"
	"strings"
)

func registerCanvasNodeBindAsset(r *Registry) {
	r.Register(Op{AssistantCanvas: true, ID: "canvas.node.bind_asset", Summary: "Bind material library materials to nodes of the same type", Scope: ScopeCanvas,
		Params: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"canvasId":{"type":"string"},"nodeId":{"type":"string"},"assetId":{"type":"string"},"resourceId":{"type":"string"},"expectedRevision":{"type":"integer","minimum":0}},"required":["canvasId","nodeId","assetId","expectedRevision"]}`), Handler: opCanvasNodeBindAsset})
}

func opCanvasNodeBindAsset(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		CanvasID         string `json:"canvasId"`
		NodeID           string `json:"nodeId"`
		AssetID          string `json:"assetId"`
		ResourceID       string `json:"resourceId"`
		ExpectedRevision *int64 `json:"expectedRevision"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	if strings.TrimSpace(args.CanvasID) == "" || strings.TrimSpace(args.NodeID) == "" || strings.TrimSpace(args.AssetID) == "" || args.ExpectedRevision == nil || *args.ExpectedRevision < 0 {
		return nil, InvalidArg("invalid_params", "Canvas, node, material and current version are required")
	}
	asset, err := ctx.Domain.OwnedAsset(ctx.UserID, args.AssetID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if asset == nil {
		return nil, NotFound("asset_not_found", "Material does not exist")
	}
	ids, err := ReferencedMediaResourceIDs(json.RawMessage(asset.PayloadJSON))
	if err != nil {
		return nil, InvalidArg("invalid_asset", "Invalid asset record")
	}
	if args.ResourceID == "" {
		if len(ids) != 1 {
			return nil, InvalidArg("ambiguous_asset_resource", "The material does not have a unique resource, please select the resourceId in the material")
		}
		args.ResourceID = ids[0]
	}
	linked := false
	for _, id := range ids {
		if id == args.ResourceID {
			linked = true
		}
	}
	if !linked {
		return nil, InvalidArg("asset_resource_mismatch", "The resource does not belong to the specified material")
	}
	resource, err := ctx.Domain.OwnedReadyResource(ctx.UserID, args.ResourceID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if resource == nil {
		return nil, NotFound("resource_not_found", "The asset does not exist")
	}
	kind := asset.Kind
	if kind != "image" && kind != "video" && kind != "audio" {
		return nil, InvalidArg("unsupported_asset_kind", "Only pictures, videos or audio materials can be bound")
	}
	if !strings.HasPrefix(strings.ToLower(resource.MimeType), kind+"/") {
		return nil, InvalidArg("asset_resource_kind_mismatch", "The material type is inconsistent with the resource type")
	}
	canvasRaw, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(canvasRaw, &doc); err != nil {
		return nil, AsError(err)
	}
	if revision := canvasRevision(doc); revision != *args.ExpectedRevision {
		return nil, Conflict("revision_conflict", "The canvas has changed, please read again", map[string]any{"currentRevision": revision})
	}
	node := findDocNode(doc, args.NodeID)
	if node == nil {
		return nil, NotFound("node_not_found", "Node does not belong to the specified canvas")
	}
	if node["type"] != kind {
		return nil, InvalidArg("node_kind_mismatch", "The material and reference node types are inconsistent")
	}
	metadata, _ := node["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		node["metadata"] = metadata
	}
	if taskID, _ := metadata["taskId"].(string); taskID != "" {
		return nil, PreconditionFailed("node_has_task", "Please use independent reference nodes and do not overwrite existing task nodes.", nil)
	}
	metadata["assetId"] = asset.ID
	metadata["storageKey"] = "resource:" + resource.ID
	metadata["content"] = "/api/resources/" + resource.ID + "/file"
	metadata["nodeRole"] = "result"
	metadata["resultOrigin"] = "library"
	metadata["status"] = "success"
	metadata["mimeType"] = resource.MimeType
	metadata["bytes"] = resource.Size
	for _, key := range []string{"width", "height", "naturalWidth", "naturalHeight", "durationMs"} {
		delete(metadata, key)
	}
	if resource.Width > 0 {
		metadata["width"] = resource.Width
		metadata["naturalWidth"] = resource.Width
	}
	if resource.Height > 0 {
		metadata["height"] = resource.Height
		metadata["naturalHeight"] = resource.Height
	}
	if resource.DurationMs > 0 {
		metadata["durationMs"] = resource.DurationMs
	}
	delete(metadata, "previewContent")
	delete(metadata, "fileUpload")
	encoded, err := json.Marshal(doc)
	if err != nil {
		return nil, AsError(err)
	}
	summary, _, err := ctx.Domain.CommitUserCanvasDocument(ctx.UserID, args.CanvasID, *args.ExpectedRevision, encoded)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return map[string]any{"canvasId": args.CanvasID, "nodeId": args.NodeID, "assetId": asset.ID, "resourceId": resource.ID, "node": node, "revision": summary.Revision, "referenceBound": true}, nil
}
