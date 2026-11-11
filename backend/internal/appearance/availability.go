package appearance

import (
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) resolveAvailable(value Setting) Setting {
	for _, slot := range []string{AssetLogo, AssetDarkLogo, AssetVideo, AssetPoster} {
		id := resourceID(value, slot)
		if id == "" || s.assetAvailable(slot, id) {
			continue
		}
		switch slot {
		case AssetLogo:
			value.LogoResourceID = ""
		case AssetDarkLogo:
			value.DarkLogoResourceID = ""
		case AssetVideo:
			value.AuthVideoResourceID = ""
		case AssetPoster:
			value.AuthVideoPosterResourceID = ""
		}
	}
	return value
}

func (s *Service) assetAvailable(slot string, resourceID string) bool {
	if s == nil || s.resources == nil {
		return false
	}
	resource, err := s.resources.Resource(resourceID)
	if err != nil || validateResourceType(slot, resource) != nil {
		return false
	}
	if resource.Provider != "local" {
		return true
	}
	if s.files == nil {
		return false
	}
	return s.files.Exists(resource.ObjectKey)
}

func validateResourceType(slot string, resource *model.Resource) error {
	if resource == nil || resource.Status != model.ResourceStatusReady {
		return kernel.BadAuthRequest("Appearance resources have not been uploaded yet")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(resource.MimeType, ";")[0]))
	allowed := allowedMIMETypes(slot)
	if _, exists := allowed[mimeType]; !exists {
		return kernel.BadAuthRequest("Appearance resource file type is not supported")
	}
	if slot == AssetVideo && resource.Kind != "video" {
		return kernel.BadAuthRequest("The landing page brand video must be a video resource")
	}
	if slot != AssetVideo && resource.Kind != "image" {
		return kernel.BadAuthRequest("Logo and video cover must be image resources")
	}
	return nil
}
