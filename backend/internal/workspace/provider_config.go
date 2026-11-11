package workspace

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"infinite-canvas/backend/internal/localcrypto"
	"infinite-canvas/backend/internal/providerpreset"
)

const (
	LocalProviderConfigFile = "local-model-config.json"
	RedactedSecret          = "__BEEFTV_REDACTED__"
)

// ProviderConfig owns the local provider snapshot. It has no database or
// hosted-service dependency and can therefore be reused by CLI/desktop shells.
// Mutation is serialized per canonical workspace directory so separately
// constructed handles to the same path share CAS and secret preservation.
type ProviderConfig struct {
	dataDir string
	mu      *sync.Mutex
}

var (
	ErrProviderConfigRevisionConflict = errors.New("The local model configuration has been updated by other writes")
	ErrUnmatchedRedactedSecret        = errors.New("The local model configuration contains a desensitization key that cannot be matched. Please fill in the key again.")
	ErrInvalidProviderIdentity        = errors.New("Local model configuration contains invalid or duplicate channel ID")
	ErrMalformedProviderConfig        = errors.New("Local model configuration is corrupted")
	ErrProviderConfigNotObject        = errors.New("Local model configuration must be a JSON object")
)

var providerConfigGuards sync.Map // canonical data dir -> *sync.Mutex

func NewProviderConfig(dataDir string) (*ProviderConfig, error) {
	dataDir = strings.TrimSpace(dataDir)
	if dataDir == "" {
		return nil, errors.New("The local workspace data directory cannot be empty")
	}
	canonical, err := canonicalWorkspacePath(dataDir)
	if err != nil {
		return nil, err
	}
	return &ProviderConfig{dataDir: canonical, mu: mutexFor(canonical)}, nil
}

func canonicalWorkspacePath(dataDir string) (string, error) {
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return "", fmt.Errorf("Failed to parse local workspace data directory: %w", err)
	}
	abs = filepath.Clean(abs)
	existing, missing, err := splitExistingPrefix(abs)
	if err != nil {
		return "", fmt.Errorf("Failed to parse local workspace data directory: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", fmt.Errorf("Failed to parse local workspace data directory: %w", err)
	}
	if len(missing) == 0 {
		return resolved, nil
	}
	return filepath.Join(append([]string{resolved}, missing...)...), nil
}

func splitExistingPrefix(path string) (existing string, missing []string, err error) {
	current := path
	var suffix []string
	for {
		_, statErr := os.Lstat(current)
		if statErr == nil {
			if len(suffix) == 0 {
				return current, nil, nil
			}
			missing = make([]string, 0, len(suffix))
			for i := len(suffix) - 1; i >= 0; i-- {
				missing = append(missing, suffix[i])
			}
			return current, missing, nil
		}
		if !errors.Is(statErr, os.ErrNotExist) {
			return "", nil, statErr
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", nil, statErr
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}

func mutexFor(canonical string) *sync.Mutex {
	if existing, ok := providerConfigGuards.Load(canonical); ok {
		return existing.(*sync.Mutex)
	}
	fresh := &sync.Mutex{}
	actual, _ := providerConfigGuards.LoadOrStore(canonical, fresh)
	return actual.(*sync.Mutex)
}

func (s *ProviderConfig) ReadLocalModelConfig() ([]byte, error) {
	effective, _, err := s.LoadEffectiveModelConfig()
	if err != nil {
		return nil, err
	}
	return json.Marshal(effective.Config)
}

func (s *ProviderConfig) ReadRedactedModelConfig() ([]byte, error) {
	body, err := s.ReadLocalModelConfig()
	if err != nil || len(body) == 0 {
		return body, err
	}
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return nil, fmt.Errorf("The local model configuration is damaged: %w", err)
	}
	redactSecrets(value)
	return json.Marshal(value)
}

func (s *ProviderConfig) SaveLocalModelConfig(body []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existingDocument, err := s.loadPrimaryDocument()
	if err != nil {
		return err
	}
	_, err = s.saveLocalModelConfig(body, existingDocument)
	return err
}

func (s *ProviderConfig) SaveLocalModelConfigRevision(body []byte, expectedRevision int64) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existingDocument, err := s.loadPrimaryDocument()
	if err != nil {
		return 0, err
	}
	if existingDocument.Revision != expectedRevision {
		return existingDocument.Revision, ErrProviderConfigRevisionConflict
	}
	return s.saveLocalModelConfig(body, existingDocument)
}

// SaveCatalogWithAssistantDefault records initialization with the config atomically.
// Connection-state retries and frontend snapshots cannot reset a later user choice.
// A fresh authorization only fills the gap when nothing was saved yet: reconnecting
// or switching accounts never moves a user off the assistant model they picked, not
// even when that model is missing from the new catalog (the app then asks them to
// choose again instead of silently switching them to a different model).
func (s *ProviderConfig) SaveCatalogWithAssistantDefault(body []byte, authorizationID, model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadPrimaryDocument()
	if err != nil {
		return err
	}
	incoming, err := decodeIncomingConfig(body)
	if err != nil {
		return err
	}
	if authorizationID != "" && document.AssistantDefaultAuthorization != authorizationID {
		if saved := savedAssistantSelection(document.Config); saved != "" {
			incoming["assistantModel"] = saved
		} else if model != "" {
			incoming["assistantModel"] = model
		}
		document.AssistantDefaultAuthorization = authorizationID
	} else if document.Config != nil {
		// A catalog read may predate a concurrent explicit selection.
		if selected, exists := document.Config["assistantModel"]; exists {
			incoming["assistantModel"] = selected
		} else {
			delete(incoming, "assistantModel")
		}
	}
	body, err = json.Marshal(incoming)
	if err != nil {
		return err
	}
	_, err = s.saveLocalModelConfig(body, document)
	return err
}

func savedAssistantSelection(config map[string]any) string {
	if config == nil {
		return ""
	}
	value, _ := config["assistantModel"].(string)
	return strings.TrimSpace(value)
}

func (s *ProviderConfig) saveLocalModelConfig(body []byte, existingDocument ProviderStateDocument) (int64, error) {
	if len(body) == 0 || len(body) > 2<<20 {
		return existingDocument.Revision, errors.New("Local model configuration size is invalid")
	}
	incoming, err := decodeIncomingConfig(body)
	if err != nil {
		return existingDocument.Revision, err
	}
	if existingDocument.Config != nil {
		if err := preserveSecrets(incoming, existingDocument.Config); err != nil {
			return existingDocument.Revision, err
		}
	}
	revision := existingDocument.Revision
	if !reflect.DeepEqual(incoming, existingDocument.Config) {
		revision++
	}
	document := newProviderState(incoming, revision)
	document.AssistantDefaultAuthorization = existingDocument.AssistantDefaultAuthorization
	// Authorization initialization and encryption migration still persist even
	// when generation settings have not changed.
	if err := s.writeDocument(document); err != nil {
		return existingDocument.Revision, err
	}
	return revision, nil
}

// Caller holds s.mu; encryption-only migration preserves the CAS revision.
func (s *ProviderConfig) writeDocument(document ProviderStateDocument) error {
	canonical, err := s.encodeStoredDocument(document)
	if err != nil {
		return fmt.Errorf("Encoding local model configuration failed: %w", err)
	}
	if err := os.MkdirAll(s.dataDir, 0o700); err != nil {
		return fmt.Errorf("Failed to create local configuration directory: %w", err)
	}
	if err := os.Chmod(s.dataDir, 0o700); err != nil {
		return fmt.Errorf("Failed to set local configuration directory permissions: %w", err)
	}
	tmp, err := os.CreateTemp(s.dataDir, ".local-model-config-*")
	if err != nil {
		return fmt.Errorf("Failed to create local configuration temporary file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to set local configuration permissions: %w", err)
	}
	if _, err := tmp.Write(canonical); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to write local model configuration: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to synchronize local model configuration: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("Failed to close local model configuration: %w", err)
	}
	if err := s.rotateBackup(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, s.path()); err != nil {
		return fmt.Errorf("Failed to replace local model configuration: %w", err)
	}
	if err := os.Chmod(s.path(), 0o600); err != nil {
		return fmt.Errorf("Failed to set local configuration permissions: %w", err)
	}
	if directory, err := os.Open(s.dataDir); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}

func (s *ProviderConfig) path() string { return filepath.Join(s.dataDir, LocalProviderConfigFile) }

func (s *ProviderConfig) backupPath() string { return s.path() + ".bak" }

func (s *ProviderConfig) LoadEffectiveModelConfig() (EffectiveModelConfig, ConfigHealth, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, health, err := s.loadDocument()
	if err != nil {
		return EffectiveModelConfig{}, health, err
	}
	effective, err := effectiveProviderState(document)
	if err != nil {
		return EffectiveModelConfig{}, health, fmt.Errorf("Failed to merge built-in model configuration: %w", err)
	}
	return effective, health, nil
}

// SavedProtocolReferences counts the protocol IDs saved in local channels and
// model profiles. Bootstrap uses it to keep an official protocol plugin alive
// while a saved connection still executes with it.
//
// The audit is read-only on purpose: it decodes the stored document without
// rewriting it, never returns a credential value, and leaves repair and
// migration to the normal read path.
func (s *ProviderConfig) SavedProtocolReferences() (map[string]int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := s.readAuditDocument()
	if err != nil {
		return nil, err
	}
	if body == nil {
		return map[string]int64{}, nil
	}
	document, _, decodeErr := s.decodeStoredDocument(body)
	if decodeErr != nil {
		return nil, fmt.Errorf("The local model configuration cannot be parsed, all official protocols are retained: %w", decodeErr)
	}
	return savedProtocolCounts(document.Config), nil
}

// savedProtocolCounts counts, per protocol ID, the saved channels and models
// that execute with it. A model's protocol is decided by
// providerpreset.SavedModelProtocol, the same rule the client submits with, so
// a profile that omits the field is counted under the legacy default it has
// always run with (an audio profile under openai-audio) rather than not at all.
func savedProtocolCounts(config map[string]any) map[string]int64 {
	counts := make(map[string]int64)
	channels, _ := config["channels"].([]any)
	for _, entry := range channels {
		channel, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		// interfaceType keeps the protocol of channels that were configured
		// before per-model profiles existed.
		countProtocolReference(counts, channel["interfaceType"])
		countProtocolReference(counts, channel["protocol"])
		saved := providerpreset.SavedChannel{
			Scope:         stringField(channel, "scope"),
			APIFormat:     stringField(channel, "apiFormat"),
			InterfaceType: stringField(channel, "interfaceType"),
		}
		profiles, _ := channel["modelProfiles"].([]any)
		seen := make(map[string]struct{}, len(profiles))
		for _, profile := range profiles {
			item, ok := profile.(map[string]any)
			if !ok {
				continue
			}
			model := stringField(item, "model")
			seen[model] = struct{}{}
			pending, _ := item["protocolPending"].(bool)
			countProtocolReference(counts, providerpreset.SavedModelProtocol(saved, providerpreset.SavedModel{
				Model: model, Capability: stringField(item, "capability"), Protocol: stringField(item, "protocol"),
				ProtocolPending: pending,
			}))
		}
		// A listed model without a profile runs with the channel protocol or the
		// legacy default, so it needs that protocol just as much.
		models, _ := channel["models"].([]any)
		for _, value := range models {
			model, _ := value.(string)
			if _, profiled := seen[model]; profiled || strings.TrimSpace(model) == "" {
				continue
			}
			countProtocolReference(counts, providerpreset.SavedModelProtocol(saved, providerpreset.SavedModel{Model: model}))
		}
	}
	return counts
}

func stringField(values map[string]any, key string) string {
	text, _ := values[key].(string)
	return strings.TrimSpace(text)
}

// readAuditDocument returns the configuration bytes the audit should count,
// without repairing, migrating or rewriting anything.
//
// The normal read path recovers a lost primary file from its backup, so a
// missing primary is not the same as "no configuration": silently reporting an
// empty inventory there would delete the plugins the recovered connections
// need. A first run (neither file) is genuinely empty; an unreadable pair is
// reported as an error so bootstrap keeps everything.
func (s *ProviderConfig) readAuditDocument() ([]byte, error) {
	body, err := os.ReadFile(s.path())
	if err == nil {
		return body, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("Failed to read local model configuration: %w", err)
	}
	backup, backupErr := os.ReadFile(s.backupPath())
	if errors.Is(backupErr, os.ErrNotExist) {
		return nil, nil
	}
	if backupErr != nil {
		return nil, fmt.Errorf("Failed to read local model configuration backup: %w", backupErr)
	}
	return backup, nil
}

func countProtocolReference(counts map[string]int64, value any) {
	text, ok := value.(string)
	if !ok {
		return
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	counts[text]++
}

func (s *ProviderConfig) loadDocument() (ProviderStateDocument, ConfigHealth, error) {
	body, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		backup, backupErr := os.ReadFile(s.backupPath())
		if errors.Is(backupErr, os.ErrNotExist) {
			return newProviderState(map[string]any{}, 0), ConfigHealthDefault, nil
		}
		if backupErr != nil {
			return ProviderStateDocument{}, ConfigHealthReady, fmt.Errorf("Failed to read model configuration backup: %w", backupErr)
		}
		document, _, decodeErr := s.decodeStoredDocument(backup)
		if decodeErr != nil {
			return ProviderStateDocument{}, ConfigHealthReady, fmt.Errorf("Model configuration is missing and backup is damaged: %w", decodeErr)
		}
		return document, ConfigHealthRecovered, nil
	}
	if err != nil {
		return ProviderStateDocument{}, ConfigHealthReady, fmt.Errorf("Failed to read local model configuration: %w", err)
	}
	document, migrated, decodeErr := s.decodeStoredDocument(body)
	if decodeErr == nil {
		if migrated {
			if err := s.writeDocument(document); err != nil {
				return ProviderStateDocument{}, ConfigHealthReady, fmt.Errorf("Encryption of old model configuration failed: %w", err)
			}
			return document, ConfigHealthMigrated, nil
		}
		return document, ConfigHealthReady, nil
	}
	backup, backupErr := os.ReadFile(s.backupPath())
	if backupErr != nil {
		return ProviderStateDocument{}, ConfigHealthReady, fmt.Errorf("The local model configuration is corrupted and no backup is available: %w", decodeErr)
	}
	document, _, backupDecodeErr := s.decodeStoredDocument(backup)
	if backupDecodeErr != nil {
		return ProviderStateDocument{}, ConfigHealthReady, fmt.Errorf("The local model configuration and backup are damaged: %w", decodeErr)
	}
	return document, ConfigHealthRecovered, nil
}

func (s *ProviderConfig) loadPrimaryDocument() (ProviderStateDocument, error) {
	body, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		document, _, recoverErr := s.loadDocument()
		return document, recoverErr
	}
	if err != nil {
		return ProviderStateDocument{}, fmt.Errorf("Failed to read local model configuration: %w", err)
	}
	document, _, decodeErr := s.decodeStoredDocument(body)
	if decodeErr != nil {
		return ProviderStateDocument{}, fmt.Errorf("The local model configuration is damaged: %w", decodeErr)
	}
	return document, nil
}

func decodeProviderDocument(body []byte) (ProviderStateDocument, bool, error) {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return ProviderStateDocument{}, false, ErrMalformedProviderConfig
	}
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		var syntax *json.SyntaxError
		if errors.As(err, &syntax) {
			return ProviderStateDocument{}, false, errors.New("Local model configuration must be valid JSON")
		}
		return ProviderStateDocument{}, false, ErrMalformedProviderConfig
	}
	object, ok := raw.(map[string]any)
	if !ok || object == nil {
		return ProviderStateDocument{}, false, ErrProviderConfigNotObject
	}
	if _, versioned := object["schemaVersion"]; versioned {
		document, err := decodeVersionedProviderDocument(body, object)
		return document, false, err
	}
	return newProviderState(object, 0), true, nil
}

func decodeVersionedProviderDocument(body []byte, object map[string]any) (ProviderStateDocument, error) {
	schemaVersion, ok := jsonNonNegativeInt(object["schemaVersion"])
	if !ok || schemaVersion != providerStateSchemaVersion {
		return ProviderStateDocument{}, ErrMalformedProviderConfig
	}
	if _, exists := object["revision"]; !exists || object["revision"] == nil {
		return ProviderStateDocument{}, ErrMalformedProviderConfig
	}
	if _, ok := jsonNonNegativeInt(object["revision"]); !ok {
		return ProviderStateDocument{}, ErrMalformedProviderConfig
	}
	config, ok := object["config"].(map[string]any)
	if !ok || config == nil {
		return ProviderStateDocument{}, ErrMalformedProviderConfig
	}
	var document ProviderStateDocument
	if err := json.Unmarshal(body, &document); err != nil {
		return ProviderStateDocument{}, ErrMalformedProviderConfig
	}
	if document.SchemaVersion != providerStateSchemaVersion || document.Config == nil || document.Revision < 0 {
		return ProviderStateDocument{}, ErrMalformedProviderConfig
	}
	return document, nil
}

func jsonNonNegativeInt(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		n := int64(typed)
		if typed != float64(n) || n < 0 {
			return 0, false
		}
		return n, true
	case json.Number:
		n, err := typed.Int64()
		if err != nil || n < 0 {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

func decodeIncomingConfig(body []byte) (map[string]any, error) {
	document, _, err := decodeProviderDocument(body)
	if err != nil {
		return nil, err
	}
	if document.Config == nil {
		return nil, ErrProviderConfigNotObject
	}
	return document.Config, nil
}

// Keep the public/in-memory config shape unchanged; only its disk envelope is
// encrypted. This also protects custom header credentials and legacy fields.
func (s *ProviderConfig) encodeStoredDocument(document ProviderStateDocument) ([]byte, error) {
	body, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	ciphertext, err := localcrypto.Encrypt(s.dataDir, string(body))
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"schemaVersion": 2, "encryptedConfig": ciphertext})
}

func (s *ProviderConfig) decodeStoredDocument(body []byte) (ProviderStateDocument, bool, error) {
	var envelope struct {
		SchemaVersion   int    `json:"schemaVersion"`
		EncryptedConfig string `json:"encryptedConfig"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ProviderStateDocument{}, false, err
	}
	if envelope.EncryptedConfig == "" {
		if envelope.SchemaVersion == 2 {
			return ProviderStateDocument{}, false, errors.New("The local model configuration secret text is missing")
		}
		document, _, err := decodeProviderDocument(body)
		return document, true, err
	}
	plain, err := localcrypto.Decrypt(s.dataDir, envelope.EncryptedConfig)
	if err != nil {
		return ProviderStateDocument{}, false, err
	}
	return decodeProviderDocument([]byte(plain))
}

func (s *ProviderConfig) rotateBackup() error {
	source, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("Failed to read old model configuration: %w", err)
	}
	document, _, err := s.decodeStoredDocument(source)
	if err != nil {
		return nil
	}
	canonical, err := s.encodeStoredDocument(document)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dataDir, ".local-model-config-backup-*")
	if err != nil {
		return fmt.Errorf("Failed to create model configuration backup: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(canonical); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("Failed to write model configuration backup: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, s.backupPath()); err != nil {
		return fmt.Errorf("Replacement model configuration backup failed: %w", err)
	}
	return nil
}

func redactSecrets(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == "headers" {
				headers, _ := child.([]any)
				for _, raw := range headers {
					if header, ok := raw.(map[string]any); ok && header["value"] != nil && header["value"] != "" {
						header["value"] = RedactedSecret
					}
				}
				continue
			}
			if isSecretKey(key) && child != nil && fmt.Sprint(child) != "" {
				typed[key] = RedactedSecret
				continue
			}
			redactSecrets(child)
		}
	case []any:
		for _, child := range typed {
			redactSecrets(child)
		}
	}
}

func preserveSecrets(incoming, existing any) error {
	switch next := incoming.(type) {
	case map[string]any:
		previous, _ := existing.(map[string]any)
		for key, value := range next {
			if key == "headers" {
				incomingHeaders, _ := value.([]any)
				oldHeaders, _ := previous[key].([]any)
				for _, raw := range incomingHeaders {
					header, ok := raw.(map[string]any)
					if !ok || header["value"] != RedactedSecret {
						continue
					}
					matched := false
					for _, old := range oldHeaders {
						oldHeader, ok := old.(map[string]any)
						if ok && strings.EqualFold(fmt.Sprint(header["name"]), fmt.Sprint(oldHeader["name"])) && usableStoredSecret(oldHeader["value"]) {
							header["value"] = oldHeader["value"]
							matched = true
							break
						}
					}
					if !matched {
						return ErrUnmatchedRedactedSecret
					}
				}
				continue
			}
			if isSecretKey(key) && isRedactedMarker(value) {
				if previous == nil {
					return ErrUnmatchedRedactedSecret
				}
				old, ok := previous[key]
				if !ok || !usableStoredSecret(old) {
					return ErrUnmatchedRedactedSecret
				}
				next[key] = old
				continue
			}
			var old any
			if previous != nil {
				old = previous[key]
			}
			if err := preserveSecrets(value, old); err != nil {
				return err
			}
		}
		return nil
	case []any:
		previous, _ := existing.([]any)
		return preserveSecretList(next, previous)
	default:
		return nil
	}
}

func preserveSecretList(next, previous []any) error {
	if !containsRedactedSecret(next) {
		return nil
	}
	incoming := inspectArrayIdentity(next)
	if incoming.invalid || incoming.duplicate {
		return ErrInvalidProviderIdentity
	}
	stored := inspectArrayIdentity(previous)
	if incoming.keyed && stored.duplicate {
		return ErrInvalidProviderIdentity
	}
	positional := !incoming.keyed && !stored.keyed
	previousByID := map[string]any{}
	if incoming.keyed {
		for _, item := range previous {
			id, has, valid := objectStringID(item)
			if has && valid {
				previousByID[id] = item
			}
		}
	}
	for index, value := range next {
		var old any
		id, has, valid := objectStringID(value)
		switch {
		case has && valid:
			old = previousByID[id]
		case positional && index < len(previous):
			old = previous[index]
		}
		if err := preserveSecrets(value, old); err != nil {
			return err
		}
	}
	return nil
}

func containsRedactedSecret(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if strings.EqualFold(key, "headers") {
				switch headers := child.(type) {
				case []any:
					for _, raw := range headers {
						if header, ok := raw.(map[string]any); ok && isRedactedMarker(header["value"]) {
							return true
						}
					}
				case map[string]any:
					for _, raw := range headers {
						if isRedactedMarker(raw) {
							return true
						}
					}
				}
				continue
			}
			if isSecretKey(key) && isRedactedMarker(child) {
				return true
			}
			if containsRedactedSecret(child) {
				return true
			}
		}
		return false
	case []any:
		for _, child := range typed {
			if containsRedactedSecret(child) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

type arrayIdentity struct {
	keyed     bool
	duplicate bool
	invalid   bool
}

func inspectArrayIdentity(items []any) arrayIdentity {
	seen := map[string]int{}
	var info arrayIdentity
	for _, item := range items {
		id, has, valid := objectStringID(item)
		if !has {
			continue
		}
		if !valid {
			info.invalid = true
			continue
		}
		info.keyed = true
		seen[id]++
		if seen[id] > 1 {
			info.duplicate = true
		}
	}
	return info
}

func objectStringID(value any) (id string, has bool, valid bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return "", false, true
	}
	raw, exists := object["id"]
	if !exists {
		return "", false, true
	}
	id, ok = raw.(string)
	if !ok || id == "" {
		return "", true, false
	}
	return id, true, true
}

func isRedactedMarker(value any) bool {
	text, ok := value.(string)
	return ok && text == RedactedSecret
}

func usableStoredSecret(value any) bool {
	if value == nil || isRedactedMarker(value) {
		return false
	}
	text, ok := value.(string)
	return !ok || text != ""
}

func isSecretKey(key string) bool {
	key = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "_", ""))
	return key == "apikey" || key == "secretkey" || key == "token" || key == "secret" || strings.HasSuffix(key, "token") || strings.HasSuffix(key, "secret")
}
