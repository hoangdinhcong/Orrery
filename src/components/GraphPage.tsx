import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GraphCanvas } from './GraphCanvas';
import { NodeDetailPanel } from './NodeDetailPanel';
import { RockShelf } from './RockShelf';
import { useForceLayout } from '../hooks/useForceLayout';
import { useGraphData } from '../hooks/useGraphData';
import { useGraphInteractions } from '../hooks/useGraphInteractions';
import type { EdgeType, GraphNodeData } from '../lib/graph.types';
import { EDGE_META, hexString } from '../lib/graph.utils';
import type { GraphScene } from '../pixi/GraphScene';

const NAV_ITEMS = [
  'MAP',
  'PRODUCTS',
  'LIBRARY',
  'MONEY',
  'LOG',
  'CONSTITUTION',
] as const;

const EDGE_ORDER: EdgeType[] = ['extract', 'ascends', 'shares', 'bundles'];

const STATUS_LEGEND = [
  { glyph: '●', label: 'live' },
  { glyph: '◐', label: 'building' },
  { glyph: '○', label: 'wedge' },
] as const;

const CAPTION_LINES = [
  'rendered from data — not a drawing',
  'nodes = product · edges = product_edge',
  'layout computed (force-directed),',
  'positions never hardcoded',
];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function GraphPage() {
  const { data, loading, error } = useGraphData();
  const layout = useForceLayout(data);
  const interactions = useGraphInteractions(data);
  const sceneRef = useRef<GraphScene | null>(null);

  const { selectedId, adjacency, selectNode, hoverNode, clearSelection } =
    interactions;

  const reduced = useMemo(prefersReducedMotion, []);
  const [introDone, setIntroDone] = useState(reduced);

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

  // Intro sequence: hold the black title card, then reveal the map.
  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => setIntroDone(true), 2800);
    return () => window.clearTimeout(id);
  }, [reduced]);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  const chrome = (delay: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay, ease: 'easeOut' as const },
  });

  return (
    <main className="relative h-full w-full overflow-hidden bg-void">
      {/* Warm core nebula + vignette behind the graph. */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 46%, rgba(70,30,18,0.55) 0%, rgba(20,10,14,0.2) 45%, transparent 75%)',
        }}
      />

      {/* The graph fills the whole viewport. */}
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

      {/* Vignette to deepen the edges of space. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            'radial-gradient(120% 95% at 50% 42%, transparent 52%, rgba(4,3,6,0.7) 100%)',
        }}
      />

      {/* Decorative foreground rock shelf along the bottom. */}
      <RockShelf />

      {/* The violet bezel framing everything. */}
      <div className="bezel-frame" aria-hidden />

      {/* Top navigation */}
      <motion.nav
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-7 py-4 sm:px-10"
        {...chrome(0.2)}
      >
        <div className="flex items-center gap-6">
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.22em] text-starlight">
            OPC OS
          </span>
          <ul className="hidden items-center gap-5 md:flex">
            {NAV_ITEMS.map((item, idx) => (
              <li
                key={item}
                className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
                  idx === 0 ? 'text-starlight' : 'text-starlight-faint'
                }`}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-starlight-dim">
          HI
        </span>
      </motion.nav>

      {/* Title block */}
      <motion.header
        className="pointer-events-none absolute left-7 top-16 z-20 sm:left-10 sm:top-20"
        {...chrome(0.45)}
      >
        <h1 className="font-display text-5xl font-medium leading-none text-starlight sm:text-6xl">
          The portfolio
        </h1>
        <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-starlight-dim">
          one company, seven products — and the lines between them.
        </p>
      </motion.header>

      {/* Legend (bottom-left) */}
      <motion.div
        className="pointer-events-none absolute bottom-7 left-7 z-20 hidden sm:block sm:left-10"
        {...chrome(0.7)}
      >
        <ul className="flex flex-col gap-1.5">
          {EDGE_ORDER.map((type) => {
            const meta = EDGE_META[type];
            return (
              <li key={type} className="flex items-center gap-3">
                <svg width="26" height="6" viewBox="0 0 26 6" aria-hidden>
                  <line
                    x1="0"
                    y1="3"
                    x2="26"
                    y2="3"
                    stroke={hexString(meta.color)}
                    strokeWidth="1.5"
                    strokeDasharray={meta.dashed ? '4 3' : undefined}
                  />
                </svg>
                <span className="font-mono text-[10.5px] tracking-wide text-starlight-dim">
                  {meta.legend}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center gap-3 border-t border-haze pt-2.5">
          {STATUS_LEGEND.map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1.5 font-mono text-[10.5px] text-starlight-dim"
            >
              <span className="text-starlight">{s.glyph}</span>
              {s.label}
            </span>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] tracking-wide text-starlight-faint">
          size › reach · L# › layer
        </p>
      </motion.div>

      {/* Right-edge vertical hint */}
      <motion.div
        className="pointer-events-none absolute right-6 top-1/2 z-20 hidden -translate-y-1/2 lg:block"
        {...chrome(0.8)}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.32em] text-starlight-faint"
          style={{ writingMode: 'vertical-rl' }}
        >
          drag to orbit · scroll to zoom
        </span>
      </motion.div>

      {/* Bottom-center status bar */}
      <motion.div
        className="absolute inset-x-0 bottom-7 z-20 flex justify-center"
        {...chrome(0.7)}
      >
        <p className="font-mono text-[10.5px] tracking-wide text-starlight-faint">
          OPC OS · product map · click a node to focus ·{' '}
          <button
            type="button"
            onClick={() => sceneRef.current?.resetView()}
            className="pointer-events-auto text-starlight-dim underline-offset-2 transition-colors hover:text-starlight hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-bezel"
          >
            [ reset ]
          </button>
        </p>
      </motion.div>

      {/* Bottom-right caption */}
      <motion.div
        className="pointer-events-none absolute bottom-7 right-7 z-20 hidden text-right sm:block sm:right-10"
        {...chrome(0.85)}
      >
        {CAPTION_LINES.map((line) => (
          <p
            key={line}
            className="font-mono text-[10px] leading-relaxed tracking-wide text-starlight-faint"
          >
            {line}
          </p>
        ))}
      </motion.div>

      <NodeDetailPanel
        node={selectedNode}
        connections={connections}
        onClose={clearSelection}
        onSelect={selectNode}
      />

      {/* Intro title card — fades to reveal the map. */}
      <AnimatePresence>
        {!introDone && (
          <motion.div
            className="absolute inset-0 z-50 flex items-end justify-end bg-void px-12 pb-24 sm:px-20"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: 'easeInOut' }}
          >
            <div className="text-right">
              {CAPTION_LINES.map((line, i) => (
                <motion.p
                  key={line}
                  className={`font-mono leading-relaxed tracking-wide ${
                    i === 0 ? 'text-[15px] text-starlight-dim' : 'text-[15px] text-starlight-faint'
                  }`}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.7, delay: 0.3 + i * 0.45, ease: 'easeOut' }}
                >
                  {line}
                </motion.p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading / error overlays */}
      <AnimatePresence>
        {loading && (
          <motion.div
            className="absolute inset-0 z-[60] grid place-items-center bg-void"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex flex-col items-center gap-4">
              <motion.span
                className="block h-3 w-3 rounded-full"
                style={{
                  backgroundColor: 'var(--color-engine-c)',
                  boxShadow: '0 0 24px var(--color-engine-c)',
                }}
                animate={{ scale: [1, 1.6, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-starlight-faint">
                loading portfolio
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="absolute inset-0 z-[60] grid place-items-center bg-void px-6">
          <div className="max-w-sm text-center">
            <h2 className="font-display text-2xl text-starlight">
              The map didn't load
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-starlight-dim">
              {error}. Check that{' '}
              <code className="font-mono text-starlight">data/graph.json</code>{' '}
              exists and is valid, then reload.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
