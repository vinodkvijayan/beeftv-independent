import { afterEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { resolveResourceVideoPlayback } from "../src/services/resource-video-playback";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = originalAdapter; });

test("When a ready record lacks a copy, the returned original can still trigger decoding failure recovery", async () => {
    const original = new Blob(["HEVC"], { type: "video/mp4" });
    const urls: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        urls.push(config.url!);
        return { data: config.url!.includes("/file") ? original : { code: 0, data: { resource: { id: "missing-copy", playbackStatus: "ready" } } }, status: 200, statusText: "OK", headers: { etag: '"original"' }, config };
    };
    expect(await resolveResourceVideoPlayback("resource:missing-copy", "original", new AbortController().signal)).toEqual({ blob: original, compatible: false });
    expect(urls).toEqual(["/resources/missing-copy", "/resources/missing-copy/file?variant=playback&proxy=1"]);
});

test("Wait for the compatible copy to be ready before pulling the playback file. The original video will not be cached as a copy.", async () => {
    const urls: string[] = [];
    let polls = 0;
    const compatible = new Blob(["H264"], { type: "video/mp4" });
    apiClient.defaults.adapter = async (config) => {
        urls.push(config.url!);
        return { data: config.url!.includes("/file") ? compatible : { code: 0, data: { resource: { id: "hevc-ready", playbackStatus: ++polls === 1 ? "processing" : "ready" } } }, status: 200, statusText: "OK", headers: { etag: '"preview:pb"' }, config };
    };
    expect(await resolveResourceVideoPlayback("resource:hevc-ready", "original", new AbortController().signal)).toEqual({ blob: compatible, compatible: true });
    expect(urls).toEqual(["/resources/hevc-ready", "/resources/hevc-ready", "/resources/hevc-ready/file?variant=playback&proxy=1"]);
});

test("Close the video, pause and wait, and do not continue to download compatible copies.", async () => {
    let requests = 0;
    const controller = new AbortController();
    apiClient.defaults.adapter = async (config) => {
        requests++;
        return { data: { code: 0, data: { resource: { id: "hevc-cancel", playbackStatus: "processing" } } }, status: 200, statusText: "OK", headers: {}, config };
    };
    const pending = resolveResourceVideoPlayback("resource:hevc-cancel", "original", controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toBeTruthy();
    expect(requests).toBe(1);
});

test("If the compatible copy fails, the original file address will be retained and a readable error will be returned, and the bad copy will not be downloaded.", async () => {
    let requests = 0;
    apiClient.defaults.adapter = async (config) => {
        requests++;
        return { data: { code: 0, data: { resource: { id: "hevc-failed", playbackStatus: "failed" } } }, status: 200, statusText: "OK", headers: {}, config };
    };
    await expect(resolveResourceVideoPlayback("resource:hevc-failed", "original", new AbortController().signal, true)).rejects.toThrow("Video has been imported");
    expect(requests).toBe(2);
});

test("Apply for compatibility preview only after the browser fails to decode", async () => {
    const urls: string[] = [];
    const compatible = new Blob(["H264"], { type: "video/mp4" });
    apiClient.defaults.adapter = async (config) => {
        urls.push(config.url!);
        const resource = { id: "hevc-demand", playbackStatus: config.method === "post" ? "ready" : "none" };
        return { data: config.url!.includes("/file") ? compatible : { code: 0, data: { resource } }, status: 200, statusText: "OK", headers: { etag: '"preview:pb"' }, config };
    };
    expect(await resolveResourceVideoPlayback("resource:hevc-demand", "original", new AbortController().signal, true)).toEqual({ blob: compatible, compatible: true });
    expect(urls).toEqual(["/resources/hevc-demand", "/resources/hevc-demand/playback", "/resources/hevc-demand/file?variant=playback&proxy=1"]);
});
