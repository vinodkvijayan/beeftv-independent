import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal } from "antd";
import { Select } from "@/components/ui/base/select";
import { Archive, Check, Eye, FolderOpen, Image as ImageIcon, Palette, Pencil, Save, ShieldAlert, Trash2 } from "lucide-react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CanvasStyleDetailModal, CanvasStylePickerModal, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { createStyleProfileSnapshot, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { listProjectAssetsPage, updateProject } from "@/services/api/projects";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelDisplayName, resolveModelRequestConfig, useEffectiveConfig } from "@/stores/use-config-store";

import { shouldApplyProjectSettingsMutation } from "./project-settings-session";
import type { ProjectDetailViewProps } from "./shared";

export default function ProjectSettingsView(props: ProjectDetailViewProps) {
    return <ProjectSettingsSession key={props.detail.project.id} {...props} />;
}

function ProjectSettingsSession({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const { project } = detail;
    const [mountedProjectId] = useState(project.id);
    const mountedRef = useRef(true);
    const liveProjectIdRef = useRef(project.id);
    liveProjectIdRef.current = project.id;
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    const personalAssets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description || "");
    const [aspectRatio, setAspectRatio] = useState(project.aspectRatio);
    const [sourceType, setSourceType] = useState(project.sourceType);
    const [stylePresetId, setStylePresetId] = useState(project.stylePresetId || "");
    const [styleProfileJson, setStyleProfileJson] = useState(project.styleProfileJson || "");
    const [defaultImageModel, setDefaultImageModel] = useState(project.defaultImageModel || "");
    const [defaultVideoModel, setDefaultVideoModel] = useState(project.defaultVideoModel || "");
    const [styleDetail, setStyleDetail] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [styleEditorRequested, setStyleEditorRequested] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [coverPickerOpen, setCoverPickerOpen] = useState(false);
    const [coverPage, setCoverPage] = useState(1);
    const [coverPageSize, setCoverPageSize] = useState(40);
    const coverAssetsQuery = useQuery({
        queryKey: ["project", project.id, "assets", "cover-picker", coverPage, coverPageSize],
        queryFn: () => listProjectAssetsPage(project.id, { page: coverPage, pageSize: coverPageSize, mediaType: "image" }),
        enabled: coverPickerOpen,
    });
    const projectCoverAssets = coverAssetsQuery.data?.assets || [];
    useEffect(() => { setName(project.name); setDescription(project.description || ""); setAspectRatio(project.aspectRatio); setSourceType(project.sourceType); setStylePresetId(project.stylePresetId || ""); setStyleProfileJson(project.styleProfileJson || ""); setDefaultImageModel(project.defaultImageModel || ""); setDefaultVideoModel(project.defaultVideoModel || ""); }, [project]);
    const dirty = useMemo(() => name.trim() !== project.name || description !== (project.description || "") || aspectRatio !== project.aspectRatio || sourceType !== project.sourceType || stylePresetId !== (project.stylePresetId || "") || styleProfileJson !== (project.styleProfileJson || "") || defaultImageModel !== (project.defaultImageModel || "") || defaultVideoModel !== (project.defaultVideoModel || ""), [aspectRatio, defaultImageModel, defaultVideoModel, description, name, project, sourceType, stylePresetId, styleProfileJson]);
    const selectedStyle = useMemo(() => resolveProjectCanvasStyle(stylePresetId, styleProfileJson), [stylePresetId, styleProfileJson]);
    const styleProfile = useMemo(() => parseStyleProfile(styleProfileJson) || selectedStyle?.profile || (selectedStyle ? createStyleProfileSnapshot(selectedStyle) : null), [selectedStyle, styleProfileJson]);
    const enabledStyleAssets = styleProfile?.assets.filter((asset) => asset.enabled !== false) || [];
    const styleExecutionPlans = useMemo(() => {
        if (!styleProfile) return null;
        const imageConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.imageModel || effectiveConfig.model);
        const videoConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.videoModel || effectiveConfig.model);
        return {
            image: resolveStyleExecutionPlan(styleProfile, { mode: "image", model: imageConfig.model, interfaceType: imageConfig.interfaceType || imageConfig.apiFormat }),
            video: resolveStyleExecutionPlan(styleProfile, { mode: "video", model: videoConfig.model, interfaceType: videoConfig.interfaceType || videoConfig.apiFormat }),
        };
    }, [effectiveConfig, styleProfile]);
    const coverPickerItems = useMemo<AssetLibraryPickerItem[]>(() => {
        const result: AssetLibraryPickerItem[] = [];
        const seenResourceIds = new Set<string>();
        for (const asset of personalAssets) {
            if (asset.kind !== "image") continue;
            const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
            if (!resourceId || seenResourceIds.has(resourceId)) continue;
            seenResourceIds.add(resourceId);
            result.push({ id: asset.id, title: asset.title, category: "image", kindLabel: "pictures", asset, description: asset.note || "Personal material library", searchText: (asset.tags || []).join(" ") });
        }
        for (const asset of projectCoverAssets) {
            if (asset.mediaType !== "image") continue;
            const resourceId = resourceIdFromStorageKey(asset.storageKey);
            if (!resourceId || seenResourceIds.has(resourceId)) continue;
            seenResourceIds.add(resourceId);
            result.push({ id: `project:${asset.id}`, title: asset.title, category: "image", kindLabel: "Project pictures", imageUrl: resourceFileUrl(resourceId), description: "Project library", searchText: asset.title });
        }
        if (project.coverResourceId && !seenResourceIds.has(project.coverResourceId)) {
            result.unshift({ id: `current:${project.coverResourceId}`, title: "Current project main image", category: "image", kindLabel: "Current main picture", imageUrl: resourceFileUrl(project.coverResourceId) });
        }
        return result;
    }, [personalAssets, project.coverResourceId, projectCoverAssets]);
    const coverResourceByItemId = useMemo(() => new Map(coverPickerItems.flatMap((item) => {
        if (item.id.startsWith("current:")) return [[item.id, item.id.slice("current:".length)] as const];
        if (item.id.startsWith("project:")) {
            const asset = projectCoverAssets.find((entry) => `project:${entry.id}` === item.id);
            const resourceId = resourceIdFromStorageKey(asset?.storageKey);
            return resourceId ? [[item.id, resourceId] as const] : [];
        }
        const asset = personalAssets.find((entry) => entry.id === item.id);
        const resourceId = asset?.kind === "image" ? resourceIdFromStorageKey(asset.data.storageKey) : "";
        return resourceId ? [[item.id, resourceId] as const] : [];
    })), [coverPickerItems, personalAssets, projectCoverAssets]);
    const coverResourceByItemIdRef = useRef(new Map<string, string>());
    useEffect(() => {
        for (const [itemId, resourceId] of coverResourceByItemId) coverResourceByItemIdRef.current.set(itemId, resourceId);
    }, [coverResourceByItemId]);
    const currentCoverItemId = coverPickerItems.find((item) => coverResourceByItemId.get(item.id) === project.coverResourceId)?.id;
    const canApplySettings = (projectId: string) => shouldApplyProjectSettingsMutation({
        mountedProjectId: projectId,
        liveProjectId: liveProjectIdRef.current,
        mounted: mountedRef.current && projectId === mountedProjectId,
    });
    const saveMutation = useMutation({
        mutationFn: (input: { projectId: string; payload: Parameters<typeof updateProject>[1] }) => {
            return updateProject(input.projectId, input.payload);
        },
        onSuccess: (_data, input) => {
            if (!canApplySettings(input.projectId)) return;
            refreshProject();
            message.success("Project settings saved");
        },
        onError: (error, input) => {
            if (!canApplySettings(input.projectId)) return;
            message.error(error instanceof Error ? error.message : "Failed to save project settings");
        },
    });
    const archiveMutation = useMutation({
        mutationFn: (input: { projectId: string; status: string; successMessage: string }) => {
            return updateProject(input.projectId, { status: input.status });
        },
        onSuccess: (_data, input) => {
            if (!canApplySettings(input.projectId)) return;
            setArchiveOpen(false);
            refreshProject();
            message.success(input.successMessage);
        },
        onError: (error, input) => {
            if (!canApplySettings(input.projectId)) return;
            message.error(error instanceof Error ? error.message : "Project status update failed");
        },
    });
    const coverMutation = useMutation({
        mutationFn: ({ coverResourceId, projectId }: { coverResourceId: string; projectId: string }) => {
            return updateProject(projectId, { coverResourceId });
        },
        onSuccess: (_, { coverResourceId, projectId }) => {
            if (!canApplySettings(projectId)) return;
            setCoverPickerOpen(false);
            refreshProject();
            message.success(coverResourceId ? "The main project image has been updated" : "Project main image has been removed");
        },
        onError: (error, variables) => {
            if (!canApplySettings(variables.projectId)) return;
            message.error(error instanceof Error ? error.message : "Project main image update failed");
        },
    });

    return (
        <div>
            <header className="flex items-end justify-between gap-3 pb-3"><div><h2 className="text-lg font-semibold">Project settings</h2><p className="mt-1 text-xs text-foreground/48">Basic information, project style and archive management</p></div><Button type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!dirty || !name.trim()} loading={saveMutation.isPending} onClick={() => saveMutation.mutate({ projectId: mountedProjectId, payload: { name: name.trim(), description, aspectRatio, sourceType, stylePresetId, styleProfileJson, defaultImageModel, defaultVideoModel } })}>{dirty ? "Save settings" : "saved"}</Button></header>

            <section className="py-5">
                <h3 className="mb-3 text-sm font-semibold">Basic settings</h3>
                <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Project name" className="xl:col-span-2"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
                    <Field label="Default frame"><Select className="w-full" value={aspectRatio} options={[{ label: "9:16 · Vertical short play", value: "9:16" }, { label: "16:9 · Landscape", value: "16:9" }, { label: "1:1 · Square", value: "1:1" }]} onChange={setAspectRatio} /></Field>
                    <Field label="Content source"><Select className="w-full" value={sourceType} options={[{ label: "blank start", value: "blank" }, { label: "Import novels", value: "novel" }, { label: "Paste text", value: "text" }]} onChange={setSourceType} /></Field>
                    <Field label="Project introduction" className="md:col-span-2 xl:col-span-4"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="One sentence describing the project goal" /></Field>
                </div>
            </section>

            <section className="border-t border-border/70 py-5">
                <div className="mb-3"><h3 className="text-sm font-semibold">Default generated model</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">Storyboards, action previews, and shot videos use the project default first; if it is not set or the model is unavailable, it will follow the global default of the workbench.</p></div>
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Default graph model">
                        <div className="flex items-center gap-2">
                            <ModelPicker config={effectiveConfig} value={defaultImageModel} capability="image" onChange={setDefaultImageModel} fullWidth placeholder={`Follow the big picture ·${modelDisplayName(effectiveConfig, effectiveConfig.imageModel) || "Not configured"}`} />
                            {defaultImageModel ? <Button type="text" size="small" onClick={() => setDefaultImageModel("")}>Follow the big picture</Button> : null}
                        </div>
                    </Field>
                    <Field label="Default video model">
                        <div className="flex items-center gap-2">
                            <ModelPicker config={effectiveConfig} value={defaultVideoModel} capability="video" onChange={setDefaultVideoModel} fullWidth placeholder={`Follow the big picture ·${modelDisplayName(effectiveConfig, effectiveConfig.videoModel) || "Not configured"}`} />
                            {defaultVideoModel ? <Button type="text" size="small" onClick={() => setDefaultVideoModel("")}>Follow the big picture</Button> : null}
                        </div>
                    </Field>
                </div>
            </section>

            <section className="border-t border-border/70 py-5">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Project main picture</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">The project list will give priority to displaying this picture; if it is not set, the project style diagram will be used.</p></div><span className="text-[var(--fs-label)] text-foreground/40">It is recommended to use pictures that are consistent with the project size</span></div>
                <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-active p-3 sm:flex-row sm:items-center">
                    {project.coverResourceId ? <img src={resourceFileUrl(project.coverResourceId)} alt={`${project.name}Project main picture`} className="aspect-video w-full shrink-0 rounded-md bg-foreground/5 object-cover sm:w-52" /> : <span className="grid aspect-video w-full shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/30 sm:w-52"><ImageIcon className="size-6" /></span>}
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium">{project.coverResourceId ? "Project main image has been set" : "The project main picture has not been set yet"}</div><p className="mt-1 text-xs leading-5 text-foreground/48">Select from your personal library or project library, or upload a new image in the selection window.</p></div>
                    <div className="flex shrink-0 gap-2"><Button icon={<FolderOpen className="size-3.5" />} onClick={() => { setCoverPage(1); setCoverPickerOpen(true); } }>{project.coverResourceId ? "Replace main image" : "Set main image"}</Button>{project.coverResourceId ? <Button danger type="text" icon={<Trash2 className="size-3.5" />} loading={coverMutation.isPending} onClick={() => coverMutation.mutate({ coverResourceId: "", projectId: mountedProjectId })}>Remove</Button> : null}</div>
                </div>
            </section>

            <section className="border-t border-border/70 py-5">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Project style</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">Projects save snapshots of the current version; modifying "My Style" will not automatically overwrite historical projects</p></div>{styleProfile ? <span className="text-[var(--fs-label)] text-foreground/52">{styleProfile.source === "user" ? "from my style" : styleProfile.source === "external" ? "external import" : "System default"}</span> : <span className="text-[var(--fs-label)] text-foreground/40">not set</span>}</div>
                <div className="flex flex-col gap-3 rounded-lg bg-surface-active p-3 lg:flex-row lg:items-center">
                    {selectedStyle ? <img src={selectedStyle.imageUrl} width="160" height="90" alt={`${selectedStyle.title}Indicative of painting style`} className="aspect-video w-40 shrink-0 rounded-md object-cover" /> : <span className="grid aspect-video w-40 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/35"><Palette className="size-5" /></span>}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{styleProfile?.title || selectedStyle?.title || "The project style has not been set yet"}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/48">{styleProfile?.description || selectedStyle?.description || "Start with a system style, or create a freely editable visual specification for your project."}</p>
                        {styleProfile ? <div className="mt-2 flex flex-wrap gap-1">{styleProfile.tags.map((tag) => <span key={tag} className="rounded bg-foreground/10 px-1.5 py-0.5 text-[var(--fs-tiny)] text-foreground/55">{tag}</span>)}</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2"><Button icon={<Eye className="size-3.5" />} disabled={!selectedStyle} onClick={() => setStyleDetail(selectedStyle || null)}>View specifications</Button><Button icon={<Pencil className="size-3.5" />} disabled={!styleProfile} onClick={() => { setStyleEditorRequested(true); setStylePickerOpen(true); }}>Edit style</Button><Button icon={<Palette className="size-3.5" />} onClick={() => { setStyleEditorRequested(false); setStylePickerOpen(true); }}>{selectedStyle ? "Change style" : "Choose style"}</Button></div>
                </div>
                {styleProfile ? <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><StyleMetric label="execution strategy" value={styleProfile.executionPolicy === "strict-assets" ? "Strict verification" : "Compatibility downgrade"} /><StyleMetric label="Bind assets" value={`${styleProfile.assets.length} a`} /><StyleMetric label="Enabled" value={`${enabledStyleAssets.length} a`} /><StyleMetric label="Image execution" value={styleExecutionStatusLabel(styleExecutionPlans?.image.status)} /><StyleMetric label="Video execution" value={styleExecutionStatusLabel(styleExecutionPlans?.video.status)} /></div> : null}
                {styleExecutionPlans && (styleExecutionPlans.image.warnings.length || styleExecutionPlans.video.warnings.length) ? <div className="mt-2 grid gap-1 rounded-md bg-amber-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-amber-600 dark:text-amber-400">{styleExecutionPlans.image.warnings.length ? <p>Picture:{styleExecutionPlans.image.warnings.join("；")}</p> : null}{styleExecutionPlans.video.warnings.length ? <p>Video:{styleExecutionPlans.video.warnings.join("；")}</p> : null}</div> : null}
            </section>

            <section className="py-4">
                <div className="flex flex-col gap-3 rounded-lg bg-red-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-500"><Archive className="size-3.5" /></span><div className="min-w-0"><h3 className="text-sm font-medium">{project.status === "archived" ? "restore items" : "Archive items"}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/48">{project.status === "archived" ? "Continue creating chapters, canvases, and build tasks after recovery" : "Keep all chapters, canvases and assets, and stop new creation and generation within the project"}</p></div></div>
                    <Button size="small" danger={project.status !== "archived"} icon={project.status === "archived" ? <Check className="size-3.5" /> : <ShieldAlert className="size-3.5" />} onClick={() => setArchiveOpen(true)}>{project.status === "archived" ? "restore items" : "Archive items"}</Button>
                </div>
            </section>

            <Modal className="workspace-modal workspace-modal-compact" title={project.status === "archived" ? "restore items" : "Archive items"} open={archiveOpen} okText={project.status === "archived" ? "Confirm recovery" : "Confirm archiving"} cancelText="Cancel" okButtonProps={{ danger: project.status !== "archived", loading: archiveMutation.isPending } } onCancel={() => setArchiveOpen(false)} onOk={() => { const currentStatus = project.status; archiveMutation.mutate({ projectId: mountedProjectId, status: currentStatus === "archived" ? "active" : "archived", successMessage: currentStatus === "archived" ? "Project has been restored" : "Project archived" }); }} styles={{ body: { paddingTop: 12 } }}><p className="m-0 text-sm leading-6 text-foreground/65">{project.status === "archived" ? "After restoration, the project will become editable again." : "Archiving does not delete chapters, canvases, or assets, and canvas documents can still be opened in Authoring Canvas."}</p></Modal>
            <AssetLibraryPickerModal
                open={coverPickerOpen}
                items={coverPickerItems}
                mediaKinds={["image"]}
                categoryLabels={{ all: "All pictures", image: "pictures" }}
                initialCategory="image"
                initialSelectedIds={currentCoverItemId ? [currentCoverItemId] : []}
                multiple={false}
                eyebrow="Project settings"
                title="Select project main image"
                confirmLabel={() => "Set as project main image"}
                emptyTitle="There are no pictures in the material library yet"
                emptyDescription="You can upload a new image from the bottom and it will be automatically selected after uploading."
                loading={coverAssetsQuery.isLoading}
                pagination={{ current: coverPage, pageSize: coverPageSize, total: coverAssetsQuery.data?.total || 0, onChange: (nextPage, nextPageSize) => { setCoverPage(nextPageSize !== coverPageSize ? 1 : nextPage); setCoverPageSize(nextPageSize); } }}
                upload={{ accept: "image/png,image/jpeg,image/webp,image/avif", description: "Support PNG, JPG, WebP, AVIF", onUpload: async (files) => {
                    const file = Array.from(files)[0];
                    if (!file?.type.startsWith("image/")) throw new Error("Please select image file");
                    const uploaded = await uploadImage(file);
                    const resourceId = resourceIdFromStorageKey(uploaded.storageKey);
                    if (!resourceId) throw new Error("The image upload is not synchronized to the server resource library, please check the backend connection.");
                    const id = addAsset({ kind: "image", title: file.name.replace(/\.[^.]+$/, "") || "Project main picture", coverUrl: uploaded.url, tags: ["Project main picture"], status: "confirmed", source: "Project settings", data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType } });
                    return [id];
                } }}
                onClose={() => setCoverPickerOpen(false)}
                onConfirm={async (ids) => {
                    const id = ids[0];
                    let resourceId = coverResourceByItemIdRef.current.get(id);
                    if (!resourceId) {
                        const asset = useAssetStore.getState().assets.find((entry) => entry.id === id);
                        resourceId = asset?.kind === "image" ? resourceIdFromStorageKey(asset.data.storageKey) : "";
                    }
                    if (!resourceId) throw new Error("The selected image has not been synchronized to the server resource library.");
                    await coverMutation.mutateAsync({ coverResourceId: resourceId, projectId: mountedProjectId });
                }}
            />
            <CanvasStylePickerModal open={stylePickerOpen} value={stylePresetId} currentProfile={styleProfile} startInEditor={styleEditorRequested} onClose={() => { setStylePickerOpen(false); setStyleEditorRequested(false); }} onSelect={(preset) => { applyStyle(preset); setStylePickerOpen(false); setStyleEditorRequested(false); }} />
            <CanvasStyleDetailModal open={Boolean(styleDetail)} preset={styleDetail} selected={styleDetail?.id === stylePresetId} onClose={() => setStyleDetail(null)} onSelect={(preset) => { applyStyle(preset); setStyleDetail(null); }} />
        </div>
    );

    function applyStyle(preset: CanvasStylePreset) {
        setStylePresetId(preset.id);
        setStyleProfileJson(serializeStyleProfile(preset.profile || createStyleProfileSnapshot(preset)));
    }
}

function StyleMetric({ label, value }: { label: string; value: string }) {
    return <div className="min-w-0 rounded-md bg-surface-active px-3 py-2"><span className="block text-[var(--fs-tiny)] text-foreground/40">{label}</span><span className="mt-0.5 block truncate font-medium text-foreground/65">{value}</span></div>;
}

function styleExecutionStatusLabel(status?: "ready" | "degraded" | "blocked") {
    return status === "blocked" ? "Not enforceable" : status === "degraded" ? "Degraded execution" : "Complete execution";
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}
