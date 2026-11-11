package database

import (
	"fmt"
	"gorm.io/gorm"
)

func migrateAssistantSessions(tx *gorm.DB) error {
	for _, name := range []string{"durable_session_id", "durable_native_sources"} {
		if err := ensureSQLiteColumn(tx, "assistant_turns", name, "TEXT"); err != nil {
			return err
		}
	}
	return requireAssistantSessions(tx)
}
func requireAssistantSessions(db *gorm.DB) error {
	has, err := sqliteHasColumn(db, "assistant_turns", "durable_session_id")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("Assistant session binding is missing, please enable automatic migration")
	}
	has, err = sqliteHasColumn(db, "assistant_turns", "durable_native_sources")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("Assistant historical material authorization is missing, please enable automatic migration.")
	}
	return nil
}
