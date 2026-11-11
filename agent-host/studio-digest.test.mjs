import { describe, expect, test } from 'bun:test';
import {
  buildStudioDigest,
  describeChangesSince,
  isTransientStudioTailMessage,
  nodeState,
  normalizeSystemHeaderMessages,
  pruneHistoricalToolImages,
  snapshotOf,
  withCurrentStudio,
} from './studio-digest.mjs';

const media = (id, type, title, meta = {}) => ({ id, type, title, metadata: meta });
const board = (rows) => ({ id: 'board-1', type: 'script', title: 'Takeaway on the 13th floor', metadata: { storyboard: { rows } } });
const row = (n, extra = {}) => ({ id: `row-${n}`, shotNumber: n, durationSeconds: 5, plotDescription: `No.${n}mirror plot`, imageGenerationPrompt: 'p', videoMotionPrompt: '', ...extra });

describe('nodeState', () => {
  test('In progress, failed, completed, empty', () => {
    expect(nodeState(media('a', 'image', 'x', { status: 'loading' }))).toBe('running');
    expect(nodeState(media('a', 'image', 'x', { taskStatus: 'queued' }))).toBe('running');
    expect(nodeState(media('a', 'image', 'x', { status: 'error' }))).toBe('failed');
    expect(nodeState(media('a', 'image', 'x', { assetId: 'asset-1' }))).toBe('done');
    expect(nodeState(media('a', 'image', 'x'))).toBe('empty');
  });
});

describe('buildStudioDigest', () => {
  const canvas = {
    revision: 12,
    nodes: [
      board([row(1, { imageNodeId: 'img-1', videoNodeId: 'vid-1' }), row(2, { imageNodeId: 'img-2' }), row(3)]),
      media('img-1', 'image', 'Mirror 1 first frame', { status: 'success', assetId: 'a1' }),
      media('vid-1', 'video', 'Mirror 1 video', { status: 'loading' }),
      media('img-2', 'image', 'Mirror 2 first frame', { status: 'error', generationErrorSummary: 'Content review failed' }),
    ],
    connections: [{ id: 'c1', fromNodeId: 'img-1', toNodeId: 'vid-1' }],
  };
  test('Contains version, story line binding, progress and failure, and id', () => {
    const { text } = buildStudioDigest(canvas, { selectedNodeIds: ['img-2'] });
    expect(text).toContain('Canvas version 12');
    expect(text).toContain('Storyboard "Takeaway on the 13th floor" id=board-1, 3 shots in total');
    expect(text).toContain('Mirror 1 5s｜row id=row-1｜first frame img-1 completed｜video vid-1 being generated');
    expect(text).toContain('Mirror 2 5s｜row id=row-2｜first frame img-2 failed｜Video - not built');
    expect(text).toContain('Mirror 3 5s｜row id=row-3｜first frame — not built');
    expect(text).toContain('Generating: vid-1');
    expect(text).toContain('Failure: img-2 "Mirror 2 First Frame" content review failed');
    expect(text).toContain('User selected: img-2');
  });
  test('Same status output is exactly the same (cache friendly)', () => {
    expect(buildStudioDigest(canvas).text).toBe(buildStudioDigest(JSON.parse(JSON.stringify(canvas))).text);
  });
  test('If the budget exceeds the budget, the storyboard details will be reduced first, and the key information will be retained.', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i + 1, { imageNodeId: `i${i}`, plotDescription: 'Very long plot description'.repeat(5) }));
    const big = { revision: 3, nodes: [board(rows), media('i0', 'image', 'x', { status: 'error', generationErrorSummary: 'failed' })], connections: [] };
    const { text } = buildStudioDigest(big, { maxBytes: 1500 });
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1500);
    expect(text).toContain('Failure: i0');
    expect(text).toContain('Storyboard details have been shrunk');
  });
  test('empty canvas', () => {
    expect(buildStudioDigest({ revision: 0, nodes: [], connections: [] }).text).toContain('canvas is empty');
  });
  test('The identity of the text node and the current text preview are visible. Long texts still need to read the original text according to the version.', () => {
    const { text } = buildStudioDigest({ revision: 23, nodes: [media('brief', 'text', 'The user just modified the request', { content: 'Maintain character consistency.'.repeat(40) })] });
    expect(text).toContain('brief');
    expect(text).toContain('The user just modified the request');
    expect(text).toContain('Maintain role consistency');
    expect(text).toContain('Preview');
    expect(text).toContain('canvas_get');
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(3600);
  });
  test('Completed video and audio directly bring out the durationMs in the summary to avoid repeated calls to canvas_get', () => {
    const { text } = buildStudioDigest({
      revision: 15,
      nodes: [
        board([row(1, { imageNodeId: 'img-1', videoNodeId: 'vid-1' })]),
        media('img-1', 'image', 'Mirror 1 first frame', { status: 'success', assetId: 'a1' }),
        media('vid-1', 'video', 'Mirror 1 video', { status: 'success', assetId: 'v1', durationMs: 5120 }),
        media('aud-1', 'audio', 'narration', { status: 'success', assetId: 'au1', durationMs: 4800 }),
      ],
      connections: [],
    });
    expect(text).toContain('Video vid-1 completed (5120ms)');
    expect(text).toContain('aud-1 "narration" audio completed (4800ms)');
  });
});

describe('describeChangesSince', () => {
  const before = snapshotOf([
    media('a', 'image', 'Mirror 1 first frame', { status: 'loading' }),
    media('b', 'text', 'Character setting', { content: 'old content' }),
    media('c', 'image', 'To be deleted', { assetId: 'x' }),
  ]);
  test('Generation completion, user modification, addition, and deletion can all be announced.', () => {
    const after = snapshotOf([
      media('a', 'image', 'Mirror 1 first frame', { status: 'success', assetId: 'a1' }),
      media('b', 'text', 'Character setting', { content: 'Content modified by users' }),
      media('d', 'image', 'new', {}),
    ]);
    const text = describeChangesSince(before, after);
    expect(text).toContain('The user modified the "role settings"');
    expect(text).toContain('Add 1 new node');
    expect(text).toContain('Deleted "to be deleted"');
    expect(text).toContain('"Mirror 1 first frame" is generated');
  });
  test('Report failure; position changes are not considered changes; no change returns an empty string', () => {
    const failed = snapshotOf([media('a', 'image', 'Mirror 1 first frame', { status: 'error' }), media('b', 'text', 'Character setting', { content: 'old content' }), media('c', 'image', 'To be deleted', { assetId: 'x' })]);
    expect(describeChangesSince(before, failed)).toContain('"Mirror 1 first frame" generation failed');
    const moved = snapshotOf([{ ...media('a', 'image', 'Mirror 1 first frame', { status: 'loading' }), position: { x: 99, y: 1 } }, media('b', 'text', 'Character setting', { content: 'old content' }), media('c', 'image', 'To be deleted', { assetId: 'x' })]);
    expect(describeChangesSince(before, moved)).toBe('');
    expect(describeChangesSince(null, moved)).toBe('');
  });
  test('When the list is too long, it will be compressed into "Wait N"', () => {
    const many = (suffix) => snapshotOf(Array.from({ length: 9 }, (_, i) => media(`n${i}`, 'text', `node${i}`, { content: suffix })));
    expect(describeChangesSince(many('old'), many('new'))).toContain('Wait 9');
  });
});

describe('normalizeSystemHeaderMessages & withCurrentStudio', () => {
  test('Only instructions and beeftv_skill_catalog are retained in the header, subsequent tool increments are retained, and real user messages starting with tags are not discarded.', () => {
    const toolDef = { name: 'extra_tool', description: 'extra', parameters: { type: 'object', properties: {} } };
    const messages = [
      {
        role: 'system',
        content: 'legacy prefix',
        sections: {
          beeftv_skill_catalog: 'CAT',
          instructions: 'INSTR',
          beeftv_studio: 'OLD_STUDIO',
          unknown_sec: 'NOPE',
        },
      },
      {
        role: 'system',
        content: 'mid convo text',
        toolsAdded: [toolDef],
        sections: { beeftv_plan: 'OLD_PLAN' },
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '<beeftv_plan>\nPlan text posted by users themselves\n</beeftv_plan>' }],
      },
    ];

    const once = withCurrentStudio(messages, '[Production site｜Canvas version 1｜Actual status before this round of requests]\nOverview: The canvas is empty.', {
      planText: 'Current production plan: All steps completed.',
    });
    expect(once[0].content).toBe('');
    expect(Object.keys(once[0].sections)).toEqual(['instructions', 'beeftv_skill_catalog']);
    expect(once[1].role).toBe('system');
    expect(once[1].content).toBe('');
    expect(once[1].sections).toBeUndefined();
    expect(once[1].toolsAdded).toEqual([toolDef]);
    // 真实用户消息即使以 <beeftv_plan> 开头也必须完整保留
    expect(once[2].role).toBe('user');
    expect(once[2].content[0].text).toContain('Plan text posted by users themselves');
    expect(isTransientStudioTailMessage(once[3])).toBe(true);

    // 再次叠加时只替换末尾生成的 transientStudioTail，不误删用户的消息
    const twice = withCurrentStudio(once, '[Production site｜Canvas version 2｜Actual status before this round of requests]\nOverview: The canvas is empty.');
    expect(twice.length).toBe(4);
    expect(twice[2].content[0].text).toContain('Plan text posted by users themselves');
    expect(twice[3].content[0].text).toContain('Canvas version 2');
  });

  test('pruneHistoricalToolImages retains toolResult images in the current batch and continuous media probing, but crops old preview images that have been transferred to canvas writing or historical rounds', () => {
    const bigPad = 'A'.repeat(20 * 1024);
    const imgPart = (tag) => ({ type: 'image', mimeType: 'image/jpeg', data: `${tag}_${bigPad}` });
    const tinyPart = { type: 'image', mimeType: 'image/png', data: 'TINY_ICON' };
    const freshBatch = [
      { role: 'user', content: [{ type: 'text', text: 'Check out the three first frames' }] },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'c1', name: 'media_overview', arguments: { nodeId: 'img-1' } },
          { type: 'toolCall', id: 'c2', name: 'media_overview', arguments: { nodeId: 'img-2' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: '{"op":"media.overview"}' }, imgPart('BASE64_1'), tinyPart] },
      { role: 'toolResult', toolCallId: 'c2', content: [{ type: 'text', text: '{"op":"media.overview"}' }, imgPart('BASE64_2')] },
    ];
    // 尚未有后续 assistant 响应时，同批 2 张图完整保留
    const projectedFresh = pruneHistoricalToolImages(freshBatch);
    expect(projectedFresh[2].content[1]).toEqual(imgPart('BASE64_1'));
    expect(projectedFresh[3].content[1]).toEqual(imgPart('BASE64_2'));

    // 连续 media_inspect（无新图片，例如音频检查）或只读/记账工具（plan_update、canvas_get）时，同轮刚读完的 overview 图仍保留，确保紧随其后的写操作请求能看到参考图
    const duringInspectAndPlan = [
      ...freshBatch,
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'c3', name: 'media_inspect', arguments: { nodeId: 'vid-1', mode: 'audio' } },
          { type: 'toolCall', id: 'c3p', name: 'plan_update', arguments: { items: [] } },
          { type: 'toolCall', id: 'c3g', name: 'canvas_get', arguments: {} },
        ],
      },
      { role: 'toolResult', toolCallId: 'c3', content: [{ type: 'text', text: '{"op":"media.inspect"}' }] },
      { role: 'toolResult', toolCallId: 'c3p', content: [{ type: 'text', text: 'Current plan:' }] },
      { role: 'toolResult', toolCallId: 'c3g', content: [{ type: 'text', text: '{"revision":2}' }] },
    ];
    const projectedInspect = pruneHistoricalToolImages(duringInspectAndPlan);
    expect(projectedInspect[2].content[1]).toEqual(imgPart('BASE64_1'));
    expect(projectedInspect[3].content[1]).toEqual(imgPart('BASE64_2'));

    // 当同轮仅有 [BEEFTV_INPUT:...] 补充消息紧跟在 toolResult 后时，不裁剪当轮刚读出的图片
    const withSupplementOnly = [
      ...freshBatch,
      { role: 'user', content: [{ type: 'text', text: '[BEEFTV_INPUT:s1]\nPlease focus on the second picture' }] },
    ];
    expect(pruneHistoricalToolImages(withSupplementOnly)[2].content[1]).toEqual(imgPart('BASE64_1'));

    // 当上一轮在 toolResult 后直接中断并进入下一轮普通 user 消息（无中间 assistant）时，旧轮图片必须被裁剪
    const interruptedThenNextTurn = [
      ...freshBatch,
      { role: 'user', content: [{ type: 'text', text: 'Start a new round of dialogue' }] },
    ];
    expect(pruneHistoricalToolImages(interruptedThenNextTurn)[2].content[1]).toEqual({
      type: 'text',
      text: '[Historical media preview images have been omitted. To review the overview, please call media_overview. To view the original image or partial details, please call media_inspect]',
    });

    // 一旦助手已读完图片并开始调用 canvas_node_configure，后续步骤不再重复上传旧 toolResult 的 base64
    const afterCanvasConfigure = [
      ...freshBatch,
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c4', name: 'canvas_node_configure', arguments: { nodeId: 'vid-1' } }],
      },
      { role: 'toolResult', toolCallId: 'c4', content: [{ type: 'text', text: '{"op":"canvas.node.configure"}' }] },
    ];
    const projectedAfterWrite = withCurrentStudio(afterCanvasConfigure, 'Site summary');
    expect(projectedAfterWrite[2].content[1]).toEqual({
      type: 'text',
      text: '[Historical media preview images have been omitted. To review the overview, please call media_overview. To view the original image or partial details, please call media_inspect]',
    });
    expect(projectedAfterWrite[3].content[1]).toEqual({
      type: 'text',
      text: '[Historical media preview images have been omitted. To review the overview, please call media_overview. To view the original image or partial details, please call media_inspect]',
    });
    // 小尺寸图标/占位图（<16KB）保持原样以维持前缀缓存一致
    expect(projectedAfterWrite[2].content[2]).toEqual(tinyPart);
    // 原数组不发生原地修改（保证持久层不变）
    expect(freshBatch[2].content[1]).toEqual(imgPart('BASE64_1'));

    // 跨轮进入新用户消息并读取新一批视频帧时，旧轮图片被裁剪、新轮刚读出的视频帧保留
    const nextTurnWithNewFrames = [
      ...afterCanvasConfigure,
      { role: 'assistant', content: [{ type: 'text', text: 'Configuration completed' }] },
      { role: 'user', content: [{ type: 'text', text: 'Continue to accept the video and deliver it' }, imgPart('USER_ATTACHMENT')] },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c5', name: 'media_overview', arguments: { nodeId: 'vid-1' } }],
      },
      { role: 'toolResult', toolCallId: 'c5', content: [{ type: 'text', text: '{"op":"media.overview"}' }, imgPart('VIDEO_FRAME_1')] },
    ];
    const projectedNextTurn = withCurrentStudio(nextTurnWithNewFrames, 'Site summary');
    expect(projectedNextTurn[2].content[1].type).toBe('text');
    // 用户消息自带的附件图片始终保留
    expect(projectedNextTurn[7].content[1]).toEqual(imgPart('USER_ATTACHMENT'));
    // 新一轮刚读取的 toolResult 视频帧完整保留
    expect(projectedNextTurn[9].content[1]).toEqual(imgPart('VIDEO_FRAME_1'));
  });
});
