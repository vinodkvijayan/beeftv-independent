import { describe, expect, test } from "bun:test";
import * as placement from "../src/lib/canvas/director/director-placement";

import {
    DIRECTOR_PLACEMENT_MARGIN,
    directorObjectFootprint,
    emptyDirectorPlacementIntent,
    finiteDirectorGroundPoint,
    resolveDirectorPlacement,
    resolveDirectorPlacementAnchor,
    type DirectorGroundPoint,
} from "../src/lib/canvas/director/director-placement";
import { createDirectorActor, createDirectorBillboard, createDirectorModel, createDirectorObject } from "../src/lib/canvas/director/director-scene";
import type { DirectorObject, DirectorVec3 } from "../src/types/director";

function place(object: DirectorObject, existing: DirectorObject[]) {
    const position = resolveDirectorPlacement({ object, existing });
    return { ...object, transform: { ...object.transform, position } };
}

/** XZ 占位是否相交（含 margin）；Y 完全不参与。 */
function overlapsXZ(a: DirectorObject, b: DirectorObject) {
    const fa = directorObjectFootprint(a);
    const fb = directorObjectFootprint(b);
    const dx = Math.abs(a.transform.position[0] - b.transform.position[0]);
    const dz = Math.abs(a.transform.position[2] - b.transform.position[2]);
    return dx < (fa.width + fb.width) / 2 + DIRECTOR_PLACEMENT_MARGIN && dz < (fa.depth + fb.depth) / 2 + DIRECTOR_PLACEMENT_MARGIN;
}

function scaled(object: DirectorObject, scale: DirectorVec3) {
    return { ...object, transform: { ...object.transform, scale } };
}

describe("Continuous new additions without overlap (B regression)", () => {
    test("In addition to the default scene actors, 6 cubes are added consecutively, and no two cubes intersect.", () => {
        const placed: DirectorObject[] = [createDirectorActor("actor 1", [0, 0, 0])];
        for (let index = 0; index < 6; index += 1) placed.push(place(createDirectorObject("box", `cube${index}`), placed));
        placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlapsXZ(a, b)).toBe(false)));
    });

    test("Mixed kinds are added continuously: actor / model / billboard / primitive are mutually exclusive", () => {
        const placed: DirectorObject[] = [];
        placed.push(place(createDirectorActor("actor 1", [0, 0, 0]), placed));
        placed.push(place(createDirectorModel({ name: "model", storageKey: undefined, url: "u", mimeType: undefined, assetId: undefined }), placed));
        placed.push(place(createDirectorBillboard("Stand up sign", "u"), placed));
        placed.push(place(createDirectorObject("sphere", "sphere"), placed));
        placed.push(place(createDirectorActor("Actor 2", [0, 0, 0]), placed));
        placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlapsXZ(a, b)).toBe(false)));
    });

    test("The default actor and default model no longer overlap when both are at the origin.", () => {
        const actor = createDirectorActor("actor 1", [0, 0, 0]);
        const model = place(createDirectorModel({ name: "model", storageKey: undefined, url: "u", mimeType: undefined, assetId: undefined }), [actor]);
        expect(overlapsXZ(actor, model)).toBe(false);
    });

    test("Hidden objects also occupy space", () => {
        const hidden = { ...createDirectorObject("box", "hide"), visible: false };
        const next = place(createDirectorObject("box", "new"), [hidden]);
        expect(overlapsXZ(hidden, next)).toBe(false);
    });
});

describe("Placeholder size and scaling", () => {
    test("The footprint is enlarged with scale.x/z and does not use scale.y", () => {
        const base = directorObjectFootprint(createDirectorObject("box", "b"));
        const wide = directorObjectFootprint(scaled(createDirectorObject("box", "b"), [3, 9, 2]));
        expect(wide.width).toBeCloseTo(base.width * 3, 6);
        expect(wide.depth).toBeCloseTo(base.depth * 2, 6);
    });

    test("Negative scaling takes place according to the absolute value and does not produce negative dimensions.", () => {
        const mirrored = directorObjectFootprint(scaled(createDirectorObject("box", "b"), [-3, 1, -2]));
        expect(mirrored.width).toBeCloseTo(3, 6);
        expect(mirrored.depth).toBeCloseTo(2, 6);
    });

    test("Leave more space around large scaled objects", () => {
        const big = scaled(createDirectorObject("box", "Big"), [6, 1, 6]);
        const next = place(createDirectorObject("box", "small"), [big]);
        expect(overlapsXZ(big, next)).toBe(false);
        expect(Math.hypot(next.transform.position[0], next.transform.position[2])).toBeGreaterThan(3);
    });

    test("billboard uses wide and shallow placeholders", () => {
        const footprint = directorObjectFootprint(createDirectorBillboard("Stand up sign", "u"));
        expect(footprint.width).toBeGreaterThan(footprint.depth);
    });
});

describe("Only change XZ, determinism and congestion fallback", () => {
    test("retain the Y given by the caller", () => {
        expect(place(createDirectorObject("box", "b"), [createDirectorObject("box", "a")]).transform.position[1]).toBeCloseTo(0.5, 6);
        expect(place(createDirectorActor("actor", [0, 0, 0]), [createDirectorActor("Already have", [0, 0, 0])]).transform.position[1]).toBeCloseTo(0, 6);
        expect(place(createDirectorBillboard("Stand up sign", "u"), [createDirectorBillboard("Already have", "u")]).transform.position[1]).toBeCloseTo(1.1, 6);
    });

    test("Same input gets the same output (deterministic)", () => {
        const existing = [createDirectorObject("box", "a"), createDirectorActor("actor", [2, 0, 0])];
        const first = resolveDirectorPlacement({ object: createDirectorObject("box", "new"), existing });
        const second = resolveDirectorPlacement({ object: createDirectorObject("box", "new"), existing });
        expect(first).toEqual(second);
    });

    test("An empty scene retains the original desired position", () => {
        expect(resolveDirectorPlacement({ object: createDirectorObject("box", "b"), existing: [] })).toEqual([0, 0.5, 0]);
    });

    test("When extremely crowded, the retreat position must not intersect with all objects.", () => {
        const crowd: DirectorObject[] = [];
        for (let x = -20; x <= 20; x += 1) {
            for (let z = -20; z <= 20; z += 1) {
                crowd.push({ ...createDirectorObject("box", `c-${x}-${z}`), transform: { position: [x, 0.5, z], rotation: [0, 0, 0], scale: [1, 1, 1] } });
            }
        }
        const placed = place(createDirectorObject("box", "new"), crowd);
        placed.transform.position.forEach((value) => expect(Number.isFinite(value)).toBe(true));
        expect(placed.transform.position[1]).toBeCloseTo(0.5, 6);
        // 核心性质：兜底不是「随便给一点」，必须真的不与任何既有占位相交。
        crowd.forEach((item) => expect(overlapsXZ(placed, item)).toBe(false));
    });

    test("When the extremely large scale exceeds the search radius of the ring, the pockets still do not intersect.", () => {
        // ring 最大半径 24*0.75 = 18；用远大于它的占位强制走兜底分支。
        const huge = scaled(createDirectorObject("box", "huge"), [80, 1, 80]);
        const placed = place(createDirectorObject("box", "new"), [huge]);
        expect(overlapsXZ(placed, huge)).toBe(false);
        expect(placed.transform.position[1]).toBeCloseTo(0.5, 6);
    });

    test("When multiple oversized placeholders are mixed, the bottom of the pocket is outside all the placeholders.", () => {
        const first = { ...scaled(createDirectorObject("box", "Big 1"), [60, 1, 60]), transform: { position: [0, 0.5, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [60, 1, 60] as DirectorVec3 } };
        const second = { ...scaled(createDirectorObject("box", "Big 2"), [40, 1, 40]), transform: { position: [70, 0.5, 10] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [40, 1, 40] as DirectorVec3 } };
        const placed = place(createDirectorObject("box", "new"), [first, second]);
        [first, second].forEach((item) => expect(overlapsXZ(placed, item)).toBe(false));
    });

    test("Illegal input does not generate NaN", () => {
        const broken = { ...createDirectorObject("box", "bad"), transform: { position: [Number.NaN, Number.NaN, Number.NaN] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [Number.NaN, 1, 1] as DirectorVec3 } };
        resolveDirectorPlacement({ object: broken, existing: [createDirectorObject("box", "a")] }).forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });
});

describe("Ground anchor normalization", () => {
    test("Finite values become legal ground points", () => {
        expect(finiteDirectorGroundPoint(1.5, -2.25)).toEqual({ x: 1.5, z: -2.25 });
        expect(finiteDirectorGroundPoint(0, 0)).toEqual({ x: 0, z: 0 });
    });

    test("NaN / ±Infinity / non-numeric values are not available", () => {
        expect(finiteDirectorGroundPoint(Number.NaN, 0)).toBeNull();
        expect(finiteDirectorGroundPoint(0, Number.NaN)).toBeNull();
        expect(finiteDirectorGroundPoint(Number.POSITIVE_INFINITY, 0)).toBeNull();
        expect(finiteDirectorGroundPoint(0, Number.NEGATIVE_INFINITY)).toBeNull();
        expect(finiteDirectorGroundPoint(undefined, 0)).toBeNull();
        expect(finiteDirectorGroundPoint("3", 0)).toBeNull();
        expect(finiteDirectorGroundPoint(null, null)).toBeNull();
    });
});

describe("Place source priority", () => {
    test("pointer takes precedence over orbit target when present", () => {
        const anchor = resolveDirectorPlacementAnchor({
            intent: { pointer: { x: 3, z: -4 }, orbitTarget: { x: 9, z: 9 } },
            fallback: [0, 0.5, 0],
        });
        expect(anchor).toEqual([3, 0.5, -4]);
    });

    test("Fallback to orbit target when pointer is missing", () => {
        const anchor = resolveDirectorPlacementAnchor({
            intent: { pointer: null, orbitTarget: { x: -2.5, z: 6 } },
            fallback: [0, 0.5, 0],
        });
        expect(anchor).toEqual([-2.5, 0.5, 6]);
    });

    test("Keep object original XZ when neither is available", () => {
        expect(resolveDirectorPlacementAnchor({ intent: emptyDirectorPlacementIntent, fallback: [7, 0.5, -8] })).toEqual([7, 0.5, -8]);
        expect(resolveDirectorPlacementAnchor({ intent: null, fallback: [7, 0.5, -8] })).toEqual([7, 0.5, -8]);
    });

    test("When the context is unavailable and null intent is returned, no exception will be thrown and the default origin will be returned.", () => {
        expect(resolveDirectorPlacementAnchor({ intent: null, fallback: [0, 0, 0] })).toEqual([0, 0, 0]);
    });

    test("fallback itself XZ returns to zero non-finitely, Y remains", () => {
        expect(resolveDirectorPlacementAnchor({ intent: null, fallback: [Number.NaN, 1.1, Number.NaN] })).toEqual([0, 1.1, 0]);
    });
    test("Illegal pointers must not obscure legal orbit targets", () => {
        const cases: DirectorGroundPoint[] = [
            { x: Number.NaN, z: 0 },
            { x: 0, z: Number.NaN },
            { x: Number.POSITIVE_INFINITY, z: 0 },
            { x: 0, z: Number.NEGATIVE_INFINITY },
            { x: Number.NaN, z: Number.NaN },
        ];
        for (const pointer of cases) {
            expect(
                resolveDirectorPlacementAnchor({
                    intent: { pointer, orbitTarget: { x: -2.5, z: 6 } },
                    fallback: [0, 0.5, 0],
                }),
            ).toEqual([-2.5, 0.5, 6]);
        }
    });

    test("Fallback to legal fallback XZ when illegal pointer + illegal orbit", () => {
        expect(
            resolveDirectorPlacementAnchor({
                intent: { pointer: { x: Number.NaN, z: Number.NaN }, orbitTarget: { x: Number.POSITIVE_INFINITY, z: 3 } },
                fallback: [7, 0.5, -8],
            }),
        ).toEqual([7, 0.5, -8]);
    });

    test("Return to zero if all three sources are illegal and still retain constructor Y", () => {
        expect(
            resolveDirectorPlacementAnchor({
                intent: { pointer: { x: Number.NaN, z: 0 }, orbitTarget: { x: Number.NaN, z: 0 } },
                fallback: [Number.NaN, 1.1, Number.POSITIVE_INFINITY],
            }),
        ).toEqual([0, 1.1, 0]);
    });

    test("A legal pointer containing 0 will not be misjudged as missing.", () => {
        expect(
            resolveDirectorPlacementAnchor({
                intent: { pointer: { x: 0, z: 0 }, orbitTarget: { x: 9, z: 9 } },
                fallback: [7, 0.5, -8],
            }),
        ).toEqual([0, 0.5, 0]);
    });

    test("Illegal orbits do not affect legal pointers", () => {
        expect(
            resolveDirectorPlacementAnchor({
                intent: { pointer: { x: 3, z: -4 }, orbitTarget: { x: Number.NaN, z: Number.NaN } },
                fallback: [0, 0.5, 0],
            }),
        ).toEqual([3, 0.5, -4]);
    });

    test("Non-finite fallback Y resets to zero, XZ source still takes effect", () => {
        expect(
            resolveDirectorPlacementAnchor({
                intent: { pointer: { x: 2, z: 2 }, orbitTarget: null },
                fallback: [0, Number.NaN, 0],
            }),
        ).toEqual([2, 0, 2]);
    });
});

describe("Grid adsorption", () => {
    test("When turned on, XZ is pasted to the half-unit cell and Y is retained; when turned off, the position remains unchanged.", () => {
        expect(placement.snapDirectorGroundPosition([1.26, 0.7, -0.74], true)).toEqual([1.5, 0.7, -0.5]);
        expect(placement.snapDirectorGroundPosition([1.26, 0.7, -0.74], false)).toEqual([1.26, 0.7, -0.74]);
    });

    test("The newly added objects after collision avoidance are still on the grid and do not overlap with the placeholders.", () => {
        const existing = [createDirectorObject("box", "Already have", [1.5, 0.5, -0.5])];
        const object = createDirectorObject("box", "new", [1.26, 0.5, -0.74]);
        const position = resolveDirectorPlacement({ object, existing, gridSnap: true });
        expect(position[0] * 2).toBeInteger();
        expect(position[2] * 2).toBeInteger();
        expect(position[1]).toBe(0.5);
        expect(overlapsXZ({ ...object, transform: { ...object.transform, position } }, existing[0])).toBe(false);
    });
});

describe("Anchor point does not change constructor Y", () => {
    const pointer = { pointer: { x: 4, z: 5 }, orbitTarget: null };

    test("primitive remains 0.5", () => {
        const box = createDirectorObject("box", "cube");
        expect(box.transform.position[1]).toBe(0.5);
        expect(resolveDirectorPlacementAnchor({ intent: pointer, fallback: box.transform.position })[1]).toBe(0.5);
    });

    test("actor remains 0", () => {
        const actor = createDirectorActor("actor");
        expect(resolveDirectorPlacementAnchor({ intent: pointer, fallback: actor.transform.position })[1]).toBe(0);
    });

    test("model remains 0", () => {
        const model = createDirectorModel({ name: "model", assetId: "a", storageKey: "k", url: "u", mimeType: "model/gltf-binary" });
        expect(resolveDirectorPlacementAnchor({ intent: pointer, fallback: model.transform.position })[1]).toBe(0);
    });

    test("billboard remains 1.1", () => {
        const billboard = createDirectorBillboard("Stand up sign", "https://example.invalid/a.png");
        expect(billboard.transform.position[1]).toBe(1.1);
        expect(resolveDirectorPlacementAnchor({ intent: pointer, fallback: billboard.transform.position })[1]).toBe(1.1);
    });

    test("The anchor points XZ of the four kinds all come from pointer", () => {
        const objects = [
            createDirectorObject("box", "cube"),
            createDirectorActor("actor"),
            createDirectorModel({ name: "model", assetId: "a", storageKey: "k", url: "u", mimeType: "model/gltf-binary" }),
            createDirectorBillboard("Stand up sign", "https://example.invalid/a.png"),
        ];
        for (const object of objects) {
            const anchor = resolveDirectorPlacementAnchor({ intent: pointer, fallback: object.transform.position });
            expect([anchor[0], anchor[2]]).toEqual([4, 5]);
        }
    });
});

describe("Anchor point and collision avoidance combination", () => {
    test("The anchor point falls exactly on anchor point XZ when idle", () => {
        const box = createDirectorObject("box", "cube");
        const anchored = { ...box, transform: { ...box.transform, position: resolveDirectorPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        expect(resolveDirectorPlacement({ object: anchored, existing: [] })).toEqual([6, 0.5, -6]);
    });

    test("When the anchor point is occupied, move away from the anchor point while still maintaining Y", () => {
        const occupant = createDirectorObject("box", "Placeholder", [6, 0.5, -6]);
        const box = createDirectorObject("box", "cube");
        const anchored = { ...box, transform: { ...box.transform, position: resolveDirectorPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        const placed = resolveDirectorPlacement({ object: anchored, existing: [occupant] });

        expect(placed[1]).toBe(0.5);
        expect(placed).not.toEqual([6, 0.5, -6]);
        expect(overlapsXZ({ ...anchored, transform: { ...anchored.transform, position: placed } }, occupant)).toBe(false);
        // 避让必须发生在锚点附近，而不是被拉回世界原点。
        expect(Math.hypot(placed[0] - 6, placed[2] + 6)).toBeLessThan(3);
    });

    test("Avoidance results are determined for the same input", () => {
        const occupant = createDirectorObject("box", "Placeholder", [6, 0.5, -6]);
        const box = createDirectorObject("box", "cube");
        const anchored = { ...box, transform: { ...box.transform, position: resolveDirectorPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        const first = resolveDirectorPlacement({ object: anchored, existing: [occupant] });
        const second = resolveDirectorPlacement({ object: anchored, existing: [occupant] });
        expect(first).toEqual(second);
    });

    test("When the area around the anchor point is extremely crowded, the bottom pockets still do not intersect and the Y does not change.", () => {
        const crowd: DirectorObject[] = [];
        for (let x = -10; x <= 10; x += 1) {
            for (let z = -10; z <= 10; z += 1) {
                crowd.push(createDirectorObject("box", `Placeholder${x}:${z}`, [6 + x, 0.5, -6 + z]));
            }
        }
        const box = createDirectorObject("box", "cube");
        const anchored = { ...box, transform: { ...box.transform, position: resolveDirectorPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        const placed = resolveDirectorPlacement({ object: anchored, existing: crowd });
        const settled = { ...anchored, transform: { ...anchored.transform, position: placed } };

        expect(placed[1]).toBe(0.5);
        expect(crowd.some((item) => overlapsXZ(settled, item))).toBe(false);
    });

    test("The orbit fallback source also participates in avoidance", () => {
        const occupant = createDirectorObject("box", "Placeholder", [-3, 0.5, 2]);
        const box = createDirectorObject("box", "cube");
        const anchored = { ...box, transform: { ...box.transform, position: resolveDirectorPlacementAnchor({ intent: { pointer: null, orbitTarget: { x: -3, z: 2 } }, fallback: box.transform.position }) } };
        const placed = resolveDirectorPlacement({ object: anchored, existing: [occupant] });

        expect(placed[1]).toBe(0.5);
        expect(overlapsXZ({ ...anchored, transform: { ...anchored.transform, position: placed } }, occupant)).toBe(false);
        expect(Math.hypot(placed[0] + 3, placed[2] - 2)).toBeLessThan(3);
    });
});
