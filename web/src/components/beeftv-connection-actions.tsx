import { Button } from "antd";
import type { BeefTVConnectionSummary } from "@/services/api/beeftv-connection";

export function BeefTVConnectionActions({
    connection,
    busy,
    onConnect,
    onCancel,
    onRetry,
    onDisconnect,
    onWallet,
}: {
    connection: BeefTVConnectionSummary | null;
    busy: boolean;
    onConnect: () => void;
    onCancel: () => void;
    onRetry: () => void;
    onDisconnect: () => void;
    onWallet: () => void;
}) {
    const state = connection?.state || "disconnected";
    const buttonClass = "h-10 sm:h-8";
    if (state === "connecting") {
        return <Button className={buttonClass} size="small" loading disabled>Connecting</Button>;
    }
    if (state === "pending") {
        return (
            <>
                <Button className={buttonClass} size="small" loading={busy} onClick={onCancel}>
                                        Cancel
                </Button>
            </>
        );
    }
    if (state === "connected") {
        return (
            <>
                <Button className={buttonClass} size="small" onClick={onWallet}>
                                        Open BeefTV account
                </Button>
                <Button className={buttonClass} size="small" loading={busy} onClick={onDisconnect}>
                                        Disconnect
                </Button>
            </>
        );
    }
    if (state === "catalog_failed") {
        return (
            <>
                <Button className={buttonClass} size="small" type="primary" loading={busy} onClick={onRetry}>
                                        Reconnect
                </Button>
                <Button className={buttonClass} size="small" loading={busy} onClick={onDisconnect}>
                                        Disconnect
                </Button>
            </>
        );
    }
    if (state === "expired" || state === "revoked" || state === "rejected" || state === "store_error" || state === "connection_error" || state === "cancelled") {
        return (
            <Button data-onboarding="official-connect" className={buttonClass} size="small" type="primary" loading={busy} onClick={onRetry}>
                                Reconnect
            </Button>
        );
    }
    return (
        <Button data-onboarding="official-connect" className={buttonClass} size="small" type="primary" loading={busy} onClick={onConnect}>
                        Connect to BeefTV
        </Button>
    );
}
