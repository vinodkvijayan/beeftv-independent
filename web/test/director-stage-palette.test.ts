import { describe, expect, test } from "bun:test";
import { Color } from "three";

import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { directorStagePalette } from "@/lib/canvas/director/director-stage-palette";
import { createDirectorSceneFromTemplate } from "@/lib/canvas/director/director-templates";

describe("New scene stage color for director's desk", () => {
    test("All new templates default to a dark stage, and the background of old scenes will not be rewritten.", () => {
        expect(createDirectorScene().background).toBe("#060608");
        for (const template of ["empty", "monologue", "dialogue", "blocking", "product"] as const) {
            expect(createDirectorSceneFromTemplate(template).background).toBe("#060608");
        }
        expect(directorStagePalette("#d8dde3").ground).toBe("#aeb7bf");
    });

    test("Dark scenes use dark ground and recognizable grids, while light-colored old scenes maintain the original look.", () => {
        const dark = directorStagePalette("#060608");
        const lightness = (color: string) => new Color(color).getHSL({ h: 0, s: 0, l: 0 }).l;
        expect(dark.ground).toBe("#151820");
        expect(lightness(dark.cell)).toBeGreaterThan(lightness(dark.ground));
        expect(lightness(dark.section)).toBeGreaterThan(lightness(dark.cell));
        expect(directorStagePalette("#d8dde3")).toEqual({ ground: "#aeb7bf", cell: "#8f99a3", section: "#626d77" });
    });
});
