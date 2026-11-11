package database

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestTaskRecoveryOutcomeMigrationOnlyAddsNullableColumn(t *testing.T) {
	db, err := Open(Config{DSN: "file:task-recovery-v25?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	stop := errors.New("stop at v25")
	if err = migrateLocalSchema(db, func(v int64) error {
		if v == 26 {
			return stop
		}
		return nil
	}); !errors.Is(err, stop) {
		t.Fatal(err)
	}
	// v1 创建新库会使用当前模型；用明确历史 DDL 去掉尚未存在的列。
	if err = db.Exec("ALTER TABLE tasks DROP COLUMN recovery_outcome").Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec("ALTER TABLE tasks ADD COLUMN custom_marker TEXT").Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`INSERT INTO tasks(id,user_id,type,status,stage,result_json,custom_marker) VALUES('historical','owner','canvas_image','running','upstream generating','original','keep')`).Error; err != nil {
		t.Fatal(err)
	}
	var before string
	if err = db.Raw("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").Scan(&before).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = MigrateLocalSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var row struct {
		Status          string
		ResultJSON      string
		RecoveryOutcome *string
		CustomMarker    string
	}
	if err = db.Table("tasks").Where("id = ?", "historical").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "running" || row.ResultJSON != "original" || row.RecoveryOutcome != nil || row.CustomMarker != "keep" {
		t.Fatalf("History has been rewritten: %+v", row)
	}
	var columns []struct {
		Name      string
		Notnull   int
		DfltValue *string
	}
	if err = db.Raw("PRAGMA table_info(tasks)").Scan(&columns).Error; err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range columns {
		if c.Name == "recovery_outcome" {
			found = true
			if c.Notnull != 0 || c.DfltValue != nil {
				t.Fatal("New column is not a nullable column with no default value")
			}
		}
	}
	if !found {
		t.Fatal("recovery_outcome missing")
	}
	if err = RequireLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err = db.Exec("ALTER TABLE tasks DROP COLUMN recovery_outcome").Error; err != nil {
		t.Fatal(err)
	}
	if err = RequireLocalSchema(db); err == nil {
		t.Fatal("Missing migrated columns are still marked Ready")
	}
}

func TestTaskRecoveryOutcomeMigrationRollsBackWithLedgerFailure(t *testing.T) {
	db, err := Open(Config{DSN: "file:task-recovery-rollback?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	stop := errors.New("v25")
	if err = migrateLocalSchema(db, func(v int64) error {
		if v == 26 {
			return stop
		}
		return nil
	}); !errors.Is(err, stop) {
		t.Fatal(err)
	}
	if err = db.Exec("ALTER TABLE tasks DROP COLUMN recovery_outcome").Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`CREATE TRIGGER fail_v26 BEFORE INSERT ON local_schema_migrations WHEN NEW.version = 26 BEGIN SELECT RAISE(ABORT, 'injected'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err = MigrateLocalSchema(db); err == nil {
		t.Fatal("Injection failure did not prevent migration")
	}
	version, _ := currentSchemaVersion(db)
	if version != 25 || db.Migrator().HasColumn(&model.Task{}, "recovery_outcome") {
		t.Fatal("DDL and migration records are not rolled back at the same time")
	}
}
