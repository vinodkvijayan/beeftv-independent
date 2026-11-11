import { explainGenerationError } from "@/lib/generation-error";
import { normalizeTaskOutcome, taskOutcomeCopy } from "@/lib/task-outcome";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";

export function getTaskCanvasContext(task: GenerationTask, canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>) {
    if (!task.projectId) return { canvasName: "Unbound canvas", projectName: "" };
    const canvas = canvasById.get(task.projectId);
    if (canvas) return { canvasName: canvas.title || "Unnamed canvas", projectName: canvas.projectId ? projectNameById.get(canvas.projectId) || "" : "" };
    const projectName = projectNameById.get(task.projectId);
    return projectName ? { canvasName: "Project level tasks", projectName } : { canvasName: `Canvas not loaded or removed ·${task.projectId}`, projectName: "" };
}

export function isTaskFailed(task: GenerationTask) {
    const outcome = normalizeTaskOutcome(task.outcome);
    if (outcome) return outcome.phase === "failed";
    return task.status === "failed" || task.status === "cancelled";
}

export function taskAttentionReason(task: GenerationTask) {
    const outcome = normalizeTaskOutcome(task.outcome);
    if (outcome) {
        if (
            outcome.phase === "retrievable" ||
            outcome.reason === "settlement_pending" ||
            outcome.reason === "billing_pending" ||
            outcome.reason === "reconcile_pending" ||
            outcome.reason === "charged_result_unrecoverable" ||
            outcome.reason === "result_unrecoverable" ||
            outcome.reason === "no_result" ||
            (!task.error && !task.errorCode && task.status !== "cancelled")
        ) {
            return taskOutcomeCopy(outcome).message;
        }
    }
    if (!outcome && task.status === "cancelled") return providerCancelStatusLabel(task);
    const explanation = explainGenerationError(
        { code: task.errorCode, message: task.error },
        { taskId: task.id, providerRequestId: task.providerRequestId, model: task.model, createdAt: task.createdAt, stage: outcome ? undefined : task.stage },
    );
    const text = explanation.message.trim();
    if (text.startsWith("{") || text.startsWith("[")) return explanation.reason || "Generation failed, open details to view the reason";
    if (explanation.moderation) return explanation.message;
    if (task.error || task.errorCode) return explanation.message;
    if (outcome) return taskOutcomeCopy(outcome).message;
    return task.stage || "Generation failed, open details to view the reason";
}

export function providerCancelStatusLabel(task: GenerationTask) {
    if (task.providerCancelStatus === "requested") return "Cancellation requested from upstream, waiting for confirmation";
    if (task.providerCancelStatus === "confirmed") return "Cancellation confirmed by upstream";
    if (task.providerCancelStatus === "uncertain") {
        return task.providerCancelError || "The upstream cannot confirm the cancellation and the status needs to be confirmed.";
    }
    return "The task has been cancelled. You can resubmit according to the original input.";
}

export function statusDotClassName(status: TaskStatus) {
    if (status === "succeeded") return "task-record-dot is-success";
    if (status === "running") return "task-record-dot is-active is-pulsing";
    if (status === "queued") return "task-record-dot is-queued";
    if (status === "failed") return "task-record-dot is-failed";
    return "task-record-dot is-idle";
}

export function taskMediaKind(task: GenerationTask): "text" | "image" | "video" {
    const value = `${task.type} ${task.operation || ""}`.toLowerCase();
    if (value.includes("video") || value.includes("video")) return "video";
    if (value.includes("image") || value.includes("pictures") || value.includes("Picture")) return "image";
    return "text";
}

export function TaskDate({ value }: { value?: string }) {
    if (!value) return <span className="text-xs text-foreground/38">-</span>;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return <span className="text-xs text-foreground/38">-</span>;
    const compact = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    return (
        <time className="task-record-date-value" dateTime={date.toISOString()} title={date.toLocaleString()}>
            {compact}
        </time>
    );
}

export function formatModelName(config: AiConfig, task: GenerationTask) {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    if (!model) return "Workflow";
    if (model === "version-router") return "Version comparison workflow";
    if (model === "workflow-router") return "Workflow routing";
    if (model === "internal-agent") return "Built-in workflow";
    if (model === "openai-compatible") return "OpenAI compatible interface";
    return modelDisplayName(config, raw);
}
