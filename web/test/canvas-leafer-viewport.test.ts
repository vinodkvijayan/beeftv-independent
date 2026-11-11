import { describe, expect, test } from "bun:test";

import { calculateCanvasPreviewTransform, sameCanvasViewport, shouldRebaseCanvasRaster } from "../src/lib/canvas/canvas-leafer-viewport";

describe("calculateCanvasPreviewTransform", () => {
    test("Map rasterized viewport to live zoom viewport", () => {
        expect(calculateCanvasPreviewTransform(
            { x: 80, y: 25, k: 1.5 },
            { x: 100, y: 50, k: 1 },
        )).toEqual({ ratio: 1.5, x: -70, y: -50 });
    });

    test("Keep unit scaling only when panning", () => {
        expect(calculateCanvasPreviewTransform(
            { x: 135, y: 70, k: 1.25 },
            { x: 100, y: 50, k: 1.25 },
        )).toEqual({ ratio: 1, x: 35, y: 20 });
    });
});

describe("shouldRebaseCanvasRaster", () => {
    const rasterViewport = { x: 100, y: 50, k: 1 };

    test("Regular zoom reuses current raster", () => {
        expect(shouldRebaseCanvasRaster({ x: 90, y: 45, k: 0.85 }, rasterViewport)).toBe(false);
        expect(shouldRebaseCanvasRaster({ x: 80, y: 40, k: 1.25 }, rasterViewport)).toBe(false);
    });

    test("Rebuild raster baseline when cache threshold exceeded", () => {
        expect(shouldRebaseCanvasRaster({ x: 90, y: 45, k: 0.849 }, rasterViewport)).toBe(true);
        expect(shouldRebaseCanvasRaster({ x: 80, y: 40, k: 1.251 }, rasterViewport)).toBe(true);
    });
});

test("sameCanvasViewport compares the complete viewport", () => {
    expect(sameCanvasViewport({ x: 1, y: 2, k: 1.5 }, { x: 1, y: 2, k: 1.5 })).toBe(true);
    expect(sameCanvasViewport({ x: 1, y: 2, k: 1.5 }, { x: 1, y: 3, k: 1.5 })).toBe(false);
});
