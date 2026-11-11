import { describe, expect, test } from "bun:test";
import { parseCharacterBreakdown } from "../src/lib/canvas/canvas-character-reference";

describe("parseCharacterBreakdown", () => {
    test("Ignore JSON fragments in inference text and read final character contract object", () => {
        const result = `Let me analyze the text first.

aliases: [] (aliases are not provided in the text)

Final result:

\`\`\`json
{
  "characters": [
    {
"name": "Lin Xia",
      "aliases": [],
"role": "The heroine, 26 years old, an urban office worker who works overtime and returns home late",
"appearance": "26-year-old East Asian female, looking tired",
"clothing": "Beige windbreaker, dark canvas work bag on back",
"physique": "Young women's normal posture",
"personality": "kind and introverted, observant",
"props": "Dark canvas work bag, magnetic night light",
"consistencyPrompt": "26-year-old East Asian female, beige windbreaker, dark canvas work bag",
"multiViewPrompt": "Keep the front, side, and back of the windbreaker and canvas bag consistent",
"voiceLanguage": "Chinese Mandarin",
"voiceAge": "26-year-old young woman",
"voiceTimbre": "Gentle, slightly tired"
    },
    {
"name": "Grandma Wu",
      "aliases": [],
"role": "Lin Xia's neighbor, an old man in his early seventies",
"appearance": "East Asian elderly woman in her early seventies, short silver-gray hair",
"clothing": "Dark green knitted cardigan",
"physique": "Physique of elderly women",
"personality": "Independent and cautious, grateful and reserved",
"props": "Beige bag and key",
"consistencyPrompt": "Silver gray short hair, dark green knitted cardigan, beige bag",
"multiViewPrompt": "Keep the short hair and cardigan consistent on the front, side, and back",
"voiceLanguage": "Chinese Mandarin",
"voiceAge": "elderly female in her early seventies",
"voiceTimbre": "an elderly female voice that speaks slowly"
    }
  ]
}
\`\`\``;

        expect(parseCharacterBreakdown(result).map((character) => character.name)).toEqual(["Lin Xia", "Grandma Wu"]);
    });
});

const characterCard = {
    name: "Lin Xia",
    aliases: ["Xia Xia"],
    role: "The heroine, an urban office worker who works overtime and comes home late",
    appearance: "26-year-old East Asian female, short hair",
    clothing: "Beige trench coat",
    physique: "Young women's normal posture",
    personality: "Kind and reserved",
    props: "Magnetic night light",
    consistencyPrompt: "Short hair, beige windbreaker",
    multiViewPrompt: "Keep the front, side and back consistent",
    voiceLanguage: "Chinese Mandarin",
    voiceAge: "26 year old young woman",
    voiceTimbre: "mild",
};

describe("parseCharacterBreakdown top-level form compatible", () => {
    test("Accepts a top-level role array", () => {
        expect(parseCharacterBreakdown(JSON.stringify([characterCard])).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("Accept an array and wrap it with one layer", () => {
        expect(parseCharacterBreakdown(JSON.stringify([[characterCard]])).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("Accept each character to have a separate layer of characters", () => {
        const payload = [{ characters: [characterCard] }];
        expect(parseCharacterBreakdown(JSON.stringify(payload)).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("Accepts characters written as objects keyed by character names", () => {
        const payload = { characters: { 林夏: characterCard } };
        expect(parseCharacterBreakdown(JSON.stringify(payload)).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("Skip non-character elements in an array", () => {
        const payload = [{ index: 1 }, characterCard];
        expect(parseCharacterBreakdown(JSON.stringify(payload)).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("Even if the character name array is listed first in the text, the final contract object can still be obtained.", () => {
        const result = `Characters in this chapter: ["Lin Xia", "Chen Mo"]${JSON.stringify({ characters: [characterCard] })}`;
        expect(parseCharacterBreakdown(result).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("The top-level array is wrapped in a markdown code block", () => {
        const result = "```json\n" + JSON.stringify([characterCard]) + "\n```";
        expect(parseCharacterBreakdown(result).map((character) => character.name)).toEqual(["Lin Xia"]);
    });

    test("The character list array is not a character card. Continue to look for the contract object backwards.", () => {
        const result = `The narrator mentioned the name: ["Lin Xia"]`;
        expect(() => parseCharacterBreakdown(result)).toThrow(/符合契约的 JSON/);
    });

    test("Report role name when role is missing setting field", () => {
        const payload = [{ name: "Lin Xia", role: "heroine" }];
        expect(() => parseCharacterBreakdown(JSON.stringify(payload))).toThrow(/林夏/);
    });
});
