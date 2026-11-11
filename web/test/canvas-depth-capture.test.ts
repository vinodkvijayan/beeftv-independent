import { expect, test } from "bun:test";

import { canvasNodeFailureExplanation, depthCaptureWaitFailureMetadata, findDepthCaptureSourceNode, isDepthCaptureResultNode } from "@/lib/canvas/canvas-depth-capture";
import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { GenerationTask } from "@/services/api/task-center";
import { generationTaskStageLabel } from "@/lib/generation-task-display";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { nodeHoverToolbarTools } from "@/lib/canvas/tool-registry/definitions/node-hover-tools";
import type { ToolContext } from "@/lib/canvas/tool-registry";
import { formatGenerationDiagnostics } from "@/lib/generation-error";

const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Video, title: "Original video", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: {} };
const depth: CanvasNodeData = { id: "depth", type: CanvasNodeType.Video, title: "Deep motion capture", position: { x: 400, y: 0 }, width: 320, height: 180, metadata: { depthSourceNodeId: source.id, taskId: "depth-task" } };

test("depth result nodes retain their dedicated retry contract instead of generic video generation", () => {
    expect(isDepthCaptureResultNode(depth)).toBe(true);
    expect(findDepthCaptureSourceNode(depth, [source, depth])).toBe(source);
    expect(isDepthCaptureResultNode(source)).toBe(false);
});

test("depth task stages show the existing CPU slow-path and CUDA fallback notice", () => {
    expect(generationTaskStageLabel({ status: "running", stage: "Processing using CPU may take a long time" })).toBe("Processing using CPU may take a long time");
    expect(generationTaskStageLabel({ status: "running", stage: "CUDA device failure, switch to CPU (may take longer)" })).toBe("CUDA device failure, switch to CPU (may take longer)");
});

test("restart-paused depth tasks ask for explicit continuation", () => {
    const paused = { ...depth, metadata: { ...depth.metadata, status: "error" as const, taskStatus: "failed", taskStage: "Paused, waiting for manual continuation" } };
    const explanation = canvasNodeFailureExplanation(paused);
    expect(explanation.reason).toBe("Depth capture is paused");
    expect(explanation.action).toContain("Try again to continue");
    expect(explanation.blockAutomaticRetry).toBe(false);
    const html = renderToStaticMarkup(createElement(GenerationFailureNotice, { explanation, onRetry: () => {} }));
    expect(html).toContain("Regenerate");
});

test("confirmed local depth failure offers retry without relaxing paid unknown-result guards", () => {
    const failed = { ...depth, metadata: { ...depth.metadata, status: "error" as const, taskStatus: "failed", generationErrorCode: "download_failed", errorDetails: "Failed to download generated results" } };
    const explanation = canvasNodeFailureExplanation(failed);
    const html = renderToStaticMarkup(createElement(GenerationFailureNotice, { explanation, onRetry: () => {} }));
    expect(html).toContain("Regenerate");
    expect(explanation.uncertain).toBe(false);
    expect(canvasNodeFailureExplanation({ ...failed, metadata: { ...failed.metadata, taskStatus: "running" } }).uncertain).toBe(true);
    expect(canvasNodeFailureExplanation({ ...failed, metadata: { ...failed.metadata, depthSourceNodeId: undefined } }).uncertain).toBe(true);
});

test("observation failure keeps a known active depth task loading", () => {
    const task = { id: "depth-task", status: "running" } as GenerationTask;
    const metadata = depthCaptureWaitFailureMetadata(new Error("Task execution timed out, please try again later"), task);
    expect(metadata.status).toBe("loading");
    expect(metadata.errorDetails).toBeUndefined();
    expect(metadata.taskClientOperationTerminal).toBeUndefined();
    expect(depthCaptureWaitFailureMetadata(new Error("HTTP 503"), "depth-task").status).toBe("loading");
    expect(depthCaptureWaitFailureMetadata(new Error("invalid input")).status).toBe("error");
});

test("hover retry preserves cloud download guards and recovers completed local output", () => {
    const retry = nodeHoverToolbarTools.find(tool => tool.id === "retry")!;
    const makeContext = (node: CanvasNodeData) => ({ node, nodeMetadata: node.metadata }) as ToolContext;
    const cloud = { ...source, metadata: { status: "error" as const, taskStatus: "failed", generationErrorCode: "download_failed", errorDetails: "download_failed" } };
    expect(retry.applicable?.(makeContext(cloud))).toBe(false);
    const failedDepth = { ...depth, metadata: { ...cloud.metadata, ...depth.metadata } };
    expect(retry.applicable?.(makeContext(failedDepth))).toBe(true);
    const completedDepth = { ...failedDepth, metadata: { ...failedDepth.metadata, taskStatus: "succeeded" } };
    expect(retry.applicable?.(makeContext(completedDepth))).toBe(true);
    expect(typeof retry.displayLabel === "function" ? retry.displayLabel(makeContext(completedDepth)) : retry.displayLabel).toBe("Recovery results");
    const explanation = canvasNodeFailureExplanation(completedDepth);
    const html = renderToStaticMarkup(createElement(GenerationFailureNotice, { explanation, onRetry: () => {}, retryLabel: "Recovery results" }));
    expect(html).toContain("Recovery results");
    expect(html).not.toContain("Regenerate");
});

test("copied local failure diagnostics retain the exit cause within the safe summary budget", () => {
    const message = "\r 0 0 0 0 Time Time Current".repeat(150) + "curl: (28) Connection timed out\nModel download failed";
    const summary = "… 0 0 0 0 Time Time Current ".repeat(7) + "curl: (28) Connection timed out\nModel download failed";
    const failed = { ...depth, metadata: { ...depth.metadata, status: "error" as const, taskStatus: "failed", errorDetails: message } };
    const diagnostics = formatGenerationDiagnostics(canvasNodeFailureExplanation(failed), {taskId: "depth-task", failureDiagnostics: {source: "local_result", summary, stage: "Depth processing failed", requestId: "req-depth-local"}});
    expect(diagnostics).toContain("curl: (28) Connection timed out");
    expect(diagnostics).toContain("Model download failed");
    expect(diagnostics).toContain("Error source: local result processing");
    expect(diagnostics).toContain("Request ID: req-depth-local");
});
