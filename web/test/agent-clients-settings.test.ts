import { describe, expect, test } from "bun:test";

import { assistantModelOptions, normalizeAssistantModel, resolveAssistantModel } from "@/lib/assistant-model";
import { agentClientLastUsedLabel, agentClientModeLabel, agentClientModeSummary, agentClientSetupBlock, agentIntegrationAction, agentIntegrationHint, agentIntegrationStatusLabel } from "@/pages/agents/agent-client-presentation";
import { connectAgentIntegration, createAgentClient, disconnectAgentIntegration, listAgentClients, revokeAgentClient, type AgentIntegration } from "@/services/api/agent-clients";
import { ApiError, apiClient } from "@/services/api/request";
import { createModelChannel, defaultConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

type Recorded = { method?: string; url?: string; data?: unknown };

async function withStubbedApi<T>(envelope: unknown, status: number, run: (recorded: Recorded[]) => Promise<T>) {
    const original = apiClient.request;
    const recorded: Recorded[] = [];
    apiClient.request = (async (config: Recorded) => {
        recorded.push({ method: config.method, url: config.url, data: config.data });
        if (status >= 400) {
            throw { isAxiosError: true, message: `Request failed with status code ${status}`, response: { status, data: envelope, headers: {} } };
        }
        return { data: envelope, status, headers: {} };
    }) as typeof apiClient.request;
    try {
        return await run(recorded);
    } finally {
        apiClient.request = original;
    }
}

describe("External Agent Access API", () => {
    test("Older read-only connections retain the read-only prompt, new connections use all authoring tools", () => {
        expect(agentClientModeLabel("read-only")).toBe("Legacy read-only connections");
        expect(agentClientModeSummary("read-only")).toContain("Reconnect");
        expect(agentClientModeLabel("read-write")).toBe("All creative tools");
    });
    test("The list is unpacked by envelope and gives both connected client and command line tool status", async () => {
        const data = {
            clients: [{ id: "c-1", label: "Codex", kind: "codex", mode: "read-only", createdAt: "2026-09-20T02:00:00Z", lastUsedAt: null }],
            cli: { path: "/Applications/BeefTV.app/Contents/Resources/beeftv", available: true, installCommand: "ln -s /x/beeftv /usr/local/bin/beeftv" },
        };
        await withStubbedApi({ code: 0, data, msg: "ok" }, 200, async (recorded) => {
            await expect(listAgentClients()).resolves.toEqual(data);
            expect(recorded[0]).toMatchObject({ method: "get", url: "/agent-clients" });
        });
    });

    test("Create a submit-only type and unpack the one-time access content", async () => {
        const data = {
            client: { id: "c-2", label: "Cursor", kind: "cursor", mode: "read-write", createdAt: "2026-09-20T02:00:00Z", lastUsedAt: null },
            token: "secret-token",
            setup: { kind: "cursor", title: "Cursor", json: '{"mcpServers":{}}' },
        };
        await withStubbedApi({ code: 0, data, msg: "ok" }, 200, async (recorded) => {
            await expect(createAgentClient({ kind: "cursor" })).resolves.toEqual(data);
            expect(recorded[0]).toMatchObject({ method: "post", url: "/agent-clients", data: { kind: "cursor" } });
        });
    });

    test("Disconnect path escaping of id and unpack revoked", async () => {
        await withStubbedApi({ code: 0, data: { revoked: true }, msg: "ok" }, 200, async (recorded) => {
            await expect(revokeAgentClient("c 3/4")).resolves.toEqual({ revoked: true });
            expect(recorded[0]).toMatchObject({ method: "delete", url: "/agent-clients/c%203%2F4" });
        });
    });

    test("When the backend does not have this capability, a recognizable 404 is thrown, and the page displays an empty state accordingly.", async () => {
        await withStubbedApi({ code: 40401, data: null, msg: "not found", reason: "not_found" }, 404, async () => {
            const thrown = await listAgentClients().catch((error) => error);
            expect(thrown).toBeInstanceOf(ApiError);
            expect(thrown).toMatchObject({ status: 404, reason: "not_found" });
        });
    });

    test("One-click access only submits the type, and disconnects the path escape for the type.", async () => {
        const integration = { kind: "claude", name: "Claude Code", detected: true, connected: true, skillInstalled: true, needsRetry: false } as const;
        await withStubbedApi({ code: 0, data: { integration }, msg: "ok" }, 200, async (recorded) => {
            await expect(connectAgentIntegration("claude")).resolves.toEqual({ integration });
            await expect(disconnectAgentIntegration("codex")).resolves.toEqual({ integration });
            expect(recorded[0]).toMatchObject({ method: "post", url: "/agent-clients/integrations", data: { kind: "claude" } });
            expect(recorded[1]).toMatchObject({ method: "delete", url: "/agent-clients/integrations/codex" });
        });
    });

    test("The one-click access status returned by the list is unpacked as it is.", async () => {
        const integrations = [{ kind: "codex", name: "Codex", detected: false, connected: false, skillInstalled: false, needsRetry: false }];
        await withStubbedApi({ code: 0, data: { clients: [], cli: { path: "", available: false, installCommand: "" }, integrations }, msg: "ok" }, 200, async () => {
            const result = await listAgentClients();
            expect(result.integrations).toEqual(integrations);
        });
    });

    test("After the disconnection is successful, unpack the instructions that cannot be automatically removed.", async () => {
        const integration = { kind: "codex", name: "Codex", detected: true, connected: false, skillInstalled: false, needsRetry: false } as const;
        const warning = "BeefTV has stopped accepting access to Codex. The BeefTV connection in Codex is not automatically removed and can be manually removed in its MCP settings.";
        await withStubbedApi({ code: 0, data: { integration, warning }, msg: "ok" }, 200, async () => {
            await expect(disconnectAgentIntegration("codex")).resolves.toEqual({ integration, warning });
        });
    });
});

describe("Access content: Select commands or configurations based on client type", () => {
    test("Claude Desktop uses configuration files instead of Claude Code commands", () => {
        const block = agentClientSetupBlock({ kind: "claude-desktop", title: "T", json: '{"mcpServers":{"beeftv":{}}}' });
        expect(block?.format).toBe("json");
        expect(block?.instruction).toContain("Keep existing services");
        expect(block?.instruction).toContain("Completely exit");
        expect(block?.instruction).not.toContain("Terminal run");
    });
    test("codex/claude displays terminal commands", () => {
        for (const kind of ["codex", "claude"] as const) {
            const block = agentClientSetupBlock({ kind, title: "T", command: "beeftv mcp add", json: '{"mcpServers":{}}' });
            expect(block).toMatchObject({ text: "beeftv mcp add", format: "command" });
            expect(block?.instruction).toContain("PowerShell");
        }
    });

    test("cursor displays configuration and points to ~/.cursor/mcp.json", () => {
        const block = agentClientSetupBlock({ kind: "cursor", title: "T", command: "beeftv mcp add", json: '{"mcpServers":{"beeftv":{}}}' });
        expect(block).toMatchObject({ text: '{"mcpServers":{"beeftv":{}}}', format: "json", instruction: "Paste into ~/.cursor/mcp.json." });
    });

    test("Other MCP clients display configuration, and the guide does not mention the Cursor path.", () => {
        const block = agentClientSetupBlock({ kind: "other", title: "T", json: '{"mcpServers":{}}' });
        expect(block?.format).toBe("json");
        expect(block?.instruction).not.toContain(".cursor");
    });

    test("When only given to another form, the actual content will be displayed without leaving any blank space.", () => {
        expect(agentClientSetupBlock({ kind: "codex", title: "T", json: '{"mcpServers":{}}' })).toMatchObject({ format: "json" });
        expect(agentClientSetupBlock({ kind: "cursor", title: "T", command: "beeftv mcp add" })).toMatchObject({ format: "command" });
        expect(agentClientSetupBlock({ kind: "codex", title: "T" })).toBeNull();
        expect(agentClientSetupBlock(undefined)).toBeNull();
    });
});

describe("Button status for one-click access", () => {
    const base: AgentIntegration = { kind: "claude", name: "Claude Code", detected: true, connected: false, skillInstalled: false, needsRetry: false };

    test("If it is not detected, it will only explain how it appeared, but will not show the clickable access.", () => {
        const integration = { ...base, detected: false };
        expect(agentIntegrationStatusLabel(integration)).toBe("not detected");
        expect(agentIntegrationAction(integration)).toBe("unavailable");
        expect(agentIntegrationHint(integration)).toBe("Claude Code's command line is not detected. Open it once after installation and come back here.");
    });

    test("When the configuration is still there but no Agent is detected this time, the configuration written by BeefTV can still be disconnected.", () => {
        const integration = { ...base, detected: false, connected: true, skillInstalled: true };
        expect(agentIntegrationStatusLabel(integration)).toBe("Already connected");
        expect(agentIntegrationAction(integration)).toBe("disconnect");
        expect(agentIntegrationHint(integration)).toBe("Connected, but no Claude Code detected this time. It will take effect after reopening or reinstalling Claude Code.");
    });

    test("If the cleanup was not completed last time, it will display the need to retry and give the action of disconnecting.", () => {
        const integration = { ...base, connected: true, skillInstalled: true, needsRetry: true };
        expect(agentIntegrationStatusLabel(integration)).toBe("Need to retry");
        expect(agentIntegrationAction(integration)).toBe("disconnect");
        expect(agentIntegrationHint(integration)).toBe("The connection was not cleared last time. Click Disconnect again to try again.");
    });

    test("Explain what happens when detected but not connected", () => {
        expect(agentIntegrationStatusLabel(base)).toBe("Not connected");
        expect(agentIntegrationAction(base)).toBe("connect");
        expect(agentIntegrationHint(base)).toBe("After accessing, BeefTV will be added to Claude Code and a canvas usage instruction will be installed.");
    });

    test("When connected, it displays disconnected and explains that it can be used once it is turned on.", () => {
        const integration = { ...base, connected: true, skillInstalled: true };
        expect(agentIntegrationStatusLabel(integration)).toBe("Already connected");
        expect(agentIntegrationAction(integration)).toBe("disconnect");
        expect(agentIntegrationHint(integration)).toBe("Accessed. Open Claude Code to use the BeefTV canvas.");
    });

    test("When the configuration is written but the instructions for use are missing, prompt the truth and do not pretend to complete it.", () => {
        const integration = { ...base, kind: "codex" as const, name: "Codex", connected: true, skillInstalled: false };
        expect(agentIntegrationHint(integration)).toBe("It has been connected, but the instructions for use have not been written. Please check whether there is content with the same name in the corresponding skill directory.");
    });
});

describe("Recent usage time", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");

    test("If you haven't used it, just say you haven't used it.", () => {
        expect(agentClientLastUsedLabel(null, now)).toBe("Not used yet");
        expect(agentClientLastUsedLabel("", now)).toBe("Not used yet");
        expect(agentClientLastUsedLabel("not-a-date", now)).toBe("Not used yet");
    });

    test("Convergence to one sentence according to relative time", () => {
        expect(agentClientLastUsedLabel("2026-09-29T11:59:30Z", now)).toBe("just now");
        expect(agentClientLastUsedLabel("2026-09-29T11:30:00Z", now)).toBe("30 minutes ago");
        expect(agentClientLastUsedLabel("2026-09-29T06:00:00Z", now)).toBe("6 hours ago");
        expect(agentClientLastUsedLabel("2026-09-26T12:00:00Z", now)).toBe("3 days ago");
        expect(agentClientLastUsedLabel("2026-01-05T12:00:00Z", now)).toContain("2026");
    });
});

function configWithChannels(channels: ModelChannel[], overrides: Partial<AiConfig> = {}): AiConfig {
    return { ...defaultConfig, channels, ...overrides };
}

function channel(id: string, profiles: Array<{ model: string; capability: "text" | "image"; protocol?: string }>, enabled = true): ModelChannel {
    return createModelChannel({
        id,
        name: `channel${id}`,
        enabled,
        models: profiles.map((profile) => profile.model),
        modelProfiles: profiles.map((profile) => ({ model: profile.model, capability: profile.capability, protocol: profile.protocol })),
    });
}

describe("Helper model options", () => {
    const config = configWithChannels([
        channel("a", [
            { model: "chat-1", capability: "text", protocol: "chat-completion" },
            { model: "claude-1", capability: "text", protocol: "claude-api" },
            { model: "resp-1", capability: "text", protocol: "responses" },
            { model: "legacy-1", capability: "text", protocol: "openai-completion" },
            { model: "img-1", capability: "image", protocol: "openai-image" },
        ]),
        channel("b", [{ model: "chat-2", capability: "text", protocol: "chat-completion" }], false),
    ]);

    test("Models with only text capabilities and supported protocols, with values in the form channelId::modelId", () => {
        expect(assistantModelOptions(config)).toEqual(["a::chat-1", "a::claude-1", "a::resp-1"]);
    });

    test("Models without enabled channels do not appear in the options", () => {
        expect(assistantModelOptions(config)).not.toContain("b::chat-2");
    });

    test("When the text model does not write a protocol, it will be processed according to the dialogue protocol, which is still optional.", () => {
        const implicit = configWithChannels([channel("c", [{ model: "chat-3", capability: "text" }])]);
        expect(assistantModelOptions(implicit)).toEqual(["c::chat-3"]);
    });
});

describe("Saved value of helper model", () => {
    const config = configWithChannels([channel("a", [{ model: "chat-1", capability: "text", protocol: "chat-completion" }])], { textModel: "a::chat-1" });

    test("A null value means to follow the default text model", () => {
        expect(normalizeAssistantModel(config, "")).toBe("");
        expect(normalizeAssistantModel(config, undefined)).toBe("");
        expect(resolveAssistantModel(config)).toBe("a::chat-1");
    });

    test("What is saved is the complete value of the channel plus model.", () => {
        expect(normalizeAssistantModel(config, "a::chat-1")).toBe("a::chat-1");
        expect(resolveAssistantModel({ ...config, assistantModel: "a::chat-1" })).toBe("a::chat-1");
    });

    test("Fallback to follow default when pointing to a disappeared channel or unsupported protocol", () => {
        expect(normalizeAssistantModel(config, "gone::chat-1")).toBe("");
        const unsupported = configWithChannels([channel("a", [{ model: "img-1", capability: "image", protocol: "openai-image" }])], { textModel: "" });
        expect(normalizeAssistantModel(unsupported, "a::img-1")).toBe("");
        expect(resolveAssistantModel({ ...unsupported, assistantModel: "a::img-1" })).toBe("");
    });

    test("The default configuration brings the assistant model field, which is empty by default.", () => {
        expect(defaultConfig.assistantModel).toBe("");
    });
});
