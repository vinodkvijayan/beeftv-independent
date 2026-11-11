import { describe, expect, test } from "bun:test";
import { parseChapterAssetBreakdown } from "../src/lib/canvas/chapter-asset-breakdown";

describe("Chapter Three Types of Assets Analysis", () => {
    test("Scenes and props can still be extracted from chapters without characters", () => {
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [], scenes: [{ name: "station", description: "empty platform", prompt: "night platform" }], props: [{ name: "envelope", description: "Kraft envelope", prompt: "Brown envelope close-up" }] }));
        expect(result.characters).toEqual([]);
        expect(result.scenes[0].name).toBe("station");
        expect(result.props[0].name).toBe("envelope");
    });
    test("Missing arrays or missing descriptions cannot be silently skipped", () => {
        expect(() => parseChapterAssetBreakdown('{"characters":[]}')).toThrow("missing");
        expect(() => parseChapterAssetBreakdown('{"characters":[],"scenes":[{"name":"车站"}],"props":[]}')).toThrow("description");
    });
    test("Support for fenced JSON and assetless chapters", () => {
        expect(parseChapterAssetBreakdown('```json\n{"characters":[],"scenes":[],"props":[]}\n```')).toEqual({ characters: [], scenes: [], props: [] });
    });
    test("Ignore the text explanation but still verify the complete asset object", () => {
        expect(parseChapterAssetBreakdown('The extraction results are as follows:\n{"characters":[],"scenes":[],"props":[]}\nThe above are all results.')).toEqual({ characters: [], scenes: [], props: [] });
    });
});
