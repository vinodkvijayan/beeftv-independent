package operations

import (
	"encoding/json"
	"infinite-canvas/backend/internal/skillhub"
	"infinite-canvas/backend/internal/skills"
)

type SkillPublishing interface {
	DraftSkill(string, skills.SkillMutationRequest) (*skills.SkillItem, error)
	PrepareSkillPublication(string, string, string, skillhub.Metadata, skills.PublicationTarget) (*skills.PublishPlan, error)
	SkillPublicationStatus(string, string) (*skills.PublishPlan, error)
}

func registerSkillPublishingOps(r *Registry) {
	r.Register(Op{ID: "skill.draft", AssistantCanvas: true, Scope: ScopeCanvas, Summary: "Save private skill draft (do not upload)", Params: json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"instruction":{"type":"string"}},"required":["canvasId","name","description","instruction"],"additionalProperties":false}`), Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
		var a struct {
			CanvasID    string `json:"canvasId"`
			Name        string `json:"name"`
			Description string `json:"description"`
			Instruction string `json:"instruction"`
		}
		if e := decodeParams(raw, &a); e != nil {
			return nil, e
		}
		p, ok := ctx.Domain.(SkillPublishing)
		if !ok {
			return nil, Unsupported("skill_unavailable", "The skill draft cannot be saved in the current workspace.")
		}
		if _, e := ctx.Domain.UserCanvasProject(ctx.UserID, a.CanvasID); e != nil {
			return nil, mapDomainError(e)
		}
		v, e := p.DraftSkill(ctx.UserID, skills.SkillMutationRequest{SkillName: a.Name, Description: a.Description, Instruction: a.Instruction, Tag: "others", IsPrivate: true})
		return v, mapDomainError(e)
	}})
	r.Register(Op{ID: "skill.publish.prepare", AssistantCanvas: true, Scope: ScopeCanvas, Summary: "Prepare skill submission preview and wait for user confirmation to upload", Params: json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"skillId":{"type":"string"},"publicationTarget":{"type":"string","enum":["new","existing"]},"marketSkillId":{"type":"string","description":"existing时填市场ID，禁填本机skillId"},"metadata":{"type":"object","properties":{"license":{"type":"string"},"requirements":{"type":"array","description":"纯文字填[]，禁填text","items":{"type":"string","enum":["beeftv.canvas","model.image","model.video","model.audio"]}},"requirementNotes":{"type":"string"}},"required":["license","requirements"]}},"required":["canvasId","skillId","publicationTarget","metadata"]}`), Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
		var a struct {
			skills.PublicationTarget
			CanvasID string            `json:"canvasId"`
			SkillID  string            `json:"skillId"`
			Metadata skillhub.Metadata `json:"metadata"`
		}
		if e := decodeParams(raw, &a); e != nil {
			return nil, e
		}
		p, ok := ctx.Domain.(SkillPublishing)
		if !ok {
			return nil, Unsupported("skill_unavailable", "The current workspace cannot be prepared for submission")
		}
		v, e := p.PrepareSkillPublication(ctx.UserID, a.SkillID, a.CanvasID, a.Metadata, a.PublicationTarget)
		return map[string]any{"plan": v, "actionRequired": "user_upload_confirmation"}, mapDomainError(e)
	}})
	r.Register(Op{ID: "skill.publish.status", AssistantCanvas: true, ReadOnly: true, Scope: ScopeWorkspaceRead, Summary: "Read skill submission status", Params: json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"planId":{"type":"string"}},"required":["canvasId","planId"],"additionalProperties":false}`), Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
		var a struct {
			CanvasID string `json:"canvasId"`
			PlanID   string `json:"planId"`
		}
		if e := decodeParams(raw, &a); e != nil {
			return nil, e
		}
		p, ok := ctx.Domain.(SkillPublishing)
		if !ok {
			return nil, Unsupported("skill_unavailable", "Submissions cannot be read in the current workspace")
		}
		v, e := p.SkillPublicationStatus(ctx.UserID, a.PlanID)
		if e == nil && v.CanvasID != a.CanvasID {
			return nil, PermissionDenied("publication_canvas_mismatch", "This contribution does not belong to the current canvas")
		}
		return v, mapDomainError(e)
	}})
}
