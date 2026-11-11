package resource

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"
)

const imageHeaderDecodeLimit = 2 << 20

type RemotePayload struct {
	URL      string
	Endpoint string
	FileName string
	MimeType string
	Data     []byte
}

type LifecycleConfig struct {
	RecordActivity       func(userID string, kind string, count int)
	AppearanceReferenced func(resourceIDs []string) map[string]struct{}
	RecycleRetentionDays func() (int, error)
	WorkerID             func() string
	RunBackground        func(fn func())
	DeleteUserAsset      func(userID string, assetID string) error
	WithStorageLock      func(fn func() error) error
}

type configLifecycle struct {
	cfg LifecycleConfig
}

func NewLifecycle(cfg LifecycleConfig) localasset.Lifecycle {
	return configLifecycle{cfg: cfg}
}

func (l configLifecycle) RecordActivity(userID string, kind string, count int) {
	if l.cfg.RecordActivity != nil {
		l.cfg.RecordActivity(userID, kind, count)
	}
}

func (l configLifecycle) AfterResourceReady(*model.Resource) {}

func (l configLifecycle) AppearanceReferencedIDs(resourceIDs []string) map[string]struct{} {
	if l.cfg.AppearanceReferenced == nil {
		return map[string]struct{}{}
	}
	return l.cfg.AppearanceReferenced(resourceIDs)
}

func (l configLifecycle) RecycleRetentionDays() (int, error) {
	if l.cfg.RecycleRetentionDays == nil {
		return 0, nil
	}
	return l.cfg.RecycleRetentionDays()
}

func (l configLifecycle) WorkerID() string {
	if l.cfg.WorkerID == nil {
		return ""
	}
	return l.cfg.WorkerID()
}

func (l configLifecycle) RunBackground(fn func()) {
	if l.cfg.RunBackground != nil && fn != nil {
		l.cfg.RunBackground(fn)
	}
}

func (l configLifecycle) DeleteUserAsset(userID string, assetID string) error {
	if l.cfg.DeleteUserAsset == nil {
		return nil
	}
	return l.cfg.DeleteUserAsset(userID, assetID)
}

func (l configLifecycle) WithStorageLock(fn func() error) error {
	if fn == nil {
		return nil
	}
	if l.cfg.WithStorageLock == nil {
		return fn()
	}
	return l.cfg.WithStorageLock(fn)
}

func DirectURL(resource *model.Resource, expiresAt time.Time, keyFn func() ([]byte, error)) (string, error) {
	if resource == nil {
		return "", errors.New("Resource does not exist")
	}
	if resource.Status != model.ResourceStatusReady {
		return "", kernel.BadAuthRequest("The resource has not been uploaded yet")
	}
	if resource.Provider != "local" {
		return "", kernel.BadAuthRequest("Resource is not in local storage")
	}
	return SignedPublicURL(resource, expiresAt, keyFn)
}

func SignedPublicURL(resource *model.Resource, expiresAt time.Time, keyFn func() ([]byte, error)) (string, error) {
	if resource == nil {
		return "", errors.New("Resource does not exist")
	}
	baseURL, err := PublicBaseURL()
	if err != nil {
		return "", err
	}
	expires := strconv.FormatInt(expiresAt.UTC().Unix(), 10)
	signature, err := SignPublic(resource.ID, expires, keyFn)
	if err != nil {
		return "", err
	}
	ext := localasset.FileExtension(resource.ObjectKey, resource.MimeType, resource.Kind)
	filename := resource.ID
	if ext != "" {
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		filename += ext
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/api/public/resources/" + url.PathEscape(resource.ID) + "/file/" + url.PathEscape(filename)
	query := baseURL.Query()
	query.Set("expires", expires)
	query.Set("signature", signature)
	baseURL.RawQuery = query.Encode()
	return baseURL.String(), nil
}

func SignedHTTPSPublicURL(resource *model.Resource, expiresAt time.Time, keyFn func() ([]byte, error)) (string, error) {
	baseURL, err := PublicBaseURL()
	if err != nil {
		return "", err
	}
	if baseURL.Scheme != "https" {
		return "", kernel.BadAuthRequest("When private network or HTTP S3 is used for upstream resources, the public access address of the server must use HTTPS")
	}
	return SignedPublicURL(resource, expiresAt, keyFn)
}

func VerifyPublicSignature(resourceID, expires, signature string, keyFn func() ([]byte, error)) error {
	if strings.TrimSpace(signature) == "" || !DecimalDigits(expires) {
		return kernel.Forbidden("Anonymous download link is invalid")
	}
	expiresAt, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || time.Now().UTC().Unix() > expiresAt {
		return kernel.Forbidden("Anonymous download link has expired")
	}
	expected, err := SignPublic(resourceID, expires, keyFn)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return kernel.Forbidden("Anonymous download link is invalid")
	}
	return nil
}

func SignPublic(resourceID, expires string, keyFn func() ([]byte, error)) (string, error) {
	key, err := keyFn()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(resourceID + "\n" + expires))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func PublicBaseURL() (*url.URL, error) {
	raw := strings.TrimSpace(os.Getenv("CANVAS_PUBLIC_BASE_URL"))
	if raw == "" {
		return nil, kernel.BadAuthRequest("The local resource has not been configured with an upstream accessible address, please set CANVAS_PUBLIC_BASE_URL")
	}
	return ValidatePublicBaseURL(raw)
}

func validateOutboundURL(raw string) (*url.URL, error) {
	parsed, err := outbound.ValidateOutboundURL(raw)
	if req, ok := err.(*outbound.BadRequestError); ok {
		return nil, kernel.BadAuthRequest(req.Message)
	}
	return parsed, err
}

func ValidatePublicBaseURL(raw string) (*url.URL, error) {
	parsed, err := validateOutboundURL(raw)
	if err != nil {
		return nil, err
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, kernel.BadAuthRequest("Server access address cannot contain query parameters or fragments")
	}
	if strings.HasSuffix(strings.TrimRight(parsed.Path, "/"), "/api") {
		return nil, kernel.BadAuthRequest("Please fill in the root address for server access address, do not include /api")
	}
	return parsed, nil
}

func OpenPublicRange(repo *repository.Repository, domain *localasset.Service, id, expires, signature, rangeHeader string, keyFn func() ([]byte, error)) (*assets.ResourceStream, error) {
	resource, err := repo.Resource(id)
	if err != nil || resource.Provider != "local" {
		return nil, kernel.Forbidden("Anonymous download link is invalid")
	}
	if err := VerifyPublicSignature(resource.ID, expires, signature, keyFn); err != nil {
		return nil, err
	}
	return domain.OpenOwnedRange(resource.UserID, resource, rangeHeader)
}

func ImportURL(domain *localasset.Service, localMode bool, maxBytes int64, userID, rawURL, kind string, width, height int, durationMs int64, uploadIdentity ...string) (*model.Resource, error) {
	if localMode {
		return nil, localasset.RemoteImportForbidden()
	}
	payload, err := DownloadRemote(rawURL, maxBytes)
	if err != nil {
		return nil, err
	}
	kind = localasset.NormalizeKind(kind, payload.MimeType)
	if kind == "image" && (width <= 0 || height <= 0) {
		if decodedWidth, decodedHeight := ImageDimensions(payload.Data); decodedWidth > 0 && decodedHeight > 0 {
			width = decodedWidth
			height = decodedHeight
		}
	}
	size := int64(len(payload.Data))
	return domain.IngestUpload(userID, kind, payload.FileName, payload.MimeType, size, width, height, durationMs, bytes.NewReader(payload.Data), uploadIdentity...)
}

func DownloadRemote(rawURL string, maxBytes int64) (RemotePayload, error) {
	parsed, err := validateOutboundURL(rawURL)
	if err != nil {
		return RemotePayload{}, err
	}
	client := outbound.OutboundHTTPClient(90 * time.Second)
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return RemotePayload{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return RemotePayload{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RemotePayload{}, fmt.Errorf("Remote resource download failed: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return RemotePayload{}, err
	}
	if int64(len(data)) >= maxBytes {
		return RemotePayload{}, kernel.BadAuthRequest(fmt.Sprintf("The remote resource must be smaller than %s", localasset.FormatStorageLimit(maxBytes)))
	}
	mimeType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data)
	}
	fileName := path.Base(parsed.Path)
	if fileName == "" || fileName == "." || !strings.Contains(fileName, ".") {
		fileName = "resource." + localasset.ExtensionFromMimeType(mimeType)
	}
	return RemotePayload{URL: parsed.String(), Endpoint: parsed.Host, FileName: fileName, MimeType: mimeType, Data: data}, nil
}

func ImageDimensions(data []byte) (int, int) {
	width, height, err := ImageHeaderDimensions(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return width, height
}

func ImageHeaderDimensions(r io.Reader) (int, int, error) {
	config, _, err := image.DecodeConfig(io.LimitReader(r, imageHeaderDecodeLimit))
	if err != nil {
		return 0, 0, err
	}
	return config.Width, config.Height, nil
}

func DecimalDigits(value string) bool {
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func IntValue(value any) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case int64:
		return int(number)
	default:
		return 0
	}
}

func UploadInProgress() *kernel.AppError {
	err := localasset.UploadInProgress()
	if appErr, ok := err.(*kernel.AppError); ok {
		return appErr
	}
	conflict := kernel.NewAppError(http.StatusConflict, err.Error())
	conflict.Retryable = true
	return conflict
}

func DirectURLByID(domain *localasset.Service, userID, id string, ttl time.Duration, encryptionKey func() ([]byte, error)) (string, error) {
	item, err := domain.Resource(userID, id)
	if err != nil {
		return "", err
	}
	return DirectURL(item, time.Now().Add(ttl), encryptionKey)
}

func RetryOwnedItem(domain *localasset.Service, userID string, item *model.Resource, kind, mimeType string, size int64, body io.Reader) (*model.Resource, error) {
	if item == nil {
		return nil, localasset.ResourceMissing()
	}
	return domain.RetryOwned(userID, item.ID, kind, mimeType, size, body)
}

func ImportURLWithPolicy(domain *localasset.Service, localMode bool, loadPolicy func() (platform.RuntimePolicySetting, error), userID, rawURL, kind string, width, height int, durationMs int64, uploadIdentity ...string) (*model.Resource, error) {
	p, err := loadPolicy()
	if err != nil {
		return nil, err
	}
	return ImportURL(domain, localMode, kernel.Megabytes(p.Resource.ResourceUploadMB), userID, rawURL, kind, width, height, durationMs, uploadIdentity...)
}
