package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"infinite-canvas/backend/internal/operations"
)

// TestMCPClientLoop 用官方 MCP 客户端连接 `beeftv mcp serve`，验证握手、工具描述、
// 幂等 operationId、冲突错误、只读工具与断开。
func TestMCPClientLoop(t *testing.T) {
	bin := os.Getenv("BEEFTV_BIN")
	if bin == "" {
		t.Skip("BEEFTV_BIN is not set, skip MCP client acceptance")
	}
	base := strings.TrimRight(os.Getenv("BEEFTV_BASE_URL"), "/")
	if base == "" {
		t.Fatal("BEEFTV_BASE_URL not set")
	}
	caseTag := fmt.Sprintf("%d", time.Now().UnixNano())
	canvasID := "mcp-canvas-" + caseTag
	// 幂等键必须每个 case 唯一：同一测试库重复跑时，不同 canvas 的 payload 不能复用同一个 operationId。
	operationID := "mcp-op-" + caseTag
	if err := seedCanvas(base, canvasID); err != nil {
		t.Fatalf("seed canvas: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "beeftv-acceptance-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.CommandTransport{Command: exec.Command(bin, "mcp", "serve")}, nil)
	if err != nil {
		t.Fatalf("MCP handshake failed: %v", err)
	}
	defer session.Close()
	if session.InitializeResult() == nil {
		t.Fatal("Missing initialize result")
	}
	t.Logf("Handshake successful: %s %s", session.InitializeResult().ServerInfo.Name, session.InitializeResult().ServerInfo.Version)

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("tools/list failed: %v", err)
	}
	registry := operations.NewRegistry(nil, nil)
	operations.RegisterDefaultOps(registry)
	excluded := map[string]bool{
		"conversation.message.attach": true,
		"skill.publish.prepare":       true,
		"skill.publish.status":        true,
		"skill.script.run":            true,
	}
	var expected []operations.Descriptor
	for _, op := range registry.List(operations.ManualCaller(false)) {
		if !excluded[op.ID] {
			expected = append(expected, op)
		}
	}
	if len(expected) != 40 {
		t.Fatalf("expected 40 default MCP operations, got %d", len(expected))
	}
	for _, tool := range tools.Tools {
		if excluded[tool.Name] {
			t.Fatalf("excluded operation %s leaked into default MCP tools", tool.Name)
		}
	}
	apiClient, clientErr := newClient()
	if clientErr != nil {
		t.Fatal(clientErr)
	}
	business, discoveryErr := apiClient.businessTools(ctx)
	if discoveryErr != nil {
		t.Fatal(discoveryErr)
	}
	// 底层业务接口默认只通过 business.list / business.call 两个入口暴露。
	gateway := 0
	if len(business) > 0 {
		gateway = 2
	}
	if len(tools.Tools) != len(expected)+gateway {
		t.Fatalf("MCP tools = %d, workspace operations = %d, business gateway = %d", len(tools.Tools), len(expected), gateway)
	}
	for _, operation := range expected {
		found := false
		for _, tool := range tools.Tools {
			if tool.Name == operation.ID {
				found = true
				if tool.Annotations == nil || tool.Annotations.ReadOnlyHint != operation.ReadOnly {
					t.Fatalf("MCP permission differs from workspace operation %s", operation.ID)
				}
			}
		}
		if !found {
			t.Fatalf("MCP omitted workspace operation %s", operation.ID)
		}
	}
	var create *mcp.Tool
	var sawPropose bool
	for _, tool := range tools.Tools {
		if tool.Name == "canvas.generation.propose" {
			sawPropose = true
			if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
				t.Fatal("generation propose must advertise readOnlyHint")
			}
		}
		if tool.Name == "canvas.get" && (tool.Annotations == nil || !tool.Annotations.ReadOnlyHint) {
			t.Fatal("read-only canvas.get must advertise readOnlyHint")
		}
		if tool.Name == "canvas.nodes.create" {
			if tool.Annotations != nil && tool.Annotations.ReadOnlyHint {
				t.Fatal("write tool advertised read-only")
			}
			create = tool
		}
	}
	if create == nil || !sawPropose {
		t.Fatal("Missing canvas.nodes.create or canvas.generation.propose")
	}
	schema, _ := json.Marshal(create.InputSchema)
	if !bytes.Contains(schema, []byte("operationId")) {
		t.Fatalf("The writing tool schema is not exposed. Stable operationId: %s", string(schema))
	}
	// 只出现在 properties 里不够：必须标成必填，MCP 客户端才知道非发不可。
	var declared struct {
		Properties map[string]any `json:"properties"`
		Required   []string       `json:"required"`
	}
	if err := json.Unmarshal(schema, &declared); err != nil {
		t.Fatalf("The writing tool schema is not a valid JSON Schema: %v", err)
	}
	if _, ok := declared.Properties["operationId"]; !ok {
		t.Fatalf("The properties of the writing tool schema are missing operationId: %s", string(schema))
	}
	requiresOperationID := false
	for _, name := range declared.Required {
		if name == "operationId" {
			requiresOperationID = true
		}
	}
	if !requiresOperationID {
		t.Fatalf("The writing tool schema does not mark the operationId as required: %s", string(schema))
	}

	// 1) 写工具缺 operationId：必须结构化失败，而不是随机补一个键
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "canvas.nodes.create",
		Arguments: map[string]any{"canvasId": canvasID, "expectedRevision": 1,
			"nodes": []any{map[string]any{"title": "A", "type": "image"}}}})
	if err != nil {
		t.Fatalf("CallTool transport layer error: %v", err)
	}
	if !result.IsError || !toolTextContains(result, "missing_operation_id") {
		t.Fatalf("Missing operationId No structured error returned: %+v", result)
	}

	// 2) 同 operationId 同参数：第二次必须回读原结果
	args := map[string]any{"canvasId": canvasID, "expectedRevision": 1,
		"nodes": []any{map[string]any{"title": "A", "type": "image"}}, "operationId": operationID}
	first, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "canvas.nodes.create", Arguments: args})
	if err != nil || first.IsError {
		t.Fatalf("First write failure: err=%v result=%+v", err, first)
	}
	second, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "canvas.nodes.create", Arguments: args})
	if err != nil || second.IsError {
		t.Fatalf("Retry writing failed: err=%v result=%+v", err, second)
	}
	if !toolTextContains(second, `"replayed":true`) {
		t.Fatalf("Retry with the same operationId and the original result is not read back: %s", toolText(second))
	}

	// 3) 同 operationId 不同参数：必须冲突
	conflict, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "canvas.nodes.create",
		Arguments: map[string]any{"canvasId": canvasID, "expectedRevision": 1,
			"nodes": []any{map[string]any{"title": "B", "type": "image"}}, "operationId": operationID}})
	if err != nil {
		t.Fatalf("Conflict call transport layer error: %v", err)
	}
	if !conflict.IsError || !toolTextContains(conflict, "operation_id_reused") {
		t.Fatalf("No conflict reported for different parameters with the same id: %s", toolText(conflict))
	}

	// 4) 只读工具：不需要 operationId
	read, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "canvas.get", Arguments: map[string]any{"canvasId": canvasID}})
	if err != nil || read.IsError {
		t.Fatalf("Read-only tool failed: err=%v result=%+v", err, read)
	}
	if !toolTextContains(read, canvasID) {
		t.Fatalf("Read-only tool did not return canvas content: %s", toolText(read))
	}
	if err := session.Close(); err != nil {
		t.Fatalf("Failed to close session: %v", err)
	}
	t.Log("MCP client acceptance completed: handshake/tool schema/idempotent/conflict/read-only/disconnect")
}

func toolText(result *mcp.CallToolResult) string {
	var builder strings.Builder
	for _, content := range result.Content {
		if text, ok := content.(*mcp.TextContent); ok {
			builder.WriteString(text.Text)
		}
	}
	return builder.String()
}

func toolTextContains(result *mcp.CallToolResult, needle string) bool {
	return strings.Contains(toolText(result), needle)
}

func seedCanvas(base, canvasID string) error {
	body, err := json.Marshal(map[string]any{"project": map[string]any{
		"id": canvasID, "title": "MCP Acceptance Canvas", "revision": 0, "nodes": []any{}, "connections": []any{}}})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPut, base+"/canvas-projects/"+canvasID, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if owner := strings.TrimSpace(os.Getenv("BEEFTV_OWNER_TOKEN")); owner != "" {
		req.Header.Set("X-Beeftv-Owner", owner)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("seed status code %d", resp.StatusCode)
	}
	return nil
}
