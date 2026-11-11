import { InputNumber, Slider } from "antd";
import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/base/switch";
import { directorGroundSettings } from "@/lib/canvas/director/director-ground";
import { directorPanoramaSphere } from "@/lib/canvas/director/director-panorama-sphere";
import { directorStageTransform } from "@/lib/canvas/director/director-stage-transform";
import type { DirectorScene, DirectorVec3 } from "@/types/director";

type SceneEnvironmentPatch = Partial<Pick<DirectorScene, "background" | "environmentIntensity" | "gridVisible" | "gridSnap" | "panorama" | "panoramaRotation" | "panoramaRadius" | "ground" | "stageTransform" | "labelsVisible">>;

export function DirectorSceneInspector({ scene, onChange }: { scene: DirectorScene; onChange: (patch: SceneEnvironmentPatch) => void }) {
    const ground = directorGroundSettings(scene);
    const stage = directorStageTransform(scene);
    const sphere = directorPanoramaSphere(scene);
    const [skyHex, setSkyHex] = useState(() => scene.background.replace(/^#/, "").toUpperCase());
    useEffect(() => setSkyHex(scene.background.replace(/^#/, "").toUpperCase()), [scene.background]);
    const commitSkyHex = () => {
        if (!/^[0-9A-Fa-f]{6}$/.test(skyHex)) {
            setSkyHex(scene.background.replace(/^#/, "").toUpperCase());
            return;
        }
        const color = `#${skyHex.toUpperCase()}`;
        if (color.toLowerCase() !== scene.background.toLowerCase()) onChange({ background: color });
        setSkyHex(color.slice(1));
    };
    const updateGround = (patch: Partial<typeof ground>) => onChange({ ground: { ...ground, ...patch } });
    const updateAxis = (field: "position" | "rotation", axis: number, value: number) => {
        const next = [...stage[field]] as DirectorVec3;
        next[axis] = value;
        onChange({ stageTransform: { ...stage, [field]: next } });
    };
    return (
        <div className="text-sm">
            <h2 className="border-b px-4 py-4 text-base font-semibold" style={{ borderColor: "var(--border)" }}>3D scene</h2>
            <section className="space-y-3 border-b px-4 py-4" style={{ borderColor: "var(--border)" }} aria-label="scene change">
                <div className="space-y-2">
                    <div className="text-[13px] opacity-50">scene zoom</div>
                    <div className="flex items-center gap-3">
                        <Slider ariaLabelForHandle="scene zoom" className="m-0 min-w-0 flex-1" min={0.1} max={10} step={0.1} value={stage.scale} onChangeComplete={(scale) => onChange({ stageTransform: { ...stage, scale } })} />
                        <InputNumber aria-label="Scene zoom percentage" className="w-[72px] shrink-0" size="small" min={10} max={1000} step={10} suffix="%" value={Math.round(stage.scale * 100)} onChange={(percent) => { if (percent !== null) onChange({ stageTransform: { ...stage, scale: percent / 100 } }); }} />
                    </div>
                </div>
                {(["position", "rotation"] as const).map((field) => <div key={field} className="space-y-2">
                    <div className="text-[13px] opacity-50">scene{field === "position" ? "Pan" : "rotate"}</div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {(["X", "Y", "Z"] as const).map((axis, index) => <label key={axis} className="flex min-w-0 items-center gap-1 rounded-lg px-2" style={{ background: "var(--director-dock-active-surface)" }}>
                            <span className="text-[11px] opacity-50">{axis}</span>
                            <InputNumber aria-label={`scene${field === "position" ? "Pan" : "rotate"}${axis}`} className="min-w-0 flex-1" size="small" variant="borderless" controls={false} step={field === "position" ? 0.1 : 1} precision={field === "position" ? 1 : 0} value={stage[field][index]} onChange={(value) => { if (value !== null) updateAxis(field, index, value); }} />
                        </label>)}
                    </div>
                </div>)}
            </section>
            <section className="space-y-4 border-b px-4 py-4" style={{ borderColor: "var(--border)" }} aria-label="panoramic background">
                <h3 className="font-semibold">panoramic background</h3>
                <div className="space-y-2">
                    <span className="text-xs opacity-65">{scene.panorama ? "Panorama connected" : "No panoramas have been added yet"}</span>
                    {scene.panorama ? <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
                        <span className="min-w-0 truncate">{scene.panorama.name || "panoramic picture"}</span>
                        <button type="button" aria-label="Remove panorama" className="shrink-0 opacity-65 hover:opacity-100" onClick={() => onChange({ panorama: undefined })}>Remove</button>
                    </div> : <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs opacity-55" style={{ borderColor: "var(--border)" }}>Upload or select an image from the left</div>}
                </div>
                <div className="space-y-2">
                    <div className="text-xs opacity-65">sky color</div>
                    <div className="flex items-center gap-2">
                        <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-lg" style={{ background: scene.background }}>
                            <input type="color" aria-label="Choose sky color" className="absolute inset-0 size-full cursor-pointer opacity-0" value={scene.background} onChange={(event) => onChange({ background: event.target.value })} />
                        </label>
                        <div className="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-lg px-2 text-xs" style={{ background: "var(--director-dock-active-surface)" }}>
                            <span className="opacity-50">#</span>
                            <input type="text" aria-label="sky color value" className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs uppercase outline-none" maxLength={6} spellCheck={false} value={skyHex} onChange={(event) => setSkyHex(event.target.value.toUpperCase())} onBlur={commitSkyHex} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setSkyHex(scene.background.replace(/^#/, "").toUpperCase()); event.currentTarget.blur(); } }} />
                        </div>
                    </div>
                </div>
            </section>
            <section className="space-y-4 border-b px-4 py-5" style={{ borderColor: "var(--border)" }} aria-label="panoramic sphere">
                <h3 className="font-semibold">panoramic sphere</h3>
                <div className="text-xs opacity-65">Horizontal rotation</div>
                <div className="flex items-center gap-3">
                    <Slider aria-label="Panoramic ball rotates horizontally" className="m-0 min-w-0 flex-1" min={0} max={360} step={1} value={sphere.rotation} onChangeComplete={(panoramaRotation) => onChange({ panoramaRotation })} />
                    <InputNumber aria-label="Panoramic ball rotation angle" className="w-[72px] shrink-0" size="small" min={0} max={360} step={1} suffix="°" value={sphere.rotation} onChange={(panoramaRotation) => { if (panoramaRotation !== null) onChange({ panoramaRotation }); }} />
                </div>
                <div className="text-xs opacity-65">spherical radius</div>
                <div className="flex items-center gap-3">
                    <Slider aria-label="panoramic sphere radius" className="m-0 min-w-0 flex-1" min={10} max={500} step={10} value={sphere.radius} onChangeComplete={(panoramaRadius) => onChange({ panoramaRadius })} />
                    <InputNumber aria-label="panoramic sphere radius value" className="w-[72px] shrink-0" size="small" min={10} max={500} step={10} value={sphere.radius} onChange={(panoramaRadius) => { if (panoramaRadius !== null) onChange({ panoramaRadius }); }} />
                </div>
            </section>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-4 text-xs" style={{ borderColor: "var(--border)" }}>
                <span>role tag</span>
                <Switch size="sm" aria-label="role tag" checked={scene.labelsVisible !== false} onChange={(labelsVisible) => onChange({ labelsVisible })} />
            </div>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-4 text-xs" style={{ borderColor: "var(--border)" }}>
                <span>Grid adsorption</span>
                <Switch size="sm" aria-label="Grid adsorption" checked={scene.gridSnap === true} onChange={(gridSnap) => onChange({ gridSnap })} />
            </div>
            <div className="space-y-5 px-4 py-5">
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs"><span className="opacity-65">ambient brightness</span><span>{Math.round(scene.environmentIntensity * 100)}%</span></div>
                    <Slider min={0} max={2} step={0.05} value={scene.environmentIntensity} onChangeComplete={(environmentIntensity) => onChange({ environmentIntensity })} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                    <span>show grid</span>
                    <Switch size="sm" aria-label="show grid" checked={scene.gridVisible} onChange={(gridVisible) => onChange({ gridVisible })} />
                </div>
            </div>
            <section className="space-y-4 border-t px-4 py-5" style={{ borderColor: "var(--border)" }} aria-label="ground setting">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">ground</h3>
                    <Switch size="sm" aria-label="show ground" checked={ground.visible} onChange={(visible) => updateGround({ visible })} />
                </div>
                <div className="space-y-1.5">
                    <div className="text-xs opacity-65">Transparency</div>
                    <div className="flex items-center gap-3">
                        <Slider ariaLabelForHandle="ground transparency" className="m-0 min-w-0 flex-1" min={0} max={1} step={0.05} disabled={!ground.visible} value={ground.opacity} onChangeComplete={(opacity) => updateGround({ opacity })} />
                        <InputNumber aria-label="Ground transparency value" className="w-[72px] shrink-0" size="small" min={0} max={1} step={0.05} precision={2} disabled={!ground.visible} value={ground.opacity} onChange={(opacity) => { if (opacity !== null) updateGround({ opacity }); }} />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <div className="text-xs opacity-65">height</div>
                    <div className="flex items-center gap-3">
                        <Slider ariaLabelForHandle="Ground height" className="m-0 min-w-0 flex-1" min={-2} max={2} step={0.05} disabled={!ground.visible} value={ground.height} onChangeComplete={(height) => updateGround({ height })} />
                        <InputNumber aria-label="Ground height value" className="w-[72px] shrink-0" size="small" min={-2} max={2} step={0.05} precision={1} disabled={!ground.visible} value={ground.height} onChange={(height) => { if (height !== null) updateGround({ height }); }} />
                    </div>
                </div>
            </section>
        </div>
    );
}
