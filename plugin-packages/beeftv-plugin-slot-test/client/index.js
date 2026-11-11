// 全插槽演示插件：挂载全部 27 个界面扩展位（含剪辑工作台 8 个子插槽），
// 并订阅全部 5 类宿主事件。插件停用或卸载时由宿主自动撤销全部挂载。

const EDITOR_SLOTS = [
  { slot: "editor.timeline-panel", label: "Timeline panel extension" },
  { slot: "editor.preview-renderer", label: "Preview rendering extension" },
  { slot: "editor.inspector", label: "Property inspector extension" },
  { slot: "editor.asset-ingest", label: "Material import extension" },
  { slot: "editor.subtitle-tool", label: "Subtitle Tool Extension" },
  { slot: "editor.transcription-provider", label: "Transcription service extension" },
  { slot: "editor.export-renderer", label: "Export rendering extension" },
  { slot: "editor.ai-assistant", label: "Clip AI Assistant Extension" },
];

const HOST_EVENTS = [
  "generation.submitted",
  "generation.completed",
  "generation.failed",
  "assets.imported",
  "assistant.turnCompleted",
];

export function activate(host) {
  const React = host.React;
  const h = React ? React.createElement : () => null;
  const eventLog = [];

  // 订阅全部 5 类宿主事件
  for (const eventName of HOST_EVENTS) {
    host.events?.on?.(eventName, (payload) => {
      eventLog.unshift({
        event: eventName,
        at: new Date().toISOString(),
        payload,
      });
      if (eventLog.length > 25) eventLog.length = 25;
    });
  }

  // 1. canvas.node — 自定义画布节点
  function SlotTestNodeCard(props) {
    const greeting =
      host.config?.get?.("greeting", "Hello BeefTV") || "Hello BeefTV";
    const note =
      props?.node?.metadata?.pluginData?.note ||
      props?.node?.metadata?.content ||
      props?.node?.metadata?.prompt ||
      "Full socket demo node ready";
    return h(
      "div",
      {
        "data-testid": "slot-test-canvas-node",
        style: {
          height: "100%",
          padding: 14,
          paddingTop: 36,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderRadius: 10,
          background: "rgba(59, 130, 246, 0.12)",
          border: "1px solid rgba(59, 130, 246, 0.35)",
          boxSizing: "border-box",
          fontSize: 12,
        },
      },
      h(
        "div",
        { style: { fontWeight: 600, fontSize: 13 } },
        `🧩 ${greeting}`,
      ),
      h("div", { style: { opacity: 0.85, lineHeight: 1.5 } }, String(note)),
      h(
        "div",
        { style: { fontSize: 11, opacity: 0.65 } },
        `Captured events:${eventLog.length} Article`,
      ),
    );
  }

  host.contribute("canvas.node", {
    id: "slot-test-node",
    type: "slot-test-node",
    label: "Socket test node",
    title: "Socket test node",
    defaultTitle: "Socket test node",
    defaultWidth: 260,
    defaultHeight: 160,
    defaultSize: { width: 260, height: 160 },
    renderer: "client",
    schema: {
      type: "object",
      properties: { note: { type: "string" } },
    },
    render: SlotTestNodeCard,
    component: SlotTestNodeCard,
  });

  // 2. canvas.addNodeMenu — 添加节点菜单条目
  host.contribute("canvas.addNodeMenu", {
    id: "slot-test-add-node",
    label: "Socket test node",
    title: "Socket test node",
    nodeType: "slot-test-node",
    section: "node",
    defaultOrder: 95,
    onSelect: (ctx) => ctx?.handlers?.onAddExtensionNode?.("slot-test-node"),
    run: (ctx) => ctx?.handlers?.onAddExtensionNode?.("slot-test-node"),
  });

  // 3. canvas.toolbar.main — 画布主工具栏按钮
  host.contribute("canvas.toolbar.main", {
    id: "slot-test-toolbar-main",
    label: "Slot home button",
    title: "Slot home button",
    category: "create",
    defaultVisible: true,
    defaultOrder: 95,
    onClick: () => host.ui?.notify?.("Canvas main toolbar plugin button triggered", "info"),
    run: () => host.ui?.notify?.("Canvas main toolbar plugin button triggered", "info"),
  });

  // 4. canvas.toolbar.selection — 多选工具栏按钮
  host.contribute("canvas.toolbar.selection", {
    id: "slot-test-toolbar-selection",
    label: "Slot multi-select action",
    title: "Slot multi-select action",
    category: "selection",
    defaultVisible: true,
    defaultOrder: 95,
    onClick: () => host.ui?.notify?.("Multi-select toolbar plugin action triggered", "info"),
    run: () => host.ui?.notify?.("Multi-select toolbar plugin action triggered", "info"),
  });

  // 5. canvas.toolbar.nodeHover — 节点悬停工具栏按钮
  host.contribute("canvas.toolbar.nodeHover", {
    id: "slot-test-toolbar-node-hover",
    label: "Slot hover action",
    title: "Slot hover action",
    category: "node-state",
    defaultVisible: true,
    defaultOrder: 95,
    onClick: () => host.ui?.notify?.("Node hover toolbar plugin action triggered", "info"),
    run: () => host.ui?.notify?.("Node hover toolbar plugin action triggered", "info"),
  });

  // 6. canvas.contextMenu — 画布与节点右键菜单项
  host.contribute("canvas.contextMenu", {
    id: "slot-test-context-menu",
    label: "Slot test right click action",
    target: "both",
    order: 95,
    onSelect: () => host.ui?.notify?.("Right-click menu plug-in action has been triggered", "info"),
    run: () => host.ui?.notify?.("Right-click menu plug-in action has been triggered", "info"),
  });

  // 7. canvas.nodePanel — 节点配置面板扩展区域
  host.contribute("canvas.nodePanel", {
    id: "slot-test-node-panel",
    title: "Slot test configuration area",
    label: "Slot test configuration area",
    order: 95,
    render: ({ node }) =>
      h(
        "div",
        {
          "data-testid": "slot-test-node-panel",
          style: { fontSize: 12, padding: "8px 0" },
        },
        `Current node:${node?.title || node?.id || "Unnamed"}`,
      ),
  });

  // 8. canvas.promptActions — 提示词输入框旁的动作按钮
  host.contribute("canvas.promptActions", {
    id: "slot-test-prompt-action",
    label: "Add test tag",
    order: 95,
    onClick: ({ prompt, setPrompt }) => {
      const next = `${String(prompt || "").trim()} [Light and shadow texture]`.trim();
      setPrompt?.(next);
    },
  });

  // 9. canvas.sidePanel — 画布侧栏面板页
  host.contribute("canvas.sidePanel", {
    id: "slot-test-side-panel",
    label: "Slot monitoring",
    title: "Slot and event monitoring",
    order: 95,
    render: () =>
      h(
        "div",
        {
          "data-testid": "slot-test-side-panel",
          style: { padding: 12, fontSize: 12 },
        },
        h("div", { style: { fontWeight: 600, marginBottom: 8 } }, "Host event log"),
        eventLog.length === 0
          ? h("div", { style: { opacity: 0.7 } }, "No event record yet")
          : eventLog.map((item, idx) =>
              h(
                "div",
                { key: `${item.at}-${idx}`, style: { marginBottom: 4 } },
                `${item.event} (${item.at.slice(11, 19)})`,
              ),
            ),
      ),
  });

  // 10. generation.beforeSubmit — 提交生成前的钩子。返回 { prompt } 会改写提示词并提示用户是哪个插件改的；
  //     这个自检插件只挂上钩子、不改任何东西，避免启用后影响真实生成。
  host.contribute("generation.beforeSubmit", {
    id: "slot-test-before-submit",
    label: "Full slot demo plugin",
    order: 95,
    transform: () => undefined,
  });

  // 11. editor.* — 剪辑工作台全部 8 个插槽
  for (const item of EDITOR_SLOTS) {
    host.contribute(item.slot, {
      id: `slot-test-${item.slot}`,
      label: item.label,
      title: item.label,
      priority: 10,
      render: () =>
        h(
          "div",
          {
            "data-testid": `slot-test-${item.slot}`,
            style: { padding: 8, fontSize: 12 },
          },
          `[Full Slots Demo]${item.label}`,
        ),
    });
  }

  // 12. assets.source — 外部素材来源
  host.contribute("assets.source", {
    id: "slot-test-assets-source",
    label: "Demo source",
    description: "Sample assets provided by the full slot demo plug-in",
    listFolders: async () => [{ id: "demo-root", name: "Demo material directory" }],
    list: async () => [],
    render: () =>
      h(
        "div",
        { "data-testid": "slot-test-assets-source", style: { padding: 12 } },
        "Demonstration external material source has been mounted",
      ),
  });

  // 13. assets.itemActions — 素材卡片与详情操作
  host.contribute("assets.itemActions", {
    id: "slot-test-asset-action",
    label: "Send to slot test",
    order: 95,
    onSelect: (asset) => {
      host.ui?.notify?.(`Selected materials:${asset?.title || asset?.id || ""}`, "info");
    },
  });

  // 14. app.page — 独立插件页面（/p/beeftv-plugin-slot-test）
  host.contribute("app.page", {
    id: "slot-test-page",
    path: "/p/beeftv-plugin-slot-test",
    title: "Full slot demo page",
    label: "Full slot demo page",
    render: () =>
      h(
        "div",
        {
          "data-testid": "slot-test-app-page",
          style: { padding: 24, display: "flex", flexDirection: "column", gap: 12 },
        },
        h("h2", { style: { margin: 0 } }, "Full slot demo plugin standalone page"),
        h(
          "p",
          { style: { margin: 0, opacity: 0.8 } },
          "This page is mounted through the app.page slot, and the path is /p/beeftv-plugin-slot-test.",
        ),
      ),
  });

  // 15. app.sidebar — 全局侧栏导航入口
  host.contribute("app.sidebar", {
    id: "slot-test-sidebar",
    label: "Slot demo",
    path: "/p/beeftv-plugin-slot-test",
    order: 95,
  });

  // 16. app.command — 全局命令面板命令
  host.contribute("app.command", {
    id: "slot-test-command",
    label: "Run the full-slot demo self-test",
    shortcut: "Mod+Shift+9",
    keywords: ["slot", "test", "slot", "Demo"],
    onSelect: () => host.ui?.notify?.("All-slot demo plug-in self-test passed", "success"),
    run: () => host.ui?.notify?.("All-slot demo plug-in self-test passed", "success"),
  });

  // 17. app.settings — 插件中心自定义设置面板
  host.contribute("app.settings", {
    id: "slot-test-settings",
    title: "Full slot demo plugin setup",
    label: "Full slot demo plugin setup",
    render: ({ config, onChange }) =>
      h(
        "div",
        {
          "data-testid": "slot-test-app-settings",
          style: { display: "flex", flexDirection: "column", gap: 8, padding: 8 },
        },
        h("label", { style: { fontSize: 12, fontWeight: 500 } }, "Test greeting"),
        h("input", {
          type: "text",
          value: String(config?.greeting ?? "Hello BeefTV"),
          onChange: (e) =>
            onChange?.({ ...(config || {}), greeting: e.target.value }),
          style: {
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(148, 163, 184, 0.35)",
            background: "transparent",
          },
        }),
      ),
  });

  // 18. pluginCenter.section — 插件中心左侧分区栏
  host.contribute("pluginCenter.section", {
    id: "slot-test-section",
    label: "Slot diagnostics",
    description: "View mount status of 27 expansion slots and 5 host events",
    order: 95,
    render: () =>
      h(
        "div",
        {
          "data-testid": "slot-test-plugin-center-section",
          style: { padding: 16, fontSize: 13 },
        },
        "All 27 interface extension bits and 5 types of event listening are activated.",
      ),
  });

  // 19. project.view — 项目详情分页视图
  host.contribute("project.view", {
    id: "slot-test-project-view",
    label: "Slot view",
    title: "Slot demo view",
    order: 95,
    render: ({ projectId }) =>
      h(
        "div",
        {
          "data-testid": "slot-test-project-view",
          style: { padding: 16, fontSize: 13 },
        },
        `Project${projectId || "Current project"} Plug-in to extend paginated view`,
      ),
  });

  // 20. assistant.toolCard — 助手面板工具调用结果卡片
  host.contribute("assistant.toolCard", {
    id: "slot-test-tool-card",
    toolName: "slot_test_ping",
    label: "Socket test probe",
    render: ({ args, result, status }) =>
      h(
        "div",
        {
          "data-testid": "slot-test-assistant-tool-card",
          style: {
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(59, 130, 246, 0.35)",
            background: "rgba(59, 130, 246, 0.1)",
            fontSize: 12,
          },
        },
        h("div", { style: { fontWeight: 600 } }, "🧩 Socket test probe receipt"),
        h(
          "div",
          { style: { marginTop: 4, opacity: 0.85 } },
          `Enter message:${args?.message || ""} · Status:${status || "completed"}`,
        ),
        result
          ? h(
              "div",
              { style: { marginTop: 4, opacity: 0.75 } },
              typeof result === "string" ? result : JSON.stringify(result),
            )
          : null,
      ),
  });
}

export default activate;
