import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { canvasNodeFailureExplanation } from "@/lib/canvas/canvas-depth-capture";
import { canReloadCanvasNodeResource, canvasNodeHasPendingOutcomeResult, isNodeRegenerateBlocked } from "@/lib/task-outcome";
import { nodeHoverToolbarTools } from "@/lib/canvas/tool-registry/definitions/node-hover-tools";
import type { ToolContext } from "@/lib/canvas/tool-registry";
import { canvasGenerationFailureMetadata, canvasGenerationTaskNodes, canvasImagePendingResultMessage } from "@/pages/canvas/canvas-generation-failure";
import type { GenerationTask } from "@/services/api/task-center";
import { canvasNodeRetryPlan } from "@/pages/canvas/canvas-generation-orchestration";
import { ApiError } from "@/services/api/request";
import { CanvasGenerationDurableAckError } from "@/services/canvas-generation-errors";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("a genuinely replaced target opens generation history instead of repeating a rejected bind", () => {
    const error = new CanvasGenerationDurableAckError(new ApiError("The node is bound to other tasks and the node is not covered", { status: 409, reason: "node_task_mismatch" }));
    const failure = canvasGenerationFailureMetadata(error, { prompt: "synthetic" });
    expect(failure.generationErrorCode).toBe("result_target_unavailable");
    expect(canReloadCanvasNodeResource(failure)).toBe(false);
    const node: CanvasNodeData = { id: "target", title: "video", type: CanvasNodeType.Video,
        width: 320, height: 180, position: { x: 0, y: 0 },
        metadata: { taskId: "original-task", taskStatus: "succeeded", status: "error", ...failure } };
    expect(canvasNodeRetryPlan(node, [])).toEqual({ kind: "history" });
    const explanation = canvasNodeFailureExplanation(node);
    expect(explanation.reason).not.toContain("parameters");
    expect(explanation.action).toContain("Build history");
    const html = renderToStaticMarkup(createElement(GenerationFailureNotice, { explanation, onRetry: () => {}, retryLabel: "Build history" }));
    expect(html).toContain("Build history");
    expect(html).not.toContain("Regenerate</button>");
    const retry = nodeHoverToolbarTools.find(item => item.id === "retry")!;
    const context = { node, nodeMetadata: node.metadata } as ToolContext;
    expect(typeof retry.displayLabel === "function" ? retry.displayLabel(context) : retry.displayLabel).toBe("Build history");
});

test("image pending-result messages and later task sync keep the saved-history action", () => {
    const node: CanvasNodeData = { id: "image", title: "pictures", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 320, height: 180,
        metadata: { taskId: "saved-task", generationErrorCode: "result_target_unavailable", taskOutcome: { phase: "failed", regenerate: "blocked", reason: "result_target_unavailable" } } };
    expect(canvasNodeHasPendingOutcomeResult(node, [])).toBe(true);
    expect(isNodeRegenerateBlocked(node.metadata)).toBe(true);
    expect(canvasImagePendingResultMessage(node, [])).toContain("Build history");
    expect(canvasImagePendingResultMessage(node, [])).not.toContain("Continue to retrieve");
    const root = { ...node, id: "root", metadata: { batchChildIds: [node.id] } };
    expect(canvasImagePendingResultMessage(root, [node])).toContain("Build history");
    const [synced] = canvasGenerationTaskNodes([node], node.id, { id: "saved-task", type: "canvas_image", status: "succeeded" } as GenerationTask);
    expect(synced.metadata?.generationErrorCode).toBe("result_target_unavailable");
    expect(canReloadCanvasNodeResource(synced)).toBe(false);
    expect(synced.metadata?.errorDetails).toContain("Build history");
    expect(canvasNodeRetryPlan(synced, [])).toEqual({ kind: "history" });
});
