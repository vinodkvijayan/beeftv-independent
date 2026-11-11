import { AnimatePresence } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
    ArrowLeft,
    AtSign,
    Check,
    ChevronRight,
    Clipboard,
    CloudUpload,
    Copy,
    Download,
    FolderOpen,
    FolderPlus,
    Image as ImageIcon,
    Layers3,
    LayoutTemplate,
    Link2,
    Maximize2,
    PanelTop,
    Pencil,
    Plus,
    Redo2,
    Tags,
    Trash2,
    Undo2,
    Upload,
    UserRound,
} from "lucide-react";

import { CanvasCreateMenu, type CanvasCreateCommand } from "@/components/canvas/canvas-create-menu";
import { ASSET_CATEGORY_OPTIONS } from "@/lib/asset-category";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasNodeAssetCategory } from "@/lib/canvas/canvas-node-asset";
import { isCanvasFolderNode, isFrameNode } from "@/lib/canvas/canvas-frame";
import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";
import { usePluginSlot } from "@/lib/plugins/slot-registry";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { cn } from "@/lib/utils";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId, type CanvasWorkspaceMode, type ContextMenuState, type Position } from "@/types/canvas";

type CanvasAssetCategory = NonNullable<NonNullable<CanvasNodeData["metadata"]>["assetCategory"]>;

const assetCategoryOptions: Array<{ value: CanvasAssetCategory; label: string }> = ASSET_CATEGORY_OPTIONS;

type CanvasNodeContextMenuProps = {
    menu: ContextMenuState;
    node?: CanvasNodeData | null;
    workspaceMode?: CanvasWorkspaceMode;
    isProjectLinked?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    canPaste: boolean;
    selectedCount?: number;
    onClose: () => void;
    onAddNode: (type: CanvasNodeTypeId, position?: Position) => void;
    onAddFolder: () => void;
    onChooseStyle: () => void;
    onOpenDirector: (position: Position) => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onOpenProjectCharacters: () => void;
    onOpenGenerationHistory: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: () => void;
    onCopyNode: () => void;
    onCreateGenerationCopy: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onSaveAsset: () => void;
    onViewMedia: () => void;
    onEditText: () => void;
    onOpenDrawing: () => void;
    onGenerateImage: () => void;
    onCopyContent: () => void;
    onCopyMediaUrl: () => void;
    onUploadToArkPrivateAsset: () => void;
    onSetAssetCategory: (category: CanvasAssetCategory) => void;
    onToggleFrame: () => void;
    onUnpackFolder?: () => void;
    onSpreadSelection?: () => void;
    onPackSelectionToFolder?: () => void;
    onCopySelection?: () => void;
    onDeleteSelection?: () => void;
    downloadableSelectionCount?: number;
    onBatchDownloadSelection?: () => void;
};

export function CanvasNodeContextMenu({
    menu,
    node,
    workspaceMode = "professional",
    isProjectLinked = false,
    canUndo,
    canRedo,
    canPaste,
    selectedCount = 0,
    onClose,
    onAddNode,
    onAddFolder,
    onChooseStyle,
    onOpenDirector,
    onUpload,
    onOpenAssets,
    onOpenProjectCharacters,
    onOpenGenerationHistory,
    onUndo,
    onRedo,
    onPaste,
    onCopyNode,
    onCreateGenerationCopy,
    onDuplicate,
    onDelete,
    onSaveAsset,
    onViewMedia,
    onEditText,
    onOpenDrawing,
    onGenerateImage,
    onCopyContent,
    onCopyMediaUrl,
    onUploadToArkPrivateAsset,
    onSetAssetCategory,
    onToggleFrame,
    onUnpackFolder,
    onSpreadSelection,
    onPackSelectionToFolder,
    onCopySelection,
    onDeleteSelection,
    downloadableSelectionCount = 0,
    onBatchDownloadSelection,
}: CanvasNodeContextMenuProps) {
    const theme = canvasThemes[useActiveTheme()];
    const [addOpen, setAddOpen] = useState(false);
    const [categoryOpen, setCategoryOpen] = useState(false);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (categoryOpen) setCategoryOpen(false);
            else onClose();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [categoryOpen, onClose]);

    useEffect(() => {
        setAddOpen(menu.type === "canvas" && Boolean(menu.createOpen));
        setCategoryOpen(false);
    }, [menu]);

    const runAction = (action: () => void) => {
        action();
        onClose();
    };
    const nodeContent = typeof node?.metadata?.content === "string" ? node.metadata.content : "";
    const isImage = node?.type === CanvasNodeType.Image;
    const isText = node?.type === CanvasNodeType.Text;
    const isCharacterReference = Boolean(isText && node?.metadata?.workflowKind === "character" && node.metadata.characterAssetId);
    const isDrawing = node?.type === CanvasNodeType.Drawing;
    const isVideo = node?.type === CanvasNodeType.Video;
    const isMedia = isImage || isVideo;
    const isAudio = node?.type === CanvasNodeType.Audio;
    const isFrame = isFrameNode(node);
    const isFolder = isCanvasFolderNode(node);
    const hasNodeContent = isText ? Boolean(nodeContent.trim()) : Boolean(nodeContent);
    const canSaveAsset = Boolean(node && !isCharacterReference && (isText ? hasNodeContent : hasNodeContent && (isImage || isVideo || isAudio)));
    const canOpenPreview = Boolean(isMedia && hasNodeContent);
    const canGenerateFromText = Boolean(isText && !isCharacterReference && hasNodeContent);
    const canCopyMediaUrl = Boolean(isMedia && hasNodeContent);
    const assetCategory = node ? canvasNodeAssetCategory(node) : "other";
    const hasMultiSelection = selectedCount >= 2;
    const position = getContextMenuPosition(menu, hasMultiSelection);
    const pluginContextMenuEntries = usePluginSlot("canvas.contextMenu");
    const pluginContextTarget = menu.type === "canvas" ? "canvas" : hasMultiSelection ? "selection" : "node";
    const pluginContextMenuCtx = {
        target: pluginContextTarget as "canvas" | "node" | "selection",
        node: node ?? null,
        selectedNodeIds: node ? [node.id] : [],
        selectedNodes: node ? [node] : [],
        position: { x: menu.x, y: menu.y },
    };
    const visiblePluginMenuItems = pluginContextMenuEntries.filter((entry) =>
        entry.payload.when ? entry.payload.when(pluginContextMenuCtx) : true,
    );

    return (
        <>
            <SpotlightSurface
                spotlightColor={theme.toolbar.itemHover}
                data-canvas-context-menu
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                className={cn(
                    "aceternity-floating-panel fixed z-[var(--z-popover)] flex w-[224px] max-h-[calc(100vh-84px)] origin-top-left flex-col overflow-hidden rounded-xl border p-1.5 backdrop-blur-2xl",
                    menu.type === "canvas" && addOpen && "pointer-events-none invisible",
                )}
                style={{ left: position.left, top: position.top, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="absolute inset-x-8 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />
                <div className="thin-scrollbar min-h-0 overflow-y-auto">
                    {menu.type === "node" && isMedia && categoryOpen ? (
                        <>
                            <MenuHeader title="Asset Classification" description={node?.title || nodeTypeLabel(node)} onBack={() => setCategoryOpen(false)} />
                            <MenuSection label="Project purpose" />
                            {assetCategoryOptions.map((option) => (
                                <MenuButton key={option.value} icon={assetCategory === option.value ? <Check /> : <Tags />} label={option.label} active={assetCategory === option.value} onClick={() => runAction(() => onSetAssetCategory(option.value))} />
                            ))}
                        </>
                    ) : menu.type === "canvas" ? (
                        <>
                            <MenuHeader title="canvas command" />
                            {hasMultiSelection ? (
                                <>
                                    <MenuButton icon={<FolderPlus className="size-4" />} label="Save to folder" detail="Merge into new canvas folder" disabled={!onPackSelectionToFolder} onClick={() => onPackSelectionToFolder && runAction(onPackSelectionToFolder)} />
                                    <MenuButton icon={<LayoutTemplate className="size-4" />} label="Adaptive organizing canvas" detail="Keep relative layout and increase margins" disabled={!onSpreadSelection} onClick={() => onSpreadSelection && runAction(onSpreadSelection)} />
                                    <MenuButton icon={<Download className="size-4" />} label={downloadableSelectionCount ? `Download materials in batches (${downloadableSelectionCount})` : "Download materials in batches"} disabled={!downloadableSelectionCount || !onBatchDownloadSelection} onClick={() => onBatchDownloadSelection && runAction(onBatchDownloadSelection)} />
                                    <MenuDivider />
                                </>
                            ) : null}
                            <MenuButton icon={<Plus className="size-4" />} label="Add node" chevron active={addOpen} onClick={() => setAddOpen((value) => !value)} />
                            <MenuButton icon={<Upload className="size-4" />} label="Upload here" onClick={() => runAction(onUpload)} />
                            {!isProjectLinked ? <MenuButton icon={<FolderOpen className="size-4" />} label="Insert from library" onClick={() => runAction(onOpenAssets)} /> : null}
                            <MenuDivider />
                            <MenuSection label="History and Clipboard" />
                            <MenuButton icon={<Undo2 className="size-4" />} label="Cancel" shortcut="⌘Z" disabled={!canUndo} onClick={() => runAction(onUndo)} />
                            <MenuButton icon={<Redo2 className="size-4" />} label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => runAction(onRedo)} />
                            <MenuButton icon={<Clipboard className="size-4" />} label="Paste" shortcut="⌘V" disabled={!canPaste} onClick={() => runAction(onPaste)} />
                        </>
                    ) : menu.type === "node" && hasMultiSelection ? (
                        <>
                            <MenuHeader title={`Selected${selectedCount} nodes`} />
                            <MenuSection label="constituency" />
                            <MenuButton icon={<FolderPlus />} label="Save to folder" detail="Merge into new canvas folder" disabled={!onPackSelectionToFolder} onClick={() => onPackSelectionToFolder && runAction(onPackSelectionToFolder)} />
                            <MenuButton icon={<LayoutTemplate />} label="Adaptive organizing canvas" detail="Keep relative layout and increase margins" disabled={!onSpreadSelection} onClick={() => onSpreadSelection && runAction(onSpreadSelection)} />
                            <MenuButton icon={<Download />} label={downloadableSelectionCount ? `Download materials in batches (${downloadableSelectionCount})` : "Download materials in batches"} disabled={!downloadableSelectionCount || !onBatchDownloadSelection} onClick={() => onBatchDownloadSelection && runAction(onBatchDownloadSelection)} />
                            <MenuDivider />
                            <MenuButton icon={<Copy />} label={`Copy${selectedCount} nodes`} shortcut="⌘C" disabled={!onCopySelection} onClick={() => onCopySelection && runAction(onCopySelection)} />
                            <MenuButton icon={<Trash2 />} label={`Delete${selectedCount} nodes`} danger disabled={!onDeleteSelection} onClick={() => onDeleteSelection && runAction(onDeleteSelection)} />
                        </>
                    ) : menu.type === "node" ? (
                        <>
                            {isCharacterReference ? (
                                <>
                                    <MenuHeader title="character card" description={node?.metadata?.characterName || node?.title} />
                                    <MenuSection label="role reference" />
                                    <MenuButton icon={<UserRound />} label="View role details" onClick={() => runAction(onEditText)} />
                                    <MenuDivider />
                                    <MenuSection label="node" />
                                            <MenuButton icon={<Copy />} label="Copy role reference" shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                    <MenuButton icon={<Layers3 />} label="Create a copy of the reference" shortcut="⌘D" onClick={() => runAction(onDuplicate)} />
                                    <MenuButton icon={<Trash2 />} label="Delete node" danger onClick={() => runAction(onDelete)} />
                                </>
                            ) : isMedia ? (
                                <>
                                    {isImage ? (
                                        <>
                                            <MenuButton icon={<Maximize2 />} label="Panorama preview" disabled={!canOpenPreview} onClick={() => runAction(onViewMedia)} />
                                            <MenuButton icon={<Tags />} label="Asset Classification" chevron onClick={() => setCategoryOpen(true)} />
                                            <MenuButton icon={<Copy />} label="Copy node" shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                        </>
                                    ) : (
                                        <>
                                            <MenuButton icon={<Maximize2 />} label="Panorama preview" disabled={!canOpenPreview} onClick={() => runAction(onViewMedia)} />
                                            <MenuButton icon={<Tags />} label="Asset Classification" chevron onClick={() => setCategoryOpen(true)} />
                                            <MenuButton icon={<Copy />} label="Copy node" shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                        </>
                                    )}
                                    <MenuButton icon={<Trash2 />} label="Delete node" danger onClick={() => runAction(onDelete)} />
                                </>
                            ) : (
                                <>
                                    <MenuHeader title={node?.title || nodeTypeLabel(node)} />
                                    <MenuSection label="Node operations" />
                                    {isFrame ? (
                                        <>
                                            <MenuButton
                                                icon={isFolder ? <FolderOpen /> : <PanelTop />}
                                                label={node?.metadata?.frame?.collapsed ? (isFolder ? "open folder" : "Unfold the back panel") : (isFolder ? "Collapse folder" : "Folding back panel")}
                                                onClick={() => runAction(onToggleFrame)}
                                            />
                                            {isFolder && !node?.metadata?.folder?.assetFolderId && onUnpackFolder ? (
                                                <MenuButton
                                                    icon={<Layers3 />}
                                                    label="Dismiss folder"
                                                    detail="Release internal nodes back to canvas"
                                                    onClick={() => runAction(onUnpackFolder)}
                                                />
                                            ) : null}
                                        </>
                                    ) : (
                                        <MenuButton icon={<FolderPlus />} label="Save to my stuff" disabled={!canSaveAsset} onClick={() => runAction(onSaveAsset)} />
                                    )}
                                    {isText ? <MenuButton icon={<Maximize2 />} label="EnlargeEdit" onClick={() => runAction(onEditText)} /> : null}
                                    {isDrawing ? <MenuButton icon={<Pencil />} label="open drawing" onClick={() => runAction(onOpenDrawing)} /> : null}
                                    {isText ? <MenuButton icon={<ImageIcon />} label="Use text to create pictures" disabled={!canGenerateFromText} onClick={() => runAction(onGenerateImage)} /> : null}
                                    <MenuDivider />
                                    <MenuSection label="Copy and content" />
                                            <MenuButton icon={<Copy />} label={isFrame ? `Copy${isFolder ? "folder" : "backplane"}and content` : "Copy node"} shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                    {isText ? <MenuButton icon={<Clipboard />} label="copy text" disabled={!hasNodeContent} onClick={() => runAction(onCopyContent)} /> : null}
                                    <MenuButton icon={<Copy />} label={isFrame ? `Create${isFolder ? "folder" : "backplane"}copy` : "Create parameter variations"} shortcut="⌘D" onClick={() => runAction(onDuplicate)} />
                                    <MenuButton icon={<Clipboard />} label="Paste" shortcut="⌘V" disabled={!canPaste} onClick={() => runAction(onPaste)} />
                                    <MenuButton icon={<Trash2 />} label={isFrame ? `Delete${isFolder ? "folder" : "backplane"}` : "Delete node"} danger onClick={() => runAction(onDelete)} />
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <MenuHeader title="connect" />
                            <MenuButton icon={<Trash2 className="size-4" />} label="Delete connection" danger onClick={() => runAction(onDelete)} />
                        </>
                    )}
                    {!categoryOpen && visiblePluginMenuItems.length > 0 ? (
                        <>
                            <MenuDivider />
                            <MenuSection label="Plug-in extension" />
                            {visiblePluginMenuItems.map((entry) => (
                                <MenuButton
                                    key={entry.entryId}
                                    icon={entry.payload.icon ?? <Plus className="size-4" />}
                                    label={entry.payload.label}
                                    shortcut={entry.payload.shortcut}
                                    onClick={() => runAction(() => void entry.payload.onSelect(pluginContextMenuCtx))}
                                />
                            ))}
                        </>
                    ) : null}
                </div>
            </SpotlightSurface>

            <AnimatePresence>
                {menu.type === "canvas" && addOpen ? (
                    <AddNodeContextMenu
                        parentPosition={position}
                        createPosition={menu.position}
                        workspaceMode={workspaceMode}
                        isProjectLinked={isProjectLinked}
                        onAddNode={(type, position) => runAction(() => onAddNode(type, position))}
                        onAddFolder={() => runAction(onAddFolder)}
                        onChooseStyle={() => runAction(onChooseStyle)}
                        onOpenDirector={() => runAction(() => onOpenDirector(menu.position))}
                        onUpload={() => runAction(onUpload)}
                        onOpenAssets={() => runAction(onOpenAssets)}
                        onOpenProjectCharacters={() => runAction(onOpenProjectCharacters)}
                        onOpenGenerationHistory={() => runAction(onOpenGenerationHistory)}
                    />
                ) : null}
            </AnimatePresence>
        </>
    );
}

function AddNodeContextMenu({
    parentPosition,
    createPosition,
    workspaceMode,
    isProjectLinked,
    onAddNode,
    onAddFolder,
    onChooseStyle,
    onOpenDirector,
    onUpload,
    onOpenAssets,
    onOpenProjectCharacters,
    onOpenGenerationHistory,
}: {
    parentPosition: { left: number; top: number };
    createPosition: Position;
    workspaceMode: CanvasWorkspaceMode;
    isProjectLinked: boolean;
    onAddNode: (type: CanvasNodeTypeId, position?: Position) => void;
    onAddFolder: () => void;
    onChooseStyle: () => void;
    onOpenDirector: () => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onOpenProjectCharacters: () => void;
    onOpenGenerationHistory: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const installations = usePluginStore((state) => state.installations);
    const pluginStates = usePluginStore((state) => state.pluginStates);
    const left = getSubmenuLeft(parentPosition.left);
    const createContext: AddNodeMenuContext = {
        workspaceMode,
        isProjectLinked,
        enabledPluginIds: new Set(installations.filter((item) => pluginStates[item.manifest.id]?.effectiveEnabled ?? item.enabled).map((item) => item.manifest.id)),
        handlers: {
            onAddText: () => onAddNode(CanvasNodeType.Text, createPosition),
            onAddImage: () => onAddNode(CanvasNodeType.Image, createPosition),
            onAddVideo: () => onAddNode(CanvasNodeType.Video, createPosition),
            onAddAudio: () => onAddNode(CanvasNodeType.Audio, createPosition),
            onAddScript: () => onAddNode(CanvasNodeType.Script, createPosition),
            onAddFrame: () => onAddNode(CanvasNodeType.Frame, createPosition),
            onAddFolder,
            onAddDrawing: () => onAddNode(CanvasNodeType.Drawing, createPosition),
            onAddExtensionNode: (type) => onAddNode(type, createPosition),
            onAddWorkflow: () => onAddNode(CanvasNodeType.Config, createPosition),
            onChooseStyle,
            onOpenDirector,
            onUpload,
            onOpenMyAssets: onOpenAssets,
            onOpenProjectCharacters,
            onOpenGenerationHistory,
        },
    };
    const commands: CanvasCreateCommand[] = resolveAddNodeMenuCommands(createContext).map((command) => ({
        id: command.id,
        label: command.label,
        icon: command.icon,
        badge: command.badge,
        section: command.section,
        disabledReason: command.disabledReason,
        onClick: () => command.run(createContext),
    }));

    return (
        <SpotlightSurface
            spotlightColor={theme.toolbar.itemHover}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
            className="canvas-create-menu-surface aceternity-floating-panel fixed z-[var(--z-popover)] w-[232px] origin-top overflow-hidden rounded-xl border p-2 backdrop-blur-2xl"
            style={{ left: getListMenuLeft(parentPosition.left), top: getListMenuTop(parentPosition.top), background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <CanvasCreateMenu commands={commands} layout="list" />
        </SpotlightSurface>
    );
}

function MenuHeader({ title, description, onBack }: { title: string; description?: string; onBack?: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    return (
        <div className="mb-0.5 flex items-start gap-1 px-1.5 py-1.5">
            {onBack ? (
                <button type="button" onClick={onBack} className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label="Return to media operations">
                    <ArrowLeft className="size-3.5" />
                </button>
            ) : null}
            <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{title}</span>
                {description && description !== title ? (
                    <span className="mt-0.5 block truncate text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </div>
    );
}

function MenuSection({ label }: { label: string }) {
    return <div className="px-2 pb-1 pt-1.5 text-[var(--fs-micro)] font-medium opacity-45">{label}</div>;
}

function MenuButton({
    icon,
    label,
    detail,
    shortcut,
    badge,
    chevron = false,
    active = false,
    disabled = false,
    danger = false,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    detail?: string;
    shortcut?: string;
    badge?: string;
    chevron?: boolean;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
    onClick?: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const color = danger ? theme.accent.danger : theme.node.text;
    return (
        <button
            type="button"
            className="canvas-menu-item group flex min-h-9 w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left outline-none enabled:hover:border-black/10 enabled:hover:bg-black/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 dark:enabled:hover:border-white/10 dark:enabled:hover:bg-white/8"
            style={{ color, background: active ? theme.toolbar.activeBg : undefined, "--tw-ring-color": theme.node.muted } as CSSProperties}
            disabled={disabled}
            onClick={onClick}
        >
            <span
                className="canvas-menu-item-icon grid size-7 shrink-0 place-items-center rounded-md border opacity-75 group-hover:opacity-100 [&_svg]:size-3.5"
                style={{ background: danger ? `${theme.accent.danger}12` : theme.spatial.surface, borderColor: danger ? `${theme.accent.danger}33` : theme.toolbar.border, color: danger ? theme.accent.danger : theme.node.text }}
            >
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium">
                    <span className="truncate">{label}</span>
                    {badge ? (
                        <span className="rounded-full border px-1 py-0.5 text-[var(--fs-nano)] font-bold" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                            {badge}
                        </span>
                    ) : null}
                </span>
                {detail ? (
                    <span className="mt-0.5 block truncate text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                        {detail}
                    </span>
                ) : null}
            </span>
            {shortcut ? <span className="shrink-0 text-[var(--fs-micro)] opacity-38">{shortcut}</span> : null}
            {chevron ? <ChevronRight className="size-3 shrink-0 opacity-45" /> : null}
        </button>
    );
}

function MenuDivider() {
    const theme = canvasThemes[useActiveTheme()];
    return <div className="mx-1.5 my-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />;
}

function getContextMenuPosition(menu: ContextMenuState, hasMultiSelection = false) {
    if (typeof window === "undefined" || typeof document === "undefined") return { left: menu.x, top: menu.y };
    const width = 224;
    // Text/media node menus contain several action groups. Reserve enough
    // vertical space before clamping so the destructive action stays inside
    // the viewport instead of ending below the fold.
    const estimatedHeight = menu.type === "node" ? Math.min(hasMultiSelection ? 300 : 480, window.innerHeight - 72) : menu.type === "canvas" ? (hasMultiSelection ? 300 : 250) : 84;
    const agentPanel = document.querySelector<HTMLElement>(".canvas-agent-panel");
    const agentLeft = agentPanel?.getBoundingClientRect().left;
    const rightEdge = typeof agentLeft === "number" && agentLeft > 0 ? Math.min(window.innerWidth - width - 12, agentLeft - width - 8) : window.innerWidth - width - 12;
    return {
        // LibTV keeps context menus clear of the docked Agent surface; when
        // the click lands in the panel's horizontal band, place the menu just
        // to its left instead of allowing the two overlays to overlap.
        left: clamp(menu.x, 12, Math.max(12, rightEdge)),
        top: clamp(menu.y, 68, Math.max(68, window.innerHeight - estimatedHeight - 12)),
    };
}

function getSubmenuLeft(parentLeft: number) {
    if (typeof window === "undefined") return parentLeft + 192;
    return parentLeft + 224 + 8 + 360 <= window.innerWidth - 12 ? parentLeft + 232 : Math.max(12, parentLeft - 368);
}

function getListMenuLeft(parentLeft: number) {
    if (typeof window === "undefined") return parentLeft;
    // LibTV keeps the compact palette close to the double-click anchor instead
    // of centering it over the hidden canvas context surface.
    return Math.min(Math.max(12, parentLeft - 44), Math.max(12, window.innerWidth - 244));
}

function getListMenuTop(parentTop: number) {
    if (typeof window === "undefined") return parentTop;
    return Math.min(Math.max(68, parentTop - 220), Math.max(68, window.innerHeight - 460));
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function nodeTypeLabel(node?: CanvasNodeData | null) {
    if (!node) return "node";
    if (node.type === CanvasNodeType.Image) return "Picture node";
    if (node.type === CanvasNodeType.Text) return "text node";
    if (node.type === CanvasNodeType.Script) return "Storyboard node";
    if (node.type === CanvasNodeType.Skill) return "Skill node";
    if (node.type === CanvasNodeType.Video) return "video node";
    if (node.type === CanvasNodeType.Audio) return "audio node";
    if (node.type === CanvasNodeType.Drawing) return "drawing node";
    if (isFrameNode(node)) return node.type === CanvasNodeType.Workflow ? "Workflow" : isCanvasFolderNode(node) ? "folder" : "backplane";
    return "Generate configuration node";
}
