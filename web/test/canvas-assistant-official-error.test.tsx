import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { agentAssistantFailureText, type AssistantTurn } from "@/services/api/agent-assistant";
import { assistantTurnCanContinue, ASSISTANT_CONTINUE_PROMPT } from "@/pages/canvas/canvas-assistant-copy";
import { CanvasAssistantTurnView } from "@/pages/canvas/canvas-assistant-turn";
const makeTurn = (reason: string): AssistantTurn => ({
    turnId: "current-turn",
    userText: "Check video results",
    reply: "",
    createdAt: "2026-10-08",
    error: "Request timed out.",
    errorReason: reason,
    cancelled: false,
    selectedNodeIds: [],
    toolCalls: [{ tool: "canvas.node.update", args: { nodeId: "saved-node" } }],
    change: { revisionBefore: 1, revisionAfter: 2, createdNodeIds: ["saved-node"], updatedNodeIds: [], createdEdgeIds: [] },
    proposals: [{ proposalId: "confirmed-proposal", kind: "video", model: "test-video-model", modelKey: "test-video-model", nodeIds: ["saved-node"] }],
});
for (const reason of ["model_error", "provider_error"])
    test(reason + " is incomplete/continuable while committed changes and started proposal stay visible", () => {
        const turn = makeTurn(reason);
        const before = JSON.stringify(turn);
        let actions = 0;
        const html = renderToStaticMarkup(
            <CanvasAssistantTurnView turn={turn} handledProposals={new Set(["confirmed-proposal"])} onLocate={() => actions++} onUndo={() => actions++} onRunProposal={() => actions++} onDismissProposal={() => actions++} onContinue={() => actions++} />,
        );
        expect(html).toContain("Not yet completed");
        expect(html).toContain("The model has not completed the reply");
        expect(html).toContain("Completed operations will be retained");
        expect(html).toContain("Continue processing");
        expect(html).toContain("Create 1 new node");
        expect(html).toContain("Started generating");
        expect(html).not.toContain("This step is not completed");
        expect(actions).toBe(0);
        expect(JSON.stringify(turn)).toBe(before);
        expect(turn.error).toBeTruthy();
    });
test("continuation stays manual and does not expose an action after undo or without a handler", () => {
    const props = { turn: makeTurn("model_error"), handledProposals: new Set(["confirmed-proposal"]), onLocate: () => {}, onUndo: () => {}, onRunProposal: () => {}, onDismissProposal: () => {} };
    expect(renderToStaticMarkup(<CanvasAssistantTurnView {...props} />)).not.toContain(">Continue processing<");
    expect(
        renderToStaticMarkup(
            <CanvasAssistantTurnView
                {...props}
                status={{ undone: true }}
                onContinue={() => {
                    throw Error("must not submit");
                }}
            />,
        ),
    ).not.toContain(">Continue processing<");
    expect(ASSISTANT_CONTINUE_PROMPT).toContain("Do not re-create nodes or resubmit already started build tasks");
});
test("unknown and fatal policy failures retain existing conservative action eligibility", () => {
    for (const reason of ["forbidden", "native_history_unavailable", "request_budget_storage_unavailable", "unrecognized_reason"]) expect(assistantTurnCanContinue(reason)).toBe(false);
    expect(agentAssistantFailureText("unrecognized_reason", "fallback")).toBe("fallback");
    expect(assistantTurnCanContinue("turn_timeout")).toBe(true);
});
