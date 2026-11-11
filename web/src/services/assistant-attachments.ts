import { nanoid } from "nanoid";
import localforage from "localforage";
import { parseAssetRecord } from "@/lib/asset-record";
import { getActiveUserScope } from "@/lib/user-scope";
import { readUploadImageSize } from "@/lib/canvas/canvas-file-upload";
import { probeMediaMetadata, type MediaMetadata } from "@/lib/media-metadata";
import { ownedResourceIdFromMediaRef, resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { putWorkspaceAsset } from "@/services/api/workspace-data";
import { runAssetStoreProjection, useAssetStore } from "@/stores/use-asset-store";
import { mergeWorkspaceAssetReceipt } from "@/services/workspace-asset-repository";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { AssistantAttachment, AssistantAttachmentPurpose, AssistantSkillSelection } from "@/services/api/agent-assistant";

export const ASSISTANT_ATTACHMENT_PURPOSES: { value: AssistantAttachmentPurpose; label: string }[] = [
    { value: "analysis", label: "Analyze only" }, { value: "character", label: "Character reference" }, { value: "scene", label: "Scene reference" },
    { value: "style", label: "style reference" }, { value: "motion", label: "Mirror movement reference" }, { value: "first-frame", label: "first frame" },
    { value: "last-frame", label: "last frame" }, { value: "rhythm", label: "rhythm reference" }, { value: "sound", label: "sound reference" },
];
export function assistantAttachmentPurposes(kind: AssistantAttachment["kind"]) {
    const allowed: Record<AssistantAttachment["kind"], AssistantAttachmentPurpose[]> = {
        image: ["analysis", "character", "scene", "style", "first-frame", "last-frame"],
        video: ["analysis", "character", "scene", "style", "motion", "rhythm"],
        audio: ["analysis", "rhythm", "sound"],
    };
    return ASSISTANT_ATTACHMENT_PURPOSES.filter(item => allowed[kind].includes(item.value));
}
export function attachmentKind(mimeType: string): AssistantAttachment["kind"] | null {
    return mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : null;
}
export function attachmentRangeError(attachment: AssistantAttachment): string | null {
    if (attachment.start === undefined && attachment.end === undefined) return null;
    const start = attachment.start ?? 0, end = attachment.end;
    if (!Number.isFinite(start) || start < 0 || end === undefined || !Number.isFinite(end) || end <= start) return "Please fill in the valid start and end time (seconds)";
    if (attachment.durationMs && end * 1000 > attachment.durationMs + 50) return "The end time exceeds the material duration";
    return null;
}
export async function uploadAssistantAttachment(file: File, identity = nanoid()): Promise<AssistantAttachment> {
    const kind = attachmentKind(file.type);
    if (!kind) throw new Error("Please select an image, video or audio file");
    const metadata: MediaMetadata | undefined = kind === "image" ? await readUploadImageSize(file) : await probeMediaMetadata(file);
    const resource = await uploadResourceFile(file, kind, { ...metadata, fileName: file.name, idempotencyKey: `assistant:${identity}` });
    if (!resource.id || resource.status !== "ready") throw new Error("The material file has not been saved successfully, please try uploading again.");
    const url = resourceFileUrl(resource.id), now = new Date().toISOString();
    const positive = (value?: number) => value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
    const durationMs = positive(resource.durationMs) ?? metadata?.durationMs;
    const asset = parseAssetRecord({ id: identity, kind, title: file.name, coverUrl: kind === "image" ? url : "", category: "material", tags: [], status: "confirmed",
        source: "Creation Assistant", createdAt: now, updatedAt: now,
        data: { ...(kind === "image" ? { dataUrl: url } : { url }), storageKey: resourceStorageKey(resource.id),
            width: metadata?.width ?? positive(resource.width) ?? 0, height: metadata?.height ?? positive(resource.height) ?? 0,
            durationMs, bytes: resource.size || file.size, mimeType: resource.mimeType || file.type },
    });
    const receipt = await putWorkspaceAsset(identity, asset);
    if (receipt.asset?.id !== identity) throw new Error("Material registration is not completed, please reload the material library and try again");
    // This is an accepted canonical write, not a second asset or a new local draft.
    runAssetStoreProjection(() => useAssetStore.setState(state => {
        const live = state.assets.find(item => item.id === identity);
        const saved = live || parseAssetRecord({ ...asset, ...mergeWorkspaceAssetReceipt(asset, asset, receipt.asset),
            createdAt: receipt.asset.createdAt || asset.createdAt, updatedAt: receipt.asset.updatedAt || asset.updatedAt });
        return { assets: live ? state.assets : [...state.assets, saved] };
    }));
    return { resourceId: resource.id, assetId: identity, kind, name: file.name, mimeType: resource.mimeType || file.type, bytes: resource.size || file.size, durationMs, purpose: "analysis" };
}
export function attachmentFromCanvasReference(reference: CanvasResourceReference): AssistantAttachment {
    if (!["image", "video", "audio"].includes(reference.kind)) throw new Error("Please select pictures, videos or audio materials");
    const resourceId = ownedResourceIdFromMediaRef(reference.storageKey, reference.mediaUrl || reference.previewUrl);
    if (!resourceId) throw new Error("This material has not been saved to the workspace, please save the material first");
    return { resourceId, kind: reference.kind as AssistantAttachment["kind"], name: reference.title || reference.label, mimeType: "", bytes: 0,
        purpose: "analysis", ...(reference.assetId ? { assetId: reference.assetId } : { nodeId: reference.nodeId }) };
}
const drafts = localforage.createInstance({ name: "beeftv-assistant-input", storeName: "drafts" });
const draftWrites = new Map<string, Promise<unknown>>();
export type AssistantInputDraft = { text: string; attachments: AssistantAttachment[]; skills: AssistantSkillSelection[];
    resultSelection?: { sessionId: string; nodeIds: string[] } | null };
export async function readAssistantInputDraft(canvasId: string) {
    const key = `${getActiveUserScope()}:${canvasId}`;
    await draftWrites.get(key)?.catch(() => undefined);
    return drafts.getItem<AssistantInputDraft>(key);
}
export async function saveAssistantInputDraft(canvasId: string, draft: AssistantInputDraft) {
    const key = `${getActiveUserScope()}:${canvasId}`;
    const write = (draftWrites.get(key) || Promise.resolve()).catch(() => undefined).then(() => drafts.setItem(key, draft));
    draftWrites.set(key, write);
    try { await write; } finally { if (draftWrites.get(key) === write) draftWrites.delete(key); }
}
