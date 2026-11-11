import { describe, expect, test } from 'bun:test';
import { durableLifecycleState, durableRetryReason, durableStreamEvents } from './durable-session-owner.mjs';
import { createDurableTurnProjection, durableReasoningSegments, durableTurnReplyText } from './durable-turn-projection.mjs';

const SECRET = 'sk-synthetic-upstream-secret';
/** 供应商给的签名与不透明载荷：可以留在官方记录里，但绝不能进展示投影。 */
const SIGNATURE = 'sig-9f2b-opaque-thinking-signature';

describe('official Durable events projected to the panel stream', () => {
  test('tool events keep their existing lines and plans carry the committed value', () => {
    expect(durableStreamEvents({ type: 'plan', plan: null })).toEqual([{ type: 'plan', plan: null }]);
    expect(durableStreamEvents({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'media_inspect', args: {} }))
      .toEqual([{ type: 'lifecycle', phase: 'tool', toolName: 'media_inspect' }]);
    expect(durableStreamEvents({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'media_inspect' }))
      .toEqual([{ type: 'lifecycle', phase: 'tool_end', toolName: 'media_inspect' }]);
  });

  test('official retry start/end become retry lifecycle with a classified reason and no upstream text', () => {
    const start = durableStreamEvents({ type: 'auto_retry_start', attempt: 1, at: 1791374400000, errorMessage: `503 upstream detail ${SECRET}` });
    expect(start).toEqual([{ type: 'lifecycle', phase: 'retry', attempt: 1, reason: 'provider_unavailable' }]);
    expect(JSON.stringify(start)).not.toContain(SECRET);
    expect(durableStreamEvents({ type: 'auto_retry_end', attempt: 1 })).toEqual([{ type: 'lifecycle', phase: 'retry_end', attempt: 1 }]);
  });

  test('only the matching official tool result confirms success and never forwards its payload', () => {
    const event = { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'canvas_node_configure', entry: { model: [
      { role: 'toolResult', toolCallId: 'c1', toolName: 'canvas_node_configure', isError: false, content: [{ type: 'text', text: SECRET }] },
    ] } };
    expect(durableStreamEvents(event)[0]).toEqual({ type: 'lifecycle', phase: 'tool_end', toolName: 'canvas_node_configure', success: true });
    expect(JSON.stringify(durableStreamEvents(event))).not.toContain(SECRET);
    event.entry.model[0].isError = true;
    expect(durableStreamEvents(event)[0].success).toBe(false);
    event.entry.model[0].toolCallId = 'other';
    expect(durableStreamEvents(event)[0]).not.toHaveProperty('success');
    expect(durableStreamEvents({ ...event, entry: undefined })[0]).not.toHaveProperty('success');
  });

  test('blocking compaction is visible, background work cannot replace foreground progress', () => {
    const tool = { type: 'lifecycle', phase: 'tool', toolName: 'media_inspect' };
    const start = { type: 'compaction_start', taskId: 42, blocking: true };
    const busy = durableLifecycleState(tool, start);
    expect(busy).toEqual({ type: 'lifecycle', phase: 'compaction', taskId: 42 });
    expect(durableStreamEvents({ ...start, blocking: false }, tool)).toEqual([]);
    expect(durableLifecycleState(tool, { ...start, blocking: false })).toEqual(tool);
    expect(durableStreamEvents({ type: 'compaction_end', taskId: 99 }, busy)).toEqual([]);
    expect(durableLifecycleState(busy, { type: 'compaction_end', taskId: 99 })).toEqual(busy);
    expect(durableStreamEvents({ type: 'compaction_end', taskId: 42, error: SECRET }, busy)).toEqual([{ type: 'lifecycle', phase: 'compaction_end', success: false }]);
    expect(durableLifecycleState(busy, { type: 'compaction_end', taskId: 42 })).toBeNull();
    expect(durableStreamEvents({ type: 'snapshot', compactions: [{ taskId: 42, blocking: true }], tools: [] })).toEqual([busy]);
  });

  test('a snapshot taken during backoff or a running tool restores that progress', () => {
    const backoff = { type: 'snapshot', entries: [], tools: [], generation: { attempt: 2, retry: { at: 1, error: `429 Too Many Requests ${SECRET}` } } };
    expect(durableStreamEvents(backoff)).toEqual([{ type: 'lifecycle', phase: 'retry', attempt: 2, reason: 'rate_limited' }]);
    expect(JSON.stringify(durableStreamEvents(backoff))).not.toContain(SECRET);
    const tool = { type: 'snapshot', entries: [], tools: [{ callId: 'c1', name: 'media_overview', status: 'running' }] };
    expect(durableStreamEvents(tool)).toEqual([{ type: 'lifecycle', phase: 'tool', toolName: 'media_overview' }]);
    expect(durableStreamEvents({ type: 'snapshot', entries: [], tools: [{ callId: 'c1', name: 'media_overview', status: 'done' }] })).toEqual([]);
  });

  test('retry reasons are a closed set', () => {
    for (const [message, reason] of [
      ['stream idle timeout after 95000ms', 'timeout'], ['Request timed out.', 'timeout'],
      ['429 rate limit reached', 'rate_limited'], ['Too Many Requests', 'rate_limited'],
      ['503 Service Unavailable', 'provider_unavailable'], ['overloaded_error', 'provider_unavailable'], ['502 Bad Gateway', 'provider_unavailable'],
      ['400 Service temporarily unavailable (busy: you can retry your request)', 'provider_unavailable'],
      ['service_unavailable', 'provider_unavailable'], ['ServiceUnavailable', 'provider_unavailable'],
      ['fetch failed', 'network'], ['socket hang up', 'network'], ['terminated', 'network'], ['Connection error.', 'network'],
      ['unexpected provider wording', 'model_error'], [undefined, 'model_error'],
    ]) expect(durableRetryReason(message)).toBe(reason);
  });
});

describe('Durable visible text projection', () => {
  const assistant = (text) => ({ role: 'assistant', content: [{ type: 'thinking', thinking: SECRET, thinkingSignature: SIGNATURE }, { type: 'text', text }] });
  const entry = (id, text) => ({ id, model: [assistant(text)] });
  test('an unobserved projection is distinct from an official empty snapshot', () => {
    const projection = createDurableTurnProjection();
    expect(projection.initialized).toBe(false);
    expect(projection.accept({ type: 'snapshot', afterEntry: 10, entries: [entry(8, 'previous turn')], tools: [] }))
      .toEqual([{ type: 'text_snapshot', text: '' }]);
    expect(projection.initialized).toBe(true);
  });
  test('initial partial, text starts, deltas, whole replacements and final-only suffix are all retained once', () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [entry(8, 'previous turn')], tools: [] });
    expect(projection.accept({ type: 'message_start', message: assistant('Beginning') })).toEqual([
      { type: 'text_snapshot', text: 'Beginning' },
      { type: 'reasoning_snapshot', segments: [{ id: 'live-1:0', text: SECRET, status: 'done' }] },
    ]);
    projection.accept({ type: 'message_update', changes: [{ type: 'text_delta', contentIndex: 1, delta: 'middle section' }] });
    expect(projection.text).toBe('Beginning and middle section');
    projection.accept({ type: 'message_update', changes: [{ type: 'text_start', contentIndex: 2, block: { type: 'text', text: 'new section' } }] });
    expect(projection.text).toBe('New paragraph in the beginning and middle paragraph');
    projection.accept({ type: 'message_update', changes: [{ type: 'block', contentIndex: 2, block: { type: 'text', text: 'Revise paragraph' } }] });
    expect(projection.text).toBe('Revision of the beginning and middle paragraphs');
    projection.accept({ type: 'message_update', changes: [{ type: 'message', message: assistant('complete replacement') }] });
    expect(projection.accept({ type: 'message_end', entry: entry(12, 'Full replacement and tail') })).toEqual([
      { type: 'text_snapshot', text: 'Full replacement and tail' },
      { type: 'reasoning_snapshot', segments: [{ id: '12:0', text: SECRET, status: 'done' }] },
    ]);
    expect(projection.accept({ type: 'message_end', entry: entry(12, 'Full replacement and tail') })).toEqual([]);
    // 思考正文有自己的通道：正文投影永远不把它当回复。
    expect(projection.text).not.toContain(SECRET);
  });
  test('late attachment and overflow snapshots restore only this turn without duplication', () => {
    const projection = createDurableTurnProjection();
    const snapshot = { type: 'snapshot', afterEntry: 10, entries: [entry(8, 'previous turn'), entry(12, 'Pre-tool instructions')], generation: { message: assistant('Current beginning') } };
    expect(projection.accept(snapshot).find((payload) => payload.type === 'text_snapshot')?.text).toBe('Pre-tool instructions\n\nCurrent beginning');
    projection.accept({ type: 'message_update', changes: [{ type: 'text_delta', contentIndex: 1, delta: 'middle section' }] });
    expect(snapshot.generation.message.content[1].text).toBe('Current beginning');
    projection.accept({ type: 'snapshot', entries: [entry(8, 'previous turn'), entry(12, 'Pre-tool instructions'), entry(15, 'Current beginning, middle and end')], generation: { message: assistant('Continue processing') } });
    expect(projection.text).toBe('Pre-tool instructions\n\nCurrent beginning, middle and end\n\nContinue processing');
    projection.accept({ type: 'message_end', entry: entry(16, 'Continue processing to completion') });
    expect(projection.text).toBe('Pre-tool instructions\n\nCurrent beginning, middle and end\n\nContinue processing to completion');
    expect(projection.text).not.toContain('previous turn');
    // 终态与重开历史共用同一纯投影：按条目身份去重，忽略无正文的工具终止步骤与报错条目。
    expect(durableTurnReplyText([
      entry(12, 'Pre-tool instructions'),
      entry(15, 'Current beginning, middle and end'),
      entry(15, 'Current beginning, middle and end'),
      entry(16, 'Continue processing to completion'),
      { id: 17, model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'p1', name: 'canvas_generation_propose', arguments: {} }] }] },
      { id: 18, model: [{ role: 'assistant', stopReason: 'error', content: [{ type: 'text', text: 'Error fragments that should not be displayed' }] }] },
    ])).toBe(projection.text);
  });
});

describe('Durable readable reasoning projection', () => {
  const thinking = (text, extra = {}) => ({ type: 'thinking', thinking: text, ...extra });
  const text = (value) => ({ type: 'text', text: value });
  const assistant = (content) => ({ role: 'assistant', content });
  const entry = (id, content) => ({ id, model: [assistant(content)] });
  const segments = (payloads) => payloads.find((payload) => payload.type === 'reasoning_snapshot')?.segments;

  test('Think about the increments accumulated paragraph by paragraph. Only the last piece is still being generated. The title should change after the text begins.', () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [], tools: [] });
    projection.accept({ type: 'message_start', message: assistant([]) });
    // 还没有可读正文时不发空抽屉。
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'thinking_start', contentIndex: 0, block: thinking('') }] })).toEqual([]);
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'thinking_delta', contentIndex: 0, delta: 'Look first' }] }))
      .toEqual([{ type: 'reasoning_snapshot', segments: [{ id: 'live-1:0', text: 'Look first', status: 'streaming' }] }]);
    expect(segments(projection.accept({ type: 'message_update', changes: [{ type: 'thinking_delta', contentIndex: 0, delta: 'canvas.' }] })))
      .toEqual([{ id: 'live-1:0', text: 'Look at the canvas first.', status: 'streaming' }]);
    // 正文开始：思考块已经写完，界面据此从「正在思考…」换成「思考过程」。
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'text_start', contentIndex: 1, block: text('') }] }))
      .toEqual([{ type: 'reasoning_snapshot', segments: [{ id: 'live-1:0', text: 'Look at the canvas first.', status: 'done' }] }]);
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'text_delta', contentIndex: 1, delta: 'Start doing it.' }] }))
      .toEqual([{ type: 'text_snapshot', text: 'Start doing it.' }]);
    // 终态：临时槽换成官方 entry 身份，内容与阶段不变。
    expect(projection.accept({ type: 'message_end', entry: entry(12, [thinking('Look at the canvas first.'), text('Start doing it.')]) }))
      .toEqual([{ type: 'reasoning_snapshot', segments: [{ id: '12:0', text: 'Look at the canvas first.', status: 'done' }] }]);
    expect(projection.accept({ type: 'message_end', entry: entry(12, [thinking('Look at the canvas first.'), text('Start doing it.')]) })).toEqual([]);
    expect(projection.text).toBe('Start doing it.');
  });

  test('Thinking→Tools→Thinking→Text: Each paragraph of readable thinking is left, and the tool parameters are not projected.', () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [], tools: [] });
    projection.accept({ type: 'message_start', message: assistant([]) });
    projection.accept({ type: 'message_update', changes: [{ type: 'thinking_delta', contentIndex: 0, delta: 'read canvas first' }] });
    const toolCall = { type: 'toolCall', id: 't1', name: 'canvas_node_configure', arguments: { apiKey: SECRET } };
    expect(segments(projection.accept({ type: 'message_end', entry: entry(11, [thinking('read canvas first'), toolCall]) })))
      .toEqual([{ id: '11:0', text: 'read canvas first', status: 'done' }]);
    projection.accept({ type: 'message_start', message: assistant([]) });
    projection.accept({ type: 'message_update', changes: [{ type: 'thinking_delta', contentIndex: 0, delta: 'Confirm the material again' }] });
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'text_delta', contentIndex: 1, delta: 'OK, let\'s get started.' }] }))
      .toEqual([{ type: 'text_snapshot', text: 'OK, let\'s get started.' }, { type: 'reasoning_snapshot', segments: [
        { id: '11:0', text: 'read canvas first', status: 'done' },
        { id: 'live-2:0', text: 'Confirm the material again', status: 'done' },
      ] }]);
    const projected = JSON.stringify(projection.reasoning);
    expect(projected).toContain('read canvas first');
    expect(projected).toContain('Confirm the material again');
    expect(projected).not.toContain(SECRET);
    expect(projected).not.toContain('canvas_node_configure');
  });

  test('redacted and empty thinking do not count as readable content and do not generate empty drawers.', () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [], tools: [] });
    projection.accept({ type: 'message_start', message: assistant([]) });
    const redacted = thinking('Encrypted placeholder', { redacted: true, thinkingSignature: SIGNATURE });
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'thinking_start', contentIndex: 0, block: redacted }] })).toEqual([]);
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'thinking_delta', contentIndex: 0, delta: 'Shouldn\'t have appeared' }] })).toEqual([]);
    expect(projection.reasoning).toEqual([]);
    expect(projection.accept({ type: 'message_end', entry: entry(12, [redacted, text('Checked by canvas.')]) }))
      .toEqual([{ type: 'text_snapshot', text: 'Checked by canvas.' }]);
    expect(JSON.stringify(projection.reasoning)).not.toContain('Encrypted placeholder');
  });

  test('The overflow snapshot replaces the current round of thinking as a whole, without duplication or mixing into other rounds.', () => {
    const projection = createDurableTurnProjection();
    const snapshot = { type: 'snapshot', afterEntry: 10, entries: [entry(8, [thinking('Last round of thinking'), text('Previous round text')]), entry(12, [thinking('Think before tools'), text('Pre-tool instructions')])],
      generation: { message: assistant([thinking('Current Thoughts')]) } };
    expect(projection.accept(snapshot).map((payload) => payload.type)).toEqual(['text_snapshot', 'reasoning_snapshot']);
    expect(projection.text).toBe('Pre-tool instructions');
    expect(projection.reasoning).toEqual([
      { id: '12:0', text: 'Think before tools', status: 'done' },
      { id: 'live-1:0', text: 'Current Thoughts', status: 'streaming' },
    ]);
    projection.accept({ type: 'snapshot', entries: [entry(8, [thinking('Last round of thinking'), text('Previous round text')]), entry(12, [thinking('Think before tools'), text('Pre-tool instructions')]), entry(15, [thinking('Thinking after Tools'), text('Instructions behind the tool')])],
      generation: { message: assistant([thinking('keep thinking')]) } });
    expect(projection.text).toBe('Pre-tool instructions\n\nInstructions behind the tool');
    expect(projection.reasoning).toEqual([
      { id: '12:0', text: 'Think before tools', status: 'done' },
      { id: '15:0', text: 'Thinking after Tools', status: 'done' },
      { id: 'live-2:0', text: 'keep thinking', status: 'streaming' },
    ]);
  });

  test('Signatures, tool parameters and upstream original texts are not included in any display snapshots', () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [], tools: [] });
    const payloads = projection.accept({ type: 'message_end', entry: entry(12, [
      thinking('readable fragment', { thinkingSignature: SIGNATURE }),
      { type: 'toolCall', id: 't1', name: 'canvas_node_configure', arguments: { apiKey: SECRET } },
      text('Done'),
    ]) });
    expect(payloads).toEqual([
      { type: 'text_snapshot', text: 'Done' },
      { type: 'reasoning_snapshot', segments: [{ id: '12:0', text: 'readable fragment', status: 'done' }] },
    ]);
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toContain(SIGNATURE);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('canvas_node_configure');
  });

  test('The final state and history use thinking fragments of the same shape: each assistant entry in this round counts, and the fragment identity has entry and content subscripts.', () => {
    // 工具调用前后的两段思考都属于这一轮，不能只留最后一条消息的思考。
    expect(durableReasoningSegments([
      entry(11, [thinking('Look at the canvas first.', { thinkingSignature: SIGNATURE }), { type: 'toolCall', id: 't1', name: 'canvas_get', arguments: {} }]),
      entry(12, [thinking('Confirm the material again.'), text('Start doing it.')]),
    ])).toEqual([
      { id: '11:0', text: 'Look at the canvas first.', status: 'done' },
      { id: '12:0', text: 'Confirm the material again.', status: 'done' },
    ]);
    expect(durableReasoningSegments([entry(12, [thinking('', { redacted: true }), text('Only answer text.')])])).toEqual([]);
    expect(durableReasoningSegments([entry(13, [text('No thinking this round.')])])).toEqual([]);
    expect(durableReasoningSegments(undefined)).toEqual([]);
    expect(durableReasoningSegments([{ id: 14, model: [{ role: 'user', content: [text('user input')] }] }])).toEqual([]);
  });
});

describe('Clear event is emitted when the think is replaced with empty or redacted', () => {
  const thinking = (body, extra = {}) => ({ type: 'thinking', thinking: body, ...extra });
  const text = (value) => ({ type: 'text', text: value });
  const assistant = (content) => ({ role: 'assistant', content });
  const entry = (id, content) => ({ id, model: [assistant(content)] });
  const segments = (payloads) => payloads.find((payload) => payload.type === 'reasoning_snapshot')?.segments;
  // 已经显示过一段可读思考的进行中回合：之后任何清空都必须通知界面。
  const shown = () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [], tools: [] });
    projection.accept({ type: 'message_start', message: assistant([]) });
    projection.accept({ type: 'message_update', changes: [{ type: 'thinking_start', contentIndex: 0, block: thinking('Old content to be replaced') }] });
    expect(projection.reasoning).toEqual([{ id: 'live-1:0', text: 'Old content to be replaced', status: 'streaming' }]);
    return projection;
  };

  test('The entire block is replaced with an empty thinking or redacted: the host clears and pushes the complete empty array', () => {
    for (const replacement of [thinking(''), thinking('Opaque placeholder', { redacted: true })]) {
      const projection = shown();
      expect(segments(projection.accept({ type: 'message_update', changes: [{ type: 'block', contentIndex: 0, block: replacement }] }))).toEqual([]);
      expect(projection.reasoning).toEqual([]);
      // 已经清空后重复同一替换不再重复推送。
      expect(projection.accept({ type: 'message_update', changes: [{ type: 'block', contentIndex: 0, block: replacement }] })).toEqual([]);
    }
  });

  test('Replace the entire message with empty, replace the snapshot with empty: also clear', () => {
    const replacedMessage = shown();
    expect(segments(replacedMessage.accept({ type: 'message_update', changes: [{ type: 'message', message: assistant([thinking('new readable content')]) }] })))
      .toEqual([{ id: 'live-2:0', text: 'new readable content', status: 'streaming' }]);
    expect(segments(replacedMessage.accept({ type: 'message_update', changes: [{ type: 'message', message: assistant([thinking('', { redacted: true })]) }] }))).toEqual([]);
    expect(replacedMessage.reasoning).toEqual([]);

    const replacedSnapshot = shown();
    expect(segments(replacedSnapshot.accept({ type: 'snapshot', entries: [], generation: {} }))).toEqual([]);
    expect(replacedSnapshot.reasoning).toEqual([]);
  });

  test('There is never an empty event when readable, and the interface does not generate an empty drawer.', () => {
    const projection = createDurableTurnProjection();
    projection.accept({ type: 'snapshot', afterEntry: 10, entries: [], tools: [] });
    projection.accept({ type: 'message_start', message: assistant([]) });
    expect(projection.accept({ type: 'message_update', changes: [{ type: 'block', contentIndex: 0, block: thinking('', { redacted: true }) }] })).toEqual([]);
    expect(projection.accept({ type: 'message_end', entry: entry(12, [thinking('', { redacted: true }), text('Only answer text.')]) }))
      .toEqual([{ type: 'text_snapshot', text: 'Only answer text.' }]);
  });
});

describe('latest transient progress kept for history polling', () => {
  const retry = { type: 'lifecycle', phase: 'retry', attempt: 1, reason: 'timeout' };
  const tool = { type: 'lifecycle', phase: 'tool', toolName: 'media_inspect' };
  test('start sets, tool end keeps its receipt, unrelated events keep the current state', () => {
    let state = durableLifecycleState(null, { type: 'auto_retry_start', attempt: 1, at: 1, errorMessage: 'stream idle timeout' });
    expect(state).toEqual(retry);
    expect(durableLifecycleState(state, { type: 'message_update', changes: [] })).toEqual(retry);
    expect(durableLifecycleState(state, { type: 'tool_execution_end', toolName: 'media_inspect' })).toEqual(retry);
    expect(durableLifecycleState(state, { type: 'auto_retry_end', attempt: 1 })).toBeNull();
    state = durableLifecycleState(null, { type: 'tool_execution_start', toolName: 'media_inspect' });
    expect(state).toEqual(tool);
    expect(durableLifecycleState(state, { type: 'tool_execution_end', toolName: 'media_inspect' })).toEqual({ type: 'lifecycle', phase: 'tool_end', toolName: 'media_inspect' });
    expect(durableLifecycleState(state, { type: 'tool_execution_end', toolName: 'other' })).toEqual(state);
  });
  test('a snapshot replaces stale progress', () => {
    expect(durableLifecycleState(retry, { type: 'snapshot', entries: [], tools: [] })).toBeNull();
    expect(durableLifecycleState(null, { type: 'snapshot', entries: [], tools: [], generation: { attempt: 1, retry: { at: 1, error: 'stream idle timeout' } } })).toEqual(retry);
  });
});
