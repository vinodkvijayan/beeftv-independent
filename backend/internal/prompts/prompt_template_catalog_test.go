package prompts

import (
	"strings"
	"testing"
)

func TestPromptOperationCatalogContainsProductJobs(t *testing.T) {
	want := []string{
		OperationChapterAssetsExtract,
		OperationStoryboardPlan,
		OperationStoryboardRepair,
		OperationStoryboardFirstFrame,
		OperationStoryboardVideo,
		OperationCharacterExtract,
		OperationCharacterTurnaround,
		OperationShortDramaOutline,
		OperationSkillDraft,
	}
	got := make(map[string]bool, len(want))
	for _, definition := range defaultPromptDefinitions() {
		got[definition.Operation] = true
	}
	for _, operation := range want {
		if !got[operation] {
			t.Fatalf("prompt catalog missing operation %s", operation)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("prompt catalog size = %d, want %d; update this lock list when adding an operation", len(got), len(want))
	}
}

func TestRenderShortDramaTemplateSubstitutesVariables(t *testing.T) {
	definition, ok := PromptDefinition(OperationShortDramaOutline)
	if !ok {
		t.Fatal("short_drama_outline definition missing")
	}
	rendered, err := RenderPromptTemplate(definition, definition.DefaultContent, map[string]string{
		"Number of chapters": "5",
		"narrative structure": "Single line advancement",
		"word count per chapter": "800",
		"narrative perspective": "third person",
		"overall tone": "Smooth narrative",
		"role size": "3-4 pcs",
		"Chapter length": "Medium",
	})
	if err != nil {
		t.Fatalf("RenderPromptTemplate() error = %v", err)
	}
	if !strings.Contains(rendered, "5 个章节") || !strings.Contains(rendered, "单线推进") || strings.Contains(rendered, "{{") {
		t.Fatalf("RenderPromptTemplate() = %q, want interpolated short-drama instruction", rendered)
	}
	protected := protectedPromptContext(OperationShortDramaOutline, map[string]string{"user stories": "Tenant discovers landlord is not human"})
	if !strings.Contains(protected, "Tenant discovers landlord is not human") || !strings.Contains(protected, "short-drama-outline/v1") {
		t.Fatalf("protectedPromptContext() = %q, want story and JSON contract", protected)
	}
}

func TestValidatePromptTemplateResultShortDramaOutline(t *testing.T) {
	ok := `{"title":"夜灯","synopsis":"租客发现房东不是人","chapters":[{"title":"入住","content":"林夏搬进旧公寓。"}]}`
	if err := ValidatePromptTemplateResult(OperationShortDramaOutline, map[string]interface{}{"text": "```json\n" + ok + "\n```"}); err != nil {
		t.Fatalf("valid outline error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationShortDramaOutline, map[string]interface{}{"text": `{"title":"夜灯","synopsis":"简介","chapters":[]}`}); err == nil || !strings.Contains(err.Error(), "没有生成任何章节") {
		t.Fatalf("empty chapters error = %v", err)
	}
}

func TestValidatePromptTemplateResultSkillDraft(t *testing.T) {
	ok := `{"skillName":"分镜节奏","tag":"drama","description":"把章节拆成可执行镜头","instruction":"角色设定：分镜导演。"}`
	if err := ValidatePromptTemplateResult(OperationSkillDraft, map[string]interface{}{"text": ok}); err != nil {
		t.Fatalf("valid skill draft error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationSkillDraft, map[string]interface{}{"text": `{"skillName":"分镜节奏","tag":"drama","description":"简介"}`}); err == nil || !strings.Contains(err.Error(), "instruction") {
		t.Fatalf("missing instruction error = %v", err)
	}
	protected := protectedPromptContext(OperationSkillDraft, map[string]string{"User thoughts": "Skills in making an e-commerce main image"})
	if !strings.Contains(protected, "Skills in making an e-commerce main image") || !strings.Contains(protected, "skill-draft/v1") {
		t.Fatalf("protectedPromptContext() = %q, want idea and JSON contract", protected)
	}
}
