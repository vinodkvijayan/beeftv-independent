package task

import (
	localasset "infinite-canvas/backend/internal/asset"
	cw "infinite-canvas/backend/internal/canvasworkflow"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type CanvasMediaInput struct {
	Node       cw.Node `json:"node"`
	ResourceID string  `json:"resourceId"`
}

func (s *Service) CreateCanvasMediaTask(user string, node cw.Node, resourceID, operation string) (*model.Task, error) {
	if !cw.IsMediaOperation(node.OperationID) {
		return nil, kernel.BadAuthRequest("Unsupported canvas media handling")
	}
	if err := cw.ValidateOperation(node); err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	if s.deps.OwnedMedia == nil {
		return nil, unavailable()
	}
	resource, err := s.deps.OwnedMedia.Resource(user, resourceID)
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
		return nil, kernel.BadAuthRequest("Input material does not exist or is not ready")
	}
	op := cw.OperationByID(node.OperationID)
	if localasset.NormalizeKind(resource.Kind, resource.MimeType) != op.Inputs[0].MediaType {
		return nil, kernel.BadAuthRequest("Input material type does not match")
	}
	if node.OperationID == "video.frame" {
		if seconds, ok := node.Config["seconds"].(float64); ok && resource.DurationMs > 0 && seconds*1000 >= float64(resource.DurationMs) {
			return nil, kernel.BadAuthRequest("The frame capture time must be less than the video duration")
		}
	}
	if _, _, _, err = cw.MediaCommand(node, resource.Width, resource.Height); err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	input, err := marshalLocalExecutorInput(CanvasMediaInput{Node: node, ResourceID: resourceID})
	if err != nil {
		return nil, err
	}
	return s.admitSpecialized(user, specializedAdmission{kind: localExecutorKind{Type: model.TaskTypeCanvasMediaTransform, Prompt: op.Name, Provider: "local", Model: "ffmpeg", Stage: "Waiting for local processing", Log: "Canvas media processing queued"}, input: withClientOperation(input, operation)})
}
