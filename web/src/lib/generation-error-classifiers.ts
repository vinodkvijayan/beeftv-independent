import { moderationErrorCopy } from "./moderation-error";

export const CONTENT_MODERATION_ERROR_CODE = "sensitive_words_detected";

export const GENERATION_ERROR_CATEGORIES = [
    "auth",
    "permission",
    "quota_user",
    "quota_upstream",
    "quota_unknown",
    "quota_limit",
    "moderation_input",
    "moderation_reference",
    "moderation_output",
    "invalid_params",
    "local_storage",
    "local_disk_full",
    "local_credential",
    "canvas_conflict",
    "result_apply_failed",
    "result_target_unavailable",
    "context_too_long",
    "input_inaccessible",
    "input_too_large",
    "model_missing",
    "throttled",
    "concurrency",
    "provider_unavailable",
    "network",
    "request_not_sent",
    "timeout",
    "submission_uncertain",
    "async_failed",
    "cancelled",
    "partial_success",
    "download_failed",
    "delivery_failed",
    "results_missing",
    "malformed_response",
    "unknown",
] as const;

export type GenerationErrorCategory = (typeof GENERATION_ERROR_CATEGORIES)[number];

export type CategoryCopy = { reason: string; action: string };

export const LOCAL_TASK_ADMISSION_FAILURE: CategoryCopy = {
    reason: "The local task failed to save and the generation has not yet been submitted.",
    action: "Please restart the application and try again; if it still fails, please retain the troubleshooting information and contact support",
};

export const CATEGORY_COPY: Record<GenerationErrorCategory, CategoryCopy> = {
    auth: { reason: "Model service authentication failed", action: "Please check the API Key and try again" },
    permission: { reason: "The current channel does not have permission to use this model", action: "Please change the model or check the channel permissions" },
    quota_user: { reason: "The available balance of the current account is insufficient", action: "Please check the account balance, replenish the quota or adjust the token or package quota and try again" },
    quota_upstream: { reason: "The model supplier rejected the billing or credit related request", action: "Please check the bill and credit limit with your supplier before deciding whether to try again." },
    quota_unknown: { reason: "The model service rejected billing or quota-related requests.", action: "Please go to the current channel or model supplier to check the bill and limit before deciding whether to try again." },
    quota_limit: { reason: "The model call has reached the set usage limit", action: "Please check the usage or budget limit of the current channel, adjust it and try again" },
    moderation_input: { reason: "The prompt word or reference material did not pass the content security review", action: "Please adjust the prompt words or reference materials and regenerate" },
    moderation_reference: { reason: "The reference material failed the content security review", action: "Please check and replace the reference material before regenerating" },
    moderation_output: { reason: "The generated results failed content security review", action: "Please adjust the prompt words or reference materials and regenerate" },
    invalid_params: { reason: "Model does not accept current parameters", action: "Please check the model, size, duration, format or quantity and try again" },
    local_storage: { reason: "The local database cannot be read or written", action: "Please restart the application; if it still fails, please retain the troubleshooting information and contact support, and do not generate it again." },
    local_disk_full: { reason: "Insufficient local disk space to save data", action: "Please clean the disk where the BeefTV data directory is located; if there are already generated results, please retrieve the original task first and do not generate it again." },
    local_credential: { reason: "Failed to read local computing power credentials", action: "Please check the workspace data directory and reconnect the computing account; do not delete the workspace key" },
    canvas_conflict: { reason: "The build results have been retained and the canvas has not been updated yet", action: "Please click \"Continue to retrieve\" and do not regenerate" },
    result_apply_failed: { reason: "The generated results have been retained and have not been put back into the canvas.", action: "Please click \"Continue to retrieve\" and do not regenerate" },
    result_target_unavailable: { reason: "The generated results have been saved and cannot be put back into the original node.", action: "Retrieved from \"Generation History\", no need to regenerate" },
    context_too_long: { reason: "The input content exceeds the model length limit", action: "Please shorten the prompt words or reduce the reference content and try again" },
    input_inaccessible: { reason: "Reference material cannot be read", action: "Please check the material and try again" },
    input_too_large: { reason: "Reference material is too large", action: "Please compress or replace the material and try again" },
    model_missing: { reason: "The current model or interface is not available", action: "Please check the model name and channel configuration" },
    throttled: { reason: "Requests are too frequent", action: "Please try again later" },
    concurrency: { reason: "Too many simultaneous builds", action: "Please wait until existing tasks are completed before trying again" },
    provider_unavailable: { reason: "Model service is temporarily unavailable", action: "Please try again later" },
    network: { reason: "Network connection failed", action: "Please check the network and verify the status of the original task before deciding whether to regenerate it." },
    request_not_sent: { reason: "Failed to connect to the service, this request has not been submitted yet", action: "Please check the network or proxy and try again" },
    timeout: { reason: "Model service response timed out", action: "Please check the original task later and do not resubmit it immediately" },
    submission_uncertain: { reason: "The submission result has not yet been confirmed, and the upstream tasks may still be executed.", action: "Please check the original task status first and do not resubmit immediately" },
    async_failed: { reason: "Build task not completed", action: "Please check the details and decide whether to try again" },
    cancelled: { reason: "Task canceled", action: "You can resubmit according to the original input" },
    partial_success: { reason: "Some results were generated, the rest failed", action: "Please check the existing results before deciding whether to do it again" },
    download_failed: { reason: "The generated results have not been retrieved yet", action: "Click \"Continue Retrieval\" to continue downloading the original results and will not regenerate them." },
    delivery_failed: { reason: "The video has been generated but cannot be retrieved at the moment", action: "Please contact support to restore the film, and click \"Retrieve Results\" after restoration; there is no need to pay again to generate it." },
    results_missing: { reason: "Task ended but no results available", action: "Please review the details before deciding whether to try again" },
    malformed_response: { reason: "The model service returned unresolved content", action: "Please check the details and check the status of the original task before deciding whether to regenerate it." },
    unknown: { reason: "Build failed", action: "Please review the details before deciding whether to try again" },
};

const PROVIDER_CODE_CATEGORIES: Record<string, GenerationErrorCategory> = {
    local_storage_failed: "local_storage",
    local_credential_failed: "local_credential",
    local_disk_full: "local_disk_full",
    accountoverdueerror: "quota_upstream",
    "operationdenied.serviceoverdue": "quota_upstream",
    setlimitexceeded: "quota_limit",
    inflightbatchsizeexceeded: "concurrency",
    modelnotopen: "permission",
    "operationdenied.servicenotopen": "permission",
    contentsecuritydetectionerror: "provider_unavailable",
    invalid_video_parameters: "invalid_params",
    invalid_reference_image: "invalid_params",
    invalid_reference_audio: "invalid_params",
    invalid_reference_video: "invalid_params",
    invalid_reference_url: "input_inaccessible",
    invalid_media_format: "invalid_params",
    media_submission_rejected: "invalid_params",
    video_reference_upload_invalid: "invalid_params",
    video_reference_upload_mismatch: "invalid_params",
    video_reference_upload_incomplete: "invalid_params",
    video_reference_upload_expired: "invalid_params",
    video_reference_upload_unavailable: "provider_unavailable",
    insufficient_user_quota: "quota_user",
    model_temporarily_unavailable: "provider_unavailable",
    no_available_channel: "provider_unavailable",
    channel_excluded: "permission",
    "channel:invalid_key": "provider_unavailable",
    "channel:no_available_key": "provider_unavailable",
    "channel:param_override_invalid": "unknown",
    "channel:header_override_invalid": "unknown",
    "channel:model_mapped_error": "unknown",
    "channel:aws_client_error": "provider_unavailable",
    "channel:response_time_exceeded": "timeout",
    "violation_fee.grok.csam": "moderation_input",
    prompt_blocked: "moderation_input",
    context_media_limit_exceeded: "context_too_long",
    media_request_capacity_exceeded: "concurrency",
    key_site_mismatch: "auth",
    bad_request_body: "invalid_params",
    invalid_api_type: "unknown",
    responses_encrypted_context_mismatch: "invalid_params",
    count_token_failed: "unknown",
    model_price_error: "unknown",
    json_marshal_failed: "unknown",
    do_request_failed: "submission_uncertain",
    get_channel_failed: "provider_unavailable",
    gen_relay_info_failed: "unknown",
    read_request_body_failed: "unknown",
    convert_request_failed: "unknown",
    read_response_body_failed: "submission_uncertain",
    bad_response_status_code: "unknown",
    bad_response: "malformed_response",
    bad_response_body: "malformed_response",
    empty_response: "results_missing",
    aws_invoke_error: "unknown",
    query_data_error: "unknown",
    update_data_error: "unknown",
    pre_consume_token_quota_failed: "unknown",
    upstream_crowded: "throttled",
    upstream_unavailable: "provider_unavailable",
    image_reference_upload_failed: "provider_unavailable",
    reference_media_upload_failed: "provider_unavailable",
    reference_preupload_failed: "provider_unavailable",
    upstream_rejected: "unknown",
    upstream_error: "unknown",
    invalid_api_key: "auth",
    invalid_authentication: "auth",
    authentication_error: "auth",
    unauthenticated: "auth",
    unauthorized: "auth",
    permission_denied: "permission",
    forbidden: "permission",
    access_denied: "permission",
    insufficient_quota: "quota_unknown",
    insufficient_balance: "quota_unknown",
    billing_not_active: "quota_unknown",
    billing_hard_limit_reached: "quota_upstream",
    arrearage: "quota_upstream",
    allocationquota: "quota_unknown",
    quota_exceeded: "quota_unknown",
    sensitive_words_detected: "moderation_input",
    content_filter: "moderation_input",
    content_policy_violation: "moderation_input",
    contentmoderationfailed: "moderation_input",
    "invalidparameter.voilationcontent": "moderation_input",
    "invalidparameter.violationcontent": "moderation_input",
    content_policy: "moderation_input",
    datainspectionfailed: "moderation_input",
    prohibited_content: "moderation_input",
    invalid_request: "invalid_params",
    invalid_request_error: "invalid_params",
    invalid_parameter: "invalid_params",
    invalidparameter: "invalid_params",
    invalid_argument: "invalid_params",
    requestparameteriswrong: "invalid_params",
    model_capability_not_supported: "invalid_params",
    context_length_exceeded: "context_too_long",
    contentlengthexceeded: "context_too_long",
    url_error: "input_inaccessible",
    invalid_image_url: "input_inaccessible",
    file_too_large: "input_too_large",
    payload_too_large: "input_too_large",
    video_request_body_too_large: "input_too_large",
    model_not_found: "model_missing",
    model_not_exist: "model_missing",
    invalid_model: "model_missing",
    not_found: "model_missing",
    rate_limit_exceeded: "throttled",
    rate_limit_error: "throttled",
    throttling: "throttled",
    too_many_requests: "throttled",
    resource_exhausted: "throttled",
    channel_concurrency_wait_timeout: "concurrency",
    channel_concurrency_unavailable: "concurrency",
    unavailable: "provider_unavailable",
    overloaded: "provider_unavailable",
    internal_error: "provider_unavailable",
    upstream_timeout: "timeout",
    deadline_exceeded: "timeout",
    request_cancelled: "cancelled",
    provider_submission_unknown: "submission_uncertain",
    video_submission_unknown: "submission_uncertain",
    video_delivery_failed: "delivery_failed",
    image_result_unknown: "submission_uncertain",
    image_submission_pending: "submission_uncertain",
    image_result_expired: "submission_uncertain",
    image_result_unavailable: "submission_uncertain",
    idempotency_conflict: "submission_uncertain",
    provider_reference_invalid: "input_inaccessible",
};

export const DEFAULT_GENERATION_ERROR_MESSAGE = "Build failed. Please review the details before trying again.";
export const CONTENT_MODERATION_MESSAGE = "The prompt word failed content security review. Please modify the prompt word or reference picture and regenerate.";

export const HTML_BODY = /^\s*(?:<!doctype|<html|<head|<body)/i;
export const LOCAL_DATABASE_ERROR = /(?:^|:\s*)(?:table\s+[a-z0-9_]+\s+has no column named\s+[a-z0-9_]+|no such (?:column|table):\s*[a-z0-9_.]+|(?:UNIQUE|NOT NULL|CHECK) constraint failed:\s*\S+|FOREIGN KEY constraint failed|database (?:is locked|is malformed)|database disk image is malformed|attempt to write a readonly database|disk I\/O error)(?:\b|$)/i;
const HTTP_STATUS = /(?:HTTP\s+|status(?:[_\s]+code)?\s*[:：=]?\s*)(\d{3})\b/i;
const WRAPPED_HTTP_STATUS = /Request failed with status code\s+(\d{3})/i;
const URL_PATTERN = /(?:https?:\/\/|file:\/\/|data:[a-z0-9.+-]+\/[^;]+;base64,)[^\s"'<>]+/gi;
const SECRET_PATTERN = /(?:[a-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?key|client[_-]?secret|private[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token)|authorization|bearer|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,})[^\s,;]*/gi;
const PROMPT_KEY = String.raw`(?:(?:choices|messages|message|delta|parts|input|prompt|contents?|system[_-]?instruction)(?:(?:.d+|[d+]|.[a -z0-9_]+)+)?|(?:(?:user|system)[_-]?)?prompt(?:[_-]?text)?|input(?:[_-]?text)?|query|content|text|prompt word|input content)`;
const PROMPT_ECHO = new RegExp(String.raw`(["']?${PROMPT_KEY}["']?\s*[=:：]\s*)(?:"[^"]{0,400}"|'[^']{0,400}'|\S{1,400})`, "gi");
// (?<![\s\S]) means "start of text". A literal ^ inside the leading optional group
// makes older WebKit (desktop WebView on older macOS/Linux) try only position 0, so
// a credential in mid-message would survive.
const CREDENTIAL_TAIL = /(?:(?<![\s\S])(?:invalid|missing|bad|expired|unauthorized|error)\s*[:：]?\s*)?["']?(?:(?:invalid|missing|bad|expired|unauthorized|aws|oss|cos|qiniu|x|goog|openai|anthropic|gemini|azure|bearer|auth|session|access|refresh|client|private|secret|api|app|service|signing)[\s_-]+)*(?:[a-z0-9_-]*(?:key(?:[\s_-]?id)?|secret|token|password|passwd|credential|signature)|authorization|proxy-authorization|cookie|set-cookie)["']?\s*[=:：][\s\S]*/i;
const UNSTRUCTURED_PROMPT_TAIL = new RegExp(
    String.raw`(?:(?:^(?:bad\s+request|invalid\s+request|error)\s*[:：]\s*)?\{?\s*)?(?:["']?(?:[a-z0-9_]+(?:\.\d+|\[\d+\]|\.)+)*${PROMPT_KEY}["']?\s*[=:：]|(?:(?:invalid\s+value\s+)?(?:for|parameter|param|field)\s+["']?${PROMPT_KEY}["']?(?:\s*[:=：]|\s+(?:contains|is)\b)?|\b(?:the\s+)?["']?${PROMPT_KEY}["']?\s+(?:field|parameter|param)\s+(?:contains|is|was)\b)|\{[^{}]*"(?:text|content|prompt|input|messages|query)"\s*:[\s\S]*)[\s\S]*`,
    "i",
);
const SIGNED_QUERY = /(?:[?&](?:signature|x-amz-signature|x-oss-signature|token|key)=)[^\s&]+/gi;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const UNSAFE_ID = /secret|token|password|apikey|api-key|bearer|sk-/i;

export type ExtractedFields = {
    code: string;
    type: string;
    status: string;
    message: string;
    param: string;
    requestId: string;
    taskId: string;
};

export type Classified = {
    category: GenerationErrorCategory;
    reason?: string;
    action?: string;
    providerCode?: string;
    requestId?: string;
    taskId?: string;
    status?: number;
    fromCode?: boolean;
    uncertain?: boolean;
    retryable?: boolean;
};

export function referenceDurationCopy(text: string): CategoryCopy | undefined {
    const audio = referenceAudioCopy(text);
    if (audio) return audio;
    // 当前提示写法：说清哪一项、现在多少、要改到多少，动作由后端给出。
    const actionable = text.match(/^((?:第 \d+ 段)?(?:参考)?(?:音频|视频)(?:「[^」]*」)?)时长为 (\d+(?:\.\d+)?) 秒[，。]需要改到 ([^；;]+)[；;](.+?)。?$/);
    if (actionable) return { reason: `${actionable[1]}The duration is${actionable[2]} seconds`, action: `Need to change to${actionable[3]}；${actionable[4]}` };
    // 旧版本已存进对话记录里的写法，继续按原样解释。
    const numbered = text.match(/^第 (\d+) 段参考(音频|视频)时长为 (\d+(?:\.\d+)?) 秒[，。]需要 (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) 秒/);
    if (numbered) return { reason: `No.${numbered[1]} Section reference${numbered[2]}The duration is${numbered[3]} seconds`, action: `need${numbered[4]}–${numbered[5]} seconds; please crop or replace this material before submitting` };
    // 输出时长不在模型范围内：写出现在的值和可选时长。
    const output = text.match(/^输出时长为 ([\d.]+) 秒[，。]当前模型只支持 ([^；;]+)[；;](.+?)。?$/);
    if (output) return { reason: `The output duration is${output[1]} seconds`, action: `The current model only supports${output[2]}；${output[3]}` };
    const missing = text.match(/^第 (\d+) 段参考(音频|视频)的时长无法读取/);
    if (missing) return { reason: `No.${missing[1]} Section reference${missing[2]}The duration cannot be read`, action: "Please re-import the material before submitting" };
}

export function referenceAudioCopy(text: string, invalidAudio = false): CategoryCopy | undefined {
    const duration = text.match(/^reference audio (\d+) is (\d+(?:\.\d+)?) seconds; use audio between (\d+(?:\.\d+)?) and (\d+(?:\.\d+)?) seconds/i);
    if (duration) return { reason: `No.${duration[1]} The length of the reference audio segment is${duration[2]} seconds`, action: `need${duration[3]}–${duration[4]} seconds; please crop or replace this material before submitting` };
    const total =
        text.match(/^reference audio is (\d+(?:\.\d+)?) seconds in total; this model accepts at most (\d+(?:\.\d+)?) seconds of reference audio/i) || text.match(/^参考音频总时长为 (\d+(?:\.\d+)?) 秒[。，](?:该|当前)模型最多支持 (\d+(?:\.\d+)?) 秒/);
    if (total) return { reason: `The total duration of the reference audio is${total[1]} seconds`, action: `This model supports up to${total[2]} seconds reference audio; please crop or reduce the reference audio before submitting` };
    const numbered = text.match(/^reference audio (\d+)(?::| requires| exceeds)/i);
    const label = numbered ? `No.${numbered[1]} segment reference audio` : "Reference audio";
    const issue =
        invalidAudio || numbered
            ? /15 MiB|byte limit|at most.*MiB/i.test(text)
                ? "File too large"
                : /duration could not be measured|invalid.*audio|unsupported|readable audio track/i.test(text)
                  ? "The format or duration cannot be read"
                  : /download|HTTPS URL|URL.*(?:policy|allowed)|redirect|readable within/i.test(text)
                    ? "Unable to download"
                    : "Does not meet model requirements"
            : "";
    if (!issue) return;
    const actions: Record<string, string> = {
        无法下载: "Please re-upload the audio and confirm that the material link is publicly accessible before submitting.",
        的格式或时长无法读取: "Please re-export the audio as MP3 or WAV and make sure the file is complete and contains audio tracks before uploading",
        文件过大: "Please compress or replace the audio to ensure that the file does not exceed the model size limit before submitting.",
        不符合模型要求: "Please check the duration, format and size of the reference audio and adjust it before submitting.",
    };
    return { reason: `${label}${issue}`, action: actions[issue] };
}

const GATEWAY_REQUEST_ID_SUFFIX = /\s*\((?:request\s*id|请求编号|請求編號)\s*[:：]\s*([A-Za-z0-9._:-]{6,127})\)\s*$/i;
export const EMBEDDED_REQUEST_ID = /(?:\brequest\s*id|请求编号|請求編號)\s*[:：]\s*([A-Za-z0-9._:-]{6,127})\b/i;

export function stripGatewayRequestIdSuffix(raw: string): { text: string; requestId: string } {
    const suffix = raw.match(GATEWAY_REQUEST_ID_SUFFIX);
    if (!suffix || suffix.index === undefined) return { text: raw, requestId: "" };
    return { text: raw.slice(0, suffix.index).trim(), requestId: sanitizeDebugId(suffix[1]) };
}

export function extractProviderFields(raw: string): ExtractedFields {
    const fields = emptyFields();
    if (raw.length > 16384) return fields;
    const stripped = stripGatewayRequestIdSuffix(raw);
    raw = stripped.text;
    const tryParse = (value: string) => {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                Object.assign(fields, walkProviderFields(parsed as Record<string, unknown>, 0));
                fields.requestId ||= stripped.requestId;
            }
        } catch {
            return;
        }
    };
    tryParse(raw.trim());
    if (fields.message.startsWith("{") || fields.message.startsWith("[")) {
        const nested = emptyFields();
        try {
            const parsed = JSON.parse(fields.message) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(nested, walkProviderFields(parsed as Record<string, unknown>, 0));
        } catch {
            /* keep outer fields */
        }
        if (nested.message) fields.message = nested.message;
        if (nested.code) fields.code = nested.code;
        if (nested.type) fields.type = nested.type;
    }
    if (fields.message || fields.code) return fields;
    for (let index = raw.indexOf("{"); index >= 0; index = raw.indexOf("{", index + 1)) {
        tryParse(raw.slice(index).trim());
        if (fields.message || fields.code) return fields;
    }
    return fields;
}

function walkProviderFields(payload: Record<string, unknown>, depth: number): ExtractedFields {
    const fields = emptyFields();
    if (depth > 5) return fields;
    fields.code = allowlistedString(payload.code);
    fields.type = allowlistedString(payload.type);
    fields.status = allowlistedString(payload.status);
    fields.message = allowlistedString(payload.message) || allowlistedString(payload.msg) || allowlistedString(payload.detail);
    fields.param = allowlistedString(payload.param) || allowlistedString(payload.parameter);
    fields.requestId = allowlistedString(payload.request_id) || allowlistedString(payload.requestId) || allowlistedString(payload["request-id"]);
    fields.taskId = allowlistedString(payload.task_id) || allowlistedString(payload.taskId);
    const nested = [payload.error, payload.data, payload.output, payload.promptFeedback].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    for (const child of nested) {
        const walked = walkProviderFields(child, depth + 1);
        if (!fields.code || (child === payload.error && walked.code)) fields.code = walked.code;
        if (!fields.type) fields.type = walked.type;
        if (!fields.status) fields.status = walked.status;
        if (!fields.message || (child === payload.error && walked.message)) fields.message = walked.message;
        if (!fields.param) fields.param = walked.param;
        if (!fields.requestId) fields.requestId = walked.requestId;
        if (!fields.taskId) fields.taskId = walked.taskId;
        if (allowlistedString(child.blockReason)) {
            fields.code = fields.code || allowlistedString(child.blockReason);
            fields.message = fields.message || "blocked by content safety policy";
        }
    }
    return fields;
}

export function categoryFromProviderCode(...values: string[]): GenerationErrorCategory | "" {
    for (const value of values) {
        const normalized = normalizeCode(value);
        if (!normalized || normalized === "0" || normalized === "success" || normalized === "ok") continue;
        if ((GENERATION_ERROR_CATEGORIES as readonly string[]).includes(normalized)) return normalized as GenerationErrorCategory;
        if (PROVIDER_CODE_CATEGORIES[normalized]) return PROVIDER_CODE_CATEGORIES[normalized];
        const moderationCopy = moderationErrorCopy(normalized, "");
        if (moderationCopy) return moderationCopy.category;
        if (/^sensitivecontentdetected(?:\.|$)/.test(normalized)) return "moderation_input";
        if (normalized.includes("content_filter") || normalized.includes("contentpolicy") || normalized.includes("sensitive_words")) return "moderation_input";
        if (normalized.includes("insufficient") && (normalized.includes("quota") || normalized.includes("balance"))) return "quota_unknown";
        if (normalized.includes("rate_limit") || normalized.includes("throttl")) return "throttled";
        if (normalized.includes("context_length") || normalized.includes("max_tokens")) return "context_too_long";
        if (normalized.includes("model_not") || normalized.includes("invalid_model")) return "model_missing";
        if (normalized.includes("auth") && (normalized.includes("invalid") || normalized.includes("fail") || normalized.includes("unauth"))) return "auth";
        if (normalized.includes("permission") || normalized.includes("forbidden")) return "permission";
    }
    return "";
}

export function referenceMediaConstraintCopy(text: string): CategoryCopy | undefined {
    text = stripGatewayRequestIdSuffix(text.split(". Check number:", 1)[0].trim()).text;
    if (text.startsWith("The current channel requires online material links:")) {
        const [reason, ...action] = text.split("。");
        return { reason, action: action.join("。") };
    }
    const modelReferenceLimit = text.match(/^(当前模型(?:暂不支持参考(?:图片|图|视频|音频)|(?:最多支持|至少需要) \d+ (?:张|个|段)?参考(?:图片|图|视频|音频)|不支持仅使用参考音频))[，。](请[^\n]+?)[。.]?$/);
    if (modelReferenceLimit) return { reason: modelReferenceLimit[1], action: modelReferenceLimit[2] };
    const unreadableFps = text.match(/^(第 \d+ 个参考视频帧率无法读取)/);
    if (unreadableFps) return {reason:unreadableFps[1],action:"Please re-export the MP4/MOV video before uploading, making sure the file is complete and contains a valid video track"};
    const measuredFps = text.match(/^(第 \d+ 个参考视频平均帧率为 \d+(?:\.\d+)? FPS)[，。](?:需要 |请将参考视频重新导出为 )(\d+)–(\d+) FPS/);
    if (measuredFps) return { reason: measuredFps[1], action: `Please re-export the reference video as${measuredFps[2]}–${measuredFps[3]} Submit after FPS` };
    const fps = text.match(/^(?:素材转换失败:\s*)?(?:frame rate|framerate|fps) must be between (\d+(?:\.\d+)?)\s*(?:fps)? and (\d+(?:\.\d+)?)[.\s]*$/i);
    if (fps) return { reason: "The frame rate of the reference video does not meet the requirements", action: `Please re-export the reference video as${fps[1]}–${fps[2]} Submit after FPS` };
    if (/^(?:素材转换失败:\s*)?(?:unsupported (?:video |audio )?codec|(?:video |audio )?codec (?:is )?not supported)[.\s]*$/i.test(text)) return { reason: "Reference material encoding is not supported by the current model", action: "Please re-export the video to the common H.264 MP4 and the audio to MP3 or WAV before replacing the material; just modifying the file suffix will not work." };
    if (/^asset (?:is )?(?:not ready|still processing)[.\s]*$/i.test(text)) return { reason: "Reference material is still being processed", action: "Please confirm and process the material library before generating it again. Do not upload or submit repeatedly." };
    if (/^asset (?:access denied|permission denied|forbidden)[.\s]*$/i.test(text)) return { reason: "No access to reference material", action: "Please use the account and channel that uploaded the material, or re-upload the original file; check the material permissions, no need to modify the prompt word" };
    const single = text.match(/^(第 \d+ (?:张|个|段)参考(?:图|视频|音频)(?:宽度|高度|宽高比|时长)为 \d+(?:\.\d+)?(?: 像素| 秒)?)[，。]需要 ((?:至少|不超过) \d+(?:\.\d+)?(?: 像素| 秒)?)/);
    if (single) return { reason: single[1], action: `need${single[2]}；${single[1].includes("duration") ? "Please crop or replace this material before submitting" : "Please adjust the size or replace before submitting"}` };
    const size = text.match(/^第 (\d+) (张|个|段)参考(图|视频|音频)(宽度|高度)为 (\d+) 像素[，。]需要 (\d+)–(\d+) 像素/);
    if (size) return { reason: `No.${size[1]} ${size[2]}Reference${size[3]}${size[4]}for${size[5]} Pixel`, action: `need${size[6]}–${size[7]} Pixels; please adjust the size or replace before submitting` };
    const aspect = text.match(/^第 (\d+) (张|个|段)参考(图|视频|音频)宽高比为 (\d+(?:\.\d+)?)[，。]需要 (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)/);
    if (aspect) return { reason: `No.${aspect[1]} ${aspect[2]}Reference${aspect[3]}The aspect ratio is${aspect[4]}`, action: `need${aspect[5]}–${aspect[6]};Please adjust the size or replace before submitting.` };
    const videoDuration = text.match(/^(第 \d+ 个参考视频时长为 \d+(?:\.\d+)? 秒)，需要 (\d+)–(\d+) 秒/);
    if (videoDuration) return { reason: videoDuration[1], action: `Please crop or replace this reference video with${videoDuration[2]}–${videoDuration[3]} seconds` };
    const videoRead = text.match(/^第 (\d+) 个参考视频[：:]?(?:参考视频)?(?:尺寸|时长)?(?:下载失败|无法读取|无法完整读取|数据无法读取|分段读取失败|在读取期间发生变化|时长无法读取|尺寸无法读取)/);
    if (videoRead) return { reason: `No.${videoRead[1]} reference videos cannot be read`, action: "Please check the material link, or re-export the MP4/MOV file and import it" };
    const videoFormat = text.match(/^第 (\d+) 个参考视频[：:]?(?:参考视频)?需使用/);
    if (videoFormat) return { reason: `No.${videoFormat[1]} The reference video format or address is not supported`, action: "Please import an MP4/MOV file or use a publicly accessible HTTP/HTTPS video link" };
    const videoBytes = text.match(/^第 (\d+) 个参考视频[：:]?(?:参考视频)?文件不能超过 (\d+)MB/);
    if (videoBytes) return { reason: `No.${videoBytes[1]} Reference video file is too large`, action: `Please compress to${videoBytes[2]}Within MB or change the material` };
    const videoSize = text.match(/^(第 \d+ 个参考视频尺寸为 \d+×\d+)，需要宽高均在 (\d+)–(\d+) 像素之间/);
    if (videoSize) return { reason: videoSize[1], action: `Please adjust the width and height of this reference video to${videoSize[2]}–${videoSize[3]} Pixel` };
    const pixelDetail = text.match(/^(第 \d+ (?:张|个|段)参考(?:图|视频|音频)像素总量为 \d+（\d+×\d+）)[，。]需要 ([^；]+) 像素/);
    if (pixelDetail) return { reason: pixelDetail[1], action: `need${pixelDetail[2]} Pixels; please adjust the size of this material or replace the original file. Modifying the generated resolution will not change the reference material.` };
    const unknownSize = text.match(/^(第 \d+ 个参考视频尺寸无法读取)/);
    if (unknownSize) return { reason: unknownSize[1], action: "Please re-export MP4/MOV and then import" };
    const pixels = text.match(/^第 (\d+) (张|个|段)参考(图|视频|音频)像素总量/);
    if (pixels) return { reason: `No.${pixels[1]} ${pixels[2]}Reference${pixels[3]}The total number of pixels does not meet the current model requirements`, action: "Please adjust the size or replace before submitting" };
    const file = text.match(/^第 (\d+) (张|个|段)参考(图|视频|音频)文件过大[，。]当前模型单文件上限为 ([^；;]+)/);
    if (file) return { reason: `No.${file[1]} ${file[2]}Reference${file[3]}File too large`, action: `The current upper limit of a single model file is${file[4]};Please compress or replace before submitting.` };
    if (text.startsWith("The total number of reference materials requested is too large")) return { reason: "The total number of reference materials requested is too large", action: "Please reduce the number of materials before submitting" };
}

export function categoryFromProviderMessage(raw: string): GenerationErrorCategory | "" {
    const normalized = sanitizeProviderText(raw).toLowerCase();
    if (!normalized.trim()) return "";
    if (/duration\s+(?:must|should)\s+be\s+between\s+\d/.test(normalized)) return "invalid_params";
    if (
        /(?:width|height)\s+(?:must|should)\s+be\s+between\s+\d/.test(normalized) ||
        /aspect(?:\s*ratio)?\s+(?:must|should)\s+be\s+between/.test(normalized) ||
        /(?:pixel(?:s)?(?:\s+count)?|total\s+pixels)\s+(?:must|should)\s+be\s+between/.test(normalized)
    )
        return "invalid_params";
    if (((normalized.includes("thinking") || normalized.includes("reasoning")) && normalized.includes("tool_choice")) || (normalized.includes("tool_choice") && (normalized.includes("not support") || normalized.includes("unsupported"))))
        return "invalid_params";
    const moderationCopy = moderationErrorCopy("", normalized);
    if (moderationCopy) return moderationCopy.category;
    if (containsContentSafety(normalized)) return moderationCategoryFromMessage(normalized);
    if (normalized.startsWith("The current account balance is insufficient")) return "quota_user";
    if (normalized.includes("insufficient_quota") || ((normalized.includes("quota") || normalized.includes("balance") || normalized.includes("Quota") || normalized.includes("Balance") || normalized.includes("Arrears")) && !normalized.includes("rate")))
        return normalized.includes("arrearage") || normalized.includes("billing_hard_limit") ? "quota_upstream" : "quota_unknown";
    if (normalized.includes("rate limit") || normalized.includes("too many requests") || normalized.includes("throttl") || normalized.includes("Frequently")) return "throttled";
    if (normalized.includes("context length") || normalized.includes("too many tokens") || normalized.includes("max_tokens") || (normalized.includes("length") && (normalized.includes("maximum") || normalized.includes("beyond")))) return "context_too_long";
    if (normalized.includes("model_not_found") || normalized.includes("model not found") || normalized.includes("Model does not exist") || normalized.includes("405 method not allowed") || normalized.includes("method not allowed") || normalized.includes("http 405") || normalized.includes("status 405")) return "model_missing";
    if (normalized.includes("invalid api key") || normalized.includes("incorrect api key") || normalized.includes("authentication") || normalized.includes("unauthorized") || normalized.includes("Authentication failed")) return "auth";
    if (normalized.includes("permission") && (normalized.includes("denied") || normalized.includes("model") || normalized.includes("access"))) return "permission";
    if (normalized.includes("url error") || normalized.includes("failed to download") || normalized.includes("cannot fetch") || normalized.includes("invalid image url") || normalized.includes("Unable to read")) return "input_inaccessible";
    if (normalized.includes("too large") || normalized.includes("payload too large") || normalized.includes("Too big") || /(?:request|payload).{0,24}(?:exceeds?|larger than)/i.test(normalized))
        return "input_too_large";
    if (normalized.includes("invalid") || normalized.includes("parameter") || normalized.includes("argument")) return "invalid_params";
    return "";
}

function containsContentSafety(normalized: string) {
    return (
        /\brejected (?:by the|as a result of (?:our|the)) safety system\b/.test(normalized) ||
        normalized.includes("contentmoderationfailed") ||
        normalized.includes("invalidparameter.voilationcontent") ||
        normalized.includes("invalidparameter.violationcontent") ||
        normalized.includes("sensitive_words_detected") ||
        normalized.includes("content policy") ||
        normalized.includes("content safety") ||
        normalized.includes("safety policy") ||
        normalized.includes("data inspection") ||
        normalized.includes("prohibited_content") ||
        (normalized.includes("blocked by") && (normalized.includes("safety") || normalized.includes("policy") || normalized.includes("content"))) ||
        (normalized.includes("safety") && (normalized.includes("blocked") || normalized.includes("violat") || normalized.includes("filter")))
    );
}

export function moderationCategoryFromMessage(normalized: string): GenerationErrorCategory {
    if (/prompt\s+(?:or|and)\s+(?:reference|input)/.test(normalized)) return "moderation_input";
    if (normalized.includes("reference image") || normalized.includes("input image")) return "moderation_reference";
    if (normalized.includes("output") && (normalized.includes("image") || normalized.includes("video") || normalized.includes("result"))) return "moderation_output";
    return "moderation_input";
}

export function categoryFromHttpStatus(status: number): GenerationErrorCategory {
    if (status === 401) return "auth";
    if (status === 403) return "permission";
    if (status === 402) return "quota_unknown";
    if (status === 404 || status === 405 || status === 501) return "model_missing";
    if (status === 408 || status === 504 || status === 524) return "timeout";
    if (status === 409) return "invalid_params";
    if (status === 413) return "input_too_large";
    if (status === 400 || status === 422) return "invalid_params";
    if (status === 429) return "throttled";
    if (status >= 500) return "provider_unavailable";
    return "unknown";
}

export function trustProviderMessageStatus(status?: number) {
    if (!status) return true;
    if (status >= 200 && status < 300) return true;
    return status === 400 || status === 402 || status === 409 || status === 413 || status === 422 || status === 429 || status === 451;
}

export function extractExplicitHttpStatus(raw: string) {
    const match = raw.match(HTTP_STATUS) || raw.match(WRAPPED_HTTP_STATUS);
    const status = match ? Number(match[1]) : 0;
    return status >= 400 && status <= 599 ? status : 0;
}

export function explanationCopy(classified: Classified): CategoryCopy {
    if (classified.reason) return { reason: classified.reason, action: classified.action || "" };
    return CATEGORY_COPY[classified.category] || CATEGORY_COPY.unknown;
}

export function debugIdLine(taskId?: string, requestId?: string) {
    const parts = [sanitizeDebugId(taskId) ? `Task${sanitizeDebugId(taskId)}` : "", sanitizeDebugId(requestId) ? `Request${sanitizeDebugId(requestId)}` : ""].filter(Boolean);
    return parts.length ? `Check number:${parts.join(" · ")}` : "";
}

export function joinSentences(...parts: Array<string | undefined>): string {
    const out = parts.map((part) => (part || "").trim().replace(/[。.;；]+$/u, "")).filter(Boolean);
    if (!out.length) return DEFAULT_GENERATION_ERROR_MESSAGE;
    if (out.length === 1) return out[0];
    return `${out.join("。")}。`;
}

export function sanitizeDebugId(value?: string) {
    const text = (value || "").trim();
    if (!text || text.length > 80 || !SAFE_ID.test(text) || UNSAFE_ID.test(text)) return "";
    return text;
}

export function sanitizeProviderCode(value: string) {
    const text = value.trim();
    return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(text) && !/^(?:sk-|eyJ)|secret|password|bearer/i.test(text) ? text : "";
}

export function sanitizeProviderText(value: string) {
    let text = value.trim();
    if (!text || HTML_BODY.test(text) || /<\/?[a-z!][^>]*>/i.test(text)) return "";
    text = text.replace(URL_PATTERN, "");
    // Unstructured messages may echo whole headers or prompts; discard the suffix,
    // since a whitespace-based token matcher cannot know where a secret ends.
    text = text.replace(CREDENTIAL_TAIL, "").replace(UNSTRUCTURED_PROMPT_TAIL, "[hidden]");
    text = text.replace(/(?:file:\/\/[^\r\n"'<>]+|(?<![a-z])[a-z]:[\\/][^\r\n:"'<>]+|\\\\[^\r\n:"'<>]+|(?<![A-Za-z0-9._-])\/+(?:Users|home|private|tmp|var|Volumes|mnt|media|run|root|opt|srv|etc|data|app|workspace|usr|proc|sys|dev|lib|bin|sbin)\/[^\r\n:"'<>]+)/gi, "[path hidden]");
    text = text.replace(SIGNED_QUERY, "").replace(SECRET_PATTERN, "").replace(PROMPT_ECHO, "$1[hidden]");
    text = text.replace(/\s+/g, " ").trim();
    if (text.startsWith("{") || text.startsWith("[") || text.startsWith("<")) return "";
    return text.slice(0, 240);
}

export function normalizeCode(value: string) {
    return value.toLowerCase().trim().replace(/-/g, "_").replace(/\s+/g, "_");
}

export function allowlistedString(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && value !== 0) return String(value);
    return "";
}

export function numericStatus(value: unknown) {
    if (typeof value === "number" && value >= 400 && value <= 599) return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) {
        const status = Number(value);
        return status >= 400 && status <= 599 ? status : undefined;
    }
    return undefined;
}

export function stringifyAllowlisted(value: unknown) {
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}

export function emptyFields(): ExtractedFields {
    return { code: "", type: "", status: "", message: "", param: "", requestId: "", taskId: "" };
}

export function isModerationCategory(value: string) {
    return value === "moderation_input" || value === "moderation_reference" || value === "moderation_output" || value === CONTENT_MODERATION_ERROR_CODE;
}

export function retryableCategory(category: GenerationErrorCategory) {
    return category === "throttled" || category === "provider_unavailable" || category === "network" || category === "timeout" || category === "concurrency" || category === "request_not_sent";
}

export function isNetworkText(value: string) {
    return /\b(?:dial tcp|connection refused|connection reset|forcibly closed by the remote host|software caused connection abort|connection was aborted by the software in your host machine|wsaeconnreset|wsaeconnaborted|no such host|i\/o timeout|context deadline exceeded|network error|failed to fetch|fetch failed|socket hang up|econnrefused|econnreset|etimedout)\b/i.test(value);
}

export function isMalformedText(value: string) {
    return /(?:接口返回非 JSON|没有返回有效 JSON|invalid character|unexpected end of json|<!doctype|<html)/i.test(value);
}

export function isDownloadText(value: string) {
    return value.includes("Video result download failed") || (value.includes("Download failed") && value.includes("result"));
}

export function isCancelledText(value: string) {
    return value.includes("Task canceled") || value.includes("Request canceled") || /context canceled/i.test(value);
}

export function isResultsMissingText(value: string) {
    return value.includes("No pictures returned") || value.includes("No video returned") || value.includes("No results available") || value.includes("The interface did not return");
}

export function isCanvasSaveConflictText(text: string) {
    return (
        text.includes("Cloud Canvas has been updated") ||
        text.includes("Coverage has stopped") ||
        text.includes("Canvas has version conflict") ||
        text.includes("Build results preserved, but canvas has version conflict") ||
        text.includes("The canvas has unhandled external changes") ||
        text.startsWith(CATEGORY_COPY.canvas_conflict.reason)
    );
}

const LOCAL_PATH_PATTERN = /(?:file:\/\/[^\r\n"'<>]+|(?<![a-z])[a-z]:[\\/][^\r\n:"'<>]+|\\\\[^\r\n:"'<>]+|(?<![A-Za-z0-9._-])\/+(?:Users|home|private|tmp|var|Volumes|mnt|media|run|root|opt|srv|etc|data|app|workspace|usr|proc|sys|dev|lib|bin|sbin)\/[^\r\n:"'<>]+)/i;
const GENERIC_CHINESE_WRAPPERS = new Set([
    "",
    "Request failed",
    "Operation failed",
    "Build failed",
    "Task failed",
    "Stopped",
    "call failed",
    "unknown error",
    "Parameter error",
    "Request parameter error",
    "Invalid parameter",
    "Invalid parameter",
    "Model service request failed",
    `${CATEGORY_COPY.unknown.reason}。${CATEGORY_COPY.unknown.action}`,
]);

export function isActionableParameterCopy(copy: CategoryCopy): boolean {
    const reason = copy.reason.trim();
    const action = copy.action.trim();
    if (/^(?:请稍后|请查看|请先查询|请联系支持|请重试|点击「)/.test(action)) return false;
    if (/(?:生成失败|请求失败|操作失败|任务失败|调用失败|模型服务请求失败|暂时不可用|服务繁忙|系统繁忙|频率|频繁|限流|并发)/.test(reason)) return false;
    if (!/(?:模型|参考|素材|图片|视频|音频|首帧|尾帧|首尾帧|文件|参数|尺寸|分辨率|比例|时长|帧率|编码|格式|提示词|无法识别)/.test(reason)) return false;
    if (/(?:调整|减少|更换|裁剪|重新导出|上传|移除|修改|缩短|压缩|图片用|视频用|音频用)/.test(action)) return true;
    return !action && /(?:不支持|仅支持|只支持|最多支持|至少需要|无法识别文件)/.test(reason);
}

export function userFacingChineseCopy(raw: string): CategoryCopy | undefined {
    let trimmed = raw.trim();
    if (!trimmed || HTML_BODY.test(trimmed) || /[{}<>]/.test(trimmed)) return undefined;
    if (
        /(?:https?:\/\/|file:\/\/|data:[a-z0-9.+-]+\/[^;]+;base64,)/i.test(trimmed) ||
        /(?:[?&](?:signature|x-amz-signature|x-oss-signature|token|key)=)/i.test(trimmed) ||
        CREDENTIAL_TAIL.test(trimmed) ||
        UNSTRUCTURED_PROMPT_TAIL.test(trimmed) ||
        /(?:[a-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?key|client[_-]?secret|private[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token)|authorization|bearer|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,})/i.test(trimmed) ||
        new RegExp(String.raw`["']?${PROMPT_KEY}["']?\s*[=:：]`, "i").test(trimmed) ||
        LOCAL_PATH_PATTERN.test(trimmed) ||
        LOCAL_DATABASE_ERROR.test(trimmed) ||
        containsInfrastructureDetails(trimmed) ||
        /(?:status(?:[_\s]+code)?\s*[:=]|素材转换失败:|无可用渠道|暂无可用渠道)/i.test(trimmed)
    ) {
        return undefined;
    }
    trimmed = stripGatewayRequestIdSuffix(trimmed.split(". Check number:", 1)[0].trim()).text;
    let clean = sanitizeProviderText(trimmed);
    if (!clean || clean.includes("[hidden]") || clean.includes("[path hidden]") || !/[\u4e00-\u9fff]/.test(clean)) return undefined;
    clean = clean.replace(/。+$/u, "").trim();
    if (GENERIC_CHINESE_WRAPPERS.has(clean)) return undefined;
    if (isNetworkText(clean) || isDownloadText(clean) || isCancelledText(clean) || isResultsMissingText(clean)) return undefined;
    const hanCount = (clean.match(/[\u4e00-\u9fff]/g) || []).length;
    if (hanCount < 6 && !/[。，；：]/.test(clean)) return undefined;
    const sentenceIdx = clean.indexOf("。");
    if (sentenceIdx > 0 && clean.slice(sentenceIdx + 1).trim()) {
        return { reason: clean.slice(0, sentenceIdx).trim(), action: clean.slice(sentenceIdx + 1).trim() };
    }
    for (const sep of [", please", ";please"] as const) {
        const idx = clean.indexOf(sep);
        if (idx > 0) return { reason: clean.slice(0, idx).trim(), action: `please${clean.slice(idx + sep.length).trim()}` };
    }
    return { reason: clean, action: "" };
}

export function containsInfrastructureDetails(value: string) {
    return /(?:接口请求失败|Request failed with status code|https?:\/\/|\b(?:GET|POST|PUT|PATCH|DELETE)\s+["']?|Bad Gateway|Service Unavailable|Gateway Timeout|upstream_error)/i.test(value);
}

export function providerPayloadMessage(payload: unknown, depth = 0): string {
    if (depth > 5) return "";
    if (typeof payload === "string") {
        const trimmed = payload.trim();
        if (trimmed.startsWith("{") || /^(?:接口请求失败|请求失败|upstream_error|http\s*\d{3})[^A-Za-z0-9{]*\{/i.test(trimmed)) {
            const extracted = extractProviderFields(trimmed).message;
            if (extracted) return extracted;
        }
        return trimmed;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const record = payload as Record<string, unknown>;
    if (record.error && typeof record.error === "object") {
        const nested = providerPayloadMessage(record.error, depth + 1);
        if (nested) return nested;
    }
    for (const key of ["message", "msg", "detail"] as const) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return providerPayloadMessage(value, depth + 1);
    }
    for (const key of ["data", "body", "response"] as const) {
        const value = record[key];
        if (value && (typeof value === "object" || typeof value === "string")) {
            const nested = providerPayloadMessage(value, depth + 1);
            if (nested) return nested;
        }
    }
    return typeof record.error === "string" ? providerPayloadMessage(record.error, depth + 1) : "";
}
