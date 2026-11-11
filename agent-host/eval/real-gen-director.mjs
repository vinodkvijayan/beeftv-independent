// 假文本模型的确定性导演：只用于本地假生成流程，不参与真实模式。
import { randomBytes } from 'node:crypto';
import { isTransientStudioTailMessage } from '../studio-digest.mjs';

const IMAGE_MODEL = 'seedream-5-0-260128';
const VIDEO_MODEL = 'seedance-2.0-fast';

// ---------- 确定性导演（假文本模型） ----------

function extractMessageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('\n');
}

function parseToolMessages(messages = []) {
  const calls = new Map();
  const results = [];
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }
        calls.set(call.id, { id: call.id, name: call.function?.name || '', args });
      }
    }
    if (message.role === 'tool') {
      const text = extractMessageText(message);
      let data = null;
      try { data = JSON.parse(text.split('\n')[0]); } catch { data = null; }
      const call = calls.get(message.tool_call_id) || { id: message.tool_call_id, name: '', args: {} };
      results.push({ toolCallId: message.tool_call_id, name: call.name, args: call.args, rawText: text, data });
    }
  }
  return { results };
}

function currentTurnView(messages = [], scenarios = []) {
  let lastUser = -1;
  let scenarioText = '';
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role !== 'user') continue;
    const text = extractMessageText(messages[index]).trim();
    if (!text || isTransientStudioTailMessage(messages[index])) continue;
    // 场景消息一定包含在用户原文里；画布变化提醒、素材补充等宿主追加消息不应改变轮次归属。
    const matched = (scenarios || []).find((message) => text.includes(message));
    if (matched) {
      scenarioText = matched;
      lastUser = index;
    }
  }
  if (lastUser < 0) {
    // 兜底：真实模式不使用导演脚本，但保留一个可用的当前轮起点。
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index].role !== 'user') continue;
      const text = extractMessageText(messages[index]).trim();
      const hasImage = Array.isArray(messages[index].content) && messages[index].content.some((part) => part && (part.type === 'image_url' || part.type === 'image'));
      if (!text || text.startsWith('The following is the material content returned by the aforementioned tools') || isTransientStudioTailMessage(messages[index]) || (hasImage && !text.includes('BEEFTV_CONTEXT:'))) continue;
      if (!text.includes('BEEFTV_SUPPLEMENT:')) lastUser = index;
    }
  }
  const slice = messages.slice(lastUser >= 0 ? lastUser : 0).filter((message) => !isTransientStudioTailMessage(message));
  const { results } = parseToolMessages(slice);
  return { toolResults: results, allText: slice.map(extractMessageText).join('\n'), scenarioText };
}

const lastTool = (results, name) => [...results].reverse().find((item) => item.name === name);
const hasTool = (results, name) => results.some((item) => item.name === name);
const nodesOf = (result) => result?.data?.canvas?.nodes || result?.data?.result?.canvas?.nodes || result?.data?.result?.nodes || result?.data?.nodes || [];
const revisionOf = (results, fallback = 1) => {
  let revision = fallback;
  for (const item of results) {
    const data = item.data;
    for (const value of [data?.revision, data?.result?.revision, data?.canvas?.revision, data?.result?.canvas?.revision]) {
      if (Number.isSafeInteger(value) && value > 0) revision = Math.max(revision, value);
    }
  }
  return revision;
};

function sseChunk(res, model, delta, finish, usage) {
  const chunk = { id: 'gen-fake', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }], ...(usage ? { usage } : {}) };
  res.write('data: ' + JSON.stringify(chunk) + '\n\n');
}

function sendToolCall(res, model, name, args, toolResults) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  sseChunk(res, model, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + randomBytes(4).toString('hex'), type: 'function',
    function: { name, arguments: JSON.stringify(args || {}) } }] }, null);
  sseChunk(res, model, {}, 'tool_calls', { prompt_tokens: 1400 + toolResults.length * 420, completion_tokens: 70 });
  res.end('data: [DONE]\n\n');
}

function sendText(res, model, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  sseChunk(res, model, { role: 'assistant', content: text }, null);
  sseChunk(res, model, {}, 'stop', { prompt_tokens: 1800, completion_tokens: 90 });
  res.end('data: [DONE]\n\n');
}

function fakeDirectorReply(res, body, scenarios) {
  const model = body.model || 'fake-gen-model';
  const { toolResults, scenarioText } = currentTurnView(body.messages || [], scenarios);
  const revision = revisionOf(toolResults, 1);
  const tool = (name) => lastTool(toolResults, name);

  // 第 3 轮：保存时间线并本地渲染成片。不新建画布节点，避免把成片硬塞进分镜行。
  if (scenarioText?.includes('cut into pieces')) {
    if (!hasTool(toolResults, 'canvas_get')) return sendToolCall(res, model, 'canvas_get', {}, toolResults);
    const nodes = nodesOf(tool('canvas_get'));
    const videos = nodes.filter((node) => node.type === 'video').slice(0, 2);
    if (videos.length === 0) return sendText(res, model, 'There are no videos to cut on the canvas yet.');
    const timeline = {
      version: 2,
      tracks: [{ id: 'video-track', kind: 'video' }],
      clips: videos.map((node, index) => ({ id: `clip-${index + 1}`, kind: 'video', trackId: 'video-track',
        nodeId: node.id, startMs: index * 5000, durationMs: 5000 })),
      durationMs: videos.length * 5000,
    };
    const updated = tool('canvas_timeline_update');
    if (!updated) return sendToolCall(res, model, 'canvas_timeline_update', { expectedRevision: revision, timeline }, toolResults);
    const updatedRevision = updated?.data?.result?.revision;
    const renderRevision = Number.isSafeInteger(updatedRevision) ? updatedRevision : revision + 1;
    if (!hasTool(toolResults, 'canvas_timeline_render')) {
      return sendToolCall(res, model, 'canvas_timeline_render', { expectedRevision: renderRevision }, toolResults);
    }
    return sendText(res, model, 'The two shots have been cut into one final film and rendered, and the final film file has been saved.');
  }

  // 第 2 轮：查看首帧，再为两个镜头准备视频草稿并登记方案。
  if (scenarioText?.includes('The first frame of the picture is out') || scenarioText?.includes('5 seconds per shot')) {
    if (!hasTool(toolResults, 'canvas_get')) return sendToolCall(res, model, 'canvas_get', {}, toolResults);
    const nodes = nodesOf(tool('canvas_get'));
    const script = nodes.find((node) => node.type === 'script');
    const images = nodes.filter((node) => node.type === 'image');
    if (!hasTool(toolResults, 'media_overview') && images[0]) {
      return sendToolCall(res, model, 'media_overview', { nodeId: images[0].id }, toolResults);
    }
    const rows = script?.metadata?.storyboard?.rows || [];
    const rowIds = rows.map((row) => row.id).filter(Boolean);
    if (!hasTool(toolResults, 'canvas_script_prepare')) {
      if (!script || rowIds.length === 0) return sendText(res, model, 'There is no storyboard to continue on the canvas yet.');
      return sendToolCall(res, model, 'canvas_script_prepare', {
        expectedRevision: revision, nodeId: script.id, rowIds,
        video: { model: VIDEO_MODEL, generateAudio: 'false' },
      }, toolResults);
    }
    const prepared = tool('canvas_script_prepare');
    const shots = prepared?.data?.result?.shots || [];
    const videoIds = shots.map((shot) => shot.videoNodeId).filter(Boolean);
    if (!hasTool(toolResults, 'canvas_generation_propose')) {
      if (videoIds.length === 0) return sendText(res, model, 'The video draft has not been created, please check the storyboard.');
      return sendToolCall(res, model, 'canvas_generation_propose', { kind: 'video', nodeIds: videoIds,
        note: 'The two shots are 5 seconds each, please confirm before starting to generate the video' }, toolResults);
    }
    return sendText(res, model, 'No obvious problems were found in the first frame. The video plan of the two lenses has been registered and can be generated after confirmation.');
  }

  // 第 1 轮：分镜 + 两张首帧图方案。
  if (!hasTool(toolResults, 'canvas_get')) return sendToolCall(res, model, 'canvas_get', {}, toolResults);
  if (!hasTool(toolResults, 'canvas_script_prepare')) {
    return sendToolCall(res, model, 'canvas_script_prepare', {
      expectedRevision: revision,
      script: {
        title: 'Early morning seaside',
        rows: [
          { durationSeconds: 5, plotDescription: 'On the beach in the early morning, a Shiba Inu chases the waves',
            imageGenerationPrompt: 'On the beach in the early morning, Shiba Inu runs along the waves, golden sunlight, vertical screen 9:16, realistic movie feel',
            videoMotionPrompt: 'The camera follows the Shiba Inu from a low angle as it runs along the waves, with sea water splashing.' },
          { durationSeconds: 5, plotDescription: 'The waves receded, and the Shiba Inu stopped on the beach and looked into the distance.',
            imageGenerationPrompt: 'On the beach in the early morning, the waves recede, the Shiba Inu stops and looks into the distance, vertical screen 9:16, realistic movie feel',
            videoMotionPrompt: 'The camera slowly zooms in on the Shiba Inu parked on the beach, with the waves gently undulating in the background.' },
        ],
      },
      image: { model: IMAGE_MODEL, size: '9:16' },
    }, toolResults);
  }
  const prepared = tool('canvas_script_prepare');
  const imageIds = (prepared?.data?.result?.shots || []).map((shot) => shot.imageNodeId).filter(Boolean);
  if (!hasTool(toolResults, 'canvas_generation_propose')) {
    if (imageIds.length === 0) return sendText(res, model, 'The first frame draft has not been created, please check the storyboard.');
    return sendToolCall(res, model, 'canvas_generation_propose', { kind: 'image', nodeIds: imageIds,
      note: 'Two first frame pictures, please confirm before starting the generation' }, toolResults);
  }
  return sendText(res, model, 'The storyboards and two first frame images are ready, please confirm in the card.');
}


export function createFakeDirector(scenarios = []) {
  return (res, body) => fakeDirectorReply(res, body, scenarios);
}
