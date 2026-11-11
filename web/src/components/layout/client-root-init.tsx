import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { navigateToSettings } from "@/lib/settings-navigation";
import { initializeClientDiagnostics, setDiagnosticUserScope } from "@/services/diagnostics/client-diagnostics";
import { fetchPluginRuntimeState, setUserPluginEnabled } from "@/services/api/plugins";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { appQueryClient } from "@/lib/query-client";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { getActiveUserScope } from "@/lib/user-scope";
import { confirmDesktopUpdateStartup } from "@/services/desktop-update-startup";
import { runStartupEnvironmentCheck } from "@/services/diagnostics/environment-startup";
import { getDesktopAppBinding } from "@/services/desktop-runtime";
import { appHref } from "@/lib/app-routing";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const config = useConfigStore((state) => state.config);
    const userId = useUserStore((state) => state.user?.id || "");
    const storageMode = useUserStore((state) => state.storageMode);
    const user = useUserStore((state) => state.user);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const localMode = isLocalWorkspaceMode() || storageMode === "local" || user?.username === "local";
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setRuntimeStatuses = usePluginStore((state) => state.setRuntimeStatuses);
    const setPluginStates = usePluginStore((state) => state.setPluginStates);
    const pluginStoreHydrated = usePluginStore((state) => state.hydrated);
    const localMediaCleanupScope = useRef("");
    const updateStartupConfirmed = useRef(false);
    const environmentScope = useRef("");

    useEffect(() => {
        let stopped = false, pending = false;
        const read = async () => {
            const consume = getDesktopAppBinding()?.ConsumeSkillLink;
            if (!consume || pending || !userId) return;
            pending = true;
            try {
                const route = await consume();
                if (!stopped && route.startsWith("/skills?")) window.location.assign(appHref(route));
            } finally { pending = false; }
        };
        const timer = window.setInterval(() => void read().catch(() => {}), 1000);
        void read().catch(() => {});
        return () => { stopped = true; clearInterval(timer); };
    }, [userId]);

    useEffect(() => {
        if (!userId || !localMode || environmentScope.current === userId) return;
        environmentScope.current = userId;
        const controller = new AbortController();
        void runStartupEnvironmentCheck(controller.signal).then((report) => {
            if (useUserStore.getState().user?.id === userId && report?.checks.some((check) => check.status === "error" || check.status === "warning")) {
                message.warning("The environment check finds problems that may affect creation, which can be viewed in the problem diagnosis of settings.", 8);
            }
        });
        return () => {
            controller.abort();
            if (environmentScope.current === userId) environmentScope.current = "";
        };
    }, [localMode, userId, message]);

    useEffect(() => {
        if (!localMode) return;
        const confirm = () => {
            if (updateStartupConfirmed.current || !useAssetStore.persist.hasHydrated() || !useCanvasStore.persist.hasHydrated()) return;
            updateStartupConfirmed.current = true;
            void confirmDesktopUpdateStartup().catch((error) => console.warn("Upgrade file cleanup will be retried on next boot", error));
        };
        const stopAssets = useAssetStore.persist.onFinishHydration(confirm);
        const stopCanvases = useCanvasStore.persist.onFinishHydration(confirm);
        confirm();
        return () => { stopAssets(); stopCanvases(); };
    }, [localMode]);

    useEffect(() => () => {
        usePluginStore.getState().setRuntimeStatuses({});
        usePluginStore.getState().setPluginStates({});
    }, []);

    useEffect(() => {
        if (!userId || localMode || !pluginStoreHydrated) return;
        let cancelled = false;
        void appQueryClient.fetchQuery({ queryKey: ["plugin-runtime", userId], queryFn: fetchPluginRuntimeState, staleTime: 30_000 })
            .then(async (runtime) => {
                if (cancelled || useUserStore.getState().user?.id !== userId) return;
                const states = { ...runtime.states };
                const legacyEnabledIds = usePluginStore
                    .getState()
                    .installations.filter((installation) => installation.enabled && states[installation.manifest.id]?.canToggle && !states[installation.manifest.id]?.userConfigured)
                    .map((installation) => installation.manifest.id);
                if (legacyEnabledIds.length) {
                    try {
                        const migrated = await Promise.all(legacyEnabledIds.map((pluginId) => setUserPluginEnabled(pluginId, true)));
                        for (const state of migrated) states[state.pluginId] = state;
                    } catch (error) {
                        console.warn("Failed to migrate user plug-in enabled status, server status has been retained", error);
                    }
                }
                if (!cancelled && useUserStore.getState().user?.id === userId) {
                    setRuntimeStatuses({});
                    setPluginStates(states);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRuntimeStatuses({});
                    setPluginStates({});
                }
            });
        return () => {
            cancelled = true;
        };
    }, [localMode, pluginStoreHydrated, setPluginStates, setRuntimeStatuses, userId]);

    useEffect(() => {
        initializeClientDiagnostics();
    }, []);

    useEffect(() => {
        if (!localMode || !assetsHydrated || !canvasHydrated) return;
        const scope = getActiveUserScope();
        if (localMediaCleanupScope.current === scope) return;
        localMediaCleanupScope.current = scope;
        void useAssetStore.getState().cleanupImages().catch((error) => {
            // Cache cleanup is best effort; it must never block opening the local workspace.
            console.warn("Local media cache cleanup failed, current workspace retained", { scope, error });
        });
    }, [assetsHydrated, canvasHydrated, localMode]);

    useEffect(() => {
        setDiagnosticUserScope(userId);
    }, [userId]);

    useEffect(() => {
        const interactiveSelector = 'button, [role="button"], a, [class*="card"], [class*="Card"]';
        const blurPointerFocus = (event: PointerEvent) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>(interactiveSelector) : null;
            if (!target || target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return;
            // 浏览器可能把鼠标点击误判为 :focus-visible；下一帧只清掉这次指针点击产生的焦点。
            window.requestAnimationFrame(() => {
                if (document.activeElement === target) target.blur();
            });
        };
        document.addEventListener("pointerdown", blurPointerFocus, true);
        return () => document.removeEventListener("pointerdown", blurPointerFocus, true);
    }, []);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const ignoredApiKey = searchParams.has("apiKey") || searchParams.has("apikey");
        if (!baseUrl && !ignoredApiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "Default channel", baseUrl: baseUrl || undefined })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        navigateToSettings({ section: "channels" });
        if (ignoredApiKey) message.warning("For security reasons, the API Key in the link has been ignored, please fill it in manually in the configuration");
        else message.success("Local direct address has been imported");
    }, [config.channels, message, updateConfig]);

    return <>{children}</>;
}
