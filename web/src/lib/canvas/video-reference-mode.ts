import type { CanvasNodeMetadata } from "@/types/canvas";

export type VideoReferenceCandidate = {
    nodeId: string;
    kind: "text" | "image" | "video" | "audio" | "character" | "skill";
    label: string;
    title?: string;
    active?: boolean;
};

export type VideoReferenceModeState = {
    mode: "frames" | "all";
    canSelectFrames: boolean;
    canSelectAll: boolean;
    framesDisabledReason?: string;
    allDisabledReason?: string;
    endFrameSupported: boolean;
    startFrameNodeId?: string;
    endFrameNodeId?: string;
    promptFirstFrameNodeId?: string;
};

const PROMPT_FIRST_FRAME_CLAUSE =
    /(?:^|[，,。；;\n\s])(?:以\s*)?(?:@\[node:([^\]]+)\]|@(图片\d+))\s*(?:[:：]?\s*)?作为(?:本镜头(?:的)?|起始)?首帧(?:画面)?/u;

const GLOBAL_FIRST_FRAME_CLAUSE =
    /(?:^|[，,。；;\s]+)(?:以\s*)?(?:@\[node:[^\]]+\]|@图片\d+)\s*(?:[:：]?\s*)?作为(?:本镜头(?:的)?|起始)?首帧(?:画面)?[，,。；;\s]*/gu;

export function findPromptFirstFrameNodeId(prompt: string, imageRefs: VideoReferenceCandidate[]): string | undefined {
    const activeImages = imageRefs.filter((ref) => ref.active !== false && ref.kind === "image");
    const match = PROMPT_FIRST_FRAME_CLAUSE.exec(prompt);
    if (!match) return undefined;
    const [, nodeId, label] = match;
    if (nodeId) {
        return activeImages.find((ref) => ref.nodeId === nodeId)?.nodeId;
    }
    if (label) {
        return activeImages.find((ref) => ref.label.trim() === label.trim())?.nodeId;
    }
    return undefined;
}

export function stripPromptFirstFrameClauses(prompt: string): string {
    return prompt
        .replace(GLOBAL_FIRST_FRAME_CLAUSE, (fullMatch, offset: number) => {
            if (offset === 0) return "";
            const leadingPunct = /^[，,。；;\s]+/u.exec(fullMatch)?.[0] || "";
            return leadingPunct.includes("\n") ? "\n" : "，";
        })
        .replace(/^[，,。；;\s]+/u, "")
        .replace(/[，,。；;\s]+$/u, (tail) => (tail.includes("\n") ? "\n" : ""));
}

export function togglePromptFirstFrameMention(
    prompt: string,
    target: { nodeId: string; token: string },
    imageRefs: VideoReferenceCandidate[],
): string {
    const currentId = findPromptFirstFrameNodeId(prompt, imageRefs);
    const cleaned = stripPromptFirstFrameClauses(prompt);
    if (currentId === target.nodeId) {
        return cleaned;
    }
    const prefix = `${target.token} As the first frame,`;
    return cleaned ? `${prefix}${cleaned}` : prefix;
}

export function resolveVideoReferenceModeState({
    metadata,
    references,
    endFrameSupported = true,
    referenceVideoSupported = true,
    h3Model = false,
    h3Style = false,
    prompt = "",
}: {
    metadata?: CanvasNodeMetadata;
    references: VideoReferenceCandidate[];
    endFrameSupported?: boolean;
    referenceVideoSupported?: boolean;
    h3Model?: boolean;
    h3Style?: boolean;
    prompt?: string;
}): VideoReferenceModeState {
    const active = references.filter((item) => item.active !== false && item.kind !== "skill");
    const imageRefs = active.filter((item) => item.kind === "image");
    const characterCount = active.filter((item) => item.kind === "character").length;
    const visualCount = imageRefs.length + characterCount;
    const videoCount = active.filter((item) => item.kind === "video").length;
    const audioCount = active.filter((item) => item.kind === "audio").length;
    const maxFrameImages = endFrameSupported ? 2 : 1;

    const canSelectFrames =
        imageRefs.length >= 1 &&
        characterCount === 0 &&
        visualCount <= maxFrameImages &&
        videoCount === 0 &&
        (audioCount === 0 || (h3Model && audioCount <= 1));
    const canSelectAll = !h3Style && referenceVideoSupported && (visualCount > 0 || videoCount > 0 || audioCount > 0);

    let framesDisabledReason: string | undefined;
    if (!canSelectFrames) {
        if (videoCount > 0) {
            framesDisabledReason = "The reference video has been connected and is currently in all-purpose reference mode; you can click on the image thumbnail \"First Frame\" to set it as the starting image.";
        } else if (characterCount > 0) {
            framesDisabledReason = "The character card has been connected and is currently in all-purpose reference mode; you can click on the image thumbnail \"First Frame\" to set it as the starting screen";
        } else if (visualCount > maxFrameImages) {
            framesDisabledReason = "The first and last frame mode is limited to 1-2 pictures; for comprehensive reference of multiple pictures, you can directly click the \"first frame\" of the picture to set it as the starting picture";
        } else if (audioCount > 0) {
            framesDisabledReason = "The reference audio has been connected and is currently in the all-purpose reference mode; you can click on the image thumbnail \"First Frame\" to set it as the starting image";
        } else {
            framesDisabledReason = "Please connect 1–2 reference pictures first";
        }
    }
    const allDisabledReason = !canSelectAll ? "The current model only supports the first frame/first and last frame modes and does not support all-round reference." : undefined;

    const mode: "frames" | "all" = !canSelectFrames
        ? "all"
        : !canSelectAll
          ? "frames"
          : metadata?.videoEditOperation === "reference_to_video"
            ? "all"
            : "frames";

    if (mode === "all") {
        return {
            mode,
            canSelectFrames,
            canSelectAll,
            framesDisabledReason,
            allDisabledReason,
            endFrameSupported,
            promptFirstFrameNodeId: findPromptFirstFrameNodeId(prompt, imageRefs),
        };
    }

    const explicitStart = imageRefs.find((ref) => ref.nodeId === metadata?.videoStartFrameNodeId)?.nodeId;
    const explicitEnd = endFrameSupported
        ? imageRefs.find((ref) => ref.nodeId === metadata?.videoEndFrameNodeId)?.nodeId
        : undefined;
    const hasExplicitFrame = Boolean(explicitStart || explicitEnd);
    const startFrameNodeId = hasExplicitFrame ? explicitStart : imageRefs[0]?.nodeId;
    const endFrameNodeId = hasExplicitFrame
        ? explicitEnd && explicitEnd !== startFrameNodeId
            ? explicitEnd
            : undefined
        : endFrameSupported && imageRefs.length === 2
          ? imageRefs[1]?.nodeId
          : undefined;

    return {
        mode,
        canSelectFrames,
        canSelectAll,
        framesDisabledReason,
        allDisabledReason,
        endFrameSupported,
        startFrameNodeId,
        endFrameNodeId,
    };
}
