package main

import (
	"context"
	"errors"
	"sync"
	"time"

	"infinite-canvas/backend/internal/buildinfo"
	"infinite-canvas/backend/internal/desktopupdate"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	desktopUpdaterRegistryMu sync.Mutex
	desktopUpdaterRegistry   = make(map[*DesktopApp]*desktopupdate.Engine)
)

func (a *DesktopApp) updater() *desktopupdate.Engine {
	desktopUpdaterRegistryMu.Lock()
	defer desktopUpdaterRegistryMu.Unlock()
	if engine, ok := desktopUpdaterRegistry[a]; ok {
		return engine
	}
	engine := desktopupdate.New(desktopupdate.Host{
		CurrentVersion: buildinfo.Current().Version,
		DataDir:        a.dataDir,
		Quit: func() error {
			a.mu.RLock()
			ctx := a.wailsCtx
			a.mu.RUnlock()
			if ctx == nil {
				return errors.New("The app is not ready yet and the update cannot be installed")
			}
			go func() {
				time.Sleep(500 * time.Millisecond)
				wailsruntime.Quit(ctx)
			}()
			return nil
		},
	})
	desktopUpdaterRegistry[a] = engine
	return engine
}

func (a *DesktopApp) clearUpdater() {
	desktopUpdaterRegistryMu.Lock()
	delete(desktopUpdaterRegistry, a)
	desktopUpdaterRegistryMu.Unlock()
}

func (a *DesktopApp) UpdateStatus() desktopupdate.UpdateState {
	return a.updater().Status()
}

func (a *DesktopApp) CheckForUpdate() (desktopupdate.UpdateState, error) {
	return a.updater().CheckForUpdate(context.Background())
}

func (a *DesktopApp) DownloadUpdate() (desktopupdate.UpdateState, error) {
	return a.updater().DownloadUpdate(context.Background())
}

func (a *DesktopApp) InstallUpdate() error {
	if _, err := a.dialogContext(); err != nil {
		return errors.New("The app is not ready yet and the update cannot be installed")
	}
	return a.updater().InstallUpdate(context.Background())
}

func (a *DesktopApp) ConfirmUpdateStartup() error {
	ctx, err := a.dialogContext()
	if err != nil || a.runtime() == nil {
		return errors.New("The local workspace is not ready yet")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return a.updater().CleanupAfterStartup(ctx)
}
