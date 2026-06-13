import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GraphCanvas } from './GraphCanvas';
import { NodeDetailPanel } from './NodeDetailPanel';
import { useForceLayout } from '../hooks/useForceLayout';
import { useGraphData } from '../hooks/useGraphData';
import { useGraphInteractions } from '../hooks/useGraphInteractions';
import type { GraphNodeData, NodeType } from '../lib/graph.types';
import { hexString, colorForType, labelForType } from '../lib/graph.utils';
import type { GraphScene } from '../pixi/GraphScene';

export function GraphPage() {
  const { data, loading, error } = useGraphData();
  const layout = useForceLayout(data);
  const interactions = useGraphInteractions(data);
  const sceneRef = useRef<GraphScene | null>(null);

  const { selectedId, adjacency, selectNode, hoverNode, clearSelection } =
    interactions;

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNodeData>();
    if (data) for (const n of data.nodes) map.set(n.id, n);
    return map;
  }, [data]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  const connections = useMemo<GraphNodeData[]>(() => {
    if (!selectedId) return [];
    const ids = adjacency.get(selectedId);
    if (!ids) return [];
    return [...ids]
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNodeData => Boolean(n))
      .sort((a, b) => b.size - a.size);
  }, [selectedId, adjacency, nodeById]);

  // Distinct node types present, for the legend.
  const legendTypes = useMemo<NodeType[]>(() => {
    if (!data) return [];
    const order: NodeType[] = [
      'main',
      'feature',
      'service',
      'data',
      'ai',
      'integration',
    ];
    const present = new Set(data.nodes.map((n) => n.type));
    return order.filter((t) => present.has(t));
  }, [data]);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  return (
    <main className="relative h-full w-full overflow-hidden bg-void">
      {/* The graph fills the whole viewport behind everything. */}
      {data && layout && (
        <GraphCanvas
          data={data}
          layout={layout}
          selectedId={selectedId}
          onSelect={selectNode}
          onHover={hoverNode}
          sceneRef={sceneRef}
        />
      )}

      {/* A faint vignette to deepen the edges of space. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(5,6,15,0.55) 100%)',
        }}
      />

      {/* Header */}
      <motion.header
        className="pointer-events-none absolute left-0 top-0 z-20 p-6 sm:p-8"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-starlight-faint">
          Product Constellation
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-none text-starlight sm:text-4xl">
          The Platform Map
        </h1>
        <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-starlight-dim">
          Every feature, service, and model in orbit around the core. Hover to
          trace connections, tap a planet to dive in.
        </p>
      </motion.header>

      {/* Legend */}
      <AnimatePresence>
        {legendTypes.length > 0 && (
          <motion.div
            className="absolute bottom-6 left-6 z-20 hidden sm:block"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6, ease: 'easeOut' }}
          >
            <ul className="flex flex-col gap-2 rounded-2xl border border-haze bg-void-2/70 px-4 py-3 backdrop-blur-md">
              {legendTypes.map((type) => (
                <li key={type} className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: hexString(colorForType(type)),
                      boxShadow: `0 0 10px ${hexString(colorForType(type))}`,
                    }}
                  />
                  <span className="text-[12px] text-starlight-dim">
                    {labelForType(type)}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <motion.div
        className="absolute bottom-6 right-6 z-20 flex items-center gap-3"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.6, ease: 'easeOut' }}
      >
        <span className="hidden font-mono text-[11px] text-starlight-faint md:inline">
          scroll to zoom · drag to pan
        </span>
        <button
          type="button"
          onClick={() => sceneRef.current?.frameAll()}
          className="rounded-full border border-haze bg-void-2/70 px-4 py-2 font-mono text-[11px] uppercase
                     tracking-wider text-starlight-dim backdrop-blur-md transition-colors hover:border-starlight-faint
                     hover:text-starlight focus-visible:outline focus-visible:outline-2 focus-visible:outline-starlight"
        >
          Reset view
        </button>
      </motion.div>

      <NodeDetailPanel
        node={selectedNode}
        connections={connections}
        onClose={clearSelection}
        onSelect={selectNode}
      />

      {/* Loading / error overlays */}
      <AnimatePresence>
        {loading && (
          <motion.div
            className="absolute inset-0 z-30 grid place-items-center bg-void"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex flex-col items-center gap-4">
              <motion.span
                className="block h-3 w-3 rounded-full bg-node-main"
                style={{ boxShadow: '0 0 24px var(--color-node-main)' }}
                animate={{ scale: [1, 1.6, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-starlight-faint">
                Charting the sky
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-void px-6">
          <div className="max-w-sm text-center">
            <h2 className="font-display text-xl text-starlight">
              The map didn't load
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-starlight-dim">
              {error}. Check that <code className="font-mono text-starlight">/data/graph.json</code>{' '}
              exists and is valid, then reload.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
