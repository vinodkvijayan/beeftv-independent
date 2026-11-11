import type { CanvasNodeData } from "@/types/canvas";

export const MEDIA_CONVERSION_SCHEMA_VERSION = 1 as const;

export const MEDIA_CONVERSION_NODE_TYPE = "media-conversion" as const;

export type MediaConversionOperation = "grayscale" | "edge-canny" | "lineart" | "depth" | "pose" | "cutout";
export type MediaConversionStatus = "idle" | "processing" | "completed" | "stale" | "skipped" | "unavailable" | "error";
export type MediaConversionOutputKind = "image" | "video";

export type MediaConversionNodeState = {
    schemaVersion: typeof MEDIA_CONVERSION_SCHEMA_VERSION;
    operation: MediaConversionOperation;
    status: MediaConversionStatus;
    sourceNodeId?: string;
    sourceFingerprint?: string;
    outputKind?: MediaConversionOutputKind;
    resultStorageKey?: string;
    resultWidth?: number;
    resultHeight?: number;
    detectedPeople?: number;
    errorCode?: string;
    errorMessage?: string;
    startedAt?: string;
    updatedAt?: string;
};

export const MEDIA_CONVERSION_OPERATION_LABELS: Record<MediaConversionOperation, string> = {
    grayscale: "Grayscale image",
    "edge-canny": "Canny edge",
    lineart: "AI line drawing",
    depth: "Depth map",
    pose: "posture skeleton",
    cutout: "Transparent cutout",
};

export const MEDIA_CONVERSION_OPERATION_DESCRIPTIONS: Record<MediaConversionOperation, string> = {
    grayscale: "Ordinary image algorithm, suitable for checking light and dark levels first",
    "edge-canny": "Ordinary image algorithm to extract clear contours",
    lineart: "Local ControlNet Aux line art preprocessing, the model needs to be loaded for the first run",
    depth: "Local Depth Anything V2 Small, the model needs to be loaded for the first run",
    pose: "Local OpenPose human skeleton preprocessing, skipped when no character is detected",
    cutout: "Need to install and verify the local cutout model",
};

export function createDefaultMediaConversionState(): MediaConversionNodeState {
    return {
        schemaVersion: MEDIA_CONVERSION_SCHEMA_VERSION,
        operation: "edge-canny",
        status: "idle",
    };
}

export function mediaConversionSourceFingerprint(node: CanvasNodeData) {
    const metadata = node.metadata;
    const source = [
        node.id,
        metadata?.storageKey || "",
        compactSource(metadata?.content || metadata?.previewContent || ""),
        metadata?.mimeType || "",
        metadata?.bytes || "",
        metadata?.naturalWidth || "",
        metadata?.naturalHeight || "",
        metadata?.durationMs || "",
    ].join("|");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function mediaConversionOperationLabel(operation: MediaConversionOperation) {
    return MEDIA_CONVERSION_OPERATION_LABELS[operation];
}

export function mediaConversionOperationDescription(operation: MediaConversionOperation) {
    return MEDIA_CONVERSION_OPERATION_DESCRIPTIONS[operation];
}

export function isLocalImageOperation(operation: MediaConversionOperation) {
    return operation === "grayscale" || operation === "edge-canny";
}

function compactSource(value: string) {
    if (value.length <= 2048) return value;
    return `${value.slice(0, 1024)}|${value.slice(-1024)}|${value.length}`;
}
