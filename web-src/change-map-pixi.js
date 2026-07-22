import { Application, Circle, Container, Graphics } from 'pixi.js';

const COLORS = Object.freeze({
  background: 0xf7f9f9,
  grid: 0xd8e0e1,
  axis: 0x91a0a3,
  positive: 0x16845b,
  negative: 0xc44d5a,
  neutral: 0x68767a,
  selected: 0x087f7a,
});

function toneColor(tone) {
  return COLORS[tone] || COLORS.neutral;
}

function drawTriangle(graphics, x, y, radius, direction) {
  const tipY = y + direction * radius;
  const baseY = y - direction * radius * 0.7;
  graphics.poly([x, tipY, x - radius * 0.9, baseY, x + radius * 0.9, baseY]).fill({ color: toneColor(direction < 0 ? 'negative' : 'positive') });
}

/** Mount a demand-rendered Pixi change map. Pixi owns only the canvas. */
export async function mountChangeMap({
  container,
  canvas,
  context,
  model,
  onSelect = () => {},
  pixelRatio = 1,
} = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('container is required');
  const app = new Application();
  const renderCanvas = canvas instanceof HTMLCanvasElement ? canvas : document.createElement('canvas');
  const width = Math.max(320, Math.round(container.clientWidth || model?.width || 960));
  const height = Math.max(300, Math.round(container.clientHeight || model?.height || 440));
  await app.init({
    width,
    height,
    resolution: Math.max(0.75, Math.min(1.5, Number(pixelRatio) || 1)),
    autoDensity: true,
    autoStart: false,
    antialias: false,
    backgroundColor: COLORS.background,
    backgroundAlpha: 1,
    preference: 'webgl',
    canvas: renderCanvas,
    context,
    powerPreference: 'low-power',
  });
  app.ticker.stop();
  app.canvas.className = 'change-map-canvas';
  app.canvas.setAttribute('aria-hidden', 'true');
  container.replaceChildren(app.canvas);
  delete container.dataset.mapDestroyed;

  let currentModel = model;
  let selectedId = '';
  let destroyed = false;

  function draw() {
    if (destroyed) return;
    app.stage.removeChildren().forEach(child => child.destroy({ children: true }));
    const root = new Container();
    const grid = new Graphics();
    const { plot, lanes, nodes } = currentModel;
    const right = currentModel.width - plot.right;

    for (const lane of lanes) {
      grid.moveTo(plot.left, lane.y).lineTo(right, lane.y).stroke({ color: COLORS.grid, width: 1, alpha: 0.85 });
    }
    for (let index = 0; index <= 6; index += 1) {
      const x = plot.left + ((right - plot.left) * index) / 6;
      grid.moveTo(x, plot.top).lineTo(x, currentModel.height - plot.bottom).stroke({ color: COLORS.grid, width: 1, alpha: index === 6 ? 0.95 : 0.38 });
    }
    root.addChild(grid);

    for (const node of nodes) {
      const mark = new Graphics();
      const selected = String(node.id) === selectedId;
      const radius = node.radius + (selected ? 3 : 0);
      if (node.tone === 'positive') {
        drawTriangle(mark, node.x, node.y, radius, 1);
      } else if (node.tone === 'negative') {
        drawTriangle(mark, node.x, node.y, radius, -1);
      } else {
        mark.circle(node.x, node.y, radius).fill({ color: toneColor(node.tone) });
      }
      if (selected) mark.circle(node.x, node.y, radius + 4).stroke({ color: COLORS.selected, width: 2, alpha: 0.9 });
      mark.eventMode = 'static';
      mark.cursor = 'pointer';
      mark.hitArea = new Circle(node.x, node.y, Math.max(12, radius + 4));
      mark.on('pointertap', () => {
        selectedId = String(node.id);
        onSelect(node.event, node);
        draw();
      });
      root.addChild(mark);
    }
    app.stage.addChild(root);
    app.render();
    app.canvas.dataset.renderReady = 'true';
    app.canvas.dispatchEvent(new CustomEvent('change-map-render-ready'));
  }

  function update(nextModel) {
    currentModel = nextModel;
    app.renderer.resize(nextModel.width, nextModel.height);
    draw();
  }

  function select(eventId) {
    selectedId = String(eventId || '');
    draw();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    app.ticker.stop();
    app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true, context: true });
    container.replaceChildren();
    container.dataset.mapDestroyed = 'true';
  }

  draw();
  return { destroy, select, update };
}
