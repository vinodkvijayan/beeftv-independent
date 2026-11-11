import { HardDrive } from "lucide-react";
import { Link } from "react-router";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";

function StorageGlyph() {
    return (
        <span className="app-workspace-sidebar-storage-icon" aria-hidden="true">
            <HardDrive strokeWidth={1.75} />
        </span>
    );
}

export function WorkspaceSidebarStorageMeter({ collapsed }: { collapsed: boolean }) {
    const query = useAccountFileStorageUsage();
    const storageMode = useUserStore((state) => state.storageMode);
    const user = useUserStore((state) => state.user);
    const localMode = isLocalWorkspaceMode() || storageMode === "local" || user?.username === "local";
    const meter = accountStorageMeter(query.data);
    const usedText = query.data ? `${localMode ? "Used locally" : "Used"} ${meter.usedLabel}` : query.isError ? "Capacity is temporarily unavailable" : "Counting capacity";
    const remainingText = query.data ? (meter.full ? "Capacity is full" : `Remaining${meter.remainingLabel}`) : "";
    const totalText = query.data ? `total${meter.totalLabel}` : "";
    const summary = query.data ? `${usedText}，${remainingText}，${totalText}` : usedText;

    const track = (
        <span
            className="app-workspace-sidebar-storage-track"
            role="progressbar"
            aria-label="Account file capacity usage progress"
            aria-valuemin={0}
            aria-valuemax={query.data?.totalBytes ?? 0}
            aria-valuenow={query.data ? Math.min(query.data.usedBytes, query.data.totalBytes) : 0}
            aria-valuetext={summary}
        >
            <span style={{ width: `${meter.percent}%` }} />
        </span>
    );

    if (query.isError && !query.data) {
        return (
            <div className={cn("app-workspace-sidebar-storage is-error", collapsed && "is-collapsed")}>
                {collapsed ? (
                    <button type="button" title="Capacity statistics are temporarily unavailable, click to try again." aria-label="Retry loading account capacity" onClick={() => void query.refetch()}>
                        <StorageGlyph />
                    </button>
                ) : (
                    <>
                        <StorageGlyph />
                        <span>Capacity is temporarily unavailable</span>
                        <button type="button" onClick={() => void query.refetch()}>
                                                        Try again
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <Link
            to="/assets"
            className={cn(
                "app-workspace-sidebar-storage",
                collapsed && "is-collapsed",
                meter.tone === "warn" && "is-warn",
                meter.tone === "critical" && "is-critical",
                query.data?.usedBytes ? "has-usage" : null,
                query.isPending && !query.data && "is-pending",
            )}
            title={`${summary}。${localMode ? "Statistics browser local materials" : "Contains footage files and authoring session attachments"}`}
            aria-label={`${localMode ? "local storage" : "Account capacity"}，${summary}`}
            aria-busy={query.isPending && !query.data}
            onFocus={() => preloadWorkspaceRoute("/assets")}
            onPointerEnter={() => preloadWorkspaceRoute("/assets")}
        >
            <StorageGlyph />
            {collapsed ? (
                track
            ) : (
                <span className="app-workspace-sidebar-storage-body">
                    <span className="app-workspace-sidebar-storage-copy">
                        <span className="app-workspace-sidebar-storage-meta">
                            <span className="app-workspace-sidebar-storage-used">{usedText}</span>
                            {totalText ? <span className="app-workspace-sidebar-storage-total">{totalText}</span> : null}
                        </span>
                    </span>
                    <span className="app-workspace-sidebar-storage-foot">
                        {track}
                        {remainingText ? <span className="app-workspace-sidebar-storage-remain">{remainingText}</span> : null}
                    </span>
                </span>
            )}
        </Link>
    );
}
