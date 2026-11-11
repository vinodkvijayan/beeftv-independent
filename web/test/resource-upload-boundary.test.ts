import { describe, expect, test } from "bun:test";
import axios from "axios";

import { apiClient } from "@/services/api/request";
import { ResourceUploadError, uploadResourceFile } from "@/services/api/resources";

type AdapterResult = { status: number; body: unknown };

// 直传失败的分类是这条边界的全部价值：permanent 决定调用方是当场报错还是退回本机等待重传。
async function uploadWith(result: AdapterResult | Error) {
    const previous = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
        if (result instanceof Error) throw result;
        if (result.status >= 400) {
            throw new axios.AxiosError(`Request failed with status code ${result.status}`, "ERR_BAD_REQUEST", config, undefined, {
                data: result.body,
                status: result.status,
                statusText: "Error",
                headers: {},
                config,
            });
        }
        return { data: result.body, status: result.status, statusText: "OK", headers: {}, config };
    };
    try {
        return await uploadResourceFile(new Blob(["x"], { type: "image/png" }), "image", { fileName: "x.png" });
    } finally {
        apiClient.defaults.adapter = previous;
    }
}

async function uploadFailure(result: AdapterResult | Error) {
    try {
        await uploadWith(result);
    } catch (error) {
        return error;
    }
    throw new Error("Upload should have failed");
}

describe("Resource direct transfer failure classification", () => {
    test("Authentication, unauthorized access, and volume exceeding the limit are permanent failures that will not self-heal after retrying.", async () => {
        for (const status of [400, 401, 403, 404, 413, 415]) {
            const error = await uploadFailure({ status, body: { code: status, data: null, msg: "" } });
            expect(error).toBeInstanceOf(ResourceUploadError);
            expect((error as ResourceUploadError).permanent).toBe(true);
            expect((error as ResourceUploadError).status).toBe(status);
        }
    });

    test("Current limiting and server-side failures are transient failures and are allowed to be returned to the local machine and retransmitted.", async () => {
        for (const status of [429, 500, 502, 503]) {
            const error = await uploadFailure({ status, body: { code: status, data: null, msg: "" } });
            expect(error).toBeInstanceOf(ResourceUploadError);
            expect((error as ResourceUploadError).permanent).toBe(false);
        }
    });

    test("Non-HTTP failures such as network disconnection will be handled immediately.", async () => {
        const error = await uploadFailure(new Error("Network Error"));
        expect(error).toBeInstanceOf(ResourceUploadError);
        expect((error as ResourceUploadError).permanent).toBe(false);
    });

    test("Keep the back-end readable copy and translate multipart into Chinese", async () => {
        const quota = await uploadFailure({ status: 403, body: { code: 403, data: null, msg: "Insufficient storage quota" } });
        expect((quota as ResourceUploadError).message).toBe("Insufficient storage quota");

        const oversize = await uploadFailure({ status: 400, body: { code: 400, data: null, msg: "http: request body too large" } });
        expect((oversize as ResourceUploadError).message).toContain("File too large");
        expect((oversize as ResourceUploadError).permanent).toBe(true);
    });

    test("A successful response still returns the backend resource itself", async () => {
        const resource = await uploadWith({
            status: 200,
            body: { code: 0, msg: "", data: { resource: { id: "res-1", kind: "image", status: "ready", publicUrl: "", size: 1 } } },
        });
        expect(resource.id).toBe("res-1");
    });
});
