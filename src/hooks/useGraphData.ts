import { useEffect, useState } from 'react';
import type { GraphData } from '../lib/graph.types';

interface UseGraphDataResult {
  data: GraphData | null;
  loading: boolean;
  error: string | null;
}

/** Basic runtime validation so a malformed JSON file fails loudly, not weirdly. */
function assertGraphData(value: unknown): asserts value is GraphData {
  if (!value || typeof value !== 'object') {
    throw new Error('graph.json is not an object');
  }
  const candidate = value as Partial<GraphData>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    throw new Error('graph.json must contain "nodes" and "edges" arrays');
  }
  const ids = new Set<string>();
  for (const node of candidate.nodes) {
    if (!node || typeof node.id !== 'string') {
      throw new Error('every node needs a string "id"');
    }
    ids.add(node.id);
  }
  for (const edge of candidate.edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      throw new Error('every edge needs string "source" and "target"');
    }
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error(
        `edge references a missing node: ${edge.source} -> ${edge.target}`,
      );
    }
  }
}

/**
 * Loads the graph from a static JSON file. The data is treated as
 * immutable — the simulation works on copies (see `seedSimulationData`),
 * never on what this hook returns.
 */
export function useGraphData(
  url = `${import.meta.env.BASE_URL}data/graph.json`,
): UseGraphDataResult {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load graph (${res.status})`);
        return res.json();
      })
      .then((json: unknown) => {
        assertGraphData(json);
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading, error };
}
