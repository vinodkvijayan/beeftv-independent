import { test, expect } from 'bun:test';
import { createCnyBudget, costOfTokens, extractUsage, normalizeAgentUsage, parseTurnEnd } from './usage.mjs';

const sse = (...chunks) => chunks.map((c) => 'data: ' + JSON.stringify(c)).join('\n\n') + '\n\ndata: [DONE]\n\n';

test('OpenAI compatible streaming: usage is in the last chunk, cached in prompt_tokens_details', () => {
  const u = extractUsage(sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'canvas_get', arguments: '{}' } }] } }] },
    { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 900 } } }));
  expect(u).toMatchObject({ promptTokens: 1000, completionTokens: 20, cachedTokens: 900, missing: false, tools: ['canvas_get'] });
});

test('DeepSeek native fields prompt_cache_hit_tokens and choices[0].usage', () => {
  expect(extractUsage(sse({ choices: [{ delta: { content: 'good' }, usage: { prompt_tokens: 500, completion_tokens: 5, prompt_cache_hit_tokens: 400 } }] })))
    .toMatchObject({ promptTokens: 500, cachedTokens: 400, missing: false, replied: true });
});

test('Responses style input_tokens_details with non-streaming JSON', () => {
  const json = JSON.stringify({ choices: [{ message: { content: 'ok', tool_calls: [{ function: { name: 'plan_update', arguments: '{"a":1}' } }] } }],
    usage: { input_tokens: 70, output_tokens: 3, input_tokens_details: { cached_tokens: 64 } } });
  expect(extractUsage(json)).toMatchObject({ promptTokens: 70, completionTokens: 3, cachedTokens: 64, missing: false, tools: ['plan_update'] });
});

test('Useful amount but no cache field: cache is unknown and not equal to 0', () => {
  expect(extractUsage(sse({ choices: [], usage: { prompt_tokens: 80, completion_tokens: 2 } }))).toMatchObject({ promptTokens: 80, cachedTokens: 0, cacheKnown: false, missing: false });
  expect(extractUsage(sse({ choices: [], usage: { prompt_tokens: 80, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } } })).cacheKnown).toBe(true);
});

test('Explicit flag missing when no usage is present, rather than being passed silently as 0', () => {
  expect(extractUsage(sse({ choices: [{ delta: { content: 'good' } }] })).missing).toBe(true);
  expect(extractUsage('').missing).toBe(true);
});

test('Anthropic streaming: input of message_start merged with cache field of message_delta', () => {
  const u = extractUsage([
    'event: message_start',
    'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 900, output_tokens: 1 } } }),
    'event: message_delta',
    'data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { cache_read_input_tokens: 900, output_tokens: 30 } }),
    '',
  ].join('\n'));
  expect(u).toMatchObject({ promptTokens: 1920, completionTokens: 30, cachedTokens: 900, cacheKnown: true, cacheCreationTokens: 900, missing: false });
});

test('Anthropic streaming: message_start only has input_tokens, message_delta only has cache fields and is also calculated based on the total input', () => {
  const u = extractUsage([
    'event: message_start',
    'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 120, output_tokens: 1 } } }),
    'event: message_delta',
    'data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { cache_read_input_tokens: 900, cache_creation_input_tokens: 80, output_tokens: 30 } }),
    '',
  ].join('\n'));
  expect(u).toMatchObject({ promptTokens: 1100, completionTokens: 30, cachedTokens: 900, cacheCreationTokens: 80, cacheKnown: true, missing: false });
  expect(((u.cachedTokens / u.promptTokens) * 100).toFixed(1)).toBe('81.8');
});

test('The denominator of the Anthropic hit rate is the total input volume: misses + cache reads + cache creations', () => {
  const u = extractUsage('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 120, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 1 } } }) + '\n');
  expect(u).toMatchObject({ promptTokens: 1020, cachedTokens: 900, cacheCreationTokens: 0, cacheKnown: true });
  expect(((u.cachedTokens / u.promptTokens) * 100).toFixed(1)).toBe('88.2');
});

test('The turn result is based on turn_end: errors and cancellations in HTTP 200 can be recognized', () => {
  const line = (row) => JSON.stringify(row);
  expect(parseTurnEnd([line({ type: 'session' }), line({ type: 'turn_end', reply: 'Done', proposals: [1] })].join('\n'))).toMatchObject({ status: 'done', reply: 'Done', proposals: 1 });
  expect(parseTurnEnd(line({ type: 'turn_end', error: 'upstream 500', errorReason: 'model_failed' })).status).toBe('error:model_failed');
  expect(parseTurnEnd(line({ type: 'turn_end', cancelled: true })).status).toBe('cancelled');
  expect(parseTurnEnd(line({ type: 'session' })).status).toBe('no_turn_end');
});

// 三类外部 Agent 的统一口径：未缓存输入、缓存读、输出。
test('Unified usage: Claude adds cache creation, Codex minus cache reads, DSH directly uses uncached input', () => {
  expect(normalizeAgentUsage('claude', { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 7 }))
    .toEqual({ uncachedInput: 150, cacheRead: 900, output: 7, cacheKnown: true, incomplete: false });
  expect(normalizeAgentUsage('codex', { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 9 }))
    .toEqual({ uncachedInput: 200, cacheRead: 800, output: 9, cacheKnown: true, incomplete: false });
  expect(normalizeAgentUsage('dsh', { inputTokens: 129, cacheReadTokens: 9216, outputTokens: 2 }))
    .toEqual({ uncachedInput: 129, cacheRead: 9216, output: 2, cacheKnown: true, incomplete: false });
  expect(normalizeAgentUsage('dsh', { uncachedInput: 5, cacheRead: 6, cacheKnown: true, output: 7 }))
    .toEqual({ uncachedInput: 5, cacheRead: 6, output: 7, cacheKnown: true, incomplete: false });
  expect(normalizeAgentUsage('dsh', null).incomplete).toBe(true);
});

test('Empty usage objects and all undefined fields have incomplete usage calculations and cannot pass the budget as 0.', () => {
  for (const [kind, usage] of [
    ['dsh', {}],
    ['dsh', { inputTokens: undefined, cacheReadTokens: undefined }],
    ['claude', {}],
    ['codex', {}],
    ['codex', { input_tokens: undefined, output_tokens: undefined }],
  ]) {
    expect(normalizeAgentUsage(kind, usage).incomplete).toBe(true);
  }
  // 明确给了 0 仍然算「拿到了用量」。
  expect(normalizeAgentUsage('claude', { input_tokens: 0, output_tokens: 0 }).incomplete).toBe(false);
  expect(normalizeAgentUsage('dsh', { uncachedInput: 0, cacheRead: 0, output: 0 }).incomplete).toBe(false);
});

test('Null and empty strings are not counted as numeric token fields and cannot be budgeted as 0.', () => {
  expect(normalizeAgentUsage('claude', { input_tokens: null, output_tokens: null }).incomplete).toBe(true);
  expect(normalizeAgentUsage('dsh', { inputTokens: null, outputTokens: null }).incomplete).toBe(true);
  expect(normalizeAgentUsage('dsh', { uncachedInput: null, cacheRead: null, output: null }).incomplete).toBe(true);
  expect(normalizeAgentUsage('codex', { input_tokens: '', output_tokens: '' }).incomplete).toBe(true);
});

test('Numeric strings are counted by valid tokens, boolean and non-finite values are still excluded', () => {
  expect(normalizeAgentUsage('claude', { input_tokens: '10', output_tokens: '2' }))
    .toEqual({ uncachedInput: 10, cacheRead: 0, output: 2, cacheKnown: false, incomplete: false });
  expect(normalizeAgentUsage('dsh', { inputTokens: '10', outputTokens: '2' }))
    .toEqual({ uncachedInput: 10, cacheRead: 0, output: 2, cacheKnown: false, incomplete: false });
  expect(normalizeAgentUsage('codex', { input_tokens: '10', output_tokens: '2' }))
    .toEqual({ uncachedInput: 10, cacheRead: 0, output: 2, cacheKnown: false, incomplete: false });
  // 明确给 0 的数字字符串仍算拿到了用量。
  expect(normalizeAgentUsage('claude', { input_tokens: '0', output_tokens: '0' }).incomplete).toBe(false);
  for (const value of [true, false, Infinity, NaN, '', '  ']) {
    expect(normalizeAgentUsage('claude', { input_tokens: value, output_tokens: value }).incomplete).toBe(true);
  }
  // 流式解析路径同样接受数字字符串，不能把兼容网关的序列化计数当成缺失。
  expect(extractUsage(sse({ choices: [], usage: { prompt_tokens: '100', completion_tokens: '20' } })))
    .toMatchObject({ promptTokens: 100, completionTokens: 20, missing: false });
});

test('The cost is calculated based on uncached input, cached read, and output respectively. By default, the cache price follows the input price.', () => {
  const tokens = { uncachedInput: 1_000_000, cacheRead: 2_000_000, output: 1_000_000 };
  expect(costOfTokens(tokens, { input: 0.2, cache: 0.004, output: 0.8 })).toBeCloseTo(1.008, 6);
  expect(costOfTokens(tokens, { input: 0.2, output: 0.8 })).toBeCloseTo(1.4, 6);
});

test('Budget: If the upper limit is set but the price is missing or is 0, an error will be reported directly and the value will not be calculated as 0.', () => {
  expect(() => createCnyBudget({ budgetCny: 1, priceIn: 0, priceOut: 0.8 })).toThrow('budget_price_missing');
  expect(() => createCnyBudget({ budgetCny: 1, priceIn: 0.2, priceOut: 0 })).toThrow('budget_price_missing');
  expect(() => createCnyBudget({ budgetCny: 1, priceIn: 0.2, priceCache: 0, priceOut: 0.8 })).toThrow('budget_price_missing');
  expect(() => createCnyBudget({ budgetCny: 0, priceIn: 0.2, priceOut: 0.8 })).toThrow('--budget-cny');
});

test('Budget: reached is true after the accumulation reaches the upper limit; when there is no budget, there is no limit and the unit price is 0', () => {
  const budget = createCnyBudget({ budgetCny: 0.01, priceIn: 1, priceOut: 1 });
  expect(budget.enabled).toBe(true);
  expect(budget.cachePriceSource).toBe('price_in');
  expect(budget.reached()).toBe(false);
  budget.addCost({ uncachedInput: 5_000, cacheRead: 0, output: 0 });
  expect(budget.reached()).toBe(false);
  budget.addCost({ uncachedInput: 5_000, cacheRead: 0, output: 0 });
  expect(budget.reached()).toBe(true);
  expect(budget.spent).toBeCloseTo(0.01, 8);

  const none = createCnyBudget({ priceIn: 0, priceOut: 0 });
  expect(none.enabled).toBe(false);
  expect(none.reached()).toBe(false);
});
