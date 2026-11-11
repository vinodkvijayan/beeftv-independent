package modelcatalog

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

const maxAdminChannelModelBatchDeleteCount = 100

func validateChannelModelTierCapabilities(tiers []model.ChannelModelVariant, rawCapabilityConfig string, capability string) error {
	if capability != "video" {
		return nil
	}
	config, err := DecodeModelCapabilityConfig(rawCapabilityConfig)
	if err != nil || config == nil || config.Video == nil {
		return kernel.BadAuthRequest("The video model capability configuration is invalid and the variant specifications cannot be verified.")
	}
	resolutionSupported := make(map[string]bool, len(config.Video.Resolutions))
	for _, resolution := range config.Video.Resolutions {
		resolutionSupported[normalizeChannelModelTierResolution(resolution)] = true
	}
	durationSupported := make(map[int]bool, len(config.Video.Duration.Values))
	for _, seconds := range config.Video.Duration.Values {
		durationSupported[seconds] = true
	}
	for _, tier := range tiers {
		if tier.Resolution != "*" && !resolutionSupported[normalizeChannelModelTierResolution(tier.Resolution)] {
			return kernel.BadAuthRequest("Variant resolutions are not supported by this video model:" + tier.Resolution)
		}
		if tier.VideoSeconds == 0 {
			continue
		}
		if !videoDurationSupported(config.Video) {
			continue
		}
		if config.Video.Duration.Selection == "enum" && !durationSupported[tier.VideoSeconds] {
			return kernel.BadAuthRequest(fmt.Sprintf("The variant duration %d seconds is not supported by this video model", tier.VideoSeconds))
		}
		if config.Video.Duration.Selection == "range" && !videoDurationAllowed(config.Video.Duration, tier.VideoSeconds) {
			return kernel.BadAuthRequest(fmt.Sprintf("The variant duration %d seconds is not supported by this video model", tier.VideoSeconds))
		}
	}
	return nil
}

func normalizeChannelModelTierSelector(capability string, input ChannelModelVariantRequest) (map[string]string, string, int, error) {
	selector := make(map[string]string, len(input.Selector)+3)
	for rawKey, rawValue := range input.Selector {
		key := strings.TrimSpace(rawKey)
		value := strings.TrimSpace(rawValue)
		if key == "" || value == "" {
			continue
		}
		switch key {
		case "operation":
			value = strings.ToLower(value)
		case "quality", "size":
			value = strings.ToLower(value)
			if value == "auto" || value == "any" {
				value = "*"
			}
		case "vquality":
			value = normalizeChannelModelTierResolution(value)
		case "videoSeconds":
			seconds, err := strconv.Atoi(value)
			if err != nil || seconds < 0 {
				return nil, "", 0, kernel.BadAuthRequest("Video variant duration must be a non-negative integer")
			}
			if seconds == 0 {
				continue
			}
			value = strconv.Itoa(seconds)
		case "imageCount":
			count, err := strconv.Atoi(value)
			if err != nil || count < 0 {
				return nil, "", 0, kernel.BadAuthRequest("The number of reference images must be a non-negative integer")
			}
			if count == 0 {
				continue
			}
			value = strconv.Itoa(count)
		default:
			return nil, "", 0, kernel.BadAuthRequest("Model variants do not support specification fields:" + key)
		}
		selector[key] = value
	}
	if capability == "video" {
		if _, exists := selector["vquality"]; !exists {
			if resolution := normalizeChannelModelTierResolution(input.Resolution); resolution != "*" {
				selector["vquality"] = resolution
			}
		}
		if _, exists := selector["videoSeconds"]; !exists && input.VideoSeconds > 0 {
			selector["videoSeconds"] = strconv.Itoa(input.VideoSeconds)
		}
	} else if input.Resolution != "" && normalizeChannelModelTierResolution(input.Resolution) != "*" {
		return nil, "", 0, kernel.BadAuthRequest("Non-video models cannot use the video resolution variant")
	} else if input.VideoSeconds != 0 {
		return nil, "", 0, kernel.BadAuthRequest("Non-video models cannot use the video duration variant")
	}
	for _, key := range []string{"quality", "size"} {
		if _, exists := selector[key]; exists && capability != "image" {
			return nil, "", 0, kernel.BadAuthRequest("Only picture models can be pressed" + key + " Configuration variants")
		}
	}
	if _, exists := selector["vquality"]; exists && capability != "video" {
		return nil, "", 0, kernel.BadAuthRequest("Only video models can configure variants by resolution")
	}
	if _, exists := selector["videoSeconds"]; exists && capability != "video" {
		return nil, "", 0, kernel.BadAuthRequest("Only video models can configure variants by duration")
	}
	if _, exists := selector["imageCount"]; exists && capability != "video" {
		return nil, "", 0, kernel.BadAuthRequest("Only video models can configure variants by number of reference images")
	}
	resolution := "*"
	if value := selector["vquality"]; value != "" {
		resolution = value
	}
	videoSeconds := 0
	if value := selector["videoSeconds"]; value != "" {
		videoSeconds, _ = strconv.Atoi(value)
	}
	return selector, resolution, videoSeconds, nil
}

func normalizeChannelModelTierResolution(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || value == "*" || strings.EqualFold(value, "any") {
		return "*"
	}
	normalized := normalizeModelRequestOption("vquality", value)
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(normalized)))
}

func videoTestDefaults(profile *VideoCapabilityConfig) (string, string) {
	if profile == nil {
		return "16:9", "720"
	}
	ratio := strings.TrimSpace(profile.DefaultRatio)
	if ratio == "" && len(profile.Ratios) > 0 {
		ratio = strings.TrimSpace(profile.Ratios[0])
	}
	if ratio == "" {
		ratio = "16:9"
	}
	resolution := strings.TrimSpace(profile.DefaultResolution)
	if resolution == "" && len(profile.Resolutions) > 0 {
		resolution = strings.TrimSpace(profile.Resolutions[0])
	}
	if resolution == "" {
		resolution = "720"
	}
	return ratio, resolution
}

func imageTestDefaults(profile *ImageCapabilityConfig) (string, string) {
	if profile == nil {
		return "1024x1024", "auto"
	}
	size := ""
	if profile.Size.Parameter != "none" {
		size = strings.TrimSpace(profile.Size.Default)
	}
	quality := ""
	if profile.Quality.Supported {
		quality = strings.TrimSpace(profile.Quality.Default)
	}
	return size, quality
}

func normalizeAdminChannelModelDeleteIDs(values []string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	if len(result) == 0 {
		return nil, kernel.BadAuthRequest("Please select at least one channel model to delete")
	}
	if len(result) > maxAdminChannelModelBatchDeleteCount {
		return nil, kernel.BadAuthRequest("A maximum of 100 channel models can be deleted at a time")
	}
	return result, nil
}

func retiredChannelModelKeys(raw string) map[string]bool {
	var values []string
	_ = json.Unmarshal([]byte(raw), &values)
	result := make(map[string]bool, len(values))
	for _, value := range values {
		if key := channelModelCatalogKey(value); key != "" {
			result[key] = true
		}
	}
	return result
}

func channelModelCatalogKey(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "models/"))
}

func protocolCapabilityFromMetadata(metadata ProtocolMeta) string {
	return strings.TrimSpace(metadata.PrimaryCapability)
}

func NormalizeChannelModelContract(lookup ProtocolLookup, channel *model.ModelChannel, req ChannelModelRequest) (string, string, string, model.ChannelInterfaceType, error) {
	modelKey := strings.TrimPrefix(strings.TrimSpace(req.ModelKey), "models/")
	if modelKey == "" {
		return "", "", "", "", kernel.BadAuthRequest("Please fill in the model ID")
	}
	providerModelKey := strings.TrimPrefix(strings.TrimSpace(req.ProviderModelKey), "models/")
	if providerModelKey == "" {
		providerModelKey = modelKey
	}
	capability := normalizeCapability(req.Capability)
	if capability == "" {
		return "", "", "", "", kernel.BadAuthRequest("Please select model capabilities")
	}
	if lookup == nil {
		return "", "", "", "", kernel.BadAuthRequest("Please select a valid model request protocol")
	}
	meta, ok := lookup(strings.TrimSpace(req.Protocol))
	if !ok || !meta.Enabled || meta.UnavailableReason != "" {
		return "", "", "", "", kernel.BadAuthRequest("Please select a valid model request protocol")
	}
	protocol := model.ChannelInterfaceType(meta.ID)
	if expected := protocolCapabilityFromMetadata(meta); expected != "" && expected != capability {
		return "", "", "", "", kernel.BadAuthRequest("Model capabilities do not match request protocol")
	}
	if channel != nil && (protocol == model.ChannelInterfaceVolcengineJiMengImage || protocol == model.ChannelInterfaceVolcengineJiMengVideo) && (strings.TrimSpace(channel.APIKey) == "" || strings.TrimSpace(channel.SecretKey) == "") {
		return "", "", "", "", kernel.BadAuthRequest("Jimeng official agreement requires first configuring the Access Key and Secret Key in the channel")
	}
	return modelKey, providerModelKey, capability, protocol, nil
}

func NormalizeChannelModelVariants(req ChannelModelRequest, capability string, protocol model.ChannelInterfaceType, fallbackProviderModelKey string) ([]model.ChannelModelVariant, error) {
	_ = protocol
	inputs := req.Variants
	if len(inputs) == 0 {
		enabled := true
		inputs = []ChannelModelVariantRequest{{
			Resolution: "*", VideoSeconds: 0, ProviderModelKey: fallbackProviderModelKey, Enabled: &enabled,
		}}
	}
	result := make([]model.ChannelModelVariant, 0, len(inputs))
	seen := make(map[string]bool, len(inputs))
	for _, input := range inputs {
		selector, resolution, videoSeconds, selectorErr := normalizeChannelModelTierSelector(capability, input)
		if selectorErr != nil {
			return nil, selectorErr
		}
		_, key, keyErr := model.CanonicalSKUSelector(selector)
		if keyErr != nil {
			return nil, keyErr
		}
		if seen[key] {
			return nil, kernel.BadAuthRequest("Only one upstream variant can be configured for the same operation and specification combination")
		}
		seen[key] = true
		enabled := input.Enabled == nil || *input.Enabled
		result = append(result, model.ChannelModelVariant{
			SelectorKey:      key,
			SelectorJSON:     key,
			Selector:         selector,
			Resolution:       resolution,
			VideoSeconds:     videoSeconds,
			ProviderModelKey: strings.TrimPrefix(strings.TrimSpace(kernel.FirstNonEmpty(input.ProviderModelKey, fallbackProviderModelKey)), "models/"),
			Enabled:          enabled,
		})
	}
	return result, nil
}

func CascadeUpstreamRename(tiers []model.ChannelModelVariant, previousProviderModelKey, providerModelKey string) []model.ChannelModelVariant {
	previousProviderModelKey = strings.TrimPrefix(strings.TrimSpace(previousProviderModelKey), "models/")
	providerModelKey = strings.TrimPrefix(strings.TrimSpace(providerModelKey), "models/")
	if previousProviderModelKey == "" || providerModelKey == "" || previousProviderModelKey == providerModelKey {
		return tiers
	}
	for index := range tiers {
		if strings.TrimPrefix(strings.TrimSpace(tiers[index].ProviderModelKey), "models/") == previousProviderModelKey {
			tiers[index].ProviderModelKey = providerModelKey
		}
	}
	return tiers
}

func ValidateChannelModelTierCapabilities(tiers []model.ChannelModelVariant, rawCapabilityConfig string, capability string) error {
	return validateChannelModelTierCapabilities(tiers, rawCapabilityConfig, capability)
}

func NormalizeChannelModelTierSelector(capability string, input ChannelModelVariantRequest) (map[string]string, string, int, error) {
	return normalizeChannelModelTierSelector(capability, input)
}

func NormalizeChannelModelTierResolution(raw string) string {
	return normalizeChannelModelTierResolution(raw)
}

func VideoTestDefaults(profile *VideoCapabilityConfig) (string, string) {
	return videoTestDefaults(profile)
}

func ImageTestDefaults(profile *ImageCapabilityConfig) (string, string) {
	return imageTestDefaults(profile)
}

func NormalizeAdminChannelModelDeleteIDs(values []string) ([]string, error) {
	return normalizeAdminChannelModelDeleteIDs(values)
}

func RetiredChannelModelKeys(raw string) map[string]bool {
	return retiredChannelModelKeys(raw)
}

func ChannelModelCatalogKey(value string) string {
	return channelModelCatalogKey(value)
}

func ProtocolCapabilityFromMetadata(metadata ProtocolMeta) string {
	return protocolCapabilityFromMetadata(metadata)
}
