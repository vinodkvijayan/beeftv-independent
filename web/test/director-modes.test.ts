import { beforeEach, describe, expect, test } from "bun:test";

import { DIRECTOR_DEFAULT_MODE, DIRECTOR_ENTRY_MODE, DIRECTOR_MODES, directorModeCapabilities, resolveDirectorModeTransition, type DirectorMode } from "../src/lib/canvas/director/director-modes";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import { createDirectorSceneFromTemplate } from "../src/lib/canvas/director/director-templates";
import { useDirectorWorkbenchStore } from "../src/stores/canvas/use-director-workbench-store";

const ALL_MODES: DirectorMode[] = ["layout", "pose", "animate", "camera"];

describe("Four-mode skeleton", () => {
    test("There are exactly four first-level modes, in order: pose/pose/animation/camera", () => {
        expect(DIRECTOR_MODES.map((item) => item.mode)).toEqual(ALL_MODES);
        expect(DIRECTOR_MODES.map((item) => item.label)).toEqual(["Put on a show", "posture", "animation", "camera"]);
    });

    test("The new director's desk session defaults to stage setting, and the camera attributes are not forced to be displayed when the camera position is not selected.", () => {
        expect(DIRECTOR_DEFAULT_MODE).toBe("layout");
        expect(DIRECTOR_ENTRY_MODE).toBe("layout");
        expect(useDirectorWorkbenchStore.getState().mode).toBe("layout");
    });

    test("Each mode has readable labels and prompts to ensure discoverability", () => {
        for (const item of DIRECTOR_MODES) {
            expect(item.label.length).toBeGreaterThan(0);
            expect(item.hint.length).toBeGreaterThan(0);
        }
    });
});

describe("competency matrix", () => {
    test("Only animation mode shows timeline, allows keyframes and Auto Key", () => {
        for (const mode of ALL_MODES) {
            const capabilities = directorModeCapabilities(mode);
            expect(capabilities.timeline).toBe(mode === "animate");
            expect(capabilities.keyframes).toBe(mode === "animate");
        }
    });

    test("Staging hides bones; poses and animations show bones", () => {
        expect(directorModeCapabilities("layout").bones).toBe(false);
        expect(directorModeCapabilities("camera").bones).toBe(false);
        expect(directorModeCapabilities("pose").bones).toBe(true);
        expect(directorModeCapabilities("animate").bones).toBe(true);
    });

    test("Only camera mode highlights the shot/camera tool", () => {
        for (const mode of ALL_MODES) {
            expect(directorModeCapabilities(mode).cameraTools).toBe(mode === "camera");
        }
    });

    test("Staging does not provide advanced views such as depth/normal; it is only available in camera mode", () => {
        expect(directorModeCapabilities("layout").renderModes).toEqual(["beauty", "clay"]);
        expect(directorModeCapabilities("layout").renderModes).not.toContain("depth");
        expect(directorModeCapabilities("layout").renderModes).not.toContain("pose");
        expect(directorModeCapabilities("camera").renderModes).toContain("depth");
        expect(directorModeCapabilities("camera").renderModes).toContain("normal");
    });

    test("Pose mode provides skeletal view", () => {
        expect(directorModeCapabilities("pose").renderModes).toContain("pose");
    });

    test("The ability of unknown mode to fall back to default mode without returning undefined", () => {
        expect(directorModeCapabilities("nope" as DirectorMode)).toEqual(directorModeCapabilities("layout"));
    });
});

describe("Switch cleanup: leaving animation must not leave background animation writing", () => {
    test("When leaving animation mode, be sure to stop playback and turn off Auto Key.", () => {
        for (const mode of ["layout", "pose", "camera"] as DirectorMode[]) {
            const next = resolveDirectorModeTransition({ mode, playing: true, autoKey: true, renderMode: "beauty" });
            expect(next.playing).toBe(false);
            expect(next.autoKey).toBe(false);
        }
    });

    test("Preserve playback when staying in animation mode with Auto Key", () => {
        const next = resolveDirectorModeTransition({ mode: "animate", playing: true, autoKey: true, renderMode: "beauty" });
        expect(next.playing).toBe(true);
        expect(next.autoKey).toBe(true);
    });

    test("renderMode is clamped back into the set allowed by the target mode", () => {
        // 摄影机模式的深度视图不能带进摆场。
        expect(resolveDirectorModeTransition({ mode: "layout", playing: false, autoKey: false, renderMode: "depth" }).renderMode).toBe("beauty");
        // 姿态模式的骨骼视图同样不属于摆场。
        expect(resolveDirectorModeTransition({ mode: "layout", playing: false, autoKey: false, renderMode: "pose" }).renderMode).toBe("beauty");
        // 合法组合保持不变。
        expect(resolveDirectorModeTransition({ mode: "camera", playing: false, autoKey: false, renderMode: "normal" }).renderMode).toBe("normal");
        expect(resolveDirectorModeTransition({ mode: "layout", playing: false, autoKey: false, renderMode: "clay" }).renderMode).toBe("clay");
    });
});

describe("setMode of store", () => {
    beforeEach(() => {
        useDirectorWorkbenchStore.getState().reset();
    });

    test("Switch to the animation and then back to the scene: playing and autoKey are cleared", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("animate");
        store.getState().setPlaying(true);
        store.getState().setAutoKey(true);
        expect(store.getState().playing).toBe(true);
        expect(store.getState().autoKey).toBe(true);

        store.getState().setMode("layout");
        expect(store.getState().mode).toBe("layout");
        expect(store.getState().playing).toBe(false);
        expect(store.getState().autoKey).toBe(false);
    });

    test("Switching modes does not affect the selection status: draft ownership is managed by the workbench itself", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setSelectedObjectId("obj-1");
        store.getState().setMode("camera");
        expect(store.getState().selectedObjectId).toBe("obj-1");
        store.getState().setMode("pose");
        expect(store.getState().selectedObjectId).toBe("obj-1");
    });

    test("The playhead is not reset when switching modes: the time position is not lost due to changing views.", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("animate");
        store.getState().setPlayhead(2.5);
        store.getState().setMode("pose");
        expect(store.getState().playhead).toBe(2.5);
    });

    test("reset Return to the entrance to the field work area", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("animate");
        store.getState().reset();
        expect(store.getState().mode).toBe("layout");
    });

    test("The pose mode rejects pose/depth/normal and only accepts beauty/clay", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("layout");
        expect(store.getState().mode).toBe("layout");

        store.getState().setRenderMode("clay");
        expect(store.getState().renderMode).toBe("clay");

        // 这三个不属于摆场：必须被拒绝，且不得把已有选择冲掉。
        for (const rejected of ["pose", "depth", "normal"] as const) {
            store.getState().setRenderMode(rejected);
            expect(store.getState().renderMode).toBe("clay");
        }
    });

    test("The \"skeleton view\" of the dock is also invalid when clicked in the swing mode: the store layer clamps all paths", () => {
        const store = useDirectorWorkbenchStore;
        // dock 按钮等价于直接调 setRenderMode("pose")。
        store.getState().setRenderMode("pose");
        expect(store.getState().renderMode).toBe("beauty");
    });

    test("Camera mode only accepts depth/normal", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("camera");
        store.getState().setRenderMode("depth");
        expect(store.getState().renderMode).toBe("depth");
        store.getState().setRenderMode("normal");
        expect(store.getState().renderMode).toBe("normal");
    });

    test("Pose mode accepts skeletal view but still rejects depth view", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("pose");
        store.getState().setRenderMode("pose");
        expect(store.getState().renderMode).toBe("pose");
        store.getState().setRenderMode("depth");
        expect(store.getState().renderMode).toBe("pose");
    });

    test("Leaving the camera mode with the depth view will be clipped back to beauty, and no illegal combinations will remain.", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("camera");
        store.getState().setRenderMode("depth");
        expect(store.getState().renderMode).toBe("depth");

        store.getState().setMode("layout");
        expect(store.getState().renderMode).toBe("beauty");
    });
});

describe("mode does not enter DirectorScene schema", () => {
    test("Scenes that are compatible with factory and template generation do not have a mode field.", () => {
        expect(Object.keys(createDirectorScene("s"))).not.toContain("mode");
        expect(Object.keys(createDirectorSceneFromTemplate("dialogue"))).not.toContain("mode");
    });

    test("Switching modes does not generate any scene objects: mode is purely a workbench UI state.", () => {
        const store = useDirectorWorkbenchStore;
        const before = createDirectorSceneFromTemplate("monologue");
        const snapshot = JSON.stringify(before);
        store.getState().setMode("animate");
        store.getState().setMode("layout");
        expect(JSON.stringify(before)).toBe(snapshot);
    });
});
