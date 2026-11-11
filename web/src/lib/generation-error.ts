import { isLocalRuntimeMode } from "@/lib/runtime-mode";
import { LocalImageUnavailableError } from "@/lib/local-image-unavailable";
import {
    allowlistedString,
    CATEGORY_COPY,
    categoryFromHttpStatus,
    categoryFromProviderCode,
    categoryFromProviderMessage,
    containsInfrastructureDetails,
    CONTENT_MODERATION_ERROR_CODE,
    CONTENT_MODERATION_MESSAGE,
    debugIdLine,
    DEFAULT_GENERATION_ERROR_MESSAGE,
    EMBEDDED_REQUEST_ID,
    emptyFields,
    explanationCopy,
    extractExplicitHttpStatus,
    extractProviderFields,
    GENERATION_ERROR_CATEGORIES,
    HTML_BODY,
    isActionableParameterCopy,
    isCancelledText,
    isCanvasSaveConflictText,
    isDownloadText,
    isMalformedText,
    isModerationCategory,
    isNetworkText,
    isResultsMissingText,
    joinSentences,
    LOCAL_DATABASE_ERROR,
    LOCAL_TASK_ADMISSION_FAILURE,
    moderationCategoryFromMessage,
    normalizeCode,
    numericStatus,
    providerPayloadMessage,
    referenceAudioCopy,
    referenceDurationCopy,
    referenceMediaConstraintCopy,
    retryableCategory,
    sanitizeDebugId,
    sanitizeProviderCode,
    sanitizeProviderText,
    stringifyAllowlisted,
    trustProviderMessageStatus,
    userFacingChineseCopy,
    type CategoryCopy,
    type Classified,
    type ExtractedFields,
    type GenerationErrorCategory,
} from "./generation-error-classifiers";
import { moderationErrorCopy } from "./moderation-error";
import { supportDiagnosticIdentity, type SupportDiagnosticContext } from "./support-diagnostics";

export {
    CONTENT_MODERATION_ERROR_CODE,
    CONTENT_MODERATION_MESSAGE,
    GENERATION_ERROR_CATEGORIES,
    type GenerationErrorCategory,
};

export type GenerationFailureExplanation = {
    httpStatus?: number;
    summary?: string;
    category: GenerationErrorCategory;
    reason: string;
    action: string;
    message: string;
    errorCode: string;
    providerCode?: string;
    requestId?: string;
    taskId?: string;
    retryable: boolean;
    uncertain: boolean;
    blockAutomaticRetry: boolean;
    blockManualRetry: boolean;
    moderation: boolean;
};

export type GenerationFailureMetadata = {
    generationErrorSummary?: string;
    errorDetails: string;
    generationErrorCode?: string;
    generationProviderCode?: string;
    taskFailureDiagnostics?: GenerationFailureDiagnostics;
    failedPromptFingerprint?: string;
    failedInputFingerprint?: string;
};

export type GenerationFailureContext = SupportDiagnosticContext & {
    errorSummary?: string;
    providerCode?: string;
    failureDiagnostics?: GenerationFailureDiagnostics;
    completedAt?: string;
    updatedAt?: string;
    taskId?: string;
    providerRequestId?: string;
    model?: string;
    createdAt?: string;
    stage?: string;
};

export type GenerationFailureDiagnostics = {
    source: "local_validation" | "local_network" | "upstream_http" | "upstream_response" | "local_result" | "local_response" | "reference_upload" | "client_result" | "unknown";
    version?: string;
    platform?: string;
    executionResult?: string;
    omittedRequests?: number;
    requests?: { operation: string; method: string; dispatched: boolean; transportPhase?: string; transportRoute?: string; outcome: string; httpStatus?: number; requestId?: string; providerCode?: string; summary?: string; startedAt: string; durationMs: number; requestBytes?: number; receivedBytes?: number; declaredResponseBytes?: number; responseLimitBytes?: number }[];
    input?: { protocol?: string; model?: string; size?: string; quality?: string; count?: string; promptChars: number; imageCount: number; videoCount: number; audioCount: number; images?: { bytes: number; width: number; height: number }[]; imageLimitsRecorded?: boolean; maxImages?: number; maxImageBytes?: number };
    summary?: string;
    providerCode?: string;
    httpStatus?: number;
    requestId?: string;
    providerTaskId?: string;
    param?: string;
    stage?: string;
    capturedAt?: string;
};

const normalizedFailures = new WeakMap<Error, GenerationFailureExplanation>();

export function preserveGenerationFailure(error: Error, explanation: GenerationFailureExplanation) {
    normalizedFailures.set(error, explanation);
}

export function explainGenerationError(error: unknown, context: GenerationFailureContext = {}): GenerationFailureExplanation {
    const saved = error instanceof Error ? normalizedFailures.get(error) : undefined;
    if (saved) {
        const taskId = saved.taskId || context.taskId;
        const requestId = saved.requestId || context.providerRequestId;
        return { ...saved, taskId, requestId, message: joinSentences(saved.reason, saved.action, debugIdLine(taskId, requestId)) || DEFAULT_GENERATION_ERROR_MESSAGE };
    }
    const classified = classifyUnknown(error, context);
    const copy = explanationCopy(classified);
    const message = joinSentences(copy.reason, copy.action, debugIdLine(classified.taskId || context.taskId, classified.requestId || context.providerRequestId));
    const moderation = isModerationCategory(classified.category);
    const uncertain = classified.uncertain || classified.category === "submission_uncertain" || classified.category === "download_failed" || (classified.category === "timeout" && classified.status === 524);
    const preparation = confirmedReferencePreparation(classified);
    const blockAutomaticRetry = uncertain || moderation || preparation || Object.hasOwn(REFERENCE_PREPARATION_COPY, classified.providerCode || "") || !["throttled", "concurrency", "provider_unavailable", "cancelled", "request_not_sent"].includes(classified.category);
    const rawSummary = providerPayloadMessage(error instanceof Error ? error.message : error);
    const sanitizedSummary = sanitizeProviderText(rawSummary);
    return {
        category: classified.category,
        httpStatus: classified.status,
        summary: ["local_storage", "local_disk_full"].includes(classified.category) || Boolean(resourceStorageFailureMessage(rawSummary)) ? copy.reason : sanitizedSummary.includes("[hidden]") || sanitizedSummary.includes("[path hidden]") || /[{}]/.test(sanitizedSummary) || /(?<![A-Za-z0-9._-])\/+(?!v\d+\/)[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/.test(sanitizedSummary) ? "" : sanitizedSummary,
        reason: copy.reason,
        action: copy.action,
        message: message || DEFAULT_GENERATION_ERROR_MESSAGE,
        errorCode: classified.category,
        providerCode: classified.providerCode || undefined,
        requestId: sanitizeDebugId(classified.requestId || (error && typeof error === "object" && "requestId" in error && typeof error.requestId === "string" ? error.requestId : "") || context.providerRequestId) || undefined,
        taskId: sanitizeDebugId(classified.taskId || context.taskId) || undefined,
        retryable: Boolean(classified.retryable) && !uncertain && !moderation && !preparation,
        uncertain,
        blockAutomaticRetry,
        blockManualRetry: blockAutomaticRetry && !preparation,
        moderation,
    };
}

export function generationErrorMessage(error: unknown) {
    if (error instanceof LocalImageUnavailableError) return error.message;
    return explainGenerationError(error).message;
}

export function generationErrorCode(error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" && isGenerationErrorCode(code)) return code;
    }
    const explained = explainGenerationError(error);
    return explained.category === "unknown" ? undefined : explained.errorCode;
}

export function generationFailureMetadata(error: unknown, prompt: string, references: Array<string | { id?: string; storageKey?: string; url?: string }> = []): GenerationFailureMetadata {
    const explained = explainGenerationError(error);
    const inputFingerprint = generationInputFingerprint(prompt, references);
    const taskFailureDiagnostics =
        error && typeof error === "object" && "failureDiagnostics" in error && error.failureDiagnostics && typeof error.failureDiagnostics === "object"
            ? (error.failureDiagnostics as GenerationFailureDiagnostics)
            : undefined;
    if (!explained.moderation) {
        return {
            errorDetails: explained.message,
            generationErrorSummary: explained.summary,
            generationErrorCode: explained.category === "unknown" ? undefined : explained.errorCode,
            generationProviderCode: explained.providerCode,
            taskFailureDiagnostics,
        };
    }
    return {
        errorDetails: explained.message,
        generationErrorSummary: undefined,
        generationErrorCode: explained.errorCode,
        generationProviderCode: explained.providerCode,
        taskFailureDiagnostics,
        failedPromptFingerprint: generationPromptFingerprint(prompt),
        failedInputFingerprint: inputFingerprint,
    };
}

export function isContentModerationError(value: unknown) {
    if (!value) return false;
    if (typeof value === "object" && value) {
        const record = value as { code?: unknown; category?: unknown };
        if (typeof record.code === "string" && record.code.trim()) {
            const code = record.code.trim();
            if (isModerationCategory(code)) return true;
            if (BACKEND_FAILURE_CATEGORIES.has(code)) return false;
        }
        if (typeof record.category === "string" && record.category.trim()) {
            const category = record.category.trim();
            if (isModerationCategory(category)) return true;
            if (BACKEND_FAILURE_CATEGORIES.has(category)) return false;
        }
    }
    return explainGenerationError(value).moderation;
}

export function shouldBlockAutomaticRetry(error: unknown, stage?: string) {
    if (stage === "submission_unknown") return true;
    return explainGenerationError(error, { stage }).blockAutomaticRetry;
}

export function unchangedModeratedPrompt(
    metadata: { errorDetails?: string; generationErrorCode?: string; failedPromptFingerprint?: string; failedInputFingerprint?: string } | undefined,
    prompt: string,
    references: Array<string | { id?: string; storageKey?: string; url?: string }> = [],
) {
    const moderationFailure =
        isModerationCategory(metadata?.generationErrorCode || "") ||
        isContentModerationError(metadata?.generationErrorCode ? { code: metadata.generationErrorCode, message: metadata.errorDetails } : metadata?.errorDetails);
    if (!moderationFailure) return false;
    if (metadata?.failedInputFingerprint) return metadata.failedInputFingerprint === generationInputFingerprint(prompt, references);
    if (references.length) return false;
    if (!metadata?.failedPromptFingerprint) return false;
    return metadata.failedPromptFingerprint === generationPromptFingerprint(prompt);
}

export function generationPromptFingerprint(value: string) {
    const normalized = value.trim().replace(/\s+/g, " ");
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${normalized.length}:${(hash >>> 0).toString(36)}`;
}

export function generationInputFingerprint(prompt: string, references: Array<string | { id?: string; storageKey?: string; url?: string; dataUrl?: string }> = []) {
    const referenceKeys = references
        .map((item) => {
            if (typeof item === "string") return item;
            if (item.storageKey) return item.storageKey;
            if (item.url || item.dataUrl) return item.url || item.dataUrl || "";
            return item.id || "";
        })
        .map((item) => item.trim())
        .filter(Boolean)
        .sort();
    return generationPromptFingerprint(`${prompt.trim()}\n${referenceKeys.join("\n")}`);
}

const LOCAL_ONLY_FAILURE_CATEGORIES: ReadonlySet<GenerationErrorCategory> = new Set([
    "local_storage",
    "local_disk_full",
    "local_credential",
    "canvas_conflict",
    "result_apply_failed",
    "result_target_unavailable",
    "request_not_sent",
    "cancelled",
]);

const LOCAL_DIAGNOSTIC_SOURCES: ReadonlySet<string> = new Set(["local_validation", "local_network", "local_result", "local_response", "reference_upload", "client_result"]);

function normalizeComparableText(value: string) {
    return value.replace(/[\s,，。.;；:：!！?？、·"'“”‘’「」『』（）()[\]【】]+/gu, "").toLowerCase();
}

function cleanUpstreamCandidate(raw: string | undefined, explanation: GenerationFailureExplanation): string {
    if (!raw || resourceStorageFailureMessage(raw) || /<\/?[a-z!][^>]*>/i.test(raw)) return "";
    const sanitized = sanitizeProviderText(providerPayloadMessage(raw));
    if (sanitized.includes("[hidden]") || sanitized.includes("[path hidden]") || /[{}]/.test(sanitized) || /(?<![A-Za-z0-9._-])\/+(?!v\d+\/)[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/.test(sanitized)) return "";
    const cleaned = sanitized
        .replace(/\{\s*\[已隐藏\]/g, "")
        .replace(/\[已隐藏\]/g, "")
        .replace(/\s*\(request\s*id:\s*[A-Za-z0-9._:-]{6,127}\)\s*$/i, "")
        .replace(/(?:[。.\s]*排查编号：[^。]+)。?$/u, "")
        .replace(/[:：,，\s[[{}]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned || /[{}]/.test(cleaned)) return "";
    if (/^(?:opaque(?:\s+(?:provider\s+)?(?:message|failure|error))?|bad\s+request|failure|任务失败|已停止)$/i.test(cleaned)) return "";
    if (/^(?:模型服务|接口)?请求失败(?:[（(]\s*HTTP\s*\d{3}\s*[)）])?$/i.test(cleaned)) return "";
    if (BACKEND_FAILURE_CATEGORIES.has(cleaned.toLowerCase())) return "";
    if (isNetworkText(cleaned) || isMalformedText(cleaned) || isCancelledText(cleaned) || isDownloadText(cleaned) || isResultsMissingText(cleaned) || containsInfrastructureDetails(cleaned)) return "";
    const normalized = normalizeComparableText(cleaned);
    if (!normalized) return "";
    const reason = normalizeComparableText(explanation.reason);
    const action = normalizeComparableText(explanation.action);
    const combined = normalizeComparableText(`${explanation.reason}${explanation.action}`);
    if (normalized === reason || normalized === action || normalized === combined) return "";
    if (reason && normalized.startsWith(reason) && (!action || normalized.includes(action))) return "";
    for (const copy of [LOCAL_TASK_ADMISSION_FAILURE, ...Object.values(CATEGORY_COPY), ...Object.values(REFERENCE_PREPARATION_COPY)]) {
        if (normalized === normalizeComparableText(copy.reason) || normalized === normalizeComparableText(`${copy.reason}${copy.action}`)) return "";
    }
    return cleaned;
}

export function formatUpstreamFailureDetail(explanation: GenerationFailureExplanation, context: GenerationFailureContext = {}): string {
    if (LOCAL_ONLY_FAILURE_CATEGORIES.has(explanation.category)) return "";
    const evidence = context.failureDiagnostics;
    if (evidence?.source && LOCAL_DIAGNOSTIC_SOURCES.has(evidence.source)) return "";
    const upstreamEvidence = evidence && ["upstream_http", "upstream_response"].includes(evidence.source);
    if (!upstreamEvidence && explanation.category === "unknown" && !explanation.httpStatus && !explanation.providerCode && !context.providerCode) return "";
    const detail = [upstreamEvidence ? evidence?.summary : "", context.errorSummary, explanation.summary]
        .map((candidate) => cleanUpstreamCandidate(candidate, explanation))
        .find(Boolean);
    if (!detail) return "";
    const rawCode = sanitizeProviderCode((upstreamEvidence ? evidence?.providerCode : "") || explanation.providerCode || context.providerCode || "");
    const showCode = Boolean(
        rawCode &&
            !/^\d+$/.test(rawCode) &&
            !BACKEND_FAILURE_CATEGORIES.has(rawCode.toLowerCase()) &&
            !Object.hasOwn(REFERENCE_PREPARATION_COPY, rawCode) &&
            !isGenericProviderCode(rawCode) &&
            !detail.toLowerCase().includes(rawCode.toLowerCase()),
    );
    return `Upstream return:${detail}${showCode ? ` (${rawCode})` : ""}`;
}

export function formatGenerationDiagnostics(explanation: GenerationFailureExplanation, context: GenerationFailureContext = {}) {
    const evidence = context.failureDiagnostics;
    const taskId = sanitizeDebugId(context.taskId) || sanitizeDebugId(explanation.taskId);
    const requestId = sanitizeDebugId(evidence?.requestId) || sanitizeDebugId(explanation.requestId);
    const model = sanitizeProviderCode(evidence?.input?.model || context.model || "");
    const createdAt = context.createdAt && /^\d{4}-\d{2}-\d{2}[T ][\d:.+Z-]{5,35}$/.test(context.createdAt) ? context.createdAt : "";
    const lines = [
        "Troubleshooting information version: 3",
        ...supportDiagnosticIdentity(context, { appVersion: import.meta.env.VITE_APP_VERSION, buildCommit: import.meta.env.VITE_BUILD_COMMIT }),
        `Reason:${sanitizeProviderText(explanation.reason)}`,
        explanation.action ? `Next step:${sanitizeProviderText(explanation.action)}` : "",
        `Category:${explanation.category}`,
        explanation.category === "local_credential" ? `Failure stage: reading local computing power credentials${explanation.summary?.includes("The build has not been submitted yet") ? "(Not yet submitted for generation)" : ""}` : "",
        `Error source:${explanation.category === "local_credential" ? "Local computing power connection" : explanation.category === "local_disk_full" ? "local disk write" : explanation.category === "local_storage" ? "Local task storage" : ({ local_validation: "Local parameter verification", local_network: "local network", upstream_http: "Upstream HTTP response", upstream_response: "Upstream business response", local_result: "local result processing", local_response: "Local response size limit", reference_upload: "Reference material upload", client_result: "Canvas application results", unknown: "Not recorded" } as Record<string, string>)[evidence?.source || "unknown"] || "Not recorded"}`,
        `Error summary:${sanitizeProviderText(evidence?.summary || context.errorSummary || explanation.summary || "") || "Not recorded"}`,
        evidence && ["upstream_http", "upstream_response", "reference_upload"].includes(evidence.source) && sanitizeProviderCode(evidence.providerCode || "") ? `${evidence.source === "reference_upload" ? "Store return code" : "upstream code"}：${sanitizeProviderCode(evidence.providerCode || "")}` : "",
        evidence?.httpStatus && Number.isInteger(evidence.httpStatus) && evidence.httpStatus >= 100 && evidence.httpStatus <= 599 ? `HTTP status:${evidence.httpStatus}` : "",
        !evidence?.httpStatus && explanation.httpStatus ? `HTTP status:${explanation.httpStatus}` : "",
        sanitizeProviderCode(evidence?.param || "") ? `Parameters:${sanitizeProviderCode(evidence?.param || "")}` : "",
        sanitizeProviderText(evidence?.stage || context.stage || "") ? `Failure stage:${sanitizeProviderText(evidence?.stage || context.stage || "")}` : "",
        taskId ? `Task ID:${taskId}` : "",
        `Request ID:${requestId || "Not recorded"}`,
        sanitizeDebugId(evidence?.providerTaskId) ? `Upstream task ID:${sanitizeDebugId(evidence?.providerTaskId)}` : "",
        sanitizeDebugId(context.providerRequestId) ? `Server association ID:${sanitizeDebugId(context.providerRequestId)}` : "",
        model ? `Model:${model}` : "",
        evidence?.version ? `Running version:${diagnosticToken(evidence.version)} (${diagnosticToken(evidence.platform || "")})` : "",
        evidence?.executionResult ? `Generate execution:${evidence.executionResult === "completed" ? "Done" : evidence.executionResult === "pending" ? "Waiting for review" : evidence.executionResult === "failed" ? "Not completed" : "unknown"}` : "",
        ...formatExecutionEvidence(evidence),
        createdAt ? `Task creation time:${createdAt}` : "",
        ...[["Error logging time", evidence?.capturedAt], ["Task end time", context.completedAt], ["Task update time", context.updatedAt]].flatMap(([label, value]) => value && /^\d{4}-\d{2}-\d{2}[T ][\d:.+Z-]{5,35}$/.test(value) ? [`${label}：${value}`] : []),
    ].filter(Boolean);
    return lines.join("\n");
}

function formatExecutionEvidence(evidence?: GenerationFailureDiagnostics): string[] {
    const lines: string[] = [];
    const number = (n: number | undefined) => Number.isSafeInteger(n) && n! >= 0 ? String(n) : "unknown";
    const input = evidence?.input;
    if (input) {
        lines.push(`Task configuration (protocol may be converted or omitted): protocol=${diagnosticToken(input.protocol)}, model =${diagnosticToken(input.model)}, size=${diagnosticToken(input.size)}, quality =${diagnosticToken(input.quality)}, quantity =${diagnosticToken(input.count)}`);
        lines.push(`Enter statistics: prompt word${number(input.promptChars)} Words; pictures/video/audio${number(input.imageCount)}/${number(input.videoCount)}/${number(input.audioCount)}`);
        if (input.imageLimitsRecorded) lines.push(`Local reference map limit: max.${number(input.maxImages)} Zhang, the upper limit of single image bytes=${number(input.maxImageBytes)}(A byte limit of 0 means no size limit is set)`);
        input.images?.slice(0, 16).forEach((media, i) => lines.push(`Reference picture${i + 1}：${number(media.width)}×${number(media.height)}，${number(media.bytes)} Bytes`));
    }
    const outcomes: Record<string, string> = { response_received: "Response received (business results will be determined separately)", transport_error: "Transfer or read failed", not_dispatched: "Request not sent", http_error: "HTTP error", cancelled: "Cancel", timeout: "timeout", business_error: "business error", response_limit: "Local response size limit" };
    const phases: Record<string, string> = { dns: "DNS resolution", connect: "Establish connection", tls: "TLS handshake", request: "Send request", response_wait: "Waiting for response", response: "Read response" };
    const routes: Record<string, string> = { direct: "direct connection", proxy: "agent" };
    const preparationOperations: Record<string, string> = { reference_create: "Application material upload", reference_put: "Upload material files", reference_complete: "Confirm material upload" };
    evidence?.requests?.slice(0, 8).forEach((request, i) => {
        lines.push(`Request${i + 1}：${preparationOperations[request.operation] || sanitizeProviderCode(request.operation)}；${outcomes[request.outcome] || "unknown"};Initiated=${request.dispatched === true ? "Yes" : "No"}；HTTP=${number(request.httpStatus)}；ID=${sanitizeDebugId(request.requestId) || "Not recorded"}; Time consuming =${number(request.durationMs)}ms`);
        lines.push(`Request${i + 1} Bytes: request body size =${number(request.requestBytes)}(does not mean sent); response statement =${number(request.declaredResponseBytes)};Read=${number(request.receivedBytes)};Response upper limit =${number(request.responseLimitBytes)}`);
        if (phases[request.transportPhase || ""]) lines.push(`Request${i + 1} Connection:${routes[request.transportRoute || ""] || "Not recorded"}; stage =${phases[request.transportPhase!]}`);
        if (/^\d{4}-\d{2}-\d{2}[T ][\d:.+Z-]{5,35}$/.test(request.startedAt)) lines.push(`Request${i + 1} Time:${request.startedAt}`);
        if (sanitizeProviderCode(request.providerCode || "")) lines.push(`Request${i + 1} Upstream code:${sanitizeProviderCode(request.providerCode || "")}`);
        if (request.summary) lines.push(`Request${i + 1} Summary:${sanitizeProviderText(request.summary)}`);
    });
    if (evidence?.omittedRequests) lines.push(`Intermediate requests are omitted:${number(evidence.omittedRequests)}`);
    return lines;
}

function diagnosticToken(value?: string): string {
    return value && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value) && !value.includes("://") && !/(?:bearer|api[_-]?key|secret|token|sk-|^[a-z]:[\\/]|\/+(?:Users|home|private|tmp|var|Volumes|mnt|media|run|root|opt|srv|etc|data|app|workspace|usr|proc|sys|dev|lib|bin|sbin)\/)/i.test(value) ? value : "Not recorded";
}

export function isGenerationErrorCode(code: string) {
    return (GENERATION_ERROR_CATEGORIES as readonly string[]).includes(code) || /^(?:model|provider|origin)_[a-z0-9_]{2,80}$/.test(code) || code === CONTENT_MODERATION_ERROR_CODE;
}

function classifyUnknown(error: unknown, context: GenerationFailureContext): Classified {
    if (context.stage === "submission_unknown") {
        const classified = classifyUnknown(error, { ...context, stage: undefined });
        if (classified.fromCode && classified.uncertain) return classified;
        return { category: "submission_uncertain", uncertain: true, retryable: false };
    }
    if (!error) return { category: "unknown", retryable: false };
    if (typeof error === "object" && error) {
        const record = error as Record<string, unknown>;
        // The custom relay backend classifies upstream bodies itself; use that
        // category instead of re-reading provider text with local rules.
        if (record.name === "ChannelResponseError" && typeof record.category === "string") {
            const category = record.category.trim();
            if ((GENERATION_ERROR_CATEGORIES as readonly string[]).includes(category)) {
                return { category: category as GenerationErrorCategory, status: numericStatus(record.status), fromCode: true, retryable: retryableCategory(category as GenerationErrorCategory) };
            }
        }
        if (record.reason === "local_credential_failed") return { category: "local_credential", status: numericStatus(record.status), fromCode: true, retryable: false };
        if (record.reason === "local_disk_full") return { category: "local_disk_full", status: numericStatus(record.status), fromCode: true, retryable: false };
        if (record.reason === "local_storage_failed") return { category: "local_storage", ...LOCAL_TASK_ADMISSION_FAILURE, fromCode: true, retryable: false };
        if (record.name === "ApiError" && record.reason === "quota_exceeded") {
            return { category: "quota_limit", reason: sanitizeProviderText(String(record.message || "Workspace usage has reached the upper limit")), action: "Please clear unnecessary task records or materials and try again", fromCode: true, retryable: false };
        }
        if (record.reason === "stale_revision" || record.code === "canvas_conflict") {
            return { category: "canvas_conflict", fromCode: true, retryable: false };
        }
        if (["node_task_mismatch", "node_mismatch", "canvas_mismatch", "node_deleted"].includes(String(record.reason || ""))) {
            return { category: "result_target_unavailable", status: numericStatus(record.status), fromCode: true, retryable: false };
        }
        const backendFailure = backendTaskFailure(record);
        if (backendFailure) return backendFailure;
        if (record.code === "download_failed" || record.code === "result_apply_failed" || record.code === "result_target_unavailable") {
            return { category: record.code, fromCode: true, retryable: false };
        }
        if (typeof record.message === "string" && isCanvasSaveConflictText(record.message) && (record.reason === "conflict" || record.status === 409 || record.status === 428)) {
            return { category: "canvas_conflict", fromCode: true, retryable: false };
        }
        const response = record.response && typeof record.response === "object" ? (record.response as Record<string, unknown>) : undefined;
        const status = numericStatus(record.status) ?? numericStatus(record.statusCode) ?? numericStatus(response?.status);
        const data = record.data ?? record.body ?? response?.data ?? record.response;
        if (status || data) {
            const classified = classifyHttp(status, data ?? record);
            if (classified.category !== "unknown" || status) return classified;
        }
        const structured = classifyText(stringifyAllowlisted(record));
        if (structured.fromCode || structured.category !== "unknown") return structured;
        if (typeof record.reason === "string" && record.reason) {
            const fromReason = classifyText(record.reason);
            if (fromReason.category !== "unknown") return fromReason;
        }
        if (typeof record.message === "string" && record.message) return classifyText(record.message);
    }
    if (error instanceof Error) return classifyText(error.message);
    if (typeof error === "string") return classifyText(error);
    return classifyText(providerPayloadMessage(error));
}

// 后端任务失败：code 是后端给出的失败类别（task.errorCode / 节点 taskErrorCode），
// message 是后端按「原因。下一步。排查编号：…」拼好的文案。类别直接取 code，
// 文案只按这个固定格式拆开，不再用文字猜类别。
const BACKEND_FAILURE_CATEGORIES: ReadonlySet<string> = new Set(
    GENERATION_ERROR_CATEGORIES.filter((category) => !["unknown", "canvas_conflict", "result_apply_failed", "result_target_unavailable"].includes(category)),
);

// 后端把这几类标为「结果未确认」；任务接口没有单独的字段，按类别判断。
const BACKEND_UNCERTAIN_CATEGORIES: ReadonlySet<string> = new Set(["submission_uncertain", "download_failed", "timeout", "partial_success", "results_missing"]);

function backendTaskFailure(record: Record<string, unknown>): Classified | undefined {
    const category = record.code;
    if (typeof category !== "string" || !BACKEND_FAILURE_CATEGORIES.has(category) || typeof record.message !== "string") return undefined;
    const text = record.message.trim();
    if (!text) return undefined;
    // 回传给后端的排查编号会被 explainGenerationError 重新拼上，这里先拆下来。
    const preparation = category === "provider_unavailable" ? persistedReferencePreparation(text) : undefined;
    if (preparation) return preparation;
    const debugMatch = text.match(/。排查编号：([^。]+)。?$/);
    const debug = debugMatch?.[1] || "";
    const [reason = "", ...action] = (debugMatch ? text.slice(0, debugMatch.index) : text).split("。").map((part) => part.trim()).filter(Boolean);
    return {
        category: category as GenerationErrorCategory,
        reason: sanitizeProviderText(reason) || undefined,
        action: sanitizeProviderText(action.join("。")) || undefined,
        requestId: sanitizeDebugId(allowlistedString(record.request_id) || allowlistedString(record.requestId)) || sanitizeDebugId(debug.match(/(?:^| · )请求 ([A-Za-z0-9._:-]{6,127})$/)?.[1]),
        taskId: sanitizeDebugId(allowlistedString(record.task_id) || allowlistedString(record.taskId)) || sanitizeDebugId(debug.match(/^任务 ([A-Za-z0-9._:-]{6,127})(?: · |$)/)?.[1]),
        fromCode: true,
        uncertain: BACKEND_UNCERTAIN_CATEGORIES.has(category),
        retryable: retryableCategory(category as GenerationErrorCategory) && !BACKEND_UNCERTAIN_CATEGORIES.has(category),
    };
}

function classifyHttp(status: number | undefined, body: unknown): Classified {
    const text = typeof body === "string" ? body : providerPayloadMessage(body) || (body && typeof body === "object" ? JSON.stringify(body) : "");
    if (persistedReferencePreparation(text)) return { category: "submission_uncertain", status, uncertain: true, retryable: false };
    let classified = classifyText(text || (body && typeof body === "object" ? stringifyAllowlisted(body) : ""));
    if (body && typeof body === "object") {
        const fromObject = classifyText(stringifyAllowlisted(body));
        if (fromObject.fromCode || (fromObject.category !== "unknown" && classified.category === "unknown")) {
            classified = fromObject;
        } else {
            classified.providerCode ||= fromObject.providerCode;
            classified.requestId ||= fromObject.requestId;
            classified.taskId ||= fromObject.taskId;
        }
    }
    const fields = extractProviderFields(typeof body === "string" ? body : body && typeof body === "object" ? stringifyAllowlisted(body) : "");
    // Local API reasons are handled before this provider-response fallback.
    if (classified.category === "local_disk_full" || classified.category === "local_credential") classified = { category: "unknown", retryable: false };
    if (status === 402 && fields.code === "video_reservation_failed" && fields.message.startsWith("insufficient balance for this video request")) {
        classified = { ...classified, category: "quota_user", fromCode: true, reason: undefined, action: undefined };
    }
    if (classified.category !== "unknown" && !classified.fromCode && !trustProviderMessageStatus(status)) {
        classified = { ...classified, category: "unknown", reason: undefined, action: undefined, retryable: false };
    }
    if (!classified.fromCode && (classified.category === "unknown" || classified.category === "malformed_response" || (classified.category === "invalid_params" && status && status !== 400 && status !== 422 && status !== 409)) && status) {
        classified = { ...classified, category: categoryFromHttpStatus(status), reason: undefined, action: undefined, status, retryable: false };
        if (status === 524) {
            classified.category = "timeout";
            classified.uncertain = true;
            classified.reason = "The model service response timed out and the request may still be executed on the server.";
            classified.action = "Please check the original task or go to the supplier to check the status first. Do not resubmit immediately.";
        }
    }
    if (status === 524 && (classified.category === "unknown" || classified.category === "timeout" || classified.category === "provider_unavailable" || classified.category === "malformed_response")) {
        classified.category = "timeout";
        classified.uncertain = true;
        classified.reason = "The model service response timed out and the request may still be executed on the server.";
        classified.action = "Please check the original task or go to the supplier to check the status first. Do not resubmit immediately.";
    }
    if (status === 413 && classified.category === "input_too_large" && !classified.reason) {
        classified.reason = "The amount of data requested exceeds the upper limit of the interface";
        classified.action = "Please reduce the number of reference materials or use publicly accessible material links before submitting.";
    }
    classified.status = status;
    classified.retryable = retryableCategory(classified.category) && !classified.uncertain;
    return classified;
}

function classifyText(raw: string): Classified {
    const text = raw.trim();
    if (!text) return { category: "unknown", retryable: false };
    if (text === LOCAL_TASK_ADMISSION_FAILURE.reason || text.startsWith(`${LOCAL_TASK_ADMISSION_FAILURE.reason}。`)) {
        return { category: "local_storage", ...LOCAL_TASK_ADMISSION_FAILURE, fromCode: true, retryable: false };
    }
    if (isCanvasSaveConflictText(text)) {
        return { category: "canvas_conflict", fromCode: true, retryable: false };
    }
    const durationCopy = referenceDurationCopy(text);
    if (durationCopy) {
        const debug = text.match(/。排查编号：([^。]+)。?$/)?.[1] || "";
        return {
            category: "invalid_params",
            ...durationCopy,
            fromCode: true,
            requestId: sanitizeDebugId(debug.match(/(?:^| · )请求 ([A-Za-z0-9._:-]{6,127})$/)?.[1]),
            taskId: sanitizeDebugId(debug.match(/^任务 ([A-Za-z0-9._:-]{6,127})(?: · |$)/)?.[1]),
            retryable: false,
        };
    }
    const mediaCopy = referenceMediaConstraintCopy(text);
    if (mediaCopy) {
        const debug = text.match(/。排查编号：([^。]+)。?$/)?.[1] || "";
        return {
            category: mediaCopy.reason.includes("Too big") ? "input_too_large" : "invalid_params",
            ...mediaCopy,
            fromCode: true,
            requestId: sanitizeDebugId(debug.match(/(?:^| · )请求 ([A-Za-z0-9._:-]{6,127})$/)?.[1]),
            taskId: sanitizeDebugId(debug.match(/^任务 ([A-Za-z0-9._:-]{6,127})(?: · |$)/)?.[1]),
            retryable: false,
        };
    }
    if (HTML_BODY.test(text)) {
        const status = extractExplicitHttpStatus(text);
        if (status) return classifyHttp(status, "");
        return { category: "malformed_response", retryable: false };
    }
    const storage = resourceStorageFailureMessage(text);
    if (storage) return { category: "input_inaccessible", reason: storage.replace(/。$/, ""), action: "", retryable: false };
    const fields = extractProviderFields(text);
    // Inspect only the error message, never JSON request echoes or debug fields.
    const databaseMessage = fields.code || fields.type || fields.message || fields.status || /^[{[]/.test(text) ? fields.message : text;
    if (/(write local resource|生成内容写入资源存储失败|database or disk is full|本地磁盘空间不足)/i.test(databaseMessage) && /(no space left on device|not enough space on the disk|disk full|database or disk is full|本地磁盘空间不足)/i.test(databaseMessage)) return { category: "local_disk_full", fromCode: true, retryable: false };
    if (LOCAL_DATABASE_ERROR.test(databaseMessage)) return { category: "local_storage", fromCode: true, requestId: sanitizeDebugId(fields.requestId), taskId: sanitizeDebugId(fields.taskId), retryable: false };
    if (fields.code || fields.type || fields.message || fields.status) {
        const fromCode = categoryFromProviderCode(fields.code, fields.type, fields.status);
        const codeOrStatusAuthoritative =
            (Boolean(categoryFromProviderCode(fields.code)) && !isNonAuthoritativeInvalidParamsCode(fields.code)) ||
            (Boolean(categoryFromProviderCode(fields.status)) && !isNonAuthoritativeInvalidParamsCode(fields.status));
        if (fromCode) {
            const specialized = specialize(
                {
                    category: fromCode,
                    fromCode: codeOrStatusAuthoritative || !isGenericProviderCode(fields.type),
                    providerCode: sanitizeProviderCode(fields.code),
                    requestId: sanitizeDebugId(fields.requestId),
                    taskId: sanitizeDebugId(fields.taskId),
                },
                fields,
            );
            if (specialized.category !== "invalid_params") specialized.fromCode = true;
            if (!specialized.fromCode && specialized.category === "invalid_params" && !specialized.reason) {
                const terminal = terminalMessageClassified(fields);
                if (terminal) return terminal;
            }
            return specialized;
        }
        const fromMessage = categoryFromProviderMessage(`${fields.message} ${fields.type} ${fields.status}`);
        if (fromMessage) return specialize({ category: fromMessage, providerCode: sanitizeProviderCode(fields.code), requestId: sanitizeDebugId(fields.requestId), taskId: sanitizeDebugId(fields.taskId) }, fields);
        const terminal = terminalMessageClassified(fields);
        if (terminal) return terminal;
        const chineseCopy = userFacingChineseCopy(fields.message);
        if (chineseCopy && isActionableParameterCopy(chineseCopy)) {
            return {
                category: "invalid_params",
                ...chineseCopy,
                providerCode: sanitizeProviderCode(fields.code),
                requestId: sanitizeDebugId(fields.requestId) || sanitizeDebugId(fields.message.match(EMBEDDED_REQUEST_ID)?.[1]),
                taskId: sanitizeDebugId(fields.taskId),
                retryable: false,
            };
        }
    }
    if (/^[{[]/.test(text)) return { category: "unknown", providerCode: sanitizeProviderCode(fields.code), requestId: sanitizeDebugId(fields.requestId), taskId: sanitizeDebugId(fields.taskId), retryable: false };
    if (isMalformedText(text)) return { category: "malformed_response", retryable: false };
    const fromFull = categoryFromProviderMessage(text);
    if (fromFull) return specialize({ category: fromFull }, { ...emptyFields(), message: text });
    if (isNetworkText(text)) return { category: "network", retryable: true };
    if (isDownloadText(text)) return { category: "download_failed", uncertain: true, retryable: false };
    if (isCancelledText(text)) return { category: "cancelled", retryable: false };
    if (isResultsMissingText(text)) return { category: "results_missing", retryable: false };
    const status = extractExplicitHttpStatus(text);
    if (status) return classifyHttp(status, "");
    if (/[\u4e00-\u9fff]/.test(text) && !containsInfrastructureDetails(text)) {
        const debugMatch = text.match(/。排查编号：([^。]+)。?$/);
        const debug = debugMatch?.[1] || "";
        const bodyWithoutDebug = debugMatch ? text.slice(0, debugMatch.index) : text;
        const isReferenceItem = /^参考(?:图片|图|视频|音频|素材) \d+：/.test(bodyWithoutDebug);
        const chineseCopy = userFacingChineseCopy(bodyWithoutDebug);
        return {
            category: isReferenceItem || (chineseCopy && isActionableParameterCopy(chineseCopy)) ? "invalid_params" : "unknown",
            fromCode: isReferenceItem || undefined,
            reason: chineseCopy?.reason || sanitizeProviderText(bodyWithoutDebug),
            action: chineseCopy?.action || "",
            requestId: sanitizeDebugId(debug.match(/(?:^| · )请求 ([A-Za-z0-9._:-]{6,127})$/)?.[1]),
            taskId: sanitizeDebugId(debug.match(/^任务 ([A-Za-z0-9._:-]{6,127})(?: · |$)/)?.[1]),
            retryable: false,
        };
    }
    return { category: "unknown", retryable: false };
}

function isGenericProviderCode(code: string) {
    return (
        ["", "unknown", "failed", "badrequest", "api_error", "upstream_error", "upstream_rejected", "invalid_request", "invalid_request_error", "invalid_parameter", "invalidparameter", "invalid_argument"].includes(normalizeCode(code)) ||
        /^\d{3}$/.test(code.trim())
    );
}

function isNonAuthoritativeInvalidParamsCode(code: string) {
    return ["", "badrequest", "invalid_request_error", "invalid_parameter", "invalidparameter", "invalid_argument"].includes(normalizeCode(code)) || /^\d{3}$/.test(code.trim());
}

function terminalMessageClassified(fields: ExtractedFields): Classified | undefined {
    const ids = { providerCode: sanitizeProviderCode(fields.code), requestId: sanitizeDebugId(fields.requestId), taskId: sanitizeDebugId(fields.taskId) };
    if (isNetworkText(fields.message)) return { category: "network", ...ids, retryable: true };
    if (isDownloadText(fields.message)) return { category: "download_failed", uncertain: true, ...ids, retryable: false };
    if (isCancelledText(fields.message)) return { category: "cancelled", ...ids, retryable: false };
    if (isResultsMissingText(fields.message)) return { category: "results_missing", ...ids, retryable: false };
    return undefined;
}

function hasAuthoritativeProviderCode(fields: ExtractedFields) {
    return (
        (Boolean(categoryFromProviderCode(fields.code)) && !isGenericProviderCode(fields.code)) ||
        (Boolean(categoryFromProviderCode(fields.status)) && !isGenericProviderCode(fields.status)) ||
        (Boolean(categoryFromProviderCode(fields.type)) && !isGenericProviderCode(fields.type))
    );
}

function specialize(classified: Classified, fields: ExtractedFields): Classified {
    const rawMessage = fields.message;
    fields = { ...fields, message: sanitizeProviderText(fields.message) };
    classified.requestId ||= sanitizeDebugId(fields.message.match(EMBEDDED_REQUEST_ID)?.[1]);
    // Only broad wrappers (or unrecognized codes paired with a generic type) may be refined by a more specific provider message.
    const genericCode = !hasAuthoritativeProviderCode(fields);
    if (genericCode && ["unknown", "invalid_params"].includes(classified.category)) {
        const refined = categoryFromProviderMessage(fields.message);
        if (refined) {
            classified.category = refined;
            if (refined !== "invalid_params") classified.fromCode = true;
        }
    }
    if (isModerationCategory(classified.category) || (genericCode && ["unknown", "invalid_params"].includes(classified.category))) {
        const moderationCopy = moderationErrorCopy(fields.code, fields.message);
        if (moderationCopy) return { ...classified, ...moderationCopy, fromCode: true, retryable: false };
    }
    const audioOrDuration = referenceAudioCopy(fields.message, normalizeCode(fields.code) === "invalid_reference_audio") || referenceDurationCopy(fields.message);
    if (audioOrDuration) return { ...classified, category: "invalid_params", ...audioOrDuration, fromCode: true, retryable: false };
    const mediaCopy = ["unknown", "invalid_params", "input_too_large", "input_inaccessible"].includes(classified.category) ? referenceMediaConstraintCopy(fields.message) : undefined;
    if (mediaCopy) return { ...classified, category: mediaCopy.reason.includes("Too big") ? "input_too_large" : "invalid_params", ...mediaCopy, fromCode: true, retryable: false };
    if (classified.category === "invalid_params") {
        const refined = categoryFromProviderMessage(fields.message);
        if (refined === "context_too_long" || refined === "input_inaccessible" || refined === "input_too_large" || refined === "model_missing") classified.category = refined;
    }
    if (isModerationCategory(classified.category) && !["moderation_reference", "moderation_output"].includes(fields.code)) classified.category = moderationCategoryFromMessage(`${fields.message} ${fields.code}`.toLowerCase());
    const normalized = `${fields.message} ${fields.code}`.toLowerCase();
    if (classified.category === "invalid_params") {
        const duration = fields.message.match(/duration\s+(?:must|should)\s+be\s+between\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)?\s+and\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
        if (duration && Number(duration[1]) <= Number(duration[2])) {
            const reference = fields.message.includes("Material") || /reference|audio/i.test(fields.message);
            classified.reason = reference ? "The duration of the reference material does not meet the model requirements" : "The video length does not meet the model requirements";
            classified.action = reference ? `Please check each reference audio and video and adjust the material that does not meet the requirements to${duration[1]}–${duration[2]} Resubmit after seconds` : `Please adjust the duration to${duration[1]}–${duration[2]} Try again in seconds`;
        }
        const height = fields.message.match(/height\s+(?:must|should)\s+be\s+between\s+(\d+)\s*(?:px|pixels?)?\s+and\s+(\d+)\s*(?:px|pixels?)/i);
        if (height) {
            classified.reason = "The height of the reference material does not meet the model requirements";
            classified.action = `Please adjust the height to${height[1]}–${height[2]} Resubmit after pixel`;
        }
        const width = fields.message.match(/width\s+(?:must|should)\s+be\s+between\s+(\d+)\s*(?:px|pixels?)?\s+and\s+(\d+)\s*(?:px|pixels?)/i);
        if (width && !height) {
            classified.reason = "The width of the reference material does not meet the model requirements";
            classified.action = `Please adjust the width to${width[1]}–${width[2]} Resubmit after pixel`;
        }
        const aspect = fields.message.match(/aspect(?:\s*ratio)?\s+(?:must|should)\s+be\s+between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i);
        if (aspect) {
            classified.reason = "The aspect ratio of the reference material does not meet the model requirements";
            classified.action = `Please adjust the aspect ratio to${aspect[1]}–${aspect[2]} resubmit`;
        }
        const pixels = fields.message.match(/(?:pixel(?:s)?(?:\s+count)?|total\s+pixels)\s+(?:must|should)\s+be\s+between\s+(\d+)\s+and\s+(\d+)/i);
        if (pixels) {
            classified.reason = "The total number of pixels in the reference material does not meet the model requirements.";
            classified.action = `Please adjust the width × height of the reference material to${pixels[1]}–${pixels[2]} Pixels; modifying the generated resolution does not change the reference material`;
        }
    }
    if (classified.category === "input_too_large") {
        if (
            normalizeCode(fields.code) === "video_request_body_too_large" ||
            /(?:request\s+(?:body|entity|payload)|payload)\s+(?:is\s+)?too\s+large|(?:request|payload).{0,24}(?:exceeds?|larger than)/i.test(fields.message)
        ) {
            classified.reason = "The amount of data requested exceeds the upper limit of the interface";
            classified.action = "Please reduce the number of reference materials or use publicly accessible material links before submitting.";
        } else if (/(?:file|image|video|audio)\s+too\s+large/i.test(fields.message)) {
            classified.reason = "Single reference file is too large";
            classified.action = "Please compress or replace the material before submitting it";
        }
    }
    if (((normalized.includes("thinking") || normalized.includes("reasoning")) && normalized.includes("tool_choice")) || (normalized.includes("tool_choice") && (normalized.includes("not support") || normalized.includes("unsupported")))) {
        classified.category = "invalid_params";
        classified.reason = "The current model is in thinking or reasoning mode and does not support forced tool calls.";
        classified.action = "Please use automatic tools to select or replace non-thinking mode models instead";
    }
    if (classified.reason) classified.fromCode = true;
    if (classified.category === "invalid_params" && !classified.reason) {
        const chineseCopy = userFacingChineseCopy(rawMessage);
        if (chineseCopy) {
            classified.reason = chineseCopy.reason;
            classified.action = chineseCopy.action;
        }
    }
    classified.retryable = retryableCategory(classified.category);
    return classified;
}

const REFERENCE_PREPARATION_COPY: Record<string, CategoryCopy> = {
    image_reference_upload_failed: { reason: "The reference image upload failed and the generation has not started yet.", action: "Please try again later" },
    reference_media_upload_failed: { reason: "The reference material upload failed and the generation has not started yet.", action: "Please check the object storage configuration and public read permissions and try again" },
    reference_preupload_failed: { reason: "The reference material upload failed and the generation has not started yet.", action: "Please check the network or try again later" },
};

function persistedReferencePreparation(raw: string): Classified | undefined {
    const text = raw.trim();
    const debug = text.match(/。排查编号：([^。]+)。?$/)?.[1] || "";
    const requestId = sanitizeDebugId(debug.match(/(?:^| · )请求 ([A-Za-z0-9._:-]{6,127})$/)?.[1]);
    const taskId = sanitizeDebugId(debug.match(/^任务 ([A-Za-z0-9._:-]{6,127})(?: · |$)/)?.[1]);
    for (const [providerCode, copy] of Object.entries(REFERENCE_PREPARATION_COPY)) {
        const message = joinSentences(copy.reason, copy.action, debugIdLine(taskId, requestId));
        if (text === message || text === message.replace(/。$/, "")) {
            return { category: "provider_unavailable", ...copy, providerCode, requestId, taskId, fromCode: true, retryable: false };
        }
    }
}

function confirmedReferencePreparation(classified: Classified) {
    const copy = REFERENCE_PREPARATION_COPY[classified.providerCode || ""];
    return Boolean(copy && !classified.uncertain && classified.category === "provider_unavailable" && classified.reason === copy.reason && classified.action === copy.action);
}

function resourceStorageFailureMessage(value: string) {
    if (!value) return "";
    if (isLocalRuntimeMode() && /(?:参考(?:图片|媒体)上传失败|OSS 上传失败|对象存储|腾讯云 COS|七牛云)/i.test(value)) {
        return "The local reference material failed to save, please check the local resource directory and try again.";
    }
    if (/\bUserDisable\b/i.test(value)) return "The object storage account has been deactivated. Please check or change the object storage configuration.";
    if (/(?:参考(?:图片|媒体)上传失败|OSS 上传失败|对象存储|腾讯云 COS|七牛云)/i.test(value)) {
        return "The reference material failed to be uploaded to object storage. Please check the object storage configuration and try again.";
    }
    return "";
}
