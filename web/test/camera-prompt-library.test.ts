import { describe, expect, test } from "bun:test";

import { APERTURES, CAMERA_PROFILES, FOCAL_LENGTHS, LENS_PROFILES, buildCameraPrompt } from "../src/lib/canvas/camera-prompt-library";

describe("camera prompt contract", () => {
    test("builds a deterministic prompt from registered camera parameters", () => {
        const prompt = buildCameraPrompt({
            cameraId: CAMERA_PROFILES[0].id,
            lensId: LENS_PROFILES[0].id,
            focalLengthMm: FOCAL_LENGTHS[0],
            apertureF: APERTURES[0],
        });

        expect(prompt).toContain(CAMERA_PROFILES[0].shortTag);
        expect(prompt).toContain(LENS_PROFILES[0].shortTag);
    });

    test("rejects unknown persisted parameters instead of silently changing generation semantics", () => {
        const valid = {
            cameraId: CAMERA_PROFILES[0].id,
            lensId: LENS_PROFILES[0].id,
            focalLengthMm: FOCAL_LENGTHS[0],
            apertureF: APERTURES[0],
        };

        expect(() => buildCameraPrompt({ ...valid, cameraId: "unknown-camera" })).toThrow("Unsupported camera configuration");
        expect(() => buildCameraPrompt({ ...valid, lensId: "unknown-lens" })).toThrow("Unsupported lens configuration");
        expect(() => buildCameraPrompt({ ...valid, focalLengthMm: 47 })).toThrow("Unsupported focal length");
        expect(() => buildCameraPrompt({ ...valid, apertureF: 3.2 })).toThrow("Unsupported aperture");
    });
});
