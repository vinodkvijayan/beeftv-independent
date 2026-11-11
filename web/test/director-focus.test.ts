import { describe, expect, test } from "bun:test";

import { resolveDirectorFocusFrame } from "../src/lib/canvas/director/director-focus";

describe("Scene asset focus framing", () => {
    test("Move the observation camera to aim at the target, and frame the view according to the subject radius and FOV", () => {
        const frame = resolveDirectorFocusFrame({
            cameraPosition: [0, 2, 8],
            cameraTarget: [0, 0, 0],
            focusTarget: [4, 1, -2],
            radius: 1,
            fov: 50,
        });

        expect(frame?.target).toEqual([4, 1, -2]);
        expect(frame?.position[1]).toBeGreaterThan(1);
        expect(frame?.position[2]).toBeGreaterThan(-2);
        expect(Math.hypot(frame!.position[0] - 4, frame!.position[1] - 1, frame!.position[2] + 2)).toBeGreaterThan(2);
    });

    test("Invalid targets do not change the camera, extreme radius and FOV are limited", () => {
        expect(resolveDirectorFocusFrame({ cameraPosition: [0, 0, 4], cameraTarget: [0, 0, 0], focusTarget: [Number.NaN, 0, 0], radius: 1, fov: 50 })).toBeNull();
        const near = resolveDirectorFocusFrame({ cameraPosition: [0, 0, 4], cameraTarget: [0, 0, 0], focusTarget: [0, 0, 0], radius: 0.01, fov: 180 });
        const far = resolveDirectorFocusFrame({ cameraPosition: [0, 0, 4], cameraTarget: [0, 0, 0], focusTarget: [0, 0, 0], radius: 10000, fov: 1 });
        expect(Math.hypot(...near!.position)).toBeGreaterThanOrEqual(1.24);
        expect(Math.hypot(...far!.position)).toBeLessThanOrEqual(80);
    });
});
