import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles/globals.css";
import { CanvasNodePromptPanel } from "../../src/components/canvas/canvas-node-prompt-panel";
import { createModelChannel, defaultConfig, useConfigStore } from "../../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../../src/lib/model-capabilities";
import { H3_STYLES } from "../../src/lib/h3-video";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../../src/types/canvas";
import type { CanvasResourceReference } from "../../src/lib/canvas/canvas-resource-references";
import { useCanvasThemeStore } from "../../src/stores/canvas/use-canvas-theme-store";

const light = new URLSearchParams(location.search).get("theme") === "light";
document.documentElement.classList.toggle("dark", !light);
useCanvasThemeStore.setState({ active: true, theme: light ? "light" : "dark" });

const models = ["minimax-h3", "minimax-h3-max", "minimax-h3-max-turbo", ...Object.keys(H3_STYLES), "seedance-2.5"];
const channel = createModelChannel({ id: "h3-entry", name: "Entrance acceptance", scope: "system", baseUrl: "https://example.invalid/v1", apiKey: "synthetic-ui-test-key", interfaceType: "newapi", models });
channel.modelProfiles = models.map((model) => {
    const capabilityConfig = defaultModelCapabilityConfig("newapi", model);
    if (model.startsWith("minimax-h3")) {
        const continuous = model === "minimax-h3-max" || model === "minimax-h3-max-turbo";
        const style = model.includes("style-");
        capabilityConfig.video = { ...capabilityConfig.video!, duration: { selection: "range", min: continuous ? 1 : 5, max: 15, step: 1, default: 5, ...(continuous ? { fractionalMin: 0.92, continuous: true } : {}) }, resolutions: style ? ["768p"] : continuous ? ["480p", "768p", "1080p"] : ["480p", "768p", "2k", "4k"], defaultResolution: "768p", operations: style ? ["text_to_video", "image_to_video"] : ["text_to_video", "image_to_video", "reference_to_video", "audio_to_video"], references: { ...capabilityConfig.video!.references, maxImages: style ? 1 : 9, maxVideos: style ? 0 : 3, maxAudios: style ? 0 : 3 } };
    }
    return { model, displayName: model, capability: "video", protocol: "newapi", billingMode: "per_second", unitPriceMicrocredits: 0, capabilityConfig };
});
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model: "h3-entry::minimax-h3-max", videoModel: "h3-entry::minimax-h3-max", videoSeconds: "5", vquality: "768p", size: "16:9" }, isAiConfigReady: true });

const allReferences: CanvasResourceReference[] = [
    { id: "start", nodeId: "start", kind: "image", label: "Picture 1", title: "Garden first frame", active: true },
    { id: "end", nodeId: "end", kind: "image", label: "Picture 2", title: "garden end frame", active: true },
    { id: "middle", nodeId: "middle", kind: "image", label: "Picture 3", title: "Garden middle frame", active: true },
    { id: "video", nodeId: "video", kind: "video", label: "Video 1", title: "Mirror movement reference", active: true },
    { id: "audio", nodeId: "audio", kind: "audio", label: "Audio 1", title: "Birdsong reference", active: true },
];

function Harness() {
    const [metadata, setMetadata] = useState<CanvasNodeMetadata>({ generationMode: "video", model: "h3-entry::minimax-h3-max", seconds: "0.925", prompt: "a ray of light in the garden", videoH3Options: { seed: 0, enable_safety_checker: false } });
    const [referenceSet, setReferenceSet] = useState("none");
    const references = referenceSet === "all" ? allReferences : referenceSet === "audio" ? allReferences.slice(-1) : [];
    const patch = (_id: string, value: Partial<CanvasNodeMetadata>) => setMetadata((current) => ({ ...current, ...value }));
    const node: CanvasNodeData = { id: "video-node", type: CanvasNodeType.Video, title: "Ordinary video node", position: { x: 0, y: 0 }, width: 460, height: 280, metadata };
    return (
        <main className="mx-auto flex w-full max-w-xl flex-col gap-3 p-4 text-foreground">
            <h1 className="text-lg font-semibold">Ordinary video node entrance backtest</h1>
            <p className="text-xs opacity-65">Mount the product prompt word panel; do not initiate paid generation.</p>
            <label className="text-xs">Reference material<select aria-label="Acceptance of reference materials" value={referenceSet} onChange={(event) => setReferenceSet(event.target.value)}><option value="none">None</option><option value="all">Pictures, videos, audio</option><option value="audio">audio only</option></select></label>
            <CanvasNodePromptPanel projectId="h3-entry-test" node={node} isRunning={false} onPromptChange={(id, prompt) => patch(id, { prompt })} onConfigChange={patch} onGenerate={() => { throw new Error("Acceptance fixture is prohibited from being generated"); }} mentionReferences={references} />
            <output id="h3-entry-state" className="break-all text-xs">{JSON.stringify(metadata)}</output>
        </main>
    );
}
createRoot(document.getElementById("root")!).render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConfigProvider theme={{ algorithm: light ? theme.defaultAlgorithm : theme.darkAlgorithm }}><App><Harness /></App></ConfigProvider></QueryClientProvider></MemoryRouter>);
