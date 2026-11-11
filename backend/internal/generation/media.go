package generation

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func HydrateMedia(ctx context.Context, userID string, input *Input, policy MediaHydrationPolicy) error {
	if input == nil {
		return nil
	}
	groups := [][]Media{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios}
	for kind, group := range groups {
		groupPolicy := mediaPolicyForKind(ctx, *input, []string{"image", "video", "audio"}[kind], policy)
		for index := range group {
			if err := HydrateOne(ctx, userID, &group[index], groupPolicy); err != nil {
				return fmt.Errorf("%s %d：%w", []string{"Reference pictures", "Reference video", "Reference audio"}[kind], index+1, err)
			}
		}
	}
	if input.Mask != nil {
		return HydrateOne(ctx, userID, input.Mask, mediaPolicyForKind(ctx, *input, "mask", policy))
	}
	return nil
}

func HydrateOne(ctx context.Context, userID string, media *Media, policy MediaHydrationPolicy) error {
	if media == nil {
		return nil
	}
	if !strings.HasPrefix(media.StorageKey, "resource:") {
		if policy.RequireURL && (strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") || strings.HasPrefix(strings.TrimSpace(media.URL), "data:")) {
			return errors.New("The current channel does not support the direct use of local materials. Please use an accessible HTTPS material link, or choose a channel that supports local materials.")
		}
		return nil
	}
	runtime, ok := RuntimeFromContext(ctx)
	if !ok || runtime.Resources == nil {
		return errors.New("Failed to read task reference resources: the resource port is not connected")
	}
	resourceID := strings.TrimPrefix(media.StorageKey, "resource:")
	resource, err := runtime.Resources.Lookup(userID, resourceID)
	if err != nil {
		return fmt.Errorf("Failed to read task reference resources: %w", err)
	}
	if resource.Status != "ready" {
		return errors.New("Task reference resources have not been uploaded yet")
	}
	if runtime.Resources.LocalMode() && resource.UsesObjectStorage() {
		return errors.New("The local workspace has detected old remote material records, please re-import them to the local resource directory.")
	}
	if policy.KeepLocal {
		media.URL = ""
		media.DataURL = ""
		applyResourceMetadata(media, resource)
		return nil
	}
	if runtime.Resources.LocalMode() && policy.RequireURL && !policy.ManualURL && runtime.ReferenceStorage != nil {
		enabled, err := runtime.ReferenceStorage.Enabled()
		if err != nil {
			return RequestPreparationError{Cause: ReferenceStoragePreparationError{Cause: err}}
		}
		if enabled {
			link, err := runtime.ReferenceStorage.Upload(ctx, userID, resourceID)
			if err != nil {
				return RequestPreparationError{Cause: ReferenceStoragePreparationError{Cause: err}}
			}
			media.URL, media.DataURL = link, ""
			applyResourceMetadata(media, resource)
			return nil
		}
	}
	if policy.PreferHTTPS {
		if httpsURL, err := runtime.Resources.HTTPSPublicURL(resource, time.Now().Add(ResourceURLTTL)); err == nil {
			media.URL = httpsURL
			media.DataURL = ""
			applyResourceMetadata(media, resource)
			return nil
		}
	}
	useObjectURL := policy.RequireURL || (policy.PreferURL && resource.UsesObjectStorage())
	if useObjectURL {
		if runtime.Resources.LocalMode() && policy.RequireURL {
			return errors.New("The current model protocol requires public network material addresses. Please use a model that supports embedded materials in the local workspace instead.")
		}
		signedURL, err := runtime.Resources.PublicURL(resource, time.Now().Add(ResourceURLTTL))
		if err != nil {
			return fmt.Errorf("Failed to generate reference material address: %w", err)
		}
		media.URL = signedURL
		media.DataURL = ""
		applyResourceMetadata(media, resource)
		return nil
	}
	if strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
		return nil
	}
	resource, body, err := runtime.Resources.Open(userID, resourceID)
	if err != nil {
		return fmt.Errorf("Failed to read task reference resources: %w", err)
	}
	defer body.Close()
	resourceLimit := MaxResponseBytes
	if runtime.Limits != nil {
		limit, limitErr := runtime.Limits.ResourceUploadBytes(ctx)
		if limitErr != nil {
			return limitErr
		}
		resourceLimit = limit
	}
	data, err := io.ReadAll(io.LimitReader(body, resourceLimit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > resourceLimit {
		return fmt.Errorf("The task reference resource exceeds %s", formatStorageLimit(resourceLimit))
	}
	mimeType := NormalizedMediaMIMEType(firstNonEmpty(media.MimeType, resource.MimeType), data)
	media.DataURL = DataURL(mimeType, data)
	media.MimeType = mimeType
	media.Bytes = int64(len(data))
	media.Width = resource.Width
	media.Height = resource.Height
	if resource.DurationMs > 0 {
		media.DurationMs = resource.DurationMs
	}
	return nil
}

func applyResourceMetadata(media *Media, resource ResourceInfo) {
	media.MimeType = firstNonEmpty(media.MimeType, resource.MimeType)
	media.Bytes = resource.Size
	if resource.Width > 0 {
		media.Width = resource.Width
	}
	if resource.Height > 0 {
		media.Height = resource.Height
	}
	if resource.DurationMs > 0 {
		media.DurationMs = resource.DurationMs
	}
}

func MediaBytes(media Media) ([]byte, string, error) {
	value := media.DataURL
	if value == "" {
		value = media.URL
	}
	if !strings.HasPrefix(value, "data:") {
		return nil, "", errors.New("The backend task queue requires local reference material in the form of a data URL")
	}
	header, encoded, ok := strings.Cut(value, ",")
	if !ok {
		return nil, "", errors.New("data URL format error")
	}
	mimeType := strings.TrimPrefix(strings.Split(strings.TrimPrefix(header, "data:"), ";")[0], " ")
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, "", err
	}
	return raw, NormalizedMediaMIMEType(defaultString(mimeType, media.Type), raw), nil
}

func NormalizedMediaMIMEType(declared string, data []byte) string {
	declared = strings.TrimSpace(strings.Split(declared, ";")[0])
	if declared != "" && declared != "application/octet-stream" {
		return declared
	}
	detected := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
	return defaultString(detected, "application/octet-stream")
}

func DataURL(mimeType string, data []byte) string {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + strings.Split(mimeType, ";")[0] + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func WithSystemPrompt(config Config, prompt string) string {
	systemPrompt := strings.TrimSpace(config.SystemPrompt)
	if systemPrompt == "" {
		return prompt
	}
	return systemPrompt + "\n\n" + prompt
}

func OpenAIImageInputURL(media Media) (string, error) {
	value := strings.TrimSpace(media.DataURL)
	if strings.HasPrefix(value, "data:image/") {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("The MIME type of the reference image is invalid, please re-read or upload the image")
	}
	value = strings.TrimSpace(media.URL)
	if strings.HasPrefix(value, "data:image/") || IsPublicMediaURL(value) {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("The MIME type of the reference image is invalid, please re-read or upload the image")
	}
	return "", errors.New("OpenAI text multi-modal reference images require public URL or base64 data URL")
}

func OpenAIVideoInputURL(media Media) (string, error) {
	value := strings.TrimSpace(media.DataURL)
	if strings.HasPrefix(value, "data:video/") {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("The reference video MIME type is invalid, please re-read or upload the video")
	}
	value = strings.TrimSpace(media.URL)
	if strings.HasPrefix(value, "data:video/") || IsPublicMediaURL(value) {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("The reference video MIME type is invalid, please re-read or upload the video")
	}
	return "", errors.New("Text multi-modal reference video requires public URL or base64 data URL")
}

func openAIImageInputURL(media Media) (string, error) { return OpenAIImageInputURL(media) }
func openAIVideoInputURL(media Media) (string, error) { return OpenAIVideoInputURL(media) }
