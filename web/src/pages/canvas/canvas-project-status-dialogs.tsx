import { Button, Modal } from "antd";
import { XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { TaskDetailItem } from "./canvas-project-feedback";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import { canRecoverTaskOutcome, readTaskOutcome } from "@/lib/task-outcome";
import { formatTaskLog, type GenerationTask, type TaskLog } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { VideoPlayer } from "@/components/video-player";
import { AppModal } from "@/components/ui/product/app-modal";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { buildLibTVVideoSourceUrl } from "@/lib/canvas/libtv-import";

type CanvasProjectStatusDialogsProps = {
    theme: { node: { stroke: string; panel: string; muted: string; fill: string } };
    task: GenerationTask | null;
    taskLogs: TaskLog[];
    taskLoading: boolean;
    taskError?: boolean;
    onCloseTask: () => void;
    onCancelTask?: (task: GenerationTask) => void;
    onRetrieveTask?: (task: GenerationTask) => void;
    retrievingTaskId?: string | null;
    previewNode: CanvasNodeData | null;
    onClosePreview: () => void;
    clearConfirmOpen: boolean;
    onCancelClear: () => void;
    onConfirmClear: () => void;
};

export function CanvasProjectStatusDialogs({ theme, task, taskLogs, taskLoading, taskError, previewNode, clearConfirmOpen, onCloseTask, onCancelTask, onRetrieveTask, retrievingTaskId, onClosePreview, onCancelClear, onConfirmClear }: CanvasProjectStatusDialogsProps) {
    const config = useEffectiveConfig();
    const previewSource = useResolvedPreviewSource(previewNode);
    return (
        <>
            <Modal title="Mission details" open={Boolean(task)} footer={null} width="min(920px, calc(100vw - 32px))" onCancel={onCloseTask}>
                {task ? (
                    <div className="space-y-4 text-sm">
                        {taskError ? <p role="status">The task details cannot be refreshed at the moment, trying again.</p> : null}
                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <TaskDetailItem label="current stage" value={generationTaskStageLabel(task)} />
                            {generationTaskShowsProgress(task) ? <TaskDetailItem label="Progress" value={`${task.progress ?? 0}%`} /> : null}
                            <TaskDetailItem label="model" value={task.model ? modelDisplayName(config, task.model) : "Default model"} />
                            <TaskDetailItem label="Task ID" value={task.id} />
                            <TaskDetailItem label="creation time" value={formatTaskTime(task.createdAt)} />
                            <TaskDetailItem label="start time" value={formatTaskTime(task.startedAt)} />
                            <TaskDetailItem label="completion time" value={formatTaskTime(task.completedAt)} />
                            <TaskDetailItem label="Time consuming" value={formatTaskDuration(task)} />
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                                                prompt word</div>
                            <div className="h-32 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5" style={{ background: theme.node.fill }}>
                                {task.prompt || "Not recorded"}
                            </div>
                        </div>
                        <TaskGenerationParameters inputJson={task.inputJson} theme={theme} />
                        {task.error ? <p role="status" className="whitespace-pre-wrap break-words">{task.error}</p> : null}
                        {onRetrieveTask && canRecoverTaskOutcome(readTaskOutcome(task)) ? (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p>Query the original task and retrieve the generated results without regenerating it.</p>
                                <Button loading={retrievingTaskId === task.id} onClick={() => onRetrieveTask(task)}>Retrieve results</Button>
                            </div>
                        ) : null}
                        {onCancelTask && (task.status === "queued" || task.status === "running") ? (
                            <div className="flex justify-end">
                                <Button danger icon={<XCircle className="size-4" />} onClick={() => onCancelTask(task)}>
                                                                        Cancel task
                                </Button>
                            </div>
                        ) : null}
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                                                Mission log
                            </div>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-950 p-3 text-[var(--fs-label)] leading-5 text-neutral-100">
                                {taskLoading ? "Loading..." : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString()}] ${log.level.toUpperCase()} ${formatTaskLog(log)}`).join("\n") : "No logs yet"}
                            </pre>
                        </div>
                    </div>
                ) : null}
            </Modal>


            <AppModal
                title="Video preview"
                open={Boolean(previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video)}
                centered
                onCancel={onClosePreview}
                footer={null}
                width="min(1200px, calc(100vw - 32px))"
                flush
                styles={{ body: { display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "84vh", overflow: "hidden", background: "var(--workspace-canvas-deep)" } }}
            >
                {previewSource && previewNode?.type === CanvasNodeType.Video ? (
                    <VideoPlayer src={previewSource} mimeType={previewNode.metadata?.mimeType} title={previewNode.title || "Video preview"} hasAudio={typeof previewNode.metadata?.hasAudio === "boolean" ? previewNode.metadata.hasAudio : undefined} className="max-h-[84vh] max-w-full bg-black" />
                ) : null}
            </AppModal>

            {previewSource && previewNode?.type === CanvasNodeType.Image ? (
                <CanvasImagePreview
                    src={previewSource}
                    alt={previewNode.title || "pictures"}
                    onClose={onClosePreview}
                />
            ) : null}

            <Modal
                title="Clear canvas?"
                open={clearConfirmOpen}
                centered
                onCancel={onCancelClear}
                footer={
                    <>
                        <Button onClick={onCancelClear}>Cancel</Button>
                        <Button danger type="primary" onClick={onConfirmClear}>
                                                        Clear
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">This will delete all nodes and connections on the current canvas.</p>
            </Modal>
        </>
    );
}

function useResolvedPreviewSource(node: CanvasNodeData | null) {
    const [source, setSource] = useState("");
    useEffect(() => {
        let cancelled = false;
        if (!node || (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video)) {
            setSource("");
            return;
        }
        const content = node.metadata?.content || "";
        const fallback = node.type === CanvasNodeType.Image
            ? node.metadata?.previewContent || content
            : node.metadata?.importSource?.provider === "libtv" ? buildLibTVVideoSourceUrl(content) : content;
        if (!node.metadata?.storageKey) {
            setSource(fallback);
            return;
        }
        setSource("");
        const resolve = node.type === CanvasNodeType.Image ? resolveImageUrl : resolveMediaUrl;
        void resolve(node.metadata.storageKey, fallback, { cacheMiss: true })
            .then((resolved) => { if (!cancelled) setSource(resolved || fallback); })
            .catch(() => { if (!cancelled) setSource(fallback); });
        return () => { cancelled = true; };
    }, [node]);
    return source;
}

function TaskGenerationParameters({ inputJson, theme }: { inputJson?: string; theme: CanvasProjectStatusDialogsProps["theme"] }) {
    const fields = taskParameterRows(inputJson);
    return (
        <div>
            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>Generate parameters</div>
            {fields.length ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-1 rounded-lg border p-3 sm:grid-cols-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    {fields.map((field) => <TaskDetailItem key={field.label} label={field.label} value={field.value} />)}
                </div>
            ) : (
                <div className="rounded-lg p-3 text-xs" style={{ background: theme.node.fill, color: theme.node.muted }}>No parameter record yet</div>
            )}
        </div>
    );
}

function taskParameterRows(inputJson?: string) {
    if (!inputJson) return [] as Array<{ label: string; value: string }>;
    let input: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(inputJson);
        input = asRecord(parsed);
    } catch {
        return [] as Array<{ label: string; value: string }>;
    }
    const config = asRecord(input.config);
    const rows: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => {
        if (value === undefined || value === null || value === "") return;
        rows.push({ label, value: String(value) });
    };
    add("size/proportion", config.size);
    add("resolution", config.vquality || config.quality);
    add("seconds", config.videoSeconds === undefined ? undefined : `${config.videoSeconds} seconds`);
    add("Generate quantity", config.count);
    add("generate sound", booleanLabel(config.videoGenerateAudio));
    add("watermark", booleanLabel(config.videoWatermark));
    add("timbre", config.audioVoice);
    add("audio format", config.audioFormat);
    add("audio speed", config.audioSpeed);
    addReference("Quote pictures", input.referenceImages, "pictures");
    addReference("Quote video", input.referenceVideos, "video");
    addReference("Quote audio", input.referenceAudios, "Audio");
    return rows;

    function addReference(label: string, value: unknown, kind: string) {
        if (!Array.isArray(value) || !value.length) return;
        const names = value
            .map((item) => (typeof item === "object" && item !== null && "name" in item ? String((item as { name?: unknown }).name || "") : ""))
            .filter(Boolean);
        const suffix = names.length ? `（${names.slice(0, 3).join("、")}${names.length > 3 ? "…" : ""}）` : "";
        rows.push({ label, value: `${value.length} a${kind}${suffix}` });
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanLabel(value: unknown) {
    if (value === true || value === "true") return "turn on";
    if (value === false || value === "false") return "Close";
    return "";
}

function formatTaskTime(value?: string) {
    if (!value) return "Not recorded";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function formatTaskDuration(task: GenerationTask) {
    const start = Date.parse(task.startedAt || task.createdAt);
    const end = task.completedAt ? Date.parse(task.completedAt) : task.status === "queued" || task.status === "running" ? Date.now() : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return task.completedAt ? "Not recorded" : "Not completed";
    const milliseconds = Math.max(0, end - start);
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}points${seconds}sec` : `${seconds}sec`;
}
