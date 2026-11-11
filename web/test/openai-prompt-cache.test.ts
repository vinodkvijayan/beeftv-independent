import { describe, expect, test } from "bun:test";

import { clampOpenAIPromptCacheKey, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH, withOpenAIPromptCacheKey } from "../src/lib/openai-prompt-cache";

describe("OpenAI prompt cache key", () => {
    test("Cache keys truncated by OpenAI cap", () => {
        const key = clampOpenAIPromptCacheKey(`canvas-session:${"x".repeat(100)}`);
        expect(Array.from(key || "")).toHaveLength(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
    });

    test("Responses request body carries cache key", () => {
        const body = withOpenAIPromptCacheKey({ model: "test-model", input: [] }, " canvas-session:session-a ");
        expect(body.prompt_cache_key).toBe("canvas-session:session-a");
    });

    test("Empty cache keys will not be written to the Responses request body", () => {
        const body = withOpenAIPromptCacheKey({ model: "test-model", input: [] }, " ");
        expect(body).not.toHaveProperty("prompt_cache_key");
    });
});
