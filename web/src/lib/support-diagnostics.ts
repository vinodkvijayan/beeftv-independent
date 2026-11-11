export type SupportDiagnosticContext = {
    traceId?: string;
    clientOperationId?: string;
    canvasId?: string;
    nodeId?: string;
    assistantSessionId?: string;
    assistantTurnId?: string;
};

export function supportDiagnosticIdentity(context: SupportDiagnosticContext, options: { appVersion?: string; buildCommit?: string; capturedAt?: string; kind?: "generation" | "assistant" } = {}) {
    const safe = (value?: string) => value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && !/^(?:sk-|eyJ)|bearer|password|secret/i.test(value) ? value : undefined;
    const traceId = context.traceId && /^[a-f0-9]{32}$/i.test(context.traceId) && !/^0+$/.test(context.traceId) ? context.traceId : undefined;
    const fields = options.kind === "assistant" ? [["Trace ID", traceId], ["Canvas ID", context.canvasId], ["Assistant session ID", context.assistantSessionId], ["Assistant round ID", context.assistantTurnId]] : [["Trace ID", traceId], ["Operation ID", context.clientOperationId], ["Canvas ID", context.canvasId], ["Node ID", context.nodeId]];
    const missing = fields.filter(([, value]) => !safe(value)).map(([label]) => label);
    return [
        `Application version:${safe(options.appVersion) || "Not recorded"}`,
        `Build commit:${safe(options.buildCommit) || "Not recorded"}`,
        `Troubleshooting information generation time:${options.capturedAt && Number.isFinite(Date.parse(options.capturedAt)) ? new Date(options.capturedAt).toISOString() : new Date().toISOString()}`,
        ...fields.flatMap(([label, value]) => safe(value) ? [`${label}：${safe(value)}`] : []),
        missing.length ? `Related evidence not recorded:${missing.join("、")}. Diagnostic package supplements covering the fault time can be exported; historical records that have not been collected cannot be supplemented.` : "",
    ].filter(Boolean);
}
