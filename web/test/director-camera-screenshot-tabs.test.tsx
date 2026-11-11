import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDirectorReproScene } from "../src/lib/canvas/director/director-repro-fixture";
import { DirectorCameraScreenshotTabs, groupDirectorCameraScreenshots } from "../src/components/canvas/director/director-camera-screenshot-tabs";
import type { DirectorScreenshot } from "../src/types/director";

const screenshot = (id: string): DirectorScreenshot => ({ id, name: `${id}-shot-01`, storageKey: `resource:${id}`, url: `/api/resources/${id}`, width: 640, height: 360, createdAt: "2026-09-29T00:00:00.000Z" });

describe("Director’s desk camera screenshot page", () => {
    test("Summarize screenshots of all shots and group them by camera without losing other shots", () => {
        const scene = createDirectorReproScene();
        const first = scene.cameras[0];
        const second = { ...first, id: "camera-two", name: "Seat 2" };
        const shot = scene.shots[0];
        const withCaptures = { ...scene, cameras: [first, second], shots: [
            { ...shot, screenshots: [screenshot("first")] },
            { ...shot, id: "shot-two", cameraId: second.id, screenshots: [screenshot("second")] },
            { ...shot, id: "shot-three", screenshots: [screenshot("third")] },
        ] };
        expect(groupDirectorCameraScreenshots(withCaptures)).toEqual([
            { cameraId: first.id, cameraName: first.name, screenshots: [screenshot("first"), screenshot("third")] },
            { cameraId: second.id, cameraName: "Seat 2", screenshots: [screenshot("second")] },
        ]);
    });

    test("Display the property page by default and expose the switchable screenshot page", () => {
        const scene = createDirectorReproScene();
        const html = renderToStaticMarkup(createElement(DirectorCameraScreenshotTabs, { scene, children: createElement("span", null, "Editable lens parameters") }));
        expect(html).toContain("camera");
        expect(html).toContain('role="tab" aria-selected="true"');
        expect(html).toContain("Editable lens parameters");
        expect(html).toContain("screenshot");
    });

    test("The screenshot page displays cross-camera content without repeatedly rendering attribute controls.", () => {
        const scene = createDirectorReproScene();
        const withCapture = { ...scene, shots: scene.shots.map((shot) => ({ ...shot, screenshots: [screenshot("first")] })) };
        const html = renderToStaticMarkup(createElement(DirectorCameraScreenshotTabs, { scene: withCapture, tab: "screenshots", children: createElement("span", null, "Editable lens parameters") }));
        expect(html).toContain("first-shot-01");
        expect(html).toContain(`${scene.cameras[0].name}screenshot`);
        expect(html).not.toContain("Editable lens parameters");
    });

    test("The motion track page only displays the camera motion control, without mixing in attributes or screenshots.", () => {
        const scene = createDirectorReproScene();
        const html = renderToStaticMarkup(createElement(DirectorCameraScreenshotTabs, {
            scene,
            tab: "motion",
            motionContent: createElement("span", null, "Editable trajectory parameters"),
            children: createElement("span", null, "Editable lens parameters"),
        }));
        expect(html).toContain("Movement trajectory");
        expect(html).toContain("Editable trajectory parameters");
        expect(html).not.toContain("Editable lens parameters");
    });
});
