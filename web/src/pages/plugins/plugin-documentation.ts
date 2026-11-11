import type { PluginManifest, PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { isOfficialApplicationPluginId } from "@/lib/plugins/official-applications";
import { MEDIA_CONVERSION_PLUGIN_ID } from "@/lib/plugins/builtin/media-conversion";

export const PLUGIN_ORIGIN_LABELS = { official: "official", custom: "Customize", thirdParty: "third party" };

export function pluginOrigin(plugin: RegisteredPlugin): keyof typeof PLUGIN_ORIGIN_LABELS {
    if (plugin.source === "uploaded" || plugin.source === "local") return "custom";
    if (["bundled", "official", "system"].includes(plugin.source || "")) return "official";
    if (!plugin.source && (isOfficialApplicationPluginId(plugin.manifest.id) || plugin.manifest.id === MEDIA_CONVERSION_PLUGIN_ID)) return "official";
    return "thirdParty";
}

export const PLUGIN_PERMISSION_LABELS: Record<string, string> = {
    "canvas.read": "Read canvas",
    "canvas.write": "Modify canvas",
    "asset.read": "Read material",
    "asset.search": "Search for material",
    "asset.import": "Import material",
    "asset.upload": "Upload material",
    "generation.run": "call generate",
    "ai.text": "Call the configured text/visual understanding model",
    "media.read": "Read input media",
    "usage.read": "Read usage",
    "external.open": "Open external details",
    "ui.slot": "Mount interface extension bit",
    "settings.write": "Write plugin model channel settings",
    "timeline.read": "Read timeline",
    "timeline.command": "Edit timeline",
    "export.run": "Export",
};

export function getPluginDocumentation(manifest: PluginManifest | PluginManifestV2) {
    if (manifest.documentation?.trim()) return manifest.documentation.trim();

    return manifest.contributes.providers?.length
        ? "This plug-in does not provide access instructions, please contact the plug-in author to obtain it."
        : "This plugin does not provide separate instructions for use.";
}
