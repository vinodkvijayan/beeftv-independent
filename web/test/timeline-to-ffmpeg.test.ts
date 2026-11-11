import { describe, expect, test } from "bun:test";

import type { CanonicalTimelinePlan } from "../src/lib/timeline/timeline-canonical-plan";
import { formatSrtTimestamp, lowerCanonicalPlan, type TimelineRenderSource } from "../src/lib/timeline/timeline-to-ffmpeg";
import { loadEditingPlan } from "./helpers/editing-fixtures";

function source(nodeId: string): TimelineRenderSource {
    return { nodeId, fileName: `input-${nodeId}.mp4`, durationMs: 15_000, url: `file:///${nodeId}.mp4` };
}

function concatTotalSeconds(plan: ReturnType<typeof lowerCanonicalPlan>): number {
    let total = 0;
    for (const entry of plan.concatEntries) {
        const step = plan.steps.find((item) => item.output === entry);
        if (step?.kind === "trim") total += Number(step.args[step.args.indexOf("-t") + 1]);
        if (step?.kind === "gap") {
            const lavfi = step.args.find((arg) => arg.startsWith("color=c=black")) || "";
            total += Number(lavfi.split("d=")[1]);
        }
    }
    return total;
}

function concatStartOffsetsMs(plan: ReturnType<typeof lowerCanonicalPlan>): number[] {
    const offsets: number[] = [];
    let cursor = 0;
    for (const entry of plan.concatEntries) {
        const step = plan.steps.find((item) => item.output === entry);
        if (!step) continue;
        offsets.push(cursor);
        if (step.kind === "trim") cursor += Number(step.args[step.args.indexOf("-t") + 1]) * 1000;
        if (step.kind === "gap") {
            const lavfi = step.args.find((arg) => arg.startsWith("color=c=black")) || "";
            cursor += Number(lavfi.split("d=")[1]) * 1000;
        }
    }
    return offsets;
}

describe("lowerCanonicalPlan segments are aligned with the black point", () => {
    test("Share gap-mix fixture: insert black field in the middle gap, dubbing crop/volume/fade into mix", () => {
        const canonical = loadEditingPlan("gap-mix.plan.json");
        const plan = lowerCanonicalPlan(canonical, [source("node-a"), source("node-b"), source("voice")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "gap-1.mp4", "trim-2.mp4"]);
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        expect(gaps[0].args.join(" ")).toContain("d=10");
        expect(concatTotalSeconds(plan)).toBe(40);
        expect(concatStartOffsetsMs(plan)).toEqual([0, 15_000, 25_000]);
        const mix = plan.steps.find((step) => step.kind === "mix")!;
        expect(mix.args.join(" ")).toContain("atrim=start=0.1:duration=1.5");
        expect(mix.args.join(" ")).toContain("volume=0,afade=t=in:st=0:d=0.1,afade=t=out:st=1.3:d=0.2,adelay=500:all=1");
        expect(mix.args.join(" ")).toContain("amix=inputs=2:normalize=0:duration=first");
        expect(mix.args.join(" ")).not.toContain("alimiter");
        expect(plan.request).toEqual({
            videoClipIds: ["a", "b"],
            audioClipIds: ["voice"],
            subtitleClipIds: ["sub"],
            durationMs: 40000,
            burnSubtitles: true,
        });
        expect(plan.steps.some((step) => step.kind === "burn")).toBe(true);
        expect(plan.subtitleSrt).toContain("Chinese");
    });

    test("Shared six-second-mix fixture: no blackout, concat order=clip order", () => {
        const canonical = loadEditingPlan("six-second-mix.plan.json");
        const plan = lowerCanonicalPlan(canonical, [source("v0"), source("v1"), source("v2"), source("voice"), source("bgm")], { width: 320, height: 180, fps: 30, outputName: "out.mp4" });
        expect(plan.steps.filter((step) => step.kind === "gap")).toHaveLength(0);
        expect(concatTotalSeconds(plan)).toBe(6);
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "trim-1.mp4", "trim-2.mp4"]);
        expect(plan.request.audioClipIds).toEqual(["bgm", "voice"]);
        expect(plan.subtitleSrt).toContain("Chinese subtitle integrity verification");
    });

    test("Missing planned media sources required must explicitly fail", () => {
        const canonical = loadEditingPlan("gap-mix.plan.json");
        expect(() => lowerCanonicalPlan(canonical, [source("node-a")])).toThrow("Material not found");
    });

    test("Muted independent tracks still go into the mix with a volume of 0", () => {
        const canonical = structuredClone(loadEditingPlan("six-second-mix.plan.json"));
        canonical.audio.find((clip) => clip.clipId === "bgm")!.muted = true;
        const plan = lowerCanonicalPlan(canonical, [source("v0"), source("v1"), source("v2"), source("voice"), source("bgm")]);
        const mix = plan.steps.find((step) => step.kind === "mix")!;
        expect(mix.args.join(" ")).toContain("volume=0");
        expect(plan.steps.some((step) => step.kind === "mix")).toBe(true);
    });

    test("Keep the plan hasAudio when the audio track is not detected, and change the sound to mute when the detection fails.", () => {
        const keepPlan: CanonicalTimelinePlan = {
            version: 1,
            output: { width: 1280, height: 720, fps: 30, sampleRate: 44100, burnSubtitles: false },
            durationMs: 1000,
            segments: [{ kind: "video", clipId: "a", sourceId: "node-a", startMs: 0, durationMs: 1000, volume: 1, hasAudio: true }],
            audio: [],
            subtitles: [],
        };
        const keep = lowerCanonicalPlan(keepPlan, [source("node-a")]);
        expect(keep.steps.find((step) => step.kind === "trim")!.args.join(" ")).toContain("-map 0:a:0");
        const silent = lowerCanonicalPlan({ ...keepPlan, segments: [{ ...keepPlan.segments[0], hasAudio: false }] }, [{ ...source("node-a"), hasAudio: false }]);
        expect(silent.steps.find((step) => step.kind === "trim")!.args.join(" ")).toContain("-map 1:a:0");
    });

    test("Image fragment lowering uses -loop 1, no error will be thrown", () => {
        const canonical: CanonicalTimelinePlan = {
            version: 1,
            output: { width: 1280, height: 720, fps: 30, sampleRate: 44100, burnSubtitles: false },
            durationMs: 2000,
            segments: [
                { kind: "video", clipId: "v", sourceId: "v", startMs: 0, durationMs: 1000, volume: 1, hasAudio: true },
                { kind: "image", clipId: "still", sourceId: "still", startMs: 1000, durationMs: 1000, volume: 1, hasAudio: false },
            ],
            audio: [],
            subtitles: [],
        };
        const plan = lowerCanonicalPlan(canonical, [source("v"), { ...source("still"), fileName: "still.png" }]);
        const image = plan.steps.find((step) => step.description.includes("pictures"))!;
        expect(image.args.slice(0, 4)).toEqual(["-loop", "1", "-t", "1"]);
        const lastInput = image.args.lastIndexOf("-i");
        const outputDuration = image.args.map((arg, index) => (arg === "-t" && index > lastInput ? Number(image.args[index + 1]) : -1)).find((value) => value >= 0);
        expect(outputDuration).toBe(1);
        expect(image.args).toContain("-shortest");
        expect(image.args.join(" ")).toContain("anullsrc=r=44100:cl=stereo");
    });

    test("Executors must not override planned output dimensions or subtitle strategies", () => {
        const canonical = loadEditingPlan("gap-mix.plan.json");
        const sources = [source("node-a"), source("node-b"), source("voice")];
        expect(() => lowerCanonicalPlan(canonical, sources, { width: 1920, height: 1080 })).toThrow("Export dimensions must be consistent with the render plan");
        expect(() => lowerCanonicalPlan(canonical, sources, { fps: 24 })).toThrow("Export frame rate must be consistent with render plan");
        expect(() => lowerCanonicalPlan(canonical, sources, { burnSubtitles: false })).toThrow("Subtitle burning must be consistent with the rendering plan");
        const matched = lowerCanonicalPlan(canonical, sources, { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        expect(matched.finalOutput).toBe("out.mp4");
        expect(matched.steps.find((step) => step.kind === "gap")!.args.join(" ")).toContain("1280x720");
    });

    test("Share the image-gap-sub fixture: the image output duration is bounded, and the sampling rate comes from the plan", () => {
        const canonical = loadEditingPlan("image-gap-sub.plan.json");
        const plan = lowerCanonicalPlan(canonical, [
            { ...source("still"), fileName: "still.png" },
            { ...source("voice"), fileName: "voice.wav" },
        ], { outputName: "out.mp4" });
        const image = plan.steps.find((step) => step.kind === "trim")!;
        const lastInput = image.args.lastIndexOf("-i");
        expect(image.args.slice(0, lastInput).includes("-t")).toBe(true);
        expect(image.args.slice(lastInput).includes("-t")).toBe(true);
        expect(plan.steps.find((step) => step.kind === "gap")).toBeTruthy();
        expect(plan.steps.find((step) => step.kind === "mix")!.args.join(" ")).toContain("aresample=44100");
        expect(plan.steps.find((step) => step.kind === "mix")!.args.join(" ")).not.toContain("alimiter");
        expect(plan.request.subtitleClipIds).toEqual(["sub"]);
        expect(concatTotalSeconds(plan)).toBe(3);
    });
});

describe("trim step output seek (-ss after -i)", () => {
    test("The cropping parameter must put -ss after -i: entering seek will align the keyframe and cause the tangent point to shift.", () => {
        const canonical = loadEditingPlan("six-second-mix.plan.json");
        const plan = lowerCanonicalPlan(canonical, [source("v0"), source("v1"), source("v2"), source("voice"), source("bgm")], { width: 320, height: 180, fps: 30, outputName: "out.mp4" });
        const trims = plan.steps.filter((step) => step.kind === "trim");
        expect(trims.length).toBeGreaterThan(0);
        for (const trim of trims) {
            const inputIndex = trim.args.indexOf("-i");
            const ssIndex = trim.args.indexOf("-ss");
            expect(inputIndex).toBeGreaterThan(-1);
            expect(ssIndex).toBeGreaterThan(-1);
            expect(ssIndex).toBeGreaterThan(inputIndex);
        }
    });

    test("trim limits the apad duration to prevent the last frame from freezing, and concat and mix multiplex the encoded video stream to avoid redundant libx264 re-encoding", () => {
        const canonical = loadEditingPlan("six-second-mix.plan.json");
        const plan = lowerCanonicalPlan(canonical, [source("v0"), source("v1"), source("v2"), source("voice"), source("bgm")], { width: 320, height: 180, fps: 30, outputName: "out.mp4" });
        const trims = plan.steps.filter((step) => step.kind === "trim");
        for (const trim of trims) {
            const af = trim.args[trim.args.indexOf("-af") + 1] || "";
            expect(af).toContain("apad=whole_dur=2");
        }
        const concatStep = plan.steps.find((step) => step.kind === "concat" && step.output === "timeline-video.mp4")!;
        expect(concatStep.args).toEqual([
            "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", "concat.txt",
            "-c", "copy", "-movflags", "+faststart", "timeline-video.mp4",
        ]);
        expect(concatStep.args).not.toContain("libx264");

        const mixStep = plan.steps.find((step) => step.kind === "mix")!;
        expect(mixStep.args.join(" ")).not.toContain("[0:v]null[v]");
        expect(mixStep.args).toContain("0:v:0");
        expect(mixStep.args).not.toContain("libx264");
        expect(mixStep.args.slice(mixStep.args.indexOf("-c:v"))).toEqual([
            "-c:v", "copy", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", "timeline-mixed.mp4",
        ]);
    });
});

describe("formatSrtTimestamp", () => {
    test("SRT timecode milliseconds aligned to three digits", () => {
        expect(formatSrtTimestamp(3_600_000 + 60_000 + 1_234)).toBe("01:01:01,234");
        expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    });
});
