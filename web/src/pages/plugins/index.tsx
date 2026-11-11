import { CollectionHeader } from "@/components/layout/collection-header";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { App, Button, Modal, Select, Typography } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { Cable, PlugZap, RefreshCw, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/product/empty-state";
import { AppModal } from "@/components/ui/product/app-modal";
import { PluginMarkdown } from "./plugin-markdown";
import { PluginCard } from "./plugin-card";

import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { isOfficialApplicationPluginId } from "@/lib/plugins/official-applications";
import { deactivateClientPlugin, syncActiveClientPlugins } from "@/lib/plugins/plugin-client-loader";
import { PLUGIN_INSTALL_REQUEST_EVENT } from "@/lib/plugins/plugin-host-runtime";
import type { PluginInstallConfirmRequest, PluginManifest, PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { usePluginSlot } from "@/lib/plugins/slot-registry";
import { EaglePluginSettingsPanel } from "@/pages/plugins/eagle";
import {
    fetchPluginUpdates,
    installPluginPackage,
    uninstallPlugin,
    updatePluginPackage,
    type BackendPlugin,
    type PluginUpdateCheck,
} from "@/services/api/plugins";
import { setPluginActivation, syncPluginsFromBackend } from "@/services/plugin-sync";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useUserStore } from "@/stores/use-user-store";
import { isLocalRuntimeMode } from "@/lib/runtime-mode";
import { workspaceCapabilities } from "@/services/workspace-mode";

import { PLUGIN_PERMISSION_LABELS, PLUGIN_ORIGIN_LABELS, pluginOrigin } from "./plugin-documentation";
import { PluginDetailsModal } from "./plugin-documentation-modals";
import { isLocalFolderSource, PluginInstallConfirmModal, pluginUpdateRequest } from "./plugin-install-confirm-modal";
import { PluginFieldsConfigForm } from "./plugin-fields-config-form";
import { PluginUpdateButton } from "./plugin-update-button";
import "./plugins.css";

const categoryLabels: Record<string, string> = {
    provider: "model channel",
    "canvas-node": "canvas node",
    workflow: "Workflow",
};

const surfaceLabels: Record<string, string> = {
    node: "canvas node",
    fullscreen: "Full screen workbench",
    hybrid: "Hybrid access",
    "asset-source": "Material library",
};

const permissionLabels = PLUGIN_PERMISSION_LABELS;

// 随应用发布的接口（各家模型的请求格式）是内置能力，在模型服务里选择，不在插件列出。
// 用户上传的接口包是他们装的插件；被停用的内置接口也放这里，免得停用后再也找不回来。
const interfaceSectionMeta = [
    { key: "interface", label: "Interface plug-in", description: "Plug-ins that provide model interfaces", icon: Cable },
] as const;

export default function PluginsPage() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const localRuntime = isLocalRuntimeMode() || workspaceCapabilities().local;
    const visibleProtocolSectionMeta = interfaceSectionMeta;
    const installations = usePluginStore((state) => state.installations);
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const setEnabled = usePluginStore((state) => state.setEnabled);
    const removePlugin = usePluginStore((state) => state.removePlugin);
    const pluginStates = usePluginStore((state) => state.pluginStates);
    const updateConfig = usePluginStore((state) => state.updateConfig);
    const builtinPlugins = useMemo(() => listRegisteredPlugins(), []);
    const pluginCenterSections = usePluginSlot("pluginCenter.section");
    const appSettingsEntries = usePluginSlot("app.settings");
    const [backendPlugins, setBackendPlugins] = useState<BackendPlugin[]>([]);
    const [backendPluginsLoading, setBackendPluginsLoading] = useState(false);
    const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
    const [detailsPluginId, setDetailsPluginId] = useState<string | null>(null);
    const [detailsRestoreFocus, setDetailsRestoreFocus] = useState(false);
    const [installModalOpen, setInstallModalOpen] = useState(false);
    const [installPendingRequest, setInstallPendingRequest] = useState<PluginInstallConfirmRequest | null>(null);
    const [installing, setInstalling] = useState(false);
    const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(null);
    const [updateCheck, setUpdateCheck] = useState<PluginUpdateCheck>();
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
    const [originFilter, setOriginFilter] = useState<"all" | keyof typeof PLUGIN_ORIGIN_LABELS>("all");

    useEffect(() => {
        for (const plugin of builtinPlugins) ensurePlugin(plugin.manifest);
        syncActiveClientPlugins();
    }, [builtinPlugins, ensurePlugin]);

    useEffect(() => {
        const handleRequest = (event: Event) => {
            const custom = event as CustomEvent<PluginInstallConfirmRequest>;
            if (custom.detail) {
                setInstallPendingRequest(custom.detail);
                setInstallModalOpen(true);
            }
        };
        window.addEventListener(PLUGIN_INSTALL_REQUEST_EVENT, handleRequest);
        return () => window.removeEventListener(PLUGIN_INSTALL_REQUEST_EVENT, handleRequest);
    }, []);

    const reloadBackendPlugins = async () => {
        setBackendPluginsLoading(true);
        try {
            const result = await syncPluginsFromBackend();
            setBackendPlugins(result.plugins || []);
        } catch (error) {
            // 读取失败不清空列表：同时发出的另一次读取可能已经成功。
            if (!localRuntime) {
                message.error(error instanceof Error ? error.message : "Failed to read plugin");
            }
        } finally {
            setBackendPluginsLoading(false);
        }
        // 查新版本要问 npm，慢且可能失败；失败时按钮照旧显示「更新」。
        fetchPluginUpdates().then(setUpdateCheck, () => setUpdateCheck(undefined));
    };

    useEffect(() => {
        void reloadBackendPlugins();
    }, [localRuntime, user?.id]);

    const remotePlugins = useMemo(() => backendPlugins.map(toRegisteredPlugin), [backendPlugins]);
    const registeredPlugins = useMemo(() => {
        const byId = new Map(builtinPlugins.map((plugin) => [plugin.manifest.id, plugin]));
        for (const plugin of remotePlugins) byId.set(plugin.manifest.id, plugin);
        return [...byId.values()];
    }, [builtinPlugins, remotePlugins]);
    const backendPluginById = useMemo(() => new Map(backendPlugins.map((plugin) => [plugin.manifest.id, plugin])), [backendPlugins]);

    const filteredPlugins = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase();
        return registeredPlugins.filter((plugin) => {
            if (isBuiltInInterface(backendPluginById.get(plugin.manifest.id))) return false;
            const state = pluginStates[plugin.manifest.id];
            const isApplicationPlugin = backendPluginById.get(plugin.manifest.id)?.management.kind === "application" || isOfficialApplicationPluginId(plugin.manifest.id);
            if (user?.role !== "admin" && !features.systemPluginsVisibleToUsers && !isApplicationPlugin) return false;
            const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
            const enabled = state?.effectiveEnabled ?? Boolean(installation?.enabled);
            const manifest = plugin.manifest;
            const contributionKinds = contributionKindsFor(manifest);
            const searchableText = [manifest.name, manifest.description, manifest.author, manifest.id, ...contributionKinds.map((kind) => categoryLabels[kind] || kind)].filter(Boolean).join(" ").toLocaleLowerCase();
            if (normalizedSearch && !searchableText.includes(normalizedSearch)) return false;
            if (categoryFilter !== "all" && !pluginMatchesCategory(manifest, categoryFilter)) return false;
            if (originFilter !== "all" && pluginOrigin(plugin) !== originFilter) return false;
            if (statusFilter === "enabled" && !enabled) return false;
            if (statusFilter === "disabled" && enabled) return false;
            return true;
        });
    }, [backendPluginById, categoryFilter, features.systemPluginsVisibleToUsers, installations, localRuntime, pluginStates, registeredPlugins, search, statusFilter, originFilter, user?.role]);

    const pluginSections = useMemo(
        () =>
            [
                ...visibleProtocolSectionMeta.map((section) => ({ ...section, plugins: filteredPlugins.filter((plugin) => pluginMatchesCategory(plugin.manifest, section.key)) })),
                { key: "other", label: "Apply plugin", description: "Canvas, assets and workflow extensions", icon: PlugZap, plugins: filteredPlugins.filter((plugin) => pluginMatchesCategory(plugin.manifest, "other")) },
            ]
                .filter((section) => categoryFilter === "all" || section.key === categoryFilter)
                // 没装接口插件时不摆一个空分组。
                .filter((section) => section.key !== "interface" || section.plugins.length > 0 || categoryFilter === "interface"),
        [categoryFilter, filteredPlugins, visibleProtocolSectionMeta],
    );

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const selectCategory = (key: string) => {
        setCategoryFilter(key);
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    };

    const categoryCounts = useMemo(() => {
        const visiblePlugins = registeredPlugins.filter((plugin) => {
            if (isBuiltInInterface(backendPluginById.get(plugin.manifest.id))) return false;
            const isApplicationPlugin =
                backendPluginById.get(plugin.manifest.id)?.management.kind === "application" ||
                isOfficialApplicationPluginId(plugin.manifest.id);
            return user?.role === "admin" || features.systemPluginsVisibleToUsers || isApplicationPlugin;
        });
        const counts: Record<string, number> = { all: visiblePlugins.length, interface: 0, other: 0 };
        for (const plugin of visiblePlugins) {
            for (const section of visibleProtocolSectionMeta) {
                if (pluginMatchesCategory(plugin.manifest, section.key)) counts[section.key] += 1;
            }
            if (pluginMatchesCategory(plugin.manifest, "other")) counts.other += 1;
        }
        return counts;
    }, [backendPluginById, features.systemPluginsVisibleToUsers, localRuntime, registeredPlugins, user?.role, visibleProtocolSectionMeta]);

    const settingsPlugin = settingsPluginId ? registeredPlugins.find((plugin) => plugin.manifest.id === settingsPluginId) : undefined;
    const settingsInstallation = settingsPlugin ? installations.find((item) => item.manifest.id === settingsPlugin.manifest.id) : undefined;
    const detailsPlugin = detailsPluginId ? registeredPlugins.find((plugin) => plugin.manifest.id === detailsPluginId) : undefined;

    const hasCustomAppSettings = (plugin: RegisteredPlugin) =>
        appSettingsEntries.some((entry) => entry.pluginId === plugin.manifest.id);
    const hasPluginConfiguration = (plugin: RegisteredPlugin) =>
        Boolean(plugin.manifest.configuration?.fields?.length) ||
        hasCustomAppSettings(plugin);
    const canConfigurePlugin = (plugin: RegisteredPlugin) =>
        localRuntime || hasCustomAppSettings(plugin)
            ? hasPluginConfiguration(plugin)
            : Boolean(pluginStates[plugin.manifest.id]?.canConfigure) && hasPluginConfiguration(plugin);

    const isPluginEnabled = (plugin: RegisteredPlugin, installation = installations.find((item) => item.manifest.id === plugin.manifest.id)) => pluginStates[plugin.manifest.id]?.effectiveEnabled ?? Boolean(installation?.enabled);

    const togglePlugin = async (plugin: RegisteredPlugin, enabled: boolean) => {
        try {
            const remote = backendPluginById.get(plugin.manifest.id);
            if (localRuntime && !remote && !(plugin.manifest.id in pluginStates)) {
                setEnabled(plugin.manifest.id, enabled);
                message.success(`${plugin.manifest.name}${enabled ? "Enabled" : "Deactivated"}`);
                return;
            }
            await setPluginActivation(plugin.manifest.id, enabled, remote?.management.activationScope);
            message.success(`${plugin.manifest.name}${enabled ? "Enabled" : "Deactivated"}`);
        } catch (error) {
            if (localRuntime) {
                setEnabled(plugin.manifest.id, enabled);
                message.success(`${plugin.manifest.name}${enabled ? "Enabled" : "Deactivated"}`);
                return;
            }
            message.error(error instanceof Error ? error.message : "Failed to update plugin status");
        }
    };

    const handleInstallConfirm = async (request: PluginInstallConfirmRequest) => {
        setInstalling(true);
        try {
            const installed = await installPluginPackage({ source: request.source, registry: request.registry });
            deactivateClientPlugin(installed.manifest.id);
            setInstallModalOpen(false);
            setInstallPendingRequest(null);
            message.success(`Plug-in installed"${installed.manifest.name}」`);
            await reloadBackendPlugins();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to install plugin");
        } finally {
            setInstalling(false);
        }
    };

    const updateInstalledPlugin = async (pluginId: string) => {
        setUpdatingPluginId(pluginId);
        try {
            const updated = await updatePluginPackage(pluginId);
            deactivateClientPlugin(updated.manifest.id);
            message.success(
                isLocalFolderSource(updated.packageSpec)
                    ? `Plugin reloaded from folder "${updated.manifest.name}」`
                    : `Plug-in "${updated.manifest.name}"Updated to v${updated.manifest.version}`,
            );
            await reloadBackendPlugins();
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Update plugin failed");
            return false;
        } finally {
            setUpdatingPluginId(null);
        }
    };

    // 文件夹里是用户自己的代码，「重新加载」不用确认；其他来源换的是别人发布的新代码。
    const handleUpdatePlugin = (plugin: BackendPlugin) => {
        if (isLocalFolderSource(plugin.packageSpec)) {
            void updateInstalledPlugin(plugin.manifest.id);
            return;
        }
        setInstallPendingRequest(pluginUpdateRequest(plugin, updateCheck));
        setInstallModalOpen(true);
    };

    const handleUpdateConfirm = async (request: PluginInstallConfirmRequest) => {
        const target = backendPlugins.find((plugin) => plugin.packageSpec === request.source);
        if (!target) {
            message.error("This plug-in is no longer available, please refresh and try again.");
            return;
        }
        setInstalling(true);
        const updated = await updateInstalledPlugin(target.manifest.id);
        setInstalling(false);
        if (updated) {
            setInstallModalOpen(false);
            setInstallPendingRequest(null);
        }
    };

    const handleUninstallPlugin = async (plugin: RegisteredPlugin) => {
        try {
            if (!localRuntime || backendPluginById.has(plugin.manifest.id)) {
                await uninstallPlugin(plugin.manifest.id);
            }
            deactivateClientPlugin(plugin.manifest.id);
            removePlugin(plugin.manifest.id);
            message.success(`Plug-in has been uninstalled"${plugin.manifest.name}」`);
            await reloadBackendPlugins();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to uninstall plugin");
        }
    };

    const activeCustomSection = categoryFilter.startsWith("slot:")
        ? pluginCenterSections.find((entry) => `slot:${entry.pluginId}:${entry.payload.id}` === categoryFilter)
        : undefined;
    const matchedSettingsSlot = settingsPlugin
        ? appSettingsEntries.find((entry) => entry.pluginId === settingsPlugin.manifest.id)
        : undefined;

    return (
        <WorkspacePage className="collection-page plugins-page" scroll={false}>
            <div ref={scrollContainerRef} className="app-workspace-scroll h-full min-h-0 overflow-y-auto">
                <div className="plugins-page-layout">
                    <CollectionHeader title="plug-in" navigationLabel="Plug-in classification" value={categoryFilter} onChange={selectCategory}
                        tabs={[
                            { value: "all", label: "All", count: categoryCounts.all },
                            ...visibleProtocolSectionMeta.filter(section => (categoryCounts[section.key] || 0) > 0 || categoryFilter === section.key).map(section => ({ value: section.key, label: section.label, count: categoryCounts[section.key] || 0 })),
                            { value: "other", label: "Apply plugin", count: categoryCounts.other },
                            ...pluginCenterSections.map(entry => ({ value: `slot:${entry.pluginId}:${entry.payload.id}`, label: entry.payload.label })),
                        ]}
                        search={activeCustomSection ? undefined : { value: search, onChange: setSearch, placeholder: "Search plugin name, description or author" }}
                        actions={<button type="button" className="assets-header-compact-button" aria-label="refresh plugin" title="refresh plugin" disabled={backendPluginsLoading} onClick={() => void reloadBackendPlugins()}><RefreshCw className={backendPluginsLoading ? "size-4 animate-spin" : "size-4"} /></button>}
                        primaryAction={<button type="button" className="collection-header-create" onClick={() => { setInstallPendingRequest(null); setInstallModalOpen(true); }}>Installation</button>}
                        trailing={activeCustomSection ? null : <div className="plugins-header-filters">
                            <Select value={statusFilter} options={[{ value: "all", label: "All status" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Deactivated" }]} onChange={setStatusFilter} aria-label="Filter by status" />
                            <Select value={originFilter} options={[{ value: "all", label: "All sources" }, ...Object.entries(PLUGIN_ORIGIN_LABELS).map(([value, label]) => ({ value, label }))]} onChange={setOriginFilter} aria-label="Filter by source" />
                        </div>}
                    />
                    <div className="plugins-page-content">
                        {activeCustomSection ? (
                            <section className="plugin-section">
                                <activeCustomSection.payload.component
                                    pluginId={activeCustomSection.pluginId}
                                    DetailsModal={AppModal}
                                    Markdown={PluginMarkdown}
                                    RegistrySelect={Select}
                                    Card={PluginCard}
                                    Button={Button}
                                    installedPlugins={registeredPlugins}
                                    pluginStates={pluginStates}
                                    reloadPlugins={reloadBackendPlugins}
                                    requestInstallPlugin={(req) => {
                                        setInstallPendingRequest(req);
                                        setInstallModalOpen(true);
                                    }}
                                />
                            </section>
                        ) : filteredPlugins.length ? (
                            <div className="plugins-sections">
                                {pluginSections.map((section) => {
                                    return (
                                        <section
                                            key={section.key}
                                            id={`plugin-section-${section.key}`}
                                            className="plugin-section"
                                            data-category={section.key === "image" ? "creative" : section.key === "video" ? "drama" : section.key === "audio" ? "social" : undefined}
                                        >
                                            <header className="plugin-section-heading">
                                                <div>
                                                    <h2>{section.label}</h2>
                                                </div>
                                                <span className="plugin-section-count">{section.plugins.length}</span>
                                            </header>
                                            {section.plugins.length ? (
                                                <div className="plugins-grid">
                                                    {section.plugins.map((plugin) => {
                                                        const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
                                                        const remote = backendPluginById.get(plugin.manifest.id);
                                                        const enabled = isPluginEnabled(plugin, installation);
                                                        const state = pluginStates[plugin.manifest.id];
                                                        const sourceLabel = PLUGIN_ORIGIN_LABELS[pluginOrigin(plugin)];
                                                        const canConfigure = canConfigurePlugin(plugin);
                                                        const canToggle = localRuntime || user?.role === "admin" ? true : Boolean(state?.canToggle);
                                                        const canUninstall = Boolean(remote && remote.source !== "bundled" && remote.source !== "system" && remote.source !== "official");
                                                        return (
                                                            <PluginCard
                                                                key={plugin.manifest.id}
                                                                name={plugin.manifest.name}
                                                                description={plugin.manifest.description}
                                                                sourceLabel={sourceLabel}
                                                                status={!state?.platformAvailable && state?.blockedReason ? state.blockedReason : enabled ? "Enabled" : "Deactivated"}
                                                                openLabel={`View${plugin.manifest.name}Documentation`}
                                                                onOpen={(event) => {
                                                                        const openedByKeyboard = event.detail === 0;
                                                                        setDetailsRestoreFocus(openedByKeyboard);
                                                                        setDetailsPluginId(plugin.manifest.id);
                                                                        if (!openedByKeyboard) event.currentTarget.blur();
                                                                }}
                                                                actions={<>
                                                                    <Switch
                                                                        disabled={!canToggle}
                                                                        checked={enabled}
                                                                        aria-label={`${plugin.manifest.name}, currently${enabled ? "Enabled, click to deactivate" : "Disabled, click to enable"}`}
                                                                        title={!canToggle ? state?.blockedReason : undefined}
                                                                        onChange={(checked) => void togglePlugin(plugin, checked)}
                                                                    />
                                                                    {remote?.source === "package" && remote.packageSpec ? (
                                                                        <PluginUpdateButton
                                                                            pluginId={plugin.manifest.id}
                                                                            packageSpec={remote.packageSpec}
                                                                            check={updateCheck}
                                                                            loading={updatingPluginId === plugin.manifest.id}
                                                                            onUpdate={() => handleUpdatePlugin(remote)}
                                                                        />
                                                                    ) : null}
                                                                    {canConfigure ? (
                                                                        <Button
                                                                            className="plugin-settings-button"
                                                                            icon={<Settings2 className="size-4" />}
                                                                            aria-expanded={settingsPluginId === plugin.manifest.id}
                                                                            aria-haspopup="dialog"
                                                                            onClick={() => setSettingsPluginId(plugin.manifest.id)}
                                                                        >
                                                                                                                                                        settings
                                                                        </Button>
                                                                    ) : null}
                                                                    {canUninstall ? (
                                                                        <Button
                                                                            className="plugin-settings-button"
                                                                            danger
                                                                            icon={<Trash2 className="size-4" />}
                                                                            onClick={() => void handleUninstallPlugin(plugin)}
                                                                        >
                                                                                                                                                        Uninstall
                                                                        </Button>
                                                                    ) : null}
                                                                </>}
                                                            >

                                                                {installation?.lastError || remote?.error ? (
                                                                    <Typography.Text type="danger" className="plugin-error" role="alert">
                                                                        {installation?.lastError || remote?.error}
                                                                    </Typography.Text>
                                                                ) : null}
                                                            </PluginCard>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="plugin-section-empty-hint">
                                                    <span>There is currently no plug-in of this type</span>
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyState
                                className="min-h-[260px] rounded-[var(--plugins-card-radius)] bg-foreground/[0.03]"
                                icon={SlidersHorizontal}
                                title="No matching plugin"
                                description="Try clearing the search terms, or broadening the filter criteria."
                                action={
                                    <Button
                                        onClick={() => {
                                            setSearch("");
                                            setCategoryFilter("all");
                                            setStatusFilter("all");
                                            setOriginFilter("all");
                                        }}
                                    >
                                                                                Clear filters
                                    </Button>
                                }
                            />
                        )}

                        <Modal
                            className="workspace-modal workspace-modal-wide plugin-settings-modal"
                            title={settingsPlugin ? `${settingsPlugin.manifest.name} settings` : null}
                            open={Boolean(settingsPlugin)}
                            centered
                            footer={null}
                            destroyOnHidden
                            onCancel={() => setSettingsPluginId(null)}
                            styles={{ body: { maxHeight: "min(72vh, 760px)", overflowY: "auto", overscrollBehavior: "contain" } }}
                        >
                            {settingsPlugin ? (
                                <div className="plugin-settings-panel plugin-settings-modal-panel">
                                    <div className="plugin-settings-heading">
                                        <div>
                                            <p>Only the configuration items actually supported by this plug-in are displayed.</p>
                                        </div>
                                        <span className="plugin-source-label">{PLUGIN_ORIGIN_LABELS[pluginOrigin(settingsPlugin)]}</span>
                                    </div>

                                    {matchedSettingsSlot ? (
                                        (() => {
                                            const SettingsComp = matchedSettingsSlot.payload.component as React.ComponentType<Record<string, unknown>>;
                                            const handleSave = async (patch: Record<string, string | number | boolean>) => {
                                                updateConfig(settingsPlugin.manifest.id, patch);
                                            };
                                            return (
                                                <SettingsComp
                                                    pluginId={settingsPlugin.manifest.id}
                                                    config={settingsInstallation?.config || {}}
                                                    updateConfig={handleSave}
                                                    onChange={handleSave}
                                                />
                                            );
                                        })()
                                    ) : settingsPlugin.manifest.id === EAGLE_PLUGIN_ID ? (
                                        <EaglePluginSettingsPanel
                                            pluginId={EAGLE_PLUGIN_ID}
                                            config={settingsInstallation?.config || {}}
                                            updateConfig={async (patch) => {
                                                updateConfig(EAGLE_PLUGIN_ID, patch);
                                            }}
                                        />
                                    ) : settingsPlugin.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID ? (
                                        <div className="rounded-[var(--r-md)] border border-border/60 bg-muted/25 px-3 py-3 text-[var(--fs-body)] leading-6 text-foreground/70">
                                            <p>Use the "Optimize" button in the prompt word editor of the creation page or picture or video node to let the current text model organize the prompt words.</p>
                                            <p className="mt-2 text-[var(--fs-micro)] text-foreground/50">The plug-in will not automatically overwrite the original prompt word and will backfill it into the current input box only after clicking "Adopt".</p>
                                        </div>
                                    ) : settingsPlugin.manifest.configuration?.fields?.length ? (
                                        <PluginFieldsConfigForm
                                            fields={settingsPlugin.manifest.configuration.fields}
                                            initialValues={settingsInstallation?.config || {}}
                                            onSave={(values) => {
                                                updateConfig(settingsPlugin.manifest.id, values as Record<string, string | number | boolean>);
                                                message.success(`${settingsPlugin.manifest.name}Configuration saved`);
                                            }}
                                        />
                                    ) : (
                                        <div className="plugin-settings-empty">
                                            {`Contribution ability:${
                                                contributionKindsFor(settingsPlugin.manifest)
                                                    .map((kind) => categoryLabels[kind] || kind)
                                                    .join("、") || "Not declared"
                                            }. The current access location and permissions will automatically take effect based on the plug-in list.`}
                                        </div>
                                    )}

                                    <div className="plugin-permissions">
                                        <div>
                                            <span>access location</span>
                                            {(settingsPlugin.manifest.surfaces || []).map((surface) => surfaceLabels[surface] ?? surface).join("、") || "Determined by contribution points"}
                                        </div>
                                        <div>
                                            <span>Plug-in capabilities</span>
                                            {settingsPlugin.manifest.permissions.map((permission) => permissionLabels[permission] ?? permission).join("、")}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </Modal>
                        <PluginDetailsModal plugin={detailsPlugin} management={detailsPluginId ? backendPluginById.get(detailsPluginId)?.management : undefined} restoreFocus={detailsRestoreFocus} onClose={() => setDetailsPluginId(null)} />
                        <PluginInstallConfirmModal
                            open={installModalOpen}
                            initialRequest={installPendingRequest}
                            loading={installing}
                            onCancel={() => {
                                setInstallModalOpen(false);
                                setInstallPendingRequest(null);
                            }}
                            onConfirm={(req) => void (req.isUpdate ? handleUpdateConfirm(req) : handleInstallConfirm(req))}
                        />
                    </div>
                </div>
            </div>
        </WorkspacePage>
    );
}

function toRegisteredPlugin(plugin: BackendPlugin): RegisteredPlugin {
    return { manifest: plugin.manifest, source: plugin.source };
}

function contributionKindsFor(manifest: PluginManifest | PluginManifestV2): string[] {
    const contributions = manifest.contributes;
    const kinds: string[] = [];
    if (contributions.providers?.length) kinds.push("provider");
    if (contributions.workflows?.length) kinds.push("workflow");
    if (contributions.canvasNodes?.length) kinds.push("canvas-node");
    return kinds;
}

function providerCapabilitiesFor(manifest: PluginManifest | PluginManifestV2) {
    return [...new Set((manifest.contributes.providers || []).flatMap((provider) => provider.capabilities))];
}

function isBuiltInInterface(plugin?: BackendPlugin) {
    return Boolean(plugin?.management.builtInInterface) && plugin?.status === "enabled";
}

function pluginMatchesCategory(manifest: PluginManifest | PluginManifestV2, category: string) {
    const providerCapabilities = providerCapabilitiesFor(manifest);
    if (category === "other") return providerCapabilities.length === 0;
    if (category === "interface") return providerCapabilities.length > 0;
    return providerCapabilities.includes(category as "text" | "image" | "video" | "audio");
}
