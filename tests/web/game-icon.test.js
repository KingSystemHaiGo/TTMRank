import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameIcon, iconProxyUrl } from '../../app/js/core/game-icon.js';

test('icon proxy URL is opt-in and encoded', () => {
  assert.equal(iconProxyUrl('https://img-tc.tapimg.com/a.png', ''), '');
  assert.equal(iconProxyUrl('https://img-tc.tapimg.com/a.png', 'https://proxy.example'), 'https://proxy.example/v1/icon?url=https%3A%2F%2Fimg-tc.tapimg.com%2Fa.png');
});

test('missing icon sources render a text fallback without creating an image request', () => {
  const nativeDocument = globalThis.document;
  const created = [];
  globalThis.document = {
    createElement(tag) {
      const node = {
        tag,
        children: [],
        style: {},
        setAttribute() {},
        addEventListener() {},
        append(...children) { this.children.push(...children); },
        remove() {},
        replaceWith() {},
      };
      created.push(node);
      return node;
    },
  };
  try {
    const fallback = createGameIcon({ title: 'No icon' });
    assert.equal(fallback.children.length, 0);
    assert.equal(created.filter(node => node.tag === 'img').length, 0);
  } finally {
    globalThis.document = nativeDocument;
  }
});
