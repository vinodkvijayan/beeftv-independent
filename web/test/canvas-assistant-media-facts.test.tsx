import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasAssistantTurnView } from "@/pages/canvas/canvas-assistant-turn";
import { CanvasAssistantPlan } from "@/pages/canvas/canvas-assistant-sidebar";
import type { AssistantTurn } from "@/services/api/agent-assistant";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const source = { resourceId: "resource-1", version: "a".repeat(64), startMs: 5000, endMs: 12000 };
const call = (mode: string, overrides = {}) => ({ tool: mode === "check" ? "media.check" : "media.inspect", isError: false,
    mediaFacts: { source, mode, durationMs: 18000, hasAudio: true, ...overrides } });
function render(calls: unknown[], reply = "", nodes?: CanvasNodeData[]) {
    const turn = JSON.parse(JSON.stringify({ turnId: "turn", userText: "Check existing films", selectedNodeIds: [], reply, toolCalls: calls, change: null,
        proposals: [], error: null, cancelled: false, createdAt: "2026-10-19" })) as AssistantTurn;
    return renderToStaticMarkup(<CanvasAssistantTurnView turn={turn} nodes={nodes} handledProposals={new Set()} onLocate={() => {}} onUndo={() => {}} onRunProposal={() => {}} onDismissProposal={() => {}} />);
}

test("actual turn displays exact read intervals and full-interval silence independently of assistant prose", () => {
    const html = render([call("video"), call("audio"), call("audio", { source: { ...source, startMs: 12000, endMs: 18000 } }),
        call("check", { source: { ...source, startMs: 0, endMs: 18000 }, silenceIntervals: [{ startMs: 0, endMs: 18000 }], meanDb: -91, peakDb: -91 })], "The whole film has been checked, 1280×720");
    expect(html).toContain('aria-label="Media Check Record"');
    expect(html).toContain("Video clip read: 5–12 seconds");
    expect(html).toContain("Audio clip read: 12–18 seconds");
    expect(html).toContain("Objective detection: 0–18 seconds");
    expect(html).toContain("The entire detection interval is muted");
    expect(html).toContain("Average volume: -91 dB");
    expect(html).toContain("Total length 18 seconds");
    const facts = html.slice(html.indexOf('aria-label="Media Check Record"'));
    expect(facts).not.toContain("1280");
    expect(facts).not.toContain("Qualified quality");
    expect(facts).not.toContain("Check failed");
});

test("different resources and versions remain separate; partial silence and frames do not imply a whole review", () => {
    const html = render([call("video"), call("audio", { source: { ...source, version: "b".repeat(64) } }),
        call("check", { source: { ...source, resourceId: "resource-2", startMs: 0, endMs: 18000 }, silenceIntervals: [{ startMs: 5000, endMs: 12000 }] }), call("frames")]);
    expect(html.match(/data-media-fact-group=/g)).toHaveLength(3);
    expect(html).toContain("Check record 2");
    expect(html).toContain("Check record 3");
    expect(html).not.toContain("Version 2");
    expect(html).toContain("Silent interval: 5–12 seconds");
    expect(html).toContain("Static frame extraction interval: 5–12 seconds");
    expect(html).not.toContain("Mute the whole segment");
});

test("node identity supplies only a readable name, never current media facts", () => {
    const html = render([call("video", { source: { ...source, nodeId: "final" } })], "", [{ id: "final", title: "The smell of bread in the morning", type: CanvasNodeType.Video,
        position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { storageKey: "resource:newer-video", durationMs: 90000 } }]);
    expect(html).toContain("The smell of bread in the morning · Inspection record 1");
    expect(html).toContain("Total length 18 seconds");
    expect(html).not.toContain("90 seconds");
});

test("failed, unrelated and old tool records never invent checks", () => {
    for (const calls of [[{ ...call("video"), isError: true }], [{ ...call("video"), tool: "canvas.get" }],
        [{ tool: "media.inspect", args: { mode: "video", startMs: 0, endMs: 18000 }, isError: false }]]) {
        expect(render(calls)).not.toContain('aria-label="Media Check Record"');
    }
});

test("a full plan shows step progress without declaring quality accepted", () => {
    const html = renderToStaticMarkup(<CanvasAssistantPlan plan={{ goal: "sound film", items: [{ id: "review", title: "Check", status: "done" }], done: 1, total: 1, updatedAt: "now" }} />);
    expect(html).toContain("Step Progress · 1/1");
    expect(html).not.toContain("Production plan · Completed");
});

test("one overview retains every actual evidence item in the same resource group", () => {
    const bundle = { tool: "media.overview", isError: false, mediaEvidence: [call("frames").mediaFacts,
        call("video").mediaFacts, call("audio").mediaFacts, call("check", { meanDb: -18 }).mediaFacts] };
    const html = render([bundle]);
    expect(html.match(/data-media-fact-group=/g)).toHaveLength(1);
    for (const label of ["static frame interval", "Video clip reading", "Audio clip reading", "objective testing"]) expect(html).toContain(label);
    expect(html).toContain("Average volume: -18 dB");
    expect(render([{ ...bundle, isError: true }])).not.toContain('aria-label="Media Check Record"');
});
