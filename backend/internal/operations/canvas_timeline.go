package operations

import (
	"encoding/json"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/editing"
	"strings"
)

func registerCanvasTimelineOps(r *Registry) {
	r.Register(Op{ReplaySafe: true, AssistantCanvas: true, ID: "canvas.timeline.update", Summary: "Modify the canvas timeline or use refreshNodeIds to partially refresh node materials", Scope: ScopeCanvas,
		Params: timelineUpdateSchema(json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"expectedRevision":{"type":"integer"},"timeline":{"type":"object","description":"Timeline v2 (milliseconds); visible video/image Not overlapping","properties":{"version":{"type":"integer","enum":[2]},"durationMs":{"type":"integer"},"tracks":{"type":"array","items":{"typ e":"object","properties":{"id":{"type":"string"},"kind":{"type":"string","enum":["video","audio","subtitle","text","image"]},"visible":{"type":"boolean"},"muted":{"type":"boolean"}},"require d":["id","kind"]}},"clips":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"k ind":{"type":"string","enum":["video","image","audio","subtitle"]},"nodeId":{"type":"string"},"trackId":{"type":"string"},"startMs":{"type":"integer"},"durationMs":{"type":"integer"},"source StartMs":{"type":"integer"},"volume":{"type":"number"},"fadeInMs":{"type":"integer"},"fadeOutMs":{"type":"integer"},"text":{"type":"string"}},"re asked":["id","kind","trackId","startMs","durationMs"]}},"output":{"type":["object","null"],"prope rties":{"width":{"type":"integer"},"height":{"type":"integer"},"fps":{"type":"integer"},"burnSubtitles":{"type":"boolean"}}}},"required": ["version","tracks","clips","durationMs"]}},"required":["canvasId","expectedRevision","timeline"]}`)), Handler: opCanvasTimelineUpdate})
}

func timelineUpdateSchema(raw json.RawMessage) json.RawMessage {
	var schema map[string]any
	_ = json.Unmarshal(raw, &schema)
	schema["properties"].(map[string]any)["refreshNodeIds"] = map[string]any{
		"type":        "array",
		"items":       map[string]any{"type": "string"},
		"description": "Only refresh the specified node material reference (choose one from timeline)",
	}
	schema["required"] = []string{"canvasId", "expectedRevision"}
	// 根级 oneOf 会让部分严格校验的工具端点拒绝整份工具清单。互斥条件由服务端校验，
	// 模型需要的约束放在参数描述里。
	schema["description"] = "Only one of timeline and refreshNodeIds must be provided; the server verifies mutually exclusive conditions."
	encoded, _ := json.Marshal(schema)
	return encoded
}

func opCanvasTimelineUpdate(ctx *Context, params json.RawMessage) (any, error) {
	var args struct {
		CanvasID         string           `json:"canvasId"`
		ExpectedRevision *int64           `json:"expectedRevision"`
		Timeline         *editing.Project `json:"timeline"`
		RefreshNodeIDs   []string         `json:"refreshNodeIds"`
	}
	if err := decodeParams(params, &args); err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(params, &fields)
	_, hasTimeline := fields["timeline"]
	_, hasRefresh := fields["refreshNodeIds"]
	if strings.TrimSpace(args.CanvasID) == "" || args.ExpectedRevision == nil || *args.ExpectedRevision < 0 ||
		hasTimeline == hasRefresh || (args.Timeline == nil) == (args.RefreshNodeIDs == nil) {
		return nil, InvalidArg("invalid_params", "Requires canvasId, expectedRevision, and choose one of timeline and refreshNodeIds")
	}
	raw, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err = json.Unmarshal(raw, &doc); err != nil {
		return nil, AsError(err)
	}
	revision := canvasRevision(doc)
	if revision != *args.ExpectedRevision {
		return nil, Conflict("revision_conflict", "The canvas has changed, please read again", map[string]any{"currentRevision": revision})
	}
	if args.RefreshNodeIDs != nil {
		if err := refreshTimelineSources(ctx, doc, args.RefreshNodeIDs); err != nil {
			return nil, err
		}
		return commitTimelineUpdate(ctx, args.CanvasID, *args.ExpectedRevision, doc)
	}
	if args.Timeline.Output == nil {
		var requested struct {
			Timeline map[string]json.RawMessage `json:"timeline"`
		}
		if err = json.Unmarshal(params, &requested); err != nil {
			return nil, InvalidArg("invalid_params", "timeline must be an object")
		}
		// An edit may replace tracks and clips without restating project output.
		// Explicit null clears the setting; omission retains only valid output.
		if _, present := requested.Timeline["output"]; !present {
			var saved struct {
				Output *editing.Options `json:"output"`
			}
			previous, marshalErr := json.Marshal(doc["timeline"])
			if marshalErr == nil && json.Unmarshal(previous, &saved) == nil && saved.Output != nil {
				if _, outputErr := editing.NormalizeOptions(*saved.Output); outputErr == nil {
					args.Timeline.Output = saved.Output
				}
			}
		}
	}
	sources, err := timelineSources(ctx, doc, args.Timeline)
	if err != nil {
		return nil, err
	}
	if _, err = editing.Compile(*args.Timeline, sources, editing.Options{}); err != nil {
		return nil, InvalidArg("invalid_timeline", err.Error())
	}
	// Encode the typed timeline; unknown fields can never introduce paths or URLs.
	timeline, err := json.Marshal(args.Timeline)
	if err != nil {
		return nil, AsError(err)
	}
	var value any
	if err = json.Unmarshal(timeline, &value); err != nil {
		return nil, AsError(err)
	}
	doc["timeline"] = value
	return commitTimelineUpdate(ctx, args.CanvasID, *args.ExpectedRevision, doc)
}

func commitTimelineUpdate(ctx *Context, canvasID string, revision int64, doc map[string]any) (any, error) {
	encoded, err := json.Marshal(doc)
	if err != nil {
		return nil, AsError(err)
	}
	summary, _, err := ctx.Domain.CommitUserCanvasDocument(ctx.UserID, canvasID, revision, encoded)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return map[string]any{"canvasId": canvasID, "revision": summary.Revision, "timelineUpdated": true}, nil
}

// Validate using the same ownership and render rules as a full edit, but write
// only the selected media references back into the original document.
func refreshTimelineSources(ctx *Context, doc map[string]any, nodeIDs []string) error {
	if len(nodeIDs) == 0 || len(nodeIDs) > 50 {
		return InvalidArg("invalid_params", "refreshNodeIds requires 1 to 50 different nodes")
	}
	selected := map[string]bool{}
	for _, id := range nodeIDs {
		if strings.TrimSpace(id) == "" || selected[id] {
			return InvalidArg("invalid_params", "refreshNodeIds cannot contain empty nodes or duplicate nodes")
		}
		selected[id] = true
	}
	rawTimeline, ok := doc["timeline"].(map[string]any)
	if !ok {
		return InvalidArg("invalid_timeline", "The current canvas has no timeline to update")
	}
	rawClips, ok := rawTimeline["clips"].([]any)
	if !ok {
		return InvalidArg("invalid_timeline", "The current timeline is missing clips")
	}
	raw, err := json.Marshal(rawTimeline)
	var project editing.Project
	if err != nil || json.Unmarshal(raw, &project) != nil {
		return InvalidArg("invalid_timeline", "The current timeline cannot be read")
	}
	found := map[string]bool{}
	for i := range project.Clips {
		clip := &project.Clips[i]
		if selected[clip.NodeID] && clip.Kind != editing.KindSubtitle {
			clip.DirectMedia = nil
			found[clip.NodeID] = true
		}
	}
	if len(found) != len(selected) {
		return InvalidArg("timeline_node_not_used", "The specified node does not have a corresponding media clip and the timeline has not been modified.")
	}
	sources, err := timelineSources(ctx, doc, &project)
	if err != nil {
		return err
	}
	if _, err := editing.Compile(project, sources, editing.Options{}); err != nil {
		return InvalidArg("invalid_timeline", err.Error())
	}
	for i, clip := range project.Clips {
		if selected[clip.NodeID] && clip.Kind != editing.KindSubtitle {
			rawClip, ok := rawClips[i].(map[string]any)
			if !ok {
				return InvalidArg("invalid_timeline", "Timeline clip cannot be read")
			}
			rawClip["directMedia"] = clip.DirectMedia
		}
	}
	return nil
}

func timelineSources(ctx *Context, doc map[string]any, project *editing.Project) ([]editing.SourceMeta, error) {
	nodes := map[string]map[string]any{}
	allowed := map[string]bool{}
	assetForResource := map[string]string{}
	for _, raw := range canvasNodes(doc) {
		if node, ok := raw.(map[string]any); ok {
			if id, ok := node["id"].(string); ok {
				nodes[id] = node
			}
			collectMediaResourceIDs(node, allowed)
			if metadata, ok := node["metadata"].(map[string]any); ok {
				if assetID, ok := metadata["assetId"].(string); ok && assetID != "" {
					ids := map[string]bool{}
					collectMediaResourceIDs(node, ids)
					for id := range ids {
						assetForResource[id] = assetID
					}
				}
			}
		}
	}
	// Direct resource references already saved in this owned document are also usable.
	var previous editing.Project
	if raw, err := json.Marshal(doc["timeline"]); err == nil && json.Unmarshal(raw, &previous) == nil {
		for _, clip := range previous.Clips {
			if id, ok := editing.MediaResourceID(clip); ok {
				allowed[id] = true
				if clip.DirectMedia.AssetID != "" {
					assetForResource[id] = clip.DirectMedia.AssetID
				}
			}
		}
	}
	sources := []editing.SourceMeta{}
	seen := map[string]bool{}
	for index := range project.Clips {
		clip := project.Clips[index]
		if clip.Kind == editing.KindSubtitle {
			continue
		}
		resourceID, direct := editing.MediaResourceID(clip)
		if clip.DirectMedia != nil && !direct {
			return nil, PermissionDenied("timeline_source_not_authorized", "Timeline only accepts linked resource references")
		}
		if clip.NodeID != "" {
			node, ok := nodes[clip.NodeID]
			if !ok {
				return nil, PermissionDenied("node_not_in_canvas", "The timeline node does not belong to the current canvas")
			}
			ids := map[string]bool{}
			collectMediaResourceIDs(node, ids)
			if direct {
				if !ids[resourceID] {
					return nil, PermissionDenied("timeline_source_not_authorized", "Nodes are inconsistent with timeline resources")
				}
			} else {
				if len(ids) != 1 {
					return nil, InvalidArg("timeline_resource_required", "Timeline nodes must be explicitly associated with a resource")
				}
				for id := range ids {
					resourceID = id
				}
			}
		} else if !direct {
			return nil, InvalidArg("timeline_resource_required", "Timeline clip requires node or resource reference")
		}
		if !allowed[resourceID] {
			return nil, PermissionDenied("timeline_source_not_authorized", "Unassociated resources cannot be added to the timeline")
		}
		resource, err := ctx.Domain.OwnedReadyResource(ctx.UserID, resourceID)
		if err != nil {
			return nil, mapDomainError(err)
		}
		if resource == nil {
			return nil, PreconditionFailed("timeline_source_not_ready", "Timeline material is not ready yet", nil)
		}
		assetID := assetForResource[resourceID]
		if assetID == "" {
			return nil, PreconditionFailed("timeline_asset_not_linked", "The material has not been associated with the material library, please synchronize it first", nil)
		}
		asset, err := ctx.Domain.OwnedAsset(ctx.UserID, assetID)
		if err != nil {
			return nil, mapDomainError(err)
		}
		if asset == nil {
			return nil, PermissionDenied("timeline_asset_not_owned", "The material does not belong to the current workspace")
		}
		if _, linked := assets.DocumentReferencedIDs(asset.PayloadJSON, map[string]struct{}{resourceID: {}})[resourceID]; !linked {
			return nil, PermissionDenied("timeline_asset_not_linked", "Material and resource references are inconsistent")
		}
		kind := ""
		switch {
		case strings.HasPrefix(resource.MimeType, "video/"):
			kind = editing.KindVideo
		case strings.HasPrefix(resource.MimeType, "audio/"):
			kind = editing.KindAudio
		case strings.HasPrefix(resource.MimeType, "image/"):
			kind = editing.KindImage
		}
		if kind == "" || (clip.Kind != kind && !(clip.Kind == editing.KindAudio && kind == editing.KindVideo)) {
			return nil, InvalidArg("timeline_source_kind", "Timeline clip does not match footage type")
		}
		project.Clips[index].DirectMedia = &editing.DirectMedia{ID: resourceID, AssetID: assetID, Kind: kind, StorageKey: "resource:" + resourceID}
		for _, id := range []string{clip.NodeID, resourceID, "resource:" + resourceID} {
			if id != "" && !seen[id] {
				sources = append(sources, editing.SourceMeta{ID: id, Kind: kind, DurationMs: resource.DurationMs})
				seen[id] = true
			}
		}
	}
	return sources, nil
}
