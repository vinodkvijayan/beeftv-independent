export type SkinThemeMode = "light" | "dark";
export type SkinShadowStyle = "none" | "soft" | "strong";

export type SkinModeTokens = {
    canvas: string;
    surface: string;
    surfaceSubtle: string;
    surfaceRaised: string;
    overlay: string;
    text: string;
    textMuted: string;
    border: string;
    control: string;
    controlHover: string;
    controlActive: string;
    controlBorder: string;
    controlFocus: string;
    controlDisabledBackground: string;
    controlDisabledForeground: string;
    switchChecked: string;
    switchCheckedHover: string;
    switchCheckedHandle: string;
    switchUnchecked: string;
    switchUncheckedHover: string;
    switchUncheckedHandle: string;
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primaryForeground: string;
    selected: string;
    selectedHover: string;
    selectedActive: string;
    selectedForeground: string;
    icon: string;
    iconMuted: string;
    iconActive: string;
    success: string;
    warning: string;
    danger: string;
    dangerHover: string;
    dangerActive: string;
    dangerForeground: string;
    info: string;
    workspace: string;
    workspaceGrid: string;
    adminBackground: string;
    adminSurface: string;
    adminSubtle: string;
    adminStrong: string;
    authBackground: string;
    authPanel: string;
    authCard: string;
    authAccent: string;
    authMuted: string;
};

export type SkinComponentTokens = {
    buttonRadius: number;
    inputRadius: number;
    cardRadius: number;
    overlayRadius: number;
    menuRadius: number;
    checkboxRadius: number;
    controlHeight: number;
    controlHeightSmall: number;
    controlHeightLarge: number;
    borderWidth: number;
    focusRingWidth: number;
    iconSize: number;
    buttonFontWeight: number;
    hoverLift: number;
    motionFast: number;
    motionNormal: number;
    shadowStyle: SkinShadowStyle;
};

export type SkinTokens = {
    light: SkinModeTokens;
    dark: SkinModeTokens;
    components: SkinComponentTokens;
};

export type SkinDefinition = {
    id: string;
    name: string;
    description: string;
    locked: boolean;
    tokens: SkinTokens;
};

export type SkinAntOverrides = {
    text: string;
    textMuted: string;
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primaryForeground: string;
    selected: string;
    selectedHover: string;
    selectedActive: string;
    selectedForeground: string;
    controlSurface: string;
    controlHover: string;
    controlActive: string;
    controlBorder: string;
    controlFocus: string;
    controlDisabledBackground: string;
    controlDisabledForeground: string;
    switchChecked: string;
    switchCheckedHover: string;
    switchCheckedHandle: string;
    switchUnchecked: string;
    switchUncheckedHover: string;
    switchUncheckedHandle: string;
    elevatedBackground: string;
    subtleBackground: string;
    menuBackground: string;
    menuForeground: string;
    icon: string;
    iconHover: string;
    success: string;
    warning: string;
    danger: string;
    dangerHover: string;
    dangerActive: string;
    dangerForeground: string;
    info: string;
    borderRadius: number;
    borderRadiusLG: number;
    borderRadiusSM: number;
    buttonRadius: number;
    inputRadius: number;
    overlayRadius: number;
    menuRadius: number;
    checkboxRadius: number;
    controlHeight: number;
    controlHeightSmall: number;
    controlHeightLarge: number;
    borderWidth: number;
    iconSize: number;
    buttonFontWeight: number;
    motionFast: number;
    motionNormal: number;
    shadowStyle: SkinShadowStyle;
};

export type SkinColorField = {
    key: keyof SkinModeTokens;
    label: string;
    help: string;
};

export type SkinColorGroup = {
    key: string;
    label: string;
    fields: readonly SkinColorField[];
};

export type SkinComponentNumberField = {
    key: Exclude<keyof SkinComponentTokens, "shadowStyle">;
    label: string;
    suffix: string;
    min: number;
    max: number;
    step?: number;
};

export const SKIN_COLOR_GROUPS: readonly SkinColorGroup[] = [
    {
        key: "foundation",
        label: "Basic surfaces and text",
        fields: [
            { key: "canvas", label: "Page background", help: "Full site page and canvas background color" },
            { key: "surface", label: "base surface", help: "Cards, regular containers and input areas" },
            { key: "surfaceSubtle", label: "secondary surface", help: "Weak partition, table header and hover background color" },
            { key: "surfaceRaised", label: "emphasize surface", help: "High-level cards and activation containers" },
            { key: "overlay", label: "floating layer surface", help: "Drop-down, pop-up and bubble menus" },
            { key: "text", label: "main text", help: "Title and text" },
            { key: "textMuted", label: "secondary text", help: "Description, placeholders, and metadata" },
            { key: "border", label: "separations and borders", help: "Normal strokes and dividers" },
        ],
    },
    {
        key: "controls",
        label: "Controls and interaction states",
        fields: [
            { key: "control", label: "Control background", help: "Input boxes, check boxes and normal buttons" },
            { key: "controlHover", label: "control hover", help: "Normal control hover background" },
            { key: "controlActive", label: "Control pressed", help: "Normal control active background" },
            { key: "controlBorder", label: "Control border", help: "Input and selection control boundaries" },
            { key: "controlFocus", label: "keyboard focus", help: "focus-visible and input focus" },
            { key: "controlDisabledBackground", label: "disable background", help: "Inoperable control background" },
            { key: "controlDisabledForeground", label: "Disable foreground", help: "Inoperable text and icons" },
            { key: "switchChecked", label: "switch on", help: "Switch opens the track, which must be clearly distinguished from the closed state." },
            { key: "switchCheckedHover", label: "Enable hover", help: "Enable state hover track" },
            { key: "switchCheckedHandle", label: "Turn on slider", help: "Open circular slider" },
            { key: "switchUnchecked", label: "switch off", help: "Switch off track" },
            { key: "switchUncheckedHover", label: "Turn off hover", help: "Close state hover track" },
            { key: "switchUncheckedHandle", label: "Close slider", help: "Close state circular slider" },
            { key: "primary", label: "main operation", help: "Main buttons, links and switches" },
            { key: "primaryHover", label: "Main action hover", help: "Main operations hover" },
            { key: "primaryActive", label: "Main operation press", help: "Main operations active" },
            { key: "primaryForeground", label: "Main operating outlook", help: "Text and icons on the main button" },
            { key: "selected", label: "Select background", help: "Menus, radio selections, and segmented controls" },
            { key: "selectedHover", label: "Check hover", help: "Selected hover" },
            { key: "selectedActive", label: "Select press", help: "Selected active" },
            { key: "selectedForeground", label: "Select foreground", help: "Selected text and icons" },
        ],
    },
    {
        key: "signals",
        label: "Icons and status",
        fields: [
            { key: "icon", label: "Normal icon", help: "Toolbar and common function icons" },
            { key: "iconMuted", label: "weaken icon", help: "Low priority and placeholder icons" },
            { key: "iconActive", label: "activation icon", help: "Current tool and emphasis icons" },
            { key: "success", label: "success", help: "Completed and available status" },
            { key: "warning", label: "warning", help: "Pending processing and risk warning" },
            { key: "danger", label: "danger", help: "Errors, deletions and destructive operations" },
            { key: "dangerHover", label: "danger hover", help: "Destructive operation hover" },
            { key: "dangerActive", label: "danger press", help: "destructive operation active" },
            { key: "dangerForeground", label: "Dangerous prospect", help: "Solid danger button text and icon" },
            { key: "info", label: "information", help: "General description and processing status" },
        ],
    },
    {
        key: "scenes",
        label: "Business scene surface",
        fields: [
            { key: "workspace", label: "Creative workspace", help: "Workspace cards and canvas carrying surface" },
            { key: "workspaceGrid", label: "canvas grid", help: "Canvas grid and space guides" },
            { key: "adminBackground", label: "Backstage bottom layer", help: "Management background page background color" },
            { key: "adminSurface", label: "Backstage card", help: "Management backend main card" },
            { key: "adminSubtle", label: "backend sub-layer", help: "Backend weak partition" },
            { key: "adminStrong", label: "background emphasis layer", help: "Background high contrast area" },
            { key: "authBackground", label: "Login page background", help: "The overall background color of the login page" },
            { key: "authPanel", label: "Login form area", help: "Form panel on the right side of the login page" },
            { key: "authCard", label: "Login card", help: "Login form card" },
            { key: "authAccent", label: "Landing page emphasis", help: "Landing page brand emphasis text" },
            { key: "authMuted", label: "Login page secondary text", help: "Login page description and supporting information" },
        ],
    },
] as const;

export const SKIN_COMPONENT_NUMBER_FIELDS: readonly SkinComponentNumberField[] = [
    { key: "buttonRadius", label: "button rounded corners", suffix: "px", min: 0, max: 32 },
    { key: "inputRadius", label: "Input box rounded corners", suffix: "px", min: 0, max: 32 },
    { key: "cardRadius", label: "Card rounded corners", suffix: "px", min: 0, max: 40 },
    { key: "overlayRadius", label: "Pop-up window and floating layer rounded corners", suffix: "px", min: 0, max: 40 },
    { key: "menuRadius", label: "menu rounded corners", suffix: "px", min: 0, max: 32 },
    { key: "checkboxRadius", label: "Checkbox rounded corners", suffix: "px", min: 0, max: 12 },
    { key: "controlHeight", label: "Standard control height", suffix: "px", min: 30, max: 48 },
    { key: "controlHeightSmall", label: "Small control height", suffix: "px", min: 24, max: 40 },
    { key: "controlHeightLarge", label: "Large control height", suffix: "px", min: 36, max: 56 },
    { key: "borderWidth", label: "control stroke", suffix: "px", min: 1, max: 3 },
    { key: "focusRingWidth", label: "keyboard focus ring", suffix: "px", min: 1, max: 4 },
    { key: "iconSize", label: "Standard icon size", suffix: "px", min: 12, max: 24 },
    { key: "buttonFontWeight", label: "Button weight", suffix: "", min: 400, max: 700, step: 50 },
    { key: "hoverLift", label: "card hover lift", suffix: "px", min: 0, max: 4 },
    { key: "motionFast", label: "Quick feedback duration", suffix: "ms", min: 0, max: 400, step: 10 },
    { key: "motionNormal", label: "Regular transition time", suffix: "ms", min: 0, max: 800, step: 10 },
] as const;

export const DEFAULT_CLASSIC_SKIN: SkinDefinition = {
    id: "classic",
    name: "classic black and white",
    description: "Project original style · cannot be modified",
    locked: true,
    tokens: {
        light: {
            canvas: "#ffffff",
            surface: "#ffffff",
            surfaceSubtle: "#f7f7f7",
            surfaceRaised: "#ececec",
            overlay: "#ffffff",
            text: "#171717",
            textMuted: "#737373",
            border: "#e5e5e5",
            control: "#ffffff",
            controlHover: "#f5f5f5",
            controlActive: "#ececec",
            controlBorder: "#d1d1d1",
            controlFocus: "#171717",
            controlDisabledBackground: "#f2f2f2",
            controlDisabledForeground: "#a3a3a3",
            switchChecked: "#16a34a",
            switchCheckedHover: "#15803d",
            switchCheckedHandle: "#ffffff",
            switchUnchecked: "#b8b8b8",
            switchUncheckedHover: "#9f9f9f",
            switchUncheckedHandle: "#ffffff",
            primary: "#171717",
            primaryHover: "#303030",
            primaryActive: "#404040",
            primaryForeground: "#ffffff",
            selected: "#e8e8e8",
            selectedHover: "#dedede",
            selectedActive: "#d5d5d5",
            selectedForeground: "#171717",
            icon: "#3f3f46",
            iconMuted: "#a1a1aa",
            iconActive: "#171717",
            success: "#16a34a",
            warning: "#d97706",
            danger: "#dc2626",
            dangerHover: "#b91c1c",
            dangerActive: "#991b1b",
            dangerForeground: "#ffffff",
            info: "#2563eb",
            workspace: "#ffffff",
            workspaceGrid: "#f3f3f3",
            adminBackground: "#f5f5f5",
            adminSurface: "#ffffff",
            adminSubtle: "#f6f6f6",
            adminStrong: "#ececec",
            authBackground: "#08090c",
            authPanel: "#0b0c10",
            authCard: "#121318",
            authAccent: "#93c5fd",
            authMuted: "#8a8b91",
        },
        dark: {
            canvas: "#0a0a0a",
            surface: "#181818",
            surfaceSubtle: "#202020",
            surfaceRaised: "#2a2a2a",
            overlay: "#1f1f20",
            text: "#f5f5f5",
            textMuted: "#a3a3a3",
            border: "#2d2d2d",
            control: "#202020",
            controlHover: "#292929",
            controlActive: "#333333",
            controlBorder: "#4a4a4a",
            controlFocus: "#f5f5f5",
            controlDisabledBackground: "#252525",
            controlDisabledForeground: "#737373",
            switchChecked: "#22c55e",
            switchCheckedHover: "#4ade80",
            switchCheckedHandle: "#071a0f",
            switchUnchecked: "#525252",
            switchUncheckedHover: "#686868",
            switchUncheckedHandle: "#f5f5f5",
            primary: "#f5f5f5",
            primaryHover: "#ffffff",
            primaryActive: "#e5e5e5",
            primaryForeground: "#171717",
            selected: "#2b2b2b",
            selectedHover: "#343434",
            selectedActive: "#3d3d3d",
            selectedForeground: "#f5f5f5",
            icon: "#d4d4d8",
            iconMuted: "#71717a",
            iconActive: "#ffffff",
            success: "#4ade80",
            warning: "#fbbf24",
            danger: "#f87171",
            dangerHover: "#fca5a5",
            dangerActive: "#ef4444",
            dangerForeground: "#2b0808",
            info: "#60a5fa",
            workspace: "#181818",
            workspaceGrid: "#222222",
            adminBackground: "#0f0f0f",
            adminSurface: "#181818",
            adminSubtle: "#222222",
            adminStrong: "#2a2a2a",
            authBackground: "#08090c",
            authPanel: "#0b0c10",
            authCard: "#121318",
            authAccent: "#93c5fd",
            authMuted: "#8a8b91",
        },
        components: {
            buttonRadius: 6,
            inputRadius: 6,
            cardRadius: 12,
            overlayRadius: 12,
            menuRadius: 8,
            checkboxRadius: 4,
            controlHeight: 36,
            controlHeightSmall: 30,
            controlHeightLarge: 42,
            borderWidth: 1,
            focusRingWidth: 2,
            iconSize: 16,
            buttonFontWeight: 500,
            hoverLift: 1,
            motionFast: 120,
            motionNormal: 180,
            shadowStyle: "soft",
        },
    },
};

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const MANAGED_VARIABLES = [
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--destructive-hover",
    "--destructive-active",
    "--destructive-foreground",
    "--border",
    "--input",
    "--ring",
    "--surface",
    "--surface-hover",
    "--surface-active",
    "--surface-card",
    "--surface-card-hover",
    "--card-surface",
    "--card-surface-hover",
    "--card-surface-raised",
    "--btn-solid-bg",
    "--btn-solid-hover-bg",
    "--btn-solid-active-bg",
    "--btn-solid-fg",
    "--control-selected-bg",
    "--control-selected-hover-bg",
    "--control-selected-fg",
    "--control-selected-border",
    "--control-check-bg",
    "--control-check-fg",
    "--control-switch-checked-bg",
    "--control-switch-checked-hover-bg",
    "--control-switch-checked-handle",
    "--control-switch-off-bg",
    "--control-switch-off-hover-bg",
    "--control-switch-off-handle",
    "--control-disabled-bg",
    "--control-disabled-fg",
    "--control-focus-ring",
    "--workspace-surface",
    "--workspace-surface-strong",
    "--workspace-border",
    "--workspace-border-strong",
    "--workspace-grid-line",
    "--workspace-accent",
    "--workspace-accent-soft",
    "--skin-admin-layer-0",
    "--skin-admin-layer-1",
    "--skin-admin-layer-2",
    "--skin-admin-layer-3",
    "--auth-page-bg",
    "--auth-panel-bg",
    "--auth-card-bg",
    "--auth-accent",
    "--auth-muted",
    "--palette-status-success",
    "--palette-status-error",
    "--palette-status-loading",
    "--palette-status-warning",
    "--icon-foreground",
    "--icon-muted",
    "--icon-active",
    "--r-sm",
    "--r-md",
    "--r-lg",
    "--r-xl",
    "--r-2xl",
    "--radius",
    "--control-radius",
    "--button-radius",
    "--input-radius",
    "--card-radius",
    "--overlay-radius",
    "--menu-radius",
    "--checkbox-radius",
    "--control-border-width",
    "--focus-ring-width",
    "--icon-size",
    "--theme-hover-lift",
    "--motion-instant",
    "--motion-state",
    "--elevation-card",
    "--elevation-card-hover",
    "--elevation-overlay",
    "--theme-admin-card-shadow",
] as const;

export function normalizeSkinDefinition(value: unknown, fallback: SkinDefinition = DEFAULT_CLASSIC_SKIN): SkinDefinition {
    if (!value || typeof value !== "object") return cloneSkinDefinition(fallback);
    const candidate = value as Partial<SkinDefinition>;
    const id = typeof candidate.id === "string" && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(candidate.id) ? candidate.id : fallback.id;
    const modes = candidate.tokens;
    const light = normalizeSkinMode(modes?.light, fallback.tokens.light);
    const dark = normalizeSkinMode(modes?.dark, fallback.tokens.dark);
    if (!modes || !light || !dark || !isSkinComponents(modes.components)) return cloneSkinDefinition(fallback);
    return {
        id,
        name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 40) : fallback.name,
        description: typeof candidate.description === "string" ? candidate.description.trim().slice(0, 100) : fallback.description,
        locked: id === "classic",
        tokens: { light, dark, components: { ...modes.components } },
    };
}

export function cloneSkinDefinition(source: SkinDefinition): SkinDefinition {
    return { ...source, tokens: cloneSkinTokens(source.tokens) };
}

export function createSkinThemeID(existingIDs: Iterable<string>) {
    const existing = new Set(existingIDs);
    const base = `custom-${Date.now().toString(36)}`;
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) candidate = `${base}-${suffix++}`;
    return candidate;
}

export function duplicateSkinDefinition(source: SkinDefinition, existingIDs: Iterable<string>, name?: string): SkinDefinition {
    const copy = cloneSkinDefinition(source);
    copy.id = createSkinThemeID(existingIDs);
    copy.name = (name || `${source.name} copy`).slice(0, 40);
    copy.description = source.id === "classic" ? "Copied from classic black and white parameters, freely adjustable" : `Copied from${source.name}`;
    copy.locked = false;
    return copy;
}

export function skinSwatches(skin: SkinDefinition) {
    const frequencyOrder: readonly (keyof SkinModeTokens)[] = [
        "canvas",
        "surface",
        "text",
        "textMuted",
        "border",
        "surfaceSubtle",
        "control",
        "controlHover",
        "primary",
        "primaryHover",
        "selected",
        "selectedForeground",
        "surfaceRaised",
        "overlay",
        "controlBorder",
        "switchChecked",
        "switchUnchecked",
        "icon",
        "iconMuted",
        "iconActive",
        "success",
        "warning",
        "danger",
        "info",
        "workspace",
        "workspaceGrid",
        "adminBackground",
        "adminSurface",
        "adminSubtle",
        "adminStrong",
        "authBackground",
        "authPanel",
        "authCard",
        "authAccent",
        "authMuted",
        "controlActive",
        "controlFocus",
        "controlDisabledBackground",
        "controlDisabledForeground",
        "primaryActive",
        "primaryForeground",
        "selectedHover",
        "selectedActive",
        "switchCheckedHover",
        "switchCheckedHandle",
        "switchUncheckedHover",
        "switchUncheckedHandle",
        "dangerHover",
        "dangerActive",
        "dangerForeground",
    ];
    const colors = frequencyOrder.flatMap((key) => [skin.tokens.light[key], skin.tokens.dark[key]]);
    return [...new Set(colors)];
}

export function normalizeSkinID(value: unknown) {
    return normalizeSkinDefinition(value).id;
}

export function getSkinAntOverrides(value: unknown, mode: SkinThemeMode): Partial<SkinAntOverrides> {
    const skin = normalizeSkinDefinition(value);
    if (skin.id === "classic") return {};
    const color = skin.tokens[mode];
    const component = skin.tokens.components;
    return {
        text: color.text,
        textMuted: color.textMuted,
        primary: color.primary,
        primaryHover: color.primaryHover,
        primaryActive: color.primaryActive,
        primaryForeground: color.primaryForeground,
        selected: color.selected,
        selectedHover: color.selectedHover,
        selectedActive: color.selectedActive,
        selectedForeground: color.selectedForeground,
        controlSurface: color.control,
        controlHover: color.controlHover,
        controlActive: color.controlActive,
        controlBorder: color.controlBorder,
        controlFocus: color.controlFocus,
        controlDisabledBackground: color.controlDisabledBackground,
        controlDisabledForeground: color.controlDisabledForeground,
        switchChecked: color.switchChecked,
        switchCheckedHover: color.switchCheckedHover,
        switchCheckedHandle: color.switchCheckedHandle,
        switchUnchecked: color.switchUnchecked,
        switchUncheckedHover: color.switchUncheckedHover,
        switchUncheckedHandle: color.switchUncheckedHandle,
        elevatedBackground: color.overlay,
        subtleBackground: color.surfaceSubtle,
        menuBackground: color.selected,
        menuForeground: color.selectedForeground,
        icon: color.icon,
        iconHover: color.iconActive,
        success: color.success,
        warning: color.warning,
        danger: color.danger,
        dangerHover: color.dangerHover,
        dangerActive: color.dangerActive,
        dangerForeground: color.dangerForeground,
        info: color.info,
        borderRadius: component.buttonRadius,
        borderRadiusLG: component.cardRadius,
        borderRadiusSM: component.inputRadius,
        buttonRadius: component.buttonRadius,
        inputRadius: component.inputRadius,
        overlayRadius: component.overlayRadius,
        menuRadius: component.menuRadius,
        checkboxRadius: component.checkboxRadius,
        controlHeight: component.controlHeight,
        controlHeightSmall: component.controlHeightSmall,
        controlHeightLarge: component.controlHeightLarge,
        borderWidth: component.borderWidth,
        iconSize: component.iconSize,
        buttonFontWeight: component.buttonFontWeight,
        motionFast: component.motionFast,
        motionNormal: component.motionNormal,
        shadowStyle: component.shadowStyle,
    };
}

export function applySkinTheme(skinValue: unknown, mode: SkinThemeMode, targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document) {
    if (!targetDocument) return;
    const skin = normalizeSkinDefinition(skinValue);
    const root = targetDocument.documentElement;
    for (const property of MANAGED_VARIABLES) root.style.removeProperty(property);
    if (skin.id !== "classic") {
        const values = skinCSSVariables(skin, mode);
        for (const [property, value] of Object.entries(values)) root.style.setProperty(property, value);
    }
    root.dataset.skin = skin.id;
}

export function skinCSSVariables(skin: SkinDefinition, mode: SkinThemeMode): Record<string, string> {
    const color = skin.tokens[mode];
    const component = skin.tokens.components;
    const shadows = skinShadowVariables(component.shadowStyle, mode);
    return {
        "--background": color.canvas,
        "--foreground": color.text,
        "--card": color.surface,
        "--card-foreground": color.text,
        "--popover": color.overlay,
        "--popover-foreground": color.text,
        "--primary": color.primary,
        "--primary-foreground": color.primaryForeground,
        "--secondary": color.surfaceSubtle,
        "--secondary-foreground": color.text,
        "--muted": color.surfaceSubtle,
        "--muted-foreground": color.textMuted,
        "--accent": color.selected,
        "--accent-foreground": color.selectedForeground,
        "--destructive": color.danger,
        "--destructive-hover": color.dangerHover,
        "--destructive-active": color.dangerActive,
        "--destructive-foreground": color.dangerForeground,
        "--border": color.border,
        "--input": color.controlBorder,
        "--ring": color.controlFocus,
        "--surface": color.surface,
        "--surface-hover": color.controlHover,
        "--surface-active": color.controlActive,
        "--surface-card": color.surfaceSubtle,
        "--surface-card-hover": color.controlHover,
        "--card-surface": color.surfaceSubtle,
        "--card-surface-hover": color.controlHover,
        "--card-surface-raised": color.surfaceRaised,
        "--control-selected-bg": color.selected,
        "--control-selected-hover-bg": color.selectedHover,
        "--control-selected-fg": color.selectedForeground,
        "--control-selected-border": color.controlBorder,
        "--control-check-bg": color.primary,
        "--control-check-fg": color.primaryForeground,
        "--control-switch-checked-bg": color.switchChecked,
        "--control-switch-checked-hover-bg": color.switchCheckedHover,
        "--control-switch-checked-handle": color.switchCheckedHandle,
        "--control-switch-off-bg": color.switchUnchecked,
        "--control-switch-off-hover-bg": color.switchUncheckedHover,
        "--control-switch-off-handle": color.switchUncheckedHandle,
        "--control-disabled-bg": color.controlDisabledBackground,
        "--control-disabled-fg": color.controlDisabledForeground,
        "--control-focus-ring": color.controlFocus,
        "--workspace-surface": color.workspace,
        "--workspace-surface-strong": color.surfaceRaised,
        "--workspace-border": color.border,
        "--workspace-border-strong": color.controlBorder,
        "--workspace-grid-line": color.workspaceGrid,
        "--workspace-accent": color.primary,
        "--workspace-accent-soft": `color-mix(in srgb, ${color.primary} 12%, transparent)`,
        "--skin-admin-layer-0": color.adminBackground,
        "--skin-admin-layer-1": color.adminSurface,
        "--skin-admin-layer-2": color.adminSubtle,
        "--skin-admin-layer-3": color.adminStrong,
        "--auth-page-bg": color.authBackground,
        "--auth-panel-bg": color.authPanel,
        "--auth-card-bg": color.authCard,
        "--auth-accent": color.authAccent,
        "--auth-muted": color.authMuted,
        "--palette-status-success": color.success,
        "--palette-status-error": color.danger,
        "--palette-status-loading": color.info,
        "--palette-status-warning": color.warning,
        "--icon-foreground": color.icon,
        "--icon-muted": color.iconMuted,
        "--icon-active": color.iconActive,
        "--r-sm": `${component.inputRadius}px`,
        "--r-md": `${component.buttonRadius}px`,
        "--r-lg": `${component.cardRadius}px`,
        "--r-xl": `${component.overlayRadius}px`,
        "--r-2xl": `${component.overlayRadius}px`,
        "--radius": `${component.buttonRadius / 16}rem`,
        "--control-radius": `${component.inputRadius}px`,
        "--button-radius": `${component.buttonRadius}px`,
        "--input-radius": `${component.inputRadius}px`,
        "--card-radius": `${component.cardRadius}px`,
        "--overlay-radius": `${component.overlayRadius}px`,
        "--menu-radius": `${component.menuRadius}px`,
        "--checkbox-radius": `${component.checkboxRadius}px`,
        "--control-border-width": `${component.borderWidth}px`,
        "--focus-ring-width": `${component.focusRingWidth}px`,
        "--icon-size": `${component.iconSize}px`,
        "--theme-hover-lift": `${component.hoverLift}px`,
        "--motion-instant": `${component.motionFast}ms`,
        "--motion-state": `${component.motionNormal}ms`,
        ...shadows,
    };
}

function skinShadowVariables(style: SkinShadowStyle, mode: SkinThemeMode) {
    if (style === "none") return { "--elevation-card": "none", "--elevation-card-hover": "none", "--elevation-overlay": "none", "--theme-admin-card-shadow": "none" };
    if (style === "strong") {
        return mode === "dark"
            ? { "--elevation-card": "0 5px 16px #00000080", "--elevation-card-hover": "0 18px 44px #000000a6", "--elevation-overlay": "0 30px 90px #000000c2", "--theme-admin-card-shadow": "0 5px 16px #00000070" }
            : { "--elevation-card": "0 5px 16px #0f172a29", "--elevation-card-hover": "0 18px 44px #0f172a3d", "--elevation-overlay": "0 30px 90px #0f172a52", "--theme-admin-card-shadow": "0 5px 16px #11182724" };
    }
    return mode === "dark"
        ? { "--elevation-card": "0 2px 7px #00000061", "--elevation-card-hover": "0 12px 30px #0000007a", "--elevation-overlay": "0 26px 72px #0000009e", "--theme-admin-card-shadow": "0 2px 7px #00000052" }
        : { "--elevation-card": "0 2px 7px #0f172a14", "--elevation-card-hover": "0 12px 30px #0f172a24", "--elevation-overlay": "0 26px 72px #0f172a33", "--theme-admin-card-shadow": "0 2px 7px #1118270f" };
}

function cloneSkinTokens(tokens: SkinTokens): SkinTokens {
    return { light: { ...tokens.light }, dark: { ...tokens.dark }, components: { ...tokens.components } };
}

function isSkinMode(value: unknown): value is SkinModeTokens {
    if (!value || typeof value !== "object") return false;
    return SKIN_COLOR_GROUPS.flatMap((group) => group.fields).every((field) => HEX_COLOR.test(String((value as Record<string, unknown>)[field.key] || "")));
}

function normalizeSkinMode(value: unknown, fallback: SkinModeTokens): SkinModeTokens | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<SkinModeTokens>;
    const result: SkinModeTokens = {
        ...fallback,
        ...candidate,
        switchChecked: candidate.switchChecked || candidate.primary || fallback.switchChecked,
        switchCheckedHover: candidate.switchCheckedHover || candidate.primaryHover || fallback.switchCheckedHover,
        switchCheckedHandle: candidate.switchCheckedHandle || candidate.primaryForeground || fallback.switchCheckedHandle,
        switchUnchecked: candidate.switchUnchecked || candidate.controlBorder || fallback.switchUnchecked,
        switchUncheckedHover: candidate.switchUncheckedHover || candidate.controlActive || fallback.switchUncheckedHover,
        switchUncheckedHandle: candidate.switchUncheckedHandle || candidate.selectedForeground || fallback.switchUncheckedHandle,
        dangerHover: candidate.dangerHover || candidate.danger || fallback.dangerHover,
        dangerActive: candidate.dangerActive || candidate.danger || fallback.dangerActive,
        dangerForeground: candidate.dangerForeground || candidate.primaryForeground || fallback.dangerForeground,
    };
    return isSkinMode(result) ? result : null;
}

function isSkinComponents(value: unknown): value is SkinComponentTokens {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return SKIN_COMPONENT_NUMBER_FIELDS.every((field) => typeof candidate[field.key] === "number" && Number.isFinite(candidate[field.key])) && ["none", "soft", "strong"].includes(String(candidate.shadowStyle));
}
