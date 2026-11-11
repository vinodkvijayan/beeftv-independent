package task

import (
	"encoding/json"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type retryCredentialRefresh struct {
	expectedInputJSON string
	inputJSON         string
}
type credentialRetryStore interface {
	RetryWithExpectedInput(userID string, prepared *model.Task, limit int, expectedInputJSON string) (*model.Task, error)
}

func (s *Service) validateRetryCredentialRefresh(task *model.Task, refresh retryCredentialRefresh) error {
	if task.InputJSON != refresh.expectedInputJSON || task.ProviderRequestID != "" || task.PollStage != "" || task.NextPollAt != nil || task.Stage == "submission_unknown" {
		return kernel.BadAuthRequest("The original task has been accepted or the status has changed. Please query the original task first to avoid repeated generation.")
	}
	previous, err := s.deps.Secrets.DecryptInputJSON(task.InputJSON)
	if err != nil {
		return err
	}
	next, err := s.deps.Secrets.DecryptInputJSON(refresh.inputJSON)
	if err != nil {
		return err
	}
	var before, after map[string]any
	if json.Unmarshal([]byte(previous), &before) != nil || json.Unmarshal([]byte(next), &after) != nil || before == nil || after == nil {
		return kernel.BadAuthRequest("The original task recipe format is invalid")
	}
	credentials := []string{}
	for _, input := range []map[string]any{before, after} {
		config, _ := input["config"].(map[string]any)
		if config == nil {
			return kernel.BadAuthRequest("The original task lacks channel configuration")
		}
		connection := map[string]any{}
		for _, key := range []string{"apiKey", "secretKey", "headers", "baseUrl", "credentialRef", "referenceAssetOrigin"} {
			if value, ok := config[key]; ok {
				connection[key] = value
			}
			delete(config, key)
		}
		encoded, _ := json.Marshal(connection)
		credentials = append(credentials, string(encoded))
	}
	if credentials[0] == credentials[1] {
		return kernel.BadAuthRequest("The connection credentials have not been updated. Please correct it in the settings and try again.")
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if string(beforeJSON) != string(afterJSON) {
		return kernel.BadAuthRequest("Credential refresh cannot change the original task content, please rerun the workflow")
	}
	return nil
}
