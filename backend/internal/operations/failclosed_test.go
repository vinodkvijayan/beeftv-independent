package operations

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/database"
)

func TestNilStoreFailsClosedWithoutPanic(t *testing.T) {
	fn := func(tx *gorm.DB) ([]byte, error) {
		t.Fatal("Unavailable stores must not perform business")
		return nil, nil
	}
	for _, store := range []*Store{nil, NewStore(nil)} {
		if store.Available() {
			t.Fatal("Empty store must not be available")
		}
		if _, err := store.Run(context.Background(), RunRequest{Op: "canvas.get"}, fn); err == nil {
			t.Fatal("Read-only paths must also fail to close")
		} else if AsError(err).Reason != "op_store_unavailable" {
			t.Fatalf("Read-only failure reason: %v", err)
		}
		if _, err := store.Run(context.Background(), RunRequest{OpID: "op-1", Op: "canvas.nodes.create"}, fn); err == nil {
			t.Fatal("The write path must fail to close")
		} else if AsError(err).Reason != "op_store_unavailable" {
			t.Fatalf("Reason for write failure: %v", err)
		}
	}
}

type nilDomainBinder struct{}

func (nilDomainBinder) BindDomain(*gorm.DB) Domain { return nil }

func TestMissingDomainBinderFailsClosed(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "failclosed.db")),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	store := NewStore(db)
	fn := func(domain Domain) ([]byte, error) {
		t.Fatal("Handler must not be executed without Domain")
		return nil, nil
	}
	if _, err := store.RunDomain(context.Background(), RunRequest{Op: "canvas.get"}, nil, fn); err == nil {
		t.Fatal("nil binder must fail")
	} else if AsError(err).Reason != "op_domain_unavailable" {
		t.Fatalf("nil binder reason: %v", err)
	}
	if _, err := store.RunDomain(context.Background(), RunRequest{Op: "canvas.get"}, nilDomainBinder{}, fn); err == nil {
		t.Fatal("BindDomain returns nil and must fail")
	} else if AsError(err).Reason != "op_domain_unavailable" {
		t.Fatalf("nil domain reason: %v", err)
	}
}

func TestAssistantWithoutScopeFailsClosed(t *testing.T) {
	registry := NewRegistry(nil, nil)
	RegisterDefaultOps(registry)
	listed := registry.List(AssistantCaller(nil, false))
	if len(listed) != 0 {
		t.Fatalf("Capability discovery must be empty when assistant lacks scope, resulting in %v", descriptorIDs(listed))
	}
	var typedNil *filterGetOnly
	listed = registry.List(Caller{Kind: CallerAssistant, Scope: typedNil})
	if len(listed) != 0 {
		t.Fatalf("Assistant with type empty range cannot fall back to manual capability: %v", descriptorIDs(listed))
	}
	_, err := registry.Execute(Request{
		Op: "canvas.get", UserID: "local", Caller: AssistantCaller(nil, false),
		Params: json.RawMessage(`{"canvasId":"c"}`),
	})
	if err == nil {
		t.Fatal("Execution must reject when helper is missing scope")
	}
	if got := AsError(err); got.Code != CodePermissionDenied || got.Reason != "missing_assistant_scope" {
		t.Fatalf("Missing range rejection reason: %v", err)
	}
}

func TestUnknownCallerKindFailsClosed(t *testing.T) {
	registry := NewRegistry(nil, nil)
	RegisterDefaultOps(registry)
	unknown := Caller{Kind: "forged"}
	if len(registry.List(unknown)) != 0 {
		t.Fatal("Unknown identities are not allowed to be discovered.")
	}
	_, err := registry.Execute(Request{
		Op: "canvas.get", UserID: "local", Caller: unknown,
		Params: json.RawMessage(`{"canvasId":"c"}`),
	})
	if got := AsError(err); got.Code != CodePermissionDenied || got.Reason != "unknown_caller" {
		t.Fatalf("Unknown identity execution reason: %v", err)
	}
}

func TestEmptyAssistantScopeStillDiscoversRestrictedSet(t *testing.T) {
	registry := NewRegistry(nil, nil)
	RegisterDefaultOps(registry)
	listed := registry.List(AssistantCaller(&filterGetOnly{}, false))
	if len(listed) != 1 || listed[0].ID != "canvas.get" {
		t.Fatalf("Explicit empty adapters should be narrowed by Visible: %v", descriptorIDs(listed))
	}
}
