import { ImageSizePicker } from "@/components/image-size-picker";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Form, Image, Input, InputNumber, Select } from "antd";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { EmptyState } from "@/components/ui/product/empty-state";
import { StatusBadge } from "@/components/ui/base/badges";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Box, ChevronDown, ChevronLeft, ChevronRight, Download, Film, Image as ImageIcon, Layers3, List, Maximize2, Play, Plus, RefreshCcw, Save, Search, SlidersHorizontal, Trash2, UsersRound, WandSparkles, X } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ModelPicker } from "@/components/model-picker";
import { initialWorkbenchModel, refreshedWorkbenchModel } from "./workflow-model-selection";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationOptions } from "@/lib/model-capabilities";
import { customShotTitle, formatShotOrdinal, normalizeDefaultShotTitle } from "@/lib/shot-label";
import { resolveCompatibleModel, resolveModelVideoBooleanOptions, type ModelRequirements } from "@/lib/model-selection";
import { formatVideoResolutionLabel } from "@/lib/video-generation-options";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { type GenerationTask } from "@/services/api/task-center";
import {
    createUnitWorkflow,
    deleteProjectShot,
    linkShotAsset,
    listProjectAssetsPage,
    saveProjectShot,
    unlinkShotAsset,
    type ProjectAsset,
    type ProjectDetail,
    type ProjectShot,
    type ShotAssetReference,
    type ShotArtifact,
    type ShotRevisionInput,
    type WorkflowStep,
} from "@/services/api/projects";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { skillRuntime } from "@/services/skill-runtime";
import { modelDisplayName, modelOptionName, resolveModelChannel, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";

import {
    ArtifactStatus,
    artifactTypeForStage,
    assetCategoryLabel,
    currentArtifact,
    currentRevision,
    formatDuration,
    type ShortDramaWorkflowStage,
} from "./workflow-shared";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, resolveShotAssetMentionPrompt } from "./workflow-shot-references";

type ShotEditorValues = Omit<ShotRevisionInput, "durationMs"> & {
    title: string;
    durationSeconds: number;
};

type Props = {
    activeStage: ShortDramaWorkflowStage;
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    workflowStep?: WorkflowStep;
    selectedShot?: ProjectShot;
    onSelectShot: (id: string) => void;
    onRefresh: () => Promise<void>;
    onAddShot: () => void;
    addingShot: boolean;
};

const productionStageCopy: Record<"storyboard" | "previz" | "video", { label: string; action: string; empty: string }> = {
    storyboard: { label: "Storyboards", action: "Generate storyboards", empty: "Generate static storyboards to confirm composition, scenery and character positions" },
    previz: { label: "action rehearsal", action: "Generate black and white preview", empty: "Generate black and white action previews to confirm performance rhythm and camera movement" },
    video: { label: "Lens video", action: "Generate footage video", empty: "Generate the current shot after selecting the video model" },
};

export default function WorkflowProductionWorkbench(props: Props) {
    const { activeStage, detail, projectId, unitId, workflowStep, selectedShot, onSelectShot, onRefresh, onAddShot, addingShot } = props;
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [form] = Form.useForm<ShotEditorValues>();
    const watchedDuration = Form.useWatch("durationSeconds", form);
    const watchedTitle = Form.useWatch("title", form);
    const [leftTab, setLeftTab] = useState<"assets" | "episodes" | "shots">("episodes");
    const [previewTab, setPreviewTab] = useState<"latest" | "history">("latest");
    const [previewArtifactId, setPreviewArtifactId] = useState("");
    const [imagePreviewArtifact, setImagePreviewArtifact] = useState<ShotArtifact | null>(null);
    const [editorDirty, setEditorDirty] = useState(false);
    const [submittingShotIds, setSubmittingShotIds] = useState<Set<string>>(() => new Set());
    const [taskClock, setTaskClock] = useState(() => Date.now());
    const activeShotIdRef = useRef(selectedShot?.id || "");
    activeShotIdRef.current = selectedShot?.id || "";
    const shots = useMemo(() => (detail.shots || []).filter((item) => item.unitId === unitId).slice().sort((left, right) => left.position - right.position), [detail.shots, unitId]);
    const shotIndex = selectedShot ? shots.findIndex((item) => item.id === selectedShot.id) : -1;
    const revision = currentRevision(detail, selectedShot);
    const artifactType = artifactTypeForStage(activeStage);
    const artifacts = useMemo(() => selectedShot ? (detail.shotArtifacts || []).filter((item) => item.shotId === selectedShot.id && item.type === artifactType).slice().sort((left, right) => right.version - left.version) : [], [artifactType, detail.shotArtifacts, selectedShot]);
    const shotTask = useMemo<GenerationTask | undefined>(() => {
        return (detail.tasks || []).filter((task) => task.clientContext?.shotId === selectedShot?.id && task.clientContext?.artifactType === artifactType).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    }, [artifactType, detail.tasks, selectedShot?.id]);
    useEffect(() => {
        if (shotTask?.status !== "queued" && shotTask?.status !== "running") return;
        const timer = window.setInterval(() => setTaskClock(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [shotTask?.status, shotTask?.id]);
    const shotTaskElapsed = shotTask ? formatTaskElapsed(Date.parse(shotTask.startedAt || shotTask.createdAt), taskClock) : "";
    const newestArtifact = artifacts.find((item) => item.selected) || artifacts[0];
    const previewArtifact = artifacts.find((item) => item.id === previewArtifactId) || newestArtifact;
    const generationCapability = activeStage === "video" ? "video" as const : "image" as const;
    const projectDefaultModel = generationCapability === "video" ? detail.project.defaultVideoModel : detail.project.defaultImageModel;
    const initialModel = initialWorkbenchModel(effectiveConfig, projectDefaultModel, generationCapability);
    const [selectedModel, setSelectedModel] = useState(initialModel);
    const selectedModelRef = useRef(initialModel);
    const modelScope = `${projectId}:${generationCapability}`;
    const modelScopeRef = useRef(modelScope);
    const [aspectRatio, setAspectRatio] = useState(detail.project.aspectRatio || "16:9");
    const [resolution, setResolution] = useState(effectiveConfig.vquality || "720");
    const [imageQuality, setImageQuality] = useState(effectiveConfig.quality || "auto");
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const { skills: availableSkills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const shotAssetReferenceContext = useMemo(() => buildShotAssetReferenceContext(detail, selectedShot?.id || ""), [detail, selectedShot?.id]);
    const referenceByVersionId = useMemo(() => {
        const references = (detail.shotReferences || []).filter((reference) => reference.shotId === selectedShot?.id && reference.role === "reference" && reference.status === "linked");
        return new Map(references.flatMap((reference) => [
            [reference.assetVersionId, reference] as const,
            ...(reference.asset?.primaryVersionId ? [[reference.asset.primaryVersionId, reference] as const] : []),
        ]));
    }, [detail.shotReferences, selectedShot?.id]);
    const currentDurationSeconds = Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000));
    const generationSeconds = String(Math.max(1, Math.round(currentDurationSeconds)));
    const generationReferenceAudios = generationCapability === "video" ? shotAssetReferenceContext.referenceAudios : [];
    const videoEditOperation = generationCapability === "video" && shotAssetReferenceContext.referenceImages.length ? "reference_to_video" : undefined;
    const modelRequirements = useMemo<ModelRequirements>(() => ({
        capability: generationCapability,
        input: { textCount: 1, imageCount: shotAssetReferenceContext.referenceImages.length, videoCount: 0, audioCount: generationReferenceAudios.length, characterCount: 0 },
        videoOperation: videoEditOperation,
        videoSeconds: generationCapability === "video" ? generationSeconds : undefined,
        imageSize: generationCapability === "image" ? aspectRatio : undefined,
        options: generationCapability === "video"
            ? { size: aspectRatio, vquality: resolution, videoSeconds: Number(generationSeconds) }
            : { size: aspectRatio, quality: imageQuality },
    }), [aspectRatio, generationCapability, generationReferenceAudios.length, generationSeconds, imageQuality, resolution, shotAssetReferenceContext.referenceImages.length, videoEditOperation]);
    const routedModel = resolveCompatibleModel(effectiveConfig, selectedModel, modelRequirements) || selectedModel;
    const activeProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, routedModel), [effectiveConfig, routedModel]);
    const videoProfile = generationCapability === "video" ? activeProfile.video : undefined;
    const imageProfile = generationCapability === "image" ? activeProfile.image : undefined;
    const videoBooleanOptions = useMemo(() => generationCapability === "video"
        ? resolveModelVideoBooleanOptions(effectiveConfig, routedModel, {}, {
              videoGenerateAudio: effectiveConfig.videoGenerateAudio,
              videoWatermark: effectiveConfig.videoWatermark,
          })
        : undefined, [effectiveConfig, generationCapability, routedModel]);
    const generationConfig = useMemo(() => ({
        ...effectiveConfig,
        model: routedModel,
        imageModel: generationCapability === "image" ? routedModel : effectiveConfig.imageModel,
        videoModel: generationCapability === "video" ? routedModel : effectiveConfig.videoModel,
        size: aspectRatio,
        quality: imageQuality,
        vquality: resolution,
        videoSeconds: generationSeconds,
        ...(videoBooleanOptions || {}),
    }), [aspectRatio, effectiveConfig, generationCapability, generationSeconds, imageQuality, resolution, routedModel, videoBooleanOptions]);
    const modelSummary = routedModel ? modelDisplayName(effectiveConfig, routedModel) : "No model selected";
    const durationSummary = Number(watchedDuration) === -1 ? "automatic" : `${Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000))}s`;
    const resolutionSummary = generationCapability === "video" ? formatVideoResolutionLabel(resolution) : imageQuality.toUpperCase();

    useEffect(() => {
        const nextModel = refreshedWorkbenchModel(selectedModelRef.current, initialModel, modelScopeRef.current === modelScope);
        modelScopeRef.current = modelScope;
        selectedModelRef.current = nextModel;
        setSelectedModel(nextModel);
        if (!nextModel) return;
        const profile = modelCapabilityConfigFor(effectiveConfig, nextModel);
        if (generationCapability === "video" && profile.video) {
            const normalized = normalizeVideoValue(profile.video, {
                seconds: effectiveConfig.videoSeconds,
                ratio: detail.project.aspectRatio || effectiveConfig.size,
                resolution: effectiveConfig.vquality,
            });
            setAspectRatio(normalized.ratio);
            setResolution(normalized.resolution);
            form.setFieldValue("durationSeconds", Number(normalized.seconds));
        } else if (generationCapability === "image" && profile.image) {
            const normalized = normalizeImageValue(profile.image, { size: detail.project.aspectRatio || effectiveConfig.size, quality: effectiveConfig.quality, count: "1" });
            setAspectRatio(normalized.size);
            setImageQuality(normalized.quality);
        }
    }, [detail.project.aspectRatio, effectiveConfig, form, generationCapability, initialModel, modelScope]);

    useEffect(() => {
        const shotDurationSeconds = Math.max(0.5, (revision?.durationMs || selectedShot?.durationMs || 3000) / 1000);
        const currentModel = selectedModelRef.current || initialModel;
        const normalizedDurationSeconds = generationCapability === "video" && currentModel
            ? Number(normalizeVideoValue(modelCapabilityConfigFor(effectiveConfig, currentModel).video!, { seconds: String(shotDurationSeconds) }).seconds)
            : shotDurationSeconds;
        const videoPrompt = ensureShotAssetMentionPrompt(revision?.videoPrompt || "", shotAssetReferenceContext.mentionReferences);
        form.setFieldsValue({
            title: normalizeDefaultShotTitle(selectedShot?.title, Math.max(0, shotIndex)),
            plotDescription: revision?.plotDescription || selectedShot?.description || "",
            action: revision?.action || "",
            dialogue: revision?.dialogue || "",
            shotSize: revision?.shotSize || "",
            cameraAngle: revision?.cameraAngle || "",
            cameraMovement: revision?.cameraMovement || "",
            durationSeconds: normalizedDurationSeconds,
            imagePrompt: revision?.imagePrompt || "",
            videoPrompt,
            negativePrompt: revision?.negativePrompt || "",
            continuityNotes: revision?.continuityNotes || "",
        });
        setPreviewArtifactId("");
        setImagePreviewArtifact(null);
        setEditorDirty(!revision || videoPrompt !== revision.videoPrompt);
    }, [effectiveConfig, form, generationCapability, initialModel, revision?.id, selectedShot?.id, shotAssetReferenceContext.mentionReferences]);

    const changeGenerationModel = (nextModel: string) => {
        selectedModelRef.current = nextModel;
        setSelectedModel(nextModel);
        const profile = modelCapabilityConfigFor(effectiveConfig, nextModel);
        if (generationCapability === "video" && profile.video) {
            const normalized = normalizeVideoValue(profile.video, {
                seconds: String(form.getFieldValue("durationSeconds") || generationSeconds),
                ratio: aspectRatio,
                resolution,
            });
            setAspectRatio(normalized.ratio);
            setResolution(normalized.resolution);
            form.setFieldValue("durationSeconds", Number(normalized.seconds));
            return;
        }
        if (generationCapability === "image" && profile.image) {
            const normalized = normalizeImageValue(profile.image, { size: aspectRatio, quality: imageQuality, count: "1" });
            setAspectRatio(normalized.size);
            setImageQuality(normalized.quality);
        }
    };

    const saveShot = useMutation({
        mutationFn: async (values: ShotEditorValues) => {
            if (!selectedShot) throw new Error("Please select lens first");
            return saveProjectShot(projectId, {
                id: selectedShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: selectedShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: selectedShot.status,
                revision: revisionInput(values),
            });
        },
        onSuccess: async () => { setEditorDirty(false); await onRefresh(); message.success("Shot script saved as new version"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "Shot saving failed"),
    });

    const deleteShot = useMutation({
        mutationFn: async ({ shotId }: { shotId: string; nextShotId: string }) => deleteProjectShot(projectId, shotId),
        onSuccess: async (_result, { nextShotId }) => {
            onSelectShot(nextShotId);
            await onRefresh();
            message.success("Lens deleted");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Lens deletion failed"),
    });

    const changeAssetBinding = useMutation({
        mutationFn: async ({ asset, reference }: { asset?: ProjectAsset; reference?: ShotAssetReference }) => {
            if (!selectedShot) throw new Error("Please select lens first");
            if (reference) return unlinkShotAsset(projectId, selectedShot.id, reference.id);
            if (!asset?.primaryVersionId) throw new Error("There is no bindable version of this asset yet");
            return linkShotAsset(projectId, selectedShot.id, { assetVersionId: asset.primaryVersionId, role: "reference" });
        },
        onSuccess: async (_result, variables) => { await onRefresh(); message.success(variables.reference ? "The asset reference for the current shot has been dereferenced" : "The asset is bound to the current shot"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "Lens asset update failed"),
    });

    const generateArtifact = async () => {
        if (!selectedShot || submittingShotIds.has(selectedShot.id)) return;
        const submittingShot = selectedShot;
        setSubmittingShotIds((current) => new Set(current).add(submittingShot.id));
        try {
            const values = await form.validateFields();
            let productionStep = workflowStep;
            if (!productionStep) {
                const initialized = await createUnitWorkflow(projectId, unitId);
                productionStep = (initialized.workflow.steps || []).find((step) => step.stepKey === activeStage);
            }
            if (!productionStep) throw new Error("The current generation phase is unavailable, please refresh the page and try again.");
            if (productionStep.status === "failed") throw new Error("The current generation phase failed, please refresh and try again.");
            if (!routedModel) throw new Error(activeStage === "video" ? "Please configure the video model first" : "Please configure the image model first");
            const saved = await saveProjectShot(projectId, {
                id: submittingShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: submittingShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: submittingShot.status,
                revision: revisionInput(values),
            });
            const mode = generationCapability;
            const config = { ...generationConfig, videoSeconds: String(Math.max(1, Math.round(values.durationSeconds))) };
            if (!isAiConfigReady(config, routedModel)) throw new Error("The current model channel configuration is incomplete, please go to the settings to complete it first.");
            const basePrompt = mode === "video"
                ? [values.videoPrompt || values.plotDescription, values.action, values.dialogue && `Lines:${values.dialogue}`, values.continuityNotes].filter(Boolean).join("\n")
                : [values.imagePrompt || values.plotDescription, values.action, "Black and white storyboard sketches, clear action beats, film composition"].filter(Boolean).join("\n");
            const resolvedPrompt = resolveShotAssetMentionPrompt(basePrompt, shotAssetReferenceContext, { dialogue: values.dialogue });
            const skillExecution = await skillRuntime.prepare({
                profile: "shortDrama",
                prompt: resolvedPrompt,
                skills: availableSkills,
                selectedSkillIds,
            });
            await submitBackendGenerationTask({
                projectId,
                mode,
                prompt: skillExecution.prompt,
                config,
                referenceImages: shotAssetReferenceContext.referenceImages,
                referenceAudios: generationReferenceAudios,
                metadata: {
                    ...skillExecution.metadata,
                    workflowStepId: productionStep.id,
                    domainProjectId: projectId,
                    unitId,
                    shotId: saved.shot.id,
                    shotRevisionId: saved.shot.currentRevisionId,
                    artifactType,
                    role: "output",
                    source: "short-drama-workflow",
                    ...(mode === "video" && shotAssetReferenceContext.referenceImages.length ? { videoEditOperation: "reference_to_video" } : {}),
                    resolvedCharacterVersions: shotAssetReferenceContext.resolvedCharacterVersions,
                    artifactMetadata: { model: routedModel, aspectRatio, resolution, durationSeconds: values.durationSeconds, ...skillExecution.metadata },
                },
            });
            if (activeShotIdRef.current === submittingShot.id) setEditorDirty(false);
            await onRefresh();
            message.success(`${productionStageCopy[activeStage as "storyboard" | "previz" | "video"].label}Task has been submitted`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Generate task submission failed");
        } finally {
            setSubmittingShotIds((current) => {
                const next = new Set(current);
                next.delete(submittingShot.id);
                return next;
            });
        }
    };

    const stageCopy = productionStageCopy[activeStage as "storyboard" | "previz" | "video"];
    const selectedShotSubmitting = submittingShotIds.has(selectedShot?.id || "");

    if (!selectedShot) {
        return <div className="workflow-empty-shot"><EmptyState size="compact" title="There is no storyboard for the current chapter yet" action={<Button type="primary" icon={<Plus className="size-4" />} loading={addingShot} onClick={onAddShot}>Add the first storyboard</Button>} /></div>;
    }

    const requestShotSelection = (nextShotId: string) => {
        if (nextShotId === selectedShot.id) return;
        if (!editorDirty) {
            onSelectShot(nextShotId);
            return;
        }
        modal.confirm({
            title: "The current shot has unsaved modifications",
            content: "Switching cameras will discard these modifications.",
            okText: "Discard changes and switch",
            cancelText: "Continue editing",
            onOk: () => onSelectShot(nextShotId),
        });
    };

    const requestAddShot = () => {
        if (!editorDirty) {
            onAddShot();
            return;
        }
        modal.confirm({
            title: "The current shot has unsaved modifications",
            content: "Adding a new shot will leave the current editing content.",
            okText: "Discard changes and add new",
            cancelText: "Continue editing",
            onOk: onAddShot,
        });
    };

    const requestDeleteShot = () => {
        const nextShot = shots[shotIndex + 1] || shots[shotIndex - 1];
        modal.confirm({
            title: `Delete footage"${watchedTitle || selectedShot.title || "unnamed shot"}”？`,
            content: editorDirty
                ? "The shot's unsaved modifications, script versions, asset references, and build artifacts will be deleted and cannot be restored."
                : "The shot's scripted version, asset references, and build artifacts are deleted and cannot be restored.",
            okText: "delete shot",
            okButtonProps: { danger: true },
            cancelText: "Cancel",
            centered: true,
            onOk: () => deleteShot.mutateAsync({ shotId: selectedShot.id, nextShotId: nextShot?.id || "" }),
        });
    };

    const selectRelativeShot = (offset: number) => {
        const next = shots[shotIndex + offset];
        if (next) requestShotSelection(next.id);
    };

    return (
        <div className="workflow-production-shell">
            <div className="workflow-production-main">
                <aside className="workflow-library-panel">
                        <SegmentedControl
                        block
                        size="sm"
                        value={leftTab}
                        onChange={(value) => setLeftTab(value as typeof leftTab)}
                        options={[{ value: "episodes", label: "Chapter" }, { value: "shots", label: "lens" }, { value: "assets", label: "assets" }]}
                    />
                    <div className="workflow-library-scroll thin-scrollbar">
                        {leftTab === "assets" ? <AssetLibrary detail={detail} referenceByVersionId={referenceByVersionId} changing={changeAssetBinding.isPending} onToggle={(asset, reference) => changeAssetBinding.mutate({ asset, reference })} /> : null}
                        {leftTab === "episodes" ? <EpisodeLibrary detail={detail} activeUnitId={unitId} projectId={projectId} activeStage={activeStage} /> : null}
                        {leftTab === "shots" ? <ShotLibrary detail={detail} shots={shots} selectedShotId={selectedShot.id} onSelectShot={requestShotSelection} /> : null}
                    </div>
                </aside>

                <section className="workflow-shot-editor">
                    <header className="workflow-panel-header">
                        <div className="workflow-shot-heading">
                            <span className="workflow-shot-number">{formatShotOrdinal(shotIndex)}</span>
                            {customShotTitle(watchedTitle || selectedShot.title, shotIndex) ? <h2>{customShotTitle(watchedTitle || selectedShot.title, shotIndex)}</h2> : null}
                            <StatusBadge tone={saveShot.isPending ? "loading" : editorDirty ? "warning" : revision ? "success" : "neutral"} label={saveShot.isPending ? "Saving" : editorDirty ? "There are unsaved changes" : revision ? "saved" : "draft"} className="m-0" />
                        </div>
                        <div className="flex items-center gap-1"><span className="mr-1 text-[var(--fs-micro)] text-foreground/45">{shotIndex + 1} / {shots.length}</span><Button type="text" size="small" icon={<ChevronLeft className="size-4" />} disabled={shotIndex <= 0} onClick={() => selectRelativeShot(-1)} aria-label="previous shot" /><Button type="text" size="small" icon={<ChevronRight className="size-4" />} disabled={shotIndex >= shots.length - 1} onClick={() => selectRelativeShot(1)} aria-label="next shot" /></div>
                    </header>
                    <Form form={form} layout="vertical" className="workflow-shot-form" onValuesChange={() => setEditorDirty(true)} onFinish={(values) => saveShot.mutate(values)}>
                        <div className="workflow-shot-form-scroll thin-scrollbar">
                            <div className="workflow-form-section-heading"><span>shot script</span><small>First write down what is happening in the shot, then adjust the generation parameters</small></div>
                            <Form.Item name="title" label="Lens name" rules={[{ required: true, message: "Please enter lens name" }]}><Input placeholder="Summarize this shot in one sentence" /></Form.Item>
                            <Form.Item name="videoPrompt" label="Video prompt words" rules={[{ required: true, message: "Please enter the video prompt word" }]}><ShotAssetMentionTextarea references={shotAssetReferenceContext.mentionReferences} /></Form.Item>
                            <BoundAssets detail={detail} shotId={selectedShot.id} changing={changeAssetBinding.isPending} onUnlink={(reference) => changeAssetBinding.mutate({ reference })} />
                            <div className="workflow-form-grid">
                                <Form.Item name="action" label="Acting and Action"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="Describe character performance, movement and object movement according to action rhythm" /></Form.Item>
                                <Form.Item name="dialogue" label="dialogue / narration"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="Fill in the dialogue, narration or audio information that needs to be retained" /></Form.Item>
                            </div>
                            <WorkflowDisclosure
                                icon={<SlidersHorizontal />}
                                title="Build settings"
                                description="Generate specs and lens language"
                                summary={<><span>{durationSummary}</span><span>{aspectRatio}</span><span>{resolutionSummary}</span><span className="is-model">{modelSummary}</span></>}
                            >
                                <div className="workflow-settings-section">
                                    <div className="workflow-settings-section-title">Generate specifications</div>
                                    <Form.Item label="Generate model">
                                        <ModelPicker
                                            config={generationConfig}
                                            value={selectedModel}
                                            capability={generationCapability}
                                            requirements={modelRequirements}
                                            onChange={changeGenerationModel}
                                            fullWidth
                                            className="workflow-model-picker"
                                            placeholder={activeStage === "video" ? "Select video model" : "Select image model"}

                                        />
                                    </Form.Item>
                                    <Form.Item label="Skill library"><SkillRuntimePicker profile="shortDrama" skills={availableSkills} loading={skillsLoading} value={selectedSkillIds} onChange={setSelectedSkillIds} /></Form.Item>
                                    <div className="workflow-form-grid is-three">
                                        <Form.Item name="durationSeconds" label="Shot duration (seconds)">
                                            {generationCapability === "video" && videoProfile?.duration.selection === "enum"
                                                ? <Select options={videoDurationOptions(videoProfile).map((value) => ({ value, label: value === -1 ? "automatic" : `${value} seconds` }))} />
                                                : <InputNumber className="w-full" min={generationCapability === "video" ? videoProfile?.duration.min || 1 : 0.5} max={generationCapability === "video" ? videoProfile?.duration.max || 60 : 60} step={generationCapability === "video" ? videoProfile?.duration.step || 1 : 0.5} />}
                                        </Form.Item>
                                        {generationCapability === "video" ? <Form.Item label="frame"><Select value={aspectRatio} onChange={setAspectRatio} options={(videoProfile?.ratios || []).map((value) => ({value, label:value}))} /></Form.Item> : null}
                                        {generationCapability === "video" ? (
                                            <Form.Item label="resolution"><Select value={resolution} onChange={setResolution} options={(videoProfile?.resolutions || []).map((value) => ({ value, label: formatVideoResolutionLabel(value) }))} /></Form.Item>
                                        ) : imageProfile?.quality.supported && !imageResolutionUsesQuality(imageProfile) ? (
                                            <Form.Item label="Generate image quality"><Select value={imageQuality} onChange={setImageQuality} options={imageProfile.quality.values.map((value) => ({ value, label: value.toUpperCase() }))} /></Form.Item>
                                        ) : <div />}
                                    </div>
                                    {generationCapability === "image" && imageProfile ? <ImageSizePicker profile={imageProfile} size={aspectRatio} quality={imageQuality} onChange={(size, quality) => { setAspectRatio(size); if (quality) setImageQuality(quality); }} /> : null}
                                </div>
                                <div className="workflow-settings-section">
                                    <div className="workflow-settings-section-title">lens language</div>
                                    <div className="workflow-form-grid is-three">
                                        <Form.Item name="shotSize" label="Scenery farewell"><Select allowClear placeholder="automatic" options={["Close-up", "close shot", "medium shot", "Panorama", "Vision"].map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item name="cameraAngle" label="camera angle"><Select allowClear placeholder="automatic" options={["eye level", "overhead shot", "Looking up", "side", "Over the shoulder"].map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item name="cameraMovement" label="Movement method"><Select allowClear placeholder="automatic" options={["Fixed", "push mirror", "pull mirror", "panning", "Shift", "Follow the shot"].map((value) => ({ value, label: value }))} /></Form.Item>
                                    </div>
                                </div>
                            </WorkflowDisclosure>
                            <WorkflowDisclosure
                                className="is-advanced"
                                icon={<WandSparkles />}
                                title="Generate supplement"
                                description="Only fill in if the model requires additional constraints"
                                summary={<span>Prompt words · Exclusions · Acceptance</span>}
                            >
                                <div className="workflow-form-grid">
                                    <Form.Item name="plotDescription" label="camera footage" rules={[{ required: true, message: "Please enter the footage" }]}><ShotAssetMentionTextarea variant="scene" references={shotAssetReferenceContext.mentionReferences} /></Form.Item>
                                    <Form.Item name="imagePrompt" label="Screen prompt words"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="If left blank, it will be automatically generated based on the footage." /></Form.Item>
                                    <Form.Item name="negativePrompt" label="Exclude content"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="Fill in unwanted elements, actions or screen issues" /></Form.Item>
                                    <Form.Item name="continuityNotes" label="Remarks for taking the role"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="Record the character's position, orientation, clothing, props, and the continuation relationship between front and rear mirrors" /></Form.Item>
                                </div>
                            </WorkflowDisclosure>
                        </div>
                        <footer className="workflow-editor-actions">
                            <div className="flex items-center gap-2"><Button danger icon={<Trash2 className="size-4" />} loading={deleteShot.isPending} disabled={saveShot.isPending || selectedShotSubmitting || changeAssetBinding.isPending} onClick={requestDeleteShot}>delete shot</Button><Button htmlType="submit" icon={<Save className="size-4" />} loading={saveShot.isPending} disabled={!editorDirty || deleteShot.isPending}>save script</Button><Button type="primary" icon={<Play className="size-4" />} loading={selectedShotSubmitting || shotTask?.status === "queued" || shotTask?.status === "running"} disabled={deleteShot.isPending} onClick={() => void generateArtifact()}>{selectedShotSubmitting ? `${stageCopy.action}(submitting)` : shotTask?.status === "queued" || shotTask?.status === "running" ? `${stageCopy.action}(Run${shotTaskElapsed}）` : shotTask?.status === "failed" ? `${stageCopy.action}(Failed last time, can try again)` : shotTask?.status === "succeeded" && !newestArtifact ? `${stageCopy.action}(Completed, syncing)` : newestArtifact ? `${stageCopy.action}(generated)` : stageCopy.action}</Button></div>
                        </footer>
                    </Form>
                </section>

                <aside className="workflow-preview-panel">
                    <header className="workflow-preview-header">
                        <div className="workflow-preview-header-row">
                            <div className="workflow-preview-title"><Film className="size-4 shrink-0" /><span>Product preview</span></div>
<SegmentedControl size="sm" value={previewTab} onChange={(value) => setPreviewTab(value as typeof previewTab)} options={[{ value: "latest", label: "Latest" }, { value: "history", label: `history${artifacts.length}` }]} />
                        </div>
<SegmentedControl
                            block
                            size="sm"
                            className="workflow-preview-stage-switch"
                            value={activeStage}
                            options={[{ value: "storyboard", label: "Storyboards" }, { value: "previz", label: "action rehearsal" }, { value: "video", label: "Lens video" }]}
                            onChange={(nextStage) => navigate(`/projects/${projectId}/workflow/${unitId}/${nextStage}`)}
                        />
                    </header>
                    <div className="workflow-preview-scroll thin-scrollbar">
                        {previewTab === "latest" ? <LatestPreview artifact={previewArtifact} emptyText={stageCopy.empty} onPreviewImage={setImagePreviewArtifact} /> : <ArtifactHistory artifacts={artifacts} activeId={previewArtifact?.id} onSelect={(artifact) => { setPreviewArtifactId(artifact.id); setPreviewTab("latest"); }} />}
                        <div className="workflow-preview-summary"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Current products</span><ArtifactStatus artifact={newestArtifact} compact /></div><div className="mt-1 text-[var(--fs-micro)] text-foreground/45">{newestArtifact ? `${formatDuration(selectedShot.durationMs)} · ${resolution}p · v${newestArtifact.version}` : "The current lens has not generated a product yet"}</div></div>
                        <div className="workflow-preview-actions"><Button icon={<RefreshCcw className="size-3.5" />} loading={selectedShotSubmitting || shotTask?.status === "queued" || shotTask?.status === "running"} onClick={() => void generateArtifact()}>Regenerate</Button><Button icon={<Download className="size-3.5" />} disabled={!previewArtifact?.resourceId} onClick={() => previewArtifact?.resourceId && void downloadArtifact(previewArtifact, selectedShot.title, message.error)}>Download{activeStage === "video" ? "video" : "pictures"}</Button></div>
                        <ArtifactHistory artifacts={artifacts.slice(0, 4)} activeId={previewArtifact?.id} onSelect={(artifact) => setPreviewArtifactId(artifact.id)} compact />
                    </div>
                </aside>
            </div>

            <AppModal
                flush
                open={Boolean(imagePreviewArtifact?.resourceId)}
                title={imagePreviewArtifact?.type === "action_board" ? "Action preview preview" : "Storyboard preview"}
                footer={null}
                centered
                width="min(960px, calc(100vw - 32px))"
                onCancel={() => setImagePreviewArtifact(null)}
            >
                {imagePreviewArtifact?.resourceId ? <img className={`workflow-image-preview-modal ${imagePreviewArtifact.type === "action_board" ? "grayscale" : ""}`} src={resourceFileUrl(imagePreviewArtifact.resourceId)} alt={imagePreviewArtifact.type === "action_board" ? "Large picture of action preview" : "Large picture of storyboard"} /> : null}
            </AppModal>

            <ShotTimeline activeStage={activeStage} detail={detail} shots={shots} selectedShotId={selectedShot.id} submittingShotIds={submittingShotIds} onSelectShot={requestShotSelection} onAddShot={requestAddShot} addingShot={addingShot} />
        </div>
    );
}

function formatTaskElapsed(startedAt: number, now: number) {
    const totalSeconds = Math.max(0, Math.floor((now - (Number.isFinite(startedAt) ? startedAt : now)) / 1_000));
    return `${Math.floor(totalSeconds / 60)}minutes${String(totalSeconds % 60).padStart(2, "0")}sec`;
}

function WorkflowDisclosure({ icon, title, description, summary, className = "", children }: { icon: ReactNode; title: string; description: string; summary: ReactNode; className?: string; children: ReactNode }) {
    return (
        <details className={`workflow-disclosure ${className}`}>
            <summary>
                <span className="workflow-disclosure-heading"><span className="workflow-disclosure-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span></span>
                <span className="workflow-disclosure-summary">{summary}<ChevronDown className="workflow-disclosure-chevron" /></span>
            </summary>
            <div className="workflow-disclosure-body"><div className="workflow-disclosure-content">{children}</div></div>
        </details>
    );
}

function AssetLibrary({ detail, referenceByVersionId, changing, onToggle }: { detail: ProjectDetail; referenceByVersionId: Map<string, ShotAssetReference>; changing: boolean; onToggle: (asset: ProjectAsset, reference?: ShotAssetReference) => void }) {
    const [category, setCategory] = useState("all");
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const [page, setPage] = useState(1);
    const pageSize = 30;
    const assetsQuery = useQuery({
        queryKey: ["project", detail.project.id, "assets", "workflow-library", category, debouncedKeyword, page, pageSize],
        queryFn: () => listProjectAssetsPage(detail.project.id, { page, pageSize, category: category === "all" ? undefined : category, query: debouncedKeyword || undefined }),
    });
    useEffect(() => setPage(1), [debouncedKeyword]);
    const assetsPage = assetsQuery.data?.assets || [];
    const groups = useMemo(() => {
        const map = new Map<string, ProjectAsset[]>();
        assetsPage.forEach((asset) => map.set(asset.category || "other", [...(map.get(asset.category || "other") || []), asset]));
        return Array.from(map.entries());
    }, [assetsPage]);
    const total = assetsQuery.data?.total || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return <div className="workflow-asset-groups"><Input allowClear size="small" className="mb-2 w-full" value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<Search className="size-3.5 text-foreground/35" />} placeholder="Search asset name" aria-label="Search Lens Assets" /><Select size="small" className="mb-2 w-full" value={category} options={[{ value: "all", label: `All assets (${Object.values(assetsQuery.data?.categoryCounts || {}).reduce((sum, count) => sum + count, 0)}）` }, ...Object.entries(assetsQuery.data?.categoryCounts || {}).filter(([, count]) => count > 0).map(([value, count]) => ({ value, label: `${assetCategoryLabel(value)}（${count}）` }))]} onChange={(value) => { setCategory(value); setPage(1); }} />{assetsQuery.isLoading ? <div className="py-6 text-center text-xs text-foreground/45">Reading assets...</div> : groups.length ? groups.map(([groupCategory, assets]) => <section key={groupCategory}><h3>{assetCategoryLabel(groupCategory)} <span>({assets.length})</span></h3><div className="workflow-asset-list">{assets.map((asset) => { const reference = asset.primaryVersionId ? referenceByVersionId.get(asset.primaryVersionId) : undefined; const active = Boolean(reference); const previewUrl = assetPreviewUrl(asset); return <button key={asset.id} type="button" className={`workflow-asset-row ${active ? "is-active" : ""}`} disabled={changing || !asset.primaryVersionId} aria-pressed={active} onClick={() => onToggle(asset, reference)}><span className="workflow-asset-thumb">{previewUrl ? <img src={previewUrl} alt="" loading="lazy" /> : asset.category === "character" ? <UsersRound /> : asset.mediaType === "image" ? <ImageIcon /> : <Box />}</span><span className="min-w-0 flex-1"><strong>{asset.title}</strong><small>{active ? "Already bound · Click to cancel" : `${assetCategoryLabel(asset.category)} · v${Math.max(1, asset.versionCount)}`}</small></span>{active ? <span className="workflow-bound-dot" /> : null}</button>; })}</div></section>) : <EmptyState size="compact" title={debouncedKeyword ? "No matching asset found" : "The project has no assets yet"} />}{total > pageSize ? <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[var(--fs-micro)] text-foreground/45"><span>{page}/{pages}  · Total{total}  item</span><span className="flex gap-1"><Button type="text" size="small" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} /><Button type="text" size="small" icon={<ChevronRight className="size-3.5" />} disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} /></span></div> : null}</div>;
}

function ShotAssetMentionTextarea({ value = "", onChange = () => undefined, references, variant = "motion" }: { value?: string; onChange?: (value: string) => void; references: ReturnType<typeof buildShotAssetReferenceContext>["mentionReferences"]; variant?: "scene" | "motion" }) {
    const isScene = variant === "scene";
    return (
        <CanvasResourceMentionTextarea
            value={value}
            references={references}
            onChange={onChange}
            sendOnEnter={false}
            containerClassName={`workflow-shot-mention-container ${isScene ? "is-scene" : ""}`}
            className={`thin-scrollbar workflow-shot-mention-editor ${isScene ? "is-scene" : ""}`}
            placeholder={isScene
                ? references.length ? "Describe subject, scene, action, composition, and lighting; enter @ to reference bound assets" : "Describe the subject, scene, action, composition and light; bind the assets first and then use @ reference"
                : references.length ? "Supplement action rhythm, camera movement changes and dynamic details; enter @ to reference bound assets" : "Supplement action rhythm, camera movement changes and dynamic details; @ reference can be used after binding assets"}
            aria-label={isScene ? "Lens screen, you can use @ to refer to bound assets" : "Video prompt words, you can use @ to refer to bound assets"}
        />
    );
}

function EpisodeLibrary({ detail, activeUnitId, projectId, activeStage }: { detail: ProjectDetail; activeUnitId: string; projectId: string; activeStage: ShortDramaWorkflowStage }) {
    return <div className="workflow-simple-list">{detail.units.slice().sort((left, right) => left.position - right.position).map((unit, index) => <Link key={unit.id} to={`/projects/${projectId}/workflow/${unit.id}/${activeStage}`} className={unit.id === activeUnitId ? "is-active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><strong>{unit.title}</strong></Link>)}</div>;
}

function ShotLibrary({ detail, shots, selectedShotId, onSelectShot }: { detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; onSelectShot: (id: string) => void }) {
    return <div className="workflow-simple-list">{shots.map((shot, index) => { const video = currentArtifact(detail, shot.id, "video"); return <button key={shot.id} type="button" className={shot.id === selectedShotId ? "is-active" : ""} onClick={() => onSelectShot(shot.id)}><span>{formatShotOrdinal(index)}</span><span className="min-w-0 flex-1"><strong>{customShotTitle(shot.title, index) || "Unnamed"}</strong><small>{formatDuration(shot.durationMs)}</small></span><ArtifactStatus artifact={video} compact /></button>; })}</div>;
}

function BoundAssets({ detail, shotId, changing, onUnlink }: { detail: ProjectDetail; shotId: string; changing: boolean; onUnlink: (reference: ShotAssetReference) => void }) {
    const references = (detail.shotReferences || []).filter((item) => item.shotId === shotId);
    const assetByVersionId = useMemo(() => new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset])), [detail.assets]);
    return (
        <div className="workflow-bound-assets">
            <div className="workflow-bound-assets-heading"><span className="workflow-field-label">lens assets</span><small>{references.length ? `Bound${references.length} item` : "Click Binding from the asset bar on the left"}</small></div>
            <Image.PreviewGroup>
                <div className="workflow-bound-assets-content">
                    {references.length ? references.map((reference) => {
                        const asset = reference.asset || assetByVersionId.get(reference.assetVersionId);
                        const title = asset?.title || "Historical asset version";
                        const previewUrl = asset ? assetPreviewUrl(asset) : "";
                        return <div key={reference.id} className="workflow-bound-asset-chip">
                            <span className="workflow-bound-asset-preview">{previewUrl ? <Image src={previewUrl} alt={`${title}Preview`} width={40} height={40} loading="lazy" preview={{ mask: "Preview" }} /> : <Box aria-hidden />}</span>
                            <span className="workflow-bound-asset-copy"><em>{asset ? assetCategoryLabel(asset.category) : "history"}</em><strong title={title}>{title}</strong></span>
                            <button type="button" disabled={changing} aria-label={`dereference${title}`} onClick={() => onUnlink(reference)}><X aria-hidden /></button>
                        </div>;
                    }) : <span>No characters, scenes or props have been bound yet</span>}
                </div>
            </Image.PreviewGroup>
        </div>
    );
}

function LatestPreview({ artifact, emptyText, onPreviewImage }: { artifact?: ShotArtifact; emptyText: string; onPreviewImage: (artifact: ShotArtifact) => void }) {
    if (!artifact?.resourceId) return <div className="workflow-media-empty"><span><Play className="size-7" /></span><p>{emptyText}</p></div>;
    const src = resourceFileUrl(artifact.resourceId);
    if (artifact.type === "video") return <VideoArtifactPreview src={src} title="Lens video" />;
    return <button type="button" className="workflow-preview-media-button" onClick={() => onPreviewImage(artifact)} aria-label={artifact.type === "action_board" ? "Click to preview action preview" : "Click to preview the storyboard"}>
        <img className={`workflow-preview-media ${artifact.type === "action_board" ? "grayscale" : ""}`} src={src} alt="Lens generation preview" loading="eager" />
        <span className="workflow-preview-expand" aria-hidden="true"><Maximize2 className="size-4" /></span>
    </button>;
}

function VideoArtifactPreview({ src, title }: { src: string; title: string }) {
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        setPlaying(false);
    }, [src]);

    if (playing) return <video className="workflow-preview-media" src={src} controls autoPlay playsInline preload="metadata" aria-label={title} />;
    return <button type="button" className="workflow-preview-media-button workflow-video-poster" onClick={() => setPlaying(true)} aria-label={`Click to play${title}`}>
        <span className="workflow-preview-media workflow-video-placeholder" aria-hidden="true"><Film /></span>
        <span className="workflow-video-play" aria-hidden="true"><Play className="size-6" fill="currentColor" /></span>
    </button>;
}

function ArtifactHistory({ artifacts, activeId, onSelect, compact = false }: { artifacts: ShotArtifact[]; activeId?: string; onSelect: (artifact: ShotArtifact) => void; compact?: boolean }) {
    if (!artifacts.length) return compact ? null : <EmptyState size="compact" title="No historical version yet" />;
    return <section className={`workflow-history ${compact ? "is-compact" : ""}`}><div className="workflow-history-title">Historical version</div>{artifacts.map((artifact) => <button key={artifact.id} type="button" className={artifact.id === activeId ? "is-active" : ""} onClick={() => onSelect(artifact)}>{artifact.resourceId ? artifact.type === "video" ? <video src={resourceFileUrl(artifact.resourceId)} muted preload="metadata" /> : <img src={resourceFileUrl(artifact.resourceId)} alt="" loading="lazy" /> : <span className="workflow-history-placeholder"><Layers3 /></span>}<span className="min-w-0 flex-1"><strong>v{artifact.version}{artifact.selected ? " · Current" : ""}</strong><small>{new Date(artifact.createdAt).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><ArtifactStatus artifact={artifact} compact /></button>)}</section>;
}

function ShotTimeline({ activeStage, detail, shots, selectedShotId, submittingShotIds, onSelectShot, onAddShot, addingShot }: { activeStage: ShortDramaWorkflowStage; detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; submittingShotIds: Set<string>; onSelectShot: (id: string) => void; onAddShot: () => void; addingShot: boolean }) {
    const artifactType = artifactTypeForStage(activeStage);
    const latestTaskByShotId = useMemo(() => {
        const tasks = new Map<string, GenerationTask>();
        for (const task of detail.tasks || []) {
            const shotId = task.clientContext?.shotId;
            if (!shotId || task.clientContext?.artifactType !== artifactType) continue;
            const current = tasks.get(shotId);
            if (!current || task.updatedAt > current.updatedAt) tasks.set(shotId, task);
        }
        return tasks;
    }, [artifactType, detail.tasks]);
    return <section className="workflow-shot-timeline"><header><div><strong>{detail.units.find((item) => item.id === shots[0]?.unitId)?.title || "This episode"}</strong><span>{shots.length}  Mirror · Total duration{formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))}</span></div><div className="flex items-center gap-1 text-[var(--fs-micro)] text-foreground/40"><List className="size-3.5" />  total{shots.length}  mirror</div></header><div className="workflow-shot-track thin-scrollbar">{shots.map((shot, index) => <TimelineShot key={shot.id} artifactType={artifactType} detail={detail} shot={shot} task={latestTaskByShotId.get(shot.id)} submitting={submittingShotIds.has(shot.id)} index={index} selected={shot.id === selectedShotId} onSelect={() => onSelectShot(shot.id)} />)}<button type="button" className="workflow-add-shot-card" disabled={addingShot} onClick={onAddShot}><Plus className="size-5" /><span>Add storyboard</span></button></div></section>;
}

function TimelineShot({ artifactType, detail, shot, task, submitting, index, selected, onSelect }: { artifactType: string; detail: ProjectDetail; shot: ProjectShot; task?: GenerationTask; submitting: boolean; index: number; selected: boolean; onSelect: () => void }) {
    const video = currentArtifact(detail, shot.id, "video");
    const previz = currentArtifact(detail, shot.id, "action_board");
    const storyboard = currentArtifact(detail, shot.id, "storyboard");
    const preview = video?.resourceId ? video : previz?.resourceId ? previz : storyboard?.resourceId ? storyboard : undefined;
    const stateArtifact = artifactType === "video" ? video : artifactType === "action_board" ? previz : storyboard;
    const revision = currentRevision(detail, shot);
    const stageLabel = artifactType === "video" ? "Lens video" : artifactType === "action_board" ? "action rehearsal" : "Storyboard";
    const cameraMeta = [revision?.shotSize, revision?.cameraMovement].filter(Boolean).join(" · ") || "Waiting for supplementary lens parameters";
    return <button type="button" className={`workflow-timeline-shot ${selected ? "is-active" : ""}`} onClick={onSelect}><span className="workflow-timeline-media">{preview?.resourceId && preview.type !== "video" ? <img src={resourceFileUrl(preview.resourceId)} alt="" loading="lazy" /> : <Film />}</span><span className="workflow-timeline-copy"><span className="workflow-timeline-heading"><strong>{formatShotOrdinal(index)}</strong><b>{formatDuration(shot.durationMs)}</b></span>{customShotTitle(shot.title, index) ? <em className="workflow-timeline-title">{customShotTitle(shot.title, index)}</em> : null}<small className="workflow-timeline-meta">{cameraMeta}</small><span className="workflow-timeline-status"><span>{stageLabel}{stateArtifact ? ` · v${stateArtifact.version}` : ""}</span><ArtifactStatus artifact={stateArtifact} taskStatus={submitting ? "queued" : task?.status} compact /></span></span></button>;
}

function revisionInput(values: ShotEditorValues): ShotRevisionInput {
    return {
        plotDescription: values.plotDescription,
        action: values.action,
        dialogue: values.dialogue,
        shotSize: values.shotSize,
        cameraAngle: values.cameraAngle,
        cameraMovement: values.cameraMovement,
        durationMs: Math.round(values.durationSeconds * 1000),
        imagePrompt: values.imagePrompt,
        videoPrompt: values.videoPrompt,
        negativePrompt: values.negativePrompt,
        continuityNotes: values.continuityNotes,
    };
}

async function downloadArtifact(artifact: ShotArtifact, shotTitle: string, onError: (content: string) => void) {
    if (!artifact.resourceId) return;
    try {
        const response = await fetch(resourceFileUrl(artifact.resourceId), { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${shotTitle || "shot"}-v${artifact.version}.${artifact.type === "video" ? "mp4" : "png"}`;
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        onError(error instanceof Error ? `Download failed:${error.message}` : "Download failed");
    }
}

function assetPreviewUrl(asset: ProjectAsset) {
    const representation = asset.character?.representations?.find((item) => item.role === "primary") || asset.character?.representations?.[0];
    if (representation?.resourceId) return resourceFileUrl(representation.resourceId);
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return resourceId && asset.mediaType === "image" ? resourceFileUrl(resourceId) : "";
}
