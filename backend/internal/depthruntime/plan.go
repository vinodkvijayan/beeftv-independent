package depthruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"infinite-canvas/backend/internal/desktopstorage"
)

var ErrNotInstalled = errors.New("The depth capture component has not been installed yet. Please download it from the storage page of settings before using it.")

const modelSize = int64(116440756)
const modelSHA = "13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609"

type Plan struct {
	DownloadBytes int64  `json:"downloadBytes"`
	RequiredBytes int64  `json:"requiredBytes"`
	FreeBytes     uint64 `json:"freeBytes"`
}

// Inspect uses installed files only. It never fetches a manifest or runs Python.
func Inspect(ctx context.Context, dataDir, platform, variant string) (Installation, error) {
	paths, err := runtimeLayout(dataDir, platform, variant)
	if err != nil {
		return Installation{}, err
	}
	modelRuntime := filepath.Join(dataDir, "models", "video-depth-anything-small", "v1")
	model := filepath.Join(modelRuntime, "checkpoints", "video_depth_anything_vits.pth")
	expected := Artifact{Size: modelSize, SHA256: modelSHA}
	if raw, err := os.ReadFile(filepath.Join(paths.Root, ".installation.json")); err == nil {
		var installed Artifact
		if json.Unmarshal(raw, &installed) == nil && installed.Size > 0 && len(installed.SHA256) == 64 {
			expected = installed
		}
	}
	if !installedRuntime(paths, platform) {
		return Installation{}, ErrNotInstalled
	}
	if err := verifyFileContext(ctx, model, expected); err != nil {
		return Installation{}, ErrNotInstalled
	}
	return Installation{Python: paths.Python, ToolDir: paths.ToolDir, ModelRuntime: modelRuntime}, nil
}

// DownloadPlan fetches metadata only, using the same signature checks as Ensure.
func DownloadPlan(ctx context.Context, options EnsureOptions) (Plan, error) {
	paths, err := runtimeLayout(options.DataDir, options.Platform, options.Variant)
	if err != nil {
		return Plan{}, err
	}
	manifest, artifact, err := loadArtifacts(ctx, options)
	if err != nil {
		return Plan{}, err
	}
	runtimeReady := installedRuntime(paths, options.Platform)
	archiveReady := runtimeReady || verifyFileContext(ctx, paths.Archive, artifact) == nil
	modelPath := filepath.Join(options.DataDir, "models", "video-depth-anything-small", "v1", "checkpoints", "video_depth_anything_vits.pth")
	return installationPlan(options.DataDir, artifact, manifest.Model, archiveReady, verifyFileContext(ctx, modelPath, manifest.Model) == nil, runtimeReady)
}

func installedRuntime(paths runtimePaths, platform string) bool {
	pythonReady := pathExecutable(paths.Python) && pathExecutable(paths.BundledPython)
	if platform == "windows-amd64" {
		pythonReady = pathRegular(paths.Python) && pathRegular(paths.BundledPython)
	}
	info, err := os.Stat(filepath.Join(paths.ToolDir, "depth_capture"))
	return pythonReady && err == nil && info.IsDir()
}

// Metadata preview and installation must use the same version and trust rules.
func loadArtifacts(ctx context.Context, options EnsureOptions) (Manifest, Artifact, error) {
	windows := options.Platform == "windows-amd64"
	manifest, err := fetchManifestSources(ctx, options)
	if err != nil {
		if ctx.Err() != nil {
			return Manifest{}, Artifact{}, ctx.Err()
		}
		if windows || options.FallbackManifest == nil {
			return Manifest{}, Artifact{}, err
		}
		manifest = *options.FallbackManifest
	}
	if (windows && manifest.Version != 2) || (!windows && manifest.Version != 1) {
		return Manifest{}, Artifact{}, fmt.Errorf("Unsupported deep component manifest version %d", manifest.Version)
	}
	artifact := manifest.Runtime
	if windows {
		var ok bool
		artifact, ok = manifest.Runtimes[options.Platform+"/"+options.Variant]
		if !ok {
			return Manifest{}, Artifact{}, errors.New("The deep component list lacks the corresponding Windows runtime package")
		}
		if artifact.Files <= 0 || artifact.ExpandedSize <= 0 {
			return Manifest{}, Artifact{}, errors.New("Windows deep component inventory is missing the decompression volume or number of files")
		}
	}
	if artifact.Size <= 0 || manifest.Model.Size <= 0 {
		return Manifest{}, Artifact{}, errors.New("Deep component manifest missing download size")
	}
	return manifest, artifact, nil
}

func installationPlan(dataDir string, artifact, model Artifact, archiveReady, modelReady, runtimeReady bool) (Plan, error) {
	var plan Plan
	if !archiveReady {
		plan.DownloadBytes += artifact.Size
		plan.RequiredBytes += artifact.Size
		if len(artifact.Parts) > 0 {
			plan.RequiredBytes += artifact.Size
		}
	}
	if !runtimeReady {
		plan.RequiredBytes += artifact.ExpandedSize
	}
	if !modelReady {
		plan.DownloadBytes += model.Size
		plan.RequiredBytes += model.Size
	}
	plan.RequiredBytes += 256 << 20
	// Query the containing volume without scanning the user's media library.
	var err error
	plan.FreeBytes, err = desktopstorage.FreeBytes(dataDir)
	return plan, err
}
