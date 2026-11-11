import { expect, test } from "bun:test";

import { replaceCanvasNodeReference } from "../src/lib/canvas/canvas-reference-replace";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const node = (id: string, type: CanvasNodeType, extra: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
    id, type, title: id, position: { x: 0, y: 0 }, width: 8, height: 8, ...extra,
});
const edge = (id: string, fromNodeId: string, toNodeId: string): CanvasConnection => ({ id, fromNodeId, toNodeId });

test("rewires the existing reference edge and rewrites the prompt mention", () => {
    const nodes = [
        node("old", CanvasNodeType.Image, { title: "old picture" }),
        node("next", CanvasNodeType.Image, { title: "new picture" }),
        node("shot", CanvasNodeType.Image, { metadata: { prompt: "Use @Picture1 as background" } }),
    ];
    const connections = [edge("e1", "old", "shot")];
    const result = replaceCanvasNodeReference(nodes, connections, "shot", { id: "ref", nodeId: "old", label: "Picture 1" }, "next", () => "e2");
    expect(result.connections).toEqual([edge("e1", "next", "shot")]);
    const shot = result.nodes.find((item) => item.id === "shot");
    expect(shot?.metadata?.prompt ?? shot?.metadata?.composerContent).toContain("@Picture1");
    expect(shot?.metadata?.prompt ?? shot?.metadata?.composerContent).not.toContain("old picture");
    expect(result.notice).toBe("The reference picture \"Picture 1\" has been replaced with \"New Picture\", and the prompt words have been updated simultaneously.");
    expect(connections[0]?.fromNodeId).toBe("old");
});

test("adds a new edge when the old reference was not connected, and routes it through a config node", () => {
    const nodes = [
        node("old", CanvasNodeType.Image),
        node("next", CanvasNodeType.Image, { title: "Substitute" }),
        node("shot", CanvasNodeType.Image),
        node("config", CanvasNodeType.Config),
    ];
    const connections = [edge("main", "shot", "config")];
    const result = replaceCanvasNodeReference(nodes, connections, "shot", { id: "ref", nodeId: "missing", label: "Picture 2" }, "next", () => "added");
    expect(result.connections.map((item) => item.id)).toEqual(["main", "added"]);
    expect(result.connections[1]).toEqual(edge("added", "next", "config"));
});

test("does nothing when the replacement is the reference itself", () => {
    const nodes = [node("same", CanvasNodeType.Image), node("shot", CanvasNodeType.Image)];
    const connections = [edge("e1", "same", "shot")];
    const result = replaceCanvasNodeReference(nodes, connections, "shot", { id: "ref", nodeId: "same" }, "same");
    expect(result.nodes).toBe(nodes);
    expect(result.connections).toBe(connections);
    expect(result.notice).toBeNull();
});
