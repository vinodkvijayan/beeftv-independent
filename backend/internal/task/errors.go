package task

import (
	"errors"
	"fmt"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	RetiredAgentBoundaryMessage                        = "Agent capability is offline, please manually create nodes in the canvas and generate"
	RetiredCloudAgentPrefix                            = "cloud_agent"
	RetiredMemoryCompactOp                             = "agent_memory_compact"
	LocalStorageFailedMessage                          = "The local task failed to save and the generation has not been submitted yet. Please restart BeefTV and try again; if it still fails, please update the app and contact support"
	DrainCreateMessage                                 = "The service is under maintenance and will not accept new generation tasks for the time being."
	DrainRetryMessage                                  = "The service is under maintenance and will not accept task retries for the time being."
	ClientOperationConflictMessage                     = "The same build confirmation has been used for different content, no new tasks have been created"
	CancellationPendingRetryMessage                    = "The last cancellation request is still being confirmed, please try again later"
	ContentModerationRetryMessage                      = "The content has not passed the security review. Please modify the prompt word or reference picture and regenerate it; the original task cannot be retried directly."
	SubmissionUncertainRetryMessage                    = "The submission result has not been confirmed yet. Please check the original task first and do not resubmit immediately."
	DownloadFailureRetryMessage                        = "The download of the generated results failed. Please reload or query the original task first. Do not resubmit immediately."
	CreationRetryConflictMessage                       = "Smart creation redo requires new quote approval, please return to the creation session to continue"
	LogicalModelUnavailableMessage                     = "The selected model has been deactivated, archived or the configuration has been updated, please select again"
	TaskScopeArchivedMessage                           = "The project is archived and the build task cannot be created"
	TaskScopeUnavailableMessage                        = "The current canvas or project is unavailable and the build task cannot be created"
	ResourceNotReadyMessage                            = "The reference material is not ready yet. Please confirm that the file has been uploaded and try again."
	TaskInputInvalidMessage                            = "The task input cannot be parsed, please resubmit."
	RetryNotRetryableMessage                           = "The task has been requeued by other requests, please do not retry again."
	RetryOnlyFailedOrCancelled                         = "only failed or cancelled tasks can be retried"
	PromptRequiredMessage                              = "Please fill in the prompt word"
	InlineMediaRejectedMessage                         = "Task input cannot contain embedded media, please upload it to resource storage first"
	VideoModeRequiredMessage                           = "Video tasks must use video mode"
	VideoConfigRequiredMessage                         = "Video task is missing executable model configuration"
	CancelChangedMessage                               = "The task status has changed, please refresh and try again"
	LocalStorageFailedReason        kernel.ErrorReason = "local_storage_failed"
)

func unavailable() error {
	return kernel.NewAppError(kernel.CodeInternal, "Task service is unavailable")
}

func localStorageFailed(cause error) error {
	if full := kernel.DiskFullError(cause); full != nil {
		return full
	}
	return &kernel.AppError{
		Status:  kernel.CodeInternal,
		Code:    kernel.CodeInternal,
		Reason:  LocalStorageFailedReason,
		Message: LocalStorageFailedMessage,
		Cause:   cause,
	}
}

func drainError(message string) error {
	return &kernel.AppError{Status: kernel.CodeUnavailable, Code: kernel.CodeUnavailable, Message: message, Retryable: true}
}

func activeLimitError(limit int) error {
	return kernel.BadAuthRequest(fmt.Sprintf("The maximum number of tasks queued or running at the same time is %d. Please wait for existing tasks to be completed.", limit))
}

func mapPersistError(err error, req CreateRequest, present Presenter, limit int) (*model.Task, error) {
	if err == nil {
		return nil, nil
	}
	var replay *repository.ClientOperationReplay
	if errors.As(err, &replay) {
		return admitExisting(replay.Task, req, present)
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return nil, activeLimitError(limit)
	}
	if errors.Is(err, repository.ErrLogicalModelUnavailable) {
		return nil, kernel.BadAuthRequest(LogicalModelUnavailableMessage)
	}
	if mapped := mapTaskScopeError(err); mapped != nil {
		return nil, mapped
	}
	if mapped := mapTaskResourceError(err); mapped != nil {
		return nil, mapped
	}
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr != nil {
		return nil, err
	}
	return nil, localStorageFailed(err)
}

func mapTaskScopeError(err error) error {
	if errors.Is(err, repository.ErrTaskScopeArchived) {
		return kernel.BadAuthRequest(TaskScopeArchivedMessage)
	}
	if errors.Is(err, repository.ErrTaskScopeNotActive) {
		return kernel.BadAuthRequest(TaskScopeUnavailableMessage)
	}
	return nil
}

func mapTaskResourceError(err error) error {
	if errors.Is(err, repository.ErrResourceNotReadyForAdmission) {
		return kernel.BadAuthRequest(ResourceNotReadyMessage)
	}
	if errors.Is(err, repository.ErrTaskInputInvalid) {
		return kernel.BadAuthRequest(TaskInputInvalidMessage)
	}
	return nil
}

// AdmissionValidationError maps shared repository preconditions for specialized
// task creators (render, transcription, depth) using the same admission rules.
// A nil result means the error is not a known validation failure.
func AdmissionValidationError(err error) error {
	if mapped := mapTaskScopeError(err); mapped != nil {
		return mapped
	}
	return mapTaskResourceError(err)
}
