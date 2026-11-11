import { useEffect, useState } from "react";
import { App, Button, Input, Switch } from "antd";
import { FolderOpen } from "lucide-react";
import { getAutoDownloadGeneratedMedia, setAutoDownloadGeneratedMedia } from "@/lib/auto-download-preference";
import { onStorageNamespaceChange } from "@/lib/user-scope";
import { getDesktopAppBinding, type DesktopStorageUsage } from "@/services/desktop-runtime";
import {
    DEFAULT_CANVAS_DOCUMENT_LIMIT_MB,
    getCanvasDocumentLimitMB,
    readLocalCanvasDocumentLimitMB,
    updateCanvasDocumentLimitMB,
} from "@/services/api/resources";
import { flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { saveRemoteUserDataNow } from "@/services/local-workspace-sync";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";
import { startOperation } from "@/stores/use-operation-progress";
import { createTransferSampler } from "@/lib/operation-progress";

const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function StorageSettingsPane() {
    const { message, modal } = App.useApp();
    const binding = getDesktopAppBinding();
    const hasNativeStorage = Boolean(binding?.StorageSettings && binding.MigrateStorage);
    const [usage, setUsage] = useState<DesktopStorageUsage>();
    const [target, setTarget] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [cleanupInterrupted, setCleanupInterrupted] = useState(false);
    const [savedCanvasLimit, setSavedCanvasLimit] = useState<number>(() => readLocalCanvasDocumentLimitMB());
    const [canvasLimitInput, setCanvasLimitInput] = useState<string>(() => String(readLocalCanvasDocumentLimitMB()));
    const [savingCanvasLimit, setSavingCanvasLimit] = useState(false);
    const [canvasLimitError, setCanvasLimitError] = useState("");
    const [autoDownloadGeneratedMedia, setAutoDownloadGeneratedMediaState] = useState<boolean>(() => getAutoDownloadGeneratedMedia());
    const [errorSummary, ...errorDetails] = error.split("\n\n");
    useEffect(() => onStorageNamespaceChange(() => setAutoDownloadGeneratedMediaState(getAutoDownloadGeneratedMedia())), []);
    useEffect(() => {
        let active = true;
        void getCanvasDocumentLimitMB().then((limitMB) => {
            if (!active) return;
            setSavedCanvasLimit(limitMB);
            setCanvasLimitInput(String(limitMB));
        });
        if (hasNativeStorage) {
            void binding
                ?.StorageSettings?.()
                .then((value) => {
                    if (active) setUsage(value);
                })
                .catch(() => {
                    if (active) setError("The storage information cannot be read temporarily, please try again.");
                });
        }
        return () => {
            active = false;
        };
    }, [binding, hasNativeStorage]);

    const applyCanvasLimit = async (rawValue: string) => {
        const trimmed = rawValue.trim();
        const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
        if (!Number.isInteger(parsed) || parsed < 0) {
            const msg = "Please enter an integer greater than or equal to 0 (fill in 0 to indicate no limit)";
            setCanvasLimitError(msg);
            message.error(msg);
            return;
        }
        setSavingCanvasLimit(true);
        setCanvasLimitError("");
        try {
            const next = await updateCanvasDocumentLimitMB(parsed);
            setSavedCanvasLimit(next);
            setCanvasLimitInput(String(next));
            message.success(next === 0 ? "Set to unlimited single canvas capacity" : `The maximum capacity of a single canvas has been set to${next} MB`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setCanvasLimitError(msg);
            message.error(msg);
        } finally {
            setSavingCanvasLimit(false);
        }
    };

    const choose = async () => {
        try {
            const path = await binding?.ChooseStorageDirectory?.();
            if (path) setTarget(path);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        }
    };
    const migrate = async () => {
        if (!binding?.MigrateStorage) return;
        setBusy(true);
        setError("");
        let phase = "save_workspace";
        const progress = startOperation("Migrate storage directory", { detail: "Saving workspace" });
        const sample = createTransferSampler();
        let stopped = false;
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
            try {
                const state = await binding.StorageMigrationStatus?.();
                if (!stopped && state?.phase) progress.update({ ...sample(state.loadedBytes, state.totalBytes), ...state });
            } catch { /* Migration closes the workspace API; Wails polling resumes on the next tick. */ }
            if (!stopped) pollTimer = setTimeout(poll, 500);
        };
        recordDiagnosticEvent({ level: "info", category: "action", code: "storage_migration_started", message: "Start preparing for storage migration" });
        try {
            await Promise.all([flushModelConfig(), saveRemoteUserDataNow()]);
            const state = getModelConfigPersistenceState();
            if (state.dirty || state.status === "error") throw new Error("The model configuration has not been saved. Please resolve the saving error before migrating.");
            phase = "migrate_workspace";
            void poll();
            await binding.MigrateStorage(target.trim());
            progress.done("Migration completed, reloading");
            window.location.reload();
        } catch (error) {
            progress.fail("Migration not completed, please see error details below");
            const details = error instanceof Error ? error.message : String(error);
            recordDiagnosticEvent({ level: "error", category: "action", code: "storage_migration_failed", reason: phase, message: details });
            setError(details);
            setBusy(false);
        } finally {
            stopped = true;
            if (pollTimer) clearTimeout(pollTimer);
        }
    };
    const cleanup = () =>
        modal.confirm({
            title: "Clear original directory",
            centered: true,
            okText: "Confirm and clean",
            cancelText: "Cancel",
            content: (
                <p className="break-words">
                                        Please first confirm that the current project, material and model configuration can be used normally. clean up{usage?.previousDir}  Releaseable approx.{size(usage?.previousBytes || 0)};Cannot restore from this directory after cleaning.
                </p>
            ),
            onOk: async () => {
                if (!binding?.CleanupPreviousStorage) return;
                setBusy(true);
                setError("");
                try {
                    setUsage(await binding.CleanupPreviousStorage());
                    setCleanupInterrupted(false);
                    message.success("The original directory has been cleared");
                } catch (error) {
                    setCleanupInterrupted(true);
                    setError(error instanceof Error ? error.message : String(error));
                    // Cleanup may have removed durable copies while leaving busy scratch.
                    try {
                        if (binding.StorageSettings) setUsage(await binding.StorageSettings());
                    } catch {
                        /* Keep the last known usage. */
                    }
                } finally {
                    setBusy(false);
                }
            },
        });
    return (
        <>
            <section className="settings-section storage-settings-block space-y-4" aria-label="Generate result saving settings">
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>Generate results and save</h2>
                    </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                        <div className="text-sm font-medium">Automatically download to local after generation is completed</div>
                        <p className="text-sm leading-6 text-foreground/60">
                                                        After the tasks of producing pictures, videos, and audios are completed, the result files will be automatically saved to the browser's default download directory.
                        </p>
                    </div>
                    <Switch
                        checked={autoDownloadGeneratedMedia}
                        aria-label="Automatically download to local after generation is completed"
                        onChange={(checked) => {
                            setAutoDownloadGeneratedMedia(checked);
                            setAutoDownloadGeneratedMediaState(checked);
                            message.success(checked ? "Automatic download after generation is turned on" : "Automatic download after generation is turned off");
                        }}
                    />
                </div>
            </section>
            <section className="settings-section storage-settings-block space-y-4" aria-label="Canvas capacity settings">
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>Canvas capacity settings</h2>
                    </div>
                </div>
                <p className="text-sm leading-6 text-foreground/60">
                                        Current effective upper limit:{savedCanvasLimit === 0 ? "no limit" : `${savedCanvasLimit} MB`}(Default{DEFAULT_CANVAS_DOCUMENT_LIMIT_MB}  MB, fill in 0 to indicate no limit). Asset projects with multiple episodes of long dramas or large pictures can be freely resized as needed without deleting to make room.
                </p>
                <label className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="shrink-0 text-sm">Maximum capacity of a single canvas (MB):</span>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                        <Input
                            className="min-w-0 flex-1"
                            aria-label="Maximum capacity of a single canvas (MB)"
                            inputMode="numeric"
                            value={canvasLimitInput}
                            onChange={(event) => setCanvasLimitInput(event.target.value)}
                            placeholder={`${DEFAULT_CANVAS_DOCUMENT_LIMIT_MB}(Fill in 0 to indicate no restrictions)`}
                            disabled={savingCanvasLimit}
                        />
                        <Button type="primary" loading={savingCanvasLimit} onClick={() => void applyCanvasLimit(canvasLimitInput)}>
                                                        Save capacity settings
                        </Button>
                        <Button disabled={savingCanvasLimit} onClick={() => void applyCanvasLimit("0")}>
                                                        no limit
                        </Button>
                    </div>
                </label>
                {canvasLimitError ? (
                    <p role="alert" className="text-sm text-destructive break-words">
                        {canvasLimitError}
                    </p>
                ) : null}
            </section>
            {hasNativeStorage ? (
                <section className="settings-section storage-settings-block space-y-4" aria-label="local storage">
                    <div className="settings-pane-header">
                        <div className="min-w-0">
                            <h2>local storage</h2>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                        <div className="min-w-0 break-all">Current directory:{usage?.dataDir || "Reading…"}</div>
                        {usage ? (
                            <p className="shrink-0 text-foreground/60">
                                                                Data usage{size(usage.usedBytes)}  · Disk remaining{size(usage.freeBytes)}
                            </p>
                        ) : null}
                    </div>
                    <label className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="shrink-0 text-sm">New storage directory:</span>
                        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                            <Input className="min-w-0 flex-1" aria-label="New storage directory" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="For example D:\\BeefTV" disabled={busy} />
                            <Button icon={<FolderOpen className="size-4" />} onClick={choose} disabled={busy}>
                                Select folder
                            </Button>
                        </div>
                    </label>
                    <p className="text-sm leading-6 text-foreground/60">Please select an empty folder. Please pause during the migration; it will reload when complete. The original directory will be retained. Please confirm that the projects and materials are complete before cleaning.</p>
                    {error ? (
                        <div role="alert" className="text-sm text-destructive break-words">
                            <p>{errorSummary}</p>
                            {errorDetails.length > 0 ? (
                                <details className="mt-2">
                                    <summary className="cursor-pointer">Error details</summary>
                                    <p className="mt-2 break-all whitespace-pre-wrap">{errorDetails.join("\n\n")}</p>
                                </details>
                            ) : null}
                        </div>
                    ) : null}
                    <Button type="primary" onClick={migrate} loading={busy} disabled={!usage || !target.trim() || target.trim() === usage.dataDir}>
                        {busy ? "Migrating and verifying files..." : "Migrate old data and use new directory"}
                    </Button>
                    {usage?.previousDir && binding?.CleanupPreviousStorage ? (
                        <div className="space-y-2 border-t border-border pt-4">
                            <p className="text-sm break-all">Original directory to be cleaned:{usage.previousDir}。</p>
                            {cleanupInterrupted ? <p className="text-sm">The cleanup is not complete and the original directory may have been partially cleaned up. Please keep the current storage directory.</p> : null}
                            <Button danger disabled={busy} onClick={cleanup}>
                                                                Clean up the original directory and free up disk space
                            </Button>
                        </div>
                    ) : null}
                </section>
            ) : null}
        </>
    );
}
