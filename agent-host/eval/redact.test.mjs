import { test, expect } from 'bun:test';
import { redactSecrets } from './redact.mjs';

test('Upstream key is replaced', () => {
  const text = redactSecrets('authorization=secret-value-123456', 'secret-value-123456');
  expect(text).not.toContain('secret-value-123456');
  expect(text).toContain('[REDACTED]');
});

test('Bearer and sk- forms are replaced', () => {
  const text = redactSecrets('Authorization: Bearer abc.def-123_456 and sk-live-abcdefghijklmnop');
  expect(text).toContain('Bearer [REDACTED]');
  expect(text).not.toContain('abc.def-123_456');
  expect(text).toContain('sk-[REDACTED]');
  expect(text).not.toContain('sk-live-abcdefghijklmnop');
});

test('JSON apiKey field is replaced', () => {
  const text = redactSecrets(JSON.stringify({ apiKey: 'plain-key', other: 'keep' }));
  expect(text).not.toContain('plain-key');
  expect(text).toContain('[REDACTED]');
  expect(text).toContain('keep');
});
