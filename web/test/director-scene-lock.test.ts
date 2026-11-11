import { describe, expect, test } from "bun:test";
import { createDirectorScene, toggleDirectorObjectLock } from "../src/lib/canvas/director/director-scene";

describe("Director's desk scene object lock", () => {
    test("The lock can be revoked and unlocked. The old scene is unlocked by default and does not affect the transformation data of the object.", () => {
        const scene = createDirectorScene();
        const object = scene.objects[0];
        expect(object.locked).toBeUndefined();
        const locked = toggleDirectorObjectLock(scene, object.id);
        expect(locked.objects[0].locked).toBe(true);
        expect(locked.objects[0].transform).toEqual(object.transform);
        expect(scene.objects[0].locked).toBeUndefined();
        expect(toggleDirectorObjectLock(locked, object.id).objects[0].locked).toBe(false);
    });

    test("Objects that do not exist do not cause scene changes.", () => {
        const scene = createDirectorScene();
        expect(toggleDirectorObjectLock(scene, "missing")).toBe(scene);
    });
});
