import { expect, spyOn, test } from "bun:test";
import { beefTVConnectionLabel, startBeefTVConnection, type BeefTVConnectionSummary } from "../src/services/api/beeftv-connection";
import { http } from "../src/services/api/request";

test("connection labels stay user-facing and distinct", () => {
    const cases: Array<[BeefTVConnectionSummary, string]> = [
        [{ state: "disconnected", hasCredential: false }, "Not connected"],
        [{ state: "connecting", hasCredential: false }, "Connecting to BeefTV"],
        [{ state: "connecting", errorReason: "Trying other connection methods", hasCredential: false }, "Trying other connection methods"],
        [{ state: "connection_error", hasCredential: false }, "Unable to connect to BeefTV service, please check the network and try again"],
        [{ state: "connection_error", errorReason: "BeefTV connection service is temporarily unavailable, please try again later.", hasCredential: false }, "BeefTV connection service is temporarily unavailable, please try again later."],
        [{ state: "pending", userCode: "WXYZ-1234", hasCredential: false }, "Please confirm in your browser WXYZ-1234"],
        [{ state: "pending", userCode: "WXYZ-1234", errorReason: "Connection interrupted, retrying", hasCredential: false }, "Connection interrupted, retrying"],
        [{ state: "pending", userCode: "WXYZ-1234", errorReason: "Completing connection confirmation", hasCredential: true }, "Completing connection confirmation"],
        [{ state: "connected", account: { id: "1", display_name: "studio" }, hasCredential: true }, "Studio connected"],
        [{ state: "connected", account: { id: "1", display_name: "studio" }, balance: "zero", hasCredential: true }, "Studio connected, balance is 0"],
        [{ state: "expired", hasCredential: false }, "Authorization has expired, please reconnect"],
        [{ state: "cancelled", hasCredential: false }, "This connection has been canceled"],
        [{ state: "rejected", hasCredential: false }, "Authorization denied"],
        [{ state: "store_error", hasCredential: false }, "Failed to save connection, please try again"],
        [{ state: "catalog_failed", hasCredential: true }, "Failed to read model list, please try again"],
        [{ state: "revoked", hasCredential: true }, "The connection has expired, please reconnect."],
    ];
    for (const [summary, label] of cases) {
        expect(beefTVConnectionLabel(summary)).toBe(label);
    }
});

test("starting authorization waits beyond the backend connection budget and preserves cancellation", async () => {
    const controller = new AbortController();
    const post = spyOn(http, "post").mockResolvedValue({ state: "pending", hasCredential: false });
    try {
        await startBeefTVConnection(controller.signal);
        expect(post).toHaveBeenCalledWith("/beeftv/connection/start", {}, { signal: controller.signal, timeout: 35_000 });
    } finally {
        post.mockRestore();
    }
});
