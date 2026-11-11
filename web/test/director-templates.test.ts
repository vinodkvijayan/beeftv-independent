import { describe, expect, test } from "bun:test";

import { resolveDirectorPlacement } from "../src/lib/canvas/director/director-placement";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import { DIRECTOR_TEMPLATES, createDirectorSceneFromTemplate, type DirectorTemplateId } from "../src/lib/canvas/director/director-templates";
import type { DirectorScene } from "../src/types/director";

const ALL_IDS: DirectorTemplateId[] = ["empty", "monologue", "dialogue", "blocking", "product"];

/**
 * 用生产的 resolveDirectorPlacement 当判据：
 * 把某个对象「原地重新摆一次」，若返回值仍是原位置，说明它与其余对象不相交。
 * 这样重叠判据与真实摆放逻辑天然一致，测试里不再复制一份 overlap 数学。
 */
function overlappingNames(scene: DirectorScene): string[] {
    return scene.objects
        .filter((object) => {
            const others = scene.objects.filter((item) => item.id !== object.id);
            const resolved = resolveDirectorPlacement({ object, existing: others });
            return resolved[0] !== object.transform.position[0] || resolved[2] !== object.transform.position[2];
        })
        .map((object) => object.name);
}

describe("Template directory", () => {
    test("Exactly 5 templates are provided, the order is fixed and the empty scene is first", () => {
        expect(DIRECTOR_TEMPLATES.map((item) => item.id)).toEqual(ALL_IDS);
    });

    test("Each template has a name, summary and description for you to judge when choosing.", () => {
        for (const template of DIRECTOR_TEMPLATES) {
            expect(template.name.length).toBeGreaterThan(0);
            expect(template.summary.length).toBeGreaterThan(0);
            expect(template.description.length).toBeGreaterThan(0);
        }
    });
});

describe("Empty scene really has no actors", () => {
    test("empty template contains no objects", () => {
        const scene = createDirectorSceneFromTemplate("empty");
        expect(scene.objects).toEqual([]);
    });

    test("Unknown template id will fall back to an empty scene and will never be secretly inserted into the default actor", () => {
        const scene = createDirectorSceneFromTemplate("nope" as DirectorTemplateId);
        expect(scene.objects).toEqual([]);
    });

    test("Comparison: The compatible createDirectorScene still has the default actor (P0 depends on it and cannot be changed)", () => {
        expect(createDirectorScene("Compatible").objects).toHaveLength(1);
    });
});

describe("Each template generates usable camera / light / shot layouts", () => {
    test("There is exactly one camera and one lens, and shot points to the camera", () => {
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            expect(scene.cameras).toHaveLength(1);
            expect(scene.shots).toHaveLength(1);
            expect(scene.shots[0].cameraId).toBe(scene.cameras[0].id);
            expect(scene.activeShotId).toBe(scene.shots[0].id);
        }
    });

    test("Both have three-point lighting and include an ambient light.", () => {
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            expect(scene.lights).toHaveLength(3);
            expect(scene.lights.some((light) => light.type === "ambient")).toBe(true);
        }
    });

    test("The focalLength and fov of the camera are self-consistent, and there will be no conflict between focal length and viewing angle.", () => {
        for (const id of ALL_IDS) {
            const camera = createDirectorSceneFromTemplate(id).cameras[0];
            const expected = (2 * Math.atan(36 / (2 * camera.focalLength)) * 180) / Math.PI;
            expect(camera.fov).toBeCloseTo(expected, 6);
        }
    });

    test("The number of actors conforms to the template semantics: single 1, double 2, moving 3, product 0", () => {
        const actorCount = (id: DirectorTemplateId) => createDirectorSceneFromTemplate(id).objects.filter((object) => object.kind === "actor").length;
        expect(actorCount("monologue")).toBe(1);
        expect(actorCount("dialogue")).toBe(2);
        expect(actorCount("blocking")).toBe(3);
        expect(actorCount("product")).toBe(0);
    });

    test("The product template contains the product body and background board, and has no actors.", () => {
        const scene = createDirectorSceneFromTemplate("product");
        expect(scene.objects.map((object) => object.name)).toEqual(["Product body", "background board", "side props"]);
        expect(scene.objects.every((object) => object.kind !== "actor")).toBe(true);
    });
});

describe("Objects do not overlap", () => {
    test("Two persons, positions, and product templates do not intersect within each other.", () => {
        for (const id of ["dialogue", "blocking", "product"] as DirectorTemplateId[]) {
            expect(overlappingNames(createDirectorSceneFromTemplate(id))).toEqual([]);
        }
    });

    test("All templates are disjoint (including the degenerate situation of single person and empty scenes)", () => {
        for (const id of ALL_IDS) {
            expect(overlappingNames(createDirectorSceneFromTemplate(id))).toEqual([]);
        }
    });

    test("Double template two actors facing each other", () => {
        const [left, right] = createDirectorSceneFromTemplate("dialogue").objects;
        // 左侧演员在 -X，朝 +X；右侧在 +X，朝 -X。
        expect(left.transform.position[0]).toBeLessThan(0);
        expect(right.transform.position[0]).toBeGreaterThan(0);
        expect(left.transform.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
        expect(right.transform.rotation[1]).toBeCloseTo(-Math.PI / 2, 6);
    });
});

describe("Deterministic and id independent", () => {
    test("The structure generated twice by the template is exactly the same (ignoring the id and timestamp)", () => {
        const strip = (scene: DirectorScene) => JSON.stringify(scene, (key, value) => (key === "id" || key === "cameraId" || key === "activeShotId" || key === "createdAt" || key === "updatedAt" ? "<volatile>" : value));
        for (const id of ALL_IDS) {
            expect(strip(createDirectorSceneFromTemplate(id))).toBe(strip(createDirectorSceneFromTemplate(id)));
        }
    });

    test("The id of each instance is independent: the two generations do not share any id", () => {
        for (const id of ALL_IDS) {
            const first = createDirectorSceneFromTemplate(id);
            const second = createDirectorSceneFromTemplate(id);
            const ids = (scene: DirectorScene) => [scene.id, ...scene.objects.map((o) => o.id), ...scene.cameras.map((c) => c.id), ...scene.lights.map((l) => l.id), ...scene.shots.map((s) => s.id)];
            expect(ids(first).some((value) => ids(second).includes(value))).toBe(false);
        }
    });

    test("The internal ID of a single scene does not collide with itself", () => {
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            const all = [scene.id, ...scene.objects.map((o) => o.id), ...scene.cameras.map((c) => c.id), ...scene.lights.map((l) => l.id), ...scene.shots.map((s) => s.id)];
            expect(new Set(all).size).toBe(all.length);
        }
    });

    test("title is passed through, and the default name is used if not given.", () => {
        expect(createDirectorSceneFromTemplate("empty", "Shot 7").title).toBe("Shot 7");
        expect(createDirectorSceneFromTemplate("empty").title).toBe("unnamed scene");
    });
});

describe("Do not upgrade schema", () => {
    test("version is always 1, and the field set is exactly the same as the compatible factory", () => {
        const legacy = Object.keys(createDirectorScene("legacy")).toSorted();
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            expect(scene.version).toBe(1);
            expect(Object.keys(scene).toSorted()).toEqual(legacy);
        }
    });

    test("Templates do not write workbench states like mode", () => {
        for (const id of ALL_IDS) {
            expect(Object.keys(createDirectorSceneFromTemplate(id))).not.toContain("mode");
        }
    });
});
