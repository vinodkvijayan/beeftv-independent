package plugins

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

// Service is the typed plugin-domain boundary. It owns management policy,
// user/platform activation, and delegates registry mutation to Runtime.
// Lifecycle locks live on the persistent Runtime: the host constructs a new
// Service per call, so a Service-local mutex cannot serialize install or
// availability updates.
type Service struct {
	runtime *Runtime
	store   Store
}

func New(runtime *Runtime, store Store) *Service {
	return &Service{runtime: runtime, store: store}
}

func (s *Service) durableStore() Store {
	if s == nil {
		return nil
	}
	if s.runtime != nil && s.runtime.store != nil {
		return s.runtime.store
	}
	return s.store
}

func (s *Service) Runtime() *Runtime {
	if s == nil {
		return nil
	}
	return s.runtime
}

func (s *Service) runtimeItems() []View {
	if s == nil || s.runtime == nil {
		return []View{}
	}
	return s.runtime.List()
}

func (s *Service) List() []View {
	items := s.runtimeItems()
	for index := range items {
		items[index].Management = ManagementFromView(items[index])
	}
	return items
}

func (s *Service) Registry() *protocol.Registry {
	if s == nil || s.runtime == nil {
		return nil
	}
	return s.runtime.Registry()
}

func (s *Service) Install(data []byte, fileName string) (View, error) {
	if s == nil || s.runtime == nil {
		return View{}, fmt.Errorf("The plugin is not initialized when running")
	}
	plugin, err := s.runtime.Install(data, fileName)
	if err != nil {
		return View{}, err
	}
	plugin.Management = ManagementFromView(plugin)
	return plugin, nil
}

func (s *Service) InstallUploaded(actorID string, data []byte, fileName string) (View, error) {
	if s == nil || s.runtime == nil {
		return View{}, fmt.Errorf("The plugin is not initialized when running")
	}
	parsed, err := protocol.ParsePluginPackage(data)
	if err != nil {
		return View{}, err
	}
	if IsReservedApplication(parsed.Manifest.Metadata.ID) {
		return View{}, fmt.Errorf("Plugin ID %q is reserved by the official application", parsed.Manifest.Metadata.ID)
	}
	if s.runtime.store == nil {
		return View{}, fmt.Errorf("Plugin state storage is not initialized")
	}
	s.runtime.beginMutation()
	defer s.runtime.endMutation()
	stage, err := s.runtime.stageInstallLocked(data, fileName)
	if err != nil {
		return View{}, err
	}
	now := time.Now()
	state := &model.PluginPlatformState{PluginID: stage.view.Manifest.ID, Available: stage.view.Status == StatusEnabled, UpdatedBy: actorID, CreatedAt: now, UpdatedAt: now}
	if err := s.runtime.commitAndPublish(&stage, persistExtras{platform: state}); err != nil {
		s.runtime.abortUncommitted(&stage)
		if errors.Is(err, errPublishInterrupted) {
			return View{}, err
		}
		return View{}, fmt.Errorf("Save plug-in platform status: %w", err)
	}
	s.runtime.commitInstall(stage)
	plugin := stage.view
	plugin.Management = ManagementFromView(plugin)
	return plugin, nil
}

func (s *Service) SetEnabled(id string, enabled bool) (View, error) {
	if s == nil || s.runtime == nil {
		return View{}, fmt.Errorf("The plugin is not initialized when running")
	}
	plugin, err := s.runtime.SetEnabled(id, enabled)
	if err != nil {
		return View{}, err
	}
	plugin.Management = ManagementFromView(plugin)
	return plugin, nil
}

func (s *Service) SetLoadError(id string, errText string) (View, error) {
	if s == nil || s.runtime == nil {
		return View{}, fmt.Errorf("The plugin is not initialized when running")
	}
	plugin, err := s.runtime.SetLoadError(id, errText)
	if err != nil {
		return View{}, err
	}
	plugin.Management = ManagementFromView(plugin)
	return plugin, nil
}

func (s *Service) Uninstall(id string) error {
	if s == nil || s.runtime == nil {
		return fmt.Errorf("The plugin is not initialized when running")
	}
	return s.runtime.Uninstall(id)
}

func (s *Service) UninstallUploaded(id string) error {
	if s == nil || s.runtime == nil {
		return fmt.Errorf("The plugin is not initialized when running")
	}
	if s.runtime.store == nil {
		return fmt.Errorf("Plugin state storage is not initialized")
	}
	return s.runtime.Uninstall(id)
}

func (s *Service) Package(id string) ([]byte, string, error) {
	if s == nil || s.runtime == nil {
		return nil, "", fmt.Errorf("The plugin is not initialized when running")
	}
	return s.runtime.Package(id)
}

func (s *Service) StatesForUser(actor *model.User) (map[string]StateView, error) {
	items := s.List()
	result := make(map[string]StateView, len(items)+len(officialApplicationPolicies))
	for _, pluginID := range KnownIDs(items) {
		state, err := s.stateForUser(actor, pluginID, items)
		if err != nil {
			return nil, err
		}
		result[pluginID] = state
	}
	return result, nil
}

func (s *Service) stateForUser(actor *model.User, pluginID string, items []View) (StateView, error) {
	runtimePlugin, hasRuntime := ByID(items, pluginID)
	source := "bundled"
	if hasRuntime {
		source = runtimePlugin.Source
	} else if !IsKnownApplication(pluginID) {
		return StateView{}, fmt.Errorf("Plug-in %q does not exist", pluginID)
	}
	policy := Management(pluginID, source)
	if hasRuntime {
		policy = ManagementFromView(runtimePlugin)
	}
	platformAvailable := policy.Kind == KindApplication
	store := s.durableStore()
	if hasRuntime && (policy.ActivationScope == ScopeSystem || store == nil) {
		platformAvailable = runtimePlugin.Status == StatusEnabled
	}
	if store != nil {
		platformState, err := store.PluginPlatformState(pluginID)
		if err != nil {
			return StateView{}, fmt.Errorf("Read plug-in platform status: %w", err)
		}
		if platformState != nil {
			platformAvailable = platformState.Available
		}
	}

	userEnabled := false
	userConfigured := false
	if policy.ActivationScope == ScopeUser && actor != nil {
		if store != nil {
			userState, err := store.UserPluginState(actor.ID, pluginID)
			if err != nil {
				return StateView{}, fmt.Errorf("Read user plug-in status: %w", err)
			}
			if userState != nil {
				userEnabled, userConfigured = userState.Enabled, true
			}
		}
		// Official applications follow the local installation state until each
		// user explicitly saves a personal choice.
		if !userConfigured {
			if pluginID == MediaConversion {
				userEnabled = true
			} else if hasRuntime && strings.TrimSpace(runtimePlugin.PackageDir) != "" {
				userEnabled = runtimePlugin.Status == StatusEnabled
			}
		}
	}
	effective := platformAvailable
	if policy.ActivationScope == ScopeUser {
		effective = platformAvailable && userEnabled
	}
	state := StateView{
		PluginID: pluginID, PlatformAvailable: platformAvailable,
		UserEnabled: userEnabled, UserConfigured: userConfigured,
		EffectiveEnabled: effective,
		CanToggle:        policy.ActivationScope == ScopeUser && platformAvailable,
		CanConfigure:     policy.ConfigurationScope == ConfigurationUser && platformAvailable,
	}
	if !platformAvailable {
		state.BlockedReason = "The administrator has disabled this plugin"
	} else if policy.ActivationScope == ScopeSystem {
		state.BlockedReason = "System plug-ins are managed uniformly by administrators"
	}
	return state, nil
}

func (s *Service) SetUserEnabled(actor *model.User, pluginID string, enabled bool) (StateView, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return StateView{}, Forbidden("Please log in first")
	}
	if s != nil && s.runtime != nil {
		s.runtime.beginMutation()
		defer s.runtime.endMutation()
	}
	items := s.List()
	current, err := s.stateForUser(actor, pluginID, items)
	if err != nil {
		return StateView{}, err
	}
	runtimePlugin, hasRuntime := ByID(items, pluginID)
	source := "bundled"
	if hasRuntime {
		source = runtimePlugin.Source
	}
	policy := Management(pluginID, source)
	if hasRuntime {
		policy = ManagementFromView(runtimePlugin)
	}
	if policy.ActivationScope != ScopeUser {
		return StateView{}, Forbidden("System plug-ins can only be managed by administrators")
	}
	if !current.PlatformAvailable {
		return StateView{}, Forbidden("The administrator has disabled this plugin")
	}
	store := s.durableStore()
	if store == nil {
		return StateView{}, fmt.Errorf("Plugin state storage is not initialized")
	}
	now := time.Now()
	state := &model.UserPluginState{ID: kernel.NewID(), UserID: actor.ID, PluginID: pluginID, Enabled: enabled, CreatedAt: now, UpdatedAt: now}
	if err := store.SaveUserPluginState(state); err != nil {
		return StateView{}, fmt.Errorf("Save user plug-in status: %w", err)
	}
	return s.stateForUser(actor, pluginID, items)
}

func (s *Service) AdminStates(actor *model.User) (map[string]AdminStateView, error) {
	states, err := s.StatesForUser(actor)
	if err != nil {
		return nil, err
	}
	store := s.durableStore()
	if store == nil {
		return nil, fmt.Errorf("Plugin state storage is not initialized")
	}
	counts, err := store.EnabledPluginUserCounts()
	if err != nil {
		return nil, fmt.Errorf("Statistics of the number of plug-in enabled users: %w", err)
	}
	result := make(map[string]AdminStateView, len(states))
	for pluginID, state := range states {
		result[pluginID] = AdminStateView{StateView: state, EnabledUserCount: counts[pluginID]}
	}
	return result, nil
}

func (s *Service) SetPlatformAvailability(actor *model.User, pluginID string, available bool) (AdminStateView, ManagementView, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return AdminStateView{}, ManagementView{}, Forbidden("Please log in first")
	}
	if s == nil {
		return AdminStateView{}, ManagementView{}, fmt.Errorf("The plugin is not initialized when running")
	}
	store := s.durableStore()
	if store == nil {
		return AdminStateView{}, ManagementView{}, fmt.Errorf("Plugin state storage is not initialized")
	}
	if s.runtime != nil {
		s.runtime.beginMutation()
		defer s.runtime.endMutation()
	}
	items := s.List()
	runtimePlugin, hasRuntime := ByID(items, pluginID)
	source := "bundled"
	if hasRuntime {
		source = runtimePlugin.Source
	} else if !IsKnownApplication(pluginID) {
		return AdminStateView{}, ManagementView{}, fmt.Errorf("Plug-in %q does not exist", pluginID)
	}
	policy := Management(pluginID, source)
	if hasRuntime {
		policy = ManagementFromView(runtimePlugin)
	}
	now := time.Now()
	platformState := &model.PluginPlatformState{PluginID: pluginID, Available: available, UpdatedBy: actor.ID, CreatedAt: now, UpdatedAt: now}
	if policy.ActivationScope == ScopeSystem {
		if !hasRuntime || s.runtime == nil {
			return AdminStateView{}, policy, fmt.Errorf("Plugin %q missing runtime", pluginID)
		}
		stage, err := s.runtime.stageSetEnabledLocked(pluginID, available)
		if err != nil {
			return AdminStateView{}, policy, err
		}
		if err := s.runtime.commitAndPublish(&stage, persistExtras{platform: platformState}); err != nil {
			s.runtime.abortUncommitted(&stage)
			if errors.Is(err, errPublishInterrupted) {
				return AdminStateView{}, policy, err
			}
			return AdminStateView{}, policy, fmt.Errorf("Save plug-in platform status: %w", err)
		}
	} else if s.runtime != nil && s.runtime.store != nil {
		records, err := s.runtime.currentRecords()
		if err != nil {
			return AdminStateView{}, policy, err
		}
		if err := s.runtime.persistRecords(records, persistExtras{platform: platformState}); err != nil {
			return AdminStateView{}, policy, fmt.Errorf("Save plug-in platform status: %w", err)
		}
	} else if err := store.SavePluginPlatformState(platformState); err != nil {
		return AdminStateView{}, policy, fmt.Errorf("Save plug-in platform status: %w", err)
	}
	states, err := s.AdminStates(actor)
	if err != nil {
		return AdminStateView{}, policy, err
	}
	return states[pluginID], policy, nil
}

func (s *Service) RequireForUser(userID string, pluginID string) error {
	state, err := s.stateForUser(&model.User{ID: strings.TrimSpace(userID)}, pluginID, s.List())
	if err != nil {
		return err
	}
	if !state.EffectiveEnabled {
		if state.BlockedReason != "" {
			return Forbidden(state.BlockedReason)
		}
		return Forbidden("Plugin not enabled")
	}
	return nil
}
