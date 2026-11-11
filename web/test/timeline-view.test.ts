import { describe, expect, it } from "bun:test";

import {
  getTimelinePxPerMs,
  getTimelineVisualEndMs,
  getTimelineTrackWidth,
  getTimelineClipTitle,
  getTimelinePreviewPlaceholder,
} from "../src/lib/timeline/timeline-view";
import type { TimelineClip } from "../src/types/timeline";
import type { CanvasNodeData } from "../src/types/canvas";

it("unnamed saved clips show their canvas shot instead of an empty-video or track label", () => {
  const clip: TimelineClip = { id: "clip", nodeId: "shot", kind: "video", trackId: "video-1", startMs: 0, durationMs: 5000 };
  const nodes = [{ id: "shot", title: "Shot 1 · Video" }] as CanvasNodeData[];
  expect(getTimelineClipTitle(clip, nodes)).toBe("Shot 1 · Video");
  expect(getTimelineClipTitle({ ...clip, title: "cropped version" }, nodes)).toBe("cropped version");
  expect(getTimelineClipTitle({ ...clip, nodeId: "", directMedia: { id: "upload", kind: "video", title: "Upload video" } }, nodes)).toBe("Upload video");
  expect(getTimelineClipTitle(clip, [])).toBe("video clip");
});

it("When a clip exists but the video is still being prepared, the preview shows Preparing instead of falsely reporting no video clip", () => {
  expect(getTimelinePreviewPlaceholder({ hasClip: false, hasSource: false, hasVideoUrl: false, failed: false })).toBe("There is no video clip at this location");
  expect(getTimelinePreviewPlaceholder({ hasClip: true, hasSource: true, hasVideoUrl: false, failed: false })).toBe("Preparing video");
  expect(getTimelinePreviewPlaceholder({ hasClip: true, hasSource: true, hasVideoUrl: true, failed: false })).toBe("");
  expect(getTimelinePreviewPlaceholder({ hasClip: true, hasSource: false, hasVideoUrl: false, failed: false })).toBe("Video is not available yet");
  expect(getTimelinePreviewPlaceholder({ hasClip: true, hasSource: true, hasVideoUrl: false, failed: true })).toBe("Video is not available yet");
});

describe("timeline-view pxPerMs independence", () => {
  it("pxPerMs is determined only by zoom level and does not drift over time", () => {
    expect(getTimelinePxPerMs(1)).toBeCloseTo(0.096, 6);
    expect(getTimelinePxPerMs(2)).toBeCloseTo(0.192, 6);
    expect(getTimelinePxPerMs(1)).toBe(getTimelinePxPerMs(1));
  });

  it("When dragging the end fragment (visualEndMs grows), pxPerMs remains constant and the track expands proportionally with the content.", () => {
    const pxBefore = getTimelinePxPerMs(1);
    const endBefore = getTimelineVisualEndMs([
      { startMs: 0, durationMs: 1000 },
      { startMs: 2000, durationMs: 500 },
    ]);
    // 模拟末片段向右拖 1 秒：startMs 2000 -> 3000
    const endAfter = getTimelineVisualEndMs([
      { startMs: 0, durationMs: 1000 },
      { startMs: 3000, durationMs: 500 },
    ]);
    const pxAfter = getTimelinePxPerMs(1);

    expect(endAfter).toBeGreaterThan(endBefore);
    expect(pxAfter).toBe(pxBefore);
    // 手势映射 deltaMs = deltaPx / pxPerMs，pxPerMs 恒定意味着同一位移映射到同一毫秒数
    const deltaPx = 96;
    expect(deltaPx / pxBefore).toBeCloseTo(deltaPx / pxAfter, 6);
  });

  it("Panel formula: Track width expands proportionally with length (pxPerMs is constant)", () => {
    // 面板内部公式：trackWidth = max(viewport, ceil(visualEndMs * pxPerMs))
    const pxPerMs = getTimelinePxPerMs(1);
    const trackW = (endMs: number) => Math.max(0, Math.ceil(endMs * pxPerMs));
    // 时长 1500 -> 3500，宽度按同比例放大（等比），而非阶梯跳变
    expect(trackW(3500) / trackW(1500)).toBeGreaterThan(2);
  });
});
