import type { AssistantTurn } from "@/services/api/agent-assistant";
import { supportDiagnosticIdentity, type SupportDiagnosticContext } from "@/lib/support-diagnostics";
import { recordDiagnosticEvent } from "./client-diagnostics";

export function recordAssistantInterruption(turn: AssistantTurn, context: SupportDiagnosticContext) {
    if (turn.errorReason !== "turn_interrupted") return;
    recordDiagnosticEvent({ ...context, assistantTurnId: turn.turnId, category: "task", level: "warning", code: "turn_interrupted", reason: "turn_interrupted", message: "The assistant history confirms that this round of execution has been interrupted and is waiting for the user to continue processing." });
}

/** Model text, tool arguments and raw errors never become copied support evidence. */
export function formatAssistantDiagnostics(turn: AssistantTurn, context: SupportDiagnosticContext) {
    return [
        "Troubleshooting information version: 3",
        ...supportDiagnosticIdentity({ ...context, assistantTurnId: turn.turnId }, { kind: "assistant", appVersion: import.meta.env.VITE_APP_VERSION, buildCommit: import.meta.env.VITE_BUILD_COMMIT }),
        `Assistant status:${turn.cancelled ? "Stopped" : "Not completed"}`,
        `Reason code:${turn.errorReason && /^[a-z][a-z0-9_]{0,95}$/.test(turn.errorReason) ? turn.errorReason : "Not recorded"}`,
        `Round creation time:${Number.isFinite(Date.parse(turn.createdAt)) ? new Date(turn.createdAt).toISOString() : "Not recorded"}`,
        `Number of tool calls:${turn.toolCalls?.length || 0};Number of failures:${turn.toolCalls?.filter(call => call.isError).length || 0}`,
        "Please check the existing changes and generation results before continuing to process to avoid repeated generation.",
    ].join("\n");
}
