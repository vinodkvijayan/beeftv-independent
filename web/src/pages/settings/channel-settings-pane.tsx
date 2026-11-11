import { Alert, App, Button, Form, Input, Popconfirm, Segmented, Select } from "antd";
import { Bug, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ModelEditorModal } from "@/components/model-editor-modal";
import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { PageHeader } from "@/components/layout/workspace-page";
import { applyFetchedChannelModelCatalog } from "@/lib/channel-model-catalog";
import { ensureModelProfilesWithUiDefaults } from "@/lib/model-protocols";
import { fetchChannelModels } from "@/services/api/image";
import { channelHasGenerationCredential, channelHasManagedBeefTVCredential, createModelChannel, defaultBaseUrlForApiFormat, isBuiltinBeefTVChannel, normalizeConfigSnapshot, useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import { ChannelModelSettings } from "./channel-model-settings";
import { ModelServiceEditor } from "./model-service-editor";
import { ChannelRequestAddressLines } from "./channel-request-addresses";
import { currentModelConnectionReceipt, useModelConnectionTests } from "@/stores/use-model-connection-tests";
import { ModelLogo } from "@/components/model-logo";
import beefTVAppIcon from "../../../../assets/app-icon.png";
import { MODEL_SERVICE_PRESETS, isTopazUpscaleChannel, channelAllowsEmptyAPIKey, mergeSavedServiceChannel, pluginServices, servicePresetFor } from "@/lib/model-service-presets";
import { workspaceCapabilities } from "@/services/workspace-mode";
import { localWorkspaceConfig } from "@/lib/user-session";
import { getLocalModelConfig } from "@/services/api/workspace";
import { commitModelConfig, flushModelConfig, getModelConfigPersistenceState, subscribeModelConfigPersistence, type ModelConfigPersistenceState } from "@/services/model-config-repository";
import { createChannelCatalogRequests } from "@/services/channel-catalog-requests";
import { getTransportFailureKind } from "@/services/api/request";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { beefTVConnectionLabel, type BeefTVConnectionSummary } from "@/services/api/beeftv-connection";
import { useBeefTVConnection } from "@/components/layout/beeftv-connection-provider";
import { BeefTVConnectionActions } from "@/components/beeftv-connection-actions";
export { BeefTVConnectionActions } from "@/components/beeftv-connection-actions";
import { mergeManagedBeefTVCatalog, withChannels } from "@/lib/managed-beeftv-catalog";
export { mergeManagedBeefTVCatalog, shouldRefreshBeefTVCatalog, withChannels } from "@/lib/managed-beeftv-catalog";
import { recordChannelDelete, recordChannelDeleteConfirmOpen } from "./model-settings-diagnostics";

type UserChannelConnection = "openai" | "gemini";
type ChannelSettingsPaneProps = {
    onOpenDiagnostics?: () => void;
    onOpenModels?: () => void;
};

export function ChannelSettingsPane({ onOpenDiagnostics, onOpenModels }: ChannelSettingsPaneProps) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const localMode = workspaceCapabilities().local;
    const persistence = useSyncExternalStore(subscribeModelConfigPersistence, getModelConfigPersistenceState, getModelConfigPersistenceState);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
    const [newChannelId, setNewChannelId] = useState<string | null>(null);
    const [serviceEditor, setServiceEditor] = useState<ModelChannel | null | undefined>(undefined);
    const [pluginServiceIds, setPluginServiceIds] = useState<ReadonlySet<string>>(() => new Set());
    const { connection: beefConnection, busy: beefBusy, catalogSyncFailed, connect, cancel, disconnect, retryCatalog, openAccount } = useBeefTVConnection();
    const requests = useRef(createChannelCatalogRequests());
    const deleting = useRef(new Set<string>());
    const [deleteFailures, setDeleteFailures] = useState<Record<string, string>>({});
    useEffect(() => () => requests.current.cancelAll(), []);
    const cancelCatalog = (id: string) => {
        requests.current.cancel(id);
        setLoadingChannelIds((items) => items.filter((item) => item !== id));
    };

    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    useEffect(() => {
        let cancelled = false;
        void fetchPluginProviderCatalog("user.custom-channel")
            .then((items) => { if (!cancelled) setPluginServiceIds(new Set(pluginServices(items).map((item) => item.value))); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        cancelCatalog(id);
        updateChannels(
            config.channels.map((channel) => {
                if (channel.id !== id) return channel;
                const models = patch.models ? uniqueModels(patch.models) : channel.models;
                const modelProfiles = patch.modelProfiles !== undefined
                    ? patch.modelProfiles
                    : patch.models && channel.scope !== "system"
                        ? ensureModelProfilesWithUiDefaults(models, channel.modelProfiles, [], channel.apiFormat)
                        : patch.models
                            ? channel.modelProfiles?.filter((item) => models.includes(item.model))
                            : channel.modelProfiles;
                return {
                    ...channel,
                    ...patch,
                    models,
                    modelProfiles,
                };
            }),
        );
    };

    const updateChannelConnection = (channel: ModelChannel, connection: UserChannelConnection) => {
        const apiFormat = connection;
        const defaultBaseUrl = defaultBaseUrlForApiFormat(apiFormat);
        const baseUrl = isKnownDefaultBaseUrl(channel.baseUrl) ? defaultBaseUrl : channel.baseUrl;
        // 渠道只负责连接类型；具体模型能力和请求协议由下方共享能力卡片维护。
        updateChannel(channel.id, { apiFormat, interfaceType: undefined, baseUrl });
    };

    const addChannel = () => {
        setServiceEditor(null);
    };

    const saveService = async (channel: ModelChannel) => {
        cancelCatalog(channel.id);
        const latest = useConfigStore.getState().config;
        const { channels, baseConfig } = mergeSavedServiceChannel(latest, channel);
        updateChannels(channels, baseConfig);
        await flushModelConfig();
        const saved = getModelConfigPersistenceState();
        if (saved.status === "error" || saved.dirty) throw new Error(saved.error || "The model service has not been saved, please try again");
        message.success("The model service has been saved. You can select the model on the creation page.");
    };

    const closeChannelEditor = () => {
        setEditingChannelId(null);
        setNewChannelId(null);
    };

    const deleteChannel = async (id: string) => {
        if (deleting.current.has(id)) return;
        const latest = useConfigStore.getState().config;
        const channel = latest.channels.find((item) => item.id === id);
        if (channel && (channel.scope === "system" || isBuiltinBeefTVChannel(channel))) {
            message.warning("System channels are maintained by administrators");
            return;
        }
        deleting.current.add(id);
        cancelCatalog(id);
        const next = withChannels(latest, latest.channels.filter((item) => item.id !== id));
        replaceConfig(next);
        try {
            await commitModelConfig(next);
            await flushModelConfig();
            const saved = getModelConfigPersistenceState();
            if (saved.status === "error" || saved.dirty) throw new Error(saved.error || "Delete not saved");
            setDeleteFailures((items) => { const next = { ...items }; delete next[id]; return next; });
            recordChannelDelete({ scope: channel?.scope, before: latest.channels.length, after: next.channels.length });
            message.success("Channel deleted and saved");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "Save failed";
            setDeleteFailures((items) => ({ ...items, [id]: `${channel?.name || "channel"}Delete not yet saved:${detail}. Please try again, reloading may restore the original channel.` }));
        } finally {
            deleting.current.delete(id);
        }
    };

    const setChannelLoading = (id: string, loading: boolean) => {
        setLoadingChannelIds((items) => (loading ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id)));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (isTopazUpscaleChannel(channel)) return;
        const connectionError = channelConnectionError(channel, isBuiltinBeefTVChannel(channel) ? beefConnection : null);
        if (connectionError) {
            message.error(`${channel.name || "current channel"}：${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        const request = requests.current.start(channel.id);
        try {
            const result = await fetchChannelModels(channel, true, request.signal);
            if (!requests.current.current(channel.id, request)) return;
            if (!result.models.length) {
                message.warning(`${channel.name || "current channel"}No model returned, existing handmade model retained`);
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(`${latestChannel.name || "current channel"}The connection configuration has changed and old pull results have been ignored`);
                return;
            }
            if (localMode && isBuiltinBeefTVChannel(latestChannel)) {
                const server = await getLocalModelConfig();
                if (!requests.current.current(channel.id, request)) return;
                const current = useConfigStore.getState().config;
                replaceConfig(localWorkspaceConfig(normalizeConfigSnapshot({
                    config: mergeManagedBeefTVCatalog(current, server.config),
                }).config));
            } else {
                updateChannels(
                    latestConfig.channels.map((item) => (item.id === channel.id ? applyFetchedChannelModelCatalog(item, result) : item)),
                    latestConfig,
                );
            }
            await flushModelConfig();
            message.success(`${latestChannel.name || "current channel"}Model list updated`);
        } catch (error) {
            if (requests.current.current(channel.id, request)) message.error(channelModelFetchErrorMessage(error));
        } finally {
            if (requests.current.current(channel.id, request)) setChannelLoading(channel.id, false);
            requests.current.finish(channel.id, request);
        }
    };

    const refreshAllModels = async () => {
        const catalogChannels = userChannels.filter(channel => !isTopazUpscaleChannel(channel));
        const runnable = catalogChannels.filter((channel) => !channelConnectionError(channel, isBuiltinBeefTVChannel(channel) ? beefConnection : null));
        const skipped = catalogChannels.filter((channel) => channelConnectionError(channel, isBuiltinBeefTVChannel(channel) ? beefConnection : null));
        if (!runnable.length) {
            const detail = skipped.map((channel) => `${channel.name || "unnamed channel"}：${channelConnectionError(channel, isBuiltinBeefTVChannel(channel) ? beefConnection : null)}`).join("；");
            message.error(detail || "There is no personal model channel to pull, please fill in the valid Base URL and API Key first");
            return;
        }
        setChannelLoading("all", true);
        const batch = new Map<string, AbortController>();
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    const request = requests.current.start(channel.id);
                    batch.set(channel.id, request);
                    try {
                        const result = await fetchChannelModels(channel, true, request.signal);
                        if (!requests.current.current(channel.id, request)) return { channel, result: { models: [], catalog: [] }, error: "", cancelled: true };
                        return { channel, result, error: "" };
                    } catch (error) {
                        if (!requests.current.current(channel.id, request)) return { channel, result: { models: [], catalog: [] }, error: "", cancelled: true };
                        return { channel, result: { models: [], catalog: [] }, error: channelModelFetchErrorMessage(error) };
                    }
                }),
            );
            const latestConfig = useConfigStore.getState().config;
            const successful = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && latestChannel && requests.current.current(item.channel.id, batch.get(item.channel.id)!) && channelConnectionSignature(latestChannel) === channelConnectionSignature(item.channel));
            });
            const stale = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && (!latestChannel || channelConnectionSignature(latestChannel) !== channelConnectionSignature(item.channel)));
            });
            const failed = results.filter((item) => !item.cancelled && !item.result.models.length);
            if (successful.length) {
                const resultMap = new Map(successful.map((item) => [item.channel.id, item.result] as const));
                const refreshedManagedBeefTV = localMode && successful.some((item) => isBuiltinBeefTVChannel(item.channel));
                const server = refreshedManagedBeefTV ? await getLocalModelConfig() : null;
                const current = useConfigStore.getState().config;
                const nextChannels = current.channels.map((channel) => {
                    if (refreshedManagedBeefTV && isBuiltinBeefTVChannel(channel)) return channel;
                    const fetched = resultMap.get(channel.id);
                    return fetched ? applyFetchedChannelModelCatalog(channel, fetched) : channel;
                });
                const updated = withChannels(current, nextChannels);
                replaceConfig(server ? localWorkspaceConfig(normalizeConfigSnapshot({
                    config: mergeManagedBeefTVCatalog(updated, server.config),
                }).config) : updated);
                await flushModelConfig();
                message.success(`updated${successful.length} channel model`);
            }
            const warnings = [
                ...failed.map((item) => `${item.channel.name || "unnamed channel"}：${item.error || "No model returned"}`),
                ...stale.map((item) => `${item.channel.name || "unnamed channel"}: The connection configuration has changed and old results have been ignored`),
                ...skipped.map((channel) => `${channel.name || "unnamed channel"}：${channelConnectionError(channel, isBuiltinBeefTVChannel(channel) ? beefConnection : null)}`),
            ];
            if (warnings.length) message.warning(`${warnings.join("；")}. Channels that have not been updated have retained the original model list`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Batch reading of models failed, the original model list has not been changed");
        } finally {
            for (const [id, request] of batch) requests.current.finish(id, request);
            setChannelLoading("all", false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            {Object.entries(deleteFailures).map(([id, detail]) => <Alert key={id} type="error" showIcon title={detail} action={<Button onClick={() => void deleteChannel(id)}>Retry deletion</Button>} />)}
            <PageHeader
                title={localMode ? "local model channel" : "personal channel"}
                actions={(
                    <div className="settings-pane-header-actions flex w-full gap-2 sm:w-auto sm:shrink-0">
                    {onOpenDiagnostics ? <Button className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<Bug className="size-4" />} onClick={onOpenDiagnostics}>Problem diagnosis</Button> : null}
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<RefreshCw className="size-4" />} loading={loadingChannelIds.includes("all")} disabled={loadingChannelIds.some((id) => id !== "all") || !userChannels.some(channel => !isTopazUpscaleChannel(channel))} onClick={() => void refreshAllModels()}>
                                                Pull all channel models
                    </Button>
                    <Button type="primary" className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<Plus className="size-4" />} onClick={addChannel}>
                                                Add model service
                    </Button>
                    </div>
                )}
            />
            {userChannels.length ? (
                <div className="settings-channel-list space-y-2">
                    {userChannels.map((channel) => {
                        const editing = editingChannelId === channel.id;
                        const builtinBeefTV = isBuiltinBeefTVChannel(channel);
                        const topazUpscale = isTopazUpscaleChannel(channel);
                        const pluginChannel = Boolean(channel.interfaceType && pluginServiceIds.has(channel.interfaceType));
                        return (
                            <section key={channel.id} data-onboarding={builtinBeefTV ? "official-channel" : undefined} aria-labelledby={`channel-${channel.id}-title`} className="settings-channel p-2.5 sm:p-3">
                                <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2.5">
                                    <div className="min-w-0 flex-1 basis-52">
                                        <h3 id={`channel-${channel.id}-title`} className="flex items-center gap-2 text-sm font-semibold">
                                            {builtinBeefTV ? <img src={beefTVAppIcon} alt="" className="size-5 shrink-0 object-contain" draggable={false} /> : <ModelLogo icon={MODEL_SERVICE_PRESETS.find((preset) => preset.id === servicePresetFor(channel))?.icon} size={20} />}
                                            {builtinBeefTV ? "BeefTV" : channel.name || "unnamed channel"}
                                        </h3>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
                                            {builtinBeefTV ? (
                                                <>
                                                    <span>saved{channel.models.length}  models</span>
                                                    <span>BeefTV official computing power channel, one-click connection, ready to use out of the box</span>
                                                </>
                                            ) : (
                                                <span>{pluginChannel ? "Plug-in provided" : channelProtocolLabel(channel)}  · Saved{channel.models.length}  models</span>
                                            )}
                                            <ChannelStatus channel={channel} persistence={persistence} connection={builtinBeefTV ? beefConnection : null} />
                                        </div>
                                        {topazUpscale ? <p className="mt-1 text-xs text-foreground/55">Use "AI Super Score" above the image or video node</p> : null}
                                        {!builtinBeefTV && !topazUpscale && !pluginChannel && <ChannelRequestAddressLines channel={channel} />}
                                    </div>
                                    <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:shrink-0">
                                        {builtinBeefTV && catalogSyncFailed ? <Button loading={beefBusy} onClick={() => void retryCatalog()}>Retry updating model list</Button> : null}
                                        {builtinBeefTV ? (
                                            <BeefTVConnectionActions
                                                connection={beefConnection}
                                                busy={beefBusy}
                                                onConnect={() => void connect()}
                                                onCancel={() => void cancel()}
                                                onRetry={() => void connect()}
                                                onDisconnect={() => void disconnect()}
                                                onWallet={() => void openAccount()}
                                            />
                                        ) : null}
                                        {!topazUpscale ? (
                                        <Button
                                            className="h-10 sm:h-8"
                                            size="small"
                                            icon={<RefreshCw className="size-3.5" />}
                                            loading={loadingChannelIds.includes(channel.id)}
                                            disabled={loadingChannelIds.includes("all") || (builtinBeefTV && beefConnection?.state !== "connected")}
                                            onClick={() => void refreshChannelModels(channel)}
                                        >
                                                                                        Pull model
                                        </Button>
                                        ) : null}
                                        <Button
                                            size="small"
                                            icon={<Pencil className="size-3.5" />}
                                            onClick={() => {
                                                cancelCatalog(channel.id);
                                                if (!builtinBeefTV) { setServiceEditor(channel); return; }
                                                setNewChannelId(null);
                                                setEditingChannelId(channel.id);
                                            }}
                                        >
                                                                                        Edit
                                        </Button>
                                        {!builtinBeefTV ? (
                                            <Popconfirm classNames={{ root: "model-channel-delete-confirm" }} title="Delete personal model channel?" description="The model selections associated with the channel are also removed." okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }} onOpenChange={recordChannelDeleteConfirmOpen} onConfirm={() => deleteChannel(channel.id)}>
                                                    <Button
                                                        title="Delete channel"
                                                        className="size-10 p-0 sm:size-8"
                                                        aria-label={`Delete channel${channel.name || "unnamed channel"}`}
                                                        size="small"
                                                        type="text"
                                                        danger
                                                        icon={<Trash2 className="size-3.5" />}
                                                    />
                                            </Popconfirm>
                                        ) : null}
                                    </div>
                                </div>
                                {editing && (
                                    <ModelEditorModal
                                        open
                                        title={channel.id === newChannelId ? "Add custom channels" : "Edit custom channels"}
                                        subtitle={channel.name}
                                        onClose={closeChannelEditor}
                                        footer={
                                            <div className="model-editor-footer">
                                                <span className="text-xs text-foreground/50">{localMode ? "Changes are saved to the local workspace in real time" : "Changes are saved to the cloud channel configuration in real time"}</span>
                                                <div className="model-editor-footer-actions">
                                                    <Button loading={loadingChannelIds.includes(channel.id)} onClick={() => void refreshChannelModels(channel)}>
                                                        Pull model
                                                    </Button>
                                                    <Button onClick={closeChannelEditor}>Done</Button>
                                                </div>
                                            </div>
                                        }
                                    >
                                        <div className="model-editor-panel">
                                            <section className="model-editor-section">
                                                <div>
                                                    <h2>connection information</h2>
                                                    <p className="mt-1 text-xs text-foreground/50">Used to pull the model directory and make a request to the current channel.</p>
                                                </div>
                                                <div className="model-editor-connection-fields grid gap-3 sm:grid-cols-2">
                                                    <Form.Item label="Channel name" htmlFor={`channel-${channel.id}-name`} className="mb-0 sm:col-span-1">
                                                        <Input
                                                            id={`channel-${channel.id}-name`}
                                                            value={channel.name}
                                                            disabled={builtinBeefTV}
                                                            placeholder="For example: My NewAPI"
                                                            onChange={(event) => updateChannel(channel.id, { name: event.target.value })}
                                                            onBlur={(event) => updateChannel(channel.id, { name: event.target.value.trim() || "unnamed channel" })}
                                                        />
                                                    </Form.Item>
                                                    <Form.Item label="Directory connection type" className="mb-0 sm:col-span-1" extra={builtinBeefTV ? "In-app adaptation" : "Only affects model directory pulls."}>
                                                        <Segmented<UserChannelConnection>
                                                            block
                                                            disabled={builtinBeefTV}
                                                            value={channelConnectionMode(channel)}
                                                            options={[
                                                                { label: "OpenAI", value: "openai" },
                                                                { label: "Gemini", value: "gemini" },
                                                            ]}
                                                            onChange={(value) => updateChannelConnection(channel, value)}
                                                        />
                                                    </Form.Item>
                                                    <Form.Item label="Base URL" htmlFor={`channel-${channel.id}-base-url`} className="mb-0 sm:col-span-1">
                                                        <Input
                                                            id={`channel-${channel.id}-base-url`}
                                                            inputMode="url"
                                                            value={channel.baseUrl}
                                                            disabled={builtinBeefTV}
                                                            placeholder={localMode ? "Fill in the local service Base URL" : "Fill in the cloud channel Base URL"}
                                                            onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })}
                                                            onBlur={(event) => updateChannel(channel.id, { baseUrl: event.target.value.trim().replace(/\/+$/u, "") })}
                                                        />
                                                    </Form.Item>
                                                    {builtinBeefTV ? (
                                                        <Form.Item label="Account connection" className="mb-0 sm:col-span-2">
                                                            <p className="m-0 text-sm leading-6 text-foreground/80">{beefTVConnectionLabel(beefConnection)}</p>
                                                            {beefConnection?.balance === "zero" ? <p className="mt-1 text-xs leading-5 text-foreground/55">The model can still be viewed when the balance is 0. An insufficient balance will be prompted when generating.</p> : null}
                                                        </Form.Item>
                                                    ) : (
                                                        <>
                                                            <Form.Item label="API Key" htmlFor={`channel-${channel.id}-api-key`} className="mb-0 sm:col-span-1">
                                                                <Input.Password
                                                                    id={`channel-${channel.id}-api-key`}
                                                                    autoComplete="new-password"
                                                                    value={channel.apiKey}
                                                                    placeholder={channel.apiFormat === "gemini" ? "Fill in the Gemini API Key" : "Fill in the current channel API Key"}
                                                                    onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })}
                                                                    onBlur={(event) => updateChannel(channel.id, { apiKey: event.target.value.trim() })}
                                                                />
                                                            </Form.Item>
                                                            <Form.Item label="Secret Key (optional)" htmlFor={`channel-${channel.id}-secret-key`} className="mb-0 sm:col-span-1" extra="Required for AK/SK protocols such as Dream; leave blank for other protocols.">
                                                                <Input.Password
                                                                    id={`channel-${channel.id}-secret-key`}
                                                                    autoComplete="new-password"
                                                                    value={channel.secretKey || ""}
                                                                    placeholder="Fill in Secret Key"
                                                                    onChange={(event) => updateChannel(channel.id, { secretKey: event.target.value })}
                                                                    onBlur={(event) => updateChannel(channel.id, { secretKey: event.target.value.trim() })}
                                                                />
                                                            </Form.Item>
                                                        </>
                                                    )}
                                                    <div className="sm:col-span-2">
                                                        <ChannelHeadersEditor value={channel.headers} onChange={(headers) => updateChannel(channel.id, { headers })} />
                                                    </div>
                                                </div>
                                            </section>
                                            <section className="model-editor-section">
                                                <div>
                                                    <h2>Models and Capabilities</h2>
                                                    <p className="mt-1 text-xs text-foreground/50">Maintain channel models and configure capabilities, interface formats, and pricing in a single model.</p>
                                                </div>
                                                <Form.Item label="Model list" htmlFor={`channel-${channel.id}-models`} className="mb-0">
                                                    <Select
                                                        id={`channel-${channel.id}-models`}
                                                        mode="tags"
                                                        showSearch
                                                        allowClear
                                                        maxTagCount="responsive"
                                                        tokenSeparators={[",", "\n"]}
                                                        placeholder="Enter the model name or click to pull the model"
                                                        value={channel.models}
                                                        onChange={(models) => updateChannel(channel.id, { models: uniqueModels(models) })}
                                                    />
                                                </Form.Item>
                                                <ChannelModelSettings channel={channel} onChange={(modelProfiles) => updateChannel(channel.id, { modelProfiles })} />
                                            </section>
                                        </div>
                                    </ModelEditorModal>
                                )}
                            </section>
                        );
                    })}
                </div>
            ) : (
                <WorkspaceState
                    icon="settings"
                    compact
                    title="Connect your first model service"
                    action={
                        <Button icon={<Plus className="size-4" />} onClick={addChannel}>
                                                        Add model service
                        </Button>
                    }
                />
            )}
            {serviceEditor !== undefined && <ModelServiceEditor initial={serviceEditor || undefined} onClose={() => setServiceEditor(undefined)} onSave={saveService} />}
        </Form>
    );
}

export function channelValidationError(channel: ModelChannel, connection?: BeefTVConnectionSummary | null) {
    return channelConnectionError(channel, connection) || validateChannelHeaders(channel.headers) || (!channel.models.length ? "Please add at least one model" : "");
}

export function isChannelReady(channel: ModelChannel) {
    return !channelValidationError(channel);
}

export function focusInvalidChannelField(channel: ModelChannel) {
    const baseUrlError = channelConnectionError({ ...channel, apiKey: "valid", secretKey: "valid" });
    const field = baseUrlError ? "base-url" : !channelHasGenerationCredential(channel) && !channelAllowsEmptyAPIKey(channel) ? "api-key" : requiresSecretKey(channel) && !channel.secretKey?.trim() ? "secret-key" : "models";
    requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    });
}

function ChannelStatus({ channel, persistence, connection }: { channel: ModelChannel; persistence: ModelConfigPersistenceState; connection?: BeefTVConnectionSummary | null }) {
    const receipts = useModelConnectionTests((state) => state.receipts);
    const tested = channel.models.map((model) => currentModelConnectionReceipt(receipts, channel, model));
    const passed = tested.filter((result) => result?.success).length;
    const failed = tested.filter((result) => result && !result.success).length;
    const error = channelValidationError(channel, connection);
    const label = modelConfigChannelStatusLabel(channel, persistence, connection);
    const testLabel = failed ? `${failed} model tests failed` : passed ? `${passed}/${channel.models.length} model test passed` : label;
    return (
        <span className={`settings-channel-status ${error || failed ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {isBuiltinBeefTVChannel(channel) ? label : error || (persistence.status === "saving" || persistence.status === "error" ? label : testLabel)}
        </span>
    );
}


export function modelConfigChannelStatusLabel(channel: ModelChannel, persistence: ModelConfigPersistenceState, connection?: BeefTVConnectionSummary | null) {
    if (isBuiltinBeefTVChannel(channel)) {
        if (connection?.state === "connected") return beefTVConnectionLabel(connection);
        if (connection?.state && connection.state !== "disconnected") return beefTVConnectionLabel(connection);
        if (channelHasManagedBeefTVCredential(channel)) return "Pending connection confirmation";
        return "Not connected";
    }
    if (!channelHasGenerationCredential(channel) && !channelAllowsEmptyAPIKey(channel)) return "To be configured";
    if (persistence.status === "saving") return "Saving";
    if (persistence.status === "error") return "Save failed";
    if (persistence.status === "saved") return "Saved · Not tested yet";
    return "Not tested yet";
}


export function modelConfigChannelPresentation(channel: ModelChannel) {
    const builtin = isBuiltinBeefTVChannel(channel);
    return {
        builtin,
        deletable: !builtin,
        adapterLabel: builtin ? "In-app adaptation" : "",
    };
}


function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelModelFetchErrorMessage(error: unknown) {
    if (getTransportFailureKind(error) === "timeout") return "Reading the model directory timed out, please check the address and network and try again; you can also add the model ID manually.";
    const detail = error instanceof Error ? error.message : "Failed to read model";
    if (detail.includes("Access to this machine is not allowed") || detail.includes("Access to reserved addresses is not allowed")) return `${detail}; The trusted private network service needs to be configured by the deployment administrator CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    return `${detail};You can also manually enter the model name directly in the model list`;
}

function channelConnectionMode(channel: ModelChannel): UserChannelConnection {
    return channel.apiFormat === "gemini" ? "gemini" : "openai";
}

function channelConnectionError(channel: ModelChannel, connection?: BeefTVConnectionSummary | null) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return "Please fill in the Base URL";
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Base URL only supports HTTP or HTTPS";
    } catch {
        return "Base URL format is incorrect";
    }
    if (isBuiltinBeefTVChannel(channel)) {
        if (connection?.state === "connected" || channelHasManagedBeefTVCredential(channel)) return "";
        return "Please connect to BeefTV first";
    }
    if (!channelHasGenerationCredential(channel) && !channelAllowsEmptyAPIKey(channel)) return "Please fill in API Key / Access Key";
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return "The current agreement requires filling in the Secret Key";
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.referenceAssetOrigin?.trim() || "", channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, JSON.stringify(channel.headers || [])].join("\n");
}

function channelProtocolLabel(channel: ModelChannel) {
    if (isTopazUpscaleChannel(channel)) return "fal · Topaz exclusive super score";
    return channelConnectionMode(channel) === "gemini" ? "Gemini native" : "OpenAI compatible";
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}

function requiresSecretKey(channel: ModelChannel) {
    return channel.modelProfiles?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}
