import type { GenerationErrorCategory } from "./generation-error";

type ModerationCopy = { category: GenerationErrorCategory; reason: string; action: string };
const labels: Record<string, string[]> = {
    input: ["Enter text", "Reference pictures", "Reference video", "Reference audio"],
    output: ["Generate text", "Generate pictures", "Generate video", "Generate audio"],
};
const mediaTypes = ["text", "image", "video", "audio"];

// Ark's documented families encode direction, medium and cause separately.
// PolicyViolation means copyright here; it is not a generic real-person rule.
export function moderationErrorCopy(code: string, message: string): ModerationCopy | undefined {
    const match = code.toLowerCase().match(/^(input|output)(text|image|video|audio)(?:sensitivecontentdetected|riskdetection)(?:\.(policyviolation|privacyinformation|deepfake))?$/);
    let direction = match?.[1];
    let media = match?.[2];
    let cause = match?.[3] || "";
    if (!direction) {
        if (/prompt\s+or\s+(?:reference|input)\s+/i.test(message)) return;
        if (/\boutput may contain sensitive information\b/i.test(message)) return { category: "moderation_output", reason: "The generated results failed content security review", action: "Please adjust the prompt words or reference materials and regenerate" };
        const subject = message.toLowerCase().match(/\b(input|output|reference)\s+(text|image|video|audio)\b/);
        const safety = /may contain sensitive information|includes sensitive content|content (?:safety|policy)|safety policy|copyright restrictions|may contain real person|counterfeit documents or credentials/i.test(message);
        if (!subject || !safety) return;
        direction = subject[1] === "reference" ? "input" : subject[1];
        media = subject[2];
        if (/copyright restrictions/i.test(message)) cause = "policyviolation";
        else if (/may contain real person/i.test(message)) cause = "privacyinformation";
        else if (/counterfeit documents or credentials/i.test(message)) cause = "deepfake";
    }
    const label = labels[direction][mediaTypes.indexOf(media!)];
    const category: GenerationErrorCategory = direction === "output" ? "moderation_output" : media === "text" ? "moderation_input" : "moderation_reference";
    let reason = `${label}Failed content security review`;
    let action = direction === "output" ? "Please adjust the prompt word; if reference material is used, please check and replace it and then regenerate it." : media === "text" ? "Please adjust the prompt word and regenerate it." : `Please check and replace${label}regenerate after`;
    if (cause === "policyviolation") {
        reason = `${label}Failed to pass upstream copyright review`;
        if (direction === "output" && media === "audio") action = "Please adjust the music or audio related prompt words; if reference audio is used, please check and replace it and regenerate it.";
    } else if (cause === "privacyinformation") {
        reason = direction === "input" && (media === "image" || media === "video") ? `${label}Suspected to contain a real person image, the model refuses to be generated` : `${label}Failed privacy review`;
    } else if (cause === "deepfake") {
        reason = `${label}Failed counterfeit content review`;
    }
    return { category, reason, action };
}
