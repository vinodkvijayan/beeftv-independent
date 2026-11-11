import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GenerationToolCard } from "../src/components/ai/generation-tool-card";
import type { ModelProtocol } from "../src/lib/model-protocols";
import { requestImageQuestion } from "../src/services/api/image";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function reasoningConfig(protocol: ModelProtocol | undefined, apiFormat: "openai" | "gemini" = "openai"): AiConfig {
    const channel = createModelChannel({
        id: "reasoning",
        name: "Reasoning",
        baseUrl: "https://reasoning.example/v1",
        apiKey: "synthetic-test-key",
        apiFormat,
        interfaceType: apiFormat === "gemini" ? undefined : protocol,
        models: ["reasoner"],
        modelProfiles: [{ model: "reasoner", capability: "text", ...(protocol ? { protocol } : {}), billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
    });
    return { ...defaultConfig, channels: [channel], model: "reasoning::reasoner", textModel: "reasoning::reasoner" };
}

function streamResponse(events: unknown[]) {
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function requestWithReasoning(config: AiConfig, events: unknown[]) {
    globalThis.fetch = (async () => streamResponse(events)) as typeof fetch;
    let content = "";
    let reasoning = "";
    const result = await requestImageQuestion(config, [{ role: "user", content: "please answer" }], (value) => { content = value; }, { onReasoning: (value) => { reasoning = value; } });
    return { result, content, reasoning };
}

describe("text reasoning streams", () => {
    test("separates Responses reasoning summaries from answer text", async () => {
        const output = await requestWithReasoning(reasoningConfig("openai-response"), [
            { type: "response.reasoning_summary_text.delta", delta: "Analyze first" },
            { type: "response.output_text.delta", delta: "final answer" },
        ]);

        expect(output).toEqual({ result: "final answer", content: "final answer", reasoning: "Analyze first" });
    });

    test("separates Chat Completions reasoning_content from answer text", async () => {
        const output = await requestWithReasoning(reasoningConfig("chat-completion"), [
            { choices: [{ delta: { reasoning_content: "reasoning process" } }] },
            { choices: [{ delta: { content: "Answer content" } }] },
        ]);

        expect(output).toEqual({ result: "Answer content", content: "Answer content", reasoning: "reasoning process" });
    });

    test("does not duplicate Gemini thought parts into visible content", async () => {
        const output = await requestWithReasoning(reasoningConfig(undefined, "gemini"), [
            { candidates: [{ content: { parts: [{ text: "internal thinking", thought: true }, { text: "Visible answer" }] } }] },
        ]);

        expect(output).toEqual({ result: "Visible answer", content: "Visible answer", reasoning: "internal thinking" });
    });

    test("keeps completed results open until the user collapses them", () => {
        const single = renderToStaticMarkup(React.createElement(GenerationToolCard, { status: "completed", heading: "image generation" }, React.createElement("span", null, "Single image results")));
        const bulk = renderToStaticMarkup(React.createElement(GenerationToolCard, { status: "completed", heading: "image generation" }, React.createElement("span", null, "Batch results")));

        expect(single).toContain("Single image results");
        expect(bulk).toContain("Batch results");
    });
});
