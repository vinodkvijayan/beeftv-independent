# `@beeftv/plugin-sdk`

BeefTV plug-in development SDK provides:

- The type of `beeftv` segment in `package.json` (`PluginManifest`)
- The host interface type of `activate(host)` on the browser side (`BeefTVPluginHost`)
- All interface extension bits (`BeefTVSlotMap`) and host events (`BeefTVEventMap`)
- Use JS to write `submit` / `query` types (`defineProvider`, `ProviderModule`) when generating services
- Assistant `pi` extended tool definition auxiliary function (`definePiExtension`, `PiExtensionAPI`)

## List

The plug-in ID, version, description and author are directly taken from `package.json`’s `name`, `version`, `description`, `author`. Only BeefTV’s own stuff is written in `beeftv`:

```json
{
  "name": "beeftv-plugin-sticky-note",
  "version": "0.1.0",
  "description": "在画布上放一张便签",
  "keywords": ["beeftv-plugin"],
  "beeftv": {
    "name": "画布便签",
    "client": "./client/index.js",
    "contributes": {
      "canvasNodes": [
        { "id": "sticky-note", "label": "画布便签", "defaultTitle": "便签", "renderer": "client", "defaultSize": { "width": 240, "height": 180 } }
      ]
    }
  }
}
```

When other keys are written (such as `beeftv.id`, top-level `canvasNodes`, node's `type`), BeefTV will not install and will explain how to change it one by one.

## How to use

BeefTV 直接加载插件里的 JS 文件，不经过打包，所以文件里不能 `import "@beeftv/plugin-sdk"`。把仓库内的 `packages/plugin-sdk` 装成开发依赖（例如 `npm i -D <BeefTV仓库路径>/packages/plugin-sdk`），用 JSDoc 拿到编辑器提示；用 TypeScript 或打包工具的插件也可以直接用 `definePlugin`、`defineProvider`，打包后发布。

## Interface plug-in

```js
/** @param {import("@beeftv/plugin-sdk").BeefTVPluginHost} host */
export function activate(host) {
  host.contribute("app.command", {
    id: "hello-beeftv",
    label: "向 BeefTV 问好",
    onSelect: () => host.ui.notify("你好，BeefTV！", "success"),
  });
}
```

## Use JS to write the generation service

在清单里登记 `"providers": [{ "id": "my-service", "label": "我的服务", "capabilities": ["image"], "scopes": ["user.custom-channel"], "module": "./provider.js" }]`（只支持图片、视频、音频），然后在 `provider.js` 里：

```js
/** @type {import("@beeftv/plugin-sdk").ProviderModule["submit"]} */
export async function submit(request, ctx) {
  const response = await fetch(`${ctx.config.baseUrl}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.config.apiKey}` },
    body: JSON.stringify({ prompt: request.prompt }),
    signal: ctx.signal,
  });
  if (!response.ok) return { status: "failed", message: `服务商返回 HTTP ${response.status}` };
  return { taskId: (await response.json()).id, status: "pending" };
}

/** @type {import("@beeftv/plugin-sdk").ProviderModule["query"]} */
export async function query(taskId, request, ctx) {
  const task = await (await fetch(`${ctx.config.baseUrl}/tasks/${taskId}`, { signal: ctx.signal })).json();
  if (task.state === "done") return { taskId, status: "succeeded", result: { images: [{ url: task.imageUrl }] } };
  return { taskId, status: "processing" };
}
```

You can also export `models(ctx)` and return `[{ id, displayName, capability }]`. After installing the plug-in, this service will appear in "Model Service → Select Service Provider". After the user fills in the address and clicks "Read Model", BeefTV will call it to list the models; otherwise, the user must manually fill in the model ID.

This file runs in the Node process next to the BeefTV backend. BeefTV is responsible for recording tasks, continuing the query after restarting, and downloading the results into the workspace; the plug-in only talks to the service provider.