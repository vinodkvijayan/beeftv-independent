import { expect, test } from "bun:test";
import { connectWorkflowPromptReference, normalizeWorkflowNodeMentions, remapWorkflowPromptMentions, validateWorkflowPromptMentions, workflowNodeMentionReferences, workflowPromptDisplayText } from "../src/lib/canvas/workflow-node-mentions";
import type { WorkflowDefinition, WorkflowOperation } from "../src/services/api/canvas-workflows";

const operation: WorkflowOperation = { id: "generate.video", version: 1, name: "Generate video", outputType: "video", fields: [], inputs: [{ id: "referenceVideos", label: "Reference video", mediaType: "video", required: false, multiple: true }, { id: "referenceImages", label: "Reference pictures", mediaType: "image", required: false, multiple: true }, { id: "prompt", label: "prompt word", mediaType: "text", required: false, multiple: true }] };
const definition: WorkflowDefinition = { version: 1, nodes: [{ id: "source", title: "Original video", role: "input", mediaType: "video" }, { id: "depth", title: "Depth of action", role: "operation", mediaType: "video", operationId: "video.depth" }, { id: "person", title: "replace character", role: "input", mediaType: "image" }, { id: "generate", title: "Completed film", role: "operation", mediaType: "video", operationId: "generate.video", config: { prompt: "Background@Video1 Action@Video2 Character@Picture1" } }, { id: "downstream", title: "Post-processing", role: "operation", mediaType: "video" }], edges: [{ fromNodeId: "source", toNodeId: "generate", toPort: "referenceVideos" }, { fromNodeId: "depth", toNodeId: "generate", toPort: "referenceVideos", order: 1 }, { fromNodeId: "person", toNodeId: "generate", toPort: "referenceImages" }, { fromNodeId: "generate", toNodeId: "downstream" }], outputNodeIds: ["generate"] };

test("legacy numbered references show node names and survive renaming", () => {
    const normalized = normalizeWorkflowNodeMentions(definition);
    const prompt = normalized.nodes[3].config!.prompt as string;
    expect(prompt).toBe("Background@[node:source] Action@[node:depth] Person@[node:person]");
    expect(workflowPromptDisplayText(prompt, normalized)).toBe("Background@original video action@action depth character@replacement character");
    normalized.nodes = normalized.nodes.map(node => node.id === "source" ? { ...node, title: "background material" } : node);
    expect(workflowPromptDisplayText(prompt, normalized)).toContain("@Background material");
    expect(() => validateWorkflowPromptMentions(normalized)).not.toThrow();
    expect(remapWorkflowPromptMentions(prompt, new Map([["source", "new-id"]]))).toContain("@[node:new-id]");
});

test("mention picker only offers compatible nodes that cannot form a cycle", () => {
    const refs = workflowNodeMentionReferences(definition, "generate", [operation]);
    expect(refs.map(ref => ref.title)).toEqual(["Original video", "Depth of action", "replace character"]);
    expect(refs[0].mentionToken).toBe("@[node:source]");
    expect(refs.every(ref => ref.active)).toBe(true);
});

test("selecting a node creates a reference once and disconnected mentions are rejected", () => {
    const unconnected = { ...definition, edges: definition.edges.filter(edge => edge.fromNodeId !== "person") };
    const connected = connectWorkflowPromptReference(unconnected, "generate", "person", [operation]);
    expect(connected.edges.at(-1)).toMatchObject({ fromNodeId: "person", toNodeId: "generate", toPort: "referenceImages", order: 0 });
    expect(connectWorkflowPromptReference(connected, "generate", "person", [operation])).toBe(connected);
    const normalized = normalizeWorkflowNodeMentions(definition);
    expect(() => validateWorkflowPromptMentions({ ...normalized, edges: unconnected.edges })).toThrow("Disconnect or delete");
});
