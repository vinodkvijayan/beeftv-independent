package main

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
)

// OpenUpdateLogDirectory accepts no caller path; it only opens this workspace.
func (a *DesktopApp) OpenUpdateLogDirectory() error {
	if _, err := a.dialogContext(); err != nil {
		return err
	}
	a.mu.RLock()
	dir := a.dataDir
	a.mu.RUnlock()
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return errors.New("The data directory cannot be opened, please check the current directory in the storage settings.")
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("explorer.exe", dir)
	case "darwin":
		command = exec.Command("open", dir)
	default:
		command = exec.Command("xdg-open", dir)
	}
	if err := command.Start(); err != nil {
		return errors.New("Unable to open log folder, please check the current directory in storage settings.")
	}
	go func() { _ = command.Wait() }()
	return nil
}
