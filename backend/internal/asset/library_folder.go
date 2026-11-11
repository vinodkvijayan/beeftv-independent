package asset

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const maxUserAssetMoveBatch = 200
const assetFolderAssignmentAttempts = 3

func (l *Library) AssetFolders(userID string) ([]model.AssetFolder, error) {
	return l.repo.AssetFolders(userID)
}

func (l *Library) CreateAssetFolder(userID string, req CreateAssetFolderRequest) (model.AssetFolder, error) {
	if err := l.requireHost(); err != nil {
		return model.AssetFolder{}, err
	}
	name, nameKey, err := normalizeAssetFolderName(req.Name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	var folder model.AssetFolder
	err = l.host.WithStorageLock(func() error {
		return l.repo.Transaction(func(tx *repository.Repository) error {
			exists, existsErr := tx.AssetFolderNameExists(userID, nameKey, "")
			if existsErr != nil {
				return existsErr
			}
			if exists {
				return kernel.BadAuthRequest("A material category with the same name already exists")
			}
			position, positionErr := tx.NextAssetFolderPosition(userID)
			if positionErr != nil {
				return positionErr
			}
			now := time.Now().UTC()
			folder = model.AssetFolder{ID: kernel.NewID(), UserID: userID, Name: name, NameKey: nameKey, Position: position, CreatedAt: now, UpdatedAt: now}
			if err := tx.CreateAssetFolder(&folder); err != nil {
				if isAssetFolderNameConflict(err) {
					return kernel.BadAuthRequest("A material category with the same name already exists")
				}
				return err
			}
			return nil
		})
	})
	if err != nil {
		return model.AssetFolder{}, err
	}
	return folder, nil
}

func (l *Library) UpdateAssetFolder(userID string, folderID string, req UpdateAssetFolderRequest) (model.AssetFolder, error) {
	if err := l.requireHost(); err != nil {
		return model.AssetFolder{}, err
	}
	name, nameKey, err := normalizeAssetFolderName(req.Name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	folderID = strings.TrimSpace(folderID)
	var folder *model.AssetFolder
	err = l.host.WithStorageLock(func() error {
		return l.repo.Transaction(func(tx *repository.Repository) error {
			item, loadErr := tx.AssetFolderForUser(userID, folderID)
			if loadErr != nil {
				if isNotFound(loadErr) {
					return kernel.BadAuthRequest("Material classification does not exist")
				}
				return loadErr
			}
			exists, existsErr := tx.AssetFolderNameExists(userID, nameKey, item.ID)
			if existsErr != nil {
				return existsErr
			}
			if exists {
				return kernel.BadAuthRequest("A material category with the same name already exists")
			}
			item.Name = name
			item.NameKey = nameKey
			item.UpdatedAt = time.Now().UTC()
			if err := tx.UpdateAssetFolder(item); err != nil {
				if isNotFound(err) {
					return kernel.BadAuthRequest("Material classification does not exist")
				}
				if isAssetFolderNameConflict(err) {
					return kernel.BadAuthRequest("A material category with the same name already exists")
				}
				return err
			}
			folder = item
			return nil
		})
	})
	if err != nil {
		return model.AssetFolder{}, err
	}
	return *folder, nil
}

func (l *Library) DeleteAssetFolder(userID string, folderID string) error {
	if err := l.requireHost(); err != nil {
		return err
	}
	return l.host.WithStorageLock(func() error {
		err := l.repo.DeleteAssetFolder(userID, strings.TrimSpace(folderID))
		if isNotFound(err) {
			return kernel.BadAuthRequest("Material classification does not exist")
		}
		if errors.Is(err, repository.ErrAssetFolderAssignmentConflict) {
			return kernel.NewAppError(http.StatusConflict, "The material has been updated by other operations, please try again")
		}
		return err
	})
}

func (l *Library) MoveUserAssetsToFolder(userID string, req MoveUserAssetsRequest) error {
	if err := l.requireHost(); err != nil {
		return err
	}
	ids := kernel.UniqueNonEmpty(req.AssetIDs)
	if len(ids) == 0 {
		return kernel.BadAuthRequest("Please select the material you want to move")
	}
	if len(ids) > maxUserAssetMoveBatch {
		return kernel.BadAuthRequest("Move up to 200 assets at a time")
	}
	folderID := strings.TrimSpace(req.FolderID)
	return l.host.WithStorageLock(func() error {
		return l.repo.Transaction(func(tx *repository.Repository) error {
			if folderID != "" {
				if _, err := tx.AssetFolderForUser(userID, folderID); err != nil {
					if isNotFound(err) {
						return kernel.BadAuthRequest("The target material category does not exist")
					}
					return err
				}
			}
			assets, err := tx.AssetsForUserIDs(userID, ids)
			if err != nil {
				return err
			}
			if len(assets) != len(ids) {
				return kernel.BadAuthRequest("Some materials do not exist or do not belong to the current user")
			}
			now := time.Now().UTC()
			for index := range assets {
				if err := assignAssetFolder(tx, userID, assets[index], folderID, now); err != nil {
					return err
				}
			}
			return nil
		})
	})
}

func assignAssetFolder(tx *repository.Repository, userID string, item model.Asset, folderID string, now time.Time) error {
	current := item
	for attempt := 0; attempt < assetFolderAssignmentAttempts; attempt++ {
		payloadJSON, err := assetPayloadWithFolder(current.PayloadJSON, folderID, now)
		if err != nil {
			return err
		}
		ok, err := tx.AssignUserAssetFolder(userID, current.ID, folderID, payloadJSON, current.PayloadJSON, now)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
		fresh, loadErr := tx.AssetForUser(userID, current.ID)
		if loadErr != nil {
			if isNotFound(loadErr) {
				return kernel.BadAuthRequest("Some materials do not exist or do not belong to the current user")
			}
			return loadErr
		}
		current = *fresh
		now = time.Now().UTC()
	}
	return kernel.NewAppError(http.StatusConflict, "The material has been updated by other operations, please try again")
}

func assetPayloadWithFolder(payloadJSON string, folderID string, updatedAt time.Time) (string, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return "", err
	}
	if folderID == "" {
		delete(payload, "folderId")
	} else {
		payload["folderId"] = folderID
	}
	payload["updatedAt"] = updatedAt.Format(time.RFC3339Nano)
	encoded, err := json.Marshal(payload)
	return string(encoded), err
}

func normalizeAssetFolderName(value string) (string, string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		return "", "", kernel.BadAuthRequest("Please enter the material category name")
	}
	if utf8.RuneCountInString(name) > 40 {
		return "", "", kernel.BadAuthRequest("Material category name cannot exceed 40 characters")
	}
	return name, strings.ToLower(name), nil
}

func isAssetFolderNameConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "idx_asset_folders_user_name") ||
		strings.Contains(message, "unique constraint") ||
		strings.Contains(message, "duplicate key")
}
