package generation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

// Execute owns paid-generation orchestration: prompt templates, config,
// capability, hydration, workflow resume, placeholder resolution, then the
// mode-specific upstream call. Config, secrets and style stay on typed ports.
func Execute(ctx context.Context, input Input) (map[string]any, error) {
	runtime, _ := RuntimeFromContext(ctx)
	userID := strings.TrimSpace(runtime.Call.UserID)
	if strings.TrimSpace(input.Mode) == "" && (runtime.Call.TaskType == "canvas_video" || strings.HasPrefix(runtime.Call.TaskType, "video_")) {
		input.Mode = "video"
	}

	promptTemplateOperation := metadataString(input.Metadata, "promptTemplateOperation")
	if input.Mode != "video" && promptTemplateOperation != "" {
		if runtime.Prompt == nil {
			return nil, errors.New("Failed to compile user prompt word: prompt word port is not connected")
		}
		compiled, err := runtime.Prompt.Compile(userID, promptTemplateOperation, metadataStringValues(input.Metadata["promptTemplateVariables"]))
		if err != nil {
			return nil, fmt.Errorf("Failed to compile user prompt words: %w", err)
		}
		input.Prompt = compiled
	}
	if strings.TrimSpace(input.Prompt) == "" && !(input.Mode == "video" && strings.TrimSpace(metadataString(input.Metadata, "videoDraftTaskId")) != "") {
		return nil, errors.New("prompt is required")
	}

	if runtime.Config != nil {
		config, err := runtime.Config.Resolve(input.Config)
		if err != nil {
			return nil, err
		}
		input.Config = config
	} else if strings.TrimSpace(input.Config.ChannelID) != "" {
		return nil, errors.New("Unable to parse system channel configuration")
	}
	applyCanvasTextStreaming(runtime.Call.TaskType, &input)
	if input.Upscale != nil {
		if err := requireTaskRuntime(ctx); err != nil {
			return nil, err
		}
		return RunUpscaleTask(ctx, input)
	}

	if input.Mode == "image" && input.Metadata != nil && strings.TrimSpace(metadataString(input.Metadata, "styleProfileJson")) != "" {
		if runtime.Style == nil {
			return nil, errors.New("Project style execution configuration is invalid: the style port is not connected")
		}
		if err := runtime.Style.Apply(userID, runtime.Call.ProjectID, &input); err != nil {
			return nil, err
		}
	}

	if err := validatePreparedInput(ctx, input); err != nil {
		return nil, err
	}
	if err := requireTaskRuntime(ctx); err != nil {
		return nil, err
	}
	runtime, _ = RuntimeFromContext(ctx)

	if input.Mode == "image" && runtime.Config != nil {
		if err := runtime.Config.ApplyCapabilities(ctx, &input); err != nil {
			if ResumedProviderRequestID(ctx) == "" {
				return nil, RequestPreparationError{Cause: err}
			}
			return nil, err
		}
	}
	if input.Mode == "image" && managedConnection(input.Config) {
		return runManagedImageTask(ctx, input)
	}
	if input.Mode == "video" {
		client, unified, err := useManagedMediaEnvelope(ctx, input.Config, "video")
		if err != nil {
			return nil, err
		}
		if unified {
			return runManagedVideoTask(ctx, client, input)
		}
		if client != nil {
			ctx = context.WithValue(ctx, managedClientContextKey{}, client)
		}
	}

	resumed := ResumedProviderRequestID(ctx) != ""
	preparing := !resumed && hasReferenceMedia(input)
	if !resumed {
		if err := ValidateMediaTransport(ctx, input); err != nil {
			return nil, err
		}
		if preparing {
			if err := setExecutionStage(ctx, runtime, "Preparing reference materials"); err != nil {
				return nil, err
			}
		}
		if input.Mode == "video" || len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
			if err := HydrateVideoReferenceMetadata(ctx, userID, &input); err != nil {
				return nil, RequestPreparationError{Cause: err}
			}
		}
		if input.Mode == "video" {
			if runtime.Config != nil {
				if err := runtime.Config.ApplyCapabilities(ctx, &input); err != nil {
					return nil, err
				}
			}
		}
		if err := HydrateMedia(ctx, userID, &input, MediaHydrationPolicyFor(ctx, input)); err != nil {
			return nil, err
		}
		if runtime.Config != nil {
			if err := runtime.Config.SyncArkPrivateAssets(ctx, userID, &input); err != nil {
				return nil, err
			}
		}
		if err := PrepareBeefTVVideoReferences(ctx, input.Config, &input, ownedSeedanceMediaReader(ctx, userID)); err != nil {
			return nil, err
		}
		if err := prepareFullVideoReferences(ctx, &input, ownedFullVideoMediaReader(ctx, userID)); err != nil {
			return nil, err
		}
		if input.Mode == "video" && strings.TrimSpace(input.Config.ChannelID) != "" && input.VideoCapability != nil {
			if err := validateVideoTask(input.VideoCapability, input); err != nil {
				return nil, err
			}
		}
		if err := prepareProtocolMediaUploads(ctx, userID, &input); err != nil {
			return nil, err
		}
	}
	if input.Mode == "video" && strings.TrimSpace(input.Config.ChannelID) != "" && input.VideoCapability != nil && !resumed {
		if err := validateVideoTask(input.VideoCapability, input); err != nil {
			return nil, err
		}
	}
	if input.Mode == "text" && input.AgentRequests != nil {
		resolved, err := ResolveAgentResourcePlaceholders(input, true)
		if err != nil {
			return nil, err
		}
		input = resolved
	}

	if preparing {
		if runtime.ReferenceProgress != nil {
			runtime.ReferenceProgress.ClearReference()
		}
	}
	if preparing || (input.Mode == "video" && !resumed) {
		if err := setExecutionStage(ctx, runtime, "Submitting build task"); err != nil {
			return nil, err
		}
	}
	result, taskErr := dispatch(ctx, input)
	if taskErr == nil && input.Mode == "text" && promptTemplateOperation != "" {
		if runtime.Prompt == nil {
			return nil, errors.New("Prompt word result cannot be verified")
		}
		taskErr = runtime.Prompt.ValidateResult(promptTemplateOperation, result)
	}
	return result, taskErr
}

func dispatch(ctx context.Context, input Input) (map[string]any, error) {
	switch input.Mode {
	case "image":
		return RunImageTask(ctx, input)
	case "text":
		if input.AgentRequests != nil {
			return RunAgentToolTask(ctx, input)
		}
		return RunTextTask(ctx, input)
	case "video":
		return RunVideoTask(ctx, input)
	case "audio":
		return RunAudioTask(ctx, input)
	default:
		return nil, fmt.Errorf("Unsupported build mode: %s", input.Mode)
	}
}

func hasReferenceMedia(input Input) bool {
	return len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios) > 0 || input.Mask != nil
}

func setExecutionStage(ctx context.Context, runtime Runtime, stage string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if runtime.Stages != nil {
		return runtime.Stages.SetStage(ctx, stage)
	}
	return nil
}

func applyCanvasTextStreaming(taskType string, input *Input) {
	if input == nil || input.Mode != "text" || !strings.HasPrefix(strings.TrimSpace(taskType), "canvas_text") {
		return
	}
	requestedStream := input.TextOptions.Stream == nil || *input.TextOptions.Stream
	supportsStream := input.Config.CapabilityConfig == nil || input.Config.CapabilityConfig.Text == nil || input.Config.CapabilityConfig.Text.Streaming == nil || *input.Config.CapabilityConfig.Text.Streaming
	input.StreamText = requestedStream && supportsStream
}

func validatePreparedInput(ctx context.Context, input Input) error {
	if ((input.Mode == "image" || input.Mode == "video" || input.Mode == "audio") && managedConnection(input.Config)) || (input.Mode == "video" && IsBeefTVVideoConfig(ctx, input.Config)) {
		if strings.TrimSpace(input.Config.BaseURL) == "" || strings.TrimSpace(input.Config.APIKey) == "" || strings.TrimSpace(input.Config.Model) == "" {
			return errors.New("Backend build task is missing Base URL, API Key or model name")
		}
		return nil
	}
	if input.Config.APIFormat == "gemini" && input.Config.InterfaceType != string(model.ChannelInterfaceGeminiVeo) && input.Config.InterfaceType != string(model.ChannelInterfaceGeminiImage) {
		_, hasDeclarativeAgent := agentProtocolAdapterForContext(ctx, input.Config.InterfaceType)
		if input.AgentRequests == nil || !hasDeclarativeAgent {
			return errors.New("The backend task queue currently does not support this Gemini calling format. Please select the installed Gemini protocol plug-in.")
		}
	}
	missingKey := strings.TrimSpace(input.Config.APIKey) == "" && !interfaceNeedsNoKey(ctx, input.Config.InterfaceType)
	if strings.TrimSpace(input.Config.BaseURL) == "" || missingKey || strings.TrimSpace(input.Config.Model) == "" {
		return errors.New("Backend build task is missing Base URL, API Key or model name")
	}
	if err := validateInterfaceForContext(ctx, input.Mode, input.Config.InterfaceType); err != nil {
		// This local check precedes the create request. A resumed provider task,
		// however, already has submission evidence that must not be erased.
		if ResumedProviderRequestID(ctx) == "" {
			return ProtocolPreparationError{Cause: err}
		}
		return err
	}
	return nil
}

// interfaceNeedsNoKey 看插件清单是否声明 auth.type 为 none，比如本机的 ComfyUI。
func interfaceNeedsNoKey(ctx context.Context, interfaceType string) bool {
	registry, ok := ProtocolRegistryFromContext(ctx)
	if !ok {
		return false
	}
	adapter, found := registry.Resolve(interfaceType)
	if !found {
		return false
	}
	auth, ok := adapter.(protocol.MediaAuthAdapter)
	return ok && strings.EqualFold(strings.TrimSpace(auth.MediaAuth().Type), "none")
}

func validateInterfaceForContext(ctx context.Context, mode, interfaceType string) error {
	interfaceType = strings.TrimSpace(interfaceType)
	if interfaceType == "" {
		return nil
	}
	if registry, ok := ProtocolRegistryFromContext(ctx); ok {
		if _, found := registry.Resolve(interfaceType); found {
			return ValidateGenerationInterfaceWithRegistry(registry, mode, interfaceType)
		}
	}
	return ValidateGenerationInterface(mode, interfaceType)
}

func requireTaskRuntime(ctx context.Context) error {
	runtime, ok := RuntimeFromContext(ctx)
	if !ok {
		return errors.New("Unable to execute build task, please try again")
	}
	if strings.TrimSpace(runtime.Call.UserID) == "" || strings.TrimSpace(runtime.Call.TaskID) == "" {
		return errors.New("Build task is missing user or task identity")
	}
	if runtime.Images == nil || runtime.Receipts == nil || runtime.Limits == nil {
		return errors.New("Unable to execute build task, please try again")
	}
	return nil
}
