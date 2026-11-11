import { describe, expect, test } from "bun:test";

import { buildImageToolbarTools } from "@/components/canvas/canvas-image-toolbar-tools";
import { resolveNodeToolbarPlacement, resolveToolbarTools, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function createNodeContext(node: CanvasNodeData): ToolContext {
    return {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool: "move",
        workspaceMode: "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        node,
        nodeMetadata: node.metadata,
        extractingVideoFrames: false,
        extractingAudio: false,
        trimmingVideo: false,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: {} as ToolbarHandlers,
    };
}

describe("canvas node toolbar model", () => {
    test("hover history action depends on the displayed failure category", () => {
        const node: CanvasNodeData = { id: "history", type: CanvasNodeType.Image, title: "pictures", position: { x: 0, y: 0 }, metadata: {
            status: "error", errorDetails: "opaque", taskOutcome: { phase: "failed", regenerate: "allowed", reason: "result_target_unavailable" },
        } };
        const ctx = createNodeContext(node);
        const retry = resolveToolbarTools("node-hover", ctx, null).find((tool) => tool.id === "retry");
        const label = retry?.label;
        expect(typeof label === "function" ? label(ctx) : label).toBe("Regenerate");
        node.metadata = { ...node.metadata, generationErrorCode: "result_target_unavailable" };
        ctx.nodeMetadata = node.metadata;
        const saved = resolveToolbarTools("node-hover", ctx, null).find((tool) => tool.id === "retry");
        const savedLabel = saved?.label;
        expect(typeof savedLabel === "function" ? savedLabel(ctx) : savedLabel).toBe("Retrieve original results from build history");
    });

    test("opens the same subtitles action for uploaded audio and video", () => {
        for (const type of [CanvasNodeType.Audio, CanvasNodeType.Video]) {
            const node: CanvasNodeData = { id: "media", type, title: "Material", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { storageKey: "resource:media-fixture" } };
            const ctx = createNodeContext(node);
            const received: CanvasNodeData[] = [];
            ctx.handlers = { onNodeSubtitles: target => received.push(target) } as ToolbarHandlers;
            const action = resolveToolbarTools("node-hover", ctx, null).find(tool => tool.id === "subtitles");
            expect(action).toBeDefined();
            action?.run(ctx);
            expect(received).toEqual([node]);
        }
    });
    test("preserves empty, simple and busy video states", () => {
        const ctx = createNodeContext({ id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: {} });
        const emptyTools = resolveToolbarTools("node-hover", ctx, null);
        expect(emptyTools.some((tool) => tool.id === "extractAudio")).toBe(false);
        expect(emptyTools.some((tool) => tool.id === "uploadVideo")).toBe(false);
        ctx.nodeMetadata = { content: "video.mp4" };
        const uploadedTools = resolveToolbarTools("node-hover", ctx, null);
        expect(resolveNodeToolbarPlacement(uploadedTools.find((tool) => tool.id === "uploadVideo")!, ctx).group).toBe("more");
        ctx.extractingAudio = true;
        const audio = resolveToolbarTools("node-hover", ctx, null).find((tool) => tool.id === "extractAudio")!;
        expect(audio.disabled?.(ctx)).toBe(true);
        ctx.workspaceMode = "simple";
        expect(resolveToolbarTools("node-hover", ctx, null).some((tool) => tool.id === "extractAudio")).toBe(false);
    });

    test("image menu actions remain lazy and keep the original node", () => {
        const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "pictures", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png", freeResize: true } };
        const received: CanvasNodeData[] = [];
        const tools = buildImageToolbarTools(node, { onCrop: (target: CanvasNodeData) => received.push(target) } as never);
        expect(received).toEqual([]);
        tools.find((tool) => tool.id === "crop")!.onClick();
        expect(received).toEqual([node]);
        expect(tools.find((tool) => tool.id === "resize")?.active).toBe(false);
    });

    test("keeps video primary actions compact and moves secondary processing into a menu", () => {
        const ctx = createNodeContext({ id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "video.mp4" } });
        const tools = resolveToolbarTools("node-hover", ctx, null);
        const groups = new Map(tools.map((tool) => [tool.id, resolveNodeToolbarPlacement(tool, ctx).group]));

        expect([...groups].filter(([, group]) => group === "primary").map(([id]) => id)).toEqual(["trimRegenerate", "subtitles"]);
        expect([...groups].filter(([, group]) => group === "process").map(([id]) => id)).toEqual(["extractFrames", "extractAudio"]);
        expect(groups.get("download")).toBe("utility");
        expect(groups.get("timeline")).toBe("workspace");
        expect(groups.get("uploadVideo")).toBe("more");
        expect(groups.get("delete")).toBe("more");
        expect(groups.get("node-lock")).toBe("more");
    });

    test("offers depth capture as a video processing action and dispatches the source node", () => {
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "video.mp4" } };
        const received: CanvasNodeData[] = [];
        const ctx = createNodeContext(node);
        ctx.handlers = { onNodeDepthCapture: (target) => received.push(target) } as ToolbarHandlers;

        const tool = resolveToolbarTools("node-hover", ctx, null).find((item) => item.id === "depthCapture");

        expect(tool).toBeDefined();
        expect(tool?.displayLabel).toBe("Deep motion capture");
        expect(resolveNodeToolbarPlacement(tool!, ctx).group).toBe("more");
        expect(tool?.nodeToolbar?.section).toBe("video processing");
        tool?.run(ctx);
        expect(received).toEqual([node]);
    });

    test("uses the redesigned video terminology from the registry", () => {
        const ctx = createNodeContext({ id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "video.mp4" } });
        const tools = new Map(resolveToolbarTools("node-hover", ctx, null).map((tool) => [tool.id, tool]));
        const displayLabel = (id: string) => {
            const value = tools.get(id)?.displayLabel;
            return typeof value === "function" ? value(ctx) : value;
        };

        expect(displayLabel("subtitles")).toBe("subtitles");
        expect(displayLabel("timeline")).toBe("Go to clip");
        expect(displayLabel("extractFrames")).toBe("Key frame interception");
        expect(displayLabel("extractAudio")).toBe("Audio and video separation");
    });

    test.each([CanvasNodeType.Audio, CanvasNodeType.Video])("opens the project timeline from a %s node", (type) => {
        const node: CanvasNodeData = { id: "media", type, title: "Material", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { storageKey: "resource:media-fixture" } };
        const ctx = createNodeContext(node);
        const received: CanvasNodeData[] = [];
        ctx.handlers = { onNodeTimeline: (target) => received.push(target) } as ToolbarHandlers;
        const timeline = resolveToolbarTools("node-hover", ctx, null).find((tool) => tool.id === "timeline");
        expect(timeline?.displayLabel).toBe("Go to clip");
        expect(resolveNodeToolbarPlacement(timeline!, ctx).group).toBe("workspace");
        timeline?.run(ctx);
        expect(received).toEqual([node]);
    });

    test("image-only tools carry presentation metadata instead of relying on component ID lists", () => {
        const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "pictures", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png" } };
        const tools = buildImageToolbarTools(node, {} as never);

        expect(tools.find((tool) => tool.id === "angle")?.group).toBe("viewpoint");
        expect(tools.find((tool) => tool.id === "maskEdit")?.group).toBe("primary");
        expect(tools.some((tool) => tool.id === "superResolve")).toBe(false);
        expect(tools.find((tool) => tool.id === "emotion")?.group).toBe("portrait");
        expect(tools.find((tool) => tool.id === "upscale")?.description).toContain("Not an AI super score");
        expect(tools.find((tool) => tool.id === "crop")?.section).toBe("Composition and size");
        expect(tools.find((tool) => tool.id === "resize")?.active).toBe(true);
        expect(tools.find((tool) => tool.id === "copyPrompt")?.group).toBe("more");
    });
});
