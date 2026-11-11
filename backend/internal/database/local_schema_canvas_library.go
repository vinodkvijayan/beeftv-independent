package database

import (
	"fmt"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func migrateCanvasLibrarySchema(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CanvasLibraryFolder{}, &model.CanvasDrawing{}); err != nil {
		return fmt.Errorf("Migrate canvas folder and artboard: %w", err)
	}
	if err := ensureSQLiteColumn(tx, "canvas_projects", "library_folder_id", "TEXT"); err != nil {
		return err
	}
	if err := ensureSQLiteColumn(tx, "canvas_library_folders", "deleted_at", "DATETIME"); err != nil {
		return err
	}
	if err := ensureSQLiteColumn(tx, "canvas_drawings", "deleted_at", "DATETIME"); err != nil {
		return err
	}
	if err := ensureSQLiteIndex(tx, "canvas_library_folders", "idx_canvas_library_folders_user",
		"CREATE INDEX idx_canvas_library_folders_user ON canvas_library_folders(user_id)"); err != nil {
		return err
	}
	if err := ensureSQLiteIndex(tx, "canvas_drawings", "idx_canvas_drawings_canvas",
		"CREATE INDEX idx_canvas_drawings_canvas ON canvas_drawings(canvas_id)"); err != nil {
		return err
	}
	if err := ensureSQLiteIndex(tx, "canvas_projects", "idx_canvas_projects_library_folder",
		"CREATE INDEX idx_canvas_projects_library_folder ON canvas_projects(user_id, library_folder_id)"); err != nil {
		return err
	}
	return requireCanvasLibrarySchema(tx)
}

func requireCanvasLibrarySchema(db *gorm.DB) error {
	if !db.Migrator().HasTable(&model.CanvasLibraryFolder{}) {
		return fmt.Errorf("Local canvas folder table is missing, please enable automatic migration")
	}
	if !db.Migrator().HasTable(&model.CanvasDrawing{}) {
		return fmt.Errorf("The local artboard table is missing, please enable automatic migration")
	}
	for _, column := range []string{"id", "user_id", "name", "cover_resource_id", "deleted_at", "created_at", "updated_at"} {
		has, err := sqliteHasColumn(db, "canvas_library_folders", column)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("Local canvas folder table missing column %s", column)
		}
	}
	for _, column := range []string{
		"user_id", "canvas_id", "drawing_id", "engine", "revision", "snapshot_json",
		"shape_count", "page_count", "preview_resource_id", "render_resource_id",
		"render_page_id", "render_width", "render_height", "render_mime_type",
		"render_background", "render_storage_key", "deleted_at", "created_at", "updated_at",
	} {
		has, err := sqliteHasColumn(db, "canvas_drawings", column)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("Local artboard table missing column %s", column)
		}
	}
	hasFolder, err := sqliteHasColumn(db, "canvas_projects", "library_folder_id")
	if err != nil {
		return err
	}
	if !hasFolder {
		return fmt.Errorf("Local canvas table missing column library_folder_id")
	}
	if err := requireSQLitePrimaryKey(db, "canvas_library_folders", []string{"id"}); err != nil {
		return err
	}
	if err := requireSQLitePrimaryKey(db, "canvas_drawings", []string{"user_id", "canvas_id", "drawing_id"}); err != nil {
		return err
	}
	for _, index := range []sqliteIndexContract{
		{table: "canvas_library_folders", name: "idx_canvas_library_folders_user", columns: []string{"user_id"}},
		{table: "canvas_drawings", name: "idx_canvas_drawings_canvas", columns: []string{"canvas_id"}},
		{table: "canvas_projects", name: "idx_canvas_projects_library_folder", columns: []string{"user_id", "library_folder_id"}},
	} {
		valid, err := matchesSQLiteIndex(db, index)
		if err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("Local database index %s definition is incomplete", index.name)
		}
	}
	return nil
}
