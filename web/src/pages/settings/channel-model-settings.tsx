import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Popconfirm, Segmented, Tag, Tooltip } from "antd";
import { ReferenceMediaTransportFields } from "./reference-media-transport-fields";
import { ChevronRight, FlaskConical, Settings2 } from "lucide-react";

import { ModelEditorModal } from "@/components/model-editor-modal";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import { builtinPresetForProtocol } from "@/lib/builtin-service-presets";
import { testChannelModelConnection } from "@/lib/model-connection-test";
import { seedancePortraitLabel } from "@/lib/seedance-portrait";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { type ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { capabilityForAssignedProtocol, defaultModelCapabilityConfig, hasUserModelCapability } from "@/lib/model-capabilities";
import { canonicalModelProtocol, modelProtocolDefinitionFor, defaultProtocolForCapability, defaultProtocolForModel, inferProtocolCapabilityFromModel, modelProtocolCapability, modelProtocolDefinition, type ModelProtocol, type ModelProtocolDefinition } from "@/lib/model-protocols";
import { signatureCredentialHint } from "@/lib/service-credentials";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { normalizeModelCapabilityDraft } from "@/services/api/workspace";
import { isBuiltinBeefTVChannel, modelOptionName, type ModelChannel } from "@/stores/use-config-store";
import { channelTextProtocols, effectiveTextProtocol, useChannelRequestUrls } from "./use-channel-request-urls";
import { UrlText } from "./channel-request-addresses";
import { TextProtocolDetection } from "./text-protocol-detection";
import { currentModelConnectionReceipt, useModelConnectionTests } from "@/stores/use-model-connection-tests";

type ModelProfile = NonNullable<ModelChannel["modelProfiles"]>[number];

export function ChannelModelSettings({
    channel,
    onChange,
    draft = false,
    focusModel,
}: {
    channel: ModelChannel;
    onChange: (profiles: ModelProfile[]) => void;
    draft?: boolean;
    focusModel?: { model: string; token: number } | null;
}) {
    const { message } = App.useApp();
    const [testingModel, setTestingModel] = useState("");
    const [detecting, setDetecting] = useState(false);
    const [editorTab, setEditorTab] = useState("protocol");
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [protocolError, setProtocolError] = useState("");
    const [activeModel, setActiveModel] = useState<string | null>(null);
    // 接口格式是高级项：已经选好时只显示一行，点「更改」才展开；还没选时直接展开。
    const [interfaceOpen, setInterfaceOpen] = useState(false);
    const [availableProtocols, setAvailableProtocols] = useState<ModelProtocolDefinition[]>([]);
    const { receipts, record } = useModelConnectionTests();
    const testResult = activeModel ? currentModelConnectionReceipt(receipts, channel, activeModel) : undefined;
    const channelRef = useRef(channel);
    channelRef.current = channel;

    useEffect(() => {
        let active = true;
        void fetchPluginProviderCatalog("user.custom-channel").then((items) => { if (active) setAvailableProtocols(items); })
            .catch((error) => { if (active) setProtocolError(error instanceof Error ? error.message : "Interface list read failed"); })
            .finally(() => { if (active) setProtocolLoading(false); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!focusModel?.model || !channel.models.includes(focusModel.model)) return;
        setEditorTab("protocol");
        setInterfaceOpen(false);
        setActiveModel(focusModel.model);
    }, [focusModel?.model, focusModel?.token]);

    // 官方托管渠道的地址由后端改写，这里不展示请求地址。钩子要在下面的提前返回之前调用。
    const showRequestUrls = channel.scope !== "system" && !isBuiltinBeefTVChannel(channel);
    const requestUrls = useChannelRequestUrls(showRequestUrls ? channel.baseUrl : "", channel.apiFormat, channelTextProtocols(channel));

    if (!channel.models.length) return (
        <div className="mt-4">
            <div className="text-xs font-medium">Model capabilities</div>
            <p className="mt-2 text-xs leading-5 text-foreground/58">
                                First enter the model name in the "Model List" above and press Enter, then select capabilities for the model.
            </p>
        </div>
    );

    const resolveChannelProtocol = (capability: ModelProfile["capability"]) => modelProtocolDefinitionFor(channel.interfaceType, capability, availableProtocols)?.value;

    const buildDefaultProfile = (model: string): ModelProfile => {
        const inferredCapability = inferProtocolCapabilityFromModel(model);
        const defaultProtocol = inferredCapability === "video" ? resolveChannelProtocol("video") : defaultProtocolForModel(model, availableProtocols);
        const defaultCap = modelProtocolCapability(defaultProtocol, availableProtocols) || inferredCapability;
        return {
            model,
            capability: defaultCap,
            protocol: defaultProtocol,
            capabilityConfig: defaultModelCapabilityConfig(defaultProtocol, model, availableProtocols),
        };
    };

    const updateProfile = (model: string, patch: Partial<ModelProfile>, syncSameCapabilityUnconfigured = false) => {
        const liveChannel = channelRef.current;
        const current = liveChannel.modelProfiles?.find((item) => item.model === model) || buildDefaultProfile(model);
        const nextProfile = { ...current, ...patch, model };
        // 协议或能力切换会重写为默认参数；只有编辑器里的手动修改才保留「用户声明」标记。
        if ("capabilityConfig" in patch && !("capabilitySource" in patch)) nextProfile.capabilitySource = undefined;
        const authType = "protocol" in patch ? modelProtocolDefinition(nextProfile.protocol, availableProtocols)?.authType : nextProfile.authType;
        if ("protocol" in patch) nextProfile.authType = authType;
        const byModel = new Map((liveChannel.modelProfiles || []).map((item) => [item.model, item]));
        byModel.set(model, nextProfile);
        if (syncSameCapabilityUnconfigured && nextProfile.protocol && nextProfile.capability) {
            for (const rawModel of liveChannel.models) {
                const sibling = modelOptionName(rawModel);
                if (sibling === model) continue;
                const existing = byModel.get(sibling) || buildDefaultProfile(sibling);
                if (existing.capability === nextProfile.capability && !existing.protocol) {
                    byModel.set(sibling, {
                        ...existing,
                        protocol: nextProfile.protocol,
                        authType,
                        ...capabilityForAssignedProtocol(existing, nextProfile.protocol, availableProtocols, { keepNonMediaExisting: true }),
                    });
                }
            }
        }
        const next = [...byModel.values()].filter((item) => liveChannel.models.includes(item.model));
        channelRef.current = { ...liveChannel, modelProfiles: next };
        onChange(next);
    };

    const refreshBackendCapability = (
        model: string,
        capability: ModelCapabilityChoice,
        protocol?: ModelProtocol,
        capabilityConfig?: ModelProfile["capabilityConfig"],
        preserveUserCapability = false,
    ) => {
        if (draft || preserveUserCapability || !protocol || (capability !== "image" && capability !== "video" && capability !== "text")) return;
        void normalizeModelCapabilityDraft({
            channelId: channel.id,
            baseUrl: channel.baseUrl,
            capability,
            protocol,
            model,
            capabilityConfig,
        })
            .then((normalized) => {
                const latest = channelRef.current.modelProfiles?.find((item) => item.model === model);
                if (
                    hasUserModelCapability(latest) ||
                    (latest?.capability && latest.capability !== capability) ||
                    (latest?.protocol && latest.protocol !== protocol)
                ) {
                    return;
                }
                const resolved = normalized.capabilityConfig || normalized;
                if (resolved && typeof resolved.version === "number" && (resolved.video || resolved.image || resolved.text)) {
                    updateProfile(model, { protocol, capability, capabilityConfig: resolved });
                }
            })
            .catch(() => {
                // Keep local fallback when the backend capability endpoint is unreachable.
            });
    };

    const testModel = async (model: string, capability: ModelProfile["capability"], protocol: ModelProtocol) => {
        setTestingModel(model);
        try {
            const detail = await testChannelModelConnection(channel, model, capability, protocol);
            record(channel, model, { success: true, detail });
            message.success(`Model test passed:${detail}`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "Model test failed";
            record(channel, model, { success: false, detail });
            message.error(detail);
        } finally {
            setTestingModel("");
        }
    };

    const activeModelProfile = activeModel ? channel.modelProfiles?.find((item) => item.model === activeModel) : undefined;
    const activeInferredCapability = activeModel ? (activeModelProfile?.capability || inferProtocolCapabilityFromModel(activeModel)) : "text";
    const inferredProtocol = activeModel ? (activeInferredCapability === "video" ? resolveChannelProtocol("video") || "" : defaultProtocolForModel(activeModel, availableProtocols)) : "";
    const activeProtocol = activeModelProfile ? canonicalModelProtocol(activeModelProfile.protocol, availableProtocols) || resolveChannelProtocol(activeInferredCapability) || "" : inferredProtocol;
    const activeCapability = activeModelProfile?.capability || modelProtocolCapability(activeProtocol, availableProtocols) || activeInferredCapability;
    const signatureHint = signatureCredentialHint(modelProtocolDefinition(activeProtocol, availableProtocols)?.authType);
    const testDisabledReason = !activeProtocol
        ? "Please select the interface format in \"Basic Information\" first"
        : protocolError
          ? `Interface list read failed:${protocolError}`
          : protocolLoading
            ? "Reading interface list..."
            : undefined;
    const rows = channel.models.map((rawModel) => {
        const model = modelOptionName(rawModel);
        const profile = channel.modelProfiles?.find((item) => item.model === model);
        const inferredCapability = profile?.capability || inferProtocolCapabilityFromModel(model);
        const protocol = profile ? canonicalModelProtocol(profile.protocol, availableProtocols) || resolveChannelProtocol(inferredCapability) || "" : (inferredCapability === "video" ? resolveChannelProtocol("video") || "" : defaultProtocolForModel(model, availableProtocols));
        const capability = profile?.capability || modelProtocolCapability(protocol, availableProtocols) || inferredCapability;
        return { model, profile, protocol, capability, displayName: seedancePortraitLabel(model) || profile?.displayName?.trim() || model };
    });
    // 文本模型展示的是后端实际请求的地址；其他能力仍展示接口格式自带的路径。
    const textRequestUrl = (model: string) => requestUrls?.text[effectiveTextProtocol(channel, model)];
    const activeRequestUrl = activeModel && activeCapability === "text" ? textRequestUrl(activeModel) : undefined;

    return (
        <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs font-medium">Model capabilities</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">Adjust the parameters according to the service provider's requirements, or generate it once to verify the connection.</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/35">{channel.models.length}  models</span>
            </div>
            <div className="space-y-2">
                {rows.map(({ model, protocol, capability, displayName }) => {
                    const requestPath = (capability === "text" ? textRequestUrl(model) : undefined) || modelProtocolDefinition(protocol, availableProtocols)?.create;
                    return (
                        <div key={model} className="flex min-w-0 items-center gap-3 rounded-md bg-surface-active px-3 py-2.5 transition-colors hover:bg-surface-hover">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.045] text-foreground/65">
                                <Settings2 className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium" title={displayName === model ? model : `${displayName} (${model})`}>
                                    {displayName}
                                    {displayName !== model ? <span className="ml-1.5 font-mono text-[var(--fs-tiny)] font-normal text-foreground/45">{model}</span> : null}
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                    <Tag className="mr-0 text-[var(--fs-tiny)]" bordered={false}>
                                        {capabilityLabel(capability)}
                                    </Tag>
                                    <span className="truncate font-mono text-[var(--fs-tiny)] text-foreground/40" title={requestPath}>
                                        {requestPath || "The interface format has not been selected yet"}
                                    </span>
                                </div>
                            </div>
                            <Button type="text" size="small" icon={<ChevronRight className="size-4" />} iconPosition="end" onClick={() => { setEditorTab("protocol"); setInterfaceOpen(false); setActiveModel(model); }}>
                                                                Configure using
                            </Button>
                        </div>
                    );
                })}
            </div>
            <ModelEditorModal
                open={Boolean(activeModel)}
                busy={Boolean(testingModel) || detecting}
                title="Edit model usage configuration"
                subtitle={activeModel || ""}
                activeKey={editorTab}
                onTabChange={setEditorTab}
                onClose={() => setActiveModel(null)}
                footer={
                    <div className="model-editor-footer">
                        <span className="text-xs text-foreground/50">{draft ? "When finished, click Save and Use to save your changes" : "Changes are saved to the local workspace in real time"}</span>
                        <div className="model-editor-footer-actions">
                            <Popconfirm title="Generate test results once?" description="The real generation task will be submitted to the current service provider, and the fee will be charged by the service provider. Results can be viewed in the task center." okText="Start generating" cancelText="Cancel" disabled={Boolean(testDisabledReason) || detecting} onConfirm={() => { if (activeModel && activeProtocol) void testModel(activeModel, activeCapability, activeProtocol); }}>
                            <Tooltip title={testDisabledReason}>
                                <Button
                                    icon={<FlaskConical className="size-4" />}
                                    loading={Boolean(testingModel)}
                                    disabled={Boolean(testDisabledReason) || detecting}
                                >
                                                                        Generate tests
                                </Button>
                            </Tooltip>
                            </Popconfirm>
                            <Button disabled={Boolean(testingModel) || detecting} onClick={() => setActiveModel(null)}>Done</Button>
                        </div>
                    </div>
                }
                items={activeModel ? [
                    {
                        key: "protocol",
                        label: "Basic information",
                        children: <div className="space-y-4" inert={Boolean(testingModel)}>
                            <section className="space-y-2">
                                <div className="text-xs font-medium">Model capabilities</div>
                                <Segmented<ModelCapabilityChoice>
                                    block
                                    options={[{ label: "text", value: "text" }, { label: "pictures", value: "image" }, { label: "video", value: "video" }, { label: "Audio", value: "audio" }]}
                                    value={activeCapability}
                                    onChange={(nextCapability) => {
                                        const nextProtocol = availableProtocols.find((item) => item.value === activeProtocol && item.capability === nextCapability && item.enabled !== false)?.value || (nextCapability === "video" ? resolveChannelProtocol("video") : defaultProtocolForCapability(nextCapability, availableProtocols));
                                        const nextCapabilityConfig = nextCapability === "image" || nextCapability === "video" ? defaultModelCapabilityConfig(nextProtocol, activeModel, availableProtocols) : undefined;
                                        updateProfile(activeModel, {
                                            protocol: nextProtocol,
                                            capability: nextCapability,
                                            capabilityConfig: nextCapabilityConfig,
                                        });
                                        refreshBackendCapability(activeModel, nextCapability, nextProtocol);
                                    }}
                                />
                            </section>
                            {channel.scope !== "system" && activeCapability !== "text" && activeProtocol !== "full-video" && !builtinPresetForProtocol(activeProtocol)?.declaresReferenceMediaTransport && <ReferenceMediaTransportFields value={activeModelProfile?.referenceMediaTransport} onChange={(referenceMediaTransport) => updateProfile(activeModel, { referenceMediaTransport })} />}
                            <section className="space-y-2">
                                {activeProtocol && !interfaceOpen ? (
                                    <div className="flex min-w-0 items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-xs font-medium">Interface format</div>
                                            <div className="mt-0.5 truncate text-xs text-foreground/58" title={modelProtocolDefinition(activeProtocol, availableProtocols)?.create}>
                                                {modelProtocolDefinition(activeProtocol, availableProtocols)?.label || activeProtocol}
                                            </div>
                                            {activeRequestUrl ? <div className="mt-1 text-[var(--fs-tiny)] text-foreground/45 [overflow-wrap:anywhere]">Request address:<span className="font-mono"><UrlText url={activeRequestUrl} /></span></div> : null}
                                        </div>
                                        <Button size="small" onClick={() => setInterfaceOpen(true)}>change</Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-xs font-medium">Interface format</div>
                                        <p className="text-xs leading-5 text-foreground/58">The request method written in the service provider's documentation. For common services, choose OpenAI Chat Completions.</p>
                                        <ModelProtocolBrowser
                                            loading={protocolLoading}
                                            error={protocolError}
                                            capability={activeCapability}
                                            value={activeProtocol}
                                            protocols={availableProtocols}
                                            onChange={(nextProtocol) => {
                                                setInterfaceOpen(true);
                                                const keepUserCapability = hasUserModelCapability(activeModelProfile);
                                                const assigned = capabilityForAssignedProtocol(
                                                    activeModelProfile || { model: activeModel, capability: activeCapability },
                                                    nextProtocol,
                                                    availableProtocols,
                                                );
                                                updateProfile(
                                                    activeModel,
                                                    {
                                                        protocol: nextProtocol,
                                                        ...assigned,
                                                    },
                                                    true,
                                                );
                                                refreshBackendCapability(activeModel, activeCapability, nextProtocol, undefined, keepUserCapability);
                                            }}
                                        />
                                    </>
                                )}
                                {activeCapability === "text" && channel.scope !== "system" && !protocolLoading && !protocolError ? (
                                    <TextProtocolDetection
                                        key={activeModel}
                                        channel={channel}
                                        model={activeModel}
                                        current={activeProtocol}
                                        protocols={availableProtocols}
                                        disabled={Boolean(testingModel)}
                                        onRunningChange={setDetecting}
                                        onSelect={(nextProtocol) => {
                                            updateProfile(activeModel, { protocol: nextProtocol, capabilityConfig: undefined }, true);
                                            refreshBackendCapability(activeModel, "text", nextProtocol);
                                        }}
                                    />
                                ) : null}
                                {signatureHint && <p className="text-xs leading-5 text-foreground/58">{signatureHint}</p>}
                            </section>
                        </div>,
                    },
                    {
                        key: "capabilities",
                        label: "Capabilities and Parameters",
                        children: <div inert={Boolean(testingModel)}>
                            {activeCapability === "image" || activeCapability === "video" ? (
                                <ModelCapabilityEditor
                                    capability={activeCapability}
                                    model={activeModel}
                                    value={activeModelProfile?.capabilityConfig || defaultModelCapabilityConfig(activeProtocol, activeModel, availableProtocols)}
                                    protocol={activeProtocol}
                                    onChange={(capabilityConfig) => updateProfile(activeModel, { capabilityConfig, capabilitySource: "user" })}
                                />
                            ) : <p className="text-xs text-foreground/50">The current model type does not require additional configuration of references and parameters.</p>}
                        </div>,
                    },
                ] : []}
            >
                {(tabs) => <>{!testingModel && testResult ? <Alert className="mx-6 mt-4 shrink-0" type={testResult.success ? "success" : "error"} title={testResult.detail} showIcon /> : null}{tabs}</>}
            </ModelEditorModal>
        </div>
    );
}

function capabilityLabel(value: ModelProfile["capability"]) {
    return { text: "text", image: "pictures", video: "video", audio: "Audio", "": "To be configured" }[value] || "To be configured";
}
