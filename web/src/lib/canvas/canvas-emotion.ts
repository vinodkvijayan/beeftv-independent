export type CanvasFaceBox = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence?: number;
    source: "detected" | "manual";
};

export type CanvasEmotionEditRegion = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type CanvasEmotionImageArtifacts = {
    sourceDataUrl: string;
    maskDataUrl: string;
    characterDataUrl: string;
    editRegion: CanvasEmotionEditRegion;
    imageWidth: number;
    imageHeight: number;
};

export type CanvasEmotionPreset = {
    id: string;
    label: string;
    intimacy: -2 | -1 | 0 | 1 | 2;
    arousal: -2 | -1 | 0 | 1 | 2;
    prompt: string;
};

export type CanvasEmotionParams = {
    presetId: string;
    intimacy: number;
    arousal: number;
    characterName: string;
    faceBox: CanvasFaceBox;
};

export type CanvasEmotionEditMode = "provider-mask" | "local-composite";

export type CanvasEmotionEditPlan = {
    mode: CanvasEmotionEditMode;
    includeMask: boolean;
    notice?: string;
};

export function resolveEmotionEditPlan(maskSupported: boolean): CanvasEmotionEditPlan {
    return maskSupported
        ? { mode: "provider-mask", includeMask: true }
        : { mode: "local-composite", includeMask: false, notice: "The current channel does not support masks, use face cropping and local feathering fusion" };
}

export function emotionProviderMask<T>(plan: CanvasEmotionEditPlan, mask: T) {
    return plan.includeMask ? mask : undefined;
}

type BlendshapeName =
    | "browInnerUp"
    | "browDown_L"
    | "browDown_R"
    | "browOuterUp_L"
    | "browOuterUp_R"
    | "eyeBlink_L"
    | "eyeBlink_R"
    | "eyeSquint_L"
    | "eyeSquint_R"
    | "eyeWide_L"
    | "eyeWide_R"
    | "cheekSquint_L"
    | "cheekSquint_R"
    | "noseSneer_L"
    | "noseSneer_R"
    | "jawOpen"
    | "mouthPucker"
    | "mouthClose"
    | "mouthSmile_L"
    | "mouthSmile_R"
    | "mouthFrown_L"
    | "mouthFrown_R"
    | "mouthDimple_L"
    | "mouthDimple_R"
    | "mouthShrugUpper"
    | "mouthPress_L"
    | "mouthPress_R"
    | "mouthStretch_L"
    | "mouthStretch_R";

export type CanvasEmotionBlendshapes = Partial<Record<BlendshapeName, number>>;

const labels = [
    ["ecstatic", "elated", "surprise", "shocked", "frightened"],
    ["happy", "looking forward to", "focus", "alert", "nervous"],
    ["gentle", "Smiling lightly", "neutral restraint", "forbearance", "Alienation"],
    ["peace of mind", "relieved", "tired", "Lost", "sad"],
    ["satisfy", "calm", "indifferent", "Bear the sadness", "despair"],
] as const;

const prompts = [
    ["A natural, bright toothy smile with symmetrical raised corners of the mouth, naturally raised cheeks, and slight smile lines at the corners of the eyes", "Visibly happy and full of smiles", "Surprise, open your eyes and open your mouth naturally", "Visibly shocked, eyebrows raised, mouth slightly open", "Intense panic, eyes wide open, face tense"],
    ["Naturally cheerful, with a smile in his eyes", "Expectation and excitement, bright expression", "Highly focused and firm-eyed", "Stay alert, eyebrows slightly tightened", "Nervous, pursed lips"],
    ["Gentle and close, slight smile", "A controlled and natural smile", "Completely neutral, restrained, relaxed", "Suppressing emotions, expression slightly stiff", "Alien and calm, reduce facial emotions"],
    ["Relax and gently close the corners of your mouth", "Relieved, eyebrows relaxed", "Visibly tired, droopy eyelids", "Depressed mood, slightly droopy mouth corners", "Sadness, inner eyebrow raised, mouth corners drooping"],
    ["Quiet and contented, slightly closed-mouthed smile", "Calm and relaxed, breathing feels natural", "Cold and restrained, with straight eyes", "Holding back the sadness, lips tightened, eyes dim", "Deep despair, eyebrows sinking, face losing tension"],
] as const;

export const canvasEmotionPresets: CanvasEmotionPreset[] = labels.flatMap((row, rowIndex) =>
    row.map((label, columnIndex) => {
        const intimacy = (2 - columnIndex) as CanvasEmotionPreset["intimacy"];
        const arousal = (2 - rowIndex) as CanvasEmotionPreset["arousal"];
        return {
            id: `emotion-${intimacy}-${arousal}`,
            label,
            intimacy,
            arousal,
            prompt: prompts[rowIndex][columnIndex],
        };
    }),
);

export const neutralEmotionPreset = canvasEmotionPresets.find((preset) => preset.intimacy === 0 && preset.arousal === 0)!;

export function findEmotionPreset(intimacy: number, arousal: number) {
    const x = clampAxis(intimacy);
    const y = clampAxis(arousal);
    return canvasEmotionPresets.find((preset) => preset.intimacy === x && preset.arousal === y) || neutralEmotionPreset;
}

export function emotionBlendshapes(preset: CanvasEmotionPreset): CanvasEmotionBlendshapes {
    if (preset === neutralEmotionPreset || (preset.intimacy === 0 && preset.arousal === 0)) return {};
    const warmth = Math.max(0, preset.intimacy / 2);
    const distance = Math.max(0, -preset.intimacy / 2);
    const activation = Math.max(0, preset.arousal / 2);
    const calm = Math.max(0, -preset.arousal / 2);
    const surprise = Math.max(0, activation * (1 - Math.abs(preset.intimacy) / 3));
    const sadness = Math.max(0, calm * (0.35 + distance * 0.65));
    const smile = warmth * (0.24 + activation * 0.48 + calm * 0.12);
    const tension = distance * (0.16 + activation * 0.46 + calm * 0.22);
    const shapes: CanvasEmotionBlendshapes = {
        browInnerUp: clamp01(surprise * 0.58 + sadness * 0.42),
        browDown_L: clamp01(tension * 0.7),
        browDown_R: clamp01(tension * 0.7),
        browOuterUp_L: clamp01(activation * 0.22 + surprise * 0.32),
        browOuterUp_R: clamp01(activation * 0.22 + surprise * 0.32),
        eyeBlink_L: clamp01(calm * 0.28),
        eyeBlink_R: clamp01(calm * 0.28),
        eyeSquint_L: clamp01(smile * 0.34 + tension * 0.28),
        eyeSquint_R: clamp01(smile * 0.34 + tension * 0.28),
        eyeWide_L: clamp01(activation * (0.16 + surprise * 0.48 + distance * 0.18)),
        eyeWide_R: clamp01(activation * (0.16 + surprise * 0.48 + distance * 0.18)),
        cheekSquint_L: clamp01(smile * 0.42),
        cheekSquint_R: clamp01(smile * 0.42),
        noseSneer_L: clamp01(tension * activation * 0.35),
        noseSneer_R: clamp01(tension * activation * 0.35),
        jawOpen: clamp01(activation * (0.06 + surprise * 0.34)),
        mouthPucker: clamp01(distance * calm * 0.12),
        mouthClose: clamp01(calm * 0.18 + tension * 0.2),
        mouthSmile_L: clamp01(smile),
        mouthSmile_R: clamp01(smile),
        mouthFrown_L: clamp01(sadness * 0.54 + distance * calm * 0.14),
        mouthFrown_R: clamp01(sadness * 0.54 + distance * calm * 0.14),
        mouthDimple_L: clamp01(warmth * 0.22),
        mouthDimple_R: clamp01(warmth * 0.22),
        mouthShrugUpper: clamp01(sadness * 0.18),
        mouthPress_L: clamp01(tension * 0.48 + calm * distance * 0.18),
        mouthPress_R: clamp01(tension * 0.48 + calm * distance * 0.18),
        mouthStretch_L: clamp01(activation * distance * 0.24),
        mouthStretch_R: clamp01(activation * distance * 0.24),
    };
    return Object.fromEntries(Object.entries(shapes).filter(([, value]) => Boolean(value && value > 0.01))) as CanvasEmotionBlendshapes;
}

export function clampAxis(value: number): CanvasEmotionPreset["intimacy"] {
    return Math.max(-2, Math.min(2, Math.round(value))) as CanvasEmotionPreset["intimacy"];
}

export function buildEmotionPrompt(params: CanvasEmotionParams, editRegion: CanvasEmotionEditRegion) {
    const preset = canvasEmotionPresets.find((item) => item.id === params.presetId) || findEmotionPreset(params.intimacy, params.arousal);
    const targetRegion = describeEmotionTarget(params.faceBox, editRegion);
    return [
        `Only modify the "${params.characterName}"The facial expression and other pixels remain consistent with the source image.`,
        `Target emotion:${preset.label};Expression requirements:${preset.prompt}. Emotional intensity is expressed through muscle tone in the brows, corners of the mouth, and cheeks, not by exaggerating the mouth or redrawing the entire face.`,
        "The first input image is the only editing target. The second input image is only used to verify the identity of the same person. The composition, background or lighting of the second image must not be copied.",
        targetRegion,
        "If other faces appear in the first input image, all other faces will be considered as uneditable backgrounds; only the target face frame and its adjacent expression area are allowed to be modified.",
        "Only change the expression details of the eyebrows, eye corners, mouth corners, cheeks and inside the mouth; keep the size and direction of the eyes, width of the mouth cleft, number and arrangement of teeth, lip thickness, chin contour and face shape natural and consistent with the original image.",
        "The input image has been cropped to the head area of the target person; only redraw the target face and its expression-related details, do not generate or modify other content in the cropped image.",
        "Strictly keep the character's identity, facial features proportions, skin color, hairstyle, hair, ears, accessories, clothing, posture, head orientation, lens, depth of field, light, background and other characters in the picture unchanged; do not redraw glasses, hats or obstructions.",
        "Exaggerated cartoon smiles, mouths that are too wide or stretched, teeth like a straight white wall, unnatural gums exposed, eyes deformed or narrowed into lines, bulging cheeks, plastic dermabrasion, repeated facial features, and any identity drift are prohibited.",
    ].join("\n");
}

export function normalizeEmotionPromptForProvider(prompt: string) {
    return prompt
        .replaceAll("The actual editable range is bounded by the transparent elliptical mask around the face.", "Finally, only the elliptical area around the face is merged back to the original image.")
        .replaceAll("Only the face corresponding to the target frame and its transparent mask is allowed to be modified.", "Only the target face frame and its adjacent expression area are allowed to be modified.")
        .replaceAll("The input image has been cropped to the head area of the target character; editing is allowed within the transparent mask, the white mask area must remain unchanged, and absolutely no content should be generated or modified outside the mask.", "The input image has been cropped to the head area of the target person; only redraw the target face and its expression-related details, do not generate or modify other content in the cropped image.");
}

function describeEmotionTarget(box: CanvasFaceBox, region: CanvasEmotionEditRegion) {
    const x = clamp(Math.round(box.x - region.x), 0, Math.max(0, region.width - 1));
    const y = clamp(Math.round(box.y - region.y), 0, Math.max(0, region.height - 1));
    const width = Math.max(1, Math.min(region.width - x, Math.round(box.width)));
    const height = Math.max(1, Math.min(region.height - y, Math.round(box.height)));
    const centerX = Math.round(((x + width / 2) / Math.max(1, region.width)) * 100);
    const centerY = Math.round(((y + height / 2) / Math.max(1, region.height)) * 100);
    return `Target face frame (relative to the first cropped input image): x=${x}px，y=${y}px，width=${width}px，height=${height}px; the center of the face is approximately at the center of the cropped image${centerX}% horizontal,${centerY}% portrait. Finally, only the elliptical area around the face is merged back to the original image.`;
}

export async function buildEmotionImageArtifacts(dataUrl: string, box: CanvasFaceBox, imageWidth: number, imageHeight: number): Promise<CanvasEmotionImageArtifacts> {
    const image = await loadImageBitmap(dataUrl);
    try {
        const width = image.width || imageWidth;
        const height = image.height || imageHeight;
        const normalized = clampFaceBox(box, width, height);
        const editRegion = resolveEmotionEditRegion(normalized, width, height);
        return {
            sourceDataUrl: drawSourceCrop(image, editRegion),
            maskDataUrl: drawFaceMask(normalized, editRegion),
            characterDataUrl: drawFaceCrop(image, normalized, width, height),
            editRegion,
            imageWidth: width,
            imageHeight: height,
        };
    } finally {
        image.close();
    }
}

export function emotionGenerationSize(region: CanvasEmotionEditRegion) {
    const ratio = region.width / Math.max(1, region.height);
    if (ratio >= 1.2) return "1536x1024";
    if (ratio <= 0.83) return "1024x1536";
    return "1024x1024";
}

// 模型只负责局部重绘；最终结果始终以源图为底，仅在羽化人脸蒙版内混合生成像素。
export async function compositeEmotionImage(sourceDataUrl: string, generatedDataUrl: string, region: CanvasEmotionEditRegion, faceBox: CanvasFaceBox) {
    const [source, generated] = await Promise.all([loadImageBitmap(sourceDataUrl), loadImageBitmap(generatedDataUrl)]);
    try {
        const normalizedRegion = clampEditRegion(region, source.width, source.height);
        const normalizedFace = clampFaceBox(faceBox, source.width, source.height);
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("The browser cannot synthesize the expression editing results");
        context.drawImage(source, 0, 0);

        const generatedCanvas = document.createElement("canvas");
        generatedCanvas.width = normalizedRegion.width;
        generatedCanvas.height = normalizedRegion.height;
        const generatedContext = generatedCanvas.getContext("2d", { willReadFrequently: true });
        if (!generatedContext) throw new Error("The browser cannot read the emoticon generation results");
        generatedContext.imageSmoothingEnabled = true;
        generatedContext.imageSmoothingQuality = "high";
        generatedContext.drawImage(generated, 0, 0, generated.width, generated.height, 0, 0, normalizedRegion.width, normalizedRegion.height);

        const sourcePixels = context.getImageData(normalizedRegion.x, normalizedRegion.y, normalizedRegion.width, normalizedRegion.height);
        const generatedPixels = generatedContext.getImageData(0, 0, normalizedRegion.width, normalizedRegion.height);
        const ellipse = emotionEditEllipse(normalizedFace, normalizedRegion);
        const gains = sampleEdgeColorGains(sourcePixels.data, generatedPixels.data, normalizedRegion.width, normalizedRegion.height, ellipse);
        blendEmotionPixels(sourcePixels.data, generatedPixels.data, normalizedRegion.width, normalizedRegion.height, ellipse, gains);
        context.putImageData(sourcePixels, normalizedRegion.x, normalizedRegion.y);
        return canvas.toDataURL("image/png");
    } finally {
        source.close();
        generated.close();
    }
}

export function clampFaceBox(box: CanvasFaceBox, imageWidth: number, imageHeight: number): CanvasFaceBox {
    const x = Math.max(0, Math.min(imageWidth - 1, box.x));
    const y = Math.max(0, Math.min(imageHeight - 1, box.y));
    return {
        ...box,
        x,
        y,
        width: Math.max(1, Math.min(imageWidth - x, box.width)),
        height: Math.max(1, Math.min(imageHeight - y, box.height)),
    };
}

function resolveEmotionEditRegion(box: CanvasFaceBox, imageWidth: number, imageHeight: number): CanvasEmotionEditRegion {
    const left = Math.floor(Math.max(0, box.x - box.width * 0.85));
    const top = Math.floor(Math.max(0, box.y - box.height * 0.75));
    const right = Math.ceil(Math.min(imageWidth, box.x + box.width * 1.85));
    const bottom = Math.ceil(Math.min(imageHeight, box.y + box.height * 2));
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function clampEditRegion(region: CanvasEmotionEditRegion, imageWidth: number, imageHeight: number): CanvasEmotionEditRegion {
    const x = Math.max(0, Math.min(imageWidth - 1, Math.round(region.x)));
    const y = Math.max(0, Math.min(imageHeight - 1, Math.round(region.y)));
    return {
        x,
        y,
        width: Math.max(1, Math.min(imageWidth - x, Math.round(region.width))),
        height: Math.max(1, Math.min(imageHeight - y, Math.round(region.height))),
    };
}

function drawSourceCrop(image: ImageBitmap, region: CanvasEmotionEditRegion) {
    const canvas = document.createElement("canvas");
    canvas.width = region.width;
    canvas.height = region.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser cannot crop the header editing area");
    context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    return canvas.toDataURL("image/png");
}

function drawFaceMask(box: CanvasFaceBox, region: CanvasEmotionEditRegion) {
    const canvas = document.createElement("canvas");
    canvas.width = region.width;
    canvas.height = region.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser cannot create face editing mask");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, region.width, region.height);
    const ellipse = emotionEditEllipse(box, region);
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.ellipse(ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, 0, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png");
}

type EmotionEditEllipse = { centerX: number; centerY: number; radiusX: number; radiusY: number };

function emotionEditEllipse(box: CanvasFaceBox, region: CanvasEmotionEditRegion): EmotionEditEllipse {
    const localX = box.x - region.x;
    const localY = box.y - region.y;
    const expandX = box.width * 0.22;
    const expandTop = box.height * 0.28;
    const expandBottom = box.height * 0.2;
    const width = box.width + expandX * 2;
    const height = box.height + expandTop + expandBottom;
    return {
        centerX: localX + box.width / 2,
        centerY: localY - expandTop + height / 2,
        radiusX: Math.max(1, width / 2),
        radiusY: Math.max(1, height / 2),
    };
}

function sampleEdgeColorGains(source: Uint8ClampedArray, generated: Uint8ClampedArray, width: number, height: number, ellipse: EmotionEditEllipse): [number, number, number] {
    // 仅采样羽化边缘，按 RGB 分通道校正可同时收敛亮度与冷暖色偏，中心表情仍以模型结果为主。
    const sourceSum = [0, 0, 0];
    const generatedSum = [0, 0, 0];
    let count = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const distance = ellipseDistance(x, y, ellipse);
            if (distance < 0.72 || distance > 0.96) continue;
            const index = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
                sourceSum[channel] += source[index + channel];
                generatedSum[channel] += generated[index + channel];
            }
            count += 1;
        }
    }
    if (count < 32) return [1, 1, 1];
    return sourceSum.map((sum, channel) => clamp(sum / Math.max(1, generatedSum[channel]), 0.78, 1.22)) as [number, number, number];
}

function blendEmotionPixels(source: Uint8ClampedArray, generated: Uint8ClampedArray, width: number, height: number, ellipse: EmotionEditEllipse, gains: [number, number, number]) {
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const alpha = emotionFeatherAlpha(ellipseDistance(x, y, ellipse));
            if (alpha <= 0) continue;
            const index = (y * width + x) * 4;
            const correctionStrength = 0.42 + (1 - alpha) * 0.58;
            for (let channel = 0; channel < 3; channel += 1) {
                const gain = 1 + (gains[channel] - 1) * correctionStrength;
                const corrected = clamp(generated[index + channel] * gain, 0, 255);
                source[index + channel] = Math.round(source[index + channel] * (1 - alpha) + corrected * alpha);
            }
            source[index + 3] = Math.round(source[index + 3] * (1 - alpha) + generated[index + 3] * alpha);
        }
    }
}

function ellipseDistance(x: number, y: number, ellipse: EmotionEditEllipse) {
    const dx = (x + 0.5 - ellipse.centerX) / ellipse.radiusX;
    const dy = (y + 0.5 - ellipse.centerY) / ellipse.radiusY;
    return Math.sqrt(dx * dx + dy * dy);
}

function emotionFeatherAlpha(distance: number) {
    if (distance <= 0.7) return 1;
    if (distance >= 1) return 0;
    const t = (distance - 0.7) / 0.3;
    return 1 - t * t * (3 - 2 * t);
}

function drawFaceCrop(image: ImageBitmap, box: CanvasFaceBox, imageWidth: number, imageHeight: number) {
    const paddingX = box.width * 0.45;
    const paddingTop = box.height * 0.35;
    const paddingBottom = box.height * 0.65;
    const sx = Math.max(0, Math.floor(box.x - paddingX));
    const sy = Math.max(0, Math.floor(box.y - paddingTop));
    const sw = Math.max(1, Math.min(imageWidth - sx, Math.ceil(box.width + paddingX * 2)));
    const sh = Math.max(1, Math.min(imageHeight - sy, Math.ceil(box.height + paddingTop + paddingBottom)));
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser cannot create a character reference image");
    context.fillStyle = "#111";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / sw, canvas.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    context.drawImage(image, sx, sy, sw, sh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    return canvas.toDataURL("image/jpeg", 0.9);
}

async function loadImageBitmap(dataUrl: string) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("Unable to read the source image, please re-upload and try again");
    return createImageBitmap(await response.blob());
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
