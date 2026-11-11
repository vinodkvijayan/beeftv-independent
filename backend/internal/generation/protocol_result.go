package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/protocol"
)

func FinishProtocolResult(ctx context.Context, config Config, mode string, taskID string, result *protocol.Result, pollPolicy VideoPollPolicy) (map[string]interface{}, error) {
	return finishProtocolResult(ctx, config, mode, taskID, result, pollPolicy, nil)
}

func finishProtocolResult(ctx context.Context, config Config, mode string, taskID string, result *protocol.Result, pollPolicy VideoPollPolicy, renew func(context.Context, int) (VideoResultSource, error)) (map[string]interface{}, error) {
	if mode == "video" {
		pollPolicy = videoPollPolicyForConfig(ctx, config, pollPolicy)
	}
	if result == nil {
		return nil, errors.New("Declarative protocol completed but no result returned")
	}
	if mode == "text" {
		output := map[string]interface{}{"mode": "text", "text": result.Text}
		if strings.TrimSpace(result.Reasoning) != "" {
			output["reasoning"] = result.Reasoning
		}
		return output, nil
	}
	var references []protocol.MediaReference
	switch mode {
	case "image":
		references = result.Images
	case "video":
		references = result.Videos
	case "audio":
		references = result.Audios
	default:
		return nil, fmt.Errorf("Declarative protocols do not support generation mode %s", mode)
	}
	if len(references) == 0 {
		return nil, errors.New("Declarative protocol completed but no media address returned")
	}
	items := make([]interface{}, 0, len(references))
	for index, reference := range references {
		if mode == "image" && !reference.Ephemeral && strings.TrimSpace(reference.DataURL) == "" && strings.TrimSpace(reference.URL) != "" {
			value := strings.TrimSpace(reference.URL)
			if _, err := outbound.ValidateOutboundURL(value); err != nil {
				return nil, err
			}
			// Generation is complete. Persist its artifact before the existing
			// delivery worker downloads it; a slow GET must not fail a paid create.
			items = append(items, map[string]interface{}{"url": value, "mimeType": reference.MIMEType})
			continue
		}
		var data []byte
		var mimeType string
		var err error
		if mode == "video" {
			var resolve videoResultResolver
			if renew != nil {
				resolve = func(ctx context.Context) (VideoResultSource, error) { return renew(ctx, index) }
			}
			source := videoURLSource(config, defaultString(reference.DataURL, reference.URL))
			download := VideoResultDownloader(config, taskID, source, resolve)
			data, mimeType, err = RunVideoDownload(ctx, taskID, pollPolicy, download)
		} else {
			data, mimeType, err = ProtocolMediaBytes(ctx, config, reference)
		}
		if err != nil {
			return nil, err
		}
		mimeType = NormalizedMediaMIMEType(mimeType, data)
		if mode == "image" {
			if err := ValidateImageArtifact(data, mimeType); err != nil {
				return nil, err
			}
		}
		if mode == "audio" {
			mimeType, err = ValidateGeneratedAudio(mimeType, data, config.AudioFormat)
			if err != nil {
				return nil, err
			}
		}
		item := map[string]interface{}{"dataUrl": DataURL(mimeType, data), "mimeType": mimeType}
		if mode == "video" {
			if lastFrameURL, ok := reference.Metadata["last_frame_url"].(string); ok && strings.TrimSpace(lastFrameURL) != "" {
				attachOptionalProviderLastFrame(ctx, config, item, lastFrameURL, true)
			}
		}
		items = append(items, item)
	}
	switch mode {
	case "image":
		output := map[string]interface{}{"mode": "image", "images": items}
		layers := make([]map[string]any, 0)
		for index, reference := range references {
			if metadata, ok := reference.Metadata["layer"].(map[string]any); ok && len(metadata) > 0 {
				layer := make(map[string]any, len(metadata)+1)
				for key, value := range metadata {
					layer[key] = value
				}
				layer["imageIndex"] = index
				layers = append(layers, layer)
			}
		}
		if len(layers) > 0 {
			output["imageLayers"] = layers
		}
		if result.Usage != nil {
			output["usage"] = result.Usage
		}
		return output, nil
	case "video":
		return map[string]interface{}{"mode": "video", "video": items[0]}, nil
	default:
		return map[string]interface{}{"mode": "audio", "audio": items[0]}, nil
	}
}

// finishProtocolAdapterResult 优先消费 create/poll 已返回的内联或 URL 结果，只有插件明确声明独立结果端点时才下载。
// 空响应或下载失败必须向上失败，不能生成伪素材；application/octet-stream 仅表示传输层未知类型，
// 不会把未知内容伪装成具体图片、视频或音频 MIME。
func FinishProtocolAdapterResult(ctx context.Context, input Input, adapter protocol.Adapter, request protocol.GenerationRequest, taskID string, result *protocol.Result, pollPolicy VideoPollPolicy) (map[string]interface{}, error) {
	if input.Mode == "video" {
		pollPolicy = videoPollPolicyForConfig(ctx, input.Config, pollPolicy)
		if auth, ok := adapter.(protocol.MediaAuthAdapter); ok {
			ctx = withVideoProtocolAuth(ctx, auth.MediaAuth())
		}
	}
	renew := func(ctx context.Context, index int) (VideoResultSource, error) {
		referenceID := ""
		if result != nil && index < len(result.Videos) {
			referenceID = strings.TrimSpace(result.Videos[index].ID)
		}
		return queryProtocolVideoSource(ctx, input, adapter, request, taskID, index, referenceID)
	}
	if ProtocolResultHasOutput(input.Mode, result) {
		return finishProtocolResult(ctx, input.Config, input.Mode, taskID, result, pollPolicy, renew)
	}
	resultAdapter, ok := adapter.(protocol.ResultAdapter)
	capability, hasCapability := adapter.(protocol.ResultCapability)
	if !ok || !hasCapability || !capability.ResultAvailable() {
		return FinishProtocolResult(ctx, input.Config, input.Mode, taskID, result, pollPolicy)
	}
	spec, err := resultAdapter.BuildResult(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID})
	if err != nil {
		return nil, err
	}
	download := func(ctx context.Context) ([]byte, string, error) {
		return ExecuteProtocolBinaryRequest(WithRequestKind(ctx, "download"), input.Config, spec)
	}
	if input.Mode == "video" {
		source, sourceErr := protocolVideoRequestSource(input.Config, spec)
		if sourceErr != nil {
			return nil, sourceErr
		}
		download = VideoResultDownloader(input.Config, taskID, source, func(ctx context.Context) (VideoResultSource, error) { return renew(ctx, 0) })
	}
	var data []byte
	var mimeType string
	if input.Mode == "video" {
		data, mimeType, err = RunVideoDownload(ctx, taskID, pollPolicy, download)
	} else {
		data, mimeType, err = download(ctx)
	}
	if err != nil {
		return nil, fmt.Errorf("Declarative protocol result download failed: %w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("Declarative protocol results download returns empty content")
	}
	mimeType = strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	reference := protocol.MediaReference{DataURL: DataURL(mimeType, data), MIMEType: mimeType}
	downloaded := &protocol.Result{}
	switch input.Mode {
	case "image":
		downloaded.Images = []protocol.MediaReference{reference}
	case "video":
		downloaded.Videos = []protocol.MediaReference{reference}
	case "audio":
		downloaded.Audios = []protocol.MediaReference{reference}
	default:
		return nil, fmt.Errorf("Declarative protocol result download does not support build mode %s", input.Mode)
	}
	return FinishProtocolResult(ctx, input.Config, input.Mode, taskID, downloaded, pollPolicy)
}

func protocolVideoRequestSource(config Config, spec protocol.RequestSpec) (VideoResultSource, error) {
	rawURL, err := ProtocolRequestURL(config.BaseURL, spec)
	if err != nil {
		return VideoResultSource{}, err
	}
	return VideoResultSource{URL: rawURL, Read: func(ctx context.Context) ([]byte, string, error) {
		return ExecuteProtocolBinaryRequest(withVideoProtocolAuth(WithRequestKind(ctx, "download"), spec.Auth), config, spec)
	}}, nil
}

func queryProtocolVideoSource(ctx context.Context, input Input, adapter protocol.Adapter, request protocol.GenerationRequest, taskID string, index int, referenceID string) (VideoResultSource, error) {
	pollContext := protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID}
	spec, err := adapter.BuildPoll(ctx, pollContext)
	if err != nil {
		return VideoResultSource{}, err
	}
	body, err := ExecuteProtocolRequest(WithRequestKind(ctx, "poll"), input.Config, spec)
	if err != nil {
		return VideoResultSource{}, err
	}
	state, err := adapter.ParsePoll(ctx, pollContext, body)
	if err != nil {
		return VideoResultSource{}, err
	}
	if returnedID := strings.TrimSpace(state.TaskID); returnedID != "" && returnedID != strings.TrimSpace(taskID) {
		return VideoResultSource{}, errors.New("The query result is inconsistent with the original video task, and the retrieval has been stopped.")
	}
	if state.Status == protocol.StatusFailed || state.Status == protocol.StatusCancelled {
		return VideoResultSource{}, ProtocolResultError(state.Message, taskID, body)
	}
	if state.Status != protocol.StatusSucceeded {
		_, err := videoResultURL(string(state.Status), "")
		return VideoResultSource{}, err
	}
	var reference protocol.MediaReference
	found := false
	if state.Result != nil {
		if referenceID != "" {
			for _, candidate := range state.Result.Videos {
				if strings.TrimSpace(candidate.ID) == referenceID {
					if found {
						return VideoResultSource{}, errors.New("The original video task returned a duplicate product ID and the retrieval has been stopped.")
					}
					reference, found = candidate, true
				}
			}
		} else if index >= 0 && index < len(state.Result.Videos) {
			reference, found = state.Result.Videos[index], true
		}
	}
	if found {
		rawURL, err := videoResultURL("succeeded", defaultString(reference.DataURL, reference.URL))
		return videoURLSource(input.Config, rawURL), err
	}
	if referenceID != "" || index != 0 {
		return VideoResultSource{}, errors.New("The original video task did not return the corresponding video product and the retrieval has been stopped.")
	}
	resultAdapter, ok := adapter.(protocol.ResultAdapter)
	capability, capable := adapter.(protocol.ResultCapability)
	if !ok || !capable || !capability.ResultAvailable() {
		return VideoResultSource{}, errors.New("The original video task did not return retrievable results.")
	}
	spec, err = resultAdapter.BuildResult(ctx, pollContext)
	if err != nil {
		return VideoResultSource{}, err
	}
	return protocolVideoRequestSource(input.Config, spec)
}

func ProtocolResultHasOutput(mode string, result *protocol.Result) bool {
	if result == nil {
		return false
	}
	switch mode {
	case "text":
		return strings.TrimSpace(result.Text) != ""
	case "image":
		return len(result.Images) > 0
	case "video":
		return len(result.Videos) > 0
	case "audio":
		return len(result.Audios) > 0
	default:
		return false
	}
}

func ProtocolMediaBytes(ctx context.Context, config Config, reference protocol.MediaReference) ([]byte, string, error) {
	var data []byte
	var mimeType string
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		data, mimeType, err = ProtocolMediaBytesOnce(ctx, config, reference)
		if err == nil {
			return data, mimeType, nil
		}
		if attempt == 2 || !RetryableProtocolMediaDownload(err) {
			break
		}
		if waitErr := SleepContext(ctx, time.Duration(attempt+1)*time.Second); waitErr != nil {
			return nil, "", fmt.Errorf("Declarative protocol media result download failed: %w", waitErr)
		}
	}
	return nil, "", fmt.Errorf("Declarative protocol media result download failed: %w", err)
}

func ProtocolMediaBytesOnce(ctx context.Context, config Config, reference protocol.MediaReference) ([]byte, string, error) {
	if strings.TrimSpace(reference.DataURL) != "" {
		mimeType, data, err := DecodeProviderDataURL(reference.DataURL)
		return data, mimeType, err
	}
	value := strings.TrimSpace(reference.URL)
	if value == "" {
		return nil, "", errors.New("Declarative protocol media result address is empty")
	}
	data, mimeType, err := GetProviderExternalBinary(WithRequestKind(ctx, "download"), config, value)
	return data, NormalizedMediaMIMEType(mimeType, data), err
}

func RetryableProtocolMediaDownload(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if outbound.IsConnectionInterrupted(err) {
		return true
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return true
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{"tls handshake timeout", "connection reset", "unexpected eof", "broken pipe"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func ProtocolResultError(message, taskID string, bodies ...[]byte) error {
	// Keep structured failure codes instead of flattening them to plugin prose.
	if len(bodies) > 0 {
		var payload map[string]interface{}
		if json.Unmarshal(bodies[0], &payload) == nil {
			requestID := firstNonEmpty(stringField(payload, "request_id"), stringField(payload, "requestId"))
			if nested, ok := payload["data"].(map[string]interface{}); ok {
				payload = nested
			}
			if errPayload, ok := payload["error"].(map[string]interface{}); ok && stringField(errPayload, "code") != "" {
				requestID = firstNonEmpty(stringField(errPayload, "request_id"), stringField(errPayload, "requestId"), stringField(payload, "request_id"), requestID)
				raw, _ := json.Marshal(map[string]interface{}{"task_id": taskID, "request_id": requestID, "error": map[string]string{"code": stringField(errPayload, "code"), "message": stringField(errPayload, "message"), "type": stringField(errPayload, "type"), "param": stringField(errPayload, "param")}})
				return NewRawPayloadError(string(raw))
			}
			if code, detail, failed := PayloadBusinessFailure(payload); failed && code != "" {
				requestID = firstNonEmpty(stringField(payload, "request_id"), stringField(payload, "requestId"), requestID)
				jobID := firstNonEmpty(taskID, stringField(payload, "task_id"), stringField(payload, "taskId"), stringField(payload, "id"))
				envelope := map[string]interface{}{
					"request_id": requestID,
					"error": map[string]string{
						"code":    code,
						"message": firstNonEmpty(detail, strings.TrimSpace(message)),
					},
				}
				if jobID != "" {
					envelope["task_id"] = jobID
				}
				raw, _ := json.Marshal(envelope)
				return NewRawPayloadError(string(raw))
			}
		}
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "Upstream returns failure status"
	}
	if taskID == "" {
		return errors.New(message)
	}
	return fmt.Errorf("Declarative protocol task failed (task %s): %s", taskID, message)
}
