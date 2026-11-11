import { describe, expect, test } from "bun:test";

import { createDirectorGeometricObject, DIRECTOR_GEOMETRY_PRESET_OPTIONS } from "../src/lib/canvas/director/director-geometry-presets";

describe("Director's desk geometric model preset", () => {
    test("exposes all geometric choices and creates the matching persistent scene primitive", () => {
        expect(DIRECTOR_GEOMETRY_PRESET_OPTIONS.map(({ label }) => label)).toEqual([
            "cube", "sphere", "cylinder", "ring body", "cone", "pyramid", "Add empty object",
        ]);

        for (const option of DIRECTOR_GEOMETRY_PRESET_OPTIONS) {
            const object = createDirectorGeometricObject(option.id);
            expect(object).toMatchObject({ kind: "primitive", primitive: option.primitive, name: option.label, visible: true });
            expect(object.url).toBeUndefined();
        }
    });
});
