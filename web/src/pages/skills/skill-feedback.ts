export function skillFailureMessage(error: unknown, operation: string, nextStep: string) {
    const reason = error instanceof Error ? error.message.trim().replace(/[。；;]+$/, "") : "";
    return `${operation}：${reason || "No specific reason returned"}。${nextStep}`;
}
