package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	arkPrivateAssetAPIVersion = "2024-01-01"
	arkPrivateAssetGroupType  = "AIGC"
	arkPrivateAssetStatusNew  = "creating"
	arkPrivateAssetStatusWait = "processing"
	arkPrivateAssetStatusLive = "active"
	arkPrivateAssetStatusFail = "failed"
	arkPrivateAssetPollLimit  = 3 * time.Minute
)

func (s *Service) prepareArkPrivateAssetReferences(ctx context.Context, userID string, input *canvasGenerationInput) error {
	// 可信素材 asset:// 仅方舟视频协议支持；Agent Plan Seedream 等图片渠道不能上传或改写。
	if input == nil || input.Mode != "video" || !isArkPrivateAssetVideoConfig(input.Config) || !parseBool(input.Config.ArkPrivateAssetUpload, true) {
		return nil
	}
	// The desktop profile owns the source media locally. Never copy a local
	// resource into Ark's hosted trusted-asset service as a side effect of
	// generation; the normal provider path will handle compatible inline media.
	if s.IsLocalMode() {
		return nil
	}
	var collections = []*[]providerMedia{&input.ReferenceImages, &input.ReferenceVideos, &input.ReferenceAudios}
	hasOwnedReference := false
	for _, list := range collections {
		for _, reference := range *list {
			if arkPrivateAssetResourceID(reference) != "" {
				hasOwnedReference = true
				break
			}
		}
	}
	if !hasOwnedReference {
		return nil
	}
	settingRecord, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return err
	}
	automaticSyncEnabled, err := arkPrivateAssetAutomaticSyncEnabled(setting)
	if err != nil || !automaticSyncEnabled {
		return err
	}
	if taskID := taskExecutionID(ctx); taskID != "" {
		_ = s.repo.UpdateTaskProgress(taskID, "Synchronized Ark’s credible materials", 36)
	}
	for _, list := range collections {
		for index := range *list {
			reference := &(*list)[index]
			if strings.HasPrefix(strings.TrimSpace(reference.URL), "asset://") {
				continue
			}
			resourceID := arkPrivateAssetResourceID(*reference)
			if resourceID == "" {
				continue
			}
			resource, err := s.Resource(userID, resourceID)
			if err != nil {
				return fmt.Errorf("Failed to read Ark reference material: %w", err)
			}
			if resource.Status != model.ResourceStatusReady {
				return errors.New("Ark reference material has not been uploaded yet")
			}
			if arkPrivateAssetTypeForMime(resource.MimeType) == "" {
				return errors.New("Ark's trusted material library only supports uploading pictures, videos or audio reference materials")
			}
			assetID, err := s.ensureArkPrivateAsset(ctx, userID, resource, settingRecord, &setting)
			if err != nil {
				return err
			}
			reference.URL = "asset://" + assetID
			reference.DataURL = ""
		}
	}
	if taskID := taskExecutionID(ctx); taskID != "" {
		_ = s.repo.UpdateTaskProgress(taskID, "Call the generated model", 40)
	}
	return nil
}

// SyncResourceToArkPrivateAsset 是用户显式触发的参考素材预同步入口。
func (s *Service) SyncResourceToArkPrivateAsset(ctx context.Context, actor *model.User, resourceID string) (*ArkPrivateAssetSyncResult, error) {
	if s.IsLocalMode() {
		return nil, BadAuthRequest("The local workspace does not support synchronizing materials to the cloud trusted material library")
	}
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		return nil, BadAuthRequest("Please select the picture material to be synchronized")
	}
	resource, err := s.Resource(actor.ID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("The picture material does not exist or you have no permission to access it.")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("The picture material has not been uploaded yet")
	}
	if arkPrivateAssetTypeForMime(resource.MimeType) == "" {
		return nil, BadAuthRequest("Ark's trusted material library only supports uploading pictures, videos or audio materials")
	}
	settingRecord, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	if !setting.Enabled || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return nil, BadAuthRequest("The Ark trusted material library has not been configured yet. Please let the administrator fill in the enabled IAM AK/SK in the Ark material library settings.")
	}
	if _, err := s.ensureArkPrivateAsset(ctx, actor.ID, resource, settingRecord, &setting); err != nil {
		return nil, err
	}
	return &ArkPrivateAssetSyncResult{ResourceID: resource.ID, Status: arkPrivateAssetStatusLive}, nil
}

func (s *Service) ensureArkPrivateAsset(ctx context.Context, userID string, resource *model.Resource, settingRecord *model.SystemSetting, setting *arkPrivateAssetSettingValue) (string, error) {
	binding, err := s.repo.ArkPrivateAssetBinding(resource.ID, setting.ProjectName)
	if err == nil {
		if shouldResumeArkPrivateAssetPolling(binding) {
			// 素材已创建成功，只是旧版 GetAsset 参数错误导致轮询失败；恢复轮询，
			// 不重新上传素材，也不会创建重复的方舟资产。
			binding.Status = arkPrivateAssetStatusWait
			binding.Error = ""
			if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
				return "", err
			}
			return s.waitForArkPrivateAsset(ctx, binding, setting)
		}
		if !shouldRetryArkPrivateAssetBinding(binding) {
			return s.waitForArkPrivateAsset(ctx, binding, setting)
		}
		// 早期字段解析未识别方舟返回的 Id。仅重试尚未创建素材或素材组的记录，
		// 审核拒绝等真实业务失败仍保持终态，避免重复上传。
		binding.Status = arkPrivateAssetStatusNew
		binding.Error = ""
		if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
			return "", err
		}
	}
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
		binding = &model.ArkPrivateAssetBinding{
			ID:          newID(),
			UserID:      userID,
			ResourceID:  resource.ID,
			ProjectName: setting.ProjectName,
			Status:      arkPrivateAssetStatusNew,
		}
		created, err := s.repo.CreateArkPrivateAssetBinding(binding)
		if err != nil {
			return "", err
		}
		if !created {
			binding, err = s.repo.ArkPrivateAssetBinding(resource.ID, setting.ProjectName)
			if err != nil {
				return "", err
			}
			return s.waitForArkPrivateAsset(ctx, binding, setting)
		}
	}

	// 重试时复用已建成的素材组，避免管理员调整配置清空 DefaultGroupID 后重复建组。
	groupID := strings.TrimSpace(binding.AssetGroupID)
	if groupID == "" {
		groupID, err = s.ensureArkPrivateAssetGroup(ctx, settingRecord, setting)
		if err != nil {
			return "", s.failArkPrivateAssetBinding(binding, err)
		}
	}
	binding.AssetGroupID = groupID
	resourceURL, err := s.directResourceURL(resource, time.Now().Add(time.Hour))
	if err != nil {
		return "", s.failArkPrivateAssetBinding(binding, fmt.Errorf("Failed to generate temporary address of Ark material: %w", err))
	}
	assetType := arkPrivateAssetTypeForMime(resource.MimeType)
	if assetType == "" {
		assetType = "Image"
	}
	payload := map[string]interface{}{"GroupId": groupID, "URL": resourceURL, "AssetType": assetType, "Name": "ark-private-asset-" + resource.ID, "ProjectName": setting.ProjectName, "Moderation": map[string]interface{}{"Strategy": "Skip"}}
	response, err := callArkPrivateAssetAPI(ctx, *setting, "CreateAsset", payload)
	if isUnsupportedArkModerationParamError(err) {
		delete(payload, "Moderation")
		response, err = callArkPrivateAssetAPI(ctx, *setting, "CreateAsset", payload)
	}
	if err != nil {
		return "", s.failArkPrivateAssetBinding(binding, fmt.Errorf("Failed to upload Ark's trusted material: %w", err))
	}
	assetID := arkPrivateAssetResponseField(response, "AssetId", "AssetID", "asset_id", "Id", "ID", "id")
	if assetID == "" {
		return "", s.failArkPrivateAssetBinding(binding, errors.New("Ark material library does not return material ID"))
	}
	binding.ArkAssetID = assetID
	binding.Status = arkPrivateAssetStatusWait
	binding.Error = ""
	if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
		return "", err
	}
	return s.waitForArkPrivateAsset(ctx, binding, setting)
}

func (s *Service) ensureArkPrivateAssetGroup(ctx context.Context, settingRecord *model.SystemSetting, setting *arkPrivateAssetSettingValue) (string, error) {
	if strings.TrimSpace(setting.DefaultGroupID) != "" {
		return setting.DefaultGroupID, nil
	}
	response, err := callArkPrivateAssetAPI(ctx, *setting, "CreateAssetGroup", map[string]interface{}{
		"Name":        "ark-private-assets",
		"Description": "Automatically imported Ark trustworthy materials",
		"GroupType":   arkPrivateAssetGroupType,
		"ProjectName": setting.ProjectName,
	})
	if err != nil {
		return "", fmt.Errorf("Failed to create Ark material group: %w", err)
	}
	groupID := arkPrivateAssetResponseField(response, "GroupId", "GroupID", "group_id", "Id", "ID", "id")
	if groupID == "" {
		return "", errors.New("Ark material library does not return material group ID")
	}
	setting.DefaultGroupID = groupID
	if settingRecord == nil {
		settingRecord = &model.SystemSetting{Key: arkPrivateAssetSettingKey}
	}
	if err := s.saveArkPrivateAssetSetting(settingRecord, *setting); err != nil {
		return "", err
	}
	return groupID, nil
}

func (s *Service) waitForArkPrivateAsset(ctx context.Context, binding *model.ArkPrivateAssetBinding, setting *arkPrivateAssetSettingValue) (string, error) {
	deadline := time.Now().Add(arkPrivateAssetPollLimit)
	for time.Now().Before(deadline) {
		switch strings.ToLower(strings.TrimSpace(binding.Status)) {
		case arkPrivateAssetStatusLive:
			if strings.TrimSpace(binding.ArkAssetID) == "" {
				return "", errors.New("Ark's trusted material records are missing material IDs")
			}
			return binding.ArkAssetID, nil
		case arkPrivateAssetStatusFail:
			return "", fmt.Errorf("Ark's trusted material review failed: %s", defaultString(binding.Error, "Please change the avatar material that you have the right to use and try again."))
		}
		if binding.ArkAssetID != "" {
			response, err := callArkPrivateAssetAPI(ctx, *setting, "GetAsset", map[string]interface{}{
				"Id":          binding.ArkAssetID,
				"ProjectName": setting.ProjectName,
			})
			if err != nil {
				return "", fmt.Errorf("Failed to query the review status of Ark's trusted materials: %w", err)
			}
			status := strings.ToLower(arkPrivateAssetResponseField(response, "Status", "status"))
			switch status {
			case "active":
				binding.Status = arkPrivateAssetStatusLive
				binding.Error = ""
				if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
					return "", err
				}
				return binding.ArkAssetID, nil
			case "failed":
				message := arkPrivateAssetResponseField(response, "ErrorMessage", "Message", "message")
				binding.Status = arkPrivateAssetStatusFail
				binding.Error = defaultString(message, "Ark failed to pass material review")
				if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
					return "", err
				}
				return "", fmt.Errorf("Ark's trusted material review failed: %s", binding.Error)
			case "":
				return "", errors.New("Ark’s trusted material status is missing")
			}
		}
		if err := sleepContext(ctx, 2*time.Second); err != nil {
			return "", err
		}
		latest, err := s.repo.ArkPrivateAssetBinding(binding.ResourceID, binding.ProjectName)
		if err != nil {
			return "", err
		}
		binding = latest
	}
	return "", errors.New("The review of Ark's trusted material has timed out, please resubmit the video task later.")
}

func isUnsupportedArkModerationParamError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	if !strings.Contains(lower, "moderation") {
		return false
	}
	return strings.Contains(lower, "invalidparameter") ||
		strings.Contains(lower, "unknownparameter") ||
		strings.Contains(lower, "unsupported") ||
		strings.Contains(lower, "unrecognized") ||
		strings.Contains(lower, "not support")
}

func (s *Service) failArkPrivateAssetBinding(binding *model.ArkPrivateAssetBinding, reason error) error {
	binding.Status = arkPrivateAssetStatusFail
	binding.Error = reason.Error()
	if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
		return err
	}
	return reason
}

// 素材库控制面调用不是模型生成；不能继承视频任务的请求审计或账单上下文，
// 否则创建素材组、上传素材和审核查询会被误记为真实的视频生成调用。

// doJSON 对非 2xx 响应只按状态码生成通用提示（401/403 会被说成“模型服务鉴权失败”），
// 方舟把真实原因（如 SubscriptionRequired）放在响应体的 ResponseMetadata.Error 里，必须还原。

// arkPrivateAssetUpstreamDetail 提取方舟控制面响应里 ResponseMetadata.Error 的 Code/Message，
// 用于把上游真实失败原因透传给用户；没有上游错误时返回空串。
