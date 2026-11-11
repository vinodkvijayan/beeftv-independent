package app

import (
	"context"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/topaz"
)

type MediaUpscaleRequest = topaz.Request

func (s *Service) upscaleConfig(name string) (generation.Config, error) {
	return generation.UpscaleConfig(name, s.lookupBeefTVCredential)
}

func (s *Service) MediaUpscaleCapabilities() map[string]any {
	return generation.UpscaleCapabilities()
}

func (s *Service) EstimateMediaUpscale(ctx context.Context, user string, request topaz.Request) (map[string]any, error) {
	return generation.EstimateMediaUpscale(ctx, user, request, s.EnsureResourceMediaMetadata, s.lookupBeefTVCredential, s.bindGenerationRuntime)
}

func (s *Service) CreateMediaUpscale(ctx context.Context, user string, request topaz.Request) (*model.Task, error) {
	input, payload, err := generation.BuildMediaUpscaleTaskPayload(ctx, user, request, s.EnsureResourceMediaMetadata, s.lookupBeefTVCredential)
	if err != nil {
		return nil, err
	}
	return s.CreateTask(user, CreateTaskRequest{ProjectID: request.ProjectID, Type: "canvas_" + input.Mode, Operation: "media.upscale.topaz", Prompt: "AI super score", Model: input.Config.Model, Provider: "beeftv", Input: payload})
}

func (s *Service) RecoverMediaUpscale(ctx context.Context, user, id string) (*model.Task, error) {
	task, err := s.repo.TaskForUser(user, id)
	if err != nil {
		return nil, err
	}
	if !task.IsUpscale() {
		return nil, BadAuthRequest("This task is not a super task")
	}
	if task.Status == model.TaskStatusCancelled {
		return nil, BadAuthRequest("The original super score task has been cancelled. Please check the results and deduction status in the task details.")
	}
	if task.Status == model.TaskStatusSucceeded {
		if err := s.DeliverSucceededTask(*task); err != nil {
			return nil, err
		}
		return s.Task(user, id)
	}
	if task.Status != model.TaskStatusFailed {
		return taskForOutput(*task), nil
	}
	s.hydrateTaskProviderRequestID(task)
	_, managed, queryErr := s.managedTaskRecoveryQuery(ctx, *task)
	if queryErr != nil {
		return nil, queryErr
	}
	if task.ProviderRequestID == "" && !managed {
		s.recordMissingVideoReceiptOutcome(task, user)
		return nil, BadAuthRequest("The original super-score task does not have a recoverable upstream receipt. Please regenerate it based on the task conclusion.")
	}
	_ = s.repo.ResetTaskRecoveryBackoff(user, id)
	result, err := s.QueryFailedVideoTask(ctx, user, id)
	if err != nil {
		return nil, err
	}
	if !result.Recovered {
		return nil, BadAuthRequest("The original super score task is still being processed, please retrieve the original results later.")
	}
	return result.Task, nil
}
