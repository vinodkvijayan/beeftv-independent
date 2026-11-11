import { http } from "@/services/api/request";

let connectionEpoch = 0;
export function getBeefTVConnectionEpoch() {
    return connectionEpoch;
}

/** 请求期间 BeefTV 连接被重连或断开：丢弃旧连接的结果，不能当成新连接的数据。 */
export class BeefTVConnectionChangedError extends Error {
    constructor() {
        super("BeefTV connection has changed, please read again");
        this.name = "BeefTVConnectionChangedError";
    }
}

export type BeefTVAccount = {
    id: string;
    username?: string;
    display_name?: string;
    email?: string;
};

export type BeefTVConnectionState = "disconnected" | "connecting" | "connection_error" | "pending" | "connected" | "expired" | "cancelled" | "rejected" | "store_error" | "catalog_failed" | "revoked";

export type BeefTVConnectionSummary = {
    state: BeefTVConnectionState | string;
    userCode?: string;
    verificationUri?: string;
    expiresAt?: string;
    account?: BeefTVAccount | null;
    keyName?: string;
    tokenId?: string;
    market?: string;
    walletUrl?: string;
    balance?: "unknown" | "zero" | "available" | string;
    catalogFailed?: boolean;
    errorReason?: string;
    connectedAt?: string;
    credentialRef?: string;
    hasCredential?: boolean;
};

export function getBeefTVConnection(signal?: AbortSignal) {
    return http.get<BeefTVConnectionSummary>("/beeftv/connection", { signal });
}

export function startBeefTVConnection(signal?: AbortSignal) {
    connectionEpoch++;
    // Authorization may need a proxy handshake and one safe direct attempt.
    return http.post<BeefTVConnectionSummary>("/beeftv/connection/start", {}, { signal, timeout: 35_000 });
}

export function cancelBeefTVConnection(signal?: AbortSignal) {
    connectionEpoch++;
    return http.post<BeefTVConnectionSummary>("/beeftv/connection/cancel", {}, { signal });
}

export function disconnectBeefTVConnection(signal?: AbortSignal) {
    connectionEpoch++;
    return http.post<BeefTVConnectionSummary>("/beeftv/connection/disconnect", {}, { signal });
}

export function openBeefTVWallet(signal?: AbortSignal) {
    return http.post<{ opened: boolean }>("/beeftv/connection/open-wallet", {}, { signal });
}

export function isBeefTVAuthenticated(summary: BeefTVConnectionSummary | null | undefined) {
    return Boolean(summary && (summary.state === "connected" || (summary.state === "catalog_failed" && summary.hasCredential)));
}

export function beefTVConnectionLabel(summary: BeefTVConnectionSummary | null | undefined) {
    const state = summary?.state || "disconnected";
    switch (state) {
        case "connecting":
            return summary?.errorReason || "Connecting to BeefTV";
        case "connection_error":
            return summary?.errorReason || "Unable to connect to BeefTV service, please check the network and try again";
        case "pending":
            return summary?.errorReason || (summary?.userCode ? `Please confirm in your browser${summary.userCode}` : "Please confirm authorization in your browser");
        case "connected":
            return connectedAccountLabel(summary);
        case "expired":
            return "Authorization has expired, please reconnect";
        case "cancelled":
            return "This connection has been canceled";
        case "rejected":
            return "Authorization denied";
        case "store_error":
            return "Failed to save connection, please try again";
        case "catalog_failed":
            return "Failed to read model list, please try again";
        case "revoked":
            return "The connection has expired, please reconnect.";
        default:
            return "Not connected";
    }
}

function connectedAccountLabel(summary: BeefTVConnectionSummary | null | undefined) {
    const account = summary?.account;
    const name = account?.email || account?.display_name || account?.username;
    if (name && summary?.balance === "zero") return `Connected${name}, the balance is 0`;
    if (name) return `Connected${name}`;
    if (summary?.balance === "zero") return "Connected, balance is 0";
    return "Connected";
}
