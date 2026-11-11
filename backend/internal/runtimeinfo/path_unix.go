//go:build !windows

package runtimeinfo

import (
	"errors"
	"path/filepath"
	"strings"
)

func descriptorLocation(dataDir string) (string, string, error) {
	if strings.TrimSpace(dataDir) == "" {
		return "", "", errors.New("The data directory cannot be empty")
	}
	return filepath.Join(dataDir, FileName), "", nil
}
