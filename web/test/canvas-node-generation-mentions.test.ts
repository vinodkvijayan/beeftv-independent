import { describe, expect, test } from "bun:test";

import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, type: CanvasNodeType, content: string): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content },
    };
}

function targetNode(): CanvasNodeData {
    return {
        id: "target",
        type: CanvasNodeType.Video,
        title: "target",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { composerContent: "Let @picture1 enter the picture" },
    };
}

function connection(fromNodeId: string): CanvasConnection {
    return { id: `connection-${fromNodeId}`, fromNodeId, toNodeId: "target" };
}

describe("canvas node generation position mentions", () => {
    test("When an existing image node explicitly references itself, it is submitted as a reference image for the generated image.", () => {
        const source = node("image-self", CanvasNodeType.Image, "data:image/png;base64,a");
        source.metadata.composerContent = "Make @Picture1 picture clearer";

        const context = buildNodeGenerationContext(source.id, [source], [], source.metadata.composerContent, []);

        expect(context.referenceImages.map((image) => image.id)).toEqual([source.id]);
        expect(context.imageCount).toBe(1);
        expect(context.prompt).toBe("Make @Picture1 picture clearer");
    });

    test("Existing image nodes will not automatically degenerate into graphs when they do not explicitly reference themselves.", () => {
        const source = node("image-self", CanvasNodeType.Image, "data:image/png;base64,a");
        const context = buildNodeGenerationContext(source.id, [source], [], "Generate a new composition", []);

        expect(context.referenceImages).toEqual([]);
        expect(context.imageCount).toBe(0);
        expect(context.prompt).toBe("Generate a new composition");
    });

    test("Unresolved canvas reference prevents silent degradation to Vincentian diagram", () => {
        const target = targetNode();
        expect(() => buildNodeGenerationContext(target.id, [target], [], "Make @Picture1 picture clearer", [])).toThrow("@Picture 1 There is no corresponding canvas resource");
    });

    test("The same @picture1 automatically points to the new first picture after changing lines.", () => {
        const target = targetNode();
        const imageA = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const imageB = node("image-b", CanvasNodeType.Image, "data:image/png;base64,b");

        const before = buildNodeGenerationContext(target.id, [imageA, target], [connection(imageA.id)], "Let @picture1 enter the picture", []);
        const after = buildNodeGenerationContext(target.id, [imageB, target], [connection(imageB.id)], "Let @picture1 enter the picture", []);

        expect(before.referenceImages.map((image) => image.id)).toEqual(["image-a"]);
        expect(after.referenceImages.map((image) => image.id)).toEqual(["image-b"]);
        expect(before.prompt).toBe("Let @picture1 enter the picture");
        expect(after.prompt).toBe("Let @picture1 enter the picture");
    });

    test("Select resources by type and location. The order in which the prompt words appear will not change the meaning of the slot.", () => {
        const target = targetNode();
        const imageA = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const audioA = node("audio-a", CanvasNodeType.Audio, "data:audio/mpeg;base64,a");
        const imageB = node("image-b", CanvasNodeType.Image, "data:image/png;base64,b");
        const connections = [connection(imageA.id), connection(audioA.id), connection(imageB.id)];
        const context = buildNodeGenerationContext(target.id, [imageA, audioA, imageB, target], connections, "Let @Picture2 match @Audio1", []);

        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-b"]);
        expect(context.referenceAudios.map((audio) => audio.id)).toEqual(["audio-a"]);
        expect(context.prompt).toBe("Let @picture1 match @audio1");
    });

    test("Markdown and quoted references select the same resource as plain mentions", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        for (const prompt of ["`@图片1`", '"@Picture1"', "'@Picture1'", "|@Picture 1|"]) {
            const context = buildNodeGenerationContext(target.id, [image, target], [connection(image.id)], prompt, []);
            expect(context.referenceImages.map((item) => item.id)).toEqual([image.id]);
            expect(context.prompt).toBe(prompt);
        }
        expect(() => buildNodeGenerationContext(target.id, [target], [], "`@图片1`", [])).toThrow("@Picture 1 There is no corresponding canvas resource");
    });

    test("The old node token only performs read migration and no longer generates prompt words.", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const context = buildNodeGenerationContext(target.id, [image, target], [connection(image.id)], "Let @[node:image-a] enter the picture", []);

        expect(context.referenceImages.map((item) => item.id)).toEqual(["image-a"]);
        expect(context.prompt).toBe("Let @picture1 enter the picture");
        expect(context.prompt).not.toContain("@[node:");
    });

    test("The prompt words after dereferencing will no longer be blocked due to hanging @Picture 1", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const { applyCanvasConnectionPromptSync } = require("../src/lib/canvas/canvas-resource-references") as typeof import("../src/lib/canvas/canvas-resource-references");
        const [nextTarget] = applyCanvasConnectionPromptSync([image, target], [connection(image.id)], [image, target], []).filter((item: typeof target) => item.id === target.id);
        const context = buildNodeGenerationContext(nextTarget.id, [image, nextTarget], [], nextTarget.metadata?.composerContent || "", []);

        expect(nextTarget.metadata?.composerContent).toBe("Let enter the picture");
        expect(context.referenceImages).toEqual([]);
        expect(context.prompt).toBe("Let enter the picture");
    });
});

describe("canvas node generation video text references", () => {
    test("rejects a conflicting IMAGE table before video generation", () => {
        const target = targetNode();
        const first = node("first", CanvasNodeType.Image, "data:image/png;base64,a");
        const second = node("second", CanvasNodeType.Image, "data:image/png;base64,b");
        const nodes = [first, second, target];
        const connections = [connection(first.id), connection(second.id)];
        const prompt = "@Picture 2 is B, @Picture 1 is A.\n| IMAGE 1 | `@second` | B |";
        expect(() => buildNodeGenerationContext(target.id, nodes, connections, prompt, [], true)).toThrow("IMAGE 1 corresponds to picture 2");
        const corrected = prompt.replace("IMAGE 1", "IMAGE 2");
        const context = buildNodeGenerationContext(target.id, nodes, connections, corrected, [], true);
        expect(context.prompt).toBe(corrected);
        expect(context.referenceImages.map((image) => image.id)).toEqual([first.id, second.id]);
    });

    test("checks the final selected image numbering and leaves text tasks alone", () => {
        const first = node("first", CanvasNodeType.Image, "data:image/png;base64,a");
        const second = node("second", CanvasNodeType.Image, "data:image/png;base64,b");
        const target = targetNode();
        const nodes = [first, second, target];
        const connections = [connection(first.id), connection(second.id)];
        const context = buildNodeGenerationContext(target.id, nodes, connections, "| IMAGE 1 | `@图片2` |", [], false);
        expect(context.prompt).toBe("| IMAGE 1 | `@图片1` |");
        expect(context.referenceImages.map((image) => image.id)).toEqual([second.id]);
        target.type = CanvasNodeType.Text;
        expect(() => buildNodeGenerationContext(target.id, nodes, connections, "| IMAGE 1 | `@图片2` |", [], true)).not.toThrow();
    });

    test("checks drawing and image labels against their shared upload order", () => {
        const target = targetNode();
        const drawing = node("sketch", CanvasNodeType.Drawing, "");
        drawing.metadata.drawingId = "drawing-id";
        const photo = node("photo", CanvasNodeType.Image, "data:image/png;base64,a");
        const nodes = [drawing, photo, target];
        const connections = [connection(drawing.id), connection(photo.id)];
        expect(() => buildNodeGenerationContext(target.id, nodes, connections, "| IMAGE 1 | @image1 |", [], true)).toThrow("IMAGE 1 corresponds to picture 2");
        const prompt = "| IMAGE 1 | @drawing1 |\n| IMAGE 2 | @image1 |";
        const context = buildNodeGenerationContext(target.id, nodes, connections, prompt, [], true);
        expect(context.prompt).toBe(prompt);
        expect(context.referenceImages.map((image) => image.id)).toEqual([drawing.id, photo.id]);
    });

    test("Explicit @text references under video promptOnly still have the real content inline, and images remain structured references.", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const note = node("note", CanvasNodeType.Text, "Character setting: He He\nLight and shadow atmosphere: dark tone");
        const context = buildNodeGenerationContext(target.id, [image, note, target], [connection(image.id), connection(note.id)], "Reference picture: @Picture 1\nTask requirements: @text1", [], true);

        expect(context.prompt).toBe("Reference picture: @Picture 1\nTask requirements: [Text 1]\n\n【Text 1】\nCharacter setting: He He\nLight and shadow atmosphere: dark tone");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["image-a"]);
        expect(context.textCount).toBe(1);
        expect(context.imageCount).toBe(1);
    });

    test("Linked text that is not explicitly referenced under video promptOnly will not be automatically spelled into the prompt word.", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const note = node("note", CanvasNodeType.Text, "Character setting: He He");
        const context = buildNodeGenerationContext(target.id, [image, note, target], [connection(image.id), connection(note.id)], "Generate a dark dance video", [], true);

        expect(context.prompt).toBe("Generate a dark dance video");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["image-a"]);
        expect(context.textCount).toBe(0);
    });

    test("Video promptOnly non-explicit reference path still discards the upstream text, and resumes automatic splicing after closing", () => {
        const target = targetNode();
        const note = node("note", CanvasNodeType.Text, "Character setting: He He");
        const nodes = [note, target];
        const connections = [connection(note.id)];

        expect(buildNodeGenerationContext(target.id, nodes, connections, "dance", [], true).prompt).toBe("dance");
        expect(buildNodeGenerationContext(target.id, nodes, connections, "dance", [], false).prompt).toBe("dance\n\nCharacter setting: He He");
    });
});
