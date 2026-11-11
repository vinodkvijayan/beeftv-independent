package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type businessTool struct {
	ID                string         `json:"id"`
	Summary           string         `json:"summary"`
	Method            string         `json:"method"`
	Path              string         `json:"path"`
	ReadOnly          bool           `json:"readOnly"`
	SubmitsGeneration bool           `json:"submitsGeneration"`
	Cost              string         `json:"cost,omitempty"`
	Params            map[string]any `json:"params"`
}
type businessArgs struct {
	Path        map[string]string `json:"path"`
	Query       map[string]string `json:"query"`
	Body        json.RawMessage   `json:"body"`
	FilePath    string            `json:"filePath"`
	OperationID string            `json:"operationId"`
	File        *struct {
		Name     string `json:"name"`
		MimeType string `json:"mimeType"`
		Data     string `json:"data"`
	} `json:"file"`
}

func (c *client) businessTools(ctx context.Context) ([]businessTool, error) {
	raw, err := c.do(ctx, "GET", "/business/tools", nil)
	if err != nil {
		return nil, err
	}
	var data struct {
		Tools []businessTool `json:"tools"`
	}
	err = json.Unmarshal(raw, &data)
	return data.Tools, err
}
func (c *client) callBusiness(ctx context.Context, tool businessTool, args businessArgs) (json.RawMessage, error) {
	path := tool.Path
	for _, segment := range strings.Split(path, "/") {
		if strings.HasPrefix(segment, ":") {
			key := segment[1:]
			value := args.Path[key]
			if value == "" || value == "." || value == ".." || strings.ContainsAny(value, "/\\%?#") {
				return nil, fmt.Errorf("invalid path parameter %s", key)
			}
			path = strings.ReplaceAll(path, segment, url.PathEscape(value))
		}
	}
	query := url.Values{}
	for k, v := range args.Query {
		query.Set(k, v)
	}
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if tool.Method == http.MethodPost && tool.Path == "/tasks" && args.OperationID != "" {
		body, err := withTaskClientOperationID(args.Body, args.OperationID)
		if err != nil {
			return nil, err
		}
		args.Body = body
	}
	var reader io.Reader = bytes.NewReader(args.Body)
	contentType := "application/json"
	if args.FilePath != "" || args.File != nil {
		if args.FilePath != "" && args.File != nil {
			return nil, fmt.Errorf("provide filePath or file, not both")
		}
		chunk := tool.Method == "PUT" && strings.HasPrefix(tool.Path, "/resources/uploads/") && strings.Contains(tool.Path, "/chunks/")
		if !(tool.Method == "POST" && (tool.Path == "/resources" || tool.Path == "/skills/install" || tool.Path == "/plugins")) && !chunk {
			return nil, fmt.Errorf("this handler does not accept file uploads")
		}
		var data []byte
		var name string
		var err error
		if args.FilePath != "" {
			f, e := os.Open(args.FilePath)
			if e != nil {
				return nil, e
			}
			defer f.Close()
			data, err = io.ReadAll(io.LimitReader(f, 64<<20+1))
			name = filepath.Base(args.FilePath)
		} else {
			data, err = base64.StdEncoding.DecodeString(args.File.Data)
			name = filepath.Base(args.File.Name)
		}
		if err != nil {
			return nil, err
		}
		if len(data) > 64<<20 {
			return nil, fmt.Errorf("upload exceeds 64 MiB; use chunked resource upload")
		}
		if name == "." || name == "" {
			return nil, fmt.Errorf("file name is required")
		}
		if chunk {
			reader = bytes.NewReader(data)
			contentType = "application/octet-stream"
		} else {
			var buffer bytes.Buffer
			writer := multipart.NewWriter(&buffer)
			part, e := writer.CreateFormFile("file", name)
			if e != nil {
				return nil, e
			}
			if _, e = part.Write(data); e != nil {
				return nil, e
			}
			fields := map[string]any{}
			if len(args.Body) > 0 {
				if e = json.Unmarshal(args.Body, &fields); e != nil {
					return nil, e
				}
			}
			for key, value := range fields {
				if e = writer.WriteField(key, fmt.Sprint(value)); e != nil {
					return nil, e
				}
			}
			if e = writer.Close(); e != nil {
				return nil, e
			}
			reader = &buffer
			contentType = writer.FormDataContentType()
		}
	}
	base := c.currentBaseURL()
	if base == "" {
		return nil, &cliError{code: exitTransportFailure, reason: "runtime_not_found", msg: "No running BeefTV workspace found, please open BeefTV first"}
	}
	req, err := http.NewRequestWithContext(ctx, tool.Method, base+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Beeftv-Client", c.clientID)
	req.Header.Set("Authorization", "Bearer "+c.token)
	if c.ownerToken != "" {
		req.Header.Set("X-Beeftv-Owner", c.ownerToken)
	}
	if c.desktopToken != "" {
		req.Header.Set("X-Desktop-Token", c.desktopToken)
	}
	if args.OperationID != "" {
		req.Header.Set("X-Idempotency-Key", args.OperationID)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<20+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 64<<20 {
		return nil, fmt.Errorf("response exceeds 64 MiB")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Reason  string         `json:"reason"`
			Msg     string         `json:"msg"`
			Details map[string]any `json:"details"`
		}
		_ = json.Unmarshal(raw, &failure)
		return nil, mapEnvelopeError(response.StatusCode, failure.Reason, failure.Msg, failure.Details)
	}
	if !strings.Contains(response.Header.Get("Content-Type"), "application/json") {
		return json.Marshal(map[string]any{"mimeType": response.Header.Get("Content-Type"), "data": base64.StdEncoding.EncodeToString(raw)})
	}
	var envelope struct {
		Code   int             `json:"code"`
		Data   json.RawMessage `json:"data"`
		Reason string          `json:"reason"`
		Msg    string          `json:"msg"`
	}
	if err = json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	if envelope.Code != 0 {
		return nil, mapEnvelopeError(envelope.Code, envelope.Reason, envelope.Msg, nil)
	}
	return envelope.Data, nil
}

func runBusiness(c *client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("business requires discover, call or upload")
	}
	fs := flag.NewFlagSet("business "+args[0], flag.ContinueOnError)
	id := fs.String("tool", "", "discovered business tool ID")
	params := fs.String("params", "{}", "JSON path/query/body/file parameters")
	file := fs.String("file", "", "local file to upload; read by CLI, never server")
	target := fs.String("target", "resource", "resource, skill or plugin")
	operationID := fs.String("operation-id", "", "stable idempotency key; reuse the same value when retrying (required when submitting paid generation)")
	_ = fs.Bool("json", true, "JSON output")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	tools, err := c.businessTools(context.Background())
	if err != nil {
		return err
	}
	if args[0] == "discover" {
		return emitJSON(tools)
	}
	var input businessArgs
	if err = json.Unmarshal([]byte(*params), &input); err != nil {
		return err
	}
	if flagID := strings.TrimSpace(*operationID); flagID != "" {
		if input.OperationID != "" && input.OperationID != flagID {
			return &cliError{code: exitBadRequest, reason: "operation_id_conflict", msg: "--operation-id is inconsistent with the operationId in --params"}
		}
		input.OperationID = flagID
	}
	if args[0] == "upload" {
		if *file == "" {
			return fmt.Errorf("--file is required")
		}
		input.FilePath = *file
		switch *target {
		case "resource":
			*id = "business_post_resources"
		case "skill":
			*id = "business_post_skills_install"
		case "plugin":
			*id = "business_post_plugins"
		default:
			return fmt.Errorf("unknown upload target")
		}
	} else if args[0] != "call" {
		return fmt.Errorf("unknown business subcommand")
	}
	for _, tool := range tools {
		if tool.ID == *id {
			// Scripts may upload or edit without a key, but a paid submission
			// retried without one would create and charge a second task.
			if tool.SubmitsGeneration && strings.TrimSpace(input.OperationID) == "" {
				return &cliError{code: exitBadRequest, reason: "missing_operation_id", msg: "Fees will be deducted when submitting the generation. You must use --operation-id to provide an idempotent key. The same value will be reused when retrying."}
			}
			result, err := c.callBusiness(context.Background(), tool, input)
			if err != nil {
				return err
			}
			return emitJSON(result)
		}
	}
	return fmt.Errorf("unknown business tool %q; run business discover", *id)
}
func runOpsCall(c *client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("ops call requires an operation ID")
	}
	operation := args[0]
	fs := flag.NewFlagSet("ops call", flag.ContinueOnError)
	params := fs.String("params", "{}", "operation JSON parameters")
	key := fs.String("operation-id", "", "stable write idempotency key")
	_ = fs.Bool("json", true, "JSON output")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if !json.Valid([]byte(*params)) {
		return fmt.Errorf("invalid JSON params")
	}
	result, err := c.callOp(operation, *key, json.RawMessage(*params))
	if err != nil {
		return err
	}
	return emitJSON(result)
}
func registerBusinessMCP(server *mcp.Server, c *client, tools []businessTool, readOnly bool) {
	for _, tool := range tools {
		descriptor := tool
		if readOnly && !tool.ReadOnly {
			continue
		}
		properties, _ := descriptor.Params["properties"].(map[string]any)
		_, acceptsFile := properties["file"]
		if acceptsFile || descriptor.Method == "PUT" && strings.HasPrefix(descriptor.Path, "/resources/uploads/") && strings.Contains(descriptor.Path, "/chunks/") {
			properties["filePath"] = map[string]any{"type": "string", "description": "Local file read by this external CLI, subject to the external agent's filesystem approval"}
		}
		properties["operationId"] = map[string]any{"type": "string", "description": "Stable idempotency key where supported by the business handler"}
		server.AddTool(&mcp.Tool{Name: descriptor.ID, Description: descriptor.Summary, InputSchema: descriptor.Params, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: descriptor.ReadOnly}}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			if request == nil || request.Params == nil {
				return toolError(fmt.Errorf("missing tool arguments")), nil
			}
			var args businessArgs
			raw, err := json.Marshal(request.Params.Arguments)
			if err == nil {
				err = json.Unmarshal(raw, &args)
			}
			if err != nil {
				return toolError(err), nil
			}
			if err := requireBusinessOperationID(descriptor, args); err != nil {
				return toolError(err), nil
			}
			data, err := c.callBusiness(ctx, descriptor, args)
			if err != nil {
				return toolError(err), nil
			}
			return &mcp.CallToolResult{Content: businessToolContent(data)}, nil
		})
	}
}

// requireBusinessOperationID matches the workspace operations: every MCP write
// carries a stable idempotency key so a retried call is not executed twice.
func requireBusinessOperationID(tool businessTool, args businessArgs) error {
	if tool.ReadOnly || strings.TrimSpace(args.OperationID) != "" {
		return nil
	}
	return &cliError{code: exitBadRequest, reason: "missing_operation_id", msg: "The write interface must provide the operationId in the parameter and reuse the same value when retrying."}
}

// businessToolContent returns image and audio file responses as MCP content
// blocks. callBusiness wraps non-JSON bodies as {"mimeType","data"}; left as
// text the client cannot see the picture and the bytes fill its context.
func businessToolContent(data json.RawMessage) []mcp.Content {
	plain := []mcp.Content{&mcp.TextContent{Text: string(data)}}
	var file struct {
		MimeType string `json:"mimeType"`
		Data     string `json:"data"`
	}
	if json.Unmarshal(data, &file) != nil || file.Data == "" {
		return plain
	}
	isImage, isAudio := strings.HasPrefix(file.MimeType, "image/"), strings.HasPrefix(file.MimeType, "audio/")
	if !isImage && !isAudio {
		return plain
	}
	decoded, err := base64.StdEncoding.DecodeString(file.Data)
	if err != nil || len(decoded) == 0 {
		return plain
	}
	facts, _ := json.Marshal(map[string]any{"mimeType": file.MimeType, "bytes": len(decoded)})
	block := mcp.Content(&mcp.ImageContent{Data: decoded, MIMEType: file.MimeType})
	if isAudio {
		block = &mcp.AudioContent{Data: decoded, MIMEType: file.MimeType}
	}
	return []mcp.Content{&mcp.TextContent{Text: string(facts)}, block}
}

// registerBusinessGateway exposes the auto-generated business handlers through
// two tools instead of one tool per route. One tool per route listed ~170 tools
// whose descriptions were mostly "METHOD /path", which filled external agents'
// context and made them pick the wrong tool. The handlers and their permission
// checks are unchanged; business.call dispatches to the same callBusiness.
// It returns how many tools were registered (0 when no handler is discovered).
func registerBusinessGateway(server *mcp.Server, c *client, tools []businessTool, readOnly bool) int {
	byID := map[string]businessTool{}
	for _, tool := range tools {
		if readOnly && !tool.ReadOnly {
			continue
		}
		byID[tool.ID] = tool
	}
	if len(byID) == 0 {
		return 0
	}
	listSchema := map[string]any{"type": "object", "properties": map[string]any{
		"query":    map[string]any{"type": "string", "description": "Filter by ID, description or keywords in the path, such as assets, folders, timeline"},
		"readOnly": map[string]any{"type": "boolean", "description": "true only lists read-only interfaces, false only lists write-only interfaces; do not fill in all"},
	}, "additionalProperties": false}
	server.AddTool(&mcp.Tool{Name: "business.list", Description: "List the underlying business interfaces of the BeefTV local workspace (material library, folders, projects, tasks, timelines, settings, etc.) and return the interface ID, description, method, path and parameter structure. There are special tools for canvas, material, media, and skill operations. If they are not covered, use here to find the interface, and then use business.call to call it.", InputSchema: listSchema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}},
		func(_ context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			var filter struct {
				Query    string `json:"query"`
				ReadOnly *bool  `json:"readOnly"`
			}
			if request != nil && request.Params != nil && request.Params.Arguments != nil {
				if raw, err := json.Marshal(request.Params.Arguments); err == nil {
					_ = json.Unmarshal(raw, &filter)
				}
			}
			query := strings.ToLower(strings.TrimSpace(filter.Query))
			matched := make([]businessTool, 0, len(byID))
			for _, tool := range tools {
				if _, ok := byID[tool.ID]; !ok {
					continue
				}
				if filter.ReadOnly != nil && tool.ReadOnly != *filter.ReadOnly {
					continue
				}
				if query != "" && !strings.Contains(strings.ToLower(tool.ID+" "+tool.Summary+" "+tool.Path), query) {
					continue
				}
				matched = append(matched, tool)
			}
			encoded, err := json.Marshal(map[string]any{"tools": matched, "count": len(matched)})
			if err != nil {
				return toolError(err), nil
			}
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(encoded)}}}, nil
		})
	callSchema := map[string]any{"type": "object", "properties": map[string]any{
		"tool":     map[string]any{"type": "string", "description": "The interface ID returned by business.list"},
		"path":     map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "Path parameters, such as {\"id\": \"...\"}"},
		"query":    map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
		"body":     map[string]any{"description": "JSON request body"},
		"filePath": map[string]any{"type": "string", "description": "The local file to be read by the upload interface is read by this command line and is subject to the file permissions of the external Agent."},
		"file": map[string]any{"type": "object", "description": "Directly transfer file content (base64), choose one from filePath", "properties": map[string]any{
			"name": map[string]any{"type": "string"}, "mimeType": map[string]any{"type": "string"}, "data": map[string]any{"type": "string", "description": "base64 encoded file content"},
		}, "required": []string{"name", "data"}},
		"operationId": map[string]any{"type": "string", "description": "Write the stable idempotent key (8-128 letters, numbers or :_-) required for the interface, reuse the same value when retrying the same operation; also serve as the clientOperationId of the task when submitting the generated task"},
	}, "required": []string{"tool"}, "additionalProperties": false}
	description := "Call business.list to find the underlying business interface. The writing interface must have an operationId; writing the interface will actually modify the workspace. Submitting the generated interface will be billed according to the selected channel, and you (the external caller) will confirm it with the user before execution."
	if readOnly {
		description = "The read-only underlying business interface found by calling business.list."
	}
	server.AddTool(&mcp.Tool{Name: "business.call", Description: description, InputSchema: callSchema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly}},
		func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			if request == nil || request.Params == nil {
				return toolError(fmt.Errorf("missing tool arguments")), nil
			}
			raw, err := json.Marshal(request.Params.Arguments)
			if err != nil {
				return toolError(err), nil
			}
			var call struct {
				Tool string `json:"tool"`
			}
			var args businessArgs
			if err = json.Unmarshal(raw, &call); err == nil {
				err = json.Unmarshal(raw, &args)
			}
			if err != nil {
				return toolError(err), nil
			}
			tool, ok := byID[strings.TrimSpace(call.Tool)]
			if !ok {
				return toolError(&cliError{code: exitNotFound, reason: "unknown_business_tool", msg: "If there is no such underlying interface, please use business.list to find it first:" + call.Tool}), nil
			}
			if err := requireBusinessOperationID(tool, args); err != nil {
				return toolError(err), nil
			}
			data, err := c.callBusiness(ctx, tool, args)
			if err != nil {
				return toolError(err), nil
			}
			return &mcp.CallToolResult{Content: businessToolContent(data)}, nil
		})
	return 2
}

// withTaskClientOperationID copies a caller's operationId into the field task
// creation actually deduplicates on (input.metadata.clientOperationId). The
// X-Idempotency-Key header alone is ignored by POST /tasks, so a retried paid
// submission would otherwise create a second task. An explicit value in the
// body wins; a different explicit value is rejected rather than overwritten.
func withTaskClientOperationID(body json.RawMessage, operationID string) (json.RawMessage, error) {
	invalid := &cliError{code: exitBadRequest, reason: "invalid_body", msg: "The body of the submitted task must be a JSON object, and input and input.metadata must also be objects."}
	var request map[string]any
	if trimmed := bytes.TrimSpace(body); len(trimmed) > 0 && json.Unmarshal(trimmed, &request) != nil {
		return nil, invalid
	}
	if request == nil {
		request = map[string]any{}
	}
	input, ok := objectField(request, "input")
	if !ok {
		return nil, invalid
	}
	metadata, ok := objectField(input, "metadata")
	if !ok {
		return nil, invalid
	}
	switch existing, _ := metadata["clientOperationId"].(string); {
	case existing == "":
		metadata["clientOperationId"] = operationID
	case existing != operationID:
		return nil, &cliError{code: exitBadRequest, reason: "operation_id_conflict", msg: "operationId is inconsistent with body.input.metadata.clientOperationId"}
	}
	input["metadata"] = metadata
	request["input"] = input
	return json.Marshal(request)
}

// objectField returns parent[key] as an object, creating it when absent or
// null; ok is false when the field holds something other than an object.
func objectField(parent map[string]any, key string) (map[string]any, bool) {
	switch value := parent[key].(type) {
	case nil:
		return map[string]any{}, true
	case map[string]any:
		return value, true
	default:
		return nil, false
	}
}
