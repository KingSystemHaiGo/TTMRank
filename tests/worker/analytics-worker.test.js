import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../../cloudflare/analytics-worker.js';

test('worker integer validation and origins are strict', () => {
  assert.equal(__test.validInteger('42'),42); assert.equal(__test.validInteger('4.2'),null);
  assert.equal(__test.allowedOrigins({ALLOWED_ORIGINS:'https://a.example, https://b.example'}).has('https://b.example'),true);
});
