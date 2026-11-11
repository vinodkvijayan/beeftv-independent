import type { AgentToolCall, AssistantMediaFacts } from "@/services/api/agent-assistant";
import type { CanvasNodeData } from "@/types/canvas";

const seconds = (ms: number) => String(ms / 1000);
const range = ({ startMs, endMs }: { startMs: number; endMs: number }) => `${seconds(startMs)}–${seconds(endMs)} seconds`;
const labels: Record<AssistantMediaFacts["mode"], string> = { frames: "static frame interval", video: "Video clip reading", audio: "Audio clip reading", check: "objective testing" };

function wholeIntervalSilent(facts: AssistantMediaFacts) {
    if (!facts.hasAudio || facts.source.endMs <= facts.source.startMs) return false;
    let end = facts.source.startMs;
    for (const interval of [...(facts.silenceIntervals || [])].sort((a, b) => a.startMs - b.startMs)) {
        if (interval.startMs > end) return false;
        end = Math.max(end, interval.endMs);
    }
    return end >= facts.source.endMs;
}

export function CanvasAssistantMediaFacts({ calls, nodes = [] }: { calls: AgentToolCall[]; nodes?: CanvasNodeData[] }) {
    const groups = new Map<string, AssistantMediaFacts[]>();
    for (const call of calls) {
        if (call.isError !== false || !["media.overview", "media.inspect", "media.check"].includes(call.tool)) continue;
        for (const facts of call.mediaEvidence ?? (call.mediaFacts ? [call.mediaFacts] : [])) {
            const key = JSON.stringify([facts.source.resourceId, facts.source.version]);
            let group = groups.get(key);
            if (!group) {
                group = [];
                groups.set(key, group);
            }
            if (!group.some(item => JSON.stringify(item) === JSON.stringify(facts))) group.push(facts);
        }
    }
    if (!groups.size) return null;
    return <div className="canvas-assistant-card" aria-label="Media censorship record">
        <strong>Media censorship record</strong>
        <span className="canvas-assistant-meta">Recording the actual read fragments and detection results does not mean that the quality has passed.</span>
        {[...groups].map(([key, group], groupIndex) => {
            const title = nodes.find(node => node.id === group[0].source.nodeId)?.title;
            return <div key={key} data-media-fact-group={key}>
                <strong>{title ? `${title} · ` : ""}Check records{groupIndex + 1}</strong>
                {group.map((facts, index) => <div key={index} className="canvas-assistant-meta">
                    <div>{labels[facts.mode]}：{range(facts.source)}  · Full length{seconds(facts.durationMs)}  seconds</div>
                    {facts.mode === "check" ? <>
                        {!facts.hasAudio ? <div>no audio track</div> : wholeIntervalSilent(facts) ? <div>The entire detection interval is muted</div>
                            : facts.silenceIntervals?.length ? <div>Silent interval:{facts.silenceIntervals.map(range).join("、")}</div> : null}
                        {facts.meanDb !== undefined ? <div>Average volume:{facts.meanDb} dB</div> : null}
                        {facts.peakDb !== undefined ? <div>Peak volume:{facts.peakDb} dB</div> : null}
                    </> : null}
                </div>)}
            </div>;
        })}
    </div>;
}
