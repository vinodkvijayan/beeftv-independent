package agentops

import (
	"encoding/json"
	"infinite-canvas/backend/internal/skills"
	"strings"

	"infinite-canvas/backend/internal/assistantturns"
	"infinite-canvas/backend/internal/operations"
)

// AssistantScope 是内置助手的可信范围：当前画布 + 后端验证过归属的额外引用，
// 以及当前画布文档里真实关联的素材与任务。
//
// 这个范围只能由后端从回合记录构造；模型给的工具参数无法扩大它，
// 所以「提示词里说可以读」不会变成真实权限。
type AssistantScope struct {
	PermissionMode string
	CanvasID       string
	AssetIDs       map[string]bool
	CanvasIDs      map[string]bool
	TaskIDs        map[string]bool
	// SkillPins holds exact pin identities selected in this round or in an
	// earlier round of the same conversation; a loaded skill stays readable.
	SkillPins map[skills.Pin]bool
	// SkillInstalled reports whether a pin is the caller's currently installed
	// version (Go-only resolver), so the assistant can load an advertised skill.
	SkillInstalled   func(skills.Pin) bool
	ProjectReference func(kind, id string) error // Go-only DB resolver, never model supplied.
}

// Visible uses the same operation policy published to the official Pi host.
func (s *AssistantScope) Visible(op *operations.Op) bool {
	if s == nil {
		return true
	}
	return op != nil && op.AssistantVisible(assistantturns.Mode(s.PermissionMode))
}

func (s *AssistantScope) Allows(op *operations.Op, params json.RawMessage) error {
	if s == nil {
		return nil
	}
	if strings.TrimSpace(s.CanvasID) == "" {
		return denied("There is no canvas bound to the current session")
	}
	if !s.Visible(op) {
		return denied("This operation is not allowed by assistant permissions in this round")
	}
	var args struct {
		CanvasID    string `json:"canvasId"`
		NodeID      string `json:"nodeId"`
		AssetID     string `json:"assetId"`
		TaskID      string `json:"taskId"`
		SkillID     string `json:"skillId"`
		VersionID   string `json:"versionId"`
		ContentHash string `json:"contentHash"`
	}
	if len(params) > 0 {
		_ = json.Unmarshal(params, &args)
	}
	// Broad modes rely on each shared domain handler's current ownership check.
	// Skills remain pinned rather than discovering filesystem instructions.
	if assistantturns.Mode(s.PermissionMode) != assistantturns.PermissionCanvas && op.ID != "skill.get" && op.ID != "skill.file" && op.ID != "skill.catalog" && op.ID != "skill.script.run" {
		return nil
	}
	if !op.ReadOnly && op.Scope == operations.ScopeCanvas && op.ID != "skill.script.run" {
		if args.CanvasID == s.CanvasID {
			return nil
		}
		return denied("Only the current canvas can be modified")
	}
	switch op.ID {
	case "model.catalog":
		return nil
	case "project.media.search", "project.canvas.search":
		if args.CanvasID == s.CanvasID {
			return nil
		}
		return denied("Only items belonging to the current canvas can be searched")
	case "skill.catalog", "skill.market.search", "skill.market.get", "skill.market.file":
		return nil
	case "skill.publish.status":
		if args.CanvasID == s.CanvasID {
			return nil
		}
		return denied("Only submissions prepared for the current canvas can be viewed")
	case "skill.get", "skill.file":
		pin := skills.Pin{SkillID: args.SkillID, VersionID: args.VersionID, ContentHash: args.ContentHash}
		if s.SkillPins[pin] || (s.SkillInstalled != nil && s.SkillInstalled(pin)) {
			return nil
		}
		return denied("Can only read this dialogue selection or installed skill version")
	case "skill.script.run":
		if assistantturns.Mode(s.PermissionMode) == assistantturns.PermissionReadOnly {
			return denied("This round of assistants can only read and cannot run skill scripts.")
		}
		if assistantturns.Mode(s.PermissionMode) == assistantturns.PermissionCanvas && args.CanvasID != s.CanvasID {
			return denied("Skill scripts can only be run on the current canvas")
		}
		pin := skills.Pin{SkillID: args.SkillID, VersionID: args.VersionID, ContentHash: args.ContentHash}.Identity()
		if s.SkillPins[pin] {
			return nil
		}
		return denied("Please load or select this skill before running its script")
	case "canvas.get":
		if s.canvasAllowed(args.CanvasID) || s.projectReferenceAllowed("canvas", args.CanvasID) {
			return nil
		}
		return denied("Can only read the current canvas or the canvas referenced in the interface")
	case "canvas.generation.propose":
		// 写只允许落在当前画布：跨画布写即便带上合法 canvasId 也必须拒绝。
		if args.CanvasID == s.CanvasID {
			return nil
		}
		return denied("Only the current canvas can be modified")
	case "asset.get":
		if s.AssetIDs[strings.TrimSpace(args.AssetID)] || s.projectReferenceAllowed("asset", args.AssetID) {
			return nil
		}
		return denied("This material has nothing to do with the current canvas and is not referenced in this conversation.")
	case "media.overview", "media.inspect", "media.check", "media.review":
		if args.CanvasID != s.CanvasID {
			return denied("Only media associated with the current canvas can be checked")
		}
		if args.NodeID != "" && args.AssetID == "" {
			return nil
		}
		if args.AssetID != "" && args.NodeID == "" && (s.AssetIDs[args.AssetID] || s.projectReferenceAllowed("asset", args.AssetID)) {
			return nil
		}
		return denied("This media is not associated with the current canvas or this conversation")
	case "task.get":
		if s.TaskIDs[strings.TrimSpace(args.TaskID)] {
			return nil
		}
		return denied("This task has nothing to do with the current canvas")
	default:
		return denied("The built-in helper cannot call this operation")
	}
}

func (s *AssistantScope) canvasAllowed(canvasID string) bool {
	trimmed := strings.TrimSpace(canvasID)
	if trimmed == "" {
		return false
	}
	return trimmed == s.CanvasID || s.CanvasIDs[trimmed]
}

func (s *AssistantScope) projectReferenceAllowed(kind, id string) bool {
	return id != "" && s.ProjectReference != nil && s.ProjectReference(kind, id) == nil
}

func denied(message string) *Error {
	return operations.PermissionDenied("scope_denied", message)
}

var _ operations.Authorizer = (*AssistantScope)(nil)
