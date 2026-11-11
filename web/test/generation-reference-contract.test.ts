import { describe, expect, test } from "bun:test";
import { buildNodeGenerationContext, compileNodeGenerationReferences } from "../src/components/canvas/canvas-node-generation";
import { canvasResourceMentionToken, applyCanvasConnectionPromptSync } from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { AiConfig } from "../src/stores/use-config-store";
import { compileBoundMediaReferences } from "../src/lib/canvas/generation-reference-contract";
import type { Asset } from "../src/stores/use-asset-store";

const config = { model: "ark::seedance-2.0", channels: [{ id: "ark", models: ["seedance-2.0"], modelProfiles: [{ model: "seedance-2.0", protocol: "volcengine-ark-video" }] }] } as AiConfig;
const image = (id: string): CanvasNodeData => ({ id, title: "Same name", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "https://example.test/" + id + ".png" } });
const target: CanvasNodeData = { ...image("target"), type: CanvasNodeType.Video, metadata: { composerContent: "test" } };
const nodes = [image("A"), image("B"), target];
const edges = (ids: string[]) => ids.map((id) => ({ id: "edge-" + id, fromNodeId: id, toNodeId: "target" }));
const build = (prompt: string, ids = ["A", "B"]) => buildNodeGenerationContext("target", nodes, edges(ids), prompt, [], true, { preserveMediaBindings: true });
const compile = (prompt: string, ids?: string[]) => compileNodeGenerationReferences(build(prompt, ids), config, "reference_to_video");

describe("bound canvas reference submission", () => {
    test("final IMAGE tables reject conflicting node bindings, including quoted cells", () => {
        for (const quote of ["", "`", '"', "'"]) {
            const prompt = `@[node:B] is on the right.
| IMAGE 1 |${quote}@[node:A]${quote} |\n| IMAGE 2 | @[node:B] |`;
            const raw = build(prompt);
            expect(() => compileNodeGenerationReferences(raw, config, "reference_to_video")).toThrow("IMAGE 1 corresponds to picture 2");
            expect(raw.prompt).toBe(prompt);
            expect(raw.referenceImages.map((item) => item.id)).toEqual(["A", "B"]);
        }
    });

    test("final IMAGE tables accept bindings matching the final order without rewriting saved text", () => {
        const prompt = "@[node:B] is on the right.\n| IMAGE 1 | @[node:B] |\n| IMAGE 2 | @[node:A] |";
        const raw = build(prompt);
        const output = compileNodeGenerationReferences(raw, config, "reference_to_video");
        expect(output.referenceImages.map((item) => item.id)).toEqual(["B", "A"]);
        expect(output.prompt).toBe("@Picture 1 on the right.\n| IMAGE 1 | @image1 |\n| IMAGE 2 | @image2 |");
        expect(raw.prompt).toBe(prompt);
    });

    test("final IMAGE tables resolve unique display names after ordering, not connection positions", () => {
        const graph = [{ ...nodes[0]!, title: "A" }, { ...nodes[1]!, title: "B" }, target];
        const prepare = (name: string) => buildNodeGenerationContext("target", graph, edges(["A", "B"]), `@[node:B] is on the right.
| IMAGE 1 | @${name} |`, [], true, { preserveMediaBindings: true });
        const correct = prepare("B");
        expect(compileNodeGenerationReferences(correct, config, "reference_to_video").referenceImages.map((item) => item.id)).toEqual(["B", "A"]);
        expect(() => compileNodeGenerationReferences(prepare("A"), config, "reference_to_video")).toThrow("IMAGE 1 corresponds to picture 2");
    });

    test("final IMAGE tables validate library asset identity", () => {
        const asset = { id: "library-face", kind: "image", title: "Material face", data: { mimeType: "image/png", dataUrl: "https://example.test/face.png" } } as Asset;
        const prepare = (slot: number) => buildNodeGenerationContext("target", nodes, edges(["B"]), `@[node:B] is on the right.
| IMAGE${slot} | @[asset:library-face] |`, [asset], true, { preserveMediaBindings: true });
        expect(() => compileNodeGenerationReferences(prepare(1), config, "reference_to_video")).toThrow("IMAGE 1 corresponds to picture 2");
        expect(compileNodeGenerationReferences(prepare(2), config, "reference_to_video").prompt).toContain("| IMAGE 2 | @image2 |");
    });

    test("final IMAGE checks include tables added after input assembly", () => {
        const raw = build("@[node:B] is on the right, @[node:A] is on the left");
        const prepared = { ...raw, prompt: `${raw.prompt}\n| IMAGE 1 | @[node:A] |` };
        expect(() => compileNodeGenerationReferences(prepared, config, "reference_to_video")).toThrow("IMAGE 1 corresponds to picture 2");
    });

    test("final IMAGE tables retain legacy drawing and photo slot meanings", () => {
        const drawing = { ...image("sketch"), type: CanvasNodeType.Drawing, metadata: { drawingId: "drawing-id" } };
        const prompt = "| IMAGE 1 | @drawing1 |\n| IMAGE 2 | @image1 |";
        const raw = buildNodeGenerationContext("target", [drawing, image("A"), target], edges(["sketch", "A"]), prompt, [], true, { preserveMediaBindings: true });
        const output = compileNodeGenerationReferences(raw, config, "reference_to_video");
        expect(output.referenceImages.map((item) => item.id)).toEqual(["sketch", "A"]);
        expect(output.prompt).toBe(prompt);
    });

    test("Seedance newapi-channel-2 orders bound references across connection permutations", () => {
        const channelConfig = { model: "custom::seedance-2.0", channels: [{ id: "custom", models: ["seedance-2.0"], modelProfiles: [{ model: "seedance-2.0", protocol: "newapi-channel-2" }] }] } as AiConfig;
        for (const ids of [["A", "B"], ["B", "A"]]) {
            const raw = build("@[node:B] is on the right, @[node:A] is on the left", ids);
            const output = compileNodeGenerationReferences(raw, channelConfig, "reference_to_video");
            expect(output.referenceImages.map((item) => item.id)).toEqual(["B", "A"]);
            expect(output.prompt).toBe("@Picture1 is on the right, @Picture2 is on the left");
        }
        const raw = build("@[node:B] is on the right, @[node:A] is on the left");
        expect(compileNodeGenerationReferences(raw, channelConfig as AiConfig, "image_to_video").referenceImages.map((item) => item.id)).toEqual(["A", "B"]);
    });

    test("the selected file and final prompt stay identical across connection permutations", () => {
        const prompt = "@[node:B] is on the right, @[node:A] is on the left. @[node:B] speaks first.";
        for (const ids of [["A", "B"], ["B", "A"]]) {
            const raw = build(prompt, ids);
            expect(raw.prompt).toBe(prompt);
            const output = compileNodeGenerationReferences(raw, config, "reference_to_video");
            expect(output.referenceImages.map((item) => item.id)).toEqual(["B", "A"]);
            expect(output.prompt).toBe("@Picture1 is on the right, @Picture2 is on the left. @Picture 1 Speak first.");
            expect(raw.prompt).toBe(prompt);
            expect(raw.referenceImages.map((item) => item.id)).toEqual(ids);
        }
    });

    test("new editor selections store node identity instead of the current shelf label", () => {
        const reference = { id: "A", nodeId: "A", kind: "image" as const, label: "Picture 2", title: "Same name", active: true };
        expect(canvasResourceMentionToken(reference)).toBe("@[node:A]");
        const node = { ...target, metadata: { composerContent: "@[node:A] is on the left, @[node:B] is on the right" } };
        const graph = [nodes[0]!, nodes[1]!, node];
        const synced = applyCanvasConnectionPromptSync(graph, edges(["A", "B"]), graph, edges(["B", "A"]));
        expect(synced.find((item) => item.id === "target")?.metadata?.composerContent).toBe(node.metadata.composerContent);
        const restored = JSON.parse(JSON.stringify(synced)) as CanvasNodeData[];
        expect(restored.find((item) => item.id === "target")?.metadata?.composerContent).toBe(node.metadata.composerContent);
    });

    test("legacy ordinal prose and IMAGE tables keep their original slot contract", () => {
        for (const suffix of ["The person in the first reference picture is always on the left.", "The first image stays on the left.", "| IMAGE 1 | @image1 |"] ) {
            const prompt = "@Picture2 is on the right, @Picture1 is on the left." + suffix;
            const output = compile(prompt);
            expect(output.referenceImages.map((item) => item.id)).toEqual(["A", "B"]);
            expect(output.prompt).toBe(prompt);
        }
        const mixed = compile("@[node:B] is on the right, @Picture1 is on the left.");
        expect(mixed.referenceImages.map((item) => item.id)).toEqual(["A", "B"]);
        expect(mixed.prompt).toBe("@Picture2 is on the right, @Picture1 is on the left.");
    });

    test("missing selected references fail before a provider request", () => {
        expect(() => compile("@[node:deleted] on the left")).toThrow("There is no corresponding canvas resource");
        const context = build("@[node:B] on the right");
        context.referenceImages = [];
        expect(() => compileNodeGenerationReferences(context, config, "reference_to_video")).toThrow("No longer available");
        context.prompt = "@[node:injected] on the right";
        expect(() => compileNodeGenerationReferences(context, config, "reference_to_video")).toThrow("There is no corresponding material");
    });

    test("first/last frames and other models preserve their ordering", () => {
        const raw = build("@[node:B] is on the right, @[node:A] is on the left");
        for (const [current, operation] of [
            [config, "image_to_video"],
            [{ ...config, model: "h3" }, "reference_to_video"],
        ] as const) {
            const output = compileNodeGenerationReferences(raw, current as AiConfig, operation);
            expect(output.referenceImages.map((item) => item.id)).toEqual(["A", "B"]);
            expect(output.prompt).toBe("@Picture2 is on the right, @Picture1 is on the left");
        }
    });

    test("character bindings use final media IDs after ordering", () => {
        const raw = build("@[node:B] is on the right, @[node:A] is on the left");
        raw.characterReferenceBindings = [{ role: 1, name: "A", imageIds: ["A"], audioIds: [] }];
        const output = compileNodeGenerationReferences(raw, config, "reference_to_video");
        expect(output.prompt).toContain("@Character 1 and \"A\" refer to the same character. Reference for the appearance of this character @Picture 2");
    });

    test("mixed image/drawing, video and audio references share their final per-kind numbering", () => {
        const baseImage = { name: "test.png", type: "image/png", dataUrl: "" };
        const output = compileBoundMediaReferences({
            prompt: "@[node:drawing] environment, @[asset:face] character, @[node:v2] action, @[node:v1] camera position, @[node:a2] sound, @[node:a1] environment sound",
            referenceImages: [{ ...baseImage, id: "face" }, { ...baseImage, id: "drawing" }],
            referenceVideos: [{ id: "v1", name: "1", type: "video/mp4", url: "" }, { id: "v2", name: "2", type: "video/mp4", url: "" }],
            referenceAudios: [{ id: "a1", name: "1", type: "audio/wav", url: "" }, { id: "a2", name: "2", type: "audio/wav", url: "" }],
            boundMediaMentions: [
                { token: "@[node:drawing]", kind: "image" as const, referenceId: "drawing" },
                { token: "@[asset:face]", kind: "image" as const, referenceId: "face" },
                ...["v1", "v2"].map((id) => ({ token: `@[node:${id}]`, kind: "video" as const, referenceId: id })),
                ...["a1", "a2"].map((id) => ({ token: `@[node:${id}]`, kind: "audio" as const, referenceId: id })),
            ],
        }, true);
        expect(output.referenceImages.map((item) => item.id)).toEqual(["drawing", "face"]);
        expect(output.referenceVideos.map((item) => item.id)).toEqual(["v2", "v1"]);
        expect(output.referenceAudios.map((item) => item.id)).toEqual(["a2", "a1"]);
        expect(output.prompt).toBe("@Picture1 environment, @Picture2 characters, @Video1 action, @Video2 camera position, @Audio1 sound, @Audio2 environmental sound");
    });

    test("explicit text input retains bindings nested inside its content", () => {
        const note = { ...image("note"), type: CanvasNodeType.Text, metadata: { content: "@[node:B] is on the right, @[node:A] is on the left" } };
        const graph = [...nodes, note];
        const raw = buildNodeGenerationContext("target", graph, [...edges(["A", "B"]), { id: "note-edge", fromNodeId: "note", toNodeId: "target" }], "@[node:note]", [], true, { preserveMediaBindings: true });
        const output = compileNodeGenerationReferences(raw, config, "reference_to_video");
        expect(output.referenceImages.map((item) => item.id)).toEqual(["B", "A"]);
        expect(output.prompt).toContain("@Picture1 is on the right, @Picture2 is on the left");
    });
});
