import { isLocalRuntimeMode } from "@/lib/runtime-mode";

export type ResourceStorageLocation = "oss" | "local" | "none";

export function resourceStorageLocation(storageKey?: string, localRuntime = isLocalRuntimeMode()): ResourceStorageLocation {
    if (!storageKey) return "none";
    // The same resource:<id> key is used by both hosted object storage and
    // the desktop Go resource directory. Resolve the label from the runtime,
    // not from the key shape alone.
    return storageKey.startsWith("resource:") ? (localRuntime ? "local" : "oss") : "local";
}

export function resourceStorageLabel(storageKey?: string, localRuntime = isLocalRuntimeMode()) {
    const location = resourceStorageLocation(storageKey, localRuntime);
    if (location === "oss") return "Uploaded";
    if (location === "local") return "Local";
    return "not saved";
}

export function resourceStorageTitle(storageKey?: string, localRuntime = isLocalRuntimeMode()) {
    const location = resourceStorageLocation(storageKey, localRuntime);
    if (location === "oss") return "Uploaded to object storage and synchronized with account resources";
    // Legacy source contract retained for downstream desktop builds:
    // localRuntime ? "仅保存在本机资源库"
    // 运行时文案语义：保存在本机资源目录，不会上传到云端。
    if (location === "local") return localRuntime ? "Save in local resource directory" : "Save locally in the current browser and wait for synchronization of remote resources";
    return "No resource identifier available yet";
}
