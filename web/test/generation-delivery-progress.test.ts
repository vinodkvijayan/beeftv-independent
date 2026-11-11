import { expect, test } from "bun:test";

import { GENERATION_RESULT_FETCH_STAGE, generationDeliveryProgressView, generationTaskFetchingResult } from "@/lib/generation-delivery-progress";

test("Retrieval progress showing percentage, downloaded/total size and speed", () => {
    expect(generationDeliveryProgressView({ outputIndex: 0, downloadedBytes: 12_900_000, totalBytes: 41_943_040, bytesPerSecond: 1_258_291, state: "downloading", updatedAt: 1000 }, 1000)).toEqual({
        title: "Retrieving results",
        percent: 30,
        detail: "12 MB / 40 MB · 1.2 MB/s · 24 seconds estimated remaining",
        size: "12 MB / 40 MB", speed: "1.2 MB/s", timing: "Estimated 24 seconds remaining",
    });
});
test("Hide old speed and remaining time after retrieval sample expires", () => {
    expect(generationDeliveryProgressView({ outputIndex: 0, downloadedBytes: 2048, totalBytes: 4096, bytesPerSecond: 1024, state: "downloading", updatedAt: 1000 }, 5000).detail).toBe("2.0 KB / 4.0 KB");
});

test("When the total size is unknown, only the downloaded amount is displayed, and the speed is not displayed when the download is interrupted and resumed.", () => {
    expect(generationDeliveryProgressView({ outputIndex: 0, downloadedBytes: 2048, totalBytes: -1, bytesPerSecond: 0, state: "retrying" })).toEqual({
        title: "Download interrupted, retrying",
        percent: null,
        detail: "2.0 KB",
        size: "2.0 KB", speed: "", timing: "",
    });
});

test("When waiting for the result to be ready, it displays retrieving, without giving bytes or speed.", () => {
    expect(generationDeliveryProgressView({ outputIndex: 0, downloadedBytes: 0, totalBytes: -1, bytesPerSecond: 0, state: "waiting" })).toEqual({
        title: "Retrieving results",
        percent: null,
        detail: "Wait for results to be ready",
        size: "", speed: "", timing: "Wait for results to be ready",
    });
});

test("The generation result retrieval stage and existing progress are both being retrieved.", () => {
    expect(generationTaskFetchingResult({ status: "running", stage: GENERATION_RESULT_FETCH_STAGE }, false)).toBe(true);
    expect(generationTaskFetchingResult({ status: "running", stage: "Generating" }, false)).toBe(false);
    expect(generationTaskFetchingResult({ status: "running", stage: GENERATION_RESULT_FETCH_STAGE }, true)).toBe(true);
    expect(generationTaskFetchingResult({ status: "succeeded" }, false)).toBe(true);
    expect(generationTaskFetchingResult({ status: "queued", stage: GENERATION_RESULT_FETCH_STAGE }, false)).toBe(false);
});
