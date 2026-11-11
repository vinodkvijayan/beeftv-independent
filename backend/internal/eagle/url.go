package eagle

import (
	"net/url"
	"path/filepath"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

func validateBaseURL(raw string) (*url.URL, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		value = DefaultBaseURL
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, kernel.BadAuthRequest("Eagle address must be http://127.0.0.1:41595")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return nil, kernel.BadAuthRequest("In order to avoid the risk of intranet proxy, the Eagle plug-in only allows connection to the local address")
	}
	if parsed.Port() != "41595" {
		return nil, kernel.BadAuthRequest("Currently the Eagle plug-in only supports the default port 41595")
	}
	parsed.Path = ""
	return parsed, nil
}

func isMediaDataURL(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) < len("data:,") || !strings.EqualFold(trimmed[:5], "data:") {
		return false
	}
	comma := strings.IndexByte(trimmed, ',')
	if comma <= len("data:") {
		return false
	}
	mediaType := strings.TrimSpace(trimmed[len("data:"):comma])
	if semicolon := strings.IndexByte(mediaType, ';'); semicolon >= 0 {
		mediaType = mediaType[:semicolon]
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	return strings.HasPrefix(mediaType, "image/") || strings.HasPrefix(mediaType, "video/") || strings.HasPrefix(mediaType, "audio/")
}

func validItemID(itemID string) bool {
	if itemID == "" || itemID != strings.TrimSpace(itemID) {
		return false
	}
	if itemID == "." || itemID == ".." {
		return false
	}
	if strings.ContainsAny(itemID, `/\:?*&<>|`) {
		return false
	}
	if filepath.Base(itemID) != itemID || filepath.Clean(itemID) != itemID {
		return false
	}
	for _, char := range itemID {
		if char < 32 || char == 127 {
			return false
		}
	}
	return true
}
