import { describe, expect, test } from "bun:test";

import { ensureDirectorOutputConnections, resolveDirectorOutputPositions } from "../src/lib/canvas/director/director-output-layout";

describe("Director’s desk output layout and connection direction", () => {
    test("When the screenshots and videos are first generated, they are arranged on the right side of the director's desk and flow out from left to right.", () => {
        const layout = resolveDirectorOutputPositions({
            source: { position: { x: 100, y: 200 }, width: 520 },
            previewSize: { width: 720, height: 405 },
        });

        expect(layout.previewPosition).toEqual({ x: 668, y: 200 });
        expect(layout.videoPosition).toEqual({ x: 668, y: 653 });
    });

    test("Correct the reverse output edge of the old version to the director's desk to the material node, and retain the irrelevant connections and stable edge IDs", () => {
        const oldImageEdge = { id: "old-image", fromNodeId: "image", toNodeId: "director" };
        const stableVideoEdge = { id: "stable-video", fromNodeId: "director", toNodeId: "video" };
        const unrelated = { id: "input", fromNodeId: "reference", toNodeId: "director" };
        const existing = [oldImageEdge, stableVideoEdge, unrelated];

        const result = ensureDirectorOutputConnections(existing, "director", ["image", "video"], () => "new-image");

        expect(result).toEqual([
            { id: "stable-video", fromNodeId: "director", toNodeId: "video" },
            unrelated,
            { id: "new-image", fromNodeId: "director", toNodeId: "image" },
        ]);
        expect(ensureDirectorOutputConnections(result, "director", ["image", "video"], () => "unused")).toEqual(result);
    });
});
