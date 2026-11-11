package asset

import (
	"net/http"
	"strconv"

	"infinite-canvas/backend/internal/kernel"
)

func UploadInProgress() error {
	err := kernel.NewAppError(http.StatusConflict, "The same material is being uploaded, please try again later.")
	err.Retryable = true
	return err
}

func UploadQuotaAttributionUncertain() error {
	return kernel.NewAppError(http.StatusConflict, "The old upload record cannot confirm the usage, and automatic recovery has been suspended. Existing data and usage records have been retained.")
}

func UploadConflict() error {
	return kernel.NewAppError(http.StatusConflict, "Upload idempotent flag already used in other files")
}

func MissingUpload() error {
	return kernel.BadAuthRequest("Please select the file to upload")
}

func ResourceNotReady() error {
	return kernel.BadAuthRequest("The resource has not been uploaded yet")
}

func ResourceNotLocal() error {
	return kernel.BadAuthRequest("Resource is not in local storage")
}

func ResourceMissing() error {
	return kernel.BadAuthRequest("Resource does not exist")
}

func ResourceFileMissing() error {
	return kernel.NotFound("The local media file does not exist or is missing")
}

func UnreadableAssetDocument(kind string) error {
	switch kind {
	case "version":
		return kernel.BadAuthRequest("The material version data cannot be parsed and deletion has been stopped to avoid accidentally deleting files.")
	case "representation":
		return kernel.BadAuthRequest("The material performance data cannot be parsed and deletion has been stopped to avoid accidentally deleting files.")
	default:
		return kernel.BadAuthRequest("The material data cannot be parsed and deletion has been stopped to avoid accidentally deleting files.")
	}
}

func HistoryReferenced() error {
	return kernel.BadAuthRequest("The material is still referenced by the historical version of the canvas and the file has been retained.")
}

func StillReferenced() error {
	return kernel.BadAuthRequest("The material is still referenced. Please dereference it in the corresponding canvas, task or business record before deleting it.")
}

func TrashStatusConflict() error {
	return kernel.NewAppError(http.StatusConflict, "The material is no longer in the recycle bin and has not been deleted.")
}

func RemoteImportForbidden() error {
	return kernel.Forbidden("The local workspace does not support importing materials through URL. Please download them to your local machine first and then upload them.")
}

func UploadSessionMissing() error {
	return kernel.NotFound("The upload session does not exist or has expired, please import again.")
}

func UploadSessionBusy() error {
	return kernel.RateLimited("There are too many uploads in progress at the same time, please try again later.")
}

func UploadSessionCompleting() error {
	err := kernel.NewAppError(http.StatusConflict, "Upload is being completed, please wait.")
	err.Retryable = true
	return err
}

func UploadSessionRecoveryFailed() error {
	err := kernel.NewAppError(http.StatusServiceUnavailable, "Upload session recovery failed, please try again later")
	err.Retryable = true
	return err
}

func UploadSessionIncomplete() error {
	return kernel.BadAuthRequest("The uploaded file is incomplete, please re-import it.")
}

func UploadChunkIndexInvalid() error {
	return kernel.BadAuthRequest("Illegal fragment sequence number")
}

func UploadChunkIncomplete(index int) error {
	return kernel.BadAuthRequest("Sharding" + strconv.Itoa(index) + " Incomplete upload, please try again")
}

func UploadChunkTooLarge(index int) error {
	return kernel.BadAuthRequest("Sharding" + strconv.Itoa(index) + " Exceeds size limit")
}
