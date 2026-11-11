import { expect, test } from "bun:test";
import { ApiError, request } from "../src/services/api/request";
import { explainGenerationError, formatGenerationDiagnostics } from "../src/lib/generation-error";

test("credential rejection retains local reason and request ID through HTTP and copied diagnostics", async () => {
    const error = await request(Promise.reject({ isAxiosError: true, response: { status: 500, headers: { "x-request-id": "req-credential-test" }, data: { code: 500, reason: "local_credential_failed", msg: "Failed to read the local computing power credentials and the generation has not yet been submitted. Workspace key file does not exist" } } })).catch(e => e);
    const explained = explainGenerationError(error);
    expect(error.retryable).toBe(false);
    expect(explained.category).toBe("local_credential");
    expect(explained.blockAutomaticRetry).toBe(true);
    const copy = formatGenerationDiagnostics(explained);
    for (const text of ["Local computing power connection", "The build has not been submitted yet", "Workspace key file does not exist", "req-credential-test", "HTTP status: 500"]) expect(copy).toContain(text);
    expect(copy).not.toContain("Model does not accept");
});

test("local disk exhaustion is actionable and hides private paths", () => {
    const admission = new ApiError("Insufficient local disk space to save data", {status: 500, reason: "local_disk_full"});
    expect(admission.retryable).toBe(false);
    expect(explainGenerationError(admission).category).toBe("local_disk_full");
    for (const cause of ["There is not enough space on the disk", "no space left on device"]) {
        const explained = explainGenerationError(`Failed to write generated content to resource storage: write local resource: write C:\\Users\\private\\video:${cause}`);
        expect(explained.category).toBe("local_disk_full");
        expect(explained.message).toContain("Not enough disk space");
        expect(explained.blockAutomaticRetry).toBe(true);
        expect(formatGenerationDiagnostics(explained)).not.toContain("private");
        expect(explainGenerationError(explained.message).category).toBe("local_disk_full");
    }
    expect(explainGenerationError({ status: 500, data: { error: { message: "no space left on device" } } }).category).not.toBe("local_disk_full");
    expect(explainGenerationError({ status: 500, data: { error: { message: "database or disk is full" } } }).category).not.toBe("local_disk_full");
    expect(explainGenerationError({ status: 500, data: { error: { code: "local_disk_full", message: "write local resource: no space left on device" } } }).category).not.toBe("local_disk_full");
});
