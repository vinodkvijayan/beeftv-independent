import { confinedArchivePath, createZip, readZip } from "@/lib/zip";
import { saveOwnedNativeArchiveFiles, saveOwnedOrBrowserBlob, type OwnedMediaSaveResult } from "@/services/desktop-media-save";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile, CanvasProjectExportItem } from "@/types/canvas-export";
import type { CanvasFolder, CanvasProject } from "@/stores/canvas/use-canvas-store";
import { loadCanvasDrawing, loadCanvasDrawingPreview, loadCanvasDrawingRender } from "@/lib/canvas/canvas-drawing-storage";
import type { CanvasDrawingExport } from "@/types/canvas-export";
import { normalizeLocalCanvasProject } from "@/lib/local-workspace-migration";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { archiveFileExtension, assertUniqueArchiveNames, ExportIntegrityError, type MissingExportFile } from "@/lib/export-integrity";
import { http } from "@/services/api/request";
import { startOperation } from "@/stores/use-operation-progress";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";
import { resourceIdFromStorageKey } from "@/services/api/resources";

export const ARCHIVE_STORAGE_KEY_PATTERN = /^(image|video|audio|file|resource|model|video-reference|audio-reference):/;

export function isArchiveStorageKey(value: string) {
    const key = value.trim();
    if (!key || key.startsWith("data:") || key.startsWith("blob:")) return false;
    return ARCHIVE_STORAGE_KEY_PATTERN.test(key);
}

export type CanvasExportProgress = { phase: "loading" | "media" | "drawings" | "packing" | "saving"; completed?: number; total?: number };

export function canvasExportProgressLabel(progress: CanvasExportProgress) {
    switch (progress.phase) {
        case "loading": return "Reading canvas...";
        case "media": return `Reading file${progress.completed ?? 0}/${progress.total ?? 0}…`;
        case "drawings": return "Loading artboards...";
        case "packing": return "Packing...";
        case "saving": return "Preparing to save, please select a location in the pop-up window...";
    }
}

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "canvas", options: { includeLocalDrawings?: boolean; allowMissingMedia?: boolean; onSkippedFiles?: (missing: MissingExportFile[]) => void; folders?: CanvasFolder[]; signal?: AbortSignal; onProgress?: (progress: CanvasExportProgress) => void } = {}): Promise<OwnedMediaSaveResult> {
    const operation = startOperation("Export canvas", { detail: "Reading canvas and media files", totalFiles: projects.reduce((sum, project) => sum + collectStorageKeys(project).length, 0) });
    const finish = (result: OwnedMediaSaveResult) => {
        if (result === "cancelled") operation.dismiss(); else operation.done("Canvas backup saved");
        return result;
    };
    try {
    const recordedPhases = new Set<CanvasExportProgress["phase"]>();
    const check = () => { options.signal?.throwIfAborted(); };
    const step = <T,>(promise: Promise<T>) => awaitCanvasExportStep(promise, options.signal);
    const progress = (value: CanvasExportProgress) => {
        check();
        options.onProgress?.(value);
        operation.update({ phase: value.phase === "packing" || value.phase === "saving" ? "processing" : "preparing", detail: canvasExportProgressLabel(value) });
        if (value.phase === "media") operation.update({ completedFiles: value.completed, totalFiles: value.total });
        if (!recordedPhases.has(value.phase)) {
            recordedPhases.add(value.phase);
            recordDiagnosticEvent({ category: "action", level: "info", code: "canvas_export_" + value.phase, message: `Canvas export${value.phase}`, canvasId: projects.length === 1 ? projects[0]?.id : undefined });
        }
    };
    let completed = 0;
    const total = projects.reduce((count, project) => count + collectStorageKeys(project).length, 0);
    progress({ phase: "media", completed, total });
    const zipFiles: { name: string; data: BlobPart; resourceId?: string }[] = [];
    const missingFiles: MissingExportFile[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            const missingStorageKeys = new Set<string>();
            const missingDrawingIds = new Set<string>();
            await Promise.all(
                collectStorageKeys(project).map(async (storageKey) => {
                    let blob: Blob | null | undefined;
                    try {
                        blob = await step(storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey));
                        check();
                    } catch (error) {
                        check();
                        missingStorageKeys.add(storageKey);
                        missingFiles.push({ owner: project.title || project.id, reference: `${storageKey}(read failed)` });
                        return;
                    } finally {
                        if (!options.signal?.aborted) progress({ phase: "media", completed: ++completed, total });
                    }
                    if (!blob || blob.size === 0) {
                        missingStorageKeys.add(storageKey);
                        missingFiles.push({ owner: project.title || project.id, reference: storageKey });
                        return;
                    }
                    const path = `projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(storageKey)}.${archiveFileExtension(blob.type, storageKey.startsWith("image:") ? "png" : "bin")}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob, resourceId: resourceIdFromStorageKey(storageKey) || undefined });
                }),
            );
            check();
            const drawingNodes = project.nodes.filter((node) => options.includeLocalDrawings !== false && node.type === "drawing" && node.metadata?.drawingId);
            if (drawingNodes.length) progress({ phase: "drawings" });
            const drawingDocuments = (await Promise.all(drawingNodes.map(async (node): Promise<CanvasDrawingExport | null> => {
                const drawingId = node.metadata?.drawingId;
                if (!drawingId) return null;
                let saved: Awaited<ReturnType<typeof loadCanvasDrawing>>;
                let preview: Awaited<ReturnType<typeof loadCanvasDrawingPreview>>;
                let render: Awaited<ReturnType<typeof loadCanvasDrawingRender>>;
                try {
                    [saved, preview, render] = await step(Promise.all([
                        loadCanvasDrawing(project.id, drawingId),
                        loadCanvasDrawingPreview(project.id, drawingId),
                        loadCanvasDrawingRender(project.id, drawingId),
                    ]));
                    check();
                } catch (error) {
                    check();
                    missingDrawingIds.add(drawingId);
                    missingFiles.push({ owner: project.title || project.id, reference: `drawing board${node.title || drawingId}(read failed)` });
                    return null;
                }
                if (!saved) {
                    missingDrawingIds.add(drawingId);
                    missingFiles.push({ owner: project.title || project.id, reference: `drawing board${node.title || drawingId}` });
                    return null;
                }
                const previewPath = preview ? `projects/${project.id}/drawings/${safeFileName(drawingId)}.png` : undefined;
                if (preview && previewPath) zipFiles.push({ name: previewPath, data: preview });
                const generationRenderPath = render ? `projects/${project.id}/drawings/${safeFileName(drawingId)}.generation.png` : undefined;
                if (render && generationRenderPath) zipFiles.push({ name: generationRenderPath, data: render.blob });
                return {
                    drawingId,
                    ...saved,
                    previewPath,
                    generationRender: render && generationRenderPath
                        ? { path: generationRenderPath, pageId: render.pageId, width: render.width, height: render.height, mimeType: render.mimeType, background: render.background }
                        : undefined,
                } satisfies CanvasDrawingExport;
            }))).filter((item): item is CanvasDrawingExport => item !== null);
            drawingDocuments.forEach((document) => zipFiles.push({ name: `projects/${project.id}/drawings/${safeFileName(document.drawingId)}.json`, data: JSON.stringify(document) }));
            const normalizedProject = isLocalWorkspaceMode() ? normalizeLocalCanvasProject(project) : project;
            const exportedProject = options.allowMissingMedia && (missingStorageKeys.size > 0 || missingDrawingIds.size > 0)
                ? stripMissingArchiveReferences(normalizedProject, missingStorageKeys, missingDrawingIds)
                : normalizedProject;
            return {
                project: exportedProject,
                files,
                ...(options.includeLocalDrawings === false ? {} : { drawingDocuments }),
            };
        }),
    );

    const projectFolderIds = new Set(projects.map((project) => project.folderId).filter((id): id is string => Boolean(id)));
    const folders: CanvasExportFile["folders"] = [];
    for (const folder of options.folders?.filter((item) => projectFolderIds.has(item.id)) || []) {
        let cover: Blob | undefined;
        try {
            if (folder.coverResourceId) {
                const response = await http.raw<Blob>({ method: "GET", url: `/resources/${encodeURIComponent(folder.coverResourceId)}/file?proxy=1`, responseType: "blob", signal: options.signal });
                cover = response.data;
            } else if (folder.coverDataUrl) {
                const response = await fetch(folder.coverDataUrl, { signal: options.signal });
                if (!response.ok) throw new ExportIntegrityError([{ owner: folder.name, reference: "Folder cover" }]);
                cover = await step(response.blob());
            }
            if (cover && !cover.size) throw new ExportIntegrityError([{ owner: folder.name, reference: "Folder cover" }]);
        } catch (error) {
            check();
            if (!options.allowMissingMedia) throw error;
            missingFiles.push({ owner: folder.name, reference: "Folder cover" });
            cover = undefined;
        }
        const coverPath = cover ? `folders/${encodeURIComponent(folder.id)}/cover.${archiveFileExtension(cover.type, "png")}` : undefined;
        if (cover && coverPath) zipFiles.push({ name: coverPath, data: cover, resourceId: folder.coverResourceId });
        folders.push({ ...folder, coverResourceId: undefined, coverDataUrl: undefined, coverPath, coverMimeType: cover?.type || undefined });
    }
    const exportedFolderIds = new Set(folders.map((folder) => folder.id));
    for (const item of exportedProjects) {
        if (item.project.folderId && !exportedFolderIds.has(item.project.folderId)) {
            item.project = { ...item.project, folderId: undefined };
        }
    }
    if (missingFiles.length) {
        if (!options.allowMissingMedia) throw new ExportIntegrityError(missingFiles);
        options.onSkippedFiles?.(missingFiles);
    }
    assertUniqueArchiveNames(["projects.json", ...zipFiles.map((file) => file.name)]);
    for (const item of exportedProjects) {
        const liveKeys = new Set(collectStorageKeys(item.project));
        for (const file of item.files) {
            if (!liveKeys.has(file.storageKey) || file.path === file.storageKey) {
                throw new Error("Backup not completed: File references are inconsistent and no backup was generated.");
            }
        }
    }

    const data: CanvasExportFile = {
        app: "infinite-canvas",
        version: 4,
        exportedAt: new Date().toISOString(),
        ...(folders?.length ? { folders } : {}),
        ...(missingFiles.length ? { skippedFiles: missingFiles } : {}),
        projects: exportedProjects,
    };
    progress({ phase: "packing" });
    const archiveFiles = [{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles];
    const saved = await saveOwnedNativeArchiveFiles(`${safeFileName(fileName)}.zip`, archiveFiles, { signal: options.signal, onSaving: () => progress({ phase: "saving" }) });
    if (saved !== undefined) return finish(saved);
    const zip = await step(createZip(archiveFiles));
    check();
    progress({ phase: "saving" });
    return finish(await saveOwnedOrBrowserBlob(`${safeFileName(fileName)}.zip`, zip));
    } catch (error) {
        if (options.signal?.aborted) operation.dismiss(); else operation.fail("Canvas export is not completed, please check the error and try again");
        throw error;
    }
}

// A cache/IndexedDB read may never settle. Cancellation stops this export;
// shared cache reads can finish independently but can no longer save a file.
export function awaitCanvasExportStep<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(signal.reason); };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); }, (error) => { signal.removeEventListener("abort", onAbort); reject(error); });
    });
}

export async function exportCanvasProjectsByIds(
    canvasIds: readonly string[],
    loadProject: (id: string) => Promise<CanvasProject | null | undefined> | CanvasProject | null | undefined,
    options: {
        archiveTitle?: string;
        singleCanvasOnly?: boolean;
        folders?: CanvasFolder[];
        allowMissingMedia?: boolean;
        onSkipped?: (count: number, missing: MissingExportFile[]) => void;
        signal?: AbortSignal;
        onProgress?: (progress: CanvasExportProgress) => void;
    } = {},
): Promise<OwnedMediaSaveResult> {
    if (!canvasIds.length) throw new Error("Canvas does not exist and cannot be exported");
    const loaded: CanvasProject[] = [];
    for (const id of canvasIds) {
        const project = await awaitCanvasExportStep(Promise.resolve(loadProject(id)), options.signal);
        options.signal?.throwIfAborted();
        if (!project) throw new Error("Canvas does not exist and cannot be exported");
        loaded.push(project);
    }
    let skippedFiles: MissingExportFile[] = [];
    const baseTitle = loaded[0]?.title || "canvas";
    const fileName = options.archiveTitle || (options.singleCanvasOnly ? `${baseTitle}- Canvas backup` : `${baseTitle}-${loaded.length}canvas`);
    const result = await exportCanvasProjects(loaded, fileName, {
        folders: options.folders,
        allowMissingMedia: options.allowMissingMedia ?? false,
        onSkippedFiles: (missing) => { skippedFiles = missing; },
        signal: options.signal,
        onProgress: options.onProgress,
    });
    if (result !== "cancelled" && skippedFiles.length > 0) {
        options.onSkipped?.(skippedFiles.length, skippedFiles);
    }
    return result;
}

export type OpenCanvasArchive = {
    data: CanvasExportFile;
    files: Map<string, Blob>;
};

export async function openCanvasArchive(file: Blob): Promise<OpenCanvasArchive> {
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("Missing projects.json metadata file");
    let data: CanvasExportFile;
    try {
        data = JSON.parse(await projectFile.text()) as CanvasExportFile;
    } catch {
        throw new Error("Canvas backup is corrupted and cannot be imported");
    }
    preflightCanvasArchive(data, zip);
    return { data, files: zip };
}

export function preflightCanvasArchive(data: CanvasExportFile, zip: Map<string, Blob>): void {
    if (!data || data.app !== "infinite-canvas") throw new Error("Not a valid canvas backup");
    if (data.version !== 3 && data.version !== 4) throw new Error("Unsupported canvas backup version");
    if (!Array.isArray(data.projects)) throw new Error("Missing canvas list in projects.json");
    if (data.folders !== undefined && !Array.isArray(data.folders)) throw new Error("The list of folders in backup is invalid");
    const folderIds = new Set<string>();
    const archivePaths = new Set<string>(["projects.json"]);
    for (const folder of data.folders || []) {
        if (!folder || typeof folder.id !== "string" || !folder.id.trim() || typeof folder.name !== "string") {
            throw new Error("The folder in the backup is invalid");
        }
        if (folderIds.has(folder.id)) throw new Error("There are duplicate folders in the backup");
        folderIds.add(folder.id);
        if (folder.coverPath !== undefined) {
            const path = confinedArchivePath(folder.coverPath);
            if (archivePaths.has(path)) throw new Error(`There are files with the same name in the compressed package:${path}`);
            archivePaths.add(path);
            const blob = zip.get(path);
            if (!blob?.size) throw new Error(`The compressed package is missing the folder cover:${folder.name}`);
        }
    }
    const projectIds = new Set<string>();
    for (const item of data.projects) {
        preflightCanvasArchiveProject(item, zip, projectIds, folderIds, archivePaths);
    }
}

function preflightCanvasArchiveProject(
    item: CanvasProjectExportItem,
    zip: Map<string, Blob>,
    projectIds: Set<string>,
    folderIds: Set<string>,
    archivePaths: Set<string>,
) {
    if (!item || !item.project || typeof item.project !== "object") throw new Error("The canvas in the backup is invalid");
    const project = item.project;
    const title = typeof project.title === "string" && project.title.trim() ? project.title : "Unnamed canvas";
    if (typeof project.id !== "string" || !project.id.trim()) throw new Error(`canvas "${title}"Missing number`);
    if (projectIds.has(project.id)) throw new Error(`There are duplicate canvases in the backup:${title}`);
    projectIds.add(project.id);
    if (project.folderId && !folderIds.has(project.folderId)) throw new Error(`canvas "${title}” refers to a folder that does not exist`);
    if (!Array.isArray(item.files)) throw new Error(`canvas "${title}The media list for " is invalid`);
    if (project.nodes !== undefined && !Array.isArray(project.nodes)) throw new Error(`canvas "${title}》The node list is invalid`);
    if (project.connections !== undefined && !Array.isArray(project.connections)) throw new Error(`canvas "${title}The connection list for " is invalid`);
    if (project.timeline !== undefined) preflightCanvasArchiveTimeline(project.timeline, title);
    const nodeIds = new Set<string>();
    for (const node of project.nodes || []) {
        if (!node || typeof node !== "object" || typeof node.id !== "string" || !node.id.trim() || typeof node.type !== "string" || !node.type.trim()) {
            throw new Error(`canvas "${title}” contains invalid nodes`);
        }
        if (nodeIds.has(node.id)) throw new Error(`canvas "${title}"There are duplicate nodes`);
        nodeIds.add(node.id);
    }
    const fileKeys = new Set<string>();
    for (const fileItem of item.files) {
        if (!fileItem || typeof fileItem.storageKey !== "string" || typeof fileItem.path !== "string") {
            throw new Error(`canvas "${title}The media list for " is invalid`);
        }
        if (!isArchiveStorageKey(fileItem.storageKey)) {
            throw new Error(`canvas "${title}” contains an invalid media reference`);
        }
        if (fileKeys.has(fileItem.storageKey)) throw new Error(`canvas "${title}"There are duplicate media references`);
        fileKeys.add(fileItem.storageKey);
        const path = confinedArchivePath(fileItem.path);
        if (path === "projects.json" || archivePaths.has(path)) throw new Error(`There are files with the same name in the compressed package:${path}`);
        archivePaths.add(path);
        const blob = zip.get(path) || zip.get(fileItem.path);
        if (!blob || blob.size === 0) throw new Error(`The compressed package is missing media files:${fileItem.path || "unnamed file"}`);
    }
    const liveKeys = collectStorageKeys(project);
    for (const storageKey of liveKeys) {
        if (!fileKeys.has(storageKey)) throw new Error(`The compressed package is missing media files:${storageKey}`);
    }
    for (const storageKey of fileKeys) {
        if (!liveKeys.includes(storageKey)) throw new Error(`canvas "${title}"The media list is inconsistent with the canvas content`);
    }
    if (item.drawingDocuments !== undefined && !Array.isArray(item.drawingDocuments)) {
        throw new Error(`canvas "${title}"The artboard document is invalid`);
    }
    const drawingIds = new Set<string>();
    for (const document of item.drawingDocuments || []) {
        if (!document || typeof document.drawingId !== "string" || !document.drawingId.trim()) {
            throw new Error(`canvas "${title}"The artboard document is invalid`);
        }
        if (drawingIds.has(document.drawingId)) throw new Error(`canvas "${title}"Duplicate artboards exist`);
        drawingIds.add(document.drawingId);
        if (document.previewPath) {
            const path = confinedArchivePath(document.previewPath);
            if (archivePaths.has(path)) throw new Error(`There are files with the same name in the compressed package:${path}`);
            archivePaths.add(path);
            if (!zip.get(path) && !zip.get(document.previewPath)) throw new Error(`The compressed package is missing media files:${document.previewPath}`);
        }
        if (document.generationRender?.path) {
            const path = confinedArchivePath(document.generationRender.path);
            if (archivePaths.has(path)) throw new Error(`There are files with the same name in the compressed package:${path}`);
            archivePaths.add(path);
            if (!zip.get(path) && !zip.get(document.generationRender.path)) throw new Error(`The compressed package is missing media files:${document.generationRender.path}`);
        }
    }
    for (const node of project.nodes || []) {
        if (node.type !== "drawing" || !node.metadata?.drawingId) continue;
        if (item.drawingDocuments && !drawingIds.has(node.metadata.drawingId)) {
            throw new Error(`canvas "${title}"Missing artboard${node.title || node.metadata.drawingId}`);
        }
    }
}

function preflightCanvasArchiveTimeline(timeline: NonNullable<CanvasProject["timeline"]>, title: string) {
    if (!timeline || typeof timeline !== "object" || !Array.isArray(timeline.clips) || !Array.isArray(timeline.tracks)) {
        throw new Error(`canvas "${title}"The timeline is invalid`);
    }
}

export function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && isArchiveStorageKey(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function stripMissingArchiveReferences<T>(
    value: T,
    missingStorageKeys: ReadonlySet<string>,
    missingDrawingIds: ReadonlySet<string>,
): T {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        return value.map((item) => stripMissingArchiveReferences(item, missingStorageKeys, missingDrawingIds)) as T;
    }
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    const droppedResourceId = typeof record.storageKey === "string" && missingStorageKeys.has(record.storageKey)
        ? resourceIdFromStorageKey(record.storageKey)
        : "";
    for (const [key, child] of Object.entries(record)) {
        if (key === "storageKey" && typeof child === "string" && missingStorageKeys.has(child)) {
            continue;
        }
        if (key === "drawingId" && typeof child === "string" && missingDrawingIds.has(child)) {
            continue;
        }
        if (droppedResourceId && (key === "content" || key === "previewContent" || key === "url") && typeof child === "string" && child.includes(`/resources/${encodeURIComponent(droppedResourceId)}/file`)) {
            next[key] = "";
            continue;
        }
        next[key] = stripMissingArchiveReferences(child, missingStorageKeys, missingDrawingIds);
    }
    return next as T;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}
