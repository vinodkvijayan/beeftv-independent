package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/operations"

	"github.com/gin-gonic/gin"
)

func TestAssistantProposalFailureKeepsBusinessStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"proposal changed", operations.Conflict("production_changed", "The generation plan has changed", nil), http.StatusConflict},
		{"proposal revoked", operations.PreconditionFailed("production_revoked", "The generation plan has been withdrawn", nil), http.StatusPreconditionFailed},
		{"invalid kind", operations.InvalidArg("invalid_kind", "Invalid plan type"), http.StatusBadRequest},
		{"turn missing", &app.AssistantTurnError{Reason: app.AssistantTurnReasonNotFound, Message: "Round does not exist"}, http.StatusNotFound},
		{"unexpected", errors.New("database closed"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/assistant/turns/t/proposals/p/production", nil)
			failAssistantProposal(c, tc.err)
			if recorder.Code != tc.want {
				t.Fatalf("status=%d, want %d: %s", recorder.Code, tc.want, recorder.Body.String())
			}
		})
	}
}
