import { App, Button, Dropdown, Form, Input, InputNumber, Modal, Popconfirm } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Callout } from "@/components/ui/product/callout";
import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    Bold,
    Check,
    ChevronDown,
    Clapperboard,
    Code2,
    Crosshair,
    Eraser,
    FileUp,
    GripVertical,
    Highlighter,
    Italic,
    Link2,
    List,
    ListOrdered,
    Minus,
    MoreHorizontal,
    MoveVertical,
    Plus,
    Quote,
    Redo2,
    Save,
    Search,
    Strikethrough,
    Trash2,
    Underline,
    Undo2,
    UsersRound,
    X,
} from "lucide-react";

import { useNavigate, useParams } from "react-router";

import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { ModelPicker } from "@/components/model-picker";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { decodeNovelText, splitTextIntoChapters } from "@/lib/canvas/canvas-document";
import { navigateToSettings } from "@/lib/settings-navigation";
import {
    createProjectAssetCandidates,
    createProjectUnit,
    deleteProjectUnit,
    importProjectUnits,
    listChapterApplyReceipts,
    replaceProjectUnitShots,
    reorderProjectUnits,
    updateProjectUnit,
    type ProjectDetail,
    type ProjectUnit,
} from "@/services/api/projects";
import { ApiError } from "@/services/api/request";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { listGenerationTasks, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";

import { formatCount, formatTime, statusLabel, type ProjectDetailViewProps } from "./shared";
import { chapterStoryboardAssets, chapterStoryboardCharacters, chapterStoryboardReplaceImpact, storyboardRowsToProjectShots } from "./chapter-storyboard-production";
import { chapterAssetsFromGenerationTask, chapterStoryboardFromGenerationTask, chapterStoryboardRecoveryDecision, chapterTaskIdentity, extractChapterAssets, generateChapterStoryboard } from "./project-chapter-ai";

const CHAPTER_ROW_HEIGHT = 62;
const MAX_NOVEL_IMPORT_CHAPTERS = 2500;
type ChapterOperationKind = "characters" | "storyboard";
type ChapterOperation = { startedAt: number; taskId?: string };
type PendingStoryboardRecovery = {
    taskId: string;
    chapterId: string;
    rows: ReturnType<typeof chapterStoryboardFromGenerationTask>["rows"];
};

function formatChapterListCount(value: number) {
    if (value < 10_000) return formatCount(value);
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function ProjectChaptersView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { chapterId = "" } = useParams();
    const initialSelectedId = detail.units.some((unit) => unit.id === chapterId) ? chapterId : detail.units[0]?.id || "";
    const [selectedId, setSelectedId] = useState(initialSelectedId);
    const [createOpen, setCreateOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [moveTargetId, setMoveTargetId] = useState("");
    const [movePosition, setMovePosition] = useState<number | null>(null);
    const [orderedIds, setOrderedIds] = useState(() => detail.units.map((unit) => unit.id));
    const [draggedId, setDraggedId] = useState("");
    const [draftTitle, setDraftTitle] = useState("");
    const [draftHtml, setDraftHtml] = useState("");
    const [dirty, setDirty] = useState(false);
    const [characterExtractOpen, setCharacterExtractOpen] = useState(false);
    const [storyboardOpen, setStoryboardOpen] = useState(false);
    const [chapterOperations, setChapterOperations] = useState<Record<string, ChapterOperation>>({});
    const [completedChapterOperations, setCompletedChapterOperations] = useState<Record<string, true>>({});
    const [operationNow, setOperationNow] = useState(() => Date.now());
    const [selectedTextModel, setSelectedTextModel] = useState("");
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const [pendingStoryboardRecoveries, setPendingStoryboardRecoveries] = useState<Record<string, PendingStoryboardRecovery>>({});
    const { skills: availableSkills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const listRef = useRef<HTMLDivElement>(null);
    const locallyOwnedTaskIdsRef = useRef(new Set<string>());
    const recoveredTaskIdsRef = useRef(new Set<string>());
    const recoveringTaskIdsRef = useRef(new Set<string>());
    const applyingStoryboardRecoveryRef = useRef(false);
    const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase("en-US"));
    const orderedUnits = useMemo(() => {
        const byId = new Map(detail.units.map((unit) => [unit.id, unit]));
        return orderedIds.map((id) => byId.get(id)).filter((unit): unit is ProjectUnit => Boolean(unit));
    }, [detail.units, orderedIds]);
    const selectedUnitSummary = detail.units.find((unit) => unit.id === selectedId) || orderedUnits[0];
    const chapterTasksQuery = useQuery({
        queryKey: ["project-chapter-generation-tasks", detail.project.id],
        queryFn: () => listGenerationTasks(100, { projectId: detail.project.id }),
        refetchInterval: (query) => query.state.data?.some((task) => {
            const identity = chapterTaskIdentity(task);
            return Boolean(identity && (task.status === "queued" || task.status === "running"));
        }) ? 2_000 : false,
        refetchOnWindowFocus: true,
    });
    const selectedUnit = selectedUnitSummary;
    const chapterNumberById = useMemo(() => new Map(orderedUnits.map((unit, index) => [unit.id, index + 1])), [orderedUnits]);
    const canvasCountByUnitId = useMemo(() => new Map(Object.entries(detail.unitCanvasCounts || {}).map(([unitId, count]) => [unitId, Number(count)])), [detail.unitCanvasCounts]);
    const storyboardImpact = useMemo(() => chapterStoryboardReplaceImpact(detail, selectedUnit?.id || ""), [detail, selectedUnit?.id]);
    const serverChapterOperations = useMemo(() => {
        const operations = new Map<string, ChapterOperation>();
        for (const task of chapterTasksQuery.data || []) {
            if (task.status !== "queued" && task.status !== "running") continue;
            const identity = chapterTaskIdentity(task);
            if (!identity) continue;
            const key = chapterOperationKey(identity.chapterId, identity.kind);
            if (!operations.has(key)) operations.set(key, chapterOperationFromTask(task));
        }
        return operations;
    }, [chapterTasksQuery.data]);
    const serverCompletedOperations = useMemo(() => {
        const latest = new Map<string, GenerationTask>();
        for (const task of chapterTasksQuery.data || []) {
            const identity = chapterTaskIdentity(task);
            if (!identity) continue;
            const key = chapterOperationKey(identity.chapterId, identity.kind);
            if (!latest.has(key)) latest.set(key, task);
        }
        return new Set([...latest].filter(([, task]) => task.status === "succeeded").map(([key]) => key));
    }, [chapterTasksQuery.data]);
    const runningOperationCount = new Set([...Object.keys(chapterOperations), ...serverChapterOperations.keys()]).size;
    const characterOperation = selectedUnit ? chapterOperations[chapterOperationKey(selectedUnit.id, "characters")] || serverChapterOperations.get(chapterOperationKey(selectedUnit.id, "characters")) : undefined;
    const storyboardOperation = selectedUnit ? chapterOperations[chapterOperationKey(selectedUnit.id, "storyboard")] || serverChapterOperations.get(chapterOperationKey(selectedUnit.id, "storyboard")) : undefined;
    const pendingStoryboardRecovery = selectedUnit ? pendingStoryboardRecoveries[selectedUnit.id] : undefined;
    const charactersGenerated = Boolean(selectedUnit && (completedChapterOperations[chapterOperationKey(selectedUnit.id, "characters")] || serverCompletedOperations.has(chapterOperationKey(selectedUnit.id, "characters")) || detail.assetCandidates.some((candidate) => candidate.unitId === selectedUnit.id && candidate.category === "character")));
    const storyboardGenerated = Boolean(selectedUnit && (completedChapterOperations[chapterOperationKey(selectedUnit.id, "storyboard")] || serverCompletedOperations.has(chapterOperationKey(selectedUnit.id, "storyboard")) || storyboardImpact.shotCount > 0));
    const visibleUnits = useMemo(() => {
        if (!deferredSearchQuery) return orderedUnits;
        const numericQuery = /^\d+$/.test(deferredSearchQuery) ? deferredSearchQuery.replace(/^0+/, "") || "0" : "";
        return orderedUnits.filter((unit, index) => (numericQuery && String(index + 1).startsWith(numericQuery)) || unit.title.toLocaleLowerCase("en-US").includes(deferredSearchQuery));
    }, [deferredSearchQuery, orderedUnits]);
    const chapterVirtualizer = useVirtualizer({
        count: visibleUnits.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => CHAPTER_ROW_HEIGHT,
        getItemKey: (index) => visibleUnits[index]?.id || index,
        initialOffset: () => readStoredScroll(`project-chapters:${detail.project.id}`),
        onChange: (instance, scrolling) => {
            if (!scrolling && instance.scrollOffset !== null) sessionStorage.setItem(`project-chapters:${detail.project.id}`, String(instance.scrollOffset));
        },
        overscan: 10,
    });

    useEffect(() => {
        setOrderedIds(detail.units.slice().sort((left, right) => left.position - right.position).map((unit) => unit.id));
        if (!detail.units.some((unit) => unit.id === selectedId)) setSelectedId(detail.units[0]?.id || "");
    }, [detail.units, selectedId]);

    useEffect(() => {
        if (!chapterId || chapterId === selectedId || dirty || !detail.units.some((unit) => unit.id === chapterId)) return;
        setSelectedId(chapterId);
    }, [chapterId, detail.units, dirty, selectedId]);

    useEffect(() => {
        if (!chapterId || dirty || detail.units.some((unit) => unit.id === chapterId)) return;
        const firstId = orderedUnits[0]?.id;
        navigate(firstId ? `/projects/${detail.project.id}/chapters/${firstId}` : `/projects/${detail.project.id}/chapters`, { replace: true });
    }, [chapterId, detail.project.id, detail.units, dirty, navigate, orderedUnits]);

    useEffect(() => {
        if (selectedId) sessionStorage.setItem(`project-active-chapter:${detail.project.id}`, selectedId);
    }, [detail.project.id, selectedId]);

    useEffect(() => {
        if (!runningOperationCount) return;
        setOperationNow(Date.now());
        const timer = window.setInterval(() => setOperationNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [runningOperationCount]);

    const saveMutation = useMutation({
        mutationFn: () => selectedUnit
            ? updateProjectUnit(detail.project.id, selectedUnit.id, {
                title: draftTitle.trim(),
                sourceText: draftHtml,
                status: stripHtml(draftHtml) ? "ready" : "draft",
            })
            : Promise.reject(new Error("Please select a chapter")),
        onSuccess: ({ unit }) => {
            queryClient.setQueryData(["project-unit", detail.project.id, unit.id], { unit });
            queryClient.setQueryData<{ units: ProjectDetail["units"]; canvasCounts: Record<string, number> }>(["project", detail.project.id, "units"], (current) => current ? {
                ...current,
                units: current.units.map((item) => item.id === unit.id ? {
                    ...item,
                    title: unit.title,
                    wordCount: unit.wordCount,
                    status: unit.status,
                    updatedAt: unit.updatedAt,
                } : item),
            } : current);
            setDirty(false);
            refreshProject();
            message.success("Chapter saved");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Chapter saving failed"),
    });
    const createMutation = useMutation({
        mutationFn: (values: { title: string; sourceText?: string }) => createProjectUnit(detail.project.id, { kind: "chapter", title: values.title, sourceText: plainTextToHtml(values.sourceText || ""), position: detail.units.length }),
        onSuccess: ({ unit }) => { setCreateOpen(false); setSelectedId(unit.id); refreshProject(); navigate(`/projects/${detail.project.id}/chapters/${unit.id}`); message.success("Chapter created"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "Chapter creation failed"),
    });
    const importMutation = useMutation({
        mutationFn: (chapters: Array<{ title: string; plainText: string }>) => importProjectUnits(detail.project.id, chapters.map((chapter) => ({ kind: "chapter", title: chapter.title, sourceText: plainTextToHtml(chapter.plainText) }))),
        onSuccess: ({ units }) => { setImportOpen(false); if (units[0]) { setSelectedId(units[0].id); navigate(`/projects/${detail.project.id}/chapters/${units[0].id}`); } refreshProject(); message.success(`Imported${units.length} chapter`); },
        onError: (error) => message.error(error instanceof Error ? error.message : "Novel import failed"),
    });
    const reorderMutation = useMutation({
        mutationFn: (unitIds: string[]) => reorderProjectUnits(detail.project.id, unitIds),
        onSuccess: () => { refreshProject(); message.success("Chapter order updated"); },
        onError: (error) => { refreshProject(); message.error(error instanceof Error ? error.message : "Chapter sorting failed"); },
    });
    const deleteMutation = useMutation({
        mutationFn: (unitId: string) => deleteProjectUnit(detail.project.id, unitId),
        onSuccess: (_, unitId) => {
            const index = orderedIds.indexOf(unitId);
            const remaining = orderedIds.filter((id) => id !== unitId);
            setOrderedIds(remaining);
            if (selectedId === unitId) {
                const nextId = remaining[Math.min(index, remaining.length - 1)] || "";
                setSelectedId(nextId);
                navigate(nextId ? `/projects/${detail.project.id}/chapters/${nextId}` : `/projects/${detail.project.id}/chapters`, { replace: true });
            }
            refreshProject();
            message.success("Chapter deleted");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Chapter deletion failed"),
    });

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TextStyle,
            Color.configure({ types: ["textStyle"] }),
            Highlight.configure({ multicolor: true }),
            CharacterCount,
            Placeholder.configure({ placeholder: "Start writing the story from this chapter..." }),
        ],
        content: selectedUnit?.sourceText || "",
        editorProps: { attributes: { class: "project-chapter-editor focus:outline-none" } },
        onUpdate: ({ editor: nextEditor }) => { setDraftHtml(nextEditor.getHTML()); setDirty(true); },
    });

    useEffect(() => {
        if (!selectedUnitSummary) return;
        setDraftTitle(selectedUnitSummary.title);
        setDraftHtml("");
        setDirty(false);
    }, [selectedUnitSummary?.id]);

    useEffect(() => {
        const loadedUnit = selectedUnit;
        if (!loadedUnit || !editor) return;
        setDraftTitle(loadedUnit.title);
        setDraftHtml(loadedUnit.sourceText || "");
        setDirty(false);
        editor.commands.setContent(loadedUnit.sourceText || "", { emitUpdate: false });
        // 只在切换章节时装载服务端内容，避免项目刷新覆盖当前未保存正文。
    }, [editor, selectedUnit?.id]);

    const wordCount = useMemo(() => editor?.storage.characterCount?.characters?.() || stripHtml(draftHtml).length || 0, [draftHtml, editor]);
    const chapterCanvasCount = (unitId: string) => canvasCountByUnitId.get(unitId) || 0;
    const chapterAnalysisInput = (textModel: string) => {
        const unit = selectedUnit;
        if (!unit) throw new Error("Chapter text has not been loaded yet");
        if (dirty) throw new Error("Please save the current chapter before running AI analysis");
        const sourceText = editor?.getText().trim() || stripHtml(unit.sourceText);
        if (!sourceText) throw new Error("There is no analyzable text in the current chapter");
        const config = { ...effectiveConfig, model: textModel, textModel };
        if (!textModel || !isAiConfigReady(config, textModel)) {
            navigateToSettings({ continueCreation: true });
            return null;
        }
        return {
            projectId: detail.project.id,
            projectName: detail.project.name,
            chapterId: unit.id,
            chapterTitle: unit.title,
            sourceText,
            projectStyle: resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson)?.prompt || "",
            config,
        };
    };
    const beginChapterOperation = (unitId: string, kind: ChapterOperationKind) => {
        const key = chapterOperationKey(unitId, kind);
        const startedAt = Date.now();
        setOperationNow(startedAt);
        setChapterOperations((current) => ({ ...current, [key]: { startedAt } }));
    };
    const updateChapterOperation = (unitId: string, kind: ChapterOperationKind, task: GenerationTask) => {
        const key = chapterOperationKey(unitId, kind);
        const taskStartedAt = Date.parse(task.startedAt || task.createdAt);
        locallyOwnedTaskIdsRef.current.add(task.id);
        setChapterOperations((current) => ({
            ...current,
            [key]: {
                startedAt: Number.isFinite(taskStartedAt) ? taskStartedAt : current[key]?.startedAt || Date.now(),
                taskId: task.id,
            },
        }));
    };
    const finishChapterOperation = (unitId: string, kind: ChapterOperationKind) => {
        const key = chapterOperationKey(unitId, kind);
        setChapterOperations((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
    };
    const markChapterOperationCompleted = (unitId: string, kind: ChapterOperationKind) => {
        setCompletedChapterOperations((current) => ({ ...current, [chapterOperationKey(unitId, kind)]: true }));
    };
    const storeExtractedAssets = async (unitId: string, assets: Awaited<ReturnType<typeof extractChapterAssets>>, write: { sourceTaskId: string }) => {
        // 去重由服务端按分类、名称及别名统一完成，避免使用页面分页快照漏判。
        const candidates = [
            ...assets.characters.map((asset) => ({ unitId, name: asset.name, category: "character" as const, details: { ...asset } })),
            ...assets.scenes.map((asset) => ({ unitId, name: asset.name, category: "environment" as const, details: { ...asset } })),
            ...assets.props.map((asset) => ({ unitId, name: asset.name, category: "prop" as const, details: { ...asset } })),
        ];
        const created = await createProjectAssetCandidates(detail.project.id, candidates, "chapter_character_extract", {
            sourceTaskId: write.sourceTaskId,
        });
        markChapterOperationCompleted(unitId, "characters");
        refreshProject();
        return created.candidates.length;
    };
    const storeGeneratedStoryboard = async (
        unitId: string,
        rows: ReturnType<typeof chapterStoryboardFromGenerationTask>["rows"],
        approved: { revision: number; shotIds: string[] },
        write: { sourceTaskId: string },
    ) => {
        const shots = storyboardRowsToProjectShots(rows, detail);
        await replaceProjectUnitShots(detail.project.id, unitId, shots, approved.shotIds, approved.revision, {
            sourceTaskId: write.sourceTaskId,
        });
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["project", detail.project.id] }),
            queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
        markChapterOperationCompleted(unitId, "storyboard");
        return shots.length;
    };
    const extractCharacters = async () => {
        let operationUnitId = "";
        try {
            const input = chapterAnalysisInput(selectedTextModel);
            if (!input) return;
            operationUnitId = input.chapterId;
            setCharacterExtractOpen(false);
            beginChapterOperation(operationUnitId, "characters");
            message.info("The task of extracting characters, scenes and props has started. You can continue to edit or switch chapters.");
            const assets = await extractChapterAssets(input, { onTaskUpdate: (task) => updateChapterOperation(operationUnitId, "characters", task) });
            const freshCount = await storeExtractedAssets(operationUnitId, assets, { sourceTaskId: assets.taskId });
            if (!freshCount) {
                message.info("No new assets: the extraction is empty or the asset already exists");
                return;
            }
            message.success(`Extracted${freshCount} characters, scenes or props, please go to the project assets to confirm`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Chapter asset extraction failed");
        } finally {
            if (operationUnitId) finishChapterOperation(operationUnitId, "characters");
        }
    };
    const createStoryboard = async () => {
        const unit = selectedUnit;
        if (!unit) return message.warning("Chapter text has not been loaded yet");
        if (dirty) return message.warning("Please save the current chapter first and then reuse the component.");
        if (detail.project.status === "archived") return message.warning("The project has been archived, please restore it in the project settings first");
        const sourceText = editor?.getText().trim() || stripHtml(unit.sourceText);
        if (!sourceText) return message.warning("There is no text available for storyboarding in the current chapter");
        const projectStyle = resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson);
        if (!projectStyle?.prompt.trim()) return message.warning("Please select the project style in the project settings first, and then re-compose it.");
        const textModel = selectedTextModel;
        const config = { ...effectiveConfig, model: textModel, textModel };
        if (!isAiConfigReady(config, textModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const approvedRevision = detail.project.revision;
        const approvedShotIds = detail.shots.filter((shot) => shot.unitId === unit.id).map((shot) => shot.id);
        if (storyboardImpact.shotCount && !(await confirmStoryboardReplacement(storyboardImpact))) return;
        setStoryboardOpen(false);
        beginChapterOperation(unit.id, "storyboard");
        message.info("The storyboard generation task has started. You can continue to edit or switch chapters.");
        let generated: Awaited<ReturnType<typeof generateChapterStoryboard>> | undefined;
        try {
            generated = await generateChapterStoryboard({
                projectId: detail.project.id,
                chapterId: unit.id,
                chapterTitle: unit.title,
                sourceText,
                projectStyle: {
                    presetId: projectStyle.id,
                    title: projectStyle.title,
                    prompt: projectStyle.prompt,
                    profileJson: detail.project.styleProfileJson,
                },
                characters: chapterStoryboardCharacters(detail, unit.id),
                assets: chapterStoryboardAssets(detail),
                config,
                skills: availableSkills,
                selectedSkillIds,
                approvedRevision,
                approvedShotIds,
            }, { onTaskUpdate: (task) => updateChapterOperation(unit.id, "storyboard", task) });
            const shotCount = await storeGeneratedStoryboard(unit.id, generated.rows, { revision: approvedRevision, shotIds: approvedShotIds }, { sourceTaskId: generated.taskId });
            message.success(generated.skillCount ? `Generated${shotCount} storyboards and apply${generated.skillCount} skills` : `Generated${shotCount} storyboard`);
            navigate(`/projects/${detail.project.id}/workflow/${unit.id}/storyboard`);
        } catch (error) {
            if (generated && isStoryboardReplacementConflict(error)) {
                queuePendingStoryboardRecovery({ taskId: generated.taskId, chapterId: unit.id, rows: generated.rows });
                message.warning("The storyboard of this chapter has been changed, but the generated results are still retained. Check the current shot before writing.");
                return;
            }
            refreshProject();
            message.error(error instanceof Error ? `Chapter storyboard generation failed:${error.message}` : "Chapter storyboard generation failed");
        } finally {
            finishChapterOperation(unit.id, "storyboard");
        }
    };
    const confirmStoryboardReplacement = (impact: ReturnType<typeof chapterStoryboardReplaceImpact>) => new Promise<boolean>((resolve) => {
        modal.confirm({
            title: `Replace the existing ones in this chapter${impact.shotCount} A storyboard?`,
            content: (
                <div className="space-y-2 text-sm leading-6 text-foreground/62">
                    <p>After the new storyboard is successfully generated, the system will replace the entire chapter data; if the generation fails, the existing storyboard will not be affected.</p>
                    <p>Replacement will remove{impact.shotCount}  lens,{impact.revisionCount}  script version,{impact.referenceCount}  asset reference,{impact.artifactCount}  product{impact.candidateCount ? `and${impact.candidateCount} related candidate assets` : ""}, this operation cannot be undone.</p>
                </div>
            ),
            okText: "Replace after successful generation",
            okButtonProps: { danger: true },
            cancelText: "Keep existing storyboards",
            centered: true,
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
    const confirmRecoveredStoryboardWrite = (impact: ReturnType<typeof chapterStoryboardReplaceImpact>, rowCount: number) => new Promise<boolean>((resolve) => {
        modal.confirm({
            title: impact.shotCount ? `Use the generated${rowCount} Replace the current storyboard of this chapter with a storyboard?` : `Put the generated${rowCount} A storyboard is included in this chapter?`,
            content: (
                <div className="space-y-2 text-sm leading-6 text-foreground/62">
                    <p>It will not be regenerated or charged again. It will be written after confirmation; if canceled, the result will still be retained.</p>
                    {impact.shotCount ? (
                        <p>Replacement will remove{impact.shotCount}  lens,{impact.revisionCount}  script version,{impact.referenceCount}  asset reference,{impact.artifactCount}  product{impact.candidateCount ? `and${impact.candidateCount} related candidate assets` : ""}, this operation cannot be undone.</p>
                    ) : null}
                </div>
            ),
            okText: "Write the generated storyboard",
            okButtonProps: { danger: Boolean(impact.shotCount) },
            cancelText: "Don't write yet",
            centered: true,
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
    const queuePendingStoryboardRecovery = (pending: PendingStoryboardRecovery) => {
        setPendingStoryboardRecoveries((current) => ({ ...current, [pending.chapterId]: pending }));
    };
    const clearPendingStoryboardRecovery = (chapterId: string) => {
        setPendingStoryboardRecoveries((current) => {
            if (!current[chapterId]) return current;
            const next = { ...current };
            delete next[chapterId];
            return next;
        });
    };
    const applyPendingStoryboardRecovery = async (pending: PendingStoryboardRecovery) => {
        if (applyingStoryboardRecoveryRef.current) return;
        const reviewedRevision = detail.project.revision;
        const reviewedShotIds = detail.shots.filter((shot) => shot.unitId === pending.chapterId).map((shot) => shot.id);
        const impact = chapterStoryboardReplaceImpact(detail, pending.chapterId);
        if (!(await confirmRecoveredStoryboardWrite(impact, pending.rows.length))) return;
        applyingStoryboardRecoveryRef.current = true;
        try {
            const shotCount = await storeGeneratedStoryboard(pending.chapterId, pending.rows, { revision: reviewedRevision, shotIds: reviewedShotIds }, { sourceTaskId: pending.taskId });
            clearPendingStoryboardRecovery(pending.chapterId);
            message.success(`has been written${shotCount} storyboard`);
            navigate(`/projects/${detail.project.id}/workflow/${pending.chapterId}/storyboard`);
        } catch (error) {
            refreshProject();
            message.error(error instanceof Error ? error.message : "Storyboard writing failed");
        } finally {
            applyingStoryboardRecoveryRef.current = false;
        }
    };

    useEffect(() => {
        const latestByOperation = new Map<string, { task: GenerationTask; chapterId: string; kind: ChapterOperationKind }>();
        for (const task of chapterTasksQuery.data || []) {
            const identity = chapterTaskIdentity(task);
            if (!identity) continue;
            const key = chapterOperationKey(identity.chapterId, identity.kind);
            if (!latestByOperation.has(key)) latestByOperation.set(key, { task, ...identity });
        }
        const pending = [...latestByOperation.values()].filter(({ task }) => (
            task.status === "succeeded"
            && !locallyOwnedTaskIdsRef.current.has(task.id)
            && !recoveredTaskIdsRef.current.has(task.id)
            && !recoveringTaskIdsRef.current.has(task.id)
        ));
        if (!pending.length) return;
        for (const item of pending) recoveringTaskIdsRef.current.add(item.task.id);
        void (async () => {
            try {
                const { receipts } = await listChapterApplyReceipts(detail.project.id, pending.map((item) => item.task.id));
                const appliedTaskIds = new Set(receipts.filter((receipt) => receipt.applied).map((receipt) => receipt.taskId));
                for (const { task, chapterId: taskChapterId, kind } of pending) {
                    if (chapterStoryboardRecoveryDecision({ alreadyApplied: appliedTaskIds.has(task.id) }).action === "skip") {
                        recoveredTaskIdsRef.current.add(task.id);
                        markChapterOperationCompleted(taskChapterId, kind);
                        continue;
                    }
                    const completedTask = await queryGenerationTask(task.id);
                    if (kind === "characters") {
                        await storeExtractedAssets(taskChapterId, { ...chapterAssetsFromGenerationTask(completedTask), taskId: completedTask.id }, { sourceTaskId: completedTask.id });
                        message.success("The chapter asset extraction results completed before the refresh have been restored");
                        recoveredTaskIdsRef.current.add(task.id);
                        continue;
                    }
                    queuePendingStoryboardRecovery({
                        taskId: completedTask.id,
                        chapterId: taskChapterId,
                        rows: chapterStoryboardFromGenerationTask(completedTask).rows,
                    });
                    message.info("There are already generated storyboards that need to be checked before being written.");
                    recoveredTaskIdsRef.current.add(task.id);
                }
            } catch (error) {
                message.error(error instanceof Error ? `Task result recovery failed:${error.message}` : "Task result recovery failed");
            } finally {
                for (const item of pending) recoveringTaskIdsRef.current.delete(item.task.id);
            }
        })();
    }, [chapterTasksQuery.data, detail]);

    const selectChapter = (unitId: string) => {
        if (unitId === selectedId) return;
        if (dirty) { message.warning("Please save the current chapter first and then switch chapters"); return; }
        setSelectedId(unitId);
        sessionStorage.setItem(`project-active-chapter:${detail.project.id}`, unitId);
        navigate(`/projects/${detail.project.id}/chapters/${unitId}`);
    };
    const moveChapter = (targetId: string) => {
        if (!draggedId || draggedId === targetId || reorderMutation.isPending) return;
        const next = orderedIds.filter((id) => id !== draggedId);
        next.splice(next.indexOf(targetId), 0, draggedId);
        setOrderedIds(next);
        setDraggedId("");
        reorderMutation.mutate(next);
    };
    const moveChapterToPosition = () => {
        if (!moveTargetId || !movePosition || reorderMutation.isPending) return;
        const next = orderedIds.filter((id) => id !== moveTargetId);
        const targetIndex = Math.min(Math.max(movePosition - 1, 0), next.length);
        next.splice(targetIndex, 0, moveTargetId);
        setOrderedIds(next);
        setMoveTargetId("");
        setMovePosition(null);
        reorderMutation.mutate(next);
        window.setTimeout(() => {
            const index = next.indexOf(moveTargetId);
            const visibleIndex = visibleUnits.findIndex((unit) => unit.id === moveTargetId);
            if (!deferredSearchQuery && index >= 0) chapterVirtualizer.scrollToIndex(index, { align: "center" });
            else if (visibleIndex >= 0) chapterVirtualizer.scrollToIndex(visibleIndex, { align: "center" });
        }, 0);
    };
    const revealSelectedChapter = () => {
        if (!selectedId) return;
        setSearchQuery("");
        window.setTimeout(() => {
            const index = orderedIds.indexOf(selectedId);
            if (index >= 0) chapterVirtualizer.scrollToIndex(index, { align: "center" });
        }, 0);
    };
    const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!draggedId || deferredSearchQuery) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const edge = 48;
        if (event.clientY < bounds.top + edge) event.currentTarget.scrollBy({ top: -24 });
        else if (event.clientY > bounds.bottom - edge) event.currentTarget.scrollBy({ top: 24 });
    };

    return (
        <div className="grid h-full min-h-0 min-w-0 w-full grid-rows-[minmax(180px,34vh)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1">
            <aside className="flex min-h-0 min-w-0 w-full flex-col border-b border-border/70 bg-background/28 lg:border-b-0 lg:border-r">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-2.5">
                    <div className="text-xs font-medium text-foreground/55">Chapter<span className="ml-1 tabular-nums text-foreground/35">{detail.units.length.toLocaleString("en-US")}</span></div>
                    <div className="flex items-center gap-0.5">
                        {selectedId ? <Tooltip title="Return to current chapter"><Button type="text" size="small" icon={<Crosshair className="size-3.5" />} aria-label="Return to current chapter" onClick={revealSelectedChapter} /></Tooltip> : null}
                        <Tooltip title="Import novels"><Button type="text" size="small" icon={<FileUp className="size-3.5" />} aria-label="Import novels" onClick={() => setImportOpen(true)} /></Tooltip>
                        <Tooltip title="Add chapter"><Button type="text" size="small" icon={<Plus className="size-4" />} aria-label="Add chapter" onClick={() => setCreateOpen(true)} /></Tooltip>
                    </div>
                </div>
                <div className="shrink-0 border-b border-border/60 p-2">
                    <label className="flex h-8 items-center gap-1.5 rounded-md border border-border/75 bg-background/55 px-2 focus-within:border-[var(--workspace-accent)] focus-within:ring-2 focus-within:ring-[var(--workspace-accent-soft)]">
                        <Search className="size-3.5 shrink-0 text-foreground/32" />
                        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && visibleUnits[0]) selectChapter(visibleUnits[0].id); }} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/28" placeholder="Search title or chapter number" aria-label="Search chapter" />
                        {searchQuery ? <button type="button" onClick={() => setSearchQuery("")} className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover" aria-label="Clear chapter search"><X className="size-3" /></button> : null}
                    </label>
                    {deferredSearchQuery ? <div className="mt-1 px-0.5 text-[var(--fs-micro)] tabular-nums text-foreground/35">found{visibleUnits.length.toLocaleString("en-US")}  Chapter · Use "Move to" to adjust the order when searching</div> : null}
                </div>
                {orderedUnits.length ? (
                    <div ref={listRef} onDragOver={handleListDragOver} className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
                        {visibleUnits.length ? <div className="relative w-full" style={{ height: chapterVirtualizer.getTotalSize() }}>
                            {chapterVirtualizer.getVirtualItems().map((virtualItem) => {
                                const unit = visibleUnits[virtualItem.index];
                                if (!unit) return null;
                                const chapterNumber = chapterNumberById.get(unit.id) || virtualItem.index + 1;
                                const displayedWordCount = dirty && selectedUnit?.id === unit.id ? wordCount : unit.wordCount || 0;
                                const chapterMeta = `${statusLabel(unit.status)} · ${formatCount(displayedWordCount)} word ·${chapterCanvasCount(unit.id)} canvas`;
                                return (
                                    <div key={unit.id} className="absolute left-0 top-0 w-full" style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}>
                                        <div draggable={!dirty && !reorderMutation.isPending && !deferredSearchQuery} onDragStart={(event) => { setDraggedId(unit.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { if (deferredSearchQuery) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={() => moveChapter(unit.id)} onDragEnd={() => setDraggedId("")} className={`group relative flex h-[58px] items-start rounded-lg border px-0.5 transition-colors duration-100 ${unit.id === selectedUnit?.id ? "border-border/90 bg-surface-active" : "border-transparent hover:border-border/60 hover:bg-surface-hover"} ${draggedId === unit.id ? "opacity-45" : ""}`}>
                                            <button type="button" disabled={Boolean(deferredSearchQuery)} className="mt-3.5 grid size-6 shrink-0 cursor-grab place-items-center text-foreground/22 active:cursor-grabbing disabled:cursor-default disabled:opacity-35" aria-label={`Drag the${chapterNumber} Chapter sorting`}><GripVertical className="size-3.5" /></button>
                                            <button type="button" onClick={() => selectChapter(unit.id)} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-14 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]">
                                                <span className={`grid h-8 min-w-8 shrink-0 place-items-center rounded-md px-1 text-[var(--fs-tiny)] font-semibold tabular-nums ${unit.id === selectedUnit?.id ? "bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)]" : "bg-foreground/[.035] text-foreground/35"}`}>{String(chapterNumber).padStart(Math.max(2, String(orderedUnits.length).length), "0")}</span>
                                                <span className="min-w-0 flex-1 overflow-hidden"><span className={`block truncate text-[var(--fs-body)] ${unit.id === selectedUnit?.id ? "font-semibold text-foreground" : "font-medium text-foreground/68"}`}>{unit.title}</span><span title={chapterMeta} className="mt-1 block truncate whitespace-nowrap text-[var(--fs-tiny)] tabular-nums text-foreground/38">{statusLabel(unit.status)} · {formatChapterListCount(displayedWordCount)}  word ·{chapterCanvasCount(unit.id)}  canvas</span></span>
                                            </button>
                                            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "move", icon: <MoveVertical className="size-3.5" />, label: "Move to…" }], onClick: () => { setMoveTargetId(unit.id); setMovePosition(chapterNumber); } }}>
                                                <button type="button" className="absolute right-7 top-1/2 z-[1] grid size-6 -translate-y-1/2 place-items-center rounded text-foreground/28 opacity-0 hover:bg-surface-hover hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100" aria-label={`${unit.title}More actions`}><MoreHorizontal className="size-3.5" /></button>
                                            </Dropdown>
                                            <Popconfirm title="Delete this chapter?" description="The chapter content and associated production records will be deleted, but the associated canvas will not be deleted." okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true, loading: deleteMutation.isPending }} onConfirm={() => deleteMutation.mutate(unit.id)}>
                                                <button type="button" className="absolute right-1 top-1/2 z-[1] grid size-6 -translate-y-1/2 place-items-center rounded text-foreground/28 opacity-0 hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete${unit.title}`}><Trash2 className="size-3.5" /></button>
                                            </Popconfirm>
                                        </div>
                                    </div>
                                );
                            })}
                        </div> : <div className="px-3 py-8 text-center text-xs text-foreground/40">No matching chapters</div>}
                    </div>
                ) : <WorkspaceState icon="projects" compact className="flex-1 px-4" title="No chapter yet" description="After adding chapters, you can continue writing the text and associated canvas." action={<Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>Add chapter</Button>} />}
            </aside>

            <section className="min-h-0 min-w-0 w-full bg-background/18 p-2.5 sm:p-3.5">
                {selectedUnit ? (
                    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/80 bg-background">
                        <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-border/70 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 text-[var(--fs-tiny)] font-medium tabular-nums text-foreground/38">No.{String(orderedUnits.findIndex((unit) => unit.id === selectedUnit.id) + 1).padStart(2, "0")}  chapter</div>
                                <Input variant="borderless" value={draftTitle} disabled={!selectedUnit} onChange={(event) => { setDraftTitle(event.target.value); setDirty(true); }} className="!h-auto !px-0 !py-0 !text-xl !font-semibold !leading-tight disabled:!cursor-wait disabled:!text-foreground" placeholder="Chapter title" />
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/38"><span>{dirty ? "There are unsaved changes" : `Saved in${formatTime(selectedUnit.updatedAt)}`}</span><span>·</span><span>{formatCount(wordCount)}  word</span><span>·</span><span>{chapterCanvasCount(selectedUnit.id)}  canvas</span></div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                <Button size="small" icon={<UsersRound className="size-3.5" />} disabled={!selectedUnit || dirty || Boolean(characterOperation)} loading={Boolean(characterOperation)} onClick={() => { setSelectedTextModel(effectiveConfig.textModel || effectiveConfig.model || effectiveConfig.textModels[0] || ""); setCharacterExtractOpen(true); }} aria-label={characterOperation ? `Extract characters, scenes and props, run${formatOperationElapsed(characterOperation.startedAt, operationNow)}` : "Extract characters, scenes and props"}>{characterOperation ? `Extract Assets (Run${formatOperationElapsed(characterOperation.startedAt, operationNow)}）` : charactersGenerated ? "Extract assets (generated)" : "Extract characters, scenes and props"}</Button>
                                <Button size="small" type="primary" icon={<Clapperboard className="size-3.5" />} disabled={!selectedUnit || dirty || Boolean(storyboardOperation)} loading={Boolean(storyboardOperation)} onClick={() => { setSelectedTextModel(effectiveConfig.textModel || effectiveConfig.model || effectiveConfig.textModels[0] || ""); setSelectedSkillIds([]); setStoryboardOpen(true); }} aria-label={storyboardOperation ? `Generate to storyboard production, run${formatOperationElapsed(storyboardOperation.startedAt, operationNow)}` : "Generate to storyboard production"}>{storyboardOperation ? `Generate to storyboarding (run${formatOperationElapsed(storyboardOperation.startedAt, operationNow)}）` : storyboardGenerated ? "Generate to Storyboarding (Generated)" : "Generate to storyboard production"}</Button>
                                <Button size="small" type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!selectedUnit || !dirty || !draftTitle.trim() || saveMutation.isPending} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{dirty ? "Save" : "saved"}</Button>
                            </div>
                        </header>
                        {pendingStoryboardRecovery ? (
                            <div className="shrink-0 border-b border-border/70 px-4 py-3">
                                <Callout
                                    tone="warning"
                                    title="There are generated storyboards that have not yet been written."
                                    action={<Button size="small" type="primary" onClick={() => void applyPendingStoryboardRecovery(pendingStoryboardRecovery)}>Write after checking</Button>}
                                >
                                                                        The generated storyboards are still there and will not be regenerated. This chapter will be written after confirmation.
                                </Callout>
                            </div>
                        ) : null}
                        <EditorToolbar editor={editor} />
                        <div className="project-chapter-editor-scroll thin-scrollbar min-h-0 flex-1 overflow-y-auto bg-foreground/[.012]">
                            <div className="project-chapter-editor-wrap min-h-full"><EditorContent editor={editor} /></div>
                        </div>
                    </div>
                ) : <WorkspaceState icon="projects" compact className="h-full" title="Please select a chapter" description="Select a chapter from the chapter list on the left to start editing." />}
            </section>
            <CreateChapterModal open={createOpen} onClose={() => setCreateOpen(false)} loading={createMutation.isPending} onSubmit={(values) => createMutation.mutate(values)} />
            <ImportNovelModal open={importOpen} loading={importMutation.isPending} onClose={() => setImportOpen(false)} onImport={(chapters) => importMutation.mutate(chapters)} />
            <Modal className="library-modal" title="Extract chapter characters, scenes and props" open={characterExtractOpen} width={500} okText="Start extraction" cancelText="Cancel" okButtonProps={{ disabled: !selectedTextModel }} onCancel={() => setCharacterExtractOpen(false)} onOk={() => void extractCharacters()} styles={{ body: { paddingTop: 12 } }}>
                <div className="grid gap-4">
                    <div className="rounded-lg border border-border/70 bg-foreground/[.018] px-3 py-2.5">
                        <div className="text-[var(--fs-tiny)] text-foreground/42">Current chapter</div>
                        <div className="mt-1 truncate text-sm font-medium text-foreground/85">{selectedUnit?.title}</div>
                        <div className="mt-1 text-[var(--fs-tiny)] text-foreground/38">The text will be analyzed by the text model selected this time, and the extraction results will be entered into the "Roles and Assets" pending confirmation list.</div>
                    </div>
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-foreground/68">text model</span>
                        <ModelPicker config={effectiveConfig} capability="text" value={selectedTextModel} onChange={setSelectedTextModel} variant="creation" fullWidth placeholder="Select text models for extracting characters, scenes, and props" onMissingConfig={() => navigateToSettings({ continueCreation: true })} />
                    </label>
                </div>
            </Modal>
            <Modal className="library-modal" title="Generate chapter storyboards" open={storyboardOpen} width={560} okText={storyboardImpact.shotCount ? "Regenerate storyboard" : "Generate storyboards"} cancelText="Cancel" okButtonProps={{ disabled: !selectedTextModel }} onCancel={() => setStoryboardOpen(false)} onOk={() => void createStoryboard()} styles={{ body: { paddingTop: 12 } }}>
                <div className="grid gap-4">
                    <div className="rounded-lg border border-border/70 bg-foreground/[.018] px-3 py-2.5">
                        <div className="text-[var(--fs-tiny)] text-foreground/42">Current chapter</div>
                        <div className="mt-1 truncate text-sm font-medium text-foreground/85">{selectedUnit?.title}</div>
                        <div className="mt-1 text-[var(--fs-tiny)] text-foreground/38">The main text will be used as the basis for storyboarding, and the generated results will be directly written into "Storyboarding Production".</div>
                    </div>
                    {storyboardImpact.shotCount ? <Callout tone="warning" title={`This chapter already exists${storyboardImpact.shotCount} storyboard`}>After continuing, a new storyboard will be generated first; after the generation is successful, click Confirm to completely replace the old footage and its associated data.</Callout> : null}
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-foreground/68">text model</span>
                        <ModelPicker config={effectiveConfig} capability="text" value={selectedTextModel} onChange={setSelectedTextModel} variant="creation" fullWidth placeholder="Select a text model for storyboarding" onMissingConfig={() => navigateToSettings({ continueCreation: true })} />
                    </label>
                    <div>
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-foreground/68">Storyboard skills</span>
                            <SkillRuntimePicker profile="shortDrama" skills={availableSkills} loading={skillsLoading} value={selectedSkillIds} onChange={setSelectedSkillIds} placeholder="Select the skills used in this chapter’s storyboard" />
                        </label>
                        <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/42">Optional, maximum 4. The selected skills will be read on demand by the unified Skill Runtime during this build, and the actual versions and files used will be recorded.</p>
                    </div>
                </div>
            </Modal>
            <Modal className="library-modal" title="Move Chapter" open={Boolean(moveTargetId)} width={400} okText="move" cancelText="Cancel" okButtonProps={{ disabled: !movePosition || movePosition < 1 || movePosition > orderedUnits.length, loading: reorderMutation.isPending }} onCancel={() => { setMoveTargetId(""); setMovePosition(null); }} onOk={moveChapterToPosition} styles={{ body: { paddingTop: 12 } }}>
                <div className="text-xs leading-5 text-foreground/50">Enter the target chapter location. Suitable for long-distance adjustment of projects with thousands of chapters, other chapters will be automatically postponed after moving.</div>
                <label className="mt-3 flex items-center gap-2 text-sm"><span className="shrink-0">Move to the</span><InputNumber min={1} max={orderedUnits.length} precision={0} value={movePosition} onChange={setMovePosition} className="min-w-0 flex-1" /><span className="shrink-0">chapters</span></label>
            </Modal>
        </div>
    );
}

function chapterOperationKey(unitId: string, kind: ChapterOperationKind) {
    return `${unitId}:${kind}`;
}

function chapterOperationFromTask(task: GenerationTask): ChapterOperation {
    const startedAt = Date.parse(task.startedAt || task.createdAt);
    return { startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(), taskId: task.id };
}

function isStoryboardReplacementConflict(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 409) return false;
    return error.reason === "project_unit_shots_changed" || error.reason === "project_revision_conflict";
}

function formatOperationElapsed(startedAt: number, now: number) {
    const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}minutes${seconds}sec`;
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
    const setLink = () => {
        if (!editor) return;
        const current = String(editor.getAttributes("link").href || "");
        const href = window.prompt("Enter link address", current);
        if (href === null) return;
        if (!href.trim()) editor.chain().focus().unsetLink().run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
    };
    const setColor = () => {
        const color = window.prompt("Enter the text color, for example #d97706", String(editor?.getAttributes("textStyle").color || "#d97706"));
        if (color?.trim()) editor?.chain().focus().setColor(color.trim()).run();
    };
    const setHighlight = () => {
        const color = window.prompt("Enter a highlight color, such as #fef3c7", String(editor?.getAttributes("highlight").color || "#fef3c7"));
        if (color?.trim()) editor?.chain().focus().toggleHighlight({ color: color.trim() }).run();
    };
    const blockLabel = editor?.isActive("heading", { level: 1 }) ? "Title 1" : editor?.isActive("heading", { level: 2 }) ? "Title 2" : editor?.isActive("heading", { level: 3 }) ? "Title 3" : "Text";
    const alignment = editor?.isActive({ textAlign: "center" }) ? "center" : editor?.isActive({ textAlign: "right" }) ? "right" : editor?.isActive({ textAlign: "justify" }) ? "justify" : "left";
    const alignmentIcon = alignment === "center" ? <AlignCenter className="size-3.5" /> : alignment === "right" ? <AlignRight className="size-3.5" /> : alignment === "justify" ? <AlignJustify className="size-3.5" /> : <AlignLeft className="size-3.5" />;
    return (
        <div className="hide-scrollbar flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/70 px-2">
            <EditorTool editor={editor} label="Cancel" icon={<Undo2 className="size-3.5" />} onClick={() => editor?.chain().focus().undo().run()} />
            <EditorTool editor={editor} label="Redo" icon={<Redo2 className="size-3.5" />} onClick={() => editor?.chain().focus().redo().run()} />
            <ToolbarDivider />
            <Dropdown trigger={["click"]} menu={{ selectedKeys: [blockLabel], items: ["Text", "Title 1", "Title 2", "Title 3"].map((key) => ({ key, label: key })), onClick: ({ key }) => key === "Text" ? editor?.chain().focus().setParagraph().run() : editor?.chain().focus().toggleHeading({ level: Number(key.slice(-1)) as 1 | 2 | 3 }).run() }}>
                <button type="button" className="flex h-7 items-center gap-1 rounded px-2 text-xs text-foreground/60 hover:bg-surface-hover" aria-label="paragraph format">{blockLabel}<ChevronDown className="size-3" /></button>
            </Dropdown>
            <EditorTool editor={editor} label="Bold" icon={<Bold className="size-3.5" />} onClick={() => editor?.chain().focus().toggleBold().run()} active={Boolean(editor?.isActive("bold"))} />
            <EditorTool editor={editor} label="italics" icon={<Italic className="size-3.5" />} onClick={() => editor?.chain().focus().toggleItalic().run()} active={Boolean(editor?.isActive("italic"))} />
            <EditorTool editor={editor} label="Underline" icon={<Underline className="size-3.5" />} onClick={() => editor?.chain().focus().toggleUnderline().run()} active={Boolean(editor?.isActive("underline"))} />
            <EditorTool editor={editor} label="strikethrough" icon={<Strikethrough className="size-3.5" />} onClick={() => editor?.chain().focus().toggleStrike().run()} active={Boolean(editor?.isActive("strike"))} />
            <ToolbarDivider />
            <Dropdown trigger={["click"]} menu={{ selectedKeys: [alignment], items: [{ key: "left", icon: <AlignLeft className="size-3.5" />, label: "left aligned" }, { key: "center", icon: <AlignCenter className="size-3.5" />, label: "center" }, { key: "right", icon: <AlignRight className="size-3.5" />, label: "Align right" }, { key: "justify", icon: <AlignJustify className="size-3.5" />, label: "Justify" }], onClick: ({ key }) => editor?.chain().focus().setTextAlign(key).run() }}>
                <button type="button" className="grid size-7 place-items-center rounded text-foreground/60 hover:bg-surface-hover" aria-label="text alignment">{alignmentIcon}</button>
            </Dropdown>
            <EditorTool editor={editor} label="Bullets" icon={<List className="size-3.5" />} onClick={() => editor?.chain().focus().toggleBulletList().run()} active={Boolean(editor?.isActive("bulletList"))} />
            <EditorTool editor={editor} label="numbered list" icon={<ListOrdered className="size-3.5" />} onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={Boolean(editor?.isActive("orderedList"))} />
            <EditorTool editor={editor} label="Quote" icon={<Quote className="size-3.5" />} onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={Boolean(editor?.isActive("blockquote"))} />
            <EditorTool editor={editor} label="link" icon={<Link2 className="size-3.5" />} onClick={setLink} active={Boolean(editor?.isActive("link"))} />
            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "color", icon: <span className="text-[var(--fs-label)] font-bold text-amber-600">A</span>, label: "text color" }, { key: "highlight", icon: <Highlighter className="size-3.5" />, label: "Highlight color" }, { type: "divider" }, { key: "code", icon: <Code2 className="size-3.5" />, label: "inline code" }, { key: "rule", icon: <Minus className="size-3.5" />, label: "divider" }, { key: "clear", icon: <Eraser className="size-3.5" />, label: "clear format" }], onClick: ({ key }) => { if (key === "color") setColor(); else if (key === "highlight") setHighlight(); else if (key === "code") editor?.chain().focus().toggleCode().run(); else if (key === "rule") editor?.chain().focus().setHorizontalRule().run(); else if (key === "clear") editor?.chain().focus().clearNodes().unsetAllMarks().run(); } }}>
                <button type="button" className="grid size-7 place-items-center rounded text-foreground/60 hover:bg-surface-hover" aria-label="More formats"><MoreHorizontal className="size-4" /></button>
            </Dropdown>
        </div>
    );
}

function EditorTool({ editor, label, icon, active = false, onClick }: { editor: Editor | null; label: string; icon: ReactNode; active?: boolean; onClick: () => void }) {
    return <Tooltip title={label}><button type="button" aria-label={label} className={`grid size-7 shrink-0 place-items-center rounded ${active ? "bg-surface-active text-[var(--workspace-accent)]" : "text-foreground/55 hover:bg-surface-hover hover:text-foreground"}`} disabled={!editor} onClick={onClick}>{icon}</button></Tooltip>;
}

function ToolbarDivider() {
    return <span className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

function CreateChapterModal({ open, onClose, loading, onSubmit }: { open: boolean; onClose: () => void; loading: boolean; onSubmit: (values: { title: string; sourceText?: string }) => void }) {
    return <Modal className="library-modal" title="Add chapter" open={open} footer={null} destroyOnHidden onCancel={onClose} width={480} styles={{ body: { paddingTop: 12 } }}><Form layout="vertical" onFinish={onSubmit}><Form.Item name="title" label="Chapter title" rules={[{ required: true, whitespace: true, message: "Please enter a chapter title" }]}><Input autoFocus placeholder="For example: Returning to the city on a rainy night" /></Form.Item><Form.Item name="sourceText" label="Text (optional)"><Input.TextArea rows={4} placeholder="Editing and formatting can continue after creation" /></Form.Item><div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" htmlType="submit" loading={loading}>Create a chapter</Button></div></Form></Modal>;
}

function ImportNovelModal({ open, loading, onClose, onImport }: { open: boolean; loading: boolean; onClose: () => void; onImport: (chapters: Array<{ title: string; plainText: string }>) => void }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [text, setText] = useState("");
    const [fileName, setFileName] = useState("");
    const deferredText = useDeferredValue(text);
    const chapters = useMemo(() => deferredText.trim() ? splitTextIntoChapters(deferredText).map((chapter) => ({ title: chapter.title, plainText: chapter.plainText })) : [], [deferredText]);
    useEffect(() => { if (!open) { setText(""); setFileName(""); } }, [open]);
    const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setFileName(file.name);
        setText(decodeNovelText(await file.arrayBuffer()));
    };
    return (
        <AppModal flush title={null} open={open} footer={null} onCancel={onClose} width={760}>
            <div className="flex min-h-[478px] flex-col">
                <header className="flex h-12 shrink-0 items-center border-b border-border px-4"><div><h2 className="text-sm font-semibold">Import novels</h2><p className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">Automatically identify chapter titles and add them to the current project after confirmation</p></div></header>
                <div className="grid min-h-[430px] flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
                <div className="border-b border-border p-3 md:border-b-0 md:border-r">
                    <div className="mb-2 flex items-center justify-between gap-2"><div><div className="text-sm font-medium">Novel text</div><div className="mt-0.5 text-[var(--fs-label)] text-foreground/45">Recognize chapter titles and append to existing chapters</div></div><Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>{fileName || "Select TXT"}</Button></div>
                    <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void readFile(event)} />
                    <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} rows={16} placeholder={'You can also paste the text of the novel directly, for example:\n\nChapter 1 A letter on a rainy night\nText...\n\nChapter 2 North of the Lighthouse\nText...'} className="!resize-none" />
                </div>
                <div className="flex min-h-0 flex-col">
                    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 text-xs"><span className="font-medium">Split preview</span><span className="tabular-nums text-foreground/45">{chapters.length}  chapter</span></div>
                    <ImportChapterPreview chapters={chapters} />
                    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3"><span className={`text-[var(--fs-tiny)] ${chapters.length > MAX_NOVEL_IMPORT_CHAPTERS ? "text-red-500" : "text-foreground/38"}`}>{chapters.length > MAX_NOVEL_IMPORT_CHAPTERS ? `Import at most once${MAX_NOVEL_IMPORT_CHAPTERS.toLocaleString("en-US")} chapter` : `Support the most${MAX_NOVEL_IMPORT_CHAPTERS.toLocaleString("en-US")} chapter`}</span><div className="flex gap-2"><Button size="small" onClick={onClose}>Cancel</Button><Button size="small" type="primary" disabled={!chapters.length || chapters.length > MAX_NOVEL_IMPORT_CHAPTERS} loading={loading} onClick={() => onImport(chapters)}>import{chapters.length || ""}  chapter</Button></div></div>
                </div>
                </div>
            </div>
        </AppModal>
    );
}

function ImportChapterPreview({ chapters }: { chapters: Array<{ title: string; plainText: string }> }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: chapters.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 49,
        overscan: 10,
    });
    return (
        <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {chapters.length ? <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const chapter = chapters[virtualItem.index];
                    return <div key={`${chapter.title}-${virtualItem.index}`} className="absolute left-0 top-0 flex w-full gap-2 border-b border-border/60 px-1.5 py-2" style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}><span className="w-8 shrink-0 pt-0.5 text-[var(--fs-tiny)] tabular-nums text-foreground/35">{String(virtualItem.index + 1).padStart(Math.max(2, String(chapters.length).length), "0")}</span><div className="min-w-0"><div className="truncate text-xs font-medium">{chapter.title}</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/40">{formatCount(chapter.plainText.length)}  word</div></div></div>;
                })}
            </div> : <div className="grid h-full place-items-center px-4 text-center text-xs leading-5 text-foreground/40">After selecting the TXT file or pasting the text, the split results will be displayed here</div>}
        </div>
    );
}

function plainTextToHtml(value: string) {
    const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function readStoredScroll(key: string) {
    const value = Number(sessionStorage.getItem(key) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
