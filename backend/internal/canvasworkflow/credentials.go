package canvasworkflow

import (
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/beeftv"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
)

// The private recipe freezes generation parameters, while channel identity
// resolves credentials at the time of a new submission. Deleted connections
// cannot be resurrected by an encrypted historical task key.

// Refresh only an unaccepted, retryable submission. Accepted provider jobs,
// uncertain submissions and successful deliveries keep their original receipt
// and credential identity so the ordinary recovery path can reconcile them.
func PrepareRetryCredentials(host CompileHost, run model.CanvasWorkflowRun, nodeID string, task *model.Task) (string, error) {
	if !host.LocalMode() || task == nil || (task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled) || task.ProviderRequestID != "" || task.PollStage != "" || task.NextPollAt != nil || task.Stage == "submission_unknown" {
		return "", nil
	}
	authFailure := generation.ClassifyText(task.Error).Category == generation.CategoryAuth
	if host.PersistedFailureBlocksRetry(task.Error, task.Stage) && !authFailure {
		return "", nil
	}
	if task.Type == "canvas_image" {
		if host.ImageRetryBlocked(task) {
			return "", nil
		}
		accepted, err := host.ImageCreateAccepted(task.UserID, task.ID)
		if err != nil {
			return "", err
		}
		if accepted {
			return "", nil
		}
	}
	plain, err := host.DecryptSetting(run.RecipeCipher)
	if err != nil {
		return "", BadRequest("Unable to read workflow recipe, please restore workspace key first")
	}
	var recipes RecipesByNode
	if json.Unmarshal([]byte(plain), &recipes) != nil {
		return "", BadRequest("The workflow recipe cannot be read, please save the template again")
	}
	recipe, ok := recipes[nodeID]
	if !ok || recipe.ChannelID == "" {
		return "", nil
	}
	decoded, err := host.DecryptTaskInput(task.InputJSON)
	if err != nil {
		return "", BadRequest("The original task recipe cannot be decrypted, please restore the workspace key first")
	}
	var input map[string]any
	if json.Unmarshal([]byte(decoded), &input) != nil || input == nil {
		return "", BadRequest("The original task recipe cannot be read, please save the template again")
	}
	previousCredentials := CredentialFingerprint(input)
	if err = RefreshCredentials(host, input, recipe.ChannelID); err != nil {
		return "", err
	}
	if previousCredentials == CredentialFingerprint(input) {
		if authFailure {
			return "", BadRequest("This step failed to authenticate last time. The current connection credentials have not been updated. Please correct the API Key in the settings and try again.")
		}
		return "", nil
	}
	if err = host.ProtectTaskSecrets(input); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(input)
	return string(encoded), err
}

func CredentialFingerprint(input map[string]any) string {
	config, _ := input["config"].(map[string]any)
	credentials := map[string]any{}
	for _, key := range []string{"apiKey", "secretKey", "headers", "baseUrl", "credentialRef"} {
		if value, ok := config[key]; ok {
			credentials[key] = value
		}
	}
	encoded, _ := json.Marshal(credentials)
	return string(encoded)
}

func ChannelID(host CompileHost, input map[string]any, logical string) (string, error) {
	if !host.LocalMode() || logical != "" {
		return "", nil
	}
	config, _ := input["config"].(map[string]any)
	if config == nil {
		return "", BadRequest("The original generation step is missing model configuration")
	}
	if beeftv.IsManagedChannel(stringValue(config["channelId"]), stringValue(config["credentialRef"]), stringValue(config["baseUrl"])) {
		return "@beeftv", nil
	}
	snapshot, e := host.ProviderConfig()
	if e != nil {
		return "", e
	}
	body, _ := json.Marshal(snapshot)
	modelName := stringValue(config["model"])
	base := strings.TrimRight(stringValue(config["baseUrl"]), "/")
	selected := stringValue(config["channelId"])
	ids := map[string]bool{}
	for _, candidate := range modelcatalog.ParseLocalChannelModels(body) {
		if candidate.Model == modelName && strings.TrimRight(candidate.BaseURL, "/") == base && candidate.Enabled && (selected == "" || candidate.ChannelID == selected) {
			ids[candidate.ChannelID] = true
		}
	}
	if len(ids) != 1 {
		return "", BadRequest("Unable to uniquely find an available channel for the original generation step, please enable the original model channel in the settings and re-run the node manually")
	}
	for id := range ids {
		return id, nil
	}
	return "", nil
}

func RefreshCredentials(host CompileHost, input map[string]any, channelID string) error {
	if !host.LocalMode() || channelID == "" {
		return nil
	}
	config, _ := input["config"].(map[string]any)
	if config == nil {
		return BadRequest("Model configuration for build step is missing")
	}
	if IsOfficialWorkflowChannel(channelID) {
		key, base, e := host.ManagedCredential()
		if e != nil {
			return e
		}
		if key == "" {
			return BadRequest("BeefTV connection has been disconnected, please reconnect in settings first")
		}
		config["apiKey"] = key
		config["baseUrl"] = base
		config["credentialRef"] = host.ManagedCredentialRef()
		config["secretKey"] = ""
		config["headers"] = []any{}
		delete(config, "channelId")
		return nil
	}
	snapshot, e := host.ProviderConfig()
	if e != nil {
		return e
	}
	channels, _ := snapshot["channels"].([]any)
	var current map[string]any
	for _, raw := range channels {
		item, _ := raw.(map[string]any)
		if stringValue(item["id"]) == channelID {
			current = item
			break
		}
	}
	if current == nil {
		return BadRequest("The model channel used by the workflow has been deleted. Please restore the channel or save the workflow again.")
	}
	if enabled, ok := current["enabled"].(bool); ok && !enabled {
		return BadRequest("The model channel used by the workflow has been disabled. Please enable it in settings first.")
	}
	body, _ := json.Marshal(snapshot)
	modelName := stringValue(config["model"])
	found := false
	for _, candidate := range modelcatalog.ParseLocalChannelModels(body) {
		if candidate.ChannelID == channelID && candidate.Model == modelName && candidate.Enabled {
			found = true
			if candidate.Protocol != "" && candidate.Protocol != stringValue(config["interfaceType"]) {
				return BadRequest("The protocol of the workflow model has changed. Please run the node manually and save the workflow again.")
			}
		}
	}
	if !found {
		return BadRequest("The model used by the workflow has been removed from the channel, please restore the model or re-save the workflow")
	}
	for _, key := range []string{"apiKey", "secretKey", "headers", "baseUrl", "referenceAssetOrigin"} {
		if value, ok := current[key]; ok {
			config[key] = value
		} else {
			delete(config, key)
		}
	}
	return nil
}

func stringValue(value any) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}
