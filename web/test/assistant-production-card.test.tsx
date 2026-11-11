import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasAssistantTurnView } from "@/pages/canvas/canvas-assistant-turn";
import { assistantProposalProgress, assistantProposalText } from "@/pages/canvas/canvas-assistant-copy";
import type { AssistantGenerationProposal, AssistantScriptProposal, AssistantTurn } from "@/services/api/agent-assistant";

const proposal: AssistantGenerationProposal = {
    proposalId:"gp-film",kind:"image",nodeIds:["frame"],model:"image",modelKey:"custom::image",
    production:{targets:[
        {nodeId:"frame",title:"first frame",kind:"image",modelKey:"custom::image",prompt:"Morning light shines into the flower shop",parameters:{size:"9:16",count:"1"},referenceNodeIds:[]},
        {nodeId:"speech",title:"Chinese narration",kind:"audio",modelKey:"custom::speech",prompt:"Bring spring home.",parameters:{audioVoice:"female-tianmei",audioSpeed:"1",audioFormat:"mp3"},referenceNodeIds:[]},
    ],estimate:{amount:0,priced:0,unknown:2,text:"Estimated cost: No price yet, actual billing will be based on the selected channel"}},source:{canvasId:"canvas",canvasRevision:1,modelConfigRevision:1},
};
test("confirmation shows the paid text, voice, aspect ratio and quantity",()=>{
    const text=assistantProposalText(proposal);
    for(const expected of ["Morning light shines into the flower shop","Bring spring home.","female-tianmei","9:16","1","Estimated cost","Rebill"]) expect(text).toContain(expected);
    const progress=assistantProposalProgress(proposal,[]);
    expect(progress.ready).toBe(false);
    expect(progress.text).toContain("0/2");
});
test("production confirmation shows the backend estimate for each shot and the total",()=>{
    const fullProposal: AssistantGenerationProposal = {
        proposalId: "gp-h3",
        kind: "image",
        nodeIds: ["img-1"],
        model: "gpt-image-2",
        modelKey: "beeftv::gpt-image-2",
        production: {
            targets: [
                { nodeId: "img-1", title: "Storyboard 1-First frame", kind: "image", modelKey: "beeftv::gpt-image-2", prompt: "Shot 1 first frame", parameters: { size: "16:9", count: "1" }, referenceNodeIds: [],
                    estimate: { amount: 0.35, basis: "1K low quality ¥0.35/sheet × 1 sheet", text: "Estimated ¥0.35 (1K low quality ¥0.35/photo × 1 photo)" } },
                { nodeId: "vid-1", title: "Storyboard 1-6s video", kind: "video", modelKey: "beeftv::seedance-2.0", prompt: "Lens 1 video", parameters: { vquality: "720p", seconds: "6", count: "1" }, referenceNodeIds: ["img-1"],
                    estimate: { amount: 5.9616, approx: true, basis: "720p ¥0.9936/second × 6 seconds, converted by Token", text: "About ¥5.96 (720p ¥0.9936/second × 6 seconds, converted by Token)" } },
                { nodeId: "tts-1", title: "Narrator 1", kind: "audio", modelKey: "byok::speech", prompt: "Narration lines", parameters: { count: "1" }, referenceNodeIds: [],
                    estimate: { amount: null, basis: "There is currently no price for channels that come with their own Key, and the actual billing will be based on the channel.", text: "There is currently no price for channels that come with their own Key, and the actual billing will be based on the channel." } },
            ],
            estimate: { amount: 6.3116, priced: 2, unknown: 1, approx: true, text: "Estimated cost: The known part is about ¥6.31, and there is another item with no price yet." },
        },
        source: { canvasId: "canvas", canvasRevision: 1, modelConfigRevision: 1 },
    };
    const text = assistantProposalText(fullProposal);
    expect(text).toContain("Whole film production plan: 1 picture, 1 video, 1 dubbing\nEstimated cost: The known part is about ¥6.31, and there is another item with no price yet.");
    expect(text).toContain("Cost: About ¥5.96 (720p ¥0.9936/second × 6 seconds, converted by Token)");
    expect(text).toContain("Cost: There is currently no price for channels that come with their own Key, and the actual billing will be based on the channel.");
    const submitted = assistantProposalText(fullProposal, [], false);
    expect(submitted).not.toContain("cost");
});
test("proposal card reflects started progress when Pi confirms and admits tasks on canvas nodes",()=>{
    const turn: AssistantTurn = {
        turnId: "turn-1",
        userText: "Start making",
        selectedNodeIds: [],
        reply: "Please confirm the plan",
        toolCalls: [],
        change: null,
        error: null,
        cancelled: false,
        createdAt: "2026-10-26",
        proposals: [proposal],
        proposalsInvalidated: true,
    };
    const html = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={turn}
            handledProposals={new Set()}
            nodes={[{
                id: "frame",
                type: "image",
                title: "first frame",
                x: 0,
                y: 0,
                width: 320,
                height: 180,
                metadata: {
                    status: "loading",
                    taskStatus: "running",
                    taskClientOperationId: "proposal:gp-film:frame",
                },
            }]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(html).not.toContain("Expired");
    expect(html).toContain("Building, 0/2 results are ready.");
});
test("started production does not ask the user to manually continue the next step",()=>{
    const turn:AssistantTurn={turnId:"film",userText:"make short film",selectedNodeIds:[],reply:"",toolCalls:[],change:null,error:null,cancelled:false,createdAt:"2026-10-19",proposals:[proposal]};
    const html=renderToStaticMarkup(<CanvasAssistantTurnView turn={turn} handledProposals={new Set([proposal.proposalId])} nodes={[]}
        onLocate={()=>{}} onUndo={()=>{}} onRunProposal={()=>{}} onDismissProposal={()=>{}} onCheckResults={()=>{}} />);
    expect(html).not.toContain("Fill in the inspection requirements");
    expect(html).not.toContain(">Check results<");
    expect(html).toContain("0/2");
});
test("production proposal card collapses per-item target details by default while keeping overview and confirm action visible",()=>{
    const turn: AssistantTurn = {
        turnId: "turn-collapsed",
        userText: "Make a flower shop short film",
        selectedNodeIds: [],
        reply: "The flower shop short film project has been prepared for you.",
        toolCalls: [],
        change: null,
        error: null,
        cancelled: false,
        createdAt: "2026-10-28",
        proposals: [proposal],
    };
    const html = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={turn}
            handledProposals={new Set()}
            nodes={[]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(html).toContain("The flower shop short film project has been prepared for you.");
    expect(html).toContain("Entire film production plan: 1 picture, 0 videos, 1 dubbing");
    expect(html).toContain("<details class=\"canvas-assistant-proposal-details\"><summary>View 2 lens and prompt word details</summary>");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Confirm and make the entire film");
});
test("legacy proposal without turn reply shows proposal note inside the card without pretending to be a model reply",()=>{
    const turn: AssistantTurn = {
        turnId: "turn-legacy-note",
        userText: "Change the first frame to 9:16",
        selectedNodeIds: [],
        reply: "",
        toolCalls: [],
        change: null,
        error: null,
        cancelled: false,
        createdAt: "2026-10-28",
        proposals: [{ ...proposal, note: "The first frame has been adjusted to portrait at 9:16." }],
    };
    const html = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={turn}
            handledProposals={new Set()}
            nodes={[]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(html).not.toContain("canvas-assistant-reply");
    expect(html).toContain("canvas-assistant-proposal-note");
    expect(html).toContain("The first frame has been adjusted to portrait at 9:16.");
});
test("assistantProposalProgress treats retrievable failed and fetching tasks as running until ready and bound",()=>{
    const withOutcome = (meta: Record<string, unknown>) => meta as NonNullable<Parameters<typeof assistantProposalProgress>[1][number]["metadata"]>;
    const inFlight = assistantProposalProgress(proposal, [
        {
            id: "frame",
            type: "image",
            title: "first frame",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: withOutcome({
                status: "error",
                taskStatus: "failed",
                taskClientOperationId: "proposal:gp-film:frame",
                taskOutcome: { phase: "retrievable", regenerate: "blocked", reason: "image_recovery_pending" },
            }),
        },
        {
            id: "speech",
            type: "audio",
            title: "Chinese narration",
            position: { x: 0, y: 200 },
            width: 320,
            height: 120,
            metadata: withOutcome({
                status: "loading",
                taskStatus: "succeeded",
                taskClientOperationId: "proposal:gp-film:speech",
                taskOutcome: { phase: "fetching", regenerate: "blocked", reason: "result_fetching" },
            }),
        },
    ]);
    expect(inFlight.ready).toBe(false);
    expect(inFlight.text).toBe("Building, 0/2 results are ready.");

    const allReady = assistantProposalProgress(proposal, [
        {
            id: "frame",
            type: "image",
            title: "first frame",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: withOutcome({
                status: "success",
                taskStatus: "succeeded",
                storageKey: "resource:frame-1",
                taskClientOperationId: "proposal:gp-film:frame",
                taskOutcome: { phase: "ready", regenerate: "allowed", reason: "result_ready" },
            }),
        },
        {
            id: "speech",
            type: "audio",
            title: "Chinese narration",
            position: { x: 0, y: 200 },
            width: 320,
            height: 120,
            metadata: withOutcome({
                status: "success",
                taskStatus: "succeeded",
                storageKey: "resource:speech-1",
                taskClientOperationId: "proposal:gp-film:speech",
                taskOutcome: { phase: "ready", regenerate: "allowed", reason: "result_ready" },
            }),
        },
    ]);
    expect(allReady.ready).toBe(true);
    expect(allReady.text).toContain("2 clips saved");

    const settledWithFailure = assistantProposalProgress(proposal, [
        {
            id: "frame",
            type: "image",
            title: "first frame",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: withOutcome({
                status: "error",
                taskStatus: "failed",
                taskClientOperationId: "proposal:gp-film:frame",
                taskOutcome: { phase: "failed", regenerate: "confirm", reason: "no_result" },
            }),
        },
        {
            id: "speech",
            type: "audio",
            title: "Chinese narration",
            position: { x: 0, y: 200 },
            width: 320,
            height: 120,
            metadata: withOutcome({
                status: "success",
                taskStatus: "succeeded",
                storageKey: "resource:speech-1",
                taskClientOperationId: "proposal:gp-film:speech",
                taskOutcome: { phase: "ready", regenerate: "allowed", reason: "result_ready" },
            }),
        },
    ]);
    expect(settledWithFailure.ready).toBe(true);
    expect(settledWithFailure.text).toBe("1 result is ready, 1 result was not generated due to task failure or cancellation.");
});

test("ordinary proposal with generation order targets renders collapsible order details", () => {
    const ordinaryWithOrder: AssistantGenerationProposal = {
        proposalId: "gp-order-1",
        orderId: "gp-order-1",
        kind: "image",
        nodeIds: ["shot-1"],
        model: "gpt-image-1.5",
        modelKey: "beeftv::gpt-image-1.5",
        pricing: "unknown",
        estimate: { amount: 0, priced: 0, unknown: 1, text: "Estimated cost: No price yet, actual billing will be based on the selected channel" },
        approvalMode: "ask",
        status: "pending",
        targets: [{
            nodeId: "shot-1",
            title: "Shot 1",
            kind: "image",
            model: "gpt-image-1.5",
            modelKey: "beeftv::gpt-image-1.5",
            pricing: "unknown",
            estimate: { amount: null, basis: "There is currently no price for channels that come with their own Key, and the actual billing will be based on the channel.", text: "There is currently no price for channels that come with their own Key, and the actual billing will be based on the channel." },
            prompt: "On a neon street corner on a rainy night, the protagonist looks back",
            parameters: { size: "16:9", count: "1" },
            referenceNodeIds: [],
        }],
    };
    const turn: AssistantTurn = {
        turnId: "turn-order-1",
        userText: "Generate the first frame of shot 1",
        selectedNodeIds: ["shot-1"],
        reply: "A generated order has been issued, please confirm.",
        toolCalls: [],
        change: null,
        error: null,
        cancelled: false,
        createdAt: "2026-11-01",
        proposals: [ordinaryWithOrder],
    };
    const html = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={turn}
            handledProposals={new Set()}
            nodes={[]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(html).toContain("<details class=\"canvas-assistant-proposal-details\"><summary>View 1 generation order details</summary>");
    expect(html).toContain("On a neon street corner on a rainy night, the protagonist looks back");
    expect(html).toContain("Estimated cost: No price yet, actual billing will be based on the selected channel");
    expect(html).toContain("Cost: There is currently no price for channels that come with their own Key, and the actual billing will be based on the channel.");
    const invalidated = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={{ ...turn, proposalsInvalidated: true }}
            handledProposals={new Set()}
            nodes={[]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(invalidated).toContain("On a neon street corner on a rainy night, the protagonist looks back");
    expect(invalidated).not.toContain("Fees:");
    expect(html).toContain("canvas-assistant-proposal-lines");
    expect(html).not.toContain("white-space:pre-line");
});

test("skill script proposal card renders confirmation actions and collapsible output after execution", () => {
    const scriptProposal: AssistantScriptProposal = {
        proposalId: "sp-audio-1",
        turnId: "turn-script-1",
        canvasId: "canvas-1",
        skillId: "audio-skill",
        skillName: "sound review",
        versionId: "v1",
        version: "1.0",
        contentHash: "a".repeat(64),
        scriptPath: "scripts/listen.py",
        interpreter: "python3",
        args: ["--check", "shot-1"],
        timeoutSec: 120,
        note: "Check the audio silence interval in the first scene",
        status: "pending",
    };
    const pendingTurn: AssistantTurn = {
        turnId: "turn-script-1",
        userText: "check sound",
        selectedNodeIds: [],
        reply: "Please make sure to run the sound check script.",
        toolCalls: [],
        change: null,
        proposals: [],
        scriptProposals: [scriptProposal],
        error: null,
        cancelled: false,
        createdAt: "2026-11-06",
    };
    const pendingHtml = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={pendingTurn}
            handledProposals={new Set()}
            nodes={[]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onRunScriptProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(pendingHtml).toContain("Run skill script · Sound review (1.0)");
    expect(pendingHtml).toContain("Script path: scripts/listen.py");
    expect(pendingHtml).toContain("Runs as: Python 3");
    expect(pendingHtml).toContain("Startup parameters: --check shot-1");
    expect(pendingHtml).toContain("Installed skill files will not be modified, and your model keys will not be read");
    expect(pendingHtml).toContain("run script");
    expect(pendingHtml).toContain("This conversation is always allowed");
    expect(pendingHtml).toContain("No need for now");

    const completedHtml = renderToStaticMarkup(
        <CanvasAssistantTurnView
            turn={{
                ...pendingTurn,
                scriptProposals: [{
                    ...scriptProposal,
                    status: "completed",
                    result: {
                        exitCode: 0,
                        timedOut: false,
                        cancelled: false,
                        durationMs: 420,
                        stdout: "00:01.20-00:01.80 pause detected",
                        stderr: "",
                    },
                }],
            }}
            handledProposals={new Set(["sp-audio-1"])}
            nodes={[]}
            onLocate={() => {}}
            onUndo={() => {}}
            onRunProposal={() => {}}
            onRunScriptProposal={() => {}}
            onDismissProposal={() => {}}
        />,
    );
    expect(completedHtml).toContain("Completed (took 0.4 seconds)");
    expect(completedHtml).toContain("View script output");
    expect(completedHtml).toContain("00:01.20-00:01.80 pause detected");
    expect(completedHtml).not.toContain("This conversation is always allowed");
});
