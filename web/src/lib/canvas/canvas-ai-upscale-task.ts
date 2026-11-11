import { isRegenerateBlocked, isTaskOutcomeWorking } from "@/lib/task-outcome";
import { authoritativeNodeOutcome } from "@/lib/canvas/canvas-node-failure-state";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";

// A stopped observer says nothing about the paid task's execution state.
export const UPSCALE_OBSERVATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function isAIUpscaleTask(task: Pick<GenerationTask, "type" | "model">): boolean {
    return (task.type === "canvas_image" && ["topaz-standard-v2", "topaz-wonder-3.5"].includes(task.model || "")) ||
        (task.type === "canvas_video" && ["topaz-proteus", "topaz-starlight-fast-2"].includes(task.model || ""));
}

export function hasPendingUpscaleTask(metadata?: CanvasNodeMetadata): boolean {
    if (!metadata) return false;
    // 成功任务的结果已经落到节点上时，旧的「待取回」结论不再有效。
    if (metadata.taskStatus === "succeeded" && (metadata.content || metadata.storageKey)) return false;
    const explicitOutcome = authoritativeNodeOutcome(metadata);
    if (explicitOutcome) {
        if (explicitOutcome.phase === "ready") return !metadata.content && !metadata.storageKey;
        return isTaskOutcomeWorking(explicitOutcome) || isRegenerateBlocked(explicitOutcome) || Boolean(metadata.taskId);
    }
    // Only a failure before calling the task API proves that no paid task exists.
    if (metadata.generationSubmissionState === "rejected" && !metadata.taskId) return false;
    if (metadata.taskStatus === "succeeded") return !metadata.content && !metadata.storageKey;
    if (metadata.taskId || metadata.taskClientOperationId) return true;
    return metadata.generationSubmissionState === "unknown" || metadata.generationSubmissionState === "submitting";
}

export function upscaleObservationFailureMetadata(task: Pick<GenerationTask, "id" | "status" | "outcome">, errorDetails: string): Partial<CanvasNodeMetadata> {
    const terminal = task.status === "failed" || task.status === "cancelled" || task.status === "succeeded";
    return {
        taskId: task.id,
        taskOutcome: task.outcome ?? (task.status === "succeeded" ? { phase: "retrievable", regenerate: "blocked", reason: "delivery_pending" } : undefined),
        taskStatus: task.status,
        status: terminal ? "error" : "loading",
        ...(terminal ? {
            errorDetails: task.status === "succeeded" ? `The cloud has been completed and the results have not been loaded yet. Please retrieve the results from the task details or reopen the canvas to restore.${errorDetails}` : `Please check the original task and deduction status in the task details first, and do not submit again.${errorDetails}`,
        } : {
            processingLabel: "Super score mission status to be confirmed",
            taskStage: "Status synchronization interrupted, please reopen canvas query",
            errorDetails: "The progress cannot be synchronized at the moment, and the cloud task may still be processed. Please reopen the canvas query and do not submit again.",
        }),
    };
}

export function canRecoverUpscaleNode(node: CanvasNodeData): boolean {
    const metadata = node.metadata;
    if (!metadata?.workflowOperation?.id.endsWith(".ai-upscale") || !metadata.taskId) return false;
    const explicitOutcome = authoritativeNodeOutcome(metadata);
    if (explicitOutcome) {
        return explicitOutcome.phase === "retrievable" || explicitOutcome.phase === "failed" || (explicitOutcome.phase === "ready" && !metadata.content && !metadata.storageKey);
    }
    return metadata.status === "error" || metadata.taskStatus === "failed" || (metadata.taskStatus === "succeeded" && !metadata.content && !metadata.storageKey);
}
