// 会话动作身份的确定性用例：不需要模型，也不需要真实 SDK 会话。
// 身份前缀来自 Durable 会话 id（`durable:<uuid>`），必须绑定在单条会话上，
// 不能用宿主进程级全局变量：同一 toolCallId 在两条会话里不能撞成同一个 operationId。
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { toolOperationId } from "./session-identity.mjs";

const serverSource = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
const ownerSource = readFileSync(new URL("./session-owner.mjs", import.meta.url), "utf8");

describe("session action identity", () => {
    test("The same toolCallId of two sessions will not collide with the same operationId.", () => {
        const callInA = toolOperationId("durable:sess-A", "call-1", "fallback");
        const callInB = toolOperationId("durable:sess-B", "call-1", "fallback");

        expect(callInA).not.toBe(callInB);
        expect(callInA).toBe("durable:sess-A:call-1");
        expect(callInB).toBe("durable:sess-B:call-1");
    });

    test("The same toolCallId in the same session will still have the same operationId after restarting", () => {
        // 前缀是持久会话 id，进程重启（不同 RUN_ID）不改变它。
        expect(toolOperationId("durable:sess-A", "call-9", "x")).toBe(toolOperationId("durable:sess-A", "call-9", "x"));
    });

    test("Return toolCallId when there is no prefix, and do not impersonate the actions of other sessions.", () => {
        expect(toolOperationId("", "call-1", "fallback")).toBe(":call-1");
        expect(toolOperationId("durable:sess-A", "", "fallback")).toBe("durable:sess-A:fallback");
    });

    test("The host does not need to save session identity and persistence state globally at the process level.", () => {
        expect(serverSource).not.toContain("let sessionIdentity");
        expect(serverSource).not.toContain("let persistenceState");
        expect(ownerSource).not.toContain("let sessionIdentity");
        expect(serverSource).toContain("persistence:entry.persistence");
    });
});

/**
 * 用官方 SessionManager 做真实 create → 重新 open 往返，验证旧 JSONL 历史
 * 仍能按 session id 稳定找回。这不是纯函数测试：它真的经过 SDK 的持久化路径。
 */
describe("Retrieve old JSONL session history by id", () => {
    test("create → list → open to get the same session id", async () => {
        const sessionDir = mkdtempSync(join(tmpdir(), "beeftv-session-id-"));
        const cwd = mkdtempSync(join(tmpdir(), "beeftv-session-cwd-"));

        const created = SessionManager.create(cwd, sessionDir);
        const createdId = created.getSessionId();
        created.appendMessage({ role: "user", content: [{ type: "text", text: "Identity check" }] });
        created.appendMessage({ role: "assistant", content: [{ type: "text", text: "received" }] });

        // 宿主读取路径：list 找出会话文件，再 open 同一条会话。
        const known = await SessionManager.list(cwd, sessionDir);
        expect(known.length).toBeGreaterThan(0);
        const target = [...known].sort((a, b) => String(b.modified ?? "").localeCompare(String(a.modified ?? "")))[0];
        const file = target.path || SessionManager.findById(cwd, target.id, sessionDir);
        expect(file).toBeTruthy();
        const reopened = SessionManager.open(file, sessionDir, cwd);

        expect(reopened.getSessionId()).toBe(createdId);
    });
});
