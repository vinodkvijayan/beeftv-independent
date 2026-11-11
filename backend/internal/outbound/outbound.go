package outbound

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"

	"infinite-canvas/backend/internal/desktopnet"
)

const (
	maxOutboundRedirects     = 5
	maxOutboundHeaderCount   = 32
	maxOutboundHeaderBytes   = 16 << 10
	CustomRelayHeadersHeader = "X-Canvas-Upstream-Headers"
	DefaultOutboundUserAgent = "BeefTV/1.0 (+https://github.com/glanderness/BeefTV)"
)

type OutboundHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

var (
	outboundTransport          = newOutboundTransport(resolveOutboundHost)
	customRelayTransport       = newOutboundTransport(resolveCustomRelayHost)
	blockedCustomRelayPrefixes = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("203.0.113.0/24"),
		netip.MustParsePrefix("240.0.0.0/4"),
		netip.MustParsePrefix("100::/64"),
		netip.MustParsePrefix("2001:db8::/32"),
	}
)

func ValidateOutboundURL(rawURL string) (*url.URL, error) {
	return ValidateOutboundURLContext(context.Background(), rawURL)
}

// ValidateOutboundURLContext keeps DNS safety checks inside the caller's
// cancellation/deadline, including reference-upload recovery budgets.
func ValidateOutboundURLContext(ctx context.Context, rawURL string) (*url.URL, error) {
	if requiresPublicHTTPS(ctx) {
		return ValidatePublicHTTPSURLContext(ctx, rawURL)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" {
		return nil, BadAuthRequest("Invalid external service address")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, BadAuthRequest("External service addresses only support http/https")
	}
	if parsed.User != nil {
		return nil, BadAuthRequest("External service addresses are not allowed to contain authentication information")
	}
	if _, err := resolveOutboundHost(ctx, parsed.Hostname()); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	return parsed, nil
}

// 用户自定义渠道不接受 URL 凭据；默认允许本机与局域网 HTTP/HTTPS 模型服务，
// 当部署显式关闭私网出站（CANVAS_ALLOW_PRIVATE_UPSTREAMS=false）时仅允许白名单主机使用 HTTP。
func ValidateCustomRelayURL(rawURL string) (*url.URL, error) {
	if len(strings.TrimSpace(rawURL)) > 4096 {
		return nil, BadAuthRequest("Custom channel address is too long")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || !parsed.IsAbs() {
		return nil, BadAuthRequest("Invalid custom channel address")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && scheme != "http" {
		return nil, BadAuthRequest("Custom channel addresses only support http/https")
	}
	if scheme == "http" && !(allowPrivateUpstreams() || AllowedPrivateUpstreamHost(parsed.Hostname())) {
		return nil, BadAuthRequest("Custom channel HTTP only allows access to configured trusted upstream hosts")
	}
	if parsed.User != nil {
		return nil, BadAuthRequest("Custom channel addresses are not allowed to contain authentication information")
	}
	if parsed.Fragment != "" {
		return nil, BadAuthRequest("Custom channel addresses are not allowed to contain fragments")
	}
	if err := validateCustomRelayHost(parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

func OutboundHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: outboundPolicyTransport{},
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxOutboundRedirects {
				return errors.New("Too many external service redirects")
			}
			_, err := ValidateOutboundURLContext(req.Context(), req.URL.String())
			return err
		},
	}
}

func CustomRelayHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: customRelayTransport,
		Timeout:   timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("Custom channel transit does not allow redirects")
		},
	}
}

// ApplyDefaultOutboundHeaders 为所有服务端出网请求提供可识别的产品标识，
// 避免 Go 默认 User-Agent 被部分 WAF 或中转网关拦截。
func ApplyDefaultOutboundHeaders(req *http.Request) {
	if req != nil && strings.TrimSpace(req.Header.Get("User-Agent")) == "" {
		req.Header.Set("User-Agent", DefaultOutboundUserAgent)
	}
}

// NormalizeOutboundHeaders 是自定义 Header 的安全边界：允许业务/WAF 校验头和 User-Agent，
// 但禁止覆盖鉴权、请求体协议、代理内部头及 hop-by-hop 头。
func NormalizeOutboundHeaders(headers []OutboundHeader) ([]OutboundHeader, error) {
	if len(headers) > maxOutboundHeaderCount {
		return nil, BadAuthRequest(fmt.Sprintf("Custom request headers support up to %d items", maxOutboundHeaderCount))
	}
	seen := make(map[string]struct{}, len(headers))
	normalized := make([]OutboundHeader, 0, len(headers))
	totalBytes := 0
	for _, item := range headers {
		name := strings.TrimSpace(item.Name)
		value := strings.TrimSpace(item.Value)
		if name == "" && value == "" {
			continue
		}
		if name == "" || !validOutboundHeaderName(name) {
			return nil, BadAuthRequest("The custom request header name is invalid, please use the standard HTTP Header name")
		}
		name = http.CanonicalHeaderKey(name)
		lowerName := strings.ToLower(name)
		if blockedOutboundHeader(lowerName) {
			return nil, BadAuthRequest("Request header" + name + " Managed by the system, no customization allowed")
		}
		if _, exists := seen[lowerName]; exists {
			return nil, BadAuthRequest("Custom request headers cannot be repeated:" + name)
		}
		if !validOutboundHeaderValue(value) {
			return nil, BadAuthRequest("Request header" + name + " The value contains illegal control characters")
		}
		if len(name) > 128 || len(value) > 4096 {
			return nil, BadAuthRequest("A single custom request header name or value is too long")
		}
		totalBytes += len(name) + len(value)
		if totalBytes > maxOutboundHeaderBytes {
			return nil, BadAuthRequest("The total size of custom request headers cannot exceed 16KB")
		}
		seen[lowerName] = struct{}{}
		normalized = append(normalized, OutboundHeader{Name: name, Value: value})
	}
	return normalized, nil
}

func ApplyOutboundHeaders(req *http.Request, headers []OutboundHeader) {
	if req == nil {
		return
	}
	for _, item := range headers {
		req.Header.Set(item.Name, item.Value)
	}
}

func EncodeOutboundHeadersJSON(headers []OutboundHeader) (string, error) {
	normalized, err := NormalizeOutboundHeaders(headers)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(normalized)
	return string(data), err
}

func ParseOutboundHeadersJSON(raw string) ([]OutboundHeader, error) {
	if strings.TrimSpace(raw) == "" {
		return []OutboundHeader{}, nil
	}
	var headers []OutboundHeader
	if err := json.Unmarshal([]byte(raw), &headers); err != nil {
		return nil, errors.New("Channel custom request header configuration is damaged")
	}
	return NormalizeOutboundHeaders(headers)
}

func DecodeRelayOutboundHeaders(encoded string) ([]OutboundHeader, error) {
	if strings.TrimSpace(encoded) == "" {
		return []OutboundHeader{}, nil
	}
	if len(encoded) > (maxOutboundHeaderBytes*2)+1024 {
		return nil, BadAuthRequest("Custom request header configuration is too large")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, BadAuthRequest("Invalid custom request header encoding")
	}
	var headers []OutboundHeader
	if err := json.Unmarshal(data, &headers); err != nil {
		return nil, BadAuthRequest("The custom request header format is invalid")
	}
	return NormalizeOutboundHeaders(headers)
}

func validOutboundHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for index := 0; index < len(name); index++ {
		char := name[index]
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("!#$%&'*+-.^_`|~", rune(char)) {
			continue
		}
		return false
	}
	return true
}

func validOutboundHeaderValue(value string) bool {
	for index := 0; index < len(value); index++ {
		char := value[index]
		if char == '\t' || char >= 32 && char != 127 {
			continue
		}
		return false
	}
	return true
}

func blockedOutboundHeader(name string) bool {
	switch name {
	case "authorization", "proxy-authorization", "cookie", "set-cookie", "host", "content-length", "content-type", "accept", "connection", "proxy-connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "forwarded", "x-goog-api-key":
		return true
	}
	return strings.HasPrefix(name, "x-canvas-") || strings.HasPrefix(name, "x-forwarded-")
}

func newOutboundTransport(resolveHost func(context.Context, string) ([]net.IP, error)) *http.Transport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Transport{
		Proxy: desktopnet.Proxy,
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			// Only configured proxy hosts bypass target DNS validation. Target URLs
			// still pass the outbound policy before transport dispatch.
			if configuredProxyAddress(address) {
				return dialer.DialContext(ctx, network, address)
			}
			addresses, err := resolveHost(ctx, host)
			if err != nil {
				return nil, err
			}
			return dialValidatedAddresses(ctx, network, port, addresses, dialer.DialContext)
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

// Race only the addresses already checked by the outbound policy. Resolving the
// hostname again in net.Dialer would reopen the DNS-rebinding boundary. Stagger
// attempts so a broken IPv6 route cannot hide a working IPv4 route.
func dialValidatedAddresses(ctx context.Context, network, port string, addresses []net.IP, dial func(context.Context, string, string) (net.Conn, error)) (net.Conn, error) {
	if len(addresses) == 0 {
		return nil, errors.New("outbound host has no validated addresses")
	}
	ordered := []net.IP{addresses[0]}
	// Put the other address family second, preserving order within each family.
	firstV4 := addresses[0].To4() != nil
	for _, opposite := range []bool{true, false} {
		for _, ip := range addresses[1:] {
			otherFamily := (ip.To4() != nil) != firstV4
			if otherFamily == opposite {
				ordered = append(ordered, ip)
			}
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	type result struct {
		conn net.Conn
		err  error
	}
	results := make(chan result)
	for i, ip := range ordered {
		go func(delay time.Duration, ip net.IP) {
			if delay > 0 {
				timer := time.NewTimer(delay)
				defer timer.Stop()
				select {
				case <-timer.C:
				case <-ctx.Done():
					return
				}
			}
			conn, err := dial(ctx, network, net.JoinHostPort(ip.String(), port))
			select {
			case results <- result{conn, err}:
			case <-ctx.Done():
				if conn != nil {
					_ = conn.Close()
				}
			}
		}(time.Duration(i)*250*time.Millisecond, ip)
	}
	var firstErr error
	for range ordered {
		select {
		case r := <-results:
			if r.err == nil {
				return r.conn, nil
			}
			if firstErr == nil {
				firstErr = r.err
			}
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return nil, firstErr
}

func configuredProxyAddress(address string) bool {
	return desktopnet.ConfiguredProxyAddress(address)
}

func ValidateOutboundHost(host string) error {
	_, err := resolveOutboundHost(context.Background(), host)
	return err
}

func validateCustomRelayHost(host string) error {
	_, err := resolveCustomRelayHost(context.Background(), host)
	return err
}

func resolveOutboundHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	return resolveOutboundHostWithPolicy(ctx, host, allowPrivateUpstreams() || AllowedPrivateUpstreamHost(host))
}

func resolveCustomRelayHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	allowPrivateHost := allowPrivateUpstreams() || AllowedPrivateUpstreamHost(host)
	addresses, err := resolveOutboundHostWithPolicy(ctx, host, allowPrivateHost)
	if err != nil {
		return nil, err
	}
	if !allowPrivateHost {
		for _, ip := range addresses {
			if blockedCustomRelayIP(ip) {
				return nil, BadAuthRequest("Access to reserved or special purpose addresses is not allowed")
			}
		}
	}
	return addresses, nil
}

func resolveOutboundHostWithPolicy(ctx context.Context, host string, allowPrivateHost bool) ([]net.IP, error) {
	if host == "" {
		return nil, BadAuthRequest("The external service domain name is invalid")
	}
	if !allowPrivateHost && (host == "localhost" || strings.HasSuffix(host, ".localhost")) {
		return nil, BadAuthRequest("Access to this machine or intranet address is not allowed")
	}
	addresses, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if allowPrivateHost && (host == "localhost" || strings.HasSuffix(host, ".localhost")) {
			return []net.IP{net.IPv4(127, 0, 0, 1)}, nil
		}
		return nil, &DNSResolutionError{Cause: err}
	}
	if len(addresses) == 0 {
		if allowPrivateHost && (host == "localhost" || strings.HasSuffix(host, ".localhost")) {
			return []net.IP{net.IPv4(127, 0, 0, 1)}, nil
		}
		return nil, BadAuthRequest("There is no available address for the external service domain name")
	}
	for _, ip := range addresses {
		// Link-local includes cloud metadata (169.254.169.254). An operator
		// allowlist may pin a LAN host, but it must not reopen that range.
		if blockedLinkLocalOrSpecialIP(ip) {
			return nil, BadAuthRequest("Do not allow access to link-local, unspecified, or multicast addresses")
		}
		if !allowPrivateHost && blockedOutboundIP(ip) {
			return nil, BadAuthRequest("Access to local machine, intranet or link-local address is not allowed")
		}
	}
	return addresses, nil
}

func blockedLinkLocalOrSpecialIP(ip net.IP) bool {
	return ip == nil || ip.IsLinkLocalMulticast() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast()
}

func blockedOutboundIP(ip net.IP) bool {
	return blockedLinkLocalOrSpecialIP(ip) || ip.IsLoopback() || ip.IsPrivate()
}

func blockedCustomRelayIP(ip net.IP) bool {
	if blockedOutboundIP(ip) {
		return true
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	address = address.Unmap()
	for _, prefix := range blockedCustomRelayPrefixes {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

var cgnatPrefix = netip.MustParsePrefix("100.64.0.0/10")

// localUpstreamIP is loopback, RFC1918/ULA, or CGNAT. Link-local (including
// cloud metadata), unspecified, multicast, and public addresses are not local.
func localUpstreamIP(ip net.IP) bool {
	if blockedLinkLocalOrSpecialIP(ip) {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() {
		return true
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	return cgnatPrefix.Contains(address.Unmap())
}

func addressesAllowLocalHTTP(addresses []net.IP, allowPrivate bool) bool {
	if !allowPrivate || len(addresses) == 0 {
		return false
	}
	for _, ip := range addresses {
		if !localUpstreamIP(ip) {
			return false
		}
	}
	return true
}

// HostAllowsLocalHTTP reports whether every resolved address is loopback,
// RFC1918/ULA, or CGNAT, and private upstreams are enabled. An operator
// allowlist does not make this true while CANVAS_ALLOW_PRIVATE_UPSTREAMS=false.
// Link-local and metadata addresses stay false.
func HostAllowsLocalHTTP(ctx context.Context, host string) bool {
	if !allowPrivateUpstreams() {
		return false
	}
	addresses, err := resolveOutboundHost(ctx, host)
	if err != nil {
		return false
	}
	return addressesAllowLocalHTTP(addresses, true)
}

func allowPrivateUpstreams() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS"))) {
	case "0", "false", "no":
		return false
	default:
		return true
	}
}

// allowedPrivateUpstreamHost lets operators pin only explicitly trusted upstream
// hostnames to an internal route without disabling SSRF protection for every URL.
func AllowedPrivateUpstreamHost(host string) bool {
	host = normalizeOutboundHost(host)
	if host == "" {
		return false
	}
	for _, configured := range strings.Split(os.Getenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS"), ",") {
		if normalizeOutboundHost(configured) == host {
			return true
		}
	}
	return false
}

func normalizeOutboundHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}
