import { ArrowDownUp, AudioLines, Box, Check, CheckCheck, Clapperboard, Copy, Download, FileText, FileUp, FileX2, FolderOpen, FolderPlus, History, Image as ImageIcon, LayoutGrid, List, Maximize2, MoreHorizontal, Pause, PencilLine, Play, Plus, RotateCcw, SlidersHorizontal, Trash2, Upload, Volume2, VolumeX, X, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Dropdown, Form, Input, Modal, Popover, Progress, Select, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { useNavigate, useSearchParams } from "react-router";

import { CollectionGrid, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { CollectionHeader } from "@/components/layout/collection-header";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { AssetDrawer, AssetGenerationPromptSection, AssetVideoPreview, formatAssetClock } from "@/components/assets/asset-detail-drawer";
export { AssetDrawer, AssetVideoPreview };
import { assetFolderQueryKey, assetLibraryQueryKey, assetPickerQueryKey, mergeHistoryLibraryAssets } from "@/components/assets/asset-view-session";
import { emitPluginEvent } from "@/lib/plugins/plugin-events";
import { usePluginSlot } from "@/lib/plugins/slot-registry";
import { Switch } from "@/components/ui/base/switch";
import { ownedResourceIdFromMediaRef } from "@/services/api/resources";
import { useResourceVideoPlayback } from "@/hooks/use-resource-video-playback";
import { downloadOwnedOrBrowserMedia, reportOwnedMediaSave } from "@/services/desktop-media-save";
import { mediaFileExtension, sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import { cn } from "@/lib/utils";

import { useCopyText } from "@/hooks/use-copy-text";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ASSET_CATEGORY_OPTIONS, assetCategoryLabel } from "@/lib/asset-category";
import { resourceStorageLabel, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { formatBytes, readFileAsDataUrl, readImageMeta } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { flushAssetStorePersistence, useAssetStore, type Asset, type AssetCategory, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { startOperation } from "@/stores/use-operation-progress";
import { assetStorageUsageQueryKey } from "./asset-storage-usage";
import { loadAssetLibraryPage, localSavedRemotePendingMessage } from "@/services/local-workspace-sync";
import { isUnsavedWorkspaceAsset, isWorkspaceGeneratedHistoryAsset, isWorkspacePersonalLibraryAsset, usesWorkspaceAssetLibraryApi, WORKSPACE_ASSET_UNLINKED_PROJECT, workspaceAssetAllProjectsCount, workspaceAssetCountSum, workspaceAssetProjectLabel, workspaceAssetProjectOptions, workspaceAssetTraversalTotal } from "@/services/workspace-asset-read";
import { deleteWorkspaceAsset, persistWorkspaceAssetChanges, persistWorkspaceAssetLink } from "@/services/workspace-asset-repository";
import {
    assignWorkspaceAssetsFolder,
    createWorkspaceAssetFolder,
    deleteWorkspaceAssetFolder,
    listWorkspaceAssetFolders,
    renameWorkspaceAssetFolder,
    usesWorkspaceAssetFolderApi,
} from "@/services/workspace-asset-folders";
import { workspaceCapabilities } from "@/services/workspace-mode";
import { normalizeLocalAsset } from "@/lib/local-workspace-migration";
import { useUserStore } from "@/stores/use-user-store";
import type { AssetFolder } from "@/services/api/workspace-data";
import { uploadWorkspaceAssetFiles } from "@/services/workspace-asset-upload";
import "@/styles/assets-reference-baseline.css";
import "@/styles/assets-frame-lock.css";
import "@/styles/assets-final-lock.css";

type LibraryAsset = Exclude<Asset, { kind: "entity" }>;

type AssetFormValues = {
    kind: AssetKind;
    category: AssetCategory;
    folderId?: string;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
    arkAssetId?: string;
    portraitCertified?: boolean;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { label: "All", value: "all" },
    { label: "text", value: "text" },
    { label: "pictures", value: "image" },
    { label: "video", value: "video" },
    { label: "Audio", value: "audio" },
];

const categoryOptions = [{ label: "All categories", value: "all" }, ...ASSET_CATEGORY_OPTIONS];
// Bump the preference key so existing installs that persisted list view get
// the new grid-first default once, while future user choices remain sticky.
const ASSET_VIEW_MODE_KEY = "infinite-canvas:asset-view-mode:v2";
const ASSET_HISTORY_PAGE_SIZE = 40;
type GenerationHistoryKind = "all" | "image" | "video" | "audio";
type AssetFolderFilter = "all" | "uncategorized" | string;
type AssetSortOrder = "updated_desc" | "updated_asc" | "name_asc";

const assetKindIcons: Record<LibraryAsset["kind"], LucideIcon> = {
    text: FileText,
    image: ImageIcon,
    video: Clapperboard,
    audio: AudioLines,
    model: Box,
};

export default function AssetsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const sourceTab = searchParams.get("tab") === "history" ? "history" : "personal";
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assetUploadInputRef = useRef<HTMLInputElement>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);

    const updateAsset = useAssetStore((state) => state.updateAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const localWorkspace = workspaceCapabilities().local;
    const remoteMode = Boolean(userId) && !localWorkspace;
    const canonicalReads = usesWorkspaceAssetLibraryApi();
    const folderApi = usesWorkspaceAssetFolderApi();
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const categoryFilter = "all";
    const [folderFilter, setFolderFilter] = useState<AssetFolderFilter>("all");
    const [projectFilter, setProjectFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(40);
    const [historyKind, setHistoryKind] = useState<GenerationHistoryKind>("all");
    const [historyPage, setHistoryPage] = useState(1);
    const [historyAssets, setHistoryAssets] = useState<LibraryAsset[]>([]);
    const [assetViewMode, setAssetViewMode] = useState<"grid" | "list">(readAssetViewMode);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sortOrder, setSortOrder] = useState<AssetSortOrder>("updated_desc");
    const [editingAsset, setEditingAsset] = useState<LibraryAsset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<LibraryAsset | null>(null);
    const [deletePending, setDeletePending] = useState(false);
    const deleteInFlight = useRef(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
    const [folderEditor, setFolderEditor] = useState<AssetFolder | "new" | null>(null);
    const [folderName, setFolderName] = useState("");
    const [folderSaving, setFolderSaving] = useState(false);
    const [folderDeleteConfirmId, setFolderDeleteConfirmId] = useState<string | null>(null);
    const folderSaveInFlight = useRef(false);
    const skipFolderBlurSave = useRef(false);
    const [localFolders, setLocalFolders] = useState<AssetFolder[]>([]);

    useEffect(() => {
        if (!folderDeleteConfirmId) return;
        const dismiss = (event: PointerEvent) => {
            if (!(event.target instanceof Element) || !event.target.closest(".assets-folder-delete-confirm")) {
                setFolderDeleteConfirmId(null);
            }
        };
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, [folderDeleteConfirmId]);

    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUploading, setImageUploading] = useState(false);
    const [imageUploadProgress, setImageUploadProgress] = useState<{ phase: "uploading" | "confirming"; percent?: number } | null>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const content = Form.useWatch("content", form) || "";
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);

    const foldersQuery = useQuery({
        queryKey: assetFolderQueryKey(),
        queryFn: () => listWorkspaceAssetFolders(),
        enabled: folderApi,
    });
    useEffect(() => {
        if (folderApi) return;
        let active = true;
        void listWorkspaceAssetFolders().then((folders) => {
            if (active) setLocalFolders(folders);
        }).catch(() => {
            // Ignore malformed local folder metadata; assets remain usable as uncategorized.
        });
        return () => { active = false; };
    }, [folderApi]);
    const folders = folderApi ? foldersQuery.data || [] : localFolders;

    const allLibraryAssets = useMemo(() => assets.filter((asset): asset is LibraryAsset => asset.kind !== "entity"), [assets]);
    const activeAssets = useMemo(() => allLibraryAssets.filter((asset) => asset.status !== "archived"), [allLibraryAssets]);
    const localGenerationHistoryCount = useMemo(() => activeAssets.filter(isWorkspaceGeneratedHistoryAsset).length, [activeAssets]);
    const validAssets = useMemo(() => activeAssets.filter(isWorkspacePersonalLibraryAsset), [activeAssets]);
    const selectedAssets = useMemo(() => validAssets.filter((asset) => selectedIds.includes(asset.id)), [selectedIds, validAssets]);
    useEffect(() => {
        if (batchDeleteOpen && !deletePending && selectedAssets.length === 0) setBatchDeleteOpen(false);
    }, [batchDeleteOpen, deletePending, selectedAssets.length]);
    const localProjectOptions = useMemo(() => {
        const names = new Set<string>();
        for (const asset of validAssets) {
            const label = workspaceAssetProjectLabel(asset);
            if (label !== WORKSPACE_ASSET_UNLINKED_PROJECT) names.add(label);
        }
        return Array.from(names).sort((left, right) => left.localeCompare(right, "en-US"));
    }, [validAssets]);
    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        return validAssets.filter((asset) => {
            if (projectFilter !== "all" && workspaceAssetProjectLabel(asset) !== projectFilter) return false;
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (folderFilter.startsWith("builtin:") && (asset.folderId || asset.category !== folderFilter.slice(8))) return false;
            if (folderFilter === "uncategorized" && asset.folderId) return false;
            if (folderFilter !== "all" && folderFilter !== "uncategorized" && !folderFilter.startsWith("builtin:") && asset.folderId !== folderFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter, categoryFilter, folderFilter, projectFilter]);

    const assetPageQuery = useQuery({
        queryKey: assetLibraryQueryKey(page, pageSize, "library", kindFilter, categoryFilter, folderFilter, projectFilter, debouncedKeyword),
        queryFn: ({ signal }) => loadAssetLibraryPage({
            page,
            pageSize,
            status: "active",
            kind: kindFilter === "all" ? undefined : kindFilter,
            category: folderFilter.startsWith("builtin:") ? folderFilter.slice(8) as AssetCategory : undefined,
            folderId: folderFilter !== "all" && folderFilter !== "uncategorized" && !folderFilter.startsWith("builtin:") ? folderFilter : undefined,
            uncategorized: folderFilter.startsWith("builtin:"),
            query: debouncedKeyword || undefined,
            project: projectFilter === "all" ? undefined : projectFilter,
            signal,
        }),
        enabled: canonicalReads && sessionHydrated,
        placeholderData: (previousData) => previousData,
    });
    // Built-in folders contain only assets without a custom folder. Category
    // facets alone also include custom-folder assets and would overcount them.
    const builtinCountsQuery = useQuery({
        queryKey: [...assetFolderQueryKey(), "builtin-folder-counts"],
        queryFn: async ({ signal }) => {
            const counts = await Promise.all((["character", "environment", "prop"] as const).map(async category => {
                const result = await loadAssetLibraryPage({ page: 1, pageSize: 1, status: "active", category, uncategorized: true, signal });
                return [category, result.total] as const;
            }));
            return Object.fromEntries(counts);
        },
        enabled: canonicalReads && sessionHydrated,
    });
    const builtinFolderCounts = canonicalReads
        ? builtinCountsQuery.data || {}
        : Object.fromEntries((["character", "environment", "prop"] as const).map(category => [category, activeAssets.filter(asset => !asset.folderId && asset.category === category).length]));

    const historyQuery = useQuery({
        queryKey: assetLibraryQueryKey("history", historyPage, historyKind),
        queryFn: ({ signal }) => loadAssetLibraryPage({
            page: historyPage,
            pageSize: ASSET_HISTORY_PAGE_SIZE,
            status: "active",
            generated: true,
            kind: historyKind === "all" ? undefined : historyKind,
            signal,
        }),
        enabled: canonicalReads && sessionHydrated && sourceTab === "history",
        placeholderData: (previousData) => previousData,
    });
    useEffect(() => {
        if (sourceTab !== "history") {
            setHistoryKind("all");
            setHistoryPage(1);
            setHistoryAssets([]);
        }
    }, [sourceTab]);
    useEffect(() => {
        if (!canonicalReads || sourceTab !== "history" || !historyQuery.data || historyQuery.isPlaceholderData) return;
        const next = (historyQuery.data.assets || []).filter((asset): asset is LibraryAsset => asset.kind !== "entity" && asset.status !== "archived");
        setHistoryAssets((current) => mergeHistoryLibraryAssets(current, next, historyPage));
    }, [canonicalReads, historyPage, historyQuery.data, historyQuery.isPlaceholderData, sourceTab]);

    const localVisibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);
    const remotePageAssets = useMemo(() => (assetPageQuery.data?.assets || []).filter((asset): asset is LibraryAsset => asset.kind !== "entity" && (sourceTab !== "personal" || isWorkspacePersonalLibraryAsset(asset))), [assetPageQuery.data?.assets, sourceTab]);
    const remoteFilteredOut = useMemo(() => (assetPageQuery.data?.assets || []).filter((asset) => asset.kind !== "entity" && sourceTab === "personal" && !isWorkspacePersonalLibraryAsset(asset)).length, [assetPageQuery.data?.assets, sourceTab]);
    const remoteTotal = Math.max(0, (assetPageQuery.data?.total ?? 0) - remoteFilteredOut);
    const remoteReady = canonicalReads && assetPageQuery.isSuccess && assetPageQuery.data !== undefined;
    const visibleAssets = useMemo(() => remoteReady ? remotePageAssets : localVisibleAssets, [remoteReady, remotePageAssets, localVisibleAssets]);
    const orderedVisibleAssets = useMemo(() => {
        const next = [...visibleAssets];
        next.sort((left, right) => {
            if (sortOrder === "name_asc") return left.title.localeCompare(right.title, "en-US");
            const leftTime = new Date(left.updatedAt).getTime();
            const rightTime = new Date(right.updatedAt).getTime();
            return sortOrder === "updated_asc" ? leftTime - rightTime : rightTime - leftTime;
        });
        return next;
    }, [sortOrder, visibleAssets]);
    const visibleAssetIds = useMemo(() => visibleAssets.map((asset) => asset.id), [visibleAssets]);
    const allFilteredSelected = visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selectedIds.includes(id));
    const totalAssets = canonicalReads && assetPageQuery.isError ? 0 : remoteReady ? remoteTotal : filteredAssets.length;
    const hasNarrowingFilters = kindFilter !== "all" || folderFilter !== "all" || Boolean(debouncedKeyword) || projectFilter !== "all";
    const libraryEmpty = remoteReady
        ? totalAssets === 0 && visibleAssets.length === 0 && !hasNarrowingFilters
        : validAssets.length === 0 && totalAssets === 0;

    const kindCounts = useMemo(() => assetCountMap(kindOptions, remoteReady ? assetPageQuery.data?.kindCounts : undefined, activeAssets, (asset) => asset.kind), [activeAssets, assetPageQuery.data?.kindCounts, remoteReady]);
    const categoryCounts = useMemo(() => assetCountMap(categoryOptions, remoteReady ? assetPageQuery.data?.categoryCounts : undefined, activeAssets, (asset) => asset.category || "other"), [activeAssets, assetPageQuery.data?.categoryCounts, remoteReady]);
    const folderCounts = remoteReady
        ? assetPageQuery.data?.folderCounts || {}
        : Object.fromEntries([...new Set(activeAssets.map((asset) => asset.folderId).filter((id): id is string => Boolean(id)))].map((folderId) => [folderId, activeAssets.filter((asset) => asset.folderId === folderId).length]));
    const allFoldersCount = remoteReady ? workspaceAssetCountSum(folderCounts) : activeAssets.length;
    const recentCount = remoteReady ? assetPageQuery.data?.recentTotal ?? 0 : activeAssets.filter((asset) => Number.isFinite(new Date(asset.updatedAt).getTime()) && Date.now() - new Date(asset.updatedAt).getTime() <= 30 * 24 * 60 * 60 * 1000).length;
    const generationHistoryCount = remoteReady ? assetPageQuery.data?.generatedTotal ?? 0 : localGenerationHistoryCount;
    const remoteProjectCounts = remoteReady ? assetPageQuery.data?.projectCounts : undefined;
    const projectOptions = remoteProjectCounts ? workspaceAssetProjectOptions(remoteProjectCounts) : localProjectOptions;
    const allProjectsCount = remoteProjectCounts ? workspaceAssetAllProjectsCount(remoteProjectCounts) : activeAssets.length;
    const traversalTotal = remoteReady && assetPageQuery.data ? workspaceAssetTraversalTotal(assetPageQuery.data) : filteredAssets.length;

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(traversalTotal / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [pageSize, traversalTotal]);

    useEffect(() => {
        window.localStorage.setItem(ASSET_VIEW_MODE_KEY, assetViewMode);
    }, [assetViewMode]);

    useEffect(() => {
        const allowed = new Set(visibleAssetIds);
        if (!canonicalReads) {
            for (const asset of validAssets) allowed.add(asset.id);
        } else {
            for (const asset of assets) {
                if (isUnsavedWorkspaceAsset(asset)) allowed.add(asset.id);
            }
        }
        setSelectedIds((current) => current.filter((id) => allowed.has(id)));
    }, [assets, canonicalReads, validAssets, visibleAssetIds]);

    const folderSelectOptions = useMemo(() => [
        { label: "No category specified", value: "" },
        ...ASSET_CATEGORY_OPTIONS.filter(item => ["character", "environment", "prop"].includes(item.value)).map(item => ({ label: item.label, value: `builtin:${item.value}` })),
        ...folders.map((folder) => ({ label: folder.name, value: folder.id })),
    ], [folders]);

    const invalidateAssetLibrary = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: assetLibraryQueryKey() }),
            queryClient.invalidateQueries({ queryKey: assetFolderQueryKey() }),
        ]);
    };

    const reflectDeletedAssets = (ids: string[]) => {
        const deletedIds = new Set(ids);
        queryClient.setQueriesData<Awaited<ReturnType<typeof loadAssetLibraryPage>>>(
            { queryKey: assetLibraryQueryKey() },
            (current) => {
                if (!current || !Array.isArray(current.assets)) return current;
                const assets = current.assets.filter((asset) => !deletedIds.has(asset.id));
                const removed = current.assets.length - assets.length;
                if (!removed) return current;
                return { ...current, assets, total: Math.max(0, current.total - removed), canonicalTotal: Math.max(0, current.canonicalTotal - removed) };
            },
        );
        setHistoryAssets((current) => current.filter((asset) => !deletedIds.has(asset.id)));
        setSelectedIds((current) => current.filter((id) => !deletedIds.has(id)));
    };

    const refreshDeletedAssets = async () => {
        await Promise.all([
            invalidateAssetLibrary(),
            queryClient.invalidateQueries({ queryKey: assetPickerQueryKey() }),
        ]);
    };

    const uploadFiles = async (files: File[], folderId: string) => {
        const hideLoading = message.loading("Uploading material...", 0);
        try {
            const result = await uploadWorkspaceAssetFiles(files, folderId);
            if (result.persistenceError) message.warning(localSavedRemotePendingMessage("Some materials have been saved locally", result.persistenceError));
            else if (result.completed) message.success(`Uploaded${result.completed} materials`);
            if (result.failed) message.error(`${result.failed} Material upload failed`);
            await invalidateAssetLibrary();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Upload failed");
        } finally {
            hideLoading();
        }
    };

    const saveFolder = async () => {
        const name = folderName.trim();
        if (!folderEditor || folderSaveInFlight.current) return;
        const creating = folderEditor === "new";
        if (!name) {
            if (!creating) {
                setFolderEditor(null);
                setFolderName("");
            }
            return;
        }
        if (folderEditor !== "new" && name === folderEditor.name) {
            setFolderEditor(null);
            setFolderName("");
            return;
        }
        const folderId = folderEditor === "new" ? "" : folderEditor.id;
        folderSaveInFlight.current = true;
        setFolderSaving(true);
        try {
            const created = creating ? await createWorkspaceAssetFolder(name) : undefined;
            if (!creating) await renameWorkspaceAssetFolder(folderId, name);
            if (!folderApi) setLocalFolders(await listWorkspaceAssetFolders());
            await invalidateAssetLibrary();
            const saved = creating ? { mode: "created" as const, folder: created } : { mode: "renamed" as const, folder: undefined };
            setFolderEditor(null);
            setFolderName("");
            if (saved.mode === "created") {
                setFiltersOpen(true);
                if (saved.folder?.id) {
                    setFolderFilter(saved.folder.id);
                    setPage(1);
                }
            }
            message.success(saved.mode === "created" ? "Material classification has been created" : "Material categories have been renamed");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to save material classification");
        } finally {
            folderSaveInFlight.current = false;
            setFolderSaving(false);
        }
    };

    const removeFolder = async (folder: AssetFolder) => {
        try {
            await deleteWorkspaceAssetFolder(folder.id);
            if (!folderApi) setLocalFolders(await listWorkspaceAssetFolders());
            await flushAssetStorePersistence();
            await invalidateAssetLibrary();
            setFolderDeleteConfirmId(null);
            if (folderFilter === folder.id) setFolderFilter("all");
            setPage(1);
            message.success(`Category deleted "${folder.name}”, the material has been moved to Uncategorized`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Material category deletion failed");
            throw error;
        }
    };

    const moveSelectedAssetsToFolder = async (assetIds: string[], folderId: string) => {
        if (!assetIds.length) return;
        try {
            if (folderId.startsWith("builtin:")) {
                for (const id of assetIds) {
                    const asset = validAssets.find(item => item.id === id);
                    if (!asset) throw new Error("The material information has changed, please refresh and try again");
                    updateAsset(id, { category: folderId.slice(8) as AssetCategory, folderId: undefined });
                    await persistWorkspaceAssetLink({ asset: { ...asset, folderId: undefined, category: folderId.slice(8) as AssetCategory } as Asset, category: folderId.slice(8) as AssetCategory, folderId: ""});
                }
            } else { await assignWorkspaceAssetsFolder(assetIds, folderId); }
            if (!folderApi) await persistWorkspaceAssetChanges();
            await flushAssetStorePersistence();
            const movedIds = new Set(assetIds);
            const builtin = folderId.startsWith("builtin:");
            const remainsVisible = folderFilter === "all" || folderFilter === folderId || (folderFilter === "uncategorized" && !folderId);
            queryClient.setQueryData<Awaited<ReturnType<typeof loadAssetLibraryPage>>>(assetLibraryQueryKey(page, pageSize, "library", kindFilter, categoryFilter, folderFilter, projectFilter, debouncedKeyword), current => {
                if (!current) return current;
                const assets = current.assets.flatMap(item => !movedIds.has(item.id) ? [item] : remainsVisible ? [{ ...item, folderId: builtin ? undefined : folderId || undefined, category: builtin ? folderId.slice(8) as AssetCategory : item.category }] : []);
                return { ...current, assets, total: Math.max(0, current.total - (current.assets.length - assets.length)) };
            });
            await invalidateAssetLibrary();
            setSelectedIds([]);
            message.success(`Moved${assetIds.length} materials`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to move assets");
        }
    };

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setImageFile(null);
        setImageUploading(false);
        setImageUploadProgress(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", category: "other", folderId: folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : "", title: "", coverUrl: "", tags: [], source: "Add manually", note: "", content: "", arkAssetId: "", portraitCertified: false });
        setIsAssetOpen(true);
    };

    const renameAsset = async (asset: LibraryAsset, title: string) => {
        title = title.trim();
        if (!title || title === asset.title) return;
        try {
            updateAsset(asset.id, { title });
            await persistWorkspaceAssetLink({ asset: { ...asset, title } as Asset });
            queryClient.setQueriesData<Awaited<ReturnType<typeof loadAssetLibraryPage>>>({ queryKey: assetLibraryQueryKey() }, current => current && Array.isArray(current.assets) ? { ...current, assets: current.assets.map(item => item.id === asset.id ? { ...item, title } : item) } : current);
            await invalidateAssetLibrary();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Rename failed");
            throw error;
        }
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        let imageData = imageDraft;
        if (values.kind === "image" && imageFile) {
            setImageUploading(true);
            setImageUploadProgress({ phase: "uploading", percent: 0 });
            try {
                const image = await uploadImage(imageFile, (loaded, total) => {
                    setImageUploadProgress(loaded >= total ? { phase: "confirming" } : { phase: "uploading", percent: Math.floor(loaded / total * 100) });
                });
                setImageUploadProgress({ phase: "confirming" });
                imageData = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
                setImageDraft(imageData);
                setImageFile(null);
                void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
            } catch (error) {
                message.error(error instanceof Error ? error.message : "Image upload failed, please try again");
                return;
            } finally {
                setImageUploading(false);
                setImageUploadProgress(null);
            }
        }

        const base = {
            title: values.title.trim(),
            category: values.folderId?.startsWith("builtin:") ? values.folderId.slice(8) as AssetCategory : "other" as AssetCategory,
            folderId: values.folderId?.startsWith("builtin:") ? undefined : values.folderId || undefined,
            status: editingAsset?.status || ("confirmed" as const),
            primaryVersionId: editingAsset?.primaryVersionId,
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageData ? imageData.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            arkAssetId: values.arkAssetId?.trim() || undefined,
            portraitCertified: values.portraitCertified || undefined,
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind !== "text" && !imageData) {
            message.error("Please select image file");
            return;
        }

        try {
            if (values.kind === "text") {
                const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
                editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
            } else {
                const asset = { ...base, kind: "image" as const, data: imageData! };
                editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
            }
            await persistWorkspaceAssetChanges();
            await invalidateAssetLibrary();
            message.success(editingAsset ? "Material has been updated" : "Material saved");
            setIsAssetOpen(false);
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(editingAsset ? "The material has been updated locally" : "The material has been saved locally", error));
            setIsAssetOpen(false);
        }
    };


    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/") || imageUploading) return;
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const meta = await readImageMeta(dataUrl);
            setImageFile(file);
            const draft = { dataUrl, storageKey: "", width: meta.width, height: meta.height, bytes: file.size, mimeType: file.type || meta.mimeType };
            setImageDraft(draft);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", dataUrl);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to read image, please try again");
        }
    };

    const readModelFile = async (file?: File) => {
        if (!file || !/\.(glb|gltf)$/i.test(file.name)) return;
        try {
            const uploaded = await uploadMediaFile(file, "model");
            addAsset({
                kind: "model",
                title: file.name.replace(/\.(glb|gltf)$/i, ""),
                coverUrl: "",
                tags: ["3D model"],
                source: "Manual upload",
                data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name },
                metadata: { source: "manual" },
            });
            await persistWorkspaceAssetChanges();
            void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
            await invalidateAssetLibrary();
            // Hosted mode may retry the remote copy; local mode intentionally keeps
            // the browser fallback local and does not expose a cloud-upload warning.
            if (uploaded.pendingRemoteUpload) {
                // The local workspace must never surface a cloud-sync promise, even
                // if an upload result was created before the session mode finished
                // hydrating. Hosted mode keeps the retry wording.
                message.warning(localWorkspace ? "The 3D model is saved locally" : `The 3D model has been saved locally and is waiting for remote synchronization.${uploaded.remoteUploadError ? `：${uploaded.remoteUploadError}` : ""}`);
            }
            else message.success("3D model saved");
        } catch (error) {
            message.warning(localSavedRemotePendingMessage("3D model saved locally", error));
        }
    };

    const copyAssetText = async (asset: LibraryAsset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "Text copied");
    };

    const downloadImage = (asset: LibraryAsset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return;
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const extension = asset.kind === "model" ? asset.data.fileName.split(".").pop() || "glb" : mediaFileExtension(asset.data.mimeType, url) || "bin";
        void reportOwnedMediaSave(message, downloadOwnedOrBrowserMedia({
            fileName: sanitizeDownloadFileName(`${asset.title || "Material"}.${extension}`),
            resourceId: ownedResourceIdFromMediaRef(asset.data.storageKey, url) || undefined,
            browserUrl: url,
        }));
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning("No material can be exported yet");
            return;
        }
        await reportOwnedMediaSave(message, exportAssets(validAssets));
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        const progress = startOperation("Import material package", { detail: "Reading and decompressing material package", totalBytes: file.size });
        try {
            const importedAssets = await readAssetPackage(file, (completedFiles, totalFiles) => progress.update({ phase: "processing", detail: "Saving material file", completedFiles, totalFiles }));
            progress.update({ phase: "processing", detail: "Saving material record", totalFiles: importedAssets.length, completedFiles: importedAssets.length });
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset((localWorkspace ? normalizeLocalAsset(payload) : payload) as Parameters<typeof addAsset>[0]);
            });
            await flushAssetStorePersistence();
            const imported = importedAssets.length;
            try {
                await persistWorkspaceAssetChanges();
            } catch (error) {
                message.warning(localSavedRemotePendingMessage("The material has been imported locally", error));
            }
            message.success(`Imported${imported} materials`);
            emitPluginEvent("assets.imported", { assets: importedAssets.map((item) => ({ id: item.id, name: item.title, type: item.kind, url: item.coverUrl || "" })) });
            progress.done("Imported" + imported + " materials");
        } catch (error) {
            progress.fail("The material package import is not completed, please check the error and try again.");
            message.error("Import failed, please select a valid material compression package");
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const saveHistoryAssetToLibrary = async (asset: LibraryAsset) => {
        if (isWorkspacePersonalLibraryAsset(asset)) return;
        const metadata = { ...asset.metadata, savedToLibrary: true };
        const nextAsset = { ...asset, metadata } as LibraryAsset;
        try {
            updateAsset(asset.id, { metadata });
            await persistWorkspaceAssetLink({ asset: nextAsset as Asset });
            setHistoryAssets((current) => current.map((item) => (item.id === asset.id ? nextAsset : item)));
            queryClient.setQueriesData<Awaited<ReturnType<typeof loadAssetLibraryPage>>>({ queryKey: assetLibraryQueryKey() }, (current) => current && Array.isArray(current.assets) ? { ...current, assets: current.assets.map((item) => (item.id === asset.id ? { ...item, metadata } : item)) } : current);
            await Promise.all([invalidateAssetLibrary(), queryClient.invalidateQueries({ queryKey: assetPickerQueryKey() })]);
            message.success("Deposited into personal asset library");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to deposit into personal asset library");
        }
    };

    const deleteHistoryAsset = async (asset: LibraryAsset) => {
        try {
            await deleteWorkspaceAsset(asset.id);
            reflectDeletedAssets([asset.id]);
            await refreshDeletedAssets();
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Material deletion failed");
            return false;
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset || deleteInFlight.current) return;
        deleteInFlight.current = true;
        setDeletePending(true);
        try {
            await deleteWorkspaceAsset(deletingAsset.id);
            reflectDeletedAssets([deletingAsset.id]);
            await refreshDeletedAssets();
            message.success("The material has been completely deleted");
            setDeletingAsset(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Material deletion failed");
        } finally {
            deleteInFlight.current = false;
            setDeletePending(false);
        }
    };

    const exportSelectedAssets = async () => {
        if (!selectedAssets.length) return;
        await reportOwnedMediaSave(message, exportAssets(selectedAssets));
    };

    const confirmBatchDelete = async () => {
        if (!selectedAssets.length || deleteInFlight.current) return;
        deleteInFlight.current = true;
        setDeletePending(true);
        const deleting = [...selectedAssets];
        const deletedIds: string[] = [];
        const failures: string[] = [];
        try {
            for (const asset of deleting) {
                try {
                    await deleteWorkspaceAsset(asset.id);
                    deletedIds.push(asset.id);
                } catch (error) {
                    failures.push(`${asset.title || "Unnamed material"}：${error instanceof Error ? error.message : "Delete failed"}`);
                }
            }
            if (deletedIds.length) reflectDeletedAssets(deletedIds);
            setBatchDeleteOpen(false);
            if (failures.length) {
                message.error(`Deleted${deletedIds.length} one,${failures.length} have not been deleted.${failures.join("；")}`);
            } else {
                message.success(`Completely deleted${deletedIds.length} materials`);
            }
            // Refresh failure must not turn completed deletions into failed commands.
            try { await refreshDeletedAssets(); }
            catch { message.warning("The deletion result has been saved. The list refresh failed. Please reopen the material library."); }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Batch deletion failed");

        } finally {
            deleteInFlight.current = false;
            setDeletePending(false);
        }
    };

    if (sourceTab === "history") {
        const localHistoryAssets = activeAssets;
        const localGenerated = localHistoryAssets.filter(isWorkspaceGeneratedHistoryAsset);
        const visibleHistoryAssets = canonicalReads ? historyAssets : localHistoryAssets;
        const generatedKindCounts = canonicalReads
            ? historyQuery.data?.generatedKindCounts || {}
            : localGenerated.reduce<Record<string, number>>((counts, asset) => {
                counts[asset.kind] = (counts[asset.kind] || 0) + 1;
                return counts;
            }, {});
        const generatedTotal = canonicalReads ? historyQuery.data?.generatedTotal ?? 0 : localGenerated.length;
        if (canonicalReads && historyQuery.isError && historyPage <= 1 && !historyAssets.length) {
            return (
                <WorkspacePage grid className="library-page assets-library-page canvas-library-page generation-history-page">
                    <WorkspaceErrorState title="Generating history reading failed" description="Please try again later." actionLabel="Try again" onRetry={() => void historyQuery.refetch()} />
                </WorkspacePage>
            );
        }
        if (canonicalReads && !historyQuery.isSuccess && historyPage <= 1 && !historyAssets.length) {
            return (
                <WorkspacePage grid className="library-page assets-library-page canvas-library-page generation-history-page">
                    <WorkspaceLoadingState label="Reading build history" detail="Read saved material page by page." />
                </WorkspacePage>
            );
        }
        return (
            <GenerationHistorySurface
                assets={visibleHistoryAssets}
                generatedTotal={generatedTotal}
                generatedKindCounts={generatedKindCounts}
                libraryTotal={totalAssets}
                kind={canonicalReads ? historyKind : undefined}
                hasMore={canonicalReads ? Boolean(historyQuery.data?.canonicalHasMore ?? historyQuery.data?.hasMore) : false}
                loadingMore={canonicalReads && historyQuery.isFetching}
                loadMoreError={Boolean(canonicalReads && historyQuery.isError && historyPage > 1)}
                onKindChange={canonicalReads ? (next) => {
                    setHistoryKind(next);
                    setHistoryPage(1);
                    setHistoryAssets([]);
                } : undefined}
                onLoadMore={canonicalReads ? () => {
                    if (historyQuery.isFetching) return;
                    if (historyQuery.isError) {
                        void historyQuery.refetch();
                        return;
                    }
                    if (historyQuery.isPlaceholderData) return;
                    setHistoryPage((current) => current + 1);
                } : undefined}
                onSelectPersonal={() => navigate("/assets?tab=personal")}
                onSaveToLibrary={saveHistoryAssetToLibrary}
                onDownload={downloadImage}
                onDelete={deleteHistoryAsset}
            />
        );
    }

    return (
        <>
            <input
                ref={assetUploadInputRef}
                type="file"
                accept="image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
                multiple
                className="hidden"
                onChange={(event) => {
                    const files = Array.from(event.currentTarget.files || []);
                    event.currentTarget.value = "";
                    if (!files.length) return;
                    void uploadFiles(files, folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : "");
                }}
            />
            <WorkspacePage grid className="library-page assets-library-page canvas-library-page collection-page">
                <CollectionHeader
                    className="assets-library-hero"
                    title="Personal asset library"
                    search={{ value: keyword, placeholder: "Search assets", onChange: (value) => { setPage(1); setKeyword(value); } }}
                    actions={<button type="button" className={cn("assets-header-compact-button", filtersOpen && "is-active")} aria-label="Filter assets" title="Filter assets" aria-pressed={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal className="size-4" /></button>}
                    createItems={[
                        { key: "image", label: "Upload assets", onClick: () => assetUploadInputRef.current?.click() },
                        { key: "folder", label: "Create new folder", onClick: () => { setFolderName(""); setFolderEditor("new"); } },
                    ]}
                    navigationLabel="Asset type"
                    tabs={kindOptions.map((option) => ({ ...option, count: kindCounts.get(option.value) ?? 0 }))}
                    value={kindFilter}
                    onChange={(value) => { setKindFilter(value as AssetKind | "all"); setPage(1); }}
                    trailing={<>
                        <div className="assets-view-toggle" role="group" aria-label="Asset view">
                            <button type="button" className={assetViewMode === "grid" ? "is-active" : ""} aria-pressed={assetViewMode === "grid"} title="grid view" onClick={() => setAssetViewMode("grid")}><LayoutGrid className="size-3.5" /><span className="sr-only">grid view</span></button>
                            <button type="button" className={assetViewMode === "list" ? "is-active" : ""} aria-pressed={assetViewMode === "list"} title="list view" onClick={() => setAssetViewMode("list")}><List className="size-3.5" /><span className="sr-only">list view</span></button>
                        </div>
                        <label className="assets-sort-control">
                            <Select value={sortOrder} className="w-full sm:w-32" aria-label="sort"
                                options={[{ label: "reverse chronological order", value: "updated_desc" }, { label: "Chronological order", value: "updated_asc" }, { label: "Name sort", value: "name_asc" }]}
                                onChange={(value) => setSortOrder(value as AssetSortOrder)} />
                        </label>
                    </>}
                />

                <div className="collection-content assets-collection-content">
                    <div className={cn("assets-collection-layout", filtersOpen && "is-filters-open")}>
                        <aside className="assets-collection-filters" aria-label="Material classification" aria-hidden={!filtersOpen} inert={!filtersOpen}>
                            <div className="assets-collection-filter-scroll">
                            <section className="collection-filter-group assets-folder-filter">
                                <div className="collection-folder-heading">
                                    <span className="collection-filter-label">Classification</span>
                                    <button type="button" className="assets-folder-add" title="New category" aria-label="New category" onClick={() => { setFolderName(""); setFolderEditor("new"); }}><FolderPlus className="size-3.5" /></button>
                                </div>
                                <div className="collection-folder-list">
                                    <button type="button" aria-pressed={folderFilter === "all"} className={`assets-filter-item ${folderFilter === "all" ? "is-active" : ""}`} onClick={() => { setFolderFilter("all"); setPage(1); }}>
                                        <span className="assets-filter-item-label">All</span><span className="assets-filter-count">{allFoldersCount}</span>
                                    </button>
                                    {ASSET_CATEGORY_OPTIONS.filter(item => ["character", "environment", "prop"].includes(item.value)).map(item => (
                                        <button key={item.value} type="button" aria-pressed={folderFilter === `builtin:${item.value}`} className={`assets-filter-item ${folderFilter === `builtin:${item.value}` ? "is-active" : ""}`} onClick={() => { setFolderFilter(`builtin:${item.value}`); setPage(1); }}>
                                            <span className="assets-filter-item-label">{item.label}</span><span className="assets-filter-count">{builtinFolderCounts[item.value] ?? 0}</span>
                                        </button>
                                    ))}
                                    {folders.map((folder) => (
                                        <Dropdown
                                            key={folder.id}
                                            trigger={["contextMenu"]}
                                            disabled={folderEditor !== "new" && folderEditor?.id === folder.id}
                                            menu={{
                                                items: [
                                                    { key: "rename", label: "Rename" },
                                                    { type: "divider" },
                                                    { key: "delete", label: "Delete", danger: true },
                                                ],
                                                onClick: ({ key }) => {
                                                    if (key === "rename") {
                                                        setFolderDeleteConfirmId(null);
                                                        setFolderName(folder.name);
                                                        setFolderEditor(folder);
                                                        return;
                                                    }
                                                    setFolderEditor(null);
                                                    setFolderDeleteConfirmId(folder.id);
                                                },
                                            }}
                                        >
                                            <div className="assets-folder-row">
                                                {folderEditor !== "new" && folderEditor?.id === folder.id ? (
                                                    <Input
                                                        autoFocus
                                                        size="small"
                                                        className="assets-folder-inline-input"
                                                        value={folderName}
                                                        maxLength={40}
                                                        disabled={folderSaving}
                                                        aria-label={`Rename category${folder.name}`}
                                                        onChange={(event) => setFolderName(event.target.value)}
                                                        onPressEnter={() => void saveFolder()}
                                                        onBlur={() => {
                                                            if (skipFolderBlurSave.current) {
                                                                skipFolderBlurSave.current = false;
                                                                return;
                                                            }
                                                            void saveFolder();
                                                        }}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Escape") {
                                                                skipFolderBlurSave.current = true;
                                                                setFolderEditor(null);
                                                                setFolderName("");
                                                                window.setTimeout(() => { skipFolderBlurSave.current = false; }, 0);
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <button type="button" aria-pressed={folderFilter === folder.id} className={`assets-filter-item min-w-0 flex-1 ${folderFilter === folder.id ? "is-active" : ""}`} onClick={() => { setFolderFilter(folder.id); setPage(1); }}>
                                                        <span className="assets-filter-item-label min-w-0 truncate">{folder.name}</span><span className="assets-filter-count">{remoteReady ? folderCounts[folder.id] ?? 0 : activeAssets.filter((asset) => asset.folderId === folder.id).length}</span>
                                                    </button>
                                                )}
                                                {folderDeleteConfirmId === folder.id ? (
                                                    <div
                                                        className="assets-folder-delete-confirm"
                                                        role="alertdialog"
                                                        aria-label={`Confirm category deletion${folder.name}`}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Escape") setFolderDeleteConfirmId(null);
                                                        }}
                                                    >
                                                        <p>Materials in categories will be moved to uncategorized.</p>
                                                        <div className="assets-folder-delete-actions">
                                                            <button type="button" onClick={() => setFolderDeleteConfirmId(null)}>Cancel</button>
                                                            <button type="button" className="is-danger" onClick={() => { setFolderDeleteConfirmId(null); void removeFolder(folder); }}>Delete category</button>
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </Dropdown>
                                    ))}
                                </div>
                            </section>
                            {projectOptions.length ? (
                                <section className="collection-filter-group assets-project-filter" aria-label="Project source">
                                    <span className="collection-filter-label">Project source</span>
                                    <div className="collection-filter-options">
                                        <button type="button" aria-pressed={projectFilter === "all"} className={`assets-filter-item ${projectFilter === "all" ? "is-active" : ""}`} onClick={() => { setProjectFilter("all"); setPage(1); }}>
                                            <span className="assets-filter-item-label">All projects</span><span className="assets-filter-count">{allProjectsCount}</span>
                                        </button>
                                        {projectOptions.map((project) => {
                                            const count = remoteProjectCounts ? remoteProjectCounts[project] ?? 0 : activeAssets.filter((asset) => workspaceAssetProjectLabel(asset) === project).length;
                                            return <button key={project} type="button" aria-pressed={projectFilter === project} className={`assets-filter-item ${projectFilter === project ? "is-active" : ""}`} onClick={() => { setProjectFilter(project); setPage(1); }}><span className="assets-filter-item-label truncate">{project}</span><span className="assets-filter-count">{count}</span></button>;
                                        })}
                                    </div>
                                </section>
                            ) : null}

                            </div>
                        </aside>
                        <section className="min-w-0">
                            {selectedAssets.length ? (
                                <AssetsBatchBar
                                    count={selectedAssets.length}
                                    allSelected={allFilteredSelected}
                                    onSelectAll={() => setSelectedIds((current) => Array.from(new Set([...current, ...visibleAssetIds])))}
                                    onClear={() => setSelectedIds([])}
                                    onExport={() => void exportSelectedAssets()}
                                    onDelete={() => setBatchDeleteOpen(true)}
                                    folderOptions={folderSelectOptions}
                                    onMoveToFolder={(folderId) => void moveSelectedAssetsToFolder(selectedAssets.map((asset) => asset.id), folderId)}
                                />
                            ) : null}
                            {canonicalReads && assetPageQuery.isError ? (
                                <WorkspaceErrorState compact title="Failed to read material" description="Please try again later." actionLabel="Try again" onRetry={() => void assetPageQuery.refetch()} />
                            ) : canonicalReads && !remoteReady ? (
                                <WorkspaceLoadingState label="Loading material" detail="Loading saved footage." />
                            ) : libraryEmpty ? (
                                <AssetsEmptyState onImport={() => assetUploadInputRef.current?.click()} />
                            ) : (
                                <>
                                    {visibleAssets.length === 0 ? (
                                        <WorkspaceState icon={null} compact title="No matching material" description="Adjust the keywords or categories on the left and try again." />
                                    ) : (
                                        <CollectionGrid className={cn("library-grid", "assets-library-grid", assetViewMode === "list" && "is-list-view")}>
                                            {orderedVisibleAssets.map((asset) => (
                                                <AssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    selected={selectedIds.includes(asset.id)}
                                                    deleting={deletingAsset?.id === asset.id}
                                                    deletePending={deletePending}
                                                    onSelect={(selected) => setSelectedIds((current) => (selected ? [...new Set([...current, asset.id])] : current.filter((id) => id !== asset.id)))}
                                                    onOpen={() => setPreviewAsset(asset)}
                                                    onRename={(title) => renameAsset(asset, title)}
                                                    onCopy={copyAssetText}
                                                    onDownload={downloadImage}
                                                    onDelete={() => setDeletingAsset(asset)}
                                                    onConfirmDelete={confirmDelete}
                                                    onCancelDelete={() => setDeletingAsset(null)}
                                                    folderOptions={folderSelectOptions}
                                                    onMoveToFolder={(folderId) => void moveSelectedAssetsToFolder([asset.id], folderId)}
                                                />
                                            ))}
                                        </CollectionGrid>
                                    )}
                                    <PaginationBar
                                        current={page}
                                        pageSize={pageSize}
                                        total={traversalTotal}
                                        pageSizeOptions={[40, 80, 120]}
                                        onChange={(nextPage, nextPageSize) => {
                                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                            setPageSize(nextPageSize);
                                        }}
                                    />
                                </>
                            )}
                        </section>
                    </div>
                </div>
                <aside className="assets-library-source-rail" aria-label="Asset Source Navigation">
                    <div className="assets-library-source-rail-inner">
                        <button type="button" className="assets-library-source-rail-item" onClick={() => navigate("/assets?tab=history")}>
                            <span className="assets-library-source-rail-icon"><History className="size-3.5" /></span>
                            <span>Build history</span>
                            <span className="assets-filter-count">{generationHistoryCount}</span>
                        </button>
                        <button type="button" className="assets-library-source-rail-item is-active" aria-current="page">
                            <span className="assets-library-source-rail-icon"><FolderOpen className="size-3.5" /></span>
                            <span>Personal asset library</span>
                            <span className="assets-filter-count">{totalAssets}</span>
                        </button>
                    </div>
                </aside>
            </WorkspacePage>

            <Modal
                className="workspace-modal workspace-modal-wide library-modal"
                title={editingAsset ? "Edit material" : "Add new material"}
                open={isAssetOpen}
                onCancel={() => {
                    if (!imageUploading) setIsAssetOpen(false);
                }}
                onOk={() => void saveAsset()}
                okText={imageUploading ? "Uploading" : "Save"}
                cancelText="Cancel"
                confirmLoading={imageUploading}
                cancelButtonProps={{ disabled: imageUploading }}
                closable={!imageUploading}
                destroyOnHidden
            >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", category: "other", tags: [] }}>
                        <Form.Item name="kind" label="Type">
                            <Select
                                options={[
                                    { label: "text", value: "text" },
                                    { label: "pictures", value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="folderId" label="Classification">
                            <Select options={folderSelectOptions} />
                        </Form.Item>
                        <Form.Item name="title" label="Title" rules={[{ required: true, message: "Please enter a title" }]}>
                            <Input placeholder="Give your material an easily searchable name" />
                        </Form.Item>
                        <Form.Item name="coverUrl" label="Cover URL">
                            <Space.Compact className="w-full">
                                <Input placeholder="You can paste the image URL or upload a local cover" />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                                                        upload
                                </Button>
                            </Space.Compact>
                        </Form.Item>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="arkAssetId" label="Ark material ID" rules={[{ pattern: /^asset-[A-Za-z0-9-]+$/, message: "Please enter the Ark material ID starting with asset-" }]}>
                                <Input autoComplete="off" allowClear placeholder="asset-..., it must be the Ark material that you or someone authorized to use" />
                            </Form.Item>
                            <Form.Item name="portraitCertified" label="Portrait authentication" valuePropName="checked" extra="Mark the real-person portrait materials that have been certified by Volcano Ark">
                                <Switch aria-label="Portrait authentication" />
                            </Form.Item>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label="Source">
                                <Input placeholder="Manually add /canvas/task center" />
                            </Form.Item>
                            <Form.Item name="note" label="Remarks">
                                <Input placeholder="Optional" />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label="text content" rules={[{ required: true, message: "Please enter text content" }]}>
                                <Input.TextArea rows={8} placeholder="Save text materials such as prompt words, explanation copy, reference description, etc." />
                            </Form.Item>
                        ) : (
                            <Form.Item label="Image content" required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button disabled={imageUploading} icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {imageUploading ? (remoteMode ? "Uploading pictures" : "Saving picture") : "Select image file"}
                                    </Button>
                                    {imageFile ? (
                                        <Tag color="gold" className="ml-3">
                                                                                        To be saved and uploaded
                                        </Tag>
                                    ) : null}
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs" title={resourceStorageTitle(imageDraft.storageKey)}>
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)} · {resourceStorageLabel(imageDraft.storageKey)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                                                                        No picture selected
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="lg:pl-4">
                        <Typography.Text strong className="text-xs">
                                                        Preview
                        </Typography.Text>
                        <div className="mt-2 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <div className={`asset-preview-uploading ${imageUploading ? "is-uploading" : ""}`}>
                                    <img src={coverUrl || imageDraft?.dataUrl} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                                    {imageUploading && imageUploadProgress ? (
                                        <div className="asset-preview-uploading-panel">
                                            <div className="asset-preview-uploading-copy">
                                                <span>{imageUploadProgress.phase === "confirming" ? "Confirming resources" : remoteMode ? "Uploading to cloud" : "Saving to local"}</span>
                                                {typeof imageUploadProgress.percent === "number" ? <strong>{imageUploadProgress.percent}%</strong> : null}
                                            </div>
                                            <Progress percent={imageUploadProgress.percent} showInfo={false} size="small" status="active" />
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "No cover yet"}</div>
                            )}
                            <div className="bg-background p-3">
                                <Typography.Text strong ellipsis className="block">
                                    {title || "Unnamed material"}
                                </Typography.Text>

                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>



            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <Modal
                className="library-modal library-confirm-modal assets-folder-create-modal"
                title="New category"
                open={folderEditor === "new"}
                confirmLoading={folderSaving}
                onCancel={() => { if (!folderSaving) { setFolderEditor(null); setFolderName(""); } }}
                onOk={() => void saveFolder()}
                okButtonProps={{ className: "assets-folder-create-confirm" }}
                okText="Save"
                cancelText="Cancel"
            >
                <Input autoFocus value={folderName} maxLength={40} placeholder="For example: character reference, scene inspiration" onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void saveFolder()} />
            </Modal>

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <input
                ref={modelInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(event) => {
                    void readModelFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />

            <Modal
                className="library-modal library-confirm-modal"
                title="Permanently delete footage"
                open={batchDeleteOpen}
                onCancel={() => { if (!deleteInFlight.current) setBatchDeleteOpen(false); }}
                onOk={() => void confirmBatchDelete()}
                confirmLoading={deletePending}
                okText="Delete permanently"
                okButtonProps={{ danger: true, disabled: !selectedAssets.length }}
                cancelButtonProps={{ disabled: deletePending }}
                cancelText="Cancel"
            >
                                Delete selected{selectedAssets.length}  It will not be possible to restore the material after it is saved. Files still referenced by the canvas or task will be retained, and the remaining files will be cleaned up simultaneously.
            </Modal>
        </>
    );
}

function AssetCard({
    asset,
    selected,
    deleting,
    deletePending,
    onSelect,
    onOpen,
    onRename,
    onCopy,
    onDownload,
    onDelete,
    onConfirmDelete,
    onCancelDelete,
    folderOptions,
    onMoveToFolder,
}: {
    asset: LibraryAsset;
    selected: boolean;
    deleting: boolean;
    deletePending: boolean;
    onSelect: (selected: boolean) => void;
    onOpen: () => void;
    onRename: (title: string) => Promise<void>;
    onCopy: (asset: LibraryAsset) => void;
    onDownload: (asset: LibraryAsset) => void;
    onDelete: () => void;
    onConfirmDelete: () => Promise<void>;
    onCancelDelete: () => void;
    folderOptions: Array<{ label: string; value: string }>;
    onMoveToFolder: (folderId: string) => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState(asset.title);
    const renameInFlight = useRef(false);
    const finishRename = async () => {
        if (renameInFlight.current) return;
        if (!renameDraft.trim()) { setRenameDraft(asset.title); setRenaming(false); return; }
        renameInFlight.current = true;
        try { await onRename(renameDraft); setRenaming(false); }
        catch { setRenameDraft(asset.title); }
        finally { renameInFlight.current = false; }
    };
    const deleteConfirmRequested = useRef(false);
    const pluginItemActions = usePluginSlot("assets.itemActions").filter((entry) => entry.payload.when ? entry.payload.when({ asset: asset as Asset }) : true);
    const openDeleteConfirm = () => { deleteConfirmRequested.current = true; setMenuOpen(true); onDelete(); };
    const closeDeleteConfirm = () => { if (deletePending) return; deleteConfirmRequested.current = false; onCancelDelete(); };
    const menuItems: MenuProps["items"] = [
        { key: "rename", icon: <PencilLine className="size-3.5" />, label: "Rename", onClick: () => { setRenameDraft(asset.title); setRenaming(true); } },
        ...(asset.kind === "text" ? [{ key: "copy", icon: <Copy className="size-3.5" />, label: "copy text", onClick: () => void onCopy(asset) }] : []),
        ...(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? [{ key: "download", icon: <Download className="size-3.5" />, label: "Download", onClick: () => onDownload(asset) }] : []),
        { key: "move", icon: <FolderOpen className="size-3.5" />, label: "Move to category", children: folderOptions.map((folder) => ({ key: folder.value || "uncategorized", label: folder.label, onClick: () => onMoveToFolder(folder.value) })) },
        ...pluginItemActions.map((entry) => ({ key: `plugin:${entry.entryId}`, icon: entry.payload.icon, label: entry.payload.label, onClick: () => void entry.payload.onSelect({ asset: asset as Asset }) })),
        { type: "divider" as const },
        { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: (
            <Popover
                open={deleting}
                onOpenChange={(open) => { if (open) openDeleteConfirm(); else closeDeleteConfirm(); }}
                afterOpenChange={(open) => { if (!open && !deleteConfirmRequested.current) setMenuOpen(false); }}
                trigger="click"
                placement="rightBottom"
                arrow={false}
                overlayClassName="asset-delete-confirm-popover"
                content={(
                    <div className="asset-delete-confirm-content" onClick={(event) => event.stopPropagation()}>
                        <p>Are you sure you want to delete this asset? It cannot be recovered after deletion.</p>
                        <div className="asset-delete-confirm-actions">
                            <Button size="small" disabled={deletePending} onClick={closeDeleteConfirm}>Cancel</Button>
                            <Button size="small" danger loading={deletePending} onClick={() => void onConfirmDelete()}>Delete permanently</Button>
                        </div>
                    </div>
                )}
            >
                <span className="asset-delete-confirm-trigger">Delete permanently</span>
            </Popover>
        ), onClick: openDeleteConfirm },
    ];
    return (
        <AssetLibraryCard selected={selected}>
            <AssetCover asset={asset} selected={selected} onSelect={onSelect} onOpen={onOpen} menuItems={menuItems} menuOpen={menuOpen} onMenuOpenChange={(open) => {
                if (!open && deleteConfirmRequested.current) return;
                setMenuOpen(open);
            }} onMenuAction={(key) => {
                if (key === "delete") return;
                deleteConfirmRequested.current = false;
                setMenuOpen(false);
                onCancelDelete();
            }} />
            <div role="button" tabIndex={0} onKeyDown={event => { if (!renaming && (event.key === "Enter" || event.key === " ")) onOpen(); }} className="asset-collection-body is-compact block w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={() => { if (!renaming) onOpen(); }}>
                <div className="asset-card-meta">
                    {renaming ? <input autoFocus aria-label="Material name" className="asset-inline-title" value={renameDraft} onFocus={event => event.target.select()} onClick={event => event.stopPropagation()} onChange={event => setRenameDraft(event.target.value)} onBlur={() => void finishRename()} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void finishRename(); } if (event.key === "Escape") { event.preventDefault(); setRenameDraft(asset.title); setRenaming(false); } }} /> : <h2 className="truncate text-[var(--fs-body)] font-semibold text-foreground" title={asset.title}>{asset.title}</h2>}
                    <span className="asset-collection-date tabular-nums">{formatAssetTime(asset.updatedAt)}</span>
                </div>
            </div>
        </AssetLibraryCard>
    );
}

function isKnownAssetKind(kind: unknown): kind is AssetKind {
    return kind === "image" || kind === "video" || kind === "audio" || kind === "model" || kind === "text";
}

function AssetCover({ asset, selected, onSelect, onOpen, menuItems, menuOpen, onMenuOpenChange, onMenuAction }: { asset: LibraryAsset; selected: boolean; onSelect: (selected: boolean) => void; onOpen: () => void; menuItems: MenuProps["items"]; menuOpen: boolean; onMenuOpenChange: (open: boolean) => void; onMenuAction: (key: string) => void }) {
    const kind = isKnownAssetKind(asset.kind) ? asset.kind : undefined;
    const KindIcon = kind ? assetKindIcons[kind] : FileText;
    const clock = asset.kind === "video" || asset.kind === "audio" ? formatAssetClock(asset.data.durationMs) : null;
    const showPlay = asset.kind === "video";
    const isLight = asset.kind === "audio" || asset.kind === "text" || asset.kind === "model";
    return (
        <AssetLibraryCardMedia className={isLight ? "assets-cover is-light" : "assets-cover"}>
            <button type="button" data-onboarding-asset={asset.id} className="assets-cover-link" onClick={onOpen} aria-label={`View material:${asset.title}`}>
                {asset.kind === "audio" ? (
                    <AudioWaveCover asset={asset} />
                ) : asset.kind === "text" ? (
                    <TextCover asset={asset} />
                ) : asset.kind === "model" ? (
                    <ModelCover asset={asset} />
                ) : (
                    <AssetMediaPreview
                        asset={asset}
                        alt={asset.title}
                        className="assets-cover-media"
                        fallback={
                            <div className="assets-cover-fallback">
                                <KindIcon className="size-7" />
                            </div>
                        }
                    />
                )}
                <span className="assets-cover-vignette" aria-hidden="true" />
                {showPlay ? (
                    <span className="assets-cover-play">
                        <Play className="size-4" />
                    </span>
                ) : null}
            </button>
            {clock ? <span className="assets-cover-clock">{clock}</span> : null}
            <input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect(event.target.checked)} className="assets-select-check" aria-label={`Select${asset.title}`} />
            <Dropdown overlayClassName="asset-actions-menu" trigger={["click"]} open={menuOpen} onOpenChange={onMenuOpenChange} menu={{ items: menuItems, onClick: ({ key }) => onMenuAction(key) }}>
                <button
                    type="button"
                    className="assets-cover-more"
                    aria-label="More material operations"
                    aria-haspopup="menu"
                    title="More actions"
                    onClick={(event) => event.stopPropagation()}
                >
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
        </AssetLibraryCardMedia>
    );
}

function AudioWaveCover({ asset }: { asset: LibraryAsset & { kind: "audio" } }) {
    const bars = audioWaveBars(asset.id);
    return (
        <div className="assets-cover-wave" aria-hidden="true">
            {bars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
            ))}
            <AudioLines className="assets-cover-wave-glyph" />
        </div>
    );
}

function TextCover({ asset }: { asset: LibraryAsset & { kind: "text" } }) {
    return (
        <div className="assets-cover-text">
            <p>{asset.data.content || "Blank text material"}</p>
        </div>
    );
}

function ModelCover({ asset }: { asset: LibraryAsset & { kind: "model" } }) {
    return (
        <div className="assets-cover-model">
            <Box />
            <span>{asset.data.fileName}</span>
        </div>
    );
}

function AssetsBatchBar({
    count,
    allSelected,
    onSelectAll,
    onClear,
    onExport,
    onDelete,
    folderOptions,
    onMoveToFolder,
}: {
    count: number;
    allSelected: boolean;
    onSelectAll: () => void;
    onClear: () => void;
    onExport: () => void;
    onDelete: () => void;
    folderOptions: Array<{ label: string; value: string }>;
    onMoveToFolder: (folderId: string) => void;
}) {
    return (
        <div className="assets-batch-bar" role="toolbar" aria-label="Batch operation">
            <span className="assets-batch-count">
                                Selected<strong>{count}</strong>  materials
            </span>
            <div className="assets-batch-actions">
                <Button size="small" icon={<CheckCheck className="size-3.5" />} disabled={allSelected} onClick={onSelectAll}>
                                        Select all
                </Button>
                <Button size="small" onClick={onClear}>
                                        Deselect
                </Button>
                <Button size="small" icon={<Download className="size-3.5" />} onClick={onExport}>
                                        Export</Button>
                <Dropdown
                    trigger={["click"]}
                    menu={{ items: folderOptions.map((folder) => ({ key: folder.value || "uncategorized", label: folder.label, onClick: () => onMoveToFolder(folder.value) })) }}
                >
                    <Button size="small" icon={<FolderOpen className="size-3.5" />}>Move to folder</Button>
                </Dropdown>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                                        Delete permanently
                </Button>
            </div>
        </div>
    );
}

function GenerationHistorySurface({
    assets, generatedTotal, generatedKindCounts, libraryTotal, kind, hasMore = false, loadingMore = false, loadMoreError = false, onKindChange, onLoadMore, onSelectPersonal, onSaveToLibrary, onDownload, onDelete,
}: {
    assets: LibraryAsset[]; generatedTotal: number; generatedKindCounts: Record<string, number>; libraryTotal: number; kind?: GenerationHistoryKind; hasMore?: boolean; loadingMore?: boolean; loadMoreError?: boolean;
    onKindChange?: (kind: GenerationHistoryKind) => void; onLoadMore?: () => void; onSelectPersonal: () => void; onSaveToLibrary: (asset: LibraryAsset) => Promise<void> | void; onDownload: (asset: LibraryAsset) => void; onDelete: (asset: LibraryAsset) => Promise<boolean | undefined>;
}) {
    const [localKind, setLocalKind] = useState<GenerationHistoryKind>("all");
    const [sortDescending, setSortDescending] = useState(true);
    const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);
    const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
    const [pendingDelete, setPendingDelete] = useState<LibraryAsset[]>([]);
    const [deleting, setDeleting] = useState(false);
    const deleteInFlight = useRef(false);
    const confirmHistoryDelete = async () => {
        if (deleteInFlight.current || !pendingDelete.length) return;
        deleteInFlight.current = true;
        setDeleting(true);
        try {
            for (const asset of pendingDelete) {
                if (!await onDelete(asset)) continue;
                setPendingDelete((current) => current.filter((item) => item.id !== asset.id));
                setSelectedHistoryIds((current) => {
                    const next = new Set(current);
                    next.delete(asset.id);
                    return next;
                });
                setPreviewAsset((current) => current?.id === asset.id ? null : current);
            }
        } finally {
            deleteInFlight.current = false;
            setDeleting(false);
        }
    };
    const activeType = kind ?? localKind;
    const setActiveType = onKindChange ?? setLocalKind;
    const historyAssets = assets
        .filter(isWorkspaceGeneratedHistoryAsset)
        .sort((left, right) => {
            const delta = new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
            return sortDescending ? -delta : delta;
        });
    const counts = {
        all: generatedTotal,
        image: generatedKindCounts.image || 0,
        video: generatedKindCounts.video || 0,
        audio: generatedKindCounts.audio || 0,
    };
    const typeTabs: Array<[GenerationHistoryKind, string, number]> = [["all", "All", counts.all], ["image", "pictures", counts.image], ["video", "video", counts.video], ["audio", "Audio", counts.audio]];
    const typeFilteredHistory = kind != null ? historyAssets : (activeType === "all" ? historyAssets : historyAssets.filter((asset) => asset.kind === activeType));
    const visibleHistoryAssets = typeFilteredHistory;
    const visibleGroups = [...new Set(visibleHistoryAssets.map((asset) => historyDay(asset.updatedAt)))];
    const selectedHistoryAssets = visibleHistoryAssets.filter((asset) => selectedHistoryIds.has(asset.id));
    const toggleHistorySelection = (assetId: string) => setSelectedHistoryIds((current) => {
        const next = new Set(current);
        if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
        return next;
    });
    const clearHistorySelection = () => setSelectedHistoryIds(new Set());
    return (
        <>
        <WorkspacePage grid className="library-page assets-library-page canvas-library-page generation-history-page">
            <div className="studio-band assets-library-hero">
                <PageHeader
                    title="Build history"
                    actions={
                        <div className="assets-header-actions">
                            <button type="button" className="assets-header-compact-button" aria-label={sortDescending ? "in reverse chronological order" : "in chronological order"} title={sortDescending ? "Latest first" : "earliest first"} onClick={() => setSortDescending((value) => !value)}><ArrowDownUp className="size-4" /></button>
                        </div>
                    }
                />
                <div className="generation-history-type-tabs" role="tablist" aria-label="Generate type">
                    {typeTabs.map(([value, label, count]) => (
                        <button key={value} type="button" className={cn("generation-history-type-tab", activeType === value && "is-active")} role="tab" aria-selected={activeType === value} onClick={() => setActiveType(value)}>
                            <span>{label}</span><strong>{count}</strong>
                        </button>
                    ))}
                </div>
            </div>
            <div className="generation-history-content">
                {selectedHistoryAssets.length ? <div className="generation-history-batch-bar" role="toolbar" aria-label="Generate historical batch operations">
                    <span>Selected{selectedHistoryAssets.length}  item</span>
                    <button type="button" onClick={() => selectedHistoryAssets.forEach((asset) => void onSaveToLibrary(asset))}><FolderPlus className="size-3.5" />Save to asset library</button>
                    <button type="button" onClick={() => selectedHistoryAssets.forEach(onDownload)}><Download className="size-3.5" />Download</button>
                    <button type="button" className="is-danger" onClick={() => setPendingDelete(selectedHistoryAssets)}><Trash2 className="size-3.5" />Delete permanently</button>
                    <button type="button" className="is-clear" onClick={clearHistorySelection}>Deselect</button>
                </div> : null}
                {visibleGroups.length ? visibleGroups.map((date) => (
                    <section key={date} className="generation-history-group">
                        <h2>{date}</h2>
                        <div className="generation-history-grid">
                            {visibleHistoryAssets.filter((asset) => historyDay(asset.updatedAt) === date).map((asset) => {
                                const savedToLibrary = isWorkspacePersonalLibraryAsset(asset);
                                return (
                                <article key={asset.id} data-onboarding-task-id={asset.metadata?.taskId} className="generation-history-card" title={asset.title} aria-label={`View the generated results:${asset.title}`} role="button" tabIndex={0} onClick={() => setPreviewAsset(asset)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPreviewAsset(asset); } }}>
                                    <div className="generation-history-thumb">
                                        <AssetMediaPreview asset={asset} alt={asset.title} className="size-full object-cover" hoverPlayDelayMs={100} fallback={<GenerationHistoryMissingPreview asset={asset} />} />
                                        <span className="generation-history-badge">AI generated</span>
                                        {asset.kind === "video" || asset.kind === "audio" ? <span className={cn("generation-history-duration", asset.kind === "video" && "is-video-duration")}>{formatAssetClock(asset.data.durationMs)}</span> : null}
                                        <button type="button" className={cn("generation-history-select", selectedHistoryIds.has(asset.id) && "is-selected")} aria-label={`Select${asset.title}`} aria-pressed={selectedHistoryIds.has(asset.id)} onClick={(event) => { event.stopPropagation(); toggleHistorySelection(asset.id); }}>{selectedHistoryIds.has(asset.id) ? <Check className="size-4" /> : null}</button>
                                        <div className="generation-history-hover-actions" aria-label="Generate result operation">
                                            <button type="button" disabled={savedToLibrary} aria-label={`${savedToLibrary ? "Saved asset library" : "Save to asset library"} ${asset.title}`} title={savedToLibrary ? "Saved asset library" : "Save to asset library"} onClick={(event) => { event.stopPropagation(); void onSaveToLibrary(asset); }}>{savedToLibrary ? <Check className="size-4" /> : <FolderPlus className="size-4" />}<span className="sr-only">{savedToLibrary ? "Saved asset library" : "Save to asset library"}</span></button>
                                            <button type="button" aria-label={`Download${asset.title}`} title="Download" onClick={(event) => { event.stopPropagation(); onDownload(asset); }}><Download className="size-4" /></button>
                                            <button type="button" aria-label={`Delete permanently${asset.title}`} title="Delete permanently" onClick={(event) => { event.stopPropagation(); setPendingDelete([asset]); }}><Trash2 className="size-4" /></button>
                                        </div>
                                    </div>
                                    <div className="generation-history-card-meta"><strong>{asset.title}</strong><span>{asset.kind === "video" ? "video" : asset.kind === "audio" ? "Audio" : "pictures"}  · Local</span></div>
                                </article>
                                );
                            })}
                        </div>
                    </section>
                )) : <WorkspaceState icon="assets" compact title={historyAssets.length ? "No matching build results" : "No generation history yet"} description={historyAssets.length ? "Switch types and try again." : "Locally generated results will automatically appear here."} />}
                {visibleGroups.length ? (
                    hasMore ? (
                        <div className="generation-history-more">
                            <button type="button" onClick={onLoadMore} disabled={loadingMore || !onLoadMore}>
                                {loadingMore ? "Loading" : loadMoreError ? "Loading failed, click to try again" : "load more"}
                            </button>
                        </div>
                    ) : (
                        <p className="generation-history-end">no more</p>
                    )
                ) : null}
            </div>
            <aside className="assets-library-source-rail" aria-label="Asset Source Navigation">
                <div className="assets-library-source-rail-inner">
                    <button type="button" className="assets-library-source-rail-item is-active" aria-current="page">
                        <span className="assets-library-source-rail-icon"><History className="size-3.5" /></span>
                        <span>Build history</span><span className="assets-filter-count">{counts.all}</span>
                    </button>
                    <button type="button" className="assets-library-source-rail-item" onClick={onSelectPersonal}>
                        <span className="assets-library-source-rail-icon"><FolderOpen className="size-3.5" /></span>
                        <span>Personal asset library</span><span className="assets-filter-count">{libraryTotal}</span>
                    </button>
                </div>
            </aside>
        </WorkspacePage>
        <Modal
            className="library-modal library-confirm-modal"
            title="Permanently delete generated assets"
            open={pendingDelete.length > 0}
            onCancel={() => { if (!deleteInFlight.current) setPendingDelete([]); }}
            onOk={() => void confirmHistoryDelete()}
            confirmLoading={deleting}
            closable={!deleting}
            cancelButtonProps={{ disabled: deleting }}
            okButtonProps={{ danger: true }}
            okText="Delete permanently"
            cancelText="Cancel"
        >
            {pendingDelete.length === 1 ? `Delete "${pendingDelete[0].title}” will not be able to be restored.` : `Delete selected${pendingDelete.length} It will not be possible to restore the material after it is saved.`}Files still referenced by the canvas or task will be retained, and the remaining files will be cleaned up simultaneously.</Modal>
        <Drawer className="assets-generation-preview-drawer" open={Boolean(previewAsset)} title={previewAsset?.title || "Generate results preview"} onClose={() => setPreviewAsset(null)} size="default">
            {previewAsset ? <div className="generation-history-preview space-y-4"><AssetMediaPreview asset={previewAsset} alt={previewAsset.title} className="generation-history-preview-media" fallback={<GenerationHistoryMissingPreview asset={previewAsset} />} /><div className="generation-history-preview-meta"><strong>{previewAsset.title}</strong><span>{previewAsset.kind === "video" ? "video" : previewAsset.kind === "audio" ? "Audio" : "pictures"}  · Locally generated</span><span>Source:{previewAsset.source || "Generate tasks"}</span>{typeof previewAsset.metadata?.taskId === "string" ? <span>Task ID:{previewAsset.metadata.taskId}</span> : null}{typeof previewAsset.metadata?.generationEffectKey === "string" ? <span>Generate ID:{previewAsset.metadata.generationEffectKey}</span> : null}</div><AssetGenerationPromptSection asset={previewAsset} /></div> : null}
        </Drawer>
        </>
    );
}

function GenerationHistoryMissingPreview({ asset }: { asset: LibraryAsset }) {
    const kind = asset.kind === "video" ? "video" : asset.kind === "audio" ? "Audio" : "pictures";
    const taskId = typeof asset.metadata?.taskId === "string" ? asset.metadata.taskId : "Task record exists";
    return <div className="generation-history-missing-preview"><strong>generate{kind}Not available yet</strong><span>{taskId}</span><small>The original generated resource was not found or has expired</small></div>;
}

function AssetsEmptyState({ onImport }: { onImport: () => void }) {
    return (
        <div className="assets-empty assets-empty-workspace">
            <div className="assets-empty-copy">
                <span className="assets-empty-icon"><FileX2 /></span>
                <strong>There are currently no assets</strong>
            </div>
            <button type="button" className="assets-empty-primary" onClick={onImport}>
                <span>Upload assets</span>
            </button>
        </div>
    );
}

function AssetFilterGroup({
    title,
    options,
    value,
    counts,
    onChange,
    className = "",
}: {
    title: string;
    options: Array<{ label: string; value: string }>;
    value: string;
    counts: Map<string, number>;
    onChange: (value: string) => void;
    className?: string;
}) {
    return (
        <div className={`collection-filter-group ${className}`}>
            <span className="collection-filter-label">{title}</span>
            <div className="collection-filter-options">
                {options.map((option) => {
                    const active = value === option.value;
                    return (
                        <button key={option.value} type="button" aria-pressed={active} className={`assets-filter-item ${active ? "is-active" : ""}`} onClick={() => onChange(option.value)}>
                            <span className="assets-filter-item-label">{option.label}</span>
                            <span className="assets-filter-count">{counts.get(option.value) || 0}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function assetSearchText(asset: LibraryAsset) {
    return [asset.title, asset.source || "", asset.note || "", assetCategoryLabel(asset.category), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function readAssetViewMode(): "grid" | "list" {
    if (typeof window === "undefined") return "grid";
    return window.localStorage.getItem(ASSET_VIEW_MODE_KEY) === "list" ? "list" : "grid";
}

function assetCountMap<T extends { label: string; value: string }>(options: T[], remote: Record<string, number> | undefined, fallback: LibraryAsset[], valueOf: (asset: LibraryAsset) => string) {
    const result = new Map<string, number>();
    options.forEach((option) => {
        // 列表只展示 LibraryAsset（entity 角色卡被排除）；"全部"计数只能累加选项里声明的类型，
        // 否则远端 facets 里的 entity 会计入"全部"，出现计数 30 但列表为空的矛盾。
        if (remote) result.set(option.value, option.value === "all" ? options.reduce((sum, item) => item.value === "all" ? sum : sum + (remote[item.value] || 0), 0) : remote[option.value] || 0);
        else result.set(option.value, option.value === "all" ? fallback.length : fallback.filter((asset) => valueOf(asset) === option.value).length);
    });
    return result;
}

function formatAssetTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
}

function historyDay(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "unknown date" : date.toISOString().slice(0, 10);
}

function audioWaveBars(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const bars: number[] = [];
    for (let index = 0; index < 26; index += 1) {
        hash = (hash * 9301 + 49297) % 233280;
        const random = hash / 233280;
        const envelope = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.55 + 1.2));
        bars.push(Math.round((0.18 + 0.82 * random * envelope) * 100));
    }
    return bars;
}
