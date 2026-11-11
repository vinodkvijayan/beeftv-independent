package skillhubcli

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"infinite-canvas/backend/internal/privatefile"
	"infinite-canvas/backend/internal/skillhub"
)

type publishingState struct {
	Market       string                     `json:"market"`
	DeviceCode   string                     `json:"deviceCode,omitempty"`
	AccessToken  string                     `json:"accessToken,omitempty"`
	ExpiresAt    int64                      `json:"expiresAt,omitempty"`
	SubmissionID string                     `json:"submissionId,omitempty"`
	CreateKey    string                     `json:"createKey,omitempty"`
	ContentHash  string                     `json:"contentHash,omitempty"`
	MetadataHash string                     `json:"metadataHash,omitempty"`
	Account      skillhub.PublishingAccount `json:"account"`
}

func loadState(name, market string, allowNew bool) (*publishingState, error) {
	if name == "" {
		return nil, fail("state_required", "Please specify a private contribution status file via --state")
	}
	info, err := os.Lstat(name)
	if os.IsNotExist(err) && allowNew {
		return &publishingState{Market: market}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > 1<<20 {
		return nil, fail("unsafe_state_file", "Submission status files must be private ordinary files with permissions 0600")
	}
	if err = privatefile.Check(name, info); err != nil {
		return nil, fail("unsafe_state_file", err.Error())
	}
	data, err := os.ReadFile(name)
	if err != nil {
		return nil, err
	}
	var state publishingState
	if err = json.Unmarshal(data, &state); err != nil {
		return nil, fail("invalid_state_file", "Submission status file is invalid")
	}
	if state.Market != market {
		return nil, fail("market_mismatch", "This authorization belongs to other markets, please use the corresponding status file")
	}
	if state.SubmissionID != "" && !skillhub.ResourceID.MatchString(state.SubmissionID) {
		return nil, fail("invalid_state_file", "Invalid submission ID")
	}
	return &state, nil
}

func lockState(name string) (func(), error) {
	if name == "" {
		return nil, fail("state_required", "Please specify a private contribution status file via --state")
	}
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(name+".lock", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, &Error{Code: 4, Reason: "state_locked", Message: "This contribution is being used by another process, or a legacy state lock needs to be checked"}
	}
	lock.Close()
	return func() { _ = os.Remove(name + ".lock") }, nil
}

func saveState(name string, state *publishingState) error {
	if name == "" {
		return fail("state_required", "Please specify --state")
	}
	if _, err := loadState(name, state.Market, true); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(name), ".beeftv-publish-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = privatefile.Protect(file); err == nil {
		err = json.NewEncoder(file).Encode(state)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(file.Name(), name)
}

func newCreateKey() (string, error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("Unable to create idempotent identity")
	}
	return "cli-create-" + hex.EncodeToString(data), nil
}
