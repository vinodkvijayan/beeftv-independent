import { describe, expect, test } from "bun:test";

import { applyDirectorUniformScale, createDirectorObject } from "../src/lib/canvas/director/director-scene";

describe("Director's desk unified zoom", () => {
    test("Independent magnification proportionally scales the three axes and all keyframes without erasing the original axial differences.", () => {
        const base = createDirectorObject("box", "Props");
        const object = {
            ...base,
            transform: { ...base.transform, scale: [1, 2, 3] as [number, number, number] },
            keyframes: [{ id: "k1", time: 1, transform: { ...base.transform, scale: [2, 3, 4] as [number, number, number] } }],
        };
        const doubled = applyDirectorUniformScale(object, 2);
        expect(doubled.uniformScale).toBe(2);
        expect(doubled.transform.scale).toEqual([2, 4, 6]);
        expect(doubled.keyframes[0].transform.scale).toEqual([4, 6, 8]);
        const tripled = applyDirectorUniformScale(doubled, 3);
        expect(tripled.transform.scale).toEqual([3, 6, 9]);
        expect(tripled.keyframes[0].transform.scale).toEqual([6, 9, 12]);
        expect(object.transform.scale).toEqual([1, 2, 3]);
    });

    test("The default magnification of old objects is 1, and no bad scenarios will be written for out-of-bounds and illegal inputs.", () => {
        const object = createDirectorObject("box", "Props");
        expect(applyDirectorUniformScale(object, Number.NaN)).toBe(object);
        expect(applyDirectorUniformScale(object, 0).uniformScale).toBe(0.1);
        expect(applyDirectorUniformScale(object, 20).uniformScale).toBe(10);
    });
});
