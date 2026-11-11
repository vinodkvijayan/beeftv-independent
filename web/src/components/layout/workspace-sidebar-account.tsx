import { LoaderCircle, UserRound } from "lucide-react";
import { useState } from "react";

import { useBeefTVConnection } from "@/components/layout/beeftv-connection-provider";
import { AccountSettingsModal } from "@/components/account-settings/account-settings-modal";
import { cn } from "@/lib/utils";
import { isBeefTVAuthenticated } from "@/services/api/beeftv-connection";

export function WorkspaceSidebarAccount({ collapsed }: { collapsed: boolean }) {
    const [open, setOpen] = useState(false);
    const account = useBeefTVConnection();
    const { connection, loading } = account;
    const connected = isBeefTVAuthenticated(connection);
    const pending = connection?.state === "pending" || connection?.state === "connecting";
    const name = connection?.account?.display_name || connection?.account?.username || connection?.account?.email || "BeefTV account";
    const label = loading ? "Reading account" : connected ? name : pending ? "Waiting for login confirmation" : "Login to BeefTV";

    return <>
        <button
            type="button"
            className={cn("app-workspace-nav-link app-workspace-official-account group relative flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] text-foreground/62 hover:bg-surface-hover hover:text-foreground", collapsed && "is-collapsed")}
            style={collapsed ? undefined : { paddingLeft: 10 }}
            disabled={loading}
            aria-label={connected ? `BeefTV account:${name}` : label}
            title={connected ? `BeefTV account:${name}` : label}
            onClick={() => setOpen(true)}
        >
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2.5">
                <span className="app-workspace-nav-icon" aria-hidden="true">
                    {pending ? <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.8} /> : <UserRound className="size-4" strokeWidth={1.8} />}
                </span>
                {!collapsed ? <span className="app-workspace-nav-title truncate">{label}</span> : null}
            </span>
        </button>
        <AccountSettingsModal open={open} onClose={() => setOpen(false)} />
    </>;
}
