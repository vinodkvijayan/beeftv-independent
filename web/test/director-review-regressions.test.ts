import { expect, test } from "bun:test";
import { createDirectorActor, createDirectorCamera, createDirectorScene, directorIdentityTransform, duplicateDirectorCamera, duplicateDirectorObject } from "@/lib/canvas/director/director-scene";
import { createDirectorActorPath, updateDirectorActorPathTransform } from "@/lib/canvas/director/director-actor-paths";
import { recordDirectorCameraPositionAtTime } from "@/lib/canvas/director/director-camera-paths";
import { resolveDirectorCameraGizmoEdit, resolveDirectorMultiObjectGroupTransformEdit, resolveDirectorMultiObjectTransformEdit } from "@/lib/canvas/director/director-animation-semantics";
import { resolveDirectorCameraLocalFraming, resolveDirectorCameraTransform } from "@/lib/canvas/director/director-view-modes";
import { replaceDirectorSceneObjects } from "@/lib/canvas/director/director-camera-binding";
import { directorAsyncSession } from "@/lib/canvas/director/director-async-session";

test("After copying the track, the control point reference belongs to the copy, and the track can be edited and undoed independently.", () => {
    const actor = createDirectorActorPath(createDirectorActor(), "ring", 5);
    const clone = duplicateDirectorObject(actor);
    expect(clone.motionPath!.controlKeyframeIds).toEqual([clone.keyframes[0].id, clone.keyframes[16].id, clone.keyframes[32].id]);
    expect(clone.motionPath!.controlKeyframeIds!.some((id) => actor.keyframes.some((frame) => frame.id === id))).toBe(false);
    const camera = createDirectorCamera();
    camera.keyframes = structuredClone(actor.keyframes);
    camera.drawnPath = { kind: "ring", sampleKeyframeIds: actor.keyframes.map((frame) => frame.id), originalKeyframes: [actor.keyframes[0]] };
    const cameraClone = duplicateDirectorCamera(camera);
    expect(cameraClone.drawnPath!.sampleKeyframeIds).toEqual(cameraClone.keyframes.map((frame) => frame.id));
    expect(cameraClone.drawnPath!.originalKeyframes![0].id).not.toBe(camera.keyframes[0].id);
});

test("Cameras with only position tracks can also be rotated using the gizmo and maintained until the actual view is taken", () => {
    const camera = recordDirectorCameraPositionAtTime(createDirectorCamera(), 0, 0);
    const from = resolveDirectorCameraTransform(camera, 0);
    const next = resolveDirectorCameraGizmoEdit({ camera, from, edited: { ...from, rotation: [0, 1, 0] }, rawTime: 0, snappedTime: 0 });
    expect(next.keyframes[0].rotationKeyed).toBe(true);
    expect(resolveDirectorCameraTransform(next, 0).rotation[1]).toBeCloseTo(1);
    const moved = resolveDirectorCameraGizmoEdit({ camera, from, edited: { ...from, position: [1, 2, 3] }, rawTime: 0, snappedTime: 0 });
    expect(moved.keyframes[0].rotationKeyed).toBe(false);
});

test("After multi-select panning, the trajectory center is synchronized, and subsequent zooming revolves around the new center.", () => {
    const actor = createDirectorActorPath(createDirectorActor(), "ring", 5);
    const moved = resolveDirectorMultiObjectTransformEdit({ objects: [actor], selectedIds: [actor.id], representativeId: actor.id, from: actor.transform, to: { ...actor.transform, position: [10, 0, 0] }, autoKey: false, time: 0 })[0];
    expect(moved.motionPath!.transform.position).toEqual([8, 0, 0]);
    const scaled = updateDirectorActorPathTransform(moved, { ...moved.motionPath!.transform, scale: [2, 2, 2] });
    expect(scaled.keyframes[0].transform.position).toEqual([12, 0, 0]);
});

test("Group rotation and scaling transform the entire trajectory and center at the same time, AutoKey does not move the trajectory center", () => {
    const actor = createDirectorActorPath(createDirectorActor(), "ring", 5);
    const args = { objects: [actor], selectedIds: [actor.id], from: directorIdentityTransform(), to: { position: [10, 0, 0] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number], scale: [2, 2, 2] as [number, number, number] }, autoKey: false, time: 0 };
    const moved = resolveDirectorMultiObjectGroupTransformEdit(args)[0];
    expect(moved.motionPath!.transform.position[0]).toBeCloseTo(10);
    expect(moved.motionPath!.transform.position[2]).toBeCloseTo(4);
    expect(moved.keyframes[16].transform.position[2]).toBeCloseTo(8);
    expect(resolveDirectorMultiObjectGroupTransformEdit({ ...args, autoKey: true })[0].motionPath).toBe(actor.motionPath);
});

test("When the multi-select attribute modifies the model orientation or size, the rotation and scaling of the trajectory itself will not be faked.", () => {
    const actor = createDirectorActorPath(createDirectorActor(), "ring", 5);
    const next = resolveDirectorMultiObjectTransformEdit({ objects: [actor], selectedIds: [actor.id], representativeId: actor.id, from: actor.transform, to: { ...actor.transform, rotation: [0, 1, 0], scale: [2, 2, 2] }, autoKey: false, time: 0 })[0];
    expect(next.motionPath!.transform).toEqual(actor.motionPath!.transform);
    expect(next.keyframes.map((key) => key.transform.position)).toEqual(actor.keyframes.map((key) => key.transform.position));
});

test("Bake follow and gaze before AI replacement to prevent the camera from suddenly jumping back to the old baseline", () => {
    const scene = createDirectorScene();
    const actor = scene.objects[0];
    actor.transform.position = [5, 0, 0];
    scene.cameras[0] = { ...scene.cameras[0], followObjectId: actor.id, followAnchor: [0, 0, 0], lookAtMode: "object", lookAtObjectId: actor.id };
    const before = resolveDirectorCameraLocalFraming(scene, scene.cameras[0], 0);
    const next = replaceDirectorSceneObjects(scene, [createDirectorActor("new role")], 0);
    const after = resolveDirectorCameraLocalFraming(next, next.cameras[0], 0);
    expect(after).toEqual(before);
    expect(next.cameras[0].transform.position[0]).toBeCloseTo(scene.cameras[0].transform.position[0] + 5);
    expect(next.cameras[0].followObjectId).toBeUndefined();
    expect(next.cameras[0].lookAtObjectId).toBeUndefined();
});

test("Closing and reopening the same scene while the old session is asynchronously completed will not restore write permissions.", async () => {
    const old = new AbortController();
    const operation = directorAsyncSession(old.signal);
    let resolve!: () => void;
    let writes = 0;
    const pending = new Promise<void>((done) => { resolve = done; }).then(() => { operation.assertCurrent(); writes++; });
    old.abort();
    const reopened = directorAsyncSession(new AbortController().signal);
    resolve();
    await expect(pending).rejects.toThrow("Director's desk session has ended");
    expect(writes).toBe(0);
    expect(reopened.current()).toBe(true);
});
