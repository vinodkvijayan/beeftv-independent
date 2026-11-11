package app

import (
	"fmt"

	"infinite-canvas/backend/internal/plugins"
	"infinite-canvas/backend/internal/workspace"
)

// providerReferenceSource is the part of the task and channel store the
// retention audit needs. The repository implements it; tests substitute counts
// so the merge rules stay verifiable without a database.
type providerReferenceSource interface {
	ChannelModelProtocolReferences() (map[string]int64, error)
	TaskProviderReferences() (map[string]int64, error)
}

// pluginReferences is the startup audit behind protocol plugin retention. It
// answers one question: which provider IDs do saved configuration and
// unfinished tasks still execute with?
//
// It reads three existing sources and invents no new state:
//   - the local provider snapshot (BYOK connections and model profiles);
//   - saved system channel models, which carry their own protocol;
//   - tasks whose result can still be retrieved with the original protocol.
//
// The audit is read-only and returns counts only; it never copies credentials
// and never writes configuration.
type pluginReferences struct {
	dataDir string
	store   providerReferenceSource
}

func newPluginReferences(dataDir string, store providerReferenceSource) plugins.ReferenceSource {
	if store == nil {
		return nil
	}
	return pluginReferences{dataDir: dataDir, store: store}
}

func (r pluginReferences) ReferencedProviders() (map[string]plugins.ReferenceUsage, error) {
	usage := make(map[string]plugins.ReferenceUsage)
	configured, err := r.configuredProtocols()
	if err != nil {
		return nil, err
	}
	mergeReferenceCounts(usage, configured, false)
	channelModels, err := r.store.ChannelModelProtocolReferences()
	if err != nil {
		return nil, fmt.Errorf("Inventory system channel model agreement failed: %w", err)
	}
	mergeReferenceCounts(usage, channelModels, false)
	pendingTasks, err := r.store.TaskProviderReferences()
	if err != nil {
		return nil, fmt.Errorf("The task of counting the results without retrieval failed: %w", err)
	}
	mergeReferenceCounts(usage, pendingTasks, true)
	return usage, nil
}

func (r pluginReferences) configuredProtocols() (map[string]int64, error) {
	store, err := workspace.NewProviderConfig(r.dataDir)
	if err != nil {
		return nil, fmt.Errorf("Failed to read local model configuration: %w", err)
	}
	counts, err := store.SavedProtocolReferences()
	if err != nil {
		return nil, fmt.Errorf("Inventory of local model configuration protocol failed: %w", err)
	}
	return counts, nil
}

func mergeReferenceCounts(usage map[string]plugins.ReferenceUsage, counts map[string]int64, tasks bool) {
	for id, total := range counts {
		if total <= 0 {
			continue
		}
		entry := usage[id]
		if tasks {
			entry.PendingTasks += total
		} else {
			entry.Configured += total
		}
		usage[id] = entry
	}
}
