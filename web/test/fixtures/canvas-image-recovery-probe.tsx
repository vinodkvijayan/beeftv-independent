import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodeContent } from "../../src/components/canvas/canvas-node-content";
import { canvasThemes } from "../../src/lib/canvas-theme";
import { setActiveUserScope } from "../../src/lib/user-scope";
import { http } from "../../src/services/api/request";
import type { CanvasNodeData } from "../../src/types/canvas";
import "../../src/styles/globals.css";
import "./canvas-image-recovery-probe.css";

type ProbeState = {
    before: { nodes: CanvasNodeData[]; revision: number };
    canvas: { nodes: CanvasNodeData[]; revision: number };
    task: { id: string; status: string; outcome?: { phase: string } };
    routeRun: number;
    started: boolean;
    upstreamGets: number;
    upstreamPosts: number;
    resourceGets: number;
    taskCount: number;
    routeAttempts: number;
};

const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
setActiveUserScope("manual-image-recovery-probe");
const theme = canvasThemes[dark ? "dark" : "light"];
const noop = () => {};

function NodePreview({ node }: { node: CanvasNodeData }) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    return <CanvasNodeContent node={node} theme={theme} isEditingContent={false} textareaRef={textareaRef}
        isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false}
        onContentChange={noop} onStopEditing={noop} mentionReferences={[]} scale={1} />;
}

function Probe() {
    const [state, setState] = useState<ProbeState>();
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const [finished, setFinished] = useState(false);
    const [pixels, setPixels] = useState("");
    useEffect(() => {
        if (finished) return;
        const controller = new AbortController();
        let timer = 0;
        const poll = async () => {
            try {
                const next = await http.get<ProbeState>("/probe/state", { signal: controller.signal });
                if (!controller.signal.aborted) { setState(next); setError(""); }
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
                if (!controller.signal.aborted) timer = window.setTimeout(poll, 300);
            }
        };
        void poll();
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [finished]);
    const action = async (name: "start" | "finish") => {
        setPending(true);
        try {
            await http.post(`/probe/${name}`, {});
            if (name === "finish") setFinished(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally { setPending(false); }
    };
    const node = state?.canvas.nodes[0];
    const ready = node?.metadata?.status === "success" && Boolean(node.metadata.content && node.metadata.storageKey) && state?.task.outcome?.phase === "ready";
    const style = { "--probe-bg": theme.canvas.background, "--probe-panel": theme.node.panel, "--probe-text": theme.node.text, "--probe-muted": theme.node.muted, "--probe-border": theme.node.stroke } as CSSProperties;
    return <main className="image-recovery-probe" style={style}>
        <header><h1>Automatic recovery of historical pictures</h1><p>Free acceptance: temporary database, native image receipts, and real background recovery. The image is displayed by the actual canvas component.</p></header>
        <div className="probe-actions">
            <button id="start-recovery" disabled={!state || pending || state.started || finished} onClick={() => void action("start")}>Start background recovery</button>
            <button id="finish-probe" disabled={pending || finished} onClick={() => void action("finish")}>End acceptance</button>
            <span role="status">{finished ? "Acceptance has ended" : ready && pixels ? `Picture shown ·${pixels}` : ready ? "Data has been restored and pictures are being read" : state?.started ? "Recovering in the background" : "Waiting to start"}</span>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <div className="probe-comparison">
            <section><h2>before recovery</h2><div className="probe-node" id="before-node">{state?.before.nodes[0] ? <NodePreview node={state.before.nodes[0]} /> : "Read the original canvas..."}</div></section>
            <section><h2>current canvas</h2><div className="probe-node" id="current-node" onLoadCapture={(event) => {
                if (event.target instanceof HTMLImageElement && event.target.naturalWidth) setPixels(`${event.target.naturalWidth} × ${event.target.naturalHeight}`);
            }}>{node ? <NodePreview node={node} /> : "Read canvas…"}</div></section>
        </div>
        {state ? <>
            <p id="probe-counts">Upstream GET:{state.upstreamGets}  · Upstream POST:{state.upstreamPosts}  · Resource reading:{state.resourceGets}  ·Number of tasks:{state.taskCount}  · New routing:{state.routeAttempts}</p>
            <p>Task:{state.task.id} · {state.task.status} / {state.task.outcome?.phase} · routeRun：{state.routeRun}  · Canvas version:{state.before.revision} → {state.canvas.revision}</p>
            <details><summary>Actual interface returns</summary><pre id="probe-state">{JSON.stringify(state, null, 2)}</pre></details>
        </> : null}
    </main>;
}

createRoot(document.getElementById("root")!).render(<Probe />);
