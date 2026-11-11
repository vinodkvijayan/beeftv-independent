import { describe, expect, test } from "bun:test";

import { updateDirectorShotPrompt } from "@/lib/canvas/director/director-session";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";

describe("Director node description submission", () => {
    test("Update the specified shot prompt word and retain other shot content", () => {
        const base = createDirectorScene("Dual lens");
        const secondShot = { ...base.shots[0], id: "shot-2", name: "Shot 2", prompt: "Old description 2" };
        const scene = { ...base, activeShotId: secondShot.id, shots: [{ ...base.shots[0], prompt: "Old description 1" }, secondShot] };

        const updated = updateDirectorShotPrompt(scene, base.shots[0].id, "  New scene description");

        expect(updated.shots[0].prompt).toBe("New scene description");
        expect(updated.shots[1]).toBe(secondShot);
        expect(updated.activeShotId).toBe(secondShot.id);
    });

    test("When the lens reference fails, the active lens will be rolled back. An empty description will not overwrite the existing content.", () => {
        const scene = createDirectorScene("single lens");
        const fallback = updateDirectorShotPrompt(scene, "missing-shot", "new description");
        expect(fallback.shots[0].prompt).toBe("new description");
        expect(updateDirectorShotPrompt(fallback, scene.activeShotId, "   ")).toBe(fallback);
    });
});
