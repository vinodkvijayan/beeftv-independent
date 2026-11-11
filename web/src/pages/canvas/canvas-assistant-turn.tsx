import { App, Button } from "antd";
import copy from "copy-to-clipboard";
import { Crosshair, Undo2 } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ASSISTANT_PROPOSAL_INVALIDATED_TEXT, ASSISTANT_PROPOSAL_UNDONE_TEXT, agentAssistantFailureText, type AgentToolCall, type AssistantGenerationProposal, type AssistantScriptProposal, type AssistantTurn } from "@/services/api/agent-assistant";
import { ASSISTANT_UNDONE_INCOMPLETE_TEXT, assistantChangeSummary, assistantSkillLabel, assistantChangedNodeIds, assistantOrderTargetLines, assistantProductionProposalParts, assistantProposalText, assistantProposalProgress, assistantScriptProposalLines, assistantScriptResultStatusText, assistantTurnCanContinue, assistantUnresolvedFailures, assistantUndoFailureText, assistantVisibleReply } from "./canvas-assistant-copy";
import type { CanvasNodeData } from "@/types/canvas";
import { dismissedProposalKey, type AssistantTurnStatus } from "./use-canvas-assistant";
import { modelOptionName, resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";
import { portraitPriceLines, seedancePortraitModel } from "@/lib/seedance-portrait";
import { portraitGenerationError } from "@/lib/model-selection";
import { CanvasAssistantAttachments } from "./canvas-assistant-attachments";
import { CanvasAssistantOutputs } from "./canvas-assistant-outputs";
import { CanvasAssistantMediaFacts } from "./canvas-assistant-media-facts";
import { AssistantReasoning } from "@/components/ai/message-reasoning";
import { usePluginSlot } from "@/lib/plugins/slot-registry";
import { formatAssistantDiagnostics } from "@/services/diagnostics/assistant-diagnostics";

type Props = {
    canvasId?: string;
    sessionId?: string | null;
    turn: AssistantTurn;
    status?: AssistantTurnStatus;
    handledProposals: Set<string>;
    proposalFeedback?: Record<string, string>;
    /** Proposals whose 生成 click is still being checked or submitted. */
    runningProposalIds?: ReadonlySet<string>;
    generationDisabled?: boolean;
    onLocate: (nodeIds: string[]) => void;
    onUndo: (turnId: string) => void;
    onRunProposal: (proposal: AssistantGenerationProposal, turnId: string) => void;
    onRunScriptProposal?: (proposal: AssistantScriptProposal, turnId: string, alwaysAllowSession: boolean) => void;
    runningScriptProposalIds?: ReadonlySet<string>;
    scriptProposalFeedback?: Record<string, string>;
    onDismissProposal: (proposalId: string) => void;
    onContinue?: () => void;
    nodes?: CanvasNodeData[];
    onCheckResults?: (nodeIds: string[]) => void;
    /** 思考区域是否展开；展开状态由调用方按回合持有，这里只负责显示。 */
    reasoningOpen?: boolean;
    onReasoningOpenChange?: (open: boolean) => void;
};

const replyMarkdownComponents: Components = {
    table: ({ children }) => <div className="canvas-assistant-table-scroll" role="region" aria-label="Reply form" tabIndex={0}>
        <table>{children}</table>
    </div>,
};

/** 助手回复用 Markdown 渲染，只走 react-markdown 的安全默认值，不放开原始 HTML。 */
export function CanvasAssistantReply({ text }: { text: string }) {
    const visible = assistantVisibleReply(text);
    if (!visible) return null;
    return (
        <div className="canvas-assistant-reply">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={replyMarkdownComponents}>{visible}</ReactMarkdown>
        </div>
    );
}

export function CanvasAssistantUserMessage({ text, selectedCount, continuationId }: { text: string; selectedCount: number; continuationId?: string | null }) {
    if (!text && !selectedCount) return null;
    const automatic = Boolean(continuationId);
    return (
        <div className="canvas-assistant-user">
            {automatic ? <span className="canvas-assistant-chip">Automatically continue</span> : null}
            <span style={{ whiteSpace: "pre-wrap" }}>{automatic ? "The generation has ended, continue checking the results and production." : text}</span>
            {selectedCount > 0 ? <span className="canvas-assistant-meta">{automatic ? `associated with this generated${selectedCount} nodes` : `Brought selected${selectedCount} nodes`}</span> : null}
        </div>
    );
}

export function CanvasAssistantTurnView({ turn, canvasId, sessionId, status, handledProposals, proposalFeedback, runningProposalIds, generationDisabled, onLocate, onUndo, onRunProposal, onRunScriptProposal, runningScriptProposalIds, scriptProposalFeedback, onDismissProposal, onContinue, nodes, onCheckResults, reasoningOpen, onReasoningOpenChange }: Props) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const toolCardEntries = usePluginSlot("assistant.toolCard");
    const summary = assistantChangeSummary(turn.change);
    const changedNodeIds = assistantChangedNodeIds(turn.change);
    const changedCanvasCount = new Set(turn.change?.canvasChanges?.map(item => item.canvasId) || []).size;
    const failedActions = assistantUnresolvedFailures(turn.toolCalls);
    const undone = Boolean(status?.undone);
    const canContinue = Boolean(turn.error && assistantTurnCanContinue(turn.errorReason));
    // 停下前已经改了画布：保留改动，可在输入框确认后接着做；不自动重发。
    const stoppedWithChanges = Boolean(turn.cancelled && !turn.error && summary && !undone);
    const copyDiagnostics = async () => {
        try {
            const text = formatAssistantDiagnostics(turn, { canvasId, assistantSessionId: sessionId || undefined });
            if (await copy(text)) message.success("Troubleshooting information copied"); else message.error("Copy failed, please export the diagnostic package");
        } catch { message.error("Copy failed, please export the diagnostic package"); }
    };

    return (
        <div className="canvas-assistant-turn">
            <CanvasAssistantUserMessage text={turn.userText} selectedCount={turn.selectedNodeIds?.length ?? 0} continuationId={turn.continuationId} />
            <CanvasAssistantAttachments attachments={turn.attachments || []} />
            {(turn.skills || []).map(skill => <span className="canvas-assistant-chip" key={skill.skillId}>{assistantSkillLabel(skill)}</span>)}
            {/* 思考过程默认折叠，与下面的正文分开；工具活动和改动卡片仍在正文之后。 */}
            <AssistantReasoning segments={turn.reasoning || []} open={Boolean(reasoningOpen)} onOpenChange={(open) => onReasoningOpenChange?.(open)} />
            {turn.reply ? <CanvasAssistantReply text={turn.reply} /> : null}
            {turn.supplementInputs?.length ? turn.supplementInputs.map((input, index) => <div key={`supplement:${index}`} className="canvas-assistant-supplement">
                <CanvasAssistantUserMessage text={input.message} selectedCount={0} /><CanvasAssistantAttachments attachments={input.attachments || []} />
                {(input.skills || []).map(skill => <span className="canvas-assistant-chip" key={skill.skillId}>{assistantSkillLabel(skill)}</span>)}
            </div>) : (turn.supplements || []).map((text, index) => <div key={`supplement:${index}`} className="canvas-assistant-supplement"><CanvasAssistantUserMessage text={text} selectedCount={0} /></div>)}
            <CanvasAssistantMediaFacts calls={turn.toolCalls || []} nodes={nodes} />
            {(turn.toolCalls || []).map((call: AgentToolCall, idx: number) => {
                const match = toolCardEntries.find((entry) => entry.payload.toolName === call.tool);
                if (!match) return null;
                const CardComp = match.payload.component as React.ComponentType<Record<string, unknown>>;
                return (
                    <div key={`${call.toolCallId || call.tool}:${idx}`} className="canvas-assistant-card">
                        <CardComp
                            toolName={call.tool}
                            status={call.isError ? "failed" : "completed"}
                            input={call.args}
                            args={call.args}
                            output={call.mediaFacts}
                            result={call.mediaFacts ?? call.error}
                            error={call.error}
                        />
                    </div>
                );
            })}
            {turn.outputs?.length ? <CanvasAssistantOutputs outputs={turn.outputs} /> : null}
            {turn.cancelled && stoppedWithChanges ? (
                <div className="canvas-assistant-incomplete" role="status">
                    <strong>This one has been stopped</strong>
                    <span>Changes made before stopping remain on the canvas.</span>
                    {onContinue ? <>
                        <Button size="small" onClick={onContinue}>Continue processing</Button>
                        <span className="canvas-assistant-meta">Send after confirming or adding requirements in the input box.</span>
                    </> : null}
                </div>
            ) : turn.cancelled ? <p className="canvas-assistant-meta">This one has been stopped.</p> : null}
            {turn.error ? (
                <div className={canContinue ? "canvas-assistant-incomplete" : "canvas-assistant-feedback"} role="status">
                    <strong>{canContinue ? "Not yet completed" : "This step is not completed"}</strong>
                    <span className={canContinue ? undefined : "canvas-assistant-failed"}>{undone ? ASSISTANT_UNDONE_INCOMPLETE_TEXT : agentAssistantFailureText(turn.errorReason ?? undefined, "Not all of this round has been completed, please check the changes that have been implemented.")}</span>
                    {canContinue && onContinue && !undone ? <>
                        <Button size="small" onClick={onContinue}>Continue processing</Button>
                        <span className="canvas-assistant-meta">Send after confirming or adding requirements in the input box.</span>
                    </> : null}
                </div>
            ) : null}
            {turn.error || turn.cancelled ? <Button size="small" onClick={() => void copyDiagnostics()}>Copy troubleshooting information</Button> : null}

            {failedActions.length > 0 ? (
                <div className="canvas-assistant-feedback" role="status">
                    {failedActions.map((text) => (
                        <span key={text} className="canvas-assistant-failed">
                            {text}
                        </span>
                    ))}
                </div>
            ) : null}

            {summary ? (
                <div className="canvas-assistant-change">
                    <strong>{summary}</strong>
                    {undone ? (
                        <span className="canvas-assistant-meta">{changedCanvasCount > 1 ? "All canvas changes in this round have been undone" : "Revoked"}</span>
                    ) : (
                        <>
                            {changedCanvasCount > 1 ? <span className="canvas-assistant-meta">Undo will restore this{changedCanvasCount}  All changes to this canvas this round.</span> : null}
                            <div className="canvas-assistant-card-actions">
                                {changedNodeIds.length > 0 ? (
                                    <Button type="text" size="small" icon={<Crosshair className="size-3.5" />} onClick={() => onLocate(changedNodeIds)}>
                                                                                View on canvas
                                    </Button>
                                ) : null}
                                <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} loading={status?.undoing} onClick={() => onUndo(turn.turnId)}>
                                                                        Undo this round
                                </Button>
                            </div>
                            {status?.undoFailure ? <span className="canvas-assistant-meta">{changedCanvasCount > 1 && status.undoFailure === "canvas_changed" ? "One of the canvases was later changed and this round was not undone." : assistantUndoFailureText(status.undoFailure)}</span> : null}
                        </>
                    )}
                </div>
            ) : null}

            {(turn.proposals || []).map((proposal) => {
                const prefix = `proposal:${proposal.proposalId}:`;
                const admittedOnCanvas = Boolean(nodes?.some((node) => (node.metadata?.taskClientOperationId || "").startsWith(prefix)));
                const started = handledProposals.has(proposal.proposalId) || admittedOnCanvas;
                const skipped = handledProposals.has(dismissedProposalKey(proposal.proposalId));
                const selectedModel = proposal.modelKey || proposal.model;
                const videoModels = proposal.production
                    ? proposal.production.targets.filter((target) => target.kind === "video").map((target) => target.modelKey)
                    : [selectedModel];
                const profile = proposal.kind === "video" ? resolveModelChannel(config, selectedModel).modelProfiles?.find((item) => item.model === modelOptionName(selectedModel)) : undefined;
                const priceError = videoModels.filter((model) => seedancePortraitModel(model)).map((model) => portraitGenerationError(config, model)).find(Boolean) || "";
                const running = Boolean(runningProposalIds?.has(proposal.proposalId));
                const progress = started && nodes ? assistantProposalProgress(proposal, nodes) : null;
                const awaitingConfirmation = !started && !skipped && !undone && !turn.proposalsInvalidated;
                const productionParts = assistantProductionProposalParts(proposal, awaitingConfirmation);
                const orderTargetLines = assistantOrderTargetLines(proposal, awaitingConfirmation);
                const legacyProposalNote = !assistantVisibleReply(turn.reply || "") && proposal.note?.trim() ? proposal.note.trim() : "";
                return (
                    <div key={proposal.proposalId} className="canvas-assistant-card">
                        {legacyProposalNote ? (
                            <div className="canvas-assistant-proposal-note">
                                {legacyProposalNote.split("\n").map((part, partIndex) => <div key={partIndex} className={part.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{part}</div>)}
                            </div>
                        ) : null}
                        {productionParts ? (
                            <>
                                <div className="canvas-assistant-proposal-lines">
                                    {productionParts.header.split("\n").map((part, partIndex) => <div key={partIndex} className={part.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{part}</div>)}
                                </div>
                                {productionParts.targetLines.length > 0 ? (
                                    <details className="canvas-assistant-proposal-details">
                                        <summary>View{productionParts.targetLines.length}  Item shots and prompt word details</summary>
                                        <div className="canvas-assistant-proposal-targets">
                                            {productionParts.targetLines.map((line, index) => (
                                                <div key={proposal.production?.targets[index]?.nodeId || index} className="canvas-assistant-proposal-target">
                                                    {line.split("\n").map((part, partIndex) => <div key={partIndex} className={part.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{part}</div>)}
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                ) : null}
                                {productionParts.footer ? (
                                    <div className="canvas-assistant-meta canvas-assistant-proposal-lines">
                                        {productionParts.footer.split("\n").map((part, partIndex) => <div key={partIndex} className={part.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{part}</div>)}
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <>
                                <div className="canvas-assistant-proposal-lines">
                                    {assistantProposalText(proposal, portraitPriceLines(profile?.videoPricing), awaitingConfirmation).split("\n").map((part, partIndex) => <div key={partIndex} className={part.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{part}</div>)}
                                </div>
                                {orderTargetLines.length > 0 ? (
                                    <details className="canvas-assistant-proposal-details">
                                        <summary>View{orderTargetLines.length}  Item creation order details</summary>
                                        <div className="canvas-assistant-proposal-targets">
                                            {orderTargetLines.map((line, index) => (
                                                <div key={proposal.targets?.[index]?.nodeId || index} className="canvas-assistant-proposal-target">
                                                    {line.split("\n").map((part, partIndex) => <div key={partIndex} className={part.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{part}</div>)}
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                ) : null}
                            </>
                        )}
                        {priceError && awaitingConfirmation ? <span className="canvas-assistant-meta" role="status">{priceError}</span> : null}
                        {!skipped && !running && ((!undone && !turn.proposalsInvalidated) || started) && proposalFeedback?.[proposal.proposalId] ? <span className="canvas-assistant-meta" role="status" style={{ overflowWrap: "anywhere" }}>{proposalFeedback[proposal.proposalId]}</span> : null}
                        {started ? (
                            <>
                                <span className="canvas-assistant-meta" role="status">{progress?.text || "Started generating"}</span>
                                {progress && onCheckResults && !undone && !proposal.production ? <div className="canvas-assistant-card-actions">
                                    <Button size="small" disabled={running || !progress.ready} onClick={() => onCheckResults(progress.nodeIds)}>Check results</Button>
                                    <span className="canvas-assistant-meta">After filling in the inspection requirements, it will be sent by you.</span>
                                </div> : null}
                            </>
                        ) : undone ? (
                            <span className="canvas-assistant-meta">{ASSISTANT_PROPOSAL_UNDONE_TEXT}</span>
                        ) : skipped ? (
                            <span className="canvas-assistant-meta">Not generated this time</span>
                        ) : turn.proposalsInvalidated ? (
                            <span className="canvas-assistant-meta" role="status">{ASSISTANT_PROPOSAL_INVALIDATED_TEXT}</span>
                        ) : (
                            <div className="canvas-assistant-card-actions">
                                <Button size="small" type="primary" autoInsertSpace={false} loading={running} disabled={generationDisabled || Boolean(priceError)} onClick={() => onRunProposal(proposal, turn.turnId)}>
                                    {proposal.production ? "Confirm and make the entire film" : "generate"}
                                </Button>
                                <Button size="small" disabled={running} onClick={() => onDismissProposal(proposal.proposalId)}>
                                                                        No need for now
                                </Button>
                            </div>
                        )}
                    </div>
                );
            })}

            {(turn.scriptProposals || []).map((proposal) => {
                const running = Boolean(runningScriptProposalIds?.has(proposal.proposalId)) || proposal.status === "running";
                const finished = proposal.status === "completed" || proposal.status === "failed" || proposal.status === "cancelled" || Boolean(proposal.result);
                const skipped = handledProposals.has(dismissedProposalKey(proposal.proposalId)) || proposal.status === "skipped";
                const awaitingConfirmation = !finished && !running && !skipped && !undone && !turn.proposalsInvalidated;
                const lines = assistantScriptProposalLines(proposal, awaitingConfirmation);
                const feedback = scriptProposalFeedback?.[proposal.proposalId] || proposalFeedback?.[proposal.proposalId];
                const hasOutput = Boolean(proposal.result && (proposal.result.stdout || proposal.result.stderr));
                return (
                    <div key={proposal.proposalId} className="canvas-assistant-card">
                        <div className="canvas-assistant-proposal-lines">
                            {lines.map((line, index) => (
                                <div key={index} className={line.length > 80 ? "canvas-assistant-pretty-line" : undefined}>{line}</div>
                            ))}
                        </div>
                        {feedback ? <span className="canvas-assistant-meta" role="status" style={{ overflowWrap: "anywhere" }}>{feedback}</span> : null}
                        {finished ? (
                            <>
                                <span className="canvas-assistant-meta" role="status">{assistantScriptResultStatusText(proposal)}</span>
                                {hasOutput ? (
                                    <details className="canvas-assistant-proposal-details">
                                        <summary>View script output</summary>
                                        <div className="canvas-assistant-proposal-targets">
                                            {proposal.result?.stdout ? (
                                                <div className="canvas-assistant-proposal-target">
                                                    <div className="canvas-assistant-meta">Standard output:</div>
                                                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{proposal.result.stdout}</pre>
                                                </div>
                                            ) : null}
                                            {proposal.result?.stderr ? (
                                                <div className="canvas-assistant-proposal-target">
                                                    <div className="canvas-assistant-meta">Error output:</div>
                                                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{proposal.result.stderr}</pre>
                                                </div>
                                            ) : null}
                                        </div>
                                    </details>
                                ) : null}
                            </>
                        ) : running ? (
                            <span className="canvas-assistant-meta" role="status">Running script…</span>
                        ) : undone ? (
                            <span className="canvas-assistant-meta">This round has been revoked and the script will not be run.</span>
                        ) : skipped ? (
                            <span className="canvas-assistant-meta">No script is run this time</span>
                        ) : turn.proposalsInvalidated ? (
                            <span className="canvas-assistant-meta" role="status">It has expired. Please ask the assistant to make a request to run the script again.</span>
                        ) : (
                            <div className="canvas-assistant-card-actions">
                                <Button size="small" type="primary" autoInsertSpace={false} loading={running} disabled={generationDisabled} onClick={() => onRunScriptProposal?.(proposal, turn.turnId, false)}>
                                                                        run script
                                </Button>
                                <Button size="small" disabled={generationDisabled || running} onClick={() => onRunScriptProposal?.(proposal, turn.turnId, true)}>
                                                                        This conversation is always allowed
                                </Button>
                                <Button size="small" disabled={running} onClick={() => onDismissProposal(proposal.proposalId)}>
                                                                        No need for now
                                </Button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
