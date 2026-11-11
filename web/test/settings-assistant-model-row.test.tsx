import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelDefaultGrid } from "@/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "@/stores/use-config-store";

function configWithTextChannel(overrides: Partial<AiConfig> = {}): AiConfig {
    const channels = [
        createModelChannel({
            id: "a",
            name: "local channel",
            models: ["chat-1", "chat-2"],
            modelProfiles: [
                { model: "chat-1", capability: "text", protocol: "chat-completion" },
                { model: "chat-2", capability: "text", protocol: "claude-api" },
            ],
        }),
    ];
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels, textModel: "a::chat-1", ...overrides } }).config;
}

function assistantSelection(config: AiConfig) {
    const markup = renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />);
    const start = markup.indexOf('id="default-assistant-title"');
    const end = markup.indexOf('id="default-multimodal-title"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return markup.slice(start, end).match(/class="ant-select-content[^"]*" title="([^"]*)"/)?.[1];
}

describe("The helper model line of the model configuration page", () => {
    test("Sort after default text model and before default audio model", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithTextChannel()} onChange={() => {}} />);
        const textIndex = markup.indexOf("Default text model");
        const assistantIndex = markup.indexOf("helper model");
        const audioIndex = markup.indexOf("Default audio model");
        expect(textIndex).toBeGreaterThan(-1);
        expect(assistantIndex).toBeGreaterThan(textIndex);
        expect(audioIndex).toBeGreaterThan(assistantIndex);
    });

    test("The default display follows the default text model and provides an accessible helper model selection box", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithTextChannel()} onChange={() => {}} />);
        expect(markup).toContain("Follow the default text model");
        expect(markup).toContain('aria-label="Assistant model"');
        expect(markup).toContain("chat-1");
    });

    test("The selected state follows assistantModel: if it is empty, the following item is selected, and if it has a value, the corresponding model is selected.", () => {
        expect(assistantSelection(configWithTextChannel())).toBe("Follow the default text model");
        expect(assistantSelection(configWithTextChannel({ assistantModel: "a::chat-2" }))).toBe("chat-2");
        // 失效的显式选择不能悄悄改用默认模型。
        expect(assistantSelection(configWithTextChannel({ assistantModel: "gone::chat-1" }))).toBeUndefined();
        const unavailable = renderToStaticMarkup(<ModelDefaultGrid config={configWithTextChannel({ assistantModel: "gone::chat-1" })} onChange={() => {}} />);
        expect(unavailable).toContain("The selected model is unavailable, please select again");
    });
});
