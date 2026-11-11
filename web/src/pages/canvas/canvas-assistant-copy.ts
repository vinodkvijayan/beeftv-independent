// 助手面板里所有用户可见文案的唯一来源：机器可读原因、操作名和改动摘要都在这里
// 翻译成用户语。组件只负责排版，不自己拼文案，避免同一种状态在两处写出两句话。
import type { AgentLifecycleEvent, AgentToolCall, AssistantGenerationProposal, AssistantScriptProposal, AssistantSkillSelection, AssistantTurnChange, AssistantUndoFailure } from "@/services/api/agent-assistant";
import { seedancePortraitLabel } from "@/lib/seedance-portrait";
import type { CanvasNodeData } from "@/types/canvas";
import { authoritativeNodeOutcome } from "@/lib/canvas/canvas-node-failure-state";

export type AssistantStatusAction = "model-settings" | "retry";

export type AssistantStatusNotice = {
    text: string;
    actionLabel?: string;
    action?: AssistantStatusAction;
    /** 正在启动时要更频繁地复查状态，其余情况按常规节奏。 */
    starting?: boolean;
};

/** 兜底文案：原因缺失或后端给了我们还不认识的值时用这一句。 */
export const ASSISTANT_UNAVAILABLE_FALLBACK = "The assistant is temporarily unavailable, please try again later.";

export function assistantStatusNotice(reason: string | undefined): AssistantStatusNotice {
    switch (reason) {
        case "model_not_configured":
        case "model_protocol_unsupported":
            return { text: "There is no helper model available yet", actionLabel: "Go to model configuration", action: "model-settings" };
        case "credential_missing":
            return { text: "BeefTV is not connected yet", actionLabel: "to connect", action: "model-settings" };
        case "host_starting":
            return { text: "Assistant starting...", starting: true };
        case "host_start_failed":
        case "host_unreachable":
            return { text: "The assistant did not start successfully", actionLabel: "Try again", action: "retry" };
        default:
            return { text: ASSISTANT_UNAVAILABLE_FALLBACK, actionLabel: "Try again", action: "retry" };
    }
}

/** 工具名是内部标识，用户只该看到「做了什么」。 */
export function assistantActionLabel(tool: string | undefined): string {
    const name = (tool || "").trim();
    if (name.startsWith("asset.")) return "Read material";
    switch (name) {
        case "media.overview":
        case "media_overview":
            return "Browse materials";
        case "media.inspect":
        case "media_inspect":
            return "View and listen to material";
        case "media.check":
        case "media_check":
            return "Check media files";
        case "canvas.nodes.create":
            return "Create new node";
        case "canvas.node.update":
            return "Modify node";
        case "canvas.timeline.update":
            return "Edit timeline";
        case "canvas.edge.create":
            return "Connect";
        case "canvas.get":
        case "canvas.search":
            return "Read canvas";
        case "canvas.generation.propose":
            return "ready to generate";
        case "canvas.generation.submit":
            return "Generate material";
        case "canvas.project.export":
            return "Export project";
        case "skill.script.run":
        case "skill_script_run":
            return "Run skill script";
        default:
            return "Change canvas";
    }
}

/** 失败的那一步用一句话说清楚是哪件事没成。 */
export function assistantFailedActionText(call: AgentToolCall): string {
    return `${assistantActionLabel(call.tool)}no success`;
}

/**
 * 这一轮改了什么：只数真实落地的对象，不复述用户的选择数量。
 * 没有任何改动时返回 null，卡片整块不出现。
 */
export function assistantChangeSummary(change: AssistantTurnChange | null | undefined): string | null {
    if (!change) return null;
    const parts: string[] = [];
    const changes = change.canvasChanges?.length ? change.canvasChanges : [change];
    if (change.canvasChanges?.length) parts.push(`Modified${new Set(change.canvasChanges.map(item => item.canvasId)).size} canvas`);
    const created = changes.reduce((total, item) => total + (item.createdNodeIds?.length ?? 0), 0);
    const updated = changes.reduce((total, item) => total + (item.updatedNodeIds?.length ?? 0), 0);
    const deleted = changes.reduce((total, item) => total + (item.deletedNodeIds?.length ?? 0), 0);
    const edges = changes.reduce((total, item) => total + (item.createdEdgeIds?.length ?? 0), 0);
    const deletedEdges = changes.reduce((total, item) => total + (item.deletedEdgeIds?.length ?? 0), 0);
    if (created > 0) parts.push(`New${created} nodes`);
    if (updated > 0) parts.push(`Modify${updated} nodes`);
    if (deleted > 0) parts.push(`Delete${deleted} nodes`);
    if (edges > 0) parts.push(`Connected${edges} lines`);
    if (deletedEdges > 0) parts.push(`Delete${deletedEdges} lines`);
    if (changes.some(item => item.timelineUpdated)) parts.push("Edit timeline");
    if (changes.some(item => item.documentUpdated)) parts.push("Modify canvas content");
    if (!parts.length) return null;
    return parts.join("，");
}

/** 改动卡片要定位的对象：新建的和被改过的都算。 */
export function assistantChangedNodeIds(change: AssistantTurnChange | null | undefined): string[] {
    if (!change) return [];
    const ids = new Set<string>();
    const deleted = new Set(change.deletedNodeIds || []);
    for (const id of change.createdNodeIds || []) if (!deleted.has(id)) ids.add(id);
    for (const id of change.updatedNodeIds || []) if (!deleted.has(id)) ids.add(id);
    return [...ids];
}

export function assistantUndoFailureText(failure: AssistantUndoFailure): string {
    switch (failure) {
        case "canvas_changed":
            return "The canvas has been modified since then and cannot be undone directly.";
        case "already_undone":
            return "This round has been canceled";
        case "no_change":
            return "No canvas changes were made this round";
        default:
            return "Undo was unsuccessful, please try again";
    }
}

export type AssistantProductionProposalParts = {
    header: string;
    targetLines: string[];
    footer: string;
};

const PROPOSAL_PARAMETER_LABELS: Record<string, string> = {
    size: "frame",
    quality: "quality",
    vquality: "resolution",
    seconds: "Duration (seconds)",
    generateAudio: "generate sound",
    audioVoice: "timbre",
    audioSpeed: "speaking speed",
    audioFormat: "audio format",
    audioInstructions: "Read instructions aloud",
    transparentBackground: "Transparent background",
    watermark: "watermark",
    seedreamOutputFormat: "Picture format",
    seedreamOptimize: "Prompt word optimization",
    seedreamWatermark: "Picture watermark",
};

/** 拆出普通生成单的逐项明细（提示词、模型、参数、参考与报价状态），供卡片折叠展开。 */
export function assistantOrderTargetLines(proposal: AssistantGenerationProposal, awaitingConfirmation = true): string[] {
    if (proposal.production) return [];
    const targets = proposal.targets?.length ? proposal.targets : proposal.order?.targetViews || [];
    if (!targets.length) return [];
    return targets.map((t) => {
        const params = Object.entries(t.parameters || {}).filter(([key]) => PROPOSAL_PARAMETER_LABELS[key]).map(([key, value]) => {
            const display = key === "seedreamOptimize" ? (value === "standard" ? "Standard" : value === "fast" ? "fast" : value)
                : key === "seedreamWatermark" ? (value === "true" ? "turn on" : "Close")
                : key === "seedreamOutputFormat" ? value.toUpperCase() : value;
            return `${PROPOSAL_PARAMETER_LABELS[key]}：${display}`;
        }).join(" · ");
        const refs = (t.referenceNodeIds || []).map((id) => targets.find((item) => item.nodeId === id)?.title || "Already have reference material");
        const modelLabel = t.model || t.modelKey?.split("::").pop() || proposal.model;
        return [
            `${t.title || t.nodeId} · ${modelLabel} · ${t.parameters?.count || "1"} a`,
            ...(params ? [params] : []),
            ...(refs.length ? [`Reference:${refs.join("、")}`] : []),
            ...(awaitingConfirmation && t.estimate?.text ? [`Fees:${t.estimate.text}`] : []),
            `${t.kind === "audio" ? "Lines" : "prompt word"}：${t.prompt}`,
        ].join("\n");
    });
}

/** 拆出整片方案的概览、逐项明细与确认提示，供卡片默认收起明细、按需展开。 */
export function assistantProductionProposalParts(
    proposal: AssistantGenerationProposal,
    awaitingConfirmation = true,
): AssistantProductionProposalParts | null {
    if (!proposal.production) return null;
    const targets = proposal.production.targets;
    const images = targets.filter(t => t.kind === "image").length;
    const videos = targets.filter(t => t.kind === "video");
    const audio = targets.filter(t => t.kind === "audio");
    const labels = PROPOSAL_PARAMETER_LABELS;
    const priceSummary = awaitingConfirmation ? proposal.production.estimate?.text : "";
    const header = `Whole film production plan:${images} pictures,${videos.length} video,${audio.length} Dubbing section${priceSummary ? `\n${priceSummary}` : ""}`;
    const targetLines = targets.map((t) => {
        const params = Object.entries(t.parameters).filter(([key]) => labels[key]).map(([key,value]) => {
            const display = key === "seedreamOptimize" ? (value === "standard" ? "Standard" : value === "fast" ? "fast" : value)
                : key === "seedreamWatermark" ? (value === "true" ? "turn on" : "Close")
                : key === "seedreamOutputFormat" ? value.toUpperCase() : value;
            return `${labels[key]}：${display}`;
        }).join(" · ");
        const refs = t.referenceNodeIds.map(id => targets.find(item => item.nodeId === id)?.title || "Already have reference material");
        const estimate = awaitingConfirmation ? t.estimate?.text : "";
        return `${t.title} · ${t.modelKey.split("::").pop()} · ${t.parameters.count || "1"} a${params}${refs.length ? `Reference:${refs.join("、")}` : ""}${estimate ? `Fees:${estimate}` : ""}\n${t.kind === "audio" ? "Lines" : "prompt word"}：${t.prompt}`;
    });
    const footer = awaitingConfirmation ? "After confirmation, generate materials according to this plan, and automatically complete sound, subtitles and editing (you can click the button below or directly send \"Confirm\" to start). Materials are billed according to the selected channel; after failure, confirmation of a new plan and regeneration will also result in rebillment, and re-confirmation will be made when adding or modifying generated content." : "";
    return { header, targetLines, footer };
}

/** 提议可能来自自建渠道，不能把所有费用都归到 BeefTV 官方算力。没有后端估算的旧提议仍显示渠道单价。 */
export function assistantProposalText(
    proposal: AssistantGenerationProposal,
    priceLines: string[] = [],
    awaitingConfirmation = true,
): string {
    const count = proposal.nodeIds?.length ?? 0;
    const productionParts = assistantProductionProposalParts(proposal, awaitingConfirmation);
    if (productionParts) {
        return [productionParts.header, ...productionParts.targetLines, ...(productionParts.footer ? [productionParts.footer] : [])].join("\n\n");
    }
    const target = proposal.kind === "video" ? "video" : proposal.kind === "audio" ? "Audio" : "pictures";
    const title = `for${count} nodes generated${target} · ${seedancePortraitLabel(proposal.model) || proposal.model}`;
    const prices = proposal.estimate?.text ? [proposal.estimate.text] : priceLines;
    return awaitingConfirmation ? `${title}\n${prices.length ? prices.join("\n") + "\n" : ""}After confirmation, billing will begin based on the selected channel.` : title;
}

/** Match the submitted proposal, including fan-out images; old results on the source node are not receipts. */
export function assistantProposalProgress(proposal: AssistantGenerationProposal, nodes: CanvasNodeData[]) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const outputs = new Map<string, CanvasNodeData>();
    let unknown = false, batchUnverified = false, planned = 0;
    for (const sourceId of new Set(proposal.production?.targets.map(t => t.nodeId) || proposal.nodeIds)) {
        const operationId = `proposal:${proposal.proposalId}:${sourceId}`;
        const matches = (node: CanvasNodeData) => {
            const actual = node.metadata?.taskClientOperationId || "";
            return actual === operationId || (actual.startsWith(`${operationId}:`) && /^\d+$/.test(actual.slice(operationId.length + 1)));
        };
        const matched = nodes.filter(matches);
        if (!matched.length) { if (proposal.production) planned++; else unknown = true; continue; }
        const roots = new Set(matched.flatMap(node => (node.metadata?.isBatchRoot || node.metadata?.generationOutputNodeIds?.includes(node.id)) ? [node.id] : node.metadata?.batchRootId ? [node.metadata.batchRootId] : []));
        if (roots.size) {
            for (const rootId of roots) {
                const root = byId.get(rootId);
                // Layout children and count are editable; only the original submission
                // targets can establish that every output has reached a terminal state.
                const expected = root?.metadata?.generationOutputNodeIds;
                const children = expected?.length ? expected : root?.metadata?.batchChildIds;
                if (!expected?.length) { unknown = true; batchUnverified = true; }
                if (!children?.length) { unknown = true; batchUnverified = true; continue; }
                for (const childId of children) {
                    const child = byId.get(childId);
                    if (!child || !matches(child)) { unknown = true; batchUnverified = true; continue; }
                    outputs.set(child.id, child);
                }
            }
        } else {
            // Indexed submissions without their batch root cannot tell us the expected count.
            if (matched.length !== 1 || matched[0].metadata?.taskClientOperationId !== operationId) unknown = true;
            for (const node of matched) outputs.set(node.id, node);
        }
    }
    let complete = 0, failed = 0, pending = planned, retrieving = 0;
    for (const node of outputs.values()) {
        const meta = node.metadata || {};
        const phase = authoritativeNodeOutcome(meta)?.phase;
        const bound = meta.status === "success" && Boolean(meta.content || meta.storageKey);
        if (phase === "running" || phase === "fetching" || phase === "retrievable") {
            pending++;
        } else if (phase === "ready") {
            if (bound) complete++;
            else pending++;
        } else if (phase === "failed") {
            failed++;
        } else if (meta.taskStatus === "failed" || meta.taskStatus === "cancelled" || meta.status === "error") {
            failed++;
        } else if (meta.taskStatus === "succeeded") {
            if (bound) complete++;
            else retrieving++;
        } else if (meta.taskStatus === "queued" || meta.taskStatus === "running" || meta.generationSubmissionState === "submitting") {
            pending++;
        } else {
            unknown = true;
        }
    }
    const ready = !unknown && outputs.size > 0 && pending === 0 && retrieving === 0;
    const visibleResults = failed ? `${complete} results are ready.${failed} results were not generated due to task failure or cancellation.` : `${complete}/${outputs.size} visible results are ready.`;
    const text = unknown ? batchUnverified ? `${visibleResults} Unable to confirm whether this batch of results is complete. You can select the ready result on the canvas and send it to the assistant for checking.` : "Some build status needs to be confirmed, please check the task list."
        : pending ? `Generating,${complete}/${outputs.size + planned} results are ready.`
        : retrieving ? `${complete}/${outputs.size} results are ready, the remaining results are not available yet. Please check the retrieval tips on the node.`
        : failed ? `${complete} results are ready.${failed} results were not generated due to task failure or cancellation.`
        : proposal.production ? `${complete} The materials have been saved. Please see the assistant message for subsequent production and delivery progress.` : `${complete} The results are ready and can be checked by an assistant.`;
    return { ready, text, nodeIds: [...outputs.keys()] };
}

export const ASSISTANT_CHECK_RESULTS_PROMPT = "Check whether the result generated this time meets the corresponding storyboard requirements, and then continue with the steps that do not require my confirmation. Check the existing products first and keep the successful results; if there are failures, explain the reasons and adjustment suggestions, and do not re-submit the started generation tasks.";

export function appendAssistantDraft(draft: string, prompt: string) {
    if (draft.includes(prompt)) return draft;
    return draft.trim() ? `${draft}\n\n${prompt}` : prompt;
}

export const ASSISTANT_STARTER_PROMPTS = [
    "Break down the script into a draft storyboard",
    "Add scene and mood to the selected shot",
    "Organize the canvas and connect lines in order",
    "Check which lenses are missing reference images",
];

const ASSISTANT_TOOL_ACTIVITY: Record<string, [string, string]> = {
    media_overview: ["Loading material summary.", "Material summary read"],
    media_inspect: ["Checking selected footage.", "Selected material loaded"],
    media_check: ["Checking black screen, audio track and file information.", "Media file information checked"],
    canvas_get: ["Reading canvas.", "Canvas read"],
    model_catalog: ["Viewing available models and offers.", "Model directory read"],
    canvas_nodes_create: ["Creating canvas node.", "Canvas node created"],
    canvas_node_configure: ["Configuring build parameters.", "Configured build parameters"],
    canvas_node_update: ["Updating canvas content.", "Canvas content updated"],
    canvas_edge_create: ["Linking reference material.", "Reference material connected"],
    canvas_script_rows_append: ["Storyboarding is being arranged.", "Storyboarded"],
    canvas_script_row_update: ["Storyboards are being updated.", "Storyboard updated"],
    canvas_timeline_update: ["Arranging editing timeline.", "Saved clip timeline"],
    canvas_timeline_render: ["The film is being submitted for composition.", "Submitted for film synthesis"],
    canvas_timeline_deliver: ["Compositing video and saving editable project.", "Delivery completed"],
    canvas_generation_propose: ["Preparing to generate plan.", "Ready to generate plan"],
    skill_script_run: ["Skill script is being prepared.", "Skill script operation completed"],
};

/** 只显示官方活动和已核对的操作回执，不把工具完成等同于创作质量验收。 */
export function assistantLifecycleText(event: Pick<AgentLifecycleEvent, "phase" | "toolName" | "success" | "stage" | "saved" | "total"> | string | null | undefined): string | null {
    const phase = typeof event === "string" ? event : event?.phase;
    switch (phase) {
        case "business": {
            if (!event || typeof event === "string") return null;
            const count = Number.isSafeInteger(event.total) && event.total! > 0 && event.total! <= 1000 &&
                Number.isSafeInteger(event.saved) && event.saved! >= 0 && event.saved! <= event.total!
                ? ` ${event.saved}/${event.total} The results of tasks have been saved.` : "";
            switch (event.stage) {
                case "processing": return `Materials are being generated.${count}`;
                case "downloading": return `Retrieving build results.${count}`;
                case "saving": return `Existing results are generated and the file is being saved.${count}`;
                case "saved": return "The file has been saved and processing is continuing.";
                case "binding": return "File saved, canvas updated.";
                case "rendering": return "Compositing video.";
                case "exporting": return "The video is available and the editable project is being exported.";
                case "checking": return "Checking timeline.";
                case "observation_unavailable": return "The original task has been retained and the progress cannot be read temporarily.";
                default: return null;
            }
        }
        case "tool": case "tool_end": {
            const tool = typeof event === "string" ? "" : event?.toolName?.replaceAll(".", "_") || "";
            const activity = ASSISTANT_TOOL_ACTIVITY[tool];
            if (!activity) return null;
            if (phase === "tool") return activity[0];
            return typeof event !== "string" && event?.success === true
                ? `${activity[1]}, production is continuing.` : "The operation results are being checked and processing continues.";
        }
        case "compaction":
            return "The conversation is being organized for easy continuation.";
        case "retry":
            return "The model is temporarily unresponsive, trying again.";
        default:
            return null;
    }
}

/** 这里只提供继续对话入口，不重发原请求，也不保证后台任务已恢复。 */
export function assistantTurnCanContinue(reason: string | null | undefined): boolean {
    return ["turn_timeout", "turn_interrupted", "turn_request_budget_exhausted", "turn_tool_step_budget_exhausted", "model_request_failed", "model_error", "provider_error"].includes(reason || "");
}

export const ASSISTANT_CONTINUE_PROMPT = "Continue to complete the previous requirement. First check the current canvas and completed operations, retain the existing results; do not repeatedly create nodes or resubmit the started generation task.";
export const ASSISTANT_UNDONE_INCOMPLETE_TEXT = "This round is not completed, and the canvas changes that have been made have been undone.";

const REASONING_TAG_PREFIXES = ["</thinking>", "<thinking>", "</think>", "<think>"];

function stripDanglingReasoningTag(text: string) {
    const start = text.lastIndexOf("<");
    return start >= 0 && REASONING_TAG_PREFIXES.some((tag) => tag.startsWith(text.slice(start).toLowerCase()))
        ? text.slice(0, start) : text;
}

/**
 * 官方会话把推理放在独立的 thinking 块里，不进入回复。
 * 有的模型仍把 <thinking> 或 <think> 直接写进正文；那是草稿，不是给用户的话。
 * 代码示例里的同名标记保留。未闭合的思考区块隐藏到正文末尾，不猜测答案起点。
 */
export function assistantVisibleReply(text: string): string {
    const tokens = /`+|~{3,}|<\/?(?:think|thinking)>/gi;
    const reasoning: string[] = [];
    let output = "";
    let index = 0;
    for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
        if (!reasoning.length) output += text.slice(index, token.index);
        const marker = token[0];
        index = tokens.lastIndex;
        if (marker[0] === "`" || marker[0] === "~") {
            const delimiters = new RegExp(`${marker[0]}+`, "g");
            delimiters.lastIndex = index;
            let end = delimiters.exec(text);
            while (end && (marker.length >= 3 ? end[0].length < marker.length : end[0].length !== marker.length)) {
                end = delimiters.exec(text);
            }
            index = end ? delimiters.lastIndex : text.length;
            if (!reasoning.length) output += text.slice(token.index, index);
            tokens.lastIndex = index;
        } else if (marker[1] !== "/") {
            reasoning.push(marker.slice(1, -1).toLowerCase());
        } else if (reasoning.at(-1) === marker.slice(2, -1).toLowerCase()) {
            reasoning.pop();
        }
    }
    if (!reasoning.length) output += stripDanglingReasoningTag(text.slice(index));
    return output.trim();
}

/** 修改看节点，连线看两端；媒体读取失败会影响审片结论，按同一片段判断是否后来成功。 */
function assistantActionTarget(call: AgentToolCall): string | null {
    const args = call.args || {};
    switch (call.tool) {
        case "media.overview":
        case "media.inspect":
        case "media.check":
        case "media_overview":
        case "media_inspect":
        case "media_check":
            return `media:${JSON.stringify(args)}`;
        case "canvas.node.update":
            return `update:${String(args.nodeId ?? "")}`;
        case "canvas.timeline.update":
            return "timeline";
        case "canvas.edge.create":
            return `edge:${String(args.fromNodeId ?? "")}>${String(args.toNodeId ?? "")}`;
        case "canvas.nodes.create":
            // 模型重试新建时常会调整标题或数量：之后任何一次新建成功都算这一步已完成。
            return "create";
        case "canvas.generation.propose":
            return `propose:${Array.isArray(args.nodeIds) ? args.nodeIds.join("|") : ""}`;
        default:
            return null;
    }
}

/**
 * 这一轮里最后仍没做成的事：失败后又重试成功的步骤不再提示，
 * 同类失败合并成一句，避免把助手的中间重试当成错误摆给用户。
 */
export function assistantUnresolvedFailures(calls: AgentToolCall[] | undefined): string[] {
    const list = calls || [];
    const counts = new Map<string, number>();
    list.forEach((call, index) => {
        if (!call.isError) return;
        const target = assistantActionTarget(call);
        if (!target) return;
        const resolved = list.slice(index + 1).some((later) => {
            if (later.isError || later.tool !== call.tool) return false;
            if (assistantActionTarget(later) === target) return true;
            // 同一节点的 overview 补齐缺失 resourceId 后成功，属于原步骤的重试。
            // 不合并不同素材、片段、版本，也不让 overview 代替 inspect。
            if (!['media.overview', 'media_overview'].includes(call.tool)) return false;
            const before = call.args || {};
            const after = later.args || {};
            if (before.resourceId || !after.resourceId || (!before.nodeId && !before.assetId)) return false;
            const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
            keys.delete('resourceId');
            return [...keys].every(key => JSON.stringify(before[key]) === JSON.stringify(after[key]));
        });
        if (resolved) return;
        const label = call.tool === "canvas.generation.propose" && /^production_seedream_multiple_outputs(?::|$)/.test(call.error || "")
            ? "Whole-film production does not currently support Seedream layer splitting or grouping. Please generate images on the canvas first, and then use existing images to continue creating."
            : call.tool.replace("_", ".") === "media.inspect"
            ? call.args?.mode === "audio" ? "There are audio clips to listen to that are not completed"
                : call.args?.mode === "video" ? "There are video clips that have not been viewed yet"
                    : !call.args?.mode || call.args.mode === "frames" ? "Screen viewing with material is not completed" : `${assistantActionLabel(call.tool)}no success`
            : `${assistantActionLabel(call.tool)}no success`;
        counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return [...counts.entries()].map(([label, count]) => (count > 1 ? `${label}（${count} (at)` : label));
}

/** 技能标签只显示名称和版本；名称不可识别时说明已移除，不显示内部标识。 */
export function assistantSkillLabel(skill: Pick<AssistantSkillSelection, "skillName" | "version">): string {
    const name = skill.skillName?.trim();
    if (!name) return "Skills: Removed skills";
    const version = skill.version?.trim();
    return version ? `Skills:${name} · ${version}` : `Skills:${name}`;
}

export function assistantScriptInterpreterLabel(interpreter: AssistantScriptProposal["interpreter"]): string {
    switch (interpreter) {
        case "python3":
            return "Python 3";
        case "bash":
            return "Bash";
        case "node":
            return "Built-in Node.js";
        default:
            return String(interpreter || "");
    }
}

export function assistantScriptProposalLines(proposal: AssistantScriptProposal, awaitingConfirmation = true): string[] {
    const skillTitle = proposal.version ? `${proposal.skillName}（${proposal.version}）` : proposal.skillName;
    const lines = [
        `Run skill script ·${skillTitle}`,
        `Script path:${proposal.scriptPath}`,
        `How to run:${assistantScriptInterpreterLabel(proposal.interpreter)}`,
        `Startup parameters:${proposal.args?.length ? proposal.args.join(" ") : "None"}`,
    ];
    if (proposal.hasStdin && proposal.stdinPreview) {
        lines.push(`Standard input:${proposal.stdinPreview}`);
    }
    if (proposal.note?.trim()) {
        lines.push(`Description:${proposal.note.trim()}`);
    }
    if (awaitingConfirmation) {
        lines.push(`Run in a separate temporary directory, limited time${proposal.timeoutSec || 120} seconds, installed skill files will not be modified, and your model keys will not be read.`);
    }
    return lines;
}

export function assistantScriptResultStatusText(proposal: AssistantScriptProposal): string {
    const result = proposal.result;
    if (!result) {
        if (proposal.status === "running") return "Running script…";
        if (proposal.status === "cancelled") return "Stopped";
        if (proposal.status === "failed") return "Run failed";
        if (proposal.status === "completed") return "Completed";
        return "To be confirmed";
    }
    const seconds = Math.max(0.1, Math.round((result.durationMs || 0) / 100) / 10);
    if (result.cancelled || proposal.status === "cancelled") return `Stopped running (time consuming${seconds} seconds)`;
    if (result.timedOut) return `Run timeout (limited time${proposal.timeoutSec || 120} seconds)`;
    if (result.exitCode === 0 && proposal.status === "completed") return `Completed (time consuming${seconds} seconds)`;
    return `The run was unsuccessful (exit code${result.exitCode}, time consuming${seconds} seconds)`;
}
