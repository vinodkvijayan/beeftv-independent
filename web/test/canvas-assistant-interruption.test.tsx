import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasAssistantTurnView, CanvasAssistantUserMessage } from "@/pages/canvas/canvas-assistant-turn";
import { CanvasAssistantComposer } from "@/pages/canvas/canvas-assistant-composer";
import type { AssistantTurn } from "@/services/api/agent-assistant";

const interrupted: AssistantTurn = {
    turnId: "paused", userText: "Create draft only", selectedNodeIds: [],
    reply: "Two drafts have been created.", toolCalls: [], proposals: [],
    change: { revisionBefore: 1, revisionAfter: 2, createdNodeIds: ["a", "b"], updatedNodeIds: [], createdEdgeIds: [] },
    error: "raw provider error", errorReason: "turn_timeout", cancelled: false, createdAt: "2026-10-08",
};
function render(turn = interrupted, options: { undone?: boolean; continue?: boolean } = {}) {
    return renderToStaticMarkup(<CanvasAssistantTurnView turn={turn} status={{ undone: options.undone }} handledProposals={new Set()}
        onLocate={() => {}} onUndo={() => {}} onRunProposal={() => {}} onDismissProposal={() => {}}
        onContinue={options.continue === false ? undefined : () => {}} />);
}

describe("Auto-continue messages are only briefly displayed based on confirmed identity", () => {
    const internal = "[Auto-continue] This generation has ended. Do not change or send my unsent drafts.";
    test("Automatic marking is displayed for running and restored rounds, retaining the original prompt word data", () => {
        const turn: AssistantTurn = { ...interrupted, continuationId: "trusted-receipt", userText: internal };
        const pending = renderToStaticMarkup(<CanvasAssistantUserMessage text={internal} selectedCount={2} continuationId={turn.continuationId} />);
        const recovered = render(JSON.parse(JSON.stringify(turn)));
        for (const html of [pending, recovered]) {
            expect(html).toContain("Automatically continue");
            expect(html).toContain("The generation has ended, continue checking the results and production.");
            expect(html).not.toContain("Draft not sent");
        }
        expect(turn.userText).toBe(internal);
    });
    test("The same text sent by ordinary users will still be displayed as it is, and supplementary messages will not be folded.", () => {
        expect(render({ ...interrupted, userText: internal })).toContain(internal);
        const supplement = render({ ...interrupted, continuationId: "trusted-receipt", userText: internal, supplements: [internal] });
        expect(supplement).toContain(internal);
        expect(supplement).toContain("The generation has ended, continue checking the results and production.");
    });
});

describe("Processing is not completed but results can be checked.", () => {
    test("Retain replies, actual changes and revocations over time, and provide neutral status and continuation entrance", () => {
        const html = render();
        expect(html).toContain("Two drafts have been created");
        expect(html).toContain("Create 2 new nodes");
        expect(html).toContain("Undo this round");
        expect(html).toContain("Not yet completed");
        expect(html).toContain("Continue processing");
        expect(html).toContain('class="canvas-assistant-incomplete"');
        expect(html).not.toContain("canvas-assistant-failed");
        expect(html).not.toContain("raw provider error");
    });
    test("The continue button is not displayed when it has been undone, old round or read-only.", () => {
        for (const html of [render(interrupted, { undone: true }), render(interrupted, { continue: false })]) {
            expect((html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).some(button => button.includes("Continue processing"))).toBe(false);
        }
        expect(render(interrupted, { undone: true })).toContain("Canvas changes undone");
    });
    test("Non-continuable configuration error still clearly fails and does not pretend to have been recovered", () => {
        const html = render({ ...interrupted, errorReason: "forbidden" });
        expect(html).toContain("canvas-assistant-failed");
        expect(html).not.toContain("Continue processing");
        expect(html).not.toContain("Not yet completed");
    });
    test("Input and stop are retained during operation, and there is a clear supplementary entrance, and no new material attachments are added.", () => {
        const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><CanvasAssistantComposer value="Only change the ending" onChange={() => {}} onSend={() => {}} onStop={() => {}}
            streaming disabled={false} canSupplement supplementBusy={false} references={[]} selectedCount={3} selectionAttached onDetachSelection={() => {}} /></QueryClientProvider>);
        expect(html).toMatch(/补\s*充/);
        expect(html).toContain("stop");
        const input = html.match(/<textarea\b[^>]*>/)?.[0] || html.match(/<div\b[^>]*contentEditable="true"[^>]*>/)?.[0];
        expect(input).toBeDefined();
        expect(input).not.toContain('disabled=""');
        expect(html).not.toContain("3 nodes selected");
    });
    test("Supplementary requests received will be retained in the history and the original user messages will not be overwritten.", () => {
        const html = render({ ...interrupted, supplements: ["The ending is changed to cake"] });
        expect(html).toContain("Create draft only");
        expect(html).toContain("The ending is changed to cake");
    });
});

describe("The stopped round gives the next step based on the actual result.", () => {
    const stopped: AssistantTurn = { ...interrupted, turnId: "stopped", error: null, errorReason: null, cancelled: true };
    const continueButtons = (html: string) => (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).filter(button => button.includes("Continue processing"));
    test("The canvas has been modified before stopping: changes and undo are retained, and a continuation entry is provided.", () => {
        const html = render(stopped);
        expect(html).toContain("This one has been stopped");
        expect(html).toContain("Create 2 new nodes");
        expect(html).toContain("Undo this round");
        expect(continueButtons(html)).toHaveLength(1);
        expect(html).toContain("Send after confirming or adding requirements in the input box.");
    });
    test("No changes have been made when stopped: it only indicates that it has been stopped, does not provide continuation, and does not indicate completion.", () => {
        const html = render({ ...stopped, reply: "", change: null });
        expect(html).toContain("This one has been stopped.");
        expect(continueButtons(html)).toHaveLength(0);
        expect(html).not.toContain("canvas-assistant-change");
        expect(html).not.toContain("Completed");
    });
    test("When the round has been revoked, old round or read-only, the stopped round does not provide continuation.", () => {
        expect(continueButtons(render(stopped, { undone: true }))).toHaveLength(0);
        expect(continueButtons(render(stopped, { continue: false }))).toHaveLength(0);
    });
});

const proposalTurn: AssistantTurn = {
    ...interrupted, turnId: "with-proposal", error: null, errorReason: null,
    proposals: [{ proposalId: "gp-1", kind: "image", nodeIds: ["a"], model: "Picture model", modelKey: "channel::image" }],
};
function buttons(html: string) {
    return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).map(button => button.replace(/<[^>]+>/g, "").replace(/\s+/g, ""));
}

describe("Revoked generated suggestions are no longer available", () => {
    test("Generating and not using are still provided when not revoked", () => {
        const labels = buttons(render(proposalTurn));
        expect(labels).toContain("generate");
        expect(labels).toContain("No need for now");
    });
    test("Suggestions that have not been started after being revoked only indicate that they will not be generated and there is no button.", () => {
        const html = render(proposalTurn, { undone: true });
        expect(html).toContain("This round has been undone and will not be generated.");
        expect(buttons(html)).not.toContain("generate");
        expect(buttons(html)).not.toContain("No need for now");
    });
    test("A build that was started before canceling still shows that the build has started.", () => {
        const html = renderToStaticMarkup(<CanvasAssistantTurnView turn={proposalTurn} status={{ undone: true }} handledProposals={new Set(["gp-1"])}
            onLocate={() => {}} onUndo={() => {}} onRunProposal={() => {}} onDismissProposal={() => {}} />);
        expect(html).toContain("Started generating");
        expect(html).not.toContain("This round has been undone and will not be generated.");
    });
});

describe("Skill labels only show names", () => {
    const hash = "352590bd".repeat(8);
    test("Display the name and version when there is a name", () => {
        const html = render({ ...interrupted, skills: [{ skillId: "s1", versionId: "cc4bb169", contentHash: hash, skillName: "Short drama asset batching process", version: "1" }] });
        expect(html).toContain("Skills: Short drama asset batching process · 1");
    });
    test("If the name is unrecognizable, the description has been removed and the logo will not be displayed.", () => {
        const html = render({ ...interrupted, skills: [{ skillId: "352590bd", versionId: "cc4bb169", contentHash: hash }],
            supplementInputs: [{ message: "supplement", skills: [{ skillId: "352590bd", versionId: "cc4bb169", contentHash: hash }] }] });
        expect(html).toContain("Skills: Removed skills");
        expect(html).not.toContain("352590bd");
        expect(html).not.toContain("cc4bb169");
    });
});
