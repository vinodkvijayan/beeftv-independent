export type StyleAssetKind = "lora" | "template" | "reference" | "prompt";
export type StyleAssetStatus = "draft" | "validated" | "unavailable";

export type StyleAssetBinding = {
    id: string;
    kind: StyleAssetKind;
    provider: string;
    title: string;
    enabled?: boolean;
    sourceId?: string;
    sourceUrl?: string;
    model?: string;
    version?: string;
    baseModels?: string[];
    triggerWords?: string[];
    promptFragment?: string;
    weight?: number;
    parameters?: {
        sampler?: string;
        steps?: number;
        cfg?: number;
        size?: string;
    };
    referenceUrls?: string[];
    referenceResourceIds?: string[];
    status: StyleAssetStatus;
    license?: {
        commercial?: boolean;
        note?: string;
        source?: string;
        capturedAt?: string;
    };
};

export type StyleProfileSnapshot = {
    schemaVersion: 1;
    presetId: string;
    title: string;
    description: string;
    tags: string[];
    prompt: string;
    negativePrompt?: string;
    coverUrl?: string;
    sourceProfileId?: string;
    selection?: Record<string, string>;
    assets: StyleAssetBinding[];
    executionPolicy?: "compatible-fallback" | "strict-assets";
    source: "builtin" | "user" | "external";
    revision: number;
};

export type StyleProfileSource = Pick<StyleProfileSnapshot, "title" | "description" | "tags" | "prompt"> & {
    // 内置画风使用 id，持久化配置使用 presetId，两种来源在此统一归一化。
    presetId?: string;
    id?: string;
    negativePrompt?: string;
    coverUrl?: string;
    sourceProfileId?: string;
    selection?: Record<string, string>;
    assets?: StyleAssetBinding[];
    executionPolicy?: StyleProfileSnapshot["executionPolicy"];
    source?: StyleProfileSnapshot["source"];
    revision?: number;
};

const MAX_PROFILE_BYTES = 256 * 1024;
export const MAX_STYLE_ASSETS = 20;

export type StyleExecutionContext = {
    mode: "image" | "video";
    model: string;
    interfaceType?: string;
};

export type StyleExecutionAsset = {
    assetId: string;
    title: string;
    kind: StyleAssetKind;
    action: "prompt" | "native" | "reference" | "skip" | "block";
    reason: string;
};

export type StyleExecutionPlan = {
    schemaVersion: 1;
    profilePresetId: string;
    profileRevision: number;
    mode: StyleExecutionContext["mode"];
    model: string;
    interfaceType?: string;
    status: "ready" | "degraded" | "blocked";
    prompt: string;
    assets: StyleExecutionAsset[];
    warnings: string[];
};

export function createStyleProfileSnapshot(source: StyleProfileSource): StyleProfileSnapshot {
    return {
        schemaVersion: 1,
        presetId: (source.presetId || source.id || "").trim(),
        title: source.title.trim(),
        description: source.description.trim(),
        tags: source.tags.map((tag) => tag.trim()).filter(Boolean),
        prompt: source.prompt.trim(),
        negativePrompt: source.negativePrompt?.trim() || undefined,
        coverUrl: source.coverUrl?.trim() || undefined,
        sourceProfileId: source.sourceProfileId?.trim() || undefined,
        selection: source.selection ? { ...source.selection } : undefined,
        assets: source.assets
            ? source.assets.map((asset) => ({
                  ...asset,
                  parameters: asset.parameters ? { ...asset.parameters } : undefined,
                  license: asset.license ? { ...asset.license } : undefined,
                  baseModels: asset.baseModels ? [...asset.baseModels] : undefined,
                  triggerWords: asset.triggerWords ? [...asset.triggerWords] : undefined,
                  referenceUrls: asset.referenceUrls ? [...asset.referenceUrls] : undefined,
                  referenceResourceIds: asset.referenceResourceIds ? [...asset.referenceResourceIds] : undefined,
              }))
            : [],
        executionPolicy: source.executionPolicy || "compatible-fallback",
        source: source.source || "builtin",
        revision: source.revision || 1,
    };
}

export function serializeStyleProfile(profile: StyleProfileSnapshot): string {
    const normalized = createStyleProfileSnapshot(profile);
    const validationMessage = styleProfileValidationMessage(normalized);
    if (validationMessage) throw new Error(validationMessage);
    const serialized = JSON.stringify(normalized);
    if (new TextEncoder().encode(serialized).length > MAX_PROFILE_BYTES) throw new Error("Project style asset allocation is too large");
    return serialized;
}

export function parseStyleProfile(value?: string | null): StyleProfileSnapshot | null {
    const raw = String(value || "").trim();
    if (!raw || new TextEncoder().encode(raw).length > MAX_PROFILE_BYTES) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<StyleProfileSnapshot>;
        if (
            parsed.schemaVersion !== 1 ||
            typeof parsed.presetId !== "string" ||
            typeof parsed.title !== "string" ||
            typeof parsed.description !== "string" ||
            typeof parsed.prompt !== "string" ||
            !Array.isArray(parsed.tags) ||
            !Array.isArray(parsed.assets)
        )
            return null;
        if (!parsed.tags.every((tag) => typeof tag === "string")) return null;
        if ([parsed.negativePrompt, parsed.coverUrl, parsed.sourceProfileId].some((value) => value !== undefined && typeof value !== "string")) return null;
        if (parsed.selection !== undefined && (!parsed.selection || typeof parsed.selection !== "object" || Array.isArray(parsed.selection) || !Object.values(parsed.selection).every((value) => typeof value === "string"))) return null;
        if (!parsed.assets.every(isStyleAssetBinding)) return null;
        if (parsed.source !== "builtin" && parsed.source !== "user" && parsed.source !== "external") return null;
        if (parsed.executionPolicy !== undefined && parsed.executionPolicy !== "compatible-fallback" && parsed.executionPolicy !== "strict-assets") return null;
        if (!Number.isInteger(parsed.revision) || Number(parsed.revision) < 1) return null;
        const profile = createStyleProfileSnapshot(parsed as StyleProfileSource);
        return styleProfileValidationMessage(profile) ? null : profile;
    } catch {
        return null;
    }
}

export function resolveStyleProfile(presetId: string | undefined, profileJson?: string | null, fallback?: StyleProfileSource): StyleProfileSnapshot | null {
    return parseStyleProfile(profileJson) || (fallback ? createStyleProfileSnapshot({ ...fallback, presetId: fallback.presetId || String(presetId || "") }) : null);
}

export function resolveStyleExecutionPlan(profile: StyleProfileSnapshot, context: StyleExecutionContext): StyleExecutionPlan {
    const assets = profile.assets.filter((asset) => asset.enabled !== false).map((asset) => resolveAssetExecution(asset, context));
    const blockedAssets = assets.filter((asset) => asset.action === "block");
    const skippedAssets = assets.filter((asset) => asset.action === "skip");
    const promptAssetIds = new Set(assets.filter((asset) => asset.action === "prompt").map((asset) => asset.assetId));
    const promptFragments = profile.assets
        .filter((asset) => promptAssetIds.has(asset.id))
        .flatMap((asset) => [asset.promptFragment, ...(asset.triggerWords || [])])
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    const strictBlocked = profile.executionPolicy === "strict-assets" && (blockedAssets.length > 0 || skippedAssets.length > 0);
    const warnings = [...blockedAssets, ...skippedAssets].map((asset) => `${asset.title}：${asset.reason}`);
    return {
        schemaVersion: 1,
        profilePresetId: profile.presetId,
        profileRevision: profile.revision,
        mode: context.mode,
        model: context.model,
        interfaceType: context.interfaceType,
        status: strictBlocked ? "blocked" : warnings.length ? "degraded" : "ready",
        prompt: [profile.prompt, profile.negativePrompt ? `[Global Negative Prompt]${profile.negativePrompt}` : "", ...promptFragments].filter(Boolean).join("\n"),
        assets,
        warnings,
    };
}

export function applyStyleExecutionPlan(prompt: string, plan: StyleExecutionPlan) {
    const content = prompt.trim();
    const stylePrompt = plan.prompt.trim();
    if (!stylePrompt || content.includes(stylePrompt)) return content;
    return [content, "[Project style execution specifications]", stylePrompt].filter(Boolean).join("\n\n");
}

export function styleAssetValidationMessage(asset: StyleAssetBinding) {
    if (!asset.id.trim()) return "Asset ID cannot be empty";
    if (!asset.title.trim()) return "Please fill in the asset name";
    if (!asset.provider.trim()) return "Please fill in the source platform or adapter";
    if (asset.weight !== undefined && (!Number.isFinite(asset.weight) || asset.weight < 0 || asset.weight > 2)) return "LoRA weight must be between 0 and 2";
    if ((asset.baseModels?.length || 0) > 20) return "A single asset can declare up to 20 compatible models";
    if ((asset.triggerWords?.length || 0) > 50) return "A single asset can declare up to 50 trigger words.";
    if ((asset.referenceUrls?.length || 0) > 20 || (asset.referenceResourceIds?.length || 0) > 20) return "A single reference image group can bind up to 20 URLs and 20 resources.";
    if (asset.parameters?.steps !== undefined && (!Number.isInteger(asset.parameters.steps) || asset.parameters.steps < 1 || asset.parameters.steps > 200)) return "Steps must be between 1 and 200";
    if (asset.parameters?.cfg !== undefined && (!Number.isFinite(asset.parameters.cfg) || asset.parameters.cfg < 0 || asset.parameters.cfg > 50)) return "CFG must be between 0 and 50";
    if (asset.status !== "validated") return "";
    if (asset.kind === "lora" && !asset.sourceId?.trim() && !asset.sourceUrl?.trim()) return "Verified LoRA must fill in the source asset ID or URL";
    if ((asset.kind === "prompt" || asset.kind === "template") && !asset.promptFragment?.trim() && !asset.triggerWords?.some((word) => word.trim())) return "The verified template or prompt word module must fill in the prompt word content";
    if (asset.kind === "reference" && !asset.referenceUrls?.some((url) => url.trim()) && !asset.referenceResourceIds?.some((id) => id.trim())) return "The verified reference picture group must be bound to the reference picture";
    return "";
}

export function styleProfileValidationMessage(profile: StyleProfileSnapshot) {
    if (!profile.presetId.trim() || profile.revision < 1) return "Project style snapshot is missing required fields";
    if (!profile.title.trim()) return "Please fill in the style name";
    if (!profile.prompt.trim()) return "Please fill in the complete style Prompt";
    if (profile.title.length > 80) return "Style name can be up to 80 characters long";
    if (profile.description.length > 500) return "Style introduction up to 500 words";
    if (profile.tags.length > 20) return "Up to 20 style tags";
    if (profile.selection && Object.keys(profile.selection).length > 20) return "Up to 20 items of auxiliary annotations for project style";
    if (profile.selection && Object.entries(profile.selection).some(([key, value]) => !key.trim() || key.length > 64 || value.length > 200)) return "The project style auxiliary annotation format is invalid";
    if ((profile.coverUrl?.length || 0) > 4096) return "Style cover address is too long";
    if (profile.coverUrl && !isStyleCoverUrl(profile.coverUrl)) return "Style cover only supports http(s), site path or image Data URL";
    if ((profile.negativePrompt?.length || 0) > 64 * 1024) return "Negative Prompt is too large";
    if (profile.assets.length > MAX_STYLE_ASSETS) return `Project style is most bound${MAX_STYLE_ASSETS} execution assets`;
    const ids = new Set<string>();
    for (const asset of profile.assets) {
        const assetMessage = styleAssetValidationMessage(asset);
        if (assetMessage) return `${asset.title || "unnamed asset"}：${assetMessage}`;
        if (ids.has(asset.id)) return "Project style execution asset ID cannot be repeated";
        ids.add(asset.id);
    }
    return "";
}

function isStyleCoverUrl(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith("http://") || normalized.startsWith("https://") || normalized.startsWith("/") || normalized.startsWith("data:image/");
}

function resolveAssetExecution(asset: StyleAssetBinding, context: StyleExecutionContext): StyleExecutionAsset {
    if (asset.status !== "validated") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "skip", reason: asset.status === "unavailable" ? "Asset is currently unavailable" : "Asset has not been verified" };
    if (asset.baseModels?.length && !asset.baseModels.some((model) => model.trim().toLowerCase() === context.model.trim().toLowerCase())) {
        return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: `Compatible only${asset.baseModels.join("、")}` };
    }
    if (asset.kind === "prompt") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "prompt", reason: "Add style prompts to project" };
    if (asset.kind === "template" && (asset.promptFragment?.trim() || asset.triggerWords?.length)) return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "prompt", reason: "Currently executed with template trigger words" };
    if (asset.kind === "reference") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: "Project reference diagram auto-injection adapter is not enabled yet" };
    if (asset.kind === "lora") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: `current${context.interfaceType || "pictures"} Protocol is not enabled for LoRA adapter` };
    return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: "The execution asset is not supported by the current protocol" };
}

function isStyleAssetBinding(value: unknown): value is StyleAssetBinding {
    if (!value || typeof value !== "object") return false;
    const asset = value as Partial<StyleAssetBinding>;
    if (
        typeof asset.id !== "string" ||
        typeof asset.kind !== "string" ||
        !["lora", "template", "reference", "prompt"].includes(asset.kind) ||
        typeof asset.provider !== "string" ||
        typeof asset.title !== "string" ||
        !["draft", "validated", "unavailable"].includes(String(asset.status))
    )
        return false;
    if (asset.enabled !== undefined && typeof asset.enabled !== "boolean") return false;
    if (asset.weight !== undefined && (!Number.isFinite(asset.weight) || asset.weight < 0 || asset.weight > 2)) return false;
    if (![asset.sourceId, asset.sourceUrl, asset.model, asset.version, asset.promptFragment].every(isOptionalString)) return false;
    if (![asset.baseModels, asset.triggerWords, asset.referenceUrls, asset.referenceResourceIds].every((values) => values === undefined || (Array.isArray(values) && values.every((item) => typeof item === "string")))) return false;
    if (
        asset.parameters !== undefined &&
        (!asset.parameters ||
            typeof asset.parameters !== "object" ||
            !isOptionalString(asset.parameters.sampler) ||
            !isOptionalString(asset.parameters.size) ||
            (asset.parameters.steps !== undefined && !Number.isInteger(asset.parameters.steps)) ||
            (asset.parameters.cfg !== undefined && !Number.isFinite(asset.parameters.cfg)))
    )
        return false;
    if (
        asset.license !== undefined &&
        (!asset.license || typeof asset.license !== "object" || (asset.license.commercial !== undefined && typeof asset.license.commercial !== "boolean") || ![asset.license.note, asset.license.source, asset.license.capturedAt].every(isOptionalString))
    )
        return false;
    return !styleAssetValidationMessage(asset as StyleAssetBinding);
}

function isOptionalString(value: unknown) {
    return value === undefined || typeof value === "string";
}
