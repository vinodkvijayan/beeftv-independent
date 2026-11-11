import type { AssistantGenerationProposal } from "@/services/api/agent-assistant";
import { ApiError } from "@/services/api/request";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeGenerationOptions } from "./use-canvas-generation-executor";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { ASSISTANT_PROPOSAL_BLOCKED_TEXT, AssistantProposalBlockedError, type ConfirmedGenerationInputs } from "./canvas-assistant-proposal-snapshot";

export const CANVAS_OWNER_CHANGED_PROPOSAL_MESSAGE = "The canvas or account has been switched and the generation has not been submitted. Please reconfirm the proposal.";

type ProposalExecution = {
    proposal: AssistantGenerationProposal;
    nodes: CanvasNodeData[];
    claims: Set<string>;
    isHandled: boolean;
    /** 后端确认这一轮仍有效；返回的文案表示拒绝，不会提交任何生成。 */
    confirmRunnable?: () => Promise<string | null>;
    prepare: () => Promise<ConfirmedGenerationInputs>;
    /** 优先走后端统一生成单确认；返回 null 时回退到页面多输出生成器。 */
    confirmOrder?: (confirmedInputs: ConfirmedGenerationInputs) => Promise<{ taskIds: string[]; continuationId?: string } | null>;
    generate: (nodeId: string, mode: "image" | "video", prompt: string, options?: CanvasNodeGenerationOptions) => Promise<unknown>;
    markHandled: (proposalId: string) => void;
    notify: (content: string) => void;
    stillOwns?: () => boolean;
};

function proposalModelKey(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

/** 兼容性解析可能改选模型，所以每次解析之后都再核对用户确认过的模型。 */
export function buildConfirmedGenerationConfig(
    config: Parameters<typeof buildGenerationConfig>[0],
    node: Parameters<typeof buildGenerationConfig>[1],
    mode: Parameters<typeof buildGenerationConfig>[2],
    requirements: Parameters<typeof buildGenerationConfig>[3],
    confirmedModelKey?: string,
) {
    const result = buildGenerationConfig(config, node, mode, requirements);
    if (confirmedModelKey !== undefined && (!confirmedModelKey.trim() || result.model !== confirmedModelKey)) {
        throw new Error("The current model is inconsistent with the generated proposal. Please ask the assistant to re-propose the generation plan and check the model before confirming.");
    }
    return result;
}

export async function executeAssistantProposal({ proposal, nodes, claims, isHandled, confirmRunnable, prepare, confirmOrder, generate, markHandled, notify, stillOwns }: ProposalExecution) {
    const kind = proposal.kind;
    if (kind === "audio" && !confirmOrder) { notify("Please confirm after adding dubbing to the complete production plan."); return; }
    if (isHandled || claims.has(proposal.proposalId)) {
        notify("This proposal has been submitted or is being submitted. Please check the progress in the task list.");
        return;
    }
    const targets = [...new Set(proposal.nodeIds)].map((id) => nodes.find((node) => node.id === id));
    if (!targets.length || targets.some((node) => !node)) {
        notify("The nodes in the proposal have changed. Please ask the assistant to re-propose the generation plan and then confirm.");
        return;
    }
    const modelKey = proposalModelKey(proposal.modelKey);
    if (!modelKey) {
        notify("This proposal lacks model information. Please ask the assistant to re-propose the generation plan and then confirm it.");
        return;
    }
    // 先占住这次确认，避免连点发出第二单；没有任务回执时在 finally 里放开。
    claims.add(proposal.proposalId);
    let receivedTask = false;
    const started = new Set<string>();
    try {
        const rejection = confirmRunnable ? await confirmRunnable() : null;
        if (rejection) {
            notify(rejection);
            return;
        }
        let confirmedInputs: ConfirmedGenerationInputs;
        try {
            confirmedInputs = await prepare();
        } catch (error) {
            if (stillOwns && !stillOwns()) {
                notify(CANVAS_OWNER_CHANGED_PROPOSAL_MESSAGE);
                return;
            }
            notify(error instanceof AssistantProposalBlockedError ? ASSISTANT_PROPOSAL_BLOCKED_TEXT[error.reason]
                : error instanceof ApiError && error.reason === "continuation_intent_changed" ? "The requirements have been updated, please ask the assistant to propose a new generation plan."
                : "Unable to check the latest content of the proposal, please check your connection and try again.");
            return;
        }
        if (stillOwns && !stillOwns()) {
            notify(CANVAS_OWNER_CHANGED_PROPOSAL_MESSAGE);
            return;
        }
        const confirmedTargets = [...new Set(proposal.nodeIds)].map((id) => confirmedInputs.nodes.find((node) => node.id === id));
        if (confirmedTargets.some((node) => !node)) {
            notify(ASSISTANT_PROPOSAL_BLOCKED_TEXT.canvas_changed);
            return;
        }
        if (confirmOrder) {
            try {
                const orderResult = await confirmOrder(confirmedInputs);
                if (orderResult !== null) {
                    if (stillOwns && !stillOwns()) {
                        notify(CANVAS_OWNER_CHANGED_PROPOSAL_MESSAGE);
                        return;
                    }
                    if (orderResult.taskIds?.length) {
                        receivedTask = true;
                        markHandled(proposal.proposalId);
                    } else {
                        notify("Unconfirmed build task start. Please check the node prompts and task list, and then let the assistant propose a new generation plan.");
                    }
                    return;
                }
            } catch (error) {
                if (stillOwns && !stillOwns()) {
                    notify(CANVAS_OWNER_CHANGED_PROPOSAL_MESSAGE);
                    return;
                }
                notify(error instanceof AssistantProposalBlockedError ? ASSISTANT_PROPOSAL_BLOCKED_TEXT[error.reason]
                    : error instanceof ApiError && error.reason === "continuation_intent_changed" ? "The requirements have been updated, please ask the assistant to propose a new generation plan."
                    : error instanceof ApiError && error.message ? error.message
                    : "It has not yet been confirmed whether the generation has started. Please try again to confirm the same generation order. Accepted materials will not be re-submitted.");
                return;
            }
        }
        if (kind === "audio") {
            notify("Please confirm after adding dubbing to the complete production plan.");
            return;
        }
        await Promise.allSettled(confirmedTargets.map(async (node) => {
            if (!node) return;
            await generate(node.id, kind, node.metadata?.composerContent ?? node.metadata?.prompt ?? "", {
                confirmedModelKey: modelKey,
                confirmedInputs,
                clientOperationId: `proposal:${proposal.proposalId}:${node.id}`,
                onTaskUpdate: (task) => {
                    if (!task.id) return;
                    receivedTask = true;
                    if (task.status !== "queued" && task.status !== "running" && task.status !== "succeeded") return;
                    const first = started.size === 0;
                    started.add(node.id);
                    if (first) markHandled(proposal.proposalId);
                },
            });
        }));
        if (!started.size) {
            notify("Unconfirmed build task start. Please check the node prompts and task list, and then let the assistant propose a new generation plan.");
        } else if (started.size < targets.length) {
            notify(`only${started.size}/${targets.length} Nodes are confirmed to be generated. Please check the prompts and task lists for the remaining nodes and do not resubmit the entire proposal.`);
        }
    } finally {
        if (!receivedTask) claims.delete(proposal.proposalId);
    }
}
