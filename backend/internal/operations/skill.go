package operations

import (
	"context"
	"encoding/json"
	"fmt"
	"infinite-canvas/backend/internal/skills"
	"strings"
	"unicode/utf8"
)

type SkillResources interface {
	AgentSkillVersion(string, skills.Pin) (*skills.AgentResource, error)
	AgentSkillFile(string, skills.Pin, string) (*skills.AgentFile, error)
}

type SkillScriptExecutor interface {
	ProposeOrRunSkillScript(context.Context, string, string, skills.ScriptRunRequest) (any, error)
}

// SkillCatalog lists the caller's installed skills at their current versions.
type SkillCatalog interface {
	AgentSkillCatalog(string) ([]skills.AgentCatalogItem, error)
}

// SkillCatalogLimit and SkillDescriptionLimit keep the advertised catalog
// bounded; the full instructions are loaded only on demand.
const (
	SkillCatalogLimit     = 50
	SkillDescriptionLimit = 300
)

func truncateSkillDescription(value string) string {
	if utf8.RuneCountInString(value) <= SkillDescriptionLimit {
		return value
	}
	runes := []rune(value)
	return string(runes[:SkillDescriptionLimit]) + "…"
}

func skillScriptRunParams() json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"type":"object","properties":{"canvasId":{"type":"string"},"skillId":{"type":"string"},"versionId":{"type":"string"},"contentHash":{"type":"string"},"scriptPath":{"type":"string","description":"scripts/ 或 script/ 下的相对路径"},"args":{"type":"array","items":{"type":"string","maxLength":4096},"maxItems":64},"stdin":{"type":"string","maxLength":65536},"timeoutSec":{"type":"integer","minimum":1,"maximum":%d,"description":"默认 %d"},"useWorkspaceOutputDir":{"type":"boolean","description":"输出目录经 BEEFTV_OUTPUT_DIR 传入"},"note":{"type":"string","maxLength":500,"description":"告诉用户运行原因"}},"required":["canvasId","skillId","versionId","contentHash","scriptPath"],"additionalProperties":false}`, skills.MaxScriptTimeoutSec, skills.DefaultScriptTimeoutSec))
}

func registerSkillOps(r *Registry) {
	r.Register(Op{AssistantCanvas: true, ID: "skill.catalog", Summary: "List installed skills", ReadOnly: true, Scope: ScopeWorkspaceRead,
		Params: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"},"q":{"type":"string"},"offset":{"type":"integer"},"limit":{"type":"integer"}}}`),
		Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
			var args struct {
				ID     string `json:"id"`
				Query  string `json:"q"`
				Offset int    `json:"offset"`
				Limit  int    `json:"limit"`
			}
			if err := decodeParams(raw, &args); err != nil {
				return nil, err
			}
			if args.Offset < 0 || args.Limit < 0 || args.Limit > SkillCatalogLimit || len(args.ID) > 80 || len(args.Query) > 300 {
				return nil, InvalidArg("invalid_skill_catalog_query", "Invalid skill query parameter")
			}
			if args.Limit == 0 {
				args.Limit = SkillCatalogLimit
			}
			port, ok := ctx.Domain.(SkillCatalog)
			if !ok {
				return nil, Unsupported("skill_unavailable", "The skill cannot be read in the current workspace")
			}
			items, err := port.AgentSkillCatalog(ctx.UserID)
			if err != nil {
				return nil, mapDomainError(err)
			}
			filtered := make([]skills.AgentCatalogItem, 0, len(items))
			query := strings.ToLower(strings.TrimSpace(args.Query))
			for _, item := range items {
				if args.ID != "" && item.Pin.SkillID != args.ID {
					continue
				}
				if query != "" && !strings.Contains(strings.ToLower(item.Name+"\n"+item.Description), query) {
					continue
				}
				filtered = append(filtered, item)
			}
			total := len(filtered)
			offset := args.Offset
			if offset > total {
				offset = total
			}
			end := offset + args.Limit
			if end > total {
				end = total
			}
			items = filtered[offset:end]
			for i := range items {
				items[i].Description = truncateSkillDescription(items[i].Description)
			}
			return map[string]any{"skills": items, "total": total, "offset": offset, "limit": args.Limit}, nil
		}})
	for _, id := range []string{"skill.get", "skill.file"} {
		operation := id
		r.Register(Op{AssistantCanvas: true, ID: operation, Summary: "Read the text or package files of the fixed version of the selected skill", ReadOnly: true, Scope: ScopeCanvas,
			Params: json.RawMessage(`{"type":"object","properties":{"skillId":{"type":"string"},"versionId":{"type":"string"},"contentHash":{"type":"string"},"path":{"type":"string"}},"required":["skillId","versionId","contentHash"]}`),
			Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
				var args struct {
					skills.Pin
					Path string `json:"path"`
				}
				if err := decodeParams(raw, &args); err != nil {
					return nil, err
				}
				port, ok := ctx.Domain.(SkillResources)
				if !ok {
					return nil, Unsupported("skill_unavailable", "The skill cannot be read in the current workspace")
				}
				if operation == "skill.get" {
					if args.Path != "" {
						return nil, InvalidArg("unexpected_path", "Text read does not accept file path")
					}
					result, err := port.AgentSkillVersion(ctx.UserID, args.Pin)
					return result, mapDomainError(err)
				}
				if args.Path == "" {
					return nil, InvalidArg("skill_path_required", "Auxiliary file reading requires the path within the package")
				}
				result, err := port.AgentSkillFile(ctx.UserID, args.Pin, args.Path)
				return result, mapDomainError(err)
			}})
	}
	r.Register(Op{
		ReplaySafe:        true,
		AssistantCanvas:   true,
		AssistantProposal: true,
		ID:                "skill.script.run",
		Summary:           "Run the script with the selected skill (executed after user confirmation)",
		Scope:             ScopeCanvas,
		Params:            skillScriptRunParams(),
		Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
			var args struct {
				CanvasID              string   `json:"canvasId"`
				SkillID               string   `json:"skillId"`
				VersionID             string   `json:"versionId"`
				ContentHash           string   `json:"contentHash"`
				ScriptPath            string   `json:"scriptPath"`
				Args                  []string `json:"args"`
				Stdin                 string   `json:"stdin"`
				TimeoutSec            int      `json:"timeoutSec"`
				UseWorkspaceOutputDir bool     `json:"useWorkspaceOutputDir"`
				Note                  string   `json:"note"`
			}
			if err := decodeParams(raw, &args); err != nil {
				return nil, err
			}
			if ctx.Caller.Kind != CallerAssistant || strings.TrimSpace(ctx.TurnID) == "" {
				return nil, PermissionDenied("scope_denied", "Skill scripts can only be initiated during built-in assistant dialogue rounds")
			}
			if strings.TrimSpace(args.CanvasID) == "" {
				return nil, InvalidArg("invalid_params", "canvasId required")
			}
			if _, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID); err != nil {
				return nil, mapDomainError(err)
			}
			port, ok := ctx.Domain.(SkillScriptExecutor)
			if !ok {
				return nil, Unsupported("skill_unavailable", "The skill script cannot be run in the current workspace")
			}
			return port.ProposeOrRunSkillScript(ctx.Context, ctx.UserID, ctx.TurnID, skills.ScriptRunRequest{
				CanvasID:              args.CanvasID,
				TurnID:                ctx.TurnID,
				Pin:                   skills.Pin{SkillID: args.SkillID, VersionID: args.VersionID, ContentHash: args.ContentHash},
				ScriptPath:            args.ScriptPath,
				Args:                  args.Args,
				Stdin:                 args.Stdin,
				TimeoutSec:            args.TimeoutSec,
				UseWorkspaceOutputDir: args.UseWorkspaceOutputDir,
				Note:                  args.Note,
			})
		},
	})
}
