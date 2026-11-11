package beeftv

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

const (
	ProductionOrigin = "https://beeftv.app"
	PreviewLocalHost = "enterprise.localhost"
	ClientID         = "beeftv-enterprise-v1"
	ClientScope      = "inference"
	CredentialRef    = "beeftv"
	ChannelID        = "beeftv"
	TestOriginEnv    = "BEEFTV_ENTERPRISE_TEST_ORIGIN"
	WalletPath       = "/console/topup"
)

// CanonicalOrigin defaults to BeefTV and only accepts an explicit loopback test origin.
func CanonicalOrigin(explicit string) (string, error) {
	candidate := strings.TrimRight(strings.TrimSpace(explicit), "/")
	if candidate == "" {
		candidate = strings.TrimRight(strings.TrimSpace(os.Getenv(TestOriginEnv)), "/")
	}
	if candidate == "" || strings.EqualFold(candidate, ProductionOrigin) {
		return ProductionOrigin, nil
	}
	origin, err := parseSafeTestOrigin(candidate)
	if err != nil {
		return "", err
	}
	return origin, nil
}

func parseSafeTestOrigin(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("The test enterprise source address is invalid")
	}
	if parsed.User != nil || parsed.Opaque != "" || strings.Trim(parsed.Path, "/") != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("The test enterprise source address can only be the enterprise preview source")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("Test enterprise source address only supports HTTP or HTTPS")
	}
	host := parsed.Hostname()
	if !isSafeTestHost(host) {
		return "", fmt.Errorf("Test enterprise source address only allows enterprise.localhost or loopback")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func isSafeTestHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == PreviewLocalHost {
		return true
	}
	return isLoopbackHost(host)
}

func isLoopbackHost(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func ProviderBaseURL(origin string) string {
	return strings.TrimRight(strings.TrimSpace(origin), "/")
}

func TokenBaseURL(origin string) string {
	return ProviderBaseURL(origin) + "/v1"
}

func WalletURL(origin string) string {
	return ProviderBaseURL(origin) + WalletPath
}

func ValidateReturnedBaseURL(origin, baseURL string) error {
	normalized := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if normalized != TokenBaseURL(origin) {
		return fmt.Errorf("The service address returned by the enterprise interface is invalid")
	}
	return nil
}

func ValidateVerificationURL(origin, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("Authorization address is invalid")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("Authorization address is invalid")
	}
	if !strings.EqualFold(parsed.Scheme+"://"+parsed.Host, origin) {
		return nil, fmt.Errorf("The authorized address does not belong to the current enterprise source")
	}
	path := parsed.EscapedPath()
	if path != "/desktop-auth" && !strings.HasPrefix(path, "/desktop-auth/") {
		return nil, fmt.Errorf("The authorized address is not on the allowed confirmation page")
	}
	return parsed, nil
}

func ValidateWalletURL(origin, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("Wallet address is invalid")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("Wallet address is invalid")
	}
	if !strings.EqualFold(parsed.Scheme+"://"+parsed.Host, origin) {
		return nil, fmt.Errorf("The wallet address does not belong to the current enterprise source")
	}
	if parsed.EscapedPath() != WalletPath || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("The wallet address is not on the allowed deposit page")
	}
	return parsed, nil
}

func IsManagedChannel(channelID, credentialRef, _ string) bool {
	return strings.TrimSpace(credentialRef) == CredentialRef || strings.TrimSpace(channelID) == ChannelID
}

func IsManagedTaskInput(inputJSON string) bool {
	var input struct {
		Config struct {
			CredentialRef string `json:"credentialRef"`
			ChannelID     string `json:"channelId"`
		} `json:"config"`
	}
	return json.Unmarshal([]byte(inputJSON), &input) == nil &&
		IsManagedChannel(input.Config.ChannelID, input.Config.CredentialRef, "")
}
