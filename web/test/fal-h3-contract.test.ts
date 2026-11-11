import fs from "node:fs";
import { expect, test } from "bun:test";
import { beefTVVideoContract } from "../src/lib/beeftv-video-contracts";
import { portraitPriceLines, sanitizeVideoPriceQuote } from "../src/lib/seedance-portrait";
import { SYSTEM_PROMPT } from "../../agent-host/system-prompt.mjs";

test("H3 preserves CNY seconds and 768p without accepting unverified model aliases", () => {
    expect(beefTVVideoContract("minimax-h3-max-turbo")?.protocol).toBe("newapi-channel-2");
    expect(beefTVVideoContract("minimax-h3-max")?.protocol).toBe("newapi-channel-2");
    expect(beefTVVideoContract("minimax-h3")?.maxReferences).toEqual({image: 9, video: 3, audio: 3});
    expect(beefTVVideoContract("minimax-h3-max-turbo-other")).toBeUndefined();
    const price = {currency: "CNY", mode: "seconds", rates: {"768p": {output: 0.2441304, reference_video: 0}}};
    expect(sanitizeVideoPriceQuote(price)).toEqual(price);
    expect(portraitPriceLines(price)).toEqual(["768p: ¥0.2441/second"]);
    expect(sanitizeVideoPriceQuote({...price, currency: "USD"})).toBeNull();
});

test("H3 2K price includes the first-five-reference-image allowance", () => {
    const price = {currency: "CNY", mode: "seconds", rates: {"2k": {output: 1.322373, reference_video: 0}, "4k": {output: 1.627536, reference_video: 0}}, reference_image: 0.813768, free_reference_images: 5};
    expect(sanitizeVideoPriceQuote(price)).toEqual(price);
    expect(portraitPriceLines(price)).toEqual(["2k：¥1.3224/second", "4k：¥1.6275/second", "The first 5 reference pictures are free, then ¥0.8138/picture"]);
    expect(sanitizeVideoPriceQuote({...price, free_reference_images: -1})).toBeNull();
    expect(sanitizeVideoPriceQuote({...price, reference_image: NaN})).toBeNull();
});

test("assistant H3 guidance matches canvas frame selection", () => {
    expect(SYSTEM_PROMPT).not.toContain("H3 series");
    const skills = JSON.parse(fs.readFileSync(new URL("../../backend/internal/skills/seed/skills.json", import.meta.url), "utf8")) as Array<{skill_id: string; instruction: string}>;
    const producerSkill = skills.find((item) => item.skill_id === "14811816970252");
    for (const instruction of ["A picture as the first frame", "Two pictures as the first and last frames", "Frame comes with pictures", "generated for each shot", "Not used in multi-material reference mode"]) {
        expect(producerSkill?.instruction).toContain(instruction);
    }
});
