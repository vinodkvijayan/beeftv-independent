package generation

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

// ValidateMediaTransport uses the same installed contract as execution, without
// reading file bytes, uploading anything, or creating a provider task.
func ValidateMediaTransport(ctx context.Context, input Input) error {
	if managedConnection(input.Config) {
		return nil
	}
	for kind, transport := range input.Config.ReferenceMediaTransport {
		if (kind != "image" && kind != "video" && kind != "audio") || (transport != "" && transport != "auto" && transport != "inline" && transport != "url" && transport != "link") {
			return &kernel.AppError{Status: 400, Code: 400, Reason: "invalid_reference_transport", Message: "The reference material transmission method is invalid, please choose again."}
		}
	}
	if err := validateBytePlusVideoTransport(ctx, input); err != nil {
		return err
	}
	policy := MediaHydrationPolicyFor(ctx, input)
	runtime, _ := RuntimeFromContext(ctx)
	var storageChecked, storageEnabled bool
	var blocked []string
	var required []map[string]any
	groups := []struct {
		label string
		kind  string
		items []Media
	}{
		{"Reference pictures", "image", input.ReferenceImages}, {"Reference video", "video", input.ReferenceVideos}, {"Reference audio", "audio", input.ReferenceAudios},
	}
	if input.Mask != nil {
		groups = append(groups, struct {
			label string
			kind  string
			items []Media
		}{"Mask", "image", []Media{*input.Mask}})
	}
	for _, group := range groups {
		kind := group.kind
		if group.label == "Mask" {
			kind = "mask"
		}
		groupPolicy := mediaPolicyForKind(ctx, input, kind, policy)
		if !groupPolicy.RequireURL || groupPolicy.KeepLocal {
			continue
		}
		for i, media := range group.items {
			if group.kind == "video" && isBytePlusVideoInput(input) && !strings.HasPrefix(media.StorageKey, "resource:") {
				continue // The BytePlus check also accepts asset:// identifiers.
			}
			if strings.HasPrefix(media.StorageKey, "resource:") {
				if runtime.Resources != nil && !runtime.Resources.LocalMode() {
					continue // Hosted resources are resolved by the owned resource port.
				}
				if !groupPolicy.ManualURL && runtime.ReferenceStorage != nil {
					if !storageChecked {
						var err error
						storageEnabled, err = runtime.ReferenceStorage.Enabled()
						if err != nil {
							return kernel.WrapAppError(500, "The reference material object storage configuration cannot be read, please check the storage settings.", err)
						}
						storageChecked = true
					}
					if storageEnabled {
						continue
					}
				}
			} else if address, err := url.Parse(strings.TrimSpace(media.URL)); err == nil && address.Scheme == "https" && address.Hostname() != "" && address.User == nil {
				continue
			}
			blocked = append(blocked, fmt.Sprintf("%s %d", group.label, i+1))
			required = append(required, map[string]any{"kind": group.kind, "index": i, "mask": group.label == "Mask"})
		}
	}
	if len(blocked) == 0 {
		return nil
	}
	return &kernel.AppError{Status: 400, Code: 400, Reason: "reference_media_requires_url", Details: map[string]any{"requiredReferences": required}, Message: "The current channel requires online material links:" + strings.Join(blocked, "、") + "Cannot be read directly. Please replace with an accessible HTTPS link, or switch to a channel that supports local content"}
}

// BytePlus accepts inline images and audio, but reference videos need an online
// URL or asset ID. A local resource would otherwise be hydrated to base64.
func isBytePlusVideoInput(input Input) bool {
	if !model.IsVolcengineArkVideoProtocol(model.ChannelInterfaceType(input.Config.InterfaceType)) {
		return false
	}
	endpoint, err := url.Parse(strings.TrimSpace(input.Config.BaseURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(endpoint.Hostname()))
	return host == "ark.ap-southeast.bytepluses.com" ||
		(strings.HasPrefix(host, "ark.") && (strings.HasSuffix(host, ".bytepluses.com") || strings.HasSuffix(host, ".byteplusapi.com")))
}

func validateBytePlusVideoTransport(ctx context.Context, input Input) error {
	if !isBytePlusVideoInput(input) {
		return nil
	}
	if input.Config.ChannelID == "" && input.Config.ReferenceMediaTransport["video"] == "inline" && len(input.ReferenceVideos) > 0 {
		return &kernel.AppError{Status: 400, Code: 400, Reason: "invalid_reference_transport", Message: "BytePlus reference video does not support direct transmission of materials. Please change the video transmission method to automatic, object storage or online link."}
	}
	runtime, _ := RuntimeFromContext(ctx)
	var blocked []string
	var required []map[string]any
	for index, media := range input.ReferenceVideos {
		if strings.HasPrefix(media.StorageKey, "resource:") && !mediaPolicyForKind(ctx, input, "video", MediaHydrationPolicyFor(ctx, input)).ManualURL {
			if runtime.Resources != nil && !runtime.Resources.LocalMode() {
				continue
			}
			if runtime.ReferenceStorage != nil {
				enabled, err := runtime.ReferenceStorage.Enabled()
				if err != nil {
					return kernel.WrapAppError(500, "The reference material object storage configuration cannot be read, please check the storage settings.", err)
				}
				if enabled {
					continue
				}
			}
		}
		address, err := url.Parse(strings.TrimSpace(media.URL))
		remote := err == nil && address.Scheme == "https" && address.Hostname() != "" && address.User == nil
		asset := err == nil && address.Scheme == "asset" && address.Hostname() != "" && address.User == nil && address.Path == "" && address.RawQuery == "" && address.Fragment == ""
		if !strings.HasPrefix(media.StorageKey, "resource:") && (remote || asset) {
			continue
		}
		blocked = append(blocked, fmt.Sprintf("Reference video %d", index+1))
		required = append(required, map[string]any{"kind": "video", "index": index})
	}
	if len(blocked) == 0 {
		return nil
	}
	return &kernel.AppError{Status: 400, Code: 400, Reason: "reference_media_requires_url", Details: map[string]any{"requiredReferences": required}, Message: "BytePlus cannot read local reference video directly:" + strings.Join(blocked, "、") + ". Please use a publicly accessible HTTPS video link or BytePlus asset ID (asset://) instead, or switch to a channel that supports local video. Pictures and audio can continue to use local files"}
}
