import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasVideoCropEditor } from "../src/components/canvas/canvas-video-crop-dialog";

describe("CanvasVideoCropEditor", () => {
    test("renders as an inline overlay inside the original video node", () => {
        const html = renderToStaticMarkup(
            <CanvasVideoCropEditor
                videoUrl="data:video/mp4;base64,AAAA"
                videoDimensions={{ width: 1080, height: 1920 }}
                onCancel={() => {}}
                onConfirm={() => {}}
            />,
        );

        expect(html).toContain('data-video-crop-inline="true"');
        expect(html).toContain('aria-label="Video cropping selection"');
        expect(html).toContain('aria-label="Cancel cropping"');
        expect(html).toContain('aria-label="Confirm cutting"');
        expect(html).toContain("bg-white text-black");
        expect(html).toContain('stroke="#111111"');
        expect(html).not.toContain("fixed inset-0");
        expect(html).toContain('data-video-crop-metadata-loader="true"');
        expect(html).toContain('preload="metadata"');
    });
});
