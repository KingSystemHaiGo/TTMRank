import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

const CLUSTER_COLORS = [
  '#0aaea8', '#6f7ee8', '#e5a33d', '#dc7186',
  '#6eaa61', '#9b78d1', '#4f9fd0', '#da8c5b', '#829398',
];

function disposeObject(object) {
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
  else object.material?.dispose?.();
}

/**
 * Render a flat density layer behind the exact DOM game markers. The DOM owns
 * labels, values, focus and selection; Three.js only visualizes lane density.
 */
export function mountUniverse({
  canvas,
  context,
  nodes,
  clusters = [],
  pixelRatio = 1,
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  const points = Array.isArray(nodes) ? nodes.slice(0, 180) : [];
  const renderer = new WebGLRenderer({
    canvas,
    context,
    antialias: false,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.max(0.75, Math.min(1.5, Number(pixelRatio) || 1)));
  renderer.setClearColor(0xffffff, 0);

  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 1, 0, -2, 2);
  camera.position.z = 1;

  const clusterColors = new Map(clusters.map((cluster, index) => [cluster, new Color(CLUSTER_COLORS[index % CLUSTER_COLORS.length])]));
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({ transparent: true, opacity: 0.16, depthTest: false, depthWrite: false });
  const mesh = new InstancedMesh(geometry, material, Math.max(1, points.length));
  mesh.count = points.length;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const matrix = new Matrix4();
  const visibleIds = new Set(points.map(point => point.id));
  let visibleClusters = clusters.slice();

  function setNodeMatrix(index) {
    const point = points[index];
    const visible = visibleIds.has(point.id);
    const width = visible ? 0.055 + point.heatLevel * 0.055 : 0.0001;
    const height = visible ? Math.min(0.024, 0.15 / Math.max(1, visibleClusters.length)) : 0.0001;
    const lane = Math.max(0, visibleClusters.indexOf(point.cluster));
    const y = (lane + (point.laneSlot === 0 ? 0.28 : 0.72)) / Math.max(1, visibleClusters.length);
    matrix.makeScale(width, height, 1);
    matrix.setPosition(point.displayX, 1 - y, 0);
    mesh.setMatrixAt(index, matrix);
  }

  points.forEach((point, index) => {
    setNodeMatrix(index);
    mesh.setColorAt(index, clusterColors.get(point.cluster) || new Color(CLUSTER_COLORS.at(-1)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  let destroyed = false;
  let suspended = false;

  function render() {
    if (!destroyed && !suspended) renderer.render(scene, camera);
  }

  function resize() {
    renderer.setSize(Math.max(1, Math.round(canvas.clientWidth)), Math.max(1, Math.round(canvas.clientHeight)), false);
    render();
  }

  function setVisibleIds(ids, activeClusters = clusters) {
    visibleIds.clear();
    for (const id of ids || []) visibleIds.add(Number(id));
    visibleClusters = Array.isArray(activeClusters) && activeClusters.length ? activeClusters.slice() : clusters.slice();
    points.forEach((_point, index) => setNodeMatrix(index));
    mesh.instanceMatrix.needsUpdate = true;
    render();
  }

  function suspend() {
    suspended = true;
  }

  function resume() {
    suspended = false;
    render();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    resizeObserver.disconnect();
    scene.traverse(disposeObject);
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  canvas.dataset.renderReady = 'true';
  canvas.dispatchEvent(new CustomEvent('universe-render-ready'));

  return { destroy, resize, resume, setVisibleIds, suspend };
}
