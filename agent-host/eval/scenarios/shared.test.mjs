import { describe, expect, test } from 'bun:test';
import { parseSimCapabilities, applySimCapabilities, waitForCanvasTasks } from './shared.mjs';

describe('Analog capability switch', () => {
  test('The default is all off and only recognizes known abilities.', () => {
    expect(parseSimCapabilities('')).toEqual([]);
    expect(parseSimCapabilities(' task.wait ,task.wait')).toEqual(['task.wait']);
    expect(() => parseSimCapabilities('task.wait,canvas.summary')).toThrow('Unknown simulation capabilities');
  });

  test('Turn on task.wait before calling the switch of the simulated backend', () => {
    let enabled = 0;
    const simGo = { enableTaskWait: () => { enabled += 1; } };
    applySimCapabilities(simGo, []);
    expect(enabled).toBe(0);
    applySimCapabilities(simGo, ['task.wait']);
    expect(enabled).toBe(1);
  });
});

describe('Tasks before the turn', () => {
  test('Return after the task is over and do not change anything for the Agent.', async () => {
    const tasks = [{ canvasId: 'c1', status: 'running' }, { canvasId: 'c2', status: 'running' }];
    setTimeout(() => { tasks[0].status = 'succeeded'; }, 30);
    const simGo = { snapshot: () => ({ tasks: tasks.map((t) => ({ ...t })) }) };
    const result = await waitForCanvasTasks(simGo, 'c1', 2000, 5);
    expect(result).toEqual({ settled: true, running: 0 });
    expect(tasks[1].status).toBe('running');
  });

  test('After timeout, the number still running will be returned truthfully.', async () => {
    const simGo = { snapshot: () => ({ tasks: [{ canvasId: 'c1', status: 'running' }] }) };
    const result = await waitForCanvasTasks(simGo, 'c1', 20, 5);
    expect(result).toEqual({ settled: false, running: 1 });
  });
});
