package generation

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/protocol"
)

const defaultProtocolMediaUploadMaxBytes = int64(20 << 20)

// prepareProtocolMediaUploads executes declarative reference-media pre-uploads
// before a plugin adapter renders its generation request. Any upload failure stops
// in preparation and is never Ambiguous Dispatch.
func prepareProtocolMediaUploads(ctx context.Context, userID string, input *Input) error {
	if input == nil {
		return nil
	}
	if len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 && len(input.ReferenceAudios) == 0 && input.Mask == nil {
		return nil
	}
	adapter, ok := ProtocolAdapterForContext(EnsureOfficialProtocolAdapter(ctx, input.Config.InterfaceType), input.Config.InterfaceType)
	if !ok {
		return nil
	}
	meta := adapter.Metadata()
	if meta.MediaUpload == nil {
		return nil
	}
	upload := *meta.MediaUpload
	auth := protocol.ManifestAuth{Type: "bearer", Field: "apiKey"}
	if authAdapter, ok := adapter.(protocol.MediaAuthAdapter); ok {
		if resolvedAuth := authAdapter.MediaAuth(); strings.TrimSpace(resolvedAuth.Type) != "" {
			auth = resolvedAuth
		}
	}

	prepared := *input
	prepared.ReferenceImages = append([]Media(nil), input.ReferenceImages...)
	prepared.ReferenceVideos = append([]Media(nil), input.ReferenceVideos...)
	prepared.ReferenceAudios = append([]Media(nil), input.ReferenceAudios...)
	if input.Mask != nil {
		maskCopy := *input.Mask
		prepared.Mask = &maskCopy
	}

	for _, group := range BeefTVSeedanceMediaGroups(&prepared) {
		for index := range group.items {
			if err := uploadOneProtocolMedia(ctx, userID, input.Config, meta, upload, auth, group.kind, index, &group.items[index]); err != nil {
				return err
			}
		}
	}
	if prepared.Mask != nil {
		if err := uploadOneProtocolMedia(ctx, userID, input.Config, meta, upload, auth, "image", len(prepared.ReferenceImages), prepared.Mask); err != nil {
			return err
		}
	}
	*input = prepared
	return nil
}

func uploadOneProtocolMedia(
	ctx context.Context,
	userID string,
	config Config,
	meta protocol.Metadata,
	upload protocol.ManifestMediaUpload,
	auth protocol.ManifestAuth,
	kind string,
	index int,
	media *Media,
) error {
	if media == nil {
		return nil
	}
	rawInline := strings.TrimSpace(firstNonEmpty(media.DataURL, media.URL))
	if !strings.HasPrefix(media.StorageKey, "resource:") && !strings.HasPrefix(rawInline, "data:") {
		rawURL := strings.TrimSpace(media.URL)
		if IsPublicMediaURL(rawURL) {
			if _, err := outbound.ValidateOutboundURL(rawURL); err != nil {
				return RequestPreparationError{Cause: err}
			}
			media.URL = rawURL
			media.DataURL = ""
			media.StorageKey = ""
			return nil
		}
		return RequestPreparationError{Cause: errors.New("The current model requires accessible reference material links or local materials, please re-import. This time the generation has not started yet")}
	}

	data, mimeType, err := readProtocolMediaUploadBytes(ctx, userID, kind, *media, upload.MaxBytes)
	if err != nil {
		return RequestPreparationError{Cause: err}
	}
	targetConfig, uploadPath, err := protocolMediaUploadTarget(config, meta, upload)
	if err != nil {
		return RequestPreparationError{Cause: err}
	}

	uploadCtx := referenceUploadStage(withReferenceUpload(ctx, ReferenceUploadMeta{Kind: kind, Index: index + 1}), "put")
	uploadCtx, _ = beginReferenceProgress(uploadCtx, referenceMediaLabel(kind, index), int64(len(data)))
	filename := strings.TrimSpace(media.Name)
	if filename == "" {
		filename = mediaFilename(*media, mimeType)
	}
	spec := protocol.RequestSpec{
		Method:      "POST",
		Path:        uploadPath,
		OriginPath:  true,
		ContentType: "multipart/form-data",
		Files: []protocol.RequestFilePart{{
			Name:     defaultString(strings.TrimSpace(upload.Field), "file"),
			Filename: filename,
			MIMEType: mimeType,
			Data:     data,
		}},
		Auth: auth,
	}
	raw, err := ExecuteProtocolRequest(uploadCtx, targetConfig, spec)
	if err != nil {
		return RequestPreparationError{Cause: referenceUploadError(uploadCtx, err)}
	}
	link, err := upload.ParseResponse(raw)
	if err != nil {
		return RequestPreparationError{Cause: referenceUploadError(uploadCtx, err)}
	}
	if !IsPublicMediaURL(link) {
		return RequestPreparationError{Cause: referenceUploadError(uploadCtx, errors.New("Material upload did not return a valid public address"))}
	}
	if _, err := outbound.ValidateOutboundURL(link); err != nil {
		return RequestPreparationError{Cause: referenceUploadError(uploadCtx, err)}
	}
	media.URL = link
	media.DataURL = ""
	media.StorageKey = ""
	media.Bytes = int64(len(data))
	media.MimeType = mimeType
	return nil
}

func readProtocolMediaUploadBytes(ctx context.Context, userID string, kind string, media Media, maxBytes int64) ([]byte, string, error) {
	limit := maxBytes
	if limit <= 0 {
		limit = defaultProtocolMediaUploadMaxBytes
	}
	if media.Bytes > limit {
		return nil, "", errors.New("The reference material exceeds the size limit of the service provider")
	}
	var (
		data     []byte
		mimeType string
	)
	if strings.HasPrefix(media.StorageKey, "resource:") {
		runtime, ok := RuntimeFromContext(ctx)
		if !ok || runtime.Resources == nil {
			return nil, "", errors.New("Failed to read task reference resources: the resource port is not connected")
		}
		resource, body, err := runtime.Resources.Open(userID, strings.TrimPrefix(media.StorageKey, "resource:"))
		if err != nil {
			return nil, "", fmt.Errorf("Failed to read task reference resources: %w", err)
		}
		defer body.Close()
		data, err = io.ReadAll(io.LimitReader(body, limit+1))
		if err != nil {
			return nil, "", fmt.Errorf("Failed to read task reference resources: %w", err)
		}
		mimeType = NormalizedMediaMIMEType(firstNonEmpty(media.MimeType, resource.MimeType), data)
	} else {
		raw := strings.TrimSpace(firstNonEmpty(media.DataURL, media.URL))
		decodedMIME, decodedData, err := DecodeProviderDataURL(raw)
		if err != nil {
			return nil, "", err
		}
		data = decodedData
		mimeType = NormalizedMediaMIMEType(firstNonEmpty(media.MimeType, decodedMIME), data)
	}
	if int64(len(data)) > limit {
		return nil, "", errors.New("The reference material exceeds the size limit of the service provider")
	}
	if len(data) == 0 {
		return nil, "", errors.New("The reference material is empty, please re-import it")
	}
	if kind == "image" {
		if err := ValidateImageArtifact(data, mimeType); err != nil {
			return nil, "", err
		}
	}
	return data, mimeType, nil
}

func protocolMediaUploadTarget(config Config, meta protocol.Metadata, upload protocol.ManifestMediaUpload) (Config, string, error) {
	if rawURL := strings.TrimSpace(upload.URL); rawURL != "" && useManifestUploadURL(config.BaseURL, meta.BaseURL, rawURL) {
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return Config{}, "", fmt.Errorf("The reference material upload address is invalid.")
		}
		target := config
		target.BaseURL = parsed.Scheme + "://" + parsed.Host
		path := parsed.Path
		if path == "" {
			path = "/"
		}
		return target, path, nil
	}
	uploadPath := strings.TrimSpace(upload.Path)
	if uploadPath == "" && strings.TrimSpace(upload.URL) != "" {
		if parsed, err := url.Parse(strings.TrimSpace(upload.URL)); err == nil {
			uploadPath = parsed.Path
		}
	}
	if !strings.HasPrefix(uploadPath, "/") {
		return Config{}, "", fmt.Errorf("Reference material upload path is invalid")
	}
	return config, uploadPath, nil
}

func useManifestUploadURL(configBaseURL, manifestBaseURL, uploadURL string) bool {
	effectiveBase := strings.TrimSpace(configBaseURL)
	if effectiveBase == "" {
		effectiveBase = strings.TrimSpace(manifestBaseURL)
	}
	cfgParsed, cfgErr := url.Parse(effectiveBase)
	upParsed, upErr := url.Parse(strings.TrimSpace(uploadURL))
	if cfgErr != nil || upErr != nil || cfgParsed.Host == "" || upParsed.Host == "" || upParsed.Scheme != "https" {
		return false
	}
	cfgHost := strings.ToLower(cfgParsed.Hostname())
	upHost := strings.ToLower(upParsed.Hostname())
	if upHost == "" || upHost == "localhost" || strings.HasSuffix(upHost, ".localhost") || strings.HasSuffix(upHost, ".local") || net.ParseIP(upHost) != nil || !strings.Contains(upHost, ".") {
		return false
	}
	return cfgHost == upHost || strings.HasSuffix(cfgHost, "."+upHost) || strings.HasSuffix(upHost, "."+cfgHost)
}
