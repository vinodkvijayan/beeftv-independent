import { Button, InputNumber, Select } from "antd";
import { isH3Style, type H3VideoOptions } from "@/lib/h3-video";
import type { CanvasNodeMetadata } from "@/types/canvas";

export function CanvasH3UnsupportedFrames({ model, metadata, onChange }: { model: string; metadata?: CanvasNodeMetadata; onChange: (patch: Partial<CanvasNodeMetadata>) => void }) {
    const endUnsupported = isH3Style(model) && metadata?.videoEndFrameNodeId;
    const middleUnsupported = Boolean(metadata?.videoMiddleFrameNodeId || metadata?.videoMiddleFrameTime !== undefined);
    if (!endUnsupported && !middleUnsupported) return null;
    return <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[var(--fs-label)]"><span>The current model does not support the previously selected end or middle frames.</span><Button size="small" onClick={() => onChange({ ...(endUnsupported ? { videoEndFrameNodeId: undefined } : {}), videoMiddleFrameNodeId: undefined, videoMiddleFrameTime: undefined })}>Clear unsupported frame settings</Button></div>;
}

export function CanvasH3Controls({ model, value = {}, onChange, duration, onDurationChange }: { model: string; value?: H3VideoOptions; onChange: (value: H3VideoOptions) => void; duration?: string; onDurationChange?: (value: string) => void }) {
    const base = model.split("::").at(-1) === "minimax-h3";
    const style = isH3Style(model),
        vhs = model.split("::").at(-1) === "minimax-h3-max-style-vhs";
    const modes = [{ value: "balanced", label: "equilibrium" }, { value: "quality", label: "high quality" }, ...(base ? [{ value: "fast", label: "fast" }] : []), { value: "disabled", label: "Close" }];
    return (
        <details className="rounded-lg px-3 py-2" data-canvas-no-zoom>
            <summary className="cursor-pointer text-[var(--fs-label)]">MiniMax H3 Advanced Settings</summary>
            <div className="mt-3 flex flex-col gap-3 text-[var(--fs-label)]">
                {!base && !style && onDurationChange ? (
                    <label className="flex min-w-0 items-center justify-between gap-3">
                        <span>Duration (seconds)</span>
                        <InputNumber
                            aria-label="H3 duration (seconds)"
                            size="small"
                            min={0.92}
                            max={15}
                            step={0.01}
                            value={Number(duration || 5)}
                            onChange={(v) => {
                                if (v != null) onDurationChange(String(v));
                            }}
                        />
                    </label>
                ) : null}
                {!style ? (
                    <label className="flex min-w-0 items-center justify-between gap-3">
                        <span>Prompt word enhancement</span>
                        <Select aria-label="Prompt word enhancement" size="small" className="w-28" classNames={{ popup: { root: "canvas-h3-option-popup" } }} value={value.prompt_expansion_mode || "balanced"} options={modes} onChange={(mode) => onChange({ ...value, prompt_expansion_mode: mode })} />
                    </label>
                ) : null}
                <label className="flex min-w-0 items-center justify-between gap-3">
                    <span>random seed</span>
                    <InputNumber
                        aria-label="random seed"
                        size="small"
                        className="!w-28"
                        precision={0}
                        min={-Number.MAX_SAFE_INTEGER}
                        max={Number.MAX_SAFE_INTEGER}
                        value={value.seed}
                        placeholder="Leave blank for random"
                        onChange={(seed) => onChange({ ...value, seed: seed == null ? undefined : seed })}
                    />
                </label>
                {vhs ? (
                    <label className="flex min-w-0 items-center justify-between gap-3">
                        <span>tape wear</span>
                        <Select
                            aria-label="tape wear"
                            classNames={{ popup: { root: "canvas-h3-option-popup" } }}
                            size="small"
                            value={value.damage_level || "medium"}
                            options={[
                                { value: "light", label: "Mild" },
                                { value: "medium", label: "Moderate" },
                                { value: "heavy", label: "Severe" },
                            ]}
                            onChange={(damage_level) => onChange({ ...value, damage_level })}
                        />
                    </label>
                ) : null}
            </div>
        </details>
    );
}
