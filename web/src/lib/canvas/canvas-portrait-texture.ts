export type PortraitTextureSettings = {
    personSceneFusion: "light" | "natural" | "deep";
    lightingFusion: "soft" | "natural" | "atmosphere";
    skin: "clear" | "natural" | "real";
    texture: "soft" | "natural" | "grain";
    sharpness: "soft" | "standard" | "high";
};

export type PortraitTextureSettingKey = keyof PortraitTextureSettings;

type PortraitTextureOption = {
    value: string;
    label: string;
    prompt: string;
};

export type PortraitTextureGroup = {
    key: PortraitTextureSettingKey;
    label: string;
    options: readonly PortraitTextureOption[];
};

export const DEFAULT_PORTRAIT_TEXTURE_SETTINGS: PortraitTextureSettings = {
    personSceneFusion: "deep",
    lightingFusion: "natural",
    skin: "natural",
    texture: "natural",
    sharpness: "standard",
};

export const PORTRAIT_TEXTURE_GROUPS: readonly PortraitTextureGroup[] = [
    {
        key: "personSceneFusion",
        label: "Fusion of people and scenery",
        options: [
            { value: "light", label: "light alignment", prompt: "Lightly align characters and scenes, only correcting obvious edges and spatial relationships" },
            { value: "natural", label: "natural blend", prompt: "Naturally integrate characters and scenes, unifying edges, tones and spatial relationships" },
            { value: "deep", label: "Deep integration", prompt: "Deeply integrate characters and scenes, and carefully unify edges, environment colors and spatial levels." },
        ],
    },
    {
        key: "lightingFusion",
        label: "Fusion of light and shadow",
        options: [
            { value: "soft", label: "Soft fill light", prompt: "Use soft fill light to soften harsh shadows and preserve natural light and dark" },
            { value: "natural", label: "natural match", prompt: "Let the character's light direction, color temperature and scene light naturally match" },
            { value: "atmosphere", label: "atmosphere strengthening", prompt: "Strengthen ambient light and ambient light, and keep the direction of light and shadow reasonable." },
        ],
    },
    {
        key: "skin",
        label: "skin",
        options: [
            { value: "clear", label: "Clear touch up", prompt: "Clear and modify the skin, moderately even skin tone without excessive skin polishing" },
            { value: "natural", label: "natural skin", prompt: "Preserve natural skin texture, pores and true skin tone transition" },
            { value: "real", label: "Real texture", prompt: "Enhance real skin texture and subtle texture to avoid plastic feel" },
        ],
    },
    {
        key: "texture",
        label: "texture",
        options: [
            { value: "soft", label: "soft texture", prompt: "Use soft and delicate overall texture to reduce rough noise" },
            { value: "natural", label: "natural texture", prompt: "Maintain the natural texture of clothing, hair, skin, and scene materials" },
            { value: "grain", label: "Grainy texture", prompt: "Add restrained grain texture and material levels" },
        ],
    },
    {
        key: "sharpness",
        label: "sharpness",
        options: [
            { value: "soft", label: "soft focus", prompt: "Use a soft focus effect to keep the outline of your subject visible" },
            { value: "standard", label: "Clear standards", prompt: "Maintain standard definition, with natural details and not over-sharpening" },
            { value: "high", label: "HD sharpening", prompt: "Improve clarity of key details and avoid sharp halos and noise" },
        ],
    },
] as const;

export function normalizePortraitTextureSettings(value: unknown): PortraitTextureSettings {
    const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
        personSceneFusion: normalizeSetting("personSceneFusion", candidate.personSceneFusion),
        lightingFusion: normalizeSetting("lightingFusion", candidate.lightingFusion),
        skin: normalizeSetting("skin", candidate.skin),
        texture: normalizeSetting("texture", candidate.texture),
        sharpness: normalizeSetting("sharpness", candidate.sharpness),
    };
}

export function buildPortraitTexturePrompt(userPrompt: string, value: unknown) {
    const settings = normalizePortraitTextureSettings(value);
    const instructions = PORTRAIT_TEXTURE_GROUPS.map((group) => {
        const selected = group.options.find((option) => option.value === settings[group.key]);
        return `${group.label}（${selected?.label || "Default"}）：${selected?.prompt || "keep it natural"}`;
    });

    return [
        userPrompt.trim(),
        "Please adjust the character texture based on the reference image, and only optimize the following visual attributes:",
        ...instructions.map((instruction) => `- ${instruction}`),
        "The original character's identity, facial features, hairstyle, clothing, posture, composition, scene and picture proportions must be maintained; no new subjects may be added or deleted, and no text, watermarks or logos may be added.",
    ].filter(Boolean).join("\n");
}

function normalizeSetting<Key extends PortraitTextureSettingKey>(key: Key, value: unknown): PortraitTextureSettings[Key] {
    const group = PORTRAIT_TEXTURE_GROUPS.find((item) => item.key === key);
    return group?.options.some((option) => option.value === value)
        ? value as PortraitTextureSettings[Key]
        : DEFAULT_PORTRAIT_TEXTURE_SETTINGS[key];
}
