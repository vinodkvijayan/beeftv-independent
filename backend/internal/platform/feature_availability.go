package platform

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const featureAvailabilitySettingKey = "feature_availability"

const (
	FeatureShortDrama            = "shortDrama"
	FeatureTaskCenter            = "taskCenter"
	FeatureCustomChannels        = "customChannels"
	FeatureFrontendModels        = "frontendModels"
	FeaturePluginCenter          = "pluginCenter"
	FeatureSystemPlugins         = "systemPluginsVisibleToUsers"
	FeatureTimelineTranscription = "timelineTranscription"
)

type FeatureAvailability struct {
	ShortDramaEnabled            bool `json:"shortDramaEnabled"`
	TaskCenterEnabled            bool `json:"taskCenterEnabled"`
	CustomChannelsEnabled        bool `json:"customChannelsEnabled"`
	FrontendModelsEnabled        bool `json:"frontendModelsEnabled"`
	PluginCenterEnabled          bool `json:"pluginCenterEnabled"`
	SystemPluginsVisibleToUsers  bool `json:"systemPluginsVisibleToUsers"`
	TimelineTranscriptionEnabled bool `json:"timelineTranscriptionEnabled"`
}

type PublicFeatureAvailability struct {
	FeatureAvailability
	Configured bool      `json:"configured"`
	UpdatedBy  string    `json:"updatedBy,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
}

func DefaultFeatureAvailability() FeatureAvailability {
	// 缺少配置代表尚未由运维接管；前台模型需要明确配置后才开放。
	return FeatureAvailability{
		ShortDramaEnabled:            true,
		TaskCenterEnabled:            true,
		CustomChannelsEnabled:        true,
		FrontendModelsEnabled:        false,
		PluginCenterEnabled:          true,
		SystemPluginsVisibleToUsers:  true,
		TimelineTranscriptionEnabled: true,
	}
}

func (s *Service) FeatureAvailability() (*PublicFeatureAvailability, error) {
	if s != nil && s.localMode {
		return publicFeatureAvailability(nil, DefaultFeatureAvailability()), nil
	}
	return s.hostedFeatureAvailability()
}

func (s *Service) hostedFeatureAvailability() (*PublicFeatureAvailability, error) {
	setting, value, err := s.readFeatureAvailability()
	if err != nil {
		return nil, err
	}
	return publicFeatureAvailability(setting, value), nil
}

func (s *Service) FeatureEnabled(feature string) (bool, error) {
	if s != nil && s.localMode {
		switch feature {
		case FeatureFrontendModels:
			return false, nil
		case FeatureShortDrama, FeatureTaskCenter, FeatureCustomChannels, FeaturePluginCenter, FeatureSystemPlugins, FeatureTimelineTranscription:
			return true, nil
		}
	}
	_, value, err := s.readFeatureAvailability()
	if err != nil {
		return false, err
	}
	switch feature {
	case FeatureShortDrama:
		return value.ShortDramaEnabled, nil
	case FeatureTaskCenter:
		return value.TaskCenterEnabled, nil
	case FeatureCustomChannels:
		return value.CustomChannelsEnabled, nil
	case FeatureFrontendModels:
		return value.FrontendModelsEnabled, nil
	case FeaturePluginCenter:
		return value.PluginCenterEnabled, nil
	case FeatureSystemPlugins:
		return value.SystemPluginsVisibleToUsers, nil
	case FeatureTimelineTranscription:
		return value.TimelineTranscriptionEnabled, nil
	default:
		return false, errors.New("Unknown function open configuration")
	}
}

func (s *Service) RequireFeature(feature string) error {
	enabled, err := s.FeatureEnabled(feature)
	if err != nil {
		return err
	}
	if enabled {
		return nil
	}
	if s != nil && s.localMode {
		return kernel.Forbidden("This feature is not available in the current workspace")
	}
	switch feature {
	case FeatureShortDrama:
		return kernel.Forbidden("Short play creation is not available yet")
	case FeatureTaskCenter:
		return kernel.Forbidden("The mission center is not open yet")
	case FeatureCustomChannels:
		return kernel.Forbidden("Custom channels are not yet open")
	case FeatureFrontendModels:
		return kernel.Forbidden("The front-end model directory is not yet open")
	case FeaturePluginCenter:
		return kernel.Forbidden("The plug-in center is not open yet")
	case FeatureSystemPlugins:
		return kernel.Forbidden("System plug-ins are not yet displayed to ordinary users")
	case FeatureTimelineTranscription:
		return kernel.Forbidden("Subtitle transcription is not available yet")
	default:
		return kernel.Forbidden("This function is not available yet")
	}
}

func (s *Service) readFeatureAvailability() (*model.SystemSetting, FeatureAvailability, error) {
	setting, err := s.repo.SystemSetting(featureAvailabilitySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, DefaultFeatureAvailability(), nil
	}
	if err != nil {
		return nil, FeatureAvailability{}, err
	}
	// 以全开放默认值为基底，避免已有三字段配置在升级后因缺少新字段而意外关闭功能。
	value := DefaultFeatureAvailability()
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, FeatureAvailability{}, errors.New("The function opening configuration format is invalid")
	}
	return setting, value, nil
}

func publicFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	result := &PublicFeatureAvailability{FeatureAvailability: value, Configured: setting != nil}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

// PublicFeatureAvailability projects the persisted feature flags without
// exposing the platform service internals to compatibility callers.
func ProjectFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	return publicFeatureAvailability(setting, value)
}
