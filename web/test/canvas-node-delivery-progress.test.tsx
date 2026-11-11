import { expect, mock, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import type { GenerationTaskDeliveryProgress } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { OperationProgress } from "@/lib/operation-progress";

// Server rendering only sees zustand's initial snapshot, so the progress store
// is replaced with a plain selector over a test-owned map.
const byTask: Record<string, GenerationTaskDeliveryProgress> = {};
mock.module("@/stores/use-generation-delivery-progress", () => ({
    useGenerationDeliveryProgress: <T,>(selector: (state: { byTask: typeof byTask }) => T) => selector({ byTask }),
    publishGenerationDeliveryProgress: () => {},
}));
const { CanvasNodeContent } = await import("@/components/canvas/canvas-node-content");
const { CanvasNodeGenerationProgress } = await import("@/components/canvas/canvas-node-generation-progress");

function render(node: CanvasNodeData) {
    return renderToStaticMarkup(<CanvasNodeContent node={node} theme={canvasThemes.dark} isEditingContent={false} textareaRef={createRef<HTMLTextAreaElement>()} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} onContentChange={() => {}} onStopEditing={() => {}} onCancelTask={() => {}} mentionReferences={[]} />);
}

const loadingVideo: CanvasNodeData = { id: "video-1", type: CanvasNodeType.Video, title: "lens", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: { status: "loading", taskId: "task-1", taskStatus: "succeeded" } };

test("When retrieving results, the node displays progress, size and speed instead of \"generating\"", () => {
    byTask["task-1"] = { outputIndex: 0, downloadedBytes: 12_900_000, totalBytes: 41_943_040, bytesPerSecond: 1_258_291, state: "downloading", updatedAt: Date.now() };
    const markup = render(loadingVideo);
    delete byTask["task-1"];
    expect(markup).toContain("Retrieving results");
    expect(markup).toContain("30%");
    expect(markup).toContain("12 MB / 40 MB");
    expect(markup).toContain("1.2 MB/s");
    expect(markup).toContain("Estimated 24 seconds remaining");
    expect(markup).not.toContain("Generating");
});

test("Shows retrying when download is interrupted", () => {
    byTask["task-1"] = { outputIndex: 0, downloadedBytes: 2_000_000, totalBytes: 4_000_000, bytesPerSecond: 0, state: "retrying" };
    const markup = render(loadingVideo);
    delete byTask["task-1"];
    expect(markup).toContain("Download interrupted, retrying");
    expect(markup).toContain("50%");
});

test("When the task is successful but there is no progress yet, it shows that the results are being retrieved.", () => {
    const markup = render(loadingVideo);
    expect(markup).toContain("Retrieving results");
    expect(markup).not.toContain("Generating");
    expect(markup).toContain("Stop retrieving results");
    expect(markup).not.toContain("Cancel build task");
});

test("Failed nodes whose results have been retained provide \"continue retrieval\"", () => {
    const markup = render({ ...loadingVideo, metadata: { status: "error", taskId: "task-1", taskStatus: "succeeded", generationErrorCode: "download_failed", taskOutcome: { phase: "retrievable", regenerate: "blocked", reason: "delivery_pending" } } });
    expect(markup).toContain("Continue to retrieve");
    expect(markup).not.toContain("Reload resources");
});

test("In the process of retrieving the generated results, even if there are no bytes yet, it will be displayed as being retrieved, and the elapsed time will not be displayed.", () => {
    const fetchingNode: CanvasNodeData = { ...loadingVideo, metadata: { status: "loading", taskId: "task-1", taskStatus: "running", taskStage: "Retrieving generated results" } };
    const markup = render(fetchingNode);
    expect(markup).toContain("Retrieving results");
    expect(markup).not.toContain("Used");
    expect(markup).not.toContain("Generating");
});

test("Upload reference materials in the node before creating the task, so that the cancellation operation of the old task is not exposed", () => {
    const operation: OperationProgress = { id: "upload", title: "Upload reference materials", detail: "Uploading reference video 1", phase: "transferring", target: { projectId: "canvas-a", nodeId: loadingVideo.id }, loadedBytes: 2 * 1024 ** 2, totalBytes: 8 * 1024 ** 2, bytesPerSecond: 1024 ** 2, startedAt: Date.now() - 2000, updatedAt: Date.now() };
    const markup = renderToStaticMarkup(<CanvasNodeGenerationProgress node={loadingVideo} theme={canvasThemes.dark} operation={operation} onCancelTask={() => {}} />);
    expect(markup).toContain("Uploading reference video 1");
    expect(markup).toContain("25%");
    expect(markup).toContain("2.0 MB / 8.0 MB");
    expect(markup).toContain("1.0 MB/s");
    expect(markup).toContain("Estimated 6 seconds remaining");
    expect(markup).not.toContain("Cancel build task");
    expect(markup).not.toContain("Stop retrieving results");
});

test("The node keeps waiting while saving the results and does not display the transfer completion as available.", () => {
    const operation: OperationProgress = { id: "save", title: "Save generated results", detail: "Saving video and updating canvas", phase: "processing", target: { projectId: "canvas-a", nodeId: loadingVideo.id, taskId: "task-1" }, loadedBytes: 1024, totalBytes: 1024, startedAt: Date.now() - 2000, updatedAt: Date.now() };
    const markup = renderToStaticMarkup(<CanvasNodeGenerationProgress node={{ ...loadingVideo, metadata: { ...loadingVideo.metadata, status: "success" } }} theme={canvasThemes.dark} operation={operation} onCancelTask={() => {}} />);
    expect(markup).toContain("Saving video and updating canvas");
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain("100%");
    expect(markup).not.toContain("Stop retrieving results");
});
