import fs from 'node:fs';
import { expect, test } from 'bun:test';
import { SYSTEM_PROMPT } from './system-prompt.mjs';

test('media policy chooses minimum evidence and never presents frames as watched or heard media', () => {
  for (const instruction of ['minimum necessary', 'mode=frames', 'mode=video', 'mode=audio', 'static screenshot', 'It cannot be claimed based on this', '15 seconds', 'segmentation', 'actual read interval']) {
    expect(SYSTEM_PROMPT).toContain(instruction);
  }
  expect(SYSTEM_PROMPT).toContain('No need to read native video or audio');
  expect(SYSTEM_PROMPT).toContain('The user explicitly requested to watch the video and listen to the audio');
  expect(SYSTEM_PROMPT).toContain('evidence:{startMs,endMs,modes,checks:true}');
  expect(SYSTEM_PROMPT).toContain('single media.overview evidence');
  expect(SYSTEM_PROMPT).toContain('Media inspection does not prove that the ZIP was generated');
});

test('skills preserve ordered work without imposing a confirmation after every step', () => {
  for (const instruction of ['After that, each round is executed in the order of its steps.', 'Continuously advance steps without confirmation', 'The user explicitly requests step-by-step confirmation', 'Paid proposals require confirmation', 'Catalog of currently provided tools and models', 'Quantity, frame, category', 'First use skill_load to read', 'Steps that are not done cannot be said to be completed.']) {
    expect(SYSTEM_PROMPT).toContain(instruction);
  }
  expect(SYSTEM_PROMPT).toContain('Don’t expand a single picture or video into a whole set of processes just because the subject matter is the same.');
});

test('storyboard image and video nodes are bound back to their rows with the row prompts', () => {
  for (const instruction of ['imageNodeId', 'videoNodeId', 'imageGenerationPrompt', 'videoMotionPrompt']) {
    expect(SYSTEM_PROMPT).toContain(instruction);
  }
});

test('producer workflow respects studio changes, maintains plan_update, and inspects generated media', () => {
  for (const instruction of ['Create a live summary', 'Don\'t overwrite user changes with old drafts', 'plan_update', 'needs_user', 'Check whether the product meets the storyboard requirements', 'Only re-propose failed or missing nodes']) {
    expect(SYSTEM_PROMPT).toContain(instruction);
  }
  expect(SYSTEM_PROMPT).toContain('A successful proposal will end the round and wait for user confirmation');
  expect(SYSTEM_PROMPT).toContain('issued in the same response');
  expect(SYSTEM_PROMPT).toContain('Don’t leave it until after the proposal, either.');
});

test('optional short-film storyboard and cross-shot method lives in the versioned builtin skill instead of resident prompt', () => {
  expect(SYSTEM_PROMPT.length).toBeLessThanOrEqual(2500);
  expect(SYSTEM_PROMPT).not.toContain('For the short film storyboard, only fill in the required fields for this time');
  expect(SYSTEM_PROMPT).not.toContain('When the same product, character or scene needs to be consistent across cameras');
  expect(SYSTEM_PROMPT).not.toContain('H3 series');
  expect(SYSTEM_PROMPT).not.toContain('prepareMedia');
  expect(SYSTEM_PROMPT).not.toContain('syncBoundNodes');
  expect(SYSTEM_PROMPT).toContain('Omit image/video');
  expect(SYSTEM_PROMPT).toContain('Do not fabricate approvals, and do not promise that fees have been deducted or drawings have been produced.');
  const skills = JSON.parse(fs.readFileSync(new URL('../backend/internal/skills/seed/skills.json', import.meta.url), 'utf8'));
  const producerSkill = skills.find((item) => item.skill_id === '14811816970252');
  expect(producerSkill?.instruction).toContain('For the short film storyboard, only fill in the required fields for this time');
  expect(producerSkill?.instruction).toContain('When the same product, character or scene needs to be consistent across cameras');
  expect(producerSkill?.instruction).toContain('H3 series');
  expect(producerSkill?.instruction).toContain('This rule does not apply to multi-material reference mode');
  expect(producerSkill?.instruction).toContain('Does not claim to complete mode switching not provided by the tool');
});
