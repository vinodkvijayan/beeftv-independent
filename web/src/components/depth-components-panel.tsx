import { useCallback, useEffect, useState } from "react";
import { Button, Progress, type App } from "antd";
import { getDesktopAppBinding, type DepthComponentState } from "@/services/desktop-runtime";
import { navigateToSettings } from "@/lib/settings-navigation";

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const running = (state?: DepthComponentState) => state?.status === "downloading" || state?.status === "installing";
const statusText: Record<DepthComponentState["status"], string> = {
    not_installed: "Not installed yet", downloading: "Downloading", installing: "Unzipping and installing", ready: "Installed and ready to use",
    paused: "Download paused", error: "Installation not completed", unsupported: "The current device does not support it yet",
};

export function DepthComponentsPanel({ initialState, onReady, onCancel, onOpenSettings }: { initialState?: DepthComponentState; onReady?: () => void; onCancel?: () => Promise<void>; onOpenSettings?: () => void }) {
    const binding = getDesktopAppBinding();
    const [state, setState] = useState(initialState);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const refresh = useCallback(async (force = false) => {
        try {
            if (!binding?.DepthComponentStatus) throw new Error("Please manage local components in BeefTV desktop");
            setState(await binding.DepthComponentStatus(force));
            setError("");
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }, [binding]);
    useEffect(() => { if (!initialState) void refresh(); }, [initialState, refresh]);
    useEffect(() => {
        if (!running(state)) return;
        const timer = window.setInterval(() => void refresh(), 1000);
        return () => window.clearInterval(timer);
    }, [state?.status, refresh]);
    useEffect(() => { if (state?.status === "ready") onReady?.(); }, [state?.status, onReady]);
    const mutate = async (action?: () => Promise<DepthComponentState>) => {
        if (!action) return;
        setBusy(true);
        try { setState(await action()); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    const insufficient = Boolean(state && state.status !== "ready" && state.freeBytes < state.requiredBytes);
    return <div className="space-y-3 text-sm" data-canvas-no-zoom data-canvas-wheel-scroll>
        <p className="leading-6 text-foreground/70">The video is processed locally, and the required components and models are downloaded only after confirmation.</p>
        <p role="status">{state ? statusText[state.status] : error ? "Component information cannot be read temporarily" : "Checking component information..."}</p>
        {state && state.status !== "unsupported" ? <>
            <div className="space-y-1 leading-6">
                <p className="break-all">Storage location:{state.dataDir}</p>
                {state.status !== "ready" ? <p>Download approx.{gb(state.downloadBytes)}, need to reserve{gb(state.requiredBytes)}, currently available{gb(state.freeBytes)}</p> : null}
                <p className="text-foreground/60">{state.variant === "cuda" ? "Accelerated using NVIDIA graphics cards" : state.variant === "cpu" ? "Processing using CPU may take a long time" : "Accelerated with Apple silicon"}</p>
            </div>
            {running(state) ? <>
                <Progress percent={Math.min(99, Math.floor(state.downloadedBytes / Math.max(1, state.downloadBytes) * 100))} status="active" aria-label="Component download progress" />
                <p className="text-foreground/60">{gb(state.downloadedBytes)} / {gb(state.downloadBytes)}. You can continue downloading after pausing; it will not resume after exiting the app.</p>
            </> : null}
            {insufficient && !running(state) ? <p role="alert" className="text-destructive">Insufficient space, please change the directory or clean the disk first.</p> : null}
            <div className="flex flex-wrap gap-2">
                {running(state) ? <Button loading={busy} onClick={() => void mutate(binding?.PauseDepthComponentDownload)}>Pause download</Button> : state.status !== "ready" ? <Button type="primary" loading={busy} disabled={insufficient} onClick={() => void mutate(binding?.DownloadDepthComponents)}>{state.status === "paused" || state.status === "error" ? "Continue downloading" : onReady ? "Download and continue" : "Download components"}</Button> : null}
                {onOpenSettings && !running(state) ? <Button onClick={onOpenSettings}>Go to storage settings</Button> : null}
                {!onReady && !running(state) ? <Button disabled={busy} onClick={() => void refresh(true)}>recheck</Button> : null}
                {onCancel ? <Button disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { await onCancel(); } catch(cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
                }}>{running(state) ? "pause and return" : "Not downloading yet"}</Button> : null}
            </div>
        </> : null}
        {error || state?.error ? <p role="alert" className="break-words text-destructive">{error || state?.error}</p> : null}
        {!state && error ? <Button onClick={() => void refresh(true)}>recheck</Button> : null}
    </div>;
}

type ModalAPI = ReturnType<typeof App.useApp>["modal"];

export async function confirmDepthComponents(modal: ModalAPI): Promise<boolean> {
    const binding = getDesktopAppBinding();
    if (!binding?.DepthComponentStatus) throw new Error("Please first install the depth capture component in the storage settings of BeefTV desktop version");
    const state = await binding.DepthComponentStatus(true);
    if (state.status === "ready") return true;
    return new Promise<boolean>((resolve) => {
        let settled = false;
        let cancelRequested = false;
        const finish = (allowed: boolean) => { if (!settled) { settled = true; resolve(allowed); } };
        const cancel = async () => {
            // A download finishing during cancellation must not launch the task.
            cancelRequested = true;
            await binding.PauseDepthComponentDownload?.();
            dialog.destroy();
            finish(false);
        };
        const dialog = modal.confirm({
            title: "Preparing for deep motion capture", centered: true, closable: true, maskClosable: false, width: 560, footer: null, icon: null,
            content: <DepthComponentsPanel initialState={state} onReady={() => { if (!cancelRequested) { dialog.destroy(); finish(true); } }} onCancel={cancel} onOpenSettings={() => { finish(false); dialog.destroy(); navigateToSettings({ section: "storage" }); }} />,
            onCancel: cancel,
        });
    });
}
