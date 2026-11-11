package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveAssistantProviderFromModelsOnlyLocalChannel(t *testing.T) {
	for _, selection := range []string{"deepseek-v4-flash:free", "newapi-local::deepseek-v4-flash:free"} {
		t.Run(selection, func(t *testing.T) {
			body, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "revision": 1,
				"config": map[string]any{
					"textModel": selection,
					"channels": []any{map[string]any{
						"id": "newapi-local", "enabled": true, "apiFormat": "openai",
						"baseUrl": "http://127.0.0.1:3000/v1", "apiKey": "synthetic-local-key",
						"models": []string{"deepseek-v4-flash:free"},
					}},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			service := writeAssistantConfig(t, string(body))
			provider, err := service.ResolveAssistantProvider()
			if err != nil {
				t.Fatalf("local models-only text selection must resolve without database rows: %v", err)
			}
			if provider.ChannelID != "newapi-local" || provider.Model != "deepseek-v4-flash:free" || provider.Protocol != "chat-completion" || provider.BaseURL != "http://127.0.0.1:3000/v1" || provider.APIKey != "synthetic-local-key" {
				t.Fatal("resolved provider does not match the persisted local channel")
			}
		})
	}
}

// 用户在设置里选的是「渠道内的某个模型」：凭据必须按那个渠道解析。
// 顶层 apiKey 在托管形态下永远是空串，只读顶层就会把可用的助手判成不可用（P1 缺陷）。
func writeAssistantConfig(t *testing.T, body string) *Service {
	t.Helper()
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "local-model-config.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return NewLocal(nil, dataDir)
}

func TestResolveAssistantProviderUsesChannelCredential(t *testing.T) {
	service := writeAssistantConfig(t, `{"schemaVersion":1,"revision":1,"config":{
		"apiKey":"","baseUrl":"https://beeftv.app","textModel":"custom::my-text",
		"channels":[{"id":"custom","name":"self-built","enabled":true,"apiKey":"channel-secret",
			"baseUrl":"https://relay.example.com/v1",
			"modelProfiles":[{"capability":"text","model":"my-text","protocol":"chat-completion"}]}]}}`)

	provider, err := service.ResolveAssistantProvider()
	if err != nil {
		t.Fatalf("Should parse successfully: %v", err)
	}
	if provider.ChannelID != "custom" || provider.Model != "my-text" || provider.Protocol != "chat-completion" {
		t.Fatalf("Channel model parsing error: %#v", provider)
	}
	if provider.APIKey != "channel-secret" || provider.BaseURL != "https://relay.example.com/v1" {
		t.Fatalf("The credentials and address should come from the channel: channel=%s base=%s hasKey=%t", provider.ChannelID, provider.BaseURL, provider.APIKey != "")
	}
	if provider.ChannelName != "Self-built" {
		t.Fatalf("The channel name should be displayable, get %q", provider.ChannelName)
	}
}

// assistantModel 优先于 textModel；协议来自该模型在渠道里的能力声明。
func TestResolveAssistantProviderPrefersAssistantModel(t *testing.T) {
	service := writeAssistantConfig(t, `{"schemaVersion":1,"revision":1,"config":{
		"assistantModel":"custom::claude-x","textModel":"custom::chat-x",
		"channels":[{"id":"custom","enabled":true,"apiKey":"k","baseUrl":"https://relay.example.com",
			"modelProfiles":[
				{"capability":"text","model":"chat-x","protocol":"chat-completion"},
				{"capability":"text","model":"claude-x","protocol":"claude-api"}]}]}}`)

	provider, err := service.ResolveAssistantProvider()
	if err != nil {
		t.Fatalf("Should parse successfully: %v", err)
	}
	if provider.Model != "claude-x" || provider.Protocol != "claude-api" {
		t.Fatalf("AssistantModel and its protocol should be used: %#v", provider)
	}
}

// 显式选择失效时要求重新选择，不能静默发送给另一模型。
func TestResolveAssistantProviderRejectsUnresolvableExplicitModel(t *testing.T) {
	service := writeAssistantConfig(t, `{"schemaVersion":1,"revision":1,"config":{
		"assistantModel":"gone::ghost-model","textModel":"custom::chat-x",
		"channels":[{"id":"custom","enabled":true,"apiKey":"k","baseUrl":"https://relay.example.com",
			"modelProfiles":[{"capability":"text","model":"chat-x","protocol":"chat-completion"}]}]}}`)

	provider, err := service.ResolveAssistantProvider()
	unavailable, ok := err.(*AssistantUnavailableError)
	if !ok || unavailable.Reason != AssistantReasonModelNotConfigured || provider.Model != "" || provider.APIKey != "" {
		t.Fatalf("Explicit failure models should be rejected: %v", err)
	}
}

// 渠道能力表里文本模型没写协议时，按渠道层的缺省协议（chat-completion）处理。
func TestResolveAssistantProviderDefaultsMissingProtocolToChatCompletion(t *testing.T) {
	service := writeAssistantConfig(t, `{"schemaVersion":1,"revision":1,"config":{
		"textModel":"custom::chat-x",
		"channels":[{"id":"custom","enabled":true,"apiKey":"k","baseUrl":"https://relay.example.com",
			"modelProfiles":[{"capability":"text","model":"chat-x"}]}]}}`)

	provider, err := service.ResolveAssistantProvider()
	if err != nil {
		t.Fatalf("Default protocol should be available: %v", err)
	}
	if provider.Protocol != "chat-completion" {
		t.Fatalf("The default protocol should be chat-completion, getting %q", provider.Protocol)
	}
}

// 配置里历史上出现过 openai-response 的写法；它和 responses 是同一件事。
func TestResolveAssistantProviderNormalizesResponsesProtocol(t *testing.T) {
	service := writeAssistantConfig(t, `{"schemaVersion":1,"revision":1,"config":{
		"textModel":"custom::resp-x",
		"channels":[{"id":"custom","enabled":true,"apiKey":"k","baseUrl":"https://relay.example.com",
			"modelProfiles":[{"capability":"text","model":"resp-x","protocol":"openai-response"}]}]}}`)

	provider, err := service.ResolveAssistantProvider()
	if err != nil {
		t.Fatalf("Should parse successfully: %v", err)
	}
	if provider.Protocol != "responses" {
		t.Fatalf("The protocols should be normalized to responses, giving %q", provider.Protocol)
	}
}

func TestResolveAssistantProviderReasons(t *testing.T) {
	cases := []struct {
		name       string
		config     string
		wantReason string
	}{
		{"no model", `{"schemaVersion":1,"revision":1,"config":{"channels":[]}}`, AssistantReasonModelNotConfigured},
		{"Channel has no key", `{"schemaVersion":1,"revision":1,"config":{"textModel":"custom::chat-x","channels":[{"id":"custom","enabled":true,"apiKey":"","baseUrl":"https://relay.example.com","modelProfiles":[{"capability":"text","model":"chat-x","protocol":"chat-completion"}]}]}}`, AssistantReasonCredentialMissing},
		{"The protocol is not supported", `{"schemaVersion":1,"revision":1,"config":{"textModel":"custom::img-x","channels":[{"id":"custom","enabled":true,"apiKey":"k","baseUrl":"https://relay.example.com","modelProfiles":[{"capability":"text","model":"img-x","protocol":"newapi-channel-1"}]}]}}`, AssistantReasonProtocolUnsupported},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			service := writeAssistantConfig(t, item.config)
			_, err := service.ResolveAssistantProvider()
			if err == nil {
				t.Fatal("The unavailability reason should be returned")
			}
			unavailable, isUnavailable := err.(*AssistantUnavailableError)
			if !isUnavailable {
				t.Fatalf("Error type should be *AssistantUnavailableError, got %T", err)
			}
			if unavailable.Reason != item.wantReason {
				t.Fatalf("reason should be %s, get %s", item.wantReason, unavailable.Reason)
			}
		})
	}
}

// 付费生成提议要把画布默认模型原样告诉用户：展示名去掉渠道前缀，modelKey 保留原值。
func TestAssistantGenerationModelStripsChannelPrefix(t *testing.T) {
	service := writeAssistantConfig(t, `{"schemaVersion":1,"revision":1,"config":{"imageModel":"beeftv::gpt-image-2","videoModel":"beeftv::wan3.0-video"}}`)

	display, modelKey := service.AssistantGenerationModel("image")
	if display != "gpt-image-2" || modelKey != "beeftv::gpt-image-2" {
		t.Fatalf("Image model parsing error: display=%q modelKey=%q", display, modelKey)
	}
	display, modelKey = service.AssistantGenerationModel("video")
	if display != "wan3.0-video" || modelKey != "beeftv::wan3.0-video" {
		t.Fatalf("Video model parsing error: display=%q modelKey=%q", display, modelKey)
	}
	if display, _ := service.AssistantGenerationModel("audio"); display != "" {
		t.Fatalf("Only supports image/video, get %q", display)
	}
}
