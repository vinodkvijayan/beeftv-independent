import { expect, test } from "bun:test";
import type { AxiosProgressEvent } from "axios";
import { apiClient } from "../src/services/api/request";
import { uploadResourceFile } from "../src/services/api/resources";

test("Ordinary multipart converts the transfer progress into file bytes, the total amount is unknown and the percentage is not forged", async () => {
    const adapter = apiClient.defaults.adapter;
    const progress: number[][] = [];
    try {
        apiClient.defaults.adapter = async (config) => {
            config.onUploadProgress?.({ loaded: 100, total: undefined } as AxiosProgressEvent);
            config.onUploadProgress?.({ loaded: 250, total: 1000 } as AxiosProgressEvent);
            config.onUploadProgress?.({ loaded: 1000, total: 1000 } as AxiosProgressEvent);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { resource: { id: "upload-test" } } } };
        };
        await uploadResourceFile(new Blob([new Uint8Array(400)]), "file", undefined, (loaded, total) => progress.push([loaded, total]));
        expect(progress).toEqual([[100, 400], [400, 400]]);
    } finally {
        apiClient.defaults.adapter = adapter;
    }
});

test("Partial upload accumulates the real progress within the slice. After 100% transmission, you still have to wait for the merge response.", async () => {
    const adapter = apiClient.defaults.adapter;
    const size = 51 * 1024 * 1024;
    const chunkSize = 32 * 1024 * 1024;
    const progress: number[][] = [];
    let merged = false;
    try {
        apiClient.defaults.adapter = async (config) => {
            let data: unknown;
            if (config.url === "/resources/uploads") data = { uploadId: "session", chunkSize, chunkCount: 2 };
            else if (config.url?.endsWith("/complete")) {
                expect(progress.at(-1)).toEqual([size, size]);
                merged = true;
                data = { resource: { id: "chunk-test" } };
            } else {
                const index = Number(config.url?.split("/").at(-1));
                const bytes = index === 0 ? chunkSize : size - chunkSize;
                config.onUploadProgress?.({ loaded: bytes / 2, total: bytes } as AxiosProgressEvent);
                data = { index };
            }
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
        };
        await uploadResourceFile(new Blob([new Uint8Array(size)]), "video", undefined, (loaded, total) => progress.push([loaded, total]));
        expect(progress).toEqual([[chunkSize / 2, size], [chunkSize, size], [chunkSize + (size - chunkSize) / 2, size], [size, size]]);
        expect(merged).toBe(true);
    } finally {
        apiClient.defaults.adapter = adapter;
    }
});

test("Server-side save error not swallowed at the end of transfer", async () => {
    const adapter = apiClient.defaults.adapter;
    try {
        apiClient.defaults.adapter = async (config) => {
            config.onUploadProgress?.({ loaded: 100, total: 100 } as AxiosProgressEvent);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 9, msg: "Save failed" } };
        };
        await expect(uploadResourceFile(new Blob(["text"]), "file", undefined, () => {})).rejects.toThrow("Save failed");
    } finally {
        apiClient.defaults.adapter = adapter;
    }
});

test("After fragmentation and disconnection, use the same idempotent identity to query the progress and only make up for the fragments that have not been received.", async () => {
    const adapter = apiClient.defaults.adapter;
    const size = 51 * 1024 * 1024;
    const chunkSize = 32 * 1024 * 1024;
    const sent: number[] = [];
    const keys: string[] = [];
    const progress: number[][] = [];
    let sessions = 0;
    try {
        apiClient.defaults.adapter = async (config) => {
            let data: unknown;
            if (config.url === "/resources/uploads") {
                keys.push(String(config.headers.get("X-Idempotency-Key")));
                data = { uploadId: "resume", chunkSize, chunkCount: 2, received: ++sessions === 1 ? [] : [0] };
            } else if (config.url?.endsWith("/complete")) {
                data = { resource: { id: "resumed" } };
            } else {
                const index = Number(config.url?.split("/").at(-1));
                sent.push(index);
                if (sent.length === 2) throw new Error("connection interrupted");
                data = { index };
            }
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
        };
        const result = await uploadResourceFile(new Blob([new Uint8Array(size)]), "video", undefined, (loaded, total) => progress.push([loaded, total]));
        expect(result.id).toBe("resumed");
        expect(sent).toEqual([0, 1, 1]);
        expect(keys.length).toBe(2);
        expect(keys[0]).not.toBe("undefined");
        expect(keys[0]).toBe(keys[1]);
        expect(progress).toEqual([[chunkSize, size], [chunkSize, size], [size, size]]);
    } finally {
        apiClient.defaults.adapter = adapter;
    }
});
