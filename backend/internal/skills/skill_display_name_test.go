package skills

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestImportedSkillUsesChineseHeadingInsteadOfTechnicalName(t *testing.T) {
	s, db := agentSkillFixture(t)
	body := "---\nname: storyboard-text\ndescription: Organize storyboards\n---\n#Double lens text storyboard\n\nText"
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": body})
	item, err := s.SkillDetail("owner", pin.SkillID)
	if err != nil || item.SkillName != "Dual lens text storyboard" {
		t.Fatalf("imported name: %+v %v", item, err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", pin.SkillID).Update("name", "storyboard-text").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	item, err = s.SkillDetail("owner", pin.SkillID)
	if err != nil || item.SkillName != "Dual lens text storyboard" || item.VersionID != pin.VersionID || item.ContentHash != pin.ContentHash {
		t.Fatalf("legacy name repair changed identity: %+v %v", item, err)
	}
	resource, err := s.AgentVersion("owner", pin)
	if err != nil || resource.Name != item.SkillName || resource.Instruction != body {
		t.Fatalf("assistant label/body: %+v %v", resource, err)
	}
	// 去掉「已修复」标记，确认没有标记时自定义名字也不会被改。
	if err := db.Model(&model.Skill{}).Where("id = ?", pin.SkillID).Update("name", "My private storyboard").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("key = ?", skillDisplayNamesRepairedKey).Delete(&model.SystemSetting{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	item, err = s.SkillDetail("owner", pin.SkillID)
	if err != nil || item.SkillName != "My private storyboard" {
		t.Fatalf("custom name replaced: %+v %v", item, err)
	}
}

func TestSkillDisplayNameFallbacks(t *testing.T) {
	for _, tc := range []struct{ body, want string }{
		{"---\nname: interview-outline\ndescription: Introduction\n---\n#Interview outline", "Interview outline"},
		{"---\nname: material-inventory\ndescription: Introduction\n---\n# Material list organization", "Material list organization"},
		{"---\nname: Custom Name\ndescription: Introduction\n---\n# Chinese title", "Custom Name"},
		{"---\nname: custom name\ndescription: Introduction\n---\n# Chinese title", "custom name"},
		{"---\nname: technical-name\ndescription: Introduction\n---\nNo title", "technical-name"},
		// 代码块里的注释不是标题；ATX 结尾的 # 不进名字；超长标题不采用，避免导入因名称超长失败。
		{"---\nname: setup-guide\ndescription: Introduction\n---\n```bash\n# Install dependencies\n```\n# Environment Preparation Guide", "Environmental Preparation Guide"},
		{"---\nname: tilde-fence\ndescription: Introduction\n---\n~~~\n# Comment\n~~~\n# Title after the tilde code block", "Title after tilde code block"},
		{"---\nname: closing-hash\ndescription: Introduction\n---\n# Storyboarding ##", "Storyboarding"},
		{"---\nname: tab-closing-hash\ndescription: Introduction\n---\n# Storyboarding ##", "Storyboarding"},
		{"---\nname: long-title\ndescription: Introduction\n---\n#" + strings.Repeat("Long", maxSkillNameRunes+1), "long-title"},
		{"---\nname: csharp-tips\ndescription: Introduction\n---\n# C# Programming Tips", "C# Programming Tips"},
		{"---\nname: long-fence\ndescription: Introduction\n---\n````md\n```\n# Example\n```\n````\n# The title after four backticks", "The title after four backticks"},
		{"---\nname: info-close\ndescription: Introduction\n---\n```\n```go\n# Comment\n```\n# Lines with language names will not end the code block early", "Lines with language names do not end code blocks early"},
		{"---\nname: indented-code\ndescription: Introduction\n---\n    ```\n    # Indent code\n\t#Tab indentation\n# Indent the title after the code", "Indent title after code"},
		// 没有 name 时用同一套规则取标题。
		{"```bash\n# Install dependencies\n```\n# Environment Preparation Guide #", "Environmental Preparation Guide"},
		{"# C#", "C#"},
	} {
		if got := parseSkillPackageMetadata([]byte(tc.body)).Name; got != tc.want {
			t.Fatalf("name = %q, want %q", got, tc.want)
		}
	}
}

// 早先导入、来源字段为空（NULL）的技能也会被修复；修复只执行一次，之后用户主动改回技术名不会被再次改掉。
func TestSkillDisplayNameRepairCoversNullSourceAndRunsOnce(t *testing.T) {
	s, db := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "---\nname: interview-outline\ndescription: interview\n---\n#Interview outline\n\nText"})
	if err := db.Exec("UPDATE skills SET name = ?, source_type = NULL WHERE id = ?", "interview-outline", pin.SkillID).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	item, err := s.SkillDetail("owner", pin.SkillID)
	if err != nil || item.SkillName != "Interview outline" || item.ContentHash != pin.ContentHash {
		t.Fatalf("NULL-source legacy name not repaired: %+v %v", item, err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", pin.SkillID).Update("name", "interview-outline").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	if item, err = s.SkillDetail("owner", pin.SkillID); err != nil || item.SkillName != "interview-outline" {
		t.Fatalf("repair ran again over the user's chosen name: %+v %v", item, err)
	}
}

// 名称或简介超长时截到上限以内，导入不会因为截断后的省略号超长而失败。
func TestSkillArchiveFitsLongNameAndDescription(t *testing.T) {
	longDescription := strings.Repeat("describe", maxSkillDescriptionRunes+100)
	for _, body := range []string{
		"---\nname: " + strings.Repeat("name", maxSkillNameRunes+20) + "\ndescription: " + longDescription + "---\nText",
		"# " + strings.Repeat("question", maxSkillNameRunes+20) + "\n\n" + longDescription,
	} {
		archive, err := archiveFromMarkdown([]byte(body), "", "")
		if err != nil {
			t.Fatalf("long metadata rejected: %v", err)
		}
		name, description := []rune(archive.Metadata.Name), []rune(archive.Metadata.Description)
		if len(name) != maxSkillNameRunes || len(description) != maxSkillDescriptionRunes || string(name[len(name)-1:]) != "…" {
			t.Fatalf("metadata not fitted: %d %d %q", len(name), len(description), archive.Metadata.Name)
		}
	}
}

// 内置技能不参与显示名修复，即使来源字段为空。
func TestSkillDisplayNameRepairSkipsBuiltin(t *testing.T) {
	s, db := agentSkillFixture(t)
	builtin := model.Skill{ID: kernel.NewID(), Name: "storyboard-text", Description: "Built-in", Instruction: "---\nname: storyboard-text\ndescription: built-in\n---\n#Double lens text storyboard", Status: skillStatusEnabled, Source: 3}
	if err := db.Create(&builtin).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE skills SET source_type = NULL WHERE id = ?", builtin.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("key = ?", skillDisplayNamesRepairedKey).Delete(&model.SystemSetting{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	var got model.Skill
	if err := db.First(&got, "id = ?", builtin.ID).Error; err != nil || got.Name != "storyboard-text" {
		t.Fatalf("builtin renamed: %q %v", got.Name, err)
	}
}
