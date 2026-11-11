import { resolveDirectorPlacement } from "@/lib/canvas/director/director-placement";
import { DIRECTOR_QUATERNIUS_FEMALE_URL, DIRECTOR_QUATERNIUS_MALE_URL } from "@/lib/canvas/director/director-actor-assets";
import { createDirectorActorPreset, DIRECTOR_ACTOR_PRESET_OPTIONS } from "@/lib/canvas/director/director-actor-presets";
import { createDirectorModel, touchDirectorScene } from "@/lib/canvas/director/director-scene";
import type { DirectorObject, DirectorScene, DirectorVec3 } from "@/types/director";

/**
 * P0 复现用确定性 fixture。
 *
 * 硬约束：fixture 自身绝不引用网络资产。
 * - 不使用 createDirectorScene（它默认包含演员，影响测试对象数量）；
 * - 所有对象都是 primitive，不带 url / storageKey / assetId；
 * - 所有 id 与时间戳都是字面量，因此每次构造完全一致（可直接断言）。
 *
 * 注意边界：这只保证「初始 fixture」离线。真实工作台自带的新增控件
 * （上传模型、画布图片立牌）仍可能联网，因此模型相关的复现项
 * 需要显式注入本地资产，不能假装当前 fixture 已经覆盖。
 */

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const FIXTURE_SCENE_ID = "repro-scene-1";
const FIXTURE_SHOT_ID = "repro-shot-1";
const FIXTURE_CAMERA_ID = "repro-camera-1";

function fixtureObject(input: { id: string; name: string; primitive: "box" | "sphere" | "cylinder" | "plane"; position: DirectorVec3; color: string }): DirectorObject {
    return {
        id: input.id,
        name: input.name,
        kind: "primitive",
        primitive: input.primitive,
        color: input.color,
        visible: true,
        castShadow: true,
        receiveShadow: true,
        transform: { position: input.position, rotation: [0, 0, 0], scale: [1, 1, 1] },
        keyframes: [],
    };
}

/**
 * 构造 fixture 场景。同一 seed 下结构完全确定，不含任何远端资产。
 * 返回全新对象，调用方可以自由改写而不影响后续构造。
 */
export function createDirectorReproScene(): DirectorScene {
    return {
        id: FIXTURE_SCENE_ID,
        version: 1,
        title: "P0 recurrence scene",
        background: "#060608",
        environmentIntensity: 0.7,
        gridVisible: true,
        objects: [
            fixtureObject({ id: "repro-box-1", name: "Cube A", primitive: "box", position: [0, 0.5, 0], color: "#8795a5" }),
            fixtureObject({ id: "repro-sphere-1", name: "Sphere B", primitive: "sphere", position: [2.2, 0.5, 0], color: "#6f8fb8" }),
            fixtureObject({ id: "repro-cylinder-1", name: "Cylindrical C", primitive: "cylinder", position: [-2.2, 0.5, 0], color: "#b8926f" }),
        ],
        cameras: [
            {
                id: FIXTURE_CAMERA_ID,
                name: "main camera",
                transform: { position: [4.8, 2.7, 6.8], rotation: [0, 0, 0], scale: [1, 1, 1] },
                target: [0, 1, 0],
                focalLength: 35,
                fov: 50,
                aperture: 2.8,
                focusDistance: 5,
                near: 0.05,
                far: 500,
                keyframes: [],
            },
        ],
        lights: [
            {
                id: "repro-light-1",
                name: "key light",
                type: "directional",
                color: "#ffffff",
                intensity: 2.4,
                castShadow: true,
                transform: { position: [4, 6, 4], rotation: [0, 0, 0], scale: [1, 1, 1] },
            },
        ],
        shots: [
            {
                id: FIXTURE_SHOT_ID,
                name: "Shot 1",
                cameraId: FIXTURE_CAMERA_ID,
                shotSize: "medium",
                cameraMove: "static",
                duration: 4,
                fps: 24,
                prompt: "",
            },
        ],
        activeShotId: FIXTURE_SHOT_ID,
        createdAt: FIXTURE_CREATED_AT,
        updatedAt: FIXTURE_CREATED_AT,
    };
}

/**
 * 离线人物视觉对照场景：无 URL 的历史标准演员会使用本地内置模型。
 * 原始 P0 fixture 保持不变，避免影响已有的交互与回归用例。
 */
export function createDirectorReproActorScene(): DirectorScene {
    const scene = createDirectorReproScene();
    const actor: DirectorObject = {
        id: "repro-actor-1",
        name: "actor 1",
        kind: "actor",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        color: "#4f8ef7",
        visible: true,
        castShadow: true,
        receiveShadow: true,
        pose: "stand",
        rig: { status: "unmapped", boneMap: {}, animationNames: [] },
        motionClips: [],
        boneOverrides: {},
        boneTracks: [],
        keyframes: [],
    };
    return {
        ...scene,
        title: "Character visual comparison scene",
        objects: [actor],
        cameras: scene.cameras.map((camera) => ({ ...camera, name: "Seat 1", transform: { ...camera.transform, position: [0, 2.2, 10] }, target: [0, 1.2, 0] })),
    };
}

/** Side-by-side preview of both free CC0 Quaternius Standard bodies. */
export function createDirectorReproQuaterniusCompareScene(): DirectorScene {
    const scene = createDirectorReproActorScene();
    const original = scene.objects[0];
    const quaternius: DirectorObject = {
        ...original,
        id: "repro-quaternius-male",
        name: "Quaternius Free Male",
        url: DIRECTOR_QUATERNIUS_MALE_URL,
        mimeType: "model/gltf-binary",
        transform: { ...original.transform, position: [1.1, 0, 0] },
    };
    return {
        ...scene,
        title: "Quaternius male and female model comparison",
        objects: [
            { ...original, name: "Quaternius free women", actorPreset: "standard_female", url: DIRECTOR_QUATERNIUS_FEMALE_URL, mimeType: "model/gltf-binary", transform: { ...original.transform, position: [-1.1, 0, 0] } },
            quaternius,
        ],
        cameras: scene.cameras.map((camera) => ({ ...camera, transform: { ...camera.transform, position: [0, 2.4, 6.4] }, target: [0, 1, 0] })),
    };
}

/** Same lighting and camera for every built-in body type; useful for visual proportion comparison. */
export function createDirectorReproActorPresetScene(): DirectorScene {
    const scene = createDirectorReproActorScene();
    const actors = DIRECTOR_ACTOR_PRESET_OPTIONS.map(({ id, label }, index) => ({
        ...createDirectorActorPreset(id, label, [((index % 3) - 1) * 1.45, 0, (Math.floor(index / 3) - 1) * 1.75]),
        id: `repro-preset-${id}`,
    }));
    return {
        ...scene,
        title: "Character default comparison scene",
        objects: actors,
        cameras: scene.cameras.map((camera) => ({ ...camera, transform: { ...camera.transform, position: [0, 3.2, 10] }, target: [0, 0.9, 0] })),
    };
}

/** fixture 是否完全不依赖网络资产：任何 url/storageKey/assetId 都算违约。 */
export function directorReproSceneIsOffline(scene: DirectorScene): boolean {
    return scene.objects.every((object) => !object.url && !object.storageKey && !object.assetId);
}

/** P0 手工复现矩阵。页面据此渲染清单，Stage D 可以逐条执行。 */
export type DirectorReproCase = {
    id: string;
    group: string;
    title: string;
    steps: string;
    expected: string;
};

export const DIRECTOR_REPRO_MATRIX: readonly DirectorReproCase[] = [
    { id: "empty-click", group: "choice semantics", title: "Blank click", steps: "Click in an empty area of the viewport.", expected: "Cancel the selection, no history record will be generated, and the status bar will not change to Unsaved." },
    { id: "right-click", group: "choice semantics", title: "right click", steps: "Right-click on the object, then right-click in an empty space.", expected: "No selections are changed, no gestures are started, no history is written." },
    { id: "switch-object", group: "choice semantics", title: "Switch object", steps: "Drag object A and then switch to select B without letting go (or release first and then select B).", expected: "The old gesture is terminated first, and B does not consume A's base." },
    { id: "release-outside", group: "end of gesture", title: "release outside viewport", steps: "Press and drag within the viewport, then release the mouse after moving out of the viewport.", expected: "The gesture ends once with commit, leaving no hanging preview." },
    { id: "blur", group: "end of gesture", title: "window blur", steps: "Switch to other windows during dragging.", expected: "The gesture is terminated, the draft status is consistent, and there is no repeated mirroring." },
    { id: "escape", group: "end of gesture", title: "Cancel", steps: "Press Escape while dragging.", expected: "Reverts to the pre-gesture snapshot, and the canceled values are never published." },
    { id: "playing", group: "timeline", title: "Operation during playback", steps: "Click play and try selecting and dragging during playback.", expected: "Playback is not interrupted into an error state; the change semantics are the same as when paused." },
    { id: "non-zero-time", group: "timeline", title: "Non-0 second operation", steps: "Drag the playhead to a non-0 and non-frame integer position and then drag the object.", expected: "The increment starts from the raw playhead and does not cause drift." },
    { id: "autokey-on", group: "timeline", title: "Auto Key on", steps: "Turn on Auto Key and drag the object at a time other than 0 seconds.", expected: "Write keyframes at the destination time after snapping." },
    { id: "autokey-off", group: "timeline", title: "Auto Key Off", steps: "Turn off Auto Key and drag objects at non-0 seconds.", expected: "Only the basic transform is changed, no keyframes are generated." },
    { id: "add-move-delete-undo", group: "Edit link", title: "Continuously add/move/delete/Undo", steps: "Add three objects in a row, move each object once, delete the middle one, and then continuously Undo to the initial state.", expected: "Each step is reversible, and the position after Undo is self-consistent with the selection state, without overlap or loss." },
    { id: "delete-while-loading", group: "model", title: "Deleted during model loading", steps: "Click \"Inject Local Model\" to immediately open the workbench and delete the model from the list on the left while it is still loading.", expected: "Late loading results are discarded and released, leaving no orphan resources or reporting errors." },
    { id: "model-load-failed", group: "model", title: "Model loading failed", steps: "Click \"Inject Missing Model\" to open the workbench and wait for the loading failure.", expected: "Return the placeholder puppet, the operable \"Retry Loading\" appears on the upper right, and the diagnostic record DIRECTOR_MODEL_LOAD_FAILED." },
    { id: "save-failed", group: "Save", title: "Save failed", steps: "Let the save flush throw an error and observe the header status and try again.", expected: "The status is error, and the prompt can be restored when the draft is retained. You can try again by trying again." },
    { id: "close-recovery", group: "Save", title: "Closing and draft recovery", steps: "Close after failed saving; reopen the same scene.", expected: "Close the prepareClose decision; when reopening, you will be prompted to resume or give up. After giving up, you will not be prompted again." },
];

/** 注入变体：本地可达 glTF，或确定性不可达地址。 */
export type DirectorReproModelVariant = "local" | "missing";

/** 固定 id：重复注入必须替换同一对象，而不是不断堆叠新对象。 */
export const DIRECTOR_REPRO_MODEL_IDS: Record<DirectorReproModelVariant, string> = {
    local: "repro-model-local",
    missing: "repro-model-missing",
};

/** 同源本地资产，不依赖外网可达性。
 *  手写 glTF 2.0：内嵌 base64 buffer、无纹理、无压缩扩展，
 *  因此不需要 KTX2Loader / DRACOLoader 也能被 GLTFLoader 直接解析。 */
export const DIRECTOR_REPRO_LOCAL_MODEL_URL = "/canvas/models/director-repro-triangle.gltf";
/** 同源但确定不存在：稳定触发加载失败路径，不依赖外网可达性。 */
export const DIRECTOR_REPRO_MISSING_MODEL_URL = "/__director-repro-missing.glb";
/** 轻量离线人形 GLTF，含真实手臂旋转动画，用于动作时间轴交互验收。 */
export const DIRECTOR_REPRO_ANIMATED_PERSON_URL = "/canvas/models/director-repro-animated-person.gltf";

const MODEL_URLS: Record<DirectorReproModelVariant, string> = {
    local: DIRECTOR_REPRO_LOCAL_MODEL_URL,
    missing: DIRECTOR_REPRO_MISSING_MODEL_URL,
};

/** local 是 JSON 形态 glTF，missing 仍按二进制声明，各自与 URL 后缀一致。 */
const MODEL_MIME_TYPES: Record<DirectorReproModelVariant, string> = {
    local: "model/gltf+json",
    missing: "model/gltf-binary",
};

const MODEL_NAMES: Record<DirectorReproModelVariant, string> = {
    local: "Local model repro triangle",
    missing: "Missing model (expected failure)",
};

/**
 * 纯函数：把一个模型对象注入场景副本并返回新场景，绝不改写入参。
 *
 * 语义要点：
 * - 固定 id，重复注入先移除同 id 再重算位置，因此不会堆叠也不会自我碰撞；
 * - 只改 XZ，Y 严格保留 createDirectorModel 给出的 0（模型贴地）；
 * - 位置经 resolveDirectorPlacement 避让现有对象；
 * - 初始 fixture 本身不含模型，注入是显式动作，不污染离线基线。
 */
export function injectDirectorReproModel(scene: DirectorScene, variant: DirectorReproModelVariant): DirectorScene {
    const id = DIRECTOR_REPRO_MODEL_IDS[variant];
    const base = createDirectorModel({
        name: MODEL_NAMES[variant],
        assetId: id,
        storageKey: undefined,
        url: MODEL_URLS[variant],
        mimeType: MODEL_MIME_TYPES[variant],
    });
    const model: DirectorObject = { ...base, id };

    // 先剔除同 id 旧对象，避免重复点击时新位置去避让自己。
    const others = scene.objects.filter((object) => object.id !== id);
    const position = resolveDirectorPlacement({ object: model, existing: others });

    return touchDirectorScene({
        ...scene,
        objects: [...others, { ...model, transform: { ...model.transform, position } }],
    });
}

/** Add/replace a same-origin animated character fixture without touching the production actor asset path. */
export function injectDirectorReproAnimatedPerson(scene: DirectorScene): DirectorScene {
    const id = "repro-animated-person";
    const model = createDirectorModel({
        name: "Offline animated characters",
        assetId: id,
        storageKey: undefined,
        url: DIRECTOR_REPRO_ANIMATED_PERSON_URL,
        mimeType: "model/gltf+json",
    });
    const others = scene.objects.filter((object) => object.id !== id);
    const position = resolveDirectorPlacement({ object: model, existing: others });
    return touchDirectorScene({
        ...scene,
        objects: [...others, { ...model, id, transform: { ...model.transform, position } }],
    });
}
