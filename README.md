# Product Constellation

An interactive, dark, cinematic **constellation-style product graph**. Nodes are glowing stars/planets; edges are thin light-traces between them. Pan, zoom, hover to trace a node's neighborhood, click to open a star-chart detail panel and glide the camera onto it.

Built **frontend-only** — no backend, no server calls. The graph is loaded from a static JSON file and laid out with a physics simulation, so you never hand-place a single coordinate.

## Stack

| Concern | Tech |
| --- | --- |
| Build / dev server | Vite 6 |
| UI | React 18 + TypeScript (strict) |
| Rendering | PixiJS v8 (WebGL/WebGPU) |
| Layout | d3-force |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first) |
| Animation (UI chrome) | Framer Motion |

> **Why Vite and not Next.js?** PixiJS is strictly a browser/WebGL thing — it touches `window`, `canvas`, and the GPU. In Next.js that fights server-side rendering and forces `"use client"` boundaries everywhere. A plain Vite SPA is the honest shape for a fully client-side canvas app. Think of it like a fish tank: the whole point is the water and the fish moving in real time. Next.js keeps trying to photograph the tank on the server and send you a still image first — pointless when the tank only exists in the browser.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build     # type-check (tsc -b) + production bundle into dist/
npm run preview   # serve the built bundle locally
npm run typecheck # tsc --noEmit, no build output
```

## Swap in your own graph

All data lives in **`public/data/graph.json`**. Replace it and the whole map redraws — no code changes, no coordinates.

```jsonc
{
  "nodes": [
    {
      "id": "core",                 // unique string, referenced by edges
      "label": "Platform Core",      // shown on the node / in the panel
      "type": "main",               // main | feature | service | data | ai | integration
      "size": 48,                    // visual radius weight; also feeds the layout
      "description": "…",           // shown in the detail panel
      "tags": ["platform"],         // optional, rendered as pills
      "meta": { "owner": "…" }       // optional key/value grid in the panel
    }
  ],
  "edges": [
    { "source": "core", "target": "jobs", "label": "owns" }
  ]
}
```

Rules the loader enforces at runtime (it will throw a readable error otherwise):

- every `node.id` is a unique string,
- every `edge.source` / `edge.target` points at an existing node id.

`type` drives a node's colour (see the legend, bottom-left). `size` drives both how big it renders and how strongly it pushes neighbours away in the simulation, so a `main` hub naturally clears space around itself.

## How the layout works (the 5-year-old version)

Imagine every node is a little magnet, and every edge is a rubber band tying two magnets together. Let go, and they jiggle: magnets shove each other apart so nothing overlaps, rubber bands pull connected ones close, and a gentle pull toward the middle stops anyone drifting into deep space. After a second or two everything settles into a shape that *feels* organised — clusters that belong together end up together. That settling is the intro animation you see on load. d3-force is the physics; PixiJS just draws wherever the physics says each node currently is, 60 times a second.

## Project map

```
public/data/graph.json     ← your data lives here
src/
  App.tsx                  ← mounts GraphPage
  main.tsx                 ← React root
  index.css                ← Tailwind v4 + design tokens (the space palette)
  lib/
    graph.types.ts         ← all shared TS types
    graph.utils.ts         ← colours, math (damp/ease), adjacency, glow textures
  hooks/
    useGraphData.ts        ← fetch + validate graph.json
    useForceLayout.ts      ← build the d3-force simulation
    useGraphInteractions.ts← selected / hovered state + neighborhood derivation
  pixi/
    GraphScene.ts          ← the imperative PixiJS engine (camera, render loop, input)
  components/
    GraphCanvas.tsx        ← thin React↔Pixi bridge
    NodeDetailPanel.tsx    ← the star-chart side panel / mobile sheet
    GraphPage.tsx          ← composes everything + header/legend/controls
```

The split to remember: **React owns *what* is selected; PixiJS owns *how* the canvas looks.** They talk through a tiny set of callbacks, never by sharing rendering state. See `CLAUDE.md` for the deeper architecture notes and the PixiJS-v8 gotchas.

## Controls

- **Scroll / pinch** — zoom (keeps the point under your cursor fixed)
- **Drag** — pan
- **Hover a node** — highlight it + its connections, dim everything else
- **Click a node** — open the detail panel and glide the camera onto it
- **Click empty space / `Esc`** — deselect
- **Reset view** (bottom-right) — frame the whole map again

Respects `prefers-reduced-motion`: the intro settle is skipped and the simulation is pre-solved to a static layout.
