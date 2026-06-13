import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

/**
 * Where a product is in its life. Drives the glyph shown before its name
 * (see `statusGlyph` in graph.utils.ts) and reads in the legend.
 */
export type ProductStatus = 'live' | 'building' | 'wedge';

/** Which "engine" a product runs on. Drives the glow colour. */
export type Engine = 'A' | 'B' | 'C';

/**
 * How two products relate. Each maps to an edge colour + legend label in
 * `graph.utils.ts`.
 */
export type EdgeType = 'extract' | 'ascends' | 'shares' | 'bundles';

/** A product (node) exactly as it appears in `public/data/graph.json`. */
export interface GraphNodeData {
  id: string;
  label: string;
  status: ProductStatus;
  /** Layer in the portfolio ladder, e.g. "L1", "L2". */
  layer: string;
  engine: Engine;
  /** Visual radius in world units. Bigger = more central. */
  size: number;
  description: string;
  /** Optional free-form tags shown in the detail panel. */
  tags?: string[];
  /** Optional key/value facts shown in the detail panel. */
  meta?: Record<string, string>;
}

/** An edge exactly as it appears in the JSON (source/target are node ids). */
export interface GraphEdgeData {
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
}

/** The full shape of `graph.json`. */
export interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

/**
 * A node once it has been handed to d3-force. d3 mutates `x`, `y`, `vx`,
 * `vy` in place on every tick — that mutation is exactly how the layout
 * "settles", and what the Pixi renderer reads each frame.
 */
export interface SimNode extends GraphNodeData, SimulationNodeDatum {}

/**
 * A link once it has been handed to d3-force. Before the simulation
 * initialises, `source`/`target` are ids (strings); afterwards d3 replaces
 * them with references to the `SimNode` objects themselves.
 */
export interface SimLink extends SimulationLinkDatum<SimNode> {
  type: EdgeType;
  label?: string;
}

/** Camera state in screen space: world is translated by (x,y) then scaled. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
