import { HardDrive } from "lucide-react";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter, formatStorageBytes } from "@/lib/account-storage-usage";
import { useUserStore } from "@/stores/use-user-store";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

export function AssetStorageUsage() {
    const query = useAccountFileStorageUsage();
    const storageMode = useUserStore((state) => state.storageMode);
    const user = useUserStore((state) => state.user);
    const localMode = isLocalWorkspaceMode() || storageMode === "local" || user?.username === "local";
    const usage = query.data;
    const meter = accountStorageMeter(usage);

    return (
        <section className={`assets-storage-usage${meter.full ? " is-full" : ""}${usage?.usedBytes ? " has-usage" : ""}`} aria-label={localMode ? "local file capacity" : "Account file capacity"} aria-busy={query.isPending} title={localMode ? "Statistics of material files saved locally in the browser" : "Contains footage files and authoring session attachments"}>
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">{localMode ? "local storage" : "Account capacity"}</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.totalBytes)}
                    </span>
                    <span
                        className="assets-storage-usage-track"
                        role="progressbar"
                        aria-label="Account file capacity usage progress"
                        aria-valuemin={0}
                        aria-valuemax={usage.totalBytes}
                        aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}
                        aria-valuetext={`Already used${formatStorageBytes(usage.usedBytes)}, total capacity${formatStorageBytes(usage.totalBytes)}`}
                    >
                        <span style={{ width: `${meter.percent}%` }} />
                    </span>
                    <span className="assets-storage-usage-percent">{meter.percentLabel}</span>
                </>
            ) : query.isError ? (
                <span className="assets-storage-usage-status">
                                        Capacity statistics are temporarily unavailable.
                    <button type="button" onClick={() => void query.refetch()}>
                                                Try again
                    </button>
                </span>
            ) : (
                <span className="assets-storage-usage-status">Counting used capacity...</span>
            )}
        </section>
    );
}
