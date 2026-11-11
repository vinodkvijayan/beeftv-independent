import { expect, test } from "bun:test";
import { referencedAssetIdsInPrompt } from "../src/lib/canvas/canvas-resource-references";

test("library mentions grant exact IDs without requiring a canvas node", () => {
    expect(referencedAssetIdsInPrompt("See @[asset:library-only], then @[asset:second] and @[asset:library-only]"))
        .toEqual(["library-only", "second"]);
});

test("labels, node mentions and incomplete tokens cannot grant library access", () => {
    expect(referencedAssetIdsInPrompt("@Picture 1 @Picture 10 @[node:library-only] @[asset:] @[asset:unfinished"))
        .toEqual([]);
});
