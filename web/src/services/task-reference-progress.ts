import type { GenerationTask } from "@/services/api/task-center";
import { startOperation } from "@/stores/use-operation-progress";
import { generationTaskNodeId } from "@/lib/canvas/canvas-generation-task-identity";

const observations = new Map<string, ReturnType<typeof startOperation>>();
const latestRequests = new Map<string, number>();
let requestSequence = 0;
export const beginTaskReferenceObservation = () => ++requestSequence;

export function publishTaskReferenceProgress(task: GenerationTask, request = beginTaskReferenceObservation()) {
    const key = task.id;
    if (request < (latestRequests.get(key) ?? 0)) return;
    latestRequests.set(key, request);
    let observation = observations.get(key);
    const progress = task.referenceProgress;
    const nodeId = generationTaskNodeId(task);
    const target = task.projectId && nodeId ? { projectId: task.projectId, nodeId, taskId: task.id } : undefined;
    if (progress && task.status === "running") {
        if (!observation) {
            observation = startOperation("Upload reference materials", { target });
            observations.set(key, observation);
        }
        observation.update({ ...progress, detail: (progress.phase === "transferring" ? "Uploading" : progress.phase === "processing" ? "Confirming" : "Preparing") + progress.label });
    } else if (observation) {
        if (target) observation.dismiss();
        else if (task.status === "failed") observation.fail("The generation task is not completed, please check the task details");
        else if (task.status === "succeeded") observation.done("Reference material confirmed");
        // A missing snapshot can also be a retry or a lost worker lease.
        // Only a confirmed terminal success is enough to show completion.
        else observation.dismiss();
        observations.delete(key);
    }
}
