import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from 'three';

const CLUSTER_COLORS = [
  '#20d9ca', '#7b8cff', '#f3b65a', '#e8788d',
  '#77be67', '#b388ed', '#5bb7e8', '#e79a66', '#8d9ca2',
];

function disposeMaterial(material) {
  if (Array.isArray(material)) material.forEach(disposeMaterial);
  else material?.dispose?.();
}

function disposeObject(object) {
  object.geometry?.dispose?.();
  disposeMaterial(object.material);
}

/**
 * Mount the bounded game universe. Exact values and keyboard navigation remain
 * in the DOM; this renderer only owns spatial exploration and pointer picking.
 */
export function mountUniverse({
  canvas,
  context,
  nodes,
  clusters = [],
  onSelect = () => {},
  reducedMotion = false,
  pixelRatio = 1,
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  const points = Array.isArray(nodes) ? nodes.slice(0, 180) : [];
  const renderer = new WebGLRenderer({
    canvas,
    context,
    antialias: pixelRatio <= 1,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.max(0.75, Math.min(1.5, Number(pixelRatio) || 1)));
  renderer.setClearColor(0x071013, 1);
  renderer.outputColorSpace = 'srgb';

  const scene = new Scene();
  scene.background = new Color(0x071013);
  const camera = new PerspectiveCamera(43, 1, 0.1, 90);
  const cameraHome = { x: 0, y: 12.8, z: 27.5 };
  camera.position.set(cameraHome.x, cameraHome.y, cameraHome.z);
  camera.lookAt(0, 0, 0);

  scene.add(new AmbientLight(0xffffff, 1.6));
  const keyLight = new DirectionalLight(0xb9fff9, 3.2);
  keyLight.position.set(7, 14, 11);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0x8792ff, 1.25);
  fillLight.position.set(-12, 6, -8);
  scene.add(fillLight);

  const floor = new InstancedMesh(
    new RingGeometry(5, 5.035, 96),
    new MeshBasicMaterial({ color: 0x1b6e70, transparent: true, opacity: 0.34, side: 2 }),
    3,
  );
  const ringMatrix = new Matrix4();
  [1, 2.08, 3.42].forEach((scale, index) => {
    ringMatrix.makeScale(scale, scale, scale);
    ringMatrix.multiply(new Matrix4().makeRotationX(-Math.PI / 2));
    floor.setMatrixAt(index, ringMatrix);
  });
  scene.add(floor);

  const clusterColor = new Map(clusters.map((cluster, index) => [cluster, new Color(CLUSTER_COLORS[index % CLUSTER_COLORS.length])]));
  const geometry = new SphereGeometry(1, 12, 8);
  const material = new MeshStandardMaterial({ roughness: 0.34, metalness: 0.08 });
  const mesh = new InstancedMesh(geometry, material, Math.max(1, points.length));
  mesh.count = points.length;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const matrix = new Matrix4();
  const visibleIds = new Set(points.map(point => point.id));
  function setNodeMatrix(index) {
    const point = points[index];
    const scale = visibleIds.has(point.id) ? point.size : 0.001;
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(point.x, point.y, point.z);
    mesh.setMatrixAt(index, matrix);
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    setNodeMatrix(index);
    mesh.setColorAt(index, clusterColor.get(point.cluster) || new Color(CLUSTER_COLORS.at(-1)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  const selectionRing = new InstancedMesh(
    new RingGeometry(1.15, 1.32, 32),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, side: 2 }),
    1,
  );
  selectionRing.visible = false;
  scene.add(selectionRing);

  const core = new InstancedMesh(
    new CylinderGeometry(0.09, 0.09, 6.5, 10),
    new MeshBasicMaterial({ color: 0x65f5e9, transparent: true, opacity: 0.18 }),
    1,
  );
  core.position.y = 0.45;
  scene.add(core);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let frame = 0;
  let running = false;
  let destroyed = false;
  let selectedIndex = -1;
  let rotation = 0;
  let dragStart = null;
  let rotationStart = 0;
  let autoRotate = !reducedMotion;
  let suspended = false;

  function render() {
    if (destroyed) return;
    mesh.rotation.y = rotation;
    floor.rotation.y = rotation;
    renderer.render(scene, camera);
  }

  function animate(time) {
    if (!running || destroyed) return;
    if (autoRotate && !dragStart) rotation = (rotation + 0.000075 * Math.min(48, Number(time - (animate.lastTime || time)))) % (Math.PI * 2);
    animate.lastTime = time;
    render();
    if (autoRotate) frame = requestAnimationFrame(animate);
    else running = false;
  }

  function resize() {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!suspended) render();
  }

  function select(index, { notify = true } = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= points.length) {
      selectedIndex = -1;
      selectionRing.visible = false;
      render();
      return;
    }
    selectedIndex = index;
    const point = points[index];
    const size = point.size * 1.25;
    matrix.makeScale(size, size, size);
    matrix.setPosition(point.x, point.y, point.z);
    selectionRing.setMatrixAt(0, matrix);
    selectionRing.instanceMatrix.needsUpdate = true;
    selectionRing.visible = true;
    selectionRing.rotation.y = rotation;
    render();
    if (notify) onSelect(point, index);
  }

  function pick(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (hit && Number.isInteger(hit.instanceId)) select(hit.instanceId);
  }

  function pointerDown(event) {
    if (event.button !== 0) return;
    dragStart = { x: event.clientX, y: event.clientY };
    rotationStart = rotation;
    canvas.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!dragStart) return;
    rotation = rotationStart + (event.clientX - dragStart.x) * 0.0075;
    render();
  }

  function pointerUp(event) {
    if (!dragStart) return;
    const distance = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
    dragStart = null;
    canvas.releasePointerCapture?.(event.pointerId);
    if (distance < 5) pick(event);
  }

  function start() {
    if (running || destroyed) return;
    suspended = false;
    if (!autoRotate) {
      render();
      return;
    }
    running = true;
    animate.lastTime = 0;
    frame = requestAnimationFrame(animate);
  }

  function pause() {
    autoRotate = false;
    suspend();
  }

  function suspend() {
    suspended = true;
    running = false;
    cancelAnimationFrame(frame);
  }

  function resume() {
    autoRotate = true;
    suspended = false;
    start();
  }

  function resetCamera() {
    rotation = 0;
    camera.position.set(cameraHome.x, cameraHome.y, cameraHome.z);
    camera.lookAt(0, 0, 0);
    select(selectedIndex, { notify: false });
    render();
  }

  function setVisibleIds(ids) {
    visibleIds.clear();
    for (const id of ids || []) visibleIds.add(Number(id));
    for (let index = 0; index < points.length; index += 1) setNodeMatrix(index);
    mesh.instanceMatrix.needsUpdate = true;
    if (selectedIndex >= 0 && !visibleIds.has(points[selectedIndex].id)) selectionRing.visible = false;
    else if (selectedIndex >= 0) select(selectedIndex, { notify: false });
    render();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    pause();
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    scene.traverse(disposeObject);
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  render();
  if (autoRotate) start();
  canvas.dataset.renderReady = 'true';
  canvas.dispatchEvent(new CustomEvent('universe-render-ready'));

  return { destroy, pause, resetCamera, resize, resume, select, setVisibleIds, suspend };
}
