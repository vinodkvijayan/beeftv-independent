import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useDirectorWorkbenchStore } from "../src/stores/canvas/use-director-workbench-store";

/**
 * 生产接线回归：新建直达空导演台，已有场景原样打开，模式切换安全清理。
 */
const workbench = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8");
const dock = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-viewport-dock.tsx"), "utf8");
const viewport = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-viewport.tsx"), "utf8");
const hook = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-director.ts"), "utf8");
const uploadHook = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-upload.ts"), "utf8");
const project = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const directorNodePanel = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-node-panel.tsx"), "utf8");
const store = readFileSync(resolve(import.meta.dir, "../src/stores/canvas/use-director-workbench-store.ts"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

function slice(source: string, from: string, to: string) {
    const start = source.indexOf(from);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(to, start + from.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("The newly created scene leads directly to the empty director's podium", () => {
    test("The create function only receives the canvas position and creates an empty scene", () => {
        expect(hook).toContain("const createDirectorShot = useCallback((position?: Position) => {");
        expect(hook).toContain('createDirectorSceneFromTemplate("empty", `镜头 ${shotIndex}`)');
        expect(hook).toContain("setDirectorNodeId(node.id);");
    });

    test("The three creation portals of the canvas are created directly, and the right-click portal passes the click position.", () => {
        expect(project).toContain("onOpenDirector: () => createDirectorShot()");
        expect(project).toContain("onOpenDirector={() => createDirectorShot()}");
        expect(project).toContain("onOpenDirector={(position) => createDirectorShot(position)}");
        expect(project).not.toContain("CanvasDirectorTemplateModal");
        expect(project).not.toContain("directorTemplateRequest");
    });

    test("The new director's desk node is an independent type and does not declare video generation input.", () => {
        expect(hook).toContain("createCanvasNode(CanvasNodeType.Director");
        expect(hook).toContain("node.title = directorTitle;");
        expect(hook).toContain("nextDirectorNodeIndex(nodesRef.current)");
        expect(hook).not.toContain('generationMode: "video"');
        expect(hook).not.toContain('videoEditOperation: "text_to_video"');
        expect(hook).not.toContain('composerContent: ""');
    });

});

describe("Existing scenes do not trigger template selection", () => {
    test("openDirectorWorkbench does not create a new scene or play a template when it hits an existing scene.", () => {
        const opener = slice(hook, "const openDirectorWorkbench = useCallback", "/** Each save is based on store");
        // 只有找不到场景（孤儿节点修复）才补建。
        expect(opener).toContain("if (!scene) {");
        expect(opener).toContain('createDirectorSceneFromTemplate("empty"');
        expect(opener).not.toContain("setDirectorTemplateRequest");
    });

    test("The node no longer carries the generation prompt words, and the scene generation entrance is left to the subsequent director's desk function.", () => {
        const opener = slice(hook, "const openDirectorWorkbench = useCallback", "/** Each save is based on store");
        expect(opener).toContain("setDirectorNodeId(nodeId);");
        expect(opener).not.toContain("updateDirectorShotPrompt");
        expect(directorNodePanel).not.toContain("onPromptChange");
        expect(directorNodePanel).not.toContain("composerContent");
        expect(directorNodePanel).not.toContain("textarea");
    });

    test("Empty scenes for orphan repair: no actors allowed if the user has not selected them", () => {
        const opener = slice(hook, "const openDirectorWorkbench = useCallback", "/** Each save is based on store");
        expect(opener).not.toContain('createDirectorSceneFromTemplate("monologue"');
        expect(opener).not.toContain("createDirectorActor");
    });

    test("The workbench itself does not contain template selection logic: opening a saved scene does not rewrite the content.", () => {
        expect(workbench).not.toContain("DIRECTOR_TEMPLATES");
        expect(workbench).not.toContain("createDirectorSceneFromTemplate");
    });
});

describe("Camera and lighting operations on the director’s desk scene menu", () => {
    test("The character menu is grouped by default identity and does not rely on the array subscript of the old version nine defaults.", () => {
        expect(workbench).not.toContain("DIRECTOR_ACTOR_PRESET_OPTIONS.slice(0, 8)");
        expect(workbench).not.toContain("DIRECTOR_ACTOR_PRESET_OPTIONS.slice(8)");
        expect(workbench).toContain('DIRECTOR_ACTOR_PRESET_OPTIONS.filter((preset) => preset.id !== "geometric")');
        expect(workbench).toContain('DIRECTOR_ACTOR_PRESET_OPTIONS.filter((preset) => preset.id === "geometric")');
    });
    test("The added menu provides LibTV-like camera positions, sunlight, point light sources, spotlights and access to real creation logic", () => {
        const menu = slice(workbench, "const addObjectMenuItems:", "const addShot =");
        expect(menu).toContain('key: "camera"');
        expect(menu).toContain('addPresetCamera("current")');
        expect(menu).toContain('key: "sun"');
        expect(menu).toContain('addLight("directional", "sunlight"');
        expect(menu).toContain('key: "point-light"');
        expect(menu).toContain('addLight("point", "Point light source"');
        expect(menu).toContain('key: "spotlight"');
        expect(menu).toContain('addLight("spot", "spotlight"');
        expect(slice(workbench, "const addObject = (object:", "const addPrimitive =")).toContain('setMode(object.kind === "actor" ? "pose" : "layout")');
        expect(slice(workbench, "const addPresetCamera =", "const addLight =")).toContain('setMode("camera")');
        expect(slice(workbench, "const addLight =", "const addLightMenuItems:")).toContain('setMode("layout")');
    });
});

describe("LibTV scene assets focus on interaction", () => {
    test("Camera positions, objects, and lighting scene tree rows all provide focus actions and call viewport framing controls.", () => {
        expect(workbench).toContain("onFocus={() => focusSceneCamera(item.camera)}");
        expect(workbench).toContain("onFocus={() => focusSceneObject(item.object)}");
        expect(workbench).toContain("onFocus={() => focusSceneLight(item.light)}");
        expect(workbench).toContain("aria-label={`聚焦${label}`}");
        expect(viewport).toContain("focusOnPoint: (point: DirectorVec3, radius: number) => boolean");
        expect(viewport).toContain("controls.target.fromArray(frame.target)");
        expect(viewport).toContain('onViewModeChange?.("free")');
    });
});

describe("Director node reference map entrance", () => {
    test("The director's desk node does not currently display the upload and prompt word box controls.", () => {
        expect(directorNodePanel).not.toContain("onAddReference");
        expect(directorNodePanel).not.toContain("onRemoveReference");
        expect(directorNodePanel).not.toContain("scene description");
        expect(uploadHook).toContain('imageInputRef.current.accept = "image/*";');
    });
});

describe("Mode wiring", () => {
    test("workbench reads mode from store and derives display by capabilities", () => {
        expect(workbench).toContain("const mode = useDirectorWorkbenchStore((state) => state.mode);");
        expect(workbench).toContain("const capabilities = directorModeCapabilities(mode);");
    });

    test("Animation mode connects the Transform track to the viewport, hiding actors and zero-length tracks and not displaying them.", () => {
        expect(workbench).toContain("showMotionPaths={workspaceView === \"scene\" && sequencerVisible}");
        expect(viewport).toContain('object.visible && (object.kind === "actor" || object.primitive === "character")');
        expect(viewport).toContain("directorTransformPathLength(object.keyframes) > 0.001");
        expect(viewport).toContain("<Line points={displayedPoints}");
        expect(viewport).toContain("interpolateDirectorTransform(sorted[0].transform, sorted, playhead).position");
    });

    test("After selecting the actor, you can directly enter the posture control, and the key frames are still controlled separately by the animation ability.", () => {
        const inspector = slice(workbench, "function ObjectInspector(", "function LightInspector(");
        expect(inspector).toContain("{isActor ? <>");
        expect(inspector).not.toContain("isActor && capabilities.bones ? <>");
        expect(inspector).toContain('role="tablist" aria-label="Role attributes"');
        expect(inspector).toContain("directorProceduralPoseControlGroups");
        expect(inspector).toContain('data-director-pose-axis={label}');
        expect(inspector).toContain("axisDirections={axisDirections(axisIndex, direction)}");
        expect(inspector).toContain('{tab !== "motion" && capabilities.keyframes ? <>');
        expect(workbench).toContain('label: "arm — shoulder"');
        expect(workbench).toContain('label: "leg — hip"');
        expect(workbench).toContain('pairedSemanticAxes("leftLowerArm", "rightLowerArm", ["curved"], [0])');
        expect(workbench).toContain('pairedSemanticAxes("leftUpperArm", "rightUpperArm", ["forward", "abduction", "twist"], [0, 2, 1], [-1, -1, 1], [-1, 1, 1])');
        // motionClips 不得再作为放行条件：带动画的普通模型不是演员。
        expect(workbench).not.toContain('object.primitive === "character" || motionClips.length) ? <>');
    });

    test("The standing preset resets the whole body posture and resets bone by bone without deleting the animation track.", () => {
        const inspector = slice(workbench, "function ObjectInspector(", "function LightInspector(");
        expect(inspector).toContain('onClick={() => applyPose(option.value)}');
        expect(inspector).toContain('const applyPose = (pose: DirectorPose) => onUpdate({ pose, activeMotionClipId: undefined, boneOverrides: {} })');
        expect(inspector).toContain("delete boneOverrides[bone]");
        expect(inspector).toContain('aria-label={`重置骨骼 ${directorBoneLabel(bone)}`}');
        expect(inspector).not.toContain("boneTracks: []");
    });

    test("Action clips are decoupled from bone entries: any object with a Clip can adjust the playback speed/loop", () => {
        expect(workbench).toContain('{tab !== "motion" && motionClips.length ? <><Field label="action clips">');
        const inspector = slice(workbench, "function ObjectInspector(", "function LightInspector(");
        expect(inspector).toContain('aria-label="Action start time"');
        expect(inspector).toContain("snapDirectorTime(value ?? 0, fps)");
        expect(workbench).toContain("fps={activeShot?.fps || 24} shotDuration={activeShot?.duration || 15}");
    });

    test("Keyframe entry is controlled by keyframes", () => {
        expect(workbench).toContain('{tab !== "motion" && capabilities.keyframes ? <>');
    });

    test("The rendering view drop-down filters by the current mode instead of hard-coding five items.", () => {
        expect(dock).toContain("renderModes: DirectorRenderMode[];");
        expect(dock).toContain("RENDER_VIEW_BUTTONS.filter((item) => renderModes.includes(item.mode))");
        expect(workbench).toContain("renderModes={capabilities.renderModes}");
    });

    test("dock is not a second way around mode gating: render view buttons are also filtered by renderModes", () => {
        expect(dock).toContain("renderModes: DirectorRenderMode[];");
        expect(dock).toContain("RENDER_VIEW_BUTTONS.filter((item) => renderModes.includes(item.mode))");
        // 写死的按钮会绕过门控。
        expect(dock).not.toContain('onClick={() => onRenderModeChange("pose")}');
        expect(workbench).toContain("renderModes={capabilities.renderModes}");
    });

    test("store layer clamps renderMode: No path can set a view that is not allowed by the current mode", () => {
        expect(store).toContain("setRenderMode: (renderMode) => set((state) => (directorModeCapabilities(state.mode).renderModes.includes(renderMode) ? { renderMode } : {})),");
    });

    test("Camera mode fixed display shot/camera inspector", () => {
        expect(workbench).toContain("selectedObject && !capabilities.cameraTools ?");
        expect(workbench).toContain("selectedLight && !capabilities.cameraTools ?");
    });

    test("The camera movement generation only updates the first and last frames and prompts you to go to animation mode to continue editing, without clearing the manual keyframes.", () => {
        expect(workbench).toContain("resolveDirectorCameraMoveKeyframes(item.keyframes");
        expect(workbench).toContain("The first and last keyframes of the camera movement have been updated and can be edited in animation mode.");
        expect(workbench).not.toContain("keyframes: [{ id: nanoid(), time: 0, transform: start }");
    });

    test("For small screens, put the attribute inspector below instead of hiding it, and the posture and bone entrances are still accessible.", () => {
        expect(workbench).toContain("max-lg:col-span-2 max-lg:max-h-[40vh] max-lg:border-l-0 max-lg:border-t");
        expect(workbench).not.toContain("border-l max-lg:hidden");
    });

    test("When the store switches out of animation mode, it stops playback, turns off Auto Key, and clips back to the allowed rendering view.", () => {
        const directorStore = useDirectorWorkbenchStore;
        directorStore.getState().reset();
        directorStore.getState().setMode("animate");
        directorStore.getState().setRenderMode("pose");
        directorStore.getState().setPlaying(true);
        directorStore.getState().setAutoKey(true);
        directorStore.getState().setMode("layout");
        expect(directorStore.getState().playing).toBe(false);
        expect(directorStore.getState().autoKey).toBe(false);
        expect(directorStore.getState().renderMode).toBe("beauty");
        directorStore.getState().reset();
    });

    test("mode is not written to DirectorScene: there is no mode field in the type file", () => {
        const types = readFileSync(resolve(import.meta.dir, "../src/types/director.ts"), "utf8");
        const sceneType = slice(types, "export type DirectorScene = {", "};");
        expect(sceneType).not.toContain("mode");
    });

    test("Switching modes does not rebuild the session: there is no mode in the dependencies of the initialized effect.", () => {
        const initEffect = slice(workbench, "//Session initialization only recognizes scene id", "// Check for valid local recovery candidates when opening a session");
        // 依赖里出现 mode 就意味着换视图会 resetWorkbench + 清空 history。
        expect(initEffect).toContain("}, [open, resetWorkbench, scene, writeDraft]);");
        expect(initEffect).not.toContain("mode");
    });

    test("The life cycle effect of draft/history/save does not depend on mode.", () => {
        // 逐个锁住依赖数组：任一处混入 mode，切模式就会掉草稿或掉历史。
        expect(workbench).toContain("}, [message, modal, open, scene, writeDraft]);");
        expect(workbench).toContain("}, [mirrorDraft, stagedTransaction]);");
        expect(workbench).toContain("}, [mirrorDraft]);");
        // 弹窗开关需暂停快捷键；mode 切换仍不得反复重挂监听器。
        expect(workbench).toContain("}, [open, panoramaAIOpen, panoramaHistoryOpen]);");
    });
});

describe("Asynchronous director console output uses the latest authoritative state", () => {
    test("After uploading, recheck the nodes and scene, and merge the preview reference into the latest scene", () => {
        expect(hook).toContain("const sourceNodeAtStart = nodesRef.current.find");
        expect(hook).toContain("const outputProjectId = projectId;");
        expect(hook).toContain("projectIdRef.current !== outputProjectId");
        expect(hook).toContain("const outputProject = useCanvasStore.getState().projects.find((item) => item.id === outputProjectId);");
        expect(hook).toContain("const sourceNode = nodesRef.current.find((item) => item.id === sourceNodeId);");
        expect(hook).toContain("const latestScene = outputProject?.directorScenes.find");
        expect(hook).toContain("mergeDirectorOutputPreview(latestScene");
        const assetRegistration = hook.indexOf("for (const mediaNode of mediaNodes)");
        const commitValidation = hook.indexOf("const commitProject =", assetRegistration);
        expect(assetRegistration).toBeGreaterThan(0);
        expect(commitValidation).toBeGreaterThan(assetRegistration);
        expect(hook.slice(commitValidation)).toContain("isDirectorOutputTargetCurrent(");
        expect(hook.slice(commitValidation)).toContain("const committedNodes = [...nodesRef.current]");
        expect(hook).toContain("saveDirectorScene(committedScene);");
        expect(hook).not.toContain("saveDirectorScene({ ...output.scene");
        expect(hook).toContain("uploadImage(output.beauty)");
        expect(hook).toContain('uploadMediaFile(output.clayVideo, "director-clay")');
        expect(hook).toContain("ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: mediaNode, source: \"canvas-manual\" })");
        expect(hook).toContain("if (!result.confirmed) confirmed = false");
        expect(hook).toContain("return { confirmed };");
        expect(hook).toContain("uploadImage(beauty)");
    });
});

describe("Edit mode moved to Director Tools menu", () => {
    test("All mode entries retain visible names, shortcut prompts and correctly invoke mode switches", () => {
        const modeMenu = slice(dock, 'key: "director-mode"', 'key: "workspace-view"');
        expect(modeMenu).toContain("DIRECTOR_MODES.map");
        expect(modeMenu).toContain("title: item.hint");
        expect(modeMenu).toContain("onModeChange(item.mode)");
        expect(modeMenu).toContain("releaseMenuFocus(domEvent.detail)");
    });

    test("Menu keeps current mode and workspace selected", () => {
        expect(dock).toContain("`director-mode-${mode}`");
        expect(dock).toContain("`workspace-${workspaceView}`");
    });

    test("Mode styles continue to use theme-aware semantic tokens, and no new hard-coded colors are added.", () => {
        const block = slice(styles, "/* Level one mode switching.", ".director-actor-colors {");
        expect(block).toContain("var(--control-selected-bg)");
        expect(block).toContain("var(--control-focus-ring)");
        expect(block).not.toMatch(/rgba?\(/);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });
});

describe("LibTV director’s desk compact roof entrance relocation", () => {
    test("The top bar no longer occupies the independent editing mode or scene/preview switching bar", () => {
        expect(workbench).not.toContain('<nav className="director-mode-switch" aria-label="Director Mode">');
        expect(workbench).not.toContain('aria-label="Director\'s desk workspace view"');
    });

    test("More tool menus at the bottom retain mode, workspace, history and workbench functions; object additions are uniformly entered from the scene panel", () => {
        expect(dock).toContain('label: "Director\'s desk mode"');
        expect(dock).toContain('key: "director-navigation", label: "director navigation"');
        expect(dock).toContain("DIRECTOR_MODES.map");
        expect(dock).toContain('label: "workspace view"');
        expect(dock).toContain('label: "scenario"');
        expect(dock).toContain('label: "Preview of the finished film"');
        expect(dock).toContain("onModeChange(item.mode)");
        expect(dock).toContain('onWorkspaceViewChange("scene")');
        expect(dock).toContain('onWorkspaceViewChange("preview")');
        expect(dock).toContain('key: "export-clay"');
        expect(dock).toContain('key: "apply-to-canvas"');
        expect(dock).not.toContain('key: "add-actor"');
        expect(dock).not.toContain('key: "add-box"');
        expect(dock).not.toContain('aria-label="Director\'s Desk Navigation" aria-haspopup="menu"');
        expect(workbench).toContain('AddMenuButton label="Add scene object" items={addObjectMenuItems}');
    });

});
