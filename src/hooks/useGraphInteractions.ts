import { useCallback, useMemo, useState } from 'react';
import type { GraphData } from '../lib/graph.types';
import { buildAdjacency, neighborhoodOf } from '../lib/graph.utils';

export interface GraphInteractions {
  selectedId: string | null;
  hoveredId: string | null;
  /** id -> set of directly connected ids. */
  adjacency: Map<string, Set<string>>;
  /** The set kept bright right now (hover wins over selection); null = all bright. */
  activeNeighborhood: Set<string> | null;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  clearSelection: () => void;
}

/**
 * Single source of truth for "what is the user pointing at / has chosen".
 *
 * Hover and selection stay in React state because the detail panel (a
 * React component) needs them. The Pixi scene reads `activeNeighborhood`
 * to decide which planets glow and which fade — hover takes priority over
 * selection, the way a fingertip hovering a map matters more than the pin
 * you dropped earlier.
 */
export function useGraphInteractions(
  data: GraphData | null,
): GraphInteractions {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const adjacency = useMemo(
    () => (data ? buildAdjacency(data.edges) : new Map<string, Set<string>>()),
    [data],
  );

  const activeNeighborhood = useMemo(() => {
    const focusId = hoveredId ?? selectedId;
    return neighborhoodOf(focusId, adjacency);
  }, [hoveredId, selectedId, adjacency]);

  const selectNode = useCallback((id: string | null) => setSelectedId(id), []);
  const hoverNode = useCallback((id: string | null) => setHoveredId(id), []);
  const clearSelection = useCallback(() => setSelectedId(null), []);

  return {
    selectedId,
    hoveredId,
    adjacency,
    activeNeighborhood,
    selectNode,
    hoverNode,
    clearSelection,
  };
}
