/**
 * Professional cinematography prompt library for the Camera Control panel.
 *
 * Ported from open-storyboard-canvas, simplified for the web project.
 * The output prompt is a comma-joinable fragment appended to the user's
 * generation prompt so the image model treats it as camera direction.
 */

export interface CameraProfile {
    id: string;
    label: string;
    zhName: string;
    shortTag: string;
    profilePrompt: string;
    bodyColor: string;
    accentColor: string;
    useCase: string;
    description: string;
}

export interface LensProfile {
    id: string;
    label: string;
    zhName: string;
    shortTag: string;
    profilePrompt: string;
    lensColor: string;
    ringColor: string;
    useCase: string;
    description: string;
}

export interface CameraControlOptions {
    enabled: boolean;
    camera: string;
    lens: string;
    focalLength: number;
    aperture: number;
}

export const CAMERA_PROFILES: CameraProfile[] = [
    {
        id: "panavision_dxl2",
        label: "Panavision DXL2",
        zhName: "Panavision DXL2",
        shortTag: "Panavision DXL2",
        profilePrompt: "shot on Panavision DXL2 with Panavision DXL color science, large-format Monstro 8K VV sensor, signature organic highlight rolloff, rich filmic texture, premium modern cinema look",
        bodyColor: "#2a2a2a",
        accentColor: "#e2a84f",
        description: "Hollywood's top cinema projector, 8K large-format sensor, smooth texture.",
        useCase: "Feature films, luxury commercials, top commercial films",
    },
    {
        id: "arri_alexa_mini_lf",
        label: "ARRI Alexa Mini LF",
        zhName: "Allais Mini LF",
        shortTag: "ARRI Alexa Mini LF",
        profilePrompt: "shot on ARRI Alexa Mini LF with ARRI Wide Gamut color science, ALEV III large-format sensor, gorgeous skin-tone rendering, buttery highlight rolloff, industry-standard feature-film look",
        bodyColor: "#3a3a3a",
        accentColor: "#d4d4d4",
        description: "The industry's benchmark cinema projector, recognized as the best in skin tone rendering.",
        useCase: "Feature films, portrait narratives, brand advertising",
    },
    {
        id: "red_komodo_6k",
        label: "RED Komodo 6K",
        zhName: "RED Komodo 6K",
        shortTag: "RED Komodo 6K",
        profilePrompt: "shot on RED Komodo 6K with RED IPP2 color pipeline, Super35 global-shutter sensor, crisp modern digital detail, clean shadows, crisp action-movie look",
        bodyColor: "#8b2b2b",
        accentColor: "#ff3b3b",
        description: "Compact global shutter 6K, no jelly effect, perfect for action movies.",
        useCase: "Action movies, FPV, time travel, drones",
    },
    {
        id: "red_v_raptor_8k",
        label: "RED V-Raptor 8K",
        zhName: "RED V-Raptor 8K",
        shortTag: "RED V-Raptor 8K",
        profilePrompt: "shot on RED V-Raptor 8K VV, RED IPP2 color pipeline, 8K Vista Vision sensor, razor-sharp resolution, vivid yet natural color",
        bodyColor: "#701f1f",
        accentColor: "#ff5555",
        description: "RED flagship 8K Vista Vision, ultimate clarity.",
        useCase: "Sci-fi blockbusters, high-resolution VFX scenes",
    },
    {
        id: "sony_venice_2",
        label: "Sony Venice 2",
        zhName: "Sony Venice 2",
        shortTag: "Sony Venice 2",
        profilePrompt: "shot on Sony Venice 2 with Sony S-Gamut3.Cine / S-Log3, dual native ISO full-frame cinema sensor, clean shadows, highly refined modern color science",
        bodyColor: "#2d3a4d",
        accentColor: "#4d90d0",
        description: "Full-frame dual native ISO, excellent low-light performance.",
        useCase: "High-end advertising, documentaries, night dramas",
    },
    {
        id: "sony_fx6",
        label: "Sony FX6",
        zhName: "Sony FX6",
        shortTag: "Sony FX6",
        profilePrompt: "shot on Sony FX6, Sony Venice-derived color science, full-frame cinema sensor, clean low-light performance, documentary-friendly modern look",
        bodyColor: "#2d2d36",
        accentColor: "#ff9000",
        description: "Lightweight full-frame Cinema Line, commonly used for handheld documentaries.",
        useCase: "Documentaries, interviews with individual soldiers, light plots",
    },
    {
        id: "blackmagic_ursa_12k",
        label: "Blackmagic URSA 12K",
        zhName: "Black Magic URSA 12K",
        shortTag: "Blackmagic URSA 12K",
        profilePrompt: "shot on Blackmagic URSA Cine 12K with Blackmagic Generation 5 color science, Super35 12K sensor, rich filmic tones, indie-cinema aesthetic",
        bodyColor: "#2e2e2e",
        accentColor: "#ffb820",
        description: "The darling of independent filmmakers, this 12K high-resolution cost-effective machine.",
        useCase: "Independent films, music shorts, experimental videos",
    },
    {
        id: "canon_c500_mk2",
        label: "Canon C500 Mk II",
        zhName: "Canon C500 Mk II",
        shortTag: "Canon C500 Mk II",
        profilePrompt: "shot on Canon C500 Mark II with Canon Cinema Gamut, full-frame cinema sensor, warm natural skin tones, premium broadcast and feature-film character",
        bodyColor: "#332a22",
        accentColor: "#e8c070",
        description: "Canon color science, warm skin tone, broadcast-level movie projector.",
        useCase: "Advertisements, TV series, wedding movies",
    },
];

export const LENS_PROFILES: LensProfile[] = [
    {
        id: "arri_signature_prime",
        label: "ARRI Signature Prime",
        zhName: "Master Alai fixed focus",
        shortTag: "ARRI Signature Prime",
        profilePrompt: "ARRI Signature Prime lens, large-format coverage, creamy organic bokeh, gentle contrast, smooth highlight rolloff, soft flattering flares",
        lensColor: "#2a2a2a",
        ringColor: "#c4a060",
        description: "Top-notch large-format fixed focus lens with creamy blur and warm contrast.",
        useCase: "Character narrative, top commercial film",
    },
    {
        id: "cooke_s7i",
        label: "Cooke S7/i",
        zhName: "Cook S7/i",
        shortTag: "Cooke S7/i",
        profilePrompt: "Cooke S7/i lens, legendary \"Cooke Look\", warm color bias, gentle contrast, soft rounded bokeh, classic flattering skin rendering",
        lensColor: "#26231d",
        ringColor: "#d0a060",
        description: "The legendary \"Cooke Look\" has a warm reddish tone and is flattering on the skin tone.",
        useCase: "Classical portraits, contemporary narratives",
    },
    {
        id: "zeiss_supreme_prime",
        label: "Zeiss Supreme Prime",
        zhName: "Zeiss supreme fixed focus",
        shortTag: "Zeiss Supreme Prime",
        profilePrompt: "Zeiss Supreme Prime lens, neutral modern color, high micro-contrast, sharp yet refined detail, clean bokeh with subtle cat-eye near edges",
        lensColor: "#1e1e22",
        ringColor: "#4d90d0",
        description: "Neutral modern colors with subtle contrast that are sharp but not hard.",
        useCase: "Technological advertising, modern plot",
    },
    {
        id: "canon_sumire_prime",
        label: "Canon Sumire Prime",
        zhName: "Canon Sumire fixed focus",
        shortTag: "Canon Sumire Prime",
        profilePrompt: "Canon Sumire Prime lens, soft organic character, warm gentle color rendering, dreamy rounded bokeh, cinematic softness for portraits",
        lensColor: "#2c241c",
        ringColor: "#e0b070",
        description: "Soft and dreamy skin color mirror, warm and soft focus.",
        useCase: "Romance movies, dreams, close-ups of characters",
    },
    {
        id: "anamorphic_cooke",
        label: "Anamorphic (Cooke)",
        zhName: "Cooke anamorphic widescreen",
        shortTag: "Cooke Anamorphic",
        profilePrompt: "Cooke anamorphic lens, oval bokeh, horizontal blue streaks for flares, wide cinematic framing, subtle focus roll-off, 2.39:1 anamorphic cinematic feel",
        lensColor: "#1a1a24",
        ringColor: "#6a9ed6",
        description: "Widescreen anamorphic lens, elliptical blur + horizontal blue halo.",
        useCase: "Science fiction blockbusters, space dramas, night dramas",
    },
    {
        id: "anamorphic_atlas",
        label: "Anamorphic (Atlas)",
        zhName: "Atlas Orion Transformation",
        shortTag: "Atlas Orion Anamorphic",
        profilePrompt: "Atlas Orion anamorphic lens, oval bokeh, cyan horizontal flares, modern anamorphic look with clean center and subtle edge blur",
        lensColor: "#1b2228",
        ringColor: "#40c0e0",
        description: "Modern deformable mirror, cyan halo, clear center and soft edges.",
        useCase: "Music MV, stylized advertising",
    },
    {
        id: "vintage_leica_r",
        label: "Vintage Leica R",
        zhName: "Leica R vintage glasses",
        shortTag: "Vintage Leica R",
        profilePrompt: "vintage Leica R prime lens, rich color saturation, slight glow on highlights, slightly soft edges, nostalgic 1970s-80s cinema character",
        lensColor: "#3a2f1f",
        ringColor: "#d04040",
        description: "Old mirrors from the last century, with slightly overflowing highlights and a retro and nostalgic feel.",
        useCase: "Period dramas, nostalgic MVs, literary films",
    },
    {
        id: "macro_100mm",
        label: "Macro 100mm",
        zhName: "100mm macro",
        shortTag: "Macro 100mm",
        profilePrompt: "macro 100mm prime lens, extremely shallow depth of field, razor-thin focus plane, smooth creamy bokeh, detail-rich close-up rendering",
        lensColor: "#1f1f1f",
        ringColor: "#60d090",
        description: "Specially designed for macro close-ups, the details are amazing and the depth of field is extremely shallow.",
        useCase: "Food ads, jewelry, insects, details",
    },
];

export const FOCAL_LENGTHS = [14, 18, 24, 35, 40, 50, 65, 85, 100, 135, 200] as const;
export const APERTURES = [1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16] as const;

export const FOCAL_LENGTH_META: Record<number, { zhName: string; description: string; useCase: string }> = {
    14: { zhName: "super wide angle", description: "14mm extremely wide angle, the space is extremely stretched", useCase: "Building interiors, landscape panoramas, immersive perspectives" },
    18: { zhName: "super wide angle", description: "18mm super wide angle, strong spatial depth", useCase: "street photography, interiors, architecture" },
    24: { zhName: "wide angle", description: "24mm wide angle, strong sense of environment", useCase: "Scenery, big scenes, news records" },
    35: { zhName: "small wide angle", description: "35mm, a classic narrative focal length, close to the human eye", useCase: "Documentary, character and environment narrative" },
    40: { zhName: "quasi-standard", description: "40mm quasi-standard, balanced composition", useCase: "Portrait narrative, literary film" },
    50: { zhName: "Standard", description: "50mm standard, natural sense of space", useCase: "Portraits, daily life, street photography" },
    65: { zhName: "medium focus", description: "65mm medium focus, slight compression, flattering on skin tones", useCase: "Bust, dialogue play" },
    85: { zhName: "medium telephoto", description: "85mm classic portrait focal length", useCase: "Close-up portrait, wedding" },
    100: { zhName: "Telephoto", description: "100mm telephoto, obvious background compression", useCase: "close-up, macro, sports" },
    135: { zhName: "Telephoto", description: "135mm telephoto for movies", useCase: "Drama close-up, stage" },
    200: { zhName: "super telephoto", description: "200mm super telephoto, ultimate background compression", useCase: "Sports, wildlife, dramatic close-up" },
};

export const APERTURE_META: Record<number, { zhName: string; description: string; useCase: string }> = {
    1.2: { zhName: "maximum aperture", description: "f/1.2, extreme blur, depth of field as thin as a knife", useCase: "Dream portrait, highlight overflow effect" },
    1.4: { zhName: "Large aperture", description: "f/1.4 strong blur, full cinematic feel", useCase: "Night scene portrait, dark light" },
    1.8: { zhName: "Large aperture", description: "f/1.8 obvious background blur", useCase: "Half-length portrait, street low light" },
    2: { zhName: "Large aperture", description: "f/2 soft bokeh and ample sharpness", useCase: "Portrait, literary and daily life" },
    2.8: { zhName: "Standard large aperture", description: "f/2.8, moderate depth of field, soft blur", useCase: "group portrait, narrative" },
    4: { zhName: "medium aperture", description: "f/4 The subject is clear and the background is slightly blurred", useCase: "Group portraits, weddings, TV series" },
    5.6: { zhName: "medium aperture", description: "f/5.6 The background is discernible and the environment is strong", useCase: "Documentary, daily life, sketch" },
    8: { zhName: "small aperture", description: "f/8 is the best image quality area, both front and rear are clear", useCase: "scenery, architecture, panorama" },
    11: { zhName: "small aperture", description: "f/11 super large depth of field, almost completely clear", useCase: "Large scenes and product posing" },
    16: { zhName: "Very small aperture", description: "f/16 Starbursts appear, requiring a high light source", useCase: "Sunlight scenery, starburst special effects" },
};

const CAMERA_PROMPT_TEMPLATE = [
    "the following parameters describe the virtual camera, lens, and exposure used to render this image",
    "they are camera direction, NOT objects to add inside the frame",
    "do not add any physical camera, lens, tripod, viewfinder, or photography equipment into the image",
    "{{cameraProfilePrompt}}, {{lensProfilePrompt}}, {{focalLengthPrompt}}, {{aperturePrompt}}",
    "keep the subjects, scene, and action unchanged — apply these as optical and sensor characteristics only",
    "[camera body: {{cameraBody}} · lens: {{lens}} · focal: {{focalLengthMm}}mm · aperture: f/{{apertureF}}]",
].join(", ");

export function describeFocalLength(mm: number): string {
    if (mm <= 16) return `${mm}mm ultra-wide-angle perspective, strong spatial depth, pronounced edge distortion, immersive wide coverage`;
    if (mm <= 24) return `${mm}mm wide-angle perspective, exaggerated depth, strong foreground/background separation, environment-forward framing`;
    if (mm <= 35) return `${mm}mm slight-wide cinematic perspective, natural environmental context, balanced depth, classic story-telling framing`;
    if (mm <= 50) return `${mm}mm standard/normal perspective, close to natural human eye perspective, neutral spatial compression, flattering portrait framing`;
    if (mm <= 85) return `${mm}mm short-telephoto portrait perspective, mild background compression, flattering facial rendering, subject isolation`;
    if (mm <= 135) return `${mm}mm telephoto perspective, moderate compression, strong subject isolation from background, cinematic close-up`;
    return `${mm}mm long-telephoto perspective, strong background compression, highly isolated subject on compressed flat background, powerful dramatic framing`;
}

export function describeAperture(f: number): string {
    if (f <= 1.4) return `shot wide open at f/${f}, extremely shallow depth of field, strong creamy bokeh, razor-thin focus plane, dreamy background separation`;
    if (f <= 2) return `shot at f/${f}, very shallow depth of field, smooth cinematic bokeh, clear subject-from-background separation`;
    if (f <= 2.8) return `shot at f/${f}, shallow depth of field, soft bokeh, natural subject isolation`;
    if (f <= 4) return `shot at f/${f}, moderate depth of field, gentle falloff, clean background blur without over-smoothing`;
    if (f <= 5.6) return `shot at f/${f}, balanced depth of field, background retains context while subject remains clearly in focus`;
    if (f <= 8) return `shot at f/${f}, wide depth of field, environment and subject both sharp, documentary / landscape style`;
    return `shot at f/${f}, very wide depth of field, extensive sharpness from foreground to background, wide-open environmental feel`;
}

function applyTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
}

export interface CameraPromptInput {
    cameraId: string;
    lensId: string;
    focalLengthMm: number;
    apertureF: number;
}

export function buildCameraPrompt(input: CameraPromptInput): string {
    // 镜头参数会进入图片生成写路径，未知枚举不能静默退回首项，否则持久化配置与实际生成语义会不一致。
    const camera = CAMERA_PROFILES.find((item) => item.id === input.cameraId);
    if (!camera) throw new Error(`Unsupported camera configurations:${input.cameraId}`);
    const lens = LENS_PROFILES.find((item) => item.id === input.lensId);
    if (!lens) throw new Error(`Unsupported lens configurations:${input.lensId}`);
    if (!FOCAL_LENGTHS.includes(input.focalLengthMm as (typeof FOCAL_LENGTHS)[number])) throw new Error(`Unsupported focal lengths:${input.focalLengthMm}mm`);
    if (!APERTURES.includes(input.apertureF as (typeof APERTURES)[number])) throw new Error(`Unsupported aperture: f/${input.apertureF}`);
    return applyTemplate(CAMERA_PROMPT_TEMPLATE, {
        cameraProfilePrompt: camera.profilePrompt,
        lensProfilePrompt: lens.profilePrompt,
        focalLengthPrompt: describeFocalLength(input.focalLengthMm),
        aperturePrompt: describeAperture(input.apertureF),
        cameraBody: camera.shortTag,
        lens: lens.shortTag,
        focalLengthMm: String(input.focalLengthMm),
        apertureF: String(input.apertureF),
    });
}
