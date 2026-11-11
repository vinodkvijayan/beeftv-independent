import { describe, expect, test } from "bun:test";
import { decodeNovelText, splitTextIntoChapters } from "../src/lib/canvas/canvas-document";

describe("splitTextIntoChapters", () => {
    test("Recognize common Chinese, Markdown, decorators and English titles", () => {
        const chapters = splitTextIntoChapters(`Book title and author

Chapter 1 Entering the world for the first time
Chapter 1 Text

# Chapter 2 The storm is coming
Chapter 2 Text

【Chapter 3】Seeing old friends again
Chapter 3 Text

Volume Four: Old Friend of Mountains and Rivers
Chapter 4 Text

Epilogue: Reunion
Epilogue text`);

        expect(chapters.map((chapter) => chapter.title)).toEqual(["Prologue", "Chapter 1 Entering the world for the first time", "Chapter 2 The storm is coming", "【Chapter 3】Seeing old friends again", "Volume Four: Old Friend of Mountains and Rivers", "Epilogue: Reunion"]);
        expect(chapters[0].plainText).toBe("Book title and author");
        expect(chapters[2].plainText).toBe("Chapter 2 Text");
    });

    test("Normal text and unrecognized text remain as single chapters", () => {
        const text = "This is what happened in the first chapter.\nThe characters move on.";
        const chapters = splitTextIntoChapters(text);

        expect(chapters).toHaveLength(1);
        expect(chapters[0].title).toBe("Chapter 1");
        expect(chapters[0].plainText).toBe(text);
    });
});

describe("decodeNovelText", () => {
    test("Decode UTF-16LE with BOM", () => {
        const bytes = new Uint8Array([0xff, 0xfe, 0x2c, 0x7b, 0x00, 0x4e, 0xe0, 0x7a]);
        expect(decodeNovelText(bytes.buffer)).toBe("Chapter 1");
    });

    test("Fallback to GB18030 after UTF-8 strict decoding fails", () => {
        const bytes = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0xd5, 0xfd, 0xce, 0xc4]);
        expect(decodeNovelText(bytes.buffer)).toBe("Chapter 1\nText");
    });
});
