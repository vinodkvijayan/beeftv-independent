package database

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// backfillUnattributedLegacyUploads plants Size-0 unattributed markers for
// pre-v13 PENDING and FAILED rows that have an identity and no positive
// witness. Anonymous daily totals cannot prove who paid. Existing Size>0
// witnesses stay authoritative. READY is already consumed and is left alone.
func backfillUnattributedLegacyUploads(tx *gorm.DB) error {
	var resources []model.Resource
	if err := tx.Where("status IN ?", []model.ResourceStatus{model.ResourceStatusPending, model.ResourceStatusFailed}).Find(&resources).Error; err != nil {
		return fmt.Errorf("Read the uploaded resources to be backfilled: %w", err)
	}
	now := time.Now()
	for i := range resources {
		resource := resources[i]
		if strings.TrimSpace(resource.UserID) == "" {
			continue
		}
		identity := legacyUploadIdentity(resource)
		if identity == "" {
			continue
		}
		var existing model.UserUploadReservation
		err := tx.Where("user_id = ? AND identity = ?", resource.UserID, identity).First(&existing).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("Read upload reservation %s: %w", identity, err)
		}
		row := model.UserUploadReservation{
			ID:        resource.UserID + ":" + identity,
			UserID:    resource.UserID,
			Identity:  identity,
			Day:       model.UploadReservationUnattributedDay,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := tx.Create(&row).Error; err != nil {
			return fmt.Errorf("Backfill upload reserved %s: %w", identity, err)
		}
	}
	return nil
}

func legacyUploadIdentity(resource model.Resource) string {
	if resource.UploadKey != nil {
		if key := strings.TrimSpace(*resource.UploadKey); key != "" {
			return key
		}
	}
	return strings.TrimSpace(resource.ID)
}
