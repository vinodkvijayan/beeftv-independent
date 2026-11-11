import { describe, expect, it } from "bun:test";

import { canPlaceAt, planClipMove } from "../src/lib/timeline/timeline-placement";
import type { TimelineClip } from "../src/types/timeline";

const clip = (id: string, startMs: number, durationMs: number, trackId = "video"): TimelineClip => ({
    id,
    kind: "video",
    nodeId: id,
    trackId,
    startMs,
    durationMs,
});

/** 首尾紧贴的两个片段：前一个片段的右侧完全没有空隙，是报障场景（首个素材拖不动）。 */
const adjacent = [clip("first", 0, 4_000), clip("second", 4_000, 4_000)];

describe("planClipMove gives way on the same track", () => {
    it("When the first clip is dragged to the right, the next clipped clip will also give way.", () => {
        const placement = planClipMove({ clipId: "first", trackId: "video", startMs: 1_250, durationMs: 4_000, clips: adjacent });
        expect(placement?.get("first")).toBe(1_250);
        expect(placement?.get("second")).toBe(5_250);
    });

    it("After giving way, the duration of each segment remains unchanged and there is no overlap within the track.", () => {
        const clips = [clip("first", 0, 1_000), clip("second", 3_000, 1_000), clip("third", 4_000, 1_000)];
        const placement = planClipMove({ clipId: "first", trackId: "video", startMs: 2_500, durationMs: 1_000, clips })!;
        expect(placement.get("first")).toBe(2_500);
        // second 被压到 first 右缘，third 顺次让位（不是被吞掉或压缩）
        expect(placement.get("second")).toBe(3_500);
        expect(placement.get("third")).toBe(4_500);
        const next = clips.map((item) => ({ ...item, startMs: placement.get(item.id) ?? item.startMs }));
        for (const item of next) {
            expect(canPlaceAt({ trackId: item.trackId, startMs: item.startMs, durationMs: item.durationMs, excludeClipId: item.id, clips: next }).ok).toBe(true);
        }
    });

    it("If there is insufficient space on the left side (which will cause a certain segment to cross 0), null will be returned, and the caller will discard this displacement.", () => {
        expect(planClipMove({ clipId: "second", trackId: "video", startMs: 3_900, durationMs: 4_000, clips: adjacent })).toBeNull();
    });

    it("If there is a gap on the left side, drag it to the left to give way as usual.", () => {
        const clips = [clip("first", 2_000, 1_000), clip("second", 3_000, 1_000)];
        const placement = planClipMove({ clipId: "second", trackId: "video", startMs: 1_800, durationMs: 1_000, clips })!;
        expect(placement.get("second")).toBe(1_800);
        expect(placement.get("first")).toBe(800);
    });

    it("Do not cross tracks: Co-located clips on another track are not affected", () => {
        const clips = [clip("first", 0, 4_000), clip("second", 4_000, 4_000), clip("voice", 0, 4_000, "voice")];
        const placement = planClipMove({ clipId: "first", trackId: "video", startMs: 1_000, durationMs: 4_000, clips })!;
        expect(placement.get("second")).toBe(5_000);
        expect(placement.has("voice")).toBe(false);
    });

    it("When no displacement occurs, it only returns itself.", () => {
        const placement = planClipMove({ clipId: "first", trackId: "video", startMs: 0, durationMs: 4_000, clips: adjacent })!;
        expect([...placement.entries()]).toEqual([["first", 0]]);
    });

    it("When the first segment is dragged to the right to cross the center point of the subsequent segments, the subsequent segments will be moved to the left to realize the order exchange.", () => {
        const clips = [clip("first", 0, 4_000), clip("second", 4_000, 4_000), clip("third", 8_000, 4_000)];
        // 拖到 second 位置（中心点 6000 >= second 中心点 6000）：second 左移到 0，first 落位 4000，third 保持 8000
        const swapSecond = planClipMove({ clipId: "first", trackId: "video", startMs: 4_000, durationMs: 4_000, clips })!;
        expect(swapSecond.get("second")).toBe(0);
        expect(swapSecond.get("first")).toBe(4_000);
        expect(swapSecond.get("third") ?? 8_000).toBe(8_000);

        // 继续拖到 third 位置（startMs = 8000）：second 左移到 0，third 左移到 4000，first 落位 8000
        const swapThird = planClipMove({ clipId: "first", trackId: "video", startMs: 8_000, durationMs: 4_000, clips })!;
        expect(swapThird.get("second")).toBe(0);
        expect(swapThird.get("third")).toBe(4_000);
        expect(swapThird.get("first")).toBe(8_000);
    });
});
