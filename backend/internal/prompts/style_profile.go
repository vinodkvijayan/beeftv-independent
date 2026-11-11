package prompts

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const maxUserStyleProfiles = 200

type StyleProfileRequest struct {
	ProfileJSON string `json:"profileJson"`
}

type StyleProfileFavoriteRequest struct {
	Favorite bool `json:"favorite"`
}

type StyleProfileDocument struct {
	SchemaVersion   int                 `json:"schemaVersion"`
	PresetID        string              `json:"presetId"`
	Title           string              `json:"title"`
	Description     string              `json:"description"`
	Tags            []string            `json:"tags"`
	Prompt          string              `json:"prompt"`
	NegativePrompt  string              `json:"negativePrompt"`
	CoverURL        string              `json:"coverUrl"`
	SourceProfileID string              `json:"sourceProfileId"`
	Selection       map[string]string   `json:"selection,omitempty"`
	Assets          []StyleProfileAsset `json:"assets"`
	ExecutionPolicy string              `json:"executionPolicy"`
	Source          string              `json:"source"`
	Revision        int                 `json:"revision"`
}

type StyleProfileAsset struct {
	ID                   string                       `json:"id"`
	Kind                 string                       `json:"kind"`
	Provider             string                       `json:"provider"`
	Title                string                       `json:"title"`
	Enabled              *bool                        `json:"enabled"`
	SourceID             string                       `json:"sourceId"`
	SourceURL            string                       `json:"sourceUrl"`
	Model                string                       `json:"model"`
	Version              string                       `json:"version"`
	BaseModels           []string                     `json:"baseModels"`
	TriggerWords         []string                     `json:"triggerWords"`
	PromptFragment       string                       `json:"promptFragment"`
	Weight               *float64                     `json:"weight"`
	Parameters           *StyleProfileAssetParameters `json:"parameters"`
	ReferenceURLs        []string                     `json:"referenceUrls"`
	ReferenceResourceIDs []string                     `json:"referenceResourceIds"`
	Status               string                       `json:"status"`
	License              *StyleProfileAssetLicense    `json:"license,omitempty"`
}

type StyleProfileAssetParameters struct {
	Sampler string   `json:"sampler"`
	Steps   *int     `json:"steps"`
	CFG     *float64 `json:"cfg"`
	Size    string   `json:"size"`
}

type StyleProfileAssetLicense struct {
	Commercial *bool  `json:"commercial,omitempty"`
	Note       string `json:"note,omitempty"`
	Source     string `json:"source,omitempty"`
	CapturedAt string `json:"capturedAt,omitempty"`
}

func (s *Service) ListStyleProfiles(userID string) ([]model.StyleProfile, error) {
	return s.repo.StyleProfiles(userID)
}

func (s *Service) CreateStyleProfile(userID string, req StyleProfileRequest) (model.StyleProfile, error) {
	count, err := s.repo.StyleProfileCount(userID)
	if err != nil {
		return model.StyleProfile{}, err
	}
	if count >= maxUserStyleProfiles {
		return model.StyleProfile{}, kernel.BadAuthRequest("Save up to 200 My Styles")
	}
	normalized, document, err := normalizeUserStyleProfileJSON(req.ProfileJSON, "", 1)
	if err != nil {
		return model.StyleProfile{}, kernel.BadAuthRequest(err.Error())
	}
	now := time.Now()
	profile := model.StyleProfile{
		ID: kernel.NewID(), UserID: userID, Name: strings.TrimSpace(document.Title), Description: strings.TrimSpace(document.Description),
		CoverURL: strings.TrimSpace(document.CoverURL), TagsJSON: MustStyleProfileJSON(document.Tags), Favorite: false,
		Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	normalized, document, err = normalizeUserStyleProfileJSON(normalized, profile.ID, profile.Revision)
	if err != nil {
		return model.StyleProfile{}, kernel.BadAuthRequest(err.Error())
	}
	profile.ProfileJSON = normalized
	profile.Name = document.Title
	if err := s.repo.CreateStyleProfile(&profile); err != nil {
		return model.StyleProfile{}, err
	}
	return profile, nil
}

func (s *Service) UpdateStyleProfile(userID string, id string, req StyleProfileRequest) (model.StyleProfile, error) {
	profile, err := s.repo.StyleProfileForUser(userID, id)
	if err != nil {
		return model.StyleProfile{}, err
	}
	normalized, document, err := normalizeUserStyleProfileJSON(req.ProfileJSON, profile.ID, profile.Revision+1)
	if err != nil {
		return model.StyleProfile{}, kernel.BadAuthRequest(err.Error())
	}
	profile.Name = document.Title
	profile.Description = document.Description
	profile.CoverURL = document.CoverURL
	profile.TagsJSON = MustStyleProfileJSON(document.Tags)
	profile.ProfileJSON = normalized
	profile.Revision++
	profile.UpdatedAt = time.Now()
	if err := s.repo.UpdateStyleProfile(profile); err != nil {
		return model.StyleProfile{}, err
	}
	return *profile, nil
}

func (s *Service) SetStyleProfileFavorite(userID string, id string, favorite bool) error {
	return s.repo.SetStyleProfileFavorite(userID, id, favorite)
}

func (s *Service) TouchStyleProfile(userID string, id string) error {
	return s.repo.TouchStyleProfile(userID, id, time.Now())
}

func (s *Service) DeleteStyleProfile(userID string, id string) error {
	return s.repo.DeleteStyleProfile(userID, id)
}

func ValidateStyleProfileJSON(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if len([]byte(trimmed)) > 256*1024 {
		return "", errors.New("Project style asset allocation is too large")
	}
	var profile StyleProfileDocument
	if err := json.Unmarshal([]byte(trimmed), &profile); err != nil {
		return "", errors.New("Project style asset configuration is not legal JSON")
	}
	if profile.SchemaVersion != 1 || strings.TrimSpace(profile.PresetID) == "" || strings.TrimSpace(profile.Title) == "" || strings.TrimSpace(profile.Prompt) == "" || profile.Revision < 1 {
		return "", errors.New("Project style asset configuration is missing necessary fields")
	}
	if profile.Assets == nil {
		return "", errors.New("The project style asset configuration is missing the assets array")
	}
	if len(profile.Assets) > 20 {
		return "", errors.New("Project style execution assets can be bound to a maximum of 20 assets")
	}
	if profile.ExecutionPolicy != "" && profile.ExecutionPolicy != "compatible-fallback" && profile.ExecutionPolicy != "strict-assets" {
		return "", errors.New("Project style execution strategy is not supported")
	}
	if profile.Source != "builtin" && profile.Source != "user" && profile.Source != "external" {
		return "", errors.New("The project style source is not supported")
	}
	if len(profile.Selection) > 20 {
		return "", errors.New("Up to 20 items of auxiliary annotations for project style")
	}
	for key, value := range profile.Selection {
		if strings.TrimSpace(key) == "" || len([]rune(key)) > 64 || len([]rune(value)) > 200 {
			return "", errors.New("The project style auxiliary annotation format is invalid")
		}
	}
	assetIDs := make(map[string]struct{}, len(profile.Assets))
	for _, asset := range profile.Assets {
		if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.Title) == "" || strings.TrimSpace(asset.Provider) == "" || !styleProfileValueAllowed(asset.Kind, "lora", "template", "reference", "prompt") || !styleProfileValueAllowed(asset.Status, "draft", "validated", "unavailable") {
			return "", errors.New("Project style execution asset field is incomplete")
		}
		if _, exists := assetIDs[asset.ID]; exists {
			return "", errors.New("Project style execution asset ID cannot be repeated")
		}
		assetIDs[asset.ID] = struct{}{}
		if asset.Weight != nil && (*asset.Weight < 0 || *asset.Weight > 2) {
			return "", errors.New("LoRA weight must be between 0 and 2")
		}
		if len(asset.BaseModels) > 20 {
			return "", errors.New("A single style asset can declare up to 20 compatible models.")
		}
		if len(asset.TriggerWords) > 50 || len(asset.ReferenceURLs) > 20 || len(asset.ReferenceResourceIDs) > 20 {
			return "", errors.New("The project style execution asset has too many trigger words or reference images")
		}
		if asset.Parameters != nil {
			if asset.Parameters.Steps != nil && (*asset.Parameters.Steps < 1 || *asset.Parameters.Steps > 200) {
				return "", errors.New("Style asset Steps must be between 1 and 200")
			}
			if asset.Parameters.CFG != nil && (*asset.Parameters.CFG < 0 || *asset.Parameters.CFG > 50) {
				return "", errors.New("Style asset CFG must be between 0 and 50")
			}
		}
		if asset.Status == "validated" {
			switch asset.Kind {
			case "lora":
				if strings.TrimSpace(asset.SourceID) == "" && strings.TrimSpace(asset.SourceURL) == "" {
					return "", errors.New("Verified LoRA must fill in the source asset ID or URL")
				}
			case "template", "prompt":
				if strings.TrimSpace(asset.PromptFragment) == "" && len(NonEmptyStyleProfileStrings(asset.TriggerWords)) == 0 {
					return "", errors.New("The verified template or prompt word module must fill in the prompt word content")
				}
			case "reference":
				if len(NonEmptyStyleProfileStrings(asset.ReferenceURLs)) == 0 && len(NonEmptyStyleProfileStrings(asset.ReferenceResourceIDs)) == 0 {
					return "", errors.New("The verified reference picture group must be bound to the reference picture")
				}
			}
		}
	}
	return trimmed, nil
}

func normalizeUserStyleProfileJSON(value string, presetID string, revision int64) (string, StyleProfileDocument, error) {
	validated, err := ValidateStyleProfileJSON(value)
	if err != nil {
		return "", StyleProfileDocument{}, err
	}
	var document StyleProfileDocument
	if err := json.Unmarshal([]byte(validated), &document); err != nil {
		return "", StyleProfileDocument{}, errors.New("User style configuration parsing failed")
	}
	if len([]rune(strings.TrimSpace(document.Title))) > 80 {
		return "", StyleProfileDocument{}, errors.New("Style name can be up to 80 characters long")
	}
	if len([]rune(strings.TrimSpace(document.Description))) > 500 {
		return "", StyleProfileDocument{}, errors.New("Style introduction up to 500 words")
	}
	if len(document.Tags) > 20 {
		return "", StyleProfileDocument{}, errors.New("Up to 20 style tags")
	}
	if len([]byte(document.CoverURL)) > 4096 || len([]byte(document.NegativePrompt)) > 64*1024 {
		return "", StyleProfileDocument{}, errors.New("Style cover or negative prompt too large")
	}
	if coverURL := strings.ToLower(strings.TrimSpace(document.CoverURL)); coverURL != "" && !strings.HasPrefix(coverURL, "http://") && !strings.HasPrefix(coverURL, "https://") && !strings.HasPrefix(coverURL, "/") && !strings.HasPrefix(coverURL, "data:image/") {
		return "", StyleProfileDocument{}, errors.New("Style cover only supports http(s), site path or image Data URL")
	}
	if strings.TrimSpace(presetID) != "" {
		document.PresetID = strings.TrimSpace(presetID)
	}
	document.SourceProfileID = document.PresetID
	document.Source = "user"
	document.Revision = int(revision)
	document.Title = strings.TrimSpace(document.Title)
	document.Description = strings.TrimSpace(document.Description)
	document.CoverURL = strings.TrimSpace(document.CoverURL)
	document.NegativePrompt = strings.TrimSpace(document.NegativePrompt)
	document.Tags = NonEmptyStyleProfileStrings(document.Tags)
	encoded, err := json.Marshal(document)
	if err != nil {
		return "", StyleProfileDocument{}, errors.New("User style configuration serialization failed")
	}
	if len(encoded) > 256*1024 {
		return "", StyleProfileDocument{}, errors.New("User style configuration is too large")
	}
	return string(encoded), document, nil
}

func ValidateStyleProfilePreset(presetID string, profileJSON string) error {
	if strings.TrimSpace(profileJSON) == "" {
		return nil
	}
	var profile StyleProfileDocument
	if err := json.Unmarshal([]byte(profileJSON), &profile); err != nil {
		return errors.New("Project style asset configuration analysis failed")
	}
	if strings.TrimSpace(presetID) == "" || strings.TrimSpace(profile.PresetID) != strings.TrimSpace(presetID) {
		return errors.New("Project style defaults are inconsistent with structured snapshots")
	}
	return nil
}

func MustStyleProfileJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func NonEmptyStyleProfileStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func styleProfileValueAllowed(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}
