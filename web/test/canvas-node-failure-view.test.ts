import { afterEach, describe, expect, test } from "bun:test";

import { canvasNodeFailureView, type CanvasNodeFailureView } from "@/lib/canvas/canvas-node-failure-view";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { persistCanvasNodeFailure } from "@/lib/canvas/canvas-node-failure-state";

/**
 * 这些期望值是在 d3b3d773 上跑原来的判断函数得到的，不是手写推断。
 * 时钟钉在 2026-04-20T06:00:00.000Z。测试进程时区是 UTC，所以截止时间显示 06:15。
 */
const NOW_MS = Date.parse("2026-04-20T06:00:00.000Z");
const FUTURE_DEADLINE = new Date(NOW_MS + 15 * 60_000).toISOString();
const realNow = Date.now;

const RETRIEVABLE = ["canvas_conflict", "download_failed", "result_apply_failed", "delivery_failed", "submission_uncertain", "results_missing"] as const;
const INPUT_REJECTED = ["moderation_input", "moderation_reference", "moderation_output", "invalid_params", "context_too_long", "input_inaccessible", "input_too_large", "content_policy_violation", "sensitive_words_detected"] as const;

type Fixture = { name: string; node: CanvasNodeData; allNodes?: CanvasNodeData[] };

function node(name: string, metadata: CanvasNodeMetadata, type: CanvasNodeData["type"] = CanvasNodeType.Image): CanvasNodeData {
    return { id: name, type, title: name, position: { x: 0, y: 0 }, width: 320, height: 180, metadata };
}

function fixtures(): Fixture[] {
    const list: Fixture[] = [];
    const add = (name: string, metadata: CanvasNodeMetadata, type?: CanvasNodeData["type"]) => {
        list.push({ name, node: node(name, metadata, type) });
    };
    add("running-task", { status: "loading", taskStatus: "running", taskId: "task-running" });
    add("succeeded-with-content", { status: "success", taskStatus: "succeeded", content: "image:ok", taskId: "task-ready" });
    add("succeeded-without-content", { status: "success", taskStatus: "succeeded", taskId: "task-fetch" });
    add("submission-unknown-state", { generationSubmissionState: "unknown", status: "error", taskId: "task-sub" });
    add("submission-unknown-stage", { taskStage: "submission_unknown", status: "error", taskId: "task-stage" });
    for (const code of RETRIEVABLE) add(`legacy-retrievable-${code}`, { status: "error", generationErrorCode: code, errorDetails: "opaque", taskId: "task-legacy" });
    for (const code of INPUT_REJECTED) add(`legacy-input-${code}`, { status: "error", generationErrorCode: code, errorDetails: "opaque", taskId: "task-input" });
    add("request-not-sent", { status: "error", generationErrorCode: "request_not_sent", errorDetails: "Unable to connect to service", taskId: "task-not-sent" });
    add("cancelled", { status: "error", taskStatus: "cancelled", errorDetails: "Task canceled", taskId: "task-cancel" });
    add("text-auth", { status: "error", errorDetails: "invalid api key" });
    add("text-throttled", { status: "error", errorDetails: "too many requests" });
    add("text-network", { status: "error", errorDetails: "Failed to fetch" });
    add("target-unavailable-with-task", { status: "error", generationErrorCode: "result_target_unavailable", errorDetails: "The generated results have been saved and cannot be put back into the original node.", taskId: "task-target" });
    add("target-unavailable-without-task", { status: "error", generationErrorCode: "result_target_unavailable", errorDetails: "The generated results have been saved and cannot be put back into the original node." });
    const explicit = [
        ["explicit-running", { phase: "running", regenerate: "blocked", reason: "task_running" }],
        ["explicit-fetching", { phase: "fetching", regenerate: "blocked", reason: "result_fetching" }],
        ["explicit-ready", { phase: "ready", regenerate: "allowed", reason: "result_ready" }],
        ["explicit-retrievable", { phase: "retrievable", regenerate: "blocked", reason: "delivery_pending" }],
        ["explicit-failed-allowed", { phase: "failed", regenerate: "allowed", reason: "task_failed" }],
        ["explicit-settlement-pending", { phase: "failed", regenerate: "blocked", reason: "settlement_pending", reconcileDeadline: FUTURE_DEADLINE }],
        ["explicit-charged-unrecoverable", { phase: "failed", regenerate: "confirm", reason: "charged_result_unrecoverable" }],
        ["explicit-input-rejected", { phase: "failed", regenerate: "confirm", reason: "input_rejected" }],
    ] as const;
    for (const [name, outcome] of explicit) {
        add(name, { status: "error", taskId: "task-explicit", taskOutcome: outcome, generationErrorCode: "download_failed", errorDetails: "opaque", generationSubmissionState: "unknown", taskStage: "submission_unknown" });
    }
    add("overwrite-retrievable-then-network-text", {
        status: "error",
        taskId: "task-overwrite",
        taskOutcome: { phase: "retrievable", regenerate: "blocked", reason: "delivery_pending" },
        errorDetails: "Failed to fetch",
    });
    add("moderation-text-only", { status: "error", errorDetails: "The prompt word or reference material did not pass the content security review", taskId: "task-mod-text" });
    add("moderation-with-code", { status: "error", generationErrorCode: "sensitive_words_detected", errorDetails: "opaque", taskId: "task-mod-code" });
    add("moderation-content-code", { status: "error", generationErrorCode: "sensitive_words_detected", errorDetails: "Contains sensitive words", taskId: "task-mod-const" });
    add("batch-child", { status: "error", batchRootId: "root", taskId: "task-child", generationErrorCode: "download_failed", errorDetails: "Download failed" });
    add("depth-capture-result", { status: "error", depthSourceNodeId: "source", taskType: "depth_capture", taskId: "depth-task", taskStatus: "failed", generationErrorCode: "download_failed", errorDetails: "Failed to download generated results" }, CanvasNodeType.Video);
    return list;
}

const EXPECTED: Array<{ name: string } & CanvasNodeFailureView> = [
    {
        "name": "running-task",
        "outcome": {
            "phase": "running",
            "regenerate": "blocked",
            "reason": "task_running"
        },
        "copy": {
            "badge": "Generating",
            "reason": "Task is being generated",
            "action": "Please wait for the current task to be completed",
            "message": "The task is being generated, please wait for the current task to be completed."
        },
        "explanation": {
            "category": "unknown",
            "summary": "",
            "reason": "Build failed",
            "action": "Please review the details before deciding whether to try again",
            "message": "Build failed. Please review the details before trying again.",
            "errorCode": "unknown",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "succeeded-with-content",
        "outcome": {
            "phase": "ready",
            "regenerate": "allowed",
            "reason": "result_ready"
        },
        "copy": {
            "badge": "Completed",
            "reason": "The result is ready",
            "action": "You can directly view or regenerate a new version",
            "message": "The build results are ready for viewing directly or regenerating a new version."
        },
        "explanation": {
            "category": "unknown",
            "summary": "",
            "reason": "Build failed",
            "action": "Please review the details before deciding whether to try again",
            "message": "Build failed. Please review the details before trying again.",
            "errorCode": "unknown",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": false,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "succeeded-without-content",
        "outcome": {
            "phase": "fetching",
            "regenerate": "blocked",
            "reason": "result_fetching"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "Generation completed, retrieving results",
            "action": "The system is saving automatically, no need to regenerate",
            "message": "The generation has been completed and the results are being retrieved. The system is automatically saving and there is no need to regenerate."
        },
        "explanation": {
            "category": "unknown",
            "summary": "",
            "reason": "Build failed",
            "action": "Please review the details before deciding whether to try again",
            "message": "Build failed. Please review the details before trying again.",
            "errorCode": "unknown",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "submission-unknown-state",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "submission_unknown"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "unknown",
            "summary": "",
            "reason": "Build failed",
            "action": "Please review the details before deciding whether to try again",
            "message": "Build failed. Please review the details before trying again.",
            "errorCode": "unknown",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "submission-unknown-stage",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "submission_unknown"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "submission_uncertain",
            "summary": "",
            "reason": "The submission result has not yet been confirmed, and the upstream tasks may still be executed.",
            "action": "Please check the original task status first and do not resubmit immediately",
            "message": "The commit result has not yet been confirmed and upstream tasks may still be executing. Please check the status of the original task first and do not resubmit it immediately.",
            "errorCode": "submission_uncertain",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-retrievable-canvas_conflict",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "canvas_conflict",
            "summary": "opaque",
            "reason": "The build results have been retained and the canvas has not been updated yet",
            "action": "Please click \"Continue to retrieve\" and do not regenerate",
            "message": "The build results have been preserved and the canvas has not been updated. Please click \"Continue Retrieval\" and do not regenerate.",
            "errorCode": "canvas_conflict",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-retrievable-download_failed",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-retrievable-result_apply_failed",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "result_apply_failed",
            "summary": "opaque",
            "reason": "The generated results have been retained and have not been put back into the canvas.",
            "action": "Please click \"Continue to retrieve\" and do not regenerate",
            "message": "The generated results have been retained and have not been returned to the canvas. Please click \"Continue Retrieval\" and do not regenerate.",
            "errorCode": "result_apply_failed",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-retrievable-delivery_failed",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "delivery_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "delivery_failed",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-retrievable-submission_uncertain",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "submission_uncertain",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "submission_uncertain",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": true,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-retrievable-results_missing",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "results_missing",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "results_missing",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "legacy-input-moderation_input",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_input",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "moderation_input",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-moderation_reference",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_reference",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "moderation_reference",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-moderation_output",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_output",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "moderation_output",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-invalid_params",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "invalid_params",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "invalid_params",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-context_too_long",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "context_too_long",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "context_too_long",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-input_inaccessible",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "input_inaccessible",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "input_inaccessible",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-input_too_large",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "input_too_large",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "input_too_large",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-content_policy_violation",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_input",
            "summary": "opaque",
            "reason": "The prompt word or reference material did not pass the content security review",
            "action": "Please adjust the prompt words or reference materials and regenerate",
            "message": "The prompt word or reference material did not pass the content security review. Please adjust the prompt words or reference materials and regenerate.",
            "errorCode": "moderation_input",
            "providerCode": "content_policy_violation",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "legacy-input-sensitive_words_detected",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_input",
            "summary": "opaque",
            "reason": "The prompt word or reference material did not pass the content security review",
            "action": "Please adjust the prompt words or reference materials and regenerate",
            "message": "The prompt word or reference material did not pass the content security review. Please adjust the prompt words or reference materials and regenerate.",
            "errorCode": "moderation_input",
            "providerCode": "sensitive_words_detected",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "request-not-sent",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "not_charged"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last request was not deducted and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last request was not deducted and can be regenerated directly."
        },
        "explanation": {
            "category": "request_not_sent",
            "summary": "Unable to connect to service",
            "reason": "Unable to connect to service",
            "action": "",
            "message": "Unable to connect to service",
            "errorCode": "request_not_sent",
            "retryable": true,
            "uncertain": false,
            "blockAutomaticRetry": false,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "cancelled",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "not_charged"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last request was not deducted and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last request was not deducted and can be regenerated directly."
        },
        "explanation": {
            "category": "cancelled",
            "summary": "Task canceled",
            "reason": "Task canceled",
            "action": "You can resubmit according to the original input",
            "message": "The task has been cancelled. You can resubmit according to the original input.",
            "errorCode": "cancelled",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": false,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "text-auth",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "task_failed"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last generation was not completed and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last generation was not completed and can be regenerated directly."
        },
        "explanation": {
            "category": "auth",
            "summary": "invalid api key",
            "reason": "Model service authentication failed",
            "action": "Please check the API Key and try again",
            "message": "Model service authentication failed. Please check the API Key and try again.",
            "errorCode": "auth",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": false,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "text-throttled",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "task_failed"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last generation was not completed and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last generation was not completed and can be regenerated directly."
        },
        "explanation": {
            "category": "throttled",
            "summary": "too many requests",
            "reason": "Requests are too frequent",
            "action": "Please try again later",
            "message": "The request was made too frequently. Please try again later.",
            "errorCode": "throttled",
            "retryable": true,
            "uncertain": false,
            "blockAutomaticRetry": false,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": false,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "text-network",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "task_failed"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last generation was not completed and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last generation was not completed and can be regenerated directly."
        },
        "explanation": {
            "category": "network",
            "summary": "Failed to fetch",
            "reason": "Network connection failed",
            "action": "Please check the network and verify the status of the original task before deciding whether to regenerate it.",
            "message": "Network connection failed. Please check the network and verify the status of the original task before deciding whether to regenerate it.",
            "errorCode": "network",
            "retryable": true,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": false,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "target-unavailable-with-task",
        "outcome": {
            "phase": "failed",
            "regenerate": "blocked",
            "reason": "result_target_unavailable"
        },
        "copy": {
            "badge": "Results saved",
            "reason": "The generation results have been saved in the generation history, and the current target node has been changed.",
            "action": "Please check the results from the generation history, do not generate again",
            "message": "The generation results have been saved in the generation history, and the current target node has been changed. Please check the results from the generation history and do not generate again."
        },
        "explanation": {
            "category": "result_target_unavailable",
            "summary": "The generated results have been saved and cannot be put back into the original node.",
            "reason": "The generated results have been saved and cannot be put back into the original node.",
            "action": "Retrieved from \"Generation History\", no need to regenerate",
            "message": "The generated results have been saved and cannot be put back into the original node. Retrieve from \"Generation History\" without regenerating.",
            "errorCode": "result_target_unavailable",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": false,
        "recoveryRoute": "history",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "target-unavailable-without-task",
        "outcome": {
            "phase": "failed",
            "regenerate": "blocked",
            "reason": "result_target_unavailable"
        },
        "copy": {
            "badge": "Results saved",
            "reason": "The generation results have been saved in the generation history, and the current target node has been changed.",
            "action": "Please check the results from the generation history, do not generate again",
            "message": "The generation results have been saved in the generation history, and the current target node has been changed. Please check the results from the generation history and do not generate again."
        },
        "explanation": {
            "category": "result_target_unavailable",
            "summary": "The generated results have been saved and cannot be put back into the original node.",
            "reason": "The generated results have been saved and cannot be put back into the original node.",
            "action": "Retrieved from \"Generation History\", no need to regenerate",
            "message": "The generated results have been saved and cannot be put back into the original node. Retrieve from \"Generation History\" without regenerating.",
            "errorCode": "result_target_unavailable",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": false,
        "recoveryRoute": "history",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "explicit-running",
        "outcome": {
            "phase": "running",
            "regenerate": "blocked",
            "reason": "task_running"
        },
        "copy": {
            "badge": "Generating",
            "reason": "Task is being generated",
            "action": "Please wait for the current task to be completed",
            "message": "The task is being generated, please wait for the current task to be completed."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "explicit-fetching",
        "outcome": {
            "phase": "fetching",
            "regenerate": "blocked",
            "reason": "result_fetching"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "Generation completed, retrieving results",
            "action": "The system is saving automatically, no need to regenerate",
            "message": "The generation has been completed and the results are being retrieved. The system is automatically saving and there is no need to regenerate."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "explicit-ready",
        "outcome": {
            "phase": "ready",
            "regenerate": "allowed",
            "reason": "result_ready"
        },
        "copy": {
            "badge": "Completed",
            "reason": "The result is ready",
            "action": "You can directly view or regenerate a new version",
            "message": "The build results are ready for viewing directly or regenerating a new version."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "The result is ready",
            "action": "You can directly view or regenerate a new version",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "explicit-retrievable",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "explicit-failed-allowed",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "task_failed"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last generation was not completed and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last generation was not completed and can be regenerated directly."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "The last generation was not completed and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "explicit-settlement-pending",
        "outcome": {
            "phase": "failed",
            "regenerate": "blocked",
            "reason": "settlement_pending",
            "reconcileDeadline": "2026-04-20T06:15:00.000Z"
        },
        "copy": {
            "badge": "Checking",
            "reason": "BeefTV is checking the last submission and a conclusion is expected by 06:15",
            "action": "Do not regenerate before verification is completed",
            "message": "BeefTV is checking the last submission and a conclusion is expected by 06:15. Do not regenerate until verification is complete."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "BeefTV is checking the last submission and a conclusion is expected by 06:15",
            "action": "Do not regenerate before verification is completed",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "explicit-charged-unrecoverable",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "charged_result_unrecoverable"
        },
        "copy": {
            "badge": "The result cannot be retrieved",
            "reason": "The fee was deducted last time, but the result cannot be retrieved. It will be deducted again if it is regenerated.",
            "action": "After confirmation, a new task will be created and regenerated.",
            "message": "The fee was deducted last time, but the result cannot be recovered. If it is regenerated, it will be deducted again. After confirmation, a new task will be created and regenerated.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The fee was deducted last time, but the result cannot be recovered. If it is regenerated, it will be deducted again."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "explicit-input-rejected",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "opaque",
            "reason": "opaque",
            "action": "",
            "message": "opaque",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "overwrite-retrievable-then-network-text",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "network",
            "summary": "Failed to fetch",
            "reason": "Network connection failed",
            "action": "Please check the network and verify the status of the original task before deciding whether to regenerate it.",
            "message": "Network connection failed. Please check the network and verify the status of the original task before deciding whether to regenerate it.",
            "errorCode": "network",
            "retryable": true,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "moderation-text-only",
        "outcome": {
            "phase": "failed",
            "regenerate": "allowed",
            "reason": "task_failed"
        },
        "copy": {
            "badge": "Build failed",
            "reason": "The last generation was not completed and can be regenerated directly.",
            "action": "Can be regenerated directly",
            "message": "The last generation was not completed and can be regenerated directly."
        },
        "explanation": {
            "category": "unknown",
            "summary": "The prompt word or reference material did not pass the content security review",
            "reason": "The prompt word or reference material did not pass the content security review",
            "action": "",
            "message": "The prompt word or reference material did not pass the content security review",
            "errorCode": "unknown",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "moderation-with-code",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_input",
            "summary": "opaque",
            "reason": "The prompt word or reference material did not pass the content security review",
            "action": "Please adjust the prompt words or reference materials and regenerate",
            "message": "The prompt word or reference material did not pass the content security review. Please adjust the prompt words or reference materials and regenerate.",
            "errorCode": "moderation_input",
            "providerCode": "sensitive_words_detected",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "moderation-content-code",
        "outcome": {
            "phase": "failed",
            "regenerate": "confirm",
            "reason": "input_rejected"
        },
        "copy": {
            "badge": "Need to adjust input",
            "reason": "Prompt word, reference material or parameter failed verification",
            "action": "Please adjust the input and regenerate; continuing to submit may incur charges again",
            "message": "The prompt word, reference material or parameter failed the verification. Please adjust the input and regenerate; continuing to submit may incur charges again.",
            "confirmTitle": "Confirm to regenerate?",
            "confirmContent": "The last input did not pass verification, and regeneration may result in another deduction. It is recommended to modify the prompt words or reference materials first."
        },
        "explanation": {
            "category": "moderation_input",
            "summary": "Contains sensitive words",
            "reason": "The prompt word or reference material did not pass the content security review",
            "action": "Please adjust the prompt words or reference materials and regenerate",
            "message": "The prompt word or reference material did not pass the content security review. Please adjust the prompt words or reference materials and regenerate.",
            "errorCode": "moderation_input",
            "providerCode": "sensitive_words_detected",
            "retryable": false,
            "uncertain": false,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": true
        },
        "retryBlocked": false,
        "regenerateBlocked": false,
        "regenerateConfirm": true,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": true,
        "pendingOutcome": false,
        "depthResult": false,
        "batchRegenerateVisible": true
    },
    {
        "name": "batch-child",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "Download failed",
            "reason": "Download failed",
            "action": "",
            "message": "Download failed",
            "errorCode": "download_failed",
            "retryable": false,
            "uncertain": true,
            "blockAutomaticRetry": true,
            "blockManualRetry": true,
            "moderation": false
        },
        "retryBlocked": true,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": false,
        "needsRecovery": true,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": true,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": false,
        "batchRegenerateVisible": false
    },
    {
        "name": "depth-capture-result",
        "outcome": {
            "phase": "retrievable",
            "regenerate": "blocked",
            "reason": "delivery_pending"
        },
        "copy": {
            "badge": "Retrieving results",
            "reason": "The last generated result has been retained and is being retrieved automatically by the system.",
            "action": "Please wait for the retrieval to be completed and do not generate it again.",
            "message": "The last generation result has been retained and the system is automatically retrieving it. Please wait for the retrieval to complete and do not generate it again."
        },
        "explanation": {
            "category": "download_failed",
            "summary": "Failed to download generated results",
            "reason": "Depth processing failed",
            "action": "Please check the details, check the deepin component and network and try again",
            "message": "Failed to download build results. Troubleshooting number: task depth-task.",
            "errorCode": "download_failed",
            "taskId": "depth-task",
            "retryable": true,
            "uncertain": false,
            "blockAutomaticRetry": false,
            "blockManualRetry": false,
            "moderation": false
        },
        "retryBlocked": false,
        "regenerateBlocked": true,
        "regenerateConfirm": false,
        "canReload": true,
        "needsRecovery": false,
        "recoveryRoute": "single",
        "cardSubmissionUncertain": false,
        "batchSubmissionUncertain": false,
        "moderationResetOnPromptEdit": false,
        "pendingOutcome": true,
        "depthResult": true,
        "batchRegenerateVisible": false
    }
] as Array<{ name: string } & CanvasNodeFailureView>;

describe("canvasNodeFailureView", () => {
    test("reads and caches only the requested field", () => {
        const item = node("lazy", { status: "error", taskOutcome: { phase: "failed", regenerate: "allowed", reason: "task_failed" } });
        let reads = 0;
        Object.defineProperty(item.metadata, "errorDetails", { get() { reads++; return "opaque"; } });
        const view = canvasNodeFailureView(item);
        expect(view.regenerateBlocked).toBe(false);
        expect(reads).toBe(0);
        const explanation = view.explanation;
        const afterFirstRead = reads;
        expect(afterFirstRead).toBeGreaterThan(0);
        expect(view.explanation).toBe(explanation);
        expect(reads).toBe(afterFirstRead);
    });

    test("locks today's display and action decisions for every recorded node", () => {
        Date.now = () => NOW_MS;
        try {
            const built = fixtures();
            expect(built.map((item) => item.name)).toEqual(EXPECTED.map((item) => item.name));
            for (const [index, fixture] of built.entries()) {
                const expected = EXPECTED[index];
                const view = canvasNodeFailureView(fixture.node, { nowMs: NOW_MS, allNodes: fixture.allNodes });
                const expectedView = {
                    outcome: expected.outcome ?? undefined,
                    copy: expected.copy,
                    explanation: expected.explanation,
                    retryBlocked: expected.retryBlocked,
                    regenerateBlocked: expected.regenerateBlocked,
                    regenerateConfirm: expected.regenerateConfirm,
                    canReload: expected.canReload,
                    needsRecovery: expected.needsRecovery,
                    recoveryRoute: expected.recoveryRoute,
                    cardSubmissionUncertain: expected.cardSubmissionUncertain,
                    batchSubmissionUncertain: expected.batchSubmissionUncertain,
                    moderationResetOnPromptEdit: expected.moderationResetOnPromptEdit,
                    pendingOutcome: expected.pendingOutcome,
                    depthResult: expected.depthResult,
                    batchRegenerateVisible: expected.batchRegenerateVisible,
                };
                // Read every public field, including lazily computed getters.
                const actual = Object.fromEntries((Object.keys(expectedView) as Array<keyof CanvasNodeFailureView>).map((key) => [key, view[key]]));
                expect(actual, fixture.name).toEqual(expectedView);
                const restored = JSON.parse(JSON.stringify(persistCanvasNodeFailure(fixture.node))) as CanvasNodeData;
                const reopened = canvasNodeFailureView(restored, { nowMs: NOW_MS, allNodes: fixture.allNodes });
                const savedView = Object.fromEntries((Object.keys(expectedView) as Array<keyof CanvasNodeFailureView>).map(key => [key, reopened[key]]));
                expect(savedView, `${fixture.name} saved and reopened`).toEqual(expectedView);
            }
        } finally {
            Date.now = realNow;
        }
    });
});

afterEach(() => {
    Date.now = realNow;
});
