import { describe, expect, test } from "bun:test";

import { customShotTitle, formatShotOrdinal, normalizeDefaultShotTitle } from "@/lib/shot-label";

describe("shot labels", () => {
    test("Use Chinese two-digit lens number", () => {
        expect(formatShotOrdinal(0)).toBe("Shot 01");
        expect(formatShotOrdinal(11)).toBe("Shot 12");
    });

    test("Convert only exact matching historical default titles", () => {
        expect(normalizeDefaultShotTitle("SC.01", 0)).toBe("Shot 01");
        expect(normalizeDefaultShotTitle("SC.01 Rainy Night", 0)).toBe("SC.01 Rainy Night");
        expect(normalizeDefaultShotTitle("Chasing on a rainy night", 0)).toBe("Chasing on a rainy night");
    });

    test("The default title will not be repeated next to the number", () => {
        expect(customShotTitle("SC.01", 0)).toBe("");
        expect(customShotTitle("Shot 01", 0)).toBe("");
        expect(customShotTitle("Chasing on a rainy night", 0)).toBe("Chasing on a rainy night");
    });
});
