import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasAssistantTurnView } from "@/pages/canvas/canvas-assistant-turn";
import type { AssistantTurn } from "@/services/api/agent-assistant";

const turn: AssistantTurn = { turnId: "source", userText: "Make first frame", selectedNodeIds: [], reply: "Plan is ready", toolCalls: [], change: null,
    proposals: [{ proposalId: "p1", kind: "image", nodeIds: ["source"], model: "Picture model" }], error: null, cancelled: false, createdAt: "2026-10-18" };
function render(proposalsInvalidated: boolean, started = false, generationDisabled = false) {
    return renderToStaticMarkup(<CanvasAssistantTurnView turn={{ ...turn, proposalsInvalidated }} handledProposals={new Set(started ? ["p1"] : [])}
        generationDisabled={generationDisabled} onLocate={() => {}} onUndo={() => {}} onRunProposal={() => {}} onDismissProposal={() => {}} />);
}
test("expired unstarted cards cannot generate, while existing outputs remain available", () => {
    const expired = render(true);
    expect(expired).toContain("It has expired. Please ask the assistant to propose a new generation plan.");
    expect(expired).not.toContain("After confirmation, billing will begin based on the selected channel.");
    expect(expired).not.toMatch(/<button\b[^>]*>[\s\S]*?生成<\/span>/);
    const started = render(true, true);
    expect(started).toContain("Started generating");
    expect(started).not.toContain("Expired");
});
test("a valid card remains available, and sending only disables its generation action", () => {
    expect(render(false)).not.toContain("Expired");
    const sending = render(false, false, true);
    const buttons = sending.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
    expect(buttons.find(button => button.includes("generate"))).toContain('disabled=""');
    expect(buttons.find(button => button.includes("No need for now"))).not.toContain('disabled=""');
});
