import test from 'node:test';
import assert from 'node:assert/strict';
import { iconProxyUrl } from '../../app/js/core/game-icon.js';

test('icon proxy URL is opt-in and encoded', () => {
  assert.equal(iconProxyUrl('https://img-tc.tapimg.com/a.png', ''), '');
  assert.equal(iconProxyUrl('https://img-tc.tapimg.com/a.png', 'https://proxy.example'), 'https://proxy.example/v1/icon?url=https%3A%2F%2Fimg-tc.tapimg.com%2Fa.png');
});
