package resource

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"infinite-canvas/backend/internal/repository"
)

const storageMigrationMarker = ".storage-v2-migrated"

type StorageMigrationSummary struct {
	Tasks    int
	Assets   int
	Projects int
	Backup   string
}

func MigrateLegacyStorage(
	repo *repository.Repository,
	dataDir string,
	persistLegacyMedia func(userID string, payload map[string]any) (map[string]any, error),
	protectSecrets func(value any) error,
	publicTaskInput func(raw string) string,
) (StorageMigrationSummary, error) {
	if repo.Dialect() != "sqlite" {
		return StorageMigrationSummary{}, nil
	}
	marker := filepath.Join(dataDir, storageMigrationMarker)
	if _, err := os.Stat(marker); err == nil {
		return StorageMigrationSummary{}, nil
	}
	backupDir := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(backupDir, 0o750); err != nil {
		return StorageMigrationSummary{}, err
	}
	backup := filepath.Join(backupDir, "open_ai_canvas-before-storage-v2-"+time.Now().Format("20060102-150405")+".db")
	if err := repo.BackupSQLite(backup); err != nil {
		return StorageMigrationSummary{}, fmt.Errorf("Backup database failed: %w", err)
	}
	summary := StorageMigrationSummary{Backup: backup}

	tasks, err := repo.AllTasks()
	if err != nil {
		return summary, err
	}
	for index := range tasks {
		changed := false
		if strings.Contains(tasks[index].InputJSON, "data:") {
			var input map[string]any
			if err := json.Unmarshal([]byte(tasks[index].InputJSON), &input); err != nil {
				return summary, fmt.Errorf("Parsing old input for task %s failed: %w", tasks[index].ID, err)
			}
			stored, storeErr := persistLegacyMedia(tasks[index].UserID, input)
			if storeErr != nil {
				return summary, fmt.Errorf("Migration task %s's old input media failed: %w", tasks[index].ID, storeErr)
			}
			encoded, err := json.Marshal(stored)
			if err != nil {
				return summary, fmt.Errorf("Migration input for serialization task %s failed: %w", tasks[index].ID, err)
			}
			tasks[index].InputJSON = string(encoded)
			changed = true
		}
		if strings.Contains(tasks[index].ResultJSON, "data:") {
			var result map[string]any
			if err := json.Unmarshal([]byte(tasks[index].ResultJSON), &result); err != nil {
				return summary, fmt.Errorf("Parsing old results for task %s failed: %w", tasks[index].ID, err)
			}
			stored, storeErr := persistLegacyMedia(tasks[index].UserID, result)
			if storeErr != nil {
				return summary, fmt.Errorf("Migration task %s's old result media failed: %w", tasks[index].ID, storeErr)
			}
			encoded, err := json.Marshal(stored)
			if err != nil {
				return summary, fmt.Errorf("Migration result of serialization task %s failed: %w", tasks[index].ID, err)
			}
			tasks[index].ResultJSON = string(encoded)
			changed = true
		}
		if strings.TrimSpace(tasks[index].InputJSON) != "" {
			var protected any
			if err := json.Unmarshal([]byte(tasks[index].InputJSON), &protected); err != nil {
				return summary, fmt.Errorf("Failed to parse input to task %s to perform key protection: %w", tasks[index].ID, err)
			}
			if err := protectSecrets(protected); err != nil {
				return summary, fmt.Errorf("Input key failed for protection task %s: %w", tasks[index].ID, err)
			}
			encoded, err := json.Marshal(protected)
			if err != nil {
				return summary, fmt.Errorf("Desensitized input for serialization task %s failed: %w", tasks[index].ID, err)
			}
			if string(encoded) != tasks[index].InputJSON {
				tasks[index].InputJSON = string(encoded)
				changed = true
			}
		}
		if tasks[index].Status == "succeeded" {
			compacted := publicTaskInput(tasks[index].InputJSON)
			if compacted != tasks[index].InputJSON {
				tasks[index].InputJSON = compacted
				changed = true
			}
		}
		if changed {
			if err := repo.Save(&tasks[index]); err != nil {
				return summary, err
			}
			summary.Tasks++
		}
	}

	assets, err := repo.AllAssets()
	if err != nil {
		return summary, err
	}
	for index := range assets {
		if !strings.Contains(assets[index].PayloadJSON, "data:") {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(assets[index].PayloadJSON), &payload); err != nil {
			return summary, fmt.Errorf("Failed to parse old payload of material %s: %w", assets[index].ID, err)
		}
		stored, err := persistLegacyMedia(assets[index].UserID, payload)
		if err != nil {
			return summary, fmt.Errorf("Failed to migrate old media of material %s: %w", assets[index].ID, err)
		}
		encoded, err := json.Marshal(stored)
		if err != nil {
			return summary, fmt.Errorf("Migration payload of serialized material %s failed: %w", assets[index].ID, err)
		}
		assets[index].PayloadJSON = string(encoded)
		if err := repo.Save(&assets[index]); err != nil {
			return summary, err
		}
		summary.Assets++
	}

	projects, err := repo.AllCanvasProjects()
	if err != nil {
		return summary, err
	}
	for index := range projects {
		if !strings.Contains(projects[index].PayloadJSON, "data:") {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(projects[index].PayloadJSON), &payload); err != nil {
			return summary, fmt.Errorf("Parsing old payload for canvas item %s failed: %w", projects[index].ID, err)
		}
		stored, err := persistLegacyMedia(projects[index].UserID, payload)
		if err != nil {
			return summary, fmt.Errorf("Migrating old media for canvas project %s failed: %w", projects[index].ID, err)
		}
		encoded, err := json.Marshal(stored)
		if err != nil {
			return summary, fmt.Errorf("Migration payload for serialized canvas item %s failed: %w", projects[index].ID, err)
		}
		projects[index].PayloadJSON = string(encoded)
		if err := repo.Save(&projects[index]); err != nil {
			return summary, err
		}
		summary.Projects++
	}

	if err := repo.CleanupDuplicateTaskPayloads(); err != nil {
		return summary, err
	}
	if err := repo.Vacuum(); err != nil {
		return summary, err
	}
	if err := os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)), 0o640); err != nil {
		return summary, err
	}
	return summary, nil
}
