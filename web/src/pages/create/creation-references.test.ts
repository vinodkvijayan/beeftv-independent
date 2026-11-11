import assert from "node:assert/strict";
import test from "node:test";

import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { CreationAttachment } from "./creation-assets";
// Node 原生 TypeScript 测试运行器要求保留扩展名，项目编译器不允许该写法。
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { creationReferenceHasRoom, creationReferenceKindMessage, creationReferenceLimit, creationReferenceLimitsFor, creationReferenceLimitsLabel, fitCreationAttachmentsToLimits, reconcileCreationAttachmentLimit, referenceOverflowKind, type CreationReferenceLimits } from "./creation-references.ts";

const seedanceLimits: CreationReferenceLimits = { image: 9, video: 3, audio: 3 };

function attachment(id: string, kind: "image" | "video" | "audio" | "file"): CreationAttachment {
    const type = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "text/plain";
    return { id, name: `${id}.dat`, type, size: 1, url: `https://example.com/${id}` } as unknown as CreationAttachment;
}

function capabilities(overrides: Partial<ModelCapabilityConfig>): ModelCapabilityConfig {
    return overrides as unknown as ModelCapabilityConfig;
}

test("The video mode takes the upper limit according to the official classification type and no longer combines the total number.", () => {
    const limits = creationReferenceLimitsFor(
        "video",
        capabilities({
            video: { operations: ["image_to_video"], references: { maxImages: 9, maxVideos: 3, maxAudios: 3 } },
        } as unknown as Partial<ModelCapabilityConfig>),
    );

    assert.deepEqual(limits, { image: 9, video: 3, audio: 3 });
    assert.equal(creationReferenceLimitsLabel(limits), "9 reference pictures, 3 reference videos, 3 reference audio clips");
});

test("When the video mode does not support reference materials, all three categories are set to 0 and cannot be reduced to the upper limit of the total number.", () => {
    const limits = creationReferenceLimitsFor(
        "video",
        capabilities({ video: { operations: ["text_to_video"], references: { maxImages: 9, maxVideos: 3, maxAudios: 3 } } } as unknown as Partial<ModelCapabilityConfig>),
    );

    assert.deepEqual(limits, { image: 0, video: 0, audio: 0 });
});

test("Picture mode only limits reference pictures", () => {
    const limits = creationReferenceLimitsFor("image", capabilities({ image: { references: { maxImages: 4 } } } as unknown as Partial<ModelCapabilityConfig>));

    assert.equal(creationReferenceLimit(limits, "image"), 4);
    assert.equal(creationReferenceLimit(limits, "video"), 0);
    assert.equal(creationReferenceLimit(limits, "audio"), 0);
});

test("When the ability is explicitly configured in text mode, it follows the upper limit of images and videos declared by it, but there is no upper limit for audio and documents.", () => {
    const limits = creationReferenceLimitsFor(
        "text",
        capabilities({ text: { references: { maxImages: 2, maxVideos: 1 } } } as unknown as Partial<ModelCapabilityConfig>),
        { textReferencesDeclared: true },
    );

    assert.equal(creationReferenceLimit(limits, "image"), 2);
    assert.equal(creationReferenceLimit(limits, "video"), 1);
    assert.equal(creationReferenceLimit(limits, "audio"), undefined);
    assert.equal(creationReferenceLimit(limits, "file"), undefined);
});

test("Text models without capabilityConfig get the default value of 0 and cannot be regarded as not supporting reference materials.", () => {
    // 自定义文字渠道没有能力配置时，modelCapabilityConfigFor 补出的是 0/0。
    const defaulted = capabilities({ text: { references: { maxImages: 0, maxVideos: 0 } } } as unknown as Partial<ModelCapabilityConfig>);
    const limits = creationReferenceLimitsFor("text", defaulted, { textReferencesDeclared: false });

    assert.deepEqual(limits, {});
    assert.equal(creationReferenceLimit(limits, "image"), undefined);
    assert.equal(creationReferenceLimit(limits, "video"), undefined);

    const attachments = [attachment("image-0", "image"), attachment("video-0", "video")];
    const fitted = fitCreationAttachmentsToLimits(attachments, limits);
    assert.equal(fitted.attachments.length, 2);
    assert.equal(fitted.dropped.length, 0);
    assert.equal(referenceOverflowKind(limits, attachments), undefined);
    assert.equal(creationReferenceHasRoom(limits, { image: 99, video: 99, audio: 0, file: 0 }, "image"), true);
});

test("When the text model explicitly declares 0 reference images, it is still intercepted according to the declaration.", () => {
    const limits = creationReferenceLimitsFor(
        "text",
        capabilities({ text: { references: { maxImages: 0, maxVideos: 0 } } } as unknown as Partial<ModelCapabilityConfig>),
        { textReferencesDeclared: true },
    );

    assert.equal(creationReferenceLimit(limits, "image"), 0);
    assert.equal(creationReferenceKindMessage(limits, attachment("image-0", "image")), "The current model does not support reference drawings");
});

test("9 pictures + 3 videos + 3 audios are optional at the same time, and will not be cut off because the total exceeds 9", () => {
    const attachments = [
        ...Array.from({ length: 9 }, (_, index) => attachment(`image-${index}`, "image")),
        ...Array.from({ length: 3 }, (_, index) => attachment(`video-${index}`, "video")),
        ...Array.from({ length: 3 }, (_, index) => attachment(`audio-${index}`, "audio")),
    ];

    const fitted = fitCreationAttachmentsToLimits(attachments, seedanceLimits);

    assert.equal(fitted.attachments.length, 15);
    assert.equal(fitted.dropped.length, 0);
    assert.equal(referenceOverflowKind(seedanceLimits, attachments), undefined);
});

test("If it exceeds a certain category, only drop this category and explain which category it is.", () => {
    const attachments = [
        ...Array.from({ length: 10 }, (_, index) => attachment(`image-${index}`, "image")),
        attachment("video-0", "video"),
    ];

    const fitted = fitCreationAttachmentsToLimits(attachments, seedanceLimits);

    assert.equal(fitted.attachments.filter((item) => item.type.startsWith("video")).length, 1);
    assert.deepEqual(fitted.dropped.map((item) => item.id), ["image-9"]);
    assert.equal(creationReferenceKindMessage(seedanceLimits, fitted.dropped[0]), "Up to 9 reference pictures");
    assert.equal(referenceOverflowKind(seedanceLimits, attachments), "image");
});

test("When it is lower than the upper limit, it will not be cropped, and the reference marks will also be cleared together.", () => {
    const attachments = [attachment("image-0", "image"), attachment("audio-0", "audio")];
    const references = [
        { id: "ref-image", attachmentId: "image-0" },
        { id: "ref-audio", attachmentId: "audio-0" },
    ] as never;

    const reconciled = reconcileCreationAttachmentLimit(attachments, references, { image: 1, audio: 0 });

    assert.deepEqual(reconciled.attachments.map((item) => item.id), ["image-0"]);
    assert.deepEqual(reconciled.removedReferences.map((item: { id: string }) => item.id), ["ref-audio"]);
});

test("Allow more to be added when there are still vacancies", () => {
    const counts = { image: 9, video: 1, audio: 3, file: 0 };

    assert.equal(creationReferenceHasRoom(seedanceLimits, counts, "image"), false);
    assert.equal(creationReferenceHasRoom(seedanceLimits, counts, "video"), true);
    assert.equal(creationReferenceHasRoom(seedanceLimits, counts, "audio"), false);
    assert.equal(creationReferenceHasRoom(seedanceLimits, counts, "file"), true);
});
