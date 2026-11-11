package creation

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/repository"
)

var allowedConfigKeys = []string{
	"channelId", "channelModelKey", "model", "variantId", "apiFormat", "interfaceType",
	"size", "quality", "transparentBackground", "count", "videoSeconds",
	"vquality", "videoGenerateAudio", "videoWatermark", "videoDraft", "videoReturnLastFrame",
	"videoArkPrivateAssetUpload", "systemPrompt",
}

func (s *Service) constrainTask(userID string, repo *repository.Repository, req *TaskRequest) error {
	config, _ := req.Input["config"].(map[string]any)
	if req.LogicalModelID == "" && strings.TrimSpace(stringValue(config["channelId"])) == "" {
		return kernel.BadAuthRequest("Smart creation currently only supports back-end managed models, please use other channels at the original entrance.")
	}
	if s.deps.Kinds != nil && s.deps.Kinds.UsesTextReplay(req.Input) {
		return kernel.BadAuthRequest("Smart Authoring does not support native or text playback tasks")
	}
	safeConfig := map[string]any{}
	for _, key := range allowedConfigKeys {
		if value, ok := config[key]; ok {
			safeConfig[key] = value
		}
	}
	if req.Input == nil {
		req.Input = map[string]any{}
	}
	req.Input["config"] = safeConfig
	if err := ValidateJSON(req); err != nil {
		return err
	}
	if req.Type != "canvas_text" && req.Type != "text" && req.Type != "canvas_image" && req.Type != "canvas_video" {
		return kernel.BadAuthRequest("Smart authoring task type is not supported")
	}
	expectedMode := map[string]string{"text": "text", "canvas_text": "text", "canvas_image": "image", "canvas_video": "video"}[req.Type]
	if stringValue(req.Input["mode"]) != expectedMode || strings.TrimSpace(stringValue(req.Input["prompt"])) != strings.TrimSpace(req.Prompt) {
		return kernel.BadAuthRequest("Task type, mode and actual prompt word must be consistent")
	}
	if expectedMode != "text" && req.Input["agentRequests"] != nil {
		return kernel.BadAuthRequest("Media tasks are not allowed to carry independent model protocol requests")
	}
	if count := stringValue(safeConfig["count"]); count != "" && count != "1" {
		return kernel.BadAuthRequest("Each approved execution item can only produce one product")
	}
	if req.Input["mask"] != nil {
		return kernel.BadAuthRequest("This issue of Intelligent Creation does not currently support mask tasks.")
	}
	if expectedMode != "text" {
		if err := validateLiveImageReferences(userID, repo, req); err != nil {
			return err
		}
	}
	return hydrateResourceStats(userID, repo, req.Input)
}

func validateLiveImageReferences(userID string, repo *repository.Repository, req *TaskRequest) error {
	canvas, err := repo.CanvasProjectForUser(userID, req.ProjectID)
	if err != nil {
		return MapError(err)
	}
	doc, err := parseDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	nodes, err := documentObjects(doc["nodes"])
	if err != nil {
		return err
	}
	refs, ok := req.Input["referenceImages"].([]any)
	if !ok {
		return nil
	}
	for _, raw := range refs {
		ref, _ := raw.(map[string]any)
		node := nodes[stringValue(ref["id"])]
		meta, _ := node["metadata"].(map[string]any)
		if node == nil || node["type"] != "image" || meta["status"] != "success" || stringValue(ref["storageKey"]) != stringValue(meta["storageKey"]) {
			return Conflict("The reference material has changed or is not ready yet")
		}
	}
	return nil
}

func hydrateResourceStats(userID string, repo *repository.Repository, input map[string]any) error {
	for _, name := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		list, ok := input[name].([]any)
		if !ok {
			continue
		}
		for _, raw := range list {
			media, ok := raw.(map[string]any)
			if !ok {
				return kernel.BadAuthRequest("Invalid material reference format")
			}
			key := stringValue(media["storageKey"])
			if !strings.HasPrefix(key, "resource:") {
				return kernel.BadAuthRequest("Please save the reference materials to the current account resource library first")
			}
			resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
			if err != nil {
				return MapError(err)
			}
			if resource.Status != model.ResourceStatusReady {
				return kernel.BadAuthRequest("Reference material is not ready yet")
			}
			delete(media, "url")
			delete(media, "dataUrl")
			media["bytes"] = resource.Size
			media["durationMs"] = resource.DurationMs
		}
	}
	return nil
}

func matchResolvedSpec(requested, resolved map[string]any) error {
	for _, key := range []string{"size", "videoSeconds", "vquality", "quality"} {
		want := stringValue(requested[key])
		if want != "" && !strings.EqualFold(want, stringValue(resolved[key])) {
			return Conflict("The generated specifications after model analysis are different from the request. Please adjust the plan and reconfirm.")
		}
	}
	return nil
}

func assertTextReferenceCapacity(repo *repository.Repository, task *model.Task, channelID, modelKey string, imageCount int) error {
	if imageCount == 0 {
		return nil
	}
	queryModel := modelKey
	cm, err := repo.ChannelModelByKey(channelID, queryModel)
	if err != nil {
		return err
	}
	profile, err := modelcatalog.DecodeModelCapabilityConfig(cm.CapabilityConfigJSON)
	if err != nil || profile == nil || profile.Text == nil || profile.Text.References.MaxImages < imageCount {
		return kernel.BadAuthRequest("The current text model is not configured with sufficient image understanding capabilities")
	}
	return nil
}

func executionFor(task *model.Task, signature string) Execution {
	execution := Execution{Model: task.Model, Options: map[string]any{}}
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	config, _ := input["config"].(map[string]any)
	for _, key := range []string{"size", "videoSeconds", "vquality", "quality", "maxTokens"} {
		if value, ok := config[key]; ok {
			execution.Options[key] = value
		}
	}
	execution.ConfigHash = Hash([]any{signature, execution.Options})
	return execution
}

func checkConfigSignature(repo *repository.Repository, task *model.Task, want string) error {
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	config, _ := input["config"].(map[string]any)
	got, err := repo.CreationConfigSignature(task, stringValue(config["channelId"]), stringValue(config["model"]))
	if err != nil {
		return err
	}
	if got != want {
		return Conflict("The model execution configuration has been updated, please reconfirm")
	}
	return nil
}
