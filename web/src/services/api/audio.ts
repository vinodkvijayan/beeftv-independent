import { audioMimeType, audioSpeechKind, buildAudioSpeechRequest, normalizeAudioFormatValue } from "@/lib/audio-generation";
import { isBeefTVEndpoint } from "@/lib/beeftv-video-contracts";
import { parseSpeechAudioEvents } from "@/lib/audio-speech-events";
import { assertChannelBlob, ChannelResponseError, createChannelTransport, isChannelCancellation } from "@/services/api/channel-transport";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, channelHasGenerationCredential, isBuiltinBeefTVChannel, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function audioTransport(config: AiConfig) {
    return createChannelTransport(config, "audio");
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const selectedModel = (config.model || config.audioModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, selectedModel);
    const format = normalizeAudioFormatValue(config.audioFormat, model);
    const payload = buildAudioSpeechRequest({ ...config, model }, prompt);

    try {
        if (requestConfig.interfaceType === "async-audio") {
            return await requestAsyncAudioGeneration(requestConfig, payload, format, options);
        }
        const useSSE = audioSpeechKind(model) === "minimax-music" && isBeefTVEndpoint(requestConfig.baseUrl);
        if (useSSE) payload.stream_format = "sse";
        let blob = await audioTransport(requestConfig).postBlob(aiApiUrl(requestConfig, "/audio/speech"), payload, { signal: options?.signal, acceptEventStream: useSSE });
        if (useSSE && blob.type.startsWith("text/event-stream")) {
            const result = parseSpeechAudioEvents(await blob.text());
            blob = result.url ? await audioTransport(requestConfig).getExternalBlob(result.url, undefined, options) : new Blob(result.chunks, { type: "audio/mpeg" });
        }
        await assertAudioBlob(blob);
        return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    } catch (error) {
        if (error instanceof ChannelResponseError || isChannelCancellation(error)) throw error;
        throw new Error(readAxiosError(error, "Audio generation failed"));
    }
}

async function requestAsyncAudioGeneration(config: AiConfig, payload: Record<string, unknown>, format: string, options?: RequestOptions) {
    const created = await audioTransport(config).postJson<Record<string, unknown>>(aiApiUrl(config, "/audio/tasks"), payload, options);
    let state = asyncAudioPayload(created);
    const taskId = asyncAudioTaskId(state);
    if (!taskId) throw new Error("Asynchronous audio interface does not return task ID");
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (asyncAudioSucceeded(state)) return downloadAsyncAudio(config, taskId, state, format, options);
        const status = String(state.status || "").toLowerCase();
        if (["failed", "cancelled", "canceled", "expired", "error"].includes(status)) {
            throw new Error(asyncAudioError(state));
        }
        await waitForAudioPoll(options?.signal);
        const polled = await audioTransport(config).get<Record<string, unknown>>(aiApiUrl(config, `/audio/tasks/${encodeURIComponent(taskId)}`), options);
        state = asyncAudioPayload(polled);
    }
    throw new Error(`Asynchronous audio generation timeout (task${taskId}）`);
}

function asyncAudioPayload(payload: Record<string, unknown>): Record<string, unknown> {
    for (const key of ["data", "result", "output"]) {
        const nested = payload[key];
        if (nested && typeof nested === "object" && !Array.isArray(nested)) return { ...payload, ...(nested as Record<string, unknown>) };
    }
    return payload;
}

function asyncAudioTaskId(payload: Record<string, unknown>) {
    for (const value of [payload.id, payload.task_id, payload.request_id]) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}

function asyncAudioSucceeded(payload: Record<string, unknown>) {
    const status = String(payload.status || "").toLowerCase();
    return payload.done === true || ["completed", "succeeded", "success", "done"].includes(status) || (!status && Boolean(asyncAudioResultUrl(payload)));
}

function asyncAudioResultUrl(payload: Record<string, unknown>): string {
    for (const key of ["audio_url", "audioUrl", "result_url", "resultUrl", "output_url", "outputUrl", "url", "data"]) {
        const value = payload[key];
        if (typeof value === "string" && (/^https?:\/\//i.test(value) || value.startsWith("data:audio/"))) return value;
    }
    for (const key of ["audio", "data", "result", "output"]) {
        const value = payload[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const nested = asyncAudioResultUrl(value as Record<string, unknown>);
            if (nested) return nested;
        }
    }
    return "";
}

async function downloadAsyncAudio(config: AiConfig, taskId: string, state: Record<string, unknown>, format: string, options?: RequestOptions) {
    const resultUrl = asyncAudioResultUrl(state);
    let blob: Blob;
    if (resultUrl.startsWith("data:audio/")) {
        blob = await (await fetch(resultUrl, { signal: options?.signal })).blob();
    } else if (/^https?:\/\//i.test(resultUrl)) {
        blob = await audioTransport(config).getExternalBlob(resultUrl, undefined, options);
    } else {
        blob = await audioTransport(config).getBlob(aiApiUrl(config, `/audio/tasks/${encodeURIComponent(taskId)}/content`), options);
    }
    await assertAudioBlob(blob);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

function asyncAudioError(payload: Record<string, unknown>) {
    const error = payload.error;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string" && message.trim()) return message;
    }
    return typeof payload.message === "string" && payload.message.trim() ? payload.message : "Asynchronous audio generation failed";
}

function waitForAudioPoll(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, 2500);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

export function assertAudioConfig(config: AiConfig, selectedModel: string) {
    if (!selectedModel.trim() && !config.model.trim()) throw new Error("Please configure the audio model first");
    if (!config.baseUrl.trim()) throw new Error("Please configure the Base URL first");
    const channel = resolveModelChannel(config, selectedModel || config.model);
    if (!channelHasGenerationCredential(channel, selectedModel || config.model)) {
        throw new Error(isBuiltinBeefTVChannel(channel) ? "Please connect to BeefTV first" : "Please configure API Key first");
    }
    if (config.apiFormat === "gemini") throw new Error("The Gemini calling format does not currently support audio generation, please use the OpenAI format channel.");
}

async function assertAudioBlob(blob: Blob) {
    await assertChannelBlob(blob);
    const mimeType = blob.type.toLowerCase();
    if (mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("text/")) throw new Error(`Upstream returned non-audio content:${mimeType}`);
}

function readAxiosError(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === "AbortError") return "Request canceled";
    return error instanceof Error ? error.message : fallback;
}
