package protocol

import (
	"embed"
	"fmt"
	"strings"
)

//go:embed docs/*.md
var builtinDocumentationFS embed.FS

func attachDocumentation(info *Metadata) {
	if info == nil || strings.TrimSpace(info.Documentation) != "" {
		return
	}
	document, err := builtinDocumentationFS.ReadFile("docs/" + info.ID + ".md")
	if err != nil {
		return
	}
	info.Documentation = renderBuiltinDocumentation(*info, string(document))
}

// AttachDocumentation fills the reference document for a shipped protocol.
func AttachDocumentation(info *Metadata) {
	attachDocumentation(info)
}

func renderBuiltinDocumentation(info Metadata, document string) string {
	replacements := map[string]string{
		"{{NAME}}":       info.Name,
		"{{OPERATIONS}}": renderOperations(info),
		"{{PARAMETERS}}": renderParameters(info.Parameters),
		"{{CONTRACT}}":   renderRuntimeContract(info),
	}
	for marker, replacement := range replacements {
		document = strings.ReplaceAll(document, marker, replacement)
	}
	return strings.TrimSpace(document) + "\n"
}

func renderOperations(info Metadata) string {
	var b strings.Builder
	b.WriteString("| Phases | Methods and Relative Paths | Request Types | Host Behavior |\n| --- | --- | --- | --- |")
	writeOperation(&b, "Create", info.Create, firstNonEmpty(info.ContentType, "application/json"), "Submit the request; the synchronous protocol directly parses the result, and the asynchronous protocol reads the task ID.")
	if strings.TrimSpace(info.Poll) != "" {
		writeOperation(&b, "polling", info.Poll, "application/json", "Query the status and extract the media address after success.")
	}
	if strings.TrimSpace(info.Cancel) != "" {
		writeOperation(&b, "Cancel", info.Cancel, "application/json", "Cancel a task that is still running")
	}
	return strings.TrimSpace(b.String())
}

func renderParameters(parameters []Parameter) string {
	if len(parameters) == 0 {
		return "> The current adapter does not declare configurable parameters; this does not mean that the upstream has no parameters, it just means that the host has not established a stable mapping."
	}
	var b strings.Builder
	b.WriteString("| Host Fields | Type | Required | Actual Upstream Mapping | Description |\n| --- | --- | --- | --- | --- |")
	for _, parameter := range parameters {
		description := strings.TrimSpace(parameter.Description)
		if len(parameter.Values) > 0 {
			description = strings.TrimSpace(description + " Optional values:" + strings.Join(parameter.Values, "、") + "。")
		}
		fmt.Fprintf(&b, "| `%s` | `%s` | %s | `%s` | %s |\n", markdownCell(parameter.Name), markdownCell(parameter.Type), yesNo(parameter.Required), markdownCell(firstNonEmpty(parameter.Mapping, "Not mapped")), markdownCell(firstNonEmpty(description, "Converted by the current protocol adapter on request type.")))
	}
	return strings.TrimSpace(b.String())
}

func renderRuntimeContract(info Metadata) string {
	var b strings.Builder
	b.WriteString("## Host runtime contract")
	b.WriteString("- The Base URL only fills in the protocol service root address, and the relative paths in the table are spliced by the adapter; do not write the same path into the Base URL repeatedly.")
	b.WriteString("- The key is read by the backend channel, and the plug-in details and browser requests do not save the key. Bearer, supplier signature or special version header shall be subject to the authentication section of this article.")
	b.WriteString("- The model name comes from the channel model configuration and is sent as is. This plug-in does not secretly change the model name, nor does it guess the price, quota or capabilities based on the name.")
	b.WriteString("- HTTP non-2xx, non-JSON responses, missing task IDs, success status without identifiable results are all returned as true errors.")
	if strings.TrimSpace(info.Poll) != "" {
		b.WriteString("- The asynchronous status is unified as: `queued/pending/created/submitted` -> waiting, `running/processing/in_progress` -> processing, `succeeded/completed/done` -> successful, `failed/error/expired/cancelled` -> failed.")
		b.WriteString("- The polling frequency should comply with the upstream rate limit; media URLs usually have a validity period and should immediately enter the host resource saving process upon success.")
	}
	b.WriteString("- Reference material only accepts upstream-reachable HTTP(S) URLs or MIME-prefixed data URLs; bare Base64, login-only links, and cookie-protected addresses are not available.")
	b.WriteString("- Plugins only guarantee fields explicitly listed in \"Current Implementation\" below. New capabilities added upstream will not automatically receive host support and must be adapted, parsed, and tested.")
	return strings.TrimSpace(b.String())
}

func writeOperation(b *strings.Builder, phase, value, contentType, purpose string) {
	parts := strings.SplitN(strings.TrimSpace(value), " ", 2)
	method, path := "", strings.TrimSpace(value)
	if len(parts) == 2 {
		method, path = parts[0], parts[1]
	}
	fmt.Fprintf(b, "| %s | `%s %s` | `%s` | %s |\n", phase, markdownCell(method), markdownCell(path), markdownCell(contentType), purpose)
}

func markdownCell(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "|", "\\|"), "\n", " ")
}

func yesNo(value bool) string {
	if value {
		return "Yes"
	}
	return "No"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
