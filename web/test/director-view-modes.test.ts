import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Euler, Vector3 } from "three";

import {
    DIRECTOR_DEFAULT_VIEW_MODE,
    DIRECTOR_VIEW_MODES,
    directorUsablePerspectiveProjection,
    directorViewFramingKey,
    directorViewModeCapabilities,
    resolveDirectorActiveCamera,
    resolveDirectorActiveShot,
    resolveDirectorCameraAimRotation,
    resolveDirectorCameraInspectorRotation,
    resolveDirectorCameraTransform,
    resolveDirectorEffectiveViewport,
    resolveDirectorOrthographicFraming,
    resolveDirectorOrthographicFrustum,
    resolveDirectorViewFraming,
    resolveDirectorViewUp,
    type DirectorOrthographicFrustum,
    type DirectorViewMode,
} from "../src/lib/canvas/director/director-view-modes";
import { createDirectorCamera, createDirectorLight, createDirectorObject, createDirectorScene } from "../src/lib/canvas/director/director-scene";
import type { DirectorObject, DirectorScene, DirectorVec3 } from "../src/types/director";

// 只读取工具栏源码做契约断言（见文末 describe）；视口接线不在这次任务范围内 —— 那是集成方要做的事，
// 不该让这份测试的通过与否依赖另一条 pane 正在改动的文件。
const toolbar = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-view-toolbar.tsx"), "utf8");

const AXIS_MODES = ["top", "front", "back", "left", "right"] as const;

function objectAt(position: DirectorVec3): DirectorObject {
    const object = createDirectorObject("box", "point cloud object", position);
    return { ...object, transform: { ...object.transform, scale: [0, 0, 0] } };
}

/** 只用可控的对象点位构图，摄影机/灯光清空，避免默认场景里的固定坐标干扰包围盒断言。 */
function sceneWithObjects(objects: DirectorObject[]): DirectorScene {
    return { ...createDirectorScene(), cameras: [], lights: [], objects };
}

describe("Viewing mode skeleton", () => {
    test("There are exactly seven viewing modes, the order is 3D/CAM/TOP/FRONT/BACK/LEFT/RIGHT, the modes correspond to the labels one-to-one", () => {
        expect(DIRECTOR_VIEW_MODES.map((item) => item.mode)).toEqual(["free", "camera", "top", "front", "back", "left", "right"]);
        expect(DIRECTOR_VIEW_MODES.map((item) => item.label)).toEqual(["3D", "CAM", "TOP", "FRONT", "BACK", "LEFT", "RIGHT"]);
    });

    test("The default is free perspective: the behavior is consistent before and after wiring", () => {
        expect(DIRECTOR_DEFAULT_VIEW_MODE).toBe("free");
    });

    test("Each mode has readable hints to ensure discoverability", () => {
        DIRECTOR_VIEW_MODES.forEach((item) => {
            expect(item.hint.length).toBeGreaterThan(0);
            expect(item.label.length).toBeGreaterThan(0);
        });
    });
});

describe("Camera attribute rotation and true gaze direction", () => {
    test("Manual coordinate orientation is calculated by position and focus. Switching to manual rotation should maintain the image.", () => {
        const scene = createDirectorScene();
        const camera = { ...scene.cameras[0],
            transform: { ...scene.cameras[0].transform, position: [0, 1.91, 7.6] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3 },
            target: [0, 1.2, 0] as DirectorVec3, lookAtMode: "coordinates" as const,
        };
        const rotation = resolveDirectorCameraAimRotation({ ...scene, cameras: [camera] }, camera, 0);
        expect(rotation).not.toBeNull();
        const forward = new Vector3(0, 0, -1).applyEuler(new Euler(...rotation!));
        const expected = new Vector3(...camera.target).sub(new Vector3(...camera.transform.position)).normalize();
        expect(forward.distanceTo(expected)).toBeLessThan(1e-5);
        const display = resolveDirectorCameraInspectorRotation({ ...scene, cameras: [camera] }, camera, 0);
        expect(display[0]).toBeCloseTo(5.34, 2);
        expect(display[1]).toBeCloseTo(180, 2);
        expect(display[2]).toBeCloseTo(0, 2);
    });

    test("Rotating the frame does not interrupt position interpolation; only reverts the rotation after deleting the rotation mark", () => {
        const scene = createDirectorScene();
        const base = scene.cameras[0].transform;
        const camera = { ...scene.cameras[0], transform: { ...base, position: [0, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3 }, keyframes: [
            { id: "start", time: 0, transform: { ...base, position: [0, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3 } },
            { id: "rotate", time: 1, positionKeyed: false, rotationKeyed: true, transform: { ...base, position: [100, 0, 0] as DirectorVec3, rotation: [0, Math.PI / 2, 0] as DirectorVec3 } },
            { id: "end", time: 2, transform: { ...base, position: [10, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3 } },
        ] };
        expect(resolveDirectorCameraTransform(camera, 1).position[0]).toBeCloseTo(5);
        expect(resolveDirectorCameraTransform(camera, 1).rotation[1]).toBeCloseTo(Math.PI / 2);
        const withoutRotation = { ...camera, keyframes: camera.keyframes.map((key) => key.id === "rotate" ? { ...key, rotationKeyed: false } : key) };
        expect(resolveDirectorCameraTransform(withoutRotation, 1).position[0]).toBeCloseTo(5);
        expect(resolveDirectorCameraTransform(withoutRotation, 1).rotation[1]).toBeCloseTo(0);
    });
});

describe("competency matrix", () => {
    test("3D allows surround, perspective projection, and does not take over the framing", () => {
        expect(directorViewModeCapabilities("free")).toEqual({ orbit: true, framed: false, projection: "perspective" });
    });

    test("CAM locks surround, perspective projection, and takes over framing", () => {
        expect(directorViewModeCapabilities("camera")).toEqual({ orbit: false, framed: true, projection: "perspective" });
    });

    test("Five orthogonal axes: lock surround, do not take over framing, must be orthogonal projection", () => {
        AXIS_MODES.forEach((mode) => {
            expect(directorViewModeCapabilities(mode)).toEqual({ orbit: false, framed: false, projection: "orthographic" });
        });
    });

    test("Unknown mode falls back to the default capability and does not return undefined", () => {
        expect(directorViewModeCapabilities("nope" as DirectorViewMode)).toEqual(directorViewModeCapabilities("free"));
    });
});

describe("shot/camera parsing fallback", () => {
    test("activeShotId gets the shot and its camera when hit", () => {
        const scene = createDirectorScene();
        expect(resolveDirectorActiveShot(scene)?.id).toBe(scene.activeShotId);
        expect(resolveDirectorActiveCamera(scene)?.id).toBe(scene.cameras[0].id);
    });

    test("When activeShotId points to a non-existent shot, fall back to the first shot", () => {
        const scene: DirectorScene = { ...createDirectorScene(), activeShotId: "missing" };
        expect(resolveDirectorActiveShot(scene)?.id).toBe(scene.shots[0].id);
    });

    test("When the cameraId of shot is invalid, it will fall back to the first camera instead of returning null.", () => {
        const base = createDirectorScene();
        const scene: DirectorScene = { ...base, shots: [{ ...base.shots[0], cameraId: "missing" }] };
        expect(resolveDirectorActiveCamera(scene)?.id).toBe(base.cameras[0].id);
    });

    test("Empty scenes return null instead of throwing an exception", () => {
        const scene: DirectorScene = { ...createDirectorScene(), shots: [], cameras: [] };
        expect(resolveDirectorActiveShot(scene)).toBeNull();
        expect(resolveDirectorActiveCamera(scene)).toBeNull();
    });
});

describe("CAM framing solution", () => {
    test("The default camera position of the new director's desk faces the actors and adopts the framing parameters of the reference page.", () => {
        const scene = createDirectorScene();
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(scene.cameras[0].name).toBe("Seat 1");
        expect(framing?.position).toEqual([0, 2.2, 10]);
        expect(framing?.target).toEqual([0, 1.2, 0]);
        expect(framing?.fov).toBe(50);
    });

    test("3D mode does not generate framing: free perspective is not written at all", () => {
        expect(resolveDirectorViewFraming({ scene: createDirectorScene(), mode: "free", playhead: 0 })).toBeNull();
    });

    test("The five orthogonal axes also do not trigger CAM framing: framed only belongs to camera", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            expect(resolveDirectorViewFraming({ scene, mode, playhead: 0 })).toBeNull();
        });
    });

    test("CAM mode takes the position, focus and optical parameters of the current shot camera", () => {
        const scene = createDirectorScene();
        const camera = scene.cameras[0];
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing?.cameraId).toBe(camera.id);
        expect(framing?.position).toEqual(camera.transform.position);
        expect(framing?.target).toEqual(camera.target);
        expect(framing?.fov).toBe(camera.fov);
        expect(framing?.near).toBe(camera.near);
        expect(framing?.far).toBe(camera.far);
    });

    test("In CAM mode, the position is interpolated according to the playhead: drag the timeline to preview the camera movement", () => {
        const base = createDirectorScene();
        const camera = {
            ...base.cameras[0],
            keyframes: [
                { id: "k0", time: 0, transform: { position: [0, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
                { id: "k1", time: 2, transform: { position: [10, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
            ],
        };
        const scene: DirectorScene = { ...base, cameras: [camera] };
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 1 })?.position[0]).toBeCloseTo(5, 5);
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })?.position[0]).toBeCloseTo(0, 5);
    });

    test("The camera focus and angle track are interpolated with the playhead, and the old position frames still use the static parameters of the camera position.", () => {
        const base = createDirectorScene();
        const camera = base.cameras[0];
        const animated: DirectorScene = { ...base, cameras: [{
            ...camera,
            keyframes: [
                { id: "camera-0", time: 0, transform: camera.transform, target: [0, 1, 0], fov: 50 },
                { id: "camera-2", time: 2, transform: camera.transform, target: [2, 1, 0], fov: 30 },
            ],
        }] };
        const middle = resolveDirectorViewFraming({ scene: animated, mode: "camera", playhead: 1 });
        expect(middle?.target).toEqual([1, 1, 0]);
        expect(middle?.fov).toBe(40);
        const legacy: DirectorScene = { ...base, cameras: [{ ...camera, keyframes: animated.cameras[0].keyframes.map(({ id, time, transform }) => ({ id, time, transform })) }] };
        const legacyMiddle = resolveDirectorViewFraming({ scene: legacy, mode: "camera", playhead: 1 });
        expect(legacyMiddle?.target).toEqual(camera.target);
        expect(legacyMiddle?.fov).toBe(camera.fov);
    });

    test("Focus-specific frames do not truncate position interpolation, and optical changes can still be maintained after position rails are turned off independently", () => {
        const base = createDirectorScene();
        const camera = base.cameras[0];
        const scene: DirectorScene = { ...base, cameras: [{ ...camera, keyframes: [
            { id: "p0", time: 0, transform: { ...camera.transform, position: [0, 2, 10] }, target: [0, 1, 0], fov: 50 },
            { id: "focus", time: 1, transform: { ...camera.transform, position: [100, 2, 10] }, target: [1, 1, 0], positionKeyed: false },
            { id: "p2", time: 2, transform: { ...camera.transform, position: [10, 2, 10] }, target: [2, 1, 0], fov: 40 },
        ] }] };
        const middle = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 1 });
        expect(middle?.position).toEqual([5, 2, 10]);
        expect(middle?.target).toEqual([1, 1, 0]);
        expect(middle?.fov).toBe(45);
    });

    test("Empty scenes return null in CAM mode and the viewport remains free-view instead of a black screen", () => {
        const scene: DirectorScene = { ...createDirectorScene(), shots: [], cameras: [] };
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })).toBeNull();
    });

    test("Illegal values (NaN/Infinity) do not generate framing: never write bad values into the camera", () => {
        const base = createDirectorScene();
        const broken = { ...createDirectorCamera(), transform: { position: [Number.NaN, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } };
        const brokenTarget = { ...createDirectorCamera(), target: [0, Number.POSITIVE_INFINITY, 0] as DirectorVec3 };
        const brokenFov = { ...createDirectorCamera(), fov: Number.NaN };
        [broken, brokenTarget, brokenFov].forEach((camera) => {
            const scene: DirectorScene = { ...base, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id }] };
            expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("The playhead is evaluated as 0 when it is not finite, instead of producing NaN framing.", () => {
        const scene = createDirectorScene();
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: Number.NaN });
        expect(framing).not.toBeNull();
        expect(framing?.position.every(Number.isFinite)).toBe(true);
    });

    test("When the position coincides with the focus, the focus is created along the camera -Z, and the line of sight is not a zero vector.", () => {
        const base = createDirectorScene();
        const camera = { ...createDirectorCamera(), transform: { position: [1, 1, 1] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 }, target: [1, 1, 1] as DirectorVec3 };
        const scene: DirectorScene = { ...base, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id }] };
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing).not.toBeNull();
        expect(framing?.target).toEqual([1, 1, 0]);
    });
});

function sceneWithOptics(optics: { fov?: number; near?: number; far?: number }): DirectorScene {
    const base = createDirectorScene();
    const camera = { ...base.cameras[0], ...optics };
    return { ...base, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id }] };
}

describe("Perspective projection usability: reject illegal fov/near/far written into Three", () => {
    test("Default camera optics available", () => {
        const scene = createDirectorScene();
        const camera = scene.cameras[0];
        expect(directorUsablePerspectiveProjection({ fov: camera.fov, near: camera.near, far: camera.far })).toBe(true);
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })).not.toBeNull();
    });

    test("Illegal fov (0/180/out of open range/negative/non-finite) does not generate framing", () => {
        [0, 180, 181, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach((fov) => {
            expect(directorUsablePerspectiveProjection({ fov, near: 0.05, far: 500 })).toBe(false);
            expect(resolveDirectorViewFraming({ scene: sceneWithOptics({ fov }), mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("Illegal near (0 / negative / non-finite) does not generate framing", () => {
        [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach((near) => {
            expect(directorUsablePerspectiveProjection({ fov: 50, near, far: 500 })).toBe(false);
            expect(resolveDirectorViewFraming({ scene: sceneWithOptics({ near }), mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("Framing will not occur when far is not greater than near", () => {
        [
            { near: 1, far: 1 },
            { near: 2, far: 1 },
            { near: 0.05, far: 0 },
            { near: 0.05, far: Number.NaN },
        ].forEach((optics) => {
            expect(directorUsablePerspectiveProjection({ fov: 50, ...optics })).toBe(false);
            expect(resolveDirectorViewFraming({ scene: sceneWithOptics(optics), mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("Boundaries are legal: small fov in the open interval, fov close to 180, minimal positive near and far larger", () => {
        [
            { fov: 0.1, near: 0.05, far: 500 },
            { fov: 179.9, near: 0.05, far: 500 },
            { fov: 50, near: 1e-6, far: 1e-5 },
            { fov: 50, near: 0.05, far: 0.0500001 },
        ].forEach((optics) => {
            expect(directorUsablePerspectiveProjection(optics)).toBe(true);
            const framing = resolveDirectorViewFraming({ scene: sceneWithOptics(optics), mode: "camera", playhead: 0 });
            expect(framing).not.toBeNull();
            expect(framing?.fov).toBe(optics.fov);
            expect(framing?.near).toBe(optics.near);
            expect(framing?.far).toBe(optics.far);
        });
    });
});

describe("The effective viewport falls back: use free when there is no viewport in CAM, and return to CAM after recovery.", () => {
    test("Empty CAM scene: The viewfinder is null, the active camera and surround are both set to free, and the scene is not changed.", () => {
        const scene: DirectorScene = { ...createDirectorScene(), shots: [], cameras: [] };
        const snapshot = JSON.parse(JSON.stringify(scene));
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing).toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing })).toEqual({ camera: "free", orbit: true });
        expect(scene).toEqual(snapshot);
    });

    test("Legal → Illegal → Legal: The same decision function returns deterministically to CAM", () => {
        const validScene = createDirectorScene();
        const valid = resolveDirectorViewFraming({ scene: validScene, mode: "camera", playhead: 0 });
        expect(valid).not.toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing: valid })).toEqual({ camera: "camera", orbit: false });

        const invalid = resolveDirectorViewFraming({ scene: sceneWithOptics({ fov: 0 }), mode: "camera", playhead: 0 });
        expect(invalid).toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing: invalid })).toEqual({ camera: "free", orbit: true });

        const recovered = resolveDirectorViewFraming({ scene: validScene, mode: "camera", playhead: 0 });
        expect(recovered).not.toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing: recovered })).toEqual({ camera: "camera", orbit: false });
        expect(directorViewFramingKey(recovered)).toBe(directorViewFramingKey(valid));
    });

    test("Illegal fov/near/far and empty scene follow the same free fallback", () => {
        const empty = resolveDirectorViewFraming({ scene: { ...createDirectorScene(), shots: [], cameras: [] }, mode: "camera", playhead: 0 });
        const badFov = resolveDirectorViewFraming({ scene: sceneWithOptics({ fov: 180 }), mode: "camera", playhead: 0 });
        const badNear = resolveDirectorViewFraming({ scene: sceneWithOptics({ near: 0 }), mode: "camera", playhead: 0 });
        const badFar = resolveDirectorViewFraming({ scene: sceneWithOptics({ near: 10, far: 1 }), mode: "camera", playhead: 0 });
        [empty, badFov, badNear, badFar].forEach((framing) => {
            expect(framing).toBeNull();
            expect(resolveDirectorEffectiveViewport({ mode: "camera", framing })).toEqual({ camera: "free", orbit: true });
        });
    });

    test("The 3D mode is always free, and the camera will not be switched even if the CAM viewfinder is entered by mistake.", () => {
        const framing = resolveDirectorViewFraming({ scene: createDirectorScene(), mode: "camera", playhead: 0 });
        expect(resolveDirectorEffectiveViewport({ mode: "free", framing })).toEqual({ camera: "free", orbit: true });
        expect(resolveDirectorEffectiveViewport({ mode: "free", framing: null })).toEqual({ camera: "free", orbit: true });
    });

    test("Five orthogonal axes do not go CAM fallback: always orthogonal and locked around", () => {
        AXIS_MODES.forEach((mode) => {
            expect(resolveDirectorEffectiveViewport({ mode, framing: null })).toEqual({ camera: "orthographic", orbit: false });
        });
    });

    test("The fallback decision is a pure function, no scene / history input is generated", () => {
        const scene = createDirectorScene();
        const objectsRef = scene.objects;
        const camerasRef = scene.cameras;
        const snapshot = JSON.parse(JSON.stringify(scene));
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        resolveDirectorEffectiveViewport({ mode: "camera", framing });
        resolveDirectorEffectiveViewport({ mode: "camera", framing: null });
        expect(scene).toEqual(snapshot);
        expect(scene.objects).toBe(objectsRef);
        expect(scene.cameras).toBe(camerasRef);
    });
});

describe("up vector: preserve the Dutch angle and never be collinear with the line of sight", () => {
    test("The world is up when there is no roll", () => {
        expect(resolveDirectorViewUp([0, 0, 0], [0, 0, -1])).toEqual([0, 1, 0]);
    });

    test("When there is a roll, the up rotates: the Dutch angle that would be lost with the naked lookAt is here to stay", () => {
        const up = resolveDirectorViewUp([0, 0, Math.PI / 2], [0, 0, -1]);
        expect(up[0]).toBeCloseTo(-1, 5);
        expect(up[1]).toBeCloseTo(0, 5);
        expect(Math.abs(up[1] - 1)).toBeGreaterThan(0.5);
    });

    test("Change to alternative up when looking down is degenerate, the cross product is non-zero (otherwise lookAt solves for a NaN matrix)", () => {
        const view: DirectorVec3 = [0, -1, 0];
        const up = resolveDirectorViewUp([0, 0, 0], view);
        expect(up).toEqual([0, 0, -1]);
        expect(new Vector3(...up).cross(new Vector3(...view)).length()).toBeGreaterThan(1e-6);
    });

    test("Looking up is also not collinear", () => {
        const view: DirectorVec3 = [0, 1, 0];
        const up = resolveDirectorViewUp([0, 0, 0], view);
        expect(new Vector3(...up).cross(new Vector3(...view)).length()).toBeGreaterThan(1e-6);
    });

    test("When the line of sight is zero vector, the world up is returned and no illegal value is returned.", () => {
        expect(resolveDirectorViewUp([0, 0, 0], [0, 0, 0])).toEqual([0, 1, 0]);
    });

    test("Up is not collinear with the line of sight in any direction: sampling covers the sphere", () => {
        const angles = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI];
        angles.forEach((pitch) =>
            angles.forEach((roll) => {
                const rotation: DirectorVec3 = [pitch, 0, roll];
                const view = new Vector3(0, 0, -1).applyEuler(new Euler(...rotation)).toArray() as DirectorVec3;
                const up = resolveDirectorViewUp(rotation, view);
                expect(up.every(Number.isFinite)).toBe(true);
                expect(new Vector3(...up).cross(new Vector3(...view)).length()).toBeGreaterThan(1e-6);
            }),
        );
    });
});

describe("Viewing sync button", () => {
    test("Empty string when there is no viewfinder: 3D mode does not trigger camera writeback", () => {
        expect(directorViewFramingKey(null)).toBe("");
    });

    test("The same viewing value is stable: the object's identity change does not cause resynchronization", () => {
        const scene = createDirectorScene();
        const first = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        const second = resolveDirectorViewFraming({ scene: { ...scene, cameras: [{ ...scene.cameras[0] }] }, mode: "camera", playhead: 0 });
        expect(directorViewFramingKey(first)).toBe(directorViewFramingKey(second));
    });

    test("The keys change when the playhead is advanced, causing the framing to change.", () => {
        const base = createDirectorScene();
        const camera = {
            ...base.cameras[0],
            keyframes: [
                { id: "k0", time: 0, transform: { position: [0, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
                { id: "k1", time: 2, transform: { position: [10, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
            ],
        };
        const scene: DirectorScene = { ...base, cameras: [camera] };
        const at0 = directorViewFramingKey(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 }));
        const at1 = directorViewFramingKey(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 1 }));
        expect(at0).not.toBe(at1);
    });

    test("Key changes when changing cameras: You have to recompose to switch shots", () => {
        const base = createDirectorScene();
        const other = createDirectorCamera("secondary camera");
        const scene: DirectorScene = { ...base, cameras: [other], shots: [{ ...base.shots[0], cameraId: other.id }] };
        const first = directorViewFramingKey(resolveDirectorViewFraming({ scene: base, mode: "camera", playhead: 0 }));
        const second = directorViewFramingKey(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 }));
        expect(first).not.toBe(second);
    });
});

describe("Orthoaxial framing: usability and basic shapes", () => {
    test("free/camera is not an orthogonal axis, returns null", () => {
        const scene = createDirectorScene();
        expect(resolveDirectorOrthographicFraming({ scene, mode: "free" })).toBeNull();
        expect(resolveDirectorOrthographicFraming({ scene, mode: "camera" })).toBeNull();
    });

    test("All five orthogonal axes return non-empty views, and all numerical fields are limited.", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode });
            expect(framing).not.toBeNull();
            expect([...framing!.position, ...framing!.target, ...framing!.up, framing!.horizontalSpan, framing!.verticalSpan, framing!.near, framing!.far].every(Number.isFinite)).toBe(true);
        });
    });

    test("near is always smaller than far, and they are all finite positive numbers", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expect(framing.near).toBeGreaterThan(0);
            expect(framing.far).toBeGreaterThan(framing.near);
        });
    });

    test("horizontalSpan and verticalSpan are always positive numbers and will never degenerate to 0 (otherwise the orthogonal camera will become infinitely zoomed)", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expect(framing.horizontalSpan).toBeGreaterThan(0);
            expect(framing.verticalSpan).toBeGreaterThan(0);
        });
    });

    test("The results of calling the same input twice are exactly the same: a pure function with stable and repeatable values.", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            expect(resolveDirectorOrthographicFraming({ scene, mode })).toEqual(resolveDirectorOrthographicFraming({ scene, mode }));
        });
    });
});

describe("Orthogonal axial framing: the five directions are strictly self-consistent with up", () => {
    const asymmetric = () => sceneWithObjects([objectAt([-1, -1, -1]), objectAt([3, 3, 3])]);

    test("top: Look towards -Y, the position is directly above the target, up is -Z", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "top" })!;
        expect(framing.up).toEqual([0, 0, -1]);
        expect(framing.position[1]).toBeGreaterThan(framing.target[1]);
        expect(framing.position[0]).toBeCloseTo(framing.target[0], 5);
        expect(framing.position[2]).toBeCloseTo(framing.target[2], 5);
    });

    test("front: looking towards -Z, the position is on the +Z side of the target, up is +Y", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "front" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[2]).toBeGreaterThan(framing.target[2]);
        expect(framing.position[0]).toBeCloseTo(framing.target[0], 5);
    });

    test("back: looking towards +Z, the position is on the -Z side of the target, up is +Y, directly opposite the front", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "back" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[2]).toBeLessThan(framing.target[2]);
    });

    test("left: looking towards +X, the position is on the -X side of the target, up is +Y", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "left" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[0]).toBeLessThan(framing.target[0]);
    });

    test("right: looking towards -X, the position is on the +X side of the target, up is +Y, directly opposite left", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "right" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[0]).toBeGreaterThan(framing.target[0]);
    });

    test("up is always orthogonal to the direction of view and never collinear", () => {
        const scene = asymmetric();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            const view = framing.target.map((value, index) => value - framing.position[index]);
            const dot = view.reduce((sum, value, index) => sum + value * framing.up[index], 0);
            expect(Math.abs(dot)).toBeLessThan(1e-9);
        });
    });
});

describe("Orthogonal axial framing: bounding box driven target and verticalSpan", () => {
    test("target is the center of the bounding box of the visible content", () => {
        const scene = sceneWithObjects([objectAt([-3, 1, -2]), objectAt([5, 4, 6])]);
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(framing.target).toEqual([1, 2.5, 2]);
    });

    test("The projection span depends on the screen axis: top=X/Z, front/back=X/Y, left/right=Z/Y", () => {
        // x 范围 10，y 范围 4，z 范围 6 —— 三轴都不同，能分辨每一种模式读了哪两根轴。
        const scene = sceneWithObjects([objectAt([0, 0, 0]), objectAt([10, 4, 6])]);
        const top = resolveDirectorOrthographicFraming({ scene, mode: "top" })!;
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        const back = resolveDirectorOrthographicFraming({ scene, mode: "back" })!;
        const left = resolveDirectorOrthographicFraming({ scene, mode: "left" })!;
        const right = resolveDirectorOrthographicFraming({ scene, mode: "right" })!;
        expect(top.horizontalSpan / front.horizontalSpan).toBeCloseTo(1, 5);
        expect(top.verticalSpan / front.verticalSpan).toBeCloseTo(6 / 4, 5);
        expect(front.horizontalSpan).toBeCloseTo(back.horizontalSpan, 9);
        expect(front.verticalSpan).toBeCloseTo(back.verticalSpan, 9);
        expect(left.horizontalSpan).toBeCloseTo(right.horizontalSpan, 9);
        expect(left.verticalSpan).toBeCloseTo(right.verticalSpan, 9);
        expect(front.verticalSpan).toBeCloseTo(left.verticalSpan, 9);
        expect(left.horizontalSpan / front.horizontalSpan).toBeCloseTo(6 / 10, 5);
        expect(top.horizontalSpan / left.horizontalSpan).toBeCloseTo(10 / 6, 5);
    });

    test("verticalSpan scales linearly with the bounding box: the content is enlarged by 2 times, and the viewing height is also enlarged by 2 times.", () => {
        const small = sceneWithObjects([objectAt([-1, -1, -1]), objectAt([1, 1, 1])]);
        const large = sceneWithObjects([objectAt([-2, -2, -2]), objectAt([2, 2, 2])]);
        const smallSpan = resolveDirectorOrthographicFraming({ scene: small, mode: "front" })!.verticalSpan;
        const largeSpan = resolveDirectorOrthographicFraming({ scene: large, mode: "front" })!.verticalSpan;
        expect(largeSpan / smallSpan).toBeCloseTo(2, 5);
    });

    test("Under the symmetrical cubic bounding box, the five axial verticalSpans are completely equal.", () => {
        const scene = sceneWithObjects([objectAt([-2, -2, -2]), objectAt([2, 2, 2])]);
        const spans = AXIS_MODES.map((mode) => resolveDirectorOrthographicFraming({ scene, mode })!.verticalSpan);
        spans.forEach((span) => expect(span).toBeCloseTo(spans[0], 9));
    });

    test("Large scale and rotated objects are composed according to the corners, no longer looking only at the center resulting in cropping", () => {
        const wide = createDirectorObject("plane", "background board", [0, 1, 0]);
        wide.transform = { position: [0, 1, 0], rotation: [0, Math.PI / 4, 0], scale: [10, 4, 2] };
        const scene = sceneWithObjects([wide]);
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        const top = resolveDirectorOrthographicFraming({ scene, mode: "top" })!;

        expect(front.horizontalSpan).toBeGreaterThan(8);
        expect(front.verticalSpan).toBeCloseTo(4 * 1.2, 6);
        expect(top.horizontalSpan).toBeGreaterThan(8);
        expect(top.verticalSpan).toBeGreaterThan(8);
    });
});

describe("Orthogonal axial framing: empty scene and illegal data fallback", () => {
    test("Empty scenes (no objects/cameras/lights) fall back to the safe default bounding box, with the target at the origin.", () => {
        const scene = sceneWithObjects([]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expect(framing).not.toBeNull();
            expect(framing.target).toEqual([0, 0, 0]);
            expect(framing.horizontalSpan).toBeGreaterThan(0);
            expect(framing.verticalSpan).toBeGreaterThan(0);
        });
    });

    test("When all points are illegal (NaN/Infinity), fall back to the safe default bounding box instead of producing non-finite values.", () => {
        const base = createDirectorScene();
        const scene: DirectorScene = {
            ...base,
            objects: [objectAt([Number.NaN, 0, 0]), objectAt([0, Number.POSITIVE_INFINITY, 0])],
            cameras: [{ ...createDirectorCamera(), transform: { position: [Number.NaN, Number.NaN, Number.NaN], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
            lights: [{ ...createDirectorLight("point", "bad lighting", [0, 0, 0]), transform: { position: [Number.NEGATIVE_INFINITY, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
        };
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(framing.target).toEqual([0, 0, 0]);
        expect([...framing.position, framing.horizontalSpan, framing.verticalSpan, framing.near, framing.far].every(Number.isFinite)).toBe(true);
    });

    test("When some points are illegal, only legal points are used to calculate the bounding box, which will not be contaminated by bad values.", () => {
        const scene = sceneWithObjects([objectAt([0, 0, 0]), objectAt([Number.NaN, 5, 0]), objectAt([4, 4, 0])]);
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        // 合法点只有 (0,0,0) 与 (4,4,0)：中心 (2,2,0)。
        expect(framing.target).toEqual([2, 2, 0]);
    });

    test("Hidden objects are not included in the bounding box, only visible content participates in the composition", () => {
        const visible = objectAt([0, 0, 0]);
        const hidden: DirectorObject = { ...objectAt([100, 100, 100]), visible: false };
        const scene = sceneWithObjects([visible, hidden]);
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(framing.target).toEqual([0, 0, 0]);
    });
});

function expectFrustumFits(frustum: DirectorOrthographicFrustum, horizontalSpan: number, verticalSpan: number, aspect: number) {
    const width = frustum.right - frustum.left;
    const height = frustum.top - frustum.bottom;
    expect(frustum.halfWidth).toBeGreaterThan(0);
    expect(frustum.halfHeight).toBeGreaterThan(0);
    expect([frustum.halfWidth, frustum.halfHeight, frustum.left, frustum.right, frustum.top, frustum.bottom].every(Number.isFinite)).toBe(true);
    expect(width).toBeGreaterThanOrEqual(horizontalSpan - 1e-9);
    expect(height).toBeGreaterThanOrEqual(verticalSpan - 1e-9);
    expect(width / height).toBeCloseTo(aspect, 9);
    expect(frustum.left).toBeCloseTo(-frustum.halfWidth, 9);
    expect(frustum.right).toBeCloseTo(frustum.halfWidth, 9);
    expect(frustum.top).toBeCloseTo(frustum.halfHeight, 9);
    expect(frustum.bottom).toBeCloseTo(-frustum.halfHeight, 9);
}

describe("Orthogonal view frustum: accommodates both horizontal and vertical spans", () => {
    test("Extremely wide content: square viewport bottom half-width equals half horizontal span, not height × aspect", () => {
        const scene = sceneWithObjects([objectAt([-40, 0, 0]), objectAt([40, 2, 0])]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 1 }), framing.horizontalSpan, framing.verticalSpan, 1);
        });
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(front.horizontalSpan).toBeCloseTo(80 * 1.2, 9);
        const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: front.horizontalSpan, verticalSpan: front.verticalSpan, aspect: 1 });
        expect(frustum.halfWidth).toBeCloseTo(front.horizontalSpan / 2, 9);
        expect(frustum.halfWidth).toBeGreaterThan(front.verticalSpan / 2);
    });

    test("Extremely tall content: The lower half height of the square viewport is equal to half of the vertical span, and the horizontal direction is padded by aspect.", () => {
        const scene = sceneWithObjects([objectAt([0, -40, 0]), objectAt([2, 40, 0])]);
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(front.verticalSpan).toBeCloseTo(80 * 1.2, 9);
        const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: front.horizontalSpan, verticalSpan: front.verticalSpan, aspect: 1 });
        expectFrustumFits(frustum, front.horizontalSpan, front.verticalSpan, 1);
        expect(frustum.halfHeight).toBeCloseTo(front.verticalSpan / 2, 9);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 1 }), framing.horizontalSpan, framing.verticalSpan, 1);
        });
    });

    test("A narrow viewport (aspect=0.5) still fits two spans at the same time, and the aspect ratio remains 0.5", () => {
        const scene = sceneWithObjects([objectAt([-5, 0, 0]), objectAt([5, 4, 0])]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 0.5 }), framing.horizontalSpan, framing.verticalSpan, 0.5);
        });
    });

    test("A wide viewport (aspect=2) still fits both spans at the same time, and the aspect ratio remains 2", () => {
        const scene = sceneWithObjects([objectAt([0, 0, 0]), objectAt([4, 4, 4])]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 2 }), framing.horizontalSpan, framing.verticalSpan, 2);
        });
    });

    test("After the empty scene falls back to the default bounding box, the view frustum is still limited and positive, and can accommodate two spans.", () => {
        const scene = sceneWithObjects([]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 16 / 9 });
            expectFrustumFits(frustum, framing.horizontalSpan, framing.verticalSpan, 16 / 9);
        });
    });

    test("fall back to square when aspect is 0 / negative / NaN / ±Infinity, half range is still limited and positive", () => {
        [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach((aspect) => {
            const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: 10, verticalSpan: 10, aspect });
            expectFrustumFits(frustum, 10, 10, 1);
            expect(frustum.halfWidth).toBeCloseTo(frustum.halfHeight, 9);
        });
    });

    test("A span of 0 / Negative / NaN / ±Infinity still gives a finite positive half range", () => {
        const invalid = [0, -4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        invalid.forEach((horizontalSpan) =>
            invalid.forEach((verticalSpan) => {
                const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan, verticalSpan, aspect: 1 });
                expect(frustum.halfWidth).toBeGreaterThan(0);
                expect(frustum.halfHeight).toBeGreaterThan(0);
                expect([frustum.halfWidth, frustum.halfHeight, frustum.left, frustum.right, frustum.top, frustum.bottom].every(Number.isFinite)).toBe(true);
                expect(frustum.halfWidth).toBeCloseTo(frustum.halfHeight, 9);
            }),
        );
    });

    test("Extremely wide content of left/right fits horizontal span along Z, extremely wide content of top fits horizontal span along X", () => {
        const alongZ = sceneWithObjects([objectAt([0, 0, -40]), objectAt([0, 2, 40])]);
        const left = resolveDirectorOrthographicFraming({ scene: alongZ, mode: "left" })!;
        const right = resolveDirectorOrthographicFraming({ scene: alongZ, mode: "right" })!;
        expect(left.horizontalSpan).toBeCloseTo(80 * 1.2, 9);
        expect(right.horizontalSpan).toBeCloseTo(left.horizontalSpan, 9);
        expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: left.horizontalSpan, verticalSpan: left.verticalSpan, aspect: 1 }), left.horizontalSpan, left.verticalSpan, 1);

        const alongX = sceneWithObjects([objectAt([-40, 0, 0]), objectAt([40, 0, 2])]);
        const top = resolveDirectorOrthographicFraming({ scene: alongX, mode: "top" })!;
        expect(top.horizontalSpan).toBeCloseTo(80 * 1.2, 9);
        expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: top.horizontalSpan, verticalSpan: top.verticalSpan, aspect: 1 }), top.horizontalSpan, top.verticalSpan, 1);
    });
});

describe("Orthogonal axial framing: Never write a scene", () => {
    test("The identity of the scene passed in and its objects/cameras/lights array remain unchanged after the call.", () => {
        const scene = createDirectorScene();
        const snapshot = JSON.parse(JSON.stringify(scene));
        const objectsRef = scene.objects;
        const camerasRef = scene.cameras;
        const lightsRef = scene.lights;
        (["free", "camera", ...AXIS_MODES] as const).forEach((mode) => {
            resolveDirectorOrthographicFraming({ scene, mode });
        });
        expect(scene).toEqual(snapshot);
        expect(scene.objects).toBe(objectsRef);
        expect(scene.cameras).toBe(camerasRef);
        expect(scene.lights).toBe(lightsRef);
    });
});

describe("The switcher can be discovered, the keyboard can be used, and there are no new global styles.", () => {
    test("Use native button and express persistent view state with aria-pressed", () => {
        expect(toolbar).toContain('type="button"');
        expect(toolbar).toContain("aria-pressed={active}");
        expect(toolbar).toContain('role="group"');
        expect(toolbar).toContain('aria-label="Director\'s desk framing mode"');
    });

    test("The main angle of view and the direction ball axis have readable names.", () => {
        expect(toolbar).toContain("aria-label={label}");
        expect(toolbar).toContain('aria-label="directional ball"');
        expect(toolbar).toContain('aria-label={head.label}');
        expect(toolbar).toContain('aria-label="Reset perspective"');
        expect(toolbar).toContain("title={item.hint}");
    });

    test("Preserve keyboard focus ring and respect reduced-motion", () => {
        expect(toolbar).toContain("focus-visible:outline");
        expect(toolbar).toContain("motion-reduce:transition-none");
    });

    test("Release the focus after clicking, otherwise the W/E/R transformation shortcut keys will be eaten by the guard.", () => {
        expect(toolbar).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("Only use existing tokens, do not write color literals", () => {
        expect(toolbar).toContain("var(--director-dock-surface)");
        expect(toolbar).toContain("var(--director-dock-active-surface)");
        expect(toolbar).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(toolbar).not.toMatch(/\brgba?\(/);
    });

    test("Do not reuse the hard-coded square size dock button class: CAM is a text label", () => {
        const classNames = [...toolbar.matchAll(/className="([^"]*)"/g)].map((match) => match[1]).join(" ");
        expect(classNames.length).toBeGreaterThan(0);
        expect(classNames).not.toContain("director-viewport-dock");
    });

    test("The main perspective is rendered from the ability list, and the orthogonal five-axis is provided by the direction ball.", () => {
        expect(toolbar).toContain("DIRECTOR_VIEW_MODES.filter((item) => primaryModes.has(item.mode))");
        expect(toolbar).toContain("primary.map((item) => {");
        expect(toolbar).toContain("heads.map((head) => {");
    });

    test("All seven modes are rendered: DIRECTOR_VIEW_MODES has several items, and the toolbar automatically displays several buttons.", () => {
        expect(DIRECTOR_VIEW_MODES).toHaveLength(7);
    });
});
