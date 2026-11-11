import { describe, expect, test } from 'bun:test';
import {
  analyzeCapturedRequests,
  ratchetBudget,
  runRequestEfficiencyGate,
} from './request-efficiency-gate.mjs';

describe('Request Efficiency Gate', () => {
  test('S1–S11 fake model runs in full: 11 scenes are completely covered, the header system is unchanged byte by byte, the transient context at the end is valid, adjacent prefixes are 100% covered, and the volume does not exceed the upper limit', async () => {
    const report = await runRequestEfficiencyGate({ scenario: 'all' });
    expect(report.passed, report.violations.join('\n')).toBe(true);
    expect(report.sessions.map((s) => s.scenarioCode)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11']);
    expect(report.overallPrefixHitRatio).toBeGreaterThanOrEqual(0.95);
    expect(report.fullPrefixHitPairs).toBe(report.totalAdjacentPairs);
    for (const session of report.sessions) {
      expect(session.adjacentPairs).toBeGreaterThanOrEqual(1);
      expect(session.systemByteIdentical).toBe(true);
      expect(session.headerClean).toBe(true);
      expect(session.tailValid).toBe(true);
    }
  }, 45_000);

  test('Should fail when the expected scene is missing, the end transient context is missing, the header is mixed into a dynamic block or the order is reversed, the prefix is broken, or the character limit is exceeded', () => {
    const baseTools = [{ type: 'function', function: { name: 'canvas_get', parameters: {} } }];
    const badRequests = [
      {
        runIndex: 1,
        scenarioCode: 'S6',
        scenarioId: 'skill-across-turns',
        canvasId: 'c1',
        sessionId: 'durable:1',
        body: {
          tools: baseTools,
          messages: [
            {
              role: 'developer',
              content: '<beeftv_skill_catalog>\ncat\n</beeftv_skill_catalog>\n\n<instructions>\ninstr\n</instructions>\n\n<beeftv_studio>\nCanvas version 1\n</beeftv_studio>',
            },
            { role: 'user', content: 'turn 1' },
          ],
        },
      },
      {
        runIndex: 1,
        scenarioCode: 'S6',
        scenarioId: 'skill-across-turns',
        canvasId: 'c1',
        sessionId: 'durable:1',
        body: {
          tools: baseTools,
          messages: [
            {
              role: 'developer',
              content: '<beeftv_skill_catalog>\ncat\n</beeftv_skill_catalog>\n\n<instructions>\ninstr\n</instructions>\n\n<beeftv_studio>\nCanvas version 2\n</beeftv_studio>',
            },
            { role: 'user', content: 'turn 1' },
            { role: 'assistant', content: 'ok' },
          ],
        },
      },
    ];

    const report = analyzeCapturedRequests(
      badRequests,
      {
        minAdjacentPrefixCoverageRatio: 0.95,
        maxHeaderChars: 50,
        maxToolsChars: 50,
        maxHeaderPlusToolsChars: 100,
      },
      { expectedScenarios: ['S1', 'S6'] },
    );
    expect(report.passed).toBe(false);
    expect(report.overallPrefixHitRatio).toBe(0);
    expect(report.violations.some((v) => v.includes('The head system still contains dynamic blocks'))).toBe(true);
    expect(report.violations.some((v) => v.includes('Ranked under <instructions>'))).toBe(true);
    expect(report.violations.some((v) => v.includes('Missing non-system <beeftv_studio>'))).toBe(true);
    expect(report.violations.some((v) => v.includes('The header system text changes within the session'))).toBe(true);
    expect(report.violations.some((v) => v.includes('Missing expected evaluation scenario request record: S1'))).toBe(true);
    expect(report.violations.some((v) => v.includes('Exceed the upper limit'))).toBe(true);
  });

  test('ratchetBudget (--update) only allows tightening the character limit and never increases the existing limit.', () => {
    const existing = {
      minAdjacentPrefixCoverageRatio: 0.95,
      maxHeaderChars: 7377,
      maxToolsChars: 31398,
      maxHeaderPlusToolsChars: 38775,
    };
    const regressed = ratchetBudget(existing, {
      maxHeaderChars: 8000,
      maxToolsChars: 32000,
      maxHeaderPlusToolsChars: 40000,
    });
    expect(regressed).toEqual(existing);

    const improved = ratchetBudget(existing, {
      maxHeaderChars: 7359,
      maxToolsChars: 31398,
      maxHeaderPlusToolsChars: 38757,
    });
    expect(improved).toEqual({
      minAdjacentPrefixCoverageRatio: 0.95,
      maxHeaderChars: 7359,
      maxToolsChars: 31398,
      maxHeaderPlusToolsChars: 38757,
    });
  });
});
