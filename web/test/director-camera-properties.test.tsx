import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorCameraProperties } from "@/components/canvas/director/director-camera-properties";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";

describe("Director's desk camera properties preview", () => {
    test("The properties area first displays the 16:9 preview and FOV of the current camera position.", () => {
        const scene = createDirectorScene();
        const html = renderToStaticMarkup(createElement(DirectorCameraProperties, {
            scene,
            camera: scene.cameras[0],
            cameras: scene.cameras,
            shot: scene.shots[0],
            objects: scene.objects,
            onUpdateCamera: () => {},
            onSelectCamera: () => {},
            onFollowObject: () => {},
            children: createElement("span", null, "Lens advanced parameters"),
        }));

        expect(html).toContain('aria-label="Camera Preview"');
        expect(html).toContain("FOV 50°");
        expect(html).toContain('aria-label="Enlarge camera preview"');
    });

    test("When the playhead is at an animation frame, the attribute input and FOV logo show that frame instead of the base camera position value", () => {
        const scene = createDirectorScene();
        const camera = { ...scene.cameras[0], keyframes: [{
            id: "animated-camera", time: 2,
            transform: { ...scene.cameras[0].transform, position: [4, 2, 3] as [number, number, number] },
            target: [1, 1.2, 0] as [number, number, number], fov: 35,
        }] };
        const html = renderToStaticMarkup(createElement(DirectorCameraProperties, {
            scene: { ...scene, cameras: [camera] },
            camera, cameras: [camera], shot: scene.shots[0], objects: scene.objects,
            playhead: 2,
            onUpdateCamera: () => {}, onSelectCamera: () => {}, onFollowObject: () => {},
            children: null,
        }));
        expect(html).toContain("FOV 35°");
        expect(html).toMatch(/aria-label="位置 X"[^>]*value="4(?:\.0)?"/);
        expect(html).toMatch(/aria-label="注视坐标 X"[^>]*value="1(?:\.0)?"/);
        expect(html).toMatch(/aria-label="FOV 数值"[^>]*value="35"/);
    });

    test("Reference page Axis-by-axis buttons share vector track status: three-axis simultaneous marking, independent viewing angles", () => {
        const scene = createDirectorScene();
        const camera = { ...scene.cameras[0], keyframes: [{
            id: "optics", time: 2, positionKeyed: false,
            transform: scene.cameras[0].transform,
            target: [1, 1.2, 0] as [number, number, number],
        }] };
        const render = (playhead: number) => renderToStaticMarkup(createElement(DirectorCameraProperties, {
            scene: { ...scene, cameras: [camera] },
            camera, cameras: [camera], shot: scene.shots[0], objects: scene.objects,
            playhead, onToggleTrack: () => {}, onUpdateCamera: () => {}, onSelectCamera: () => {}, onFollowObject: () => {}, children: null,
        }));
        const atKey = render(2);
        expect((atKey.match(/aria-label="当前帧有关键帧"/g) || []).length).toBe(6);
        expect((atKey.match(/aria-label="当前帧无关键帧"/g) || []).length).toBe(4);
        const away = render(1);
        expect((away.match(/aria-label="当前帧有关键帧"/g) || []).length).toBe(0);
        expect((away.match(/aria-label="当前帧无关键帧"/g) || []).length).toBe(10);
    });

    test("Manual coordinate mode always displays the three axes of rotation calculated from the screen gaze direction.", () => {
        const scene = createDirectorScene();
        const camera = { ...scene.cameras[0],
            transform: { ...scene.cameras[0].transform, position: [0, 1.91, 7.6] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
            target: [0, 1.2, 0] as [number, number, number], lookAtMode: "coordinates" as const,
        };
        const html = renderToStaticMarkup(createElement(DirectorCameraProperties, {
            scene: { ...scene, cameras: [camera] }, camera, cameras: [camera], shot: scene.shots[0], objects: scene.objects,
            playhead: 0, onToggleTrack: () => {}, onUpdateCamera: () => {}, onSelectCamera: () => {}, onFollowObject: () => {}, children: null,
        }));
        expect(html).toMatch(/aria-label="旋转 X"[^>]*value="5\.34"/);
        expect(html).toMatch(/aria-label="旋转 Y"[^>]*value="180(?:\.0)?"/);
        expect((html.match(/aria-label="当前帧无关键帧"/g) || []).length).toBe(10);
    });
});
