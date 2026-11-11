import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { getCanvasHydrationHealth,subscribeCanvasHydrationHealth } from "@/services/canvas-hydration-health";
import { useNavigate, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { App, Button, Dropdown, Input, Modal } from "antd";
import { Select } from "@/components/ui/base/select";
import { Download, FolderPlus, Image as ImageIcon, MoreHorizontal, Pencil, Plus, Trash2, Upload } from "lucide-react";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { ExpandableSearch } from "@/components/layout/expandable-search";
import { WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";

import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";
import { CanvasDeleteConfirmation } from "@/components/canvas/canvas-delete-confirmation";
import { RecycleBinDialog } from "@/components/canvas/recycle-bin-dialog";
import { LibraryCardShell } from "@/components/canvas/library-card-shell";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { canvasExportProgressLabel, exportCanvasProjectsByIds, type CanvasExportProgress } from "@/lib/canvas/canvas-export";
import { restoreCanvasArchive } from "@/lib/canvas/canvas-archive-restore";
import { createCanvasLibraryFolder, deleteCanvasLibraryFolder, hydrateCanvasLibraryFolders, persistCanvasFolderCover, renameCanvasLibraryFolder } from "@/lib/canvas/canvas-folder-storage";
import { isWailsNativeShell } from "@/services/desktop-media-save";
import { loadCanvasProjectForEditing, saveRemoteUserDataNow } from "@/services/local-workspace-sync";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";
import { beginLocalCanvasProject, deleteLocalCanvasProjects, hydrateLocalCanvasProjectsFromBackend, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { createWorkspaceCanvasProject } from "@/services/workspace-project-repository";
import { listWorkspaceCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/workspace-data";
import { useUserStore } from "@/stores/use-user-store";
import { listProjects } from "@/services/api/projects";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";
import { canvasIdsForWorkspaceProjects, canvasWorkspaceProjectId, listCanvasWorkspaceProjectCanvases, listCanvasWorkspaceProjectRoots, previewNodesForWorkspaceProject, resolveWorkspaceExportCanvasIds } from "@/lib/canvas/canvas-workspace-project";

const CanvasDeleteProjectsDialog = lazy(() => import("@/components/canvas/canvas-delete-projects-dialog").then((module) => ({ default: module.CanvasDeleteProjectsDialog })));

export default function CanvasPage() {
    const canvasHealth = useSyncExternalStore(subscribeCanvasHydrationHealth,getCanvasHydrationHealth);
    const { message } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState<"updated" | "name" | "nodes">("updated");
    const [projectFilter, setProjectFilter] = useState("all");
    const [folderFilter, setFolderFilter] = useState("all");
    const [folderDialogOpen, setFolderDialogOpen] = useState(false);
    const [folderName, setFolderName] = useState("");
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [loadedProjectCount, setLoadedProjectCount] = useState(50);
    const [creationError, setCreationError] = useState(false);
    const exportController = useRef<AbortController | null>(null);
    const [exportProgress, setExportProgress] = useState<CanvasExportProgress | null>(null);
    const [exportError, setExportError] = useState("");
    useEffect(() => () => exportController.current?.abort(), []);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const folders = useCanvasStore((state) => state.folders);
    const moveProjectsToFolder = useCanvasStore((state) => state.moveProjectsToFolder);
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    // The sync layer is the source of truth: it also recognizes the synthetic
    // local identity, which protects the library from stale session state after
    // a desktop reload or HMR cycle.
    // The default BeefTV build is local-only even when a stale/embedded browser
    // session still contains a logged-in user. Cloud project APIs are opt-in via
    // the explicit hosted build flag, never inferred from login state.
    const remoteMode = import.meta.env.VITE_CANVAS_LOCAL_MODE === "false" && Boolean(userId) && !isLocalWorkspaceMode();
    useEffect(() => {
        if (!hydrated || !isLocalWorkspaceMode()) return;
        void hydrateLocalCanvasProjectsFromBackend();
        void hydrateCanvasLibraryFolders().catch((error) => {
            message.error(error instanceof Error ? error.message : "Failed to read folder list");
        });
    }, [hydrated, message]);
    const [debouncedKeyword, setDebouncedKeyword] = useState("");
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    const libraryQuery = useInfiniteQuery({
        queryKey: ["canvas-library", userId, projectFilter, sort, debouncedKeyword],
        queryFn: ({ pageParam, signal }) => listWorkspaceCanvasProjectsPage({ page: pageParam, pageSize: 40, projectId: projectFilter, sort, query: debouncedKeyword, signal }),
        initialPageParam: 1,
        getNextPageParam: (last) => last.hasMore ? last.page + 1 : undefined,
        enabled: remoteMode && sessionHydrated,
    });
    const projects = useMemo<CanvasLibrarySummary[]>(() => remoteMode
        ? libraryQuery.data?.pages.flatMap((page) => page.projects) || []
        : listCanvasWorkspaceProjectRoots(localProjects).map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: previewNodesForWorkspaceProject(localProjects, canvasWorkspaceProjectId(project)) })), [libraryQuery.data, localProjects, remoteMode]);
    const totalProjects = remoteMode ? libraryQuery.data?.pages[0]?.total || 0 : projects.length;
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const deleteDialogOpen = useCanvasUiStore((state) => state.deleteProjectIds.length > 0);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const deleteSelectedProjects = () => {
        setDeleteIds(selectedCanvasIds);
    };
    const updateProject = useCanvasStore((state) => state.updateProject);
    const [historyOpen, setHistoryOpen] = useState(() => searchParams.get("history") === "all" || searchParams.get("history") === "deleted");
    const [associationOpen, setAssociationOpen] = useState(false);
    const [associationProjectId, setAssociationProjectId] = useState("");
    // 本地工作区的画布、文件夹与历史完全来自浏览器本地存储；项目关系查询只在远程工作区启用。
    const projectQuery = useQuery({ queryKey: ["projects", userId], queryFn: () => listProjects(), enabled: remoteMode && sessionHydrated });

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const handoffMode = mode === "handoff";
    const forwardedQuery = agentMode || handoffMode || searchParams.get("agent") === "1" ? `?${searchParams.toString()}` : "";
    const preloadProject = useCallback(() => {
        void loadCanvasProjectPage();
    }, []);
    const enterProject = useCallback(
        (id: string) => {
            preloadProject();
            navigate(`/canvas/${id}${forwardedQuery}`);
        },
        [forwardedQuery, navigate, preloadProject],
    );
    const createAndEnter = () => {
        setCreationError(false);
        const { id, saved } = beginLocalCanvasProject("Unnamed project");
        void saved.then(() => {
            // Only enter after the desktop repository has accepted the new canvas.
            if (searchParams.get("stay") !== "1") enterProject(id);
        }).catch((error) => {
            setCreationError(true);
            message.error(error instanceof Error ? error.message : "Failed to create project, please try again");
        });
    };
    const duplicateCanvasProject = useCallback(async (project: CanvasLibrarySummary) => {
        if (!remoteMode) {
            const sourceCanvases = listCanvasWorkspaceProjectCanvases(localProjects, project.id);
            let copiedWorkspaceProjectId: string | undefined;
            for (const [index, source] of sourceCanvases.entries()) {
                const copy = await createWorkspaceCanvasProject(index === 0 ? `${project.title || "Unnamed project"} copy` : source.title, source.projectId, {
                    nodes: source.nodes,
                    connections: source.connections,
                    chatSessions: source.chatSessions,
                    activeChatId: source.activeChatId,
                }, copiedWorkspaceProjectId);
                copiedWorkspaceProjectId ||= copy.id;
            }
            if (!copiedWorkspaceProjectId) throw new Error("Project does not exist");
            message.success(`Project copies have been created with a total of${sourceCanvases.length} canvas`);
            enterProject(copiedWorkspaceProjectId);
            return;
        }
        const source = await loadCanvasProjectForEditing(project.id);
        if (!source) throw new Error("Canvas does not exist");
        const copy = await createWorkspaceCanvasProject(`${source.title || project.title || "Unnamed project"} copy`, undefined, {
            nodes: source.nodes,
            connections: source.connections,
            chatSessions: source.chatSessions,
            activeChatId: source.activeChatId,
        });
        message.success("A copy of the project has been created");
        enterProject(copy.id);
    }, [enterProject, localProjects, message, remoteMode]);
    const filteredProjects = useMemo(() => {
        if (remoteMode) return projects;
        const query = keyword.trim().toLowerCase();
        // The root library represents uncategorized work alongside folder tiles.
        // Categorized projects must disappear from the root after being moved and
        // only reappear when their folder is opened.
        const scoped = projects.filter((project) => (projectFilter === "all" || (projectFilter === "independent" ? !project.projectId : project.projectId === projectFilter)) && (folderFilter === "all" ? !project.folderId : project.folderId === folderFilter));
        const values = query ? scoped.filter((project) => project.title.toLowerCase().includes(query)) : [...scoped];
        values.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title, "en-US") : sort === "nodes" ? b.nodeCount - a.nodeCount : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
        return values;
    }, [folderFilter, keyword, projectFilter, projects, remoteMode, sort]);
    const projectNames = useMemo(() => new Map((projectQuery.data?.projects || []).map(({ project }) => [project.id, project.name])), [projectQuery.data]);
    const visibleProjects = remoteMode ? filteredProjects : filteredProjects.slice(0, loadedProjectCount);
    const hasMore = remoteMode ? libraryQuery.hasNextPage : visibleProjects.length < filteredProjects.length;
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const selectedCanvasIds = remoteMode ? selectedIds : canvasIdsForWorkspaceProjects(localProjects, selectedIds);
    // Folder tiles belong to the root library only. Once a folder is opened,
    // the grid represents that folder's contents; rendering the active folder
    // tile again makes an empty folder look like it contains itself.
    const visibleFolders = folderFilter === "all" ? folders : [];
    const activeFolder = folderFilter === "all" ? undefined : folders.find((folder) => folder.id === folderFilter);
    const projectFilterItems = useMemo(() => [{ key: "all", label: "All canvases" }, { key: "independent", label: "free canvas" }, ...(projectQuery.data?.projects || []).map(({ project }) => ({ key: project.id, label: project.name }))], [projectQuery.data]);
    const saveFolderRename = () => {
        const nextName = folderName.trim() || "unnamed folder";
        const id = editingFolderId;
        setFolderName("");
        setEditingFolderId(null);
        setFolderDialogOpen(false);
        if (!id) return;
        void renameCanvasLibraryFolder(id, nextName).catch((error) => {
            message.error(error instanceof Error ? error.message : "The folder was not saved successfully");
        });
    };
    useEffect(() => {
        setLoadedProjectCount(50);
    }, [folderFilter, keyword, projectFilter, sort]);
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry?.isIntersecting) return;
                if (remoteMode) {
                    if (!libraryQuery.isFetchingNextPage && !libraryQuery.isFetchNextPageError) void libraryQuery.fetchNextPage();
                } else setLoadedProjectCount((count) => Math.min(count + 50, filteredProjects.length));
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [filteredProjects.length, visibleProjects.length, hasMore, remoteMode, libraryQuery.fetchNextPage, libraryQuery.isFetchingNextPage, libraryQuery.isFetchNextPageError]);
    const associateSelected = async (nextProjectId = associationProjectId) => {
        const projectId = nextProjectId || undefined;
        try {
            for (const id of selectedIds) await loadCanvasProjectForEditing(id);
            selectedIds.forEach((id) => updateProject(id, { projectId }));
            if (remoteMode) await saveRemoteUserDataNow();
            message.success(projectId ? "Already joined the project" : "Project moved out, canvas remains");
            setAssociationOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? `Canvas relationship save failed:${error.message}` : "Canvas relationship save failed");
        }
    };
    const exportCanvasByIds = async (canvasIds: readonly string[], archiveTitle?: string) => {
        if (exportController.current || !canvasIds.length) return;
        const controller = new AbortController();
        exportController.current = controller;
        setExportError("");
        setExportProgress({ phase: "loading" });
        try {
            let skippedCount = 0;
            const saved = await exportCanvasProjectsByIds(
                canvasIds,
                (id) => loadCanvasProjectForEditing(id),
                {
                    archiveTitle: archiveTitle || `${brandName}Canvas-${canvasIds.length}canvas`,
                    folders,
                    allowMissingMedia: true,
                    signal: controller.signal,
                    onProgress: setExportProgress,
                    onSkipped: (count) => { skippedCount = count; },
                },
            );
            if (saved !== "cancelled") {
                if (skippedCount > 0) message.warning(`Backup has been exported and automatically skipped${skippedCount} missing or unreadable assets`);
                else if (saved === "saved" && isWailsNativeShell()) message.success("Saved to selected location");
            }
        } catch (error) {
            if (controller.signal.aborted) {
                recordDiagnosticEvent({ category: "action", level: "info", code: "canvas_export_cancelled", message: "Canvas export canceled" });
            } else {
                setExportError(error instanceof Error ? error.message : "Export failed, please try again");
                recordDiagnosticEvent({ category: "action", level: "error", code: "canvas_export_failed", message: "Canvas export failed" });
            }
        } finally {
            exportController.current = null;
            setExportProgress(null);
        }
    };
    const exportSelected = () => exportCanvasByIds(remoteMode ? selectedIds : resolveWorkspaceExportCanvasIds(localProjects, selectedIds));
    const exportWorkspaceProject = (project: CanvasLibrarySummary) => {
        const ids = remoteMode ? [project.id] : resolveWorkspaceExportCanvasIds(localProjects, [project.id]);
        return exportCanvasByIds(ids, `${project.title || brandName}-${ids.length}canvas`);
    };
    const exportFolderProjects = (folder: { id: string; name: string }) => {
        const folderProjectIds = projects.filter((project) => project.folderId === folder.id).map((project) => project.id);
        const ids = remoteMode ? folderProjectIds : resolveWorkspaceExportCanvasIds(localProjects, folderProjectIds);
        if (!ids.length) {
            message.info("There are currently no exported items in the current folder.");
            return Promise.resolve();
        }
        return exportCanvasByIds(ids, `${folder.name}-${ids.length}canvas`);
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        const hideLoading = message.loading({ content: "Unzipping and preparing to import canvas...", duration: 0 });
        try {
            const result = await restoreCanvasArchive(file, {
                onProjectProgress: (projectId, progress) => {
                    useSyncProgressStore.getState().setProjectProgress(projectId, progress);
                },
            });
            hideLoading();
            message.success(result.storage === "backend"
                ? `Imported${result.count} canvas`
                : `Imported${result.count} canvas and save it locally`);
        } catch (error) {
            hideLoading();
            console.error("Failed to import canvas", error);
            message.error(error instanceof Error ? `Import failed:${error.message}` : "Import failed, please select a valid canvas compressed package");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        // Local desktop canvases do not depend on a browser login session. Waiting
        // for session hydration here can leave /canvas?mode=new on the opening
        // screen forever after an app restart, even though the local store is
        // already ready. Hosted mode still waits for both session and library.
        if (!hydrated || (remoteMode && (!sessionHydrated || !libraryQuery.isSuccess)) || autoOpenRef.current || (mode !== "new" && mode !== "recent" && mode !== "handoff")) return;
        // A new local canvas can be created while older projects are still
        // hydrating. Waiting for every historical canvas leaves this route on
        // the loading screen when one large project or cache write is slow.
        if (!remoteMode && mode !== "new" && (canvasHealth.loading || canvasHealth.error)) return;
        autoOpenRef.current = true;
        if (mode === "recent" && projects[0]?.id) {
            enterProject(projects[0].id);
            return;
        }
        const { id, saved } = beginLocalCanvasProject("Unnamed project");
        void saved.then(() => enterProject(id)).catch((error) => {
            setCreationError(true);
            message.error(error instanceof Error ? error.message : "Failed to create project, please try again");
        });
    }, [hydrated, message, mode, projects, remoteMode, sessionHydrated, libraryQuery.isSuccess,canvasHealth]);

    if (!creationError && !libraryQuery.isError && !(canvasHealth.error && !remoteMode) && (mode === "new" || mode === "recent" || mode === "handoff")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">Opening canvas...</main>;

    return (
        <WorkspacePage className="studio-collection-page lib-tv-project-page">
            <PageHeader
                title={activeFolder?.name || "All projects"}
                leading={activeFolder ? <button type="button" className="libtv-project-breadcrumb-button" onClick={() => setFolderFilter("all")}>All projects /</button> : undefined}
                actions={(
                    <div className="libtv-project-actions">
                    <ExpandableSearch value={keyword} placeholder="Search items" onChange={setKeyword} />
                    <Button icon={<Upload />} disabled={!hydrated} onClick={() => inputRef.current?.click()}>Import canvas</Button>
                    <Button icon={<Trash2 />} onClick={() => setHistoryOpen(true)}>recycle bin</Button>
                    <Button icon={<FolderPlus />} disabled={!hydrated} onClick={() => {
                        void createCanvasLibraryFolder("unnamed folder").catch((error) => {
                            message.error(error instanceof Error ? error.message : "The folder was not saved successfully");
                        });
                    }}>Create new folder</Button>
                    </div>
                )}
            />

            <div className="collection-content">
                {selectedIds.length || exportProgress ? (
                    <div className="collection-selection-bar">
                        <strong className="mr-auto font-medium">{exportProgress ? "Exporting canvas" : `Selected${selectedIds.length} items`}</strong>
                        {remoteMode ? <>
                            <Button
                                size="small"
                                disabled={!hydrated || projectQuery.isLoading}
                                onClick={() => {
                                    setAssociationProjectId(selectedProjects[0]?.projectId || "");
                                    setAssociationOpen(true);
                                }}
                            >
                                                                Join the project
                            </Button>
                            {selectedProjects.some((project) => project.projectId) ? (
                                <Button
                                    size="small"
                                    disabled={!hydrated}
                                    onClick={() => {
                                        setAssociationProjectId("");
                                        void associateSelected("");
                                    }}
                                >
                                    Move items out
                                </Button>
                            ) : null}
                        </> : null}
                        <Button size="small" aria-label="Export" disabled={!hydrated} loading={Boolean(exportProgress)} icon={<Download className="size-3.5" />} onClick={() => void exportSelected()}>
                                                        Export
                        </Button>
                        {exportProgress ? <>
                            <span className="text-sm text-foreground/65" role="status" aria-live="polite">{canvasExportProgressLabel(exportProgress)}</span>
                            <Button size="small" disabled={exportProgress.phase === "saving"} onClick={() => exportController.current?.abort()}>Cancel export</Button>
                        </> : null}
                        <Button size="small" danger disabled={!hydrated || Boolean(exportProgress)} onClick={deleteSelectedProjects}>
                                                        Delete
                        </Button>
                    </div>
                ) : null}

                {exportError ? <p role="alert" className="mb-4 whitespace-pre-wrap break-words text-sm text-destructive">{exportError}</p> : null}

                {!remoteMode && canvasHealth.error ? <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm"><span>{canvasHealth.error}</span><Button loading={canvasHealth.loading} onClick={()=>void hydrateLocalCanvasProjectsFromBackend()}>Retry loading</Button></div> : null}
                {remoteMode && libraryQuery.isError ? (
                    <div role="alert">Canvas list read failed<Button onClick={() => void libraryQuery.refetch()}>Try again</Button></div>
                ) : !hydrated || (remoteMode && libraryQuery.isPending) ? (
                    <WorkspaceLoadingState label="Restoring canvas" detail="Read local cache and account synchronization status" />
                ) : visibleProjects.length || (!keyword && projectFilter === "all") ? (
                    <CollectionGrid className="canvas-collection-grid">
                        <div className="libtv-create-project-entry">
                            <article className="libtv-create-project-card" role="button" tabIndex={0} onClick={createAndEnter} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); createAndEnter(); } }}>
                                <div className="libtv-create-project-icon"><Plus /></div>
                                <strong>Start creating</strong>
                            </article>
                            <p className="libtv-create-project-subtitle">Create a new video project</p>
                        </div>
                        {visibleFolders.map((folder) => <CanvasLibraryFolderTile key={folder.id} folder={folder} onOpen={() => setFolderFilter(folder.id)} onRename={() => { setFolderName(folder.name); setEditingFolderId(folder.id); setFolderDialogOpen(true); } } onExport={() => void exportFolderProjects(folder)} onDelete={() => setDeletingFolder({ id: folder.id, name: folder.name })} onCoverChange={(dataUrl) => {
                            void persistCanvasFolderCover(folder.id, dataUrl).then(() => {
                                message.success("Folder cover has been updated");
                            }).catch((error) => {
                                message.error(error instanceof Error ? error.message : "The cover was not saved successfully");
                            });
                        }} />)}
                        {visibleProjects.map((project) => (
                            <CanvasFolderCard
                                key={project.id}
                                project={project}
                                projectName={project.projectId ? projectNames.get(project.projectId) || "Projects not synced" : undefined}
                                folders={folders}
                                onMoveToFolder={async (folderId) => {
                                    try {
                                        // Keep the menu action transactional: validate the selected
                                        // folder, update the local store, then verify the in-memory
                                        // relation before reporting success. This prevents a stale
                                        // menu/list state from making a failed move look successful.
                                        if (folderId && !folders.some((folder) => folder.id === folderId)) {
                                            throw new Error("The target folder does not exist");
                                        }
                                        const projectCanvasIds = canvasIdsForWorkspaceProjects(localProjects, [project.id]);
                                        moveProjectsToFolder(projectCanvasIds, folderId);
                                        await flushCanvasStorePersistence();
                                        const movedProject = useCanvasStore.getState().projects.find((item) => item.id === project.id);
                                        if (!movedProject || (movedProject.folderId || undefined) !== (folderId || undefined)) {
                                            throw new Error("The project move is not completed, please try again");
                                        }
                                        if (!usesBrowserLocalResourceStore()) {
                                            await Promise.all(projectCanvasIds.map((id) => syncLocalCanvasProjectToBackend(id)));
                                        }
                                        message.success(folderId ? "Moved to folder" : "Moved out of folder");
                                    } catch (error) {
                                        message.error(error instanceof Error ? error.message : "Move project failed");
                                    }
                                }}
                                onDuplicate={() => duplicateCanvasProject(project)}
                                onExport={() => exportWorkspaceProject(project)}
                                onDelete={() => {
                                    setDeleteIds([project.id]);
                                }}
                                onClick={() => enterProject(project.id)}
                                onPrefetch={preloadProject}
                            />
                        ))}
                    </CollectionGrid>
                ) : (
                    <WorkspaceState icon="canvas" title={canvasHealth.error ? "The project cannot be loaded temporarily" : keyword || projectFilter !== "all" || folderFilter !== "all" ? "No matching items" : "Let the first idea hit the canvas"} description={canvasHealth.error || (keyword || projectFilter !== "all" || folderFilter !== "all" ? "Change the name or reset the filters." : "Pictures, storyboards and inspirations can all be freely organized here.")} action={canvasHealth.error ? <Button loading={canvasHealth.loading} onClick={()=>void hydrateLocalCanvasProjectsFromBackend()}>Retry loading</Button> : !keyword && projectFilter === "all" && folderFilter === "all" ? <Button type="primary" icon={<Plus />} disabled={!hydrated} onClick={createAndEnter}>New project</Button> : undefined} />
                )}
                {hydrated && visibleProjects.length && (hasMore || libraryQuery.isFetchNextPageError) ? (
                    <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                        {libraryQuery.isFetchNextPageError ? <Button onClick={() => void libraryQuery.fetchNextPage()}>Loading failed, try again</Button> : hasMore ? "Keep scrolling to load more" : `All loaded${filteredProjects.length} canvas`}
                    </div>
                ) : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <Modal
                className="libtv-folder-dialog"
                wrapClassName="libtv-folder-dialog-wrap"
                title="Rename folder"
                open={folderDialogOpen}
                okText="Save"
                okButtonProps={{ type: "default" }}
                cancelText="Cancel"
                onCancel={() => { setFolderDialogOpen(false); setEditingFolderId(null); setFolderName(""); }}
                onOk={saveFolderRename}
            >
                <Input autoFocus value={folderName} placeholder="Example: short film project" onChange={(event) => setFolderName(event.target.value)} onPressEnter={saveFolderRename} />
            </Modal>
            <Modal
                title="Join the project"
                open={associationOpen}
                okText="Save association"
                cancelText="Cancel"
                okButtonProps={{ disabled: !associationProjectId, loading: projectQuery.isFetching }}
                onCancel={() => setAssociationOpen(false)}
                onOk={() => void associateSelected()}
            >
                <p className="mb-3 text-sm text-foreground/60">The selected canvas will retain the original nodes and local media, and only add project associations.</p>
                <Select
                    className="w-full"
                    value={associationProjectId || undefined}
                    placeholder="Select item"
                    options={(projectQuery.data?.projects || []).map((item) => ({ label: item.project.name, value: item.project.id }))}
                    onChange={setAssociationProjectId}
                />
            </Modal>
            <RecycleBinDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
            {deletingFolder ? <CanvasDeleteConfirmation title={`Delete folder "${deletingFolder.name}」？`}
                description={`This folder and the${localProjects.filter((project) => project.folderId === deletingFolder.id).length} canvas, the nodes and connections in the canvas will also be removed.`}
                onCancel={() => setDeletingFolder(null)} onConfirm={async () => {
                    const folderId = deletingFolder.id;
                    const ids = useCanvasStore.getState().projects.filter((project) => project.folderId === folderId).map((project) => project.id);
                    if (ids.length) await deleteLocalCanvasProjects(ids);
                    await deleteCanvasLibraryFolder(folderId);
                    message.success(ids.length ? `Deleted folders and the${ids.length} canvas` : "Folder deleted");
                }} /> : null}
            {deleteDialogOpen ? <Suspense fallback={null}><CanvasDeleteProjectsDialog /></Suspense> : null}
        </WorkspacePage>
    );
}

function CanvasLibraryFolderTile({ folder, onOpen, onRename, onExport, onDelete, onCoverChange }: { folder: { id: string; name: string; updatedAt: string; coverDataUrl?: string; unsaved?: boolean; saveError?: string }; onOpen: () => void; onRename: () => void; onExport: () => void; onDelete: () => void; onCoverChange: (dataUrl: string) => void }) {
    const { message } = App.useApp();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const chooseCover = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { message.error("Please select an image file for cover"); return; }
        if (file.size > 12 * 1024 * 1024) { message.error("Cover image cannot exceed 12MB"); return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== "string") return;
            const image = new Image();
            image.onload = () => {
                const maxSize = 1280;
                const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
                onCoverChange(canvas.toDataURL("image/jpeg", 0.84));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
        event.target.value = "";
    };
    return (
        <LibraryCardShell
            ariaLabel={`open folder${folder.name}`}
            className="libtv-folder-card"
            updatedAt={folder.updatedAt}
            onOpen={onOpen}
            title={folder.saveError ? `${folder.name} · Save failed` : folder.unsaved ? `${folder.name} · Not saved` : folder.name}
            cover={<div className={cn("libtv-folder-cover-art", folder.coverDataUrl && "has-custom-cover")} style={folder.coverDataUrl ? { backgroundImage: `url(${folder.coverDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} />}
            actions={<>
                <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                overlayClassName="project-library-menu folder-library-menu"
                menu={{
                    onClick: ({ domEvent }) => domEvent.stopPropagation(),
                    items: [
                        { key: "open", label: "Open", onClick: onOpen },
                        { key: "rename", label: "Rename", onClick: onRename },
                        { key: "cover", label: "Change cover", onClick: () => coverInputRef.current?.click() },
                        { key: "export", label: "Export folder", onClick: onExport },
                        { type: "divider" },
                        { key: "delete", danger: true, label: "delete folder", onClick: onDelete },
                    ],
                }}
                >
                    <button type="button" className="product-icon-button libtv-folder-card-more" aria-label={`${folder.name} Folder operations`} title="More actions" onClick={(event) => event.stopPropagation()}><MoreHorizontal /></button>
                </Dropdown>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={chooseCover} />
            </>}
        />
    );
}
