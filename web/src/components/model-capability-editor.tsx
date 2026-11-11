import { ImageSizePresetsEditor } from "./image-size-presets-editor";
import { imageSizeConfigWithPresets, imageSizePresets } from "@/lib/image-size-presets";
import { Button, Input, InputNumber, Select } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import type { ReactNode } from "react";

import { defaultImageCapabilityConfig, defaultModelCapabilityConfig, imageResponseFormatSelectable, normalizeModelCapabilityConfig, type ImageCapabilityConfig, type ImageResponseFormatConfig, type ModelCapabilityConfig, type TextCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";
import { VIDEO_RESOLUTION_CAPABILITY_OPTIONS } from "@/lib/video-generation-options";

const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const ratioOptionLabel = (item: string) => (item === "adaptive" ? "adaptive" : item);
const operationOptions = [
    { label: "Vincent Video", value: "text_to_video" },
    { label: "tusheng video", value: "image_to_video" },
    { label: "Full modal reference", value: "reference_to_video" },
    { label: "Video continuation", value: "extend" },
    { label: "local modification", value: "inpaint" },
    { label: "element replacement", value: "replace_element" },
    { label: "Mirror movement adjustment", value: "camera_motion" },
    { label: "style transfer", value: "style_transfer" },
    { label: "Audio produces video", value: "audio_to_video" },
    { label: "Convert sample to film", value: "draft_to_final" },
];

function ImageSizeHelp() {
    return <p className="text-[var(--fs-label)] leading-relaxed text-foreground/60">Configure supported ratios according to resolution, and automatically convert sizes. size sends pixels, aspect_ratio sends ratio; independent resolutions are adapted by the model protocol. The actual output size is subject to upstream.</p>;
}

type Props = {
    value?: ModelCapabilityConfig;
    onChange?: (value: ModelCapabilityConfig) => void;
    protocol?: ModelProtocol;
    capability?: "text" | "image" | "video";
    model?: string;
    disabled?: boolean;
    section?: "all" | "protocol" | "references";
};

export function ModelCapabilityEditor({ value, onChange, protocol, capability = "video", model = "", disabled = false, section = "all" }: Props) {
    if (capability === "text") {
        return <TextCapabilityEditor value={value} onChange={onChange} protocol={protocol} disabled={disabled} section={section} />;
    }
    if (capability === "image") {
        return <ImageCapabilityEditor value={value} onChange={onChange} protocol={protocol} model={model} disabled={disabled} section={section} />;
    }
    const defaults = defaultModelCapabilityConfig(protocol, model).video!;
    const profile = normalizeModelCapabilityConfig(value || { version: 1, video: defaults }).video!;
    const update = (patch: Partial<VideoCapabilityConfig>) => onChange?.({ version: 1, video: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<VideoCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateDuration = (patch: Partial<VideoCapabilityConfig["duration"]>) => update({ duration: { ...profile.duration, ...patch } });
    const updateDraft = (draft: { supported: boolean; default: boolean }) => {
        const operations = draft.supported
            ? Array.from(new Set([...profile.operations, "draft_to_final"]))
            : profile.operations.filter((item) => item !== "draft_to_final");
        update({ draft, operations });
    };
    const durationValues = (profile.duration.values || []).join(",");
    const resolutionOptions = Array.from(new Set([...VIDEO_RESOLUTION_CAPABILITY_OPTIONS, ...profile.resolutions]));

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid">
                    <ReferenceCard title="Image Quote" description="First frame, reference image and multi-image input restrictions">
                        <NumberField label="Minimum image citation" value={profile.references.minImages} min={0} max={profile.references.maxImages} disabled={disabled} onChange={(value) => updateReferences({ minImages: value || 0 })} />
                        <NumberField
                            label="Maximum image quotes"
                            value={profile.references.maxImages}
                            min={0}
                            disabled={disabled}
                            onChange={(value) => {
                                const maxImages = value || 0;
                                updateReferences({ maxImages, minImages: Math.min(profile.references.minImages, maxImages) });
                            }}
                        />
                        <NumberField label="Maximum MB for a single image" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImageBytes: mbToBytes(value) })} />
                    </ReferenceCard>
                    <ReferenceCard title="audio quotes" description="Audio input and sync output limitations">
                        <NumberField label="maximum audio citation" value={profile.references.maxAudios} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudios: value || 0 })} />
                        <NumberField label="Single audio limit MB" value={bytesToMB(profile.references.maxAudioBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioBytes: mbToBytes(value) })} />
                        <NumberField label="The longest number of seconds for a single audio" value={profile.references.maxAudioDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioDurationSeconds: value || 0 })} />
                        <BooleanField label="Sync audio" value={profile.generateAudio} disabled={disabled} onChange={(generateAudio) => update({ generateAudio })} />
                    </ReferenceCard>
                    <ReferenceCard title="video quotes" description="Video quantity, size and duration limits">
                        <NumberField label="Maximum video citations" value={profile.references.maxVideos} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideos: value || 0 })} />
                        <NumberField label="Maximum MB for a single video" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoBytes: mbToBytes(value) })} />
                        <NumberField label="The longest number of seconds in a single video" value={profile.references.maxVideoDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoDurationSeconds: value || 0 })} />
                    </ReferenceCard>
                    <ReferenceCard title="General restrictions" description="Basic constraints common to all video requests">
                        <VideoPromptLimitFields references={profile.references} defaults={defaults.references} disabled={disabled} onChange={updateReferences} />
                        <BooleanField label="watermark" value={profile.watermark} disabled={disabled} onChange={(watermark) => update({ watermark })} />
                        <BooleanField label="Sample preview (480P)" value={profile.draft || { supported: false, default: false }} disabled={disabled} onChange={updateDraft} />
                        <BooleanField label="Return lossless last frame" value={profile.returnLastFrame || { supported: false, default: false }} disabled={disabled} onChange={(returnLastFrame) => update({ returnLastFrame })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    if (section === "protocol") {
        return (
            <div className="admin-capability-protocol-editor">
                <div className="admin-capability-protocol-grid">
                    <ProtocolParameterCard step="01" title="Generation method" description="Allowed task types and default tasks">
                        <Field label="Support mode">
                            <Select
                                mode="multiple"
                                className="w-full"
                                disabled={disabled}
                                value={profile.operations}
                                options={operationOptions}
                                onChange={(operations) => update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] || "text_to_video" })}
                            />
                        </Field>
                        <Field label="Default mode">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.defaultOperation}
                                options={operationOptions.filter((item) => profile.operations.includes(item.value))}
                                onChange={(defaultOperation) => update({ defaultOperation })}
                            />
                        </Field>
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="02" title="Output duration" description="Define available seconds and default duration">
                        <SegmentedControl
                            block
                            disabled={disabled}
                            value={profile.duration.selection}
                            options={[
                                { label: "range", value: "range" },
                                { label: "fixed value", value: "enum" },
                            ]}
                            onChange={(value) =>
                                updateDuration(
                                    value === "enum"
                                        ? { selection: "enum", values: profile.duration.values?.length ? profile.duration.values : [profile.duration.default] }
                                        : { selection: "range", min: profile.duration.min || 1, max: profile.duration.max || 15, step: profile.duration.step || 1 },
                                )
                            }
                        />
                        {profile.duration.selection === "enum" ? (
                            <Field label="Fixed duration (seconds)">
                                <Input
                                    disabled={disabled}
                                    value={durationValues}
                                    placeholder="For example: 5,10"
                                    onChange={(event) => updateDuration({ values: parseIntegerList(event.target.value), default: parseIntegerList(event.target.value)[0] || profile.duration.default })}
                                />
                            </Field>
                        ) : (
                            <div className="admin-capability-duration-grid">
                                <NumberField label="shortest" value={profile.duration.min} min={1} disabled={disabled} onChange={(value) => updateDuration({ min: value || 1 })} />
                                <NumberField label="longest" value={profile.duration.max} min={1} disabled={disabled} onChange={(value) => updateDuration({ max: value || 1 })} />
                                <NumberField label="step size" value={profile.duration.step} min={1} disabled={disabled} onChange={(value) => updateDuration({ step: value || 1 })} />
                                <NumberField label="Default" value={profile.duration.default} min={1} disabled={disabled} onChange={(value) => updateDuration({ default: value || 1 })} />
                            </div>
                        )}
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="03" title="Screen specifications" description="Control scale, resolution and default output">
                        <div className="admin-capability-spec-grid">
                            <Field label="Support ratio">
                                <Select
                                    mode="multiple"
                                    className="w-full"
                                    disabled={disabled}
                                    value={profile.ratios}
                                    options={ratioOptions.map((item) => ({ label: ratioOptionLabel(item), value: item }))}
                                    onChange={(ratios) => update({ ratios, defaultRatio: ratios.includes(profile.defaultRatio) ? profile.defaultRatio : ratios[0] || "16:9" })}
                                />
                            </Field>
                            <Field label="Default scale">
                                <Select className="w-full" disabled={disabled} value={profile.defaultRatio} options={profile.ratios.map((item) => ({ label: ratioOptionLabel(item), value: item }))} onChange={(defaultRatio) => update({ defaultRatio })} />
                            </Field>
                            <Field label="Output resolution">
                                <Select
                                    mode="tags"
                                    className="admin-capability-tags w-full"
                                    disabled={disabled}
                                    value={profile.resolutions}
                                    tokenSeparators={[","]}
                                    placeholder="Select or enter model level"
                                    options={resolutionOptions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                    onChange={(resolutions) => update({ resolutions, defaultResolution: resolutions.includes(profile.defaultResolution) ? profile.defaultResolution : resolutions[0] || "" })}
                                />
                            </Field>
                            <Field label="Default resolution">
                                <Select
                                    className="w-full"
                                    disabled={disabled}
                                    value={profile.defaultResolution}
                                    options={profile.resolutions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                    onChange={(defaultResolution) => update({ defaultResolution })}
                                />
                            </Field>
                        </div>
                    </ProtocolParameterCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="admin-capability-editor-heading flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">Video capability parameters</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">These parameters will be synchronized to the creation page, canvas and generated validation</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">The agreement template can continue to be adjusted</span>
            </div>

            <CapabilityGroup title="video" description="Generation method, output specifications and video reference constraints">
                <CapabilityBlock title="Generation method">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Support mode">
                            <Select
                                mode="multiple"
                                className="w-full"
                                disabled={disabled}
                                value={profile.operations}
                                options={operationOptions}
                                onChange={(operations) => update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] || "text_to_video" })}
                            />
                        </Field>
                        <Field label="Default mode">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.defaultOperation}
                                options={operationOptions.filter((item) => profile.operations.includes(item.value))}
                                onChange={(defaultOperation) => update({ defaultOperation })}
                            />
                        </Field>
                    </div>
                </CapabilityBlock>
                <CapabilityBlock title="Output duration">
                    <SegmentedControl
                        block
                        disabled={disabled}
                        value={profile.duration.selection}
                        options={[
                            { label: "range", value: "range" },
                            { label: "fixed value", value: "enum" },
                        ]}
                        onChange={(value) =>
                            updateDuration(
                                value === "enum"
                                    ? { selection: "enum", values: profile.duration.values?.length ? profile.duration.values : [profile.duration.default] }
                                    : { selection: "range", min: profile.duration.min || 1, max: profile.duration.max || 15, step: profile.duration.step || 1 },
                            )
                        }
                    />
                    {profile.duration.selection === "enum" ? (
                        <Field label="Fixed duration (seconds)">
                            <Input
                                disabled={disabled}
                                value={durationValues}
                                placeholder="For example: 5,10"
                                onChange={(event) => updateDuration({ values: parseIntegerList(event.target.value), default: parseIntegerList(event.target.value)[0] || profile.duration.default })}
                            />
                        </Field>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <NumberField label="shortest" value={profile.duration.min} min={1} disabled={disabled} onChange={(value) => updateDuration({ min: value || 1 })} />
                            <NumberField label="longest" value={profile.duration.max} min={1} disabled={disabled} onChange={(value) => updateDuration({ max: value || 1 })} />
                            <NumberField label="step size" value={profile.duration.step} min={1} disabled={disabled} onChange={(value) => updateDuration({ step: value || 1 })} />
                            <NumberField label="Default" value={profile.duration.default} min={1} disabled={disabled} onChange={(value) => updateDuration({ default: value || 1 })} />
                        </div>
                    )}
                </CapabilityBlock>
                <CapabilityBlock title="Screen specifications">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="aspect ratio">
                            <Select
                                mode="multiple"
                                className="w-full"
                                disabled={disabled}
                                value={profile.ratios}
                                options={ratioOptions.map((item) => ({ label: ratioOptionLabel(item), value: item }))}
                                onChange={(ratios) => update({ ratios, defaultRatio: ratios.includes(profile.defaultRatio) ? profile.defaultRatio : ratios[0] || "16:9" })}
                            />
                        </Field>
                        <Field label="Default scale">
                            <Select className="w-full" disabled={disabled} value={profile.defaultRatio} options={profile.ratios.map((item) => ({ label: ratioOptionLabel(item), value: item }))} onChange={(defaultRatio) => update({ defaultRatio })} />
                        </Field>
                        <Field label="Output resolution">
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.resolutions}
                                tokenSeparators={[","]}
                                placeholder="Select a standard gear or enter a model-specific value such as 768p"
                                options={resolutionOptions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                onChange={(resolutions) => update({ resolutions, defaultResolution: resolutions.includes(profile.defaultResolution) ? profile.defaultResolution : resolutions[0] || "" })}
                            />
                        </Field>
                        <Field label="Default resolution">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.defaultResolution}
                                options={profile.resolutions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                onChange={(defaultResolution) => update({ defaultResolution })}
                            />
                        </Field>
                    </div>
                </CapabilityBlock>
                {section === "all" ? (
                    <CapabilityBlock title="video quotes">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <NumberField label="Maximum video citations" value={profile.references.maxVideos} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideos: value || 0 })} />
                            <NumberField label="Maximum MB for a single video" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoBytes: mbToBytes(value) })} />
                            <NumberField label="The longest number of seconds in a single video" value={profile.references.maxVideoDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoDurationSeconds: value || 0 })} />
                        </div>
                    </CapabilityBlock>
                ) : null}
            </CapabilityGroup>

            {section === "all" ? (
                <>
                    <CapabilityGroup title="pictures" description="First frame, reference image and multi-image input constraints">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <NumberField label="Minimum image citation" value={profile.references.minImages} min={0} max={profile.references.maxImages} disabled={disabled} onChange={(value) => updateReferences({ minImages: value || 0 })} />
                            <NumberField
                                label="Maximum image quotes"
                                value={profile.references.maxImages}
                                min={0}
                                disabled={disabled}
                                onChange={(value) => {
                                    const maxImages = value || 0;
                                    updateReferences({ maxImages, minImages: Math.min(profile.references.minImages, maxImages) });
                                }}
                            />
                            <NumberField label="Maximum MB for a single image" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImageBytes: mbToBytes(value) })} />
                        </div>
                    </CapabilityGroup>

                    <CapabilityGroup title="Audio" description="Audio reference synchronized audio output with video">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <NumberField label="maximum audio citation" value={profile.references.maxAudios} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudios: value || 0 })} />
                            <NumberField label="Single audio limit MB" value={bytesToMB(profile.references.maxAudioBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioBytes: mbToBytes(value) })} />
                            <NumberField label="The longest number of seconds for a single audio" value={profile.references.maxAudioDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioDurationSeconds: value || 0 })} />
                        </div>
                        <BooleanField label="Sync audio" value={profile.generateAudio} disabled={disabled} onChange={(generateAudio) => update({ generateAudio })} />
                    </CapabilityGroup>

                    <CapabilityGroup title="General restrictions" description="Request and output constraints that do not belong to a single media type">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <VideoPromptLimitFields references={profile.references} defaults={defaults.references} disabled={disabled} onChange={updateReferences} />
                            <BooleanField label="watermark" value={profile.watermark} disabled={disabled} onChange={(watermark) => update({ watermark })} />
                            <BooleanField label="Sample preview (480P)" value={profile.draft || { supported: false, default: false }} disabled={disabled} onChange={updateDraft} />
                            <BooleanField label="Return lossless last frame" value={profile.returnLastFrame || { supported: false, default: false }} disabled={disabled} onChange={(returnLastFrame) => update({ returnLastFrame })} />
                        </div>
                    </CapabilityGroup>
                </>
            ) : null}
        </div>
    );
}

function VideoPromptLimitFields({ references, defaults, disabled, onChange }: {
    references: VideoCapabilityConfig["references"];
    defaults: VideoCapabilityConfig["references"];
    disabled: boolean;
    onChange: (value: Partial<VideoCapabilityConfig["references"]>) => void;
}) {
    const usesUtf16 = Boolean(references.promptMaxUtf16Units || (!references.promptMaxChars && defaults.promptMaxUtf16Units));
    return <div className="space-y-2">
        <NumberField label="Maximum number of characters for prompt word" value={usesUtf16 ? references.promptMaxUtf16Units || 0 : references.promptMaxChars} min={0} disabled={disabled} onChange={(value) => onChange(usesUtf16 ? { promptMaxChars: 0, promptMaxUtf16Units: value ?? 0 } : { promptMaxChars: value ?? 0, promptMaxUtf16Units: 0 })} />
        <p className="text-[var(--fs-label)] leading-relaxed text-foreground/60">When set to 0, it will be verified by the service provider.{usesUtf16 ? "This channel is counted in UTF-16, with 2 characters for common emoticons." : ""}</p>
        <Button size="small" disabled={disabled} onClick={() => onChange({ promptMaxChars: defaults.promptMaxChars, promptMaxUtf16Units: defaults.promptMaxUtf16Units || 0 })}>Restore default limits</Button>
    </div>;
}

function TextCapabilityEditor({ value, onChange, protocol, disabled, section }: Pick<Props, "value" | "onChange" | "protocol" | "disabled" | "section">) {
    const profile = value?.text || defaultModelCapabilityConfig(protocol).text!;
    const update = (patch: Partial<TextCapabilityConfig>) => {
        onChange?.({ version: 1, text: { ...profile, ...patch } });
    };
    const updateReferences = (patch: Partial<TextCapabilityConfig["references"]>) => {
        update({ references: { ...profile.references, ...patch } });
    };

    if (section === "protocol") {
        return (
            <div className="admin-capability-editor space-y-3 rounded-md bg-muted/20 p-3">
                <CapabilityGroup title="Output mode" description="Controls how requests to upstream text models are responded to.">
                    <ParameterField label="SSE streaming output" description="Send stream=true when enabled and push text increments in real time; wait for full JSON response when turned off." supported={profile.streaming !== false} disabled={Boolean(disabled)} onChange={(streaming) => update({ streaming })} />
                </CapabilityGroup>
            </div>
        );
    }

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid is-three">
                    <ReferenceCard title="Image Quote" description="The range of images that the text model can accept">
                        <NumberField label="Maximum number of reference pictures" value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                        <NumberField label="Maximum MB for a single image" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                    </ReferenceCard>
                    <ReferenceCard title="video quotes" description="The video range that the text model can accept">
                        <NumberField label="Maximum number of reference videos" value={profile.references.maxVideos} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideos: next || 0 })} />
                        <NumberField label="Maximum MB for a single video" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideoBytes: mbToBytes(next) })} />
                    </ReferenceCard>
                    <ReferenceCard title="General restrictions" description="Basic constraints common to all text requests">
                        <NumberField label="Maximum number of characters for prompt word" value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/20 p-3">
            <div>
                <div className="text-sm font-medium">text comprehension</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">By default, support for images or videos is not assumed, and relevant requests will enter the model only after explicit configuration.</div>
            </div>
            <CapabilityGroup title="pictures" description="The image reference range that the text model can accept">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="Maximum number of reference pictures" value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                    <NumberField label="Maximum MB for a single image" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                </div>
            </CapabilityGroup>
            <CapabilityGroup title="video" description="The video reference range that the text model can accept">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="Maximum number of reference videos" value={profile.references.maxVideos} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideos: next || 0 })} />
                    <NumberField label="Maximum MB for a single video" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideoBytes: mbToBytes(next) })} />
                </div>
            </CapabilityGroup>
            <CapabilityGroup title="General restrictions" description="Basic constraints common to all text requests">
                <NumberField label="Maximum number of characters for prompt word" value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
            </CapabilityGroup>
        </div>
    );
}

function ImageCapabilityEditor({ value, onChange, protocol, model, disabled, section }: Required<Pick<Props, "model" | "disabled">> & Pick<Props, "value" | "onChange" | "protocol" | "section">) {
    const profile = normalizeModelCapabilityConfig(value || { version: 1, image: defaultImageCapabilityConfig(protocol, model) }).image!;
    const update = (patch: Partial<ImageCapabilityConfig>) => onChange?.({ version: 1, image: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<ImageCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateSize = (patch: Partial<ImageCapabilityConfig["size"]>) => update({ size: { ...profile.size, ...patch } });
    const updateQuality = (patch: Partial<ImageCapabilityConfig["quality"]>) => update({ quality: { ...profile.quality, ...patch } });
    const responseFormatSelectable = imageResponseFormatSelectable(protocol, model);

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid is-two">
                    <ReferenceCard title="Image Quote" description="Reference images, file size and masking capabilities">
                        <NumberField label="Maximum reference picture" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                        <NumberField label="Maximum single image MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                        <ParameterField label="Mask editing" description="Allow image editing interface to submit mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
                    </ReferenceCard>
                    <ReferenceCard title="General restrictions" description="Basic constraints common to all image requests">
                        <NumberField label="Maximum number of characters for prompt word" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    if (section === "protocol") {
        return (
            <div className="admin-capability-protocol-editor admin-image-protocol-editor">
                <div className="admin-capability-protocol-grid admin-image-protocol-grid">
                    <ProtocolParameterCard step="01" title="Dimensions" description="Configure available frames according to resolution, click directly or enter the ratio" className="admin-image-size-card">
                        <div className="admin-image-size-intro">
                            <SegmentedControl
                                block
                                disabled={disabled}
                                value={profile.size.parameter}
                                options={[
                                    { label: "Do not send", value: "none" },
                                    { label: "size", value: "size" },
                                    { label: "aspect_ratio", value: "aspect_ratio" },
                                ]}
                                onChange={(value) => {
                                    const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                                    updateSize(
                                        parameter === "none"
                                            ? { parameter, values: [], presets: undefined, default: "auto", allowCustom: false }
                                            : imageSizeConfigWithPresets({ ...profile, size: { ...profile.size, parameter } }, imageSizePresets(profile)),
                                    );
                                }}
                            />
                            <ImageSizeHelp />
                        </div>
                        {profile.size.parameter !== "none" ? (
                            <>
                                <ImageSizePresetsEditor profile={profile} disabled={disabled} onChange={updateSize} />
                                <ParameterField label="Allow customization" description="Allow dimensions outside of supported values" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                            </>
                        ) : null}
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="02" title="Output quantity" description="Set the number of images generated at a time">
                        <NumberField label="Number of sheets generated at a time" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="03" title="Optional parameters" description="Control quality, context and response format">
                        <ParameterField label="Picture quality" description="Send quality parameter" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                        {profile.quality.supported ? (
                            <div className="admin-capability-spec-grid">
                                <Field label="quality support value">
                                    <Select
                                        mode="tags"
                                        className="admin-capability-tags w-full"
                                        disabled={disabled}
                                        value={profile.quality.values}
                                        tokenSeparators={[","]}
                                        placeholder="For example auto, low, medium, high, 1k, 2k, 4k"
                                        onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                                    />
                                </Field>
                                <Field label="Default quality">
                                    <Select
                                        className="w-full"
                                        disabled={disabled}
                                        value={profile.quality.default}
                                        options={profile.quality.values.map((item) => ({ label: item, value: item }))}
                                        onChange={(defaultValue) => updateQuality({ default: defaultValue })}
                                    />
                                </Field>
                            </div>
                        ) : null}
                        <BooleanField label="Transparent background" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                        <BooleanField label="Association diagram" value={profile.sequentialGeneration || { supported: false, default: false }} disabled={disabled} onChange={(sequentialGeneration) => update({ sequentialGeneration })} />
                        <ResponseFormatField label="response_format" value={profile.responseFormat} disabled={disabled} selectable={responseFormatSelectable} onChange={(patch) => update({ responseFormat: { ...profile.responseFormat, ...patch } })} />
                        <ParameterField label="output_format" description="Send PNG output format" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                    </ProtocolParameterCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="admin-capability-editor-heading flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">Picture capability parameters</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">Both the generated interface and the backend request will tailor parameters here.</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">The current model takes effect independently</span>
            </div>

            <CapabilityGroup title="pictures" description="Reference images, masks and image input constraints">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="Maximum reference picture" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                    <NumberField label="Maximum single image MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                </div>
                <ParameterField label="Mask editing" description="Allow calling the image editing interface and submitting the mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
            </CapabilityGroup>

            <CapabilityGroup title="Output specifications" description="Single generation quantity, size parameters and default values">
                <CapabilityBlock title="Generate quantity">
                    <NumberField label="Number of sheets generated at a time" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                </CapabilityBlock>
                <CapabilityBlock title="Dimensions">
                    <ImageSizeHelp />
                    <SegmentedControl
                        block
                        disabled={disabled}
                        value={profile.size.parameter}
                        options={[
                            { label: "Do not send", value: "none" },
                            { label: "size", value: "size" },
                            { label: "aspect_ratio", value: "aspect_ratio" },
                        ]}
                        onChange={(value) => {
                            const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                            updateSize(
                                parameter === "none" ? { parameter, values: [], presets: undefined, default: "auto", allowCustom: false } : imageSizeConfigWithPresets({ ...profile, size: { ...profile.size, parameter } }, imageSizePresets(profile)),
                            );
                        }}
                    />
                    {profile.size.parameter !== "none" ? (
                        <>
                            <ImageSizePresetsEditor profile={profile} disabled={disabled} onChange={updateSize} />
                            <ParameterField label="Allow customization" description="Allow users to enter dimensions outside of supported values" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                        </>
                    ) : null}
                </CapabilityBlock>
            </CapabilityGroup>

            <CapabilityGroup title="Optional parameters" description="Optional capabilities such as quality, background and response format">
                <ParameterField label="Picture quality" description="Send quality parameter" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                {profile.quality.supported ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="quality support value">
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.quality.values}
                                tokenSeparators={[","]}
                                placeholder="For example auto, low, medium, high, 1k, 2k, 4k"
                                onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                            />
                        </Field>
                        <Field label="Default quality">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.quality.default}
                                options={profile.quality.values.map((item) => ({ label: item, value: item }))}
                                onChange={(defaultValue) => updateQuality({ default: defaultValue })}
                            />
                        </Field>
                    </div>
                ) : null}
                <BooleanField label="Transparent background" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                <BooleanField label="Association diagram" value={profile.sequentialGeneration || { supported: false, default: false }} disabled={disabled} onChange={(sequentialGeneration) => update({ sequentialGeneration })} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <ResponseFormatField label="response_format" value={profile.responseFormat} disabled={disabled} selectable={responseFormatSelectable} onChange={(patch) => update({ responseFormat: { ...profile.responseFormat, ...patch } })} />
                    <ParameterField label="output_format" description="Send PNG output format" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title="General restrictions" description="Basic constraints common to all image requests">
                <NumberField label="Maximum number of characters for prompt word" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
            </CapabilityGroup>
        </div>
    );
}

function CapabilityGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <details open className="admin-capability-group rounded-lg bg-muted/10 p-3">
            <summary className="cursor-pointer list-none pr-5">
                <span className="admin-capability-group-title block text-xs font-semibold text-foreground/70">{title}</span>
                {description ? <span className="admin-capability-group-description mt-0.5 block text-[var(--fs-tiny)] font-normal text-foreground/45">{description}</span> : null}
            </summary>
            <div className="mt-3 space-y-2">{children}</div>
        </details>
    );
}

function CapabilityBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="admin-capability-block">
            <div className="admin-capability-block-title">{title}</div>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

function ReferenceCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <section className="admin-capability-reference-card">
            <header className="admin-capability-reference-card-heading">
                <h3>{title}</h3>
                <p>{description}</p>
            </header>
            <div className="admin-capability-reference-fields">{children}</div>
        </section>
    );
}

function ProtocolParameterCard({ step, title, description, children, className = "" }: { step: string; title: string; description: string; children: ReactNode; className?: string }) {
    return (
        <section className={`admin-capability-protocol-card ${className}`}>
            <header className="admin-capability-protocol-card-heading">
                <span>{step}</span>
                <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                </div>
            </header>
            <div className="admin-capability-protocol-fields">{children}</div>
        </section>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1 block text-[var(--fs-tiny)] text-foreground/48">{label}</span>
            {children}
        </label>
    );
}

function NumberField({ label, value, min, max, disabled, onChange }: { label: string; value?: number; min: number; max?: number; disabled: boolean; onChange: (value: number | null) => void }) {
    return (
        <label className="admin-capability-number-field block min-w-0">
            <span className="admin-capability-field-label mb-1.5 block text-xs text-foreground/62">{label}</span>
            <InputNumber className="w-full" disabled={disabled} min={min} max={max} precision={0} value={value} onChange={onChange} />
        </label>
    );
}

function BooleanField({ label, value, disabled, onChange }: { label: string; value: { supported: boolean; default: boolean }; disabled: boolean; onChange: (value: { supported: boolean; default: boolean }) => void }) {
    return (
        <div className="admin-capability-boolean-field flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="text-xs font-medium">{label}</div>
                <div className="text-[var(--fs-tiny)] text-foreground/45">Send parameters and default values</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <label className="grid justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>support</span>
                    <Switch aria-label={`${label}support`} size="sm" disabled={disabled} checked={value.supported} onChange={(supported) => onChange({ ...value, supported })} />
                </label>
                <label className="grid justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>Default</span>
                    <Switch aria-label={`${label}Default value`} size="sm" disabled={disabled || !value.supported} checked={value.default} onChange={(defaultValue) => onChange({ ...value, default: defaultValue })} />
                </label>
            </div>
        </div>
    );
}

function ParameterField({ label, description, supported, disabled, onChange }: { label: string; description: string; supported: boolean; disabled: boolean; onChange: (supported: boolean) => void }) {
    return (
        <div className="admin-capability-parameter-field flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="break-all text-xs font-medium">{label}</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] leading-5 text-foreground/45">{description}</div>
            </div>
            <label className="grid shrink-0 justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                <span>support</span>
                <Switch aria-label={`${label}support`} size="sm" disabled={disabled} checked={supported} onChange={onChange} />
            </label>
        </div>
    );
}

function ResponseFormatField({ label, value, disabled, selectable, onChange }: { label: string; value: ImageResponseFormatConfig; disabled: boolean; selectable: boolean; onChange: (patch: Partial<ImageResponseFormatConfig>) => void }) {
    const showSelect = selectable && value.supported;
    return (
        <div className="admin-capability-parameter-field flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="break-all text-xs font-medium">{label}</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] leading-5 text-foreground/45">
                    {showSelect ? "b64_json is returned inline by the channel; url is returned by the channel as an image link, and BeefTV saves it back to the canvas after downloading it." : "Send b64_json response format"}
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {showSelect ? (
                    <Select
                        className="w-28"
                        size="small"
                        disabled={disabled}
                        aria-label={`${label}value`}
                        value={value.value || "b64_json"}
                        options={[
                            { label: "b64_json", value: "b64_json" },
                            { label: "url", value: "url" },
                        ]}
                        onChange={(next) => onChange({ value: next === "url" ? "url" : "b64_json" })}
                    />
                ) : null}
                <label className="grid shrink-0 justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>support</span>
                    <Switch aria-label={`${label}support`} size="sm" disabled={disabled} checked={value.supported} onChange={(supported) => onChange({ supported })} />
                </label>
            </div>
        </div>
    );
}

function bytesToMB(value: number) {
    return value ? Math.round((value / (1024 * 1024)) * 10) / 10 : 0;
}

function mbToBytes(value: number | null) {
    return Math.max(0, Math.round(Number(value || 0) * 1024 * 1024));
}

function parseIntegerList(value: string) {
    return Array.from(
        new Set(
            value
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isInteger(item) && item > 0),
        ),
    ).sort((left, right) => left - right);
}
