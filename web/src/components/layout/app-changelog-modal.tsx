import { Button } from "antd";
import { ScrollText } from "lucide-react";
import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react";

const AppChangelogDialog = lazy(() => import("@/components/layout/app-changelog-dialog").then((module) => ({ default: module.AppChangelogDialog })));

export const APP_VERSION = __APP_VERSION__;

type AppChangelogButtonProps = {
    appearance?: "plain" | "button";
    className?: string;
    style?: CSSProperties;
    showVersion?: boolean;
    showLabel?: boolean;
    showIcon?: boolean;
    labelClassName?: string;
    versionClassName?: string;
    icon?: ReactNode;
    label?: ReactNode;
    version?: string;
    ariaLabel?: string;
};

export function formatAppVersionLabel(version: string) {
    const raw = version.trim();
    if (!raw) return "";
    return `v${raw.replace(/^v/, "")}`;
}

export function AppChangelogButton({ appearance = "plain", className, style, showVersion = false, showLabel = false, showIcon = true, labelClassName, versionClassName, icon, label = "Change log", version, ariaLabel }: AppChangelogButtonProps) {
    const [open, setOpen] = useState(false);
    const displayed = formatAppVersionLabel(version ?? APP_VERSION);
    const resolvedAriaLabel = ariaLabel || (displayed ? `Current version${displayed}, view the change log` : "View changelog");

    return (
        <>
            {appearance === "button" ? (
                <Button className={className} style={style} onClick={() => setOpen(true)} aria-label={resolvedAriaLabel} title={displayed ? `Current version${displayed}` : "Change log"}>
                    {label}
                </Button>
            ) : (
                <button type="button" className={className} style={style} onClick={() => setOpen(true)} aria-label={resolvedAriaLabel} title={displayed ? `Current version${displayed}` : "Change log"}>
                    {showIcon ? (icon ?? <ScrollText className="size-4 shrink-0" />) : null}
                    {showLabel ? <span className={`whitespace-nowrap ${labelClassName || ""}`}>{label}</span> : null}
                    {showVersion && displayed ? <span className={versionClassName}>{displayed}</span> : null}
                </button>
            )}
            {open ? (
                <Suspense fallback={null}>
                    <AppChangelogDialog open onClose={() => setOpen(false)} />
                </Suspense>
            ) : null}
        </>
    );
}
