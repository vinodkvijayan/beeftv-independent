import { describe, expect, test } from "bun:test";

import { resolveDirectorDeleteDecision } from "../src/lib/canvas/director/director-delete-target";
import { canvasKeyboardEnabled } from "../src/pages/canvas/use-canvas-keyboard";

describe("Deletion target of Director Desk Delete/Backspace", () => {
    test("Delete a camera when it is selected", () => {
        expect(resolveDirectorDeleteDecision({ camera: { id: "camera-1" } })).toEqual({ action: "delete", kind: "camera", id: "camera-1" });
    });

    test("When the camera is locked, only keystrokes are consumed and nothing is deleted.", () => {
        expect(resolveDirectorDeleteDecision({ camera: { id: "camera-1", locked: true } })).toEqual({ action: "consume", reason: "locked" });
    });

    test("When the object is locked, only the keys are consumed and will not fall on the light or outer canvas.", () => {
        expect(resolveDirectorDeleteDecision({ object: { id: "object-1", locked: true }, light: { id: "light-1" } })).toEqual({ action: "consume", reason: "locked" });
    });

    test("Delete the corresponding entity when an object or light is selected", () => {
        expect(resolveDirectorDeleteDecision({ object: { id: "object-1" } })).toEqual({ action: "delete", kind: "object", id: "object-1" });
        expect(resolveDirectorDeleteDecision({ light: { id: "light-1" } })).toEqual({ action: "delete", kind: "light", id: "light-1" });
    });

    test("Path keyframes take precedence over camera and object selection", () => {
        expect(resolveDirectorDeleteDecision({
            pathKeyframe: { kind: "actor", id: "actor-1" },
            camera: { id: "camera-1" },
            object: { id: "object-1" },
        })).toEqual({ action: "delete", kind: "actor-path", id: "actor-1" });
        expect(resolveDirectorDeleteDecision({
            pathKeyframe: { kind: "camera", id: "camera-1" },
            camera: { id: "camera-1" },
        })).toEqual({ action: "delete", kind: "camera-path", id: "camera-1" });
    });

    test("Only consume buttons when nothing is selected", () => {
        expect(resolveDirectorDeleteDecision({})).toEqual({ action: "consume", reason: "empty" });
        expect(resolveDirectorDeleteDecision({ pathKeyframe: null, camera: null, object: null, light: null })).toEqual({ action: "consume", reason: "empty" });
    });
});

describe("Canvas keyboard enablement conditions", () => {
    const loadedWithoutPreview = { projectLoaded: true, previewActive: false };

    test("Canvas keyboard closes when director's desk is open", () => {
        expect(canvasKeyboardEnabled({ ...loadedWithoutPreview, directorNodeId: "director-node" })).toBe(false);
    });

    test("The canvas keyboard is restored after the director's desk is closed", () => {
        expect(canvasKeyboardEnabled({ ...loadedWithoutPreview, directorNodeId: null })).toBe(true);
    });

    test("Remains closed when project is not loading, version preview or folder browser is open", () => {
        expect(canvasKeyboardEnabled({ projectLoaded: false, previewActive: false, directorNodeId: null })).toBe(false);
        expect(canvasKeyboardEnabled({ projectLoaded: true, previewActive: true, directorNodeId: null })).toBe(false);
        expect(canvasKeyboardEnabled({ ...loadedWithoutPreview, directorNodeId: null, folderBrowserNodeId: "folder-node" })).toBe(false);
    });
});
