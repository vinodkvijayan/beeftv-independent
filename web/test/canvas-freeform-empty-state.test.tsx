import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasFreeformEmptyState } from "@/components/canvas/canvas-short-drama-entry";
import type { CanvasCreateCommand } from "@/components/canvas/canvas-create-menu";
import { CanvasNodeContent } from "@/components/canvas/canvas-node-content";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";
import { createRef } from "react";

const commands: CanvasCreateCommand[] = [
    { id: "script", label: "script", icon: null, section: "node", onClick: () => {} },
    { id: "image", label: "pictures", icon: null, section: "node", onClick: () => {} },
    { id: "video", label: "video", icon: null, section: "node", onClick: () => {} },
    { id: "audio", label: "Audio", icon: null, section: "node", onClick: () => {} },
];

describe("BeefTV freeform canvas empty state", () => {
    test("exposes the double-click hint without obsolete quick starts", () => {
        const markup = renderToStaticMarkup(<CanvasFreeformEmptyState commands={commands} />);
        expect(markup).toContain("Double click on the canvas");
        expect(markup).toContain("Freely generated nodes");
        expect(markup).toContain("Click to show/hide the connections on the canvas");
        expect(markup).toContain('aria-label="Close connection prompt"');
        for (const label of ["Story script generation", "Three views of the character", "All-around reference student video", "Audio produces video"]) expect(markup).not.toContain(label);
        expect(markup).toContain('aria-label="Add first item"');
        // 空状态只是视觉引导，不能把中心空白区域标成 no-zoom，否则会吞掉
        // InfiniteCanvas 用来打开 LibTV 添加节点面板的双击事件。
        expect(markup).not.toContain("data-canvas-no-zoom");
    });

    test("does not reintroduce quick starts when an optional command is unavailable", () => {
        const markup = renderToStaticMarkup(<CanvasFreeformEmptyState commands={commands.filter((command) => command.id !== "audio")} />);
        expect(markup).not.toContain("Story script generation");
        expect(markup).not.toContain("Audio produces video");
    });

    test("renders the minimal empty text node state", () => {
        const node: CanvasNodeData = { id: "text-1", type: CanvasNodeType.Text, title: "text node 1", position: { x: 0, y: 0 }, width: 350, height: 350, metadata: { content: "", status: "idle" } };
        const markup = renderToStaticMarkup(<CanvasNodeContent node={node} theme={canvasThemes.dark} isEditingContent={false} textareaRef={createRef<HTMLTextAreaElement>()} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} onContentChange={() => {}} onStopEditing={() => {}} mentionReferences={[]} />);
        for (const label of ["Write your own content", "Vincent Video", "Picture reverse prompt words", "Words give birth to music"]) expect(markup).not.toContain(label);
        for (const label of ["GVLM 3.1", "GVLM3.1", "6 points", "6 points"]) expect(markup).not.toContain(label);
        expect(markup).toContain("canvas-node-empty-text-mark");
        expect(markup).toContain("canvas-node-text-footer");
        expect(markup).toContain("pointer-events-none");
        expect(markup).toContain("aria-hidden");
    });

    test("does not invent a model or price when empty text metadata names one", () => {
        const node: CanvasNodeData = { id: "text-2", type: CanvasNodeType.Text, title: "text node 2", position: { x: 0, y: 0 }, width: 350, height: 350, metadata: { content: "", status: "idle", model: "GVLM 3.1" } };
        const markup = renderToStaticMarkup(<CanvasNodeContent node={node} theme={canvasThemes.dark} isEditingContent={false} textareaRef={createRef<HTMLTextAreaElement>()} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} onContentChange={() => {}} onStopEditing={() => {}} mentionReferences={[]} />);
        expect(markup).not.toContain("GVLM 3.1");
        expect(markup).not.toContain("6 points");
    });

    test("keeps the primary add-node order aligned with the LibTV palette", () => {
        const noop = () => {};
        const context: AddNodeMenuContext = {
            workspaceMode: "professional",
            isProjectLinked: false,
            handlers: {
                onAddText: noop, onAddImage: noop, onAddVideo: noop, onAddAudio: noop, onAddScript: noop,
                onAddFrame: noop, onAddFolder: noop, onAddDrawing: noop, onAddWorkflow: noop, onAddExtensionNode: noop,
                onChooseStyle: noop, onOpenDirector: noop, onUpload: noop, onOpenMyAssets: noop, onOpenProjectCharacters: noop,
            },
        };
        const labels = resolveAddNodeMenuCommands(context).filter((command) => command.section === "node").slice(0, 8).map((command) => command.label);
        expect(labels).toEqual(["text", "pictures", "video", "AI super score", "Audio", "Director's desk", "Smart clipping", "Pull frame by frame"]);
        const commandsByLabel = new Map(resolveAddNodeMenuCommands(context).map((command) => [command.label, command]));
        for (const label of ["Smart clipping", "Pull frame by frame"]) {
            expect(commandsByLabel.get(label)?.disabledReason).toBe("Under development");
        }
        expect(commandsByLabel.get("script")?.disabledReason).toBeUndefined();
    });

    test("opens the existing director templates from the professional add-node menu", () => {
        let opened = false;
        const noop = () => {};
        const context: AddNodeMenuContext = {
            workspaceMode: "professional",
            isProjectLinked: false,
            handlers: {
                onAddText: noop, onAddImage: noop, onAddVideo: noop, onAddAudio: noop, onAddScript: noop,
                onAddFrame: noop, onAddFolder: noop, onAddDrawing: noop, onAddWorkflow: noop, onAddExtensionNode: noop,
                onChooseStyle: noop, onOpenDirector: () => { opened = true; }, onUpload: noop, onOpenMyAssets: noop, onOpenProjectCharacters: noop,
            },
        };
        const director = resolveAddNodeMenuCommands(context).find((command) => command.id === "director");
        expect(director).toBeDefined();
        expect(director?.disabledReason).toBeUndefined();
        expect(director?.badge).toBeUndefined();
        director?.run(context);
        expect(opened).toBe(true);
        expect(resolveAddNodeMenuCommands({ ...context, workspaceMode: "simple" }).some((command) => command.id === "director")).toBe(false);
    });
});
