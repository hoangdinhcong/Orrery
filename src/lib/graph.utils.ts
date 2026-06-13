import { Texture } from 'pixi.js';
import type {
  GraphEdgeData,
  GraphNodeData,
  NodeType,
  SimLink,
  SimNode,
} from './graph.types';

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

/**
 * Glow colour per node type, as a 24-bit number (what Pixi wants).
 * Keep these in sync with the `--color-node-*` tokens in `index.css`.
 */
export const NODE_COLORS: Record<NodeType, number> = {
  main: 0xffe8b0, // warm star-gold — the sun of the system
  ai: 0xff4fd8, // magenta
  integration: 0x8b5cff, // violet
  data: 0x2fe0c8, // teal
  feature: 0xffb454, // amber
  service: 0x4fa8ff, // azure
};

export const EDGE_COLOR = 0x8fb4ff; // faint cyan-white
export const FALLBACK_COLOR = 0x9aa3d6;

export function colorForType(type: NodeType): number {
  return NODE_COLORS[type] ?? FALLBACK_COLOR;
}

/** "#rrggbb" string (handy for HTML/Tailwind inline styles in the panel). */
export function hexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

const TYPE_LABELS: Record<NodeType, string> = {
  main: 'Core',
  feature: 'Feature',
  integration: 'Integration',
  data: 'Data',
  ai: 'AI',
  service: 'Service',
};

export function labelForType(type: NodeType): string {
  return TYPE_LABELS[type] ?? type;
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

/** A stable string key for an edge, used to look up its display object. */
export function edgeKey(edge: GraphEdgeData | SimLink): string {
  const s = typeof edge.source === 'object' ? edge.source.id : edge.source;
  const t = typeof edge.target === 'object' ? edge.target.id : edge.target;
  return `${String(s)}__${String(t)}`;
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
 * blur filters.
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
  gradient.addColorStop(0.0, `rgba(${r},${g},${b},0.95)`);
  gradient.addColorStop(0.18, `rgba(${r},${g},${b},0.55)`);
  gradient.addColorStop(0.45, `rgba(${r},${g},${b},0.18)`);
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
    label: edge.label,
  }));

  return { simNodes, simLinks };
}
