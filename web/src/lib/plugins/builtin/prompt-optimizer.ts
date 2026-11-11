import { registerPlugin } from "../plugin-registry";
import type {
    PluginManifest,
    PluginTextContentPart,
    PluginTextMessage,
    PluginTextTool,
    PromptOptimizationInput,
    PromptOptimizationMode,
    PromptOptimizationResult,
    PromptOptimizationVariant,
    PromptOptimizerProvider,
    RegisteredPlugin,
} from "../plugin-types";

export const PROMPT_OPTIMIZER_PLUGIN_ID = "prompt-optimizer";

const modeLabels: Record<PromptOptimizationMode, string> = {
    expand: "expand ideas",
    refine: "Refine existing prompt words",
    style: "Enhance visual style",
    "model-adapt": "Adapt to current model",
    reference: "Combined with reference material",
};

const optimizerTool: PluginTextTool = {
    type: "function",
    function: {
        name: "optimize_prompt",
        description: "Returns structured AI image or video prompt word optimization results.",
        strict: true,
        parameters: {
            type: "object",
            additionalProperties: false,
            required: ["optimizedPrompt", "negativePrompt", "changes", "assumptions", "variants"],
            properties: {
                optimizedPrompt: { type: "string", description: "Can be used directly to generate positive prompt words." },
                negativePrompt: { type: "string", description: "Content to be avoided; if not available, an empty string is returned." },
                changes: { type: "array", items: { type: "string" }, description: "Key changes compared to entering the prompt word." },
                assumptions: { type: "array", items: { type: "string" }, description: "Assumptions made about fuzzy requirements; returns an empty array if none." },
                variants: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["label", "prompt"],
                        properties: {
                            label: { type: "string" },
                            prompt: { type: "string" },
                        },
                    },
                    description: "Up to two optional prompt word versions.",
                },
            },
        },
    },
};

const manifest: PluginManifest = {
    id: PROMPT_OPTIMIZER_PLUGIN_ID,
    name: "AI prompt word optimizer",
    version: "0.3.0",
    apiVersion: "beeftv.plugin/v1",
    description: "Organize vague drawing ideas into prompt words that are executable, comparable, and suitable for the current model.",
    author: "Built-in tools",
    permissions: ["canvas.read", "canvas.write", "ai.text"],
    trusted: true,
    contributes: {},
};

const systemPrompt = [
    "You are the prompt word director in the current creation workbench, responsible for organizing the user's vague visual ideas into prompt words that can be directly handed over to the generative model.",
    "Only optimize expression and executability, and do not change the subject, identity, action, quantity, era, location, aspect ratio or safety boundaries clearly written by the user without authorization.",
    "Prioritize the use of specific visual language: subject and relationship, composition and scene, action, environment, material, light, color, lens and style.",
    "If the input is clear enough, keep the original meaning and refine it with restraint; if the information is insufficient, write the uncertain items into assumptions and don't pretend to know.",
    "Choose expression according to generationMode: pictures focus on static images, composition and materials, videos focus on action continuity, sense of duration, camera movement and end-to-end connection.",
    "When the optimization mode is to adapt the current model, first determine the model family by combining targetProtocol and targetModel, and then strictly implement the model adaptation strategy; do not make up non-existent parameters, weight syntax, or model capabilities.",
    "The optimize_prompt tool must be called eventually, do not output Markdown, and do not interpret outside of the tool call.",
].join("\n");

type ModelAdaptationProfile = {
    id: string;
    label: string;
    promptShape: string;
    rules: string[];
    avoid: string[];
};

const genericImageProfile: ModelAdaptationProfile = {
    id: "generic-image",
    label: "Universal picture model",
    promptShape: "Natural language description, arranged by subject and action → environment → composition → light and material → style.",
    rules: ["First lock the subject, quantity, identity and action, and then add the visible details of the picture.", "Make important proportions, text, placement, and consistency requirements clear."],
    avoid: ["Don't make up vendor parameters or control syntax.", "Don’t just put key avoidance items in negativePrompt. Positive prompt words must also be clearly expressed."],
};

const genericVideoProfile: ModelAdaptationProfile = {
    id: "generic-video",
    label: "Universal video model",
    promptShape: "Single shot timing description, arranged in the order of starting picture → main action → camera movement → environment change → ending state.",
    rules: ["Use observable, continuous verbs for each action to avoid cramming a paragraph into multiple disconnected shots.", "Be clear about who is moving in subjects, shots, and environments, and keep characters, costumes, and scenes consistent."],
    avoid: ["Don’t pile still photography parameters into a keyword list.", "Don't add transitions, characters, or storylines that the user didn't request."],
};

function containsAny(value: string, keywords: string[]) {
    return keywords.some((keyword) => value.includes(keyword));
}

function resolveModelAdaptationProfile(input: PromptOptimizationInput): ModelAdaptationProfile {
    const model = `${input.targetModel || ""} ${input.targetProtocol || ""}`.toLowerCase();
    if (input.generationMode === "image") {
        if (containsAny(model, ["gemini", "imagen", "nano-banana", "nanobanana"])) {
            return {
                id: "gemini-image",
                label: "Gemini / Imagen picture model",
                promptShape: "Clear natural language scene descriptions, organized by Subject → Background & Context → Style & Photographic Details.",
                rules: ["Prefer complete sentences and specific visual facts, and refer to images to describe only what is actually visible.", "If the picture contains text, keep the original text and clarify the location, level and number of words, and avoid irrelevant decorations.", "To control the length of prompt words, first retain the three core levels of subject, context and style."],
                avoid: ["Do not use SD weights, backword tags, or unconfirmed vendor parameters."],
            };
        }
        if (containsAny(model, ["gpt-image", "dall-e", "dalle", "openai-image", "openai"])) {
            return {
                id: "openai-image",
                label: "OpenAI image model",
                promptShape: "A concise and complete natural language description, first describing what is to be generated, and then adding composition, light, material and style.",
                rules: ["Use screen descriptions that the model can directly understand, and do not write prompt words as console parameters.", "Use clear sentences about the text, position, quantity, and subject relationships in the picture."],
                avoid: ["Do not add SD weights, comma keyword stacking, or -- parameters.", "Don't rely on negativePrompt alone; important restrictions should be written into the positive description."],
            };
        }
        if (containsAny(model, ["grok-image", "grok-imagine"])) {
            return {
                id: "grok-image",
                label: "Grok picture model",
                promptShape: "Concise natural language picture description, with clear layering of subject, action, environment and visual style.",
                rules: ["Keep clear subject relationships, composition, and stylistic intent, and avoid writing prompts as lists of parameters.", "When you have a reference picture, explain the main theme or stylistic features that you want to retain, and don’t speculate on invisible details."],
                avoid: ["Do not add SD weights, Midjourney parameters, or control syntax that the model is not confirmed to support."],
            };
        }
        if (containsAny(model, ["seedream", "jimeng", "doubao", "volcengine-ark-image", "volcengine-ark-agent-plan-image", "volcengine-jimeng-image"])) {
            return {
                id: "seedream-image",
                label: "Seedream / 即梦 / 火山图片模型",
                promptShape: "Chinese natural language lens description, organized by subject and action → composition → light and shadow → material and style.",
                rules: ["Prioritize the appearance, movements, spatial relationships and key points of the characters or subjects.", "Repeat key appearance features when character consistency is needed, and avoid just writing abstract ‘keep it consistent’.", "Chinese needs to be expressed in Chinese, and English proper nouns are only retained when they are really helpful."],
                avoid: ["Don't apply SD's weighted syntax, quality strings, or meaningless English tags.", "Don’t mix multiple shots and conflicting actions into one prompt."],
            };
        }
        if (containsAny(model, ["flux"])) {
            return {
                id: "flux-image",
                label: "FLUX picture model",
                promptShape: "Natural language paragraphs + a few clear visual keywords, with subject and action at the front.",
                rules: ["Describe subject, location, material, and light in concrete relationships rather than repeating quality adjectives.", "The style and composition specified by the user are retained, and model parameters are not actively added."],
                avoid: ["Don't output long lists of comma tags or stacked negative prompts.", "Do not add LoRA, sampler, or weight markers not requested by the user."],
            };
        }
        if (containsAny(model, ["sdxl", "stable-diffusion", "stable diffusion", "sd3", "stable3"])) {
            return {
                id: "stable-diffusion-image",
                label: "Stable Diffusion / SDXL image model",
                promptShape: "Compact layered keywords or short sentences, organized by subject → composition → light → style and quality.",
                rules: ["Only keep keywords that can affect the picture, giving priority to the subject and composition.", "If the original prompt word already uses bracket weighting, keep it and adjust it slightly if necessary.", "Express the main body of the picture and the reverse avoidance items separately to avoid conflict with each other."],
                avoid: ["Don’t blindly add too many quality words, artist names, or model-specific tags.", "If you are not sure whether the weight syntax is supported by the current channel, do not actively add it."],
            };
        }
        if (containsAny(model, ["midjourney", "mid-journey"])) {
            return {
                id: "midjourney-image",
                label: "Midjourney picture model",
                promptShape: "A concise visual description with clear subject, scene, composition and style, with parameters at the end.",
                rules: ["Prioritize screen content and visual direction, and keep it short and recognizable.", "Parameters such as --ar and --stylize are retained only if originally provided or explicitly requested by the user."],
                avoid: ["Don’t make up Midjourney parameters or pile all the photography jargon on it.", "Do not use command prefixes that are not related to the current workbench protocol."],
            };
        }
        if (containsAny(model, ["ideogram", "recraft"])) {
            return {
                id: "design-image",
                label: "Design and text picture mockup",
                promptShape: "First explain the canvas, main body and layout, and then explain the text content, position, level, font temperament and color matching.",
                rules: ["The text on the screen retains the precise original text and controls the number of words to clarify the spatial relationship between the text and the subject.", "Distinguish content, layout and visual style, and avoid giving only abstract aesthetic words."],
                avoid: ["Do not rewrite brand names, titles, numbers or slogans without permission."],
            };
        }
        return genericImageProfile;
    }

    if (containsAny(model, ["seedance", "doubao-seedance", "volcengine-ark-video", "volcengine-ark-agent-plan-video", "volcengine-jimeng-video", "jimeng-video"])) {
        return {
            id: "seedance-video",
            label: "Seedance/Jimeng Video Model",
            promptShape: "Single-shot timing description, clarifying the starting composition, action rhythm, camera movement, environmental changes and ending status.",
            rules: ["Use sequential actions to describe how the subject begins, develops, and ends, maintaining cause-and-effect relationships within the shot.", "Consistency of characters, costumes, sets, and props takes precedence over stacked style words.", "When you have a first frame or reference image, make it clear what content must be maintained and what content is allowed to change."],
            avoid: ["Don't splice multiple unrelated shots into one prompt.", "Don't treat static image parameters as video action instructions."],
        };
    }
    if (containsAny(model, ["veo", "gemini-veo"])) {
        return {
            id: "veo-video",
            label: "Veo video model",
            promptShape: "Cinematic natural language shot description, organized by subject, action, shot, environment and rhythm.",
            rules: ["Break down ideas into observable actions and camera movements, and supplement them with chronology.", "Use visual elements such as scene, camera position, camera movement, light and environmental sound to control the lens."],
            avoid: ["Don't just write in mood and abstract style without giving action or shot changes.", "Don't include multi-camera transitions that were not requested by the user."],
        };
    }
    if (containsAny(model, ["kling"])) {
        return {
            id: "kling-video",
            label: "Kling video model",
            promptShape: "Concise and continuous action instructions clarify the subject movement and camera movement.",
            rules: ["Write down the subject, direction, speed or result of each action to avoid conflicting actions.", "Prioritize physical continuity, character consistency and camera stability."],
            avoid: ["Don’t include too much abstract narrative or events that can’t be accomplished in a short clip."],
        };
    }
    if (containsAny(model, ["runway", "gen-3", "gen3", "minimax-video", "hailuo", "wan", "ltx-video", "hunyuan-video"])) {
        return {
            id: "general-video-family",
            label: "Universal video model",
            promptShape: "Describe the starting scene, action sequence, camera, and ending scene as a single shot.",
            rules: ["Use continuous verbs for actions, clarify the moving subject and camera, and do not write the results as static adjectives.", "Maintain continuity with characters, costumes, scenery, and lighting."],
            avoid: ["Don’t stuff static image keywords or schedule too many actions at once."],
        };
    }
    return genericVideoProfile;
}

function buildUserMessage(input: PromptOptimizationInput, modelProfile: ModelAdaptationProfile | null = input.mode === "model-adapt" ? resolveModelAdaptationProfile(input) : null): PluginTextMessage {
    const textParts = [
        `Optimization mode:${modeLabels[input.mode]}`,
        `Target type:${input.generationMode === "image" ? "pictures" : "video"}`,
        `Target generation model:${input.targetModel?.trim() || "unspecified"}`,
        `Target interface protocol:${input.targetProtocol?.trim() || "unspecified"}`,
        "",
        "User's original prompt word:",
        input.prompt.trim() || "(The user has not written a specific prompt word, please extract an executable version from the reference context)",
    ];
    if (modelProfile) {
        textParts.push(
            "",
            `Model adaptation strategy:${modelProfile.label}`,
            `Suggested prompt word structure:${modelProfile.promptShape}`,
            "Must comply with:",
            ...modelProfile.rules.map((rule) => `- ${rule}`),
            "Avoid:",
            ...modelProfile.avoid.map((rule) => `- ${rule}`),
            "Please clearly state the key points of model adaptation that have been adopted in changes.",
        );
    }
    if (input.context?.texts?.length) {
        textParts.push("", "Connected text context:", ...input.context.texts.map((item) => `- ${item.title}：${item.text}`));
    }
    if (input.context?.images?.length) {
        textParts.push("", "The connected reference image has been input as an image, please only make judgments on the content that is actually visible:", ...input.context.images.map((item) => `- ${item.title}`));
    }
    textParts.push(
        "",
        "Output requirements:",
        "1. optimizedPrompt is a prompt word that can be copied directly to the current generation node.",
        "2. negativePrompt Only fill in the avoidance items that are clearly helpful, and leave them blank if they are not.",
        "3. Use short Chinese entries for changes and assumptions.",
        "4. Variants gives at most two versions that are obviously different but still faithful to the original intention, and returns an empty array when not necessary.",
    );

    const content: PluginTextContentPart[] = [{ type: "text", text: textParts.join("\n") }];
    for (const image of input.context?.images || []) {
        if (/^(data:|https?:\/\/)/i.test(image.url.trim())) content.push({ type: "image_url", image_url: { url: image.url.trim() } });
    }
    return { role: "user", content };
}

function parseJsonObject(value: string) {
    const cleaned = value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
    const candidates = [cleaned];
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
            // 某些兼容模型会在 JSON 外包一层解释，继续尝试截取对象部分。
        }
    }
    return null;
}

function stringArray(value: unknown) {
    return Array.isArray(value)
        ? value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
        : [];
}

function variants(value: unknown): PromptOptimizationVariant[] {
    if (!Array.isArray(value)) return [];
    return value
        .flatMap((item): PromptOptimizationVariant[] => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const label = typeof record.label === "string" ? record.label.trim() : "alternative version";
            const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
            return prompt ? [{ label: label || "alternative version", prompt }] : [];
        })
        .slice(0, 2);
}

function normalizeResult(value: Record<string, unknown> | null, sourcePrompt: string, modelProfile?: ModelAdaptationProfile | null): PromptOptimizationResult {
    const optimizedPrompt = typeof value?.optimizedPrompt === "string" ? value.optimizedPrompt.trim() : "";
    const negativePrompt = typeof value?.negativePrompt === "string" ? value.negativePrompt.trim() : "";
    return {
        optimizedPrompt: optimizedPrompt || sourcePrompt.trim(),
        negativePrompt,
        changes: stringArray(value?.changes),
        assumptions: stringArray(value?.assumptions),
        variants: variants(value?.variants),
        modelProfile: modelProfile ? { id: modelProfile.id, label: modelProfile.label } : undefined,
    };
}

function createPromptOptimizer(context: Parameters<NonNullable<RegisteredPlugin["createPromptOptimizer"]>>[0]): PromptOptimizerProvider {
    const textService = context.services?.ai?.text;
    if (!textService) throw new Error("The prompt word optimizer has not yet obtained the text model service");

    return {
        optimize: async (input, options) => {
            const modelProfile = input.mode === "model-adapt" ? resolveModelAdaptationProfile(input) : null;
            const response = await textService.requestToolResponse({
                model: input.optimizerModel,
                messages: [{ role: "system", content: systemPrompt }, buildUserMessage(input, modelProfile)],
                tools: [optimizerTool],
                toolChoice: { type: "function", name: "optimize_prompt" },
                signal: options?.signal,
                onDelta: options?.onDelta,
            });
            const toolCall = response.toolCalls.find((call) => call.name === "optimize_prompt");
            const parsed = parseJsonObject(toolCall?.arguments || response.content);
            return normalizeResult(parsed, input.prompt, modelProfile);
        },
    };
}

export const promptOptimizerPlugin: RegisteredPlugin = {
    manifest,
    createPromptOptimizer,
    setup(host) {
        return host.contribute("canvas.promptActions", {
            id: "prompt-optimizer",
            label: "polish",
            order: 10,
            nodeTypes: ["image", "video"],
        });
    },
};

registerPlugin(promptOptimizerPlugin);
