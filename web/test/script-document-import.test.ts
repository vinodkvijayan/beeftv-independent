import { describe, expect, it } from "bun:test";

import {
    decodeXmlEntities,
    extractScriptDocumentText,
    extractWordDocumentXmlText,
    isDocxDocumentFile,
    isScriptDocumentFile,
    stripScriptDocumentExtension,
} from "@/lib/canvas/script-document-import";

async function deflateRawBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([new Uint8Array(input)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function buildSynthesizedDocxBuffer(
    documentXml: string,
    options: { method?: 0 | 8; omitCentralDirectory?: boolean } = {},
): Promise<ArrayBuffer> {
    const method = options.method ?? 8;
    const encoder = new TextEncoder();
    const rawEntries = [
        {
            name: "[Content_Types].xml",
            raw: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`),
        },
        {
            name: "word/document.xml",
            raw: encoder.encode(documentXml),
        },
    ];

    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const entry of rawEntries) {
        const nameBytes = encoder.encode(entry.name);
        const payload = method === 8 ? await deflateRawBytes(entry.raw) : entry.raw;

        const localHeader = new Uint8Array(30 + nameBytes.length + payload.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0, true);
        localView.setUint16(8, method, true);
        localView.setUint32(18, payload.length, true);
        localView.setUint32(22, entry.raw.length, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);
        localHeader.set(payload, 30 + nameBytes.length);
        localParts.push(localHeader);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0, true);
        centralView.setUint16(10, method, true);
        centralView.setUint32(20, payload.length, true);
        centralView.setUint32(24, entry.raw.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);
        centralParts.push(centralHeader);

        offset += localHeader.length;
    }

    if (options.omitCentralDirectory) {
        return new Blob(localParts as BlobPart[]).arrayBuffer();
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, rawEntries.length, true);
    eocdView.setUint16(10, rawEntries.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, offset, true);

    return new Blob([...localParts, ...centralParts, eocd] as BlobPart[]).arrayBuffer();
}

describe("script-document-import", () => {
    it("matches supported script document filenames case-insensitively", () => {
        expect(isScriptDocumentFile({ name: "episode-01.docx" })).toBe(true);
        expect(isScriptDocumentFile({ name: "EPISODE-02.DOCX" })).toBe(true);
        expect(isScriptDocumentFile({ name: "outline.txt" })).toBe(true);
        expect(isScriptDocumentFile({ name: "scenes.md" })).toBe(true);
        expect(isScriptDocumentFile({ name: "notes.markdown" })).toBe(true);
        expect(isScriptDocumentFile({ name: "legacy.doc" })).toBe(false);
        expect(isScriptDocumentFile({ name: "poster.png", type: "image/png" })).toBe(false);
        expect(isDocxDocumentFile({ name: "script.DOCX" })).toBe(true);
        expect(isDocxDocumentFile({ name: "script.txt" })).toBe(false);
    });

    it("strips document extensions cleanly for titles", () => {
        expect(stripScriptDocumentExtension("Episode 1_Chasing the Murderer on a Rainy Night.docx")).toBe("Episode 1_Chasing the murderer on a rainy night");
        expect(stripScriptDocumentExtension("/path/to/storyboard script.MD")).toBe("Storyboard");
        expect(stripScriptDocumentExtension("   ")).toBe("");
    });

    it("decodes XML entities and formats Word XML paragraphs and tables", () => {
        expect(decodeXmlEntities("A &amp; B &lt;3&gt; &quot;Hi&quot; &apos;OK&apos; &#65; &#x4E2D;")).toBe(
            "A & B <3> \"Hi\" 'OK' A in",
        );

        const xml = [
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`,
            `<w:p><w:r><w:t>The first scene: Night rain on the rooftop</w:t></w:r></w:p>`,
            `<w:p><w:r><w:t>Lin Mo stood under the neon light</w:t><w:br/><w:t>Holding an old pocket watch and voice recorder in his hands. </w:t></w:r></w:p>`,
            `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mirror number 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Panorama advancement</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
            `</w:body></w:document>`,
        ].join("");

        expect(extractWordDocumentXmlText(xml)).toBe(
            "The first scene: Night rain on the rooftop\nLin Mo stood under the neon lights\nHolding old pocket watch & voice recorder in hand.\nMirror No. 1 Panoramic Advancement",
        );
    });

    it("extracts UTF-8 text and title from .txt and .md files", async () => {
        const mdFile = new File(
            ["# Act 1\r\n\r\n\r\nRainy night street, close-up.\r\n\r\nAct Two: The Chase\r"],
            "Urban suspense storyboard.md",
            { type: "text/markdown" },
        );
        const result = await extractScriptDocumentText(mdFile);
        expect(result.title).toBe("Urban suspense storyboard");
        expect(result.content).toBe("# Act 1\n\nRainy night street, close-up.\n\nAct Two: The Chase");
    });

    it("extracts text from a stored (method 0) .docx ZIP archive", async () => {
        const xml = `<w:document><w:body><w:p><w:r><w:t>Episode 1 Opening</w:t></w:r></w:p><w:p><w:r><w:t>The protagonist opens the door and enters. </w:t></w:r></w:p></w:body></w:document>`;
        const buffer = await buildSynthesizedDocxBuffer(xml, { method: 0 });
        const file = new File([buffer], "Episode 1 script.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        const result = await extractScriptDocumentText(file);
        expect(result.title).toBe("First episode script");
        expect(result.content).toBe("Episode 1 Opening\nThe protagonist opens the door and enters.");
    });

    it("extracts text from a deflate-raw compressed (method 8) .docx ZIP archive", async () => {
        const xml = [
            `<w:document><w:body>`,
            `<w:p><w:r><w:t>Scene 1: Cafe (day/intraday)</w:t></w:r></w:p>`,
            `<w:p><w:r><w:t>Dialogue: "You are finally here."</w:t><w:tab/><w:t>(whisper)</w:t></w:r></w:p>`,
            `</w:body></w:document>`,
        ].join("");
        const buffer = await buildSynthesizedDocxBuffer(xml, { method: 8 });
        const result = await extractScriptDocumentText(buffer, "Cafe rivalry.docx");

        expect(result.title).toBe("Cafe rivalry");
        expect(result.content).toBe(`Scene 1: Cafe (Japan / Domestic)
Dialogue: "You're finally here." (whisper)`);
    });

    it("falls back to local file headers when central directory is absent", async () => {
        const xml = `<w:document><w:body><w:p><w:r><w:t>Local header parsed successfully</w:t></w:r></w:p></w:body></w:document>`;
        const buffer = await buildSynthesizedDocxBuffer(xml, { method: 8, omitCentralDirectory: true });
        const result = await extractScriptDocumentText(buffer, "fallback.docx");
        expect(result.title).toBe("fallback");
        expect(result.content).toBe("Local header parsing successful");
    });
});
