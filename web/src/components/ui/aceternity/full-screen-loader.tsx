import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label = "Restoring workspace", detail = "Synchronize account, model and project data", className }: FullScreenLoaderProps) {
    return (
        <div
            data-full-screen-loader
            role="status"
            aria-live="polite"
            aria-label={`${label}，${detail}`}
            className={cn("full-screen-loader", className)}
        >
            <span className="beeftv-loading-logo" aria-hidden="true" />
        </div>
    );
}

export function WorkspaceRouteLoader({ label = "Opening page" }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
        }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={label}>
            <div className="workspace-route-loader-content">
                <span className="beeftv-loading-logo is-compact" aria-hidden="true" />
                <span>{label}</span>
            </div>
        </section>
    );
}
