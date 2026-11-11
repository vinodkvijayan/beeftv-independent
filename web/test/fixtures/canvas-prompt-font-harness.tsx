import { createRoot } from "react-dom/client";
import { useState } from "react";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN } from "@/lib/skin-themes";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const dark = new URLSearchParams(location.search).get("theme") === "dark";
useThemeStore.getState().setTheme(dark ? "dark" : "light");
applySkinTheme(DEFAULT_CLASSIC_SKIN, dark ? "dark" : "light");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const initial: CanvasNodeData = { id: "font-preview", type: CanvasNodeType.Image, title: "test picture", width: 500, height: 300, position: { x: 0, y: 0 }, metadata: { prompt: "The camera slowly advances, and the cat by the window looks into the distance. Preserve natural light, shadow and details." } };

function Harness() {
    const [node, setNode] = useState(initial);
    const [composed, setComposed] = useState("Use connected assets to generate warm scenes.");
    return <ConfigProvider theme={getAntThemeConfig(dark, DEFAULT_CLASSIC_SKIN)}><App><QueryClientProvider client={client}>
        <main style={{ padding: 12, maxWidth: 680, margin: "auto" }}>
            <section data-testid="node-panel" style={{ width: "100%", position: "relative" }}>
                <CanvasNodePromptPanel projectId="font-test" node={node} isRunning={false} workspaceMode="simple" onPromptChange={(_, prompt) => setNode(current => ({ ...current, metadata: { ...current.metadata, prompt } }))} onConfigChange={() => {}} onGenerate={() => { throw new Error("Font size adjustment cannot generate tasks"); }} />
            </section>
            <section data-testid="config-composer" style={{ marginTop: 24 }}>
                <CanvasConfigComposer value={composed} inputs={[]} onChange={setComposed} onClose={() => {}} workspaceMode="simple" />
            </section>
            <output hidden data-testid="prompt-value">{node.metadata?.prompt}</output>
        </main>
    </QueryClientProvider></App></ConfigProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
