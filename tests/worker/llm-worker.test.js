import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../../cloudflare-worker.js';

test('LLM worker rejects untrusted origins and oversized bodies', () => {
  const env = { ALLOWED_ORIGINS: 'https://kingsystemhaigo.github.io', MAX_BODY_BYTES: '1000' };
  assert.equal(__test.isOriginAllowed('https://kingsystemhaigo.github.io', env), true);
  assert.equal(__test.isOriginAllowed('https://evil.example', env), false);
  assert.equal(__test.bodyLimit(env), 1000);
});

test('LLM worker only permits configured models and token ceilings', () => {
  const env = { LLM_MODELS: 'deepseek-chat,deepseek-reasoner', MAX_TOKENS: '2048' };
  assert.equal(__test.validatePayload({ model: 'deepseek-chat', messages: [], max_tokens: 2048 }, env).ok, true);
  assert.equal(__test.validatePayload({ model: 'unknown', messages: [], max_tokens: 20 }, env).ok, false);
  assert.equal(__test.validatePayload({ model: 'deepseek-chat', messages: [], max_tokens: 9999 }, env).ok, false);
});
