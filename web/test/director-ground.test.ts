import { describe, expect, test } from "bun:test";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { createDirectorSceneFromTemplate } from "@/lib/canvas/director/director-templates";
import { DIRECTOR_DEFAULT_GROUND, directorGroundSettings } from "@/lib/canvas/director/director-ground";

describe("Director's stage floor", () => {
    test("New scenes and templates use LibTV terrestrial initialization", () => {
        expect(createDirectorScene().ground).toEqual(DIRECTOR_DEFAULT_GROUND);
        expect(createDirectorSceneFromTemplate("empty").ground).toEqual(DIRECTOR_DEFAULT_GROUND);
    });

    test("Old scene retains originally opaque ground when fields are missing", () => {
        expect(directorGroundSettings({})).toEqual({ visible: true, opacity: 1, height: 0 });
    });

    test("Exception save value not penetrating to 3D materials or geometry", () => {
        expect(directorGroundSettings({ ground: { visible: false, opacity: Infinity, height: NaN } })).toEqual({ visible: false, opacity: 1, height: 0 });
        expect(directorGroundSettings({ ground: { visible: true, opacity: -1, height: 100 } })).toEqual({ visible: true, opacity: 0, height: 2 });
    });
});
