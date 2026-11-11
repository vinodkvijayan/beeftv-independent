import { App } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { useCallback, useRef, useState } from "react";

import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { resourceFileUrl, resourceIdFromStorageKey, syncResourceToArkPrivateAsset } from "@/services/api/resources";
import { uploadImage } from "@/services/image-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { copyImageToSystemClipboard } from "./canvas-project-clipboard";

type UseCanvasNodeMediaShareActionsParams = {
    projectId: string;
    domainProjectId?: string;
    localOnly: boolean;
    releaseCopiedNodesPastePriority: () => void;
    handleConfigNodeChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
};

export function useCanvasNodeMediaShareActions({
    projectId,
    domainProjectId,
    localOnly,
    releaseCopiedNodesPastePriority,
    handleConfigNodeChange,
}: UseCanvasNodeMediaShareActionsParams) {
    const { message, modal } = App.useApp();
    const [arkPrivateAssetUploadNodeId, setArkPrivateAssetUploadNodeId] = useState<string | null>(null);
    const copyingNodeContentRef = useRef(false);

    const copyNodeContentToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            if (copyingNodeContentRef.current) return;
            copyingNodeContentRef.current = true;
            releaseCopiedNodesPastePriority();
            const content = node?.metadata?.content?.trim();
            const resourceId = resourceIdFromStorageKey(node?.metadata?.storageKey);
            const copySource = content || (node?.type === CanvasNodeType.Image && resourceId ? resourceFileUrl(resourceId) : "");
            if (!node || !copySource) {
                copyingNodeContentRef.current = false;
                message.warning("No content to copy");
                return;
            }

            try {
                if (node.type === CanvasNodeType.Image) {
                    try {
                        await copyImageToSystemClipboard(copySource, node.metadata?.storageKey);
                        message.success("Image copied to clipboard");
                        return;
                    } catch (imageErr) {
                        const fallbackUrl = new URL(copySource, window.location.href).toString();
                        if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(fallbackUrl).catch(() => undefined);
                            message.info("The image address has been copied for you because the browser does not have focus.");
                            return;
                        }
                        if (await copyToClipboard(fallbackUrl)) {
                            message.info("The image address has been copied for you because the browser does not have focus.");
                            return;
                        }
                        throw imageErr;
                    }
                }

                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copySource);
                else if (!copyToClipboard(copySource)) throw new Error("The current browser does not support writing to the clipboard");
                message.success(node.type === CanvasNodeType.Text ? "Text copied" : "Content link copied");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "Copy failed, please check browser clipboard permissions");
            } finally {
                copyingNodeContentRef.current = false;
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const copyNodeMediaUrlToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            releaseCopiedNodesPastePriority();
            try {
                const storageKey = node?.metadata?.storageKey;
                const content = node?.metadata?.content?.trim();
                const resourceId = resourceIdFromStorageKey(storageKey);
                const mediaPath = content && !content.startsWith("data:") && !content.startsWith("blob:") ? content : resourceId ? resourceFileUrl(resourceId) : "";
                const mediaURL = mediaPath ? new URL(mediaPath, window.location.href).toString() : "";
                if (!mediaURL) throw new Error("The current media only has local content and no copyable address.");
                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(mediaURL);
                else if (!(await copyToClipboard(mediaURL))) throw new Error("The current browser does not support writing to the clipboard");
                message.success(node?.type === CanvasNodeType.Video ? "Video address has been copied" : "Image address has been copied");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "Media address copy failed");
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const uploadNodeImageToArkPrivateAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("Please select an available image before uploading");
                return;
            }
            if (arkPrivateAssetUploadNodeId === node.id) return;
            const feedbackKey = `ark-private-asset-${node.id}`;
            setArkPrivateAssetUploadNodeId(node.id);
            message.loading({ key: feedbackKey, content: "Saving and uploading to Ark material library...", duration: 0 });
            try {
                let resourceID = resourceIdFromStorageKey(node.metadata.storageKey);
                let persistedNode = node;
                if (!resourceID) {
                    const uploaded = await uploadImage(node.metadata.content);
                    resourceID = resourceIdFromStorageKey(uploaded.storageKey);
                    if (!resourceID) throw new Error(localOnly ? "The image failed to be saved to the local library, please try again." : "The image failed to be saved to the system material library. Please check the object storage configuration and try again.");
                    handleConfigNodeChange(node.id, imageMetadata(uploaded));
                    persistedNode = { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded) } };
                }
                const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: persistedNode, source: "canvas-manual" });
                handleConfigNodeChange(node.id, { assetId: asset.assetId });
                await syncResourceToArkPrivateAsset(resourceID);
                message.success({ key: feedbackKey, content: "It has been synchronized to the Ark material library, and Seedance will automatically reuse the material.", duration: 4 });
            } catch (error) {
                message.error({ key: feedbackKey, content: error instanceof Error ? error.message : "Failed to upload to Ark material library", duration: 5 });
            } finally {
                setArkPrivateAssetUploadNodeId((current) => (current === node.id ? null : current));
            }
        },
        [arkPrivateAssetUploadNodeId, domainProjectId, handleConfigNodeChange, localOnly, message, projectId],
    );

    const confirmUploadNodeImageToArkPrivateAsset = useCallback(
        (node: CanvasNodeData) => {
            modal.confirm({
                title: "Upload to Ark material library",
                content: "Only upload images for which you have a likeness, copyright, or other legal right to use them. After Ark is approved, Seedance will generate the video using controlled material identification.",
                okText: "Confirm you have the right to use it and upload it",
                cancelText: "Cancel",
                onOk: () => uploadNodeImageToArkPrivateAsset(node),
            });
        },
        [modal, uploadNodeImageToArkPrivateAsset],
    );

    return {
        arkPrivateAssetUploadNodeId,
        copyNodeContentToClipboard,
        copyNodeMediaUrlToClipboard,
        confirmUploadNodeImageToArkPrivateAsset,
    };
}
