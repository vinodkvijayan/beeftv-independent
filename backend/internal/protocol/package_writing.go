package protocol

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// npm 插件的 beeftv 清单只认一种写法。别名和放错位置的字段以前会被悄悄忽略，
// 开发者照着写却不生效；安装和更新时逐项指出该怎么改。已经装好的插件不在启动时
// 重新检查，旧写法照旧加载，更新到新版本时才要求改。
var (
	packageManifestKeys = map[string]string{
		"name": "", "client": "", "surfaces": "", "permissions": "", "configuration": "", "contributes": "",
		"id":            "The plug-in ID is taken from the name of package.json, delete this item",
		"version":       "The version is taken from version of package.json, delete this item",
		"description":   "The description is written in the description of package.json",
		"author":        "The author writes in package.json author",
		"displayName":   "The display name is written as beeftv.name",
		"apiVersion":    "No need to write, npm plug-in always reads according to the latest manifest rules",
		"schemaVersion": "No need to write, delete this item",
		"trusted":       "No need to write, only the plug-ins that come with BeefTV are considered built-in",
		"renderer":      "Written in beeftv.contributes.canvasNodes[].renderer",
		"canvasNodes":   "Written in beeftv.contributes.canvasNodes",
		"providers":     "Written in beeftv.contributes.providers",
		"workflows":     "Written in beeftv.contributes.workflows",
	}
	packageContributionKeys = map[string]string{
		"providers": "", "workflows": "", "canvasNodes": "",
		"skills":      "Skills are written in pi.skills in package.json",
		"extensions":  "Helper extensions are written in pi.extensions in package.json",
		"slots":       "The interface hanging point is registered with host.contribute in the client code.",
		"editorSlots": "The interface hanging point is registered with host.contribute in the client code.",
	}
	packageCanvasNodeKeys = map[string]string{
		"id": "", "label": "", "defaultTitle": "", "defaultSize": "", "schema": "", "renderer": "", "fields": "",
		"description": "", "acceptsInputKind": "", "maxInputCount": "", "showOutputConnection": "",
		"type":          "The node type is id, delete type",
		"title":         "Use label (the name in the add menu) and defaultTitle (the title of the new node)",
		"defaultWidth":  "Use defaultSize: { width, height }",
		"defaultHeight": "Use defaultSize: { width, height }",
	}
	packageFieldKeys = map[string]string{
		"name": "", "type": "", "label": "", "required": "", "secret": "", "default": "", "description": "", "values": "",
		"key":          "Use name for field name",
		"defaultValue": "Use default for default value",
		"options":      "Use values (array of strings) for drop-down options",
	}
)

// CheckPackageManifestWriting 检查 npm 插件包 package.json 里 beeftv 的写法，一次列出全部问题。
func CheckPackageManifestWriting(root string) error {
	raw, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return fmt.Errorf("read package.json: %w", err)
	}
	var pkg struct {
		BeefTV json.RawMessage `json:"beeftv"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return fmt.Errorf("decode package.json: %w", err)
	}
	var manifest map[string]json.RawMessage
	if len(pkg.BeefTV) == 0 || string(pkg.BeefTV) == "null" || json.Unmarshal(pkg.BeefTV, &manifest) != nil {
		// 没有 beeftv 的纯 pi 包合法；不是对象的 beeftv 由 ParsePluginPackageDir 报错。
		return nil
	}
	var problems []string
	problems = append(problems, unknownKeys("beeftv", manifest, packageManifestKeys)...)
	var configuration struct {
		Fields []map[string]json.RawMessage `json:"fields"`
	}
	if rawConfiguration, ok := manifest["configuration"]; ok && json.Unmarshal(rawConfiguration, &configuration) == nil {
		problems = append(problems, fieldProblems("beeftv.configuration.fields", configuration.Fields)...)
	}
	var contributes map[string]json.RawMessage
	if rawContributes, ok := manifest["contributes"]; ok && json.Unmarshal(rawContributes, &contributes) == nil {
		problems = append(problems, unknownKeys("beeftv.contributes", contributes, packageContributionKeys)...)
		var nodes []map[string]json.RawMessage
		if rawNodes, ok := contributes["canvasNodes"]; ok && json.Unmarshal(rawNodes, &nodes) == nil {
			for index, node := range nodes {
				problems = append(problems, unknownKeys(fmt.Sprintf("beeftv.contributes.canvasNodes[%d]", index), node, packageCanvasNodeKeys)...)
			}
		}
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("The beeftv writing method of package.json needs to be modified:\n%s", strings.Join(problems, "\n"))
}

func fieldProblems(prefix string, fields []map[string]json.RawMessage) []string {
	var problems []string
	for index, field := range fields {
		problems = append(problems, unknownKeys(fmt.Sprintf("%s[%d]", prefix, index), field, packageFieldKeys)...)
	}
	return problems
}

func unknownKeys(prefix string, object map[string]json.RawMessage, allowed map[string]string) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var problems []string
	for _, key := range keys {
		hint, known := allowed[key]
		switch {
		case !known:
			problems = append(problems, fmt.Sprintf("- %s.%s: BeefTV does not recognize this item", prefix, key))
		case hint != "":
			problems = append(problems, fmt.Sprintf("- %s.%s：%s", prefix, key, hint))
		}
	}
	return problems
}
