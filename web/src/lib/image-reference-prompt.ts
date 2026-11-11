import type { ReferenceImage } from "@/types/image";

export function imageReferenceLabel(index: number) {
    return `pictures${index + 1}`;
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    void references;
    return prompt.trim();
}
