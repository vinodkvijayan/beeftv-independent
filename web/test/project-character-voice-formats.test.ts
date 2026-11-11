import { describe, expect, test } from "bun:test";

import { audioFileExtension, characterVoiceTitleFromFileName, isSupportedCharacterVoiceFile } from "@/lib/character-voice-formats";

describe("Character sound format", () => {
    test("Accepts common audio formats that browsers can listen to", () => {
        for (const [name, type] of [
            ["voice.mp3", "audio/mpeg"],
            ["voice.wav", "audio/x-wav"],
            ["voice.m4a", "audio/mp4"],
            ["voice.aac", "audio/aac"],
            ["voice.flac", "audio/flac"],
            ["voice.ogg", "audio/ogg"],
            ["voice.opus", "audio/opus"],
            ["voice.weba", "audio/webm"],
        ]) expect(isSupportedCharacterVoiceFile({ name, type })).toBe(true);
    });

    test("Use extension only if MIME is unknown", () => {
        expect(isSupportedCharacterVoiceFile({ name: "voice.wav", type: "" })).toBe(true);
        expect(isSupportedCharacterVoiceFile({ name: "video.webm", type: "video/webm" })).toBe(false);
        expect(isSupportedCharacterVoiceFile({ name: "voice.wma", type: "audio/x-ms-wma" })).toBe(false);
    });

    test("Generate correct title and reference audio extension", () => {
        expect(characterVoiceTitleFromFileName("Zhang Zhentian original voice.FLAC")).toBe("Zhang Zhentian original voice");
        expect(audioFileExtension("audio/mp4", "sample.m4a")).toBe("m4a");
        expect(audioFileExtension("audio/ogg", "sample.opus")).toBe("opus");
        expect(audioFileExtension("audio/wav")).toBe("wav");
        expect(audioFileExtension("audio/wave")).toBe("wav");
        expect(audioFileExtension("audio/vnd.wave")).toBe("wav");
    });
});
