package operations

import (
	"context"
	"encoding/json"
	"strings"
)

// MediaReviewer performs one bounded inference over bytes already authorized by
// the media operation. It has no tools, project writes, or recovery loop.
type MediaReviewer interface {
	ReviewMedia(context.Context, MediaPart, string) (MediaReviewObservation, error)
}

type MediaReviewObservation struct {
	Model     string          `json:"model"`
	RequestID string          `json:"requestId,omitempty"`
	Text      string          `json:"observations"`
	Usage     json.RawMessage `json:"usage,omitempty"`
}

type mediaReviewArgs struct {
	CanvasID        string `json:"canvasId"`
	NodeID          string `json:"nodeId,omitempty"`
	AssetID         string `json:"assetId,omitempty"`
	ResourceID      string `json:"resourceId,omitempty"`
	ExpectedVersion string `json:"expectedVersion"`
	StartMs         int64  `json:"startMs"`
	EndMs           int64  `json:"endMs"`
	Mode            string `json:"mode,omitempty"`
	Question        string `json:"question"`
}

func registerMediaReview(r *Registry) {
	r.Register(Op{ID: "media.review", AssistantCanvas: true, ReadOnly: true, ReplayUnsafe: true, Scope: ScopeCanvas,
		Summary: "Check the specified interval with an independent multi-modal review model (charges may apply, up to 15 seconds)",
		Params:  json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"canvasId":{"type":"string"},"nodeId":{"type":"string"},"assetId":{"type":"string"},"resourceId":{"type":"string"},"expectedVersion":{"type":"string"},"startMs":{"type":"integer"},"endMs":{"type":"integer"},"mode":{"type":"string","enum":["video","audio"]},"question":{"type":"string"}},"required":["canvasId","expectedVersion","startMs","endMs","question"]}`), Handler: runMediaReview})
}

func runMediaReview(ctx *Context, raw json.RawMessage) (any, error) {
	var args mediaReviewArgs
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	if strings.TrimSpace(args.Question) == "" || len([]rune(args.Question)) > 4000 || args.StartMs < 0 || args.EndMs <= args.StartMs || args.EndMs-args.StartMs > 15000 || strings.TrimSpace(args.ExpectedVersion) == "" {
		return nil, InvalidArg("invalid_media_review", "Please provide a version of the material, a clear interval within 15 seconds, and review questions")
	}
	if args.Mode == "" {
		args.Mode = "video"
	}
	if args.Mode != "video" && args.Mode != "audio" {
		return nil, InvalidArg("invalid_media_mode", "mode must be video or audio")
	}
	reviewer, ok := ctx.Domain.(MediaReviewer)
	if !ok {
		return nil, Unsupported("media_review_unavailable", "The film review model is not configured in the current workspace")
	}
	params, _ := json.Marshal(mediaArgs{CanvasID: args.CanvasID, NodeID: args.NodeID, AssetID: args.AssetID, ResourceID: args.ResourceID, ExpectedVersion: args.ExpectedVersion, StartMs: args.StartMs, EndMs: args.EndMs, Mode: args.Mode})
	value, err := runMedia(ctx, "media.inspect", params)
	if err != nil {
		return nil, err
	}
	media := value.(MediaResult)
	mime := "video/mp4"
	if args.Mode == "audio" {
		mime = "audio/wav"
	}
	if len(media.Content) != 1 || media.Content[0].MimeType != mime {
		if args.Mode == "audio" {
			return nil, InvalidArg("media_review_requires_audio", "The review tool requires audio material")
		}
		return nil, InvalidArg("media_review_requires_video", "The review tool requires video material")
	}
	part := media.Content[0]
	observation, err := reviewer.ReviewMedia(ctx.Context, part, args.Question)
	if err != nil {
		return nil, err
	}
	note := "The designated footage has been handed over to the review model; observations may be omitted and need to be compared with the original requirements and visible footage. The time position is based on the starting point of the intercepted clip as 0, and source.startMs is added to the original material position."
	if args.Mode == "audio" {
		note = "The designated audio clips have been handed over to the review model; there may be omissions in the observations and need to be compared with the original requirements and actual sounds. This does not mean that the main model listened to it personally. The time position is based on the starting point of the intercepted clip as 0, and source.startMs is added to the original material position."
	}
	return map[string]any{"source": media.Source, "durationMs": media.DurationMs, "hasAudio": media.HasAudio, "mediaSHA256": part.SHA256, "review": observation, "note": note}, nil
}
