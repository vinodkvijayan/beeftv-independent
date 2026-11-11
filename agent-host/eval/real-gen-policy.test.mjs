import { test, expect } from 'bun:test';
import { canConfirmRound, roundStopReason } from './real-gen-policy.mjs';

test('Normal rounds can be confirmed and continued', () => {
  const round = { status: 'done', error: '', tasks: [{ status: 'succeeded' }] };
  expect(canConfirmRound(round)).toBe(true);
  expect(roundStopReason(round)).toBe('');
});

test('Round failure or timeout will no longer be confirmed', () => {
  for (const round of [{ status: 'failed', error: 'boom' }, { status: 'timeout', error: 'slow' }, { status: 'done', error: 'x' }]) {
    expect(canConfirmRound(round)).toBe(false);
    expect(roundStopReason(round)).toStartWith('turn_');
  }
});

test('Stop subsequent rounds after task failure or cancellation', () => {
  expect(roundStopReason({ status: 'done', error: '', tasks: [{ status: 'failed' }] })).toBe('task_failed');
  expect(roundStopReason({ status: 'done', error: '', tasks: [{ status: 'cancelled' }] })).toBe('task_cancelled');
});

test('All three rounds are restored normally, but if there is a shortage of products, a gap will be listed and the result will be considered a failure.', async () => {
  const { completenessGaps } = await import('./real-gen-policy.mjs');
  expect(completenessGaps([], [])).toEqual([
    'image successful mission 0/2', 'image Downloaded product 0/2', 'video successful mission 0/2', 'video Downloaded product 0/2', 'render successful task 0/1', 'render Downloaded product 0/1',
  ]);
  const tasks = [
    { type: 'canvas_image', status: 'succeeded' }, { type: 'canvas_image', status: 'succeeded' },
    { type: 'canvas_video', status: 'succeeded' }, { type: 'canvas_video', status: 'failed' },
    { type: 'timeline_render', status: 'succeeded' },
  ];
  const artifacts = [
    { kind: 'image', bytes: 10 }, { kind: 'image', bytes: 10 }, { kind: 'video', bytes: 10 }, { kind: 'render', bytes: 0 },
  ];
  expect(completenessGaps(tasks, artifacts)).toEqual(['video successful mission 1/2', 'video Downloaded product 1/2', 'render Downloaded product 0/1']);
  const ok = [...tasks.slice(0, 3), { type: 'canvas_video', status: 'succeeded' }, tasks[4]];
  const saved = [...artifacts.slice(0, 3), { kind: 'video', bytes: 5 }, { kind: 'render', bytes: 5 }];
  expect(completenessGaps(ok, saved)).toEqual([]);
});
