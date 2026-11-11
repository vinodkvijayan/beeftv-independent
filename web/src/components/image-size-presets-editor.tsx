import { useId, useState } from "react";
import { Button, Input } from "antd";
import { Check, Plus } from "lucide-react";
import { Switch } from "@/components/ui/base/switch";
import "./image-size-picker.css";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, imagePresetForRatio, imageResolutionUsesQuality, imageSizeConfigWithPresets, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import type { ImageResolutionTier } from "@/lib/image-resolution-tiers";

export function ImageSizePresetsEditor({ profile, disabled, onChange }: { profile: ImageCapabilityConfig; disabled?: boolean; onChange: (size: ImageCapabilityConfig["size"]) => void }) {
    const presets = imageSizePresets(profile);
    const id = useId();
    const [drafts, setDrafts] = useState<Partial<Record<ImageResolutionTier, string>>>({});
    const [errors, setErrors] = useState<Partial<Record<ImageResolutionTier, string>>>({});
    const toggleTier = (tier: ImageResolutionTier, ratios: string[], enabled: boolean) => {
        if (disabled) return;
        update(tier, enabled ? ratios : []);
    };
    const update = (tier: ImageResolutionTier, ratios: string[]) => {
        if (disabled) return false;
        try {
            const next = [
                ...new Map(
                    ratios.map((ratio) => {
                        const normalized = imagePresetForRatio(tier, ratio);
                        const preset = presets.find((preset) => preset.tier === tier && preset.ratio === normalized.ratio) || normalized;
                        return [preset.ratio, preset] as const;
                    }),
                ).values(),
            ];
            onChange(imageSizeConfigWithPresets(profile, [...presets.filter((preset) => preset.tier !== tier), ...next]));
            setErrors((current) => ({ ...current, [tier]: "" }));
            return true;
        } catch (reason) {
            setErrors((current) => ({ ...current, [tier]: reason instanceof Error ? reason.message : "Invalid scale format" }));
            return false;
        }
    };
    const addRatio = (tier: ImageResolutionTier) => {
        const ratios = (drafts[tier] || "")
            .split(/[,，\n]/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (!ratios.length) return;
        if (update(tier, [...presets.filter((preset) => preset.tier === tier).map((preset) => preset.ratio), ...ratios])) {
            setDrafts((current) => ({ ...current, [tier]: "" }));
        }
    };
    return (
        <div className="image-size-presets-editor">
            <p className="image-size-editor-intro">Click to select a supported ratio and click again to remove it. Dimensions are automatically converted and existing exact dimensions remain unchanged.</p>
            {IMAGE_RESOLUTIONS.map((tier) => {
                const items = presets.filter((preset) => preset.tier === tier);
                const ratios = [...new Set([...IMAGE_RATIOS, ...items.map((item) => item.ratio)])];
                return (
                    <section key={tier} className="image-size-preset-group" aria-labelledby={`${id}-${tier}-title`}>
                        <header className="image-size-preset-heading">
                            <div className="image-size-preset-heading-label">
                                <strong id={`${id}-${tier}-title`}>{tier.toUpperCase()}</strong>
                                <span>{items.length ? `${items.length} ratio` : "Not enabled"}</span>
                                <Switch size="sm" checked={items.length === ratios.length} disabled={disabled} aria-label={`enable${tier.toUpperCase()} Specifications`} onChange={(enabled) => toggleTier(tier, ratios, enabled)} />
                            </div>
                        </header>
                        <div className="image-size-preset-body">
                            {imageResolutionUsesQuality(profile) && !imageTierAvailable(profile, tier) ? <p className="image-size-hint">The quality value corresponding to this gear needs to be configured first before the client will be opened.</p> : null}
                            <div className="image-size-preset-options" role="group" aria-label={`${tier.toUpperCase()} Supported aspect ratios`}>
                                {ratios.map((ratio) => {
                                    const selected = items.find((item) => item.ratio === ratio);
                                    const dimensions = selected || imagePresetForRatio(tier, ratio);
                                    return (
                                        <button
                                            key={ratio}
                                            type="button"
                                            disabled={disabled}
                                            aria-pressed={Boolean(selected)}
                                            aria-label={`${tier.toUpperCase()} ${ratio}`}
                                            className="image-size-preset-option"
                                            title={`${ratio} · ${dimensions.width} × ${dimensions.height} px${selected ? " · Click to remove" : " · Click to add"}`}
                                            onClick={() => update(tier, selected ? items.filter((item) => item.ratio !== ratio).map((item) => item.ratio) : [...items.map((item) => item.ratio), ratio])}
                                        >
                                            <span className="image-size-preset-option-label">
                                                <span>{ratio}</span>
                                                {selected ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                                            </span>
                                            <small>
                                                {dimensions.width} × {dimensions.height}
                                            </small>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="image-size-preset-add">
                                <Input
                                    aria-label={`${tier.toUpperCase()} Custom scale`}
                                    aria-invalid={Boolean(errors[tier])}
                                    aria-describedby={errors[tier] ? `${id}-${tier}-error` : undefined}
                                    disabled={disabled}
                                    placeholder="Other ratios such as 17:11"
                                    value={drafts[tier] || ""}
                                    onChange={(event) => {
                                        setDrafts((current) => ({ ...current, [tier]: event.target.value }));
                                        setErrors((current) => ({ ...current, [tier]: "" }));
                                    }}
                                    onPressEnter={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        addRatio(tier);
                                    }}
                                />
                                <Button disabled={disabled || !drafts[tier]?.trim()} icon={<Plus size={14} />} onClick={() => addRatio(tier)} aria-label={`add${tier.toUpperCase()} Proportion`}>
                                                                        add
                                </Button>
                            </div>
                            {errors[tier] ? (
                                <p id={`${id}-${tier}-error`} role="alert" className="image-size-error">
                                    {errors[tier]}
                                </p>
                            ) : null}
                        </div>
                    </section>
                );
            })}
            <div className="image-size-defaults">
                <div className="image-size-defaults-heading">
                    <strong>Default output</strong>
                    <span>Initial size when user selects model</span>
                </div>
                <div className="image-size-default-options" role="group" aria-label="Default output">
                    {profile.size.values.map((value) => {
                        const preset = presets.find((item) => (profile.size.parameter === "aspect_ratio" ? item.ratio === value : item.size === value));
                        const label = value === "auto" ? "automatic" : preset && profile.size.parameter === "size" ? `${preset.tier.toUpperCase()} · ${preset.ratio}` : value;
                        return (
                            <button key={value} type="button" disabled={disabled} aria-pressed={profile.size.default === value} title={value} aria-label={`Default output${label} ${value}`} onClick={() => onChange({ ...profile.size, default: value })}>
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
