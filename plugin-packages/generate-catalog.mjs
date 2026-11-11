import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const scopes = ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"];
const ref = (path) => ({ $ref: path });
const omit = (value) => ({ $omitEmpty: value });
const coalesce = (...values) => ({ $coalesce: values });
const map = (from, as, body) => ({ $map: { from, as, in: body } });
const filter = (from, as, where) => ({ $filter: { from, as, where } });
const eq = (left, right) => ({ $eq: [left, right] });
const ne = (left, right) => ({ $ne: [left, right] });
const gt = (left, right) => ({ $gt: [left, right] });
const gte = (left, right) => ({ $gte: [left, right] });
const lt = (left, right) => ({ $lt: [left, right] });
const lte = (left, right) => ({ $lte: [left, right] });
const and = (...values) => ({ $and: values });
const len = (value) => ({ $len: value });
const lower = (value) => ({ $lower: value });
const trim = (value) => ({ $trim: value });
const toFloat = (value) => ({ $toFloat: value });
const toInt = (value) => ({ $toInt: value });
const split = (value, separator) => ({ $split: [value, separator] });
const at = (value, index) => ({ $at: [value, index] });
const divide = (left, right) => ({ $divide: [left, right] });
const conditional = (condition, thenValue, elseValue = null) => ({ $if: { condition, then: thenValue, else: elseValue } });
const nonZeroFloat = (value) => conditional(ne(toFloat(value), 0), toFloat(value));
const first = (value) => ({ $first: value });
const sorted = (value) => ({ $sortByOrder: value });
const mediaWithRoles = (path, roles) => filter(sorted(ref(path)), "media", { $in: [ref("media.role"), roles] });
const firstMediaWithRoles = (path, roles) => first(mediaWithRoles(path, roles));
const firstMediaFieldWithRoles = (path, roles, field) => first(map(mediaWithRoles(path, roles), "media", ref(`media.${field}`)));

const textParams = [
  ["model", "string", true, "model", "Upstream model ID."],
  ["messages", "message[]", true, "provider message container", "Contains historical messages and current user input."],
  ["instructions", "string", false, "system/instructions", "System commands."],
  ["temperature", "number", false, "temperature", "Sampling temperature."],
  ["top_p", "number", false, "top_p", "Kernel sampling parameters."],
  ["max_tokens", "integer", false, "max_tokens/max_output_tokens", "Maximum output token."],
  ["tools", "array", false, "tools/toolConfig", "Tool definition."],
  ["tool_choice", "object|string", false, "tool_choice", "Tool selection strategies."],
  ["response_format", "object", false, "response_format/text", "Structured output configuration."],
  ["stream", "boolean", false, "stream", "Streaming switch; background tasks are now normalized to the final response."]
];

const imageParams = [
  ["model", "string", true, "model", "Image model ID."],
  ["prompt", "string", true, "prompt", "Picture prompt words."],
  ["images", "media[]", false, "provider image/reference fields", "Reference diagram or edit source diagram, role is determined by the business layer."],
  ["imageCount", "integer", false, "n/sample_count", "Output quantity."],
  ["aspectRatio", "string", false, "size/aspect_ratio", "Scale or size, semantics specified by protocol."],
  ["resolution", "string", false, "resolution/imageSize", "Resolution level."],
  ["quality", "string", false, "quality", "Quality level."],
  ["providerOptions", "object", false, "provider-specific fields", "Vendor extension fields within the plugin namespace."]
];

const videoParams = [
  ["model", "string", true, "model", "Video model ID."],
  ["prompt", "string", true, "prompt/content/input", "Video prompt words."],
  ["images", "media[]", false, "first/last/reference image", "Explicit role image input."],
  ["videos", "media[]", false, "reference video", "Reference video."],
  ["audios", "media[]", false, "reference audio/voice", "Reference audio or tone."],
  ["duration", "integer", false, "duration/seconds", "Duration in seconds."],
  ["aspectRatio", "string", false, "ratio/aspect_ratio/size", "Aspect ratio or size."],
  ["resolution", "string", false, "resolution", "Resolution level."],
  ["generateAudio", "boolean", false, "generate_audio", "Whether to generate audio."],
  ["watermark", "boolean", false, "watermark", "Watermark switch."],
  ["providerOptions", "object", false, "provider-specific fields", "Vendor extension fields within the plugin namespace."]
];

const audioParams = [
  ["model", "string", true, "model", "Audio model ID."],
  ["prompt", "string", true, "input", "Text to be synthesized."],
  ["providerOptions", "object", false, "provider-specific fields", "Vendor extension fields within the plugin namespace."]
];

const parameters = (items) => items.map(([name, type, required, mapping, description]) => ({ name, type, required, mapping, description }));
const config = (extra = []) => ({
  fields: [
    { name: "apiKey", type: "secret", label: "API Key", required: true },
    ...extra
  ]
});
const bearer = { type: "bearer", field: "apiKey" };
const jsonCreate = (path, body, extra = {}) => ({ method: "POST", path, contentType: "application/json", body, ...extra });
const asyncResponse = (kind, overrides = {}) => ({
  taskId: coalesce(ref("response.id"), ref("response.task_id"), ref("response.taskId"), ref("response.data.id"), ref("taskId")),
  status: coalesce(ref("response.status"), ref("response.state"), ref("response.data.status"), "pending"),
  message: coalesce(ref("response.error.message"), ref("response.message"), ref("response.fail_reason")),
  [kind + "s"]: coalesce(ref(`response.${kind}_url`), ref(`response.${kind}Url`), ref("response.result_url"), ref("response.url"), ref(`response.data.${kind}_url`), ref("response.output.url")),
  errorPaths: ["error.code"],
  resultEphemeral: true,
  ...overrides
});

const specs = [];

function add(spec) {
  specs.push(spec);
}

// 各家 OpenAI 兼容服务（DeepSeek、Kimi、智谱、硅基流动、OpenRouter 等）都走这一个接口，
// 服务商名字和地址只是前端的预设。这些旧 ID 曾各自一份副本，已保存的配置和任务仍可能写着它们。
const openAICompatibleChatAliases = [
  "xai-grok-chat", "deepseek-chat", "mistral-chat", "kimi-chat", "zhipu-glm-chat", "baichuan-chat", "yi-chat",
  "siliconflow-chat", "together-chat", "groq-chat", "fireworks-chat", "nvidia-nim-chat", "openrouter-chat",
  "atlascloud-chat", "litellm-proxy-chat", "newapi-chat", "vllm-chat", "localai-chat"
];

// 选「服务商」时一键带出名字和地址；请求格式完全相同，所以只是数据。本机网关的地址按常见默认端口填写。
const openAICompatibleChatPresets = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { id: "moonshot", label: "Kimi (Dark Side of the Moon)", baseUrl: "https://api.moonshot.cn" },
  { id: "zhipu", label: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "siliconflow", label: "silicon based flow", baseUrl: "https://api.siliconflow.cn" },
  { id: "baichuan", label: "Baichuan", baseUrl: "https://api.baichuan-ai.com" },
  { id: "lingyiwanwu", label: "zero one thing", baseUrl: "https://api.lingyiwanwu.com" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api" },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai" },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz" },
  { id: "fireworks", label: "Fireworks", baseUrl: "https://api.fireworks.ai/inference" },
  { id: "nvidia-nim", label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com" },
  { id: "atlascloud", label: "Atlas Cloud", baseUrl: "https://api.atlascloud.ai" },
  { id: "litellm", label: "LiteLLM (native)", baseUrl: "http://127.0.0.1:4000" },
  { id: "newapi", label: "NewAPI (native)", baseUrl: "http://127.0.0.1:3000" },
  { id: "vllm", label: "vLLM (native)", baseUrl: "http://127.0.0.1:8000" },
  { id: "localai", label: "LocalAI (native)", baseUrl: "http://127.0.0.1:8080" }
];

add({
  id: "openai-chat-completions", providerId: "chat-completion", name: "OpenAI Chat Completions", vendor: "OpenAI", capability: "text",
  baseUrl: "https://api.openai.com", auth: bearer, params: textParams, legacyAliases: openAICompatibleChatAliases, presets: openAICompatibleChatPresets,
  create: jsonCreate("/chat/completions", {
    model: ref("request.model"), messages: ref("request.messages"),
    temperature: omit(ref("request.providerOptions.chat-completion.temperature")),
    top_p: omit(ref("request.providerOptions.chat-completion.top_p")),
    max_tokens: omit(coalesce(ref("request.extra.max_tokens"), ref("request.providerOptions.chat-completion.max_tokens"))),
    tools: omit(ref("request.providerOptions.chat-completion.tools")),
    tool_choice: omit(ref("request.providerOptions.chat-completion.tool_choice")),
    response_format: omit(ref("request.providerOptions.chat-completion.response_format")),
    stream: omit(ref("request.providerOptions.chat-completion.stream")),
    stop: omit(ref("request.providerOptions.chat-completion.stop")),
    seed: omit(ref("request.providerOptions.chat-completion.seed")),
    frequency_penalty: omit(ref("request.providerOptions.chat-completion.frequency_penalty")),
    presence_penalty: omit(ref("request.providerOptions.chat-completion.presence_penalty")),
    logprobs: omit(ref("request.providerOptions.chat-completion.logprobs")),
    top_logprobs: omit(ref("request.providerOptions.chat-completion.top_logprobs")),
    user: omit(ref("request.providerOptions.chat-completion.user")),
    provider: omit(ref("request.providerOptions.chat-completion.provider")),
    transforms: omit(ref("request.providerOptions.chat-completion.transforms")),
    extra_body: omit(ref("request.providerOptions.chat-completion.extra_body"))
  }),
  agent: jsonCreate("/chat/completions", { $merge: [ref("request.extra.agent.chatCompletion"), { model: ref("request.model") }] }),
  agentResponse: { textPaths: ["choices.0.message.content", "choices.0.text"], reasoningPaths: ["choices.0.message.reasoning_content"], toolCallsPath: "choices.0.message.tool_calls", toolCallIdPaths: ["id"], toolCallNamePaths: ["function.name"], toolCallArgumentsPaths: ["function.arguments"] },
  response: { status: "succeeded", textPaths: ["choices.0.message.content", "choices.0.text"], reasoningPaths: ["choices.0.message.reasoning_content"], usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "openai-responses", providerId: "openai-response", name: "OpenAI Responses", vendor: "OpenAI", capability: "text",
  baseUrl: "https://api.openai.com", auth: bearer, params: textParams,
  create: jsonCreate("/responses", {
    model: ref("request.model"),
    input: filter(ref("request.messages"), "message", ne(ref("message.role"), "system")),
    instructions: omit(ref("request.instructions")),
    temperature: omit(ref("request.providerOptions.openai-response.temperature")),
    top_p: omit(ref("request.providerOptions.openai-response.top_p")),
    max_output_tokens: omit(coalesce(ref("request.extra.max_output_tokens"), ref("request.providerOptions.openai-response.max_output_tokens"))),
    tools: omit(ref("request.providerOptions.openai-response.tools")), tool_choice: omit(ref("request.providerOptions.openai-response.tool_choice")),
    text: omit(ref("request.providerOptions.openai-response.text")), reasoning: omit(ref("request.providerOptions.openai-response.reasoning")),
    previous_response_id: omit(ref("request.providerOptions.openai-response.previous_response_id")),
    store: omit(ref("request.providerOptions.openai-response.store")), metadata: omit(ref("request.providerOptions.openai-response.metadata")),
    stream: omit(ref("request.providerOptions.openai-response.stream")), truncation: omit(ref("request.providerOptions.openai-response.truncation")),
    user: omit(ref("request.providerOptions.openai-response.user"))
  }),
  agent: jsonCreate("/responses", { $merge: [ref("request.extra.agent.responses"), { model: ref("request.model") }] }),
  agentResponse: { textPaths: ["output_text"], reasoningPaths: ["reasoning.summary.0.text"], toolCallsPath: "output", toolCallIdPaths: ["call_id", "id"], toolCallNamePaths: ["name"], toolCallArgumentsPaths: ["arguments"] },
  response: { status: "succeeded", textPaths: ["output_text"], reasoningPaths: ["reasoning.summary.0.text"], usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "anthropic-messages", providerId: "claude-api", name: "Anthropic Messages", vendor: "Anthropic", capability: "text",
  baseUrl: "https://api.anthropic.com", auth: { type: "anthropic", field: "apiKey" }, params: textParams,
  create: jsonCreate("/v1/messages", {
    model: ref("request.model"),
    max_tokens: coalesce(ref("request.extra.max_tokens"), ref("request.providerOptions.claude-api.max_tokens"), 4096),
    system: omit(coalesce(ref("request.instructions"), ref("request.providerOptions.claude-api.system"))),
    messages: filter(ref("request.messages"), "message", ne(ref("message.role"), "system")),
    temperature: omit(ref("request.providerOptions.claude-api.temperature")), top_p: omit(ref("request.providerOptions.claude-api.top_p")),
    top_k: omit(ref("request.providerOptions.claude-api.top_k")), stop_sequences: omit(ref("request.providerOptions.claude-api.stop_sequences")),
    tools: omit(ref("request.providerOptions.claude-api.tools")), tool_choice: omit(ref("request.providerOptions.claude-api.tool_choice")),
    metadata: omit(ref("request.providerOptions.claude-api.metadata")), stream: omit(ref("request.providerOptions.claude-api.stream")),
    thinking: omit(ref("request.providerOptions.claude-api.thinking")), service_tier: omit(ref("request.providerOptions.claude-api.service_tier"))
  }, { headers: { "anthropic-version": coalesce(ref("request.providerOptions.claude-api.anthropic-version"), "2023-06-01"), "anthropic-beta": omit(ref("request.providerOptions.claude-api.anthropic-beta")) } }),
  agent: jsonCreate("/v1/messages", { $merge: [ref("request.extra.agent.claude"), { model: ref("request.model") }] }, { headers: { "anthropic-version": "2023-06-01" } }),
  agentResponse: { textPaths: ["content.0.text"], reasoningPaths: ["content.0.thinking"], toolCallsPath: "content", toolCallIdPaths: ["id"], toolCallNamePaths: ["name"], toolCallArgumentsPaths: ["input"] },
  response: {
    status: "succeeded",
    text: map(filter(ref("response.content"), "part", eq(ref("part.type"), "text")), "part", ref("part.text")),
    reasoning: map(filter(ref("response.content"), "part", eq(ref("part.type"), "thinking")), "part", ref("part.thinking")),
    usage: ref("response.usage"), errorPaths: ["error.type"], messagePaths: ["error.message"]
  }
});

add({
  id: "google-gemini-generate-content", providerId: "gemini-generate-content", name: "Google Gemini generateContent", vendor: "Google", capability: "text",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: textParams,
  create: jsonCreate("/v1beta/models/{{model}}:generateContent", {
    contents: map(filter(ref("request.messages"), "message", ne(ref("message.role"), "system")), "message", {
      role: conditional(eq(ref("message.role"), "assistant"), "model", "user"),
      parts: [{ text: ref("message.content") }]
    }),
    systemInstruction: conditional(ref("request.instructions"), { parts: [{ text: ref("request.instructions") }] }),
    generationConfig: omit(ref("request.providerOptions.gemini-generate-content.generationConfig")),
    safetySettings: omit(ref("request.providerOptions.gemini-generate-content.safetySettings")),
    tools: omit(ref("request.providerOptions.gemini-generate-content.tools")),
    toolConfig: omit(ref("request.providerOptions.gemini-generate-content.toolConfig")),
    cachedContent: omit(ref("request.providerOptions.gemini-generate-content.cachedContent"))
  }),
  agent: jsonCreate("/v1beta/models/{{model}}:generateContent", ref("request.extra.agent.gemini")),
  agentResponse: { textPaths: ["candidates.0.content.parts.0.text"], toolCallsPath: "candidates.0.content.parts", toolCallIdPaths: ["functionCall.id"], toolCallNamePaths: ["functionCall.name"], toolCallArgumentsPaths: ["functionCall.args"], toolCallThoughtSignaturePaths: ["thoughtSignature", "thought_signature"] },
  response: { status: "succeeded", text: map(ref("response.candidates.0.content.parts"), "part", omit(ref("part.text"))), usage: ref("response.usageMetadata"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "cohere-chat-v2", providerId: "cohere-chat-v2", name: "Cohere Chat v2", vendor: "Cohere", capability: "text",
  baseUrl: "https://api.cohere.com", auth: bearer, params: textParams,
  create: jsonCreate("/v2/chat", {
    model: ref("request.model"), messages: ref("request.messages"),
    temperature: omit(ref("request.providerOptions.cohere-chat-v2.temperature")), max_tokens: omit(ref("request.extra.max_tokens")),
    stop_sequences: omit(ref("request.providerOptions.cohere-chat-v2.stop_sequences")), tools: omit(ref("request.providerOptions.cohere-chat-v2.tools")),
    tool_choice: omit(ref("request.providerOptions.cohere-chat-v2.tool_choice")), response_format: omit(ref("request.providerOptions.cohere-chat-v2.response_format")),
    documents: omit(ref("request.providerOptions.cohere-chat-v2.documents")), citation_options: omit(ref("request.providerOptions.cohere-chat-v2.citation_options")),
    safety_mode: omit(ref("request.providerOptions.cohere-chat-v2.safety_mode")), seed: omit(ref("request.providerOptions.cohere-chat-v2.seed")), stream: omit(ref("request.providerOptions.cohere-chat-v2.stream"))
  }),
  response: { status: "succeeded", textPaths: ["message.content.0.text", "text"], usage: ref("response.usage"), errorPaths: ["error.type"], messagePaths: ["message"] }
});

add({
  id: "ollama-chat", providerId: "ollama-chat", name: "Ollama Chat", vendor: "Ollama", capability: "text",
  baseUrl: "http://127.0.0.1:11434", auth: { type: "none", field: "apiKey" }, params: textParams,
  create: jsonCreate("/api/chat", {
    model: ref("request.model"), messages: ref("request.messages"), stream: false,
    format: omit(ref("request.providerOptions.ollama-chat.format")), options: omit(ref("request.providerOptions.ollama-chat.options")),
    keep_alive: omit(ref("request.providerOptions.ollama-chat.keep_alive")), tools: omit(ref("request.providerOptions.ollama-chat.tools")),
    think: omit(ref("request.providerOptions.ollama-chat.think"))
  }),
  response: { status: "succeeded", textPaths: ["message.content", "response"], reasoningPaths: ["message.thinking", "thinking"], errorPaths: ["error"], messagePaths: ["error"] }
});

add({
  id: "openai-images", providerId: "openai-image", name: "OpenAI Images", vendor: "OpenAI", capability: "image",
  baseUrl: "https://api.openai.com", auth: bearer, params: imageParams, requiresPublicMediaUrls: false,
  notes: "If there is no reference image, use JSON generations; if there is a reference image or mask, use multipart edits. The reference image is uploaded as an image file component, and the mask is uploaded as a mask file component. The quality of 1k/2k/4k is mapped to OpenAI low/medium/high.",
  create: {
    method: "POST",
    path: "/v1/images/generations",
    pathTemplate: conditional(gt(len(ref("request.images")), 0), "/v1/images/edits", "/v1/images/generations"),
    contentType: "application/json",
    contentTypeTemplate: conditional(gt(len(ref("request.images")), 0), "multipart/form-data", "application/json"),
    body: {
      model: ref("request.model"),
      prompt: ref("request.prompt"),
      n: omit(conditional(gt(ref("request.imageCount"), 0), ref("request.imageCount"), 1)),
      size: omit(conditional({ $in: [lower(trim(ref("request.aspectRatio"))), ["", "auto"]] }, null, ref("request.aspectRatio"))),
      quality: omit({
        $switch: {
          cases: [
            { when: { $in: [lower(trim(ref("request.quality"))), ["1k"]] }, then: "low" },
            { when: { $in: [lower(trim(ref("request.quality"))), ["2k"]] }, then: "medium" },
            { when: { $in: [lower(trim(ref("request.quality"))), ["4k"]] }, then: "high" },
            { when: { $in: [lower(trim(ref("request.quality"))), ["", "auto"]] }, then: null }
          ],
          default: ref("request.quality")
        }
      }),
      background: omit(coalesce(
        ref("request.providerOptions.openai-image.background"),
        conditional(eq(ref("request.extra.transparentBackground"), "true"), "transparent", null)
      )),
      output_format: omit(coalesce(ref("request.providerOptions.openai-image.output_format"), "png")),
      output_compression: omit(ref("request.providerOptions.openai-image.output_compression")),
      moderation: omit(ref("request.providerOptions.openai-image.moderation")),
      response_format: omit(ref("request.providerOptions.openai-image.response_format")),
      style: omit(ref("request.providerOptions.openai-image.style")),
      user: omit(ref("request.providerOptions.openai-image.user"))
    },
    files: [
      {
        name: "image",
        source: filter(sorted(ref("request.images")), "media", ne(ref("media.role"), "mask")),
        filename: "image.png"
      },
      {
        name: "mask",
        source: first(filter(sorted(ref("request.images")), "media", eq(ref("media.role"), "mask"))),
        filename: "mask.png"
      }
    ]
  },
  response: {
    status: "succeeded",
    images: map(ref("response.data"), "item", {
      url: omit(ref("item.url")),
      dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] })
    }),
    usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"]
  }
});

const grokAspectSource = lower(trim(ref("request.aspectRatio")));
const grokSizeParts = split(grokAspectSource, "x");
const grokSizeWidth = toFloat(at(grokSizeParts, 0));
const grokSizeHeight = toFloat(at(grokSizeParts, 1));
const grokSizeRatio = divide(grokSizeWidth, grokSizeHeight);
const grokHasPixelSize = and(eq(len(grokSizeParts), 2), gt(grokSizeWidth, 0), gt(grokSizeHeight, 0));
const grokAspectRatio = omit({
  $switch: {
    cases: [
      { when: { $in: [grokAspectSource, ["", "auto"]] }, then: null },
      { when: { $in: [grokAspectSource, ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "1:2", "2:1"]] }, then: grokAspectSource },
      { when: and(grokHasPixelSize, eq(grokSizeWidth, grokSizeHeight)), then: "1:1" },
      { when: and(grokHasPixelSize, gte(grokSizeRatio, 1.7), lte(grokSizeRatio, 1.8)), then: "16:9" },
      { when: and(grokHasPixelSize, gte(grokSizeRatio, 1.0 / 1.8), lte(grokSizeRatio, 1.0 / 1.7)), then: "9:16" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 1.2), lt(grokSizeRatio, 1.4)), then: "4:3" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 0.7), lt(grokSizeRatio, 0.85)), then: "3:4" },
      { when: and(grokHasPixelSize, gte(grokSizeRatio, 0.6), lt(grokSizeRatio, 0.72)), then: "2:3" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 1.35), lt(grokSizeRatio, 1.6)), then: "3:2" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 0.45), lt(grokSizeRatio, 0.55)), then: "1:2" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 1.85), lt(grokSizeRatio, 2.2)), then: "2:1" },
      { when: and(grokHasPixelSize, gt(grokSizeWidth, grokSizeHeight)), then: "16:9" },
      { when: grokHasPixelSize, then: "9:16" }
    ],
    default: null
  }
});
const grokResolutionSource = lower(trim(coalesce(ref("request.resolution"), ref("request.quality"))));
const grokResolution = omit({
  $switch: {
    cases: [
      { when: { $in: [grokResolutionSource, ["1k", "low", "standard"]] }, then: "1k" },
      { when: { $in: [grokResolutionSource, ["2k", "medium", "hd", "high", "4k"]] }, then: "2k" }
    ],
    default: null
  }
});

add({
  id: "xai-grok-images", providerId: "grok-image", name: "xAI Grok Images", vendor: "xAI", capability: "image",
  baseUrl: "https://api.x.ai", auth: bearer, params: imageParams,
  notes: "If you have a reference image, use /v1/images/edits instead; resolution only accepts 1k/2k; pixel size will be converted to aspect_ratio.",
  create: {
    method: "POST",
    path: "/v1/images/generations",
    pathTemplate: conditional(gt(len(ref("request.images")), 0), "/v1/images/edits", "/v1/images/generations"),
    contentType: "application/json",
    body: {
      model: ref("request.model"), prompt: ref("request.prompt"),
      image: conditional(gt(len(ref("request.images")), 0), { url: firstMediaFieldWithRoles("request.images", ["edit_source", "reference_image", ""], "value") }),
      n: conditional(gt(ref("request.imageCount"), 0), ref("request.imageCount"), 1),
      response_format: coalesce(ref("request.providerOptions.grok-image.response_format"), "url"),
      aspect_ratio: grokAspectRatio, resolution: grokResolution,
      user: omit(ref("request.providerOptions.grok-image.user"))
    }
  },
  response: { status: "succeeded", images: map(ref("response.data"), "item", { url: omit(ref("item.url")), dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] }) }), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

const arkSeedreamRatioSizes = [
  ["auto", "2k"], ["1:1", "2048x2048"], ["4:3", "2304x1728"], ["3:4", "1728x2304"], ["16:9", "2560x1440"], ["9:16", "1440x2560"],
  ["3:2", "2496x1664"], ["2:3", "1664x2496"], ["21:9", "3024x1296"]
];

const arkSeedreamImageBody = (optionNamespace) => ({
  model: ref("request.model"), prompt: ref("request.prompt"),
  // Ark 的 size 只接受 WIDTHxHEIGHT 或 2k/3k/4k；统一层的比例值在这里换算成 2K 档像素尺寸，像素或档位值原样透传。
  size: omit({ $switch: { cases: arkSeedreamRatioSizes.map(([ratio, size]) => ({ when: eq(ref("request.aspectRatio"), ratio), then: size })), default: ref("request.aspectRatio") } }),
  image: omit(conditional(
    eq(len(ref("request.images")), 1),
    first(map(ref("request.images"), "media", ref("media.value"))),
    conditional(gt(len(ref("request.images")), 1), map(ref("request.images"), "media", ref("media.value")), null)
  )),
  sequential_image_generation: omit(ref(`request.providerOptions.${optionNamespace}.sequential_image_generation`)),
  sequential_image_generation_options: omit(ref(`request.providerOptions.${optionNamespace}.sequential_image_generation_options`)),
  watermark: coalesce(ref(`request.providerOptions.${optionNamespace}.watermark`), ref("request.watermark"), false),
  seed: omit(ref(`request.providerOptions.${optionNamespace}.seed`)),
  response_format: coalesce(ref(`request.providerOptions.${optionNamespace}.response_format`), "b64_json")
});

add({
  id: "volcengine-ark-seedream", providerId: "volcengine-ark-image", name: "Volcengine Ark Seedream Images", vendor: "Volcengine", capability: "image",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: imageParams,
  notes: "Official Ark inference access: The Base URL uses /api/v3, and the API Key comes from the Ark inference access console and cannot be mixed with the Agent Plan exclusive Key.",
  create: jsonCreate("/api/v3/images/generations", arkSeedreamImageBody("volcengine-ark-image")),
  response: { status: "succeeded", images: ref("response.data"), usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "volcengine-ark-agent-plan-seedream", providerId: "volcengine-ark-agent-plan-image", name: "Volcengine Ark Agent Plan Seedream Images", vendor: "Volcengine", capability: "image",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: imageParams,
  notes: "Agent Plan exclusive access: The request path is /api/plan/v3/images/generations, and the Agent Plan console exclusive API Key must be used; the request body is consistent with the official Seedream protocol, but the voucher and quota are settled according to the AFP package and cannot be mixed with the /api/v3 official Key.",
  create: jsonCreate("/api/plan/v3/images/generations", arkSeedreamImageBody("volcengine-ark-agent-plan-image")),
  response: { status: "succeeded", images: ref("response.data"), usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

const arkSeedanceValidations = [
  { assert: { $lte: [len(ref("request.images")), 9] }, message: "Seedance supports up to 9 reference images" },
  { assert: { $lte: [len(ref("request.videos")), 3] }, message: "Seedance supports up to 3 reference videos" },
  { assert: { $lte: [len(ref("request.audios")), 3] }, message: "Seedance supports up to 3 reference audios" },
  { assert: { $or: [eq(len(ref("request.audios")), 0), gt({ $add: [len(ref("request.images")), len(ref("request.videos"))] }, 0)] }, message: "Seedance does not support pure audio or text+audio, please also add reference pictures or reference videos." }
];

const arkSeedanceParams = [
  ["model", "string", true, "model", "Ark endpoint/model ID。"],
  ["prompt", "string", true, "content[type=text].text", "Video prompt words."],
  ["images", "media[]", false, "content[type=image_url]", "first_frame, last_frame, reference_image and other roles are mapped as is."],
  ["videos", "media[]", false, "content[type=video_url]", "reference_video。"],
  ["audios", "media[]", false, "content[type=audio_url]", "reference_audio/reference_voice。"],
  ["aspectRatio", "string", false, "ratio", "Output frame."],
  ["resolution", "string", false, "resolution", "Output resolution level."],
  ["duration", "integer", false, "duration", "Output duration in seconds."],
  ["generateAudio", "boolean", false, "generate_audio", "Whether to generate audio."],
  ["watermark", "boolean", false, "watermark", "Whether to include watermark."],
  ["seed", "integer", false, "seed", "providerOptions seed。"],
  ["camera_fixed", "boolean", false, "camera_fixed", "providerOptions camera_fixed。"]
];

const arkSeedanceBody = (optionNamespace) => ({
  model: ref("request.model"),
  content: {
    $concatArrays: [
      [{ type: "text", text: ref("request.prompt") }],
      map(sorted(ref("request.images")), "media", {
        type: "image_url",
        image_url: { url: ref("media.value") },
        role: coalesce(ref("media.role"), "reference_image")
      }),
      map(sorted(ref("request.videos")), "media", {
        type: "video_url",
        video_url: { url: ref("media.value") },
        role: coalesce(ref("media.role"), "reference_video")
      }),
      map(sorted(ref("request.audios")), "media", {
        type: "audio_url",
        audio_url: { url: ref("media.value") },
        role: coalesce(ref("media.role"), "reference_audio")
      })
    ]
  },
  ratio: coalesce(ref("request.aspectRatio"), "16:9"),
  resolution: coalesce(ref("request.resolution"), "720p"),
  duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 5),
  generate_audio: ref("request.generateAudio"),
  watermark: ref("request.watermark"),
  seed: omit(ref(`request.providerOptions.${optionNamespace}.seed`)),
  camera_fixed: omit(ref(`request.providerOptions.${optionNamespace}.camera_fixed`))
});

const arkSeedanceResponse = {
  taskId: coalesce(ref("response.id"), ref("response.task_id"), ref("response.data.id"), ref("taskId")),
  status: coalesce(ref("response.status"), ref("response.data.status"), "pending"),
  message: coalesce(ref("response.error.message"), ref("response.message"), ref("response.fail_reason")),
  videos: coalesce(ref("response.content.video_url"), ref("response.video_url"), ref("response.output.video_url"), ref("response.data.video_url")),
  usage: ref("response.usage"),
  errorPaths: ["error.code"],
  resultEphemeral: true
};

add({
  id: "volcengine-ark-seedance", providerId: "volcengine-ark-video", name: "Volcengine Ark Seedance", vendor: "Volcengine", capability: "video",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: arkSeedanceParams, requiresPublicMediaUrls: true,
  validations: arkSeedanceValidations,
  notes: "Official Ark inference access: Create/query/cancel via /api/v3/contents/generations/tasks; the plug-in does not infer the first and last frames based on the image subscript, and the role is determined by the business layer. The API Key comes from the Ark Reasoning Access Console.",
  create: jsonCreate("/api/v3/contents/generations/tasks", arkSeedanceBody("volcengine-ark-video")),
  poll: { method: "GET", path: "/api/v3/contents/generations/tasks/{{taskId}}" },
  cancel: { method: "DELETE", path: "/api/v3/contents/generations/tasks/{{taskId}}" },
  response: arkSeedanceResponse
});

add({
  id: "volcengine-ark-agent-plan-seedance", providerId: "volcengine-ark-agent-plan-video", name: "Volcengine Ark Agent Plan Seedance", vendor: "Volcengine", capability: "video",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: arkSeedanceParams, requiresPublicMediaUrls: true,
  validations: arkSeedanceValidations,
  notes: "Agent Plan exclusive access: create/query/cancel via /api/plan/v3/contents/generations/tasks; the request body is consistent with the official Seedance protocol, but the Agent Plan exclusive API Key and AFP quota must be used, and cannot be mixed with the /api/v3 official Key.",
  create: jsonCreate("/api/plan/v3/contents/generations/tasks", arkSeedanceBody("volcengine-ark-agent-plan-video")),
  poll: { method: "GET", path: "/api/plan/v3/contents/generations/tasks/{{taskId}}" },
  cancel: { method: "DELETE", path: "/api/plan/v3/contents/generations/tasks/{{taskId}}" },
  response: arkSeedanceResponse
});

// Gemini imageConfig.imageSize 只接受 1K/2K/4K；画布统一层用 1k/2k/4k 或 low/medium/high。
const geminiImageSize = omit({
  $coalesce: [
    {
      $switch: {
        cases: [
          { when: { $in: [lower(ref("request.quality")), ["1k", "low"]] }, then: "1K" },
          { when: { $in: [lower(ref("request.quality")), ["2k", "medium"]] }, then: "2K" },
          { when: { $in: [lower(ref("request.quality")), ["4k", "high"]] }, then: "4K" }
        ],
        default: null
      }
    },
    {
      $switch: {
        cases: [
          { when: { $in: [lower(ref("request.resolution")), ["1k", "low"]] }, then: "1K" },
          { when: { $in: [lower(ref("request.resolution")), ["2k", "medium"]] }, then: "2K" },
          { when: { $in: [lower(ref("request.resolution")), ["4k", "high"]] }, then: "4K" }
        ],
        default: null
      }
    }
  ]
});

add({
  id: "google-gemini-image", providerId: "gemini-image", name: "Google Gemini Image", vendor: "Google", capability: "image",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: imageParams,
  notes: "imageSize only maps 1K/2K/4K; unknown quality values (e.g. video resolution 720) must be omitted. Multi-graph output is created one-by-one by the host and does not map candidateCount.",
  create: jsonCreate("/v1beta/models/{{model}}:generateContent", {
    contents: [{ role: "user", parts: { $concatArrays: [
      [{ text: ref("request.prompt") }],
      map(ref("request.images"), "media", conditional(ref("media.dataUrl"), { inlineData: { mimeType: { $dataMime: ref("media.dataUrl") }, data: { $dataPayload: ref("media.dataUrl") } } }, { fileData: { mimeType: omit(ref("media.mimeType")), fileUri: ref("media.url") } }))
    ] } }],
    generationConfig: {
      responseModalities: coalesce(ref("request.providerOptions.gemini-image.responseModalities"), ["TEXT", "IMAGE"]),
      imageConfig: { aspectRatio: omit(ref("request.aspectRatio")), imageSize: geminiImageSize },
      temperature: omit(ref("request.providerOptions.gemini-image.temperature")), topP: omit(ref("request.providerOptions.gemini-image.topP")), topK: omit(ref("request.providerOptions.gemini-image.topK")), seed: omit(ref("request.providerOptions.gemini-image.seed"))
    },
    safetySettings: omit(ref("request.providerOptions.gemini-image.safetySettings")),
    systemInstruction: omit(coalesce(ref("request.providerOptions.gemini-image.systemInstruction"), conditional(ref("request.instructions"), { parts: [{ text: ref("request.instructions") }] }, null)))
  }),
  response: {
    status: "succeeded",
    images: map(filter(ref("response.candidates.0.content.parts"), "part", { $or: [ref("part.inlineData"), ref("part.inline_data")] }), "part", {
      dataUrl: { $concat: ["data:", coalesce(ref("part.inlineData.mimeType"), ref("part.inline_data.mime_type"), "image/png"), ";base64,", coalesce(ref("part.inlineData.data"), ref("part.inline_data.data"))] }
    }),
    text: map(filter(ref("response.candidates.0.content.parts"), "part", ref("part.text")), "part", ref("part.text")),
    usage: ref("response.usageMetadata"), errorPaths: ["error.code"], messagePaths: ["error.message"]
  }
});

const jimengSizeParts = split(lower(trim(ref("request.aspectRatio"))), "x");
const jimengHasPixelSize = and(eq(len(jimengSizeParts), 2), gt(toFloat(at(jimengSizeParts, 0)), 0), gt(toFloat(at(jimengSizeParts, 1)), 0));

add({
  id: "volcengine-jimeng-image", providerId: "volcengine-jimeng-image", name: "Volcengine Jimeng Image", vendor: "Volcengine", capability: "image",
  baseUrl: "https://visual.volcengineapi.com", auth: { type: "volcengine-v4", field: "apiKey", secretField: "secretKey", service: "cv", region: "cn-north-1" }, params: imageParams,
  configuration: config([{ name: "secretKey", type: "secret", label: "Secret Key", required: true }]),
  notes: "For local reference images, use binary_data_base64; for public URLs, use image_urls. WxH size is split into width/height.",
  create: jsonCreate("/", {
    req_key: ref("request.model"), prompt: ref("request.prompt"), force_single: true,
    binary_data_base64: omit(map(filter(ref("request.images"), "media", ref("media.dataUrl")), "media", { $dataPayload: ref("media.dataUrl") })),
    image_urls: omit(map(filter(ref("request.images"), "media", and({ $not: ref("media.dataUrl") }, ref("media.url"))), "media", ref("media.url"))),
    seed: omit(ref("request.providerOptions.volcengine-jimeng-image.seed")),
    width: omit(conditional(jimengHasPixelSize, toInt(at(jimengSizeParts, 0)), ref("request.output.width"))),
    height: omit(conditional(jimengHasPixelSize, toInt(at(jimengSizeParts, 1)), ref("request.output.height"))),
    req_json: omit(ref("request.providerOptions.volcengine-jimeng-image.req_json"))
  }, { originPath: true, query: { Action: "CVSync2AsyncSubmitTask", Version: "2022-08-31" } }),
  poll: { method: "POST", path: "/", originPath: true, contentType: "application/json", query: { Action: "CVSync2AsyncGetResult", Version: "2022-08-31" }, body: { req_key: ref("request.model"), task_id: ref("taskId"), req_json: "{\"return_url\":true}" } },
  response: asyncResponse("image", { taskId: coalesce(ref("response.data.task_id"), ref("response.task_id"), ref("taskId")), status: coalesce(ref("response.data.status"), ref("response.status"), "pending"), images: coalesce(ref("response.data.image_urls"), ref("response.data.binary_data_base64")), errorPaths: ["code"], messagePaths: ["message"] })
});

add({
  id: "openai-audio", providerId: "openai-audio", name: "OpenAI Audio Speech", vendor: "OpenAI", capability: "audio",
  baseUrl: "https://api.openai.com", auth: bearer, params: audioParams,
  notes: "Synchronizing /v1/audio/speech returns the raw audio stream, wrapped by binaryPayload into a unified audio result.",
  create: jsonCreate("/v1/audio/speech", {
    model: ref("request.model"),
    input: ref("request.prompt"),
    voice: coalesce(ref("request.extra.audioVoice"), ref("request.providerOptions.openai-audio.voice"), "alloy"),
    response_format: coalesce(ref("request.extra.audioFormat"), ref("request.providerOptions.openai-audio.response_format"), "mp3"),
    speed: coalesce(nonZeroFloat(ref("request.extra.audioSpeed")), ref("request.providerOptions.openai-audio.speed"), 1),
    instructions: omit(coalesce(ref("request.extra.audioInstructions"), ref("request.providerOptions.openai-audio.instructions")))
  }),
  response: { binaryPayload: true, resultKind: "audio", status: "succeeded", errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "async-audio", providerId: "async-audio", name: "Async Audio Tasks", vendor: "OpenAI compatible", capability: "audio",
  baseUrl: "https://api.openai.com", auth: bearer, params: audioParams,
  notes: "Asynchronous audio tasks: Create /v1/audio/tasks, poll the same path, the result is the URL first, otherwise download /content.",
  create: jsonCreate("/v1/audio/tasks", {
    model: ref("request.model"),
    input: ref("request.prompt"),
    voice: coalesce(ref("request.extra.audioVoice"), ref("request.providerOptions.async-audio.voice"), "alloy"),
    response_format: coalesce(ref("request.extra.audioFormat"), ref("request.providerOptions.async-audio.response_format"), "mp3"),
    speed: coalesce(nonZeroFloat(ref("request.extra.audioSpeed")), ref("request.providerOptions.async-audio.speed"), 1),
    instructions: omit(coalesce(ref("request.extra.audioInstructions"), ref("request.providerOptions.async-audio.instructions")))
  }),
  poll: { method: "GET", path: "/v1/audio/tasks/{{taskId}}" },
  result: { method: "GET", path: "/v1/audio/tasks/{{taskId}}/content", headers: { Accept: "audio/*" } },
  response: asyncResponse("audio", {
    taskId: coalesce(ref("response.id"), ref("response.task_id"), ref("response.data.id"), ref("taskId")),
    status: coalesce(ref("response.status"), ref("response.data.status"), "pending"),
    audios: coalesce(ref("response.audio_url"), ref("response.audioUrl"), ref("response.result_url"), ref("response.url"), ref("response.data.audio_url"), ref("response.output.url")),
    errorPaths: ["error.code"], messagePaths: ["error.message"]
  })
});

add({
  id: "openai-videos", providerId: "newapi", name: "OpenAI Videos / Sora", vendor: "OpenAI", capability: "video",
  version: "2.0.3",
  baseUrl: "https://api.openai.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: false,
  docsIntro: "> Official service status: OpenAI has closed the Sora 2 model and Videos API on 2026-09-24, and there is no one-to-one replacement interface; official documents are retained for historical records only.\n> This protocol is therefore only available on third-party relays that still provide the `/v1/videos` contract with the same name. Directly generating videos with ordinary OpenAI Keys is not guaranteed to be available. Keeping them as they are is to not interrupt these transits and does not mean that the official links are still in service.\n\nThis protocol sends at most one reference picture, and does not send reference video, reference audio, last frame or mask. When the protocol capabilities are exceeded, an error will be reported before submission, and the material will not be silently ignored. For the multi-image video interface of a third-party service, please select the corresponding JSON or native protocol according to its documentation.",
  validations: [
    { assert: lte(len(ref("request.images")), 1), message: "The current OpenAI Videos/Sora protocol supports at most one reference image. Please remove redundant images, or select a request protocol that supports multiple images according to the service provider's documentation." },
    { assert: eq(len(ref("request.videos")), 0), message: "The current OpenAI Videos / Sora protocol does not support reference videos, please select a request protocol that supports this material." },
    { assert: eq(len(ref("request.audios")), 0), message: "The current OpenAI Videos / Sora protocol does not support reference audio, please select a request protocol that supports this material." },
    { assert: eq(len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["mask", "last_frame"]] })), 0), message: "The current OpenAI Videos / Sora protocol does not support tail frames or masks, please select a request protocol that supports this material." }
  ],
  create: {
    method: "POST", path: "/v1/videos", contentType: "multipart/form-data",
    body: {
      model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
      size: omit(ref("request.aspectRatio")), aspect_ratio: ref("request.extra.aspectRatio"), resolution_name: omit(ref("request.resolution")),
      generate_audio: ref("request.extra.generateAudio"),
      variants: omit(ref("request.providerOptions.newapi.variants"))
    },
    files: [{ name: "input_reference", source: first(filter(sorted(ref("request.images")), "media", ne(ref("media.role"), "mask"))), filename: "input-reference.png" }]
  },
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" },
  cancel: { method: "DELETE", path: "/v1/videos/{{taskId}}" },
  result: { method: "GET", path: "/v1/videos/{{taskId}}/content", headers: { Accept: "video/mp4" } },
  response: asyncResponse("video", { videos: coalesce(ref("response.url"), ref("response.video_url"), ref("response.output.url")), errorPaths: ["error.code"], messagePaths: ["error.message"] })
});

add({
  id: "newapi-media-task-v1", providerId: "newapi-channel-1", name: "NewAPI Media Task Channel 1", vendor: "NewAPI", capability: "video",
  baseUrl: "http://127.0.0.1:3000", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  create: jsonCreate("/v1/videos", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"),
      media: omit({ $concatArrays: [
        map(sorted(ref("request.images")), "media", { type: coalesce(ref("media.role"), "reference_image"), url: ref("media.value") }),
        map(sorted(ref("request.videos")), "media", { type: coalesce(ref("media.role"), "reference_video"), url: ref("media.value") }),
        map(sorted(ref("request.audios")), "media", { type: coalesce(ref("media.role"), "reference_voice"), url: ref("media.value") })
      ] })
    },
    parameters: {
      resolution: coalesce(ref("request.resolution"), "720P"), ratio: coalesce(ref("request.aspectRatio"), "16:9"),
      duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 5), watermark: ref("request.watermark"),
      prompt_extend: coalesce(ref("request.providerOptions.newapi-channel-1.prompt_extend"), false)
    }
  }),
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" }, response: asyncResponse("video")
});

add({
  id: "newapi-video-generations-v1", providerId: "newapi-channel-2", name: "NewAPI Video Generations Channel 2", vendor: "NewAPI", capability: "video",
  baseUrl: "http://127.0.0.1:3000", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  create: jsonCreate("/v1/video/generations", {
    model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), resolution: omit(ref("request.resolution")), generate_audio: ref("request.generateAudio"),
    image: omit(coalesce(firstMediaFieldWithRoles("request.images", ["first_frame"], "value"), first(map({ $sortByOrder: ref("request.images") }, "media", ref("media.value"))))),
    image_url: omit(coalesce(firstMediaFieldWithRoles("request.images", ["first_frame"], "value"), first(map({ $sortByOrder: ref("request.images") }, "media", ref("media.value"))))),
    image_urls: omit(map({ $sortByOrder: ref("request.images") }, "media", ref("media.value"))),
    video_urls: omit(map({ $sortByOrder: ref("request.videos") }, "media", ref("media.value"))),
    audio_urls: omit(map({ $sortByOrder: ref("request.audios") }, "media", ref("media.value")))
  }),
  poll: { method: "GET", path: "/v1/video/generations/{{taskId}}" },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.data.task_id"), ref("response.data.taskId"), ref("response.task_id"), ref("response.taskId"), ref("response.data.id"), ref("response.id"), ref("taskId")),
    videos: coalesce(
      ref("response.data.result_url"), ref("response.data.video_url"), ref("response.data.output_url"), ref("response.data.url"), ref("response.data.metadata.url"),
      ref("response.data.data.video_url"), ref("response.data.data.output_url"), ref("response.data.data.result_url"), ref("response.data.data.url"), ref("response.data.data.metadata.url"),
      ref("response.video_url"), ref("response.videoUrl"), ref("response.result_url"), ref("response.output_url"), ref("response.url"), ref("response.metadata.url"), ref("response.output.url")
    )
  })
});

add({
  id: "rolldek-wan-video", providerId: "rolldek-wan-video", name: "RollDek WAN 3.0 Video", vendor: "RollDek", capability: "video",
  baseUrl: "https://rolldek.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  notes: "This protocol strictly corresponds to the JSON /v1/videos contract of RollDek WAN 3.0. Other compatible creation entries exposed by RollDek at the same time do not share the task query path and cannot be mixed with NewAPI Video Generations Channel 2.",
  create: jsonCreate("/v1/videos", {
    model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
    size: omit({ $upper: ref("request.resolution") }), aspect_ratio: omit(ref("request.aspectRatio")),
    reference_images: omit(map(sorted(ref("request.images")), "media", {
      url: ref("media.value"), role: coalesce(ref("media.role"), "reference_image")
    })),
    reference_videos: omit(map(sorted(ref("request.videos")), "media", {
      url: ref("media.value"), duration: omit({ $multiply: [ref("media.metadata.durationMs"), 0.001] })
    })),
    reference_audios: omit(map(sorted(ref("request.audios")), "media", { url: ref("media.value") }))
  }),
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" },
  result: { method: "GET", path: "/v1/videos/{{taskId}}/content", headers: { Accept: "video/mp4" } },
  response: asyncResponse("video", {
    videos: coalesce(ref("response.metadata.url"), ref("response.data.metadata.url"), ref("response.video_url"), ref("response.url")),
    errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message", "fail_reason"]
  })
});

add({
  id: "xai-video", providerId: "xai-video", name: "xAI Video", vendor: "xAI", capability: "video",
  baseUrl: "https://api.x.ai", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $lte: [len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["first_frame", "last_frame"]] })), 1] }, message: "xAI Video supports at most one frame input, and the current profile does not support the last frame." },
    { assert: { $not: { $and: [gt(len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["first_frame", "last_frame"]] })), 0), gt(len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["reference_image", "subject_reference", "style_reference"]] })), 0)] } }, message: "xAI Video cannot mix starting frames and character reference images at the same time" }
  ],
  create: jsonCreate("/v1/videos/generations", {
    model: ref("request.model"), prompt: ref("request.prompt"), duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 6),
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), resolution: coalesce(ref("request.resolution"), "720p"),
    image: conditional(gt(len(mediaWithRoles("request.images", ["first_frame", ""])), 0), { url: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "value") }),
    reference_images: omit(map(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["reference_image", "subject_reference", "style_reference"]] }), "media", { url: ref("media.value") }))
  }),
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" }, response: asyncResponse("video")
});

add({
  id: "google-gemini-veo", providerId: "gemini-veo", name: "Google Gemini Veo", vendor: "Google", capability: "video",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: videoParams,
  validations: [{ assert: { $eq: [len(filter(ref("request.images"), "media", eq(ref("media.role"), "reference_image"))), 0] }, message: "The current profile of Gemini Veo does not support character reference images, please use the first frame input or the protocol that supports reference_to_video" }],
  create: jsonCreate("/v1beta/models/{{model}}:predictLongRunning", {
    instances: [{
      prompt: ref("request.prompt"),
      image: conditional(gt(len(mediaWithRoles("request.images", ["first_frame", ""])), 0), conditional(firstMediaFieldWithRoles("request.images", ["first_frame", ""], "dataUrl"), { inlineData: { mimeType: { $dataMime: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "dataUrl") }, data: { $dataPayload: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "dataUrl") } } }, { fileUri: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "url"), mimeType: omit(firstMediaFieldWithRoles("request.images", ["first_frame", ""], "mimeType")) }))
    }],
    parameters: {
      aspectRatio: omit(ref("request.aspectRatio")), durationSeconds: omit(ref("request.duration")), resolution: omit(ref("request.resolution")),
      generateAudio: ref("request.generateAudio"), sampleCount: omit(ref("request.imageCount")), negativePrompt: omit(ref("request.providerOptions.gemini-veo.negativePrompt")),
      personGeneration: omit(ref("request.providerOptions.gemini-veo.personGeneration")), seed: omit(ref("request.providerOptions.gemini-veo.seed"))
    }
  }),
  poll: { method: "GET", path: "/v1beta/{{taskId}}" },
  response: asyncResponse("video", { taskId: coalesce(ref("response.name"), ref("taskId")), status: conditional(ref("response.error"), "failed", conditional(ref("response.done"), "succeeded", "processing")), videos: coalesce(ref("response.response.generateVideoResponse.generatedSamples"), ref("response.response.generatedVideos"), ref("response.response.videos")), message: ref("response.error.message") })
});

add({
  id: "novita-video", providerId: "novita-video", name: "Novita Video", vendor: "Novita", capability: "video",
  baseUrl: "https://api.novita.ai", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [{ assert: { $eq: [len(filter(ref("request.images"), "media", eq(ref("media.role"), "reference_image"))), 0] }, message: "Novita Video's current profile only supports starting images and does not support character reference images." }],
  create: jsonCreate("/v3/video/create", {
    model_name: ref("request.model"), prompt: ref("request.prompt"), duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 5),
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), image_url: omit(firstMediaFieldWithRoles("request.images", ["first_frame", ""], "value")),
    seed: omit(ref("request.providerOptions.novita-video.seed")), negative_prompt: omit(ref("request.providerOptions.novita-video.negative_prompt"))
  }),
  poll: { method: "GET", path: "/v3/async/task-result", query: { task_id: ref("taskId") } }, response: asyncResponse("video")
});

// 即梦官方视频的线协议与通用视频模板有三处不同，必须按官方合同逐个映射：
// 时长用 frames 表示（24*n+1：121=5 秒、241=10 秒），画幅用 aspect_ratio，
// req_json 属于查询请求而不是创建正文。成功业务码是 code=10000，所以只有这个协议
// 声明 successCodes，其他厂商的错误码判定维持原样。
// 官方只提供 5 秒和 10 秒两档；宿主给的是秒数，取最近一档，避免发出不存在的帧数。
const jimengVideoSeconds = ref("request.duration");
const jimengVideoFrames = omit(conditional(gt(jimengVideoSeconds, 0), conditional(lte(jimengVideoSeconds, 7), 121, 241)));
// 参数表只用于插件文档和统一字段说明；按实际线字段写明，避免继续宣称发送 duration/ratio。
const jimengVideoParams = videoParams.map(([name, type, required, mapping, description]) => {
  if (name === "duration") return [name, type, required, "frames (24*seconds+1)", "Duration in seconds; officially only 5 seconds and 10 seconds, converted to frames=121/241 according to the latest gear."];
  if (name === "aspectRatio") return [name, type, required, "aspect_ratio", "Aspect ratio, the official value is 16:9/9:16/1:1/4:3/3:4/21:9."];
  if (name === "resolution") return [name, type, required, "resolution", "Resolution level; the actual resolution is determined by req_key, and only transparent transmission is used here."];
  if (name === "providerOptions") return [name, type, required, mapping, "Vendor extension field in the plug-in namespace; volcengine-jimeng-video.req_json belongs to the query request and is only sent in poll."];
  return [name, type, required, mapping, description];
});

add({
  id: "volcengine-jimeng-video", providerId: "volcengine-jimeng-video", name: "Volcengine Jimeng Video", vendor: "Volcengine", capability: "video",
  baseUrl: "https://visual.volcengineapi.com", auth: { type: "volcengine-v4", field: "apiKey", secretField: "secretKey", service: "cv", region: "cn-north-1" }, params: jimengVideoParams,
  configuration: config([{ name: "secretKey", type: "secret", label: "Secret Key", required: true }]),
  notes: "The line protocol is converged according to Jimeng's official video interface: only req_key, prompt, image_urls, aspect_ratio, frames, and resolution are sent when creating the text; the official expression is frames=24*seconds+1 to express the duration (121=5 seconds, 241=10 seconds), and only two levels of 5 seconds and 10 seconds are provided, and the other seconds are the nearest one. req_json is the configuration string of the query request, which is only sent during poll. The business success code is code=10000. The plug-in explicitly declares successCodes and will not judge the completed task as a failure. The resolution is determined by req_key, and resolution is only used as a transparent transmission and is not derived.",
  create: jsonCreate("/", {
    req_key: ref("request.model"), prompt: ref("request.prompt"), image_urls: omit(map({ $sortByOrder: ref("request.images") }, "media", ref("media.value"))),
    aspect_ratio: omit(ref("request.aspectRatio")), frames: jimengVideoFrames, resolution: omit(ref("request.resolution"))
  }, { originPath: true, query: { Action: "CVSync2AsyncSubmitTask", Version: "2022-08-31" } }),
  poll: { method: "POST", path: "/", originPath: true, contentType: "application/json", query: { Action: "CVSync2AsyncGetResult", Version: "2022-08-31" }, body: { req_key: ref("request.model"), task_id: ref("taskId"), req_json: omit(ref("request.providerOptions.volcengine-jimeng-video.req_json")) } },
  response: asyncResponse("video", { taskId: coalesce(ref("response.data.task_id"), ref("response.task_id"), ref("taskId")), status: coalesce(ref("response.data.status"), ref("response.status"), "pending"), videos: coalesce(ref("response.data.video_urls"), ref("response.data.video_url")), errorPaths: ["code"], successCodes: [10000], messagePaths: ["message"] })
});

const agnesFrameImages = mediaWithRoles("request.images", ["first_frame", "last_frame"]);
const agnesReferenceImages = mediaWithRoles("request.images", ["reference_image", "subject_reference", "style_reference"]);
const agnesReferenceMode = { $or: [gt(len(agnesReferenceImages), 0), gt(len(ref("request.videos")), 0), gt(len(ref("request.audios")), 0)] };

add({
  id: "agnes-video-25", providerId: "agnes-video", name: "Agnes Video 2.5 / 2.5 Flash", vendor: "Agnes AI", capability: "video",
  mediaTransport: { image: "inline", video: "url", audio: "url" },
  baseUrl: "https://apihub.agnes-ai.com/v1", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $in: [ref("request.model"), ["agnes-video-2.5", "agnes-video-2.5-flash"]] }, message: "Agnes 2.5 plug-in only supports agnes-video-2.5 and agnes-video-2.5-flash" },
    { assert: { $in: [{ $upper: coalesce(ref("request.resolution"), "720P") }, ["720P", "960P", "2K"]] }, message: "Agnes Video 2.5 resolution must be 720P, 960P or 2K" },
    { assert: { $not: { $and: [gt(len(agnesFrameImages), 0), agnesReferenceMode] } }, message: "Agnes Video 2.5 cannot mix first and last frames with character, video or audio reference material at the same time" },
    { assert: { $or: [ne(ref("request.model"), "agnes-video-2.5-flash"), eq({ $upper: coalesce(ref("request.resolution"), "720P") }, "720P")] }, message: "Agnes Video 2.5 Flash only supports 720P" },
    { assert: { $or: [ne(ref("request.model"), "agnes-video-2.5-flash"), { $lte: [len(ref("request.images")), 5] }] }, message: "Agnes Video 2.5 Flash supports up to 5 reference pictures" },
    { assert: { $or: [ne(ref("request.model"), "agnes-video-2.5-flash"), eq(len(ref("request.videos")), 0)] }, message: "Agnes Video 2.5 Flash does not support reference videos" }
  ],
  create: jsonCreate("/videos", {
    model: ref("request.model"), prompt: ref("request.prompt"),
    mode: conditional(agnesReferenceMode, "reference", conditional(gt(len(ref("request.images")), 0), "keyframe", "text")),
    seconds: { $toString: ref("request.duration") }, size: { $upper: coalesce(ref("request.resolution"), "720P") },
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), n: coalesce(ref("request.output.count"), 1),
    first_frame: conditional({ $not: agnesReferenceMode }, omit(coalesce(firstMediaFieldWithRoles("request.images", ["first_frame"], "value"), first(map(sorted(ref("request.images")), "media", ref("media.value"))))), null),
    last_frame: conditional({ $not: agnesReferenceMode }, omit(firstMediaFieldWithRoles("request.images", ["last_frame"], "value")), null),
    images: conditional(agnesReferenceMode, omit(map(sorted(ref("request.images")), "media", ref("media.value"))), null),
    videos: conditional(agnesReferenceMode, omit(map(sorted(ref("request.videos")), "media", { url: ref("media.value") })), null),
    audios: conditional(agnesReferenceMode, omit(map(sorted(ref("request.audios")), "media", ref("media.value"))), null)
  }),
  poll: { method: "GET", path: "/agnesapi", originPath: true, query: { video_id: ref("taskId"), model_name: ref("request.model") } },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.data.video_id"), ref("response.video_id"), ref("response.data.id"), ref("response.id"), ref("taskId")),
    status: coalesce(ref("response.data.status"), ref("response.status"), "pending"),
    videos: coalesce(ref("response.data.metadata.url"), ref("response.metadata.url"), ref("response.data.url"), ref("response.url")),
    message: coalesce(ref("response.data.error.message"), ref("response.error.message"), ref("response.message"), ref("response.detail"))
  })
});

// Agnes 图像是同步端点，文生图与图生图共用 POST /v1/images/generations：
// 不传 image 为文生图，传 image 为图生图或多图合成。官方参数表只承认
// model、prompt、size（必填，档位 1K/2K/3K/4K 或 WxH 精确尺寸）、ratio、image、
// return_base64 和 extra_body，因此这里不发送 n、output_format、quality、
// background 等 OpenAI 兼容字段。顶层 response_format 是官方明确列出的错误写法，
// 输出格式只能声明在 extra_body 内。参考图放 extra_body.image，支持公共 HTTPS URL
// 和 Data URI Base64，所以不强制公共媒体 URL，本地开发也能直接联调。
const agnesImageRatios = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
const agnesImageAspect = trim(ref("request.aspectRatio"));
const agnesImageIsRatio = { $in: [agnesImageAspect, agnesImageRatios] };
const agnesImageIsPixel = eq(len(split(agnesImageAspect, "x")), 2);
// size 是官方必填项：像素尺寸原样透传，其余情况（比例、auto、空值）一律落到分辨率档位，不能省略。
const agnesImageSize = conditional(agnesImageIsPixel, agnesImageAspect, {
  $switch: {
    cases: [
      { when: { $in: [lower(trim(ref("request.quality"))), ["1k", "low", "standard"]] }, then: "1K" },
      { when: { $in: [lower(trim(ref("request.quality"))), ["2k", "medium", "hd", "high"]] }, then: "2K" },
      { when: { $in: [lower(trim(ref("request.quality"))), ["3k"]] }, then: "3K" },
      { when: { $in: [lower(trim(ref("request.quality"))), ["4k"]] }, then: "4K" }
    ],
    default: "1K"
  }
});

add({
  id: "agnes-image", providerId: "agnes-image", name: "Agnes Image", vendor: "Agnes AI", capability: "image",
  baseUrl: "https://api.agnes-ai.cn", auth: bearer, params: imageParams, requiresPublicMediaUrls: false,
  notes: "Agnes official image endpoint, returned synchronously. Vincentian pictures and Tushengtu share /v1/images/generations: If you do not pass image, it will be a Wensheng image, and if you pass image, it will be a Tusheng image or a combination of multiple images. size is required, take the 1K/2K/3K/4K range or WxH exact size; the screen ratio uses an independent ratio field. The reference image is placed in extra_body.image and supports public HTTPS URL or Data URI Base64. The top-level response_format is an officially listed wrong way of writing, and the output format can only be declared in extra_body.response_format. This endpoint does not accept n. A single request will return a fixed picture. When multiple pictures are needed, the upper layer will split it into multiple tasks.",
  validations: [
    { assert: { $or: [{ $in: [agnesImageAspect, ["", "auto", ...agnesImageRatios]] }, eq(len(split(agnesImageAspect, "x")), 2)] }, message: "Agnes images only support 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9 ratios or WxH pixel dimensions" }
  ],
  create: jsonCreate("/v1/images/generations", {
    model: ref("request.model"),
    prompt: ref("request.prompt"),
    size: omit(agnesImageSize),
    ratio: omit(conditional(agnesImageIsRatio, agnesImageAspect)),
    extra_body: omit({
      image: omit(map(sorted(ref("request.images")), "media", coalesce(ref("media.dataUrl"), ref("media.url")))),
      response_format: coalesce(ref("request.providerOptions.agnes-image.response_format"), "url")
    })
  }, { originPath: true }),
  response: {
    status: "succeeded",
    images: map(ref("response.data"), "item", {
      url: omit(ref("item.url")),
      dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] })
    }),
    errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message", "msg"]
  }
});

const agnesV20FrameImages = mediaWithRoles("request.images", ["first_frame", "last_frame", ""]);

add({
  id: "agnes-video-v20", providerId: "agnes-video-v20", name: "Agnes Video V2.0", vendor: "Agnes AI", capability: "video",
  mediaTransport: { image: "inline", video: "url", audio: "url" },
  baseUrl: "https://apihub.agnes-ai.com/v1", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: eq(ref("request.model"), "agnes-video-v2.0"), message: "Agnes Video V2.0 plug-in only supports agnes-video-v2.0" },
    { assert: eq(len(ref("request.videos")), 0), message: "Agnes Video V2.0 does not support reference videos" },
    { assert: eq(len(ref("request.audios")), 0), message: "Agnes Video V2.0 does not support reference audio" },
    { assert: eq(len(agnesReferenceImages), 0), message: "Agnes Video V2.0 does not support character or style reference images" },
    { assert: { $lte: [len(agnesV20FrameImages), 2] }, message: "Agnes Video V2.0 supports at most one first frame and one last frame." }
  ],
  create: jsonCreate("/videos", {
    model: ref("request.model"), prompt: ref("request.prompt"), frame_rate: 24,
    num_frames: { $min: [441, { $add: [{ $ceilStep: [{ $multiply: [coalesce(ref("request.duration"), 5), 24] }, 8] }, 1] }] },
    image: conditional(eq(len(agnesV20FrameImages), 1), firstMediaFieldWithRoles("request.images", ["first_frame", "last_frame", ""], "value")),
    extra_body: conditional(gt(len(agnesV20FrameImages), 1), { image: map(agnesV20FrameImages, "media", ref("media.value")), mode: "keyframes" })
  }),
  poll: { method: "GET", path: "/agnesapi", originPath: true, query: { video_id: ref("taskId"), model_name: ref("request.model") } },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.data.video_id"), ref("response.video_id"), ref("response.data.id"), ref("response.id"), ref("taskId")),
    status: coalesce(ref("response.data.status"), ref("response.status"), "pending"),
    videos: coalesce(ref("response.data.metadata.url"), ref("response.metadata.url"), ref("response.data.url"), ref("response.url")),
    message: coalesce(ref("response.data.error.message"), ref("response.error.message"), ref("response.message"), ref("response.detail"))
  })
});

add({
  id: "stability-image", providerId: "stability-image", name: "Stability AI Image", vendor: "Stability AI", capability: "image",
  baseUrl: "https://api.stability.ai", auth: bearer, params: imageParams,
  create: {
    method: "POST",
    pathTemplate: coalesce(ref("request.providerOptions.stability-image.endpoint"), "/v2beta/stable-image/generate/core"),
    contentType: "multipart/form-data",
    headers: { Accept: "application/json" },
    body: {
      prompt: ref("request.prompt"), negative_prompt: omit(ref("request.providerOptions.stability-image.negative_prompt")),
      aspect_ratio: omit(ref("request.aspectRatio")), output_format: coalesce(ref("request.output.format"), ref("request.providerOptions.stability-image.output_format"), "png"),
      seed: omit(ref("request.providerOptions.stability-image.seed")), style_preset: omit(ref("request.providerOptions.stability-image.style_preset")),
      strength: omit(ref("request.providerOptions.stability-image.strength")), cfg_scale: omit(ref("request.providerOptions.stability-image.cfg_scale")),
      grow_mask: omit(ref("request.providerOptions.stability-image.grow_mask")), creativity: omit(ref("request.providerOptions.stability-image.creativity"))
    },
    files: [
      { name: "image", source: first(mediaWithRoles("request.images", ["edit_source", "reference_image", ""])), filename: "image.png" },
      { name: "mask", source: first(mediaWithRoles("request.images", ["mask"])), filename: "mask.png" }
    ]
  },
  response: {
    status: conditional(ref("response.errors"), "failed", "succeeded"),
    message: coalesce(ref("response.errors"), ref("response.message")),
    images: conditional(ref("response.image"), [
      { dataUrl: { $concat: ["data:", coalesce(ref("response.mime_type"), "image/png"), ";base64,", ref("response.image")] } }
    ]),
    errorPaths: ["errors"]
  }
});

add({
  id: "ideogram-image", providerId: "ideogram-image", name: "Ideogram Image", vendor: "Ideogram", capability: "image",
  baseUrl: "https://api.ideogram.ai", auth: { type: "header", field: "apiKey", header: "Api-Key" }, params: imageParams,
  create: {
    method: "POST", pathTemplate: coalesce(ref("request.providerOptions.ideogram-image.endpoint"), "/v1/ideogram-v3/generate"), contentType: "multipart/form-data",
    body: {
      prompt: ref("request.prompt"), negative_prompt: omit(ref("request.providerOptions.ideogram-image.negative_prompt")),
      aspect_ratio: omit(ref("request.aspectRatio")), resolution: omit(ref("request.resolution")), num_images: coalesce(ref("request.imageCount"), 1),
      rendering_speed: omit(ref("request.providerOptions.ideogram-image.rendering_speed")), style_type: omit(ref("request.providerOptions.ideogram-image.style_type")),
      magic_prompt: omit(ref("request.providerOptions.ideogram-image.magic_prompt")), seed: omit(ref("request.providerOptions.ideogram-image.seed")),
      color_palette: omit(ref("request.providerOptions.ideogram-image.color_palette")), character_reference_images_mask: omit(ref("request.providerOptions.ideogram-image.character_reference_images_mask"))
    },
    files: [
      { name: "image", source: first(mediaWithRoles("request.images", ["edit_source", "reference_image", "subject_reference", "style_reference", ""])), filename: "reference.png" },
      { name: "mask", source: first(mediaWithRoles("request.images", ["mask"])), filename: "mask.png" }
    ]
  },
  response: { status: "succeeded", images: coalesce(ref("response.data"), ref("response.images")), errorPaths: ["error.code"], messagePaths: ["error.message", "message"] }
});

add({
  id: "dashscope-wan-video", providerId: "dashscope-wan-video", name: "DashScope Wan Video", vendor: "Alibaba Cloud", capability: "video",
  mediaTransport: { image: "inline", video: "url", audio: "url" },
  version: "2.0.1",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $lte: [len(mediaWithRoles("request.images", ["first_frame"])), 1] }, message: "Wan videos can only have at most one first frame" },
    { assert: { $lte: [len(mediaWithRoles("request.images", ["last_frame"])), 1] }, message: "Wan video can only have at most one last frame" },
    { assert: { $or: [eq(len(mediaWithRoles("request.images", ["last_frame"])), 0), eq(len(mediaWithRoles("request.images", ["first_frame"])), 1)] }, message: "Wan video must provide the first frame when using the last frame" }
  ],
  create: jsonCreate("/api/v1/services/aigc/video-generation/video-synthesis", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"),
      negative_prompt: omit(ref("request.providerOptions.dashscope-wan-video.negative_prompt")),
      img_url: omit(conditional({ $and: [ne(ref("request.operation"), "reference_to_video"), eq(len(mediaWithRoles("request.images", ["last_frame"])), 0)] }, coalesce(firstMediaFieldWithRoles("request.images", ["first_frame"], "value"), firstMediaFieldWithRoles("request.images", ["reference_image", "edit_source", ""], "value")))),
      first_frame_url: omit(conditional(gt(len(mediaWithRoles("request.images", ["last_frame"])), 0), firstMediaFieldWithRoles("request.images", ["first_frame"], "value"))),
      last_frame_url: omit(firstMediaFieldWithRoles("request.images", ["last_frame"], "value")),
      reference_images: omit(conditional(eq(ref("request.operation"), "reference_to_video"), map(mediaWithRoles("request.images", ["reference_image", "subject_reference", "style_reference"]), "media", ref("media.value")))),
      video_url: omit(firstMediaFieldWithRoles("request.videos", ["reference_video", ""], "value")),
      audio_url: omit(firstMediaFieldWithRoles("request.audios", ["reference_audio", "reference_voice", ""], "value"))
    },
    parameters: {
      size: omit(ref("request.resolution")), duration: omit(ref("request.duration")),
      prompt_extend: omit(ref("request.providerOptions.dashscope-wan-video.prompt_extend")),
      watermark: ref("request.watermark"), seed: omit(ref("request.providerOptions.dashscope-wan-video.seed")),
      shot_type: omit(ref("request.providerOptions.dashscope-wan-video.shot_type")),
      audio: ref("request.generateAudio"), template: omit(ref("request.providerOptions.dashscope-wan-video.template"))
    }
  }, { headers: { "X-DashScope-Async": "enable" } }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}" },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    videos: coalesce(ref("response.output.video_url"), ref("response.output.results"), ref("response.video_url")),
    usage: ref("response.usage"), errorPaths: ["code"], messagePaths: ["message", "output.message"]
  })
});

add({
  id: "dashscope-wanx-image", providerId: "dashscope-wanx-image", name: "DashScope Wanx Image", vendor: "Alibaba Cloud", capability: "image",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: imageParams, requiresPublicMediaUrls: true,
  create: jsonCreate("/api/v1/services/aigc/text2image/image-synthesis", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"), negative_prompt: omit(ref("request.providerOptions.dashscope-wanx-image.negative_prompt")),
      ref_img: omit(conditional(eq(len(ref("request.images")), 1), firstMediaFieldWithRoles("request.images", ["edit_source", "reference_image", "subject_reference", "style_reference", ""], "value"))),
      ref_images: omit(conditional(gt(len(ref("request.images")), 1), map(sorted(ref("request.images")), "media", ref("media.value"))))
    },
    parameters: {
      size: omit(ref("request.aspectRatio")), n: coalesce(ref("request.imageCount"), 1),
      seed: omit(ref("request.providerOptions.dashscope-wanx-image.seed")), style: omit(ref("request.providerOptions.dashscope-wanx-image.style")),
      prompt_extend: omit(ref("request.providerOptions.dashscope-wanx-image.prompt_extend")), watermark: ref("request.watermark")
    }
  }, { headers: { "X-DashScope-Async": "enable" } }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}" },
  response: asyncResponse("image", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    images: coalesce(ref("response.output.results"), ref("response.output.image_url")),
    usage: ref("response.usage"), errorPaths: ["code"], messagePaths: ["message", "output.message"]
  })
});

// Qwen-Image 3.0 / Wan 2.7 图像属于百炼多模态模型，必须走多模态端点：
// 用 OpenAI 的 /v1/images/generations 或 /v1/images/edits 会被网关判为“模型与端点不匹配”，
// 官方错误码把它表现为 url error；参考图只能放在 input.messages[].content[].image。
// size 使用 DashScope 的 “宽*高”（星号），未登记的档位直接省略，由模型按提示词自动推荐分辨率。
const dashscopeMultimodalImageSizes = [
  ["1:1", "1024*1024"], ["3:4", "960*1280"], ["4:3", "1280*960"], ["2:3", "1024*1536"], ["3:2", "1536*1024"],
  ["9:16", "864*1536"], ["16:9", "1536*864"],
  ["1024x1024", "1024*1024"], ["1024x1536", "1024*1536"], ["1536x1024", "1536*1024"],
  ["1024x1280", "1024*1280"], ["1280x1024", "1280*1024"], ["960x1280", "960*1280"], ["1280x960", "1280*960"]
];

add({
  id: "dashscope-qwen-image", providerId: "dashscope-qwen-image", name: "DashScope Qwen / Wan Image", vendor: "Alibaba Cloud", capability: "image",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: imageParams, requiresPublicMediaUrls: false,
  notes: "Bailian multi-modal image endpoint (image-generation asynchronous task). Vincentian pictures and Tusheng pictures share the same entrance: if no image is passed, it is Vincentian pictures, and if 1-3 images are passed, it is Tusheng pictures. The reference image is transmitted via input.messages[].content[].image (Base64 data URL is preferred) and OpenAI’s /v1/images/edits multipart is not used. size uses \"width*height\", unregistered gears are omitted and automatically recommended by the model; enable_thinking is fixed to false because the official requires non-streaming calls to turn off thinking mode.",
  create: jsonCreate("/api/v1/services/aigc/image-generation/generation", {
    model: ref("request.model"),
    input: {
      messages: [{
        role: "user",
        content: {
          $concatArrays: [
            map(sorted(ref("request.images")), "media", { image: coalesce(ref("media.dataUrl"), ref("media.url")) }),
            [{ text: ref("request.prompt") }]
          ]
        }
      }]
    },
    parameters: {
      size: omit({ $switch: { cases: dashscopeMultimodalImageSizes.map(([ratio, size]) => ({ when: eq(ref("request.aspectRatio"), ratio), then: size })), default: null } }),
      n: conditional(gt({ $toInt: ref("request.imageCount") }, 0), { $toInt: ref("request.imageCount") }, 1),
      prompt_extend: true,
      enable_thinking: false,
      negative_prompt: omit(ref("request.providerOptions.dashscope-qwen-image.negative_prompt")),
      seed: omit(ref("request.providerOptions.dashscope-qwen-image.seed")),
      watermark: omit(ref("request.watermark"))
    }
  }, { headers: { "X-DashScope-Async": "enable" }, originPath: true }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}", originPath: true },
  response: asyncResponse("image", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    message: coalesce(ref("response.output.message"), ref("response.message")),
    images: map(ref("response.output.choices.0.message.content"), "item", { url: omit(ref("item.image")) }),
    errorPaths: ["code", "output.code"], messagePaths: ["message", "output.message"]
  })
});

for (const [id, name, vendor, capability, baseUrl, createPath, pollPath, requestShape] of [
  ["dashscope-qwen-native", "DashScope Qwen Native", "Alibaba Cloud", "text", "https://dashscope.aliyuncs.com", "/api/v1/services/aigc/text-generation/generation", null, "input+parameters"],
  ["minimax-text-native", "MiniMax Text Native", "MiniMax", "text", "https://api.minimax.chat", "/v1/text/chatcompletion_v2", null, "messages+tokens_to_generate"],
  ["azure-openai", "Azure OpenAI", "Microsoft Azure", "text", "https://{resource}.openai.azure.com", "/openai/deployments/{{model}}/chat/completions", null, "OpenAI body + api-version query"],
  ["vertex-gemini", "Vertex AI Gemini", "Google Cloud", "text", "https://{location}-aiplatform.googleapis.com", "/v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent", null, "Gemini contents/parts"],
  ["aws-bedrock-converse", "AWS Bedrock Converse", "AWS", "text", "https://bedrock-runtime.{region}.amazonaws.com", "/model/{{model}}/converse", null, "messages+system+inferenceConfig+toolConfig"],
  ["aws-bedrock-invoke-model", "AWS Bedrock InvokeModel", "AWS", "text", "https://bedrock-runtime.{region}.amazonaws.com", "/model/{{model}}/invoke", null, "model-specific arbitrary body"],
  ["vertex-imagen", "Vertex Imagen", "Google Cloud", "image", "https://{location}-aiplatform.googleapis.com", "/v1/projects/{{request.providerOptions.vertex-imagen.project}}/locations/{{request.providerOptions.vertex-imagen.location}}/publishers/google/models/{{model}}:predict", null, "instances+parameters"],
  ["minimax-image", "MiniMax Image", "MiniMax", "image", "https://api.minimax.io", "/v1/image_generation", null, "model-specific image body"],
  ["kling-image", "Kling Image", "Kuaishou", "image", "https://api.klingai.com", "/v1/images/generations", "/v1/images/generations/{{taskId}}", "task JSON"],
  ["zhipu-cogview", "Wisdom spectrum CogView", "Zhipu AI", "image", "https://open.bigmodel.cn/api/paas", "/v4/images/generations", null, "OpenAI-like image JSON"],
  ["bfl-flux", "Black Forest Labs FLUX", "Black Forest Labs", "image", "https://api.bfl.ai", "/v1/{{model}}", "/v1/get_result", "async model schema"],
  ["recraft-image", "Recraft Image", "Recraft", "image", "https://external.api.recraft.ai", "/v1/images/generations", null, "raster/vector image JSON"],
  ["adobe-firefly", "Adobe Firefly", "Adobe", "image", "https://firefly-api.adobe.io", "/v3/images/generate", null, "versioned Firefly request"],
  ["runway-image", "Runway Image", "Runway", "image", "https://api.dev.runwayml.com", "/v1/text_to_image", "/v1/tasks/{{taskId}}", "async Runway image schema"],
  ["vertex-veo", "Vertex AI Veo", "Google Cloud", "video", "https://{location}-aiplatform.googleapis.com", "/v1/projects/{{request.providerOptions.vertex-veo.project}}/locations/{{request.providerOptions.vertex-veo.location}}/publishers/google/models/{{model}}:predictLongRunning", "/v1/{{taskId}}", "Vertex long-running operation"],
  ["seedance-videos-compatible", "Seedance Compatible /videos", "Gateway profile", "video", "http://127.0.0.1:3000", "/v1/videos", "/v1/videos/{{taskId}}", "gateway-specific videos JSON"],
  ["kling-video", "Kling Video", "Kuaishou", "video", "https://api.klingai.com", "/v1/videos/generations", "/v1/videos/generations/{{taskId}}", "text/image/multi-image task"],
  ["runway-video", "Runway Video", "Runway", "video", "https://api.dev.runwayml.com", "/v1/image_to_video", "/v1/tasks/{{taskId}}", "promptImage+promptText+ratio+duration"],
  ["luma-dream-machine", "Luma Dream Machine", "Luma AI", "video", "https://api.lumalabs.ai", "/dream-machine/v1/generations", "/dream-machine/v1/generations/{{taskId}}", "prompt+keyframes"],
  ["vidu-video", "Vidu Video", "Vidu", "video", "https://api.vidu.com", "/v1/videos", "/v1/tasks/{{taskId}}", "text/image/reference video task"],
  ["pixverse-video", "PixVerse Video", "PixVerse", "video", "https://app-api.pixverse.ai", "/openapi/v2/video/text/generate", "/openapi/v2/video/result/{{taskId}}", "model+duration+quality+effect"],
  ["zhipu-cogvideox", "Wisdom Chart CogVideoX", "Zhipu AI", "video", "https://open.bigmodel.cn/api/paas", "/v4/videos/generations", "/v4/async-result/{{taskId}}", "model+prompt+image_url+quality+with_audio"],
  ["baidu-video", "Baidu Qianfan Video", "Baidu AI Cloud", "video", "https://qianfan.baidubce.com", "/v2/video/generations", "/v2/video/generations/{{taskId}}", "model-specific input"],
  ["tencent-hunyuan-video", "Tencent Hunyuan Video", "Tencent Cloud", "video", "https://hunyuan.tencentcloudapi.com", "/", "/", "TC3 Action task"],
  ["tencent-hunyuan-image", "Tencent Hunyuan pictures", "Tencent Cloud", "image", "https://hunyuan.tencentcloudapi.com", "/", "/", "TC3 Action task"],
  ["baidu-qianfan-image", "Baidu Qianfan pictures", "Baidu AI Cloud", "image", "https://qianfan.baidubce.com", "/v2/images/generations", null, "model-specific image input"]
]) {
  const params = capability === "text" ? textParams : capability === "image" ? imageParams : videoParams;
  const optionPath = `request.providerOptions.${id}`;
  const standardFields = capability === "text"
    ? { model: ref("request.model"), messages: ref("request.messages"), input: omit(ref("request.prompt")), parameters: omit(ref(`${optionPath}.parameters`)) }
    : capability === "image"
      ? { model: ref("request.model"), prompt: ref("request.prompt"), images: omit(map(ref("request.images"), "media", ref("media.value"))), parameters: omit(ref(`${optionPath}.parameters`)) }
      : { model: ref("request.model"), prompt: ref("request.prompt"), images: omit(map(ref("request.images"), "media", ref("media.value"))), videos: omit(map(ref("request.videos"), "media", ref("media.value"))), audios: omit(map(ref("request.audios"), "media", ref("media.value"))), duration: omit(ref("request.duration")), aspect_ratio: omit(ref("request.aspectRatio")), resolution: omit(ref("request.resolution")), ...(id === "seedance-videos-compatible" ? { generate_audio: ref("request.extra.generateAudio") } : {}), parameters: omit(ref(`${optionPath}.parameters`)) };
  const standard = { $merge: [standardFields, coalesce(ref(`${optionPath}.body`), ref(`${optionPath}.extra_body`), {})] };
  let auth = bearer;
  let configuration;
  let operationExtra = id.startsWith("dashscope-") ? { headers: { "X-DashScope-Async": "enable" } } : {};
  if (id.startsWith("aws-bedrock-")) {
    auth = { type: "aws-sigv4", field: "apiKey", secretField: "secretKey", service: "bedrock" };
    configuration = { fields: [{ name: "apiKey", type: "secret", label: "Access Key ID", required: true }, { name: "secretKey", type: "secret", label: "Secret Access Key", required: true }] };
  } else if (id.startsWith("tencent-")) {
    auth = { type: "tc3", field: "apiKey", secretField: "secretKey", service: "hunyuan" };
    configuration = { fields: [{ name: "apiKey", type: "secret", label: "SecretId", required: true }, { name: "secretKey", type: "secret", label: "SecretKey", required: true }] };
    operationExtra = { headers: { "X-TC-Action": ref(`${optionPath}.action`), "X-TC-Version": ref(`${optionPath}.version`) } };
  } else if (id === "azure-openai") {
    auth = { type: "header", field: "apiKey", header: "api-key" };
    operationExtra = { query: { "api-version": coalesce(ref(`${optionPath}.api-version`), "2024-10-21") } };
  }
  add({
    id, providerId: id, name, vendor, capability, baseUrl, auth, params, configuration,
    ...(id === "seedance-videos-compatible" ? { version: "2.0.1" } : {}),
    notes: `The protocol's model-level fields change quickly or depend on cloud resource configuration. Plug-in fixed line protocol entry and unified fields, complete vendor object through providerOptions.${id} The parameters/input/extra_body is passed in;${requestShape}. When the corresponding authentication driver is not configured, the cloud signature type entry will explicitly fail and will not pretend to be a Bearer success.`,
    create: jsonCreate(createPath, standard, operationExtra),
    poll: pollPath ? { method: "GET", path: pollPath } : undefined,
    response: capability === "text"
      ? { status: "succeeded", textPaths: ["output.text", "output_text", "choices.0.message.content", "result"], reasoningPaths: ["reasoning_content"], usage: ref("response.usage"), errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message"] }
      : pollPath ? asyncResponse(capability) : { status: "succeeded", [capability + "s"]: coalesce(ref("response.data"), ref("response.output"), ref("response.url")), errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message"] }
  });
}

for (const [id, name, capability, createPath, pollPath, resultPath] of [
  ["fal-queue-image", "fal.ai Queue Image", "image", "/{{model}}", "/{{request.providerOptions.fal-queue-image.statusPath}}", "response.images"],
  ["fal-queue-video", "fal.ai Queue Video", "video", "/{{model}}", "/{{request.providerOptions.fal-queue-video.statusPath}}", "response.video"],
  ["replicate-prediction-image", "Replicate Predictions Image", "image", "/v1/predictions", "/v1/predictions/{{taskId}}", "response.output"],
  ["replicate-prediction-video", "Replicate Predictions Video", "video", "/v1/predictions", "/v1/predictions/{{taskId}}", "response.output"],
  ["pika-via-fal", "Pika via fal.ai", "video", "/{{model}}", "/{{request.providerOptions.pika-via-fal.statusPath}}", "response.video"]
]) {
  const optionPath = `request.providerOptions.${id}`;
  add({
    id, providerId: id, name, vendor: id.includes("replicate") ? "Replicate" : id.includes("comfy") ? "ComfyUI" : "fal.ai", capability,
    baseUrl: id.includes("replicate") ? "https://api.replicate.com" : id.includes("fal") || id.includes("pika") ? "https://queue.fal.run" : "http://127.0.0.1:8188",
    auth: id.includes("comfy") ? { type: "none", field: "apiKey" } : bearer,
    params: capability === "image" ? imageParams : videoParams,
    notes: "This is a runtime/workflow protocol, and model fields are determined by endpoint, version, or workflow schema. Plugins do not forge fixed model fields; providerOptions.input/workflow/prompt is the complete request object, and the actual access version is locked by the conformance fixture.",
    create: jsonCreate(createPath, {
      version: omit(ref(`${optionPath}.version`)), model: omit(coalesce(ref(`${optionPath}.model`), ref("request.model"))),
      input: omit(coalesce(ref(`${optionPath}.input`), { prompt: ref("request.prompt"), images: map(ref("request.images"), "media", ref("media.value")), videos: map(ref("request.videos"), "media", ref("media.value")), audios: map(ref("request.audios"), "media", ref("media.value")) })),
      prompt: omit(ref(`${optionPath}.workflow`)), client_id: omit(ref(`${optionPath}.client_id`)), webhook: omit(ref(`${optionPath}.webhook`)), webhook_events_filter: omit(ref(`${optionPath}.webhook_events_filter`))
    }),
    poll: pollPath ? { method: "GET", path: pollPath } : undefined,
    cancel: id.includes("replicate") ? { method: "POST", path: "/v1/predictions/{{taskId}}/cancel" } : undefined,
    response: asyncResponse(capability, { [capability + "s"]: ref(resultPath), taskId: coalesce(ref("response.id"), ref("response.request_id"), ref("response.prompt_id"), ref("taskId")) })
  });
}

function manifestFor(spec) {
  return {
    apiVersion: "beeftv.plugin/v2",
    id: spec.id,
    name: spec.name,
    version: spec.version || "2.0.0",
    author: "BeefTV Contributors",
    description: `${spec.name} Independent request protocol plugin.`,
    documentation: `# ${spec.name}The complete fields, mappings, responses, authentication and compatibility boundaries are found in the package's README.md and docs/interface.md.

## BeefTV runtime contract

Users only operate unified text, image or video capabilities; the plug-in is responsible for converting unified requests into${spec.name} upstream agreement.`,
    permissions: ["generation.run", "media.read"],
    configuration: spec.configuration || config(),
    contributes: {
      providers: [{
        id: spec.providerId,
        label: spec.name,
        ...(spec.legacyAliases ? { legacyAliases: spec.legacyAliases } : {}),
        ...(spec.presets ? { presets: spec.presets } : {}),
        capabilities: [spec.capability],
        scopes,
        baseUrl: spec.baseUrl,
        requiresPublicMediaUrls: spec.requiresPublicMediaUrls === true,
        ...(spec.mediaTransport ? { mediaTransport: spec.mediaTransport } : {}),
        auth: spec.auth,
        parameters: parameters(spec.params),
        ...(spec.validations ? { validations: spec.validations } : {}),
        create: spec.create,
        ...(spec.agent ? { agent: spec.agent } : {}),
        ...(spec.poll ? { poll: spec.poll } : {}),
        ...(spec.cancel ? { cancel: spec.cancel } : {}),
        ...(spec.result ? { result: spec.result } : {}),
        response: spec.response,
        ...(spec.agentResponse ? { agentResponse: spec.agentResponse } : {})
      }]
    }
  };
}

function collectTemplateFields(value, prefix, rows) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push([prefix, "[]"]);
    value.forEach((item, index) => collectTemplateFields(item, `${prefix}[${index}]`, rows));
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0].startsWith("$")) {
      rows.push([prefix, JSON.stringify(value)]);
      return;
    }
    if (keys.length === 0) rows.push([prefix, "{}"]);
    for (const key of keys) collectTemplateFields(value[key], prefix ? `${prefix}.${key}` : key, rows);
    return;
  }
  rows.push([prefix, JSON.stringify(value)]);
}

function operationFieldRows(operation, label) {
  if (!operation) return [];
  const rows = [
    [`${label}.method`, JSON.stringify(operation.method)],
    [`${label}.path`, JSON.stringify(operation.path || "dynamic")],
    [`${label}.contentType`, JSON.stringify(operation.contentType || "application/json")]
  ];
  collectTemplateFields(operation.body, `${label}.body`, rows);
  collectTemplateFields(operation.query, `${label}.query`, rows);
  collectTemplateFields(operation.headers, `${label}.headers`, rows);
  collectTemplateFields(operation.files, `${label}.files`, rows);
  return rows;
}

function docsFor(spec) {
  const rows = spec.params.map(([name, type, required, mapping, description]) => `| \`${name}\` | ${type} | ${required ? "Yes" : "No"} | \`${mapping}\` | ${description} |`).join("\n");
  const operationRows = [
    ...operationFieldRows(spec.create, "create"),
    ...operationFieldRows(spec.agent, "agent"),
    ...operationFieldRows(spec.poll, "poll"),
    ...operationFieldRows(spec.cancel, "cancel"),
    ...operationFieldRows(spec.result, "result")
  ].map(([path, expression]) => `| \`${path}\` | \`${String(expression).replaceAll("|", "\\|")}\` |`).join("\n");
  const responseRows = [];
  collectTemplateFields(spec.response, "response", responseRows);
  collectTemplateFields(spec.agentResponse, "agentResponse", responseRows);
  const mappedResponseRows = responseRows.map(([path, expression]) => `| \`${path}\` | \`${String(expression).replaceAll("|", "\\|")}\` |`).join("\n");
  const manifestJSON = JSON.stringify({ create: spec.create, agent: spec.agent, poll: spec.poll, cancel: spec.cancel, result: spec.result, response: spec.response, agentResponse: spec.agentResponse });
  const optionRefs = [...new Set([...manifestJSON.matchAll(new RegExp(`request\\.providerOptions\\.${spec.providerId.replaceAll("-", "\\-")}\\.([A-Za-z0-9_.-]+)`, "g"))].map((match) => match[1]))].sort();
  const optionRows = optionRefs.length ? optionRefs.map((name) => `- \`providerOptions.${spec.providerId}.${name}\``).join("\n") : "- No additional expansion keys.";
  const configRows = (spec.configuration || config()).fields.map((field) => `| \`${field.name}\` | ${field.type} | ${field.required ? "Yes" : "No"} | ${field.label || ""} |`).join("\n");
  const successCodes = Array.isArray(spec.response?.successCodes) ? spec.response.successCodes : [];
  const errorSemantics = successCodes.length
    ? `HTTP errors and error objects maintain failure semantics and are not packaged as success; in business code${successCodes.map((code) => `\`${code}\``).join("、")} It is the success code declared by the protocol. It is not considered a failure. Other business codes still fail.`
    : "HTTP errors, business code and error objects maintain failure semantics and are not packaged as success.";
  return `# ${spec.name} interface fields${spec.docsIntro ? `${spec.docsIntro}\n\n` : ""}## Protocol Identity

- Plugin ID: \`${spec.id}\`。\n- Provider ID：\`${spec.providerId}\`。\n${spec.presets ? `- Service provider default:${spec.presets.map((preset) => `${preset.label}（\`${preset.baseUrl}\`）`).join("、")}。\n` : ""}${spec.legacyAliases ? `- Old ID (can still be resolved to this interface):${spec.legacyAliases.map((alias) => `\`${alias}\``).join("、")}。\n` : ""}- Abilities: \`${spec.capability}\`.
-Default Base URL: \`${spec.baseUrl}\`.
- Authentication driver: \`${spec.auth?.type || "Default"}\`.
-Create:\`${spec.create.method} ${spec.create.path || "dynamic path"}\`。\n${spec.agent ? `- Agent：\`${spec.agent.method} ${spec.agent.path || "dynamic path"}\`。\n` : ""}${spec.poll ? `- Query: \`${spec.poll.method} ${spec.poll.path}\`。\n` : "- Life cycle: synchronous response."}${spec.cancel ? `- Cancel: \`${spec.cancel.method} ${spec.cancel.path}\`。\n` : ""}## Configuration fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |${configRows}## Unified field mapping

| Uniform Fields | Type | Required | Upstream Mapping | Description |
| --- | --- | --- | --- | --- |${rows}## Field-by-field list of upstream request templates

The table below is generated by the plugin request template and covers every field in the body, query, headers and multipart file declarations.

| upstream position | value or conversion expression |
| --- | --- |${operationRows || "| `create` | No request fields |"}## Provider extension key${optionRows}Dynamic models or workflows are allowed to use the complete \`parameters/input/extra_body\` object declared by the document; this object is the open schema of the protocol itself and will not be tailored by the host.

## Response mapping field-by-field list

| Mapping location | Upstream path or transformation expression |
| --- | --- |${mappedResponseRows || "| `response` | No explicit mapping |"}## Responses and Errors

The plug-in maps the upstream task/status/text/media/usage to a unified result. Ephemeral media URLs are marked as ephemeral and are immediately downloaded for persistence by the host.${errorSemantics}## Compatibility boundary${spec.notes || "This package only represents the above line protocol profile; other endpoint, cloud zone or gateway packages of the same brand must use independent plug-ins and cannot be guessed based on the model name."}\n`;
}

const requestedPackageIDs = new Set(process.argv.slice(2).map((value) => value.trim()).filter(Boolean));
const selectedSpecs = requestedPackageIDs.size > 0 ? specs.filter((spec) => requestedPackageIDs.has(spec.id)) : specs;
if (requestedPackageIDs.size > 0 && selectedSpecs.length !== requestedPackageIDs.size) {
  const found = new Set(selectedSpecs.map((spec) => spec.id));
  const missing = [...requestedPackageIDs].filter((id) => !found.has(id));
  throw new Error(`unknown protocol package id(s): ${missing.join(", ")}`);
}

for (const spec of selectedSpecs) {
  const dir = join(root, spec.id);
  await mkdir(join(dir, "docs"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifestFor(spec), null, 2) + "\n");
  await writeFile(join(dir, "README.md"), `# ${spec.name}This directory is the BeefTV declarative protocol plug-in source code. The backend is generated from \`${spec.id}.beeftv-plugin\` 包加载，不依赖系统内置 \`host:\` 适配器。\n\n本插件由 BeefTV Contributors 维护，用于适配 ${spec.vendor}Related service interfaces; it does not mean that BeefTV has an affiliation, authorization or cooperative relationship with the service provider.

See [docs/interface.md](docs/interface.md) for the complete interface.`);
  await writeFile(join(dir, "docs", "interface.md"), docsFor(spec));
}

console.log(`generated ${selectedSpecs.length} protocol packages`);
await import("./embed-documentation.mjs");
