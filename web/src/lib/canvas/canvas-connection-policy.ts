import { maxModelInputCapacity, type ModelInputSummary } from "@/lib/model-selection";
import { getNodeAcceptedInputKinds, getNodeGenerationMode, getNodeInputKind, getNodeMaxInputCount } from "@/lib/canvas/node-registry";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type ConnectionCandidate = Pick<CanvasConnection, "fromNodeId" | "toNodeId">;
type CanvasConnectionPolicyOptions = {
    // 仅跳过参考素材数量上限，媒体类型不兼容仍然拒绝。
    ignoreCapacity?: boolean;
};

export function canvasConnectionError(config: AiConfig, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate: ConnectionCandidate, options: CanvasConnectionPolicyOptions = {}) {
    const target = nodes.find((node) => node.id === candidate.toNodeId);
    if (!target) return "The connection target node cannot be found";
    const sourceNode = nodes.find((node) => node.id === candidate.fromNodeId);
    if (sourceNode?.type === CanvasNodeType.Upscale && target.type !== CanvasNodeType.Image && target.type !== CanvasNodeType.Video) return "The right side of the super-resolution node is only connected to the picture or video result node.";
    const acceptedInputKinds = getNodeAcceptedInputKinds(target.type);
    if (acceptedInputKinds.length) {
        const source = nodes.find((node) => node.id === candidate.fromNodeId);
        const sourceKind = source ? getNodeInputKind(source.type) : undefined;
        const isMediaConversion = target.type === CanvasNodeType.MediaConversion || target.type === CanvasNodeType.Upscale;
        const hasAcceptedSource = isMediaConversion
            ? source?.type === CanvasNodeType.Image || source?.type === CanvasNodeType.Video
            : Boolean(sourceKind && acceptedInputKinds.includes(sourceKind));
        if (!sourceKind || !hasAcceptedSource) {
            const labels = acceptedInputKinds.map(acceptedInputKindLabel).join("or");
            const targetLabel = target.type === CanvasNodeType.Upscale ? "Super score" : isMediaConversion ? "Convert" : target.type === CanvasNodeType.BatchTable ? "Batch creation table" : labels;
            return `${targetLabel}The node only accepts${labels}input`;
        }
        const maxInputCount = getNodeMaxInputCount(target.type);
        if (maxInputCount) {
            const inputCount = new Set(
                [...connections, { id: "candidate", ...candidate }]
                    .filter((connection) => connection.toNodeId === target.id)
                    .map((connection) => connection.fromNodeId),
            ).size;
            if (inputCount > maxInputCount) return `${isMediaConversion ? "Convert" : "current"}Nodes have the most connections${maxInputCount} input`;
        }
    }
    const mode = getNodeGenerationMode(target);
    if (!mode) return "";
    const input = connectionInputSummary(target.id, nodes, connections, candidate);
    const visualInputCount = input.imageCount + input.characterCount;

    if (mode === "image") {
        if (input.videoCount > 0) return "The image generation node cannot connect to the reference video";
        if (input.audioCount > 0) return "The image generation node cannot be connected to the reference audio";
        return options.ignoreCapacity ? "" : capacityError(config, mode, "image", visualInputCount, "Reference picture");
    }
    if (mode === "video") {
        return options.ignoreCapacity ? "" : capacityError(config, mode, "image", visualInputCount, "Reference picture") || capacityError(config, mode, "video", input.videoCount, "Reference video") || capacityError(config, mode, "audio", input.audioCount, "Reference audio");
    }
    if (mode === "text" && input.audioCount > 0) return "Text generation node cannot connect to reference audio";
    if (mode === "audio" && input.characterCount > 1) return "Character dubbing can only connect one character card at a time";
    if (mode === "audio" && (input.imageCount > 0 || input.videoCount > 0 || input.audioCount > 0)) return "Audio generation nodes only accept text or single character card input";
    return "";
}

function acceptedInputKindLabel(kind: "image" | "video" | "audio" | "text" | "table_data") {
    if (kind === "image") return "pictures";
    if (kind === "video") return "video";
    if (kind === "audio") return "Audio";
    if (kind === "table_data") return "multidimensional table";
    return "text";
}

export function connectionInputSummary(targetNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate?: ConnectionCandidate): ModelInputSummary {
    const sourceIds = new Set([...connections, ...(candidate ? [{ id: "candidate", ...candidate }] : [])].filter((connection) => connection.toNodeId === targetNodeId).map((connection) => connection.fromNodeId));
    const input: ModelInputSummary = { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 };
    sourceIds.forEach((sourceId) => {
        const source = nodes.find((node) => node.id === sourceId);
        if (!source) return;
        // 生成配置与背板不是参考素材，不参与容量计数——这一步必须早于角色卡判定，
        // 否则一个带角色元数据的配置/背板节点会被多算成角色。
        const inputKind = getNodeInputKind(source.type);
        if (!inputKind) return;
        // 角色卡是跨类型覆盖：落在可计数类型上时改记为角色。
        if (source.metadata?.workflowKind === "character") input.characterCount += 1;
        else if (inputKind !== "table_data") input[`${inputKind}Count`] += 1;
    });
    return input;
}

function capacityError(config: AiConfig, capability: "image" | "video", kind: "image" | "video" | "audio", count: number, label: string) {
    const maximum = maxModelInputCapacity(config, capability, kind);
    if (maximum === null || count <= maximum) return "";
    const unit = kind === "image" ? "images" : "items";
    return maximum > 0 ? `The configured model supports up to${maximum} ${unit}${label}` : `None of the configured models are supported${label}`;
}
