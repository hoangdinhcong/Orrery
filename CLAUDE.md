# CLAUDE.md — working context for this project

This file is the handoff. If you're a fresh Claude Code session opening this folder, read this first — it captures the architecture, the decisions already made, the PixiJS-v8 traps that were already hit and fixed, and what's worth doing next. The build compiles clean (`npm run typecheck` and `npm run build` both pass) as of handoff.

## What this is

A frontend-only interactive product graph rendered on a WebGL canvas. Data → physics layout → canvas render. Dark "star chart / deep space" aesthetic. No backend.

## The one architectural rule

**React owns state; PixiJS owns pixels.** They are deliberately kept on opposite sides of a thin boundary.

- React state (`useGraphInteractions`) holds `selectedId` and `hoveredId` and derives the active neighborhood from the adjacency map.
- PixiJS (`GraphScene`) owns the camera, the render loop, every `Graphics`/`Sprite`/`Text`, and all pointer input on the canvas.
- They communicate through a tiny callback contract, never by sharing render objects:
  - Pixi → React: `onSelect(id | null)`, `onHover(id | null)` (set once via a ref so the scene is never rebuilt on every render).
  - React → Pixi: `scene.setSelected(id)` (a `useEffect` in `GraphCanvas` pushes selection changes down).

If you're tempted to make React re-render on hover/zoom, stop — that's the thing this architecture exists to avoid. 60fps canvas work must not go through React's reconciler.

## Data flow, end to end

1. `useGraphData` fetches `/data/graph.json`, validates it at runtime (`assertGraphData`), returns `{ data, loading, error }`.
2. `useForceLayout` builds a `d3-force` simulation from the data with `useMemo`, then calls `.stop()` immediately. It does **not** run the sim — it hands back `{ simulation, simNodes, simLinks }`.
3. `GraphScene` (via `GraphCanvas`) is what actually drives the simulation. It calls back into a `restartSimulation(alpha)` function: `alpha > 0` reheats and runs the sim live (the intro settle); `alpha === 0` is the reduced-motion path — it ticks the sim ~400 times synchronously then stops, so the layout is static.
4. Every Pixi ticker frame, `tick()` reads each `simNode.x/.y` and moves the matching node container there, redraws edges, pulses the selection ring, twinkles stars, and damps the camera toward its target.

The nodes are seeded in a tight cluster near the origin (`seedSimulationData`) specifically so the intro "explosion outward into place" reads well.

## Files that matter most

- `src/pixi/GraphScene.ts` — the engine. Biggest, most important file. `CONFIG` at the top holds every tunable (scales, smoothing constants, alphas, star count, intro duration, label thresholds). Camera model: `this.camera` is current, `this.target` is the goal; user pan/zoom sets both (instant), `focusOn` sets only target (animated glide). Layers, top to bottom: `starLayer` (screen-space parallax) → `world` (`edgesGfx` + `selectionRing` + `nodesLayer`, this is what pans/zooms) → `labelLayer` (screen-space, projected + counter-scaled so text stays crisp).
- `src/lib/graph.utils.ts` — pure helpers: `colorForType`, `damp` (frame-rate-independent exponential smoothing), `easeOutCubic`, `buildAdjacency`, `neighborhoodOf`, and the offscreen-canvas texture makers (`createGlowTexture`, `createStarTexture`).
- `src/components/GraphPage.tsx` — composition root for the UI chrome (header, legend, controls, panel) and owns the `sceneRef` used by "Reset view" (`scene.frameAll()`).

## PixiJS v8 specifics already relied on (don't "fix" these back to v7)

- `const app = new Application(); await app.init({...})` — v8 init is async. The scene's `init()` guards with a `this.destroyed` check after the await so React StrictMode's mount/unmount/mount doesn't leak a dead app.
- `app.canvas` (the DOM element), **not** `app.view`.
- `Graphics` uses the chained command API: `.circle(x,y,r).fill({color}).stroke({width,color})`. No `beginFill`/`endFill`.
- `new Text({ text, style })` — object form. `text.resolution = 2` keeps labels sharp; `text.anchor.set(0.5)`.
- Pointer events are `FederatedPointerEvent`: use `.global`, `.pointerId`, `.stopPropagation()`.
- Ticker callback receives a `Ticker` instance — read `ticker.deltaMS`, not a raw number.
- `app.screen` is a live `Rectangle` reference (stays current on resize) — it's reused directly as the stage `hitArea`.
- Teardown: `app.destroy({ removeView: true }, { children: true })`, and `Texture.destroy(true)` for the glow/star textures.
- **Resize is handled via `window.addEventListener('resize', ...)`**, not the renderer's `'resize'` event. The renderer event was unreliable; the window listener triggers the starfield rebuild. (The `hitArea` needs no resize handling because it's the live `app.screen` reference.)

## Config / toolchain gotchas already solved

- `tsconfig.node.json` must have `"composite": true` (it's a referenced project) and must **not** set `allowImportingTsExtensions` (conflicts with emit under `tsc -b`).
- `src/vite-env.d.ts` (`/// <reference types="vite/client" />`) is required — without it, `import './index.css'` fails typecheck under `noUncheckedSideEffectImports`.
- Tailwind v4 is CSS-first: config lives in `@theme` inside `src/index.css`, there is **no** `tailwind.config.js` and **no** PostCSS config. The design tokens (the space palette + per-type accent colours) are CSS custom properties there.
- The production build warns that a chunk is >500 kB — that's just PixiJS's size. Ignore, or add `manualChunks` if you care.

## Reasonable next steps (not yet done)

- **Edge labels** — `edge.label` exists in the data and types but isn't rendered yet. Would need its own screen-space label pass, shown only on hover/zoom to avoid clutter.
- **Search / filter** — jump-to-node or dim-by-type would slot into `useGraphInteractions` cleanly.
- **Deep-linking** — reflect `selectedId` in the URL hash so a focused node is shareable.
- **Persisted layout** — for very large graphs, pre-solve positions once and ship them in the JSON (optional `x/y`) instead of simulating on every load.
- **Code-split PixiJS** — `manualChunks` to quiet the bundle warning if this goes to production.
- **Tests** — `graph.utils.ts` is pure and the obvious first target (adjacency, neighborhood, clamp, ease).

## Conventions

- TypeScript strict, `noUnusedLocals`/`noUnusedParameters` on — no dead imports or vars will compile.
- Code and comments in English.
- Keep imperative Pixi out of components and declarative React out of the scene. The boundary is the whole design.
