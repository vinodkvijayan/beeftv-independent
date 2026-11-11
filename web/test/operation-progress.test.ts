import { afterEach, expect, test } from "bun:test";
import { canvasNodeOperation, createTransferSampler, operationProgressView, type OperationProgress } from "@/lib/operation-progress";
import { startOperation, useOperationProgress } from "@/stores/use-operation-progress";
import { beginTaskReferenceObservation, publishTaskReferenceProgress } from "@/services/task-reference-progress";
import type { GenerationTask } from "@/services/api/task-center";

const base: OperationProgress = { id: "upload", title: "Reference video", detail: "Uploading", phase: "transferring", loadedBytes: 2 * 1024 ** 2, totalBytes: 8 * 1024 ** 2, bytesPerSecond: 1024 ** 2, startedAt: 1000, updatedAt: 3000 };
afterEach(() => useOperationProgress.setState({ entries: {} }));

test("Real bytes, speed and remaining time from the same transfer sample", () => {
    expect(operationProgressView(base, 3000)).toMatchObject({ percent: 25, size: "2.0 MB / 8.0 MB", speed: "1.0 MB/s", timing: "Estimated 6 seconds remaining" });
    expect(operationProgressView({ ...base, totalBytes: undefined }, 3000)).toMatchObject({ percent: null, size: "2.0 MB", timing: "2 seconds elapsed" });
});
test("Do not retain false speed or estimated completion time when waiting for acknowledgment and stopping transfer", () => {
    expect(operationProgressView(base, 7000)).toMatchObject({ speed: "", timing: "6 seconds elapsed" });
    expect(operationProgressView({ ...base, loadedBytes: base.totalBytes, phase: "processing" }, 3000)).toMatchObject({ percent: null, speed: "", timing: "2 seconds elapsed" });
});
test("Resample after retransmitting to zero and do not use the previous round of speed.", () => {
    const sample = createTransferSampler(0);
    expect(sample(1024, 4096, 1000).bytesPerSecond).toBe(1024);
    expect(sample(0, 4096, 1200).bytesPerSecond).toBe(0);
    expect(sample(512, 4096, 2200).bytesPerSecond).toBe(512);
});
test("Receiving the same number of bytes repeatedly won't keep stalled transfers showing speed", () => {
    const sample = createTransferSampler(0);
    expect(sample(1024, 4096, 1000).bytesPerSecond).toBe(1024);
    sample(1024, 4096, 2000);
    sample(1024, 4096, 3000);
    expect(sample(1024, 4096, 4000).bytesPerSecond).toBe(0);
});
test("Polling retains the server sampling time and does not regard the old speed as the real-time speed", () => {
    const operation = startOperation("Upload reference video");
    operation.update({ phase: "transferring", loadedBytes: 512, totalBytes: 1024, bytesPerSecond: 256, updatedAt: 3000 });
    const entry = Object.values(useOperationProgress.getState().entries)[0];
    expect(entry.updatedAt).toBe(3000);
    expect(operationProgressView(entry, 7000).speed).toBe("");
    operation.dismiss();
});
test("The end of bytes is still waiting for confirmation, and failure will not be displayed as completed.", () => {
    const operation = startOperation("Upload reference video");
    operation.progress(100, 100);
    expect(Object.values(useOperationProgress.getState().entries)[0].phase).toBe("processing");
    operation.fail();
    expect(Object.values(useOperationProgress.getState().entries)[0].phase).toBe("error");
});
test("Completed reference uploads cannot be redisplayed when an earlier response is late.", () => {
    const oldRequest = beginTaskReferenceObservation();
    const latestRequest = beginTaskReferenceObservation();
    const task = { id: "ordered-reference-task", status: "running", referenceProgress: { label: "Reference video 1", phase: "transferring", loadedBytes: 512, totalBytes: 1024, bytesPerSecond: 256, startedAt: 1000, updatedAt: 3000 } } as GenerationTask;
    publishTaskReferenceProgress(task, oldRequest);
    publishTaskReferenceProgress({ ...task, referenceProgress: undefined }, latestRequest);
    const before = Object.values(useOperationProgress.getState().entries);
    expect(before).toHaveLength(0);
    publishTaskReferenceProgress(task, oldRequest);
    expect(Object.values(useOperationProgress.getState().entries)).toEqual(before);
});
test("The reference upload will not show success when the retry gap disappears. It will only show completion when it is clear that the task is successful.", () => {
    const task = { id: "retry-reference-task", status: "running", referenceProgress: { label: "Reference video 1", phase: "processing", loadedBytes: 1024, totalBytes: 1024, bytesPerSecond: 0, startedAt: 1000, updatedAt: 3000 } } as GenerationTask;
    publishTaskReferenceProgress(task);
    publishTaskReferenceProgress({ ...task, referenceProgress: undefined });
    expect(Object.values(useOperationProgress.getState().entries)).toHaveLength(0);
    publishTaskReferenceProgress(task);
    publishTaskReferenceProgress({ ...task, status: "succeeded", referenceProgress: undefined });
    expect(Object.values(useOperationProgress.getState().entries).map(item => item.phase)).toEqual(["done"]);
});
test("The node progress must match the canvas, node and current task at the same time, and the old task cannot overwrite the new task.", () => {
    const upload = { ...base, target: { projectId: "canvas-a", nodeId: "video", taskId: "old-task" } };
    const entries = { upload };
    expect(canvasNodeOperation(entries, "canvas-a", "video", "old-task")).toBe(upload);
    expect(canvasNodeOperation(entries, "canvas-b", "video", "old-task")).toBeUndefined();
    expect(canvasNodeOperation(entries, undefined, "video", "old-task")).toBeUndefined();
    expect(canvasNodeOperation(entries, "canvas-a", "video", "new-task")).toBeUndefined();
    expect(canvasNodeOperation(entries, "canvas-a", "other-video", "old-task")).toBeUndefined();
    expect(canvasNodeOperation({ upload: { ...upload, phase: "done" } }, "canvas-a", "video", "old-task")).toBeUndefined();
    const preparation = { ...base, target: { projectId: "canvas-a", nodeId: "video" } };
    expect(canvasNodeOperation({ preparation }, "canvas-a", "video", "old-task")).toBe(preparation);
});

test("The background reference upload locates the result node from the complete task metadata, and returns the generation progress after the upload is completed.", () => {
    const task = { id: "canvas-reference-task", projectId: "canvas-a", status: "running", inputJson: JSON.stringify({ metadata: { nodeId: "output-video", sourceNodeId: "source-video" } }), referenceProgress: { label: "Reference video 1", phase: "transferring", loadedBytes: 512, totalBytes: 1024, bytesPerSecond: 256, startedAt: 1000, updatedAt: 3000 } } as GenerationTask;
    publishTaskReferenceProgress(task);
    const progress = canvasNodeOperation(useOperationProgress.getState().entries, "canvas-a", "output-video", task.id);
    expect(progress?.target).toEqual({ projectId: "canvas-a", nodeId: "output-video", taskId: task.id });
    expect(canvasNodeOperation(useOperationProgress.getState().entries, "canvas-a", "source-video", task.id)).toBeUndefined();
    publishTaskReferenceProgress({ ...task, status: "succeeded", referenceProgress: undefined });
    expect(Object.values(useOperationProgress.getState().entries)).toHaveLength(0);
});
