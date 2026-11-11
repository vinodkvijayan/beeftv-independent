import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { CanvasAssistantSidebar } from "@/pages/canvas/canvas-assistant-sidebar";
import type { CanvasAssistantController } from "@/pages/canvas/use-canvas-assistant";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { AgentHostStatus, AssistantReasoningSegment, AssistantTurn } from "@/services/api/agent-assistant";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";

/**
 * DEV 实验室：只为验收助手停靠栏的视觉与状态分支。
 *
 * 不连后端、不调模型：所有数据都是本页写死的样例，用查询参数切换场景
 * （?state=ready|unavailable|starting|no-model|streaming|thinking|interrupted&narrow=1&dark=1&readonly=1）。生产构建不含此路由。
 */
const REFERENCES: CanvasResourceReference[] = [
    { id: "n1", nodeId: "n1", kind: "text", label: "Shot 1", title: "Shot 1-Opening", active: true, sourceType: CanvasNodeType.Text, mentionToken: "@[node:n1]" },
    { id: "n2", nodeId: "n2", kind: "image", label: "Shot 2", title: "Shot 2 - Conflict", active: true, sourceType: CanvasNodeType.Image, mentionToken: "@[node:n2]" },
];

const TURNS: AssistantTurn[] = [
    {
        turnId: "turn-1",
        userText: "Split the script into three shots and connect them in order",
        selectedNodeIds: ["n1", "n2"],
        reply: "It has been split into three shots according to the opening, conflict, and ending, and connected in this order.\n\n- **Shot 1 Opening**: At the entrance of the alley on a rainy night, the distant view suppresses emotions\n- **Shot 2 Conflict**: Close-up confrontation, the light only hits half of the face\n- **Shot 3 Ending**: Leaving the scene in mid-shot, leaving an unfinished line",
        toolCalls: [
            { toolCallId: "t1", tool: "canvas.nodes.create" },
            { toolCallId: "t2", tool: "canvas.edge.create" },
            { toolCallId: "t3", tool: "canvas.node.update", isError: true, error: "conflict" },
        ],
        reasoning: [
            { id: "12:0", text: "First confirm the plot points to be covered by the three shots: opening, conflict, and ending.\nThe user has given two reference pictures, and you can directly use their composition and lighting.", status: "done" },
            { id: "12:1", text: "The connection sequence is arranged according to the timeline, and no redundant nodes are added.", status: "done" },
        ],
        change: { revisionBefore: 12, revisionAfter: 13, createdNodeIds: ["n3", "n4", "n5"], updatedNodeIds: [], createdEdgeIds: ["e1", "e2"] },
        proposals: [{ proposalId: "p1", kind: "image", nodeIds: ["n3", "n4", "n5"], model: "seedream-4", modelKey: "beeftv::seedream-4" }],
        error: null,
        cancelled: false,
        createdAt: new Date("2026-09-29T10:00:00Z").toISOString(),
    },
];

/** 正在生成的那一轮的思考片段：只在 ?state=thinking 下挂到面板上。 */
const LIVE_REASONING: AssistantReasoningSegment[] = [
    { id: "live-1:0", text: "First confirm the duration and audio channel of this reference video, and then locate the black screen in the middle.", status: "streaming" },
];

function stubController(open: boolean, setOpen: (next: boolean) => void, width: number, setWidth: (next: number) => void, status: AgentHostStatus | null): CanvasAssistantController {
    const noop = () => {};
    const asyncNoop = async () => {};
    return {
        plan: null,
        canvasId: "lab",
        open,
        setOpen,
        width,
        setWidth,
        status,
        statusBusy: false,
        modelBusy: false,
        sessions: [
            { sessionId: "s1", title: "Split the script into three shots and connect them in order", updatedAt: new Date().toISOString(), turnCount: 1 },
            { sessionId: "s2", title: "Check which lenses are missing reference images", updatedAt: new Date().toISOString(), turnCount: 3 },
        ],
        sessionId: "s1",
        turns: status?.available ? TURNS : [],
        historyLoaded: true,
        historyError: null,
        sessionBusy: false,
        reloadHistory: async () => true,
        pendingUserText: null,
        pendingContinuationId: null,
        pendingSelectedNodeIds: [],
        pendingAttachments: [],
        pendingSkills: [],
        permissionMode: "canvas",
        permissionLocked: false,
        setPermissionMode: noop,
        streamed: "",
        reasoning: [],
        reasoningOpen: {},
        setReasoningOpen: noop,
        streaming: false,
        awaitingReceipt: false,
        supplements: [],
        supplementBusy: false,
        canSupplement: false,
		lifecycleNotice: null,
        error: null,
        canRetry: false,
        turnStatus: {},
        handledProposals: new Set<string>(),
        markProposalHandled: noop,
        markProposalDismissed: noop,
        runScriptProposal: asyncNoop,
        runningScriptProposalIds: new Set<string>(),
        scriptProposalFeedback: {},
        send: asyncNoop,
        stop: asyncNoop,
        retryLast: noop,
        dismissError: noop,
        startNewSession: asyncNoop,
        activateSession: asyncNoop,
        deleteSession: async () => true,
        handleDeleteSession: async () => true,
        undoTurn: asyncNoop,
        restartHost: asyncNoop,
    };
}

export default function AssistantPanelLab() {
    const [params] = useSearchParams();
    const state = params.get("state") || "ready";
    const narrow = params.get("narrow") === "1";
    const dark = params.get("dark") === "1";
    const [open, setOpen] = useState(true);
    const [width, setWidth] = useState(380);
    const [reasoningOpen, setReasoningOpenState] = useState<Record<string, boolean>>({});

    // CSS 变量和 antd 主题必须同时切：只切一边会让按钮文字和底色撞在一起。
    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        useThemeStore.getState().setTheme(dark ? "dark" : "light");
    }, [dark]);

    const status: AgentHostStatus | null =
        state === "unavailable"
            ? { available: false, reason: "credential_missing" }
            : state === "starting"
              ? { available: false, reason: "host_starting" }
              : state === "no-model"
                ? { available: false, reason: "model_not_configured" }
                : { available: true, model: { id: "deepseek-v3", channelId: "beeftv", channelName: "BeefTV" } };

    const assistant = stubController(open, setOpen, width, setWidth, status);
    // 实验室里让思考抽屉真的能点开，才能验收展开后的样子。
    assistant.reasoningOpen = reasoningOpen;
    assistant.setReasoningOpen = (key, next) => setReasoningOpenState((current) => ({ ...current, [key]: next }));
    if (state === "thinking") {
        assistant.streaming = true;
        assistant.canSupplement = true;
        assistant.pendingUserText = "Check the sound of the reference video, remove the black screen in the middle, and keep the coffee and cake ending";
        assistant.reasoning = LIVE_REASONING;
        assistant.lifecycleNotice = "Checking media";
    }
    if (state === "interrupted") {
        assistant.turns = [{ ...TURNS[0], proposals: [], error: "The waiting limit has been reached this round", errorReason: "turn_timeout", change: { ...TURNS[0].change!, timelineUpdated: true } }];
    }
    if (state === "streaming") {
        assistant.streaming = true;
        assistant.canSupplement = true;
        assistant.pendingUserText = "Check the sound of the reference video, remove the black screen in the middle, and keep the coffee and cake ending";
        assistant.streamed = "The black screen in the middle has been found and the sound is being checked.";
        assistant.supplements = [{ text: "Don’t delete the two-second pause at the end of the film", status: "accepted" }];
        assistant.lifecycleNotice = "Checking media";
    }

    return (
        <div className="flex h-screen min-h-0" style={{ background: "var(--background)", color: "var(--foreground)" }}>
            <div className="flex min-w-0 flex-1 items-center justify-center" style={{ background: "var(--muted)" }}>
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Canvas area (lab space)</p>
            </div>
            <CanvasAssistantSidebar
                assistant={assistant}
                canvasTitle="Rainy night alley"
                dockable={!narrow}
                readOnly={params.get("readonly") === "1"}
                selectedNodeIds={["n1", "n2"]}
                references={REFERENCES}
                onLocateNodes={() => {}}
                onRunProposal={() => {}}
                onOpenModelSettings={() => {}}
            />
        </div>
    );
}
