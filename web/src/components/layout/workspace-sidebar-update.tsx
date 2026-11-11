import { useEffect, useState, type ReactNode } from "react";
import { Button, Popover } from "antd";
import { useReducedMotion } from "motion/react";
import { Download, LoaderCircle, RotateCcw } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";

import { AppChangelogButton, APP_VERSION } from "@/components/layout/app-changelog-modal";
import { cn } from "@/lib/utils";
import {
    desktopUpdateActionLabel,
    desktopUpdateDetailLabel,
    desktopUpdateProgressLabel,
    desktopUpdateProgressPercent,
    formatDesktopVersionLabel,
    hasResumableDesktopUpdate,
    shouldShowDesktopUpdaterControls,
    userFacingDesktopUpdateError,
    type DesktopUpdateState,
} from "@/services/desktop-update";
import { useDesktopUpdate } from "@/hooks/use-desktop-update";
import DiagnosticsPanel from "@/pages/settings/diagnostics-panel";

import "./workspace-sidebar-update.css";

type UpdateStatusLine = { title: string; detail: string; percent: number | null; tone: "active" | "paused" };

function statusLine(state: DesktopUpdateState, persistBusy: boolean, latest: string, percent: number | null): UpdateStatusLine | null {
    if (persistBusy) return { title: "Saving workspace", detail: "After saving, start the installation", percent: null, tone: "active" };
    switch (state.status) {
        case "downloading":
            return { title: state.totalBytes > 0 && state.downloadedBytes >= state.totalBytes ? "Verifying update package" : latest ? `Downloading${latest}` : "Downloading updates", detail: desktopUpdateDetailLabel(state), percent: state.downloadedBytes > 0 ? percent : null, tone: "active" };
        case "ready":
            return { title: "Update package has been downloaded", detail: "Current work will be saved before installation", percent: null, tone: "active" };
        case "installing": {
            const title = state.installPrepared || state.phase === "restarting" ? "Restarting application" : state.phase === "verifying" ? "Verifying update package" : state.phase === "extracting" ? "Unpacking update" : "Preparing for installation";
            return { title, detail: desktopUpdateDetailLabel(state), percent: state.phase === "extracting" && state.totalFiles ? Math.min(100, Math.floor((state.completedFiles ?? 0) / state.totalFiles * 100)) : null, tone: "active" };
        }
        case "error":
            return hasResumableDesktopUpdate(state)
                ? { title: latest ? `Continue downloading${latest}` : "Continue downloading", detail: desktopUpdateDetailLabel(state), percent, tone: "paused" }
                : { title: latest ? `Retry update${latest}` : "Retry update", detail: desktopUpdateDetailLabel(state), percent: null, tone: "paused" };
        default:
            return null;
    }
}

export function WorkspaceSidebarUpdate({ collapsed, leading }: { collapsed: boolean; leading?: ReactNode }) {
    const reducedMotion = useReducedMotion();
    const updater = useDesktopUpdate();
    const { state, persistBusy, actionBusy, runtime } = updater;
    const [saveWarningOpen, setSaveWarningOpen] = useState(false);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    useEffect(() => {
        if (updater.canForceInstall) setSaveWarningOpen(true);
    }, [updater.canForceInstall]);
    const installed = formatDesktopVersionLabel(state.currentVersion || APP_VERSION);
    const latest = formatDesktopVersionLabel(state.latestVersion);
    const showControls = shouldShowDesktopUpdaterControls(updater.snapshot);
    const busy = persistBusy || actionBusy || state.status === "checking" || state.status === "downloading" || state.status === "installing";
    const percent = desktopUpdateProgressPercent(state);
    const resumable = hasResumableDesktopUpdate(state);
    const enabled = runtime === "desktop" && state.status !== "disabled";
    const actionLabel = !enabled ? (state.error || "The current environment does not support automatic updates") : persistBusy ? "Saving" : state.status === "available" ? "Download and install updates" : showControls ? desktopUpdateActionLabel(state.status) : state.status === "checking" ? "Checking for updates" : state.status === "error" ? "Retry checking for updates" : "Check for updates";
    const errorText = state.status === "error" ? userFacingDesktopUpdateError(state.error) : "";
    const updateLabel = updater.canForceInstall ? "Saving is not completed, click to view processing method" : state.status === "error" ? `${errorText.replace(/[。！，]$/, "")}，${resumable ? "Click to continue downloading" : "Click to try again"}` : latest ? `${actionLabel} ${latest}` : actionLabel;
    const line = showControls ? statusLine(state, persistBusy, latest, percent) : null;
    const elapsed = usePhaseElapsed(busy, persistBusy ? "saving" : `${state.status}:${state.phase ?? ""}`);
    const slow = elapsed >= 30 && (persistBusy || state.status === "installing" || state.phase === "verifying");
    const amount = state.totalBytes > 0 ? desktopUpdateProgressLabel(state) : "";
    const tooltip = line ? [line.title, amount, line.detail].filter(Boolean).join("\n") : updateLabel;
    const showBar = !persistBusy && ((state.status === "downloading" && state.phase !== "verifying") || (state.status === "installing" && state.phase === "extracting") || (line?.tone === "paused" && line.percent !== null));
    const barPercent = state.phase === "extracting" ? line?.percent ?? null : percent;
    const handleUpdate = () => {
        if (updater.canForceInstall) {
            setSaveWarningOpen(true);
            return;
        }
        if (state.status === "error") return showControls ? updater.downloadAndInstall() : updater.retry();
        return showControls ? updater.downloadAndInstall() : updater.check();
    };
    const statusContent = line ? <div className={cn("app-workspace-update-status", line.tone === "paused" && "is-paused")} role="status" aria-live="polite">
        <span className="app-workspace-update-status-title">{line.title}</span>
        <span className="app-workspace-update-status-detail">{line.detail}</span>
		{state.status === "error" ? <button type="button" className="app-workspace-update-diagnostics" onClick={() => setDiagnosticsOpen(true)}>Troubleshooting update failures</button> : null}
        {slow ? <span className="app-workspace-update-status-detail">{persistBusy ? "Still waiting for save to complete" : "It takes a long time, please keep the app open"}</span> : null}
        {showBar ? <UpdateProgressBar state={state} percent={barPercent} reducedMotion={Boolean(reducedMotion)} paused={state.status === "error"} /> : null}
    </div> : null;

    return (
        <div className={cn("app-workspace-update", collapsed && "is-collapsed")} data-desktop-update-status={state.status} data-desktop-update-runtime={runtime}>
            {leading ?? <AppChangelogButton className="app-workspace-update-version" showIcon={false} showVersion version={installed} versionClassName="tabular-nums" ariaLabel={installed ? `Current version${installed}, view the change log` : "View changelog"} />}
                <Popover open={collapsed && Boolean(line)} content={collapsed ? statusContent : null} placement="rightBottom" arrow={false} rootClassName="app-workspace-update-popover">
                <div className="app-workspace-update-progress" role="status" aria-live="polite">
                    {!line ? <span className="sr-only">{updateLabel}</span> : null}
                    <button type="button" className={cn("app-workspace-update-action", showControls && "has-update", busy && "is-busy")} disabled={!enabled || busy} onClick={() => void handleUpdate()} aria-label={updateLabel} title={tooltip}>
                        {busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.8} aria-hidden="true" /> : state.status === "error" ? <RotateCcw className="size-4" strokeWidth={1.8} aria-hidden="true" /> : <Download className="size-4" strokeWidth={1.8} aria-hidden="true" />}
                    </button>
                </div>
                </Popover>
                {!collapsed ? statusContent : null}
			<DiagnosticsPanel open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
            <AppModal
                open={saveWarningOpen && updater.canForceInstall}
                title="The save is not complete, do you still want to update?"
                onCancel={() => setSaveWarningOpen(false)}
                width={480}
                footer={[
                    <Button key="cancel" onClick={() => setSaveWarningOpen(false)}>Return to processing</Button>,
                    <Button key="retry" type="primary" onClick={() => { setSaveWarningOpen(false); void updater.install(); }}>Retry saving</Button>,
                    <Button key="force" danger onClick={() => { setSaveWarningOpen(false); void updater.forceInstall(); }}>Still updated</Button>,
                ]}
            >
                <p>{errorText}</p>
                <p className="mt-3">The update will close and restart the application, and unsaved changes may be lost.</p>
                <p className="mt-3">You can go back to processing first, or try saving again.</p>
            </AppModal>
        </div>
    );
}

function UpdateProgressBar({ state, percent, reducedMotion, paused }: { state: DesktopUpdateState; percent: number | null; reducedMotion: boolean; paused: boolean }) {
    return (
        <span
            className={cn("app-workspace-update-progress-bar", paused && "is-paused")}
            role="progressbar"
            aria-label={state.phase === "extracting" ? "Update decompression progress" : "Update download progress"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-valuetext={state.phase === "extracting" ? desktopUpdateDetailLabel(state) : desktopUpdateProgressLabel(state)}
        >
            <span style={{ width: `${percent ?? (reducedMotion ? 100 : 32)}%` }} />
        </span>
    );
}

function usePhaseElapsed(active: boolean, phase: string) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        setElapsed(0);
        if (!active) return;
        const started = Date.now();
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [active, phase]);
    return elapsed;
}
