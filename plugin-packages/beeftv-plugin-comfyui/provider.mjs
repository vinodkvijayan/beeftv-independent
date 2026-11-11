// BeefTV 的 ComfyUI 生成接口：每个在 ComfyUI 里保存过的工作流就是一个模型。
// 提交时读出工作流、填进提示词和素材、换掉种子，交给 ComfyUI 排队；查询时看 /history，
// 跑完后把输出文件的 /view 地址交给 BeefTV 下载。

import {
  inputTargets,
  missingNodeTypes,
  needsObjectInfo,
  outputNodeIds,
  prepareWorkflow,
  randomizeSeeds,
  setInput,
  workflowOutputKind,
} from "./lib/workflow.mjs";

const WORKFLOW_DIR = "workflows";
const OBJECT_INFO_TTL = 5 * 60 * 1000;
// 任务既不在队列也不在历史里，连续查到这么多次就当丢了（通常是 ComfyUI 重启过）。
const MISSING_LIMIT = 3;

/** @param {import("@beeftv/plugin-sdk").ProviderModuleContext} ctx */
function baseUrl(ctx) {
  const raw = String(ctx.config?.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Please fill in the service address of ComfyUI in the model service first");
  return raw.replace(/\/api$/, "");
}

async function comfy(ctx, path, init = {}) {
  const url = `${baseUrl(ctx)}/api${path}`;
  let response;
  try {
    response = await fetch(url, { ...init, signal: ctx.signal });
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    throw new Error("Can't connect to ComfyUI. Please confirm that ComfyUI has been started and the service address is filled in correctly.");
  }
  return response;
}

async function comfyJSON(ctx, path, init) {
  const response = await comfy(ctx, path, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // 留给下面按状态码报错。
  }
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.error || text.slice(0, 200) || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function workflowPath(model) {
  const name = String(model ?? "").trim();
  if (!name || name.split("/").some((part) => part === ".." || part === "")) throw new Error("Please select a ComfyUI workflow");
  return `${WORKFLOW_DIR}/${name}`;
}

async function readWorkflow(ctx, model) {
  try {
    return await comfyJSON(ctx, `/userdata/${encodeURIComponent(workflowPath(model))}`);
  } catch (error) {
    if (error.status === 404) throw new Error(`Workflow cannot be found in ComfyUI"${model}”, may have been renamed or deleted. Please re-read the model in the model service`);
    throw error;
  }
}

const objectInfoCache = new Map();

async function objectInfo(ctx, force = false) {
  const key = baseUrl(ctx);
  const cached = objectInfoCache.get(key);
  if (!force && cached && Date.now() - cached.at < OBJECT_INFO_TTL) return cached.data;
  const data = await comfyJSON(ctx, "/object_info");
  objectInfoCache.set(key, { at: Date.now(), data });
  return data;
}

async function prepare(ctx, raw) {
  if (!needsObjectInfo(raw)) return prepareWorkflow(raw, null);
  let info = await objectInfo(ctx);
  let missing = missingNodeTypes(raw, info);
  if (missing.length > 0) {
    // 用户刚装好节点包再试时，缓存里还是旧目录。
    info = await objectInfo(ctx, true);
    missing = missingNodeTypes(raw, info);
  }
  if (missing.length > 0) throw new Error(`This ComfyUI is missing nodes:${missing.join("、")}. Please install the corresponding node package first`);
  return prepareWorkflow(raw, info);
}

function mediaBytes(reference) {
  const dataUrl = String(reference.dataUrl ?? "");
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (match) {
    const body = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
    return { body, mimeType: match[1] || reference.mimeType };
  }
  return null;
}

async function readMedia(reference, ctx) {
  const inline = mediaBytes(reference);
  if (inline) return inline;
  const url = String(reference.url ?? "");
  if (!/^https?:\/\//i.test(url)) throw new Error("There is a reference material without a downloadable address.");
  const response = await fetch(url, { signal: ctx.signal });
  if (!response.ok) throw new Error(`Failed to download reference material: HTTP${response.status}`);
  return { body: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || reference.mimeType };
}

const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
};

// 素材传进 ComfyUI 的 input 目录。文件名带上 BeefTV 的提交编号，重复提交会覆盖同一个文件。
async function upload(ctx, reference, name) {
  const { body, mimeType } = await readMedia(reference, ctx);
  const extension = EXTENSIONS[String(mimeType ?? "").split(";")[0].trim()] ?? "bin";
  const form = new FormData();
  form.append("image", new Blob([body], { type: mimeType || "application/octet-stream" }), `${name}.${extension}`);
  form.append("type", "input");
  form.append("subfolder", "beeftv");
  form.append("overwrite", "true");
  const saved = await comfyJSON(ctx, "/upload/image", { method: "POST", body: form });
  return saved.subfolder ? `${saved.subfolder}/${saved.name}` : saved.name;
}

const KIND_LABEL = { image: "pictures", video: "video", audio: "Audio" };

function nodeErrorMessage(body) {
  const lines = [];
  for (const [nodeId, detail] of Object.entries(body?.node_errors ?? {})) {
    for (const error of detail?.errors ?? []) {
      lines.push(`node${nodeId}（${detail.class_type}）：${error.details || error.message}`);
    }
  }
  const head = body?.error?.message || "ComfyUI rejected this workflow";
  return lines.length > 0 ? `${head}：${lines.slice(0, 3).join("；")}` : head;
}

/** 读工作流、填输入、传素材。全部成功才有东西可提交；这里出错时 ComfyUI 还没有这个任务。 */
async function preparePrompt(request, ctx) {
  const prepared = await prepare(ctx, await readWorkflow(ctx, request.model));
  const targets = inputTargets(prepared);

  const prompt = String(request.prompt ?? "").trim();
  if (prompt && targets.prompt) setInput(prepared.graph, targets.prompt, prompt);
  if (prompt && !targets.prompt) ctx.log(`Workflow${request.model} There is no space for the prompt word. The prompt word is not used this time.`);

  const key = String(request.extra?.idempotencyKey ?? Date.now()).replace(/[^\w-]/g, "").slice(0, 40);
  // 局部重绘的蒙版不是普通输入图，工作流要用蒙版时请在 ComfyUI 里自己接。
  const supplied = { image: (request.images ?? []).filter((item) => item.role !== "mask"), video: request.videos ?? [], audio: request.audios ?? [] };
  for (const kind of ["image", "video", "audio"]) {
    const slots = targets.media[kind];
    if (supplied[kind].length > slots.length) {
      const limit = slots.length === 0 ? `Do not accept${KIND_LABEL[kind]}` : `Most received${slots.length} a${KIND_LABEL[kind]}`;
      return { status: "failed", message: `This workflow${limit}, this time I gave it${supplied[kind].length} a` };
    }
    // 给的素材比位置少时，其余位置用工作流里原来选的文件。
    for (const [index, reference] of supplied[kind].entries()) {
      setInput(prepared.graph, slots[index], await upload(ctx, reference, `${key}-${kind}-${index + 1}`));
    }
  }

  randomizeSeeds(prepared);
  const outputs = outputNodeIds(prepared);
  if (outputs.length === 0) return { status: "failed", message: "This workflow has no nodes to save images, videos or audios" };
  return { graph: prepared.graph, outputs };
}

/** @type {import("@beeftv/plugin-sdk").ProviderModule["submit"]} */
export async function submit(request, ctx) {
  // 没提交就出错是确定的失败，要把原因告诉用户；抛出去会被当成「提交结果不明」。
  const ready = await preparePrompt(request, ctx).catch((error) => {
    if (ctx.signal?.aborted) throw error;
    return { status: "failed", message: error.message };
  });
  if (ready.status === "failed") return ready;

  let queued;
  try {
    queued = await comfyJSON(ctx, "/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // 要取的输出节点存在 extra_data 里，查询时从 /history 读回来，不用再读一遍工作流。
      body: JSON.stringify({ prompt: ready.graph, client_id: "beeftv", extra_data: { beeftv: { outputs: ready.outputs } } }),
    });
  } catch (error) {
    // 400 是 ComfyUI 校验没过，任务肯定没建；别的错误说不准，交给 BeefTV 按提交结果不明处理。
    if (error.status === 400) return { status: "failed", message: nodeErrorMessage(error.body) };
    throw error;
  }
  if (!queued?.prompt_id) throw new Error("ComfyUI does not return the task number");
  return { taskId: queued.prompt_id, status: "pending" };
}

const missingCounts = new Map();

function executionError(messages) {
  for (const [type, detail] of messages ?? []) {
    if (type === "execution_error") {
      const where = detail?.node_type ? `node${detail.node_type} Error:` : "";
      return `${where}${detail?.exception_message || "ComfyUI failed to run"}`.trim();
    }
    if (type === "execution_interrupted") return "The task was interrupted in ComfyUI";
  }
  return "ComfyUI failed to run";
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)$/i;
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|opus|m4a)$/i;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/opus", m4a: "audio/mp4" };

function collectOutputs(ctx, entry) {
  const wanted = entry.prompt?.[3]?.beeftv?.outputs;
  const result = { images: [], videos: [], audios: [] };
  for (const [nodeId, output] of Object.entries(entry.outputs ?? {})) {
    if (Array.isArray(wanted) && wanted.length > 0 && !wanted.includes(nodeId)) continue;
    for (const value of Object.values(output ?? {})) {
      if (!Array.isArray(value)) continue;
      for (const file of value) {
        if (!file || typeof file.filename !== "string") continue;
        const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
        const extension = file.filename.split(".").pop()?.toLowerCase() ?? "";
        const reference = { url: `${baseUrl(ctx)}/api/view?${query}`, name: file.filename, mimeType: MIME[extension] };
        if (VIDEO_EXT.test(file.filename)) result.videos.push({ ...reference, kind: "video" });
        else if (AUDIO_EXT.test(file.filename)) result.audios.push({ ...reference, kind: "audio" });
        else if (MIME[extension]) result.images.push({ ...reference, kind: "image" });
      }
    }
  }
  return result;
}

/** @type {import("@beeftv/plugin-sdk").ProviderModule["query"]} */
export async function query(taskId, _request, ctx) {
  const history = await comfyJSON(ctx, `/history/${encodeURIComponent(taskId)}`);
  const entry = history?.[taskId];
  if (entry) {
    missingCounts.delete(taskId);
    if (entry.status?.status_str === "error") return { taskId, status: "failed", message: executionError(entry.status.messages) };
    if (entry.status && entry.status.completed === false) return { taskId, status: "processing" };
    const result = collectOutputs(ctx, entry);
    if (result.images.length + result.videos.length + result.audios.length === 0) {
      return { taskId, status: "failed", message: "The workflow is completed, but no images, videos or audios are produced." };
    }
    return { taskId, status: "succeeded", result };
  }
  const queue = await comfyJSON(ctx, "/queue");
  const has = (items) => (items ?? []).some((item) => item?.[1] === taskId);
  if (has(queue?.queue_running)) return { taskId, status: "processing" };
  if (has(queue?.queue_pending)) return { taskId, status: "pending" };
  const misses = (missingCounts.get(taskId) ?? 0) + 1;
  missingCounts.set(taskId, misses);
  if (misses < MISSING_LIMIT) return { taskId, status: "processing" };
  missingCounts.delete(taskId);
  return { taskId, status: "failed", message: "This task cannot be found in ComfyUI. ComfyUI may have been restarted. Please regenerate" };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

/** @type {NonNullable<import("@beeftv/plugin-sdk").ProviderModule["models"]>} */
export async function models(ctx) {
  let files;
  try {
    files = await comfyJSON(ctx, `/userdata?dir=${WORKFLOW_DIR}&recurse=true&split=false`);
  } catch (error) {
    if (error.status === 404) files = [];
    else throw error;
  }
  const names = (Array.isArray(files) ? files : []).filter((name) => typeof name === "string" && name.endsWith(".json")).sort();
  if (names.length === 0) {
    throw new Error("There are no saved workflows in this ComfyUI. Please open the workflow in ComfyUI and save it, then come back to read the model");
  }
  const listed = await mapLimit(names, 8, async (name) => {
    try {
      const capability = workflowOutputKind(await readWorkflow(ctx, name));
      return capability ? { id: name, displayName: name.replace(/(\.app)?\.json$/, ""), capability } : null;
    } catch (error) {
      ctx.log(`Read workflow${name} Failure:${error.message}`);
      return null;
    }
  });
  return listed.filter(Boolean);
}
