import { describe, expect, test } from "bun:test";
import * as sceneTools from "@/lib/canvas/director/director-scene";

describe("Create a copy of the director's desk scene list", () => {
    test("Keep content, generate unique IDs, and append to end of list when copying roles", () => {
        const scene = sceneTools.createDirectorScene();
        const original = scene.objects[0];
        original.keyframes = [{ id: "keyframe-1", time: 0, transform: structuredClone(original.transform) }];
        const duplicate = Reflect.get(sceneTools, "duplicateDirectorObject") as ((item: typeof original) => typeof original) | undefined;
        expect(duplicate).toBeFunction();
        const copy = duplicate!(original);
        expect(copy.name).toBe(`${original.name}copy`);
        expect(copy.id).not.toBe(original.id);
        expect(copy.transform).toEqual(original.transform);
        expect(copy.transform).not.toBe(original.transform);
        expect(copy.keyframes[0].id).not.toBe(original.keyframes[0].id);
        expect(copy.url).toBe(original.url);
        expect(copy.rig).not.toBe(original.rig);
    });

    test("No keyframes or coordinate references are shared when copying a camera position", () => {
        const original = sceneTools.createDirectorScene().cameras[0];
        original.keyframes = [{ id: "camera-keyframe", time: 0, transform: structuredClone(original.transform) }];
        const duplicate = Reflect.get(sceneTools, "duplicateDirectorCamera") as ((item: typeof original) => typeof original) | undefined;
        expect(duplicate).toBeFunction();
        const copy = duplicate!(original);
        expect(copy.name).toBe(`${original.name}copy`);
        expect(copy.id).not.toBe(original.id);
        expect(copy.transform).toEqual(original.transform);
        expect(copy.target).not.toBe(original.target);
        expect(copy.keyframes[0].id).not.toBe(original.keyframes[0].id);
    });
});
