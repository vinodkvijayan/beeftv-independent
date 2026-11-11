import type { Skill, SkillCategory } from "@/services/api/skills";

export const fallbackSkillCategories: SkillCategory[] = [
    { value: "drama", label: "Short drama film and television" },
    { value: "ecommerce", label: "E-commerce marketing" },
    { value: "creative", label: "creative design" },
    { value: "social", label: "social media content" },
    { value: "others", label: "Others" },
];

export function skillOrigin(skill: Pick<Skill, "sourceType" | "isOwner">) {
    if (skill.sourceType === "builtin" && !skill.isOwner) return { label: "official", hint: "The original version is officially maintained and can be edited after creating a private copy." };
    if (skill.sourceType === "market") return { label: "market", hint: "Install through the Skills Market to check for updates, view version history, or create a private copy." };
    if (skill.sourceType === "plugin") return { label: "plug-in", hint: "Skills installed via the BeefTV plug-in." };
    if (skill.isOwner) return { label: "mine", hint: "The current local copy is managed by you and can be edited, contributed and deleted." };
    return { label: "Installed", hint: "Skills installed via BeefTV." };
}

export function skillCategoryLabel(value: string, categories: SkillCategory[] = fallbackSkillCategories) {
    const list = categories.length ? categories : fallbackSkillCategories;
    return list.find((item) => item.value === value)?.label || "Others";
}

export function groupSkills(skills: Skill[], categories: SkillCategory[]) {
    const ordered = categories.length ? categories : fallbackSkillCategories;
    return ordered
        .map((category) => ({ ...category, skills: skills.filter((skill) => skill.tag === category.value) }))
        .filter((group) => group.skills.length > 0);
}

export function formatSkillCount(value: number) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatSkillDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "unknown time";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
}
