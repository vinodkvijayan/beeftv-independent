package prompts

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"regexp"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	promptCustomizationInherit = "inherit"
	promptCustomizationAppend  = "append"
	promptCustomizationRewrite = "rewrite"
)

var promptPlaceholderPattern = regexp.MustCompile(`\{\{[^{}]+\}\}`)

type PromptTemplateVariable struct {
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
}

type PromptOperationDefinition struct {
	Operation      string                   `json:"operation"`
	Label          string                   `json:"label"`
	Category       string                   `json:"category"`
	Description    string                   `json:"description"`
	OutputType     string                   `json:"outputType"`
	SchemaKey      string                   `json:"schemaKey,omitempty"`
	Variables      []PromptTemplateVariable `json:"variables"`
	OutputContract string                   `json:"outputContract"`
	DefaultContent string                   `json:"-"`
}

type UserPromptCustomizationRequest struct {
	Mode    string `json:"mode"`
	Content string `json:"content"`
}

type UserPromptPreference struct {
	Definition    PromptOperationDefinition      `json:"definition"`
	Template      *model.PromptTemplate          `json:"template"`
	Customization *model.UserPromptCustomization `json:"customization,omitempty"`
	Outdated      bool                           `json:"outdated"`
}

type CompiledPrompt struct {
	Content              string
	TemplateID           string
	TemplateVersion      int
	CustomizationID      string
	CustomizationUpdated string
}

func promptDefinitions() []PromptOperationDefinition {
	definitions := defaultPromptDefinitions()
	for index := range definitions {
		definitions[index].OutputContract = promptOutputContract(definitions[index].Operation)
	}
	return definitions
}

func PromptDefinition(operation string) (PromptOperationDefinition, bool) {
	for _, definition := range promptDefinitions() {
		if definition.Operation == operation {
			return definition, true
		}
	}
	return PromptOperationDefinition{}, false
}

func (s *Service) EnsureDefaultPromptTemplates() error {
	for _, definition := range promptDefinitions() {
		count, err := s.repo.PromptTemplateCount(definition.Operation)
		if err != nil {
			return err
		}
		if count > 0 {
			if definition.Operation == OperationStoryboardVideo {
				active, activeErr := s.repo.ActivePromptTemplate(definition.Operation)
				if activeErr == nil && active.CreatedBy == "" && strings.HasPrefix(active.Content, legacyStoryboardVideoPromptPreamble) {
					active.Content = strings.TrimPrefix(active.Content, legacyStoryboardVideoPromptPreamble)
					active.UpdatedAt = time.Now()
					if err := s.repo.SavePromptTemplate(active); err != nil {
						return err
					}
				}
			}
			continue
		}
		if err := s.repo.SavePromptTemplate(&model.PromptTemplate{
			ID: kernel.NewID(), Operation: definition.Operation, Name: "Default" + definition.Label + "Template", Version: 1,
			Content: definition.DefaultContent, OutputType: definition.OutputType, Enabled: true,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) UserPromptPreferences(user *model.User) ([]UserPromptPreference, error) {
	if user == nil || user.ID == "" {
		return nil, kernel.BadAuthRequest("Please log in first")
	}
	customizations, err := s.repo.UserPromptCustomizations(user.ID)
	if err != nil {
		return nil, err
	}
	customizationByOperation := make(map[string]*model.UserPromptCustomization, len(customizations))
	for index := range customizations {
		customization := &customizations[index]
		customizationByOperation[customization.Operation] = customization
	}
	preferences := make([]UserPromptPreference, 0)
	for _, definition := range promptDefinitions() {
		template, err := s.repo.ActivePromptTemplate(definition.Operation)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		customization := customizationByOperation[definition.Operation]
		preference := UserPromptPreference{Definition: definition, Template: template, Customization: customization}
		preference.Outdated = customization != nil && customization.Mode == promptCustomizationRewrite && template != nil && customization.BaseTemplateID != template.ID
		preferences = append(preferences, preference)
	}
	return preferences, nil
}

func (s *Service) UpdateUserPromptCustomization(user *model.User, operation string, req UserPromptCustomizationRequest) (*model.UserPromptCustomization, error) {
	if user == nil || user.ID == "" {
		return nil, kernel.BadAuthRequest("Please log in first")
	}
	definition, ok := PromptDefinition(strings.TrimSpace(operation))
	if !ok {
		return nil, kernel.BadAuthRequest("Unsupported prompt word template type")
	}
	mode := strings.TrimSpace(req.Mode)
	if mode != promptCustomizationInherit && mode != promptCustomizationAppend && mode != promptCustomizationRewrite {
		return nil, kernel.BadAuthRequest("Unsupported prompt word customization method")
	}
	content := strings.TrimSpace(req.Content)
	if mode == promptCustomizationInherit {
		content = ""
	}
	if mode != promptCustomizationInherit && content == "" {
		return nil, kernel.BadAuthRequest("Please fill in the personal prompt word requirements")
	}
	if len([]rune(content)) > 12_000 {
		return nil, kernel.BadAuthRequest("Personal prompt words can be up to 12,000 characters long")
	}
	if err := validatePromptPlaceholders(definition, content); err != nil {
		return nil, err
	}
	active, err := s.repo.ActivePromptTemplate(definition.Operation)
	if err != nil {
		return nil, errors.New("There is no version enabled for the current template type")
	}
	customization, err := s.repo.UserPromptCustomization(user.ID, definition.Operation)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		customization = &model.UserPromptCustomization{ID: kernel.NewID(), UserID: user.ID, Operation: definition.Operation}
	} else if err != nil {
		return nil, err
	}
	customization.Mode = mode
	customization.Content = content
	customization.BaseTemplateID = active.ID
	if err := s.repo.SaveUserPromptCustomization(customization); err != nil {
		return nil, err
	}
	return customization, nil
}

func (s *Service) ResetUserPromptCustomization(user *model.User, operation string) error {
	if user == nil || user.ID == "" {
		return kernel.BadAuthRequest("Please log in first")
	}
	if _, ok := PromptDefinition(strings.TrimSpace(operation)); !ok {
		return kernel.BadAuthRequest("Unsupported prompt word template type")
	}
	return s.repo.DeleteUserPromptCustomization(user.ID, operation)
}

func (s *Service) CompilePrompt(userID string, operation string, values map[string]string) (CompiledPrompt, error) {
	definition, ok := PromptDefinition(operation)
	if !ok {
		return CompiledPrompt{}, fmt.Errorf("Unsupported prompt word template type: %s", operation)
	}
	template, err := s.repo.ActivePromptTemplate(operation)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		template = &model.PromptTemplate{Operation: operation, Name: "Built-in default", Version: 1, Content: definition.DefaultContent, OutputType: definition.OutputType}
	} else if err != nil {
		return CompiledPrompt{}, err
	}
	creative := template.Content
	compiled := CompiledPrompt{TemplateID: template.ID, TemplateVersion: template.Version}
	customization, customizationErr := s.repo.UserPromptCustomization(userID, operation)
	if customizationErr == nil {
		compiled.CustomizationID = customization.ID
		compiled.CustomizationUpdated = customization.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
		switch customization.Mode {
		case promptCustomizationAppend:
			creative += "[User personalized creation requirements]" + customization.Content
		case promptCustomizationRewrite:
			creative = customization.Content
		}
	} else if !errors.Is(customizationErr, gorm.ErrRecordNotFound) {
		return CompiledPrompt{}, customizationErr
	}
	rendered, err := RenderPromptTemplate(definition, creative, values)
	if err != nil {
		return CompiledPrompt{}, err
	}
	parts := []string{strings.TrimSpace(rendered)}
	if protected := strings.TrimSpace(protectedPromptContext(operation, values)); protected != "" {
		parts = append(parts, protected)
	}
	compiled.Content = strings.Join(parts, "\n\n")
	return compiled, nil
}

func validatePromptPlaceholders(definition PromptOperationDefinition, content string) error {
	allowed := make(map[string]bool, len(definition.Variables))
	for _, variable := range definition.Variables {
		allowed[variable.Placeholder] = true
	}
	unknown := make([]string, 0)
	for _, placeholder := range promptPlaceholderPattern.FindAllString(content, -1) {
		if !allowed[placeholder] {
			unknown = append(unknown, placeholder)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	sort.Strings(unknown)
	return kernel.BadAuthRequest("Template contains unsupported variables:" + strings.Join(uniqueStrings(unknown), "、"))
}

func RenderPromptTemplate(definition PromptOperationDefinition, content string, values map[string]string) (string, error) {
	if err := validatePromptPlaceholders(definition, content); err != nil {
		return "", err
	}
	rendered := content
	for _, variable := range definition.Variables {
		key := strings.TrimSuffix(strings.TrimPrefix(variable.Placeholder, "{{"), "}}")
		rendered = strings.ReplaceAll(rendered, variable.Placeholder, strings.TrimSpace(values[key]))
	}
	return strings.TrimSpace(rendered), nil
}

func ValidatePromptTemplateResult(operation string, result map[string]interface{}) error {
	definition, ok := PromptDefinition(operation)
	if !ok || definition.OutputType != "json" {
		return nil
	}
	text, _ := result["text"].(string)
	jsonText, err := promptResultJSONExtractor(operation)(text)
	if err != nil {
		return fmt.Errorf("%s The returned content does not conform to the protected JSON contract: %w", definition.Label, err)
	}
	switch operation {
	case OperationChapterAssetsExtract:
		return validateChapterAssetsResult(jsonText)
	case OperationCharacterExtract:
		return validateCharacterExtractResult(jsonText)
	case OperationShortDramaOutline:
		return validateShortDramaOutlineResult(jsonText)
	case OperationSkillDraft:
		return validateSkillDraftResult(jsonText)
	default:
		return nil
	}
}

func promptResultJSONExtractor(operation string) func(string) (string, error) {
	switch operation {
	case OperationCharacterExtract, OperationChapterAssetsExtract:
		// 角色卡契约要求顶层对象，模型正文里若先出现数组（例如先列一遍角色名）会让通用提取命中错误片段。
		return func(raw string) (string, error) { return extractPreferredJSONText(raw, "characters") }
	case OperationShortDramaOutline:
		return func(raw string) (string, error) { return extractPreferredJSONText(raw, "chapters") }
	case OperationSkillDraft:
		return func(raw string) (string, error) { return extractPreferredJSONText(raw, "skillName") }
	default:
		return extractJSONText
	}
}

func validateChapterAssetsResult(jsonText string) error {
	var assets struct {
		Characters *[]map[string]interface{} `json:"characters"`
		Scenes     *[]map[string]interface{} `json:"scenes"`
		Props      *[]map[string]interface{} `json:"props"`
	}
	if err := json.Unmarshal([]byte(jsonText), &assets); err != nil {
		return fmt.Errorf("Chapter asset extraction JSON cannot be parsed: %w", err)
	}
	if assets.Characters == nil || assets.Scenes == nil || assets.Props == nil {
		return errors.New("Chapter asset extraction results must contain characters, scenes, and props arrays")
	}
	for _, group := range [][]map[string]interface{}{*assets.Scenes, *assets.Props} {
		for _, asset := range group {
			for _, field := range []string{"name", "description", "prompt"} {
				value, ok := asset[field].(string)
				if !ok || strings.TrimSpace(value) == "" {
					return fmt.Errorf("Chapter scene or prop is missing a valid %s", field)
				}
			}
		}
	}
	if len(*assets.Characters) > 0 {
		return ValidatePromptTemplateResult(OperationCharacterExtract, map[string]interface{}{"text": jsonText})
	}
	return nil
}

func validateCharacterExtractResult(jsonText string) error {
	jsonText = normalizeCharacterBreakdownRootJSON(jsonText)
	var payload struct {
		Characters *[]map[string]interface{} `json:"characters"`
	}
	if err := json.Unmarshal([]byte(jsonText), &payload); err != nil {
		return fmt.Errorf("The JSON returned by character card extraction cannot be parsed: %w", err)
	}
	required := []string{"name", "aliases", "role", "appearance", "clothing", "physique", "personality", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"}
	if payload.Characters == nil {
		return errors.New("Character card extraction result is missing characters array")
	}
	if len(*payload.Characters) == 0 {
		return errors.New("No characters were identified in the character card extraction result. Please adjust the text or re-extract.")
	}
	for index, character := range *payload.Characters {
		for _, field := range required {
			if _, exists := character[field]; !exists {
				return fmt.Errorf("The %d character in the character card extraction result is missing the field %s.", index+1, field)
			}
		}
	}
	return nil
}

func validateShortDramaOutlineResult(jsonText string) error {
	var payload struct {
		Title    string `json:"title"`
		Synopsis string `json:"synopsis"`
		Chapters *[]struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		} `json:"chapters"`
	}
	if err := json.Unmarshal([]byte(jsonText), &payload); err != nil {
		return fmt.Errorf("Skit synopsis JSON cannot be parsed: %w", err)
	}
	if strings.TrimSpace(payload.Title) == "" {
		return errors.New("Skit synopsis is missing title")
	}
	if strings.TrimSpace(payload.Synopsis) == "" {
		return errors.New("Skit synopsis missing synopsis")
	}
	if payload.Chapters == nil {
		return errors.New("Skit synopsis missing chapters array")
	}
	if len(*payload.Chapters) == 0 {
		return errors.New("The short play outline did not generate any chapters.")
	}
	for index, chapter := range *payload.Chapters {
		if strings.TrimSpace(chapter.Title) == "" || strings.TrimSpace(chapter.Content) == "" {
			return fmt.Errorf("Skit synopsis chapter %d is missing title or content", index+1)
		}
	}
	return nil
}

func validateSkillDraftResult(jsonText string) error {
	var payload struct {
		SkillName   string `json:"skillName"`
		Tag         string `json:"tag"`
		Description string `json:"description"`
		Instruction string `json:"instruction"`
	}
	if err := json.Unmarshal([]byte(jsonText), &payload); err != nil {
		return fmt.Errorf("Skill draft JSON cannot be parsed: %w", err)
	}
	if strings.TrimSpace(payload.SkillName) == "" {
		return errors.New("Skill draft is missing skillName")
	}
	if strings.TrimSpace(payload.Tag) == "" {
		return errors.New("Skill draft is missing tag")
	}
	if strings.TrimSpace(payload.Description) == "" {
		return errors.New("Skill draft is missing description")
	}
	if strings.TrimSpace(payload.Instruction) == "" {
		return errors.New("Skill draft is missing instruction")
	}
	return nil
}

// normalizeCharacterBreakdownRootJSON 把模型返回的角色卡结果收敛为 character-breakdown/v1 的
// {"characters": [...]} 形态。模型并不总是遵守顶层 object 契约，实测出现的偏离包括：
//   - 顶层直接返回角色数组（[ { name, role, ... }, ... ]）；
//   - 数组外再包一层（[[ {...} ]]）；
//   - 每个角色单独包一层 characters（[ {"characters":[...]}, {"characters":[...]} ]）；
//   - 数组里混入非角色对象或 prose 片段（[ {"index":1}, {...} ]）。
//
// 这里只做形态归一，字段完整性仍由 validatePromptTemplateResult 的必填校验负责，
// 因此收集阶段按宽松规则保留候选，再由必填校验给出“第 N 个角色缺少字段 X”的可读提示。
func normalizeCharacterBreakdownRootJSON(jsonText string) string {
	trimmed := strings.TrimSpace(jsonText)
	if trimmed == "" {
		return trimmed
	}
	if trimmed[0] != '[' {
		return normalizeCharacterBreakdownObject(trimmed)
	}
	var root []json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
		return trimmed
	}
	return marshalCharacterBreakdown(collectCharacterCards(root))
}

// normalizeCharacterBreakdownObject 处理顶层已是对象的情况，只把 characters 收敛成数组。
func normalizeCharacterBreakdownObject(jsonText string) string {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(jsonText), &obj); err != nil {
		return jsonText
	}
	raw, ok := obj["characters"]
	if !ok {
		return jsonText
	}
	var cards []json.RawMessage
	if err := json.Unmarshal(raw, &cards); err == nil {
		// characters 已经位于契约位置，这里只摊平嵌套，不过滤元素：
		// 缺少 name 的角色要留给必填校验报出具体字段，而不是被静默丢弃。
		obj["characters"] = marshalRawMessageArray(flattenCharacterCardValues(cards))
	} else {
		// characters 被写成以角色名为键的对象时降级为取值列表。
		var indexed map[string]json.RawMessage
		if err := json.Unmarshal(raw, &indexed); err != nil {
			return jsonText
		}
		list := make([]json.RawMessage, 0, len(indexed))
		for _, value := range indexed {
			list = append(list, value)
		}
		obj["characters"] = marshalRawMessageArray(list)
	}
	encoded, err := json.Marshal(obj)
	if err != nil {
		return jsonText
	}
	return string(encoded)
}

// collectCharacterCards 递归展开顶层数组，收集所有可辨认的角色卡对象。
// 顶层数组无法区分“角色卡列表”和模型正文里的旁枝数组，因此只保留带 name 的候选。
func collectCharacterCards(values []json.RawMessage) []json.RawMessage {
	result := make([]json.RawMessage, 0, len(values))
	for _, raw := range flattenCharacterCardValues(values) {
		if looksLikeCharacterCard(raw) {
			result = append(result, raw)
		}
	}
	return result
}

// flattenCharacterCardValues 递归摊平嵌套数组与 {"characters": [...]} 包装，不判断元素是否是角色。
func flattenCharacterCardValues(values []json.RawMessage) []json.RawMessage {
	result := make([]json.RawMessage, 0, len(values))
	for _, raw := range values {
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) == 0 {
			continue
		}
		switch trimmed[0] {
		case '[':
			var nested []json.RawMessage
			if json.Unmarshal(trimmed, &nested) == nil {
				result = append(result, flattenCharacterCardValues(nested)...)
			}
		case '{':
			var obj map[string]json.RawMessage
			if json.Unmarshal(trimmed, &obj) != nil {
				continue
			}
			if inner, ok := obj["characters"]; ok {
				var cards []json.RawMessage
				if json.Unmarshal(inner, &cards) == nil {
					result = append(result, flattenCharacterCardValues(cards)...)
					continue
				}
			}
			result = append(result, trimmed)
		}
	}
	return result
}

func marshalCharacterBreakdown(cards []json.RawMessage) string {
	return `{"characters":` + string(marshalRawMessageArray(cards)) + `}`
}

func marshalRawMessageArray(values []json.RawMessage) json.RawMessage {
	encoded, err := json.Marshal(values)
	if err != nil {
		return json.RawMessage("[]")
	}
	return encoded
}

// looksLikeCharacterCard 只判断“是否为一个角色对象”的最小特征。带 name 的对象即视为候选，
// 缺少其余字段时交由必填校验报出具体字段名，而不是在形态归一阶段被静默丢弃。
func looksLikeCharacterCard(raw json.RawMessage) bool {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return false
	}
	_, hasName := obj["name"]
	return hasName
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if len(result) == 0 || result[len(result)-1] != value {
			result = append(result, value)
		}
	}
	return result
}
