package operations

import (
	"encoding/json"
	"testing"
)

type filterGetOnly struct{}

func (*filterGetOnly) Allows(*Op, json.RawMessage) error { return nil }

func (*filterGetOnly) Visible(op *Op) bool {
	return op != nil && op.ID == "canvas.get"
}

func TestTypedNilAuthorizerDoesNotFilterOwnerCatalog(t *testing.T) {
	var typedNil *filterGetOnly
	var scope Authorizer = typedNil
	registry := NewRegistry(nil, nil)
	RegisterDefaultOps(registry)

	listed := registry.List(Caller{Kind: CallerManual, Scope: scope})
	if len(listed) != 44 {
		t.Fatalf("The empty range with type should not narrow the owner directory, getting %d: %v", len(listed), descriptorIDs(listed))
	}
	if !containsOp(listed, "conversation.message.attach") {
		t.Fatalf("The owner should see the message binding: %v", descriptorIDs(listed))
	}
	if !containsOp(listed, "canvas.document.commit") || !containsOp(listed, "canvas.create") {
		t.Fatalf("The owner should see the document submitted with the new canvas: %v", descriptorIDs(listed))
	}
	if !containsOp(listed, "asset.list") || !containsOp(listed, "canvas.search") {
		t.Fatalf("The owner should see the workspace level action: %v", descriptorIDs(listed))
	}

	restricted := registry.List(Caller{Kind: CallerAssistant, Scope: &filterGetOnly{}})
	if len(restricted) != 1 || restricted[0].ID != "canvas.get" {
		t.Fatalf("The true range should still be filtered: %v", descriptorIDs(restricted))
	}

	external := registry.List(ExternalCaller(false))
	if len(external) != 44 {
		t.Fatalf("External callers should see the full directory %d: %v", len(external), descriptorIDs(external))
	}
	for _, descriptor := range external {
		if !descriptor.ReadOnly && !jsonContainsOp(descriptor.Params, "operationId") {
			t.Fatalf("The external write operation schema must have operationId: %s", descriptor.ID)
		}
		if descriptor.ID == "canvas.generation.propose" && !descriptor.ReadOnly {
			t.Fatal("Paid proposals must be read-only operations")
		}
	}
}

func descriptorIDs(items []Descriptor) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.ID)
	}
	return out
}

func containsOp(items []Descriptor, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func jsonContainsOp(raw json.RawMessage, needle string) bool {
	return len(raw) > 0 && string(raw) != "" && (func() bool {
		body := string(raw)
		for i := 0; i+len(needle) <= len(body); i++ {
			if body[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
