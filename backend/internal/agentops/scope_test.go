package agentops_test

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/operations"
)

// 内置助手的范围裁决：当前画布可读写，显式引用/画布关联的素材与任务只读，
// 额外画布只读，跨画布写一律拒绝。模型自报的参数无法越过这里。
func TestAssistantScopeAllowsOnlyVerifiedResources(t *testing.T) {
	scope := &agentops.AssistantScope{
		CanvasID:  "canvas-a",
		AssetIDs:  map[string]bool{"asset-ref": true},
		CanvasIDs: map[string]bool{"canvas-b": true},
		TaskIDs:   map[string]bool{"task-1": true},
	}
	cases := []struct {
		name   string
		op     string
		params string
		denied bool
	}{
		{"The current canvas is readable", "canvas.get", `{"canvasId":"canvas-a"}`, false},
		{"Explicitly referenced canvases are readable", "canvas.get", `{"canvasId":"canvas-b"}`, false},
		{"Unreferenced canvas is not readable", "canvas.get", `{"canvasId":"canvas-c"}`, true},
		{"The current canvas is writable", "canvas.nodes.create", `{"canvasId":"canvas-a"}`, false},
		{"Extra canvas is not writable", "canvas.nodes.create", `{"canvasId":"canvas-b"}`, true},
		{"The current storyboard can be added", "canvas.script.rows.append", `{"canvasId":"canvas-a"}`, false},
		{"Additional storyboards cannot be added", "canvas.script.rows.append", `{"canvasId":"canvas-b"}`, true},
		{"Additional storyboards cannot be modified", "canvas.script.row.update", `{"canvasId":"canvas-b"}`, true},
		{"Extra storyboards cannot be deleted", "canvas.script.row.remove", `{"canvasId":"canvas-b"}`, true},
		{"The current timeline is writable", "canvas.timeline.update", `{"canvasId":"canvas-a"}`, false},
		{"Extra timeline is not writable", "canvas.timeline.update", `{"canvasId":"canvas-b"}`, true},
		{"Reference material is readable", "asset.get", `{"assetId":"asset-ref"}`, false},
		{"Unquoted material is unreadable", "asset.get", `{"assetId":"asset-other"}`, true},
		{"The current node media can be checked", "media.overview", `{"canvasId":"canvas-a","nodeId":"node-a"}`, false},
		{"Related material media can be checked", "media.check", `{"canvasId":"canvas-a","assetId":"asset-ref"}`, false},
		{"Uncited media cannot be checked", "media.inspect", `{"canvasId":"canvas-a","assetId":"asset-other"}`, true},
		{"Extra canvas media is not checkable", "media.overview", `{"canvasId":"canvas-b","nodeId":"node-b"}`, true},
		{"The current node can be entrusted with film review", "media.review", `{"canvasId":"canvas-a","nodeId":"node-a"}`, false},
		{"Related materials can be commissioned for review", "media.review", `{"canvasId":"canvas-a","assetId":"asset-ref"}`, false},
		{"Unquoted material cannot be commissioned for film review", "media.review", `{"canvasId":"canvas-a","assetId":"asset-other"}`, true},
		{"Additional canvases cannot be commissioned for review", "media.review", `{"canvasId":"canvas-b","nodeId":"node-b"}`, true},
		{"The source of film review cannot be ambiguous", "media.review", `{"canvasId":"canvas-a","nodeId":"node-a","assetId":"asset-ref"}`, true},
		{"The source of review is indispensable", "media.review", `{"canvasId":"canvas-a"}`, true},
		{"Associated tasks are readable", "task.get", `{"taskId":"task-1"}`, false},
		{"Unable to read for unrelated tasks", "task.get", `{"taskId":"task-2"}`, true},
		{"Workspace level enumeration is not available", "asset.list", `{}`, true},
		{"Full page document submission is not available", "canvas.document.commit", `{"canvasId":"canvas-a"}`, true},
		{"External new canvas is not available for built-in helpers", "canvas.create", `{"title":"x"}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := scope.Allows(registeredScopeOp(t, tc.op), json.RawMessage(tc.params))
			if tc.denied {
				if err == nil {
					t.Fatal("Out-of-bounds calls must be rejected")
				}
				if opErr := agentops.AsError(err); opErr.Code != agentops.CodePermissionDenied || opErr.Reason != "scope_denied" {
					t.Fatalf("Denied reason should be permission_denied/scope_denied, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Calls within the range should not be rejected: %v", err)
			}
		})
	}
}

func registeredScopeOp(t *testing.T, id string) *agentops.Op {
	t.Helper()
	registry := operations.NewRegistry(nil, nil)
	operations.RegisterDefaultOps(registry)
	descriptor, ok := registry.Descriptor(id)
	if !ok {
		t.Fatalf("unregistered operation %s", id)
	}
	op := &agentops.Op{ID: id, ReadOnly: descriptor.ReadOnly, Scope: descriptor.Scope}
	hasReadOnly := false
	for _, mode := range descriptor.AssistantModes {
		if mode == "canvas" {
			op.AssistantCanvas = true
		}
		if mode == "read-only" {
			hasReadOnly = true
		}
	}
	if len(descriptor.AssistantModes) == 0 && descriptor.Scope != operations.ScopeConversation {
		op.ExternalOnly = true
	}
	if descriptor.ReadOnly && !hasReadOnly {
		op.AssistantProposal = true
	}
	return op
}

// 没有绑定画布的空范围（宿主在回合之外做能力发现时）不允许执行任何操作。
func TestEmptyAssistantScopeDeniesExecution(t *testing.T) {
	scope := &agentops.AssistantScope{}
	if err := scope.Allows(&agentops.Op{ID: "canvas.get"}, json.RawMessage(`{"canvasId":"canvas-a"}`)); err == nil {
		t.Fatal("An empty scope should not allow any execution")
	}
}

// 能力发现的可见集合是真实过滤：不因调用方是助手就暴露工作区级操作。
func TestAssistantVisibleSetExcludesWorkspaceWideOps(t *testing.T) {
	registry := agentops.NewRegistry(nil, nil)
	agentops.RegisterDefaultOps(registry)
	visible := map[string]bool{}
	for _, descriptor := range registry.List(agentops.AssistantCaller(&agentops.AssistantScope{}, false)) {
		visible[descriptor.ID] = true
	}
	for _, id := range []string{"canvas.get", "canvas.node.update", "canvas.nodes.create", "canvas.edge.create",
		"canvas.generation.propose", "canvas.task.bind", "asset.get", "task.get"} {
		if !visible[id] {
			t.Fatalf("The assistant should see %s: %v", id, visible)
		}
	}
	for _, id := range []string{"asset.list", "canvas.search", "canvas.create", "canvas.document.commit", "conversation.message.attach"} {
		if visible[id] {
			t.Fatalf("Workspace level or full page write operation %s should not be exposed to the assistant", id)
		}
	}
	// 外部客户端（不带助手范围）仍然能看到完整工作区能力。
	full := registry.List(agentops.Caller{})
	if len(full) <= len(visible) {
		t.Fatalf("External clients should see the full capability set: %d <= %d", len(full), len(visible))
	}
}

func TestNilAssistantScopeDoesNotFilterCatalog(t *testing.T) {
	registry := agentops.NewRegistry(nil, nil)
	agentops.RegisterDefaultOps(registry)
	var typedNil *agentops.AssistantScope
	listed := registry.List(agentops.Caller{Kind: agentops.CallerManual, Scope: typedNil})
	if len(listed) != 44 {
		t.Fatalf("The null pointer range should not narrow the directory, getting %d", len(listed))
	}
	empty := registry.List(agentops.AssistantCaller(&agentops.AssistantScope{}, false))
	if len(empty) != 38 {
		t.Fatalf("An empty helper scope should only expose the helper collection, getting %d", len(empty))
	}
	if got := registry.List(agentops.AssistantCaller(nil, false)); len(got) != 0 {
		t.Fatalf("Capability discovery must be empty when assistant lacks scope, resulting in %d", len(got))
	}
}

func TestReferenceBindingCatalogPermissionModes(t *testing.T) {
	registry := agentops.NewRegistry(nil, nil)
	agentops.RegisterDefaultOps(registry)
	for mode, want := range map[string]int{"read-only": 20, "canvas": 38, "full-access": 42} {
		descriptors := registry.List(agentops.AssistantCaller(&agentops.AssistantScope{PermissionMode: mode}, false))
		if len(descriptors) != want {
			t.Fatalf("%s catalog=%d want=%d", mode, len(descriptors), want)
		}
		bound := false
		for _, d := range descriptors {
			if d.ID == "canvas.node.bind_asset" {
				bound = true
			}
		}
		if bound != (mode != "read-only") {
			t.Fatalf("%s binding visibility=%v", mode, bound)
		}
	}
}
