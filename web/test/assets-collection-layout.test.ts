import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isWorkspaceGeneratedHistoryAsset, isWorkspacePersonalLibraryAsset } from "@/services/workspace-asset-read";

describe("asset library category sidebar", () => {
    test("keeps type, business and folder filters in the product asset workspace", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/workspace-product.css"), "utf8");
        expect(page).toContain("assets-collection-layout");
        expect(page).toContain('aria-label="Material classification"');
        expect(page).toContain("builtinFolderCounts");
        expect(page).toContain('aria-label="New category"');
        expect(page).not.toContain('title="default label"');
        expect(page).not.toContain('title="Tags and Classifications"');
        expect(page).toContain('className="collection-filter-label">Classification</span>');
        expect(page).toContain('"character", "environment", "prop"');
        expect(page).toContain("folders.map((folder) => (");
        expect(page).not.toContain("All custom categories");
        expect(css).toContain(".assets-library-source-rail");
        expect(css).toContain(".assets-library-source-rail");
    });
});

describe("asset upload entry points", () => {
    test("empty state opens the native image/video/audio picker and uploads without an intermediate modal", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const handler = readFileSync(resolve(import.meta.dir, "../src/services/workspace-asset-upload.ts"), "utf8");
        expect(page).toContain("<AssetsEmptyState onImport={() => assetUploadInputRef.current?.click()} />");
        expect(page).toContain('accept="image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"');
        expect(page).toContain("await uploadWorkspaceAssetFiles(files, folderId)");
        expect(page).toContain('label: "Upload assets"');
        expect(handler).toContain("uploadMediaFile(file, \"video\"");
        expect(handler).toContain("uploadMediaFile(file, \"audio\"");
        expect(handler).toContain("Please select an image, video or audio file");
        expect(page).not.toContain("AssetBatchUploadModal");
        expect(page).not.toContain("batchUploadOpen");
    });

    test("matches LibTV personal-library new menu", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        expect(page).toContain('label: "Upload assets"');
        expect(page).toContain('label: "New folder"');
        expect(page).not.toContain('label: "New text material"');
    });
});

describe("project card actions", () => {
    test("project cards expose the LibTV-style overflow actions", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/projects/index.tsx"), "utf8");
        expect(page).toContain('aria-label={`${row.project.name} 更多操作`}');
        expect(page).toContain('label: "open"');
        expect(page).toContain('label: "rename"');
        expect(page).toContain('label: "Modify cover"');
        expect(page).toContain('label: "Create a copy"');
        expect(page).toContain('label: "Move to folder"');
        expect(page).toContain("duplicateProject");
        expect(page).toContain("moveProjectToFolder");
        expect(page).toContain('label: row.project.status === "archived" ? "Restore Project" : "Archived Project"');
        expect(page).toContain('label: "Delete item"');
        expect(page).toContain("updateProject");
        const canvasCard = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-folder-card.tsx"), "utf8");
        expect(canvasCard).toContain('label: "open"');
        expect(canvasCard).toContain('label: "rename"');
        expect(canvasCard).toContain('label: "Move to folder"');
        expect(canvasCard).toContain("<LibraryCardShell");
        expect(canvasCard).toContain('label: "Create a copy"');
        expect(canvasCard).toContain('label: "Modify cover"');
        expect(canvasCard).toContain("beeftv-project-cover:");
        expect(canvasCard).toContain('toDataURL("image/jpeg", 0.84)');
        expect(canvasCard).toContain("onDuplicate");
        expect(canvasCard).not.toContain("summarizePreviewNodeTypes");
        expect(canvasCard).not.toContain("canvas-collection-node-types");
        const previewCard = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-project-card.tsx"), "utf8");
        expect(previewCard).toContain('preload="auto"');
        expect(previewCard).toContain("projectPreviewMediaCandidates(project.nodes, preferLatestImage).find");
        expect(previewCard).toContain("<Workflow className=\"canvas-project-empty-icon\"");
        const canvasPage = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/index.tsx"), "utf8");
        expect(canvasPage).toContain("<LibraryCardShell");
        expect(canvasPage).toContain("maxSize = 1280");
        expect(canvasPage).toContain('toDataURL("image/jpeg", 0.84)');
        expect(canvasPage).toContain("Cover image cannot exceed 12MB");
        expect(canvasPage).toContain("Please select an image file for cover");
        expect(canvasPage).toContain("onOpen={() => setFolderFilter(folder.id)}");
        expect(canvasPage).toContain('label: "Change cover"');
        expect(canvasPage).not.toContain('icon: <ImageIcon className="size-3.5" />');
        expect(canvasPage).toContain('label: "Delete folder"');
        expect(canvasPage).not.toContain('icon: <Pencil className="size-3.5" />');
        const recycleBin = readFileSync(resolve(import.meta.dir, "../src/components/canvas/recycle-bin-dialog.tsx"), "utf8");
        expect(recycleBin).toContain("restoreProject");
        expect(recycleBin).toContain("Revert to project list");
        expect(recycleBin).toContain("Delete completely");
        expect(recycleBin).toContain("Unable to recover after deletion");
        expect(recycleBin).toContain("createPortal");
        expect(recycleBin).not.toContain("<Modal");
        expect(recycleBin).toContain('role="dialog"');
        expect(recycleBin).toContain('aria-modal="true"');
        expect(recycleBin).toContain('aria-label="Select all recycle bin items"');
        expect(recycleBin).toContain("setSelectedDeleted(event.target.checked ? allDeletedProjectIds : [])");
        expect(recycleBin).toContain('document.body.style.overflow = "hidden"');
        expect(recycleBin).not.toContain("Popconfirm");
        expect(recycleBin).toContain("setDeleteConfirmationOpen(true)");
        expect(recycleBin).toContain('role="alertdialog"');
        expect(recycleBin).toContain('aria-labelledby="recycle-delete-title"');
        expect(recycleBin).toContain("permanentlyDeleteProjects(selectedDeleted)");
        expect(recycleBin).toContain("setDeleteConfirmationOpen(false)");
        const styles = readFileSync(resolve(import.meta.dir, "../src/styles/workspace-product.css"), "utf8");
        expect(styles).toContain(".recycle-bin-overlay { position: fixed; inset: 0;");
        expect(styles).toContain(".recycle-bin-dialog {");
        expect(styles).toContain("display: grid;");
        expect(styles).toContain("grid-template-rows: 72px minmax(0, 1fr) 68px");
        expect(styles).toContain(".recycle-bin-viewport { height: calc(var(--recycle-card-height) * 2 + var(--recycle-row-gap)); min-height: 0; overflow-y: auto;");
        expect(styles).toContain(".recycle-bin-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));");
        expect(styles).toContain("grid-auto-rows: var(--recycle-card-height)");
        expect(styles).toContain("height: calc(var(--recycle-card-height) * 2 + var(--recycle-row-gap))");
        expect(styles).toContain(".recycle-delete-confirm-backdrop { position: absolute; inset: 0;");
        expect(styles).toContain(".recycle-delete-confirm { width: min(360px, calc(100% - 40px));");
        expect(styles).toContain(".recycle-bin-header h2 { margin: 0; color: #f5f5f5; font-size: 22px;");
        expect(styles).toContain(".recycle-bin-select-all { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,.78); font-size: 14px;");
        expect(styles).toContain(".recycle-bin-selected-count { margin-left: 4px; color: rgba(255,255,255,.42); font-size: 12px;");
        expect(styles).toContain(".recycle-bin-card.is-selected { border-color: rgba(255,255,255,.58);");
        expect(styles).toContain("appearance: none;");
        expect(styles).toContain(".recycle-bin-checkbox input:checked, .recycle-bin-select-all input:checked");
        expect(styles).toContain(".recycle-bin-footer .ant-btn { height: 36px; min-width: 104px;");
        expect(styles).not.toContain(".recycle-bin-checkbox input, .recycle-bin-select-all input { width: 16px; height: 16px; accent-color: var(--user-accent);");
        expect(styles).not.toContain(".recycle-bin-card.is-selected { border-color: var(--user-accent)");
        expect(styles).not.toContain(".libtv-recycle-modal-wrap");
        expect(canvasCard).not.toContain("canvas-collection-rename");
        expect(styles).toContain(".canvas-collection-card:focus-within .canvas-collection-select { opacity: 1; }");
        expect(styles).not.toContain(".app-user-workspace .lib-tv-project-page .canvas-collection-select { display: none; }");
        expect(styles).toContain("top: auto; right: 8px; bottom: 24px");
        expect(styles).toContain("canvas-collection-preview");
        expect(styles).toContain(".libtv-folder-card-more { position: absolute; top: auto;");
        expect(styles).toContain(".libtv-folder-card-body { display: flex; flex-direction: column; align-items: flex-start;");
        expect(styles).toContain("gap: 2px; padding: 10px 12px;");
        expect(styles).toContain("libtv-folder-card-body { min-height: 58px; padding: 8px 40px 8px 8px;");
        const globalStyles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        expect(globalStyles).toContain("min-height: 230.8px");
        expect(globalStyles).toContain("height: 34.8px !important");
        expect(page).toContain('label: "open"');
    });
});

describe("asset card actions", () => {
    test("asset overflow menu supports rename, categorization, download and deletion", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        expect(page).toContain('label: "rename"');
        expect(page).toContain('label: "Move to category"');
        expect(page).toContain('label: "Download"');
        expect(page).toContain("Delete permanently");
        expect(page).not.toContain('label: "Edit label"');
        expect(page).not.toContain('label: asset.metadata?.favorite === true ? "Unfavorite" : "Favorite"');
    });

    test("asset overflow trigger behaves as an isolated menu control", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        expect(page).toContain('aria-haspopup="menu"');
        expect(page).toContain('onClick={(event) => event.stopPropagation()}');
    });
});

describe("generation history card actions", () => {
    test("matches LibTV hover controls for download and permanent deletion", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/assets-reference-baseline.css"), "utf8");
        expect(page).toContain('aria-label="Generate result operation"');
        expect(page).toContain('aria-label={`下载 ${asset.title}`}');
        expect(page).toContain('aria-label={`永久删除 ${asset.title}`}');
        expect(page).toContain("setPendingDelete([asset])");
        expect(page).toContain("setPendingDelete(selectedHistoryAssets)");
        expect(page).toContain("if (!await onDelete(asset)) continue");
        expect(page).toContain("onOk={() => void confirmHistoryDelete()}");
        expect(page).not.toContain("selectedHistoryAssets.forEach(onDelete)");
        expect(page).not.toContain('aria-label={`移入回收站 ${asset.title}`}');
        expect(css).toContain(".generation-history-hover-actions");
        expect(css).toContain(".generation-history-card:hover .generation-history-hover-actions");
    });

    test("supports selecting history cards for batch actions", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/assets-reference-baseline.css"), "utf8");
        expect(page).toContain('aria-label={`选择 ${asset.title}`}');
        expect(page).toContain('aria-label="Generate historical batch operations"');
        expect(page).toContain("Selected");
        expect(page).toContain("selectedHistoryIds");
        expect(css).toContain(".generation-history-select");
        expect(css).toContain(".generation-history-batch-bar");
    });

    test("supports saving generation history items into personal asset library", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        expect(page).toContain("isWorkspacePersonalLibraryAsset");
        expect(page).toContain("Save to asset library");
        expect(page).toContain("Saved asset library");
        expect(page).toContain('message.success("Deposited into personal asset library")');
        expect(isWorkspaceGeneratedHistoryAsset({ kind: "image", source: "Generate tasks", metadata: { generationEffectKey: "eff-1" } })).toBe(true);
        expect(isWorkspacePersonalLibraryAsset({ kind: "image", source: "Generate tasks", metadata: { generationEffectKey: "eff-1" } })).toBe(false);
        expect(isWorkspacePersonalLibraryAsset({ kind: "image", source: "Generate tasks", metadata: { generationEffectKey: "eff-1", savedToLibrary: true } })).toBe(true);
    });
});
