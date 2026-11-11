package assistant

import "testing"

func TestProviderFingerprintTracksEveryField(t *testing.T) {
	base := Provider{ChannelID: "beeftv", Model: "MiniMax-M3",
		BaseURL: "https://beeftv.app/v1", Protocol: "chat-completion", APIKey: "one"}
	variants := []Provider{
		{ChannelID: "other", Model: base.Model, BaseURL: base.BaseURL, Protocol: base.Protocol, APIKey: base.APIKey},
		{ChannelID: base.ChannelID, Model: "claude-fable-5", BaseURL: base.BaseURL, Protocol: base.Protocol, APIKey: base.APIKey},
		{ChannelID: base.ChannelID, Model: base.Model, BaseURL: "https://other.example/v1", Protocol: base.Protocol, APIKey: base.APIKey},
		{ChannelID: base.ChannelID, Model: base.Model, BaseURL: base.BaseURL, Protocol: "claude-api", APIKey: base.APIKey},
		{ChannelID: base.ChannelID, Model: base.Model, BaseURL: base.BaseURL, Protocol: base.Protocol, APIKey: "two"},
	}
	for _, variant := range variants {
		if variant.Fingerprint() == base.Fingerprint() {
			t.Fatalf("The fingerprint does not change with the field: %#v", variant)
		}
	}
	if base.Fingerprint() != (Provider{ChannelID: "beeftv", Model: "MiniMax-M3",
		BaseURL: "https://beeftv.app/v1", Protocol: "chat-completion", APIKey: "one"}).Fingerprint() {
		t.Fatal("The same configuration should get the same fingerprint")
	}
}
