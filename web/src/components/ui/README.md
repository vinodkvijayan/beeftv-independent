# Celadon UI component layer

Self-developed component layer under `web/src/components/ui/`. This article is a public quick reference and maintenance convention in the component catalog.

## Layering

| Layers | Directory | Content |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| base | `ui/base/` | Primitive + basic parts: `buttons/`, `badges/`, `kbd/`, `segmented-control/`, etc. |
| product | `ui/product/` | Cross-page modeware: `empty-state/`, `callout/`, `loading-state/`, `section-card/`, `property-row/` |
| fx | `ui/fx/` | Special effects (the original `aceternity/*` is returned to this namespace, and the reference will be moved as it is used, without rewriting) |
| application | `ui/application/` | Product block (from P3): agent-chat, notification-center, app-shell, etc. |

> The visual value uses the theme variables and component tokens in the warehouse as the authoritative source. Components must not rely on private style packages outside the warehouse.

## Directory and export

- One directory (`base/badges/`) per "family", variants are split by file within the family; family-level `index.ts` summary export (component + `XxxVariants` type); **No global barrel**.
- The import path is always deep `@/components/ui/<layer>/<family>`; component `PascalCase`, file `kebab-case.tsx`, directory `kebab-case/`.
- Variant defined with cva(`class-variance-authority`) and type derived from `index.ts`; `className` merged via `cn`; ref forwarded; root element `data-slot`.

## Hard discipline

1. The style only consumes three layers of tokens (`var(--*)` or tool classes mapped by `@theme`, such as `bg-surface`, `text-caption`, `text-status-success`); **Nude `text-[Npx]`/`rounded-[Npx]`/hexadecimal color values are prohibited**. Font size/line height is referenced by registered typesetting tool class or token.
2. Light and shade adaptation is done by CSS variables, without reading the skin ID; permanently switch `aria-pressed` + `data-active`, retain `:focus-visible`, and respect `prefers-reduced-motion`.
3. The icon is passed in as a lucide component reference (`icon={Move}`). The size/color is determined by the host component. The caller is prohibited from passing the icon className to change the size.
4. Comments on the component header indicate: purpose, consumption token group, benchmarking/takeover object (AntD component or reference system component), and key points of light and dark differences.

## Entry threshold

New components must meet one of the following requirements: ① ≥2 true duplications (PR attached with grep evidence); ② Isolate clear agreement/interaction contract. Pure transparent transmission shells will not be stored in the warehouse.

## Current family directory

- `base/kbd/` — Kbd (shortcut key tip keycap)
- `base/badges/` — StatusBadge (status point badge; NodeTypeBadge under planning)
- `base/buttons/` — IconButton / ToolButton (IconButton contains ghost/default/outline/solid/danger variants; ButtonGroup is under planning)
- `base/segmented-control/` — SegmentedControl (segmented radio selection, thumb sliding, generic + block/size)
- `base/checkbox/` — Checkbox + CheckboxGroup (native input + self-drawn glyph, checked/indeterminate/bare)
- `base/select/` — Select (RAC single-select shell, value/options/allowClear; multi-select/search ComboBox to be built)
- `base/tooltip/` — Tooltip (RAC floating layer, AntD 8-way placement mapping, empty title will not render)
- `base/switch/` — Switch (button role=switch + data-state, checkedChildren text track, loading, Form.Item injection)
- `product/empty-state/` — EmptyState (empty state holder)
- `product/callout/` — Callout
- `product/app-modal/` — AppModal (product pop-up shell, `flush` removes AntD default padding)
- `product/app-drawer/` — AppDrawer (product sidebar shell)
- `base/buttons/` — IconButton / ToolButton / ButtonGroup (under planning, P0)