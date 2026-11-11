import { describe, expect, test } from 'bun:test';
import { PLAN_MAX_ITEMS, applyPlanUpdate, emptyPlan, planContinuation, publicPlan, renderPlanSection } from './plan.mjs';
import { fitRestoredSkills, restoredSkillMessage, skillBlockVisible } from './active-skills.mjs';

const item = (id, status, title = `steps${id}`) => ({ id, title, status });

describe('plan', () => {
  test('Overall replacement steps, retention goal, and verification status', () => {
    const first = applyPlanUpdate(emptyPlan(), { goal: 'Do a 2 shot skit', items: [item('s1', 'doing'), item('s2', 'todo')] }, 't1');
    expect(first.goal).toBe('Do a 2 shot skit');
    const second = applyPlanUpdate(first, { items: [item('s1', 'done'), item('s2', 'doing')] }, 't2');
    expect(second.goal).toBe('Do a 2 shot skit');
    expect(second.items.map((x) => x.status)).toEqual(['done', 'doing']);
    expect(second.updatedAt).toBe('t2');
  });
  test('Illegal input is rejected with a machine-readable reason', () => {
    expect(() => applyPlanUpdate(emptyPlan(), { items: [item('s1', 'oops')] })).toThrow('invalid_plan');
    expect(() => applyPlanUpdate(emptyPlan(), { items: [item('s1', 'todo'), item('s1', 'todo')] })).toThrow('Duplicate step number');
    expect(() => applyPlanUpdate(emptyPlan(), { items: [item('a', 'doing'), item('b', 'doing')] })).toThrow('There can only be one step');
    expect(() => applyPlanUpdate(emptyPlan(), { items: Array.from({ length: PLAN_MAX_ITEMS + 1 }, (_, i) => item(`s${i}`, 'todo')) })).toThrow('most');
    expect(() => applyPlanUpdate(emptyPlan(), 'x')).toThrow('invalid_plan');
  });
  test('Render plan paragraphs; empty plans do not generate paragraphs', () => {
    expect(renderPlanSection(emptyPlan())).toBeUndefined();
    expect(renderPlanSection(applyPlanUpdate(emptyPlan(), { items: [] }, 't1'))).toContain('All steps completed');
    const text = renderPlanSection(applyPlanUpdate(emptyPlan(), { goal: 'G', items: [item('s1', 'done'), item('s2', 'needs_user', 'First frame confirmation')] }));
    expect(text).toContain('Target:G');
    expect(text).toContain('1. [Complete] Step s1');
    expect(text).toContain('2. [Waiting for your confirmation] First frame confirmation');
    expect(text).toContain('Steps that are not actually completed cannot be marked done.');
  });
  test('Continue: continue when there is something to be done and no user is needed; stop when the user/stuck/finishes/exceeds the number of times', () => {
    const plan = (...items) => applyPlanUpdate(emptyPlan(), { items });
    expect(planContinuation(plan(item('a', 'done'), item('b', 'todo', 'Storyboard')))).toContain('Storyboard');
    expect(planContinuation(plan(item('a', 'doing', 'Character setting'), item('b', 'todo')))).toContain('Character setting');
    expect(planContinuation(plan(item('a', 'needs_user'), item('b', 'todo')))).toBeUndefined();
    expect(planContinuation(plan(item('a', 'blocked'), item('b', 'todo')))).toBeUndefined();
    expect(planContinuation(plan(item('a', 'done')))).toBeUndefined();
    expect(planContinuation(plan(item('a', 'todo')), { continuations: 6 })).toBeUndefined();
    expect(planContinuation(emptyPlan())).toBeUndefined();
  });
  test('Add completion progress to the projection of the interface', () => {
    expect(publicPlan(emptyPlan())).toBeNull();
    const view = publicPlan(applyPlanUpdate(emptyPlan(), { items: [item('a', 'done'), item('b', 'todo')] }, 't'));
    expect(view).toMatchObject({ done: 1, total: 2 });
  });
});

const rec = (skillId, extra = {}) => ({ skillId, versionId: `v-${skillId}`, contentHash: skillId.padEnd(64, '0'), ...extra });
const userMessage = (text) => ({ role: 'user', content: [{ type: 'text', text }] });

describe('active skills', () => {
  test('As long as the text is still in the message, it is considered visible.', () => {
    const a = rec('a');
    const block = `<skill name="n" versionId="${a.versionId}" contentHash="${a.contentHash}">…</skill>`;
    expect(skillBlockVisible([userMessage(block)], a)).toBe(true);
    expect(skillBlockVisible([userMessage('Compressed summary: Target…')], a)).toBe(false);
  });
  test('The supplementary message uses the official skill block format and explains the reason.', () => {
    const resource = { pin: { skillId: 'a', versionId: 'v-a', contentHash: 'a'.padEnd(64, '0') }, name: 'skit', version: '2', description: '', files: [], unsupportedCapabilities: [], instruction: 'The first step...' };
    const message = restoredSkillMessage([resource], 1);
    expect(message.role).toBe('user');
    expect(message.content[0].text).toContain('Conversations are compressed');
    expect(message.content[0].text).toContain('versionId="v-a"');
    expect(message.content[0].text).toContain('The first step...');
  });
  test('Total size guardrail: exceed window 1/5 and only keep the most recent one', () => {
    const resource = (id, size) => ({ pin: { skillId: id }, instruction: 'x'.repeat(size) });
    expect(fitRestoredSkills([resource('a', 600), resource('b', 600)], 4000).map((r) => r.pin.skillId)).toEqual(['b']);
    expect(fitRestoredSkills([resource('a', 100), resource('b', 100)], 4000).map((r) => r.pin.skillId)).toEqual(['a', 'b']);
  });
});
