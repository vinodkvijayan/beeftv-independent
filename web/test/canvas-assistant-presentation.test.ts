import { describe, expect, test } from "bun:test";

import {
    ASSISTANT_STARTER_PROMPTS,
    ASSISTANT_UNAVAILABLE_FALLBACK,
    assistantActionLabel,
    assistantChangeSummary,
    assistantChangedNodeIds,
    assistantLifecycleText,
    assistantTurnCanContinue,
    assistantFailedActionText,
    assistantProposalText,
    assistantProposalProgress,
    appendAssistantDraft,
    assistantStatusNotice,
    assistantUndoFailureText,
} from "@/pages/canvas/canvas-assistant-copy";
import { ASSISTANT_DEFAULT_WIDTH, ASSISTANT_MAX_WIDTH, ASSISTANT_MIN_WIDTH, clampAssistantWidth, dismissedProposalKey, resolveCanvasRightPanel } from "@/pages/canvas/use-canvas-assistant";
import type { AssistantTurnChange } from "@/services/api/agent-assistant";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { removeCanvasNodes } from "@/lib/canvas/canvas-project-domain";
import { generationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import type { GenerationTask } from "@/services/api/task-center";

describe("The reason why the assistant is unavailable is mapped into a user language and a way out", () => {
    test("Missing models and unsupported protocols both point to the model configuration.", () => {
        for (const reason of ["model_not_configured", "model_protocol_unsupported"]) {
            const notice = assistantStatusNotice(reason);
            expect(notice.text).toBe("There is no helper model available yet");
            expect(notice.action).toBe("model-settings");
            expect(notice.actionLabel).toBe("Go to model configuration");
        }
    });

    test("Missing credentials point to connect", () => {
        const notice = assistantStatusNotice("credential_missing");
        expect(notice.text).toBe("BeefTV is not connected yet");
        expect(notice.action).toBe("model-settings");
    });

    test("Starting only reports progress, no buttons, and asks for a faster review", () => {
        const notice = assistantStatusNotice("host_starting");
        expect(notice.text).toBe("Assistant starting...");
        expect(notice.action).toBeUndefined();
        expect(notice.starting).toBe(true);
    });

    test("If startup fails or fails to connect, try again.", () => {
        for (const reason of ["host_start_failed", "host_unreachable"]) {
            const notice = assistantStatusNotice(reason);
            expect(notice.text).toBe("The assistant did not start successfully");
            expect(notice.action).toBe("retry");
        }
    });

    test("If the reason is missing or not recognized yet, the original value will not be displayed.", () => {
        for (const reason of [undefined, "", "something_new_from_backend"]) {
            const notice = assistantStatusNotice(reason);
            expect(notice.text).toBe(ASSISTANT_UNAVAILABLE_FALLBACK);
            expect(notice.text).not.toContain("something_new_from_backend");
        }
    });
});

describe("Tool calls are translated into what is done", () => {
    test("Known operations speak human language", () => {
        expect(assistantActionLabel("canvas.nodes.create")).toBe("Create new node");
        expect(assistantActionLabel("canvas.node.update")).toBe("Modify node");
        expect(assistantActionLabel("canvas.timeline.update")).toBe("Edit timeline");
        expect(assistantActionLabel("canvas.edge.create")).toBe("Connect");
        expect(assistantActionLabel("canvas.get")).toBe("Read canvas");
        expect(assistantActionLabel("canvas.search")).toBe("Read canvas");
        expect(assistantActionLabel("asset.list")).toBe("Read material");
        expect(assistantActionLabel("asset.get")).toBe("Read material");
        expect(assistantActionLabel("media.overview")).toBe("Browse materials");
        expect(assistantActionLabel("media.inspect")).toBe("View and listen to material");
        expect(assistantActionLabel("media.check")).toBe("Check media files");
    });

    test("Do not expose internal names for operations you have never seen before.", () => {
        expect(assistantActionLabel("canvas.something.new")).toBe("Change canvas");
        expect(assistantActionLabel(undefined)).toBe("Change canvas");
    });

    test("On the failed step, explain clearly what failed.", () => {
        expect(assistantFailedActionText({ tool: "canvas.edge.create", isError: true })).toBe("Connection failed");
    });
});

describe("Summary of changes by round", () => {
    const change = (patch: Partial<AssistantTurnChange>): AssistantTurnChange => ({
        revisionBefore: 1,
        revisionAfter: 2,
        createdNodeIds: [],
        updatedNodeIds: [],
        createdEdgeIds: [],
        ...patch,
    });

    test("Only report objects that are actually implemented", () => {
        expect(assistantChangeSummary(change({ createdNodeIds: ["a", "b", "c"], createdEdgeIds: ["e1", "e2"] }))).toBe("Create 3 new nodes and connect 2 lines");
        expect(assistantChangeSummary(change({ updatedNodeIds: ["a", "b"] }))).toBe("Modify 2 nodes");
        expect(assistantChangeSummary(change({ timelineUpdated: true }))).toBe("Edit timeline");
        expect(assistantChangeSummary(change({ timelineUpdated: false }))).toBeNull();
    });

    test("No card will be released if there are no changes", () => {
        expect(assistantChangeSummary(null)).toBeNull();
        expect(assistantChangeSummary(undefined)).toBeNull();
        expect(assistantChangeSummary(change({}))).toBeNull();
    });

    test("Cross-canvas summary counts by all real receipts, positioning still only uses undeleted nodes of the main canvas", () => {
        const receipt = change({ createdNodeIds: ["main"], deletedNodeIds: ["gone"], canvasChanges: [
            { ...change({ createdNodeIds: ["main"], deletedNodeIds: ["gone"], deletedEdgeIds: ["edge"] }), canvasId: "c1", operationIds: ["op1"] },
            { ...change({ createdNodeIds: ["other"], updatedNodeIds: ["existing"], timelineUpdated: true }), canvasId: "c2", operationIds: ["op2"] },
        ] });
        expect(assistantChangeSummary(receipt)).toBe("Modified 2 canvases, created 2 new nodes, modified 1 node, deleted 1 node, deleted 1 line, modified timeline");
        expect(assistantChangedNodeIds(receipt)).toEqual(["main"]);
        expect(assistantChangedNodeIds(change({ updatedNodeIds: ["gone", "kept"], deletedNodeIds: ["gone"] }))).toEqual(["kept"]);
        expect(assistantChangeSummary(change({ revisionAfter: 0, canvasChanges: [
            { ...change({ documentUpdated: true }), canvasId: "other", operationIds: ["op3"] },
        ] }))).toBe("Modified 1 canvas, modified canvas content");
    });

    test("The positioned objects include new ones and modified ones, and are not repeated.", () => {
        expect(assistantChangedNodeIds(change({ createdNodeIds: ["a"], updatedNodeIds: ["a", "b"] })).sort()).toEqual(["a", "b"]);
        expect(assistantChangedNodeIds(null)).toEqual([]);
    });
});

describe("Undo failure reason mapping", () => {
    test("After the canvas has been changed again, it shows that it cannot be undone directly.", () => {
        expect(assistantUndoFailureText("canvas_changed")).toBe("The canvas has been modified since then and cannot be undone directly.");
    });

    test("Each of the remaining reasons has one sentence, and no machine-readable value appears.", () => {
        expect(assistantUndoFailureText("already_undone")).toBe("This round has been canceled");
        expect(assistantUndoFailureText("no_change")).toBe("No canvas changes were made this round");
        expect(assistantUndoFailureText("unknown")).toBe("Undo was unsuccessful, please try again");
    });
});

describe("Paid generation confirmation", () => {
    test("A single image of the entire piece showing the Seedream options to be submitted", () => {
        const text = assistantProposalText({ proposalId: "p", kind: "image", nodeIds: ["a"], model: "seedream", modelKey: "custom::seedream", production: { targets: [{ nodeId: "a", title: "first frame", kind: "image", modelKey: "custom::seedream", prompt: "flower shop", parameters: { count: "1", seedreamOutputFormat: "jpeg", seedreamOptimize: "fast", seedreamWatermark: "true" }, referenceNodeIds: [] }] } });
        expect(text).toContain("Image format: JPEG");
        expect(text).toContain("Prompt word optimization: fast");
        expect(text).toContain("Image watermark: Enable");
        expect(text).not.toContain("seedreamOptimize");
    });
    test("Explain the quantity, which model to use, and who will deduct the payment.", () => {
        const text = assistantProposalText({ proposalId: "p1", kind: "image", nodeIds: ["a", "b"], model: "seedream-4", modelKey: "ch::seedream-4", note: "" });
        expect(text).toBe("Generate images for 2 nodes · seedream-4\nAfter confirmation, billing will begin based on the selected channel.");
        // 不能把带渠道前缀的内部值显示出来。
        expect(text).not.toContain("ch::");
    });

    test("Video proposal is about video", () => {
        const text = assistantProposalText({ proposalId: "p2", kind: "video", nodeIds: ["a"], model: "seedance-1", modelKey: "ch::seedance-1" });
        expect(text).toContain("Generate video for 1 node");
    });
    test("Cards that have been submitted or ended are no longer prompted to confirm generation and billing", () => {
        const text = assistantProposalText({ proposalId: "p2", kind: "video", nodeIds: ["a"], model: "image", modelKey: "ch::image" }, ["quote"], false);
        expect(text).not.toContain("Start after confirmation");
        expect(text).not.toContain("billing");
        expect(text).not.toContain("quote");
    });

    test("Old live model proposed to display unified name with current channel offer", () => {
        const text = assistantProposalText({ proposalId: "portrait", kind: "video", nodeIds: ["a"], model: "seedance-2.0-portrait", modelKey: "byok::seedance-2.0-portrait" }, ["720p: without video input ¥69, with video input ¥42 / million video tokens"]);
        expect(text).toContain("Seedance 2.0");
        expect(text).not.toContain("Seedance 2.0-Real Person");
        expect(text).toContain("¥69");
        expect(text).toContain("¥42");
        expect(text).not.toContain("byok::");
    });
});

describe("Generate results using only real receipts for this proposal", () => {
    const proposal = { proposalId: "p1", kind: "image" as const, nodeIds: ["source"], model: "image", modelKey: "channel::image" };
    const node = (id: string, metadata: CanvasNodeMetadata = {}): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
    const ready = (id: string, patch: CanvasNodeMetadata = {}) => node(id, { taskClientOperationId: "proposal:p1:source", taskId: "task-1", taskStatus: "succeeded", status: "success", storageKey: "resource:ready", ...patch });

    test("The existing results do not pretend to be the results of this time, the real new targets are available for inspection.", () => {
        expect(assistantProposalProgress(proposal, [ready("source", { taskClientOperationId: "older" })]).ready).toBe(false);
        const progress = assistantProposalProgress(proposal, [ready("source", { taskClientOperationId: "older" }), ready("new-result")]);
        expect(progress.ready).toBe(true);
        expect(progress.nodeIds).toEqual(["new-result"]);
    });
    test("The upstream success cannot be checked but it has not been retrieved yet. Failure and cancellation can be actively analyzed.", () => {
        expect(assistantProposalProgress(proposal, [ready("a", { status: "loading", storageKey: undefined })]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [ready("a", { taskOutcome: { phase: "fetching", regenerate: "blocked", reason: "fetching_outputs" } })]).ready).toBe(false);
        for (const taskStatus of ["failed", "cancelled"]) expect(assistantProposalProgress(proposal, [ready("a", { taskStatus, status: "error", storageKey: undefined })]).ready).toBe(true);
    });
    test("Wait for all original outputs to be finalized in batches. Missing items and unsubmitted items cannot be covered up by successful results.", () => {
        const root = node("batch", { isBatchRoot: true, batchChildIds: ["a", "b"], generationOutputNodeIds: ["a", "b"] });
        const a = ready("a", { batchRootId: "batch", taskClientOperationId: "proposal:p1:source:0" });
        const b = ready("b", { batchRootId: "batch", taskClientOperationId: "proposal:p1:source:1" });
        expect(assistantProposalProgress(proposal, [root, a]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [root, a, node("b", { batchRootId: "batch", status: "loading" })]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [root, a, { ...b, metadata: { ...b.metadata, taskStatus: "running" } }]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [root, a, b]).nodeIds).toEqual(["a", "b"]);
        expect(assistantProposalProgress(proposal, [root, a, b]).ready).toBe(true);
        const legacyRoot = { ...root, metadata: { ...root.metadata, generationOutputNodeIds: undefined } };
        expect(assistantProposalProgress(proposal, [legacyRoot, a, b]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [a, b]).ready).toBe(false);
    });
    test("Native multi-graph root nodes are not counted repeatedly; partial failures retain successful products", () => {
        const root = ready("batch", { isBatchRoot: true, batchChildIds: ["a", "b"], generationOutputNodeIds: ["a", "b"] });
        const a = ready("a", { batchRootId: "batch" });
        const b = ready("b", { batchRootId: "batch", taskStatus: "failed", status: "error", storageKey: undefined });
        const progress = assistantProposalProgress(proposal, [root, a, b]);
        expect(progress.ready).toBe(true);
        expect(progress.nodeIds).toEqual(["a", "b"]);
        expect(progress.text).toContain("1 result is ready, 1 result failed due to task");
    });
    test("Seedream's independent output can be checked after it is fully saved. If the image is missing or has not been retrieved, continue to wait.", () => {
        const root = ready("source", { isBatchRoot: false, taskOutputIndex: 0, generationOutputNodeIds: ["source", "sibling"] });
        const sibling = ready("sibling", { isBatchRoot: false, taskOutputIndex: 1 });
        const progress = assistantProposalProgress(proposal, [root, sibling]);
        expect(progress.ready).toBe(true);
        expect(progress.nodeIds).toEqual(["source", "sibling"]);
        expect(progress.text).toContain("2 results are ready");
        expect(assistantProposalProgress(proposal, [root]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [root, ready("sibling", { taskStatus: "running" })]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [root, ready("sibling", { taskOutcome: { phase: "fetching", regenerate: "blocked", reason: "fetching_outputs" } })]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [root, ready("sibling", { taskClientOperationId: "older" })]).ready).toBe(false);
        expect(assistantProposalProgress(proposal, removeCanvasNodes([root, sibling], new Set(["sibling"])).nodes).ready).toBe(false);
        expect(assistantProposalProgress(proposal, [ready("source", { generationOutputNodeIds: ["source"], isBatchRoot: false })]).ready).toBe(true);
    });
    test("Deleting a running subitem will shorten the current list, but will not call the original batch that is still running complete.", () => {
        const root = node("batch", { isBatchRoot: true, batchChildIds: ["a", "b"], generationOutputNodeIds: ["a", "b"], count: 2 });
        const a = ready("a", { batchRootId: "batch", count: 2, taskClientOperationId: "proposal:p1:source:0" });
        const b = ready("b", { batchRootId: "batch", count: 2, taskStatus: "running", taskClientOperationId: "proposal:p1:source:1" });
        const after = removeCanvasNodes([root, a, b], new Set(["b"])).nodes;
        expect(after.find(item => item.id === "batch")?.metadata?.batchChildIds).toEqual(["a"]);
        expect(after.find(item => item.id === "batch")?.metadata?.generationOutputNodeIds).toEqual(["a", "b"]);
        expect(assistantProposalProgress(proposal, after).ready).toBe(false);
        const editedCount = after.map(item => ({ ...item, metadata: { ...item.metadata, count: 1 } }));
        expect(assistantProposalProgress(proposal, editedCount).ready).toBe(false);
        expect(assistantProposalProgress(proposal, editedCount).text).toContain("Unable to confirm whether this batch of results is complete");
    });
    test("The three failed products of a native task are counted according to the results and do not pretend to be three tasks.", () => {
        const metadata = generationTaskMetadata({ id: "one-native-task", clientOperationId: "proposal:p1:source", status: "failed" } as GenerationTask);
        const root = node("batch", { ...metadata, isBatchRoot: true, batchChildIds: ["a", "b", "c"], generationOutputNodeIds: ["a", "b", "c"], count: 3 });
        const children = ["a", "b", "c"].map(id => node(id, { ...metadata, batchRootId: "batch", count: 3, status: "error" }));
        const progress = assistantProposalProgress(proposal, [root, ...children]);
        expect(progress.ready).toBe(true);
        expect(progress.text).toContain("3 results due to task failure");
        expect(progress.text).not.toContain("3 tasks");
    });
    test("Do not string to similar operation numbers, do not infer from the missing second source node that all completions", () => {
        expect(assistantProposalProgress(proposal, [ready("a", { taskClientOperationId: "proposal:p1:source:other" })]).ready).toBe(false);
        expect(assistantProposalProgress({ ...proposal, nodeIds: ["source", "missing"] }, [ready("a")]).ready).toBe(false);
    });
    test("The inspection requires that the original draft be retained and do not add repeated dots.", () => {
        expect(appendAssistantDraft("keep my ending", "Check the build results")).toBe("keep my ending\n\n\nCheck the build results");
        expect(appendAssistantDraft("keep my ending\n\nCheck the build results", "Check the build results")).toBe("keep my ending\n\nCheck the build results");
    });
});

describe("Right fields are mutually exclusive", () => {
    test("The assistant does not render when the version record occupies the field", () => {
        expect(resolveCanvasRightPanel(true, true)).toBe("versions");
        expect(resolveCanvasRightPanel(false, true)).toBe("versions");
    });

    test("When only the assistant is turned on, it is the assistant. When both are not turned on, the field is empty.", () => {
        expect(resolveCanvasRightPanel(true, false)).toBe("assistant");
        expect(resolveCanvasRightPanel(false, false)).toBeNull();
    });
});

describe("Official life cycle progress", () => {
    test("Media tools show real work in progress, ending non-faking has been successful", () => {
        expect(assistantLifecycleText({ phase: "tool", toolName: "media_overview" })).toBe("Loading material summary.");
        expect(assistantLifecycleText({ phase: "tool", toolName: "media_inspect" })).toBe("Checking selected footage.");
        expect(assistantLifecycleText({ phase: "tool", toolName: "media_check" })).toBe("Checking black screen, audio track and file information.");
        expect(assistantLifecycleText({ phase: "tool", toolName: "unknown_tool" })).toBeNull();
        expect(assistantLifecycleText({ phase: "tool_end", toolName: "media_check" })).not.toContain("checked");
        expect(assistantLifecycleText({ phase: "tool_end", toolName: "media_check", success: false })).not.toContain("checked");
        expect(assistantLifecycleText({ phase: "tool_end", toolName: "media_check", success: true })).toBe("Media file information has been checked and production is continuing.");
    });
    test("The production operation displays the in-progress and confirmed completion status without exposing the tool name.", () => {
        expect(assistantLifecycleText({ phase: "tool", toolName: "canvas_node_configure" })).toBe("Configuring build parameters.");
        expect(assistantLifecycleText({ phase: "tool_end", toolName: "canvas.node.configure", success: true })).toBe("The generation parameters have been configured and production is continuing.");
        expect(assistantLifecycleText({ phase: "tool_end", toolName: "canvas_timeline_render", success: true })).toBe("The film has been submitted for compositing and production is continuing.");
        expect(assistantLifecycleText({ phase: "tool_end", toolName: "unknown_tool", success: true })).toBeNull();
    });
    test("Use a complete sentence each for compression and retry, and the end event will no longer show progress.", () => {
        expect(assistantLifecycleText({ phase: "compaction" })).toBe("The conversation is being organized for easy continuation.");
        expect(assistantLifecycleText({ phase: "business", stage: "saving", saved: 2, total: 3 })).toBe("Existing results are generated and the file is being saved. Results for 2/3 tasks have been saved.");
        expect(assistantLifecycleText({ phase: "business", stage: "binding" })).toBe("File saved, canvas updated.");
        expect(assistantLifecycleText({ phase: "business", stage: "exporting" })).toBe("The video is available and the editable project is being exported.");
        expect(assistantLifecycleText({ phase: "business", stage: "observation_unavailable" })).not.toContain("Regenerate");
        expect(assistantLifecycleText({ phase: "business", stage: "saving", saved: 9, total: 3 })).not.toContain("9/3");
        expect(assistantLifecycleText({ phase: "retry" })).toBe("The model is temporarily unresponsive, trying again.");
        expect(assistantLifecycleText({ phase: "compaction_end" })).toBeNull();
        expect(assistantLifecycleText({ phase: "retry_end" })).toBeNull();
        expect(assistantLifecycleText({ phase: "compaction" })).not.toContain("compaction");
        expect(assistantLifecycleText({ phase: "retry" })).not.toContain("retry");
    });
});

describe("Scope to continue after interruption", () => {
    test("Stage interruption and model response failure provide a continued request entry, and permanent configuration problems will not be retried.", () => {
        for (const reason of ["turn_timeout", "turn_interrupted", "model_request_failed", "turn_request_budget_exhausted", "turn_tool_step_budget_exhausted"]) {
            expect(assistantTurnCanContinue(reason)).toBe(true);
        }
        for (const reason of ["request_budget_exhausted", "request_budget_storage_unavailable", "forbidden", "credential_missing", undefined]) {
            expect(assistantTurnCanContinue(reason)).toBe(false);
        }
    });
});

describe("dock width", () => {
    test("The out-of-bounds width is reclaimed from the available range", () => {
        expect(clampAssistantWidth(10)).toBe(ASSISTANT_MIN_WIDTH);
        expect(clampAssistantWidth(9999)).toBe(ASSISTANT_MAX_WIDTH);
        expect(clampAssistantWidth(Number.NaN)).toBe(ASSISTANT_DEFAULT_WIDTH);
        expect(clampAssistantWidth(420)).toBe(420);
    });
});

describe("Empty start tips", () => {
    test("The four items are all sentences that can be directly used in the creation of short plays.", () => {
        expect(ASSISTANT_STARTER_PROMPTS).toHaveLength(4);
        for (const prompt of ASSISTANT_STARTER_PROMPTS) {
            expect(prompt.length).toBeGreaterThan(5);
            expect(prompt.length).toBeLessThan(20);
        }
    });
});

describe("Two results for generating a proposal do not impersonate each other", () => {
    test("Agree and decline each have a key", () => {
        expect(dismissedProposalKey("p1")).toBe("p1:skipped");
        const decided = new Set(["p1", dismissedProposalKey("p2")]);
        expect(decided.has("p1")).toBe(true);
        expect(decided.has(dismissedProposalKey("p1"))).toBe(false);
        expect(decided.has("p2")).toBe(false);
        expect(decided.has(dismissedProposalKey("p2"))).toBe(true);
    });
});

describe("assistantVisibleReply", () => {
    test("Remove closed and unclosed thinking fragments", async () => {
        const { assistantVisibleReply } = await import("@/pages/canvas/canvas-assistant-copy");
        expect(assistantVisibleReply("<think>Think first</think>\nThree lenses have been built.")).toBe("Three lenses have been built.");
        expect(assistantVisibleReply("Completed <think> Still writing")).toBe("Completed");
        expect(assistantVisibleReply("<think>Draft only")).toBe("");
    });

    test("The thinking tag in the text is not displayed, and code examples and ordinary replies are retained.", async () => {
        const { assistantVisibleReply } = await import("@/pages/canvas/canvas-assistant-copy");
        expect(assistantVisibleReply("<thinking>Check the nodes first</thinking>\nA proposal has been registered for this node.")).toBe("A proposal has been registered for this node.");
        expect(assistantVisibleReply("<thinking>English draft. This is a Chinese draft of more than eight words.\n\nAnother Chinese passage still belongs to thinking.")).toBe("");
        expect(assistantVisibleReply("<thinking>English draft. This is a Chinese draft of more than eight words. </thinking>")).toBe("");
        expect(assistantVisibleReply("I read the canvas first.\n<thinking>The node state is unchanged")).toBe("I read the canvas first.");
        expect(assistantVisibleReply("<thinking>The node state is unchanged")).toBe("");
        expect(assistantVisibleReply("Already modified<thinking")).toBe("Already changed");
        expect(assistantVisibleReply("<thinking>Three shots have been modified and you can continue. </thinking>")).toBe("");
        const example = "Example:\n```\n<thinking>keep this</thinking>\n<think>also keep</think>\n```\nThe text is still there";
        expect(assistantVisibleReply(example)).toBe(example);
        expect(assistantVisibleReply("Tag `<thinking>` is just an example")).toBe("Tag `<thinking>` is just an example");
        expect(assistantVisibleReply("Preparing to generate failed")).toBe("Preparing to generate failed");
        expect(assistantVisibleReply("The canvas is unchanged. I only read the canvas, no changes.")).toBe("The canvas is unchanged. I only read the canvas, no changes.");
        expect(assistantVisibleReply(assistantVisibleReply("<thinking>draft</thinking>\nChecked."))).toBe("Checked.");
    });

    test("Each streaming prefix does not leak tags or unclosed thoughts", async () => {
        const { assistantVisibleReply } = await import("@/pages/canvas/canvas-assistant-copy");
        for (const tag of ["think", "thinking", "THINKING"]) {
            const hidden = `<${tag}>English draft. The Chinese draft exceeds eight characters. </${tag}>`;
            for (let length = 1; length <= hidden.length; length += 1) {
                expect(assistantVisibleReply(`Text${hidden.slice(0, length)}`)).toBe("Text");
            }
            expect(assistantVisibleReply(`Text${hidden}Final answer. Final answer.`)).toBe("Text Final answer. Final answer.");
        }
        expect(assistantVisibleReply("Text <thing")).toBe("Text <thing");
    });

    test("The code example does not change the label status, and the code under consideration is also hidden.", async () => {
        const { assistantVisibleReply } = await import("@/pages/canvas/canvas-assistant-copy");
        for (const code of [
            "`<thinking>示例</thinking>`",
            "``<think>含 ` 单个反引号</think>``",
            "`````\n```xml\n<thinking>Nested fence example</thinking>\n```\n`````",
            "`` 含 ``` 和 <thinking> 的示例 ``",
            "```xml\n<thinking>Example</thinking>\n```",
            "~~~xml\n<think>Example</think>\n~~~",
            "```\n<thinking>Unclosed example",
        ]) {
            expect(assistantVisibleReply(`Example:${code}`)).toBe(`Example:${code}`);
        }
        const draft = "<thinking>Draft `</thinking>` is still a draft\n```\n<think>Code Example</think>\n```\nkeep thinking";
        expect(assistantVisibleReply(`Preface${draft}`)).toBe("Preface");
        expect(assistantVisibleReply(`${draft}</thinking> Completed.`)).toBe("Completed.");
        expect(assistantVisibleReply("<thinking>Outer layer<think>Inner layer</think>still a draft</thinking>Text")).toBe("Text");
    });
});

describe("assistantUnresolvedFailures", () => {
    test("Seedream combinations that are not supported by the whole piece are directly shown the way out, without relying on the assistant to repeat errors.", async () => {
        const { assistantUnresolvedFailures } = await import("@/pages/canvas/canvas-assistant-copy");
        const failed = { tool: "canvas.generation.propose", args: { nodeIds: ["image"] }, isError: true, error: "production_seedream_multiple_outputs: server detail must not be shown" };
        expect(assistantUnresolvedFailures([failed])).toEqual(["Whole-film production does not currently support Seedream layer splitting or grouping. Please generate images on the canvas first, and then use existing images to continue creating."]);
        expect(assistantUnresolvedFailures([failed, { ...failed, isError: false }])).toEqual([]);
        expect(assistantUnresolvedFailures([{ ...failed, error: "another_error: private detail" }])).toEqual(["Preparing to generate failed"]);
    });
    test("The same material overview completes the resource retry successfully without leaving false positives, and other materials still report", async () => {
        const { assistantUnresolvedFailures } = await import("@/pages/canvas/canvas-assistant-copy");
        for (const tool of ["media.overview", "media_overview"]) {
            const failed = { tool, args: { canvasId: "canvas", nodeId: "video" }, isError: true };
            const success = { tool, args: { resourceId: "resource", nodeId: "video", canvasId: "canvas" }, isError: false };
            expect(assistantUnresolvedFailures([failed, success])).toEqual([]);
            expect(assistantUnresolvedFailures([failed, { ...success, args: { ...success.args, nodeId: "other" } }])).toEqual(["Browsing material failed"]);
            expect(assistantUnresolvedFailures([failed, { ...success, args: { ...success.args, startMs: 1000 } }])).toEqual(["Browsing material failed"]);
            expect(assistantUnresolvedFailures([failed, { ...success, tool: "media_inspect" }])).toEqual(["Browsing material failed"]);
            expect(assistantUnresolvedFailures([{ ...failed, args: { ...failed.args, resourceId: "old" } }, success])).toEqual(["Browsing material failed"]);
        }
    });
    test("Report truthfully when media tools still fail, and don’t leave old failures behind when they succeed later", async () => {
        const { assistantUnresolvedFailures } = await import("@/pages/canvas/canvas-assistant-copy");
        const failed = { tool: "media.inspect", args: { nodeId: "a", start: 2, end: 4 }, isError: true };
        expect(assistantUnresolvedFailures([failed])).toEqual(["Screen viewing with material is not completed"]);
        expect(assistantUnresolvedFailures([failed, { ...failed, isError: false }])).toEqual([]);
    });
    test("The image inspect failed and failed to impersonate the native video and audio of the other two materials, and the overview failed to be cleared.", async () => {
        const { assistantUnresolvedFailures } = await import("@/pages/canvas/canvas-assistant-copy");
        const failed = { tool: "media.inspect", args: { assetId: "image", mode: "frames" }, isError: true, error: "media_version_required" };
        const calls = [
            failed,
            { tool: "media.overview", args: { assetId: "image" }, isError: false },
            { tool: "media.inspect", args: { assetId: "video", mode: "video", startMs: 0, endMs: 3000, expectedVersion: "video-version" }, isError: false },
            { tool: "media.inspect", args: { assetId: "audio", mode: "audio", startMs: 0, endMs: 6611, expectedVersion: "audio-version" }, isError: false },
        ];
        expect(assistantUnresolvedFailures(calls)).toEqual(["Screen viewing with material is not completed"]);
        expect(calls[0]).toEqual(failed);
        expect(assistantUnresolvedFailures(calls.map(call => ({ ...call, tool: call.tool.replace(".", "_") })))).toEqual(["Screen viewing with material is not completed"]);
    });
    test("The failed media will be prompted according to the actual mode, and the failure of other materials, intervals and versions will be retained.", async () => {
        const { assistantUnresolvedFailures } = await import("@/pages/canvas/canvas-assistant-copy");
        const failed = { tool: "media.inspect", args: { assetId: "video", mode: "video", startMs: 0, endMs: 3000, expectedVersion: "v1" }, isError: true };
        for (const args of [{ ...failed.args, assetId: "other" }, { ...failed.args, endMs: 6000 }, { ...failed.args, expectedVersion: "v2" }]) {
            expect(assistantUnresolvedFailures([failed, { ...failed, args, isError: false }])).toEqual(["There are video clips that have not been viewed yet"]);
        }
        expect(assistantUnresolvedFailures([failed, { ...failed, isError: false }])).toEqual([]);
        expect(assistantUnresolvedFailures([{ tool: "media_inspect", args: { mode: "audio" }, isError: true }])).toEqual(["There are audio clips to listen to that are not completed"]);
    });
    test("Retrying successful steps does not prompt, but the number of similar merges that still failed is counted.", async () => {
        const { assistantUnresolvedFailures } = await import("@/pages/canvas/canvas-assistant-copy");
        const calls = [
            { tool: "canvas.node.update", args: { nodeId: "a" }, isError: true },
            { tool: "canvas.node.update", args: { nodeId: "b" }, isError: true },
            { tool: "canvas.node.update", args: { nodeId: "a" }, isError: false },
            { tool: "canvas.edge.create", args: { fromNodeId: "a", toNodeId: "c" }, isError: true },
            { tool: "canvas.edge.create", args: { fromNodeId: "b", toNodeId: "c" }, isError: true },
            { tool: "canvas.get", args: {}, isError: true },
        ];
        expect(assistantUnresolvedFailures(calls)).toEqual(["Modifying the node failed", "Failed to connect (2 places)"]);
        expect(assistantUnresolvedFailures([])).toEqual([]);
    });
});
