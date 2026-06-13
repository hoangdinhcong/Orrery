import {
  Application,
  Circle,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Sprite,
  Text,
  Texture,
  type Ticker,
} from 'pixi.js';
import type {
  Camera,
  GraphData,
  NodeType,
  SimLink,
  SimNode,
} from '../lib/graph.types';
import {
  buildAdjacency,
  clamp,
  colorForType,
  createGlowTexture,
  createStarTexture,
  damp,
  EDGE_COLOR,
  endpointId,
  hexString,
  neighborhoodOf,
} from '../lib/graph.utils';

/* ------------------------------------------------------------------ *
 * Tunables — every magic number that shapes the "feel" lives here.
 * ------------------------------------------------------------------ */
const CONFIG = {
  background: 0x05060f,
  minScale: 0.25,
  maxScale: 4,
  defaultScale: 0.9,
  introScale: 0.5,
  focusScale: 1.55,
  cameraSmoothing: 0.0009, // lower = snappier (used as base of damp)
  alphaSmoothing: 0.0005,
  zoomSpeed: 0.0016,
  dimAlpha: 0.18, // alpha of nodes outside the active neighbourhood
  dimEdgeAlpha: 0.04,
  idleEdgeAlpha: 0.16,
  activeEdgeAlpha: 0.7,
  labelZoomThreshold: 1.1,
  importantSize: 30,
  starCount: 280,
  introDurationMs: 1500,
} as const;

interface NodeView {
  node: SimNode;
  container: Container;
  glow: Sprite;
  core: Graphics;
  label: Text;
  important: boolean;
  alpha: number; // current eased alpha
  labelAlpha: number;
  glowPulse: number; // current eased glow multiplier
}

interface StarView {
  sprite: Sprite;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
}

export interface GraphSceneOptions {
  container: HTMLElement;
  data: GraphData;
  simNodes: SimNode[];
  simLinks: SimLink[];
  restartSimulation: (alpha: number) => void;
  reducedMotion: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

/**
 * Owns the whole PixiJS render tree and all imperative interaction logic.
 * React never reaches into Pixi directly — it constructs one of these,
 * pushes state in through small public methods, and tears it down on
 * unmount.
 */
export class GraphScene {
  private app = new Application();
  private readonly opts: GraphSceneOptions;

  // Layers (bottom → top): stars, world (edges + nodes), screen-space labels.
  private starLayer = new Container();
  private world = new Container();
  private edgesGfx = new Graphics();
  private nodesLayer = new Container();
  private selectionRing = new Graphics();
  private labelLayer = new Container();

  private nodeViews = new Map<string, NodeView>();
  private nodeIndex = new Map<string, SimNode>();
  private stars: StarView[] = [];
  private adjacency: Map<string, Set<string>>;

  private glowTextures = new Map<NodeType, Texture>();
  private starTexture!: Texture;

  // Camera: `camera` is what's applied this frame; `target` is where it's
  // heading. User pan/zoom sets both (instant); focus sets only target.
  private camera: Camera = { x: 0, y: 0, scale: CONFIG.introScale };
  private target: Camera = { x: 0, y: 0, scale: CONFIG.defaultScale };

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private highlight: Set<string> | null = null;

  // Interaction bookkeeping.
  private pointers = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private dragMoved = false;
  private lastDrag = { x: 0, y: 0 };
  private pinchDist = 0;

  private introStart = 0;
  private elapsed = 0;
  private destroyed = false;
  private ready = false;

  constructor(options: GraphSceneOptions) {
    this.opts = options;
    this.adjacency = buildAdjacency(options.data.edges);
    for (const n of options.simNodes) this.nodeIndex.set(n.id, n);
  }

  /** Async because Pixi v8's renderer initialises asynchronously. */
  async init(): Promise<void> {
    const { container } = this.opts;

    await this.app.init({
      background: CONFIG.background,
      resizeTo: container,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }

    container.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';

    // Assemble the scene graph.
    this.world.addChild(this.edgesGfx, this.selectionRing, this.nodesLayer);
    this.app.stage.addChild(this.starLayer, this.world, this.labelLayer);

    this.buildTextures();
    this.buildStars();
    this.buildNodes();

    // Centre the world origin on screen for both current and target camera.
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    this.camera = { x: cx, y: cy, scale: CONFIG.introScale };
    this.target = { x: cx, y: cy, scale: CONFIG.defaultScale };

    this.setupInteractions();

    // Kick off the layout. With reduced motion we settle it instantly so
    // nothing flies across the screen.
    if (this.opts.reducedMotion) {
      this.opts.restartSimulation(0); // we'll pre-tick below
      // Pre-cool: advance the simulation without animating.
      // (The hook gives us a stopped simulation; ticking it here settles it.)
    } else {
      this.opts.restartSimulation(1);
    }

    this.introStart = performance.now();
    this.ready = true;
    this.app.ticker.add(this.tick);
    window.addEventListener('resize', this.onResize);
  }

  /* ----------------------------- build ----------------------------- */

  private buildTextures(): void {
    this.starTexture = createStarTexture(32);
    const types = new Set<NodeType>(this.opts.data.nodes.map((n) => n.type));
    for (const type of types) {
      this.glowTextures.set(type, createGlowTexture(colorForType(type), 256));
    }
  }

  private buildStars(): void {
    this.starLayer.removeChildren();
    this.stars = [];
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    for (let i = 0; i < CONFIG.starCount; i++) {
      const sprite = new Sprite(this.starTexture);
      sprite.anchor.set(0.5);
      sprite.x = -w * 0.5 + Math.random() * w * 2;
      sprite.y = -h * 0.5 + Math.random() * h * 2;
      const scale = 0.18 + Math.random() * 0.5;
      sprite.scale.set(scale);
      // A touch of cool tint so the field reads as deep space, not snow.
      sprite.tint = Math.random() < 0.2 ? 0x9fc0ff : 0xffffff;
      const baseAlpha = 0.25 + Math.random() * 0.55;
      sprite.alpha = baseAlpha;
      this.starLayer.addChild(sprite);
      this.stars.push({
        sprite,
        baseAlpha,
        twinkleSpeed: 0.4 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private buildNodes(): void {
    for (const node of this.opts.simNodes) {
      const color = colorForType(node.type);
      const container = new Container();
      container.x = node.x ?? 0;
      container.y = node.y ?? 0;

      const glow = new Sprite(this.glowTextures.get(node.type) ?? Texture.WHITE);
      glow.anchor.set(0.5);
      glow.width = glow.height = node.size * 4.4;
      glow.alpha = 0.85;

      const core = new Graphics();
      const coreR = node.size * 0.34;
      core
        .circle(0, 0, coreR * 1.5)
        .fill({ color, alpha: 0.22 })
        .circle(0, 0, coreR)
        .fill({ color: 0xffffff, alpha: 0.92 })
        .circle(0, 0, coreR)
        .stroke({ width: 1.5, color, alpha: 0.9 });
      // A small bright pupil gives bigger nodes a "sun" sparkle.
      if (node.size >= 26) {
        core.circle(-coreR * 0.25, -coreR * 0.25, coreR * 0.3).fill({
          color: 0xffffff,
          alpha: 0.95,
        });
      }

      const important = node.type === 'main' || node.size >= CONFIG.importantSize;
      const label = new Text({
        text: node.label,
        style: {
          fontFamily: 'Space Grotesk, sans-serif',
          fontSize: important ? 15 : 13,
          fontWeight: important ? '600' : '500',
          fill: '#e8ecff',
          align: 'center',
        },
      });
      label.anchor.set(0.5, 0);
      label.resolution = 2;
      label.alpha = 0;

      container.addChild(glow, core);
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.hitArea = new Circle(0, 0, Math.max(node.size * 1.1, 18));

      const startAlpha = this.opts.reducedMotion ? 1 : 0;
      container.alpha = startAlpha;

      container.on('pointerover', () => this.handleHover(node.id));
      container.on('pointerout', () => this.handleHover(null));
      container.on('pointertap', (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.handleTap(node.id);
      });

      this.nodesLayer.addChild(container);
      this.labelLayer.addChild(label);

      this.nodeViews.set(node.id, {
        node,
        container,
        glow,
        core,
        label,
        important,
        alpha: startAlpha,
        labelAlpha: 0,
        glowPulse: 1,
      });
    }
  }

  /* -------------------------- interactions ------------------------- */

  private setupInteractions(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;

    stage.on('pointerdown', this.onPointerDown);
    stage.on('globalpointermove', this.onPointerMove);
    stage.on('pointerup', this.onPointerUp);
    stage.on('pointerupoutside', this.onPointerUp);
    // Tapping empty space clears the selection.
    stage.on('pointertap', () => {
      if (!this.dragMoved) {
        this.applySelection(null, false);
        this.opts.onSelect(null);
      }
    });

    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onPointerDown = (e: FederatedPointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.dragMoved = false;
      this.lastDrag = { x: e.global.x, y: e.global.y };
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDist = this.currentPinchDistance();
    }
  };

  private onPointerMove = (e: FederatedPointerEvent): void => {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    }

    if (this.pointers.size >= 2) {
      this.handlePinch();
      return;
    }
    if (!this.dragging) return;

    const dx = e.global.x - this.lastDrag.x;
    const dy = e.global.y - this.lastDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
    this.lastDrag = { x: e.global.x, y: e.global.y };

    this.camera.x += dx;
    this.camera.y += dy;
    this.syncTargetToCamera(); // panning cancels any in-flight focus
  };

  private onPointerUp = (e: FederatedPointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
    if (this.pointers.size === 1) {
      // Resume single-pointer drag from the remaining finger.
      const [remaining] = [...this.pointers.values()];
      this.dragging = true;
      this.lastDrag = { x: remaining.x, y: remaining.y };
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const ax = e.clientX - rect.left;
    const ay = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * CONFIG.zoomSpeed);
    this.zoomAround(ax, ay, this.camera.scale * factor);
  };

  private currentPinchDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private handlePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (this.pinchDist > 0) {
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      this.zoomAround(midX, midY, this.camera.scale * (dist / this.pinchDist));
    }
    this.pinchDist = dist;
  }

  /** Zoom toward a screen anchor, keeping the world point under it fixed. */
  private zoomAround(ax: number, ay: number, nextScale: number): void {
    const scale = clamp(nextScale, CONFIG.minScale, CONFIG.maxScale);
    const wx = (ax - this.camera.x) / this.camera.scale;
    const wy = (ay - this.camera.y) / this.camera.scale;
    this.camera.scale = scale;
    this.camera.x = ax - wx * scale;
    this.camera.y = ay - wy * scale;
    this.syncTargetToCamera();
  }

  private syncTargetToCamera(): void {
    this.target = { ...this.camera };
  }

  private handleHover(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.recomputeHighlight();
    this.opts.onHover(id);
  }

  private handleTap(id: string): void {
    this.applySelection(id, true);
    this.opts.onSelect(id);
  }

  private recomputeHighlight(): void {
    const focus = this.hoveredId ?? this.selectedId;
    this.highlight = neighborhoodOf(focus, this.adjacency);
  }

  private applySelection(id: string | null, focus: boolean): void {
    this.selectedId = id;
    this.recomputeHighlight();
    if (id && focus) {
      const node = this.nodeIndex.get(id);
      if (node) this.focusOn(node);
    }
  }

  private focusOn(node: SimNode): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = w < 760;
    // Nudge the focal point left of centre on wide screens so the node
    // doesn't end up hidden behind the detail panel.
    const anchorX = compact ? w / 2 : w / 2 - 170;
    const anchorY = compact ? h * 0.4 : h / 2;
    const scale = Math.max(this.camera.scale, CONFIG.focusScale);
    this.target = {
      scale,
      x: anchorX - (node.x ?? 0) * scale,
      y: anchorY - (node.y ?? 0) * scale,
    };
  }

  /* ----------------------------- frame ----------------------------- */

  private tick = (ticker: Ticker): void => {
    if (!this.ready) return;
    const dtMs = ticker.deltaMS;
    const dt = dtMs / 1000;
    this.elapsed += dtMs;

    // Ease the camera toward its target.
    this.camera.x = damp(this.camera.x, this.target.x, CONFIG.cameraSmoothing, dt);
    this.camera.y = damp(this.camera.y, this.target.y, CONFIG.cameraSmoothing, dt);
    this.camera.scale = damp(
      this.camera.scale,
      this.target.scale,
      CONFIG.cameraSmoothing,
      dt,
    );
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.scale);

    // Parallax + twinkle for the ambient starfield.
    this.starLayer.position.set(
      (this.camera.x - this.app.screen.width / 2) * 0.18,
      (this.camera.y - this.app.screen.height / 2) * 0.18,
    );
    const t = this.elapsed / 1000;
    for (const star of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * star.twinkleSpeed + star.phase);
      star.sprite.alpha = star.baseAlpha * tw;
    }

    // Intro fade: nodes brighten with a slight stagger, edges follow.
    const introT = this.opts.reducedMotion
      ? 1
      : clamp((performance.now() - this.introStart) / CONFIG.introDurationMs, 0, 1);

    this.updateNodes(dt, introT);
    this.drawEdges(introT);
    this.updateSelectionRing(t);
  };

  private updateNodes(dt: number, introT: number): void {
    let i = 0;
    const n = Math.max(this.nodeViews.size, 1);
    for (const view of this.nodeViews.values()) {
      const { node, container, glow, label } = view;

      // Position from the live simulation.
      container.x = node.x ?? 0;
      container.y = node.y ?? 0;

      const inHighlight = !this.highlight || this.highlight.has(node.id);
      const isFocus =
        node.id === this.hoveredId || node.id === this.selectedId;

      // Target alpha: full when relevant, dimmed otherwise; multiplied by
      // a staggered intro fade-in.
      const stagger = clamp((introT - (i / n) * 0.4) / 0.6, 0, 1);
      const targetAlpha = (inHighlight ? 1 : CONFIG.dimAlpha) * stagger;
      view.alpha = damp(view.alpha, targetAlpha, CONFIG.alphaSmoothing, dt);
      container.alpha = view.alpha;

      // Focused nodes flare a little brighter and larger.
      const targetPulse = isFocus ? 1.18 : 1;
      view.glowPulse = damp(view.glowPulse, targetPulse, 0.0008, dt);
      glow.scale.set((node.size * 4.4 * view.glowPulse) / glow.texture.width);
      glow.alpha = (inHighlight ? 0.9 : 0.45) * stagger;

      // Screen-space label placement keeps text crisp at every zoom level.
      const sx = (node.x ?? 0) * this.camera.scale + this.camera.x;
      const sy = (node.y ?? 0) * this.camera.scale + this.camera.y;
      label.position.set(
        sx,
        sy + node.size * 0.5 * this.camera.scale + 12,
      );
      const labelVisible =
        view.important || this.camera.scale >= CONFIG.labelZoomThreshold;
      const labelTarget =
        labelVisible && stagger > 0.5 ? (inHighlight ? 1 : 0.12) : 0;
      view.labelAlpha = damp(view.labelAlpha, labelTarget, 0.0006, dt);
      label.alpha = view.labelAlpha;
      label.visible = view.labelAlpha > 0.02;

      i++;
    }
  }

  private drawEdges(introT: number): void {
    const g = this.edgesGfx;
    g.clear();
    const widthScale = 1 / this.camera.scale; // keep lines thin on screen
    const edgeFade = clamp((introT - 0.35) / 0.65, 0, 1);
    if (edgeFade <= 0) return;

    for (const link of this.opts.simLinks) {
      const sId = endpointId(link.source);
      const tId = endpointId(link.target);
      const s = this.nodeIndex.get(sId);
      const tt = this.nodeIndex.get(tId);
      if (!s || !tt) continue;

      let alpha: number;
      let width: number;
      if (!this.highlight) {
        alpha = CONFIG.idleEdgeAlpha;
        width = 1.1;
      } else if (this.highlight.has(sId) && this.highlight.has(tId)) {
        alpha = CONFIG.activeEdgeAlpha;
        width = 1.8;
      } else {
        alpha = CONFIG.dimEdgeAlpha;
        width = 1;
      }

      g.moveTo(s.x ?? 0, s.y ?? 0)
        .lineTo(tt.x ?? 0, tt.y ?? 0)
        .stroke({
          width: width * widthScale,
          color: EDGE_COLOR,
          alpha: alpha * edgeFade,
        });
    }
  }

  private updateSelectionRing(t: number): void {
    const g = this.selectionRing;
    g.clear();
    if (!this.selectedId) return;
    const node = this.nodeIndex.get(this.selectedId);
    if (!node) return;
    const color = colorForType(node.type);
    const pulse = 1 + Math.sin(t * 2.4) * 0.04;
    const r = (node.size * 0.7 + 8) * pulse;
    g.circle(node.x ?? 0, node.y ?? 0, r).stroke({
      width: 1.5 / this.camera.scale,
      color,
      alpha: 0.7,
    });
  }

  /* --------------------------- public API -------------------------- */

  /** React pushes selection changes (e.g. panel close, legend click) here. */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.applySelection(id, id !== null);
  }

  /** Reset the camera to frame the whole constellation. */
  frameAll(): void {
    if (this.nodeViews.size === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { node } of this.nodeViews.values()) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      minX = Math.min(minX, x - node.size);
      minY = Math.min(minY, y - node.size);
      maxX = Math.max(maxX, x + node.size);
      maxY = Math.max(maxY, y + node.size);
    }
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const pad = 120;
    const scale = clamp(
      Math.min((w - pad) / (maxX - minX), (h - pad) / (maxY - minY)),
      CONFIG.minScale,
      CONFIG.maxScale,
    );
    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2;
    this.target = {
      scale,
      x: w / 2 - cxWorld * scale,
      y: h / 2 - cyWorld * scale,
    };
  }

  private onResize = (): void => {
    this.app.stage.hitArea = this.app.screen;
    this.buildStars();
  };

  destroy(): void {
    this.destroyed = true;
    if (!this.ready) return;
    this.app.ticker.remove(this.tick);
    window.removeEventListener('resize', this.onResize);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    for (const tex of this.glowTextures.values()) tex.destroy(true);
    this.starTexture?.destroy(true);
    this.app.destroy({ removeView: true }, { children: true });
  }

  /** Exposed mainly so the UI can build a legend from the live palette. */
  static colorHex(type: NodeType): string {
    return hexString(colorForType(type));
  }
}
