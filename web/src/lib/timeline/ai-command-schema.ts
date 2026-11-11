// AI 编辑命令的边界层：同一份注册表同时约束模型输出和宿主执行，避免提示词与真实能力列表分叉。
// 本文件只负责 JSON 结构解析、批量预检和提示词契约生成；命令的参数合法性仍由编辑命令注册表统一判定。
// 预检使用与正式执行相同的纯函数注册表，保证“模型看见的能力”和“宿主实际允许的能力”一致。

import { getEditorCommandRegistry, type EditCommand } from "@/lib/timeline/editor-commands";
import type { TimelineProject } from "@/types/timeline";

/** LLM 输出 JSON 结构：reasoning 可选，commands 至少一条。 */
export type AiCommandPlan = {
    reasoning?: string;
    commands: EditCommand[];
};

export type AiCommandBatchVerdict =
    | { ok: true }
    | { ok: false; index: number; op: string; error: string };

export class AiCommandPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AiCommandPlanError";
    }
}

/** 从 LLM 回复中提取首个 JSON 对象（容忍 markdown fence / 前后缀杂讯）。 */
function extractFirstJsonObject(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    if (start < 0) throw new AiCommandPlanError("JSON object not found in output (requires { commands: [...] })");
    // 从首个 { 起逐字符数括号，找配对的收尾 }（字符串内括号不计）。
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === "{") {
            depth += 1;
        } else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return candidate.slice(start, i + 1);
        }
    }
    throw new AiCommandPlanError("JSON object is not closed (missing closing })");
}

function assertPlanShape(raw: unknown): asserts raw is AiCommandPlan {
    if (typeof raw !== "object" || raw === null) throw new AiCommandPlanError("Output must be a JSON object");
    const plan = raw as Record<string, unknown>;
    if (plan.reasoning !== undefined && typeof plan.reasoning !== "string") {
        throw new AiCommandPlanError("reasoning must be a string");
    }
    if (!Array.isArray(plan.commands)) throw new AiCommandPlanError("missing commands array");
    if (plan.commands.length > AI_EDITING_MAX_COMMANDS) {
        throw new AiCommandPlanError(`commands exceed${AI_EDITING_MAX_COMMANDS} bar upper limit`);
    }
    // commands 为空数组 = 只读问答 / 无可用命令，合法终态
    plan.commands.forEach((cmd, i) => {
        if (typeof cmd !== "object" || cmd === null) throw new AiCommandPlanError(`commands[${i}] must be an object`);
        const c = cmd as Record<string, unknown>;
        if (typeof c.op !== "string" || c.op.length === 0) throw new AiCommandPlanError(`commands[${i}].op must be a non-empty string`);
        if (typeof c.payload !== "object" || c.payload === null || Array.isArray(c.payload)) {
            throw new AiCommandPlanError(`commands[${i}].op=${c.op} Missing object payload`);
        }
    });
}

/**
 * 解析模型文本为 AiCommandPlan；结构非法时抛 AiCommandPlanError，调用方可将明确原因展示给用户或回传模型修正。
 * commands 为空数组表示只读问答或当前能力无法完成，调用方不应把它当成“执行成功的空修改”。
 */
export function parseAiCommandPlan(text: string): AiCommandPlan {
    let raw: unknown;
    try {
        raw = JSON.parse(extractFirstJsonObject(text));
    } catch (error) {
        if (error instanceof AiCommandPlanError) throw error;
        throw new AiCommandPlanError(`JSON parsing failed:${(error as Error).message}`);
    }
    assertPlanShape(raw);
    return raw;
}

/**
 * 批级预检：把整批命令按序 dry-run 到当前时间线（immutable 纯函数，无副作用）。
 * 任何一条触发注册表的拒绝规则（未知 op、非法 payload 或引用不存在）即整批拒绝，
 * 返回首个失败命令的位置和原因；正式执行不得绕过这一步或只提交部分命令。
 */
export function validateAiCommandBatch(project: TimelineProject, plan: AiCommandPlan): AiCommandBatchVerdict {
    const registry = getEditorCommandRegistry();
    let state = project;
    for (let i = 0; i < plan.commands.length; i += 1) {
        const cmd = plan.commands[i];
        try {
            state = registry.apply(state, cmd);
        } catch (error) {
            return { ok: false, index: i, op: cmd.op, error: (error as Error).message };
        }
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------
// 模型提示词契约：schema 同时用于宿主校验与模型输出约束，具体交互决策见 ADR-0007。
// ---------------------------------------------------------------------------

/** AI 命令 schema 版本；提示词契约或解析规则变化时递增，用于 golden 测试和缓存失效对齐。 */
export const AI_COMMAND_SCHEMA_VERSION = 1;

/** 单次 AI 编辑最多允许的命令条数，防止一次模型输出造成不可控的大范围变更。 */
export const AI_EDITING_MAX_COMMANDS = 8;

/** 12 个黄金 op 的 LLM 可读 payload 契约；op 集合与注册表黄金同步（见测试）。 */
export const AI_EDITING_OP_CATALOG: ReadonlyArray<{
    op: string;
    desc: string;
    payload: string;
}> = [
    {
        op: "addClip",
        desc: "Add media/text clips to existing tracks",
        payload: "{ clip: { id(新唯一), kind: video|audio|image|text, trackId(必须存在), nodeId(源素材), startMs≥0, durationMs>0, title?, volume?, fadeInMs?, fadeOutMs? } }",
    },
    {
        op: "moveClip",
        desc: "Move clips (point in time/across tracks)",
        payload: "{ id, startMs≥0, trackId?(可选, 必须存在) }",
    },
    {
        op: "trimClip",
        desc: "Trim clip (timeline position/duration/in-source starting point)",
        payload: "{ id, startMs?(≥0), durationMs?(>0 且≤sourceDurationMs), sourceStartMs?(≥0, 与 durationMs 之和≤sourceDurationMs) }",
    },
    {
        op: "splitClip",
        desc: "Cut a knife inside the segment into two pieces",
        payload: "{ id, splitAtMs(严格大于 startMs 且小于 startMs+durationMs) }",
    },
    {
        op: "removeClip",
        desc: "Delete segment",
        payload: "{ id }",
    },
    {
        op: "setClipProperty",
        desc: "Modify fragment properties (whitelist)",
        payload: "{ id, patch: { title? | text? | volume? | fadeInMs? | fadeOutMs? | subtitleEntryIndex? } (at least one item) }",
    },
    {
        op: "addSubtitle",
        desc: "Add subtitle snippet",
        payload: "{ clip: { kind: subtitle, trackId(字幕轨), id/nodeId/startMs/durationMs/text } }",
    },
    {
        op: "removeSubtitle",
        desc: "Delete subtitle segment",
        payload: "{ id }",
    },
    {
        op: "rebuildSubtitleClips",
        desc: "Reconstruct subtitle fragments by node subtitle entries",
        payload: "{ nodeId, entries: [{ index≥0(唯一), startMs≥0, endMs>startMs, text }], trackId?(字幕轨) }",
    },
    {
        op: "addTrack",
        desc: "Add a new track (id/label is generated by the system, do not pass it)",
        payload: "{ kind: video|image|text|audio|subtitle }",
    },
    {
        op: "removeTrack",
        desc: "Delete entire tracks and regions (leave at least one of each type of track)",
        payload: "{ trackId }",
    },
    {
        op: "setTrackFlag",
        desc: "track switch",
        payload: "{ trackId, flag: visible|muted, value: boolean }",
    },
];

/** LLM 输出结构说明（追加到系统提示词，约束其为纯 JSON）。 */
export const AI_EDITING_OUTPUT_FORMAT = `Output requirements:
- Output only a JSON object without any explanatory text or markdown.
- Structure: { "reasoning": "One sentence to explain the intention", "commands": [ { "op": "Command name", "payload": { ... } } ] }
- commands: 1-8 items when they can be executed; an empty array [] when the user just asks a question or cannot complete it with existing commands, in which case reasoning directly answers the user.
- The payload field strictly follows the command contract; the time is always milliseconds; the text is in Simplified Chinese.
- All IDs (clip/track/nodeId) must come from the timeline summary above, fabrication is prohibited.`;

/** 示例（示意完整 JSON 输出，加入 system prompt）。 */
const AI_EDITING_OUTPUT_EXAMPLE = `Example:
{ "reasoning": "Move the first video clip to 5 seconds", "commands": [ { "op": "moveClip", "payload": { "id": "clip-a", "startMs": 5000 } } ] }`;

/** 组装 AI 编辑系统提示词：时间线摘要、可用 op 契约和输出约束必须来自同一份注册表。 */
export function buildAiEditingSystemPrompt(timelineSummary: string): string {
    const catalogLines = AI_EDITING_OP_CATALOG.map(
        (entry) => `- ${entry.op}：${entry.desc}。payload：${entry.payload}`,
    ).join("\n");
    return [
        "You are the AI editing assistant of BeefTV Video Editing Workbench. Outputs JSON of constrained editing commands to the timeline based on user instructions.",
        "Timeline current status:",
        timelineSummary,
        "Available command contracts (same source as the editor, illegal commands will be rejected in batches):",
        catalogLines,
        AI_EDITING_OUTPUT_FORMAT,
        AI_EDITING_OUTPUT_EXAMPLE,
        "If user instructions cannot be completed with existing commands (such as transitions, filters, templates), output commands: [] and explain what capabilities are missing in reasoning.",
    ].join("\n");
}
