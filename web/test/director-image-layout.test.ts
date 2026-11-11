import { describe, expect, test } from "bun:test";

import { parseDirectorImageLayout } from "@/lib/canvas/director/director-image-layout";

describe("Director’s desk picture position recognition results", () => {
    test("Parse JSON with code fences and limit coordinates and quantities", () => {
        const parsed = parseDirectorImageLayout('```json\n{"elements":[{"name":"人物 A","type":"person","x":0.25,"depth":0.7},{"name":"桌子","type":"object","x":1.4,"depth":-0.2}]}\n```');
        expect(parsed).toEqual([
            { name: "Character A", type: "person", x: 0.25, depth: 0.7 },
            { name: "table", type: "object", x: 1, depth: 0 },
        ]);
    });

    test("Reject missing fields, unknown types, and invalid JSON", () => {
        expect(() => parseDirectorImageLayout("not json")).toThrow("The image recognition result format is invalid.");
        expect(() => parseDirectorImageLayout('{"elements":[{"name":"x","type":"vehicle","x":0.5,"depth":0.5}]}')).toThrow("No usable person or object identified");
        expect(() => parseDirectorImageLayout('{"elements":[]}')).toThrow("No usable person or object identified");
    });
});
