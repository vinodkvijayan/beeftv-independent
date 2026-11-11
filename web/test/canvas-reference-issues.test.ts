import { expect, test } from "bun:test";
import { canvasReferenceIssues, replaceCanvasReferenceToken } from "../src/lib/canvas/canvas-reference-issues";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";
import { inspectNodeGenerationMentions } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { Asset } from "../src/stores/use-asset-store";

const image: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "Picture 1", title: "Photos of people", previewUrl: "data:image/png;base64,AA", active: true };
const nodes: CanvasNodeData[] = [
    { id: "image", type: CanvasNodeType.Image, title: "Photos of people", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "data:image/png;base64,AA" } },
    { id: "target", type: CanvasNodeType.Video, title: "Generate video", position: { x: 0, y: 200 }, width: 100, height: 100, metadata: {} },
];
const connections = [{ id: "edge", fromNodeId: "image", toNodeId: "target" }];

test("UI issue descriptions consume the same unresolved bindings as submission", () => {
    const asset: Asset = { id: "a", kind: "image", title: "Stock image", status: "confirmed", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { dataUrl: "data:image/png;base64,AA", width: 1, height: 1, mimeType: "image/png", bytes: 1 } };
    expect(inspectNodeGenerationMentions("target", nodes, connections, "Use @[node:image], @image1 and @[asset:a].", [asset]).unresolved).toEqual([]);
    const unresolved = inspectNodeGenerationMentions("target", nodes, [], "Use @[node:image] and @image9.", []).unresolved;
    const issues = canvasReferenceIssues(unresolved, [{ ...image, active: false }], nodes);
    expect(issues.map((issue) => issue.title)).toEqual(["Photos of people", "Picture 9"]);
    expect(issues[0].nodeId).toBe("image");
    expect(issues[0].reason).toBe("Not connected to current build node");
});

test("missing IDs get deduplicated readable labels without leaking IDs", () => {
    const [issue] = canvasReferenceIssues(["@[asset:opaque-id]", "@[asset:opaque-id]"], []);
    expect(issue.title).toBe("Library Reference 1");
    expect(issue.reason).not.toContain("opaque-id");
    expect(canvasReferenceIssues(["@picture1abc", "@Picture1"], [])).toHaveLength(1);
});

test("preview availability does not define generation eligibility", () => {
    const unresolved = inspectNodeGenerationMentions("target", nodes, connections, "Reference @[node:image] and @image1|", []).unresolved;
    expect(canvasReferenceIssues(unresolved, [{ ...image, previewUrl: undefined }], nodes)).toEqual([]);
});

test("reselect replaces every occurrence of one binding and leaves other bindings and prose untouched", () => {
    const prompt = "@[asset:a] and @[asset:ab], then @[asset:a]. IMAGE 1 Do not change";
    expect(replaceCanvasReferenceToken(prompt, "@[asset:a]", "@[node:image]")).toBe("@[node:image] and @[asset:ab], then @[node:image]. IMAGE 1 Do not change");
    expect(replaceCanvasReferenceToken("@picture1abc @picture1. @Picture10", "@Picture1", "@[asset:a]")).toBe("@Picture1abc @[asset:a]. @Picture10");
});
