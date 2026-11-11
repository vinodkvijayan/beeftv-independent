import { describe, expect, test } from "bun:test";

import { searchDirectorSceneItems } from "@/lib/canvas/director/director-scene-search";
import { createDirectorSceneFromTemplate } from "@/lib/canvas/director/director-templates";

const scene = createDirectorSceneFromTemplate("dialogue");
scene.cameras[0].name = "Seat 2";
scene.objects[0].name = "Role A";
scene.objects[1].name = "Character B";

describe("Director's desk scene search", () => {
    test("Empty query lists scene data in order of camera position, object, and light", () => {
        const items = searchDirectorSceneItems(scene, "");
        expect(items.map((item) => item.name).slice(0, 3)).toEqual(["Seat 2", "Role A", "Character B"]);
        expect(items.some((item) => item.kind === "light")).toBe(true);
    });

    test("Only name matches are displayed when typing, ignoring leading and trailing blanks and English case.", () => {
        expect(searchDirectorSceneItems(scene, "  Seat 2").map((item) => item.name)).toEqual(["Seat 2"]);
        expect(searchDirectorSceneItems(scene, "role").map((item) => item.name)).toEqual(["Role A", "Character B"]);
        expect(searchDirectorSceneItems(scene, "not-found")).toEqual([]);
    });

    test("Search is read-only and does not change the project scene", () => {
        const before = JSON.stringify(scene);
        searchDirectorSceneItems(scene, "Role A");
        expect(JSON.stringify(scene)).toBe(before);
    });
});
