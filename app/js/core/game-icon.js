import { element } from './safe-dom.js';

export function iconProxyUrl(sourceUrl, endpoint = '') {
  return endpoint ? `${endpoint.replace(/\/$/, '')}/v1/icon?url=${encodeURIComponent(sourceUrl)}` : '';
}

export function createGameIcon(game, { size = 48, proxyEndpoint = '' } = {}) {
  const wrapper = element('span', { className: 'game-icon-fallback', text: (game.title || '?').trim().slice(0, 1), attrs: { 'aria-hidden': 'true' } });
  wrapper.style.width = `${size}px`; wrapper.style.height = `${size}px`;
  const image = element('img', { className: 'game-icon', attrs: { alt: `${game.title} 图标`, width: size, height: size, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', crossorigin: 'anonymous' } });
  image.style.width = `${size}px`; image.style.height = `${size}px`;
  let triedProxy = false;
  image.addEventListener('load', () => wrapper.replaceWith(image), { once: true });
  image.addEventListener('error', () => {
    const proxy = iconProxyUrl(game.icon_source_url, proxyEndpoint);
    if (!triedProxy && proxy) { triedProxy = true; image.src = proxy; return; }
    image.remove();
  });
  image.src = game.icon_source_url || '';
  wrapper.append(image);
  return wrapper;
}
