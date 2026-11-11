package desktopstorage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Snapshot contains hashes only, never file contents or credentials.
func Snapshot(dir string) (map[string]string, error) {
	files := make(map[string]string)
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if skipScratch(dir, path, entry) {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		if rel == locationFile {
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("The data directory contains links or special files and cannot be cleaned or migrated.")
		}
		file, err := openMigrationFile(path)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, err = io.Copy(hash, file)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		files[rel] = hex.EncodeToString(hash.Sum(nil))
		return nil
	})
	return files, err
}

func VerifySnapshot(dir string, files map[string]string, allowMissing bool) error {
	current, err := Snapshot(dir)
	if err != nil {
		return err
	}
	for path, hash := range current {
		if files[path] != hash {
			return errors.New("There is new or modified data in the original directory and cleaning has stopped. Please keep and check the original directory.")
		}
	}
	if !allowMissing && len(current) != len(files) {
		return errors.New("The number of migrated files is inconsistent and the original data has been retained.")
	}
	return nil
}

func MigrationLocation(root, current string) (Location, error) {
	body, err := os.ReadFile(filepath.Join(root, locationFile))
	if errors.Is(err, os.ErrNotExist) {
		return Location{}, nil
	}
	if err != nil {
		return Location{}, err
	}
	var location Location
	if err = json.Unmarshal(body, &location); err != nil {
		return Location{}, err
	}
	resolved, err := canonical(current)
	if err != nil {
		return Location{}, err
	}
	stored, err := canonical(location.DataDir)
	if err != nil {
		return Location{}, err
	}
	if resolved != stored {
		return Location{}, nil
	}
	return location, nil
}

// Caller must refuse a live legacy runtime, whose version predates the lock.
// Verify all remaining source files before deleting any. Repeated cleanup after
// a filesystem failure is safe; changed or newly added files always stop it.
func CleanupPrevious(root, current string, acquireLock func(string) (*os.File, error)) error {
	location, err := MigrationLocation(root, current)
	if err != nil {
		return err
	}
	if location.PreviousDir == "" || len(location.PreviousFiles) == 0 {
		return errors.New("There is no original directory that can be automatically cleaned")
	}
	overlaps, err := Overlaps(current, location.PreviousDir)
	if err != nil {
		return err
	}
	if overlaps {
		return errors.New("The original directory overlaps with the current directory and cannot be cleaned.")
	}
	lock, err := acquireLock(location.PreviousDir)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = VerifySnapshot(location.PreviousDir, location.PreviousFiles, true); err != nil {
		return err
	}
	for rel := range location.PreviousFiles {
		// Snapshot paths are untrusted persisted data: prevent traversal.
		if !filepath.IsLocal(rel) || filepath.Clean(rel) != rel || rel == locationFile {
			return errors.New("The migration record is invalid and cannot be cleaned")
		}
	}
	// A live desktop child can retain scratch handles after the workspace has
	// stopped. Handle scratch first, before deleting any durable copies, and
	// retain the receipt so cleanup can be retried after those handles close.
	if err = os.RemoveAll(filepath.Join(location.PreviousDir, "cache", "tmp")); err != nil {
		if fileInUse(err) {
			return fmt.Errorf("The temporary file is still in use, please restart BeefTV and clean it again. The current storage directory is not affected\n\n%w", err)
		}
		return fmt.Errorf("Temporary files could not be cleaned up and the current storage directory was not affected. Please check the access permissions and disk status of the original directory\n\n%w", err)
	}
	for rel := range location.PreviousFiles {
		// Older receipts included scratch files; they are handled above.
		if strings.HasPrefix(rel, filepath.Join("cache", "tmp")+string(filepath.Separator)) {
			continue
		}
		if err = os.Remove(filepath.Join(location.PreviousDir, rel)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("The original directory cleanup has not been completed, and the current storage directory is not affected. Please keep the current directory and check the error details\n\n%w", err)
		}
	}
	// Only remove empty directories. Keep the fixed profile pointer intact.
	var dirs []string
	_ = filepath.WalkDir(location.PreviousDir, func(path string, entry fs.DirEntry, err error) error {
		if err == nil && entry.IsDir() {
			dirs = append(dirs, path)
		}
		return err
	})
	for i := len(dirs) - 1; i >= 0; i-- {
		_ = os.Remove(dirs[i])
	}
	return saveLocation(root, Location{DataDir: current})
}
