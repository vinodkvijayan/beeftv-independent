import { expect, test } from "bun:test";

import { generationErrorMessage, generationFailureMetadata } from "../src/lib/generation-error";

test("local generation errors do not expose hosted object-storage wording", () => {
    expect(generationErrorMessage("OSS upload failed: Object storage is unavailable")).toBe("Failed to save local reference material. Please check the local resource directory and try again.");
    expect(generationErrorMessage("Reference image upload failed")).toBe("Failed to save local reference material. Please check the local resource directory and try again.");
});

test("HTTP 402 explains the upstream billing cause and exposes a stable canvas error code", () => {
    const raw = "Model service request failed (HTTP 402)";
    expect(generationErrorMessage(raw)).toContain("Billing or quota");
    expect(generationErrorMessage(raw)).not.toContain("Insufficient balance");
    expect(generationFailureMetadata(raw, "prompt")).toEqual({
        errorDetails: generationErrorMessage(raw),
        generationErrorCode: "quota_unknown",
        generationErrorSummary: raw,
    });
});

test("HTTP 402 keeps the classified upstream cause without exposing its raw body", () => {
    expect(generationErrorMessage({ status: 402, data: { error: { message: "subscription required api_key=PRIVATE" } } })).toContain("Billing or quota");
    expect(generationErrorMessage({ status: 402, data: { error: { message: "subscription required api_key=PRIVATE" } } })).not.toContain("PRIVATE");
});
