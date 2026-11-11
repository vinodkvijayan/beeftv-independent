import { describe, expect, test } from "bun:test";

import { resampleDirectorGroundPath } from "@/lib/canvas/director/director-path-sampling";

describe("Fixed ten-point sampling of the director's desk trajectory", () => {
    test("Routes shorter than 0.5 meters also have ten proportional control points", () => {
        const points = resampleDirectorGroundPath([{ x: 0, z: 0 }, { x: 0.2, z: 0 }]);

        expect(points).toHaveLength(10);
        points.forEach((point, index) => {
            expect(point.x).toBeCloseTo(0.2 * index / 9, 8);
            expect(point.z).toBe(0);
        });
    });

    test("The polyline path is divided into ten equal points according to the total arc length, and the starting point and end point are retained.", () => {
        const points = resampleDirectorGroundPath([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]);

        expect(points).toHaveLength(10);
        expect(points[0]).toEqual({ x: 0, z: 0 });
        expect(points.at(-1)).toEqual({ x: 1, z: 1 });
        expect(points[4].x).toBeCloseTo(8 / 9, 8);
        expect(points[4].z).toBe(0);
        expect(points[5].x).toBe(1);
        expect(points[5].z).toBeCloseTo(1 / 9, 8);
    });
});
