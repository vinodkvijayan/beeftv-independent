import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const source = read("src/services/api/agent-assistant.ts");
const hook = read("src/pages/canvas/use-canvas-assistant.ts");
const sidebar = read("src/pages/canvas/canvas-assistant-sidebar.tsx");
const composer = read("src/pages/canvas/canvas-assistant-composer.tsx");
const turn = read("src/pages/canvas/canvas-assistant-turn.tsx");
const copy = read("src/pages/canvas/canvas-assistant-copy.ts");
const project = read("src/pages/canvas/project.tsx");
const proposal = read("src/pages/canvas/use-canvas-assistant-proposal.ts");
const syncStatus = read("src/pages/canvas/canvas-sync-status.tsx");

/** 粗略取出源码里的字符串字面量与模板字符串，用于检查渲染文案。 */
function source_string_literals(code: string) {
    const literals = code.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
    return literals.map((literal) => literal.slice(1, -1));
}

describe("Assistant front-end wiring", () => {
    test("Streaming conversations and stopping hitting the real registered /api/assistant/* routes on the backend", () => {
        // 后端 registerAgentProxyRoutes 注册的是 /assistant/chat 与 /assistant/cancel；
        // 曾经写成 /api/agent/* 时每一次发送都只拿到 404，面板永远没有回复。
        // 原生 Wails 的页面 origin 不是后端地址，必须使用当前运行时的 API base。
        expect(source).toContain('fetch(`${apiBaseURL}/assistant/chat`');
        expect(source).toContain('fetch(`${apiBaseURL}/assistant/cancel`');
        expect(source).not.toContain("/api/agent/chat");
        expect(source).not.toContain("/api/agent/cancel");
        expect(source).toContain('http.post<{ token: string; expiresAt: string }>("/assistant/ui-session"');
        expect(source).toContain('http.get<AgentHostStatus>("/assistant/status")');
    });

    test("Session, history, revocation, and restart follow the routes in the contract and bring UI session headers.", () => {
        expect(source).toContain('"/assistant/host/restart"');
        expect(source).toContain("/assistant/sessions?canvasId=");
        expect(source).toContain('"/assistant/sessions"');
        expect(source).toContain('"/assistant/sessions/activate"');
        expect(source).toContain("/assistant/history?");
        expect(source).toContain("/undo");
        expect(source).toContain('"X-Beeftv-Ui-Session": token');
    });

    test("The interface copy uses user language and does not contain implementer terminology.", () => {
        // 只看会渲染给用户的字符串字面量，避免把 DOM 变量名当成文案。
        const files = [copy, sidebar, composer, turn];
        const userFacing = files.flatMap(source_string_literals).filter((text) => /[一-鿿]/.test(text));
        expect(userFacing.length).toBeGreaterThan(10);
        for (const text of userFacing) {
            // BeefTV 是用户自己的账户名称，属于产品名，不是实现细节；
            // 先摘掉它再检查术语，避免把品牌名误判成实现术语。
            const scrubbed = text.replaceAll("BeefTV", "");
            for (const term of ["agent-host", "host", "Node", "Idempotent", "MCP", "revision", "API", "token", "session"]) {
                expect(scrubbed).not.toContain(term);
            }
        }
    });

    test("After the round lands, the canvas immediately pulls the latest content and lights up the changed nodes.", () => {
        expect(hook).toContain("onCanvasChanged");
        expect(project).toContain("refreshLocalCanvasProjectIfChanged(canvasId).then(() => highlightAssistantNodes(");
    });

    test("Freezes the selected object snapshot when sending and does not allow subsequent selection changes.", () => {
        expect(hook).toContain("const selectedSnapshot = [...selectedNodeIds]");
        expect(hook).toContain("selectedSnapshot");
        // 归属也一起冻结：结果只写回发送时那个画布。
        expect(hook).toContain("const targetCanvas = activeCanvasRef.current");
    });

    test("The panel is the right dock, no longer an absolutely positioned card floating on the canvas", () => {
        expect(project).not.toContain("absolute right-4 top-24");
        expect(project).not.toContain("CanvasAgentAssistantPanel");
        expect(sidebar).toContain('className="canvas-assistant-sidebar"');
    });

    test("Panels only use style variables that actually exist in the application", () => {
        const css = read("src/pages/canvas/canvas-assistant-sidebar.css");
        // 这些变量在 globals.css 里从来没有定义过；用它们会让面板变成透明白框。
        for (const missing of ["--bg-elevated", "--text-primary", "--border-color", "--bg-hover", "--text-secondary", "--accent-color", "--shadow-panel", "--bg-subtle", "--bg-input", "--canvas-panel-bg", "--canvas-panel-border"]) {
            expect(css).not.toContain(missing);
            expect(sidebar).not.toContain(missing);
        }
        expect(css).toContain("var(--background)");
        expect(css).toContain("var(--border)");
        expect(css).toContain("var(--muted-foreground)");
    });

    test("The external change prompt is moved to the top bar to save the state, and is no longer repeated in the panel.", () => {
        expect(syncStatus).toContain("pendingExternalCanvasRevision");
        expect(syncStatus).toContain("acceptExternalCanvasRevision");
        expect(sidebar).not.toContain("pendingExternalCanvasRevision");
    });

    test("The assistant entrance and shortcut keys are all connected", () => {
        const topBar = read("src/pages/canvas/canvas-project-top-bar.tsx");
        const keyboard = read("src/pages/canvas/use-canvas-keyboard.ts");
        const shortcuts = read("src/lib/canvas/canvas-shortcuts.ts");
        const selectionTools = read("src/lib/canvas/tool-registry/definitions/selection-toolbar-tools.tsx");
        const emptyState = read("src/components/canvas/canvas-short-drama-entry.tsx");
        expect(topBar).toContain("canvas-topbar-agent-button");
        expect(topBar).toContain('aria-pressed={assistantOpen}');
        expect(keyboard).toContain('key === "j"');
        expect(keyboard).toContain("onToggleAssistant?.()");
        expect(shortcuts).toContain('id: "assistant"');
        expect(selectionTools).toContain("Ask the assistant");
        expect(emptyState).toContain("Or ask your assistant to make a draft");
    });

    test("Paid generation is performed by the existing generation link of the canvas, and the panel does not adjust the model itself.", () => {
        expect(project).toContain("runAssistantProposal");
        expect(project).toContain("useCanvasAssistantProposal");
        expect(proposal).toContain("const generateForThisRun = handleGenerateNodeRef.current");
        expect(proposal).toMatch(/generate:\s*(?:generateForThisRun\b|\([^)]*\)\s*=>\s*generateForThisRun\()/);
        expect(proposal).toContain("stillOwns: () => lifetime.matches(owner, projectIdRef.current)");
        expect(proposal).toContain("prepareAssistantProposalSnapshot");
        expect(proposal).toContain("executeAssistantProposal");
        for (const file of [sidebar, composer, turn, hook]) {
            expect(file).not.toContain("services/api/image");
            expect(file).not.toContain("channel-transport");
        }
    });
});
