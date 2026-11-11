package prompts

import (
	"strings"
	"testing"
)

func TestExtractJSONTextSkipsProseAndMarkdownFence(t *testing.T) {
	raw := "先说明一下，{这不是有效 JSON}。\n```json\n{\"characters\":[{\"name\":\"林夏\",\"aliases\":[]}]}\n```\n"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","aliases":[]}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

func TestExtractJSONTextHandlesBracesInJSONString(t *testing.T) {
	raw := "```json\n{\"characters\":[{\"name\":\"林夏\",\"role\":\"拿着{小夜灯}的租客\"}]}\n```"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","role":"拿着{小夜灯}的租客"}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

const characterCardJSON = `{"name":"林夏","aliases":["夏夏"],"role":"女主角","appearance":"短发","clothing":"白衬衫","physique":"纤细","personality":"冷静","props":"小夜灯","consistencyPrompt":"c","multiViewPrompt":"m","voiceLanguage":"中文","voiceAge":"青年","voiceTimbre":"清亮"}`

// TestValidatePromptTemplateResultCharacterRootShapes 覆盖模型返回角色卡时的各种顶层形态。
// 这些形态都违反 character-breakdown/v1 的顶层 object 契约，但内容本身可用，应当被接受；
// 真正无内容或缺字段的输入则必须报出可读的业务错误，而不是 Go 的类型错误。
func TestValidatePromptTemplateResultCharacterRootShapes(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		wantErr string
	}{
		{name: "Standard object form", text: `{"characters":[` + characterCardJSON + `]}`},
		{name: "Top-level character card array", text: `[` + characterCardJSON + `]`},
		{name: "Single element package characters", text: `[{"characters":[` + characterCardJSON + `]}]`},
		{name: "Multiple elements in each package characters", text: `[{"characters":[` + characterCardJSON + `]},{"characters":[` + characterCardJSON + `]}]`},
		{name: "Wrap another layer outside the array", text: `[[` + characterCardJSON + `]]`},
		{name: "Array mixed with non-role objects", text: `[{"index":1},` + characterCardJSON + `]`},
		{name: "markdown code block wrapped array", text: "```json\n[" + characterCardJSON + "]\n```"},
		{name: "The text lists the character name array first", text: "Characters in this chapter: [\"Lin Xia\", \"Chen Mo\"]\n\n{\"characters\":[" + characterCardJSON + "]}"},
		{name: "characters is written as an object whose key is the character name", text: `{"characters":{"Lin Xia":` + characterCardJSON + `}}`},
		{name: "empty array", text: `[]`, wantErr: "No role recognized"},
		{name: "Unrelated array", text: `["林夏","陈默"]`, wantErr: "No role recognized"},
		{name: "Role is missing a required field", text: `[{"name":"林夏"}]`, wantErr: "Role 1 is missing field aliases"},
		// characters 位于契约位置时不做元素过滤，缺 name 也要报出具体字段而不是被当成空结果。
		{name: "The character in the contract position is missing a name", text: `{"characters":[{"role":"女主角"}]}`, wantErr: "Role 1 is missing field name"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePromptTemplateResult(OperationCharacterExtract, map[string]interface{}{"text": tc.text})
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidatePromptTemplateResult() error = %v, want nil", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ValidatePromptTemplateResult() error = nil, want %q", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("ValidatePromptTemplateResult() error = %q, want containing %q", err.Error(), tc.wantErr)
			}
			// 形态问题必须收敛成业务语言，不能把 Go 的类型错误抛给用户。
			if strings.Contains(err.Error(), "cannot unmarshal") {
				t.Fatalf("ValidatePromptTemplateResult() leaked Go type error: %v", err)
			}
		})
	}
}

// TestValidatePromptTemplateResultScopesCharacterRelaxation 确认形态放宽只作用于角色卡提取。
// 其余 JSON 操作只要求能取出一个合法 JSON 值，不套用 characters 契约，因此顶层数组对它们依旧无意义。
func TestValidatePromptTemplateResultScopesCharacterRelaxation(t *testing.T) {
	if err := ValidatePromptTemplateResult(OperationStoryboardPlan, map[string]interface{}{"text": `[{"name":"林夏"}]`}); err != nil {
		t.Fatalf("ValidatePromptTemplateResult() error = %v, want nil for non-character JSON operation", err)
	}
	if err := ValidatePromptTemplateResult(OperationStoryboardPlan, map[string]interface{}{"text": "No JSON content at all"}); err == nil {
		t.Fatal("ValidatePromptTemplateResult() error = nil, want contract error for non-character operation")
	}
	err := ValidatePromptTemplateResult(OperationCharacterExtract, map[string]interface{}{"text": "No JSON content at all"})
	if err == nil || !strings.Contains(err.Error(), "受保护 JSON 契约") {
		t.Fatalf("ValidatePromptTemplateResult() error = %v, want contract error for character extract", err)
	}
}
