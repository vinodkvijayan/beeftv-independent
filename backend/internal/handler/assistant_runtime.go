package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/operations"
	"io"
	"net/http"
)

// Runtime lifecycle is a host capability, never a model-discoverable operation.
func registerAssistantRuntimeRoutes(r gin.IRouter, svc *app.Service) {
	registerAssistantRuntimeSkillContextRoutes(r, svc)
	handle := func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) || !isAssistantHostRequest(c, svc) {
			fail(c, http.StatusForbidden, app.Forbidden("Only built-in helper hosts can resume or end tasks"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		state, err := svc.AssistantTurns().RuntimeState(user.ID, c.Param("turnId"))
		if err != nil {
			fail(c, http.StatusForbidden, app.Forbidden("Task is not recoverable"))
			return
		}
		if c.Request.Method == http.MethodPost {
			if err := svc.FinalizeAssistantTurn(state.TurnID); err != nil {
				failService(c, err)
				return
			}
			state.Open = false
		}
		ok(c, state)
	}

	r.POST("/assistant/runtime/turns/:turnId/bind-session", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) || !isAssistantHostRequest(c, svc) {
			fail(c, http.StatusForbidden, app.Forbidden("Only built-in helper hosts can bind sessions"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			SessionID     string                  `json:"sessionId"`
			Historical    bool                    `json:"historical"`
			CurrentTurnID string                  `json:"currentTurnId"`
			Source        *operations.MediaSource `json:"source"`
		}
		decoder := json.NewDecoder(io.LimitReader(c.Request.Body, 8192))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil {
			fail(c, http.StatusBadRequest, app.BadAuthRequest("Invalid session binding parameter"))
			return
		}
		if err := svc.AssistantTurns().BindDurableSession(user.ID, c.Param("turnId"), body.SessionID, body.Historical); err != nil {
			failService(c, err)
			return
		}
		if body.Source != nil {
			if err := svc.RegisterAssistantNativeSource(c.Request.Context(), user.ID, body.CurrentTurnID, c.Param("turnId"), body.SessionID, *body.Source); err != nil {
				failService(c, err)
				return
			}
		}
		ok(c, map[string]any{"bound": true})
	})
	r.POST("/assistant/runtime/turns/:turnId/native-rehydrate", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) || !isAssistantHostRequest(c, svc) {
			fail(c, http.StatusForbidden, app.Forbidden("Only the built-in assistant host can restore historical materials"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			SessionID    string                 `json:"sessionId"`
			OriginTurnID string                 `json:"originTurnId"`
			Source       operations.MediaSource `json:"source"`
		}
		decoder := json.NewDecoder(io.LimitReader(c.Request.Body, 8192))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil || body.Source.Version == "" || body.Source.ResourceID == "" {
			fail(c, http.StatusBadRequest, app.BadAuthRequest("Historical material parameters are invalid"))
			return
		}
		result, err := svc.RevalidateAssistantNativeSource(c.Request.Context(), user.ID, c.Param("turnId"), body.OriginTurnID, body.SessionID, body.Source)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/assistant/runtime/turns", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) || !isAssistantHostRequest(c, svc) {
			fail(c, http.StatusForbidden, app.Forbidden("Only built-in assistant hosts can start tasks"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			TurnID         string `json:"turnId"`
			CanvasID       string `json:"canvasId"`
			PermissionMode string `json:"permissionMode"`
			SessionID      string `json:"sessionId"`
		}
		decoder := json.NewDecoder(io.LimitReader(c.Request.Body, 8192))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil || body.TurnID == "" || body.CanvasID == "" {
			fail(c, http.StatusBadRequest, app.BadAuthRequest("Invalid task startup parameters"))
			return
		}
		mode := body.PermissionMode
		if mode == "" {
			mode = "canvas"
		}
		if _, err := svc.BeginAssistantTurn(user.ID, body.CanvasID, body.TurnID, app.AssistantTurnInput{PermissionMode: mode}); err != nil {
			failService(c, err)
			return
		}
		if body.SessionID != "" {
			if err := svc.AssistantTurns().BindDurableSession(user.ID, body.TurnID, body.SessionID, false); err != nil {
				failService(c, err)
				return
			}
		}
		state, err := svc.AssistantTurns().RuntimeState(user.ID, body.TurnID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, state)
	})
	r.GET("/assistant/runtime/turns/:turnId", handle)
	r.POST("/assistant/runtime/turns/:turnId/complete", handle)
}
