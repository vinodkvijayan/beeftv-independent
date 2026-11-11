package creation

import (
	"errors"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/repository"
)

const (
	msgLeaseExpired      = "Execution control has expired, please take over again on the current page"
	msgLeaseHeld         = "The current execution right is still held by other sessions and cannot be taken over until it expires or is released."
	msgEpochChanged      = "The execution generation has changed"
	msgUnknownAction     = "Unknown authoring operation"
	msgMissingClientKey  = "Missing stable session key"
	msgClientKeyConflict = "The contents of the same session key are different"
	msgNotFound          = "Creation record does not exist or is not accessible"
	msgStateChanged      = "The creation status has changed, please read again and continue."
	msgActiveTaskLimit   = "The number of tasks queued or running at the same time has reached the limit."
	msgModelUpdated      = "The model has been updated or deactivated, please prepare the execution items again"
	msgJSONLimit         = "The creative content exceeds the limit or the format is invalid"
	msgSecretsInRecord   = "Authoring records cannot contain keys, embedded media, or temporary signature links"
	msgAdmitNilTask      = "Task admission did not return saveable tasks"
	msgProtectedInput    = "Task input cannot be saved"
)

func Conflict(message string) error {
	return kernel.NewAppError(kernel.CodeConflict, message)
}

func MapError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return kernel.BadAuthRequest(msgActiveTaskLimit)
	}
	if errors.Is(err, repository.ErrLogicalModelUnavailable) {
		return Conflict(msgModelUpdated)
	}
	if errors.Is(err, repository.ErrCreationConflict) {
		return Conflict(msgStateChanged)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound(msgNotFound)
	}
	return err
}
