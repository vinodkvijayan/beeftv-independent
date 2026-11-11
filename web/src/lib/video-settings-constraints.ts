import { beefTVVideoContract, isBeefTVEndpoint } from "./beeftv-video-contracts";
import { h3ReferenceMode, h3VideoOperation, isH3MaxModel, isH3Model, isH3Style } from "./h3-video";
import { modelCapabilityConfigFor } from "./model-capabilities";
import { seedanceSettingsConstraints, type SeedanceSettingsConstraints } from "./seedance-task-constraints";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

export type VideoSettingsConstraints = SeedanceSettingsConstraints & { ratioHelp?: string };

export function videoSettingsConstraints(
    config: AiConfig,
    input: { imageCount?: number; videoCount?: number; audioCount?: number; characterCount?: number },
    metadata?: Pick<CanvasNodeMetadata, "videoEditOperation" | "videoStartFrameNodeId" | "videoEndFrameNodeId" | "videoMiddleFrameNodeId">,
): VideoSettingsConstraints {
    const model = modelOptionName(config.model);
    const imageCount = input.imageCount || 0;
    const videoCount = input.videoCount || 0;
    const audioCount = input.audioCount || 0;
    const first = metadata?.videoStartFrameNodeId;
    const last = metadata?.videoEndFrameNodeId;
    const resolved = resolveModelRequestConfig(config, config.model);
    const h3 = isBeefTVEndpoint(resolved.baseUrl) && beefTVVideoContract(model) && isH3Model(model);
    if (h3) {
        // Canvas submission resolves the operation before building the provider payload.
        const counts = { imageCount, videoCount, audioCount };
        const referenceMode = h3ReferenceMode(model, counts, { ...metadata, videoEditOperation: h3VideoOperation(model, counts, metadata?.videoEditOperation) });
        if (referenceMode) return {};
        if (input.characterCount) {
            // A card can expand into several views and change the submission mode.
            const ratioHelp = first || last
                ? isH3MaxModel(model)
                    ? "Character reference pictures cannot be mixed in the first and last frame generation; H3 Max multi-material reference generation can combine key frames and character reference pictures, using the selected ratio."
                    : "When using a character cassette with a reference image, it cannot be used at the same time as the specified first and last frames. Please remove the character card, or cancel the specification of the first and last frames before generating again."
                : isH3Style(model)
                    ? "When the character card has a reference picture, the video ratio is determined by the reference picture; the selected ratio only takes effect when there is no reference picture."
                    : "When the first and last frames are generated, the scale follows the actual reference image; multi-material reference generation uses the selected scale.";
            return { ratioHelp };
        }
        if (!imageCount) return {};
        const frame = last && !first ? "last frame" : "first frame";
        return {
            ratioLabel: `Follow${frame}pictures`,
            ratioHelp: `The video ratio is given by${frame}Pictures decide. If you need other ratios, please crop or enlarge the image first and then generate the video.`,
        };
    }
    return seedanceSettingsConstraints(modelCapabilityConfigFor(config, config.model).video, imageCount, videoCount, audioCount, metadata?.videoEditOperation, Boolean(first || last));
}
