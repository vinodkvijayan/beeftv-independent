import type { AiConfig } from "@/stores/use-config-store";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { Switch } from "@/components/ui/base/switch";

type Key = "size" | "transparentBackground" | "seedreamMode" | "seedreamMaxImages" | "seedreamOutputFormat" | "seedreamOptimize" | "seedreamWatermark";

export function SeedreamSettings({ config, family, profile, onChange, theme }: { config: AiConfig; family: string; profile: ImageCapabilityConfig; onChange: (key: Key, value: string) => void; theme: CanvasTheme }) {
    const modern = family === "pro" || family === "flash";
    const supportsSequential = profile.sequentialGeneration ? profile.sequentialGeneration.supported : !modern;
    const layers = config.seedreamMode === "layers";
    const style = { background: theme.canvas.background, color: theme.node.text, borderColor: theme.node.stroke };
    return <div className="space-y-3">
        {modern ? <label className="flex items-center justify-between gap-3 text-xs"><span>Split layers</span><Switch size="sm" checked={layers} onChange={(checked) => { onChange("seedreamMode", checked ? "layers" : "image"); if (checked) onChange("transparentBackground", "false"); if (!checked && config.size === "auto") onChange("size", "2K"); }} /></label> : null}
        {layers ? <p className="text-xs leading-relaxed" style={{ color: theme.node.muted }}>Connect an image and separate the base image and transparent layer. The elements to be separated can be specified in the prompt word.</p> : <p className="text-xs leading-relaxed" style={{ color: theme.node.muted }}>Supports text generation, reference image editing and multi-image fusion. For local editing, you can upload annotation images or specify the location in the prompt word.</p>}
        <label className="block space-y-1.5 text-xs"><span>resolution</span><select aria-label="Seedream resolution" className="h-8 w-full rounded-lg border px-2" style={style} value={profile.size.values.includes(config.size) || config.size === "auto" ? config.size : "custom"} onChange={(event) => onChange("size", event.target.value === "custom" ? "2048x2048" : event.target.value)}>
            {profile.size.values.map((value) => <option key={value} value={value}>{value}</option>)}
            {layers ? <option value="auto">Follow the original picture</option> : <option value="custom">Custom width and height</option>}
        </select></label>
        {!layers && !profile.size.values.includes(config.size) ? <label className="block space-y-1.5 text-xs"><span>Width × Height (pixels)</span><input aria-label="Seedream custom width and height" className="h-8 w-full rounded-lg border px-2" style={style} value={config.size} onChange={(event) => onChange("size", event.target.value)} placeholder="2048x2048" /></label> : null}
        {supportsSequential ? <label className="block space-y-1.5 text-xs"><span>Association group diagram upper limit</span><input aria-label="Association group diagram upper limit" type="number" min={1} max={15} className="h-8 w-full rounded-lg border px-2" style={style} value={config.seedreamMaxImages || "1"} onChange={(event) => onChange("seedreamMaxImages", event.target.value)} /><span className="block leading-relaxed" style={{ color: theme.node.muted }}>Related pictures in the same generation are charged according to the actual pictures produced; the total number of reference pictures and output pictures is up to 15.</span></label> : null}
        {profile.outputFormat.supported ? <label className="block space-y-1.5 text-xs"><span>{layers ? "Basemap format" : "Picture format"}</span><select aria-label="Seedream image format" className="h-8 w-full rounded-lg border px-2" style={style} value={config.transparentBackground === "true" ? "png" : config.seedreamOutputFormat || "png"} onChange={(event) => onChange("seedreamOutputFormat", event.target.value)}><option value="png">PNG</option><option value="jpeg" disabled={config.transparentBackground === "true"}>JPEG</option></select></label> : null}
        <label className="block space-y-1.5 text-xs"><span>Prompt word optimization</span><select aria-label="Seedream prompt word optimization" className="h-8 w-full rounded-lg border px-2" style={style} value={config.seedreamOptimize || "standard"} onChange={(event) => onChange("seedreamOptimize", event.target.value)}><option value="standard">Standard</option>{family === "pro" || family === "4.0" ? <option value="fast">fast</option> : null}</select></label>
        <label className="flex items-center justify-between gap-3 text-xs"><span>AI watermark</span><Switch size="sm" checked={config.seedreamWatermark === "true"} onChange={(checked) => onChange("seedreamWatermark", checked ? "true" : "false")} /></label>
    </div>;
}
