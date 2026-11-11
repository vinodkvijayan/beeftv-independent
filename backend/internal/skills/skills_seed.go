package skills

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
)

//go:embed seed/skills.json
var builtinSkillsJSON []byte

type seedShowcaseMedia struct {
	Type        string `json:"type"`
	ShowcaseURI string `json:"showcase_uri"`
	ShowcaseURL string `json:"showcase_url"`
}

type seedEffectiveUser struct {
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	UID       string `json:"uid"`
}

type builtinSkillDefinition struct {
	SkillID       string              `json:"skill_id"`
	SkillName     string              `json:"skill_name"`
	Description   string              `json:"description"`
	Instruction   string              `json:"instruction"`
	Files         map[string]string   `json:"files,omitempty"`
	Status        int                 `json:"status"`
	MarkdownURL   string              `json:"markdown_url"`
	CreateTime    int64               `json:"create_time"`
	UpdateTime    int64               `json:"update_time"`
	Source        int                 `json:"source"`
	Tag           string              `json:"tag"`
	SortWeight    int                 `json:"sort_weight"`
	IsPrivate     bool                `json:"is_private"`
	LikeCount     int64               `json:"like_count"`
	OwnerUID      string              `json:"owner_uid"`
	EffectiveUser seedEffectiveUser   `json:"effective_user"`
	ShowcaseMedia []seedShowcaseMedia `json:"showcase_media"`
	AddedCount    int64               `json:"added_count"`
	ExtraInfo     string              `json:"extra_info"`
	DefaultAdded  bool                `json:"default_added,omitempty"`
}

// EnsureBuiltinSkills 校验并同步内置技能正文；用户关系独立保存，因此重复启动不会清空加入或收藏状态。
func (s *Service) EnsureBuiltinSkills() error {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		return fmt.Errorf("Failed to parse built-in skills: %w", err)
	}
	if len(definitions) == 0 {
		return fmt.Errorf("Built-in skills cannot be empty")
	}

	seen := make(map[string]struct{}, len(definitions))
	skills := make([]model.Skill, 0, len(definitions))
	for _, definition := range definitions {
		id := strings.TrimSpace(definition.SkillID)
		ownerID := strings.TrimSpace(definition.OwnerUID)
		if id == "" || len(id) > 36 || ownerID == "" || len(ownerID) > 36 {
			return fmt.Errorf("Invalid built-in skill ID or author ID: %q", definition.SkillID)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("Duplicate built-in skill ID: %s", id)
		}
		seen[id] = struct{}{}
		if definition.Status != skillStatusEnabled || definition.IsPrivate {
			return fmt.Errorf("Built-in skills must be publicly enabled: %s", id)
		}
		if definition.CreateTime <= 0 || definition.UpdateTime <= 0 || definition.LikeCount < 0 || definition.AddedCount < 0 {
			return fmt.Errorf("Invalid built-in skill time or count: %s", id)
		}
		authorName := strings.TrimSpace(definition.EffectiveUser.Name)
		authorAvatarURL := strings.TrimSpace(definition.EffectiveUser.AvatarURL)
		if authorName == "" || (authorAvatarURL != "" && !validSkillURL(authorAvatarURL)) {
			return fmt.Errorf("The built-in skill author information is invalid: %s", id)
		}
		if _, err := normalizeBuiltinSkillFiles(definition.Files); err != nil {
			return fmt.Errorf("Built-in skill %s Invalid auxiliary file: %w", id, err)
		}
		media := make([]SkillShowcaseMedia, 0, len(definition.ShowcaseMedia))
		for _, item := range definition.ShowcaseMedia {
			media = append(media, SkillShowcaseMedia{Type: item.Type, ShowcaseURI: item.ShowcaseURI, ShowcaseURL: item.ShowcaseURL})
		}
		normalized, mediaJSON, err := normalizeSkillMutationRequest(SkillMutationRequest{
			SkillName: definition.SkillName, Description: definition.Description, Instruction: definition.Instruction,
			Tag: definition.Tag, IsPrivate: definition.IsPrivate, MarkdownURL: definition.MarkdownURL,
			ShowcaseMedia: media, ExtraInfo: definition.ExtraInfo,
		}, true)
		if err != nil {
			return fmt.Errorf("Built-in skill %s Invalid data: %w", id, err)
		}
		skills = append(skills, model.Skill{
			ID: id, OwnerID: ownerID, AuthorName: authorName, AuthorAvatarURL: authorAvatarURL,
			Name: normalized.SkillName, Description: normalized.Description, Instruction: normalized.Instruction,
			Status: skillStatusEnabled, Source: definition.Source, Tag: normalized.Tag, SortWeight: definition.SortWeight,
			IsPrivate: false, MarkdownURL: normalized.MarkdownURL, ShowcaseMediaJSON: mediaJSON, ExtraInfo: normalized.ExtraInfo,
			InitialLikeCount: definition.LikeCount, InitialAddedCount: definition.AddedCount,
			CreatedAt: time.UnixMilli(definition.CreateTime), UpdatedAt: time.UnixMilli(definition.UpdateTime),
		})
	}
	if err := s.repo.UpsertBuiltinSkills(skills); err != nil {
		return fmt.Errorf("Failed to synchronize built-in skills: %w", err)
	}
	return nil
}

func normalizeBuiltinSkillFiles(raw map[string]string) (map[string][]byte, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	files := make(map[string][]byte, len(raw))
	var total int64
	for rawPath, content := range raw {
		cleanPath, err := normalizeSkillPath(rawPath)
		if err != nil || cleanPath != rawPath || cleanPath == "SKILL.md" {
			return nil, fmt.Errorf("Invalid auxiliary file path: %q", rawPath)
		}
		data := []byte(content)
		if len(data) == 0 || !utf8.Valid(data) {
			return nil, fmt.Errorf("Invalid auxiliary file content: %q", rawPath)
		}
		total += int64(len(data))
		if total > maxSkillPackageBytes {
			return nil, fmt.Errorf("The total size of auxiliary files exceeds the upper limit %d", maxSkillPackageBytes)
		}
		files[cleanPath] = data
	}
	return files, nil
}

func builtinSkillAuxiliaryFiles() (map[string]map[string][]byte, error) {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		return nil, fmt.Errorf("Failed to parse built-in skills: %w", err)
	}
	result := make(map[string]map[string][]byte)
	for _, definition := range definitions {
		if len(definition.Files) == 0 {
			continue
		}
		files, err := normalizeBuiltinSkillFiles(definition.Files)
		if err != nil {
			return nil, fmt.Errorf("Built-in skill %s Invalid auxiliary file: %w", definition.SkillID, err)
		}
		result[strings.TrimSpace(definition.SkillID)] = files
	}
	return result, nil
}

func builtinDefaultAddedSkillIDs() ([]string, error) {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		return nil, fmt.Errorf("Failed to parse built-in skills: %w", err)
	}
	var ids []string
	for _, definition := range definitions {
		if definition.DefaultAdded {
			ids = append(ids, strings.TrimSpace(definition.SkillID))
		}
	}
	return ids, nil
}
