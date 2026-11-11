package desktopupdate

import "errors"

const (
	StatusDisabled    = "disabled"
	StatusIdle        = "idle"
	StatusChecking    = "checking"
	StatusAvailable   = "available"
	StatusDownloading = "downloading"
	StatusReady       = "ready"
	StatusInstalling  = "installing"
	StatusError       = "error"
)

// UpdateState is the Wails JSON contract. Field names must stay stable.
type UpdateState struct {
	Phase           string `json:"phase,omitempty"`
	CompletedFiles  int    `json:"completedFiles,omitempty"`
	TotalFiles      int    `json:"totalFiles,omitempty"`
	InstallPrepared bool   `json:"installPrepared,omitempty"`
	Status          string `json:"status"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	ReleaseNotes    string `json:"releaseNotes"`
	DownloadedBytes int64  `json:"downloadedBytes"`
	TotalBytes      int64  `json:"totalBytes"`
	BytesPerSecond  int64  `json:"bytesPerSecond"`
	Reconnecting    bool   `json:"reconnecting"`
	Error           string `json:"error"`
}

var (
	ErrPreparationTimeout = errors.New("Preparing for update timed out, please try again; the current version has not been replaced.")
	ErrDisabled           = errors.New("Automatic updates are not turned on")
	ErrBusy               = errors.New("There is an update operation in progress")
	ErrNotAvailable       = errors.New("No updates available for download")
	ErrNotReady           = errors.New("The update is not ready to install yet")
	ErrInvalidSignature   = errors.New("Update information cannot be verified")
	ErrTampered           = errors.New("The update file is corrupted or tampered with")
	ErrWrongPlatform      = errors.New("There is no update package suitable for the current system")
	ErrUnsupported        = errors.New("The current system does not support automatic updates")
	ErrNoDowngrade        = errors.New("The update source version is not the updated version")
	ErrTimeout            = errors.New("The network does not respond for a long time")
	ErrInvalidArchive     = errors.New("The update package format is invalid")
	ErrInstallFailed      = errors.New("Installation update failed")
	ErrIncompleteConfig   = errors.New("Update configuration is incomplete")
	ErrProxyUnavailable   = errors.New("Unable to connect to the proxy, please check the proxy software")
	ErrNetworkOffline     = errors.New("Unable to connect to the update server, please check the network")
	ErrSecureConnection   = errors.New("Secure connection failed, please check proxy settings")
	ErrServerBusy         = errors.New("The update server is temporarily unavailable")
	ErrConnectionDropped  = errors.New("Network connection interrupted")
	ErrNetworkUnstable    = errors.New("The network is unstable and the download progress has been retained.")
)

func (s UpdateState) clone() UpdateState {
	return s
}

func preparationTimeoutMessage(phase string) string {
	stage := "Ready to install"
	switch phase {
	case "verifying":
		stage = "Verify update package"
	case "extracting":
		stage = "Unzip the update package"
	}
	return stage + "Timed out and the current version was not replaced. Please try again; if it fails again, export the diagnostic package."
}
