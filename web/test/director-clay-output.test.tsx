import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { directorClayVideoMetadata, isSilentDirectorClayVideo } from "../src/lib/canvas/director/director-clay-output";
import { DirectorExportNotice } from "../src/components/canvas/director/director-export-notice";
import { normalizeVideoPlayerMimeType } from "../src/components/video-player";
import { canvasNodeVideoPreviewUrl } from "../src/lib/canvas/canvas-media-preview";
import { CanvasNodeType } from "../src/types/canvas";

const image = { url: "/api/resources/cover/file", storageKey: "resource:cover", width: 1280, height: 720, bytes: 2000, mimeType: "image/png" };
const video = { url: "/api/resources/clay/file", storageKey: "resource:clay", bytes: 3000, mimeType: "video/webm" };

test("The director's stage white film video reuses the exported composition as the cover, and clearly marks mute to allow the canvas to play automatically.", () => {
    const metadata = directorClayVideoMetadata(video, image);
    expect(metadata.content).toBe(video.url);
    expect(metadata.storageKey).toBe(video.storageKey);
    expect(metadata.hasAudio).toBe(false);
    expect(metadata.videoPreview).toMatchObject({ content: image.url, storageKey: image.storageKey, sourceKey: video.storageKey });
    expect(canvasNodeVideoPreviewUrl({ id: "clay", type: CanvasNodeType.Video, title: "White film video", position: { x: 0, y: 0 }, width: 360, height: 220, metadata })).toBe(image.url);
});

test("When the video itself has a cover available, the video cover will be used first.", () => {
    const preview = { ...image, url: "/api/resources/video-poster/file", storageKey: "resource:video-poster" };
    const metadata = directorClayVideoMetadata({ ...video, preview }, image);
    expect(metadata.videoPreview?.content).toBe(preview.url);
    expect(metadata.videoPreview?.sourceKey).toBe(video.storageKey);
});

test("The recorder's WebM codec parameter will not cause the canvas player to mistakenly parse MP4", () => {
    const metadata = directorClayVideoMetadata({ ...video, mimeType: "video/webm;codecs=vp9" }, image);
    expect(metadata.mimeType).toBe("video/webm");
    expect(normalizeVideoPlayerMimeType("video/webm;codecs=vp9")).toBe("video/webm");
    expect(normalizeVideoPlayerMimeType("video/mp4;codecs=avc1")).toBe("video/mp4");
});

test("The exported old albuginea node is still recognized as mute", () => {
    expect(isSilentDirectorClayVideo({ workflowKind: "reference_video", assetTags: ["Director's white film"] })).toBe(true);
    expect(isSilentDirectorClayVideo({ workflowKind: "reference_video", assetTags: ["Other videos"] })).toBe(false);
});

test("The success and failure feedback of the director's console export can be seen directly in the workbench.", () => {
    const success = renderToStaticMarkup(<DirectorExportNotice kind="success" text="The white film video has been exported and can be previewed and played in the canvas" />);
    const warning = renderToStaticMarkup(<DirectorExportNotice kind="warning" text="The white film video has been exported, and the file is currently only on this device." />);
    const error = renderToStaticMarkup(<DirectorExportNotice kind="error" text="Export failed, please try again" />);
    expect(success).toContain('role="status"');
    expect(success).toContain("The white film video has been exported and can be previewed and played in the canvas");
    expect(warning).toContain('role="status"');
    expect(warning).toContain("The white film video has been exported, and the file is currently only on this device.");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Export failed, please try again");
});
