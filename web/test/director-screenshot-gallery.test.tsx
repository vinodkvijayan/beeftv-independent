import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorScreenshotGallery } from "../src/components/canvas/director/director-screenshot-gallery";

describe("Director's desk screenshot history display", () => {
    test("Displays a recognizable image and name when there is a screenshot of the current shot", () => {
        const html = renderToStaticMarkup(createElement(DirectorScreenshotGallery, { screenshots: [{ id: "one", name: "Camera position 3-shot-01", storageKey: "resource:image-1", url: "/api/resources/image-1", width: 1920, height: 1080, createdAt: "2026-09-29T00:00:00.000Z" }] }));
        expect(html).toContain("Camera screenshot");
        expect(html).toContain("Camera position 3-shot-01");
        expect(html).toContain('alt="Camera 3-shot-01"');
    });

    test("The camera screenshot page uses square thumbnails and does not overlap the card border.", () => {
        const html = renderToStaticMarkup(createElement(DirectorScreenshotGallery, { title: "Screenshot of camera position 3", compact: true, screenshots: [{ id: "one", name: "Camera position 3-shot-01", storageKey: "resource:image-1", url: "/api/resources/image-1", width: 1920, height: 1080, createdAt: "2026-09-29T00:00:00.000Z" }] }));
        expect(html).toContain("Screenshot of camera position 3");
        expect(html).toContain("aspect-square");
        expect(html).not.toContain("rounded-lg border");
    });
});
