package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"infinite-canvas/backend/internal/assistantruntime"
	"infinite-canvas/backend/internal/assistantturns"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/operations"
	"infinite-canvas/backend/internal/skills"
)

type assistantSkillScriptService interface {
	ownerCredentialDirs
	Database() *gorm.DB
	SkillsDomain() *skills.Service
	AssistantTurns() *assistantturns.Service
}

func registerAssistantSkillScriptRoutes(
	r gin.IRouter,
	svc assistantSkillScriptService,
	host *assistantruntime.Host,
	guard func(*gin.Context, bool) bool,
	requireOwnedCanvas func(*gin.Context, string) (json.RawMessage, bool),
) {
	r.POST("/assistant/turns/:turnId/script-proposals/:proposalId/run", func(c *gin.Context) {
		if strings.TrimSpace(c.GetHeader("X-Beeftv-Client")) != "" || isAssistantHostRequest(c, svc) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":   http.StatusForbidden,
				"reason": "agent_token_cannot_approve",
				"msg":    "The Agent's own credentials cannot approve script execution, please confirm on the BeefTV interface.",
			})
			return
		}
		if !guard(c, true) {
			return
		}
		_, payload, valid := readAssistantBody(c, struct {
			CanvasID           string `json:"canvasId"`
			AlwaysAllowSession bool   `json:"alwaysAllowSession"`
		}{})
		if !valid {
			return
		}
		if !assistantProposalIDPattern.MatchString(c.Param("proposalId")) {
			fail(c, http.StatusBadRequest, kernel.BadAuthRequest("Invalid script run proposal ID"))
			return
		}
		canvasRaw, allowed := requireOwnedCanvas(c, payload.CanvasID)
		if !allowed {
			return
		}
		userID := c.GetString("agentUserId")
		turnID := c.Param("turnId")
		if err := svc.AssistantTurns().CheckProposalRunnable(userID, payload.CanvasID, turnID); err != nil {
			failAssistantProposal(c, err)
			return
		}
		proposal, result, err := operations.ConfirmSkillScriptProposal(
			c.Request.Context(),
			svc.Database(),
			svc.SkillsDomain(),
			userID,
			turnID,
			c.Param("proposalId"),
			payload.CanvasID,
			payload.AlwaysAllowSession,
		)
		if err != nil {
			failAssistantProposal(c, err)
			return
		}
		continuationMsg := ""
		woken := false
		if !result.Cancelled && proposal.Status != "cancelled" && c.Request.Context().Err() == nil &&
			svc.AssistantTurns().CheckProposalRunnable(userID, payload.CanvasID, turnID) == nil {
			continuationMsg = formatSkillScriptContinuationMessage(*proposal, *result)
			woken = wakeHostWithScriptResult(c.Request.Context(), host, payload.CanvasID, proposal, continuationMsg, canvasRaw)
		}
		ok(c, gin.H{
			"proposal":            proposal,
			"result":              result,
			"woken":               woken,
			"continuationMessage": continuationMsg,
		})
	})
}

func formatSkillScriptContinuationMessage(proposal operations.SkillScriptProposal, res skills.ScriptRunResult) string {
	const maxEventStreamField = 12 * 1024
	stdout := res.Stdout
	if len(stdout) > maxEventStreamField {
		stdout = stdout[:maxEventStreamField] + "...[Event summary truncated]"
	}
	stderr := res.Stderr
	if len(stderr) > maxEventStreamField {
		stderr = stderr[:maxEventStreamField] + "...[Event summary truncated]"
	}
	payload := map[string]any{
		"proposalId":  proposal.ProposalID,
		"skillId":     proposal.SkillID,
		"skillName":   proposal.SkillName,
		"versionId":   proposal.VersionID,
		"contentHash": proposal.ContentHash,
		"scriptPath":  proposal.ScriptPath,
		"interpreter": proposal.Interpreter,
		"args":        proposal.Args,
		"status":      proposal.Status,
		"exitCode":    res.ExitCode,
		"timedOut":    res.TimedOut,
		"cancelled":   res.Cancelled,
		"durationMs":  res.DurationMs,
		"stdout":      stdout,
		"stderr":      stderr,
		"outputFiles": res.OutputFiles,
	}
	encoded, _ := json.Marshal(payload)
	return fmt.Sprintf("The user has confirmed and ran skill script `%s` (status: %s, exit code: %d). Please continue to complete the task based on the following results:\n<skill_script_result>\n%s\n</skill_script_result>",
		proposal.ScriptPath, proposal.Status, res.ExitCode, string(encoded))
}

func wakeHostWithScriptResult(
	ctx context.Context,
	host *assistantruntime.Host,
	canvasID string,
	proposal *operations.SkillScriptProposal,
	message string,
	canvasRaw json.RawMessage,
) bool {
	if host == nil || host.Endpoint() == "" || proposal == nil {
		return false
	}
	var doc map[string]any
	_ = json.Unmarshal(canvasRaw, &doc)
	revBefore := int64(0)
	if v, ok := doc["revision"].(float64); ok {
		revBefore = int64(v)
	}
	body, err := json.Marshal(map[string]any{
		"canvasId":       canvasID,
		"sessionId":      proposal.SessionID,
		"requestId":      "script-run-" + proposal.ProposalID,
		"kind":           "skill_script_completed",
		"userText":       "Confirmed to run skill script:" + proposal.ScriptPath,
		"message":        message,
		"revisionBefore": revBefore,
	})
	if err != nil {
		return false
	}
	req, err := host.NewChildRequest(context.WithoutCancel(ctx), http.MethodPost, "/events", bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := agentHostClient(15 * time.Second).Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var decoded struct {
		Accepted bool `json:"accepted"`
		Woken    bool `json:"woken"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 8<<10)).Decode(&decoded)
	return resp.StatusCode/100 == 2 && (decoded.Woken || decoded.Accepted)
}
