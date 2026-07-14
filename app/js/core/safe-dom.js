export function element(tag, { className, text, attrs = {}, children = [] } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  Object.entries(attrs).forEach(([key, value]) => { if (value !== null && value !== undefined) node.setAttribute(key, String(value)); });
  children.filter(Boolean).forEach(child => node.append(child));
  return node;
}
export function clear(node) { node.replaceChildren(); return node; }
