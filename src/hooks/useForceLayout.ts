import { useEffect, useMemo } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import type { GraphData, SimLink, SimNode } from '../lib/graph.types';
import { seedSimulationData } from '../lib/graph.utils';

export interface ForceLayout {
  simulation: Simulation<SimNode, SimLink>;
  /** The node objects d3 mutates each tick — the renderer reads x/y from here. */
  simNodes: SimNode[];
  /** The link objects; after init, source/target are resolved to SimNode refs. */
  simLinks: SimLink[];
}

/**
 * Builds a force-directed layout from graph data.
 *
 * Think of it like a mobile hanging from the ceiling: every node repels
 * every other (charge), edges act like springs pulling connected nodes
 * together (link), a gentle pull keeps the whole thing centred, and
 * collision stops the planets from overlapping. d3 nudges all of this
 * toward equilibrium a little on every tick — that settling motion *is*
 * the intro animation.
 *
 * The simulation is created lazily and only when data exists. It is NOT
 * started here at full energy; the renderer reheats it on mount so the
 * intro plays from a clean state regardless of mount timing.
 */
export function useForceLayout(data: GraphData | null): ForceLayout | null {
  const layout = useMemo<ForceLayout | null>(() => {
    if (!data) return null;

    const { simNodes, simLinks } = seedSimulationData(data.nodes, data.edges);

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'charge',
        forceManyBody<SimNode>().strength((d) => -28 * Math.sqrt(d.size)),
      )
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            return s.size + t.size + 56;
          })
          .strength(0.32),
      )
      .force('center', forceCenter(0, 0).strength(0.05))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => d.size * 0.9 + 14).strength(0.85),
      )
      .force('x', forceX(0).strength(0.02))
      .force('y', forceY(0).strength(0.02))
      .alphaDecay(0.018)
      .velocityDecay(0.32);

    // Don't run yet — let the renderer call .alpha(1).restart() once it's
    // ready, so the settling animation is always visible.
    simulation.stop();

    return { simulation, simNodes, simLinks };
  }, [data]);

  // Tear the simulation down when data changes or the component unmounts.
  useEffect(() => {
    return () => {
      layout?.simulation.stop();
    };
  }, [layout]);

  return layout;
}
