package canvasworkflow

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// CaptureSource encrypts a task command before completion compacts InputJSON.
// The snapshot and successful result commit atomically on the task row, and
// disappear with the task. An already captured cipher is returned unchanged.
func CaptureSource(host CompileHost, task model.Task) (string, error) {
	if task.WorkflowSourceCipher != "" {
		return task.WorkflowSourceCipher, nil
	}
	if task.Type != "canvas_image" && task.Type != "canvas_video" && task.Type != "canvas_audio" && task.Type != "canvas_text" && !strings.HasPrefix(task.Type, "video_") {
		return "", nil
	}
	var input map[string]any
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input == nil {
		return "", nil
	}
	if _, ok := input["config"].(map[string]any); !ok {
		return "", nil
	}
	// The canonical input already protects credentials. Encrypt the entire
	// command as well so private prompts and reference identities stay private.
	return host.EncryptSetting(task.InputJSON)
}

func SourceInput(host CompileHost, task *model.Task) (map[string]any, error) {
	raw := task.InputJSON
	if task.WorkflowSourceCipher != "" {
		var err error
		raw, err = host.DecryptSetting(task.WorkflowSourceCipher)
		if err != nil {
			return nil, BadRequest("Unable to decrypt the original workflow recipe, please restore the workspace key first or manually run the node again")
		}
	}
	plain, err := host.DecryptTaskInput(raw)
	if err != nil {
		return nil, BadRequest("Unable to read the original task recipe, please run the node manually again")
	}
	var input map[string]any
	if json.Unmarshal([]byte(plain), &input) != nil || input == nil {
		return nil, BadRequest("The original task recipe format is invalid")
	}
	if _, ok := input["config"].(map[string]any); !ok {
		return nil, BadRequest("The complete recipe of this historical task has been cleaned. Please manually rerun the build node before saving the successful process as a workflow.")
	}
	return input, nil
}
