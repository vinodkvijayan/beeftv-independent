package kernel

import (
	"errors"
	"strings"
	"syscall"
)

// DiskFullError is used only at local storage boundaries, never on provider bodies.
func DiskFullError(cause error) *AppError {
	if cause == nil {
		return nil
	}
	text := strings.ToLower(cause.Error())
	if !errors.Is(cause, syscall.ENOSPC) && !strings.Contains(text, "no space left on device") && !strings.Contains(text, "not enough space on the disk") && !strings.Contains(text, "database or disk is full") && !strings.Contains(text, "the disk is full") {
		return nil
	}
	return &AppError{Status: 500, Code: 500, Reason: "local_disk_full", Message: "Insufficient local disk space to save data. Please clean the disk where the BeefTV data directory is located; if there are already generated results, please retrieve the original task first and do not generate it again.", Cause: cause}
}
