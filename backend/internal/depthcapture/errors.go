package depthcapture

import (
	"errors"
	"strings"
)

var (
	ErrCUDADevice    = errors.New("CUDA device or model forward is not available")
	ErrNeedVideo     = errors.New("Pending video must be specified")
	ErrMissingVideo  = errors.New("Unable to read pending video, may have been deleted")
	ErrNotVideo      = errors.New("Deep motion capture only supports video resources")
	ErrTooLong       = errors.New("The video exceeds 15 seconds, please use video clipping to shorten it first")
	ErrUnsupportedOS = errors.New("Current version only supports Apple Silicon Mac and Windows x64")
	ErrMissingCUDA   = errors.New("Missing CUDA real model probe")
	ErrWindowsKey    = errors.New("The Windows Deep Processing component has not been configured with a trusted publishing public key and is temporarily unavailable.")
	ErrBadInput      = errors.New("Task is missing a valid video resource reference")
	ErrTempDir       = errors.New("Unable to create secure temporary directory")
	ErrPrepareInput  = errors.New("Unable to prepare input video")
	ErrReadInput     = errors.New("Failed to read input video")
	ErrPrepareOutput = errors.New("Unable to prepare output directory")
	ErrCleanCUDA     = errors.New("Unable to clean up outstanding CUDA output")
	ErrReprepareOut  = errors.New("Unable to re-prepare output directory")
	ErrNoPreview     = errors.New("The depth processing component did not generate a valid video file")
	ErrOpenPreview   = errors.New("Unable to read generated video file")
	ErrEmptyPreview  = errors.New("The generated video file is empty")
)

const (
	stageUnavailable = "Depth processing is not available"
	stageFailed      = "Depth processing failed"
	stageTooLong     = "Video too long"
	stageComponent   = "Depth component is not available"
	stageOutput      = "Output verification failed"
	stageSave        = "Failed to save results"
)

func workerFailureSummary(message string) string {
	// curl's progress meter can fill the whole diagnostic budget before its
	// error. The tail contains the exit reason and Python's final exception.
	runes := []rune(strings.TrimSpace(message))
	if len(runes) > 800 {
		return "…" + string(runes[len(runes)-800:])
	}
	return string(runes)
}
