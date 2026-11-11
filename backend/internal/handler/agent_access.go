package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/app"
)

// ownerCredentialDirs locates the owner token file. Agent routes still pass
// the composition root; business discovery only needs this one method.
type ownerCredentialDirs interface {
	DataDir() string
}

// requireOwner 是所有 owner 级入口的唯一准入判断：本机同源 + owner 凭据。
// 统一在这里，避免每个文件各写一份表达式。
func requireOwner(c *gin.Context, dirs ownerCredentialDirs) bool {
	if !isLoopbackRequest(c.Request) {
		fail(c, http.StatusForbidden, app.BadAuthRequest("Only accept local origin requests"))
		return false
	}
	if !agentops.OwnerTokenMatches(dirs.DataDir(), strings.TrimSpace(c.GetHeader("X-Beeftv-Owner"))) {
		fail(c, http.StatusForbidden, app.BadAuthRequest("This operation requires owner credentials"))
		return false
	}
	return true
}
