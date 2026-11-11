package taskbinding

import (
	"errors"
	"strings"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

// AttachMessage binds a durable backend task output onto an existing
// conversation message in one domain step. Conversation CAS retries stay
// inside this call so the operation identity does not change.
func AttachMessage(ports MessagePorts, userID string, req MessageRequest) (MessageReceipt, error) {
	if ports == nil {
		return MessageReceipt{}, invalid("bind_ports_unavailable", "Binding port is not available")
	}
	userID = strings.TrimSpace(userID)
	req.ConversationID = strings.TrimSpace(req.ConversationID)
	req.MessageID = strings.TrimSpace(req.MessageID)
	req.TaskID = strings.TrimSpace(req.TaskID)
	req.EffectKey = strings.TrimSpace(req.EffectKey)
	if userID == "" {
		return MessageReceipt{}, invalid("missing_scope", "Missing user/workspace scope")
	}
	if req.ConversationID == "" || req.TaskID == "" || req.MessageID == "" {
		return MessageReceipt{}, invalid("invalid_params", "conversationId, taskId, messageId required")
	}
	if req.OutputIndex < 0 {
		return MessageReceipt{}, invalid("invalid_params", "outputIndex is invalid")
	}
	task, err := ports.Task(userID, req.TaskID)
	if err != nil {
		return MessageReceipt{}, mapPortError(err)
	}
	if task == nil || strings.TrimSpace(task.ID) == "" {
		return MessageReceipt{}, notFound("task_not_found", "Task does not exist")
	}
	if strings.TrimSpace(task.UserID) != userID {
		return MessageReceipt{}, forbidden("task_foreign", "The task does not belong to the current user")
	}
	if task.Status != model.TaskStatusSucceeded {
		return MessageReceipt{}, precondition("task_not_succeeded", "Only successful tasks can be bound to messages")
	}
	target := localtask.TargetBindingFromInput(task.InputJSON)
	if conversationID := strings.TrimSpace(target.ConversationID); conversationID != "" && conversationID != req.ConversationID {
		return MessageReceipt{}, conflict("conversation_mismatch", "Can only be bound to the conversation originally assigned to the task")
	}
	if messageID := strings.TrimSpace(target.MessageID); messageID != "" && messageID != req.MessageID {
		return MessageReceipt{}, conflict("message_mismatch", "Can only be bound to the message originally specified by the task")
	}
	wantKey := localtask.AttachMessageEffectKey(req.TaskID, req.MessageID, req.OutputIndex)
	if req.EffectKey == "" {
		req.EffectKey = wantKey
	}
	if req.EffectKey != wantKey {
		return MessageReceipt{}, invalid("effect_identity_mismatch", "The operation identity must be attach-message:task:message:output sequence number")
	}

	patch, err := messagePatch(ports, userID, *task, req)
	if err != nil {
		return MessageReceipt{}, err
	}
	var attached ConversationView
	for attempt := 0; attempt < maxBindRevisionAttempts; attempt++ {
		attached, err = ports.AttachMessageResult(userID, MessageAttachInput{
			ConversationID: req.ConversationID,
			MessageID:      req.MessageID,
			TaskID:         req.TaskID,
			EffectKey:      req.EffectKey,
			ResultURLs:     patch.ResultURLs,
			Status:         "done",
			Content:        patch.Content,
		})
		if err == nil {
			return messageReceiptFor(req, patch, attached), nil
		}
		if !isMessageRevisionConflict(err) {
			return MessageReceipt{}, mapPortError(err)
		}
	}
	return MessageReceipt{}, mapPortError(err)
}

type messagePatchFields struct {
	MediaType  string
	AssetID    string
	ResourceID string
	StorageKey string
	Content    string
	ResultURLs []string
}

func messagePatch(ports MessagePorts, userID string, task model.Task, req MessageRequest) (messagePatchFields, error) {
	if isMessageTextTask(task) {
		if req.OutputIndex != 0 {
			return messagePatchFields{}, invalid("invalid_params", "Text tasks can only be bound to outputIndex 0")
		}
		text, _, ok, unreadable := durableText(task.ResultJSON)
		if unreadable {
			return messagePatchFields{}, precondition("delivery_unreadable", "Task results cannot be read and cannot be bound to a message")
		}
		if !ok {
			return messagePatchFields{}, precondition("output_not_ready", "The text task has no results to bind yet")
		}
		return messagePatchFields{MediaType: "text", Content: text}, nil
	}
	outputs, err := ports.GenerationOutputs(task.ID)
	if err != nil {
		return messagePatchFields{}, mapPortError(err)
	}
	var output localtask.CanonicalOutput
	found := false
	for _, item := range outputs {
		if item.OutputIndex == req.OutputIndex {
			output = item
			found = true
			break
		}
	}
	if !found {
		return messagePatchFields{}, precondition("output_not_ready", "The task product has not yet been delivered and cannot be bound to a message")
	}
	if strings.TrimSpace(output.MaterializationErrorCode) != "" && strings.TrimSpace(output.MaterializedAssetID) == "" {
		return messagePatchFields{}, precondition(output.MaterializationErrorCode, "The task product is not available and cannot be bound to the message")
	}
	if strings.TrimSpace(output.MaterializedAssetID) == "" || strings.TrimSpace(output.ResourceID) == "" {
		return messagePatchFields{}, precondition("output_not_ready", "The task product is not ready yet and cannot be bound to the message")
	}
	resource, err := ports.OwnedReadyResource(userID, output.ResourceID)
	if err != nil {
		return messagePatchFields{}, mapPortError(err)
	}
	if resource == nil || strings.TrimSpace(resource.ID) == "" || resource.Status != model.ResourceStatusReady {
		return messagePatchFields{}, precondition("resource_not_ready", "The task resource is not ready and cannot be bound to the message")
	}
	if strings.TrimSpace(resource.UserID) != userID {
		return messagePatchFields{}, forbidden("resource_foreign", "The task resource does not belong to the current user")
	}
	if strings.TrimSpace(resource.ID) != strings.TrimSpace(output.ResourceID) {
		return messagePatchFields{}, precondition("resource_mismatch", "The task resource is inconsistent with the product record and cannot be bound to the message")
	}
	asset, err := ports.OwnedAsset(userID, output.MaterializedAssetID)
	if err != nil {
		return messagePatchFields{}, mapPortError(err)
	}
	if asset == nil || strings.TrimSpace(asset.ID) == "" {
		return messagePatchFields{}, precondition("output_not_ready", "The task material is not ready yet and cannot be bound to the message")
	}
	if strings.TrimSpace(asset.UserID) != userID {
		return messagePatchFields{}, forbidden("asset_foreign", "The task material does not belong to the current user")
	}
	if assetResourceID(asset) != strings.TrimSpace(output.ResourceID) {
		return messagePatchFields{}, precondition("resource_mismatch", "The task material does not point to this product resource and cannot be bound to the message.")
	}
	mediaType := strings.TrimSpace(output.MediaType)
	if mediaType == "" {
		mediaType = strings.TrimSpace(resource.Kind)
	}
	content := mediaResultLabel(mediaType)
	url := assets.FileURL(resource.ID)
	return messagePatchFields{
		MediaType:  mediaType,
		AssetID:    output.MaterializedAssetID,
		ResourceID: resource.ID,
		StorageKey: "resource:" + resource.ID,
		Content:    content,
		ResultURLs: []string{url},
	}, nil
}

func isMessageTextTask(task model.Task) bool {
	switch strings.TrimSpace(task.Type) {
	case "text", "canvas_text", "text_replay":
		return true
	default:
		return false
	}
}

func mediaResultLabel(mediaType string) string {
	switch strings.TrimSpace(mediaType) {
	case "video":
		return "Video has been generated"
	case "audio":
		return "Audio generated"
	default:
		return "Image has been generated"
	}
}

func messageReceiptFor(req MessageRequest, patch messagePatchFields, attached ConversationView) MessageReceipt {
	return MessageReceipt{
		Applied:        true,
		ConversationID: req.ConversationID,
		MessageID:      req.MessageID,
		TaskID:         req.TaskID,
		OutputIndex:    req.OutputIndex,
		EffectKey:      req.EffectKey,
		MediaType:      patch.MediaType,
		AssetID:        patch.AssetID,
		ResourceID:     patch.ResourceID,
		StorageKey:     patch.StorageKey,
		Content:        patch.Content,
		ResultURLs:     append([]string(nil), patch.ResultURLs...),
		Revision:       attached.Revision,
	}
}

func isMessageRevisionConflict(err error) bool {
	var bindErr *Error
	return errors.As(err, &bindErr) && bindErr.Reason == "stale_revision"
}
