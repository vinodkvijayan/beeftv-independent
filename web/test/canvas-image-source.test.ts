import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPortraitTextureNode, isCanvasImageSourceNode } from "../src/lib/canvas/canvas-image-source";
import { canGenerateImageInPlace } from "../src/lib/canvas/canvas-generation-layout";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const source: CanvasNodeData = {
    id: "uploaded", type: CanvasNodeType.Image, title: "Original picture", position: { x: 10, y: 20 }, width: 300, height: 200,
    metadata: { content: "original-image", storageKey: "original-key", status: "success" },
};
const read = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");
// 断言源码时忽略换行与缩进：长条件被拆行属于排版变化，不应让契约测试失效。
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("Upload pictures as input material", () => {
    test("There is no generation box for uploading and importing images, and empty nodes and generation results can still be configured.", () => {
        expect(isCanvasImageSourceNode(source)).toBe(true);
        expect(isCanvasImageSourceNode({ ...source, metadata: {} })).toBe(false);
        expect(isCanvasImageSourceNode({ ...source, metadata: { ...source.metadata, generationType: "edit" } })).toBe(false);
        expect(isCanvasImageSourceNode({ ...source, metadata: { ...source.metadata, taskId: "task" } })).toBe(false);
        expect(isCanvasImageSourceNode({ ...source, type: CanvasNodeType.Video })).toBe(false);
        expect(isCanvasImageSourceNode(null)).toBe(false);
    });
    test("Explicit copy/version entry remains available", () => {
        expect(isCanvasImageSourceNode({ ...source, metadata: { ...source.metadata, generationResultPlacement: "replace-node" } })).toBe(false);
        expect(isCanvasImageSourceNode({ ...source, metadata: { ...source.metadata, copiedFromNodeId: "original" } })).toBe(false);
    });
    test("Create independent editing nodes for character texture, without copying the original image output and task status", () => {
        const before = structuredClone(source);
        const child = createPortraitTextureNode(source, "texture");
        expect(source).toEqual(before);
        expect(child.id).toBe("texture");
        expect(child.position).toEqual({ x: 406, y: 20 });
        expect(child.metadata?.composerContent).toBe("@Picture1");
        expect(child.metadata?.generationType).toBe("edit");
        expect(child.metadata?.content).toBeUndefined();
        expect(child.metadata?.storageKey).toBeUndefined();
        expect(child.metadata?.taskId).toBeUndefined();
        expect(child.metadata?.nodeRole).toBe("generator");
        expect(isCanvasImageSourceNode(child)).toBe(false);
        expect(canGenerateImageInPlace(child)).toBe(true);
        expect(canGenerateImageInPlace(source)).toBe(false);
    });
    test("The page and tool entrance share material judgment, and the character texture is connected to the original image.", () => {
        expect(read("pages/canvas/project.tsx")).toContain("canOpenCanvasNodePromptPanel");
        expect(read("lib/canvas/tool-registry/definitions/node-hover-tools.tsx")).toContain("canOpenCanvasNodePromptPanel(ctx.node)");
        const mediaTools = read("pages/canvas/use-canvas-image-tools.ts");
        const portrait = mediaTools.slice(mediaTools.indexOf("const openPortraitTextureEditor"), mediaTools.indexOf("const cropImageNode"));
        expect(portrait).toContain("fromNodeId: node.id, toNodeId: child.id");
        expect(portrait).toContain("setDialogNodeId(child.id)");
        expect(portrait).not.toContain("current.map");
        expect(mediaTools).toContain("payload.generationConfig");
        expect(mediaTools).toContain("imageBatchExpanded: requestedCount > 1 ? true : undefined");
        const dialog = read("components/canvas/canvas-node-mask-edit-dialog.tsx");
        expect(dialog).toContain("ModelPicker");
        expect(dialog).toContain("ImageSettingsPanel");
    });
});

test("The bottom menu uses the canvas floating layer to manage and respond to opening, mouse and keyboard interactions", () => {
    const toolbar = read("components/canvas/canvas-toolbar.tsx");
    expect(toolbar).toContain('useCanvasOverlayLayer("main-toolbar", "calc(var(--z-modal-overlay) + 10)")');
    expect(toolbar).toContain("if (addOpen || modeMenuOpen || appearanceOpen || shortcutsOpen) bringToFront()");
    expect(toolbar).toContain('role="menuitemradio"');
    expect(toolbar).toContain('shortcut: "V"');
    expect(toolbar).toContain('shortcut: "H"');
    expect(toolbar).toContain("onPointerDownCapture={bringToFront} onFocusCapture={bringToFront}");
});
