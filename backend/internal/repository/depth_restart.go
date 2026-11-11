package repository

import (
	"context"
	"infinite-canvas/backend/internal/model"
	"time"
)

// Called only after acquiring the desktop workspace lock, before workers start.
// Interrupted local inference is resumable by an explicit retry, never at startup.
func (r *Repository) PauseDepthCapturesAfterRestart(ctx context.Context) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.Task{}).
		Where("type = ? AND status IN ?", model.TaskTypeDepthCapture, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
		Updates(map[string]any{"status": model.TaskStatusFailed, "stage": "Paused, waiting for manual continuation", "error": "The app has been restarted and depth capture has been paused. Please confirm that the component has been installed and click Retry to continue.", "lease_owner": "", "lease_expires_at": nil, "next_poll_at": nil, "completed_at": now, "updated_at": now}).Error
}
