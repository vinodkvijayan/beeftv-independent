package asset

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

var userAssetKinds = map[string]struct{}{
	"text":   {},
	"image":  {},
	"video":  {},
	"audio":  {},
	"model":  {},
	"entity": {},
}

func AssetFromJSON(userID string, raw json.RawMessage) (model.Asset, error) {
	if err := ValidateSyncedPayload(raw, "Material"); err != nil {
		return model.Asset{}, err
	}
	var payload struct {
		ID               string `json:"id"`
		FolderID         string `json:"folderId"`
		Kind             string `json:"kind"`
		Category         string `json:"category"`
		Status           string `json:"status"`
		PrimaryVersionID string `json:"primaryVersionId"`
		Title            string `json:"title"`
		CreatedAt        string `json:"createdAt"`
		UpdatedAt        string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return model.Asset{}, kernel.BadAuthRequest("Material data format error")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = kernel.NewID()
	}
	if utf8.RuneCountInString(id) > model.AssetIDMaxLength {
		return model.Asset{}, kernel.BadAuthRequest("Asset ID cannot exceed 80 characters")
	}
	primaryVersionID := strings.TrimSpace(payload.PrimaryVersionID)
	if utf8.RuneCountInString(primaryVersionID) > 36 {
		return model.Asset{}, kernel.BadAuthRequest("Asset master version ID cannot exceed 36 characters")
	}
	if err := ValidateDocument(raw); err != nil {
		return model.Asset{}, err
	}
	// Keep the document identity identical to the database key without decoding
	// extension fields into a lossy, closed payload type.
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		return model.Asset{}, kernel.BadAuthRequest("Material data format error")
	}
	document["id"], _ = json.Marshal(id)
	normalized, err := json.Marshal(document)
	if err != nil {
		return model.Asset{}, kernel.BadAuthRequest("Material data format error")
	}
	category := model.NormalizeAssetCategory(model.AssetCategory(payload.Category), payload.Kind)
	status := model.AssetVersionStatus(strings.TrimSpace(payload.Status))
	if status == "" {
		status = model.AssetVersionStatusConfirmed
	}
	return model.Asset{
		ID:               id,
		UserID:           userID,
		FolderID:         strings.TrimSpace(payload.FolderID),
		Kind:             strings.TrimSpace(payload.Kind),
		Category:         category,
		Status:           status,
		PrimaryVersionID: primaryVersionID,
		Title:            strings.TrimSpace(payload.Title),
		PayloadJSON:      string(normalized),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

func ValidateDocument(raw json.RawMessage) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return kernel.BadAuthRequest("Material data format error")
	}
	kind, err := requiredJSONStringField(object, "kind")
	if err != nil {
		return err
	}
	kind = strings.TrimSpace(kind)
	if _, ok := userAssetKinds[kind]; !ok {
		return kernel.BadAuthRequest("Unsupported material types")
	}
	if _, err := requiredJSONStringField(object, "title"); err != nil {
		return err
	}
	if _, err := requiredJSONStringField(object, "coverUrl"); err != nil {
		return err
	}
	if err := validateUserAssetTags(object); err != nil {
		return err
	}
	data, err := requiredJSONObjectField(object, "data")
	if err != nil {
		return err
	}
	return validateUserAssetData(kind, data)
}

func validateUserAssetTags(object map[string]json.RawMessage) error {
	raw, ok := object["tags"]
	if !ok {
		return kernel.BadAuthRequest("The material is missing tags field")
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return kernel.BadAuthRequest("Material tags must be a string array")
	}
	var tags []string
	if err := json.Unmarshal(raw, &tags); err != nil {
		return kernel.BadAuthRequest("Material tags must be a string array")
	}
	return nil
}

func validateUserAssetData(kind string, data map[string]json.RawMessage) error {
	switch kind {
	case "text":
		_, err := requiredJSONStringField(data, "content")
		return err
	case "image":
		if err := requireMediaLocator(data, "dataUrl", "pictures"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "width"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "height"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "mimeType")
	case "video":
		if err := requireMediaLocator(data, "url", "video"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "width"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "height"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "mimeType")
	case "audio":
		if err := requireMediaLocator(data, "url", "Audio"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "mimeType")
	case "model":
		if err := requireMediaLocator(data, "url", "model"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		if err := requireNonEmptyJSONString(data, "mimeType"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "fileName")
	case "entity":
		return requireJSONObjectFieldPresent(data, "definition")
	default:
		return kernel.BadAuthRequest("Unsupported material types")
	}
}

func requireMediaLocator(data map[string]json.RawMessage, primaryKey string, label string) error {
	primary, err := optionalJSONStringField(data, primaryKey)
	if err != nil {
		return err
	}
	storageKey, err := optionalJSONStringField(data, "storageKey")
	if err != nil {
		return err
	}
	if strings.TrimSpace(primary) == "" && strings.TrimSpace(storageKey) == "" {
		return kernel.BadAuthRequest(label + "Material missing" + primaryKey + " or storageKey")
	}
	return nil
}

func requiredJSONStringField(object map[string]json.RawMessage, key string) (string, error) {
	raw, ok := object[key]
	if !ok {
		return "", kernel.BadAuthRequest("Material missing" + key + " Field")
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", kernel.BadAuthRequest("Material field" + key + " Must be a string")
	}
	return value, nil
}

func optionalJSONStringField(object map[string]json.RawMessage, key string) (string, error) {
	raw, ok := object[key]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", kernel.BadAuthRequest("Material field" + key + " Must be a string")
	}
	return value, nil
}

func requireNonEmptyJSONString(object map[string]json.RawMessage, key string) error {
	value, err := requiredJSONStringField(object, key)
	if err != nil {
		return err
	}
	if strings.TrimSpace(value) == "" {
		return kernel.BadAuthRequest("Material field" + key + " cannot be empty")
	}
	return nil
}

func requiredJSONNumberField(object map[string]json.RawMessage, key string) (float64, error) {
	raw, ok := object[key]
	if !ok {
		return 0, kernel.BadAuthRequest("Material missing" + key + " Field")
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return 0, kernel.BadAuthRequest("Material field" + key + " Must be a number")
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, kernel.BadAuthRequest("Material field" + key + " Must be a number")
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, kernel.BadAuthRequest("Material field" + key + " Must be a non-negative number")
	}
	return value, nil
}

func requiredJSONObjectField(object map[string]json.RawMessage, key string) (map[string]json.RawMessage, error) {
	raw, ok := object[key]
	if !ok {
		return nil, kernel.BadAuthRequest("Material missing" + key + " Field")
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(raw, &nested); err != nil || nested == nil {
		return nil, kernel.BadAuthRequest("Material field" + key + " Must be an object")
	}
	return nested, nil
}

func requireJSONObjectFieldPresent(object map[string]json.RawMessage, key string) error {
	_, err := requiredJSONObjectField(object, key)
	return err
}

var inlineMediaDataURLPrefixes = [...]string{"data:image/", "data:video/", "data:audio/"}

func ValidateSyncedPayload(raw json.RawMessage, label string) error {
	return ValidateSyncedPayloadWithLimit(raw, label, 4)
}

func ValidateSyncedPayloadWithLimit(raw json.RawMessage, label string, maxMB int) error {
	if maxMB > 0 && int64(len(raw)) > int64(maxMB)<<20 {
		return kernel.BadAuthRequest(label + "Data exceeds" + strconv.Itoa(maxMB) + "MB, please save the media files to resource storage first")
	}
	if !mayContainInlineMediaDataURL(raw) {
		return nil
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err == nil && ContainsInlineMediaDataURL(payload) {
		return kernel.BadAuthRequest(label + "The data contains embedded media, please upload it to resource storage first")
	}
	return nil
}

func mayContainInlineMediaDataURL(raw []byte) bool {
	if bytes.Contains(raw, []byte(`\u`)) || bytes.Contains(raw, []byte(`\U`)) {
		return true
	}
	for _, prefix := range inlineMediaDataURLPrefixes {
		if containsASCIIFold(raw, prefix) {
			return true
		}
	}
	return false
}

func containsASCIIFold(haystack []byte, needle string) bool {
	n := len(needle)
	if n == 0 || len(haystack) < n {
		return false
	}
	first := needle[0]
	firstUpper := first - ('a' - 'A')
	limit := len(haystack) - n
	for i := 0; i <= limit; i++ {
		b := haystack[i]
		if b != first && b != firstUpper {
			continue
		}
		match := true
		for j := 1; j < n; j++ {
			hb := haystack[i+j]
			if hb >= 'A' && hb <= 'Z' {
				hb += 'a' - 'A'
			}
			if hb != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func ContainsInlineMediaDataURL(value interface{}) bool {
	switch item := value.(type) {
	case string:
		text := strings.ToLower(strings.TrimSpace(item))
		for _, prefix := range inlineMediaDataURLPrefixes {
			if strings.HasPrefix(text, prefix) {
				return true
			}
		}
		return false
	case []interface{}:
		for _, child := range item {
			if ContainsInlineMediaDataURL(child) {
				return true
			}
		}
	case map[string]interface{}:
		for _, child := range item {
			if ContainsInlineMediaDataURL(child) {
				return true
			}
		}
	}
	return false
}

func parseClientTime(value string, fallback time.Time) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}
	return fallback
}
