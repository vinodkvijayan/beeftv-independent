import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { assertCanvasImageReferenceTable, type CanvasImageTableReference } from "@/lib/canvas/canvas-reference-table";

export type BoundMediaMention = {
    token: string;
    kind: "image" | "video" | "audio";
    referenceId: string;
};

export type CharacterReferenceBinding = {
    role: number;
    name: string;
    imageIds: string[];
    audioIds: string[];
};

type ReferenceContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    boundMediaMentions?: BoundMediaMention[];
    imageReferenceTableReferences?: CanvasImageTableReference[];
};

/** Render only bound tokens. Free text and legacy positional references keep their original meaning. */
export function compileBoundMediaReferences<T extends ReferenceContext>(context: T, firstMentionOrder: boolean): T {
    const bindings = new Map((context.boundMediaMentions || []).map((binding) => [binding.token, binding]));
    const hasLegacySlots = /@(图片|视频|音频|绘图)\d+/u.test(context.prompt);
    const occurrences = Array.from(context.prompt.matchAll(/@\[(?:node|asset):[^\]]+\]/gu));
    const mentions = occurrences.map((match) => {
        const binding = bindings.get(match[0]);
        if (!binding) throw new Error(`Quote${match[0]} There is no corresponding material, please select again and generate again.`);
        return binding;
    });
    const reorder = <R extends { id: string }>(items: R[], kind: BoundMediaMention["kind"]): R[] => {
        if (!firstMentionOrder || hasLegacySlots) return items;
        const byId = new Map(items.map((item) => [item.id, item]));
        const ids = [...new Set(mentions.filter((mention) => mention.kind === kind).map((mention) => mention.referenceId))];
        return [...ids.map((id) => {
            const item = byId.get(id);
            if (!item) throw new Error("The referenced material is no longer available, please select it again and generate it again.");
            return item;
        }), ...items.filter((item) => !ids.includes(item.id))];
    };
    const referenceImages = reorder(context.referenceImages, "image");
    const referenceVideos = reorder(context.referenceVideos, "video");
    const referenceAudios = reorder(context.referenceAudios, "audio");
    const labels = new Map<string, string>();
    const boundImageSlots = new Map<string, number>();
    const arrays = { image: referenceImages, video: referenceVideos, audio: referenceAudios };
    const names = { image: "pictures", video: "video", audio: "Audio" };
    mentions.forEach((binding) => {
        const index = arrays[binding.kind].findIndex((item) => item.id === binding.referenceId);
        if (index < 0) throw new Error("The referenced material is no longer available, please select it again and generate it again.");
        labels.set(binding.token, `@${names[binding.kind]}${index + 1}`);
        if (binding.kind === "image") boundImageSlots.set(binding.token.slice(1), index + 1);
    });
    const tableReferencesById = new Map((context.imageReferenceTableReferences || []).map((image) => [image.id, image]));
    // Check the original table's explicit bindings against the final upload order.
    // Saved labels/names remain useful here; synthetic file names cannot replace them.
    assertCanvasImageReferenceTable(context.prompt, referenceImages.map((image, index) => tableReferencesById.get(image.id) || {
        title: image.name, label: `pictures${index + 1}`,
    }), boundImageSlots);
    return {
        ...context,
        prompt: context.prompt.replace(/@\[(?:node|asset):[^\]]+\]/gu, (token) => labels.get(token)!),
        referenceImages, referenceVideos, referenceAudios,
    };
}

export function renderCharacterReferenceBindings(bindings: CharacterReferenceBinding[], context: ReferenceContext) {
    const labels = (ids: string[], items: { id: string }[], kind: string) => ids.map((id) => {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("The character reference material is no longer available, please select again and generate again.");
        return `@${kind}${index + 1}`;
    });
    return `[Characters and Reference Materials]${bindings.map((binding) => {
        const images = labels(binding.imageIds, context.referenceImages, "pictures");
        const audios = labels(binding.audioIds, context.referenceAudios, "Audio");
        return [
            `@role${binding.role} with "${binding.name}” refers to the same role.`,
            images.length && `Appearance reference for this character${images.join("、")}, these pictures all belong to the same character.`,
            audios.length && `The character’s voice reference${audios.join("、")}。`,
        ].filter(Boolean).join("");
    }).join("\n")}`;
}
