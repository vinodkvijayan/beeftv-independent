package database

import (
	"fmt"
	"gorm.io/gorm"
)

func migrateAssistantSkillPins(tx *gorm.DB) error {
	if err := ensureSQLiteColumn(tx, "assistant_turns", "skill_pins_json", "TEXT"); err != nil {
		return err
	}
	return requireAssistantSkillPins(tx)
}

func requireAssistantSkillPins(db *gorm.DB) error {
	has, err := sqliteHasColumn(db, "assistant_turns", "skill_pins_json")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("The local assistant skill version range is missing, please enable automatic migration")
	}
	return nil
}
