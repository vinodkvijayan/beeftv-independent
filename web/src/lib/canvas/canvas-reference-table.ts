export type CanvasImageTableReference = { id: string; title: string; label: string };

/** Check explicit IMAGE table bindings against the final submitted image order. */
export function assertCanvasImageReferenceTable(prompt: string, images: readonly { title: string; label: string }[], boundSlots: ReadonlyMap<string, number> = new Map()) {
    const slotsByLabel = new Map(images.map((image, index) => [image.label, index + 1]));
    const slotsByName = new Map<string, number | null>();
    images.forEach((image, index) => {
        const title = image.title.trim();
        if (!title) return;
        slotsByName.set(title, slotsByName.has(title) ? null : index + 1);
    });
    for (const row of prompt.matchAll(/^\s*\|\s*IMAGE\s+(\d+)\s*\|\s*[`"']?@([^\s`"'|]+)[`"']?/gimu)) {
        const declaredSlot = Number(row[1]);
        const actualSlot = boundSlots.get(row[2]) ?? slotsByLabel.get(row[2]) ?? slotsByName.get(row[2]);
        if (!actualSlot || actualSlot === declaredSlot) continue;
        throw new Error(`IMAGE in the material table${declaredSlot} Corresponding picture${actualSlot}, the numbers are inconsistent. Please unify the material order and prompt word number before generating`);
    }
}
