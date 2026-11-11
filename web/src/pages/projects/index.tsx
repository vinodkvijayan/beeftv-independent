import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Form, Input, Modal, Select } from "antd";
import { ArrowRight, Archive, BookOpenText, FileText, FolderKanban, Images, LayoutGrid, MoreHorizontal, Palette, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { CanvasStylePickerModal, resolveCanvasStylePreset, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { resourceFileUrl } from "@/services/api/resources";
import { ModelPicker } from "@/components/model-picker";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { settingsPath } from "@/lib/settings-navigation";
import { PromptTemplateOperation, parseGeneratedStory, promptTemplateTaskPlaceholder, shortDramaOutlineVariables } from "@/lib/prompts";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { createProject, deleteProject, duplicateProject, importProjectUnits, listProjectFolders, listProjects, moveProjectToFolder, updateProject, type ProjectSummary } from "@/services/api/projects";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

import { sourceTypeLabel } from "./detail/shared";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ProjectsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const [createForm] = Form.useForm<ProjectForm>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [storyDraft, setStoryDraft] = useState("");
    const [createSource, setCreateSource] = useState<"blank" | "novel" | "text">("blank");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [generateModel, setGenerateModel] = useState("");
    const [generateChapterCount, setGenerateChapterCount] = useState("5");
    const [generateStructure, setGenerateStructure] = useState("Single line advancement");
    const [generateChapterLength, setGenerateChapterLength] = useState("Medium");
    const [generateWordCount, setGenerateWordCount] = useState("800");
    const [generatePerspective, setGeneratePerspective] = useState("third person");
    const [generateTone, setGenerateTone] = useState("Smooth narrative");
    const [generateCharacterScale, setGenerateCharacterScale] = useState("3-4 pcs");
    const [generating, setGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState("");
    const [generationPreview, setGenerationPreview] = useState("");
    const [renamingProject, setRenamingProject] = useState<ProjectSummary["project"] | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const foldersQuery = useQuery({ queryKey: ["project-folders"], queryFn: listProjectFolders });
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    const openCreate = (source: "blank" | "novel" | "text") => {
        setCreateSource(source);
        setCreateOpen(true);
    };
    useEffect(() => {
        if (!createOpen) return;
        createForm.setFieldsValue({
            name: storyDraft.trim().slice(0, 24) || "",
            sourceType: createSource,
            aspectRatio: "9:16",
        });
    }, [createForm, createOpen, createSource, storyDraft]);

    const generateStory = async () => {
        const story = storyDraft.trim();
        if (!story || generating) return;
        const textModel = generateModel || effectiveConfig.textModel;
        if (!textModel || !effectiveConfig.textModels.includes(textModel)) {
            if (!textModel) {
                modal.warning({
                    title: "You need to select the text model first",
                    content: "Please select a configured text model in the \"AI Model\" above, or go to the settings to complete the model channel configuration first.",
                    okText: "Go to settings",
                    cancelText: "Cancel",
                    onOk: () => navigate(settingsPath("models")),
                });
            } else {
                message.error(`model${textModel} Not in the text model list, please select again`);
            }
            return;
        }
        setGenerating(true);
        setGenerationStatus("Creating project…");
        setGenerationPreview("");
        try {
            const project = await createUniqueProjectName(story, selectedStyle);
            setGenerationStatus("AI is generating synopsis and chapters...");
            const result = await runBackendGenerationTask({
                projectId: project.project.id,
                mode: "text",
                prompt: promptTemplateTaskPlaceholder("Short play outline"),
                config: { ...effectiveConfig, model: textModel, imageModel: textModel, videoModel: textModel, textModel },
                metadata: {
                    source: "project-story-generator",
                    projectId: project.project.id,
                    promptTemplateOperation: PromptTemplateOperation.ShortDramaOutline,
                    promptTemplateVariables: shortDramaOutlineVariables({
                        story,
                        chapterCount: generateChapterCount,
                        structure: generateStructure,
                        wordCount: generateWordCount,
                        perspective: generatePerspective,
                        tone: generateTone,
                        characterScale: generateCharacterScale,
                        chapterLength: generateChapterLength,
                    }),
                },
                onTextDelta: setGenerationPreview,
            });
            const answer = result.text || "";
            const parsed = parseGeneratedStory(answer);
            if (!parsed.chapters.length) throw new Error("AI did not return valid chapter content, please try again");
            setGenerationStatus(`Importing${parsed.chapters.length} Chapters…`);
            await importProjectUnits(project.project.id, parsed.chapters.map((chapter: { title: string; content: string }) => ({ kind: "chapter", title: chapter.title, sourceText: chapter.content })));
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.project.id}/overview`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI generation failed, please try again");
        } finally {
            setGenerating(false);
            setGenerationStatus("");
            setGenerationPreview("");
        }
    };
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const query = useInfiniteQuery({
        // 分页查询和画布页的全量项目查询不能共用缓存形状，否则两个页面会互相覆盖缓存数据。
        queryKey: ["projects", "paged"],
        queryFn: ({ pageParam }) => listProjects({ page: pageParam, pageSize: 50 }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.id}/overview`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Project creation failed"),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteProject,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("Project deleted");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Project deletion failed"),
    });
    const archiveMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: string }) => updateProject(id, { status }),
        onSuccess: (_, variables) => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success(variables.status === "archived" ? "Project archived" : "Project has been restored");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Project status update failed"),
    });
    const renameMutation = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) => updateProject(id, { name }),
        onSuccess: () => {
            setRenamingProject(null);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("Project has been renamed");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Project rename failed"),
    });
    const allProjects = useMemo(() => query.data?.pages.flatMap((page) => page.projects) || [], [query.data]);
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [...allProjects]
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(({ project }) => !normalizedKeyword || `${project.name} ${project.description} ${project.stylePresetId} ${parseStyleProfile(project.styleProfileJson)?.title || resolveCanvasStylePreset(project.stylePresetId)?.title || ""}`.toLowerCase().includes(normalizedKeyword))
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, "en-US");
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [allProjects, keyword, sort, status]);
    const totalProjectCount = query.data?.pages[0]?.total ?? allProjects.length;
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !query.hasNextPage || query.isError) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting && !query.isFetchingNextPage) void query.fetchNextPage();
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage]);
    const hasInitialError = query.isError && !query.data;
    return (
        <WorkspacePage className="library-page project-library-page" grid>
            <PageHeader title="Short drama workbench" description="Your stories, chapters and shots are all here." meta={<span className="app-projects-header-meta">{totalProjectCount}  items</span>} />
            <details className="story-launcher-panel" aria-label="Start a new short play">
                <summary className="story-launcher-head">
                    <div className="story-launcher-title">
                        <span className="story-launcher-mark"><Sparkles className="size-4" /></span>
                        <div>
                            <h2>Start a new short play</h2>
                            <p>Generate chapters from one sentence, you can also import novels or start from blank</p>
                        </div>
                    </div>
                    <span className="story-launcher-expand"><Plus className="size-4" /><span>Start creating</span></span>
                </summary>
                <div className="story-launcher-main">
                    <Input.TextArea
                        className="story-launcher-input"
                        value={storyDraft}
                        onChange={(event) => setStoryDraft(event.target.value)}
                        placeholder="For example: A courier with amnesia receives letters sent ten years ago every day..."
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        aria-label="one sentence story"
                    />
                    {selectedStyle ? <button type="button" className="story-launcher-style-chip" onClick={() => setStylePickerOpen(true)} title={selectedStyle.title}>
                        <img src={selectedStyle.imageUrl} alt="" />
                        <span>{selectedStyle.title}</span>
                    </button> : null}
                </div>
                    <div className="story-launcher-actions">
                        <Button icon={<FolderKanban />} onClick={() => openCreate("blank")}>Blank project</Button>
                        <Button icon={<FileText />} onClick={() => openCreate("novel")}>Import novels</Button>
                        <Button icon={<Palette />} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? "Change style" : "Choose style"}</Button>
                        <ModelPicker
                            config={effectiveConfig}
                            value={generateModel || effectiveConfig.textModel}
                            onChange={setGenerateModel}
                            capability="text"
                            variant="creation"
                            placeholder="Select text model"


                            popoverClassName="agent-model-picker-popover"
                        />
                        <Button type="default" icon={<Sparkles className="size-3.5" />} disabled={!storyDraft.trim() || generating} loading={generating} onClick={() => void generateStory()}>AI generated chapters</Button>
                        <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(createSource)}>Start creating</Button>
                    </div>
                <details className="story-launcher-options">
                    <summary>Story setting ·{generateChapterCount}  Chapter ·{generatePerspective} · {generateTone}</summary>
                <div className="story-launcher-controls">
                    <label><span>Number of chapters</span><Select size="small" className="min-w-28" value={generateChapterCount} onChange={setGenerateChapterCount} options={[{ label: "Chapter 3", value: "3" }, { label: "Chapter 5", value: "5" }, { label: "Chapter 8", value: "8" }, { label: "Chapter 10", value: "10" }]} /></label>
                    <label><span>narrative structure</span><Select size="small" className="min-w-32" value={generateStructure} onChange={setGenerateStructure} options={[{ label: "Single line advancement", value: "Single line advancement" }, { label: "Dual parallel", value: "Dual parallel" }, { label: "Group portrait with multiple lines", value: "Group portrait with multiple lines" }, { label: "Reverse nesting", value: "Reverse nesting" }]} /></label>
                    <label><span>Chapter length</span><Select size="small" className="min-w-28" value={generateChapterLength} onChange={setGenerateChapterLength} options={[{ label: "refine", value: "Short" }, { label: "equilibrium", value: "Medium" }, { label: "plump", value: "Long" }]} /></label>
                    <label><span>Number of words in a single chapter</span><Select size="small" className="min-w-28" value={generateWordCount} onChange={setGenerateWordCount} options={[{ label: "500 words", value: "500" }, { label: "800 words", value: "800" }, { label: "1200 words", value: "1200" }, { label: "2000 words", value: "2000" }]} /></label>
                    <label><span>narrative perspective</span><Select size="small" className="min-w-28" value={generatePerspective} onChange={setGeneratePerspective} options={[{ label: "third person", value: "third person" }, { label: "first person", value: "first person" }, { label: "multiple perspectives", value: "multiple perspectives" }]} /></label>
                    <label><span>Story tone</span><Select size="small" className="min-w-32" value={generateTone} onChange={setGenerateTone} options={[{ label: "Smooth narrative", value: "Smooth narrative" }, { label: "light comedy", value: "light comedy" }, { label: "Tension and suspense", value: "Tension and suspense" }, { label: "Passionate growth", value: "Passionate growth" }, { label: "Sweet pet cures", value: "Sweet pet cures" }]} /></label>
                    <label><span>role size</span><Select size="small" className="min-w-28" value={generateCharacterScale} onChange={setGenerateCharacterScale} options={[{ label: "2", value: "2" }, { label: "3-4 pcs", value: "3-4 pcs" }, { label: "5-6", value: "5-6" }]} /></label>
                </div>
                </details>
            </details>
            <CollectionToolbar active={Boolean(keyword || status !== "all" || sort !== "updated")} onReset={() => { setKeyword(""); setStatus("all"); setSort("updated"); }}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="Search for projects, profiles or styles" onChange={(event) => setKeyword(event.target.value)} />
                <Select className="w-32" value={status} onChange={setStatus} options={[{ label: "All status", value: "all" }, { label: "In progress", value: "active" }, { label: "Archived", value: "archived" }]} />
                <Select className="w-32" value={sort} onChange={setSort} options={[{ label: "Latest updates", value: "updated" }, { label: "Chapter progress", value: "progress" }, { label: "Project name", value: "name" }]} />
            </CollectionToolbar>

            {hasInitialError ? <WorkspaceErrorState description={query.error instanceof Error ? query.error.message : "Project list failed to load"} onRetry={() => void query.refetch()} /> : null}
            {query.isLoading ? <WorkspaceLoadingState label="Organizing projects" detail="Read chapter, canvas and asset progress" /> : null}
            {!query.isLoading && !hasInitialError && rows.length ? (
                <CollectionGrid className="library-grid project-library-grid">
                    {rows.map((row) => <ProjectRow key={row.project.id} row={row} folders={foldersQuery.data?.folders || []} onDelete={() => modal.confirm({ title: "Delete project?", content: `Project chapters, canvas associations and material attributions will be removed as well"${row.project.name}”, the original materials of the independent canvas and material library will be retained. This action cannot be undone.`, okText: "Delete project", cancelText: "Cancel", okButtonProps: { danger: true }, onOk: () => deleteMutation.mutateAsync(row.project.id) })} onRename={() => { setRenameValue(row.project.name); setRenamingProject(row.project); }} onArchive={() => archiveMutation.mutate({ id: row.project.id, status: row.project.status === "archived" ? "active" : "archived" })} onDuplicate={async () => { await duplicateProject(row.project.id); await queryClient.invalidateQueries({ queryKey: ["projects"] }); message.success("A copy of the project has been created"); }} onMove={async (folderId) => { await moveProjectToFolder(row.project.id, folderId); await queryClient.invalidateQueries({ queryKey: ["projects"] }); message.success(folderId ? "Project moved" : "Project has been moved out of folder"); }} />)}
                </CollectionGrid>
            ) : null}
            {!query.isLoading && !hasInitialError ? <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                {query.isFetchingNextPage ? "Loading more items…" : query.isError ? <button type="button" onClick={() => void query.fetchNextPage()}>Failed to load more, click to try again</button> : query.hasNextPage ? "Keep scrolling to load more (50 items per page)" : allProjects.length ? `All loaded${totalProjectCount} items` : null}
            </div> : null}
            {!query.isLoading && !rows.length && !hasInitialError && (keyword || status !== "all") ? (
                <WorkspaceState
                    icon="projects"
                    title={keyword || status !== "all" ? "No matching items" : "Create your first story project"}
                    description={keyword || status !== "all" ? "Adjust your search terms or status filters and try again." : "Projects will centrally save chapters, project canvases, character scenes, and production progress. Free drawings can start from the canvas."}
                    action={!keyword && status === "all" ? <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>Create project</Button> : undefined}
                />
            ) : null}

            <Modal className="library-modal" title="Create a skit project" open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={560} styles={{ body: { paddingTop: 12 } }}>
                <Form<ProjectForm> form={createForm} layout="vertical" initialValues={{ aspectRatio: "9:16", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "short-drama", ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}) })}>
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        <button type="button" className={createSource === "blank" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("blank"); createForm.setFieldValue("sourceType", "blank"); }}><FolderKanban className="size-4" /><span>blank start</span></button>
                        <button type="button" className={createSource === "novel" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("novel"); createForm.setFieldValue("sourceType", "novel"); }}><FileText className="size-4" /><span>Import novels</span></button>
                        <button type="button" className={createSource === "text" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("text"); createForm.setFieldValue("sourceType", "text"); }}><BookOpenText className="size-4" /><span>Paste text</span></button>
                    </div>
                    <Form.Item name="name" label="Project name" rules={[{ required: true, whitespace: true, message: "Please enter project name" }]}><Input autoFocus placeholder="For example: Chang'an Night Tour" /></Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label="Default frame"><Select options={[{ label: "9:16 vertical screen", value: "9:16" }, { label: "16:9 landscape", value: "16:9" }, { label: "1:1 square", value: "1:1" }]} /></Form.Item>
                        <Form.Item name="sourceType" label="Content source"><Select options={[{ label: "blank start", value: "blank" }, { label: "Import novels", value: "novel" }, { label: "Paste text", value: "text" }]} /></Form.Item>
                    </div>
                    <Form.Item label="Project style"><button type="button" className="app-story-modal-style" onClick={() => setStylePickerOpen(true)}>{selectedStyle ? <><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span><em>Replace</em></> : <><Palette className="size-4" /><span>Select project style (optional)</span></>}</button></Form.Item>
                    <p className="-mt-1 mb-5 text-xs leading-5 text-foreground/48">After creation, enter the project overview. Chapters, styles and reference assets can be added gradually.</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Create project</Button></div>
                </Form>
            </Modal>
            <Modal className="library-modal" title="Rename project" open={Boolean(renamingProject)} okText="Save" cancelText="Cancel" confirmLoading={renameMutation.isPending} onCancel={() => setRenamingProject(null)} onOk={() => { const name = renameValue.trim(); if (!renamingProject || !name) return; renameMutation.mutate({ id: renamingProject.id, name }); }}>
                <Input autoFocus value={renameValue} maxLength={80} placeholder="Please enter project name" onChange={(event) => setRenameValue(event.target.value)} onPressEnter={() => { const name = renameValue.trim(); if (renamingProject && name) renameMutation.mutate({ id: renamingProject.id, name }); }} />
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => { setSelectedStyle(preset); setStylePickerOpen(false); }}
            />
            <Modal className="library-modal" title="AI generated chapters" open={generating} footer={null} closable={false} mask={{ closable: false }} keyboard={false} width={760}>
                <div className="app-story-generating">
                    <div className="app-story-generating-head">
                        <span className="app-story-generating-mark"><Sparkles className="size-4" /></span>
                        <div className="min-w-0">
                            <p>AI is creating</p>
                            <span className="block text-[var(--fs-tiny)] text-foreground/45">Generating drama title, introduction and chapters</span>
                        </div>
                        {generateModel || effectiveConfig.textModel ? <span className="app-story-generating-model">{modelDisplayName(effectiveConfig, generateModel || effectiveConfig.textModel)}</span> : null}
                    </div>
                    <div className="app-story-generating-progress" aria-hidden="true" />
                    <div className="app-story-generating-grid">
                        <div className="app-story-generating-story">
                            <span className="app-story-generating-caption">story starting point</span>
                            <p>{storyDraft.trim() || "Waiting for story input"}</p>
                            <span className="app-story-generating-meta">{generateChapterCount}  Chapter · Approx. per chapter{generateWordCount}  word ·{generateStructure} · {generatePerspective}</span>
                            {selectedStyle ? <span className="app-story-generating-style"><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span></span> : null}
                        </div>
                        <ol className="app-story-generating-steps">
                            {generationSteps.map((step) => {
                                const state = generationStatus.startsWith(step.label) ? "is-active" : generationStepDone(step.label, generationStatus) ? "is-done" : "";
                                return <li key={step.label} className={state}><span className="app-story-generating-step-dot" /><span>{step.label}</span><em>{state === "is-active" ? "In progress" : state === "is-done" ? "Done" : "wait"}</em></li>;
                            })}
                        </ol>
                    </div>
                    <div className="app-story-generating-preview">
                        <div className="app-story-generating-preview-head"><span>live draft</span><span className="app-story-generating-live" /><em>{generationPreview ? "Outputting" : "Wait for model output"}</em></div>
                        <pre>{generationPreview}</pre>
                    </div>
                </div>
            </Modal>
        </WorkspacePage>
    );
}

async function createUniqueProjectName(story: string, selectedStyle: CanvasStylePreset | null) {
    const base = story.trim().slice(0, 24);
    const buildInput = (name: string) => ({
        name,
        type: "short-drama" as const,
        aspectRatio: "9:16",
        sourceType: "blank",
        description: story.trim(),
        ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}),
    });
    let attempt = 0;
    for (;;) {
        try {
            return await createProject(buildInput(attempt === 0 ? base : `${base}（${attempt + 1}）`));
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const uniqueConflict = message.includes("UNIQUE") || message.includes("projects.user_id") || message.includes("projects.name");
            if (!uniqueConflict || attempt >= 5) throw error;
            attempt += 1;
        }
    }
}

const generationSteps = [
    { label: "Creating project" },
    { label: "AI is generating synopsis and chapters" },
    { label: "Importing chapters" },
];

function generationStepDone(label: string, status: string) {
    if (label === "Creating project") return status.startsWith("AI is generating") || status.startsWith("Importing");
    if (label === "AI is generating synopsis and chapters") return status.startsWith("Importing");
    return false;
}

function ProjectRow({ row, folders, onDelete, onRename, onArchive, onDuplicate, onMove }: { row: ProjectSummary; folders: { id: string; name: string }[]; onDelete: () => void; onRename: () => void; onArchive: () => void; onDuplicate: () => Promise<void>; onMove: (folderId: string) => Promise<void> }) {
    const navigate = useNavigate();
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const projectStyle = resolveProjectCanvasStyle(row.project.stylePresetId, row.project.styleProfileJson);
    const styleTitle = projectStyle?.title || parseStyleProfile(row.project.styleProfileJson)?.title || resolveCanvasStylePreset(row.project.stylePresetId)?.title || (row.project.stylePresetId ? "Custom style" : "No style set");
    const coverUrl = row.project.coverResourceId ? resourceFileUrl(row.project.coverResourceId) : projectStyle?.imageUrl;
    return (
        <Link to={`/projects/${row.project.id}/overview`} className="product-collection-card library-card project-library-card group">
            <span className="project-library-cover">
                {coverUrl ? <CachedResourceImage className="project-library-cover-art" src={coverUrl} alt="" fallback={<MediaPlaceholder failed />} /> : <MediaPlaceholder label="The story begins here" />}
                <span className="project-library-cover-scrim" />
                <span className="project-library-cover-ratio">{row.project.aspectRatio}</span>
                <span className="project-library-cover-stage">{stage.label}</span>
                <span className="project-collection-delete" onClick={(event) => event.preventDefault()}><Dropdown trigger={["click"]} placement="bottomRight" overlayClassName="project-library-menu" menu={{ items: [{ key: "open", label: "Open", onClick: () => navigate(`/projects/${row.project.id}/overview`) }, { key: "rename", icon: <Pencil className="size-3.5" />, label: "Rename", onClick: onRename }, { key: "cover", label: "Modify cover", onClick: () => navigate(`/projects/${row.project.id}/settings`) }, { key: "duplicate", label: "Create a copy", onClick: () => void onDuplicate() }, { key: "move", label: "Move to folder", children: [{ key: "root", label: "All projects", onClick: () => void onMove("") }, ...folders.map((folder) => ({ key: folder.id, label: folder.name, onClick: () => void onMove(folder.id) }))] }, { key: "archive", icon: <Archive className="size-3.5" />, label: row.project.status === "archived" ? "restore items" : "Archive items", onClick: onArchive }, { type: "divider" }, { key: "delete", danger: true, label: "Delete project", onClick: onDelete }] }}><button type="button" className="project-library-more" aria-label={`${row.project.name} More actions`} onClick={(event) => event.preventDefault()}><MoreHorizontal className="size-4" /></button></Dropdown></span>
            </span>
            <span className="project-library-body">
                <span className="project-library-heading"><strong title={row.project.name}>{row.project.name}</strong>{row.project.status === "archived" ? <em>Archived</em> : null}<ArrowRight className="project-library-arrow size-4" /></span>
                <span className="project-library-date">{row.project.updatedAt.slice(0, 10)}</span>
                <span className="project-library-subtitle">{styleTitle} · {sourceTypeLabel(row.project.sourceType)}</span>
                <span className="project-library-progress"><span><span>{row.completedUnitCount}/{row.unitCount}  chapter</span><span>{completion}%</span></span><i><b style={{ width: `${completion}%` }} /></i></span>
                <span className="project-library-stats"><ProjectCount icon={<BookOpenText className="size-3.5" />} label="Chapter" value={row.unitCount} /><ProjectCount icon={<LayoutGrid className="size-3.5" />} label="canvas" value={row.canvasCount} /><ProjectCount icon={<Images className="size-3.5" />} label="assets" value={row.assetCount} /></span>
            </span>
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}><span className="text-foreground/32">{icon}</span><strong className="font-medium tabular-nums text-foreground/65">{value}</strong><span>{label}</span></span>;
}
