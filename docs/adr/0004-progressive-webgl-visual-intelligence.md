# ADR-0004: Progressive WebGL visual intelligence

## Status

Accepted

## Context

TTMRank needs a more distinctive, exploratory presentation without making WebGL a requirement
for reading rankings or changes. Three.js and PixiJS have material bundle, GPU, accessibility and
battery costs, while the static GitHub Pages site must remain the primary reliable product.

## Decision

Use two page-isolated, progressively loaded renderers. Three.js owns a dedicated game-universe
route and renders made-game nodes with one instanced mesh. PixiJS owns an optional change-map
mode and renders only on data, resize or selection changes; its ticker remains stopped. Exact
labels and controls stay in DOM. The homepage loads neither engine.

The pipeline publishes a bounded made-only visual artifact. Engines are pinned, bundled and
self-hosted. Capability, reduced-motion, data-saver and low-device checks select a static SVG/DOM
fallback before downloading an engine. Page visibility stops the Three.js loop; leaving Pixi map
mode destroys its renderer.

## Consequences

- The public site stays useful with JavaScript errors, WebGL loss or optional infrastructure loss.
- Visual exploration has real data semantics instead of decorative particles.
- Engine bundles increase the repository and dedicated-page transfer size but do not affect the
  default homepage or ranking paths.
- Renderer source, generated bundles, budget tests and fallbacks require ongoing maintenance.

