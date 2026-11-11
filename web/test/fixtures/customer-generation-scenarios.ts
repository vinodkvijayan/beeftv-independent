import { canvasAppearanceForTheme } from "../../src/lib/canvas/canvas-appearance";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../src/types/canvas";

// Synthetic reconstructions of the two reported input shapes. The exported
// diagnostics did not include the click or graph, so these are separate cases.
export type CustomerGenerationScenario = "five-images" | "video-image" | "missing-audio-duration" | "character" | "library-references";

export function customerGenerationProject(scenario: CustomerGenerationScenario) {
    const refs: CanvasNodeData[] = [];
    const add = (id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}) => refs.push({
        id, type, title: id, position: { x: refs.length * 340, y: 0 }, width: 320, height: 180,
        metadata: { content: `/api/resources/${id}/file`, storageKey: `resource:${id}`, status: "success", naturalWidth: 1280, naturalHeight: 720, ...metadata },
    });
    let prompt = "Let @Picture1 move slowly across the screen";
    if (scenario === "five-images") {
        for (let index = 1; index <= 5; index++) add(`image-${index}`, CanvasNodeType.Image);
        prompt = "Reference @Picture 1 @Picture 2 @Picture 3 @Picture 4 @Picture 5, the camera advances slowly";
    } else if (scenario === "video-image") {
        add("video-1", CanvasNodeType.Video, { durationMs: 2500 });
        add("image-1", CanvasNodeType.Image);
        prompt = "Keep the movement of @video1 and use the composition of @picture1";
    } else if (scenario === "missing-audio-duration") {
        add("image-1", CanvasNodeType.Image);
        add("audio-1", CanvasNodeType.Audio, { durationMs: 0, mimeType: "audio/wav" });
        prompt = "Refer to @Picture1, dubbed by @Audio1";
    } else if (scenario === "library-references") {
        prompt = "Refer to the characters in @[asset:library-image] and retain the actions of @[asset:library-video]";
    } else {
        refs.push({ id: "character-1", type: CanvasNodeType.Config, title: "test role", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { workflowKind: "character", characterAssetId: "character-asset", characterVersionId: "character-v1" } });
        prompt = "Let @Character1 move slowly in the screen";
    }
    const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Video, title: "customer generation scenario", position: { x: 0, y: 300 }, width: 320, height: 180,
        metadata: { content: "/api/resources/previous-result/file", storageKey: "resource:previous-result", status: "success", nodeRole: "generator", generationResultPlacement: "replace-node", composerContent: prompt, prompt } };
    const connections: CanvasConnection[] = refs.map(node => ({ id: `edge-${node.id}`, fromNodeId: node.id, toNodeId: target.id }));
    return { id: "customer-scenario", revision: 1, title: "Synthetic customer generation", createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z", nodes: [...refs, target], connections,
        chatSessions: [], activeChatId: null, appearance: canvasAppearanceForTheme("light"), backgroundMode: "grid" as const, showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [] };
}
