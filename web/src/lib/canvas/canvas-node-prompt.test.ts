import assert from "node:assert/strict";
import test from "node:test";

import "./node-registry/definitions/index.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { canvasNodeHasCommittedContent, writeCanvasNodePrompt } from "./canvas-node-prompt.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { createStoryboardRow } from "./canvas-project-domain.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { syncBoundStoryboardNodesForRows } from "./canvas-storyboard-materializer.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { CanvasNodeType, type CanvasNodeData, type StoryboardRow } from "../../types/canvas.ts";

function node(type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id: `${type}-node`,
        type,
        title: "test node",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata,
    };
}

test("When the media node already has results, only the next version of the prompt word draft will be updated.", () => {
    for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio]) {
        const current = node(type, {
            content: `https://example.com/${type}`,
            prompt: "Prompt word submitted",
            composerContent: "old draft",
            status: "success",
        });

        assert.equal(canvasNodeHasCommittedContent(current), true);
        assert.deepEqual(writeCanvasNodePrompt(current, "Prompt word for next edition").metadata, {
            content: `https://example.com/${type}`,
            prompt: "Prompt word submitted",
            composerContent: "Prompt word for next edition",
            status: "success",
        });
    }
});

test("An empty media draft initializes both the submission prompt word and the edit prompt word.", () => {
    const current = node(CanvasNodeType.Video, { status: "idle" });

    assert.equal(canvasNodeHasCommittedContent(current), false);
    assert.deepEqual(writeCanvasNodePrompt(current, "First edition prompt words").metadata, {
        status: "idle",
        prompt: "First edition prompt words",
        composerContent: "First edition prompt words",
    });
});

test("When the image only retains the storageKey, it is still regarded as an existing media result.", () => {
    const current = node(CanvasNodeType.Image, {
        storageKey: "canvas/image/result.png",
        prompt: "Prompt word submitted",
    });

    assert.equal(canvasNodeHasCommittedContent(current), true);
    assert.equal(writeCanvasNodePrompt(current, "new draft").metadata?.prompt, "Prompt word submitted");
});

test("Text prompt words themselves do not constitute submitted content", () => {
    const draft = node(CanvasNodeType.Text, { prompt: "draft text" });
    const committed = node(CanvasNodeType.Text, { content: "Text generated", prompt: "Prompt word submitted" });

    assert.equal(canvasNodeHasCommittedContent(draft), false);
    assert.equal(canvasNodeHasCommittedContent(committed), true);
    assert.equal(writeCanvasNodePrompt(draft, "New text draft").metadata?.prompt, "New text draft");
    assert.equal(writeCanvasNodePrompt(committed, "Draft text for next edition").metadata?.prompt, "Prompt word submitted");
});

test("The caller can first clean up the failed task metadata, and then the unified writer saves the draft.", () => {
    const current = node(CanvasNodeType.Video, {
        content: "https://example.com/video.mp4",
        prompt: "Prompt word submitted",
        promptTemplateOperation: "storyboard-video",
        promptTemplateVariables: { shot: "1" },
        taskId: "failed-task",
    });
    const metadata = { ...current.metadata, taskId: undefined };

    const updated = writeCanvasNodePrompt(current, "revised draft", {
        metadata,
        clearPromptTemplate: true,
    });

    assert.equal(updated.metadata?.prompt, "Prompt word submitted");
    assert.equal(updated.metadata?.composerContent, "revised draft");
    assert.equal(updated.metadata?.taskId, undefined);
    assert.equal(updated.metadata?.promptTemplateOperation, undefined);
    assert.equal(updated.metadata?.promptTemplateVariables, undefined);
});

test("When storyboards are updated, automatically synchronize drafts of bound nodes that have not been manually deviated, and skip drafts of nodes that have been manually edited.", () => {
    const prevRow: StoryboardRow = {
        ...createStoryboardRow(1),
        id: "shot-1",
        plotDescription: "Original picture",
        imageGenerationPrompt: "Old picture prompt words",
        videoMotionPrompt: "old video prompt words",
        imageNodeId: "img-1",
        videoNodeId: "vid-1",
    };
    const nextRow: StoryboardRow = {
        ...prevRow,
        imageGenerationPrompt: "New picture prompt words",
        videoMotionPrompt: "new video prompt word",
    };
    const scriptNode = node(CanvasNodeType.Script, {
        storyboard: {
            rows: [prevRow],
            visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
            referenceNodeIds: [],
        },
    });
    const imageNode = {
        ...node(CanvasNodeType.Image, {
            content: "https://example.com/img-1.png",
            prompt: "Old picture prompt words",
            composerContent: "Old picture prompt words",
            status: "success",
        }),
        id: "img-1",
    };
    const videoNodeManuallyEdited = {
        ...node(CanvasNodeType.Video, {
            content: "https://example.com/vid-1.mp4",
            prompt: "old video prompt words",
            composerContent: "A draft of the movement of the camera manually modified by the user on the node",
            status: "success",
        }),
        id: "vid-1",
    };

    const synced = syncBoundStoryboardNodesForRows(
        scriptNode,
        [prevRow],
        [nextRow],
        [scriptNode, imageNode, videoNodeManuallyEdited],
        [],
    );
    const updatedImage = synced.find((item) => item.id === "img-1");
    const updatedVideo = synced.find((item) => item.id === "vid-1");

    assert.equal(updatedImage?.metadata?.prompt, "Old picture prompt words");
    assert.equal(updatedImage?.metadata?.composerContent, "New picture prompt words");
    assert.equal(updatedVideo?.metadata?.composerContent, "A draft of the movement of the camera manually modified by the user on the node");
});
