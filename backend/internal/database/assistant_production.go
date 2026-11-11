package database

import (
	"fmt"
	"gorm.io/gorm"
)

func migrateAssistantProductionAuthorization(tx *gorm.DB) error {
	return ensureSQLiteColumn(tx, "assistant_turns", "generation_authorization_json", "TEXT")
}

func requireAssistantProductionAuthorization(db *gorm.DB) error {
	has, err := sqliteHasColumn(db, "assistant_turns", "generation_authorization_json")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("The assistant production authorization structure is missing, please enable automatic migration.")
	}
	return nil
}
