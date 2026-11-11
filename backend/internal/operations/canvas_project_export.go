package operations

import (
	"context"
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type CanvasProjectExporter interface {
	ExportCanvasProjectArchive(context.Context, string, string, json.RawMessage) (*model.Resource, error)
}

func registerCanvasProjectExportOps(r *Registry) {
	r.Register(Op{ID: "canvas.project.export", Summary: "Free export of editable projects to ZIP", Scope: ScopeCanvas, AssistantCanvas: true, ReplaySafe: true,
		Params: json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"expectedRevision":{"type":"integer","minimum":0}},"required":["canvasId","expectedRevision"]}`), Handler: opCanvasProjectExport})
}

func opCanvasProjectExport(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		CanvasID         string `json:"canvasId"`
		ExpectedRevision *int64 `json:"expectedRevision"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	if strings.TrimSpace(args.CanvasID) == "" || args.ExpectedRevision == nil || *args.ExpectedRevision < 0 || strings.TrimSpace(ctx.OperationID) == "" {
		return nil, InvalidArg("invalid_params", "canvasId, expectedRevision and stable operation identifier are required")
	}
	exporter, ok := ctx.Domain.(CanvasProjectExporter)
	if !ok {
		return nil, Unsupported("project_export_unavailable", "The current workspace cannot export the project")
	}
	document, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err = json.Unmarshal(document, &doc); err != nil {
		return nil, AsError(err)
	}
	if revision := canvasRevision(doc); revision != *args.ExpectedRevision {
		return nil, Conflict("revision_conflict", "The canvas has changed, please read again", map[string]any{"currentRevision": revision})
	}
	resource, err := exporter.ExportCanvasProjectArchive(ctx.Context, ctx.UserID, ctx.OperationID, document)
	if err != nil {
		return nil, mapDomainError(err)
	}
	name, _ := doc["title"].(string)
	name = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 32 {
			return '_'
		}
		return r
	}, strings.TrimSpace(name))
	if name == "" {
		name = "BeefTV project"
	}
	return map[string]any{"canvasId": args.CanvasID, "sourceRevision": *args.ExpectedRevision, "resourceId": resource.ID, "storageKey": "resource:" + resource.ID, "fileName": name + ".zip", "mimeType": resource.MimeType, "bytes": resource.Size, "local": true, "charged": false, "editable": true}, nil
}
