let cachedDocument;
let cachedBootstrap;

export function readBootstrap(documentTarget = globalThis.document) {
  if (!documentTarget?.getElementById) return null;
  if (documentTarget === cachedDocument) return cachedBootstrap;
  cachedDocument = documentTarget;
  const node = documentTarget.getElementById('ttmrank-bootstrap');
  if (!node) {
    cachedBootstrap = null;
    return null;
  }
  try {
    cachedBootstrap = JSON.parse(node.textContent || 'null');
  } catch {
    cachedBootstrap = null;
  }
  return cachedBootstrap;
}

export function resetBootstrapCache() {
  cachedDocument = undefined;
  cachedBootstrap = undefined;
}
