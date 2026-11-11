import referenceVideoErrors from "./fixtures/reference-video-errors.json";
import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/services/api/request";

test("reference transport admission identifies blocked inputs and survives persisted display", () => {
    const message = "The current channel requires online material links: reference picture 2, reference video 1 cannot be read directly. Please replace with an accessible HTTPS link, or switch to a channel that supports local content";
    const failure = explainGenerationError(new ApiError(message, { status: 400, reason: "reference_media_requires_url" }));
    expect(failure.category).toBe("invalid_params");
    expect(failure.message).toContain("Reference picture 2, reference video 1");
    expect(failure.action).toContain("HTTPS");
    expect(failure.blockAutomaticRetry).toBe(true);
    expect(explainGenerationError(failure.message).reason).toBe(failure.reason);
});

test("Windows socket disconnects explain saved historical errors without exposing network details", () => {
    for (const detail of ["An existing connection was forcibly closed by the remote host.", "An established connection was aborted by the software in your host machine."]) {
        const failure = explainGenerationError(`Get "https://private.example/task?token=secret": read tcp: wsarecv: ${detail}`);
        expect(failure.category).toBe("network");
        expect(failure.message).not.toMatch(/wsarecv|secret|private\.example/);
    }
});

test("local task persistence errors keep their cause through API and saved details", () => {
    const error = new ApiError("The local task failed to save and the generation has not yet been submitted.", { status: 500, reason: "local_storage_failed" });
    const result = explainGenerationError(error);
    expect(result.category).toBe("local_storage");
    expect(result.message).toContain("The build has not been submitted yet");
    expect(result.message).not.toContain("Model does not accept");
    expect(result.blockAutomaticRetry).toBe(true);
    expect(explainGenerationError(result.message).category).toBe("local_storage");
    const diagnostics = formatGenerationDiagnostics(result);
    expect(diagnostics).toContain("Category: local_storage");
    expect(diagnostics).toContain("Error source: local task storage");
    expect(diagnostics).toContain("The build has not been submitted yet");
});

test("local API quota keeps the actual capacity error instead of channel permissions", () => {
    const result = explainGenerationError(new ApiError("The account task history has reached the upper limit of 100 items.", {status: 403, code: 40301, reason: "quota_exceeded"}));
    expect(result.category).toBe("quota_limit");
    expect(result.reason).toContain("100 limit");
    expect(result.action).toContain("clean up");
    expect(result.message).not.toMatch(/权限|供应商|账单/);
    expect(result.blockAutomaticRetry).toBe(true);
});
import audioErrorContract from "../../fixtures/reference-audio-errors.json";

test("local database failures never blame model parameters", () => {
    for (const message of ["table tasks has no column named failure_diagnostics", "no such column: failure_diagnostics", "no such table: tasks", "database is locked", "attempt to write a readonly database", "disk I/O error", "UNIQUE constraint failed: tasks.id", "NOT NULL constraint failed: tasks.type", "CHECK constraint failed: task_status", "FOREIGN KEY constraint failed"]) {
        for (const input of [message, new Error(message), { status: 400, code: 400, reason: "invalid_argument", message }, { status: 500, data: { error: { code: "invalid_argument", message } } }]) {
            const failure = explainGenerationError(input);
            expect(failure.category).toBe("local_storage");
            expect(failure.reason).toContain("database");
            expect(failure.message).not.toContain("failure_diagnostics");
            expect(failure.retryable).toBe(false);
            expect(failure.blockAutomaticRetry).toBe(true);
            expect(explainGenerationError({ code: failure.category, message: failure.message }).category).toBe("local_storage");
        }
    }
});

test("database classification preserves provider parameters and stable codes", () => {
    for (const prompt of ["UNIQUE constraint failed: tasks.id", "NOT NULL constraint failed: tasks.type", "CHECK constraint failed: task_status", "FOREIGN KEY constraint failed"]) {
        expect(explainGenerationError({ error: { code: "invalid_parameter", message: "invalid size" }, prompt }).category).toBe("invalid_params");
    }
    for (const input of [{ error: { code: "invalid_parameter", message: "invalid size" }, prompt: "table tasks has no column named failure_diagnostics" }, { error: { code: "invalid_parameter", message: "invalid size" } }]) {
        expect(explainGenerationError(input).category).toBe("invalid_params");
    }
    expect(explainGenerationError({ status: 500, data: { code: "local_storage", message: "" } }).category).toBe("local_storage");
});

test("canvas save conflicts are not vendor parameter failures", () => {
    const saveConflict = new ApiError("The cloud canvas has been updated and coverage has stopped; please keep the local draft and load the latest version", { status: 409, reason: "conflict" });
    const explained = explainGenerationError(saveConflict);
    expect(explained.category).toBe("canvas_conflict");
    expect(explained.action).toContain("Don't regenerate");
    expect(explained.message).not.toContain("Model does not accept");
    expect(explainGenerationError(explained.message).category).toBe("canvas_conflict");

    expect(explainGenerationError(new ApiError("Save failed", { status: 409, reason: "stale_revision" })).category).toBe("canvas_conflict");
    expect(explainGenerationError({ code: "canvas_conflict", message: "The build results are preserved, but the canvas has a version conflict. Please use the latest version of canvas first, and then reload the resources. Do not regenerate." }).category).toBe("canvas_conflict");
    expect(explainGenerationError(new Error("The canvas has unprocessed external changes and has not been submitted this time.")).category).toBe("canvas_conflict");
});

test("image receipt states never invite automatic paid regeneration", () => {
    for (const code of ["image_result_unknown", "image_submission_pending", "image_result_expired", "image_result_unavailable", "idempotency_conflict"]) {
        const failure = explainGenerationError({ status: 409, data: { error: { code, message: "" } } });
        expect(failure.category).toBe("submission_uncertain");
        expect(failure.blockAutomaticRetry).toBe(true);
        expect(failure.retryable).toBe(false);
    }
});

test("whole request limits retain actionable copy after persistence", () => {
    for (const body of ["", "<html>413 Request Entity Too Large</html>"]) expect(explainGenerationError({ status: 413, data: body }).reason).toContain("entire request");
    for (const raw of ["video request body is too large", "video request body exceeds the 64 MiB request limit; use public media URLs instead of inline base64", { error: { code: "video_request_body_too_large", message: "" } }]) {
        const failure = explainGenerationError(raw);
        for (const got of [failure, explainGenerationError({ code: failure.category, message: `${failure.reason}。${failure.action}。` })]) {
            expect(got.category).toBe("input_too_large");
            expect(got.reason).toContain("entire request");
            expect(got.action).toContain("Material link");
            expect(got.retryable).toBe(false);
        }
    }
});

test("actual persisted task output contract renders identically in the frontend", () => {
    for (const fixture of audioErrorContract) {
        // Backend app test writes the corresponding upstream failure through the
        // real terminal coordinator and DB, then asserts this exact list payload.
        const error = `${fixture.display}. Troubleshooting number: Request req_reference_audio_123.`;
        const result = explainGenerationError({ code: "invalid_params", message: error });
        expect(result.message).toBe(error);
        expect(result.category).toBe("invalid_params");
        expect(result.requestId).toBe("req_reference_audio_123");
        expect(result.blockAutomaticRetry).toBe(true);
    }
});

describe("measured reference audio API errors", () => {
    const requestId = "202609270829245377912978268d9d6USz1NP3R";
    const cases = [
        ["reference audio 2 is 0.900 seconds; use audio between 2 and 15 seconds", ["Paragraph 2", "0.900 seconds", "2–15 seconds", "Crop"]],
        ["reference audio 1 is 31.250 seconds; use audio between 2 and 30 seconds", ["Paragraph 1", "31.250 seconds", "2–30 seconds", "Replace"]],
        ["reference audio is 35.500 seconds in total; this model accepts at most 30 seconds of reference audio", ["total duration", "35.500 seconds", "30 seconds", "reduce"]],
        ["reference audio 3: could not download reference audio within the allowed time and URL policy", ["Paragraph 3", "Unable to download", "Reupload", "public access"]],
        ["reference audio 2: reference audio duration could not be measured: invalid WAV audio", ["Paragraph 2", "The format or duration cannot be read", "MP3", "WAV"]],
        ["reference audio 1: reference audio duration could not be measured: the media contains no readable audio track", ["Paragraph 1", "audio track", "Re-export"]],
        ["reference audio 1 exceeds the model's 15728640 byte limit", ["Paragraph 1", "File too large", "Compression"]],
        ["reference audio 1 requires a public HTTPS URL", ["Paragraph 1", "Unable to download", "public access"]],
        ["reference audio 2: reference audio download returned HTTP 403", ["Paragraph 2", "Unable to download", "Reupload"]],
        ["reference audio 2: reference audio could not be downloaded completely within the allowed time", ["Paragraph 2", "Unable to download", "Reupload"]],
        ["reference audio 2: reference audio must be at most 15 MiB", ["Paragraph 2", "File too large", "Compression"]],
        ["reference audio 2: reference audio URL is not allowed", ["Paragraph 2", "Unable to download", "public access"]],
    ] as const;
    for (const [message, fragments] of cases) {
        test(`HTTP, gateway wrapper and persisted details: ${message}`, () => {
            const body = { error: { code: "invalid_reference_audio", type: "invalid_request_error", message }, request_id: requestId };
            for (const input of [{ response: { status: 400, data: body } }, `Interface request failed:${JSON.stringify(body)} (request id: ${requestId})`]) {
                const first = explainGenerationError(input);
                const metadata = generationFailureMetadata(input, "test prompt");
                const persisted = explainGenerationError({ code: metadata.generationErrorCode, message: metadata.errorDetails });
                for (const failure of [first, persisted]) {
                    expect(failure.category).toBe("invalid_params");
                    expect(failure.retryable).toBe(false);
                    expect(failure.blockAutomaticRetry).toBe(true);
                    expect(failure.requestId).toBe(requestId);
                    for (const fragment of fragments) expect(failure.message).toContain(fragment);
                }
            }
        });
    }
    test("unknown validation detail is actionable without reflecting secrets", () => {
        const failure = explainGenerationError({ status: 400, data: { error: { code: "invalid_reference_audio", message: "private detail https://secret.test/audio?token=abc prompt=private_words" }, request_id: requestId } });
        expect(failure.message).toContain("Check reference audio");
        expect(failure.message).not.toMatch(/secret|private|token/);
        expect(failure.requestId).toBe(requestId);
        expect(failure.blockAutomaticRetry).toBe(true);
        const badWav = explainGenerationError({ status: 400, data: { error: { code: "invalid_reference_audio", message: "reference audio 2: reference audio duration could not be measured: invalid WAV audio" }, request_id: requestId } });
        expect(badWav.message).not.toContain("M4A");
    });

    test("structured 4xx Chinese upload and reference-count messages pass through with Chinese request IDs", () => {
        const upload400 = explainGenerationError({
            status: 400,
            data: {
                error: {
                    code: "video_reference_upload_invalid",
                    type: "video_reference_upload_invalid",
                    message: "File not recognized. Use PNG, JPEG, WebP, GIF, BMP or TIFF for images. For videos use MP4 or MOV. For audio use MP3 or WAV.",
                },
                request_id: requestId,
            },
        });
        expect(upload400.category).toBe("invalid_params");
        expect(upload400.reason).toBe("File not recognized");
        expect(upload400.action).toContain("Audio in MP3 or WAV");
        expect(upload400.requestId).toBe(requestId);
        expect(upload400.blockAutomaticRetry).toBe(true);

        const count400 = explainGenerationError(
            `{"error":{"code":"invalid_video_parameters","type":"invalid_request_error","message":"The current model supports up to 9 reference pictures. Please reduce the reference pictures (10 are passed in this time) before submitting (request number:${requestId})"}}`,
        );
        expect(count400.category).toBe("invalid_params");
        expect(count400.reason).toBe("The current model supports up to 9 reference images");
        expect(count400.action).toBe("Please reduce the number of reference images (input 10 this time) before submitting");
        expect(count400.requestId).toBe(requestId);
        expect(count400.message).not.toContain("Request number:");

        const persistedItem = explainGenerationError(`Reference Audio 1: File not recognized. Use PNG, JPEG, WebP, GIF, BMP or TIFF for images. For videos use MP4 or MOV. For audio use MP3 or WAV. Troubleshooting Number: Request${requestId}。`);
        expect(persistedItem.category).toBe("invalid_params");
        expect(persistedItem.reason).toBe("Reference Audio 1: File not recognized");
        expect(persistedItem.requestId).toBe(requestId);

        const futureServer = explainGenerationError({
            status: 400,
            data: `{"error":{"code":"invalid_video_parameters","type":"invalid_request_error","message":"当前模型不支持同时传入首尾帧和参考音频，请移除其一后再提交"}} (请求编号: ${requestId})`,
        });
        expect(futureServer.category).toBe("invalid_params");
        const persistedFuture = explainGenerationError(futureServer.message);
        expect(persistedFuture.category).toBe("invalid_params");
        expect(persistedFuture.reason).toBe("The current model does not support passing in first and last frames and reference audio at the same time");
        expect(persistedFuture.action).toBe("Please remove one of them before submitting");
        expect(persistedFuture.requestId).toBe(requestId);

        const busy503 = explainGenerationError({
            status: 503,
            data: { error: { code: "invalid_request_error", message: "The service is currently busy, please try again later." } },
        });
        expect(busy503.category).toBe("provider_unavailable");
        expect(busy503.retryable).toBe(true);

        const busy503Type = explainGenerationError({
            status: 503,
            data: { error: { type: "invalid_request_error", code: "custom_gateway_code", message: "The service is currently busy, please try again later." } },
        });
        expect(busy503Type.category).toBe("provider_unavailable");
        expect(busy503Type.retryable).toBe(true);

        expect(explainGenerationError("The current model service is temporarily unavailable, please try again later.").category).not.toBe("invalid_params");
        expect(explainGenerationError("Generation failed, please try again").category).not.toBe("invalid_params");
        expect(explainGenerationError("Generation failed, please adjust and try again").category).not.toBe("invalid_params");
        expect(explainGenerationError("The request frequency is too high, please adjust the request time and try again.").category).not.toBe("invalid_params");
        expect(explainGenerationError("The generated results have not been retrieved yet. Click \"Continue Retrieval\" to continue downloading the original results and will not regenerate them.").category).not.toBe("invalid_params");
        expect(explainGenerationError({ status: 400, data: { error: { message: "Video result download failed, please try again later." } } }).category).toBe("download_failed");
        expect(explainGenerationError({ status: 400, data: { error: { code: "invalid_request_error", message: "Video result download failed, please try again later." } } }).category).toBe("download_failed");
        expect(explainGenerationError({ status: 400, data: { error: { type: "invalid_request_error", message: "The interface does not return pictures" } } }).category).toBe("results_missing");
        expect(explainGenerationError({ status: 400, data: { error: { code: "invalid_request_error", message: "failed to fetch" } } }).category).toBe("network");
        expect(explainGenerationError({ status: 400, data: { error: { type: "invalid_request_error", message: "Task canceled" } } }).category).toBe("cancelled");
        expect(explainGenerationError({ status: 503, data: { error: { code: "invalid_request_error", message: "Video result download failed, please try again later." } } }).category).toBe("provider_unavailable");
        expect(explainGenerationError({ status: 403, data: { error: { code: "invalid_request_error", message: "failed to fetch" } } }).category).toBe("permission");
        expect(explainGenerationError({ status: 400, data: { error: { code: "invalid_request", message: "Video result download failed, please try again later." } } }).category).toBe("invalid_params");
        expect(explainGenerationError({ data: { error: { message: "The upstream service is temporarily unavailable, please try again later." } } }).reason).toContain("The upstream service is temporarily unavailable");
        expect(explainGenerationError({ status: 200, data: { error: { message: "The upstream service is temporarily unavailable, please try again later." } } }).reason).toContain("The upstream service is temporarily unavailable");

        const containerPath = explainGenerationError({
            status: 400,
            data: { error: { code: "invalid_video_parameters", message: "Failed to read file /app/uploads/customer-secret.png" } },
        });
        expect(containerPath.message).not.toContain("/app/");
        expect(containerPath.message).not.toContain("customer-secret");
        expect(containerPath.message).not.toContain("[path hidden]");
    });
    test("local total limit and combined diagnostic IDs survive persistence", () => {
        const raw = "The total duration of the reference audio is 16.00 seconds, and the current model supports up to 15 seconds; please crop or reduce the reference audio before submitting";
        const first = explainGenerationError(raw, { taskId: "task_existing_123", providerRequestId: requestId });
        const second = explainGenerationError({ code: first.category, message: first.message });
        expect(second.message).toBe(first.message);
        expect(second.requestId).toBe(requestId);
        expect(second.taskId).toBe("task_existing_123");
        expect(second.message).toContain("16.00 seconds");
        expect(second.message).toContain("15 seconds");
        expect(second.category).toBe("invalid_params");
        expect(second.blockAutomaticRetry).toBe(true);
    });
});

test("height, aspect, pixel and request-size errors stay human and never leak JSON", () => {
    const height = '{"error":{"code":"400","message":"Height must be between 300px and 6000px","type":"api_error"}} (request id: 202609270829245377912978268d9d6USz1NP3R)';
    const failure = explainGenerationError(height);
    expect(failure.category).toBe("invalid_params");
    expect(failure.action).toContain("300–6000 pixels");
    expect(failure.requestId).toBe("202609270829245377912978268d9d6USz1NP3R");
    expect(failure.message).not.toContain("{");
    expect(explainGenerationError({ code: failure.category, message: failure.message }).action).toContain("300–6000 pixels");
    expect(explainGenerationError({ code: failure.category, message: failure.message }).category).toBe("invalid_params");
    expect(explainGenerationError({ code: "invalid_parameter", message: "aspect ratio must be between 0.4 and 2.5" }).action).toContain("0.4–2.5");
    expect(explainGenerationError({ code: "invalid_parameter", message: "pixel count must be between 409600 and 8295044" }).reason).toContain("Total number of pixels");
    expect(explainGenerationError({ status: 413, data: { error: { message: "Request entity too large" } } }).reason).toContain("entire request");
    expect(explainGenerationError({ status: 413, data: { error: { message: "image file too large" } } }).reason).toContain("single reference file");
    const persisted = explainGenerationError("The first reference image is 200 pixels high and requires 300–6000 pixels; please resize or replace before submitting");
    expect(persisted.reason).toContain("Picture 1");
    expect(persisted.category).toBe("invalid_params");
});

test("gateway JSON suffix retains reference duration advice and request id", () => {
    const raw = '{"error":{"code":"400","message":"素材转换失败: Duration must be between 1.8s and 30.2s.","type":"api_error"}} (request id: 202609270829245377912978268d9d6USz1NP3R)';
    const failure = explainGenerationError(raw);
    expect(failure.category).toBe("invalid_params");
    expect(failure.reason).toBe("The duration of the reference material does not meet the model requirements");
    expect(failure.action).toContain("1.8–30.2 seconds");
    expect(failure.requestId).toBe("202609270829245377912978268d9d6USz1NP3R");
    expect(failure.blockAutomaticRetry).toBe(true);
    expect(explainGenerationError({ code: "video_submission_unknown", task_id: "task-known-123" }).uncertain).toBe(true);
});

import {
    explainGenerationError,
    formatGenerationDiagnostics,
    generationErrorMessage,
    generationFailureMetadata,
    generationInputFingerprint,
    isContentModerationError,
    shouldBlockAutomaticRetry,
    unchangedModeratedPrompt,
} from "../src/lib/generation-error";
import { readFetchError, readStatusError } from "../src/services/api/image-response";
import { ChannelResponseError, normalizeChannelFailure } from "../src/services/api/channel-transport";
import { AxiosError } from "axios";
import gatewayCodes from "../../fixtures/generation-error-codes.json";

describe("generation error classification", () => {
    test("all declared gateway error codes match the shared backend contract", () => {
        expect(Object.keys(gatewayCodes)).toHaveLength(53);
        for (const [code, category] of Object.entries(gatewayCodes)) {
            expect(explainGenerationError({ code, message: "opaque provider message" }).category).toBe(category);
            expect(explainGenerationError({ status: 400, data: { error: { code } } }).category).toBe(category);
        }
    });
    test("canonical categories survive persistence and structured codes without HTTP", () => {
        for (const code of ["moderation_reference", "moderation_output", "quota_user", "invalid_params", "download_failed"] as const) {
            const failure = explainGenerationError({ code, message: explainGenerationError({ code }).message });
            expect(failure.category).toBe(code);
        }
        expect(explainGenerationError({ code: "insufficient_user_quota" }).action).toContain("Balance");
        expect(explainGenerationError({ code: "no_available_channel" }).category).toBe("provider_unavailable");
        expect(explainGenerationError({ code: "channel:invalid_key" }).category).toBe("provider_unavailable");
        expect(explainGenerationError({ status: 405, message: "405 Method Not Allowed" }).category).toBe("model_missing");
        expect(explainGenerationError({ status: 501, message: "Not Implemented" }).category).toBe("model_missing");
    });

    test("copy diagnostics validates context at the final boundary", () => {
        const failure = explainGenerationError({ code: "invalid_api_key" });
        expect(failure.providerCode).toBe("invalid_api_key");
        const copied = formatGenerationDiagnostics(failure, {
            taskId: "https://private.example/?token=PRIVATE",
            providerRequestId: "secret-PRIVATE",
            model: "Authorization: Bearer PRIVATE",
            createdAt: "Cookie: session=PRIVATE",
        });
        expect(copied).not.toContain("PRIVATE");
        expect(copied).not.toContain("https://");
    });

    test("ambiguous moderation and structured prompt echoes do not invent a cause", () => {
        const text = "Your prompt or reference image was blocked by the content safety policy.";
        expect(explainGenerationError(text).reason).toContain("Prompt words or reference materials");
        expect(explainGenerationError({ error: { message: text } }).reason).toContain("Prompt words or reference materials");
        expect(explainGenerationError({ error: { code: "novel_error" }, prompt: "blocked by content safety policy" }).moderation).toBe(false);
        expect(explainGenerationError({ error: { message: "opaque prompt=blocked by content safety policy" } }).moderation).toBe(false);
    });

    test("HTTP fallback survives HTML and nested Axios responses", () => {
        expect(explainGenerationError({ status: 402, data: "<html>private</html>" }).category).toBe("quota_unknown");
        expect(explainGenerationError({ status: 429, data: "<html>private</html>" }).category).toBe("throttled");
        expect(explainGenerationError({ response: { status: 429, data: { error: { code: "insufficient_user_quota" } } } }).category).toBe("quota_user");
    });

    test("spaced credentials and arbitrary prompt text are never echoed", () => {
        for (const suffix of ["Authorization: Bearer PRIVATE VALUE", "Cookie: session=PRIVATE", "api_key = PRIVATE", "prompt = PRIVATE WORDS"]) {
            expect(generationErrorMessage(`Operation failed${suffix}`)).not.toContain("PRIVATE");
        }
    });

    test("only proven parameter limits are quoted", () => {
        expect(explainGenerationError({ code: "invalid_parameter", message: "duration must be between 2 and 10 seconds" }).action).toContain("2–10 seconds");
        expect(explainGenerationError({ code: "invalid_parameter", message: "duration invalid" }).action).not.toContain("sec");
        expect(explainGenerationError({ code: "invalid_parameter", message: "prompt=duration must be between 2 and 10 seconds" }).action).not.toContain("2–10");
    });

    test("same reference identity with replaced content unlocks moderation retry", () => {
        const metadata = generationFailureMetadata({ code: "prompt_blocked" }, "p", [{ id: "ref1", storageKey: "old.png" }]);
        expect(unchangedModeratedPrompt(metadata, "p", [{ id: "ref1", storageKey: "new.png" }])).toBe(false);
    });

    test("unsafe same-input bulk retries are blocked", () => {
        for (const code of ["invalid_params", "auth", "quota_user", "timeout", "submission_uncertain", "download_failed", "results_missing", "unknown"]) {
            expect(shouldBlockAutomaticRetry({ code })).toBe(true);
        }
        expect(shouldBlockAutomaticRetry({ code: "throttled" })).toBe(false);
    });
    test("openai json keeps structured invalid params", () => {
        const explained = explainGenerationError({
            status: 400,
            data: { error: { message: "Invalid size", type: "invalid_request_error", param: "size", code: "invalid_request" }, request_id: "req_abc123" },
        });
        expect(explained.category).toBe("invalid_params");
        expect(explained.message).toContain("parameters");
        expect(explained.requestId).toBe("req_abc123");
    });

    test("gemini json uses status over http 400", () => {
        const explained = explainGenerationError({
            status: 400,
            data: { error: { code: 400, message: "API key not valid", status: "UNAUTHENTICATED" } },
        });
        expect(explained.category).toBe("auth");
        expect(explained.message).toContain("Authentication");
    });

    test("dashscope url error is inaccessible media", () => {
        const explained = explainGenerationError({
            status: 400,
            data: { code: "InvalidParameter", message: "url error, please check url！", request_id: "req-dash-1" },
        });
        expect(explained.category).toBe("input_inaccessible");
    });

    test("newapi length error is context too long", () => {
        const explained = explainGenerationError({
            status: 200,
            data: { code: "RequestParameterIsWrong", data: null, msg: "Parameters: length of prompt: 23142 is greater than the maximum length of 10000" },
        });
        expect(explained.category).toBe("context_too_long");
    });

    test("http 402 without body is unknown billing", () => {
        const explained = explainGenerationError({ status: 402, message: "Model service request failed" });
        expect(explained.category).toBe("quota_unknown");
        expect(explained.message).toContain("Billing or quota");
        expect(explained.message).not.toContain("Balance");
        expect(explained.message).not.toContain("return");
    });

    test("http 451 safety body is moderation", () => {
        const explained = explainGenerationError({
            status: 451,
            data: "Your prompt or reference image was blocked by the content safety policy. Please adjust your prompt or reference image and try again.",
        });
        expect(explained.moderation).toBe(true);
        expect(explained.message).toContain("Content security review");
        expect(explained.blockAutomaticRetry).toBe(true);
    });

    test("http 451 alone is not safety", () => {
        const explained = explainGenerationError({ status: 451, message: "Unavailable For Legal Reasons" });
        expect(explained.moderation).toBe(false);
    });

    test("429 quota vs rate", () => {
        expect(explainGenerationError({ status: 429, data: { error: { code: "insufficient_quota", message: "You exceeded your current quota" } } }).category).toBe("quota_unknown");
        expect(explainGenerationError({ status: 429, data: { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } } }).category).toBe("throttled");
        expect(explainGenerationError({ status: 429 }).category).toBe("throttled");
    });

    test("same status different causes", () => {
        expect(explainGenerationError({ status: 400, data: { error: { code: "content_policy_violation", message: "blocked" } } }).moderation).toBe(true);
        expect(explainGenerationError({ status: 400, data: { error: { code: "invalid_request", message: "bad size" } } }).category).toBe("invalid_params");
    });

    test("wrapped string errors still parse json", () => {
        const raw = 'Interface request failed: {"error":{"message":"Your prompt or reference image was blocked by the content safety policy.","code":"content_policy_violation"}}';
        expect(explainGenerationError(raw).moderation).toBe(true);
    });

    test("nonjson html does not leak", () => {
        const explained = explainGenerationError({ status: 502, data: "<!DOCTYPE html><html><body>nginx 502 api-key=secret</body></html>" });
        expect(explained.category).toBe("provider_unavailable");
        expect(explained.message).not.toContain("nginx");
        expect(explained.message).not.toContain("secret");
        expect(explained.message).not.toContain("<html");
    });

    test("malicious credential url and prompt are stripped", () => {
        const explained = explainGenerationError({
            status: 400,
            data: { error: { message: "blocked by content policy prompt=secret-words api-key=sk-live-secret https://cdn.example.com/file?signature=abc", code: "content_policy_violation" }, request_id: "secret-trace" },
        });
        expect(explained.message).not.toContain("sk-live-secret");
        expect(explained.message).not.toContain("secret-words");
        expect(explained.message).not.toContain("https://");
        expect(explained.requestId).toBeUndefined();
    });

    test("http urls in transport summaries are stripped without mangling as local paths or dropping trailing causes", () => {
        for (const msg of [
            'The preparation of this request failed: Get "https://beeftv.app/v1/models": EOF',
            'Post "https://beeftv.app/v1/media/tasks": connection reset by peer',
            'Put "https://storage.example.com/media/uploads/part1?X-Amz-Signature=secret": unexpected EOF',
        ]) {
            const text = formatGenerationDiagnostics(explainGenerationError({ code: "request_not_sent" }), {
                failureDiagnostics: {
                    source: "local_network",
                    summary: msg,
                },
            });
            expect(text).not.toContain("[path hidden]");
            expect(text).not.toContain("beeftv.app");
            expect(text).not.toContain("secret");
            expect(text).toMatch(/EOF|connection reset by peer/);
        }
    });

    test("numbers in messages are not http codes", () => {
        const explained = explainGenerationError({ data: { error: { message: "task 402 failed internally", code: "internal_error" }, request_id: "req_safe_1" } });
        expect(explained.category).not.toBe("quota_unknown");
    });

    test("unknown fields stay unknown and do not dump json", () => {
        const explained = explainGenerationError({ status: 400, data: { error: { mystery: true, trace: "private" } } });
        expect(explained.category).toBe("invalid_params");
        expect(explained.message).not.toContain("private");
        expect(explained.message).not.toContain("mystery");
    });

    test("2xx business error still classifies", () => {
        expect(explainGenerationError({ status: 200, data: { code: "sensitive_words_detected", message: "prompt rejected" } }).moderation).toBe(true);
    });

    test("async poll download and missing results", () => {
        expect(explainGenerationError("Video result download failed (task task-1): The model service is temporarily unavailable").category).toBe("download_failed");
        expect(shouldBlockAutomaticRetry("Video result download failed (task task-1): The model service is temporarily unavailable")).toBe(true);
        expect(explainGenerationError("The interface does not return pictures").category).toBe("results_missing");
        expect(explainGenerationError(new Error("Task failed"), { stage: "submission_unknown" }).category).toBe("submission_uncertain");
        expect(shouldBlockAutomaticRetry("Build failed", "submission_unknown")).toBe(true);
    });

    test("does not promise refunds", () => {
        expect(generationErrorMessage({ status: 400, data: { code: "sensitive_words_detected" } })).not.toContain("return");
        expect(generationErrorMessage({ status: 400, data: { code: "sensitive_words_detected" } })).not.toContain("Points");
    });

    test("changing reference unlocks moderation retry", () => {
        const metadata = generationFailureMetadata({ status: 400, data: { error: { message: "Your prompt or reference image was blocked by the content safety policy." } } }, "same prompt", [{ id: "ref-1" }]);
        expect(unchangedModeratedPrompt(metadata, "same prompt", [{ id: "ref-1" }])).toBe(true);
        expect(unchangedModeratedPrompt(metadata, "same prompt", [{ id: "ref-2" }])).toBe(false);
        expect(unchangedModeratedPrompt({ generationErrorCode: "moderation_input", errorDetails: "Content security review" }, "same prompt", [{ id: "ref-2" }])).toBe(false);
    });

    test("missing fingerprint does not trap the user", () => {
        expect(unchangedModeratedPrompt({ generationErrorCode: "moderation_input", errorDetails: "Content security review" }, "prompt")).toBe(false);
    });

    test("input fingerprint changes with references", () => {
        expect(generationInputFingerprint("p", [{ id: "a" }])).not.toBe(generationInputFingerprint("p", [{ id: "b" }]));
    });

    test("diagnostics copy is safe", () => {
        const explanation = explainGenerationError({ status: 400, data: { error: { code: "invalid_request", message: "bad" } }, message: "bad" }, { taskId: "task_safe_1", model: "demo-model" });
        const text = formatGenerationDiagnostics(explanation, { taskId: "task_safe_1", model: "demo-model", createdAt: "2026-09-26T00:00:00.000Z" });
        expect(text).toContain("Task ID: task_safe_1");
        expect(text).toContain("Model: demo-model");
        expect(text).not.toContain("api-key");
    });

    test("diagnostics use the failed task model and distinguish body size from transmission", () => {
        const text = formatGenerationDiagnostics(explainGenerationError({ code: "request_not_sent" }), {
            model: "beeftv::seedance-2.0-fast",
            failureDiagnostics: {
                source: "unknown",
                input: { model: "minimax-h3", promptChars: 10, imageCount: 3, videoCount: 0, audioCount: 0 },
                requests: [{ operation: "submit", method: "POST", dispatched: false, outcome: "not_dispatched", transportPhase: "tls", transportRoute: "direct", startedAt: "2026-10-15T03:25:27Z", durationMs: 15312, requestBytes: 7557896 }],
            },
        });
        expect(text).toContain("Model:minimax-h3");
        expect(text).not.toContain("seedance");
        expect(text).toContain("Request body size = 7557896 (does not mean it has been sent)");
        expect(text).toContain("Direct connection; stage=TLS handshake");
        expect(text).toContain("Request not sent");
        expect(text).not.toContain("Upstream tasks may still be executing");
    });

    test("persisted category is never advertised as an upstream code", () => {
        const explanation = explainGenerationError({ code: "invalid_params", message: "Model does not accept current parameters" });
        const text = formatGenerationDiagnostics(explanation, { taskId: "local-task-123", createdAt: "2026-09-30T15:39:21+08:00" });
        expect(text).not.toContain("Upstream code: invalid_params");
        expect(text).toContain("Error source: undocumented");
        expect(text).toContain("Request ID: Not logged");
        expect(text).toContain("Task creation time: 2026-09-30T15:39:21+08:00");
    });

    test("diagnostics preserve constraint, request and distinct failure time", () => {
        const text = formatGenerationDiagnostics(explainGenerationError({ code: "invalid_params" }), {
            taskId: "local-task-123", createdAt: "2026-09-30T15:39:21+08:00", completedAt: "2026-09-30T15:40:11+08:00",
            failureDiagnostics: { source: "upstream_http", summary: "size must be 1024x1024", providerCode: "invalid_size", httpStatus: 400, requestId: "req-123456", param: "size", stage: "Generating", capturedAt: "2026-09-30T15:40:10+08:00" },
        });
        for (const expected of ["Upstream code: invalid_size", "HTTP status: 400", "Request ID: req-123456", "Parameters: size", "Error summary: size must be 1024x1024", "Error recording time: 2026-09-30T15:40:10+08:00", "Mission end time: 2026-09-30T15:40:11+08:00"]) expect(text).toContain(expected);
    });

    test("copied diagnostic evidence is sanitized again", () => {
        const text = formatGenerationDiagnostics(explainGenerationError("failed"), { failureDiagnostics: {
            source: "local_validation", summary: "cannot read C:\\Users\\PRIVATE\\image.png https://host/file?token=PRIVATE Authorization: Bearer PRIVATE multi word",
            providerCode: "invalid_params", requestId: "secret-PRIVATE", stage: "prompt=PRIVATE", capturedAt: "Cookie: PRIVATE",
        } });
        expect(text).toContain("Source of error: local parameter verification");
        expect(text).not.toContain("PRIVATE");
        expect(text).not.toContain("upstream code");
    });

    test("reference upload diagnostics identify storage and the failing asset", () => {
        const failure = explainGenerationError({ code: "provider_unavailable", message: "The reference material upload failed and the generation has not started yet. Please check the network or try again later." });
        expect(failure.blockAutomaticRetry).toBe(true);
        expect(failure.blockManualRetry).toBe(false);
        const text = formatGenerationDiagnostics(failure, { failureDiagnostics: {
            source: "reference_upload", summary: "Refer to Figure 2 File upload failed: HTTP 403 SignatureDoesNotMatch", providerCode: "SignatureDoesNotMatch", httpStatus: 403,
            requests: [{ operation: "reference_put", method: "PUT", dispatched: true, outcome: "http_error", httpStatus: 403, startedAt: "2026-10-19T03:00:00Z", durationMs: 123, summary: "Refer to Figure 2 File upload failed" }],
        } });
        expect(text).toContain("Error source: Reference material upload");
        expect(text).toContain("Store return code: SignatureDoesNotMatch");
        expect(text).toContain("Request 1: Upload material files");
        expect(text).toContain("Reference Figure 2");
    });

    test("copied original-task DNS failure identifies local network and query stage", () => {
        const text = formatGenerationDiagnostics(explainGenerationError("Model service domain name resolution failed"), { failureDiagnostics: {
            source: "local_network", stage: "Query the original task (DNS resolution)", summary: "External service domain name resolution failed",
        } });
        expect(text).toContain("Error source: local network");
        expect(text).toContain("Failure stage: Query the original task (DNS resolution)");
        expect(text).not.toContain("Connecting to upstream");
        expect(text).not.toContain("Upstream business response");
    });

    test("copied reference failure keeps DNS stage and recovery attempt", () => {
        const text = formatGenerationDiagnostics(explainGenerationError({ code: "provider_unavailable", message: "The reference material upload failed and the generation has not started yet. Please check the network or try again later." }), { failureDiagnostics: {
            source: "reference_upload", requests: [{ operation: "reference_put", method: "PUT", dispatched: false, outcome: "not_dispatched", transportPhase: "dns", transportRoute: "direct", startedAt: "2026-10-22T03:00:00Z", durationMs: 123, summary: "Refer to Figure 1. File upload (3rd time) failed: Domain name resolution failed." }],
        } });
        expect(text).toContain("Stage=DNS Resolution");
        expect(text).toContain("3rd time");
        expect(text).toContain("Request not sent");
        expect(text).not.toContain("Upstream tasks may still be executing");
    });

    test("content moderation helper recognizes new categories", () => {
        expect(isContentModerationError({ code: "moderation_input" })).toBe(true);
        expect(isContentModerationError({ code: "moderation_reference" })).toBe(true);
        expect(isContentModerationError({ code: "moderation_output" })).toBe(true);
        expect(isContentModerationError({ code: "sensitive_words_detected" })).toBe(true);
        expect(isContentModerationError({ category: "moderation_input" })).toBe(true);
        expect(isContentModerationError({ code: "quota_user", message: "The prompt word failed the content security review" })).toBe(false);
        expect(isContentModerationError("The prompt word failed the content security review")).toBe(false);
        expect(isContentModerationError("Upstream HTTP 400")).toBe(false);
    });
});

describe("image transport errors go through the classifier", () => {
    test("readStatusError 402 is unknown billing", () => {
        expect(readStatusError(402, "Request failed")).toContain("Billing or quota");
    });

    test("readFetchError classifies json body and strips html", async () => {
        const jsonResponse = new Response(JSON.stringify({ error: { message: "Your prompt or reference image was blocked by the content safety policy.", code: "content_policy_violation" } }), { status: 451 });
        expect(await readFetchError(jsonResponse, "Request failed")).toContain("Content security review");
        const htmlResponse = new Response("<!DOCTYPE html><html>secret</html>", { status: 502 });
        const htmlMessage = await readFetchError(htmlResponse, "Request failed");
        expect(htmlMessage).toContain("Temporarily unavailable");
        expect(htmlMessage).not.toContain("secret");
        expect(htmlMessage).not.toContain("<html");
    });
});


test("pixel failure explains actual input and upstream range", () => {
    const raw = explainGenerationError({ error: { code: "400", message: "Material conversion failed: Pixel count must be between 407696 and 8295044." } });
    expect(raw.action).toContain("407696–8295044");
    const measured = explainGenerationError("The first reference video has a total pixel count of 331776 (432×768) and requires 407696–8295044 pixels; please resize");
    expect(measured.reason).toContain("432×768");
    expect(measured.action).toContain("407696–8295044");
});

test("gateway video preflight failures preserve actionable details", () => {
    for (const item of referenceVideoErrors) {
        const failure = explainGenerationError({ error: { code: "invalid_reference_video", message: item.message }, status: 400 });
        expect(failure.reason).toContain(item.reason);
        expect(failure.action).toContain(item.action);
        expect(explainGenerationError({ code: failure.category, message: `${failure.reason}。${failure.action}` }).action).toContain(item.action);
    }
});

test("reference pixel diagnostic ID is not duplicated", () => {
    const id = "202609290516575609492488268d9d6HqaXq7bq";
    const input = `The total number of pixels in the first reference video is 331776 (432×768). Requires 407696–8295044 pixels; please resize. Troubleshooting Number: Request${id}。`;
    const failure = explainGenerationError({ code: "invalid_params", message: input });
    expect(failure.message.split(id).length - 1).toBe(1);
    expect(failure.action).not.toContain(id);
});

test("media details preserve authentication and ignore prompt echoes", () => {
    for (const message of ["asset access denied", "unsupported video codec", "Frame rate must be between 24 and 60."]) {
        const failure = explainGenerationError({error: {code: "invalid_api_key", message}, request_id: "req_media_auth_123"});
        expect(failure.category).toBe("auth");
        expect(failure.requestId).toBe("req_media_auth_123");
    }
    expect(explainGenerationError({error: {code: "unknown", message: "Failure"}, prompt: "unsupported video codec"}).category).toBe("unknown");
});

const BACKEND_IDS = "Troubleshooting number: task task_abc123 · Request req_abc123";
const BACKEND_CASES: Array<{ code: string; reason: string; action: string; moderation?: boolean; uncertain?: boolean }> = [
    { code: "moderation_reference", reason: "The first reference image appears to contain a real person, and the model refuses to generate it.", action: "Please check and replace the reference image before regenerating", moderation: true },
    { code: "quota_user", reason: "The available balance of the current account is insufficient", action: "Please check the account balance, replenish the quota or adjust the token or package quota and try again" },
    { code: "invalid_params", reason: "The screen ratio of the first and last frame modes must follow the first frame", action: "Please select the adaptive scale before regenerating; if you need to specify the scale, please use the reference generation mode instead." },
    { code: "invalid_params", reason: "The second reference video is 3.00 seconds long", action: "Please crop or replace this reference video to 5–15 seconds" },
    { code: "timeout", reason: "Image task execution timeout", action: "Please contact support to check the original task results and do not regenerate immediately.", uncertain: true },
    { code: "results_missing", reason: "Image task ended, but no available images were returned", action: "Please contact support to verify the original task and do not submit it again.", uncertain: true },
    { code: "throttled", reason: "Requests are too frequent", action: "Please try again later" },
];
for (const item of BACKEND_CASES) {
    test(`backend task failure ${item.code} uses the structured category: ${item.reason}`, () => {
        const result = explainGenerationError({ code: item.code, message: `${item.reason}。${item.action}。${BACKEND_IDS}。` });
        expect(result.category).toBe(item.code as typeof result.category);
        expect(result.reason).toBe(item.reason);
        expect(result.action).toBe(item.action);
        expect(result.taskId).toBe("task_abc123");
        expect(result.requestId).toBe("req_abc123");
        expect(result.moderation).toBe(Boolean(item.moderation));
        expect(result.uncertain).toBe(Boolean(item.uncertain));
        expect(result.message).toBe(`${item.reason}。${item.action}。${BACKEND_IDS}。`);
    });
}

test("backend task failure category comes from the code, never from the message text", () => {
    const result = explainGenerationError({ code: "invalid_params", message: "Insufficient quota. Please check your account balance." });
    expect(result.category).toBe("invalid_params");
    expect(result.moderation).toBe(false);
    expect(explainGenerationError({ code: "canvas_conflict", message: "The backend doesn't say that. Please ignore." }).reason).toBe("The build results have been retained and the canvas has not been updated yet");
});

test("third-party gateway channel_excluded and generic invalid_request_error wrapper keep accurate categories", () => {
    const channelBody = {
        error: {
            message: "The lines of this model have all been unchecked in the \"Channel Management\" of this key, so there are currently no available channels. Please open \"Channel Management\" for this key, hook up at least one line and try again. (request id: req.20261101.zB868dI1)",
            type: "invalid_request_error",
            param: "",
            code: "channel_excluded",
        },
    };
    const channelFailure = explainGenerationError({ status: 403, data: channelBody });
    expect(channelFailure.category).toBe("permission");
    expect(channelFailure.providerCode).toBe("channel_excluded");
    expect(channelFailure.requestId).toBe("req.20261101.zB868dI1");
    const persistedChannel = explainGenerationError({ code: channelFailure.category, message: channelFailure.message });
    expect(persistedChannel.category).toBe("permission");
    expect(persistedChannel.reason).toBe(channelFailure.reason);
    expect(persistedChannel.action).toBe(channelFailure.action);
    expect(persistedChannel.requestId).toBe("req.20261101.zB868dI1");

    const opaqueStatuses: Array<[number, string]> = [
        [400, "invalid_params"],
        [402, "quota_unknown"],
        [403, "permission"],
        [413, "input_too_large"],
        [429, "throttled"],
        [451, "unknown"],
        [503, "provider_unavailable"],
    ];
    for (const [status, want] of opaqueStatuses) {
        const got = explainGenerationError({ status, data: { error: { message: "opaque gateway error", type: "invalid_request_error", code: "custom_gateway_code" } } });
        expect(got.category).toBe(want as typeof got.category);
        expect(got.providerCode).toBe("custom_gateway_code");
    }

    for (const status of [400, 402, 403, 413, 429, 451, 503]) {
        const height = explainGenerationError({ status, data: { error: { message: "Height must be between 300px and 6000px", type: "invalid_request_error", code: "custom_gateway_code" } } });
        expect(height.category).toBe("invalid_params");
        expect(height.retryable).toBe(false);
        expect(height.action).toContain("300–6000 pixels");
        expect(height.providerCode).toBe("custom_gateway_code");

        const quota = explainGenerationError({ status, data: { error: { message: "Your account quota is exhausted", type: "invalid_request_error", code: "custom_quota_code" } } });
        expect(quota.category).toBe("quota_unknown");
        expect(quota.providerCode).toBe("custom_quota_code");
    }

    const authoritativeType = explainGenerationError(`{"error":{"message":"Your account quota is exhausted (request id: req_inner_123456)","type":"model_capability_not_supported","code":"invalid_request_error"}} (request id: req_outer_654321)`);
    expect(authoritativeType.category).toBe("invalid_params");
    expect(authoritativeType.requestId).toBe("req_outer_654321");
});

test("custom relay failure header overrides local provider-text classification", async () => {
    const data = { error: { code: "content_policy_violation", message: "blocked by content safety policy" } };
    const config = { headers: {} } as never;
    const response = { config, data, status: 429, statusText: "Too Many Requests", headers: { "x-canvas-failure-category": "quota_upstream" } };
    try {
        await normalizeChannelFailure(new AxiosError("rejected", "ERR_BAD_RESPONSE", config, undefined, response));
        throw new Error("normalized a rejected response");
    } catch (error) {
        expect(error).toBeInstanceOf(ChannelResponseError);
        expect((error as ChannelResponseError).category).toBe("quota_upstream");
        const explained = explainGenerationError(error);
        expect(explained.category).toBe("quota_upstream");
        expect(explained.reason).toContain("supplier");
        expect(explained.reason).not.toContain("Content security");
    }
});
