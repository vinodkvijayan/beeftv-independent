import { queryGenerationTask, retryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";

/** Retry the persisted request, never rebuild a failed video's inputs from the current canvas. */
export async function retryStoredCanvasVideo(taskId: string, signal: AbortSignal, onTaskUpdate: (task: GenerationTask) => void,
    dependencies = { queryGenerationTask, retryGenerationTask, waitForGenerationTask }) {
    const check = () => signal.throwIfAborted();
    let task = await dependencies.queryGenerationTask(taskId, { signal });
    check();
    if (task.type !== "canvas_video") throw new Error("The original task is not a canvas video task and cannot be retried according to the original input.");
    if (task.status === "failed" || task.status === "cancelled") {
        task = await dependencies.retryGenerationTask(taskId, { signal });
        check();
    }
    onTaskUpdate(task);
    return dependencies.waitForGenerationTask(task.id, { signal, initialTask: task, onTaskUpdate });
}
