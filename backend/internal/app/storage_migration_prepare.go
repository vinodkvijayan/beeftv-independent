package app

import (
	"context"
	"fmt"
)

func (s *Service) PrepareStorageMigration(ctx context.Context) (func(), error) {
	workers := s.backgroundWorkers()
	if !workers.PauseIfIdle() {
		return nil, fmt.Errorf("There are still %d background tasks running. Please cancel or wait for completion in the canvas task panel before migrating. The current directory has not changed and projects and assets are still available", workers.ActiveTaskCount())
	}
	if err := s.depthCaptureRuntime().PauseComponentDownload(ctx); err != nil {
		workers.Resume()
		return nil, fmt.Errorf("Component downloads have not been paused, migration has not started, and the current workspace is still available. Please try again later\n\n%w", err)
	}
	return workers.Resume, nil
}
