package prompts

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestStyleProfileCreateAndUpdateOwnsIdentityAndRevision(t *testing.T) {
	svc := newStyleProfileTestService(t)
	created, err := svc.CreateStyleProfile("user-1", styleProfileTestRequest(t, "Strange and dark colors", 88))
	if err != nil {
		t.Fatal(err)
	}
	var createdDocument StyleProfileDocument
	if err := json.Unmarshal([]byte(created.ProfileJSON), &createdDocument); err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 || createdDocument.PresetID != created.ID || createdDocument.SourceProfileID != created.ID || createdDocument.Source != "user" || createdDocument.Revision != 1 {
		t.Fatalf("created profile identity was not normalized: model=%+v document=%+v", created, createdDocument)
	}
	if createdDocument.Selection["medium"] != "Gongbi dark color" || len(createdDocument.Assets) != 1 || createdDocument.Assets[0].License == nil || createdDocument.Assets[0].License.Note != "Source records need to be kept" {
		t.Fatalf("created profile metadata was not preserved: document=%+v", createdDocument)
	}

	updated, err := svc.UpdateStyleProfile("user-1", created.ID, styleProfileTestRequest(t, "Zhiguai dark color version 2", 300))
	if err != nil {
		t.Fatal(err)
	}
	var updatedDocument StyleProfileDocument
	if err := json.Unmarshal([]byte(updated.ProfileJSON), &updatedDocument); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updatedDocument.Revision != 2 || updatedDocument.PresetID != created.ID || updatedDocument.Title != "Zhiguai dark color version 2" {
		t.Fatalf("updated profile revision was not server controlled: model=%+v document=%+v", updated, updatedDocument)
	}
}

func TestStyleProfileMutationsRejectOtherUsers(t *testing.T) {
	svc := newStyleProfileTestService(t)
	created, err := svc.CreateStyleProfile("user-1", styleProfileTestRequest(t, "user style", 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateStyleProfile("user-2", created.ID, styleProfileTestRequest(t, "Ultra vires modification", 1)); err == nil {
		t.Fatal("expected cross-user update to fail")
	}
	if err := svc.SetStyleProfileFavorite("user-2", created.ID, true); err == nil {
		t.Fatal("expected cross-user favorite to fail")
	}
	if err := svc.TouchStyleProfile("user-2", created.ID); err == nil {
		t.Fatal("expected cross-user use tracking to fail")
	}
	if err := svc.DeleteStyleProfile("user-2", created.ID); err == nil {
		t.Fatal("expected cross-user delete to fail")
	}
	profiles, err := svc.ListStyleProfiles("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || profiles[0].ID != created.ID {
		t.Fatalf("owner profile was changed by rejected mutations: %+v", profiles)
	}
}

func newStyleProfileTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.StyleProfile{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db))
}

func styleProfileTestRequest(t *testing.T, title string, revision int) StyleProfileRequest {
	t.Helper()
	document := StyleProfileDocument{
		SchemaVersion: 1, PresetID: "client-controlled-id", Title: title, Description: "Reusable styles",
		Tags: []string{"Zhiwei", "dark color"}, Prompt: "Uniform use of meticulous lines, dark mineral colors and restrained light and shadow.", NegativePrompt: "Media drift and random text are prohibited.",
		Selection: map[string]string{"world": "Oriental Legend", "medium": "Gongbi dark color"},
		Assets: []StyleProfileAsset{{
			ID: "license-snapshot", Kind: "prompt", Provider: "manual", Title: "Material constraints", PromptFragment: "Mineral color and rice paper texture", Status: "validated",
			License: &StyleProfileAssetLicense{Note: "Source records need to be kept", Source: "internal regulations"},
		}},
		ExecutionPolicy: "compatible-fallback", Source: "external", Revision: revision,
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return StyleProfileRequest{ProfileJSON: string(encoded)}
}
