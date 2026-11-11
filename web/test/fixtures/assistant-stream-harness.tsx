import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";

import { CanvasAssistantSidebar } from "@/pages/canvas/canvas-assistant-sidebar";
import { useCanvasAssistant } from "@/pages/canvas/use-canvas-assistant";
import { configureApiRuntime } from "@/services/api/request";
import { appQueryClient } from "@/lib/query-client";
import { hydrateModelConfig } from "@/services/model-config-repository";
import "@/pages/canvas/canvas-assistant-sidebar.css";

configureApiRuntime(location.origin + "/api", "synthetic-desktop-stream");
await hydrateModelConfig();

function Harness() {
    const assistant = useCanvasAssistant({ canvasId: "stream-canvas" });
    return <App>
        <div style={{ height: "100vh", width: "100%", display: "flex" }}>
            <CanvasAssistantSidebar assistant={assistant} canvasTitle="Streaming display verification" dockable readOnly={false}
                selectedNodeIds={[]} references={[]} onLocateNodes={() => {}} onRunProposal={() => {}} onOpenModelSettings={() => {}} />
        </div>
        <button style={{ position: "fixed", left: 4, top: 4 }} onClick={() => void assistant.send("answer slowly", [])}>start</button>
        <button style={{ position: "fixed", left: 80, top: 4 }} onClick={() => void assistant.send("Think first before answering", [])}>start thinking</button>
        <button style={{ position: "fixed", left: 190, top: 4 }} onClick={() => void assistant.send("Think first and then clear", [])}>Clear your mind</button>
        <button style={{ position: "fixed", left: 290, top: 4 }} onClick={() => void assistant.send("Think first and then finalize", [])}>Final state cleared</button>
        <output data-testid="streaming">{String(assistant.streaming)}</output>
    </App>;
}

createRoot(document.getElementById("root")!).render(<MemoryRouter><QueryClientProvider client={appQueryClient}><Harness /></QueryClientProvider></MemoryRouter>);
