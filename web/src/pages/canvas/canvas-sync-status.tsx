import { App, Button, Dropdown, Popover } from "antd";
import { CheckCircle2, CircleAlert, CloudCheck, CloudOff, LoaderCircle, RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { exportCanvasProjects, exportCanvasProjectsByIds } from "@/lib/canvas/canvas-export";
import { resolveWorkspaceExportCanvasIds } from "@/lib/canvas/canvas-workspace-project";
import { ApiError } from "@/services/api/request";
import { readAllCanvasSyncDrafts, readCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { fetchExternalCanvasWrites, subscribeExternalCanvasEvent, undoExternalCanvasWrite, type ExternalCanvasWrite } from "@/services/canvas-external-writes";
import { getActiveUserScope } from "@/lib/user-scope";
import { acceptExternalCanvasRevision, pendingExternalCanvasRevision, refreshLocalCanvasProjectIfChanged, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { loadCanvasProjectForEditing } from "@/services/local-workspace-sync";
import { highlightAssistantNodes } from "./canvas-assistant-highlight";
import { canvasExternalRevisionVersion, subscribeCanvasExternalRevision, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { canvasSyncProgressKey, useSyncProgressStore, type SyncProjectProgress } from "@/stores/use-sync-progress-store";
import { workspaceCapabilities } from "@/services/workspace-mode";

export type CanvasSyncStatusView = {
    label: string;
    detail: string;
    note?: string;
    tone: "saved" | "saving" | "failed";
    action?: "use-latest" | "retry-save" | "load-cloud";
};

/** 顶栏保存状态的文案与可用操作：只说这份画布现在是否已保存、接下来能做什么。 */
export function canvasSyncStatusView(localOnly: boolean, progress: Pick<SyncProjectProgress, "phase" | "message"> | undefined): CanvasSyncStatusView {
    const phase = progress?.phase;
    const saving = phase === "pending" || phase === "saving" || phase === "uploading";
    if (localOnly) {
        if (phase === "conflict") {
            return {
                label: "Version conflict · not saved",
                tone: "failed",
                detail: "The canvas has been updated elsewhere and this change has not been saved.",
                note: "Autosave is paused. Before using the latest version, a local draft will be saved.",
                action: "use-latest",
            };
        }
        if (phase === "error") return { label: "Save failed", tone: "failed", detail: "The save is not completed and the modifications are still retained on this machine.", action: "retry-save" };
        if (saving) return { label: "Saving", tone: "saving", detail: "Saving to local machine." };
        return { label: "Saved locally", tone: "saved", detail: "The canvas is saved locally." };
    }
    const conflict = phase === "conflict";
    const failed = phase === "error" || conflict || !phase;
    return {
        label: conflict ? "Version conflict · Not synchronized" : !phase ? "Not synced yet" : failed ? "Not saved in cloud" : saving ? "Saving" : "saved",
        tone: saving ? "saving" : failed ? "failed" : "saved",
        detail: progress?.message || (phase === "done" ? "Canvas has been synced to the cloud" : "Cloud saving has not been confirmed yet, please keep local content"),
        note: conflict ? "Autocommit for this canvas is paused. The local draft will be retained before loading the latest version, which can be imported as a copy from the canvas list after downloading." : undefined,
        action: "load-cloud",
    };
}

function syncStatusIcon(localOnly: boolean, tone: CanvasSyncStatusView["tone"]) {
    if (tone === "saving") return <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />;
    if (localOnly) return tone === "failed" ? <CircleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5 text-emerald-500" />;
    return tone === "failed" ? <CloudOff className="size-3.5" /> : <CloudCheck className="size-3.5" />;
}

export function CanvasSyncStatus({ projectId, onLoadLatest, onOpenVersions }: { projectId: string; onLoadLatest: () => Promise<void>; onOpenVersions?: () => void }) {
    const { message } = App.useApp();
    const progress = useSyncProgressStore((state) => state.syncingProjects[canvasSyncProgressKey(projectId)]);
    const localOnly = workspaceCapabilities().local;
    const [busy, setBusy] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    // 外部改动被本地编辑挡住时必须在顶栏一直看得见：它以前藏在侧边面板里，
    // 面板关着的时候用户根本不知道画布已经在别处变了。
    const externalRevision = useSyncExternalStore(subscribeCanvasExternalRevision, canvasExternalRevisionVersion);
    const externalConflict = pendingExternalCanvasRevision(projectId);
    const [adopting, setAdopting] = useState(false);
    const [externalWrites, setExternalWrites] = useState<ExternalCanvasWrite[]>([]);
    const [externalWriteOpen, setExternalWriteOpen] = useState(false);
    const [undoingOpId, setUndoingOpId] = useState<string | null>(null);
    const highlightedOpIdsRef = useRef<Set<string>>(new Set());
    const lastProjectIdRef = useRef<string>(projectId);

    useEffect(() => {
        if (lastProjectIdRef.current !== projectId) {
            lastProjectIdRef.current = projectId;
            setExternalWrites([]);
            setExternalWriteOpen(false);
        }
        if (!localOnly || !projectId) {
            setExternalWrites([]);
            return;
        }
        let cancelled = false;
        const loadWrites = () => {
            void fetchExternalCanvasWrites(projectId)
                .then((items) => {
                    if (cancelled) return;
                    setExternalWrites(items);
                    const latest = items.find((item) => !item.undone);
                    if (latest && !highlightedOpIdsRef.current.has(latest.opId)) {
                        highlightedOpIdsRef.current.add(latest.opId);
                        if (latest.changedNodeIds?.length && typeof document !== "undefined") {
                            highlightAssistantNodes(document.body, latest.changedNodeIds);
                        }
                    }
                })
                .catch(() => {});
        };
        loadWrites();
        const unsubscribe = subscribeExternalCanvasEvent((changedCanvasId) => {
            if (changedCanvasId === projectId) loadWrites();
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [localOnly, projectId, externalRevision]);

    const latestExternalWrite = externalWrites.find((item) => !item.undone);
    const handleUndoExternalWrite = async (write: ExternalCanvasWrite) => {
        setUndoingOpId(write.opId);
        let restoredNodeIds: string[] = write.changedNodeIds ?? [];
        try {
            try {
                const result = await undoExternalCanvasWrite(projectId, write.opId);
                if (result.restoredNodeIds?.length) {
                    restoredNodeIds = result.restoredNodeIds;
                }
            } catch (error) {
                if (!(error instanceof ApiError && error.reason === "already_undone")) {
                    throw error;
                }
            }
            setExternalWrites((current) =>
                current.map((item) => (item.opId === write.opId ? { ...item, undone: true } : item)),
            );
            setExternalWriteOpen(false);
            message.success(`Revoked${write.clientLabel} changes`);
            if (write.op === "canvas.create") {
                useCanvasStore.getState().deleteProjects([projectId]);
                if (typeof window !== "undefined") {
                    window.location.assign("/canvas");
                }
                return;
            }
            void refreshLocalCanvasProjectIfChanged(projectId)
                .then(() => {
                    if (restoredNodeIds.length && typeof document !== "undefined") {
                        highlightAssistantNodes(document.body, restoredNodeIds);
                    }
                })
                .catch(() => {});
            void fetchExternalCanvasWrites(projectId)
                .then((refreshed) => setExternalWrites(refreshed))
                .catch(() => {});
        } catch (error) {
            message.error(error instanceof Error && error.message ? error.message : "Failed to undo external changes, please try again");
        } finally {
            setUndoingOpId(null);
        }
    };
    const view = canvasSyncStatusView(localOnly, progress);
    const label = view.label;
    // 替换前会先把当前内容存成本地草稿；草稿没存成时不替换，并把原因告诉用户。
    const adoptLatest = async () => {
        setAdopting(true);
        try {
            await acceptExternalCanvasRevision(projectId);
        } catch (error) {
            message.error(error instanceof Error && error.message ? error.message : "Failed to load the latest version, please try again");
        } finally {
            setAdopting(false);
        }
    };
    const run = async (operation: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await operation();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Operation failed, please try again");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {externalConflict ? (
                <Button
                    size="small"
                    type="text"
                    data-canvas-external-revision={externalRevision}
                    className="canvas-sync-external-notice"
                    loading={adopting}
                    aria-label="Canvas has been updated elsewhere to use the latest version"
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={() => void adoptLatest()}
                >
                    <span className="canvas-sync-status-label text-xs">Canvas has been updated elsewhere · Use the latest version</span>
                </Button>
            ) : null}
            {latestExternalWrite ? (
                <Popover
                    trigger="click"
                    placement="bottom"
                    open={externalWriteOpen}
                    onOpenChange={setExternalWriteOpen}
                    content={
                        <div className="max-w-80 space-y-2.5" data-canvas-no-zoom>
                            <div className="space-y-1">
                                <p className="text-xs font-medium">
                                                                        Sources of external changes:{latestExternalWrite.clientLabel}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {latestExternalWrite.summary}（v{latestExternalWrite.revisionBefore} → v{latestExternalWrite.revisionAfter}）
                                </p>
                                {latestExternalWrite.modifiedNodes?.length ? (
                                    <p className="text-xs text-muted-foreground">
                                                                                Involved nodes:{latestExternalWrite.modifiedNodes.map((node) => node.title || node.id).join("、")}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {latestExternalWrite.changedNodeIds?.length ? (
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            if (typeof document !== "undefined") {
                                                highlightAssistantNodes(document.body, latestExternalWrite.changedNodeIds);
                                            }
                                        }}
                                    >
                                                                                Locate change nodes
                                    </Button>
                                ) : null}
                                <Button
                                    size="small"
                                    danger
                                    icon={<Undo2 className="size-3.5" />}
                                    loading={undoingOpId === latestExternalWrite.opId}
                                    onClick={() => void handleUndoExternalWrite(latestExternalWrite)}
                                >
                                                                        Undo this change
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <Button
                        size="small"
                        type="text"
                        data-canvas-external-write-op={latestExternalWrite.opId}
                        aria-label={`External changes:${latestExternalWrite.clientLabel} ${latestExternalWrite.summary}`}
                        icon={<Undo2 className="size-3.5" />}
                    >
                        <span className="canvas-sync-status-label text-xs">
                                                        External changes ·{latestExternalWrite.clientLabel}：{latestExternalWrite.summary}
                        </span>
                    </Button>
                </Popover>
            ) : null}
            <Popover
                trigger="click"
                placement="bottom"
                open={statusOpen}
                onOpenChange={setStatusOpen}
                content={
                    <div className="max-w-80 space-y-3" data-canvas-no-zoom>
                        <p role="status" className="text-sm">{view.detail}</p>
                        {view.note ? <p className="text-xs text-muted-foreground">{view.note}</p> : null}
                        <div className="flex flex-wrap gap-2">
                            {view.action === "use-latest" ? <Button size="small" type="primary" loading={adopting} disabled={busy} onClick={() => void adoptLatest()}>Use the latest version</Button> : null}
                            {view.action === "retry-save" ? <Button size="small" type="primary" loading={busy} onClick={() => void run(() => syncLocalCanvasProjectToBackend(projectId))}>Retry saving</Button> : null}
                            {view.action === "load-cloud" ? <Button size="small" loading={busy} onClick={() => void run(onLoadLatest)}>Load the latest version from the cloud</Button> : null}
                            <Button
                                size="small"
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        const store = useCanvasStore.getState();
                                        const project = store.openProject(projectId);
                                        if (project) {
                                            let skippedCount = 0;
                                            const result = await exportCanvasProjects([project], `${project.title}- local draft`, {
                                                folders: store.folders,
                                                allowMissingMedia: true,
                                                onSkippedFiles: (missing) => { skippedCount = missing.length; },
                                            });
                                            if (result === "cancelled") return;
                                            if (skippedCount > 0) message.warning(`Backup has been exported and automatically skipped${skippedCount} missing or unreadable assets`);
                                        }
                                    })
                                }
                            >
                                                                Download current content
                            </Button>
                            <Button
                                size="small"
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        const store = useCanvasStore.getState();
                                        const ids = resolveWorkspaceExportCanvasIds(store.projects, [projectId]);
                                        await exportCanvasProjectsByIds(
                                            ids,
                                            async (id) => (await loadCanvasProjectForEditing(id).catch(() => undefined)) || store.openProject(id),
                                            {
                                                folders: store.folders,
                                                allowMissingMedia: true,
                                                onSkipped: (count) => message.warning(`Backup has been exported and automatically skipped${count} missing or unreadable assets`),
                                            },
                                        );
                                    })
                                }
                            >
                                                                Export the entire project
                            </Button>
                            {onOpenVersions ? (
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setStatusOpen(false);
                                        onOpenVersions();
                                    }}
                                >
                                                                        version record{progress?.draftCount ? ` · ${progress.draftCount} draft` : ""}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                }
            >
                <Button
                    type="text"
                    size="small"
                    danger={view.tone === "failed"}
                    aria-label={`Canvas save status:${label}`}
                    icon={syncStatusIcon(localOnly, view.tone)}
                >
                    <span className="canvas-sync-status-label text-xs">{label}</span>
                </Button>
            </Popover>
        </>
    );
}

export function CanvasSyncDraftMenu({ projectId }: { projectId?: string }) {
    const { message } = App.useApp();
    const [drafts, setDrafts] = useState<CanvasSyncDraft[]>([]);
    const [draftScope, setDraftScope] = useState("");
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    return (
        <Dropdown
            trigger={["click"]}
            onOpenChange={(open) => {
                if (!open) return;
                const scope = getActiveUserScope();
                setDraftScope(scope);
                setDrafts([]);
                setLoading(true);
                void (projectId ? readCanvasSyncDrafts(projectId, scope) : readAllCanvasSyncDrafts(scope))
                    .then((items) => {
                        if (getActiveUserScope() === scope) setDrafts(items.reverse());
                    })
                    .catch(() => message.error("Failed to read local draft"))
                    .finally(() => setLoading(false));
            }}
            menu={{
                items: drafts.length
                    ? drafts.map((draft) => ({
                          key: draft.id,
                          label: `${draft.project.title} · ${new Date(draft.savedAt).toLocaleString()}`,
                          onClick: () => {
                              if (getActiveUserScope() !== draftScope) {
                                  setDrafts([]);
                                  message.error("The account has been switched, please reopen the local draft");
                                  return;
                              }
                              setExporting(true);
                              let skippedCount = 0;
                              void exportCanvasProjects([draft.project], `${draft.project.title}- local draft`, {
                                  includeLocalDrawings: false,
                                  folders: useCanvasStore.getState().folders,
                                  allowMissingMedia: true,
                                  onSkippedFiles: (missing) => { skippedCount = missing.length; },
                              })
                                  .then((result) => {
                                      if (result === "saved") {
                                          if (skippedCount > 0) message.warning(`Draft has been exported and automatically skipped${skippedCount} missing or unreadable assets`);
                                          else message.success("The draft is downloaded and can be imported as a new canvas from the canvas list");
                                      }
                                  })
                                  .catch(() => message.error("Draft download failed, please try again"))
                                  .finally(() => setExporting(false));
                          },
                      }))
                    : [{ key: "empty", label: loading ? "Reading draft…" : "No local draft yet", disabled: true }],
            }}
        >
            <Button size={projectId ? "small" : "middle"} loading={exporting}>
                                local draft
            </Button>
        </Dropdown>
    );
}
