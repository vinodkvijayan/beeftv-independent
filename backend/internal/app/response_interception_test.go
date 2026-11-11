package app

import (
	"strings"
	"testing"
)

func TestInterceptResponseMessageMatchesCaseInsensitivelyAndStopsAtFirstRule(t *testing.T) {
	setting := ResponseInterceptionSetting{
		Enabled: true,
		Rules: []ResponseInterceptionRule{
			{Contains: "Insufficient balance", Replace: "Network abnormality, please try again"},
			{Contains: "Abnormal", Replace: "Article 2"},
		},
	}
	if got := interceptResponseMessage(setting, "Upstream return: Insufficient balance"); got != "Network abnormality, please try again" {
		t.Fatalf("interceptResponseMessage() = %q", got)
	}
	if got := interceptResponseMessage(setting, "request failed: 429"); got != "request failed: 429" {
		t.Fatalf("unmatched message = %q", got)
	}
	if got := interceptResponseMessage(ResponseInterceptionSetting{Enabled: true, Rules: []ResponseInterceptionRule{{Contains: "429", Replace: "Network abnormality, please try again"}}}, "HTTP 429 Too Many Requests"); got != "Network abnormality, please try again" {
		t.Fatalf("case-insensitive match = %q", got)
	}
}

func TestValidateResponseInterceptionSettingRejectsEmptyRuleText(t *testing.T) {
	for name, value := range map[string]ResponseInterceptionSetting{
		"contains": {Rules: []ResponseInterceptionRule{{Contains: " ", Replace: "replace"}}},
		"replace":  {Rules: []ResponseInterceptionRule{{Contains: "429", Replace: " "}}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateResponseInterceptionSetting(normalizeResponseInterceptionSetting(value)); err == nil {
				t.Fatal("validateResponseInterceptionSetting() error = nil")
			}
		})
	}
}

func TestNormalizeResponseInterceptionSettingTrimsRules(t *testing.T) {
	value := normalizeResponseInterceptionSetting(ResponseInterceptionSetting{Rules: []ResponseInterceptionRule{{Contains: " 429 ", Replace: " Network abnormality, please try again"}}})
	if value.Rules[0].Contains != "429" || value.Rules[0].Replace != "Network abnormality, please try again" {
		t.Fatalf("normalized rules = %#v", value.Rules)
	}
	if strings.TrimSpace(value.Rules[0].Contains) != value.Rules[0].Contains {
		t.Fatal("contains was not trimmed")
	}
}
