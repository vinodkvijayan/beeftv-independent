package beeftv

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func loadState(dataDir string) (persistedState, error) {
	body, err := os.ReadFile(filepath.Join(dataDir, connectionStoreFile))
	if errors.Is(err, os.ErrNotExist) {
		return persistedState{SchemaVersion: connectionSchema, Status: StateDisconnected, Balance: BalanceUnknown}, nil
	}
	if err != nil {
		return persistedState{}, fmt.Errorf("Failed to read enterprise connection status: %w", err)
	}
	var state persistedState
	if err := json.Unmarshal(body, &state); err != nil {
		return persistedState{}, fmt.Errorf("Enterprise connection status corrupted")
	}
	if state.SchemaVersion != connectionSchema {
		return persistedState{}, fmt.Errorf("Unsupported Enterprise Connection State version")
	}
	if state.Status == "" {
		state.Status = StateDisconnected
	}
	if state.Balance == "" {
		state.Balance = BalanceUnknown
	}
	return state, nil
}

func saveState(dataDir string, state persistedState) error {
	state.SchemaVersion = connectionSchema
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	body, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("Failed to encode enterprise connection status: %w", err)
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("Failed to create enterprise connection directory: %w", err)
	}
	tmp, err := os.CreateTemp(dataDir, ".beeftv-connection-*")
	if err != nil {
		return fmt.Errorf("Failed to create enterprise connection temporary file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to set enterprise connection permissions: %w", err)
	}
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to write enterprise connection status: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to synchronize enterprise connection status: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("Failed to close enterprise connection status: %w", err)
	}
	if err := os.Rename(tmpName, filepath.Join(dataDir, connectionStoreFile)); err != nil {
		return fmt.Errorf("Failed to replace enterprise connection status: %w", err)
	}
	if directory, err := os.Open(dataDir); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}

func clearState(dataDir string) error {
	return saveState(dataDir, persistedState{Status: StateDisconnected, Balance: BalanceUnknown})
}
