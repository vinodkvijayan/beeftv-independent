import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { isSeedanceVideoConfig } from "@/lib/seedance-video";
import type { CanvasVideoEditOperation } from "@/types/canvas";
import { channelHasGenerationCredential, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export function listVideoReferenceModels(config: AiConfig): string[] {
    return selectableModelsByCapability(config, "video").filter((model) => {
        const profile = modelCapabilityConfigFor(config, model).video;
        if (!profile || profile.references.maxVideos < 1 || !profile.operations.length) return false;
        const channel = resolveModelChannel(config, model);
        return Boolean(channel.baseUrl.trim() && channelHasGenerationCredential(channel));
    });
}

export function videoReferenceRegenerationError(config: AiConfig): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    if (!videoProfile || videoProfile.references.maxVideos < 1) {
        return "The currently selected video model does not support reference video, and nodes to be generated for the clip cannot be created. Please select a model that supports reference videos, or configure the Seedance / Agent Plan / NewAPI channels in settings.";
    }
    if (!videoProfile.operations.length) return "There is no video generation mode available for the current video model";
    return "";
}

export function videoReferenceOperationError(config: AiConfig, operation: CanvasVideoEditOperation): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    if (!videoProfile?.operations.includes(operation)) return "The selected generation mode is not supported by the current video model";
    return "";
}

export function validateVideoSegmentBatch(config: AiConfig, segments: Array<{ startMs: number; endMs: number }>, operation?: CanvasVideoEditOperation): string {
    const referenceError = videoReferenceRegenerationError(config);
    if (referenceError) return referenceError;
    if (operation) {
        const operationError = videoReferenceOperationError(config, operation);
        if (operationError) return operationError;
    }
    for (const segment of segments) {
        const segmentError = videoReferenceSegmentError(config, segment.endMs - segment.startMs);
        if (segmentError) return segmentError;
    }
    return "";
}

export function videoReferenceSegmentError(config: AiConfig, durationMs: number): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    const maxSeconds = videoProfile?.references.maxVideoDurationSeconds || 0;
    if (maxSeconds > 0 && durationMs > maxSeconds * 1000) {
        return `The captured clips cannot exceed the current model reference video limit (${maxSeconds} seconds)`;
    }
    if (isSeedanceVideoConfig(config) && durationMs < 2000) {
        return "The single segment of Seedance reference video must be at least 2 seconds, please expand the interception range.";
    }
    return "";
}
