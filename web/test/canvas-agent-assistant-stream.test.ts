import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

/**
 * NDJSON 回合流的确定性边界用例：分片切割、末尾无换行、中途断流。
 * 全部用内存流，不调用模型。
 */

const requests: Array<{ url: string; method: string; body: string }> = [];
let chatResponse: (() => Response | Promise<Response>) | null = null;
let sessionResponse: (() => Response) | null = null;

const { ApiError, http, apiClient, configureApiRuntime } = await import("@/services/api/request");
const requestRuntime = await import("@/services/api/request");
let previousFetch: typeof fetch;
let previousBaseURL: string;
let previousDesktopToken: unknown, previousBootstrapToken: unknown;
let httpGetSpy: ReturnType<typeof spyOn>, httpPostSpy: ReturnType<typeof spyOn>;
const {
    AgentChatNotAdmittedError,
    AgentStreamDetachedError,
    AGENT_STREAM_INCOMPLETE_MESSAGE,
    assistantUndoFailure,
    cancelAgentChat,
    confirmAssistantProposalRunnable,
    confirmAssistantScriptProposal,
    steerAgentChat,
    ensureAgentUiSession,
    resetAgentUiSession,
    streamAgentChat,
} = await import("@/services/api/agent-assistant");

/** 把整段 NDJSON 按给定分片切开发成流，模拟真实网络分片（可切到单个字节）。 */
function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
            controller.close();
        },
    });
}

function chatResponseOf(chunks: string[]): Response {
    return new Response(streamOf(chunks), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

function installFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({ url, method: init?.method || "GET", body: String(init?.body || "") });
        if (url.includes("/api/assistant/chat")) return chatResponse ? chatResponse() : new Response(null, { status: 500 });
        if (url.includes("/api/assistant/cancel")) return cancelResponse();
        if (url.includes("/api/assistant/steer")) return steerResponse();
        if (url.includes("/api/assistant/ui-session")) return new Response(JSON.stringify({ code: 0, data: { token: "ui-token" } }), { status: 200 });
        return new Response("{}", { status: 200 });
    }) as typeof fetch;
}

let cancelResponse: () => Response = () => new Response(JSON.stringify({ code: 0, accepted: true }), { status: 202 });
let steerResponse = () => new Response(JSON.stringify({ code: 0, data: { accepted: true } }), { status: 200 });

beforeEach(() => {
    previousFetch = globalThis.fetch;
    previousBaseURL = requestRuntime.apiBaseURL;
    previousDesktopToken = apiClient.defaults.headers.common["X-Desktop-Token"];
    previousBootstrapToken = apiClient.defaults.headers.common["X-Beeftv-UI-Bootstrap"];
    configureApiRuntime("http://127.0.0.1:54321/api", "");
    httpGetSpy = spyOn(http, "get").mockImplementation(async () => ({ available: true }) as never);
    httpPostSpy = spyOn(http, "post").mockImplementation(async () => {
        const response = sessionResponse ? sessionResponse() : new Response(JSON.stringify({ code: 0, data: { token: "ui-token" } }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (!response.ok) throw new ApiError("session failed", { status: response.status });
        const payload = await response.json();
        return payload.data;
    });
    requests.length = 0;
    chatResponse = null;
    sessionResponse = null;
    cancelResponse = () => new Response(JSON.stringify({ code: 0, accepted: true }), { status: 202 });
    resetAgentUiSession();
    steerResponse = () => new Response(JSON.stringify({ code: 0, data: { accepted: true } }), { status: 200 });
    installFetch();
});

afterEach(() => {
    resetAgentUiSession();
    globalThis.fetch = previousFetch;
    httpGetSpy.mockRestore();
    httpPostSpy.mockRestore();
    configureApiRuntime(previousBaseURL, String(previousDesktopToken || ""), previousBootstrapToken ? String(previousBootstrapToken) : undefined);
    if (previousDesktopToken === undefined) delete apiClient.defaults.headers.common["X-Desktop-Token"];
});

const TURN_END = JSON.stringify({ type: "turn_end", reply: "Done", toolCalls: [], error: null, cancelled: false });

describe("Authoring Assistant Turn Flow Boundary", () => {
    test("Expired generation confirmation returns a clear prompt, and generally available proposals are not affected.", async () => {
        // Establish the UI session before replacing the proposal endpoint response.
        sessionResponse = () => new Response(JSON.stringify({ data: { token: "ui-token", expiresAt: new Date(Date.now() + 1_800_000).toISOString() } }));
        await ensureAgentUiSession();
        httpPostSpy.mockRejectedValueOnce(new ApiError("internal detail", { status: 409, reason: "continuation_intent_changed" }));
        expect(await confirmAssistantProposalRunnable("old", "gp-old", "canvas")).toBe("It has expired. Please ask the assistant to propose a new generation plan.");
        httpPostSpy.mockResolvedValueOnce({ runnable: true } as never);
        expect(await confirmAssistantProposalRunnable("current", "gp-current", "canvas")).toBeNull();
    });
    test("Confirm that running skill scripts uses a long timeout (1830s) and is not interrupted by the 4 second default JSON timeout", async () => {
        sessionResponse = () => new Response(JSON.stringify({ data: { token: "ui-token", expiresAt: new Date(Date.now() + 1_800_000).toISOString() } }));
        await ensureAgentUiSession();
        let capturedUrl = "";
        let capturedBody: unknown = null;
        let capturedConfig: Record<string, unknown> | undefined;
        httpPostSpy.mockImplementationOnce((async (url: string, body: unknown, config?: Record<string, unknown>) => {
            capturedUrl = url;
            capturedBody = body;
            capturedConfig = config;
            return { proposal: { proposalId: "sp-1", status: "completed" }, result: { exitCode: 0 } };
        }) as never);
        await confirmAssistantScriptProposal("canvas-1", "turn-1", "sp-1", true);
        expect(capturedUrl).toBe("/assistant/turns/turn-1/script-proposals/sp-1/run");
        expect(capturedBody).toEqual({ canvasId: "canvas-1", alwaysAllowSession: true });
        expect(capturedConfig?.timeout).toBe(1_830_000);
        expect((capturedConfig?.headers as Record<string, string>)?.["X-Beeftv-Ui-Session"]).toBe("ui-token");
    });
    test("The handover session identity is handed over to the interface before observer_error and disconnection, and the round cannot be pretended to be completed.", async () => {
        let sessionId = "legacy-session";
        let ended = false;
        chatResponse = () => chatResponseOf([
            JSON.stringify({ type: "session", sessionId: "durable:successor" }) + "\n",
            JSON.stringify({ type: "observer_error", reason: "interrupted" }) + "\n",
        ]);
        await expect(streamAgentChat("c1", "continue", {
            onSession: value => { sessionId = value; },
            onTurnEnd: () => { ended = true; },
        })).rejects.toThrow(AGENT_STREAM_INCOMPLETE_MESSAGE);
        expect(sessionId).toBe("durable:successor");
        expect(ended).toBe(false);
    });
    test("observer_error indicates that it is just observing the disconnection, and the interface changes to read the result instead of treating it as a disconnection failure.", async () => {
        chatResponse = () => chatResponseOf([
            JSON.stringify({ type: "session", sessionId: "durable:s1" }) + "\n",
            JSON.stringify({ type: "text_delta", delta: "Started" }) + "\n",
            JSON.stringify({ type: "observer_error", reason: "interrupted" }) + "\n",
        ]);
        const error = await streamAgentChat("c1", "continue", {}).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(AgentStreamDetachedError);
        expect((error as InstanceType<typeof AgentStreamDetachedError>).reason).toBe("interrupted");
        expect((error as Error).message).toBe(AGENT_STREAM_INCOMPLETE_MESSAGE);
        chatResponse = () => chatResponseOf([JSON.stringify({ type: "text_delta", delta: "half" }) + "\n"]);
        const cut = await streamAgentChat("c1", "continue", {}).catch((caught: unknown) => caught);
        expect(cut).toBeInstanceOf(Error);
        expect(cut).not.toBeInstanceOf(AgentStreamDetachedError);
    });
    test("Running supplements only send text and the current conversation, and do not create new rounds or additional materials.", async () => {
        await steerAgentChat("c1", "s1", "End with cake");
        const calls = requests.filter(item => item.url.includes("/assistant/steer"));
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0]!.body)).toEqual({ canvasId: "c1", sessionId: "s1", message: "End with cake" });
        expect(requests.some(item => item.url.includes("/assistant/chat"))).toBe(false);
    });
    test("Attachments and skills only send the saved description, chat and steer do not carry local preview or content", async () => {
        const attachment = { resourceId: "r1", assetId: "a1", kind: "image" as const, name: "Reference.png", mimeType: "image/png", bytes: 100, purpose: "style" as const, dataUrl: "data:image/png;base64,DO_NOT_SEND", file: "local-file" };
        const skill = { skillId: "s1", versionId: "v1", contentHash: "a".repeat(64), skillName: "Storyboard", version: "1" };
        chatResponse = () => chatResponseOf([`${TURN_END}\n`]);
        await streamAgentChat("c1", "", {}, { attachments: [attachment], skills: [skill], references: [{ kind: "asset", id: "a1" }] });
        const body = JSON.parse(requests.find(item => item.url.includes("/assistant/chat"))!.body);
        expect(body.message).toBe(""); expect(body.attachments[0].dataUrl).toBeUndefined(); expect(body.attachments[0].file).toBeUndefined();
        expect(body.skills).toEqual([{ skillId: "s1", versionId: "v1", contentHash: "a".repeat(64) }]);
        await steerAgentChat("c1", "current", "", { attachments: [attachment], skills: [skill], references: [{ kind: "asset", id: "a1" }] });
        const supplement = JSON.parse(requests.find(item => item.url.includes("/assistant/steer"))!.body);
        expect(supplement.attachments).toEqual(body.attachments); expect(supplement.skills).toEqual(body.skills); expect(supplement.references).toEqual(body.references);
    });

    test("Supplementary requests will be reported as successful only if they are clearly received, and will not be automatically resent if rejected or disconnected.", async () => {
        for (const response of [
            () => new Response(JSON.stringify({ code: 409, reason: "session_not_running" }), { status: 409 }),
            () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
            () => new Response("not JSON", { status: 200 }),
        ]) {
            requests.length = 0;
            steerResponse = response;
            await expect(steerAgentChat("c1", "s1", "Only change the ending")).rejects.toThrow();
            expect(requests.filter(item => item.url.includes("/assistant/steer"))).toHaveLength(1);
        }
    });
    test("Renew before expiration in 30 minutes, concurrent calls share one issuance", async () => {
        let now = Date.parse("2026-10-02T00:00:00Z");
        const clock = spyOn(Date, "now").mockImplementation(() => now);
        let issued = 0;
        sessionResponse = () => new Response(JSON.stringify({ data: { token: `token-${++issued}`, expiresAt: new Date(now + 30 * 60_000).toISOString() } }));
        try {
            expect(await Promise.all([ensureAgentUiSession(), ensureAgentUiSession()])).toEqual(["token-1", "token-1"]);
            now += 29 * 60_000;
            expect(await ensureAgentUiSession()).toBe("token-1");
            now += 30_000;
            expect(await ensureAgentUiSession()).toBe("token-2");
            expect(issued).toBe(2);
        } finally { clock.mockRestore(); }
    });

    test("After reset, the old issuance cannot be written back or the old credentials can be returned.", async () => {
        let issued = 0;
        sessionResponse = () => new Response(JSON.stringify({ data: { token: `token-${++issued}`, expiresAt: new Date(Date.now() + 1_800_000).toISOString() } }));
        const stale = ensureAgentUiSession().catch((error: Error) => error);
        resetAgentUiSession();
        expect(await ensureAgentUiSession()).toBe("token-2");
        expect(await stale).toBeInstanceOf(Error);
        expect((await stale as Error).message).toContain("The current page session has been updated");
        expect(await ensureAgentUiSession()).toBe("token-2");
    });

    test("Explicit 403 Acceptance Rejection clears old credentials but never automatically replays the message", async () => {
        let issued = 0;
        sessionResponse = () => new Response(JSON.stringify({ data: { token: `token-${++issued}`, expiresAt: new Date(Date.now() + 1_800_000).toISOString() } }));
        chatResponse = () => new Response(JSON.stringify({ reason: "unauthenticated" }), { status: 403, headers: { "X-Beeftv-Turn-Admission": "rejected" } });
        await expect(streamAgentChat("c1", "hi", {})).rejects.toBeInstanceOf(AgentChatNotAdmittedError);
        expect(requests.filter((r) => r.url.endsWith("/chat"))).toHaveLength(1);
        expect(await ensureAgentUiSession()).toBe("token-2");
    });

    test("The issuance failed and no chat was sent, so it will be treated as not accepted.", async () => {
        sessionResponse = () => new Response("", { status: 403 });
        await expect(streamAgentChat("c1", "hi", {})).rejects.toBeInstanceOf(AgentChatNotAdmittedError);
        expect(requests).toHaveLength(0);
    });

    test("Delayed return of 403 for old requests will not clear new credentials that have been renewed", async () => {
        let issued = 0;
        sessionResponse = () => new Response(JSON.stringify({ data: { token: `token-${++issued}`, expiresAt: new Date(Date.now() + 1_800_000).toISOString() } }));
        let rejectResponse!: (response: Response) => void;
        let sent!: () => void;
        const dispatched = new Promise<void>((resolve) => { sent = resolve; });
        chatResponse = () => {
            sent();
            return new Promise<Response>((resolve) => { rejectResponse = resolve; });
        };
        const oldRequest = streamAgentChat("c1", "hi", {}).catch((error: Error) => error);
        await dispatched;
        resetAgentUiSession();
        expect(await ensureAgentUiSession()).toBe("token-2");
        rejectResponse(new Response(JSON.stringify({ reason: "unauthenticated" }), { status: 403, headers: { "X-Beeftv-Turn-Admission": "rejected" } }));
        expect(await oldRequest).toBeInstanceOf(AgentChatNotAdmittedError);
        expect(await ensureAgentUiSession()).toBe("token-2");
        expect(issued).toBe(2);
    });

    test("HTTP errors without an explicit reject tag and accepted disconnections continue to be treated as unknown.", async () => {
        for (const admission of [null, "unknown", "admitted"]) {
            chatResponse = () => new Response(JSON.stringify({ reason: "host_unreachable" }), { status: 503, headers: admission ? { "X-Beeftv-Turn-Admission": admission } : {} });
            const error = await streamAgentChat("c1", "hi", {}).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(AgentChatNotAdmittedError);
        }
        chatResponse = () => chatResponseOf([`{"type":"text_delta","delta":"半截"}\n`]);
        const error = await streamAgentChat("c1", "hi", {}).catch((e: unknown) => e);
        expect(error).not.toBeInstanceOf(AgentChatNotAdmittedError);
        expect(requests.filter((r) => r.url.endsWith("/chat"))).toHaveLength(4);
    });
	 test("Conversation and disconnection of the current desktop runtime address", async () => {
		chatResponse = () => chatResponseOf([TURN_END + "\n"]);
		await streamAgentChat("canvas-1", "test", {});
		await cancelAgentChat("canvas-1");
		expect(requests.map((request) => request.url)).toEqual([
			"http://127.0.0.1:54321/api/assistant/chat",
			"http://127.0.0.1:54321/api/assistant/cancel",
		]);
	 });
    test("Fragment cutting (including cross-line and multi-byte Chinese) can still fully retrieve the increment and final round", async () => {
        const line = JSON.stringify({ type: "text_delta", delta: "Rainy night alley" }) + "\n";
        const bytes = new TextEncoder().encode(line + TURN_END + "\n");
        // 在每个字节边界切一刀：任何依赖「一次读到整行」的实现都会露馅，
        // 同时覆盖中文被切断在多字节序列中间的情况。
        const chunks: Uint8Array[] = [];
        for (let index = 0; index < bytes.length; index += 1) chunks.push(bytes.slice(index, index + 1));
        chatResponse = () => new Response(streamOf(chunks), { status: 200 });

        const deltas: string[] = [];
        let ended = 0;
        await streamAgentChat("c1", "hi", { onDelta: (delta) => deltas.push(delta), onTurnEnd: () => { ended += 1; } });

        expect(deltas.join("")).toBe("Rainy night alley");
        expect(ended).toBe(1);
    });

    test("The last line must be processed even if there is no newline character (the tail cannot be lost)", async () => {
        chatResponse = () => chatResponseOf([`${JSON.stringify({ type: "text_delta", delta: "tail" })}\n`, TURN_END]);

        const deltas: string[] = [];
        let reply = "";
        await streamAgentChat("c1", "hi", { onDelta: (delta) => deltas.push(delta), onTurnEnd: (end) => { reply = end.reply; } });

        expect(deltas.join("")).toBe("tail");
        expect(reply).toBe("Done");
    });

    test("Text snapshot replaces the old fragment, is scheduled to be delivered immediately before turn_end and can be cleared", async () => {
        const plan = { goal: "Generate and check first frame", items: [{ id: "s1", title: "first frame", status: "doing" }], done: 0, total: 1, updatedAt: "now" };
        chatResponse = () => chatResponseOf([
            JSON.stringify({ type: "text_snapshot", text: "Beginning and middle section" }) + "\n",
            JSON.stringify({ type: "plan", plan }) + "\n",
            JSON.stringify({ type: "text_snapshot", text: "Beginning, middle and end" }) + "\n",
            JSON.stringify({ type: "plan", plan: null }) + "\n", TURN_END,
        ]);
        const observed: unknown[] = [];
        let text = "";
        await streamAgentChat("c1", "hi", {
            onText: value => { text = value; },
            onPlan: value => observed.push(value),
            onTurnEnd: () => observed.push("end"),
        });
        expect(text).toBe("Beginning, middle and end");
        expect(observed).toEqual([plan, null, "end"]);
    });

    test("Stream ended but no final turn event → explicit incomplete error, improper success", async () => {
        chatResponse = () => chatResponseOf([`${JSON.stringify({ type: "text_delta", delta: "half" })}\n`]);

        await expect(streamAgentChat("c1", "hi", { onDelta: () => {} })).rejects.toThrow(AGENT_STREAM_INCOMPLETE_MESSAGE);
    });

    test("Corrupted JSON lines → explicit incomplete errors, no longer swallowed by continue", async () => {
        chatResponse = () => chatResponseOf(["{ this is not json }\n", `${TURN_END}\n`]);

        await expect(streamAgentChat("c1", "hi", {})).rejects.toThrow(AGENT_STREAM_INCOMPLETE_MESSAGE);
    });

    test("The flow is interrupted midway (reader throws an error) and is thrown upward. It is not regarded as a normal end.", async () => {
        const encoder = new TextEncoder();
        chatResponse = () => new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ type: "text_delta", delta: "half" })}\n`));
                controller.error(new Error("network down"));
            },
        }), { status: 200 });

        await expect(streamAgentChat("c1", "hi", {})).rejects.toThrow("network down");
    });

    test("round in which the host returns error → user-visible failure without revealing implementer terminology", async () => {
        chatResponse = () => chatResponseOf([`${JSON.stringify({ type: "turn_end", reply: "", toolCalls: [], error: "TypeError: x is not a function", cancelled: false })}\n`]);

        await expect(streamAgentChat("c1", "hi", {})).rejects.toThrow("This round was not completed, please try again");
    });

    test("The lifecycle event will not regard the round as the end, nor will the agent_end be settled.", async () => {
        const lifecycle = JSON.stringify({ type: "lifecycle", phase: "compaction", reason: "threshold" });
        const agentEnd = JSON.stringify({ type: "agent_end", willRetry: false, messages: [] });
        chatResponse = () => chatResponseOf([`${lifecycle}\n`, `${agentEnd}\n`]);
        const phases: string[] = [];
        await expect(streamAgentChat("c1", "hi", {
            onLifecycle: (event) => { phases.push(event.phase); },
        })).rejects.toThrow(AGENT_STREAM_INCOMPLETE_MESSAGE);
        expect(phases).toEqual(["compaction"]);
    });

    test("canceled The round ends normally.", async () => {
        chatResponse = () => chatResponseOf([`${JSON.stringify({ type: "turn_end", reply: "Stopped", toolCalls: [], error: null, cancelled: true })}\n`]);

        let cancelled = false;
        await streamAgentChat("c1", "hi", { onTurnEnd: (end) => { cancelled = end.cancelled; } });

        expect(cancelled).toBe(true);
    });

    test("Stop failure (404 Session does not exist) must be thrown and cannot be regarded as stopped.", async () => {
        cancelResponse = () => new Response(JSON.stringify({ code: 404, reason: "session_not_found" }), { status: 404 });

        await expect(cancelAgentChat("c1")).rejects.toThrow();
    });

    test("Stop returning business failure (HTTP 202 but code is non-0) and also throw it", async () => {
        cancelResponse = () => new Response(JSON.stringify({ code: 500, reason: "internal_error" }), { status: 202 });

        await expect(cancelAgentChat("c1")).rejects.toThrow();
    });

    test("Don’t throw an error when stopping successfully", async () => {
        await expect(cancelAgentChat("c1")).resolves.toBeUndefined();
    });

    test("Stop pointing to this send: bring the session and request identifier, and read back the stop result of this request", async () => {
        cancelResponse = () => new Response(JSON.stringify({ code: 0, data: { accepted: true, state: "pending" } }), { status: 200 });
        await expect(cancelAgentChat("c1", { sessionId: "durable:s1", requestId: "req-1" })).resolves.toBe("pending");
        expect(JSON.parse(requests.at(-1)!.body)).toEqual({ canvasId: "c1", sessionId: "durable:s1", requestId: "req-1" });
    });

    test("Each time you send it, bring your own request ID.", async () => {
        chatResponse = () => chatResponseOf([TURN_END + "\n"]);
        await streamAgentChat("c1", "hi", {}, { requestId: "req-2" });
        expect(JSON.parse(requests.find((request) => request.url.endsWith("/chat"))!.body).requestId).toBe("req-2");
    });

    test("The final round brings back the turnId, change list and generated proposal", async () => {
        const end = {
            type: "turn_end",
            turnId: "turn-7",
            reply: "Three lenses have been built",
            toolCalls: [{ toolCallId: "t1", tool: "canvas.nodes.create" }],
            change: { revisionBefore: 4, revisionAfter: 5, createdNodeIds: ["n1", "n2", "n3"], updatedNodeIds: [], createdEdgeIds: ["e1", "e2"] },
            proposals: [{ proposalId: "p1", kind: "image", nodeIds: ["n1"], model: "seedream-4", modelKey: "ch::seedream-4" }],
            error: null,
            cancelled: false,
        };
        chatResponse = () => chatResponseOf([`${JSON.stringify(end)}\n`]);

        let received: Record<string, unknown> | null = null;
        await streamAgentChat("c1", "hi", { onTurnEnd: (value) => { received = value as unknown as Record<string, unknown>; } });

        expect(received).not.toBeNull();
        expect(received!.turnId).toBe("turn-7");
        expect(received!.change).toEqual(end.change);
        expect(received!.proposals).toEqual(end.proposals);
    });

    test("Old format (without turnId/change/proposals) still ends on success", async () => {
        chatResponse = () => chatResponseOf([`${TURN_END}\n`]);
        let received: Record<string, unknown> | null = null;
        await streamAgentChat("c1", "hi", { onTurnEnd: (value) => { received = value as unknown as Record<string, unknown>; } });
        expect(received!.turnId).toBeUndefined();
        expect(received!.change).toBeUndefined();
    });

    test("Give an actionable sentence when the session is not the current one", async () => {
        chatResponse = () => new Response(JSON.stringify({ code: 409, reason: "session_not_current" }), { status: 409 });
        await expect(streamAgentChat("c1", "hi", {}, { sessionId: "stale" })).rejects.toThrow("You have switched to another conversation, please resend this message");
    });

    test("Only put the sessionId into the request body when specifying a session.", async () => {
        chatResponse = () => chatResponseOf([`${TURN_END}\n`]);
        await streamAgentChat("c1", "hi", {}, { sessionId: "s-1", selectedNodeIds: ["n1"] });
        const chat = requests.find((item) => item.url.includes("/assistant/chat"));
        expect(JSON.parse(chat!.body)).toEqual({ canvasId: "c1", message: "hi", selectedNodeIds: ["n1"], sessionId: "s-1", permissionMode: "canvas" });

        requests.length = 0;
        await streamAgentChat("c1", "hi", {});
        const plain = requests.find((item) => item.url.includes("/assistant/chat"));
        expect(JSON.parse(plain!.body)).toEqual({ canvasId: "c1", message: "hi", selectedNodeIds: [], permissionMode: "canvas" });
    });

    test("Explicit permissions are frozen for each new round, adding that changes to permission fields cannot be sent", async () => {
        chatResponse = () => chatResponseOf([`${TURN_END}\n`]);
        for (const permissionMode of ["read-only", "canvas", "full-access"] as const) {
            await streamAgentChat("c1", "hi", {}, { permissionMode });
            expect(JSON.parse(requests.filter(item => item.url.includes("/assistant/chat")).at(-1)!.body).permissionMode).toBe(permissionMode);
        }
        await steerAgentChat("c1", "s1", "supplement", { permissionMode: "full-access" } as any);
        expect(JSON.parse(requests.find(item => item.url.includes("/assistant/steer"))!.body)).toEqual({ canvasId: "c1", sessionId: "s1", message: "supplement" });
    });
});

describe("Reason for undo failure", () => {
    test("Each of the three types of 409 can be distinguished, and the unknown cause is classified into unknown", () => {
        // 必须用同一个 ApiError 类，instanceof 才会命中（这里复用真实 API 错误类）。
        const failure = (reason?: string) => new ApiError("failed", { status: 409, reason });
        expect(assistantUndoFailure(failure("canvas_changed_since_turn"))).toBe("canvas_changed");
        expect(assistantUndoFailure(failure("turn_already_undone"))).toBe("already_undone");
        expect(assistantUndoFailure(failure("turn_has_no_change"))).toBe("no_change");
        expect(assistantUndoFailure(failure("brand_new_reason"))).toBe("unknown");
        expect(assistantUndoFailure(new Error("boom"))).toBe("unknown");
    });
});
