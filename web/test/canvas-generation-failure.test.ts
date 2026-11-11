import { describe, expect, test } from "bun:test";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { canvasGenerationFailureMetadata, canvasTaskFailureMetadata, canvasGenerationTaskNodes } from "../src/pages/canvas/canvas-generation-failure";
import { canReloadCanvasNodeResource, canvasNodeHasPendingOutcomeResult, isNodeRegenerateBlocked, isNodeRegenerateConfirm, isTaskRegenerateBlocked, readTaskOutcome } from "../src/lib/task-outcome";
import { taskAttentionReason } from "../src/pages/tasks/task-shared";
import { resolveMetadataReferences, generationTaskMetadata, resetGenerationTaskMetadata } from "../src/lib/canvas/canvas-project-generation";
import { ApiError } from "../src/services/api/request";
import { explainGenerationError, formatGenerationDiagnostics, unchangedModeratedPrompt } from "../src/lib/generation-error";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { GenerationTask } from "../src/services/api/task-center";
import moderationFixtures from "../../fixtures/moderation-errors.json";

const rejection = { code: "content_policy_violation", message: "opaque" };

test("confirmed unsent submission remains retryable after restoring the task", () => {
    const task = { id: "unsent-task", type: "canvas_video", status: "failed", stage: "Task failed", errorCode: "request_not_sent", error: "Failed to connect to the service. This request has not been submitted yet. Please check your network or proxy and try again." } as GenerationTask;
    const metadata = { ...generationTaskMetadata(task), ...canvasTaskFailureMetadata(task) };
    expect(isTaskRegenerateBlocked(task)).toBe(false);
    expect(isNodeRegenerateBlocked(metadata)).toBe(false);
    expect(explainGenerationError({ code: task.errorCode, message: task.error }).message).toContain("Not submitted yet");
    expect(isNodeRegenerateBlocked({ ...metadata, taskOutcome: undefined, taskStage: "submission_unknown", generationErrorCode: "submission_uncertain" })).toBe(true);
});

test("completed media with a canvas commit conflict offers reload without another paid generation", () => {
    const failure = canvasGenerationFailureMetadata({ code: "canvas_conflict" }, { prompt: "red square", mode: "video" });
    expect(failure.errorDetails).toContain("Generate results retained");
    expect(failure.errorDetails).not.toContain("Model does not accept");
    expect(canReloadCanvasNodeResource({ taskId: "task-1", ...failure })).toBe(true);
    expect(isNodeRegenerateBlocked(failure)).toBe(true);
});

test("backend canvas revision 409 offers reload without treating it as a model failure", () => {
    const failure = canvasGenerationFailureMetadata(
        new ApiError("The cloud canvas has been updated and coverage has stopped; please keep the local draft and load the latest version", { status: 409, reason: "conflict" }),
        { prompt: "red square", mode: "image" },
    );
    expect(failure.generationErrorCode).toBe("canvas_conflict");
    expect(canReloadCanvasNodeResource({ taskId: "task-1", ...failure })).toBe(true);
    expect(failure.errorDetails).toContain("Generate results retained");
    expect(failure.errorDetails).not.toContain("Model does not accept");
    expect(isNodeRegenerateBlocked(failure)).toBe(true);
});
const task: GenerationTask = { id: "task-failure", type: "canvas_image", status: "failed", prompt: "draw", attempts: 1, createdAt: "2026-09-26T00:00:00Z", updatedAt: "2026-09-26T00:00:00Z", errorCode: "content_policy_violation", error: "opaque" };
const image = (id: string, storageKey: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `https://example.test/${id}.png`, storageKey } });

test("complete image input rejection permits changed input while uncertain tasks stay locked", () => {
    const corrected: GenerationTask = { ...task, stage: "Task failed", errorCode: "moderation_input", error: "The input text failed content security review. Please adjust the prompt word and regenerate." };
    const stale = image("rejected-node", "");
    stale.metadata = { taskId: task.id, status: "error", taskStage: "submission_unknown", generationSubmissionState: "unknown", generationErrorCode: "submission_uncertain" };
    const restored = canvasGenerationTaskNodes([stale], stale.id, corrected)[0];
    expect(restored.metadata?.errorDetails).toContain("Input text failed content security review");
    expect(restored.metadata?.errorDetails).not.toContain("Results are not yet confirmed");
    expect(canvasNodeHasPendingOutcomeResult(restored, [restored])).toBe(false);
    expect(isNodeRegenerateConfirm(restored.metadata)).toBe(true);
    expect(unchangedModeratedPrompt(restored.metadata, "draw")).toBe(true);
    expect(unchangedModeratedPrompt(restored.metadata, "a different drawing")).toBe(false);
    expect(readTaskOutcome(corrected)?.regenerate).toBe("confirm");
    const uncertain: GenerationTask = { ...task, stage: "submission_unknown", errorCode: "submission_uncertain", error: "Image results not yet confirmed" };
    const pending = canvasGenerationTaskNodes([stale], stale.id, uncertain)[0];
    expect(canvasNodeHasPendingOutcomeResult(pending, [pending])).toBe(true);
    expect(isNodeRegenerateBlocked(pending.metadata)).toBe(true);
});

describe("canvas generation failure consumers", () => {
    test("copied diagnostics hide mounted and UNC paths and label configuration honestly", () => {
        for (const path of ["/Volumes/PrivateDrive/customer-A/image.png", "/Volumes/External Work/customer-A/image.png", String.raw`C:\Private User\customer-A\image.png`, String.raw`\\Private Server\Private Share\customer-A\image.png`, "/mnt/PrivateDrive/customer-A/image.png", String.raw`\\PrivateServer\PrivateShare\customer-A\image.png`]) {
            const copied = formatGenerationDiagnostics(explainGenerationError(new Error(`open ${path}: permission denied`)), { failureDiagnostics: { source: "local_result", summary: `open ${path}: permission denied`, input: { size: "auto", quality: "2k", count: "3", promptChars: 1, imageCount: 0, videoCount: 0, audioCount: 0 } } });
            expect(copied).not.toContain("Private");
            expect(copied).not.toContain("customer-A");
            expect(copied).toContain("Task configuration (protocols may be switched or omitted)");
            expect(copied).not.toContain("Submit parameters");
        }
    });
    test("completed generation evidence survives a later canvas application failure", () => {
        const completed: GenerationTask = { ...task, status: "succeeded", failureDiagnostics: { source: "unknown", version: "1.5.9", platform: "windows/amd64", executionResult: "completed", requests: [{ operation: "image_edit", method: "POST", dispatched: true, outcome: "response_received", httpStatus: 200, requestId: "req-success-123", startedAt: "2026-09-30T15:39:23+08:00", durationMs: 48000, receivedBytes: 5672372 }], input: { size: "2048x2048", count: "1", promptChars: 20, imageCount: 3, videoCount: 0, audioCount: 0, maxImages: 2 } } };
        const metadata = canvasTaskFailureMetadata(completed, undefined, new Error("cannot apply result /Users/PRIVATE/image.png"));
        const copied = formatGenerationDiagnostics(explainGenerationError(metadata.errorDetails), { failureDiagnostics: metadata.taskFailureDiagnostics });
        expect(copied).toContain("Error source: canvas application results");
        expect(copied).toContain("Build Execution: Complete");
        expect(copied).toContain("Response received (business results will be determined separately)");
        expect(copied).toContain("req-success-123");
        expect(copied).toContain("1.5.9 (windows/amd64)");
        expect(copied).toContain("size=2048x2048");
        expect(copied).toContain("quantity=1");
        expect(copied).toContain("5672372");
        expect(copied).not.toContain("PRIVATE");
    });
    test("task diagnostic survives canvas restore and is cleared before retry", () => {
        const diagnosticTask: GenerationTask = { ...task, errorCode: "invalid_params", failureDiagnostics: { source: "local_validation", summary: "The current image model supports up to 2 reference images.", stage: "Validate input" } };
        const metadata = { ...generationTaskMetadata(diagnosticTask), ...canvasTaskFailureMetadata(diagnosticTask) };
        const copied = formatGenerationDiagnostics(explainGenerationError(metadata.errorDetails), { taskId: metadata.taskId, failureDiagnostics: metadata.taskFailureDiagnostics });
        expect(copied).toContain("The current image model supports up to 2 reference images.");
        expect(copied).toContain("Source of error: local parameter verification");
        expect(resetGenerationTaskMetadata(metadata).taskFailureDiagnostics).toBeUndefined();
        expect(resetGenerationTaskMetadata(metadata).generationErrorSummary).toBeUndefined();
    });
    test("task cards and restored canvas retain specific moderation guidance", () => {
        for (const fixture of moderationFixtures) {
            const error = `${fixture.reason}。${fixture.action}. Troubleshooting number: Request req_moderation_123.`;
            const failedTask = { ...task, error, errorCode: fixture.category };
            expect(taskAttentionReason(failedTask)).toContain(fixture.reason);
            expect(taskAttentionReason(failedTask)).toContain(fixture.action);
            expect(canvasTaskFailureMetadata(failedTask).errorDetails).toBe(error);
            expect(readTaskOutcome(failedTask)?.regenerate).toBe("confirm");
        }
    });
    test("actual connected reference, rather than the source image itself, controls moderation retry", () => {
        const source = image("source", "resource:source");
        const first = image("reference-a", "resource:a");
        const second = image("reference-b", "resource:b");
        const nodes = [source, first, second];
        const context = (referenceId: string) => buildNodeGenerationContext(source.id, nodes, [{ id: "input", fromNodeId: referenceId, toNodeId: source.id }], "redraw @picture1", []);
        const submitted = context(first.id);
        const failure = canvasGenerationFailureMetadata(rejection, submitted);
        expect(submitted.referenceImages.map((reference) => reference.id)).toEqual([first.id]);
        expect(unchangedModeratedPrompt(failure, submitted.prompt, submitted.referenceImages)).toBe(true);
        expect(unchangedModeratedPrompt(failure, context(second.id).prompt, context(second.id).referenceImages)).toBe(false);
        expect(unchangedModeratedPrompt(failure, "different drawing", submitted.referenceImages)).toBe(false);
    });

    test("stable resources ignore preview URL rotation but detect content replacement", () => {
        const input = { prompt: "draw", referenceImages: [{ id: "ref", storageKey: "resource:old", url: "blob:old" }] };
        const failure = canvasGenerationFailureMetadata(rejection, input);
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:old" }])).toBe(true);
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:new" }])).toBe(false);
        const raw = { prompt: "draw", referenceImages: [{ id: "ref", dataUrl: "data:image/png;base64,a" }] };
        expect(unchangedModeratedPrompt(canvasGenerationFailureMetadata(rejection, raw), "draw", [{ url: "data:image/png;base64,b" }])).toBe(false);
    });

    test("video, audio and masks are part of the submitted moderation input", () => {
        const input = { prompt: "draw", referenceVideos: [{ id: "video", storageKey: "resource:video" }], referenceAudios: [{ id: "audio", storageKey: "resource:audio" }], mask: { id: "mask", dataUrl: "mask-a" } };
        const failure = canvasGenerationFailureMetadata(rejection, input);
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:video" }, { storageKey: "resource:audio" }, { url: "mask-a" }])).toBe(true);
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:video" }, { url: "mask-a" }])).toBe(false);
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:video" }, { storageKey: "resource:audio" }, { url: "mask-b" }])).toBe(false);
        const imageOnly = { ...input, mode: "image" as const };
        expect(unchangedModeratedPrompt(canvasGenerationFailureMetadata(rejection, imageOnly), "draw", [{ url: "mask-a" }])).toBe(true);
    });

    test("stored references survive a deleted source without pretending to be new input", async () => {
        const input = { prompt: "draw", referenceImages: [{ id: "deleted-source", url: "https://example.test/reference.png" }] };
        const failure = canvasGenerationFailureMetadata(rejection, input);
        const recovered = await resolveMetadataReferences({ generationType: "edit", references: ["https://example.test/reference.png"] });
        expect(recovered).not.toBeNull();
        expect(recovered).toHaveLength(1);
        expect(unchangedModeratedPrompt(failure, "draw", recovered!.map((ref) => ({ url: ref.url })))).toBe(true);
        expect(await resolveMetadataReferences({ generationType: "edit", references: [] })).toBeNull();
    });

    test("retrievable and input-rejected outcomes map to blocked or confirm regenerate modes", () => {
        for (const generationErrorCode of ["submission_uncertain", "download_failed"]) {
            expect(isNodeRegenerateBlocked({ generationErrorCode, errorDetails: "opaque" })).toBe(true);
        }
        for (const generationErrorCode of ["invalid_params", "moderation_reference"]) {
            expect(isNodeRegenerateConfirm({ generationErrorCode, errorDetails: "opaque" })).toBe(true);
        }
        expect(isNodeRegenerateBlocked({ generationErrorCode: "throttled", errorDetails: "opaque" })).toBe(false);
        expect(isNodeRegenerateBlocked({ generationErrorCode: "auth", errorDetails: "opaque" })).toBe(false);
    });

    test("task recovery uses the original submitted references and structured error code", () => {
        const submitted = { prompt: "draw", referenceImages: [{ id: "ref", storageKey: "resource:old" }] };
        const failure = canvasTaskFailureMetadata({ ...task, inputJson: JSON.stringify(submitted) });
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:old" }])).toBe(true);
        expect(unchangedModeratedPrompt(failure, "draw", [{ storageKey: "resource:new" }])).toBe(false);
        const restored = canvasTaskFailureMetadata(task, { ...failure, taskId: task.id });
        expect(restored.failedInputFingerprint).toBe(failure.failedInputFingerprint);
    });

    test("task cards never expose raw nested JSON in the visible reason or tooltip", () => {
        const raw = { ...task, error: '{"error":{"code":"400","message":"Height must be between 300px and 6000px"}}', errorCode: "invalid_params" };
        const reason = taskAttentionReason(raw);
        expect(reason).not.toContain("{");
        // 后端只下发整理过的文案；收到原始 JSON 时只显示类别文案，不外露 JSON。
        expect(reason).toContain("Model does not accept current parameters");
        const backend = taskAttentionReason({ ...task, error: "The height of the reference material does not meet the model requirements. Please adjust the height to 300–6000 pixels and resubmit.", errorCode: "invalid_params" });
        expect(backend).toContain("height");
        expect(backend).toContain("300–6000");
    });

    test("task cards preserve a machine-readable failure code alongside an opaque message", () => {
        expect(taskAttentionReason({ ...task, error: undefined, errorCode: "moderation_reference" })).toContain("Reference material");
        expect(isTaskRegenerateBlocked({ ...task, errorCode: "download_failed" })).toBe(true);
        expect(readTaskOutcome({ ...task, errorCode: "invalid_params" })?.regenerate).toBe("confirm");
        expect(isTaskRegenerateBlocked({ ...task, errorCode: "throttled" })).toBe(false);
        expect(isTaskRegenerateBlocked({ ...task, errorCode: "throttled", stage: "submission_unknown" })).toBe(true);
    });

    test("canvas batch items and creation recovery preserve errorCode and classify via structured { code, message }", async () => {
        const { isContentModerationError, generationErrorMessage } = await import("../src/lib/generation-error");
        const { recoverCreationTextTask } = await import("../src/services/creation-text-task-recovery");
        const { reconcileCreationTaskMessages } = await import("../src/pages/create/creation-conversations");
        const { isGenerationSubmissionUncertainError } = await import("../src/lib/canvas/canvas-generation-batch");

        const batchItem = {
            id: "batch-item-1",
            rowId: "row-1",
            nodeId: "node-1",
            status: "failed" as const,
            retryCount: 0,
            errorDetails: "The first reference image appears to contain a real person, and the model refuses to generate it. Please check and replace the reference image before regenerating.",
            errorCode: "moderation_reference",
        };
        const batchErrorInput = { code: batchItem.errorCode, message: batchItem.errorDetails };
        expect(isContentModerationError(batchErrorInput)).toBe(true);
        expect(explainGenerationError(batchErrorInput).blockManualRetry).toBe(true);
        expect(generationErrorMessage(batchErrorInput)).toBe(batchItem.errorDetails);
        expect(isGenerationSubmissionUncertainError({ code: "submission_uncertain", message: "General error description" })).toBe(true);

        const textRecovery = recoverCreationTextTask(
            { mode: "text", status: "pending", content: "", taskIds: ["text-task-1"] },
            [{ ...task, id: "text-task-1", type: "canvas_text", status: "failed", errorCode: "quota_user", error: "The available balance of the current account is insufficient. Please check your account balance." }],
        );
        expect(textRecovery).toMatchObject({
            status: "error",
            error: "The available balance of the current account is insufficient. Please check your account balance.",
            generationErrorCode: "quota_user",
        });

        const reconciled = reconcileCreationTaskMessages(
            { recoverCreationTextTask } as unknown as Parameters<typeof reconcileCreationTaskMessages>[0],
            [{
                id: "conv-1",
                title: "test",
                updatedAt: "2026-10-01T00:00:00Z",
                messages: [{ id: "msg-1", role: "assistant", mode: "video", status: "pending", content: "", createdAt: "2026-10-01T00:00:00Z", taskIds: ["video-task-1"] }],
            }],
            [{ ...task, id: "video-task-1", type: "canvas_video", status: "failed", errorCode: "moderation_output", error: "The generated video failed content security review. Please adjust the prompt words or reference materials and regenerate." }],
        );
        const failedMsg = reconciled[0]?.messages[0];
        expect(failedMsg?.status).toBe("error");
        expect(failedMsg?.generationErrorCode).toBe("moderation_output");
        expect(explainGenerationError({ code: failedMsg?.generationErrorCode, message: failedMsg?.error }).category).toBe("moderation_output");
        expect(explainGenerationError({ code: failedMsg?.generationErrorCode, message: failedMsg?.error }).blockManualRetry).toBe(true);
    });
});

test("an unrecoverable result keeps the backend conclusion when applying it fails", () => {
    const task = { id: "lost-result", type: "canvas_video", status: "succeeded", stage: "Mission accomplished", outcome: { phase: "failed", regenerate: "confirm", reason: "result_unrecoverable" } } as GenerationTask;
    const metadata = canvasTaskFailureMetadata(task, undefined, new Error("Download result failed"));
    expect(metadata.taskOutcome).toEqual({ phase: "failed", regenerate: "confirm", reason: "result_unrecoverable" });
    expect(isNodeRegenerateBlocked(metadata)).toBe(false);
    expect(metadata.errorDetails).not.toContain("Continue to retrieve");
    expect(metadata.generationErrorCode).toBeUndefined();
    const retained = canvasTaskFailureMetadata({ ...task, outcome: undefined }, undefined, new Error("Download result failed"));
    expect(retained.taskOutcome).toEqual({ phase: "retrievable", regenerate: "blocked", reason: "delivery_pending" });
});

test("live waitForGenerationTask failure preserves backend failureDiagnostics and allows retry after parameter rejection", async () => {
    const { waitForGenerationTask } = await import("../src/services/api/task-center");
    const { apiClient } = await import("../src/services/api/request");
    const origAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => ({
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: {
            code: 0,
            msg: "ok",
            data: {
                id: "task-live-reject",
                type: "canvas_image",
                status: "failed",
                stage: "Task failed",
                errorCode: "invalid_params",
                error: "The current model does not support this parameter combination, please adjust the parameters and try again. Troubleshooting number: Request req-synthetic-400.",
                outcome: { phase: "failed", regenerate: "confirm", reason: "input_rejected" },
                failureDiagnostics: {
                    source: "upstream_http",
                    executionResult: "failed",
                    stage: "Generate pictures",
                    httpStatus: 400,
                    providerCode: "InvalidParameter",
                    requestId: "req-synthetic-400",
                    summary: "The parameter specified in the request is not valid.",
                },
                attempts: 1,
                createdAt: "2026-10-01T00:00:00Z",
                updatedAt: "2026-10-01T00:00:01Z",
            },
        },
    });

    try {
        let caught: unknown;
        try {
            await waitForGenerationTask("task-live-reject", { intervalMs: 5, timeoutMs: 200 });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeDefined();
        const failure = canvasGenerationFailureMetadata(caught, { prompt: "portrait", mode: "image" });
        expect(isNodeRegenerateBlocked(failure)).toBe(false);
        expect(isNodeRegenerateConfirm(failure)).toBe(true);
        expect(unchangedModeratedPrompt(failure, "updated portrait")).toBe(false);

        const copied = formatGenerationDiagnostics(explainGenerationError(failure.errorDetails), {
            taskId: "task-live-reject",
            failureDiagnostics: failure.taskFailureDiagnostics,
        });
        expect(copied).toContain("Error source: Upstream HTTP response");
        expect(copied).not.toContain("Error source: undocumented");
        expect(copied).toContain("HTTP status: 400");
        expect(copied).toContain("req-synthetic-400");

        const staleTaskWithoutDiagnostics = {
            id: "task-live-reject",
            type: "canvas_image" as const,
            status: "failed" as const,
            prompt: "portrait",
            errorCode: "invalid_params",
            error: "The current model does not support this parameter combination",
            attempts: 1,
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:01Z",
        };
        const recovered = canvasTaskFailureMetadata(staleTaskWithoutDiagnostics, undefined, caught);
        expect(recovered.taskFailureDiagnostics?.source).toBe("upstream_http");
        expect(recovered.taskFailureDiagnostics?.httpStatus).toBe(400);
    } finally {
        apiClient.defaults.adapter = origAdapter;
    }
});
