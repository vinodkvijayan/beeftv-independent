package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/model"

	"github.com/gin-gonic/gin"
)

var (
	geminiGeneratePath         = regexp.MustCompile(`^/models/([^/:]+):(generateContent|streamGenerateContent)$`)
	customGeminiRelayPath      = regexp.MustCompile(`(?:^|/)models/[^/:]+:(generateContent|streamGenerateContent|predictLongRunning)$`)
	customVideoTaskPath        = regexp.MustCompile(`(?:^|/)video/generations/[^/]+$`)
	customXAIVideoTaskPath     = regexp.MustCompile(`(?:^|/)videos/[^/]+$`)
	customVideoContentPath     = regexp.MustCompile(`(?:^|/)videos/[^/]+/content$`)
	customArkVideoTaskPath     = regexp.MustCompile(`(?:^|/)contents/generations/tasks/[^/]+$`)
	customGeminiOperationPath  = regexp.MustCompile(`(?:^|/)(?:models/[^/]+/)?operations/[^/]+$`)
	customNovitaTaskResultPath = regexp.MustCompile(`(?:^|/)async/task-result$`)
	customMiniMaxTaskPath      = regexp.MustCompile(`(?:^|/)v2/query/video_generation/[^/]+$`)
	systemMiniMaxTaskPath      = regexp.MustCompile(`^/v2/query/video_generation/[^/]+$`)
	openAIPostEndpoints        = map[string]bool{
		"/responses": true, "/chat/completions": true, "/images/generations": true, "/images/edits": true,
		"/audio/speech": true, "/messages": true,
	}
)

func authorizeCustomRelay(method string, target *url.URL, apiFormat string, contentType string) error {
	requestPath, err := normalizedCustomRelayPath(target.EscapedPath())
	if err != nil {
		return err
	}
	query, err := url.ParseQuery(target.RawQuery)
	if err != nil {
		return errors.New("Invalid custom channel query parameters")
	}
	for key := range query {
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "key", "api_key", "access_token", "token":
			return errors.New("Custom channel addresses do not allow keys to be carried in query parameters")
		}
	}

	apiFormat = strings.ToLower(strings.TrimSpace(apiFormat))
	if apiFormat != "openai" && apiFormat != "gemini" && apiFormat != "claude" {
		return errors.New("The custom channel call format is invalid")
	}
	if method == http.MethodGet {
		if apiFormat == "openai" && requestPath == "/agnesapi" {
			if len(query) == 2 && len(query["video_id"]) == 1 && len(query["model_name"]) == 1 && strings.TrimSpace(query.Get("video_id")) != "" && strings.TrimSpace(query.Get("model_name")) != "" {
				return nil
			}
			return errors.New("Agnes video query must provide video_id and model_name")
		}
		if customNovitaTaskResultPath.MatchString(requestPath) {
			if len(query) == 1 && len(query["task_id"]) == 1 && strings.TrimSpace(query.Get("task_id")) != "" {
				return nil
			}
			return errors.New("Custom channels do not allow access to the upstream interface")
		}
		allowed := requestPath == "/models" || strings.HasSuffix(requestPath, "/models")
		if apiFormat == "openai" {
			allowed = allowed || customVideoTaskPath.MatchString(requestPath) || customXAIVideoTaskPath.MatchString(requestPath) || customVideoContentPath.MatchString(requestPath) || customArkVideoTaskPath.MatchString(requestPath) || customMiniMaxTaskPath.MatchString(requestPath)
		} else if apiFormat == "gemini" {
			allowed = allowed || customGeminiOperationPath.MatchString(requestPath)
		}
		if len(query) != 0 || !allowed {
			return errors.New("Custom channels do not allow access to the upstream interface")
		}
		return nil
	}
	if method != http.MethodPost {
		return errors.New("This request method is not allowed for custom channels")
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return errors.New("Invalid custom channel build request type")
	}
	if apiFormat == "openai" {
		multipartAllowed := mediaType == "multipart/form-data" && (strings.HasSuffix(requestPath, "/images/edits") || strings.HasSuffix(requestPath, "/videos"))
		jsonAllowed := mediaType == "application/json" && (strings.HasSuffix(requestPath, "/responses") || strings.HasSuffix(requestPath, "/chat/completions") || strings.HasSuffix(requestPath, "/images/generations") || strings.HasSuffix(requestPath, "/images/edits") || strings.HasSuffix(requestPath, "/audio/speech") || strings.HasSuffix(requestPath, "/video/generations") || strings.HasSuffix(requestPath, "/videos/generations") || strings.HasSuffix(requestPath, "/videos") || strings.HasSuffix(requestPath, "/contents/generations/tasks") || strings.HasSuffix(requestPath, "/video/create") || strings.HasSuffix(requestPath, "/v2/video_generation"))
		if len(query) != 0 || (!multipartAllowed && !jsonAllowed) {
			return errors.New("Custom channels do not allow access to the upstream interface")
		}
		return nil
	}
	if apiFormat == "claude" {
		if mediaType != "application/json" || !strings.HasSuffix(requestPath, "/messages") {
			return errors.New("Claude custom channel only allows /messages requests for application/json")
		}
		return nil
	}
	if mediaType != "application/json" {
		return errors.New("Gemini custom channel generation requests must use application/json")
	}
	if !customGeminiRelayPath.MatchString(requestPath) {
		return errors.New("Custom channels do not allow access to the upstream interface")
	}
	if len(query) == 0 {
		return nil
	}
	if len(query) == 1 && len(query["alt"]) == 1 && query.Get("alt") == "sse" && strings.HasSuffix(requestPath, ":streamGenerateContent") {
		return nil
	}
	return errors.New("This query parameter is not allowed in custom channels")
}

func normalizedCustomRelayPath(value string) (string, error) {
	if len(value) > 2048 {
		return "", errors.New("Custom channel request path is too long")
	}
	decoded, err := url.PathUnescape(value)
	if err != nil || strings.Contains(decoded, "\\") || strings.Contains(decoded, "\x00") {
		return "", errors.New("The custom channel request path is invalid")
	}
	cleaned := path.Clean("/" + strings.TrimPrefix(decoded, "/"))
	if cleaned != decoded && cleaned != "/"+strings.TrimPrefix(decoded, "/") {
		return "", errors.New("The custom channel request path is invalid")
	}
	return cleaned, nil
}

func enforceRateLimit(c *gin.Context, key string, limit int, window time.Duration) bool {
	dependencies, ok := runtimeDependencies(c)
	if !ok || dependencies.RequestCoordinator == nil {
		fail(c, http.StatusServiceUnavailable, errors.New("The request coordinator has not been initialized yet"))
		return false
	}
	allowed, err := dependencies.RequestCoordinator.AllowRequest(c.Request.Context(), key, limit, window)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, errors.New("The request coordination service is temporarily unavailable"))
		return false
	}
	if allowed {
		return true
	}
	wait := dependencies.RequestCoordinator.RequestRetryAfter(c.Request.Context(), key, window)
	seconds := max(1, int((wait+time.Second-1)/time.Second))
	c.Header("Retry-After", strconv.Itoa(seconds))
	failService(c, app.RateLimited(fmt.Sprintf("The number of requests has reached the upper limit, please try again in %d seconds.", seconds)))
	return false
}

// runtimePolicies is the only platform read shared by request throttling.
type runtimePolicies interface {
	RuntimePolicy() (app.RuntimePolicySetting, error)
}

func loadRuntimePolicy(c *gin.Context, policies runtimePolicies) (app.RuntimePolicySetting, bool) {
	policy, err := policies.RuntimePolicy()
	if err != nil {
		failInternal(c, http.StatusServiceUnavailable, err)
		return app.RuntimePolicySetting{}, false
	}
	return policy, true
}

func authorizeSystemProxy(channel *model.ModelChannel, protocol model.ChannelInterfaceType, method string, requestPath string, contentType string, body []byte) error {
	requestPath, err := normalizedProxyPath(requestPath)
	if err != nil {
		return err
	}
	if method == http.MethodGet && requestPath == "/models" {
		return nil
	}
	if protocol == model.ChannelInterfaceAgnesVideo {
		if method == http.MethodGet && requestPath == "/agnesapi" {
			return nil
		}
		if method != http.MethodPost || requestPath != "/videos" {
			return errors.New("The system channel does not allow access to the upstream interface")
		}
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			return errors.New("Agnes video generation requests must use application/json")
		}
		modelName := proxyRequestModel(contentType, body)
		if modelName == "" || !channelAllowsModel(channel, modelName) {
			return errors.New("The model is not authorized by the current system channel")
		}
		return nil
	}
	if protocol == model.ChannelInterfaceMiniMaxVideo {
		if method == http.MethodGet && systemMiniMaxTaskPath.MatchString(requestPath) {
			return nil
		}
		if method != http.MethodPost || requestPath != "/v2/video_generation" {
			return errors.New("The system channel does not allow access to the upstream interface")
		}
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			return errors.New("MiniMax video generation requests must use application/json")
		}
		modelName := proxyRequestModel(contentType, body)
		if modelName == "" || !channelAllowsModel(channel, modelName) {
			return errors.New("The model is not authorized by the current system channel")
		}
		return nil
	}
	if protocol == model.ChannelInterfaceGeminiVeo || protocol == model.ChannelInterfaceGeminiImage {
		matches := geminiGeneratePath.FindStringSubmatch(requestPath)
		if method != http.MethodPost || len(matches) != 3 {
			return errors.New("The system channel does not allow access to the upstream interface")
		}
		modelName, err := url.PathUnescape(matches[1])
		if err != nil || !channelAllowsModel(channel, modelName) {
			return errors.New("The model is not authorized by the current system channel")
		}
		return nil
	}
	if method != http.MethodPost || !openAIPostEndpoints[requestPath] {
		return errors.New("The system channel does not allow access to the upstream interface")
	}
	if protocol != "" && !interfaceAllowsProxyPath(protocol, requestPath) {
		return errors.New("The current interface type does not allow access to the upstream interface")
	}
	modelName := proxyRequestModel(contentType, body)
	if modelName == "" || !channelAllowsModel(channel, modelName) {
		return errors.New("The model is not authorized by the current system channel")
	}
	return nil
}

func interfaceAllowsProxyPath(interfaceType model.ChannelInterfaceType, requestPath string) bool {
	switch interfaceType {
	case model.ChannelInterfaceChatCompletion:
		return requestPath == "/chat/completions"
	case model.ChannelInterfaceOpenAIResponse:
		return requestPath == "/responses"
	case model.ChannelInterfaceClaudeAPI:
		return requestPath == "/messages"
	case model.ChannelInterfaceOpenAIImage, model.ChannelInterfaceGrokImage:
		return requestPath == "/images/generations" || requestPath == "/images/edits"
	case model.ChannelInterfaceVolcengineArkImage, model.ChannelInterfaceVolcengineArkAgentPlanImage:
		return requestPath == "/images/generations"
	case model.ChannelInterfaceOpenAIAudio:
		return requestPath == "/audio/speech"
	case model.ChannelInterfaceAsyncAudio, model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo, model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineArkAgentPlanVideo, model.ChannelInterfaceVolcengineJiMengImage, model.ChannelInterfaceVolcengineJiMengVideo, model.ChannelInterfaceGeminiVeo, model.ChannelInterfaceGeminiImage, model.ChannelInterfaceNovitaVideo, model.ChannelInterfaceMiniMaxVideo:
		return false
	default:
		return true
	}
}

func normalizedProxyPath(value string) (string, error) {
	decoded, err := url.PathUnescape(value)
	if err != nil || strings.Contains(decoded, "\\") || strings.Contains(decoded, "\x00") {
		return "", errors.New("System channel request path is invalid")
	}
	cleaned := path.Clean("/" + strings.TrimPrefix(decoded, "/"))
	if cleaned != decoded && cleaned != "/"+strings.TrimPrefix(decoded, "/") {
		return "", errors.New("System channel request path is invalid")
	}
	return cleaned, nil
}

func channelAllowsModel(channel *model.ModelChannel, requested string) bool {
	requested = strings.TrimPrefix(strings.TrimSpace(requested), "models/")
	var models []string
	_ = json.Unmarshal([]byte(channel.ModelsJSON), &models)
	for _, configured := range models {
		if strings.TrimPrefix(strings.TrimSpace(configured), "models/") == requested {
			return true
		}
	}
	return false
}

func proxyRequestModel(contentType string, body []byte) string {
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if strings.HasPrefix(mediaType, "multipart/") {
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		for {
			part, err := reader.NextPart()
			if err != nil {
				return ""
			}
			if part.FormName() == "model" {
				value, _ := io.ReadAll(io.LimitReader(part, 1024))
				return strings.TrimSpace(string(value))
			}
			_ = part.Close()
		}
	}
	var payload map[string]interface{}
	if json.Unmarshal(body, &payload) != nil {
		return ""
	}
	modelName, _ := payload["model"].(string)
	return strings.TrimSpace(modelName)
}

func proxyRequestModelForPath(requestPath string, contentType string, body []byte) string {
	if matches := geminiGeneratePath.FindStringSubmatch(requestPath); len(matches) == 3 {
		modelName, err := url.PathUnescape(matches[1])
		if err == nil {
			return strings.TrimPrefix(strings.TrimSpace(modelName), "models/")
		}
	}
	return proxyRequestModel(contentType, body)
}

func proxyRequestVideoSeconds(contentType string, body []byte) int64 {
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if strings.HasPrefix(mediaType, "multipart/") {
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		for {
			part, err := reader.NextPart()
			if err != nil {
				return 0
			}
			if part.FormName() == "seconds" || part.FormName() == "duration" {
				value, _ := io.ReadAll(io.LimitReader(part, 32))
				seconds, _ := strconv.ParseInt(strings.TrimSpace(string(value)), 10, 64)
				return seconds
			}
			_ = part.Close()
		}
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return 0
	}
	for _, key := range []string{"seconds", "duration"} {
		value, exists := payload[key]
		if !exists {
			continue
		}
		seconds, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		return seconds
	}
	return 0
}
