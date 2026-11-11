import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { GenerationFailureNotice } from "../src/components/generation/generation-failure-notice";
import { explainGenerationError, shouldBlockAutomaticRetry } from "../src/lib/generation-error";
import { isNodeRegenerateBlocked, isTaskRegenerateBlocked } from "../src/lib/task-outcome";
import { CreationMessageView } from "../src/pages/create/creation-workspace";
import { selectRetryableImageBatchChildren } from "../src/pages/canvas/canvas-generation-orchestration";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { GenerationTask } from "../src/services/api/task-center";

const preparationMessages = [
    ["image_reference_upload_failed", "The reference image upload failed and the generation has not started yet. Please try again later."],
    ["reference_media_upload_failed", "The reference material upload failed and the generation has not started yet. Please check the object storage configuration and public read permissions and try again."],
] as const;

function task(error: string, stage = "Prepare reference materials"): GenerationTask {
    return { id: "task-reference", type: "canvas_image", status: "failed", errorCode: "provider_unavailable", error, stage, attempts: 1, createdAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T10:00:01Z" };
}

function creation(error: string, generationStage?: string, generationErrorCode?: string) {
    return renderToStaticMarkup(<CreationMessageView
        item={{ id: "message-reference", role: "assistant", mode: "image", content: "", status: "error", error, generationStage, generationErrorCode, createdAt: "2026-10-17T10:00:00Z" }}
        shotNumber={1} onRetryFailure={() => {}} onCreateVariant={() => {}} onEditUserMessage={() => {}} onContinueCanvas={() => {}} openingCanvas={false}
    />);
}

test("local runtime preserves confirmed preparation copy and offers only manual retry", () => {
    for (const [code, message] of preparationMessages) {
        const structured = { code: "provider_unavailable", message };
        const explanation = explainGenerationError(structured);
        expect(explanation.providerCode).toBe(code);
        expect(explanation.category).toBe("provider_unavailable");
        expect(explanation.message).toBe(message);
        expect(explanation.retryable).toBe(false);
        expect(explanation.uncertain).toBe(false);
        expect(shouldBlockAutomaticRetry(structured)).toBe(true);
        expect(explanation.blockManualRetry).toBe(false);
        expect(isTaskRegenerateBlocked(task(message))).toBe(false);
        const notice = renderToStaticMarkup(<GenerationFailureNotice explanation={explanation} onRetry={() => {}} />);
        expect(notice).toContain("Regenerate");
        const html = creation(message, undefined, "provider_unavailable");
        expect(html).toContain("This time the generation has not started yet");
        expect(html).toContain("Regenerate");
        expect(html).not.toContain("local resource directory");
        if (code === "image_reference_upload_failed") expect(html).not.toContain("Check object storage");
    }
});

test("unknown stage overrides later preparation text in creation and task center", () => {
    for (const [, message] of preparationMessages) {
        expect(explainGenerationError({ code: "provider_unavailable", message }, { stage: "submission_unknown" }).blockManualRetry).toBe(true);
        expect(isTaskRegenerateBlocked(task(message, "submission_unknown"))).toBe(true);
        const html = creation(message, "submission_unknown", "provider_unavailable");
        expect(html).toContain("The submission result has not yet been confirmed");
        expect(html).not.toContain("This time the generation has not started yet");
        expect(html).not.toContain("Regenerate");
    }
});

test("untrusted HTTP echoes and upload short messages do not grant manual retry", () => {
    for (const [code, message] of preparationMessages) {
        for (const status of [400, 403, 503]) {
            for (const data of [message, { error: { code, message } }]) {
                const error = { status, data };
                expect(explainGenerationError(error).uncertain).toBe(true);
                expect(explainGenerationError(error).blockManualRetry).toBe(true);
            }
        }
        expect(explainGenerationError({ code, message: "Reference image upload failed" }).blockManualRetry).toBe(true);
    }
    expect(explainGenerationError("Reference image upload failed").blockManualRetry).toBe(true);
    expect(creation("Reference image upload failed")).not.toContain("Regenerate");
});

test("manual canvas and batch retry keep preparation distinct from unknown submission", () => {
    for (const [, message] of preparationMessages) {
        const node: CanvasNodeData = { id: "prepared", type: CanvasNodeType.Image, title: "lens", width: 320, height: 180, position: { x: 0, y: 0 }, metadata: { status: "error", generationErrorCode: "provider_unavailable", errorDetails: message } };
        const unknown = { ...node, id: "unknown", metadata: { ...node.metadata, taskStage: "submission_unknown" } };
        expect(isNodeRegenerateBlocked(node.metadata)).toBe(false);
        expect(isNodeRegenerateBlocked(unknown.metadata)).toBe(true);
        expect(selectRetryableImageBatchChildren([node, unknown])).toEqual({ retryable: [node], blocked: true });
    }
});
