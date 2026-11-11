import type { CanvasFolderTheme } from "@/types/canvas";
import { resolveEmbeddedAssetUrl } from "@/lib/embedded-runtime";

export const CANVAS_FOLDER_THEME_OPTIONS: ReadonlyArray<{
    key: CanvasFolderTheme;
    label: string;
    cover: string;
}> = [
    { key: "aurora", label: "red blue streamer", cover: "/images/canvas/folder-default-cover.png" },
    { key: "obsidian", label: "obsidian silver blue", cover: "/images/canvas/folder-theme-obsidian.png" },
    { key: "ember", label: "molten gold red flame", cover: "/images/canvas/folder-theme-ember.png" },
    { key: "pearl", label: "pearl mist", cover: "/images/canvas/folder-theme-pearl.png" },
];

export function resolveCanvasFolderTheme(value?: string): CanvasFolderTheme {
    return CANVAS_FOLDER_THEME_OPTIONS.some((theme) => theme.key === value) ? (value as CanvasFolderTheme) : "aurora";
}

export function resolveCanvasFolderThemeCover(theme?: string, customCover?: string) {
    const custom = customCover?.trim();
    if (custom) return resolveEmbeddedAssetUrl(custom);
    const resolved = resolveCanvasFolderTheme(theme);
    return resolveEmbeddedAssetUrl(CANVAS_FOLDER_THEME_OPTIONS.find((item) => item.key === resolved)!.cover);
}
