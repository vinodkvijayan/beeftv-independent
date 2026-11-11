package runtimeinfo

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func descriptorLocation(dataDir string) (string, string, error) {
	if strings.TrimSpace(dataDir) == "" {
		return "", "", errors.New("The data directory cannot be empty")
	}
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return "", "", fmt.Errorf("Locate workspace data directory: %w", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("Locate user directory: %w", err)
	}
	if !filepath.IsAbs(home) {
		return "", "", errors.New("The user directory must be an absolute path")
	}
	// MSIX opens AppData files from its private copy first, even for absolute
	// paths. Use one shared location outside AppData, never a legacy fallback.
	digest := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(abs))))
	dataDirHash := hex.EncodeToString(digest[:])
	return filepath.Join(home, ".beeftv", "runtime", dataDirHash+".json"), dataDirHash, nil
}
