import type { CanvasGenerationMode } from "@/types/canvas";
import type { SrtEntry } from "@/types/timeline";

export type CanvasPromptPreset = {
    id: string;
    name: string;
    description: string;
    prompt: string;
    modes: CanvasGenerationMode[];
    source: "builtin" | "skill";
};

export const CANVAS_BUILTIN_PRESETS: CanvasPromptPreset[] = [
    {
        id: "character-sheet",
        name: "Character setting diagram",
        description: "Front, side, back and expression reference to lock character consistency",
        prompt: "Generate character setting drawings: Keep the identity, facial features, hairstyle, clothing and body posture of the same character consistent, including front, side, back and key expression references, and the background is simple to facilitate reuse of subsequent shots.",
        modes: ["image"],
        source: "builtin",
    },
    {
        id: "multi-angle",
        name: "Multi-camera perspective",
        description: "Generate continuous and connectable camera position changes around the same subject",
        prompt: "Design multi-camera images around the same subject, keep the characters, clothing, scenes and lighting consistent, and provide distant, panoramic, medium, close-up, close-up, side, back and overhead perspectives, with continuity between shots.",
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "next-shot",
        name: "Screen deduction",
        description: "Deducing the forward and backward actions of the current scene and the lens connection",
        prompt: "Deduce the next sequence based on the current scene: keep the character and scene consistent, clarify the subject’s next actions, line of sight, environmental changes, camera movement and natural connection methods, and do not jump to composition or identity.",
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "story-beats",
        name: "footage",
        description: "Split short plots into generative sequence beats",
        prompt: "Break this up into one-shot beats. Each shot clearly describes the subject's movements, scenery, composition, camera position, camera movement, light, emotion and the connection with the front and rear shots, and the characters, scenes and props are consistent.",
        modes: ["text", "image", "video"],
        source: "builtin",
    },
    {
        id: "cinematic-light",
        name: "Movie lighting and shadow optimization",
        description: "Preserve content and optimize true light, layering and blending",
        prompt: "The identity, movement, and original composition of the subject are retained, and the lighting is optimized for real cinematography: the key light direction, environmental reflections, shadow levels, skin tones, and background blending are clearly defined, and plasticity and over-sharpening are reduced without changing the content of the picture.",
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "video-prompt",
        name: "Video prompt word optimization",
        description: "Organized into sequenced lens instructions that are easier to execute on the model",
        prompt: "Rewrite the current requirements into structured video prompts that describe the opening scene, main body action, camera movement, environmental changes, sound, and ending scene in chronological order; eliminate conflicting instructions and retain all key constraints.",
        modes: ["text", "video"],
        source: "builtin",
    },
];

export const IMAGE_PROMPT_REVERSE = `Please use the reference picture to infer a prompt word that is suitable for AI to generate pictures.

Requirements:
1. Only output the text of the prompt word without explanation.
2. Cover subject, composition, style, light, color, material, lens and atmosphere.
3. Try to write complete prompt words that can be directly used in the graph model.`;

export const VIDEO_PROMPT_REVERSE = `Please disassemble and infer a structured prompt word suitable for AI video generation based on the reference video.

Requirements:
1. Only output the text of the prompt word without explanation.
2. Cover the opening scene, main body movements and expressions, scenery and camera movement changes, light and shadow colors, environmental atmosphere and sound details in chronological order.
3. Write a complete prompt word that can be directly used in the video generation model.`;

export function workflowStarterPrompt(kind: "character_cards" | "character_three_view" | "storyboard_video", title: string, workflowTitle: string) {
    if (kind === "character_cards") return `Please base on "${workflowTitle}"Split the main characters and generate character picture cards for each character that can be used for subsequent creation: appearance, clothing, identity, personality and visual identification points.`;
    if (kind === "character_three_view") return `Please generate "based on the upstream character card"${title}": Three views of the same character from the front, side, and back, keeping the clothing, hairstyle, props, and proportions consistent.`;
    return `Please base on the three views of the upstream role, as "${workflowTitle}"Production of storyboard story video plan: including shot sequence, scenery, action, rhythm and picture continuity.`;
}

export function buildTextRewritePrompt(sourceText: string, instruction: string) {
    return `Please modify the following text as required.

Original text:${sourceText}Modification requirements:${instruction}`;
}

export function buildVideoOperationPrompt(operation: string, prompt: string, operationLabel: string) {
    if (operation === "compare_versions") return `Please conduct a comparative analysis of the following video result versions and output recommended versions, differences and modification suggestions:${prompt}`;
    return `Video editing tasks:${operationLabel}Creation requirements:${prompt}`;
}

export function buildSubtitleHighlightSystemPrompt() {
    return `You are a video subtitle keyword highlighting assistant. Please output strict JSON.

Mission objectives:
- Determine whether highlighting is needed for each subtitle
- Each subtitle can highlight up to 1 paragraph
- Only return the keyword or phrase that is most worthy of highlighting
- start and end use JavaScript string subscripts
- end is exclusive
- Return shouldHighlight=false when no clear focus is provided

Highlighting criteria:
- Prioritize highlighting of conclusion words, numbers, identity words, first/breakthrough words, and strong contrast words
- Do not highlight function words, colloquial language, or entire long phrases

Boundary constraints:
- Not responsible for color, font size, position, and animation
- only returns the highlights array
- highlightText must be strictly equal to the original subtitle text slicing result`;
}

export function buildSubtitleHighlightUserMessage(entries: SrtEntry[]) {
    const lines = entries.map((entry) => {
        return `entryIndex=${entry.index} | startMs=${entry.startMs} | endMs=${entry.endMs} | text=${entry.text}`;
    });
    return `Please determine whether highlighting is needed for each subtitle based on the following subtitles and context, and return JSON:

{
  "highlights": [
    {
      "entryIndex": 1,
      "shouldHighlight": true,
      "highlightText": "example",
      "start": 0,
      "end": 2
    }
  ]
}

Subtitle list:${lines.join("\n")}`;
}
