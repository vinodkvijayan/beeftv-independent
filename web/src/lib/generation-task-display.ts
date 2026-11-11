import { normalizeTaskOutcome, taskOutcomeCopy } from "@/lib/task-outcome";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";

export const statusLabel: Record<TaskStatus, string> = {
    queued: "Queuing",
    running: "Generating",
    succeeded: "Completed",
    failed: "failed",
    cancelled: "Canceled",
};

type GenerationTaskDisplayTarget = Pick<GenerationTask, "status" | "stage"> & { outcome?: GenerationTask["outcome"] };

export function isGenerationTaskSubmissionUncertain(task: GenerationTaskDisplayTarget) {
    const outcome = normalizeTaskOutcome(task.outcome);
    if (outcome) {
        return outcome.phase === "retrievable" && outcome.reason !== "delivery_pending";
    }
    return task.stage === "submission_unknown";
}

export function generationTaskStatusLabel(task: GenerationTaskDisplayTarget) {
    const outcome = normalizeTaskOutcome(task.outcome);
    if (outcome) {
        return taskOutcomeCopy(outcome).badge;
    }
    if (isGenerationTaskSubmissionUncertain(task)) return "Submit results to be confirmed";
    if (task.stage === "delivery_paused" || task.stage === "delivery_timed_out") return "Result to be retrieved";
    return statusLabel[task.status];
}

export function generationTaskStageLabel(task: GenerationTaskDisplayTarget) {
    const outcome = normalizeTaskOutcome(task.outcome);
    if (outcome && (outcome.phase === "retrievable" || outcome.reason === "settlement_pending")) {
        return taskOutcomeCopy(outcome).reason;
    }
    if (isGenerationTaskSubmissionUncertain(task)) return "To avoid repeated creation of upstream tasks, automatic retries are not performed.";
    if (task.stage === "delivery_paused") return "Retrieval of results has been suspended";
    if (task.stage === "delivery_timed_out") return "The download times out, you can continue to retrieve the original results";
    if (task.stage === "generating") return "Generating";
    if (task.stage === "queued") return "Queuing";
    return task.stage || generationTaskStatusLabel(task);
}

export function generationTaskShowsProgress(task: GenerationTaskDisplayTarget) {
    const outcome = normalizeTaskOutcome(task.outcome);
    if (outcome && outcome.phase !== "running" && outcome.phase !== "fetching") return false;
    if (isGenerationTaskSubmissionUncertain(task) || task.stage === "delivery_paused" || task.stage === "delivery_timed_out") return false;
    // 排队、后端接管和连接供应商都没有真实百分比。只有上游状态响应
    // 已经写回任务后才显示进度，避免所有图片/视频长期停在同一个假数值。
    if (["Waiting for queue scheduling", "Backend takes over tasks", "Connecting to upstream", "Call the generated model"].includes(task.stage || "")) return false;
    return true;
}

/** 上游百分比多久没动，就不再把它画成一根停住的进度条。 */
export const GENERATION_PROGRESS_STALL_MS = 60_000;

export const GENERATION_VIDEO_EXPECTATION = "Videos usually take a few minutes, so you can do something else first.";

export type GenerationProgressRecord = { progress: number; changedAt: number };

/**
 * 记录上游百分比最后一次变化的时间（只在客户端记，不改任务数据）。
 * 百分比没变就原样返回旧记录，变了或第一次看到就以 now 作为变化时间。
 */
export function trackGenerationProgressChange(previous: GenerationProgressRecord | undefined, progress: number, now: number): GenerationProgressRecord {
    if (previous && previous.progress === progress) return previous;
    return { progress, changedAt: now };
}

export type GenerationProgressDisplay = {
    /** none：不画进度条；determinate：按真实百分比画；indeterminate：百分比久未变化，改为循环扫描。 */
    bar: "none" | "determinate" | "indeterminate";
    /** 只在 determinate 时给出，永远是上游返回的真实值。 */
    percent: number | null;
    /** 视频任务进行中给出的一句预期说明。 */
    expectation: string | null;
};

export function generationProgressDisplay(input: {
    status: GenerationTask["status"];
    progress: number | null;
    progressChangedAt?: number;
    now: number;
    isVideo: boolean;
}): GenerationProgressDisplay {
    const active = input.status === "queued" || input.status === "running";
    const expectation = active && input.isVideo ? GENERATION_VIDEO_EXPECTATION : null;
    if (input.progress === null) return { bar: "none", percent: null, expectation };
    const stalled = input.status === "running"
        && input.progressChangedAt !== undefined
        && input.now - input.progressChangedAt >= GENERATION_PROGRESS_STALL_MS;
    if (stalled) return { bar: "indeterminate", percent: null, expectation };
    return { bar: "determinate", percent: input.progress, expectation };
}

/** 已用时间，例如「3分12秒」「1时05分」。 */
export function formatGenerationElapsed(elapsedMs: number) {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (seconds < 60) return `${seconds}sec`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}points${seconds % 60}sec` : `${Math.floor(minutes / 60)}time${minutes % 60}points`;
}

export const operationOptions = [
    { label: "Vincent Video", value: "text_to_video" },
    { label: "tusheng video", value: "image_to_video" },
    { label: "Full modal reference", value: "reference_to_video" },
    { label: "Video continuation", value: "extend" },
    { label: "Partial modification of video", value: "inpaint" },
    { label: "element replacement", value: "replace_element" },
    { label: "Lens/scope adjustment", value: "camera_motion" },
    { label: "style transfer", value: "style_transfer" },
    { label: "Generate video from reference audio", value: "audio_to_video" },
    { label: "Result version comparison", value: "compare_versions" },
];

export const operationLabelByValue = new Map(operationOptions.map((item) => [item.value, item.label]));

export const taskTypeLabel: Record<string, string> = {
    canvas_image: "canvas drawing",
    canvas_video: "canvas video",
    canvas_audio: "canvas audio",
    canvas_text: "canvas text",
};

export function formatTaskKind(task: GenerationTask) {
    const typeLabel = taskTypeLabel[task.type];
    const operationLabel = task.operation ? operationLabelByValue.get(task.operation) : "";

    if (task.type === "canvas_video" && operationLabel) return `${typeLabel || "canvas video"} · ${operationLabel}`;
    if (typeLabel) return typeLabel;
    if (operationLabel) return operationLabel;
    if (task.type.startsWith("video_")) return "video tasks";
    return "Generate tasks";
}
