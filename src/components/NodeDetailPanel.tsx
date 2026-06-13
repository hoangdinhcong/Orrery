import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { GraphNodeData } from '../lib/graph.types';
import { colorForEngine, hexString, statusGlyph } from '../lib/graph.utils';

interface NodeDetailPanelProps {
  node: GraphNodeData | null;
  connections: GraphNodeData[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

/**
 * The "product card" for whichever node is selected. Slides in from the
 * right on wide screens and up from the bottom on narrow ones. Closing it
 * is always one tap away (button, backdrop, or Escape upstream).
 */
export function NodeDetailPanel({
  node,
  connections,
  onClose,
  onSelect,
}: NodeDetailPanelProps) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          key={node.id}
          className="scroll-faint pointer-events-auto fixed z-30 overflow-y-auto border-haze bg-void-2/90 backdrop-blur-xl
                     inset-x-0 bottom-0 max-h-[62vh] rounded-t-3xl border-t px-6 pb-8 pt-5
                     sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-[360px] sm:rounded-none sm:border-l sm:border-t-0 sm:px-7 sm:pt-7"
          initial={reduce ? { opacity: 0 } : { x: '100%', y: 0, opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          aria-label={`Details for ${node.label}`}
        >
          {/* Mobile grab handle */}
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-haze sm:hidden" />

          <header className="flex items-start justify-between gap-4">
            <div>
              <span
                className="font-mono text-[11px] uppercase tracking-[0.18em]"
                style={{ color: hexString(colorForEngine(node.engine)) }}
              >
                {statusGlyph(node.status)} {node.status} · {node.layer}
              </span>
              <h2 className="mt-1 font-display text-3xl font-medium leading-tight text-starlight">
                {node.label}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-full text-starlight-dim
                         transition-colors hover:bg-haze/60 hover:text-starlight focus-visible:outline focus-visible:outline-2 focus-visible:outline-bezel"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <p className="mt-4 text-[15px] leading-relaxed text-starlight-dim">
            {node.description}
          </p>

          {node.tags && node.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {node.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-haze px-2.5 py-1 font-mono text-[11px] text-starlight-faint"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {node.meta && Object.keys(node.meta).length > 0 && (
            <dl className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-haze bg-haze/50">
              {Object.entries(node.meta).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between bg-void-2 px-4 py-2.5"
                >
                  <dt className="text-[13px] text-starlight-faint">{key}</dt>
                  <dd className="font-mono text-[13px] text-starlight">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {connections.length > 0 && (
            <section className="mt-7">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-starlight-faint">
                Connected · {connections.length}
              </h3>
              <ul className="mt-3 space-y-1.5">
                {connections.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left
                                 transition-colors hover:bg-haze/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bezel"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: hexString(colorForEngine(c.engine)),
                          boxShadow: `0 0 10px ${hexString(colorForEngine(c.engine))}`,
                        }}
                      />
                      <span className="flex-1 font-mono text-[13px] text-starlight-dim transition-colors group-hover:text-starlight">
                        {c.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-starlight-faint">
                        {c.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
