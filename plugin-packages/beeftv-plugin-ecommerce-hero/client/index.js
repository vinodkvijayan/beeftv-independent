// 一键商品主图插件客户端入口：
// 1. 挂载 ecommerce-hero 画布节点（支持填写商品名称、图片地址、选择场景风格与出图张数，点击一键在画布创建场景主图节点）
// 2. 挂载 canvas.addNodeMenu（「一键商品主图」）
// 3. 挂载 assistant.toolCard（美化 ecommerce_hero_arrange 工具在助手面板里的结果卡片）

const SCENE_STYLES = [
  { value: "studio", label: "Studio shot texture", promptPrefix: "The main image of the e-commerce commercial studio shoot, soft box three-dimensional lighting, pure high-end background" },
  { value: "lifestyle", label: "life scenes", promptPrefix: "The main picture of the e-commerce real life scene, natural daylight, high immersive life aesthetics" },
  { value: "festival", label: "holiday promotion", promptPrefix: "The main image of the e-commerce promotion atmosphere, festive high-end light and shadow, highlighting the core visual focus" },
];

const SCENE_COUNTS = [1, 2, 4];

export function activate(host) {
  const React = host.React;
  const h = React.createElement;

  function EcommerceHeroNodeCard(props) {
    const pluginData = props?.node?.metadata?.pluginData || {};
    const [productTitle, setProductTitle] = React.useState(
      pluginData.productTitle || props?.node?.title || "New featured products",
    );
    const [imageUrl, setImageUrl] = React.useState(pluginData.imageUrl || "");
    const [sceneStyle, setSceneStyle] = React.useState(
      pluginData.sceneStyle || SCENE_STYLES[0].value,
    );
    const [sceneCount, setSceneCount] = React.useState(
      Number(pluginData.sceneCount) || 2,
    );
    const [submitting, setSubmitting] = React.useState(false);
    const [statusMessage, setStatusMessage] = React.useState("");

    const syncPluginData = (patch) => {
      const next = {
        productTitle,
        imageUrl,
        sceneStyle,
        sceneCount,
        ...patch,
      };
      props?.updateNodeData?.(next);
    };

    const handleCreateSceneNodes = async () => {
      setSubmitting(true);
      setStatusMessage("");
      try {
        const styleItem =
          SCENE_STYLES.find((item) => item.value === sceneStyle) ||
          SCENE_STYLES[0];
        const count = SCENE_COUNTS.includes(Number(sceneCount))
          ? Number(sceneCount)
          : 2;

        const canvasId = host.context.getCanvasId();
        if (!canvasId) throw new Error("Please open a canvas first");
        const current = await host.ops.call("canvas.get", { canvasId });
        const expectedRevision = current?.canvas?.revision;
        if (!Number.isSafeInteger(expectedRevision)) throw new Error("Unable to read canvas version, please refresh and try again");

        const drafts = Array.from({ length: count }, (_, idx) => ({
          type: "image",
          title: `${productTitle || "merchandise"} · ${styleItem.label} #${idx + 1}`,
          prompt: `${styleItem.promptPrefix}, commodity subject:${productTitle || "Featured products"}, No.${idx + 1} perspective composition${imageUrl ? `, refer to the product picture:${imageUrl}` : ""}。`,
        }));
        await host.ops.call("canvas.nodes.create", { canvasId, expectedRevision, nodes: drafts });
        setStatusMessage(`Created${count} a${styleItem.label}Main graph node`);
        host.ui?.notify?.(
          `has been "${productTitle || "merchandise"}"Generate${count} main graph nodes`,
          "success",
        );
      } catch (err) {
        const msg = err?.message || "Failed to create main graph node";
        setStatusMessage(msg);
        host.ui?.notify?.(msg, "error");
      } finally {
        setSubmitting(false);
      }
    };

    return h(
      "div",
      {
        "data-testid": "ecommerce-hero-node",
        "data-plugin-node": "ecommerce-hero",
        style: {
          height: "100%",
          width: "100%",
          padding: "36px 14px 12px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
        },
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            },
          },
          h(
            "span",
            { style: { fontWeight: 600, fontSize: 13 } },
            "🛍️ One-click product main image",
          ),
          h(
            "span",
            { style: { fontSize: 11, opacity: 0.65 } },
            `${sceneCount} scene picture`,
          ),
        ),
        h("input", {
          type: "text",
          "data-testid": "ecommerce-hero-title-input",
          value: productTitle,
          onChange: (e) => {
            setProductTitle(e.target.value);
            syncPluginData({ productTitle: e.target.value });
          },
          placeholder: "Enter the product name (for example: retro Bluetooth speaker)",
          style: {
            width: "100%",
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid rgba(148, 163, 184, 0.35)",
            background: "transparent",
            color: "inherit",
            boxSizing: "border-box",
          },
        }),
        h("input", {
          type: "url",
          "data-testid": "ecommerce-hero-image-input",
          value: imageUrl,
          onChange: (e) => {
            setImageUrl(e.target.value);
            syncPluginData({ imageUrl: e.target.value });
          },
          placeholder: "Paste the product white background image URL or connect the upstream image node",
          style: {
            width: "100%",
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid rgba(148, 163, 184, 0.35)",
            background: "transparent",
            color: "inherit",
            boxSizing: "border-box",
          },
        }),
        h(
          "div",
          { style: { display: "flex", gap: 6, alignItems: "center" } },
          h("span", { style: { opacity: 0.75, whiteSpace: "nowrap" } }, "Style:"),
          h(
            "select",
            {
              "data-testid": "ecommerce-hero-style-select",
              value: sceneStyle,
              onChange: (e) => {
                setSceneStyle(e.target.value);
                syncPluginData({ sceneStyle: e.target.value });
              },
              style: {
                flex: 1,
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid rgba(148, 163, 184, 0.35)",
                background: "transparent",
                color: "inherit",
              },
            },
            SCENE_STYLES.map((item) =>
              h("option", { key: item.value, value: item.value }, item.label),
            ),
          ),
          h("span", { style: { opacity: 0.75, whiteSpace: "nowrap" } }, "Number of sheets:"),
          h(
            "div",
            { style: { display: "flex", gap: 4 } },
            SCENE_COUNTS.map((count) =>
              h(
                "button",
                {
                  key: count,
                  type: "button",
                  "data-testid": `ecommerce-hero-count-${count}`,
                  onClick: () => {
                    setSceneCount(count);
                    syncPluginData({ sceneCount: count });
                  },
                  style: {
                    padding: "3px 8px",
                    borderRadius: 5,
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    background:
                      sceneCount === count
                        ? "rgba(59, 130, 246, 0.22)"
                        : "transparent",
                    color: "inherit",
                    fontWeight: sceneCount === count ? 600 : 400,
                    cursor: "pointer",
                  },
                },
                `${count}images`,
              ),
            ),
          ),
        ),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        statusMessage
          ? h(
              "div",
              {
                "data-testid": "ecommerce-hero-status",
                style: { fontSize: 11, opacity: 0.85 },
              },
              statusMessage,
            )
          : null,
        h(
          "button",
          {
            type: "button",
            "data-testid": "ecommerce-hero-submit-btn",
            disabled: submitting,
            onClick: handleCreateSceneNodes,
            style: {
              width: "100%",
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid rgba(59, 130, 246, 0.5)",
              background: "rgba(59, 130, 246, 0.2)",
              color: "inherit",
              fontWeight: 600,
              cursor: submitting ? "wait" : "pointer",
            },
          },
          submitting ? "Creating main graph node..." : "Generate main graph nodes",
        ),
      ),
    );
  }

  host.contribute("canvas.node", {
    id: "ecommerce-hero",
    type: "ecommerce-hero",
    label: "One-click product main image",
    title: "One-click product main image",
    defaultTitle: "Product main image",
    description: "Upload the white background image/real shot of the product, select the number of scenes and generate the e-commerce main image",
    defaultWidth: 320,
    defaultHeight: 280,
    defaultSize: { width: 320, height: 280 },
    acceptsInputKind: "image",
    renderer: "client",
    schema: {
      type: "object",
      properties: {
        productTitle: { type: "string" },
        imageUrl: { type: "string" },
        sceneStyle: { type: "string" },
        sceneCount: { type: "number" },
      },
    },
    render: EcommerceHeroNodeCard,
    component: EcommerceHeroNodeCard,
  });

  host.contribute("canvas.addNodeMenu", {
    id: "ecommerce-hero-add",
    label: "One-click product main image",
    title: "One-click product main image",
    nodeType: "ecommerce-hero",
    section: "node",
    defaultOrder: 89,
    onSelect: (ctx) => ctx?.handlers?.onAddExtensionNode?.("ecommerce-hero"),
    run: (ctx) => ctx?.handlers?.onAddExtensionNode?.("ecommerce-hero"),
  });

  host.contribute("assistant.toolCard", {
    id: "ecommerce-hero-tool-card",
    toolName: "ecommerce_hero_arrange",
    label: "Arrange product main images with one click",
    render: ({ args, result, status }) =>
      h(
        "div",
        {
          "data-testid": "ecommerce-hero-tool-card",
          style: {
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(16, 185, 129, 0.35)",
            background: "rgba(16, 185, 129, 0.1)",
            fontSize: 12,
          },
        },
        h(
          "div",
          { style: { fontWeight: 600 } },
          `🛍️ One-click product main image arrangement ·${args?.productTitle || "merchandise"}`,
        ),
        h(
          "div",
          { style: { marginTop: 4, opacity: 0.85 } },
          `Selling Points:${args?.sellingPoints || "Not filled in"} · Number of scenes:${args?.sceneCount ?? 2} Zhang · Status:${status || "completed"}`,
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
