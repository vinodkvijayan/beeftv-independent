import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canvasThemes } from "../src/lib/canvas-theme";
import { ConnectedReferenceShelf, VideoReferenceModeSwitch } from "../src/components/canvas/canvas-node-reference-shelf";
import { findPromptFirstFrameNodeId, resolveVideoReferenceModeState, stripPromptFirstFrameClauses, togglePromptFirstFrameMention } from "../src/lib/canvas/video-reference-mode";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";

const makeImageRefs = (count: number): CanvasResourceReference[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `img-${index + 1}`,
        nodeId: `img-${index + 1}`,
        kind: "image",
        label: `pictures${index + 1}`,
        title: `lens${index + 1}`,
        active: true,
        previewUrl: `https://example.com/img-${index + 1}.png`,
    }));

describe("resolveVideoReferenceModeState", () => {
    test("1–2 reference pictures enter the first and last frame mode by default and deduce the first and last frame roles, and support switching to all-round reference", () => {
        const oneImageState = resolveVideoReferenceModeState({
            references: makeImageRefs(1),
        });
        expect(oneImageState.mode).toBe("frames");
        expect(oneImageState.canSelectFrames).toBe(true);
        expect(oneImageState.canSelectAll).toBe(true);
        expect(oneImageState.startFrameNodeId).toBe("img-1");
        expect(oneImageState.endFrameNodeId).toBeUndefined();

        const twoImageState = resolveVideoReferenceModeState({
            references: makeImageRefs(2),
        });
        expect(twoImageState.mode).toBe("frames");
        expect(twoImageState.canSelectFrames).toBe(true);
        expect(twoImageState.startFrameNodeId).toBe("img-1");
        expect(twoImageState.endFrameNodeId).toBe("img-2");

        const switchedToAll = resolveVideoReferenceModeState({
            references: makeImageRefs(2),
            metadata: { videoEditOperation: "reference_to_video" },
        });
        expect(switchedToAll.mode).toBe("all");
        expect(switchedToAll.canSelectFrames).toBe(true);
        expect(switchedToAll.startFrameNodeId).toBeUndefined();
        expect(switchedToAll.endFrameNodeId).toBeUndefined();
    });

    test("When there are 3 or more reference pictures or contain video/audio, the universal reference will be automatically locked and the reason for the disablement will be given.", () => {
        const fiveImageState = resolveVideoReferenceModeState({
            references: makeImageRefs(5),
        });
        expect(fiveImageState.mode).toBe("all");
        expect(fiveImageState.canSelectFrames).toBe(false);
        expect(fiveImageState.framesDisabledReason).toContain("1–2 images");

        const videoRefState = resolveVideoReferenceModeState({
            references: [
                ...makeImageRefs(1),
                { nodeId: "vid-1", kind: "video", label: "Video 1", title: "Reference video", active: true },
            ],
        });
        expect(videoRefState.mode).toBe("all");
        expect(videoRefState.canSelectFrames).toBe(false);
        expect(videoRefState.framesDisabledReason).toContain("Reference video");

        const characterRefState = resolveVideoReferenceModeState({
            references: [
                ...makeImageRefs(1),
                { nodeId: "char-1", kind: "character", label: "role 1", title: "Protagonist card", active: true },
            ],
        });
        expect(characterRefState.mode).toBe("all");
        expect(characterRefState.canSelectFrames).toBe(false);
        expect(characterRefState.framesDisabledReason).toContain("character card");

        const noRefVideoModelState = resolveVideoReferenceModeState({
            references: makeImageRefs(1),
            referenceVideoSupported: false,
            endFrameSupported: false,
        });
        expect(noRefVideoModelState.mode).toBe("frames");
        expect(noRefVideoModelState.canSelectAll).toBe(false);
        expect(noRefVideoModelState.endFrameSupported).toBe(false);
        expect(
            renderToStaticMarkup(
                <VideoReferenceModeSwitch state={noRefVideoModelState} theme={canvasThemes.dark} onChange={() => {}} />,
            ),
        ).toBe("");
    });
});

describe("togglePromptFirstFrameMention", () => {
    test("Switch @[node:id] as the first frame in universal reference mode to support cleaning up old clauses at the beginning or in the sentence", () => {
        const refs = makeImageRefs(5);
        const initialPrompt = "As the camera moves forward, the trees and vines grow crazily";

        const withImg5 = togglePromptFirstFrameMention(initialPrompt, { nodeId: "img-5", token: "@[node:img-5]" }, refs);
        expect(withImg5).toBe("@[node:img-5] As the first frame, the camera advances and the trees and vines grow crazily.");
        expect(findPromptFirstFrameNodeId(withImg5, refs)).toBe("img-5");

        const switchedToImg2 = togglePromptFirstFrameMention(withImg5, { nodeId: "img-2", token: "@[node:img-2]" }, refs);
        expect(switchedToImg2).toBe("@[node:img-2] As the first frame, the camera advances and the trees and vines grow crazily.");
        expect(findPromptFirstFrameNodeId(switchedToImg2, refs)).toBe("img-2");

        const toggledOff = togglePromptFirstFrameMention(switchedToImg2, { nodeId: "img-2", token: "@[node:img-2]" }, refs);
        expect(toggledOff).toBe("As the camera moves forward, the trees and vines grow crazily");
        expect(findPromptFirstFrameNodeId(toggledOff, refs)).toBeUndefined();

        const midSentencePrompt = "The camera advances, @[node:img-1] as the first frame, the trees and vines grow crazily";
        expect(findPromptFirstFrameNodeId(midSentencePrompt, refs)).toBe("img-1");
        expect(togglePromptFirstFrameMention(midSentencePrompt, { nodeId: "img-1", token: "@[node:img-1]" }, refs)).toBe("As the camera moves forward, the trees and vines grow crazily");
        expect(stripPromptFirstFrameClauses(withImg5)).toBe("As the camera moves forward, the trees and vines grow crazily");
    });
});

describe("buildVideoGenerationMetadata default frame roles", () => {
    test("When the node ID is not explicitly written in the first and last frame mode, the first frame and the last frame will be completed in the connection order by default. The character diagram/audio reference or the old frame will not be mistakenly set.", async () => {
        const { buildVideoGenerationMetadata } = await import("../src/lib/canvas/canvas-project-generation");
        const { CanvasNodeType } = await import("../src/types/canvas");
        const twoImageNodes = ["img-1", "img-2"].map((id, index) => ({
            id,
            name: `${id}.png`,
            type: "image/png",
            dataUrl: `https://example.com/${id}.png`,
            position: { x: index * 10, y: 0 },
        }));

        const defaultTwoFrameMeta = buildVideoGenerationMetadata(
            {
                id: "vid-1",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beeftv::seedance-2.5" },
            },
            { referenceImages: twoImageNodes, referenceVideos: [], referenceAudios: [] },
        );
        expect(defaultTwoFrameMeta.videoEditOperation).toBe("image_to_video");
        expect(defaultTwoFrameMeta.videoStartFrameNodeId).toBe("img-1");
        expect(defaultTwoFrameMeta.videoEndFrameNodeId).toBe("img-2");

        const singleEndFrameMeta = buildVideoGenerationMetadata(
            {
                id: "vid-2",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beeftv::seedance-2.5", videoEndFrameNodeId: "img-1" },
            },
            { referenceImages: [twoImageNodes[0]!], referenceVideos: [], referenceAudios: [] },
        );
        expect(singleEndFrameMeta.videoEditOperation).toBe("image_to_video");
        expect(singleEndFrameMeta.videoStartFrameNodeId).toBeUndefined();
        expect(singleEndFrameMeta.videoEndFrameNodeId).toBe("img-1");

        const staleFrameDroppedMeta = buildVideoGenerationMetadata(
            {
                id: "vid-stale",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beeftv::seedance-2.5", videoStartFrameNodeId: "removed-img", videoEndFrameNodeId: "img-1" },
            },
            { referenceImages: [twoImageNodes[0]!], referenceVideos: [], referenceAudios: [] },
        );
        expect(staleFrameDroppedMeta.videoStartFrameNodeId).toBeUndefined();
        expect(staleFrameDroppedMeta.videoEndFrameNodeId).toBe("img-1");

        const withAudioMeta = buildVideoGenerationMetadata(
            {
                id: "vid-audio",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beeftv::seedance-2.5" },
            },
            { referenceImages: [twoImageNodes[0]!], referenceVideos: [], referenceAudios: [{ id: "aud-1", name: "a.mp3", type: "audio/mpeg", dataUrl: "" }] },
        );
        expect(withAudioMeta.videoStartFrameNodeId).toBeUndefined();

        const withCharacterImageMeta = buildVideoGenerationMetadata(
            {
                id: "vid-char",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beeftv::seedance-2.5" },
            },
            {
                referenceImages: [
                    twoImageNodes[0]!,
                    { id: "character-reference-1", sourceNodeId: "char-1", name: "char.png", type: "image/png", dataUrl: "" },
                ],
                referenceVideos: [],
                referenceAudios: [],
            },
        );
        expect(withCharacterImageMeta.videoStartFrameNodeId).toBeUndefined();
        expect(withCharacterImageMeta.videoEndFrameNodeId).toBeUndefined();
    });
});

describe("VideoReferenceModeSwitch & ConnectedReferenceShelf UI", () => {
    test("First and last frame mode rendering [First and last frame | All-purpose reference] switcher, thumbnail first frame/last frame corner mark and ⇄ swap button", () => {
        const refs = makeImageRefs(2);
        const state = resolveVideoReferenceModeState({ model: "seedance-2.5", references: refs });
        const switchHtml = renderToStaticMarkup(
            <VideoReferenceModeSwitch state={state} theme={canvasThemes.dark} onChange={() => {}} />,
        );
        expect(switchHtml).toContain("First and last frames");
        expect(switchHtml).toContain("All-round reference");

        const shelfHtml = renderToStaticMarkup(
            <ConnectedReferenceShelf
                references={refs}
                theme={canvasThemes.dark}
                videoModeState={state}
                onInsert={() => {}}
                onVideoMetadataChange={() => {}}
            />,
        );
        expect(shelfHtml).toContain("first frame");
        expect(shelfHtml).toContain("last frame");
        expect(shelfHtml).toContain("Swap first and last frames");
    });

    test("Universal reference mode renders the first frame shortcut button of the prompt word on the picture thumbnail", () => {
        const refs = makeImageRefs(5);
        const prompt = "@[node:img-5] As the first frame, the camera advances";
        const state = resolveVideoReferenceModeState({ model: "seedance-2.5", references: refs, prompt });
        const shelfHtml = renderToStaticMarkup(
            <ConnectedReferenceShelf
                references={refs}
                theme={canvasThemes.dark}
                videoModeState={state}
                onInsert={() => {}}
                onTogglePromptFirstFrame={() => {}}
            />,
        );
        expect(shelfHtml).toContain("Write picture 4 into the first frame of the prompt word");
        expect(shelfHtml).toContain("Cancel Picture 5 Prompt word first frame");
        expect(state.promptFirstFrameNodeId).toBe("img-5");
    });
});
