import { Blocks, CircleDollarSign, Clapperboard, Images, LibraryBig, ListTodo, PanelsTopLeft, Settings, WandSparkles } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "Create",
        icon: WandSparkles,
        section: "Create",
    },
    {
        slug: "projects",
        label: "Projects",
        icon: Clapperboard,
        section: "Create",
    },
    {
        slug: "canvas",
        label: "Canvas",
        icon: PanelsTopLeft,
        section: "Create",
    },
    {
        slug: "tasks",
        label: "Tasks",
        icon: ListTodo,
        section: "Create",
    },
    {
        slug: "assets",
        label: "Assets",
        icon: Images,
        section: "Create",
    },
    {
        slug: "skills",
        label: "Skills",
        icon: LibraryBig,
        section: "Workspace",
    },
    {
        slug: "plugins",
        label: "Plugins",
        icon: Blocks,
        section: "Workspace",
    },
    {
        slug: "wallet",
        label: "Credits",
        icon: CircleDollarSign,
        section: "Workspace",
    },
    {
        slug: "settings",
        label: "Settings",
        icon: Settings,
        section: "Workspace",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
