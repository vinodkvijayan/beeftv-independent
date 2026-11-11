import { expect, test } from "bun:test";

import { ApiError } from "../src/services/api/request";
import { isIgnorablePlanPreviewError, RENDER_PLAN_PREVIEW_DEBOUNCE_MS } from "../src/lib/timeline/timeline-plan-preview";

test("plan preview debounce is slower than typical edit bursts", () => {
    expect(RENDER_PLAN_PREVIEW_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
});

test("cancelled and rate-limited plan preview errors stay off the editor", () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(isIgnorablePlanPreviewError(new Error("too many requests"), aborted.signal)).toBe(true);
    expect(isIgnorablePlanPreviewError(new DOMException("Request canceled", "AbortError"))).toBe(true);
    expect(isIgnorablePlanPreviewError(Object.assign(new Error("Request canceled"), { name: "AbortError" }))).toBe(true);
    expect(isIgnorablePlanPreviewError(new ApiError("Requests are too frequent", { status: 429 }))).toBe(true);
    expect(isIgnorablePlanPreviewError(new Error("The timeline has no renderable media clips"))).toBe(false);
});
