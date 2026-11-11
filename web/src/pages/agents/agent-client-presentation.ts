import type { AgentClient, AgentClientKind, AgentClientMode, AgentClientSetup, AgentIntegration, AgentIntegrationKind } from "@/services/api/agent-clients";

export const agentClientKinds: AgentClientKind[] = ["codex", "claude", "claude-desktop", "cursor", "other"];

const kindLabels: Record<AgentClientKind, string> = {
    codex: "Codex",
    claude: "Claude Code",
    "claude-desktop": "Claude Desktop",
    cursor: "Cursor",
    other: "Other MCP clients",
};

const kindSummaries: Record<AgentClientKind, string> = {
    codex: "Connect to Codex in the terminal.",
    claude: "Connect to Claude Code in the terminal.",
    "claude-desktop": "Connect in the Claude desktop app.",
    cursor: "Connect in Cursor configuration.",
    other: "All tools that support MCP can be connected.",
};

const modeLabels: Record<AgentClientMode, string> = {
    "read-only": "Legacy read-only connections",
    "read-write": "All creative tools",
};

const modeSummaries: Record<AgentClientMode, string> = {
    "read-only": "This connection remains read-only; all authoring tools will be available upon reconnection.",
    "read-write": "All of BeefTV's authoring tools are available, and approval of operations is handled by the connected Agent.",
};

export function agentClientKindLabel(kind: AgentClientKind | string) {
    return kindLabels[kind as AgentClientKind] || "Other MCP clients";
}

export function agentClientKindSummary(kind: AgentClientKind) {
    return kindSummaries[kind];
}

export function agentClientModeLabel(mode: AgentClientMode | string) {
    return modeLabels[mode as AgentClientMode] || modeLabels["read-only"];
}

export function agentClientModeSummary(mode: AgentClientMode) {
    return modeSummaries[mode];
}

export type AgentClientSetupBlock = {
    /** 待粘贴的整段内容；凭证只存在于这里，页面不再单独展示。 */
    text: string;
    format: "command" | "json";
    instruction: string;
};

const COMMAND_INSTRUCTION = "Paste into Terminal and run; for Windows, use PowerShell. Please keep BeefTV on while connected.";

const configInstructions: Record<AgentClientKind, string> = {
    codex: "Paste it into the MCP configuration file of the tool you are using.",
    claude: "Paste it into the MCP configuration file of the tool you are using.",
    "claude-desktop": "Open Claude Desktop's Settings → Developer → Edit Configuration, merge the beeftv entry into mcpServers, keep the existing service, then exit completely and reopen Claude. Please keep BeefTV on while connected.",
    cursor: "Paste into ~/.cursor/mcp.json.",
    other: "Paste it into the MCP configuration file of the tool you are using.",
};

/**
 * codex / claude 给一条终端命令，cursor / other 给一段配置。
 * 后端只会给出其中一种；若与类型不一致，按实际给到的那一种展示，避免页面空白。
 */
export function agentClientSetupBlock(setup: AgentClientSetup | undefined): AgentClientSetupBlock | null {
    if (!setup) return null;
    const command = setup.command?.trim() || "";
    const json = setup.json?.trim() || "";
    const prefersCommand = setup.kind === "codex" || setup.kind === "claude";
    const text = prefersCommand ? command || json : json || command;
    if (!text) return null;
    const format: "command" | "json" = text === command ? "command" : "json";
    return { text, format, instruction: format === "command" ? COMMAND_INSTRUCTION : configInstructions[setup.kind] || configInstructions.other };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 最近使用：没用过要说没用过，不要显示一个假的时间。 */
export function agentClientLastUsedLabel(lastUsedAt: string | null | undefined, now: number = Date.now()) {
    if (!lastUsedAt) return "Not used yet";
    const used = Date.parse(lastUsedAt);
    if (!Number.isFinite(used)) return "Not used yet";
    const elapsed = now - used;
    if (elapsed < MINUTE) return "just now";
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} minutes ago`;
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hours ago`;
    if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)} days ago`;
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(used);
}

export function agentClientDisplayLabel(client: AgentClient) {
    return client.label?.trim() || agentClientKindLabel(client.kind);
}

export function agentIntegrationKindLabel(kind: AgentIntegrationKind) {
    return kind === "claude" ? kindLabels.claude : kindLabels.codex;
}

/** 状态只说明本机事实：没检测到、已接入或还没接入。 */
export function agentIntegrationStatusLabel(integration: AgentIntegration) {
    if (integration.needsRetry) return "Need to retry";
    if (integration.connected) return "Already connected";
    return integration.detected ? "Not connected" : "not detected";
}

export type AgentIntegrationAction = "connect" | "disconnect" | "unavailable";

export function agentIntegrationAction(integration: AgentIntegration): AgentIntegrationAction {
    // A connected config can outlive the agent installation; always let the
    // user remove what BeefTV wrote. Retry also starts by cleaning up.
    if (integration.needsRetry || integration.connected) return "disconnect";
    return integration.detected ? "connect" : "unavailable";
}

/** 一行说清接入会发生什么、未检测到该怎么办、断开能恢复什么。 */
export function agentIntegrationHint(integration: AgentIntegration) {
    const name = integration.name || agentIntegrationKindLabel(integration.kind);
    if (integration.needsRetry) return "The connection was not cleared last time. Click Disconnect again to try again.";
    if (integration.connected && !integration.detected) return `Connected, but not detected this time${name}. Reopen or reinstall${name} It will take effect later.`;
    if (!integration.detected) return `not detected${name} command line. Open it once after installation and come back here.`;
    if (integration.connected && !integration.skillInstalled) return "It has been connected, but the instructions for use have not been written. Please check whether there is content with the same name in the corresponding skill directory.";
    if (integration.connected) return `Accessed. open${name} You can use the BeefTV canvas.`;
    return `After accessing, it will be${name} Add BeefTV and install a copy of the canvas instructions.`;
}
