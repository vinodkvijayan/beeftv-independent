import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildOverlayPatch,
  credentialEnvNames,
  dshToolCount,
  parseDefaultModel,
  parseDshEvents,
  parseModelOverride,
  parseSessionUsageLog,
  prepareCredentialAccess,
  prepareDshAgent,
  readSessionUsageLog,
} from './dsh-driver.mjs';
import { normalizeAgentUsage, costOfTokens } from './usage.mjs';

const ndjson = (...events) => events.map((event) => JSON.stringify(event)).join('\n') + '\n';

describe('dsh headless event stream analysis', () => {
  test('Get the final reply, reason, number of tool calls and step-by-step usage', () => {
    const parsed = parseDshEvents(ndjson(
      { type: 'session', sessionId: 'session-1', cwd: '/w' },
      { type: 'status', phase: 'step_start', turn: 1, step: 1 },
      { type: 'tool_call', callId: 'c1', tool: 'skill', input: { name: 'beeftv-canvas' } },
      { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 100, cacheReadTokens: 900, outputTokens: 10 } },
      { type: 'status', phase: 'step_end', turn: 1, step: 2, usage: { inputTokens: 20, cacheReadTokens: 80, outputTokens: 5 } },
      { type: 'status', phase: 'turn_end', turn: 1, reason: { kind: 'completed' } },
      { type: 'final', sessionId: 'session-1', reason: { kind: 'completed' }, text: 'Done' },
    ));
    expect(parsed).toMatchObject({
      sessionId: 'session-1', reply: 'Done', reasonKind: 'completed', toolCalls: 1, numTurns: 2,
      usage: { uncachedInput: 120, cacheRead: 980, output: 15, cacheKnown: true },
      usageIncomplete: false,
    });
  });

  test('If the usage is missing, the retry step will first use the session log to fill it in. If it cannot be filled in, the usage will be marked as incomplete.', () => {
    const stdout = ndjson(
      { type: 'session', sessionId: 's2' },
      { type: 'status', phase: 'step_end', turn: 1, step: 1 },
      { type: 'status', phase: 'step_end', turn: 1, step: 2, usage: { inputTokens: 5, outputTokens: 1 } },
      { type: 'status', phase: 'step_end', turn: 1, step: 3, usage: {} },
      { type: 'final', sessionId: 's2', reason: { kind: 'completed' }, text: 'ok' },
    );
    const fallback = new Map([
      ['1:1', { inputTokens: 10, cacheReadTokens: 40, outputTokens: 2 }],
      ['1:3', { inputTokens: 3, cacheReadTokens: 7, outputTokens: 1 }],
    ]);
    const filled = parseDshEvents(stdout, { fallbackUsages: fallback });
    // 空 usage 对象也会尝试用会话日志补；补到后这一步就是完整的。
    expect(filled.usageIncomplete).toBe(false);
    expect(filled.usage).toMatchObject({ uncachedInput: 18, cacheRead: 47, output: 4 });
    expect(filled.steps[0]).toMatchObject({ usageSource: 'session_log' });
    expect(filled.steps[2]).toMatchObject({ usageSource: 'session_log' });

    const missing = parseDshEvents(stdout);
    expect(missing.usageIncomplete).toBe(true);
    expect(missing.usage).toMatchObject({ uncachedInput: 5, cacheRead: 0, output: 1 });
  });

  test('When step_end only provides some undefined fields, session log completion is also used.', () => {
    const stdout = ndjson(
      { type: 'session', sessionId: 's2b' },
      { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: undefined, cacheReadTokens: undefined } },
      { type: 'status', phase: 'step_end', turn: 1, step: 2, usage: { inputTokens: 5, outputTokens: 1 } },
      { type: 'final', sessionId: 's2b', reason: { kind: 'completed' }, text: 'ok' },
    );
    const filled = parseDshEvents(stdout, {
      fallbackUsages: new Map([['1:1', { inputTokens: 10, cacheReadTokens: 40, outputTokens: 2 }]]),
    });
    expect(filled.usageIncomplete).toBe(false);
    expect(filled.steps[0].usageSource).toBe('session_log');
    expect(filled.usage).toMatchObject({ uncachedInput: 15, cacheRead: 40, output: 3 });
  });

  test('When step_end only takes cacheReadTokens or only outputTokens, the session log is also used for completion.', () => {
    const stdout = ndjson(
      { type: 'session', sessionId: 's2d' },
      { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { cacheReadTokens: 100 } },
      { type: 'status', phase: 'step_end', turn: 1, step: 2, usage: { outputTokens: 7 } },
      { type: 'final', sessionId: 's2d', reason: { kind: 'completed' }, text: 'ok' },
    );
    const filled = parseDshEvents(stdout, {
      fallbackUsages: new Map([
        ['1:1', { inputTokens: 10, cacheReadTokens: 40, outputTokens: 2 }],
        ['1:2', { inputTokens: 5, cacheReadTokens: 0, outputTokens: 3 }],
      ]),
    });
    expect(filled.usageIncomplete).toBe(false);
    expect(filled.steps[0].usageSource).toBe('session_log');
    expect(filled.steps[1].usageSource).toBe('session_log');
    expect(filled.usage).toMatchObject({ uncachedInput: 15, cacheRead: 40, output: 5 });
  });

  test('There are only cached reads or only output and the session log cannot be filled in and the time stamp usage is incomplete.', () => {
    const parsed = parseDshEvents(ndjson(
      { type: 'session', sessionId: 's2e' },
      { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { cacheReadTokens: 100 } },
      { type: 'status', phase: 'step_end', turn: 1, step: 2, usage: { outputTokens: 7 } },
      { type: 'final', sessionId: 's2e', reason: { kind: 'completed' }, text: 'ok' },
    ));
    expect(parsed.usageIncomplete).toBe(true);
    // 缺输入或输出的步骤不按已知字段的部分值入账，避免把整步账单算成一半。
    expect(parsed.usage).toMatchObject({ uncachedInput: 0, cacheRead: 0, output: 0 });
  });

  test('Error/timeout rounds without final are also marked as incomplete, and the session id is retained for completion.', () => {
    const errored = parseDshEvents(ndjson(
      { type: 'session', sessionId: 's2f' },
      { type: 'error', message: 'turn_timeout' },
    ));
    expect(errored).toMatchObject({ final: null, errorEvent: 'turn_timeout', sessionId: 's2f', usageIncomplete: true });
    // 只有 step_end 没有 final（进程被杀）时，步骤完整就不用标不完整。
    const interrupted = parseDshEvents(ndjson(
      { type: 'session', sessionId: 's2g' },
      { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 9, outputTokens: 2 } },
    ));
    expect(interrupted).toMatchObject({ final: null, usageIncomplete: false, usage: { uncachedInput: 9, output: 2 } });
  });

  test('Ended normally but without any step_end time scale usage is incomplete and cannot pass budget by 0', () => {
    const parsed = parseDshEvents(ndjson(
      { type: 'session', sessionId: 's2c' },
      { type: 'final', sessionId: 's2c', reason: { kind: 'completed' }, text: 'ok' },
    ));
    expect(parsed).toMatchObject({ usageIncomplete: true, usage: { uncachedInput: 0, cacheRead: 0, output: 0 } });
  });

  test('The failure reason comes from the error event or final.reason, instead of just looking at the exit code', () => {
    expect(parseDshEvents(ndjson({ type: 'error', message: 'unknown option' })))
      .toMatchObject({ errorEvent: 'unknown option', final: null, reply: '' });
    expect(parseDshEvents(ndjson({ type: 'session', sessionId: 's3' }, { type: 'status', phase: 'turn_end', turn: 1, reason: { kind: 'aborted' } },
      { type: 'final', sessionId: 's3', reason: { kind: 'aborted' }, text: 'stop' })))
      .toMatchObject({ reasonKind: 'aborted', reply: 'stop' });
  });

  test('The analysis results can be directly converted into expenses and will not be reset to zero twice.', () => {
    const parsed = parseDshEvents(ndjson(
      { type: 'session', sessionId: 's1' },
      { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 8435, cacheReadTokens: 55936, outputTokens: 2546 } },
      { type: 'final', sessionId: 's1', reason: { kind: 'completed' }, text: 'ok' },
    ));
    expect(normalizeAgentUsage('dsh', parsed.usage)).toMatchObject(parsed.usage);
    expect(costOfTokens(parsed.usage, { input: 0.2, cache: 0.004, output: 0.8 })).toBeCloseTo(0.003948, 6);
  });

  test('Read back the real number of tools from stderr of beeftv mcp serve', () => {
    expect(dshToolCount('beeftv mcp serve: 40 tools, base=http://127.0.0.1:1（BEEFTV_BASE_URL）')).toBe(40);
    expect(dshToolCount('')).toBe(0);
  });
});

describe('dsh session log usage', () => {
  const line = (event) => JSON.stringify(event);

  test('The retry step adds the usage of assistant/message and all assistant/attempts; a successful message is counted as 0 when the usage is missing.', () => {
    const usages = parseSessionUsageLog([
      line({ type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 10, cacheReadTokens: 90, outputTokens: 4 } } }),
      line({ type: 'assistant/message', data: { turn: 1, step: 2, stream: [] } }),
      line({ type: 'assistant/attempt', data: { turn: 1, step: 2, stream: [{ usage: { inputTokens: 7, cacheReadTokens: 3, outputTokens: 1 } }] } }),
      line({ type: 'assistant/attempt', data: { turn: 1, step: 2, stream: [{ usage: { inputTokens: 5, cacheReadTokens: 2, outputTokens: 2 } }] } }),
      // 消息只带成功 attempt 的用量，失败 attempt 的账单在 attempt 流里，两者要相加。
      line({ type: 'assistant/message', data: { turn: 1, step: 4, usage: { inputTokens: 20, cacheReadTokens: 100, outputTokens: 8 } } }),
      line({ type: 'assistant/attempt', data: { turn: 1, step: 4, stream: [{ usage: { inputTokens: 3, cacheReadTokens: 1, outputTokens: 1 } }] } }),
      line({ type: 'assistant/attempt', data: { turn: 1, step: 4, stream: [{ usage: { inputTokens: 2, cacheReadTokens: 4, outputTokens: 2 } }] } }),
      // 成功 message 已有用量时，没拿到用量的失败 attempt 按 0 计，不能丢掉整步。
      line({ type: 'assistant/message', data: { turn: 1, step: 5, usage: { inputTokens: 9, cacheReadTokens: 9, outputTokens: 9 } } }),
      line({ type: 'assistant/attempt', data: { turn: 1, step: 5, stream: [] } }),
      // 既没有 message 用量，attempt 又缺用量：整步费用不可知，不输出。
      line({ type: 'assistant/attempt', data: { turn: 1, step: 6, stream: [] } }),
      // 空 usage 对象不算成功用量，不能把整步补成 0。
      line({ type: 'assistant/message', data: { turn: 1, step: 7, usage: {} } }),
    ].join('\n'));
    expect(usages.get('1:1')).toMatchObject({ inputTokens: 10, cacheReadTokens: 90, outputTokens: 4 });
    expect(usages.get('1:2')).toMatchObject({ inputTokens: 12, cacheReadTokens: 5, outputTokens: 3 });
    expect(usages.get('1:4')).toMatchObject({ inputTokens: 25, cacheReadTokens: 105, outputTokens: 11 });
    expect(usages.get('1:5')).toMatchObject({ inputTokens: 9, cacheReadTokens: 9, outputTokens: 9 });
    expect(usages.has('1:6')).toBe(false);
    expect(usages.has('1:7')).toBe(false);
  });

  test('Returns ok:false when there is no session log or no zstd, no guess 0', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-usage-test-'));
    try {
      expect(readSessionUsageLog(home, 'session-x')).toMatchObject({ ok: false, reason: 'no_sessions_dir' });
      fs.mkdirSync(path.join(home, 'sessions', '--w--', 'session-x'), { recursive: true });
      expect(readSessionUsageLog(home, 'session-x')).toMatchObject({ ok: false, reason: 'no_session_log' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('dsh isolation configuration', () => {
  test('Overlay hangs BeefTV MCP, turns off redundant tools, and tool times out for 120 seconds.', () => {
    const yaml = buildOverlayPatch({
      cli: '/tmp/beeftv', baseUrl: 'http://127.0.0.1:1234/api', ownerToken: 'tok',
      sourceModel: { provider: 'provider-a', model: 'm1', reasoningEffort: 'high' },
    });
    expect(yaml).toContain("name: '@deepseek-ai/dsh-mcp-client'");
    expect(yaml).toContain('toolCallTimeoutMs: 120000');
    expect(yaml).toContain('BEEFTV_BASE_URL: "http://127.0.0.1:1234/api"');
    expect(yaml).toContain('BEEFTV_OWNER_TOKEN: "tok"');
    expect(yaml).toContain('- id: tool-bash\n  disabled: true');
    expect(yaml).not.toContain('- id: tool-skill\n  disabled: true');
  });

  test('Override the default model when specifying a model; explicitly report an error when the provider is missing', () => {
    const yaml = buildOverlayPatch({
      cli: 'beeftv', baseUrl: 'http://x', ownerToken: 't',
      modelOverride: { provider: 'provider-b', model: 'model-b' },
    });
    expect(yaml).toContain('provider: "provider-b"');
    expect(yaml).toContain('model: "model-b"');
    expect(yaml).toContain('reasoningEffort');
    expect(() => buildOverlayPatch({ cli: 'beeftv', baseUrl: 'u', ownerToken: 't', modelOverride: { provider: '', model: 'm' } })).toThrow('provider/model');
  });

  test('Read the default model, key environment variable name and model override format from the source profile', () => {
    const patch = [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      provider-a:',
      '        apiKeyEnv: PROVIDER_A_API_KEY',
      '- id: agent-default-model',
      '  config:',
      '    provider: provider-a',
      '    model: model-a',
      '    reasoningEffort: high',
    ].join('\n');
    expect(parseDefaultModel(patch)).toEqual({ provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' });
    expect(credentialEnvNames(patch)).toEqual(['PROVIDER_A_API_KEY']);
    expect(parseModelOverride('provider-a/model-a')).toEqual({ provider: 'provider-a', model: 'model-a' });
    expect(parseModelOverride('model-only')).toEqual({ provider: '', model: 'model-only' });
    expect(parseModelOverride('')).toBeNull();
  });

  test('Environment variables are used first for credentials; when variables are missing, a 0600 temporary copy is copied, and the source file is not soft-linked.', () => {
    const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cred-source-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cred-home-'));
    const patch = 'providers:\n  provider-a:\n    apiKeyEnv: PROVIDER_A_API_KEY\n';
    const sourceFile = path.join(sourceHome, '.credentials.yaml');
    fs.writeFileSync(sourceFile, 'token: secret\n');
    try {
      process.env.PROVIDER_A_API_KEY = 'from-env';
      const envAccess = prepareCredentialAccess({ sourceHome, home, env: {}, sourcePatch: patch });
      expect(envAccess).toMatchObject({ mode: 'env', envProvided: 1 });
      expect(fs.existsSync(path.join(home, '.credentials.yaml'))).toBe(false);

      // 源配置没有声明任何 apiKeyEnv 时，不把整份凭据带进临时 home。
      const noDeclared = prepareCredentialAccess({ sourceHome, home, env: {}, sourcePatch: 'providers:\n  provider-a:\n    model: m1\n' });
      expect(noDeclared).toMatchObject({ mode: 'env', envNames: 0 });
      expect(fs.existsSync(path.join(home, '.credentials.yaml'))).toBe(false);

      delete process.env.PROVIDER_A_API_KEY;
      const copyAccess = prepareCredentialAccess({ sourceHome, home, env: {}, sourcePatch: patch });
      expect(copyAccess).toMatchObject({ mode: 'temp_copy_0600', envProvided: 0 });
      const target = path.join(home, '.credentials.yaml');
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(sourceFile, 'utf8')).toBe('token: secret\n');
    } finally {
      delete process.env.PROVIDER_A_API_KEY;
      fs.rmSync(sourceHome, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('When the DSH preparation phase fails, the temporary home is deleted without leaving a copy of the token and credentials.', () => {
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('beeftv-eval-dsh-')));
    expect(() => prepareDshAgent({
      workDir: os.tmpdir(),
      baseUrl: 'http://127.0.0.1:1/api',
      ownerToken: 'tmp-token',
      cli: 'beeftv',
      bin: path.join(os.tmpdir(), 'missing-dsh-binary-for-test'),
      sourceHome: path.join(os.tmpdir(), 'missing-dsh-source-for-test'),
    })).toThrow('dsh_profile_init_failed');
    const leaked = fs.readdirSync(os.tmpdir())
      .filter((name) => name.startsWith('beeftv-eval-dsh-') && !before.has(name));
    expect(leaked).toEqual([]);
  });
});
