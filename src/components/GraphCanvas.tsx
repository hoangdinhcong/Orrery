import { useEffect, useRef, type MutableRefObject } from 'react';
import type { ForceLayout } from '../hooks/useForceLayout';
import type { GraphData } from '../lib/graph.types';
import { GraphScene } from '../pixi/GraphScene';

interface GraphCanvasProps {
  data: GraphData;
  layout: ForceLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /** Filled with the live scene so parent controls (reset, etc.) can drive it. */
  sceneRef?: MutableRefObject<GraphScene | null>;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Mounts the PixiJS scene into a DOM node and keeps it alive for the life
 * of the component. All the heavy lifting lives in `GraphScene`; this just
 * wires React state (selection) into it and tears it down cleanly.
 */
export function GraphCanvas({
  data,
  layout,
  selectedId,
  onSelect,
  onHover,
  sceneRef,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const localSceneRef = useRef<GraphScene | null>(null);

  // Keep the latest callbacks without forcing the scene to rebuild.
  const callbacks = useRef({ onSelect, onHover });
  callbacks.current = { onSelect, onHover };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = prefersReducedMotion();
    const { simulation, simNodes, simLinks } = layout;

    const scene = new GraphScene({
      container,
      data,
      simNodes,
      simLinks,
      reducedMotion,
      restartSimulation: (alpha: number) => {
        if (alpha > 0) {
          simulation.alpha(alpha).restart();
        } else {
          // Reduced motion: settle instantly without animating.
          simulation.alpha(1);
          for (let i = 0; i < 400; i++) simulation.tick();
          simulation.stop();
        }
      },
      onSelect: (id) => callbacks.current.onSelect(id),
      onHover: (id) => callbacks.current.onHover(id),
    });

    localSceneRef.current = scene;
    if (sceneRef) sceneRef.current = scene;
    void scene.init();

    return () => {
      scene.destroy();
      localSceneRef.current = null;
      if (sceneRef) sceneRef.current = null;
    };
    // Rebuild only if the underlying data/layout identity changes.
  }, [data, layout, sceneRef]);

  // Push selection changes (panel close, legend clicks) into the scene.
  useEffect(() => {
    localSceneRef.current?.setSelected(selectedId);
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full"
      aria-label="Interactive product constellation graph"
      role="img"
    />
  );
}
