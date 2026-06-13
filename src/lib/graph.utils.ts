import { Texture } from 'pixi.js';
import type {
  EdgeType,
  Engine,
  GraphEdgeData,
  GraphNodeData,
  ProductStatus,
  SimLink,
  SimNode,
} from './graph.types';

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

/**
 * Glow colour per engine, as a 24-bit number (what Pixi wants).
 * Keep these in sync with the `--color-engine-*` tokens in `index.css`.
 */
export const ENGINE_COLORS: Record<Engine, number> = {
  A: 0xffce8a, // gold
  B: 0xb38cff, // violet
  C: 0xff6a45, // ember
};

export const FALLBACK_COLOR = 0x9aa3d6;

export function colorForEngine(engine: Engine): number {
  return ENGINE_COLORS[engine] ?? FALLBACK_COLOR;
}

/** "#rrggbb" string (handy for HTML/Tailwind inline styles in the panel). */
export function hexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A near-white tint of an engine colour, used for crisp label text. */
export function labelTint(engine: Engine): number {
  return mixToward(colorForEngine(engine), 0xffffff, 0.62);
}

/** Linearly mix `color` toward `target` by `t` (0..1). */
export function mixToward(color: number, target: number, t: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  const mix = (a: number, c: number) => Math.round(a + (c - a) * t);
  return (mix(r, tr) << 16) | (mix(g, tg) << 8) | mix(b, tb);
}

/** The glyph drawn before a product name, by status (matches the legend). */
export function statusGlyph(status: ProductStatus): string {
  switch (status) {
    case 'live':
      return '●';
    case 'building':
      return '◐';
    case 'wedge':
      return '○';
  }
}

/* ------------------------------------------------------------------ *
 * Edge relationships
 * ------------------------------------------------------------------ */

export interface EdgeMeta {
  color: number;
  /** Short legend label. */
  legend: string;
  /** Dashed line in the legend / on screen? */
  dashed: boolean;
}

export const EDGE_META: Record<EdgeType, EdgeMeta> = {
  extract: { color: 0xff7a45, legend: 'extract → intake', dashed: true },
  ascends: { color: 0xffce8a, legend: 'ascends (ladder)', dashed: false },
  shares: { color: 0x8aa0ff, legend: 'shares audience', dashed: true },
  bundles: { color: 0x49d4a8, legend: 'bundles', dashed: false },
};

export function edgeMeta(type: EdgeType): EdgeMeta {
  return EDGE_META[type] ?? { color: FALLBACK_COLOR, legend: type, dashed: false };
}

/* ------------------------------------------------------------------ *
 * Graph structure
 * ------------------------------------------------------------------ */

/** Adjacency map: node id -> set of directly connected node ids. */
export function buildAdjacency(
  edges: GraphEdgeData[],
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let set = adjacency.get(a);
    if (!set) {
      set = new Set<string>();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const { source, target } of edges) {
    link(source, target);
    link(target, source);
  }
  return adjacency;
}

/**
 * The "neighbourhood" of a node: the node itself plus its direct
 * neighbours. This is the set that stays bright on hover/selection while
 * everything else dims.
 */
export function neighborhoodOf(
  id: string | null,
  adjacency: Map<string, Set<string>>,
): Set<string> | null {
  if (!id) return null;
  const set = new Set<string>([id]);
  const neighbors = adjacency.get(id);
  if (neighbors) for (const n of neighbors) set.add(n);
  return set;
}

/** Resolve a link endpoint to its node id regardless of d3's mutation state. */
export function endpointId(end: SimLink['source'] | SimLink['target']): string {
  return typeof end === 'object' && end !== null
    ? (end as SimNode).id
    : String(end);
}

/* ------------------------------------------------------------------ *
 * Maths
 * ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Frame-rate-independent exponential smoothing toward `target`. */
export function damp(
  current: number,
  target: number,
  smoothing: number,
  deltaSeconds: number,
): number {
  const t = 1 - Math.pow(smoothing, deltaSeconds);
  return current + (target - current) * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/* ------------------------------------------------------------------ *
 * Pixi assets
 * ------------------------------------------------------------------ */

/**
 * Build a soft radial-gradient sprite texture used for the glow halo
 * around every node. We draw it once per colour onto an offscreen canvas
 * and let Pixi cache it as a GPU texture — far cheaper than per-frame
 * blur filters. The core is pushed toward white so big nodes read as
 * white-hot suns with a coloured corona.
 */
export function createGlowTexture(color: number, diameter = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = diameter;
  canvas.height = diameter;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const center = diameter / 2;

  const gradient = ctx.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0.0, 'rgba(255,255,255,0.98)');
  gradient.addColorStop(0.08, `rgba(${r},${g},${b},0.92)`);
  gradient.addColorStop(0.22, `rgba(${r},${g},${b},0.5)`);
  gradient.addColorStop(0.5, `rgba(${r},${g},${b},0.14)`);
  gradient.addColorStop(1.0, `rgba(${r},${g},${b},0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, diameter, diameter);

  return Texture.from(canvas);
}

/** A tiny soft dot texture reused for the ambient background starfield. */
export function createStarTexture(diameter = 32): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = diameter;
  canvas.height = diameter;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const center = diameter / 2;
  const gradient = ctx.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, diameter, diameter);

  return Texture.from(canvas);
}

/* ------------------------------------------------------------------ *
 * Simulation seeding
 * ------------------------------------------------------------------ */

/**
 * Make defensive copies of the JSON data for the simulation, so d3's
 * in-place mutation never touches the immutable data returned by
 * `useGraphData`. Nodes start in a tight random cluster near the origin so
 * the intro reads as an explosion settling into a constellation.
 */
export function seedSimulationData(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
): { simNodes: SimNode[]; simLinks: SimLink[] } {
  const simNodes: SimNode[] = nodes.map((node, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const radius = 8 + Math.random() * 24;
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  const simLinks: SimLink[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    type: edge.type,
    label: edge.label,
  }));

  return { simNodes, simLinks };
}
