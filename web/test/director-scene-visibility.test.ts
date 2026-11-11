import { describe, expect, test } from "bun:test";
import { createDirectorScene, toggleDirectorObjectVisibility } from "../src/lib/canvas/director/director-scene";

describe("Director's desk scene list visibility", () => {
    test("Hide and restore only change the target object, retaining the objects in the list and other scene data", () => {
        const scene = createDirectorScene();
        const target = scene.objects[0];
        const hidden = toggleDirectorObjectVisibility(scene, target.id);
        expect(hidden.objects).toHaveLength(scene.objects.length);
        expect(hidden.objects[0].visible).toBe(false);
        expect(hidden.objects.slice(1)).toEqual(scene.objects.slice(1));
        expect(scene.objects[0].visible).toBe(true);
        expect(toggleDirectorObjectVisibility(hidden, target.id).objects[0].visible).toBe(true);
    });

    test("Do not create invalid historical changes when the object does not exist", () => {
        const scene = createDirectorScene();
        expect(toggleDirectorObjectVisibility(scene, "missing")).toBe(scene);
    });
});
