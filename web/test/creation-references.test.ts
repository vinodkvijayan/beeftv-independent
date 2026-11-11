import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "../src/lib/canvas/canvas-resource-references";
import { creationAttachmentKind, creationFileAccepted, creationMediaAspectRatio, creationUploadAccept, type CreationAttachment } from "../src/pages/create/creation-assets";
import { buildCreationMentionReferences, displayCreationPrompt, reconcileCreationAttachmentLimit, removeCreationReferenceTokens, replaceCreationAttachmentReference, selectedCreationReferences } from "../src/pages/create/creation-references";

function imageAttachment(id: string): CreationAttachment {
    return {
        id,
        name: `${id}.png`,
        type: "image/png",
        dataUrl: `data:image/png;base64,${id}`,
        previewUrl: `data:image/png;base64,${id}`,
    };
}

describe("creation references", () => {
    test("removes attachments and prompt tokens beyond the current model limit", () => {
        const attachments = [imageAttachment("first"), imageAttachment("second"), imageAttachment("third")];
        const references = buildCreationMentionReferences([], attachments);
        const result = reconcileCreationAttachmentLimit(attachments, references, { image: 1 });
        const prompt = references.map(canvasResourceMentionToken).join(" ");
        const nextPrompt = removeCreationReferenceTokens(prompt, result.removedReferences);

        expect(result.attachments).toEqual([attachments[0]]);
        expect(result.removedReferences.map((reference) => reference.attachmentId)).toEqual(["second", "third"]);
        expect(nextPrompt).toContain(canvasResourceMentionToken(references[0]));
        expect(nextPrompt).not.toContain(canvasResourceMentionToken(references[1]));
        expect(nextPrompt).not.toContain(canvasResourceMentionToken(references[2]));
    });

    test("returns the original attachment list when it is already within the limit", () => {
        const attachments = [imageAttachment("first")];
        const result = reconcileCreationAttachmentLimit(attachments, buildCreationMentionReferences([], attachments), { image: 1 });

        expect(result.attachments).toBe(attachments);
        expect(result.removedReferences).toEqual([]);
    });

    test("Text creation allows media and common documents, image creation still only accepts images", () => {
        expect(creationFileAccepted("text", { name: "story.pdf", type: "application/pdf" })).toBe(true);
        expect(creationFileAccepted("text", { name: "clip.mp4", type: "video/mp4" })).toBe(true);
        expect(creationFileAccepted("image", { name: "story.pdf", type: "application/pdf" })).toBe(false);
        expect(creationUploadAccept("text")).toContain(".docx");
    });

    test("Document attachments will be referenced as text resources", () => {
        const attachment: CreationAttachment = { id: "document", name: "script.pdf", type: "application/pdf", url: "https://example.com/script.pdf", storageKey: "resource:document", bytes: 1024, previewUrl: "" };
        const [reference] = buildCreationMentionReferences([], [attachment]);

        expect(creationAttachmentKind(attachment)).toBe("file");
        expect(reference.kind).toBe("text");
        expect(reference.label).toBe("File 1");
    });

    test("Different attachment types are numbered according to their own order of introduction.", () => {
        const audio: CreationAttachment = { id: "audio", name: "audio.mp3", type: "audio/mpeg", url: "blob:audio", storageKey: "audio:key", previewUrl: "" };
        const references = buildCreationMentionReferences([], [imageAttachment("first"), audio, imageAttachment("second")]);

        expect(references.map((reference) => reference.label)).toEqual(["Picture 1", "Audio 1", "Picture 2"]);
    });

    test("The media placeholder is displayed according to the selected frame and provides mode fallback for outliers.", () => {
        expect(creationMediaAspectRatio("16:9", "video")).toBe("16 / 9");
        expect(creationMediaAspectRatio("1:1", "image")).toBe("1 / 1");
        expect(creationMediaAspectRatio("1920x1080", "image")).toBe("1920 / 1080");
        expect(creationMediaAspectRatio("auto", "video")).toBe("16 / 9");
        expect(creationMediaAspectRatio("auto", "image")).toBe("1 / 1");
    });

    test("When replacing pictures, the target position is retained and the prompt word does not need to be modified.", () => {
        const attachments = [imageAttachment("first"), imageAttachment("second"), imageAttachment("third")];
        const references = buildCreationMentionReferences([], attachments);
        const oldToken = canvasResourceMentionToken(references[1]);
        const replacement = imageAttachment("replacement");

        const result = replaceCreationAttachmentReference(`let${oldToken} close${oldToken}`, attachments, "second", replacement);
        const nextReferences = buildCreationMentionReferences([], result.attachments);
        const replacementReference = nextReferences.find((reference) => reference.attachmentId === replacement.id)!;
        const replacementToken = canvasResourceMentionToken(replacementReference);

        expect(result.attachments.map((attachment) => attachment.id)).toEqual(["first", "replacement", "third"]);
        expect(replacementReference.label).toBe("Picture 2");
        expect(result.prompt).toBe(`let${replacementToken} close${replacementToken}`);
        expect(result.prompt).not.toContain(oldToken);
        expect(displayCreationPrompt(result.prompt, nextReferences)).toBe("Let @Picture2 get closer to @Picture2");
    });

    test("After deleting the intermediate attachment, only the reference to the attachment is removed, and subsequent attachments are still retained as stable identities.", () => {
        const attachments = ["first", "second", "third", "fourth", "fifth"].map(imageAttachment);
        const references = buildCreationMentionReferences([], attachments);
        const third = references[2];
        const fifth = references[4];
        const prompt = `Compare before deletion${canvasResourceMentionToken(third)} and${canvasResourceMentionToken(fifth)}`;
        const remaining = attachments.filter((attachment) => attachment.id !== "third");
        const nextPrompt = removeCreationReferenceTokens(prompt, [third]);
        const nextReferences = buildCreationMentionReferences([], remaining);

        expect(nextPrompt).not.toContain(canvasResourceMentionToken(third));
        expect(nextPrompt).toContain(canvasResourceMentionToken(fifth));
        expect(selectedCreationReferences(nextPrompt, nextReferences).map((reference) => reference.attachmentId)).toEqual(["fifth"]);
        expect(displayCreationPrompt(nextPrompt, nextReferences)).toBe("Compare before deletion and @Picture 4");
    });

    test("Replacement will normalize visible tags and remove existing duplicate attachments", () => {
        const attachments = [imageAttachment("source"), imageAttachment("target"), imageAttachment("third")];
        const result = replaceCreationAttachmentReference("Let @picture2 refer to @picture2.", attachments, "target", attachments[0]);
        const references = buildCreationMentionReferences([], result.attachments);
        const sourceReference = references.find((reference) => reference.attachmentId === "source")!;

        expect(result.attachments.map((attachment) => attachment.id)).toEqual(["third", "source"]);
        expect(sourceReference.label).toBe("Picture 2");
        expect(result.prompt).toBe(`let${canvasResourceMentionToken(sourceReference)} Reference${canvasResourceMentionToken(sourceReference)}。`);
    });

    test("Reject replacement when target attachment does not exist", () => {
        expect(() => replaceCreationAttachmentReference("", [imageAttachment("first")], "missing", imageAttachment("next"))).toThrow("The reference content to be replaced does not exist");
    });
});
