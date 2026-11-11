package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"infinite-canvas/backend/internal/bootstrap"
	"infinite-canvas/backend/internal/desktopstorage"
	"infinite-canvas/backend/internal/runtimeinfo"
)

func (a *DesktopApp) StorageSettings() (desktopstorage.Usage, error) {
	a.mu.RLock()
	path := a.dataDir
	a.mu.RUnlock()
	usage, err := desktopstorage.Inspect(path)
	if err != nil {
		return usage, err
	}
	root := a.storageRoot
	if root == "" {
		root, err = desktopstorage.DefaultRoot()
		if err != nil {
			return usage, err
		}
	}
	location, err := desktopstorage.MigrationLocation(root, path)
	if err != nil {
		return usage, err
	}
	if location.PreviousDir != "" && len(location.PreviousFiles) > 0 {
		previous, inspectErr := desktopstorage.Inspect(location.PreviousDir)
		if inspectErr == nil {
			usage.PreviousDir = location.PreviousDir
			usage.PreviousBytes = previous.UsedBytes
		}
	}
	return usage, nil
}

func (a *DesktopApp) CleanupPreviousStorage() (desktopstorage.Usage, error) {
	if !a.migrationMu.TryLock() {
		return desktopstorage.Usage{}, errors.New("The storage operation is in progress, please wait for completion")
	}
	defer a.migrationMu.Unlock()
	a.mu.RLock()
	current, root := a.dataDir, a.storageRoot
	a.mu.RUnlock()
	var err error
	if root == "" {
		root, err = desktopstorage.DefaultRoot()
		if err != nil {
			return desktopstorage.Usage{}, err
		}
	}
	if a.runtime() == nil || !a.runtime().Ready() {
		return desktopstorage.Usage{}, errors.New("The current workspace is not ready yet, so the original directory will not be cleared yet.")
	}
	if err = desktopstorage.CleanupPrevious(root, current, runtimeinfo.LockWorkspace); err != nil {
		return desktopstorage.Usage{}, err
	}
	return a.StorageSettings()
}

func (a *DesktopApp) ChooseStorageDirectory() (string, error) {
	ctx, err := a.dialogContext()
	if err != nil {
		return "", err
	}
	path, err := wailsruntime.OpenDirectoryDialog(ctx, wailsruntime.OpenDialogOptions{Title: "Select BeefTV data storage folder"})
	if err == nil && path != "" && filepath.Dir(path) == path {
		path = filepath.Join(path, "BeefTV")
	}
	return path, err
}

func (a *DesktopApp) MigrateStorage(target string) (desktopstorage.Usage, error) {
	if !a.migrationMu.TryLock() {
		return desktopstorage.Usage{}, errors.New("Data is being migrated, please wait for completion")
	}
	defer a.migrationMu.Unlock()
	a.setMigrationProgress(desktopstorage.Progress{Phase: "preparing", Detail: "Checking storage directory and disk space"})
	if a.storageRoot == "" && strings.TrimSpace(os.Getenv("CANVAS_DESKTOP_DATA_DIR")) != "" {
		return desktopstorage.Usage{}, errors.New("Please remove the CANVAS_DESKTOP_DATA_DIR environment variable first, and then migrate the storage directory in the settings")
	}
	a.mu.RLock()
	source := a.dataDir
	root := a.storageRoot
	a.mu.RUnlock()
	target, err := desktopstorage.Validate(source, target)
	if err != nil {
		return desktopstorage.Usage{}, err
	}
	exe, err := os.Executable()
	if err != nil {
		return desktopstorage.Usage{}, err
	}
	overlaps, err := desktopstorage.Overlaps(filepath.Dir(exe), target)
	if err != nil {
		return desktopstorage.Usage{}, err
	}
	if overlaps {
		return desktopstorage.Usage{}, errors.New("The data directory cannot use the program installation directory")
	}
	if root == "" {
		root, err = desktopstorage.DefaultRoot()
		if err != nil {
			return desktopstorage.Usage{}, err
		}
	}
	ctx, cancelMigration := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancelMigration()
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return desktopstorage.Usage{}, errors.New("App is shutting down and migration has not started")
	}
	a.migrating = true
	a.migrationCancel = cancelMigration
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.migrating = false; a.migrationCancel = nil; a.mu.Unlock() }()
	currentRuntime := a.runtime()
	if currentRuntime == nil {
		return desktopstorage.Usage{}, errors.New("The workspace is not ready yet and the migration has not started. Please restart BeefTV and try again")
	}
	prepareCtx, prepareCancel := context.WithTimeout(ctx, 10*time.Second)
	a.setMigrationProgress(desktopstorage.Progress{Phase: "preparing", Detail: "Stopping background tasks and saving workspace"})
	resume, prepareErr := currentRuntime.PrepareStorageMigration(prepareCtx)
	prepareCancel()
	if prepareErr != nil {
		return desktopstorage.Usage{}, prepareErr
	}
	defer resume()
	// Nothing may reopen the source while SQLite and workers are being closed.
	stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	err = a.stop(stopCtx)
	cancel()
	restore := func(cause error) (desktopstorage.Usage, error) {
		a.mu.RLock()
		closing := a.closing
		a.mu.RUnlock()
		if closing {
			return desktopstorage.Usage{}, cause
		}
		old, openErr := openDesktopRuntime(context.Background(), source)
		if openErr == nil {
			a.installStorageRuntime(source, old)
			return desktopstorage.Usage{}, fmt.Errorf("The migration is not completed, the original workspace has been restored, and the storage directory has not changed. Please see error details\n\n%w", cause)
		}
		return desktopstorage.Usage{}, fmt.Errorf("The migration is not completed, the original data has been retained, but the workspace cannot be reopened. Please restart BeefTV\n\n%w", errors.Join(cause, openErr))
	}
	if err != nil {
		a.mu.Lock()
		a.closing = true
		a.mu.Unlock()
		return desktopstorage.Usage{}, fmt.Errorf("The migration has not started and the original data is still in the original directory. The workspace failed to close completely, please restart BeefTV and try again\n\n%w", err)
	}
	sourceLock, err := runtimeinfo.LockWorkspace(source)
	if err != nil {
		return restore(err)
	}
	defer sourceLock.Close()
	// Release before rollback reopens the source runtime.
	oldRestore := restore
	restore = func(cause error) (desktopstorage.Usage, error) { _ = sourceLock.Close(); return oldRestore(cause) }
	a.setMigrationProgress(desktopstorage.Progress{Phase: "processing", Detail: "Checking original directory files"})
	files, err := desktopstorage.Snapshot(source)
	if err != nil {
		return restore(err)
	}
	if err := desktopstorage.CopyClosedWorkspace(ctx, source, target, a.setMigrationProgress); err != nil {
		return restore(fmt.Errorf("Migration failed, original data has been retained: %w", err))
	}
	a.mu.RLock()
	progress := a.migrationProgress
	a.mu.RUnlock()
	progress.Phase, progress.Detail = "processing", "Checking the integrity of the original directory and the new directory"
	a.setMigrationProgress(progress)
	if err = desktopstorage.VerifySnapshot(source, files, false); err != nil {
		return restore(err)
	}
	if err = desktopstorage.VerifySnapshot(target, files, false); err != nil {
		return restore(err)
	}
	usage, err := desktopstorage.Inspect(target)
	if err != nil {
		return restore(err)
	}
	progress.Detail = "Opening new directory and restoring workspace"
	a.setMigrationProgress(progress)
	next, err := openDesktopRuntime(ctx, target)
	if err != nil {
		return restore(fmt.Errorf("The new directory cannot be opened, continue to use the original directory: %w", err))
	}
	if err = ctx.Err(); err != nil {
		_ = closeDesktopRuntime(context.Background(), next)
		return restore(err)
	}
	if a.storageRoot == "" {
		if err = configureDesktopTemp(target); err != nil {
			_ = closeDesktopRuntime(context.Background(), next)
			return restore(err)
		}
	}
	if err := desktopstorage.SaveMigration(root, target, source, files); err != nil {
		_ = closeDesktopRuntime(context.Background(), next)
		if a.storageRoot == "" {
			_ = configureDesktopTemp(source)
		}
		return restore(fmt.Errorf("The storage directory setting is not saved, continue to use the original directory: %w", err))
	}
	a.installStorageRuntime(target, next)
	progress.Phase, progress.Detail = "done", "Migration completed, reloading"
	a.setMigrationProgress(progress)
	return usage, nil
}

func (a *DesktopApp) setMigrationProgress(progress desktopstorage.Progress) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.migrationProgress = progress
}

func (a *DesktopApp) StorageMigrationStatus() desktopstorage.Progress {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.migrationProgress
}

func (a *DesktopApp) installStorageRuntime(path string, runtime *bootstrap.Runtime) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.dataDir = path
	desktopRuntimeRegistryMu.Lock()
	desktopRuntimeRegistry[a] = runtime
	desktopRuntimeRegistryMu.Unlock()
}
