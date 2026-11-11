package canvas

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	assetlib "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type AssetBytesRepairIssue struct {
	AssetID string `json:"assetId"`
	Reason  string `json:"reason"`
}

type AssetBytesRepairReport struct {
	Apply      bool                    `json:"apply"`
	Scanned    int                     `json:"scanned"`
	Repairable int                     `json:"repairable"`
	Repaired   int                     `json:"repaired"`
	Unresolved []AssetBytesRepairIssue `json:"unresolved"`
}

// RepairAssetBytes is an explicit offline maintenance operation, not a read fallback.
// Only an owned, ready resource with a known positive size can repair a record.
func RepairAssetBytes(db *gorm.DB, apply bool) (AssetBytesRepairReport, error) {
	report := AssetBytesRepairReport{Apply: apply, Unresolved: []AssetBytesRepairIssue{}}
	// Payloads may contain private media URLs; never include SQL parameters in logs.
	err := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		after := ""
		for {
			var rows []model.Asset
			if err := tx.Where("id > ? AND kind IN ?", after, []string{"image", "video", "audio", "model"}).Order("id ASC").Limit(100).Find(&rows).Error; err != nil {
				return errors.New("Failed to read material, repair not submitted")
			}
			if len(rows) == 0 {
				return nil
			}
			for _, asset := range rows {
				after = asset.ID
				report.Scanned++
				issue := func(reason string) {
					report.Unresolved = append(report.Unresolved, AssetBytesRepairIssue{AssetID: asset.ID, Reason: reason})
				}
				var payload map[string]json.RawMessage
				var data map[string]json.RawMessage
				if json.Unmarshal([]byte(asset.PayloadJSON), &payload) != nil || json.Unmarshal(payload["data"], &data) != nil || data == nil {
					issue("The material JSON or data is invalid and requires manual verification.")
					continue
				}
				if assetHasNonNegativeBytes(data) {
					continue
				}
				var kind, key string
				_ = json.Unmarshal(payload["kind"], &kind)
				_ = json.Unmarshal(data["storageKey"], &key)
				key = strings.TrimSpace(key)
				if strings.TrimSpace(asset.UserID) == "" || kind != asset.Kind || !strings.HasPrefix(key, "resource:") || strings.TrimPrefix(key, "resource:") == "" {
					issue("Inconsistent type or lack of explicit resource: reference, cannot infer file size")
					continue
				}
				var resource model.Resource
				err := tx.Where("id = ? AND user_id = ? AND kind = ? AND status = ? AND size > 0", strings.TrimPrefix(key, "resource:"), asset.UserID, kind, model.ResourceStatusReady).Take(&resource).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					issue("No resource with the same user, same type, ready and known size was found")
					continue
				}
				if err != nil {
					return errors.New("Failed to read resource, repair not committed")
				}
				data["bytes"], err = json.Marshal(resource.Size)
				if err != nil {
					return err
				}
				payload["data"], err = json.Marshal(data)
				if err != nil {
					return err
				}
				now := time.Now().UTC()
				payload["updatedAt"], err = json.Marshal(now.Format(time.RFC3339Nano))
				if err != nil {
					return err
				}
				encoded, err := json.Marshal(payload)
				if err != nil {
					return err
				}
				if err := assetlib.ValidateDocument(encoded); err != nil {
					issue("There are still other contract errors in the material and have not been modified. Please check separately.")
					continue
				}
				report.Repairable++
				if !apply {
					continue
				}
				result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ? AND payload_json = ? AND updated_at = ?", asset.ID, asset.UserID, asset.PayloadJSON, asset.UpdatedAt).Updates(map[string]any{"payload_json": string(encoded), "updated_at": now})
				if result.Error != nil {
					return errors.New("Failed to update the material and did not submit the fix.")
				}
				if result.RowsAffected != 1 {
					return fmt.Errorf("Material %s has changed. The entire batch of repairs will be rolled back. Please stop writing and try again.", asset.ID)
				}
				report.Repaired++
			}
		}
	})
	if err != nil {
		report.Repaired = 0
	}
	return report, err
}

func assetHasNonNegativeBytes(data map[string]json.RawMessage) bool {
	raw, ok := data["bytes"]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return false
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}
