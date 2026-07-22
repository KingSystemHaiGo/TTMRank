# Visual Intelligence Implementation Plan

## Task 1: Compact visual artifact

- Add a pure Python visual-dataset builder and deterministic cluster selection.
- Publish and hash `visual-current.json` from the existing atomic pipeline.
- Test schema, made-only scope, byte budget and manifest fields.

## Task 2: Reproducible engine bundles

- Add pinned Three.js, PixiJS and esbuild dependencies.
- Bundle two isolated ESM entry points into self-hosted assets.
- Add gzip size gates and source/build scripts.

## Task 3: Three.js game universe

- Add the universe route, layout model, capability gate and static SVG fallback.
- Render all nodes with one instanced mesh and DOM labels/details.
- Pause when hidden, cap DPR, respect reduced motion and expose render-ready state.

## Task 4: PixiJS change map

- Extend URL state with list/map view without changing filter semantics.
- Add a deterministic timeline/lane model and lazy PixiJS renderer.
- Stop the ticker, destroy the renderer on list view and preserve DOM interaction.

## Task 5: Site integration

- Add consistent navigation and a zero-JavaScript homepage portal.
- Refine responsive styling, loading/error states and accessible descriptions.
- Update operational docs and performance budgets.

## Task 6: Verification and release

- Run Python, JavaScript, bundle-budget and Playwright suites.
- Validate desktop, mobile, static fallback, reduced motion, request inventory and console.
- Push a focused branch, merge after checks, and verify the production Pages artifact.

