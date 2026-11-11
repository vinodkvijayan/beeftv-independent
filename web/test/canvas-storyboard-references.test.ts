import { describe, expect, test } from "bun:test";

import { expandStoryboardTextMentions } from "../src/lib/canvas/canvas-project-domain";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";

describe("expandStoryboardTextMentions", () => {
    test("Expand the canonical node token saved by the reference control", () => {
        const references: CanvasResourceReference[] = [{
            id: "script-node",
            nodeId: "script-node",
            kind: "text",
            label: "Text 1",
            title: "full script",
            text: "Scene 1: The protagonist opens the warehouse door.",
            active: true,
        }];

        expect(expandStoryboardTextMentions("@[node:script-node] split into 8 lenses", references)).toBe(
            "[Project setting: complete script]\nScene 1: The protagonist opens the warehouse door. Divided into 8 lenses",
        );
    });
});
