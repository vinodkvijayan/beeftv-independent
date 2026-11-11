import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatMs, summarizeTimeline } from "@/lib/timeline/timeline-summary";
import type { TimelineProject } from "@/types/timeline";

const commandsGolden = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/commands.golden.json"), "utf8"),
) as { base: TimelineProject };

describe("formatMs", () => {
    test("Milliseconds to m:ss", () => {
        expect(formatMs(0)).toBe("0:00");
        expect(formatMs(59999)).toBe("0:59");
        expect(formatMs(60000)).toBe("1:00");
        expect(formatMs(65000)).toBe("1:05");
        expect(formatMs(600000 + 12000)).toBe("10:12");
    });
    test("Negative numbers are clamped to 0", () => {
        expect(formatMs(-500)).toBe("0:00");
    });
    test("Decimal rounding", () => {
        // Math.round(ms) 到毫秒再向下取秒：1500.6→1501ms→0:01；1501.9→1502ms→0:01
        expect(formatMs(1500.6)).toBe("0:01");
    });
});

describe("summarizeTimeline", () => {
    test("Deterministic: The output is consistent with the same input twice.", () => {
        expect(summarizeTimeline(commandsGolden.base)).toBe(summarizeTimeline(commandsGolden.base));
    });
    test("Including duration, track number and segment statistics", () => {
        const s = summarizeTimeline(commandsGolden.base);
        expect(s).toContain("Total duration 0:08");
        expect(s).toContain("4 tracks");
        expect(s).toContain("4 clips");
        expect(s).toContain("subtitles 1");
    });
    test("Tracks are sorted by order and row by column id/kind/label", () => {
        const s = summarizeTimeline(commandsGolden.base);
        const video1 = s.indexOf("video-1");
        const audio1 = s.indexOf("audio-1");
        const subtitle1 = s.indexOf("subtitle-1");
        const video2 = s.indexOf("video-2");
        expect(video1).toBeGreaterThan(-1);
        expect(audio1).toBeGreaterThan(video1);
        expect(subtitle1).toBeGreaterThan(audio1);
        expect(video2).toBeGreaterThan(subtitle1);
        expect(s).toContain("video track");
        expect(s).toContain("audio track");
        expect(s).toContain("subtitle track");
    });
    test("The snippet lists the id/kind/time intervals line by line, with the text truncated to a safe length", () => {
        const s = summarizeTimeline(commandsGolden.base);
        expect(s).toContain("clip-a");
        expect(s).toContain("clip-b");
        expect(s).toContain("clip-c");
        expect(s).toContain("sub-1");
        expect(s).toContain("0-5000ms");
        expect(s).toContain("orbit video-1");
        expect(s).toContain("Orbital subtitle-1");
    });
    test("Subtitle clips are included in the word count", () => {
        const s = summarizeTimeline(commandsGolden.base);
        expect(s).toMatch(/字幕共 \d+ 字。/);
    });
    test("An empty timeline gives a clear reminder", () => {
        const empty: TimelineProject = { version: 2, tracks: [], clips: [], durationMs: 0 };
        const s = summarizeTimeline(empty);
        expect(s).toContain("0 tracks");
        expect(s).toContain("(empty timeline)");
    });
    test("Fold when the total number of fragments exceeds the limit (to prevent context explosion)", async () => {
        const summaryModule = await import("@/lib/timeline/timeline-summary");
        const manyClips = Array.from({ length: summaryModule.SUMMARY_MAX_CLIP_LINES + 10 }, (_, i) => ({
            id: `c${i}`,
            kind: "video" as const,
            nodeId: `n${i}`,
            trackId: "video-1",
            startMs: i * 1000,
            durationMs: 500,
            sourceStartMs: 0,
            sourceDurationMs: 500,
        }));
        const big: TimelineProject = {
            version: 2,
            tracks: [{ id: "video-1", kind: "video", label: "Video 1", order: 0 }],
            clips: manyClips,
            durationMs: manyClips.length * 1000,
        };
        const s = summarizeTimeline(big);
        const counted = s.match(/^  - clip /gm)?.length ?? 0;
        expect(counted).toBe(summaryModule.SUMMARY_MAX_CLIP_LINES);
        expect(s).toContain("...the remaining 10 fragments are omitted");
    });
});
