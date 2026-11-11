import { describe, expect, test } from "bun:test";

import { assetCategoryLabel, defaultAssetCategoryForKind, normalizeAssetCategory } from "@/lib/asset-category";

describe("asset category contract", () => {
    test("Old clothing, weapons and accessories are uniformly migrated to props", () => {
        expect(normalizeAssetCategory("wardrobe")).toBe("prop");
        expect(normalizeAssetCategory("weapon")).toBe("prop");
        expect(normalizeAssetCategory("accessory")).toBe("prop");
    });

    test("The old style of painting is migrated to materials, and the unknown values are classified into other", () => {
        expect(normalizeAssetCategory("style")).toBe("material");
        expect(normalizeAssetCategory("unknown")).toBe("other");
        expect(assetCategoryLabel("material")).toBe("Material");
    });

    test("Uncategorized media is classified as material by default", () => {
        expect(defaultAssetCategoryForKind("image")).toBe("material");
        expect(defaultAssetCategoryForKind("video")).toBe("material");
        expect(defaultAssetCategoryForKind("audio")).toBe("material");
        expect(defaultAssetCategoryForKind("text")).toBe("other");
    });
});
