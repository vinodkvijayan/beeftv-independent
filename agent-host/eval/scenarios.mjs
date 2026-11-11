// 助手评测尺子：11 个固定评测场景（S1–S11）定义、确定性检查项与本地 Fake OpenAI SSE 模型服务。
// 覆盖：短剧 2 镜开场、8 镜分镜表且仅物化前 2 镜首帧、单镜局部修改、同轮中途补充改向、
// 生成后自动唤醒复查（wake-on-generation）、长对话多轮后技能规则保持，
// 以及单张需求不被技能带偏、技能分批上限、方案参数以节点为准、工具缺参后的正确恢复。

import http from 'node:http';
import { isTransientStudioTailMessage } from '../studio-digest.mjs';
import { clone, isPortrait916 } from './scenarios/shared.mjs';
import { REAL_FAILURE_SCENARIOS } from './scenarios/real-failures.mjs';
import { PARITY_SCENARIOS } from './scenarios/parity.mjs';

function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

function parseToolMessages(messages = []) {
  const toolCallsById = new Map();
  const toolResults = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          args = {};
        }
        toolCallsById.set(tc.id, {
          id: tc.id,
          name: tc.function?.name || '',
          args,
        });
      }
    }
    if (msg.role === 'tool') {
      const text = extractMessageText(msg);
      let data = null;
      try {
        const firstLine = text.split('\n')[0];
        data = JSON.parse(firstLine);
      } catch {
        data = null;
      }
      const call = toolCallsById.get(msg.tool_call_id) || { id: msg.tool_call_id, name: '', args: {} };
      toolResults.push({
        toolCallId: msg.tool_call_id,
        name: call.name,
        args: call.args,
        rawText: text,
        data,
      });
    }
  }
  return { toolCallsById, toolResults };
}

function latestRevisionFromTools(toolResults, fallback = 1) {
  let rev = fallback;
  for (const tr of toolResults) {
    const d = tr.data;
    if (!d) continue;
    const candidates = [
      d.revision,
      d.result?.revision,
      d.canvas?.revision,
      d.result?.canvas?.revision,
    ];
    for (const c of candidates) {
      if (Number.isSafeInteger(c) && c > 0) rev = c;
    }
  }
  return rev;
}

// 本地确定性 Fake OpenAI Chat Completions SSE 模型服务器
export function createFakeModelServer(options = {}) {
  const requests = [];
  const hooks = {
    onRequest: options.onRequest || null,
    onResponse: options.onResponse || null,
  };

  let callSeq = 0;
  function sendToolCall(res, model, toolName, argsObj, usage = { prompt_tokens: 320, completion_tokens: 80 }) {
    callSeq += 1;
    const callId = `call_${toolName}_${callSeq}`;
    const argStr = JSON.stringify(argsObj || {});
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const writeChunk = (delta, finishReason = null, extra = {}) => {
      const chunk = {
        id: `chatcmpl-fake-${callSeq}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model || 'fake-eval-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...extra,
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };
    writeChunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: callId,
          type: 'function',
          function: { name: toolName, arguments: argStr },
        },
      ],
    });
    writeChunk({}, 'tool_calls', {
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.prompt_tokens + usage.completion_tokens,
      },
    });
    res.end('data: [DONE]\n\n');
  }

  function sendTextReply(res, model, text, usage = { prompt_tokens: 360, completion_tokens: 90 }) {
    callSeq += 1;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const writeChunk = (delta, finishReason = null, extra = {}) => {
      const chunk = {
        id: `chatcmpl-fake-${callSeq}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model || 'fake-eval-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...extra,
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };
    writeChunk({ role: 'assistant', content: text });
    writeChunk({}, 'stop', {
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.prompt_tokens + usage.completion_tokens,
      },
    });
    res.end('data: [DONE]\n\n');
  }

  // 找到当前最后一轮用户消息之后的本轮工具调用结果
  function currentTurnView(messages) {
    let lastUserIdx = -1;
    let firstTurnUserIdx = -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        const txt = extractMessageText(messages[i]).trim();
        const hasImageAttachment =
          Array.isArray(messages[i].content) &&
          messages[i].content.some((p) => p && (p.type === 'image_url' || p.type === 'image'));
        // 跳过媒体适配层追加的提示消息、末尾瞬态上下文（画布摘要/计划/压缩恢复技能）或纯图片附件用户消息
        if (
          !txt ||
          txt.startsWith('The following is the material content returned by the aforementioned tools') ||
          isTransientStudioTailMessage(messages[i]) ||
          (hasImageAttachment && !txt.includes('BEEFTV_CONTEXT:'))
        ) {
          continue;
        }
        if (firstTurnUserIdx < 0) firstTurnUserIdx = i;
        if (!txt.includes('BEEFTV_SUPPLEMENT:')) {
          lastUserIdx = i;
        }
      }
    }
    const startIdx = lastUserIdx >= 0 ? lastUserIdx : 0;
    const slice = messages
      .slice(startIdx)
      .filter((m) => !isTransientStudioTailMessage(m));
    const { toolResults } = parseToolMessages(slice);
    const allText = slice.map(extractMessageText).join('\n');
    const fullConversationText = messages.map(extractMessageText).join('\n');
    return { slice, toolResults, allText, fullConversationText };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const reqChunks = [];
      for await (const chunk of req) reqChunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(reqChunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      const reqIndex = requests.length + 1;
      requests.push({
        index: reqIndex,
        url: req.url,
        model: body.model || 'fake-eval-model',
        messages: body.messages || [],
        tools: (body.tools || []).map((t) => t.function?.name).filter(Boolean),
        at: new Date().toISOString(),
      });

      if (hooks.onRequest) {
        await hooks.onRequest({ reqIndex, body, req });
      }

      if (hooks.onResponse) {
        let pendingStatus = 200;
        let pendingHeaders = {};
        const pendingChunks = [];
        let capturedRespText = '';
        const origWriteHead = res.writeHead.bind(res);
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);
        res.writeHead = (statusCode, headers) => {
          pendingStatus = statusCode;
          pendingHeaders = headers || {};
          return res;
        };
        res.write = (chunk) => {
          if (chunk) {
            pendingChunks.push(chunk);
            capturedRespText += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
          }
          return true;
        };
        res.end = (chunk, ...rest) => {
          if (chunk && typeof chunk !== 'function') {
            pendingChunks.push(chunk);
            capturedRespText += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
          }
          res.writeHead = origWriteHead;
          res.write = origWrite;
          res.end = origEnd;
          hooks.onResponse({ reqIndex, body, respText: capturedRespText });
          origWriteHead(pendingStatus, pendingHeaders);
          for (const c of pendingChunks) origWrite(c);
          return origEnd(...rest);
        };
      }

      const messages = body.messages || [];
      const { toolResults, allText, fullConversationText } = currentTurnView(messages);
      const allParsed = parseToolMessages(messages);
      const rev = latestRevisionFromTools(allParsed.toolResults, 1);

      // 识别当前属于哪个场景/步骤
      // S4: 中途补充改向
      if (allText.includes('The opening of ancient martial arts') || allText.includes('Cyberpunk Neon Night Market')) {
        const steered = allText.includes('Cyberpunk Neon Night Market');
        if (toolResults.length === 0) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const createdNodesResult = toolResults.find((t) => t.name === 'canvas_nodes_create');
        if (!createdNodesResult) {
          const styleLabel = steered ? 'Cyberpunk Neon Night Market' : 'Ancient style martial arts';
          sendToolCall(res, body.model, 'canvas_nodes_create', {
            expectedRevision: rev,
            nodes: [
              { type: 'script', title: 'Storyboard' },
              {
                type: 'image',
                title: 'Mirror 1 first frame',
                prompt: `${styleLabel}Style, close-up of hacker under neon holographic sign on rainy night, vertical screen 9:16`,
              },
              {
                type: 'image',
                title: 'Mirror 2 first frame',
                prompt: `${styleLabel}Style, prosthetic detective tracking drones in neon night market alleys, vertical screen 9:16`,
              },
            ],
          });
          return;
        }
        const createdList = createdNodesResult.data?.result?.created || [];
        const scriptNode = createdList.find((n) => n.type === 'script') || { id: 'node-1' };
        const imgNodes = createdList.filter((n) => n.type === 'image');
        const appendedResult = toolResults.find((t) => t.name === 'canvas_script_rows_append');
        if (!appendedResult) {
          sendToolCall(res, body.model, 'canvas_script_rows_append', {
            expectedRevision: rev,
            nodeId: scriptNode.id,
            rows: [
              {
                durationSeconds: 5,
                plotDescription: 'On the cyberpunk neon night market street, hackers look up at the flashing holographic billboards',
                dialogue: 'The signal was sent from deep inside the night market.',
                imageGenerationPrompt: 'Cyberpunk neon night market, close shot of hackers under holographic signboard, cool blue and magenta neon light, 9:16',
                videoMotionPrompt: 'The camera slowly moves toward the hacker\'s face, with neon signs flashing behind him and rain falling.',
              },
              {
                durationSeconds: 5,
                plotDescription: 'Cyberpunk neon night market dark alley, micro drones fly over steam stalls',
                dialogue: 'Keep up with it, don\'t lose it!',
                imageGenerationPrompt: 'Cyberpunk neon night market dark alley, steam and holographic projection intertwined, micro drone passing by, 9:16',
                videoMotionPrompt: 'The camera follows the drone as it quickly shuttles between the neon night market stalls',
              },
            ],
          });
          return;
        }
        const boundResult = toolResults.find((t) => t.name === 'canvas_script_row_update');
        if (!boundResult) {
          const rows = appendedResult.data?.result?.created || [];
          sendToolCall(res, body.model, 'canvas_script_row_update', {
            expectedRevision: rev,
            nodeId: scriptNode.id,
            patches: [
              { rowId: rows[0]?.id || 'shot-1', imageNodeId: imgNodes[0]?.id || 'node-2' },
              { rowId: rows[1]?.id || 'shot-2', imageNodeId: imgNodes[1]?.id || 'node-3' },
            ],
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'It has been changed to the **Cyberpunk Neon Night Market** style according to the latest requirements you added midway, and has been condensed into 2 shots. The creation and binding of the storyboard script and 2 first frame image nodes have been completed.',
        );
        return;
      }

      // S2: 8 镜头分镜表 + 只为前 2 个镜头创建首帧图节点并回填
      if (allText.includes('8 shots') || allText.includes('Just for the first 2 shots')) {
        if (toolResults.length === 0) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const createdScript = toolResults.find(
          (t) => t.name === 'canvas_nodes_create' && t.args?.nodes?.some((n) => n.type === 'script'),
        );
        if (!createdScript) {
          sendToolCall(res, body.model, 'canvas_nodes_create', {
            expectedRevision: rev,
            nodes: [
              { type: 'script', title: 'Storyboard' },
              {
                type: 'image',
                title: 'Mirror 1 first frame',
                prompt: 'Panoramic view of deep space orbital station, huge ring-shaped space station passing by blue-white gas giant planet, movie-like sci-fi realism, 9:16',
              },
              {
                type: 'image',
                title: 'Mirror 2 first frame',
                prompt: 'Cockpit interior, female astronaut stares at the red abnormal signal point on the holographic star map, cold light illuminates the mask, 9:16',
              },
            ],
          });
          return;
        }
        const createdNodes = createdScript.data?.result?.created || [];
        const scriptNode = createdNodes.find((n) => n.type === 'script') || { id: 'node-1' };
        const imgNodes = createdNodes.filter((n) => n.type === 'image');

        const appended = toolResults.find((t) => t.name === 'canvas_script_rows_append');
        if (!appended) {
          const eightRows = Array.from({ length: 8 }, (_, idx) => {
            const n = idx + 1;
            return {
              durationSeconds: n <= 4 ? 4 : 3,
              plotDescription: `No.${n} Mirror: Key images from deep space exploration missions${n}, showing interstellar jumps and unknown ruins`,
              dialogue: n === 1 ? 'Here is the Pioneer, preparing to enter the jump orbit.' : `No.${n} Mirror line: Signal strength continues to rise.`,
              imageGenerationPrompt: `Science fiction movies${n} Prompt words for the first frame of the shot, deep space exploration scene${n}, high-detail realistic light and shadow`,
              videoMotionPrompt: `No.${n} Mirror video prompts the movement of the camera, and the camera advances smoothly to show the depth of the science fiction space`,
            };
          });
          sendToolCall(res, body.model, 'canvas_script_rows_append', {
            expectedRevision: rev,
            nodeId: scriptNode.id,
            rows: eightRows,
          });
          return;
        }
        const updatedRows = toolResults.find((t) => t.name === 'canvas_script_row_update');
        if (!updatedRows) {
          const rows = appended.data?.result?.created || [];
          sendToolCall(res, body.model, 'canvas_script_row_update', {
            expectedRevision: rev,
            nodeId: scriptNode.id,
            patches: [
              { rowId: rows[0]?.id || 'shot-1', imageNodeId: imgNodes[0]?.id || 'node-2' },
              { rowId: rows[1]?.id || 'shot-2', imageNodeId: imgNodes[1]?.id || 'node-3' },
            ],
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'The complete storyboard scripts for 8 shots have been completed, and the "First Frame of Shot 1" and "First Frame of Shot 2" image nodes have been created strictly for the first 2 shots as required and bound to lines 1 and 2. Shots 3-8 remain ungenerated.',
        );
        return;
      }

      // S3: 局部修改第 3 个镜头与第 3 个首帧图节点
      if (allText.includes('Shot 3') || allText.includes('Morning mist forest')) {
        const getResult = toolResults.find((t) => t.name === 'canvas_get');
        if (!getResult) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const canvasNodes = getResult.data?.nodes || getResult.data?.result?.canvas?.nodes || [];
        const scriptNode = canvasNodes.find((n) => n.type === 'script') || { id: 'node-script-1' };
        const img3Node =
          canvasNodes.find((n) => n.id === 'node-img-3' || n.title === 'Mirror 3 first frame') || { id: 'node-img-3' };
        const rowUpdate = toolResults.find((t) => t.name === 'canvas_script_row_update');
        if (!rowUpdate) {
          sendToolCall(res, body.model, 'canvas_script_row_update', {
            expectedRevision: rev,
            nodeId: scriptNode.id,
            patches: [
              {
                rowId: 'shot-3',
                plotDescription: 'In the misty forest in the early morning, the sunlight penetrates the tree canopy and shines on the mossy path, and the protagonist walks slowly',
                imageGenerationPrompt: 'In the misty forest in the early morning, Tyndall sunlight penetrates the tall pine forest, and the mist fills the air, creating a realistic cinematic feel, 9:16',
              },
            ],
          });
          return;
        }
        const nodeUpdate = toolResults.find((t) => t.name === 'canvas_node_update');
        if (!nodeUpdate) {
          sendToolCall(res, body.model, 'canvas_node_update', {
            expectedRevision: rev,
            nodeId: img3Node.id,
            patch: {
              content: 'In the misty forest in the early morning, Tyndall sunlight penetrates the tall pine forest, and the mist fills the air, creating a realistic cinematic feel, 9:16',
            },
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'Only the storyboard description of the third shot and the prompt word of the "First Frame of Shot 3" image node have been updated to the theme of "Morning Mist Forest". The remaining shots 1, 2, and 4 and their corresponding nodes and connections remain unchanged.',
        );
        return;
      }

      // S8: 用户只要一张首帧，已选技能不能把流程带成整套分镜
      if (allText.includes('The rooftop after school') || allText.includes('This time I will only make the first frame of a vertical Japanese anime style picture.')) {
        if (toolResults.length === 0) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const created = toolResults.find((t) => t.name === 'canvas_nodes_create');
        if (!created) {
          sendToolCall(res, body.model, 'canvas_nodes_create', {
            expectedRevision: rev,
            nodes: [
              {
                type: 'image',
                title: 'Rooftop after school first frame',
                prompt: 'Japanese anime style, rooftop after school, girl looking back, sunset and breeze, vertical screen 9:16',
              },
            ],
          });
          return;
        }
        const imgNode = created.data?.result?.created?.[0] || { id: 'node-1' };
        const configured = toolResults.find((t) => t.name === 'canvas_node_configure');
        if (!configured) {
          sendToolCall(res, body.model, 'canvas_node_configure', {
            expectedRevision: rev,
            nodeId: imgNode.id,
            kind: 'image',
            patch: { size: '9:16', count: 1 },
          });
          return;
        }
        const proposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
        if (!proposed) {
          sendToolCall(res, body.model, 'canvas_generation_propose', {
            kind: 'image',
            nodeIds: [imgNode.id],
            note: 'According to your request, only the first frame of the vertical screen will be made, and the generation will start after confirmation.',
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'We have created only one vertical screen first frame image node according to your request, with a frame size of 9:16 and a quantity of 1, and the generation plan has been submitted. The generation will start after confirmation in the panel.',
        );
        return;
      }

      // S9: 选了「资产分批制作」技能，第 1 批只能做角色且最多 4 张
      if (allText.includes('Asset batch production skills')) {
        if (toolResults.length === 0) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const created = toolResults.find((t) => t.name === 'canvas_nodes_create');
        if (!created) {
          const characters = ['Lin Xi', 'Chen Ye', 'Jiangmo', 'Su Wei'];
          sendToolCall(res, body.model, 'canvas_nodes_create', {
            expectedRevision: rev,
            nodes: characters.map((name, idx) => ({
              type: 'image',
              title: `role${idx + 1} Finalize`,
              prompt: `Protagonist in campus science fiction short drama${name} The character confirmation draft, the whole body setting picture, and the clean background will facilitate the subsequent unified styling.`,
            })),
          });
          return;
        }
        const imgNodes = (created.data?.result?.created || []).filter((n) => n.type === 'image');
        const proposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
        if (!proposed && imgNodes.length > 0) {
          sendToolCall(res, body.model, 'canvas_generation_propose', {
            kind: 'image',
            nodeIds: imgNodes.map((n) => n.id),
            note: 'Only the confirmation drafts for these 4 characters will be submitted for the first batch. Please confirm before doing the next batch.',
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'The first batch has been completed according to the "Asset Batch Production" skill: the character confirmation drafts of the four protagonists, without mixing in props or scenes. After confirming the shape, I will make the next batch.',
        );
        return;
      }

      // S10: 参数以节点当前值为准，不改节点，只按现有设置重提方案
      if (allText.includes('Changed to a square shape')) {
        if (toolResults.length === 0) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const getRes = toolResults.find((t) => t.name === 'canvas_get');
        const nodes = getRes.data?.result?.canvas?.nodes || getRes.data?.canvas?.nodes || [];
        const imgNode = nodes.find((n) => n.type === 'image') || { id: 'node-s10-image' };
        const proposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
        if (!proposed) {
          sendToolCall(res, body.model, 'canvas_generation_propose', {
            kind: 'image',
            nodeIds: [imgNode.id],
            note: 'Resubmit the generation plan with the node\'s current 1:1 square setting and quantity 1, with the node unchanged',
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'The generation plan has been resubmitted according to the current settings of the nodes (1:1 square, 1 sheet), without changing the nodes. Please confirm in the panel before generating.',
        );
        return;
      }

      // S11: 第一次 media.inspect 漏了 expectedVersion，读取错误后先 overview 再带版本复查
      if (allText.includes('Are there any problems with the character’s hands?')) {
        if (toolResults.length === 0) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const getRes = toolResults.find((t) => t.name === 'canvas_get');
        const nodes = getRes.data?.result?.canvas?.nodes || getRes.data?.canvas?.nodes || [];
        const imgNode = nodes.find((n) => n.type === 'image') || { id: 'node-s11-image' };
        const inspectCalls = toolResults.filter((t) => t.name === 'media_inspect');
        if (inspectCalls.length === 0) {
          // 故意先漏掉必填参数，等工具参数校验拒绝后再按提示恢复。
          sendToolCall(res, body.model, 'media_inspect', { nodeId: imgNode.id, mode: 'frames' });
          return;
        }
        const overview = toolResults.find((t) => t.name === 'media_overview');
        if (!overview) {
          sendToolCall(res, body.model, 'media_overview', { nodeId: imgNode.id });
          return;
        }
        const version = overview.data?.result?.source?.version;
        const successfulInspect = inspectCalls.some(
          (t) => t.data?.result?.source?.version && !String(t.rawText || '').includes('media_version_required'),
        );
        if (!successfulInspect) {
          sendToolCall(res, body.model, 'media_inspect', {
            nodeId: imgNode.id,
            expectedVersion: version,
            mode: 'frames',
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'I\'ve seen this picture: the character\'s hand structure and number of fingers look normal, with no obvious deformities.',
        );
        return;
      }

      // S5/S7: 生成后自动唤醒或用户主动发起的复查，触发来源由运行器分别记录。
      if (allText.includes('hand deformity') || allText.includes('Review the newly generated screen')) {
        const isFollowupReview = allText.includes('Review the newly generated screen') || allText.includes('Task completed');
        if (!isFollowupReview) {
          if (toolResults.length === 0) {
            sendToolCall(res, body.model, 'canvas_get', {});
            return;
          }
          const created = toolResults.find((t) => t.name === 'canvas_nodes_create');
          if (!created) {
            sendToolCall(res, body.model, 'canvas_nodes_create', {
              expectedRevision: rev,
              nodes: [
                {
                  type: 'image',
                  title: 'Mirror 1 first frame',
                  prompt: 'Close-up portrait, the heroine holds up a flashlight to read a letter on the street on a rainy night, realistic movie feel, 9:16',
                },
              ],
            });
            return;
          }
          const imgNodeId = created.data?.result?.created?.[0]?.id || 'node-1';
          const proposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
          if (!proposed) {
            sendToolCall(res, body.model, 'canvas_generation_propose', {
              kind: 'image',
              nodeIds: [imgNodeId],
              note: 'Submit a generation proposal for the first frame of Mirror 1, please confirm before starting the generation',
            });
            return;
          }
          sendTextReply(
            res,
            body.model,
            'The "Mirror 1 First Frame" node has been created and the image generation proposal has been submitted. Please confirm the generation in the panel and let me review the screen after the generation is completed.',
          );
          return;
        }
        // 生成完成后的唤醒复查轮次
        const getRes = toolResults.find((t) => t.name === 'canvas_get');
        if (!getRes) {
          sendToolCall(res, body.model, 'canvas_get', {});
          return;
        }
        const nodes = getRes.data?.result?.canvas?.nodes || getRes.data?.canvas?.nodes || getRes.data?.nodes || [];
        const imgNode = nodes.find((n) => n.type === 'image') || { id: 'node-1' };
        const overview = toolResults.find((t) => t.name === 'media_overview');
        if (!overview) {
          sendToolCall(res, body.model, 'media_overview', { nodeId: imgNode.id });
          return;
        }
        const inspected = toolResults.find((t) => t.name === 'media_inspect');
        if (!inspected) {
          sendToolCall(res, body.model, 'media_inspect', {
            nodeId: imgNode.id,
            expectedVersion: overview.data?.result?.source?.version,
            mode: 'frames',
          });
          return;
        }
        const updated = toolResults.find((t) => t.name === 'canvas_node_update');
        if (!updated) {
          sendToolCall(res, body.model, 'canvas_node_update', {
            expectedRevision: rev,
            nodeId: imgNode.id,
            patch: {
              content:
                'Close-up portrait, the heroine is holding a flashlight with both hands naturally on the street on a rainy night to read a letter. The structure of the five fingers is naturally clear and there are no extra fingers. It has a realistic and cinematic feel, 9:16',
            },
          });
          return;
        }
        const reProposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
        if (!reProposed) {
          sendToolCall(res, body.model, 'canvas_generation_propose', {
            kind: 'image',
            nodeIds: [imgNode.id],
            note: 'Six-finger deformity of the hand was detected, the prompt word has been corrected to emphasize the natural structure of the five fingers, and the generation proposal is re-initiated.',
          });
          return;
        }
        sendTextReply(
          res,
          body.model,
          'Through the `media_inspect` inspection, it was found that the generated screen had a six-finger deformity problem on the character\'s right hand. The node prompt word has been modified to correct the description of the anatomical structure of the hand, and the generation proposal has been resubmitted.',
        );
        return;
      }

      // S6: 长对话多轮后技能规则保持
      if (allText.includes('S6_TURN_')) {
        if (allText.includes('S6_TURN_1')) {
          if (toolResults.length === 0) {
            sendToolCall(res, body.model, 'canvas_get', {});
            return;
          }
          const loadedSkill = toolResults.find((t) => t.name === 'skill_load');
          if (!loadedSkill && !fullConversationText.includes('# Storyboard the short play to the first frame')) {
            sendToolCall(res, body.model, 'skill_load', { id: 'short-drama-storyboard' });
            return;
          }
          const created = toolResults.find((t) => t.name === 'canvas_nodes_create');
          if (!created) {
            sendToolCall(res, body.model, 'canvas_nodes_create', {
              expectedRevision: rev,
              nodes: [
                {
                  type: 'markdown',
                  title: 'Character setting',
                  prompt: '#Character settings\n- **Lin Wan (female protagonist)**: 26-year-old investigative reporter, black trench coat, firm eyes.\n- **Silence (Villain)**: 30-year-old mysterious informant, gold-rimmed glasses, cold and deep.',
                },
                { type: 'script', title: 'Storyboard' },
              ],
            });
            return;
          }
          const scriptNode = (created.data?.result?.created || []).find((n) => n.type === 'script') || { id: 'node-2' };
          const appended = toolResults.find((t) => t.name === 'canvas_script_rows_append');
          if (!appended) {
            sendToolCall(res, body.model, 'canvas_script_rows_append', {
              expectedRevision: rev,
              nodeId: scriptNode.id,
              rows: [
                {
                  durationSeconds: 5,
                  plotDescription: 'On the rooftop on a rainy night, Lin Wan held a blood-stained pocket watch and questioned the silence.',
                  dialogue: 'Lin Wan: Why is this watch in your hand?',
                  imageGenerationPrompt: 'Vertical screen 9:16 Realistic cinematic feel, on the rooftop on a rainy night, a 26-year-old female reporter in black trench coat clutches a pocket watch, cold colors',
                  videoMotionPrompt: 'The camera moved from the close-up of the pocket watch to Lin Wan\'s questioning face, and the rain fell down',
                },
                {
                  durationSeconds: 5,
                  plotDescription: 'Standing silently in the neon shadow and turning around with a sneer',
                  dialogue: 'Silence: Do you think what you found is the truth?',
                  imageGenerationPrompt: 'Vertical screen 9:16 Realistic cinematic feel, a 30-year-old man with gold-rimmed glasses stands in the shadow of the rooftop and looks back with a sneer.',
                  videoMotionPrompt: 'Silence slowly turned her head to look at the camera, and lightning streaked through the night sky behind her',
                },
              ],
            });
            return;
          }
          sendTextReply(
            res,
            body.model,
            'The first two steps of the "Character Settings" node and the first two shots of the second step "Storyboarding" have been completed according to the "Short Play Storyboarding to the First Frame" skill specification. Please confirm whether the storyboard content needs to be adjusted.',
          );
          return;
        }

        if (allText.includes('S6_TURN_2') || allText.includes('S6_TURN_3')) {
          if (toolResults.length === 0) {
            sendToolCall(res, body.model, 'canvas_get', {});
            return;
          }
          sendTextReply(
            res,
            body.model,
            'The two shots "Character Settings" and "Storyboard Script" on the current canvas have been checked. The vertical screen 9:16 frame and realistic movie-like settings remain unchanged. You can materialize the first frame according to step 3 of the skill at any time and make a generation proposal.',
          );
          return;
        }

        if (allText.includes('S6_TURN_4')) {
          const getRes = toolResults.find((t) => t.name === 'canvas_get');
          if (!getRes) {
            sendToolCall(res, body.model, 'canvas_get', {});
            return;
          }
          const nodes = getRes.data?.canvas?.nodes || getRes.data?.nodes || [];
          const priorCreate = allParsed.toolResults.find((t) => t.name === 'canvas_nodes_create');
          const scriptNode =
            nodes.find((n) => n.type === 'script') ||
            (priorCreate?.data?.result?.created || []).find((n) => n.type === 'script') ||
            { id: 'node-2' };
          const createdImgs = toolResults.find((t) => t.name === 'canvas_nodes_create');
          if (!createdImgs) {
            sendToolCall(res, body.model, 'canvas_nodes_create', {
              expectedRevision: rev,
              nodes: [
                {
                  type: 'image',
                  title: 'Mirror 1 first frame',
                  prompt: 'Vertical screen 9:16 Realistic cinematic feel, on the rooftop on a rainy night, a 26-year-old female reporter in black trench coat clutches a pocket watch, cold colors',
                },
                {
                  type: 'image',
                  title: 'Mirror 2 first frame',
                  prompt: 'Vertical screen 9:16 Realistic cinematic feel, a 30-year-old man with gold-rimmed glasses stands in the shadow of the rooftop and looks back with a sneer.',
                },
              ],
            });
            return;
          }
          const imgList = createdImgs.data?.result?.created || [];
          const configured = toolResults.filter((t) => t.name === 'canvas_node_configure');
          if (configured.length < imgList.length) {
            const nextImg = imgList[configured.length];
            sendToolCall(res, body.model, 'canvas_node_configure', {
              expectedRevision: rev,
              nodeId: nextImg.id,
              kind: 'image',
              patch: { size: '9:16', count: 1 },
            });
            return;
          }
          const bound = toolResults.find((t) => t.name === 'canvas_script_row_update');
          if (!bound) {
            const priorAppend = allParsed.toolResults.find((t) => t.name === 'canvas_script_rows_append');
            const realRows =
              scriptNode.metadata?.storyboard?.rows ||
              scriptNode.storyboardRows ||
              priorAppend?.data?.result?.created ||
              [];
            sendToolCall(res, body.model, 'canvas_script_row_update', {
              expectedRevision: rev,
              nodeId: scriptNode.id,
              patches: [
                { rowId: realRows[0]?.id || 'shot-1', imageNodeId: imgList[0]?.id || 'node-3' },
                { rowId: realRows[1]?.id || 'shot-2', imageNodeId: imgList[1]?.id || 'node-4' },
              ],
            });
            return;
          }
          const proposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
          if (!proposed) {
            sendToolCall(res, body.model, 'canvas_generation_propose', {
              kind: 'image',
              nodeIds: imgList.map((n) => n.id),
              note: 'Storyboard the skit to step 3 of the first frame skill, and initiate generation suggestions for the first frame of mirror 1 and the first frame of mirror 2',
            });
            return;
          }
          sendTextReply(
            res,
            body.model,
            'Step 3 of the "Short Play Storyboarding to the First Frame" skill has been strictly followed: Create "First Frame of Mirror 1" and "First Frame of Mirror 2" picture nodes (frame 9:16, quantity 1), write the real node ID back to the storyboard line `imageNodeId`, and submit a generation proposal. Please confirm in the panel before the generation and billing will start.',
          );
          return;
        }
      }

      // 默认场景 S1: 都市短剧开场 2 个镜头（脚本 + 首帧图 + 视频节点 + 连线 + 分镜绑定）
      if (toolResults.length === 0) {
        sendToolCall(res, body.model, 'canvas_get', {});
        return;
      }
      const createdNodesResult = toolResults.find((t) => t.name === 'canvas_nodes_create');
      if (!createdNodesResult) {
        sendToolCall(res, body.model, 'canvas_nodes_create', {
          expectedRevision: rev,
          nodes: [
            { type: 'script', title: 'Storyboard' },
            {
              type: 'image',
              title: 'Mirror 1 first frame',
              prompt: 'On the street on a rainy night in the city, the heroine squatted on the side of the puddle holding a transparent umbrella and picked up a silver cufflink with scores, neon reflection, vertical screen 9:16',
            },
            {
              type: 'image',
              title: 'Mirror 2 first frame',
              prompt: 'The heroine suddenly raised her head and looked towards the dark alley at the corner of the street. Black shadows flashed past in the distance, rain was like weaving, suspenseful and cold tones, vertical screen 9:16',
            },
            {
              type: 'video',
              title: 'mirror 1 video',
              prompt: 'The camera moves from the ripples of rain to the silver cufflinks in the heroine\'s hand, and the heroine\'s fingers tremble slightly.',
            },
            {
              type: 'video',
              title: 'mirror 2 video',
              prompt: 'The heroine held an umbrella and hurriedly chased into the dark alley around the corner. The camera quickly followed the shot, and the neon lights drew light trails on the slippery ground.',
            },
          ],
        });
        return;
      }

      const createdList = createdNodesResult.data?.result?.created || [];
      const scriptNode = createdList.find((n) => n.type === 'script') || { id: 'node-1' };
      const imgNodes = createdList.filter((n) => n.type === 'image');
      const vidNodes = createdList.filter((n) => n.type === 'video');

      const appendedResult = toolResults.find((t) => t.name === 'canvas_script_rows_append');
      if (!appendedResult) {
        sendToolCall(res, body.model, 'canvas_script_rows_append', {
          expectedRevision: rev,
          nodeId: scriptNode.id,
          rows: [
            {
              durationSeconds: 5,
              plotDescription: 'The heroine discovers the key to the disappearance case, silver cufflinks, beside the puddles on the street on a rainy night in the city.',
              dialogue: 'This cufflink...he really was here last night!',
              imageGenerationPrompt: 'On the street on a rainy night in the city, the heroine squatted on the side of the pond holding a transparent umbrella and picked up a silver cufflink with a score, 9:16',
              videoMotionPrompt: 'The camera moves from the ripples of rain to the silver cufflinks in the heroine\'s hand, and the heroine\'s fingers tremble slightly.',
            },
            {
              durationSeconds: 5,
              plotDescription: 'The heroine looked up and saw a dark shadow flashing across the dark alley, and immediately got up and chased her into the rain.',
              dialogue: 'Stop! Don\'t go!',
              imageGenerationPrompt: 'The heroine suddenly looked up at the dark alley at the corner of the street. Black shadows flashed past in the distance, rain was like weaving, suspenseful and cold tones, 9:16',
              videoMotionPrompt: 'The heroine held an umbrella and hurriedly chased towards the corner of the street, and the camera quickly followed her.',
            },
          ],
        });
        return;
      }

      const boundResult = toolResults.find((t) => t.name === 'canvas_script_row_update');
      if (!boundResult) {
        const rows = appendedResult.data?.result?.created || [];
        sendToolCall(res, body.model, 'canvas_script_row_update', {
          expectedRevision: rev,
          nodeId: scriptNode.id,
          patches: [
            {
              rowId: rows[0]?.id || 'shot-1',
              imageNodeId: imgNodes[0]?.id || 'node-2',
              videoNodeId: vidNodes[0]?.id || 'node-4',
            },
            {
              rowId: rows[1]?.id || 'shot-2',
              imageNodeId: imgNodes[1]?.id || 'node-3',
              videoNodeId: vidNodes[1]?.id || 'node-5',
            },
          ],
        });
        return;
      }

      const edgeCalls = toolResults.filter((t) => t.name === 'canvas_edge_create');
      if (edgeCalls.length === 0 && imgNodes[0] && vidNodes[0]) {
        sendToolCall(res, body.model, 'canvas_edge_create', {
          expectedRevision: rev,
          fromNodeId: imgNodes[0].id,
          toNodeId: vidNodes[0].id,
        });
        return;
      }
      if (edgeCalls.length === 1 && imgNodes[1] && vidNodes[1]) {
        sendToolCall(res, body.model, 'canvas_edge_create', {
          expectedRevision: rev,
          fromNodeId: imgNodes[1].id,
          toNodeId: vidNodes[1].id,
        });
        return;
      }

      const proposed = toolResults.find((t) => t.name === 'canvas_generation_propose');
      if (!proposed && imgNodes.length >= 2) {
        sendToolCall(res, body.model, 'canvas_generation_propose', {
          kind: 'image',
          nodeIds: imgNodes.map((n) => n.id),
          note: 'Initiate generation proposal for the first frame of Mirror 1 and Mirror 2',
        });
        return;
      }

      sendTextReply(
        res,
        body.model,
        'The 2-shot storyboard script, 2 first frame graph nodes and 2 video generation nodes for the opening of the urban short drama "Traveling on a Rainy Night" have been completed. The storyboard row binding and the reference connection from the first frame to the video have been completed, and a proposal for first frame graph generation has been made.',
      );
    } catch (error) {
      res.writeHead(error?.reason === 'aborted_budget' ? 429 : 500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: String(error?.message || error), code: error?.reason || 'fake_model_error' },
        }),
      );
    }
  });

  const fakeModel = {
    server,
    port: 0,
    baseUrl: '',
    requests,
    hooks,
    async listen(port = 0) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
      const addr = server.address();
      fakeModel.port = typeof addr === 'object' && addr ? addr.port : port;
      fakeModel.baseUrl = `http://127.0.0.1:${fakeModel.port}/v1`;
      return fakeModel;
    },
    async close() {
      if (server.listening) {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(() => resolve()));
      }
    },
  };

  return fakeModel;
}

// S3 初始画布种子生成函数
export function buildS3SeedCanvas(canvasId = 'canvas-s3') {
  return {
    id: canvasId,
    title: 'Forest adventure four-shot storyboard canvas',
    revision: 5,
    nodes: [
      {
        id: 'node-script-1',
        type: 'script',
        title: 'Storyboard',
        position: { x: 120, y: 160 },
        width: 920,
        height: 360,
        metadata: {
          status: 'idle',
          workflowKind: 'script',
          storyboard: {
            visibleColumns: ['shotNumber', 'durationSeconds', 'videoMotionPrompt', 'dialogue', 'assets'],
            referenceNodeIds: [],
            rows: [
              {
                id: 'shot-1',
                shotNumber: 1,
                durationSeconds: 5,
                plotDescription: 'First shot: An ancient road in the wilderness under the scorching sun at noon, the travelers’ backs disappearing into the distance',
                dialogue: 'The journey has just begun.',
                shotSize: 'Vision',
                camera: 'Fixed',
                motion: 'still',
                emotion: 'Desolation',
                imageGenerationPrompt: 'The ancient road in the wilderness under the scorching sun at noon, the back of the traveler, 9:16',
                videoMotionPrompt: 'The wind and sand swept over the ancient road in the wilderness, and the travelers moved forward slowly',
                imageNodeId: 'node-img-1',
                videoNodeId: 'node-vid-1',
                status: 'idle',
              },
              {
                id: 'shot-2',
                shotNumber: 2,
                durationSeconds: 5,
                plotDescription: 'Second shot: Stone bridge by the stream at dusk, travelers stop to drink water',
                dialogue: 'The entrance to the valley should be ahead.',
                shotSize: 'medium shot',
                camera: 'eye level',
                motion: 'Push slowly',
                emotion: 'calm',
                imageGenerationPrompt: 'Stone bridge by the stream at dusk, travelers stop to drink water, warm colors, 9:16',
                videoMotionPrompt: 'The gurgling stream flows, and the afterglow of the setting sun shines on the water',
                imageNodeId: 'node-img-2',
                videoNodeId: 'node-vid-2',
                status: 'idle',
              },
              {
                id: 'shot-3',
                shotNumber: 3,
                durationSeconds: 5,
                plotDescription: 'Third shot: Abandoned wooden house in heavy rain late at night, bonfire swaying',
                dialogue: 'I can only take shelter from the rain tonight.',
                shotSize: 'close shot',
                camera: 'eye level',
                motion: 'Fixed',
                emotion: 'loneliness',
                imageGenerationPrompt: 'Abandoned wooden house in heavy rain late at night, bonfire swaying indoors, 9:16',
                videoMotionPrompt: 'Heavy rain pours outside the window, and sparks dance from the bonfire inside the house',
                imageNodeId: 'node-img-3',
                videoNodeId: 'node-vid-3',
                status: 'idle',
              },
              {
                id: 'shot-4',
                shotNumber: 4,
                durationSeconds: 5,
                plotDescription: 'The fourth shot: the golden light of dawn on the top of the snow-capped mountains, the traveler looks at the sea of clouds',
                dialogue: 'Finally arrived.',
                shotSize: 'big vision',
                camera: 'aerial photography',
                motion: 'rising around',
                emotion: 'Invigorate',
                imageGenerationPrompt: 'The golden light of dawn on the top of the snow-capped mountains, the traveler looks at the sea of clouds, 9:16',
                videoMotionPrompt: 'Aerial footage slowly rises around the top of the snow-capped mountains, and the sea of clouds surges',
                imageNodeId: 'node-img-4',
                videoNodeId: 'node-vid-4',
                status: 'idle',
              },
            ],
          },
        },
      },
      ...[1, 2, 3, 4].map((n) => ({
        id: `node-img-${n}`,
        type: 'image',
        title: `mirror${n} first frame`,
        position: { x: 1120, y: 80 + (n - 1) * 440 },
        width: 720,
        height: 405,
        metadata: {
          content: '',
          prompt: `Original Chapter${n} First frame prompt word`,
          composerContent: `Original Chapter${n} First frame prompt word`,
          status: 'idle',
          size: '9:16',
          count: 1,
        },
      })),
      ...[1, 2, 3, 4].map((n) => ({
        id: `node-vid-${n}`,
        type: 'video',
        title: `mirror${n} video`,
        position: { x: 1920, y: 80 + (n - 1) * 440 },
        width: 720,
        height: 405,
        metadata: {
          content: '',
          prompt: `Original Chapter${n} Mirror video mirror tips`,
          composerContent: `Original Chapter${n} Mirror video mirror tips`,
          status: 'idle',
          size: '9:16',
          seconds: '6',
        },
      })),
    ],
    connections: [
      ...[1, 2, 3, 4].map((n) => ({
        id: `edge-row-img-${n}`,
        fromNodeId: 'node-script-1',
        toNodeId: `node-img-${n}`,
        fromHandleId: `row:shot-${n}`,
        relation: 'storyboard-output',
        storyboardRowId: `shot-${n}`,
      })),
      ...[1, 2, 3, 4].map((n) => ({
        id: `edge-row-vid-${n}`,
        fromNodeId: 'node-script-1',
        toNodeId: `node-vid-${n}`,
        fromHandleId: `row:shot-${n}`,
        relation: 'storyboard-output',
        storyboardRowId: `shot-${n}`,
      })),
      ...[1, 2, 3, 4].map((n) => ({
        id: `edge-img-vid-${n}`,
        fromNodeId: `node-img-${n}`,
        toNodeId: `node-vid-${n}`,
      })),
    ],
    timeline: null,
    updatedAt: new Date().toISOString(),
  };
}
// 11 个固定场景定义
export const SCENARIOS = [
  {
    id: 'shortdrama-2shot',
    code: 'S1',
    aliases: ['S1', 's1', 'shortdrama-2shot'],
    name: 'S1 short play opening 2 shots (full link script + first frame + video + connection)',
    description: 'Enter the opening requirements of a 2-shot urban short play on an empty canvas, and check the storyboard nodes, 2-line storyboards, first frame image and video nodes, reference connections and zero dangling nodes.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s1-1',
        message: 'Make an urban short play opening: the heroine discovers missing clues on the streets on a rainy night (including plot descriptions for each shot, lines and first frame/video prompts), make scripts and first frame graph nodes for the two shots, and connect them to the corresponding video generation nodes.',
      },
    ],
    evaluate({ simGo, canvasId, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const edges = doc.connections || [];

      const scriptNodes = nodes.filter((n) => n.type === 'script');
      const rows = scriptNodes[0]?.metadata?.storyboard?.rows || [];
      const imgNodes = nodes.filter((n) => n.type === 'image');
      const vidNodes = nodes.filter((n) => n.type === 'video');

      const rowsComplete =
        rows.length >= 2 &&
        rows.every(
          (r) =>
            Number.isFinite(r.shotNumber) &&
            String(r.plotDescription || '').trim().length > 0 &&
            (String(r.dialogue || '').trim().length > 0 || String(r.videoMotionPrompt || '').trim().length > 0) &&
            String(r.imageGenerationPrompt || '').trim().length > 0,
        );

      const imgToVidEdges = edges.filter((e) => {
        const from = nodes.find((n) => n.id === e.fromNodeId);
        const to = nodes.find((n) => n.id === e.toNodeId);
        return from?.type === 'image' && to?.type === 'video';
      });

      const connectedNodeIds = new Set();
      for (const e of edges) {
        connectedNodeIds.add(e.fromNodeId);
        connectedNodeIds.add(e.toNodeId);
      }
      for (const r of rows) {
        if (r.imageNodeId) connectedNodeIds.add(r.imageNodeId);
        if (r.videoNodeId) connectedNodeIds.add(r.videoNodeId);
      }
      const mediaNodes = [...imgNodes, ...vidNodes];
      const danglingMediaNodes = mediaNodes.filter((n) => !connectedNodeIds.has(n.id));

      const turnErrors = (turnRecords || []).filter((t) => t.error);
      // 只算这个场景画布上的冲突；计数器是整个模拟器共用的，别的场景恢复过的冲突不能记到这里。
      const canvasConflicts = (snap.opLog || []).filter((op) =>
        op.status === 'error' && op.reason === 'revision_conflict' && op.params?.canvasId === canvasId).length;

      const checks = [
        {
          name: 'script_node_created',
          passed: scriptNodes.length >= 1,
          detail: `script node number=${scriptNodes.length}`,
        },
        {
          name: 'script_rows_complete',
          passed: rowsComplete,
          detail: `Number of storyboard lines =${rows.length},field complete=${rowsComplete}`,
        },
        {
          name: 'image_and_video_nodes_created',
          passed: imgNodes.length >= 2 && vidNodes.length >= 2,
          detail: `image node=${imgNodes.length}, video node =${vidNodes.length}`,
        },
        {
          name: 'image_to_video_edges_connected',
          passed: imgToVidEdges.length >= 2,
          detail: `image->video number of connections =${imgToVidEdges.length}`,
        },
        {
          name: 'zero_dangling_media_nodes',
          passed: danglingMediaNodes.length === 0 && mediaNodes.length >= 4,
          detail: `Number of dangling media nodes =${danglingMediaNodes.length}`,
        },
        {
          name: 'no_unrecovered_errors',
          passed: turnErrors.length === 0 && canvasConflicts === 0,
          detail: `turnErrors=${turnErrors.length}, revisionConflicts=${canvasConflicts}`,
        },
      ];

      return {
        passed: checks.every((c) => c.passed),
        status: checks.every((c) => c.passed) ? 'passed' : 'failed',
        checks,
      };
    },
  },

  {
    id: 'storyboard-8shot',
    code: 'S2',
    aliases: ['S2', 's2', 'storyboard-8shot'],
    name: 'S2 8-shot storyboard and only the first 2 frames of materialization',
    description: 'Generate a complete 8-shot storyboard. Only create the first frame graph node for the first 2 shots and write back the storyboard row imageNodeId. The 3rd to 8th shots are not created out of bounds.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s2-1',
        message: 'Make a 30-second science fiction trailer storyboard (8 shots). Complete the storyboard first, then create the first frame graph node for only the first 2 shots and backfill it into the storyboard row.',
      },
    ],
    evaluate({ simGo, canvasId }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const scriptNode = nodes.find((n) => n.type === 'script');
      const rows = scriptNode?.metadata?.storyboard?.rows || [];
      const imgNodes = nodes.filter((n) => n.type === 'image');
      const imgNodeIds = new Set(imgNodes.map((n) => n.id));

      const boundRows12 =
        rows.length >= 2 &&
        Boolean(rows[0].imageNodeId && imgNodeIds.has(rows[0].imageNodeId)) &&
        Boolean(rows[1].imageNodeId && imgNodeIds.has(rows[1].imageNodeId)) &&
        rows[0].imageNodeId !== rows[1].imageNodeId;

      const unboundRows3to8 =
        rows.length === 8 &&
        rows.slice(2).every((r) => !r.imageNodeId && !r.videoNodeId);

      const checks = [
        {
          name: 'eight_storyboard_rows',
          passed: rows.length === 8,
          detail: `Number of storyboard lines =${rows.length}(expected 8)`,
        },
        {
          name: 'only_two_image_nodes_created',
          passed: imgNodes.length === 2,
          detail: `image node number =${imgNodes.length}(Expect 2, build 8 without crossing the line)`,
        },
        {
          name: 'first_two_rows_bound_to_real_nodes',
          passed: boundRows12,
          detail: `1st mirror binding =${rows[0]?.imageNodeId || 'None'}, 2nd mirror binding =${rows[1]?.imageNodeId || 'None'}`,
        },
        {
          name: 'rows_3_to_8_remain_unbound',
          passed: unboundRows3to8,
          detail: `Mirrors 3-8 are not bound =${unboundRows3to8}`,
        },
      ];

      return {
        passed: checks.every((c) => c.passed),
        status: checks.every((c) => c.passed) ? 'passed' : 'failed',
        checks,
      };
    },
  },

  {
    id: 'local-edit',
    code: 'S3',
    aliases: ['S3', 's3', 'local-edit'],
    name: 'S3 has partially modified the existing canvas single lens (accidental damage to other nodes is strictly prohibited)',
    description: 'Preset 4-shot storyboard + 4 first frames + 4 video canvases, only change the 3rd shot and the 3rd first-frame prompt word, and assert that the remaining nodes/rows/connections have zero changes.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const seed = buildS3SeedCanvas(canvasId);
      const doc = simGo.ensureCanvas(canvasId, seed);
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s3-1',
        message: 'Only change the third shot to a misty forest in the early morning, and update the prompt word of the third first frame node simultaneously. Do not touch other shots and nodes.',
      },
    ],
    evaluate({ simGo, canvasId, setupState }) {
      const before = setupState.beforeCanvas;
      const after = simGo.snapshot().canvases[canvasId];

      const beforeScript = before.nodes.find((n) => n.type === 'script');
      const afterScript = after.nodes.find((n) => n.type === 'script');
      const beforeRows = beforeScript.metadata.storyboard.rows;
      const afterRows = afterScript?.metadata?.storyboard?.rows || [];

      const forestRegex = /清晨.*薄雾.*森林|清晨薄雾森林/;
      const row3Updated =
        afterRows[2] &&
        (forestRegex.test(String(afterRows[2].plotDescription || '')) ||
          forestRegex.test(String(afterRows[2].imageGenerationPrompt || '')));

      const otherRowsUnchanged = [0, 1, 3].every(
        (idx) => JSON.stringify(beforeRows[idx]) === JSON.stringify(afterRows[idx]),
      );

      const afterImg3 = after.nodes.find((n) => n.id === 'node-img-3');
      const img3Updated =
        afterImg3 &&
        (forestRegex.test(String(afterImg3.metadata?.prompt || '')) ||
          forestRegex.test(String(afterImg3.metadata?.composerContent || '')));

      const otherNodeIds = ['node-img-1', 'node-img-2', 'node-img-4', 'node-vid-1', 'node-vid-2', 'node-vid-3', 'node-vid-4'];
      const otherNodesUnchanged = otherNodeIds.every((id) => {
        const b = before.nodes.find((n) => n.id === id);
        const a = after.nodes.find((n) => n.id === id);
        return JSON.stringify(b) === JSON.stringify(a);
      });

      const edgesUnchanged = JSON.stringify(before.connections) === JSON.stringify(after.connections);

      const checks = [
        {
          name: 'row_3_updated',
          passed: Boolean(row3Updated),
          detail: `3rd mirror description =${afterRows[2]?.plotDescription || ''}`,
        },
        {
          name: 'img_3_prompt_updated',
          passed: Boolean(img3Updated),
          detail: `Mirror 3 first frame prompt word=${afterImg3?.metadata?.prompt || ''}`,
        },
        {
          name: 'other_rows_unchanged',
          passed: otherRowsUnchanged,
          detail: `Shots 1/2/4 are completely unchanged =${otherRowsUnchanged}`,
        },
        {
          name: 'other_nodes_unchanged',
          passed: otherNodesUnchanged && after.nodes.length === before.nodes.length,
          detail: `The remaining 7 media nodes are completely unchanged =${otherNodesUnchanged}, total number of nodes =${after.nodes.length}`,
        },
        {
          name: 'edges_unchanged',
          passed: edgesUnchanged,
          detail: `All 12 connections remain unchanged =${edgesUnchanged}`,
        },
      ];

      return {
        passed: checks.every((c) => c.passed),
        status: checks.every((c) => c.passed) ? 'passed' : 'failed',
        checks,
      };
    },
  },

  {
    id: 'mid-turn-steer',
    code: 'S4',
    aliases: ['S4', 's4', 'mid-turn-steer'],
    name: 'S4 Supplementary redirection in the middle of the same round (/steer real-time convergence)',
    description: 'In the first round, 4 shots of ancient martial arts were initiated. When the first request for the model arrived, it was changed to 2 shots of Cyberpunk Neon Night Market through /steer injection, which was completed in the same round.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s4-1',
        message: 'Help me plan a 4-shot ancient martial arts opening, create script nodes and 4 first frame graph nodes.',
        steerOnFirstModelRequest: {
          message: 'Change it to a cyberpunk neon night market style and only require 2 shots.',
        },
      },
    ],
    evaluate({ simGo, canvasId, turnRecords, steerResults }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const scriptNode = nodes.find((n) => n.type === 'script');
      const rows = scriptNode?.metadata?.storyboard?.rows || [];
      const imgNodes = nodes.filter((n) => n.type === 'image');

      const steerAccepted = steerResults.length > 0 && steerResults.every((s) => s.status === 202 && s.body?.accepted === true);
      const cyberRegex = /赛博|霓虹|夜市|全息|义体|cyberpunk|neon/i;
      const isCyberpunk =
        rows.length === 2 &&
        rows.every((r) => cyberRegex.test(`${r.plotDescription || ''} ${r.imageGenerationPrompt || ''}`)) &&
        imgNodes.every((n) => cyberRegex.test(`${n.title || ''} ${n.metadata?.prompt || ''} ${n.metadata?.composerContent || ''}`));

      const checks = [
        {
          name: 'steer_accepted_mid_turn',
          passed: steerAccepted,
          detail: `steerresponse=${JSON.stringify(steerResults[0] || null)}`,
        },
        {
          name: 'converged_to_2_shots',
          passed: rows.length === 2 && imgNodes.length === 2,
          detail: `Number of final storyboard lines =${rows.length}, number of image nodes =${imgNodes.length}`,
        },
        {
          name: 'style_updated_to_cyberpunk',
          passed: isCyberpunk,
          detail: `Cyberpunk neon night market style takes effect =${isCyberpunk}`,
        },
        {
          name: 'completed_in_single_turn',
          passed: (turnRecords || []).length === 1 && !turnRecords[0]?.error,
          detail: `Number of rounds=${(turnRecords || []).length}`,
        },
      ];

      return {
        passed: checks.every((c) => c.passed),
        status: checks.every((c) => c.passed) ? 'passed' : 'failed',
        checks,
      };
    },
  },

  {
    id: 'post-generation-review',
    code: 'S5',
    aliases: ['S5', 's5', 'post-generation-review'],
    name: 'Automatic wake-up screen review and re-generation after S5 generation',
    description: 'In the first round, the generation proposal is submitted and the simulator completes the generation product with the six-finger defect to verify whether the host has the wake-on-generation automatic wake-up review capability.',
    capabilities: ['wake-on-generation'],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      simGo.flagNextTaskDefect('The character\'s right hand has 6 fingers and the hand is obviously deformed.');
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s5-1',
        message: 'Create a node for the first frame of a close-up portrait and submit the generation task. After the generation is completed, help me check whether there are hand deformities in the picture. If there are any problems, rewrite the prompt words and regenerate.',
        confirmProposalsAfterTurn: true,
        // 上限而非固定等待：真实模型被唤醒后要几次请求才复查完，看到复查且助手停下就结束。
        awaitAutoWakeMs: 120_000,
      },
    ],
    evaluate({ simGo, canvasId, wakeResult }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const imgNodes = (doc.nodes || []).filter((n) => n.type === 'image');
      const canvasProposals = snap.proposals.filter((p) => p.canvasId === canvasId);
      const canvasTasks = snap.tasks.filter((t) => t.canvasId === canvasId);
      const firstProposalConfirmed = canvasProposals.length >= 1 && canvasProposals[0].confirmed === true;
      const taskDelivered = canvasTasks.length >= 1 && canvasTasks[0].status === 'succeeded';
      const autoWoken = Boolean(wakeResult?.autoWoken);
      // 只算本画布上的复查；全局计数会把同一轮评测里其他场景的复查也算进来。
      const mediaInspected = snap.opLog.some((op) =>
        op.status === 'ok' && ['media.inspect', 'media.overview'].includes(op.op) && op.params?.canvasId === canvasId);
      const reProposed = canvasProposals.length >= 2;

      const checks = [
        {
          name: 'initial_node_and_proposal_created',
          passed: imgNodes.length >= 1 && firstProposalConfirmed && taskDelivered,
          detail: `image node=${imgNodes.length}, first proposal confirmed =${firstProposalConfirmed}, task delivered =${taskDelivered}`,
        },
        {
          name: 'auto_wake_on_generation',
          passed: autoWoken && mediaInspected && reProposed,
          capabilityGap: !autoWoken && wakeResult?.eventAccepted ? 'wake-on-generation' : undefined,
          detail: autoWoken
            ? `Has automatically woken up and executed media.inspect(${snap.counts.mediaInspections}) and retrieval generation (${canvasProposals.length})`
            : wakeResult?.eventAccepted
              ? 'Completion event accepted; no automatic review within watch window (capability gap: wake-on-generation)'
              : 'The generation completion event is not accepted by the host and cannot be used to judge the automatic wake-up capability.',
        },
      ];

      const allPassed = checks.every((c) => c.passed);
      const hasCapabilityGap = checks.some((c) => !c.passed && c.capabilityGap);
      const onlyCapabilityGap = hasCapabilityGap && checks.every((c) => c.passed || c.capabilityGap);

      return {
        passed: allPassed,
        status: allPassed ? 'passed' : onlyCapabilityGap ? 'baseline_gap' : 'failed',
        capabilityGap: hasCapabilityGap ? 'wake-on-generation' : null,
        checks,
      };
    },
  },

  {
    id: 'skill-across-turns',
    code: 'S6',
    aliases: ['S6', 's6'],
    name: 'S6 multi-round rules maintenance after activating skills in the first round (short-drama-storyboard)',
    description: 'Only the "short drama storyboarding to the first frame" skill is selected in the first round, and will be naturally supplemented and confirmed later to verify that the active skill still enters every model request and the first frame complies with the rules; no compression is triggered or declared.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      const pin = simGo.getSkillPin('short-drama-storyboard');
      return { beforeCanvas: clone(doc), skillPin: pin };
    },
    turns: [
      {
        id: 'turn-s6-1',
        useActiveSkillPins: true,
        message:
          '[S6_TURN_1] I chose the "Short Play Storyboarding to the First Frame" skill. Summary of the script: On the rooftop on a rainy night, female reporter Lin Wan holds a blood-stained pocket watch to question the silence of her informant (2 shots, vertical screen 9:16, realistic cinematic feel). Please complete the character settings and storyboards first.',
      },
      {
        id: 'turn-s6-2',
        message:
          '[S6_TURN_2] I have confirmed the character settings. To add: Lin Wan has been investigating the disappearance case for three years. There is a microfilm hidden in his pocket watch. Shen Mo is actually the liaison person of the organization behind the scenes. Please improve the storyboard and let me see it first.',
      },
      {
        id: 'turn-s6-3',
        message:
          '[S6_TURN_3] There should be water on the rooftop to reflect the red neon in the distance, and the cold blue main light should be combined with the lightning side backlight. First check whether the existing storyboard is suitable for the atmosphere, and don’t make pictures yet.',
      },
      {
        id: 'turn-s6-4',
        message: '[S6_TURN_4] The storyboard is confirmed, let’s start preparing the first frames of these two shots.',
      },
    ],
    evaluate({ simGo, canvasId, turnRecords, requestEvidence = [] }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const mdNode = nodes.find((n) => (n.type === 'markdown' || n.type === 'text') && String(n.title || '').includes('Character setting'));
      const scriptNode = nodes.find((n) => n.type === 'script');
      const rows = scriptNode?.metadata?.storyboard?.rows || [];
      const imgNodes = nodes.filter((n) => n.type === 'image');

      const titlesFollowSkill =
        imgNodes.some((n) => /镜\s*1\s*首帧/.test(String(n.title || ''))) &&
        imgNodes.some((n) => /镜\s*2\s*首帧/.test(String(n.title || '')));
      const configured916 =
        imgNodes.length >= 2 &&
        imgNodes.every((n) => isPortrait916(n.metadata?.size) && Number(n.metadata?.count ?? 1) === 1);
      const rowsBound =
        rows.length === 2 &&
        rows.every((row) => imgNodes.some((node) => node.id === row.imageNodeId)) &&
        new Set(rows.map((row) => row.imageNodeId)).size === 2;
      const proposalCreated = snap.proposals.some((p) => p.canvasId === canvasId && p.kind === 'image' && p.nodeIds.length >= 2);

      const owned = requestEvidence.filter((entry) => entry.attribution === 'session');
      const checks = [
        {
          name: 'active_skill_present_in_every_turn_request',
          // 只用能按会话确认属于本场景的请求作证据；归属未知的单列，不算通过也不算失败。
          passed: new Set(owned.map((entry) => entry.turnId)).size === 4 && owned.every((entry) => entry.activeSkillPresent),
          detail: `Active skill enters non-system request context =${owned.filter((entry) => entry.activeSkillPresent).length}/${owned.length} Sub-model request, ownership unknown${requestEvidence.length - owned.length} times`,
        },
        {
          name: 'four_turns_completed_in_same_session',
          passed: (turnRecords || []).length === 4 && turnRecords.every((t) => !t.error),
          detail: `Number of rounds completed =${(turnRecords || []).length}`,
        },
        {
          name: 'step1_and_step2_artifacts_preserved',
          passed: Boolean(mdNode) && Boolean(scriptNode) && rows.length === 2,
          detail: `Role setting node =${Boolean(mdNode)}, the number of storyboard lines =${rows.length}`,
        },
        {
          name: 'step3_image_nodes_follow_skill_naming_and_aspect',
          passed: titlesFollowSkill && configured916,
          detail: `The title matches "Mirror N First Frame" =${titlesFollowSkill}, frame size 9:16 and count=1=${configured916} (${imgNodes.map((n) => `${n.title}:${n.metadata?.size}/${n.metadata?.count}`).join(', ')})`,
        },
        {
          name: 'step3_rows_bound_and_proposal_submitted',
          passed: rowsBound && proposalCreated,
          detail: `Storyline row imageNodeId has been backfilled =${rowsBound}, the generated proposal has been submitted =${proposalCreated}`,
        },
      ];

      return {
        passed: checks.every((c) => c.passed),
        status: checks.every((c) => c.passed) ? 'passed' : 'failed',
        checks,
      };
    },
  },
  {
    id: 'user-requested-generation-review',
    code: 'S7',
    aliases: ['S7', 's7'],
    name: 'S7 users actively review the generated results and correct and resubmit them',
    description: 'After the user confirms the first round of generation, he then proactively requests to check the product; the user verifies reading the product, changing the prompt word, and reproducing the product. The resubmission is still waiting for the user\'s confirmation.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      simGo.ensureCanvas(canvasId);
      simGo.flagNextTaskDefect('The character\'s right hand has 6 fingers and the hand is obviously deformed.');
    },
    turns: [
      {
        id: 'turn-s7-1',
        message: 'Create a close-up portrait first frame graph node and submit a generation proposal, paying attention to hand deformities.',
        confirmProposalsAfterTurn: true,
      },
      {
        id: 'turn-s7-2',
        message: 'The picture has been generated. Please review the newly generated picture, change the prompt word if there is any problem, and give me a generation suggestion.',
      },
    ],
    evaluate({ simGo, canvasId, turnRecords }) {
      const snap = simGo.snapshot();
      const proposals = snap.proposals.filter((proposal) => proposal.canvasId === canvasId);
      const tasks = snap.tasks.filter((task) => task.canvasId === canvasId);
      const nodes = snap.canvases[canvasId]?.nodes || [];
      const reviewOps = snap.opLog.filter((operation) => operation.turnId === turnRecords[1]?.turnId && operation.status === 'ok');
      const inspectedAt = reviewOps.findIndex((operation) => operation.op === 'media.inspect');
      // 媒体节点的提示词由 canvas.node.configure 设置（canvas.node.update 的 prompt/content 也是草稿别名），
      // 两者改提示词都算修正；只改标题或其他参数不算。
      const promptEdited = ({ op, params }) =>
        (op === 'canvas.node.configure' && typeof params?.patch?.prompt === 'string') ||
        (op === 'canvas.node.update' && ['prompt', 'content'].some((key) => typeof params?.patch?.[key] === 'string'));
      const correctedAt = reviewOps.findIndex(promptEdited);
      const proposedAt = reviewOps.findIndex((operation) => operation.op === 'canvas.generation.propose');
      const checks = [
        {
          name: 'explicit_user_review_after_delivery',
          passed: turnRecords.length === 2 && turnRecords.every((turn) => !turn.error) && tasks.length === 1 && tasks[0].status === 'succeeded',
          detail: `User round =${turnRecords.length}, the first build task has been delivered =${tasks[0]?.status === 'succeeded'}`,
        },
        {
          name: 'result_inspected_and_prompt_corrected',
          passed: inspectedAt >= 0 && correctedAt > inspectedAt && proposedAt > correctedAt && nodes.length === 1,
          detail: `Check, modify, and repeat in order =${inspectedAt >= 0 && correctedAt > inspectedAt && proposedAt > correctedAt}, modify the original node instead of re-creating =${nodes.length === 1}`,
        },
        {
          name: 'replacement_proposal_waits_for_user_confirmation',
          passed: proposals.length === 2 && proposals[0].confirmed && !proposals[1].confirmed && tasks.length === 1,
          detail: `Number of proposals=${proposals.length}, the re-mention has not yet been confirmed =${proposals[1]?.confirmed === false}, actual number of tasks =${tasks.length}`,
        },
      ];
      return { passed: checks.every((check) => check.passed), status: checks.every((check) => check.passed) ? 'passed' : 'failed', checks };
    },
  },

  ...REAL_FAILURE_SCENARIOS,
];

export function resolveScenarioList(selector = 'all') {
  const norm = String(selector || 'all').trim();
  const lower = norm.toLowerCase();
  // 'all' 仍然只指 S1–S11，替代场景要用 parity 或具体场景码单独选择。
  if (!norm || lower === 'all') return SCENARIOS;
  if (lower === 'parity') return PARITY_SCENARIOS;
  const parts = norm.split(',').map((s) => s.trim()).filter(Boolean);
  const pool = [...SCENARIOS, ...PARITY_SCENARIOS];
  const matched = [];
  for (const part of parts) {
    const found = pool.find(
      (s) => s.id.toLowerCase() === part.toLowerCase() || s.code.toLowerCase() === part.toLowerCase() || (s.aliases || []).some((a) => a.toLowerCase() === part.toLowerCase()),
    );
    if (!found) {
      throw new Error(`Unknown evaluation scenario:${part}(optional: all, parity,${pool.map((s) => `${s.code}/${s.id}`).join(', ')}）`);
    }
    if (!matched.includes(found)) matched.push(found);
  }
  return matched;
}
