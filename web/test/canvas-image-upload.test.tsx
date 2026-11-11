import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createImageUploadPlaceholder, createFileUploadPlaceholder, interruptFileUpload, readUploadImageSize, uploadNodeType, uploadPercent, uploadVeilOpacity } from "../src/lib/canvas/canvas-file-upload";
import { CanvasNodeType } from "../src/types/canvas";
import { isCanvasImageSourceNode } from "../src/lib/canvas/canvas-image-source";
import { CanvasFileUploadContent } from "../src/components/canvas/canvas-file-upload-content";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { canvasThemes } from "../src/lib/canvas-theme";

const file = { name: "photo.png", size: 1234, type: "image/png" };
const placeholder = () => createImageUploadPlaceholder("upload", file, { x: 100, y: 200 }, { width: 1920, height: 1080 });
const read = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");

describe("Image upload placeholder", () => {
    for (const [width, height] of [[1920, 1080], [900, 1600], [800, 800], [4000, 500]]) {
        test(`Maintain proportions to true size and center around drop point${width}x${height}`, () => {
            const node = createImageUploadPlaceholder("upload", file, { x: 100, y: 200 }, { width, height });
            expect(node.width / node.height).toBeCloseTo(width / height);
            expect(node.position.x + node.width / 2).toBe(100);
            expect(node.position.y + node.height / 2).toBe(200);
            expect(node.metadata?.naturalWidth).toBe(width);
            expect(node.metadata?.naturalHeight).toBe(height);
            expect(node.metadata?.fileUpload).toBe("uploading");
            expect(node.metadata?.content).toBeUndefined();
            expect(node.metadata?.status).toBeUndefined();
            expect(isCanvasImageSourceNode(node)).toBe(true);
        });
    }

    test("Reopening the canvas will convert interrupted uploads into retryable errors without modifying other nodes.", () => {
        const node = placeholder();
        const interrupted = interruptFileUpload(node);
        expect(interrupted.metadata?.fileUpload).toBe("error");
        expect(interrupted.metadata?.errorDetails).toContain("interrupt");
        expect(interrupted.position).toEqual(node.position);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(interruptFileUpload(interrupted)).toBe(interrupted);
        const ready = { ...node, metadata: { content: "image" } };
        expect(interruptFileUpload(ready)).toBe(ready);
    });

    test("The temporary URL is released when the image is decoded successfully or failed, and the size is not forged.", async () => {
        const originalImage = globalThis.Image;
        const create = URL.createObjectURL;
        const revoke = URL.revokeObjectURL;
        const revoked: string[] = [];
        let fail = false;
        try {
            URL.createObjectURL = () => "blob:upload-test";
            URL.revokeObjectURL = (url) => { revoked.push(url); };
            globalThis.Image = class {
                src = "";
                naturalWidth = 1200;
                naturalHeight = 800;
                async decode() { if (fail) throw new Error("decode failed"); }
            } as unknown as typeof Image;
            const input = new File(["test"], "test.png", { type: "image/png" });
            expect(await readUploadImageSize(input)).toEqual({ width: 1200, height: 800 });
            fail = true;
            await expect(readUploadImageSize(input)).rejects.toThrow("decode failed");
            expect(revoked).toEqual(["blob:upload-test", "blob:upload-test"]);
        } finally {
            globalThis.Image = originalImage;
            URL.createObjectURL = create;
            URL.revokeObjectURL = revoke;
        }
    });

    for (const mode of ["light", "dark"] as const) {
        test(`${mode}Theme includes accessible upload status, fade animations, and failure retries`, () => {
            const html = renderToStaticMarkup(<CanvasFileUploadContent node={placeholder()} theme={canvasThemes[mode]} reduceMotion />);
            expect(html).toContain("Uploading pictures");
            expect(html).toContain('aria-busy="true"');
            expect(html).toContain('data-static="true"');
            expect(html).toContain(canvasThemes[mode].node.fill);
            const error = renderToStaticMarkup(<CanvasNodeActionContext.Provider value={{ upload: () => {} }}><CanvasFileUploadContent node={interruptFileUpload(placeholder())} theme={canvasThemes[mode]} /></CanvasNodeActionContext.Provider>);
            expect(error).toContain("Reselect file");
            expect(error).toContain('aria-busy="false"');
            expect(error).toContain('data-static="true"');
        });
    }

    test("Uploading first occupies the space before transmitting, and the same node is replaced after completion. The pop-up window does not wait for the transmission to complete.", () => {
        const hook = read("pages/canvas/use-canvas-upload.ts");
        const create = hook.slice(hook.indexOf("const createFileNode"), hook.indexOf("const createImageAssetNode"));
        expect(create.indexOf("createFileUploadPlaceholder")).toBeLessThan(create.indexOf("await uploadImage(file,"));
        expect(create).toContain("if (!currentNode)");
        expect(create).toContain("fileUpload: undefined");
        const replace = hook.slice(hook.indexOf('const replaceNodeMedia'), hook.indexOf("const pasteSystemClipboard"));
        expect(replace).toContain("await createFileNode(file, currentNode.position, nodeId)");
        expect(create).toContain("original?.metadata?.content");
        expect(read("components/canvas/canvas-upload-modal.tsx")).toContain("onClose();\n            await pendingUpload;");
        expect(read("styles/globals.css")).toContain("prefers-reduced-motion: reduce");
    });
});

test("The real progress is inversely related to the mask concentration, and unknown progress is not generated.", () => {
    expect(uploadPercent(20, 100)).toBe(20);
    expect(uploadPercent(150, 100)).toBe(100);
    expect(uploadPercent(0, 0)).toBeUndefined();
    expect(uploadPercent(NaN, 100)).toBeUndefined();
    expect(uploadVeilOpacity(0)).toBe(1);
    expect(uploadVeilOpacity(50)).toBeCloseTo(0.55);
    expect(uploadVeilOpacity(100)).toBeCloseTo(0.1);
});

test("Unified recognition of images, videos, audios, and plain text files without accidentally receiving PDF or Word files", () => {
    for (const [name, type, expected] of [
        ["image.png", "image/png", CanvasNodeType.Image], ["video.mp4", "video/mp4", CanvasNodeType.Video],
        ["sound.ogg", "audio/ogg", CanvasNodeType.Audio], ["sound.wav", "", CanvasNodeType.Audio],
        ["note.md", "", CanvasNodeType.Text], ["note.txt", "text/plain", CanvasNodeType.Text],
        ["document.pdf", "application/pdf", null], ["document.docx", "", null],
    ] as const) expect(uploadNodeType({ name, type })).toBe(expected);
});

test("Audio and text have independent places before transmission, can be retried and do not have model generation status.", async () => {
    for (const [name, type, expected] of [["voice.mp3", "audio/mpeg", CanvasNodeType.Audio], ["note.md", "text/markdown", CanvasNodeType.Text]] as const) {
        const node = await createFileUploadPlaceholder("file", new File(["content"], name, { type }), { x: 0, y: 0 });
        expect(node.type).toBe(expected);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(node.metadata?.content).toBeUndefined();
        expect(node.metadata?.status).toBeUndefined();
        expect(interruptFileUpload(node).metadata?.fileUpload).toBe("error");
    }
});

test("H.265 videos do not require browser decoding to create upload nodes, and empty MIME MOVs can also be imported.", async () => {
    for (const [name, type] of [["hevc.mp4", "video/mp4"], ["hevc.mov", ""], ["hevc.mkv", "application/octet-stream"]]) {
        const node = await createFileUploadPlaceholder("hevc", new File(["undecodable video"], name, { type }), { x: 100, y: 200 });
        expect(node.type).toBe(CanvasNodeType.Video);
        expect(node.title).toBe(name);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(node.position.x + node.width / 2).toBe(100);
        expect(node.metadata?.naturalWidth).toBeUndefined();
    }
});

test("All resources are rendered at a true percentage, 100% is still waiting to be saved, the matte color fades but the copy does not fade out.", () => {
    for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text]) {
        const node = { ...placeholder(), type, metadata: { fileUpload: "uploading" as const, fileUploadProgress: 50 } };
        const html = renderToStaticMarkup(<CanvasFileUploadContent node={node} theme={canvasThemes.light} />);
        expect(html).toContain("50% uploaded");
        expect(html).toContain('opacity:0.55');
        expect(html).toContain('aria-valuenow="50"');
        const complete = renderToStaticMarkup(<CanvasFileUploadContent node={{ ...node, metadata: { ...node.metadata, fileUploadProgress: 100 } }} theme={canvasThemes.dark} />);
        expect(complete).toContain("The file has been transferred and is being saved and processed");
        expect(complete).toContain('aria-busy="true"');
    }
});
