// Package environment runs bounded local checks. Case records are references,
// never executable repair instructions or a remotely updated policy.
package environment

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"runtime"
	"time"

	"infinite-canvas/backend/internal/desktopnet"
	"infinite-canvas/backend/internal/mediatools"
)

type Check struct {
	ID     string   `json:"id"`
	Title  string   `json:"title"`
	Status string   `json:"status"`
	Detail string   `json:"detail"`
	Cases  []string `json:"cases"`
}

type Report struct {
	CheckedAt time.Time   `json:"checkedAt"`
	OS        string      `json:"os"`
	Arch      string      `json:"arch"`
	Catalog   CaseCatalog `json:"catalog"`
	Checks    []Check     `json:"checks"`
}

// Inspect never accepts a path from HTTP. The already-open workspace owns dir.
// Repair only recreates missing scratch/download directories; existing files,
// permissions, projects, credentials and system settings are left alone.
func Inspect(ctx context.Context, dir string, repair bool) Report {
	r := Report{CheckedAt: time.Now().UTC(), OS: runtime.GOOS, Arch: runtime.GOARCH, Catalog: catalog(), Checks: []Check{}}
	add := func(id, title, status, detail string, cases ...string) {
		r.Checks = append(r.Checks, Check{id, title, status, detail, cases})
	}
	stop := func() bool {
		if ctx.Err() == nil {
			return false
		}
		add("check-cancelled", "environmental inspection", "unknown", "The inspection was canceled and the unfinished items remained unconfirmed.")
		return true
	}
	if stop() {
		return r
	}
	if dir == "" {
		add("workspace", "local storage", "skipped", "The current service does not provide native workspace checking.", "ENV-0007")
		return r
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		add("workspace", "local storage", "error", "The current data directory cannot be opened. Please check the disk connection and access permissions, and do not create an empty directory to replace the original project.", "ENV-0007")
		return r
	}
	defer root.Close()
	if stop() {
		return r
	}
	if err := probeWrite(ctx, root); err != nil {
		if stop() {
			return r
		}
		add("storage-write", "storage write", "error", "File writing and synchronization cannot be completed in the current data directory. Please check disk space, permissions, or read-only status.", "ENV-0009")
	} else {
		add("storage-write", "storage write", "pass", "Temporary file writing, synchronization, and cleanup completed.", "ENV-0009")
	}
	if stop() {
		return r
	}
	free, err := freeBytes(dir)
	switch {
	case err != nil:
		add("disk-space", "Disk remaining space", "unknown", "The remaining space cannot be read and the disk is not determined to be normal.", "ENV-0009")
	case free < 1<<30:
		add("disk-space", "Disk remaining space", "warning", "There is less than 1 GB of free space, downloading or saving large files may fail. Please free up space or migrate the directory in storage settings.", "ENV-0009", "ENV-0022")
	default:
		add("disk-space", "Disk remaining space", "pass", "More than 1 GB of space is currently available; large assets and components still require additional space.", "ENV-0009")
	}
	for _, name := range []string{"tmp", "downloads"} {
		if stop() {
			return r
		}
		status, detail := scratchDirectory(ctx, root, name, repair)
		add("directory-"+name, map[string]string{"tmp": "Temporary file directory", "downloads": "Component download directory"}[name], status, detail, "ENV-0006", "ENV-0046")
	}
	if stop() {
		return r
	}
	path, err := mediatools.ResolveFFmpeg()
	info, statErr := os.Stat(path)
	if err != nil || statErr != nil || !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0) {
		add("media-tool", "Video processing tools", "warning", "No executable video processing tool found. Some video previews, transcoding and exporting will be unavailable, please reinstall from the official installation package.", "ENV-0014", "ENV-0015", "ENV-0016")
	} else {
		add("media-tool", "Video processing tools", "pass", "Tool file found; codec capabilities for specific assets are still being checked while in use.", "ENV-0014", "ENV-0015")
	}
	if stop() {
		return r
	}
	model, err := root.Stat("models/video-depth-anything-small/v1/checkpoints/video_depth_anything_vits.pth")
	switch {
	case errors.Is(err, os.ErrNotExist):
		add("depth-model", "Optional depth model", "skipped", "It has not been installed yet. When using depth motion capture for the first time, download and verify according to the official list.", "ENV-0011")
	case err != nil || !model.Mode().IsRegular() || model.Size() != 116440756:
		add("depth-model", "Optional depth model", "warning", "The model file is unreadable or incomplete in size. When deep motion capture is used again, it will be verified and restored by the component installer; the self-test will not delete or download the model.", "ENV-0011", "ENV-0046")
	default:
		add("depth-model", "Optional depth model", "pass", "The model file size is normal, but the component installer still needs to verify the hash before running.", "ENV-0011")
	}
	if stop() {
		return r
	}
	proxy := desktopnet.ConfigurationStatus()
	if proxy.AutoConfigOnly {
		add("proxy", "download agent", "warning", "The system is only configured with an automatic proxy script, and the current downloader cannot parse it. Please configure an available static system proxy or an explicit proxy environment variable.", "ENV-0010", "ENV-0011")
	} else {
		add("proxy", "download agent", "pass", map[string]string{"environment": "Explicitly configured proxy environment variables are inherited.", "system": "Use the system static proxy and pass it to the component download sub-process.", "direct": "No static proxy configuration found, currently using direct connection."}[proxy.Mode]+"This item does not test external network connectivity.", "ENV-0010", "ENV-0011")
	}
	return r
}

func probeWrite(ctx context.Context, root *os.Root) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	name := ".beeftv-environment-" + rand.Text()
	f, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write([]byte("environment-check"))
	syncErr := ctx.Err()
	if syncErr == nil {
		syncErr = f.Sync()
	}
	closeErr := f.Close()
	removeErr := root.Remove(name)
	return errors.Join(writeErr, syncErr, closeErr, removeErr)
}

func scratchDirectory(ctx context.Context, root *os.Root, name string, repair bool) (string, string) {
	info, err := root.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		if !repair {
			return "warning", "The directory is missing and can be safely rebuilt by the application."
		}
		if ctx.Err() != nil {
			return "unknown", "The check was canceled and the directory was not rebuilt."
		}
		if err = root.Mkdir(name, 0o750); err != nil && !errors.Is(err, os.ErrExist) {
			return "error", "Directory rebuild failed, please check write permissions."
		}
		info, err = root.Lstat(name)
		if err == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			return "repaired", "The missing directory has been rebuilt and rechecked; existing files have not been modified."
		}
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "error", "This location is not a normal directory or is inaccessible and has not been automatically replaced."
	}
	return "pass", "The directory exists and the existing content has not been modified."
}
