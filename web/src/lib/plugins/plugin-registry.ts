import type { EditorSlotKind, PluginManifest, PluginManifestV2, RegisteredPlugin } from "./plugin-types";
import { unregisterPluginSlots } from "./editor-slot-registry";
import { registerPluginCanvasNodes, unregisterNodeDefinitions } from "@/lib/canvas/node-registry";

const registeredPlugins = new Map<string, RegisteredPlugin>();

const EDITOR_SLOT_KINDS: EditorSlotKind[] = [
    "timeline-panel",
    "preview-renderer",
    "inspector",
    "asset-ingest",
    "subtitle-tool",
    "transcription-provider",
    "export-renderer",
    "ai-assistant",
];

function assertManifest(manifest: PluginManifest | PluginManifestV2) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error("Plugin ID must use kebab-case");
    if (!manifest.name.trim() || !manifest.version.trim() || !manifest.apiVersion.trim()) throw new Error("Plugin manifest is missing name, version or API version");
    const apiVersion: string = manifest.apiVersion;
    if (apiVersion !== "beeftv.plugin/v1" && apiVersion !== "beeftv.plugin/v2" && apiVersion !== "beeftv.plugin/v3") {
        throw new Error(`Unsupported plug-in API versions:${apiVersion}`);
    }
    if (new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error("Plug-in permissions cannot be repeated");
    if (manifest.apiVersion !== "beeftv.plugin/v1") assertManifestV2(manifest);
}

function assertManifestV2(manifest: PluginManifestV2) {
    if (manifest.contributes.editorSlots?.length) {
        for (const slot of manifest.contributes.editorSlots) {
            if (!EDITOR_SLOT_KINDS.includes(slot.slot)) throw new Error(`Unknown editor slot type:${slot.slot}`);
            if (slot.priority !== undefined && (typeof slot.priority !== "number" || Number.isNaN(slot.priority))) {
                throw new Error(`Editor slot${slot.slot} The priority must be a number`);
            }
        }
    }
}

export function registerPlugin(plugin: RegisteredPlugin) {
    assertManifest(plugin.manifest);
    const actionIds = new Set<string>();
    for (const action of plugin.agentActions || []) {
        if (!action.id.trim() || !action.description.trim() || actionIds.has(action.id) || typeof action.buildOperations !== "function") throw new Error("Plug-in Agent action requires unique ID, description and action builder");
        actionIds.add(action.id);
    }
    const existing = registeredPlugins.get(plugin.manifest.id);
    if (existing && existing.manifest.version !== plugin.manifest.version) {
        throw new Error(`plug-in${plugin.manifest.id} Already registered other versions`);
    }
    if (plugin.manifest.apiVersion !== "beeftv.plugin/v1") {
        // v2：编辑器插槽声明由注册器提取存储；UI 渲染函数由插件 activate() 阶段经 registerEditorSlot 提供。
        plugin.editorSlots = plugin.manifest.contributes.editorSlots ?? [];
    }
    if (plugin.manifest.contributes.canvasNodes?.length) {
        registerPluginCanvasNodes(plugin.manifest.id, plugin.manifest.contributes.canvasNodes);
    }
    registeredPlugins.set(plugin.manifest.id, plugin);
}

export function unregisterPlugin(pluginId: string) {
    unregisterNodeDefinitions(pluginId);
    unregisterPluginSlots(pluginId);
    registeredPlugins.delete(pluginId);
}

export function getRegisteredPlugin(pluginId: string) {
    return registeredPlugins.get(pluginId);
}

export function listRegisteredPlugins() {
    return [...registeredPlugins.values()];
}

export function listRegisteredManifests(): Array<PluginManifest | PluginManifestV2> {
    return listRegisteredPlugins().map(({ manifest }) => manifest);
}
