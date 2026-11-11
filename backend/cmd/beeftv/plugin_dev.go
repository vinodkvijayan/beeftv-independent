package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/protocol"
)

// runPlugin is the offline developer surface for interface plugins: it uses the
// same validator and request builder as the app, never sends a request and
// never needs a key.
func runPlugin(args []string) error {
	if len(args) == 0 {
		return &cliError{code: exitUsage, reason: "invalid_plugin_command", msg: pluginUsage}
	}
	switch args[0] {
	case "validate":
		return runPluginValidate(args[1:])
	case "try":
		return runPluginTry(args[1:])
	default:
		return &cliError{code: exitUsage, reason: "invalid_plugin_command", msg: pluginUsage}
	}
}

const pluginUsage = `Usage:
  beeftv plugin validate <plugin directory|manifest.json|.beeftv-plugin>
  beeftv plugin try <plugin directory|manifest.json|.beefv-plugin> --interface <interface ID> [--model m] [--prompt p] [--base-url u] [--options '{"key":1}']`

func runPluginValidate(args []string) error {
	if len(args) != 1 {
		return &cliError{code: exitUsage, reason: "plugin_path_required", msg: pluginUsage}
	}
	manifest, adapters, err := loadPluginForDev(args[0])
	if err != nil {
		return err
	}
	type item struct {
		ID         string   `json:"id"`
		Label      string   `json:"label"`
		Kinds      []string `json:"capabilities"`
		Create     string   `json:"create,omitempty"`
		Poll       string   `json:"poll,omitempty"`
		OldIDs     []string `json:"legacyAliases,omitempty"`
		PresetsLen int      `json:"presets,omitempty"`
	}
	result := struct {
		OK         bool   `json:"ok"`
		ID         string `json:"id"`
		Version    string `json:"version"`
		Interfaces []item `json:"interfaces"`
	}{OK: true, ID: manifest.Metadata.ID, Version: manifest.Metadata.Version}
	for index, adapter := range adapters {
		metadata := adapter.Metadata()
		entry := item{ID: metadata.ID, Label: metadata.Name, Create: metadata.Create, Poll: metadata.Poll}
		for _, capability := range metadata.Categories {
			entry.Kinds = append(entry.Kinds, string(capability))
		}
		if index < len(manifest.Contributes.Providers) {
			provider := manifest.Contributes.Providers[index]
			entry.Label, entry.OldIDs, entry.PresetsLen = provider.Label, provider.LegacyAliases, len(provider.Presets)
		}
		result.Interfaces = append(result.Interfaces, entry)
	}
	return emitJSON(result)
}

func runPluginTry(args []string) error {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") {
		return &cliError{code: exitUsage, reason: "plugin_path_required", msg: pluginUsage}
	}
	path := args[0]
	flags := flag.NewFlagSet("plugin try", flag.ContinueOnError)
	interfaceID := flags.String("interface", "", "Interface ID (providers[].id in manifest)")
	model := flags.String("model", "test-model", "Model ID")
	prompt := flags.String("prompt", "One sentence test content", "prompt word")
	baseURL := flags.String("base-url", "", "Service address, leave blank to use the default address of the interface")
	options := flags.String("options", "", "providerOptions, JSON object put into the namespace of this interface")
	if err := flags.Parse(args[1:]); err != nil {
		return flagError(err)
	}
	if flags.NArg() != 0 {
		return &cliError{code: exitUsage, reason: "unexpected_argument", msg: pluginUsage}
	}
	manifest, adapters, err := loadPluginForDev(path)
	if err != nil {
		return err
	}
	var adapter protocol.Adapter
	var provider protocol.ManifestProvider
	for index, candidate := range adapters {
		if *interfaceID == "" && len(adapters) == 1 || candidate.Metadata().ID == strings.TrimSpace(*interfaceID) {
			adapter = candidate
			if index < len(manifest.Contributes.Providers) {
				provider = manifest.Contributes.Providers[index]
			}
			break
		}
	}
	if adapter == nil {
		return &cliError{code: exitBadRequest, reason: "plugin_interface_not_found", msg: "There is no such interface in this plug-in; if there are multiple interfaces, use --interface to specify"}
	}
	if strings.TrimSpace(provider.Module) != "" {
		return &cliError{code: exitBadRequest, reason: "plugin_module_interface", msg: "This interface is implemented by plug-in JS and cannot be tested offline; please install it into BeefTV and use \"Generate Test\""}
	}
	capability := protocol.CapabilityText
	if categories := adapter.Metadata().Categories; len(categories) > 0 {
		capability = categories[0]
	}
	request := protocol.GenerationRequest{Capability: capability, Model: *model, Prompt: *prompt}
	if strings.TrimSpace(*options) != "" {
		var values map[string]any
		if err := json.Unmarshal([]byte(*options), &values); err != nil {
			return &cliError{code: exitBadRequest, reason: "plugin_options_invalid", msg: "--options requires a JSON object"}
		}
		request.ProviderOptions = map[string]map[string]any{adapter.Metadata().ID: values}
	}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{BaseURL: *baseURL, Request: request})
	if err != nil {
		return &cliError{code: exitBadRequest, reason: "plugin_request_invalid", msg: "Construct request failed:" + err.Error()}
	}
	base := strings.TrimSpace(*baseURL)
	if base == "" {
		base = provider.BaseURL
	}
	target := spec.Path
	if base != "" {
		if resolved, err := generation.ProtocolRequestURL(base, spec); err == nil {
			target = resolved
		}
	}
	return emitJSON(map[string]any{
		"interface":   adapter.Metadata().ID,
		"method":      spec.Method,
		"url":         target,
		"contentType": spec.ContentType,
		"headers":     spec.Headers,
		"query":       spec.Query,
		"body":        spec.Body,
		"auth":        describeDevAuth(spec.Auth, provider.Auth),
		"note":        "The request is only constructed, not sent, and no key is used.",
	})
}

// loadPluginForDev accepts a plugin folder (package.json with a beeftv field,
// or manifest.json), a bare manifest.json, or a packed .beeftv-plugin, and runs
// the same validation the app runs when installing it.
func loadPluginForDev(path string) (protocol.Manifest, []protocol.Adapter, error) {
	info, err := os.Stat(path)
	if err != nil {
		return protocol.Manifest{}, nil, &cliError{code: exitNotFound, reason: "plugin_path_unavailable", msg: "This path cannot be found:" + path}
	}
	var raw []byte
	var parseErr error
	switch {
	case info.IsDir():
		if _, statErr := os.Stat(filepath.Join(path, "package.json")); statErr == nil {
			pkg, err := protocol.ParsePluginPackageDir(path)
			raw, parseErr = pkg.ManifestRaw, err
		} else {
			raw, parseErr = os.ReadFile(filepath.Join(path, "manifest.json"))
		}
	case strings.HasSuffix(strings.ToLower(path), protocol.PluginPackageExtension):
		data, err := os.ReadFile(path)
		if err != nil {
			parseErr = err
			break
		}
		pkg, err := protocol.ParsePluginPackage(data)
		raw, parseErr = pkg.ManifestRaw, err
	default:
		raw, parseErr = os.ReadFile(path)
	}
	if parseErr != nil {
		return protocol.Manifest{}, nil, &cliError{code: exitBadRequest, reason: "plugin_invalid", msg: "Plug-in verification failed:" + parseErr.Error()}
	}
	var manifest protocol.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return protocol.Manifest{}, nil, &cliError{code: exitBadRequest, reason: "plugin_invalid", msg: "Manifest is not valid JSON:" + err.Error()}
	}
	adapters, err := protocol.LoadInstalledProviders(raw)
	if err != nil {
		return protocol.Manifest{}, nil, &cliError{code: exitBadRequest, reason: "plugin_invalid", msg: "Plug-in verification failed:" + err.Error()}
	}
	return manifest, adapters, nil
}

func describeDevAuth(spec, provider protocol.ManifestAuth) string {
	auth := spec
	if strings.TrimSpace(auth.Type) == "" {
		auth = provider
	}
	if strings.TrimSpace(auth.Type) == "" {
		return "Not declared"
	}
	return fmt.Sprintf("%s (read configuration field %s)", auth.Type, auth.Field)
}
