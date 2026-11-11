import { ART_CRITIQUE_RUBRIC_VERSION, type ArtCritiqueCategory, type ArtCritiqueImageType } from "./contracts";

export type RubricCategory = Exclude<ArtCritiqueCategory, "other">;

export type ArtCritiqueRubricPromptOptions = {
    /** Restrict the prompt to one or more reviewer-owned categories. */
    categories?: readonly RubricCategory[];
    /** Full prompts keep the research mapping; narrow reviewer prompts omit it to reduce distraction. */
    includeReferenceMapping?: boolean;
};

export type ArtCritiqueRubricCheck = {
    id: string;
    label: string;
    check: string;
    flagWhen: string;
    applicableImageTypes?: readonly ArtCritiqueImageType[];
    evidenceRequired?: boolean;
    minConfidence?: number;
    mergeKeys?: readonly string[];
};

export type ArtCritiqueRubricSection = {
    category: RubricCategory;
    label: string;
    references: readonly string[];
    checks: readonly ArtCritiqueRubricCheck[];
};

/**
 * 这些项目只作为方法论来源，不作为运行时依赖。模型仍然通过当前项目的云端渠道调用。
 */
export const ART_CRITIQUE_RUBRIC: readonly ArtCritiqueRubricSection[] = [
    {
        category: "composition",
        label: "Composition and visual hierarchy",
        references: ["CADB / SAMP-Net", "CG-IAA", "PhotoFramer-Assessment"],
        checks: [
            { id: "subject-placement", label: "subject position", check: "Does the subject position serve the purpose of the picture and the direction of the narrative?", flagWhen: "The position of the subject makes the picture lose its sense of direction, or significantly weakens the expression of the theme.", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["subject", "placement"] },
            { id: "visual-balance", label: "visual balance", check: "Is the visual weight of the left and right, top and bottom, and front and rear backgrounds reasonable?", flagWhen: "The weight on one side obviously presses the other side, and the imbalance is not intentionally created.", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["balance", "weight"] },
            { id: "negative-space", label: "White space and breathing", check: "Does white space provide a sense of breathing, direction, or narrative space?", flagWhen: "The blank space squeezes the subject, cuts off the direction of action, or the blank area does not play a role", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["negative-space", "space"] },
            { id: "visual-flow", label: "visual movement", check: "Are the first visual focus, the second focus and the movement path of the visual gaze clear?", flagWhen: "High contrast in the background or local areas steals the subject's attention and prevents the line of sight from entering the picture naturally.", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["flow", "focus"] },
            { id: "composition-pattern", label: "composition mode", check: "Which of center, thirds, golden ratio, triangle, horizontal, vertical, diagonal, symmetry, curve, radial, vanishing point, pattern or fill-frame is closer to the current image", flagWhen: "Compositional mode conflicts with pictorial intent (cannot be reported simply because the rule of thirds is not used)", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.6, mergeKeys: ["pattern", "intent"] },
            { id: "crop-and-depth", label: "Cropping and depth of field", check: "Do cropping, occlusion and front, middle and back scenes strengthen the subject relationship?", flagWhen: "Cropping destroys the main structure, or the spatial hierarchy makes it difficult to understand the relationship between the pictures.", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["crop", "depth"] },
        ],
    },
    {
        category: "color",
        label: "color",
        references: ["CG-IAA", "AesExpert"],
        checks: [
            { id: "palette", label: "color relationship", check: "Whether the primary color, secondary color and accent color form a clear color relationship", flagWhen: "Colors compete with each other for attention, or the main colors are so confusing that they weaken the theme." },
            { id: "temperature", label: "Warmth and warmth and harmony", check: "Whether the relationship between cold and warm, hue and overall atmosphere is consistent", flagWhen: "Local warmth or hue suddenly pops out without narrative or focal point reason" },
            { id: "value-and-saturation", label: "lightness and saturation", check: "Whether the brightness level and saturation distribution support visual hierarchy", flagWhen: "The subject and background are close in brightness, the color is gray and dirty, or the secondary areas are too bright" },
            { id: "color-separation", label: "color separation", check: "Is there sufficient color distinction between the subject, the background, and adjacent shapes?", flagWhen: "Key figures blend into the background, rendering silhouettes, emotions or messages unreadable" },
        ],
    },
    {
        category: "lighting",
        label: "light",
        references: ["CG-IAA", "AesExpert", "HumanAesExpert"],
        checks: [
            { id: "light-direction", label: "Light source direction", check: "Are the direction of the main light source, highlights and shadows consistent?", flagWhen: "The lighting directions of different objects in the same picture are conflicting with each other" },
            { id: "exposure", label: "exposure and contrast", check: "Do exposure, local contrast and highlight shadows retain important information?", flagWhen: "Key areas of the subject are overexposed, dead black, or local contrast is insufficient to establish focus." },
            { id: "volume", label: "volume and space", check: "Does light help shape, distance and spatial depth be understood?", flagWhen: "The shape becomes flat, the spatial relationship is confused, or the light does not serve the subject" },
            { id: "subject-separation", label: "separation of subjects", check: "Whether the subject establishes a clear hierarchy through light and the environment", flagWhen: "The brightness or light quality of the subject and the background is close, causing the subject to be engulfed" },
        ],
    },
    {
        category: "proportion",
        label: "Proportion, structure and perspective",
        references: ["HumanAesExpert", "PhotoFramer-Assessment", "CG-IAA"],
        checks: [
            { id: "human-proportion", label: "Character proportions", check: "Whether the character’s face, facial features, hands and feet, limb length and head-to-body relationship are natural", flagWhen: "Visible structural abnormalities affect credibility (do not mistake normal perspective changes as deformities)", applicableImageTypes: ["portrait"], evidenceRequired: true, minConfidence: 0.7, mergeKeys: ["human", "proportion"] },
            { id: "object-scale", label: "relative size of object", check: "Whether the relative size between objects conforms to the scene relationship", flagWhen: "The size relationship of key objects destroys space or narrative logic" },
            { id: "perspective", label: "Perspective and occlusion", check: "Are the disappearing direction, near and far size, ground relationship and occlusion sequence consistent?", flagWhen: "Perspective clues conflict with each other, or the occlusion relationship makes the space impossible to establish." },
            { id: "detail-consistency", label: "Detailed consistency", check: "Key edges, texture, clarity and style are consistent", flagWhen: "Parts are obviously broken, repetitive, and abnormal, and will affect the main reading." },
        ],
    },
];

export function findArtCritiqueRubricCheck(checkId: string) {
    for (const section of ART_CRITIQUE_RUBRIC) {
        const check = section.checks.find((item) => item.id === checkId);
        if (check) return { ...check, category: section.category };
    }
    return undefined;
}

export const ART_CRITIQUE_REFERENCE_METHODS = [
    "Use CG-IAA / AesExpert's dimensional critique approach to organize evaluations, and do not reduce aesthetics to a single score.",
    "Use the composition pattern of CADB as a reference, but first determine the intention of the picture, and do not regard geometric rules such as the rule of thirds as absolute answers.",
    "Supplement Portrait mode with HumanAesExpert's human dimension, pointing out structural issues only when they are clearly visible and actually affect the frame.",
    "Use PhotoFramer's shift, zoom/crop, and view change ideas to organize modification actions. The suggestions must be able to be converted into the next round of prompt words.",
    "Use Grounding-IQA's description and regional binding ideas to express the target; use global when positioning cannot be reliably performed.",
] as const;

export function buildArtCritiqueRubricPrompt(options: ArtCritiqueRubricPromptOptions = {}) {
    const selectedCategories = options.categories?.length ? new Set(options.categories) : undefined;
    const sectionsToRender = selectedCategories ? ART_CRITIQUE_RUBRIC.filter((section) => selectedCategories.has(section.category)) : ART_CRITIQUE_RUBRIC;
    const sections = sectionsToRender.map((section) => {
        const checks = section.checks.map((item) => `- ${item.label}(Rule ID:${item.id}; Applicable pictures:${(item.applicableImageTypes || ["All pictures"]).join("、")};Minimum confidence level:${item.minConfidence ?? 0.55};Need evidence:${item.evidenceRequired !== false ? "Yes" : "No"};Merge keywords:${(item.mergeKeys || []).join("、")}): check${item.check};Only in${item.flagWhen}Just report it.`).join("\n");
        return [`【${section.label}｜${section.category}】`, `Method reference:${section.references.join("、")}`, checks].join("\n");
    }).join("\n\n");
    const includeReferenceMapping = options.includeReferenceMapping ?? !selectedCategories;

    return [
        `Aesthetic rubric version:${ART_CRITIQUE_RUBRIC_VERSION}`,
        "The following are the current internal aesthetic inspection standards used by the creative workbench. Reference projects provide task definitions and methodologies, not answers that need to be cited, nor models that must be deployed.",
        selectedCategories ? `This Reviewer is only responsible for the following dimensions:${[...selectedCategories].join("、")}. Do not review other dimensions, and do not duplicate the responsibilities of other Reviewers.` : "Determine the image type, subject, visual intent, and current composition strategy before applying the check.",
        "Aesthetic preferences do not equal structural errors; problems only arise when there is picture evidence, it affects expression, and actions can be given. Allow no questions and don't cram in numbers just to cover a check, satisfy a quantity, or appear helpful.",
        ...(includeReferenceMapping ? [`Reference method mapping:${ART_CRITIQUE_REFERENCE_METHODS.map((method) => `- ${method}`).join("\n")}`] : []),
        sections,
        "Each candidate must fill in the hit rule ID (checkId), and only rules in the dimension responsible for the current Reviewer can be selected. Do not report if the rule does not apply to the current image type; do not report if there is no concrete evidence; do not report if the confidence level is below the rule minimum.",
        "The rule ID is only used for local verification and aggregation deduplication. Do not display the rule ID to the user as a question title.",
        "It is recommended to use executable actions first: moving the subject (shift), cropping or scaling (zoom/crop), adjusting the perspective or spatial relationship (view change), adjusting color/light, partial redrawing or regeneration. Write clearly the modification goals, specific actions, content that needs to be retained, and expected effects.",
        "Positioning must comply with the problem description: a continuous local area (such as the face, character, foreground, desktop, head periphery) is preferably boxed; box only allows two corner points, the upper left corner and the lower right corner, and the left and right, upper and lower spans are at least 2.5% of the image size, and cannot return to the same horizontal or vertical line. Point is used for a single discrete position, points is used for multiple unconnected positions, polygon is used for areas along the contour, and global is used for overall problems. All coordinates are the normalized coordinates of 0,0 in the upper left corner and 1,1 in the lower right corner of the original image. Prefer using global when positioning cannot be reliably done rather than guessing a box.",
    ].join("\n\n");
}
