import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasTimelinePreview } from "@/components/canvas/canvas-timeline-preview";
import { canvasThemes } from "@/lib/canvas-theme";
import type { TimelineClip, TimelineTrack } from "@/types/timeline";

const tracks: TimelineTrack[] = [{ id: "video", kind: "video", label: "video", order: 0 }];
const clips: TimelineClip[] = [{
    id: "clip",
    kind: "video",
    nodeId: "",
    trackId: "video",
    startMs: 0,
    durationMs: 2000,
    directMedia: { id: "media", kind: "video", title: "fragment", url: "/video.mp4" },
}];

function render(playheadMs: number) {
    return renderToStaticMarkup(
        <CanvasTimelinePreview
            clips={clips}
            tracks={tracks}
            nodes={[]}
            playheadMs={playheadMs}
            playing={false}
            theme={Object.values(canvasThemes)[0]}
            onTogglePlay={() => {}}
            onRequestPause={() => {}}
            onPlayheadChange={() => {}}
        />,
    );
}

test("When the playhead is dropped on a video clip but the video has not yet been parsed, the preview shows preparing instead of no video clip", () => {
    const markup = render(500);
    expect(markup).toContain("Preparing video");
    expect(markup).not.toContain("There is no video clip at this location");
});

test("No video clips are displayed until the playhead is not on any video clips", () => {
    expect(render(3000)).toContain("There is no video clip at this location");
});
