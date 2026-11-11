import { createElement, lazy, Suspense } from "react";
import { nanoid } from "nanoid";

import { addEagleItem, createEagleFolder, downloadEagleItem, eagleItemFileUrl, eagleItemThumbnailUrl, getEagleLibrary, listEagleItems, type EagleFolder, type EagleItem } from "@/services/api/eagle";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import { registerPlugin } from "../plugin-registry";
import type { AssetSourceProvider, ExternalAssetItem, PluginAppPageProps, PluginAppSettingsProps, PluginHostContext, RegisteredPlugin } from "../plugin-types";

const LazyEagleLibraryPage = lazy(() => import("@/pages/plugins/eagle"));
const LazyEagleSettingsPanel = lazy(() =>
    import("@/pages/plugins/eagle").then((mod) => ({ default: mod.EaglePluginSettingsPanel })),
);

function EaglePageSlotWrapper(_props: PluginAppPageProps) {
    return createElement(Suspense, { fallback: null }, createElement(LazyEagleLibraryPage));
}

function EagleSettingsSlotWrapper(props: PluginAppSettingsProps) {
    return createElement(Suspense, { fallback: null }, createElement(LazyEagleSettingsPanel, props));
}

export const EAGLE_PLUGIN_ID = "eagle-asset-connector";
export const EAGLE_DEFAULT_BASE_URL = "http://127.0.0.1:41595";

const eaglePluginDocumentation = `#Eagle Library

The Eagle plug-in connects the desktop Eagle database to the site material panel. The browser does not access Eagle directly: all read, search, download, and write requests first go to the site backend, which then accesses the Eagle Local API address configured by the administrator.

## Preparation before use

1. Install and start the Eagle desktop client and open the database you want to use.
2. Confirm that Eagle Local API is available; the default address is \`${EAGLE_DEFAULT_BASE_URL}\`.
3. Enter the plugin settings as an administrator, fill in the Base URL and read the folder.
4. After saving the configuration, select the Eagle source in the material library to browse and import materials.

> Eagle must keep running. After closing the client, switching repositories, or modifying the local API port, the site will receive a connection failure that cannot be masked with an empty list.

## Site backend interface

| Operations | Site Interface | Purpose |
| --- | --- | --- |
| Read the library | \`GET /api/plugins/eagle/library?baseUrl=...\` | Get the Eagle version, library name and folder tree |
| List materials | \`GET /api/plugins/eagle/items\` | Read materials by folder, keyword and page |
| Thumbnail | \`GET /api/plugins/eagle/items/{id}/thumbnail\` | Agent Eagle Thumbnail |
| Original file | \`GET /api/plugins/eagle/items/{id}/file\` | Download and import into site resource storage |
| Write material | \`POST /api/plugins/eagle/items?baseUrl=...\` | Write images, videos or audio back to Eagle |
| Create a folder | \`POST /api/plugins/eagle/folders?baseUrl=...\` | Create a directory in Eagle |

These are site-internal login APIs that use cookie authentication; do not call them directly as Eagle official interfaces.

## Browse and search

The plugin reads the Eagle folder tree and generates the full hierarchical path. The material list supports \`folderId\`, \`keyword\`, \`limit\`, \`offset\`. The folder list is cached within the current plugin instance; it is invalidated and re-read after a folder is created. When switching Eagle databases, you should reopen the plug-in settings confirmation directory.

## Import to site

When importing, the back-end agent downloads the original Eagle file, and the front-end writes it to the site's own image or media storage. Images retain recognizable width, height, and MIME; video, audio, and other model files retain byte count, extension, Eagle item ID, folder, and source metadata.

| Eagle Content | Site Results | Current Limitations |
| --- | --- | --- |
| Pictures | Picture materials | Use original images, do not regard thumbnails as finished products |
| Video | Video material | When the metadata lacks width and height, use 1280×720 to display the bottom line without rewriting the original file |
| Audio | Audio material | Duration is subject to browser media detection results |
| Other files | Model materials | Save only as file resources |
| Text/Entity | Not supported | The import will clearly report an error |

## Write back to Eagle

The plug-in can convert site images, videos or audios into data URLs, and then call Eagle to add the materials. Existing local blobs are read directly first; the remote generated address is downloaded only if there is no local copy. By default, a single manually uploaded file does not exceed 96 MB, and the MIME must start with \`image/\`, \`video/\` or \`audio/\`.

When "Automatically upload build results" is enabled, generated assets can be written to the configured target folder. Automatic writeback failures must be displayed as writeback failures and "Site Saved" should not be misreported as "Eagle Saved".

## Configuration fields

| Field | Description | Default Value |
| --- | --- | --- |
| \`baseUrl\` | Eagle Local API address, only explicit HTTP(S) addresses are allowed | \`${EAGLE_DEFAULT_BASE_URL}\` |
| \`autoUploadGenerated\` | Whether to automatically write supported generation results back to Eagle | Enable |
| \`generatedFolderId\` | Automatically write back the target folder ID | Empty, use Eagle default location |

## Security Boundary

- Eagle usually runs on local machine. The backend must continue to perform private network target validation, only allow native services explicitly configured by the administrator, and cannot turn the proxy into an arbitrary URL scraper.
- \`baseUrl\` only saves the service address and does not contain Token, Cookie or query key.
- The original file and data URL will not be entered into logs, localStorage or error reporting.
- In multi-user deployment, the server's \`127.0.0.1\` refers to the server itself, not the visitor's computer; please use Eagle's official accessible client connection method and cannot pretend that direct connection is available.

## FAQ

| Phenomenon | Check items |
| --- | --- |
| Unable to read the database | Whether Eagle is running, Base URL/port, and whether the backend can access the host |
| The folder is empty | Eagle’s currently opened database, filter conditions, and folder level |
| There are thumbnails but the import failed | Whether the original file still exists, file permissions, and backend response status |
| Writeback failed | File size/MIME, whether the target folder exists, whether the remote generated link has expired |
| The deployment server cannot connect to the local Eagle | The network topology is not established and local bridging is required instead of changing the front-end URL |

## Official information

- [Eagle API Documentation](https://api.eagle.cool/)
- [Eagle Products and Downloads](https://eagle.cool/)`;

export const eagleAssetPlugin: RegisteredPlugin = {
    manifest: {
        id: EAGLE_PLUGIN_ID,
        name: "Eagle Library",
        version: "0.3.0",
        publishedAt: "2026-08-21",
        updatedAt: "2026-08-22",
        apiVersion: "beeftv.plugin/v1",
        description: "Use Eagle as an external source for your site, browse raw folders and read and write Eagle files directly.",
        documentation: eaglePluginDocumentation,
        author: "Open source community",
        permissions: ["asset.read", "asset.search", "asset.upload", "external.open"],
        trusted: true,
        configuration: {
            fields: [
                { name: "baseUrl", type: "url", label: "Eagle Base URL", required: true, default: EAGLE_DEFAULT_BASE_URL },
                { name: "autoUploadGenerated", type: "boolean", label: "Automatically upload generated results", default: true },
                { name: "generatedFolderId", type: "string", label: "Generate results folder" },
            ],
        },
        contributes: {},
    },
    createAssetSource: ({ config }: PluginHostContext) => {
        const configuredBaseUrl = config.baseUrl;
        return createEagleAssetSource(typeof configuredBaseUrl === "string" && configuredBaseUrl.trim() ? configuredBaseUrl.trim() : undefined);
    },
    setup(host) {
        const disposePage = host.contribute("app.page", {
            path: "",
            title: "Eagle Library",
            component: EaglePageSlotWrapper,
        });
        const disposeSidebar = host.contribute("app.sidebar", {
            id: EAGLE_PLUGIN_ID,
            label: "Eagle Library",
            path: "/p/eagle-asset-connector",
            order: 50,
        });
        const disposeSettings = host.contribute("app.settings", {
            title: "Eagle library settings",
            component: EagleSettingsSlotWrapper,
        });
        const disposeAssetSource = host.contribute("assets.source", {
            id: EAGLE_PLUGIN_ID,
            name: "Eagle Library",
            description: "Use Eagle as an external source for your site, browse raw folders and read and write Eagle files directly.",
            provider: {
                listFolders: (signal) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).listFolders!(signal);
                },
                list: (query) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).list!(query);
                },
                importAsset: (item, signal) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).importAsset!(item, signal);
                },
                uploadAsset: (asset, signal) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).uploadAsset!(asset, signal);
                },
                uploadAssetToFolder: (asset, folderId, signal) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).uploadAssetToFolder!(asset, folderId, signal);
                },
                uploadFile: (file, folderId, signal) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).uploadFile!(file, folderId, signal);
                },
                createFolder: (name, parentId) => {
                    const baseUrl = host.config.get<string>("baseUrl", EAGLE_DEFAULT_BASE_URL) || EAGLE_DEFAULT_BASE_URL;
                    return createEagleAssetSource(baseUrl.trim()).createFolder!(name, parentId);
                },
            },
        });
        return () => {
            disposePage();
            disposeSidebar();
            disposeSettings();
            disposeAssetSource();
        };
    },
};

export function createEagleAssetSource(baseUrl = EAGLE_DEFAULT_BASE_URL): AssetSourceProvider {
    let folderCache: EagleFolder[] | null = null;

    const getFolders = async (signal?: AbortSignal) => {
        if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
        if (!folderCache) folderCache = (await getEagleLibrary(baseUrl)).library.folders;
        return folderCache;
    };

    return {
        listFolders: async (signal) => (await getFolders(signal)).map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId })),
        list: async (query) => {
            const [result, folders] = await Promise.all([listEagleItems({ baseUrl, folderId: query.folderId, keyword: query.keyword, limit: query.limit, offset: query.offset }), getFolders(query.signal)]);
            const pathMap = buildFolderPathMap(folders);
            return result.items.map((item) => toExternalItem(item, baseUrl, pathMap));
        },
        importAsset: (item, signal) => importEagleAsset(item, baseUrl, signal),
        uploadAsset: (asset, signal) => uploadEagleAsset(asset, baseUrl, undefined, signal),
        uploadAssetToFolder: (asset, folderId, signal) => uploadEagleAsset(asset, baseUrl, folderId, signal),
        uploadFile: (file, folderId, signal) => uploadEagleFile(file, baseUrl, folderId, signal),
        createFolder: async (name, parentId) => {
            await createEagleFolder(baseUrl, { name, parentId });
            folderCache = null;
        },
    };
}

async function importEagleAsset(item: ExternalAssetItem, baseUrl: string, signal?: AbortSignal): Promise<Asset> {
    const kind = item.kind;
    if (kind === "text" || kind === "entity") throw new Error("Currently, Eagle import does not support text or entity materials.");
    const blob = await downloadEagleItem(item.id, baseUrl, signal);
    const now = new Date().toISOString();
    const metadata = {
        source: "eagle",
        eagle: {
            itemId: item.id,
            baseUrl,
            folderId: item.folderId,
            folderIds: item.folderIds || [],
            folderPath: item.folderPath || [],
            extension: item.metadata?.extension,
        },
    };
    if (kind === "image") {
        const uploaded = await uploadImage(blob);
        return {
            id: nanoid(), kind, title: item.title, coverUrl: uploaded.url, tags: item.tags || [], source: "Eagle Library", createdAt: now, updatedAt: now, metadata,
            data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: item.width || uploaded.width, height: item.height || uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    const uploaded = await uploadMediaFile(blob, `eagle-${kind}`);
    if (kind === "video") {
        return {
            id: nanoid(), kind, title: item.title, coverUrl: "", tags: item.tags || [], source: "Eagle Library", createdAt: now, updatedAt: now, metadata,
            data: { url: uploaded.url, storageKey: uploaded.storageKey, width: item.width || uploaded.width || 1280, height: item.height || uploaded.height || 720, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    if (kind === "audio") {
        return {
            id: nanoid(), kind, title: item.title, coverUrl: "", tags: item.tags || [], source: "Eagle Library", createdAt: now, updatedAt: now, metadata,
            data: { url: uploaded.url, storageKey: uploaded.storageKey, durationMs: uploaded.durationMs, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    return {
        id: nanoid(), kind: "model", title: item.title, coverUrl: "", tags: item.tags || [], source: "Eagle Library", createdAt: now, updatedAt: now, metadata,
        data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: item.title },
    };
}

type EagleWritableAsset = Extract<Asset, { kind: "image" | "video" | "audio" }>;

async function uploadEagleAsset(asset: Asset, baseUrl: string, folderId?: string, signal?: AbortSignal): Promise<ExternalAssetItem> {
    if (!isEagleWritableAsset(asset)) throw new Error("Currently only supports writing images, videos or audio back to Eagle");
    const dataUrl = await assetToDataUrl(asset, signal);
    const result = await addEagleItem(baseUrl, {
        url: dataUrl,
        name: eagleAssetName(asset),
        folderId,
        tags: asset.tags,
        annotation: asset.note,
        website: typeof asset.metadata?.eagle === "object" && asset.metadata.eagle && "url" in asset.metadata.eagle ? String(asset.metadata.eagle.url || "") : undefined,
    });
    return { id: result.item.id || "eagle:" + asset.id, title: eagleAssetName(asset), kind: asset.kind, tags: asset.tags, mimeType: asset.data.mimeType };
}

function isEagleWritableAsset(asset: Asset): asset is EagleWritableAsset {
    return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
}

async function assetToDataUrl(asset: EagleWritableAsset, signal?: AbortSignal) {
    if (asset.kind === "image") {
        return imageToDataUrl({ dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, url: asset.data.dataUrl, name: asset.title, mimeType: asset.data.mimeType });
    }
    const stored = asset.data.storageKey ? await getMediaBlob(asset.data.storageKey) : null;
    if (stored) return fileToDataUrl(withMimeType(stored, asset.data.mimeType), signal);
    const url = asset.data.url;
    if (!url) throw new Error("The generated result has no media address writable to Eagle");
    if (url.startsWith("data:")) return url;
    const response = await fetch(url, { credentials: "include", signal });
    if (!response.ok) throw new Error("Failed to read build media and cannot write to Eagle");
    return fileToDataUrl(withMimeType(await response.blob(), asset.data.mimeType), signal);
}

function eagleAssetName(asset: EagleWritableAsset) {
    const title = asset.title.trim() || (asset.kind === "image" ? "Generate pictures" : asset.kind === "video" ? "Generate video" : "Generate audio");
    if (/\.[a-z0-9]{2,8}$/i.test(title)) return title;
    const extension = asset.kind === "image" ? extensionFromMime(asset.data.mimeType, "png") : asset.kind === "video" ? extensionFromMime(asset.data.mimeType, "mp4") : extensionFromMime(asset.data.mimeType, "mp3");
    return title + "." + extension;
}

function extensionFromMime(mimeType: string, fallback: string) {
    const value = mimeType.toLowerCase();
    if (value.includes("png")) return "png";
    if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
    if (value.includes("webm")) return "webm";
    if (value.includes("quicktime")) return "mov";
    if (value.includes("wav")) return "wav";
    if (value.includes("ogg")) return "ogg";
    if (value.includes("mp4")) return "mp4";
    if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
    return fallback;
}

function withMimeType(blob: Blob, mimeType: string) {
    return mimeType && blob.type !== mimeType ? blob.slice(0, blob.size, mimeType) : blob;
}
async function uploadEagleFile(file: File, baseUrl: string, folderId?: string, signal?: AbortSignal): Promise<ExternalAssetItem> {
    if (file.size > 96 * 1024 * 1024) throw new Error("A single file cannot exceed 96 MB");
    if (!isEagleMediaType(file.type)) throw new Error("Eagle writing currently supports image, video and audio files");
    const dataUrl = await fileToDataUrl(file, signal);
    const result = await addEagleItem(baseUrl, {
        url: dataUrl,
        name: file.name,
        folderId,
    });
    const itemId = result.item.id || "eagle:" + nanoid();
    const extension = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
    return {
        id: itemId,
        title: file.name,
        kind: kindFromExtension(extension),
        thumbnailUrl: result.item.id ? eagleItemThumbnailUrl(result.item.id, baseUrl) : undefined,
        fileUrl: result.item.id ? eagleItemFileUrl(result.item.id, baseUrl) : undefined,
        mimeType: file.type || mimeTypeFromExtension(extension),
        bytes: file.size,
        folderId,
        folderIds: folderId ? [folderId] : [],
        metadata: { extension },
    };
}

function isEagleMediaType(mimeType: string) {
    const value = mimeType.toLowerCase();
    return value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/");
}
function fileToDataUrl(file: Blob, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const abort = () => {
            reader.abort();
            cleanup();
            reject(new DOMException("Request canceled", "AbortError"));
        };
        reader.onload = () => {
            cleanup();
            if (typeof reader.result !== "string") {
                reject(new Error("Unable to read file to be written"));
                return;
            }
            resolve(reader.result);
        };
        reader.onerror = () => {
            cleanup();
            reject(new Error("Unable to read file to be written"));
        };
        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        reader.readAsDataURL(file);
    });
}

function toExternalItem(item: EagleItem, baseUrl: string, pathMap: Map<string, string[]>) {
    const kind = kindFromExtension(item.extension);
    const folderIds = item.folderIds || [];
    const tags = item.tags || [];
    return {
        id: item.id,
        title: item.name,
        kind,
        thumbnailUrl: eagleItemThumbnailUrl(item.id, baseUrl),
        fileUrl: eagleItemFileUrl(item.id, baseUrl),
        mimeType: mimeTypeFromExtension(item.extension),
        width: item.width,
        height: item.height,
        bytes: item.size,
        tags,
        folderId: folderIds[0],
        folderIds,
        folderPath: folderIds[0] ? pathMap.get(folderIds[0]) : [],
        description: item.annotation,
        metadata: { extension: item.extension, modificationTime: item.modificationTime, url: item.url, deleted: item.deleted },
    } satisfies ExternalAssetItem;
}

function buildFolderPathMap(folders: EagleFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result = new Map<string, string[]>();
    for (const folder of folders) {
        const path: string[] = [];
        const seen = new Set<string>();
        let current: EagleFolder | undefined = folder;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            path.unshift(current.name);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        result.set(folder.id, path);
    }
    return result;
}

function kindFromExtension(extension: string): Asset["kind"] {
    const value = extension.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"].includes(value)) return "image";
    if (["mp4", "mov", "webm", "mkv", "avi"].includes(value)) return "video";
    if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(value)) return "audio";
    if (["glb", "gltf", "obj", "fbx", "usdz", "blend"].includes(value)) return "model";
    return "model";
}

function mimeTypeFromExtension(extension: string) {
    const value = extension.toLowerCase();
    if (["jpg", "jpeg"].includes(value)) return "image/jpeg";
    if (value === "png") return "image/png";
    if (value === "webp") return "image/webp";
    if (value === "gif") return "image/gif";
    if (value === "svg") return "image/svg+xml";
    if (value === "mp4") return "video/mp4";
    if (value === "webm") return "video/webm";
    if (value === "mp3") return "audio/mpeg";
    if (value === "wav") return "audio/wav";
    if (value === "glb") return "model/gltf-binary";
    return "application/octet-stream";
}


registerPlugin(eagleAssetPlugin);
