import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 生产接线回归：领域函数正确不代表用户能删到关键帧。
 * 这里锁住「时间轴入口 -> workbench -> 领域函数」这条链路真的接上了。
 */
const dock = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-viewport-dock.tsx"), "utf8");
const workbench = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8");
const sequencer = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-sequencer.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

function slice(source: string, from: string, to: string) {
    const start = source.indexOf(from);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(to, start + from.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("Workbench access timeline keyframe deletion", () => {
    test("DirectorSequencer gets deleteKeyframe instead of empty implementation", () => {
        const element = slice(workbench, "<DirectorSequencer", "/>");
        expect(element).toContain("onDeleteKeyframe={deleteKeyframe}");
        expect(element).not.toContain("onDeleteKeyframe={() =>");
    });

    test("Easing updates are accessed through workbench commit, and misses do not create history.", () => {
        const element = slice(workbench, "<DirectorSequencer", "/>");
        expect(element).toContain("onSetKeyframeEasing={setKeyframeEasing}");
        const handler = slice(workbench, "const setKeyframeEasing = useCallback", "* Shortcut key executor");
        expect(handler).toContain("setDirectorSceneKeyframeEasing(current, target, easing) === current");
        expect(handler).toContain("commit((scene) => setDirectorSceneKeyframeEasing(scene, target, easing));");
    });

    test("DeleteKeyframe does not enter when it is not hit. Commit: does not remember the history and does not generate revisions.", () => {
        const handler = slice(workbench, "const deleteKeyframe = useCallback", "* Shortcut key executor");
        expect(handler).toContain("removeDirectorSceneKeyframe(current, target) === current) return;");
        expect(handler).toContain("commit((scene) => removeDirectorSceneKeyframe(scene, target));");
    });

    test("Deletion is done through commit, so it goes into history, can be undone, and triggers canonical saving.", () => {
        // commit 自身的语义：入历史 + writeAndPublish（coordinator 保存 + 镜像项目）。
        const commit = slice(workbench, "const commit = useCallback", "/** Temporary gesture");
        expect(commit).toContain("setHistory((items) => [...items.slice(-49), structuredClone(current)]);");
        expect(commit).toContain("writeAndPublish(touchDirectorScene(updater(current)));");
    });
});

describe("workbench shortcut key wiring", () => {
    const effect = slice(workbench, "// The director's desk is a full-screen floating layer, and the shortcut keys are hung in the window", "/** The only entry point for object transform editing");

    test("Monitoring is hung on window keydown and loaded and unloaded with open", () => {
        expect(effect).toContain("if (!open) return;");
        expect(effect).toContain('window.addEventListener("keydown", onKeyDown);');
        expect(effect).toContain('window.removeEventListener("keydown", onKeyDown);');
    });

    test("The interactive control context is determined by blocksDirectorShortcut and handed over to the parser.", () => {
        expect(effect).toContain("isInteractiveTarget: blocksDirectorShortcut(event.target),");
        // 旧的 text-only 判定不得残留：它放过 BUTTON/A/role 型控件。
        expect(workbench).not.toContain("isDirectorTextEntryTarget");
    });

    test("The delete key is always consumed by the director console, and other shortcut keys are still processed according to the execution results.", () => {
        expect(effect).toContain('if (action.kind === "delete-selected")');
        expect(effect).toContain("event.preventDefault();");
        expect(effect).toContain("event.stopImmediatePropagation();");
        expect(effect).toContain("if (handled) event.preventDefault();");
    });

    test("Each action falls on an existing real execution path", () => {
        const runner = slice(workbench, "const runShortcut = (action: DirectorShortcutAction)", "const runShortcutRef");
        expect(runner).toContain("setTransformMode(action.mode);");
        expect(runner).toContain("resolveDirectorDeleteDecision({ pathKeyframe: selectedPathKeyframe, camera: selectedCamera, object: selectedObject, light: selectedLight })");
        expect(runner).toContain("removeObject(decision.id);");
        expect(runner).toContain("removeLight(decision.id);");
        expect(runner).toContain("updateObject(selectedObject.id, { visible: !selectedObject.visible });");
        expect(runner).toContain("setPlaying(!playing);");
        expect(runner).toContain("undo();");
        expect(runner).toContain("redo();");
    });

    test("Return false when there is no operable object/history and return the button to the browser", () => {
        const runner = slice(workbench, "const runShortcut = (action: DirectorShortcutAction)", "const runShortcutRef");
        expect(runner).toContain("if (!history.length) return false;");
        expect(runner).toContain("if (!future.length) return false;");
        expect(runner).toContain("if (!selectedObject) return false;");
        expect(runner).toContain("if (!selectedObjectId && !selectedLightId && !selectedBone) return false;");
    });

    test("After each operation and scene list of the extended menu is clicked, the focus is released and the W/E/R/Delete shortcut keys are retained.", () => {
        // 场景对象添加统一从场景面板进入；dock 菜单承载视图与工作台操作。
        const toolMenu = slice(dock, "const toolMenuItems:", "return (");
        expect((toolMenu.match(/releaseMenuFocus\(domEvent\.detail\)/g) || []).length).toBe(10);
        const sceneRow = slice(workbench, "function SceneRow(", "function QuickAdd(");
        expect(sceneRow).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("The focus release rules focus on shared helpers, and each button does not write blur by itself.", () => {
        // 判据（keyboard detail === 0 保留焦点）必须只有一处，否则迟早走偏。
        expect(dock).toContain("releaseDirectorFocusAfterPointer({ detail, currentTarget: document.activeElement as HTMLElement })");
        expect(dock).not.toContain("event.currentTarget.blur()");
        expect(workbench).not.toContain("if (event.detail !== 0) event.currentTarget.blur();");
    });

    test("The timeline track row also releases focus after being clicked: the select-then-Delete process that has the same origin as the scene list", () => {
        const row = slice(sequencer, "function SequencerRow(", "* Keyframes are rendered as real buttons");
        expect(row).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("Keyframe button never releases focus: it owns Enter/Space/Delete/Backspace", () => {
        // 关键帧 blur 掉焦点会让键盘连续删除失效，且与它的 stopPropagation 设计冲突。
        const trackKeys = slice(sequencer, "function TrackKeys(", "function TrackBar(");
        expect(trackKeys).not.toContain("releaseDirectorFocusAfterPointer");
    });
});

describe("Timeline keyframe entry is visible, selectable, and can be deleted with the keyboard", () => {
    const trackKeys = slice(sequencer, "function TrackKeys(", "function TrackBar(");

    test("Editable keyframes are real buttons, not lazy spans", () => {
        expect(trackKeys).toContain('type="button"');
        expect(trackKeys).toContain("director-sequencer-key is-actionable");
        expect(trackKeys).toContain('aria-label={`选择 ${key.label ?? "关键帧"} ${key.time.toFixed(2)}s 的关键帧`}');
        expect(trackKeys).toContain("aria-pressed=");
    });

    test("Ordinary clicks and Enter/Space only select positioning, and Delete/Backspace deletes them without bubbling.", () => {
        expect(trackKeys).toContain('if (!["Enter", " ", "Delete", "Backspace"].includes(event.key)) return;');
        expect(trackKeys).toContain("event.preventDefault();");
        expect(trackKeys).toContain("event.stopPropagation();");
        expect(trackKeys).toContain('if (event.key === "Delete" || event.key === "Backspace") onDeleteKey(target);');
        expect(trackKeys).toContain("else onSelectKey?.(key);");
        expect(trackKeys).toContain("onSelectKey?.(key);");
    });

    test("Tracks without target remain read-only and do not render delete buttons", () => {
        expect(trackKeys).toContain("const target = onDeleteKey && key.target;");
        expect(trackKeys).toContain("if (!target) {");
    });

    test("The hit area is expanded and has a focus-visible focus ring", () => {
        expect(styles).toContain(".director-sequencer-key.is-actionable");
        expect(styles).toContain(".director-sequencer-key.is-actionable::after");
        expect(styles).toContain(".director-sequencer-key.is-actionable:focus-visible");
        expect(styles).toContain(".director-sequencer-key.is-actionable.is-selected");
    });

    test("hover/focus only uses semantic tokens and does not add hard-coded colors.", () => {
        const block = slice(styles, "/* Keyframes can be deleted:", ".director-sequencer-clip {");
        expect(block).toContain("outline: var(--stroke-2) solid var(--control-focus-ring);");
        expect(block).toContain("color-mix(in srgb, var(--control-focus-ring) 55%, transparent)");
        // rgba / 十六进制字面值一律不允许出现在新增块里。
        expect(block).not.toMatch(/rgba?\(/);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });
});

describe("All three types of tracks have deletion entries, and the overview track remains read-only.", () => {
    test("Keyframes can be deleted on the host level track, and the timeline will not render the Camera Cut overview track repeatedly.", () => {
        const cameraRow = slice(sequencer, '<MainTrackLabel name="Host bit"', "{cameraKeys.length &&");
        expect(cameraRow).toContain("<TrackKeys duration={duration} keys={cameraKeys}");
        expect(cameraRow).toContain("onDeleteKey={deleteTrackKey}");
        expect(sequencer).not.toContain('label="Camera Cut"');
    });

    test("Camera keyframes with camera delete target", () => {
        expect(sequencer).toContain('target: { track: "camera", cameraId: camera.id, keyframeId: key.id }');
    });

    test("Object transforms and bone frames each have the correct target", () => {
        expect(sequencer).toContain('target: { track: "object-transform" as const, objectId: object.id, keyframeId: key.id }');
        expect(sequencer).toContain('target: { track: "object-bone" as const, objectId: object.id, bone: track.bone, keyframeId: key.id }');
    });

    test("The object summary track in the collapsed state can also be deleted, otherwise it cannot be deleted after it is collapsed.", () => {
        const summaryRow = slice(sequencer, "<SequencerRow label={object.name} icon={isExpanded", "</SequencerRow>");
        expect(summaryRow).toContain("keys={[...transformKeys, ...boneTrackKeys]}");
        expect(summaryRow).toContain("onDeleteKey={deleteTrackKey}");
    });

    test("Both the expanded Transform sub-track and bone sub-track can be deleted.", () => {
        const transformRow = slice(sequencer, 'label="Transform" icon="◇"', "</SequencerRow>");
        expect(transformRow).toContain("onDeleteKey={deleteTrackKey}");
        const boneRow = slice(sequencer, "label={directorBoneLabel(track.bone)}", "</SequencerRow>");
        expect(boneRow).toContain("onDeleteKey={deleteTrackKey}");
    });

    test("The transform rails of non-actor objects (cubes/models/stands) can also be deleted", () => {
        const plainRow = slice(sequencer, 'icon="□"', "</SequencerRow>");
        expect(plainRow).toContain("onDeleteKey={deleteTrackKey}");
        expect(sequencer).toContain('target: { track: "object-transform", objectId: object.id, keyframeId: key.id }');
    });

    test("Selected keyframes provide step/linear/smooth easing switching and explicit delete buttons", () => {
        expect(sequencer).toContain('aria-label="Keyframe easing"');
        expect(sequencer).toContain('<option value="step">Keep</option>');
        expect(sequencer).toContain('<option value="linear">Linear</option>');
        expect(sequencer).toContain('<option value="smooth">Smooth</option>');
        expect(sequencer).toContain('aria-label="Delete selected keyframes"');
    });

    test("Clear old selections after switching cameras or externally deleting frames. The top controls cannot accidentally change invisible tracks.", () => {
        expect(sequencer).toContain("directorKeyframeTargetExists(selectedKey.target, camera, objects)");
        expect(sequencer).toContain("setSelectedKey((current) => current?.target && !directorKeyframeTargetExists(current.target, camera, objects) ? null : current);");
        expect(sequencer).toContain("camera?.id === target.cameraId && camera.keyframes.some");
        expect(sequencer).toContain("object.boneTracks?.some");
    });
});
