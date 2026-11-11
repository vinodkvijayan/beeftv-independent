import { describe, expect, test } from "bun:test";

import { consumeChatCompletionStreamText, consumeGeminiStreamText, consumeResponseStreamText, parseChatCompletionPayload, parseGeminiToolResponse, parseImagePayload, parseToolResponse } from "../src/services/api/image-response";
import { normalizeQuality, resolveRequestSize, validateImageSize } from "../src/services/api/image-validation";
import { ChannelResponseError } from "../src/services/api/channel-transport";

describe("image api contracts", () => {
    test("Normalize quality and size, reject images out of bounds", () => {
        expect(normalizeQuality("1k")).toBe("low");
        expect(normalizeQuality("2k")).toBe("medium");
        expect(normalizeQuality("4k")).toBe("high");
        expect(resolveRequestSize("medium", "16:9")).toMatch(/^\d+x\d+$/);
        expect(resolveRequestSize("medium", "9:16")).toMatch(/^\d+x\d+$/);
        expect(() => validateImageSize(1025, 1024)).toThrow("Multiples of 16");
        expect(() => validateImageSize(3072, 1008)).toThrow("aspect ratio");
        expect(() => validateImageSize(3840, 2176)).toThrow("total pixels");
    });

    test("Unpacking b64_json, url and business errors", () => {
        expect(parseImagePayload({ data: [{ b64_json: "abc" }, { url: "https://example.com/image.png" }] })).toEqual([
            { id: expect.any(String), dataUrl: "data:image/png;base64,abc" },
            { id: expect.any(String), dataUrl: "https://example.com/image.png" },
        ]);
        expect(() => parseImagePayload({ data: [] })).toThrow("The interface does not return pictures");
        // A provider quota error does not identify whose balance is insufficient.
        try {
            parseImagePayload({ code: 1001, msg: "Insufficient quota" });
            throw new Error("accepted quota failure");
        } catch (error) {
            expect(error).toBeInstanceOf(ChannelResponseError);
            expect((error as Error).message).toMatch(/额度|计费/);
            expect((error as Error).message).not.toMatch(/请.{0,6}充值|你的余额不足|您的余额不足/);
        }
    });

    test("Unified parsing of Responses, Chat Completions and Gemini tool calls", () => {
        expect(
            parseToolResponse({
                output: [{ type: "function_call", call_id: "call-1", name: "search", arguments: '{"q":"canvas"}' }],
            }),
        ).toMatchObject({ toolCalls: [{ id: "call-1", function: { name: "search", arguments: '{"q":"canvas"}' } }] });
        expect(
            parseChatCompletionPayload({
                choices: [{ message: { content: "done", tool_calls: [{ id: "call-2", function: { name: "search", arguments: "{}" } }] } }],
            }),
        ).toMatchObject({ content: "done", toolCalls: [{ id: "call-2", function: { name: "search" } }] });
        expect(
            parseGeminiToolResponse({
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: "thinking", thought: true },
                                { functionCall: { id: "call-3", name: "search", args: { q: "canvas" } }, thoughtSignature: "sig" },
                            ],
                        },
                    },
                ],
            }),
        ).toMatchObject({ reasoning: "thinking", toolCalls: [{ id: "call-3", thoughtSignature: "sig", function: { name: "search", arguments: '{"q":"canvas"}' } }] });
    });

    test("SSE incremental parsing preserves body, reasoning, and tool calls", () => {
        const responseState = { buffer: "", text: "", reasoning: "" };
        consumeResponseStreamText(responseState, 'data: {"type":"response.output_text.delta","delta":"hel"}\n\n');
        consumeResponseStreamText(responseState, 'data: {"type":"response.reasoning.delta","delta":"why"}\n\n');
        consumeResponseStreamText(responseState, 'data: {"type":"response.output_text.delta","delta":"lo"}', undefined, undefined, true);
        expect(responseState).toMatchObject({ text: "hello", reasoning: "why", buffer: "" });

        const chatState = { buffer: "", text: "", reasoning: "", toolCalls: new Map() };
        consumeChatCompletionStreamText(chatState, 'data: {"choices":[{"delta":{"content":"ok","reasoning_content":"r"}}]}\n\n');
        expect(chatState).toMatchObject({ text: "ok", reasoning: "r" });

        const geminiState = { buffer: "", text: "", reasoning: "", toolCalls: [] };
        consumeGeminiStreamText(geminiState, 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n');
        expect(geminiState).toMatchObject({ text: "hi" });
    });
});
