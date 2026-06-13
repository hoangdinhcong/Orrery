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
  Engine,
  GraphData,
  SimLink,
  SimNode,
} from '../lib/graph.types';
import {
  buildAdjacency,
  clamp,
  colorForEngine,
  createGlowTexture,
  createStarTexture,
  damp,
  edgeMeta,
  endpointId,
  labelTint,
  neighborhoodOf,
  statusGlyph,
} from '../lib/graph.utils';

/* ------------------------------------------------------------------ *
 * Tunables — every magic number that shapes the "feel" lives here.
 * ------------------------------------------------------------------ */
const CONFIG = {
  background: 0x070608,
  minScale: 0.3,
  maxScale: 4,
  defaultScale: 1.0,
  introScale: 0.55,
  focusScale: 1.7,
  tourScale: 1.5,
  tourHoldMs: 4200, // how long the camera lingers on each product
  tourStartDelayMs: 1900, // overview hold after the intro before touring
  cameraSmoothing: 0.0012, // lower = snappier (used as base of damp)
  alphaSmoothing: 0.0006,
  zoomSpeed: 0.0016,
  dimAlpha: 0.16, // alpha of nodes outside the active neighbourhood
  dimEdgeAlpha: 0.05,
  idleEdgeAlpha: 0.28,
  activeEdgeAlpha: 0.85,
  labelZoomThreshold: 0.85,
  importantSize: 34,
  starCount: 200,
  introDurationMs: 1500,
} as const;

interface NodeView {
  node: SimNode;
  container: Container;
  glow: Sprite;
  core: Graphics;
  labelBox: Container;
  nameText: Text;
  metaText: Text;
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

  private glowTextures = new Map<Engine, Texture>();
  private starTexture!: Texture;

  // Camera: `camera` is what's applied this frame; `target` is where it's
  // heading. User pan/zoom sets both (instant); focus sets only target.
  private camera: Camera = { x: 0, y: 0, scale: CONFIG.introScale };
  private target: Camera = { x: 0, y: 0, scale: CONFIG.defaultScale };

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private highlight: Set<string> | null = null;

  // Cinematic auto-tour: when the user hasn't touched anything, the camera
  // drifts from product to product on its own.
  private tourOrder: string[] = [];
  private tourIndex = -1;
  private tourTimer = 0;
  private tourFocusId: string | null = null;
  private tourStarted = false;
  private framedOnce = false;
  private userInteracted = false;

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
      backgroundAlpha: 0, // transparent — the CSS nebula/vignette shows through
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

    // Visit the biggest products first when touring.
    this.tourOrder = [...this.opts.simNodes]
      .sort((a, b) => b.size - a.size)
      .map((n) => n.id);

    // Centre the world origin on screen for both current and target camera.
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    this.camera = { x: cx, y: cy, scale: CONFIG.introScale };
    this.target = { x: cx, y: cy, scale: CONFIG.defaultScale };

    this.setupInteractions();

    if (this.opts.reducedMotion) {
      this.opts.restartSimulation(0);
      this.userInteracted = true; // never auto-tour with reduced motion
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
    const engines = new Set<Engine>(this.opts.data.nodes.map((n) => n.engine));
    for (const engine of engines) {
      this.glowTextures.set(engine, createGlowTexture(colorForEngine(engine), 256));
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
      const scale = 0.12 + Math.random() * 0.38;
      sprite.scale.set(scale);
      // A touch of warm tint so the field reads as a dim ember sky.
      sprite.tint = Math.random() < 0.25 ? 0xffd9b0 : 0xffffff;
      const baseAlpha = 0.12 + Math.random() * 0.4;
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
      const color = colorForEngine(node.engine);
      const container = new Container();
      container.x = node.x ?? 0;
      container.y = node.y ?? 0;

      const glow = new Sprite(this.glowTextures.get(node.engine) ?? Texture.WHITE);
      glow.anchor.set(0.5);
      glow.width = glow.height = node.size * 4.6;
      glow.alpha = 0.9;

      const important =
        node.status === 'live' || node.size >= CONFIG.importantSize;

      const core = new Graphics();
      const coreR = node.size * 0.3;
      core
        .circle(0, 0, coreR * 1.6)
        .fill({ color, alpha: 0.28 })
        .circle(0, 0, coreR)
        .fill({ color: 0xffffff, alpha: 0.95 });
      // 'wedge' products get a hollow ring instead of a solid core, echoing
      // the legend glyph; building/live get the bright pupil.
      if (node.status === 'wedge') {
        core
          .circle(0, 0, coreR * 0.62)
          .fill({ color: CONFIG.background, alpha: 1 })
          .circle(0, 0, coreR)
          .stroke({ width: Math.max(coreR * 0.18, 1.2), color, alpha: 0.9 });
      } else if (important) {
        core.circle(-coreR * 0.28, -coreR * 0.28, coreR * 0.34).fill({
          color: 0xffffff,
          alpha: 0.98,
        });
      }

      // Two-line screen-space label: name (with status glyph) + meta.
      const tint = labelTint(node.engine);
      const nameText = new Text({
        text: `${statusGlyph(node.status)} ${node.label}`,
        style: {
          fontFamily: 'Inter, sans-serif',
          fontSize: important ? 14.5 : 12.5,
          fontWeight: important ? '600' : '500',
          fill: `#${tint.toString(16).padStart(6, '0')}`,
          letterSpacing: 0.2,
        },
      });
      nameText.anchor.set(0.5, 0);
      nameText.resolution = 2;

      const metaText = new Text({
        text: `${node.status} · ${node.layer} · engine ${node.engine}`,
        style: {
          fontFamily: 'Space Mono, monospace',
          fontSize: 9.5,
          fontWeight: '400',
          fill: '#8a7f95',
          letterSpacing: 0.6,
        },
      });
      metaText.anchor.set(0.5, 0);
      metaText.resolution = 2;
      metaText.y = important ? 18 : 16;

      const labelBox = new Container();
      labelBox.addChild(nameText, metaText);
      labelBox.alpha = 0;

      container.addChild(glow, core);
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.hitArea = new Circle(0, 0, Math.max(node.size * 1.1, 20));

      const startAlpha = this.opts.reducedMotion ? 1 : 0;
      container.alpha = startAlpha;

      container.on('pointerover', () => this.handleHover(node.id));
      container.on('pointerout', () => this.handleHover(null));
      container.on('pointertap', (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.handleTap(node.id);
      });

      this.nodesLayer.addChild(container);
      this.labelLayer.addChild(labelBox);

      this.nodeViews.set(node.id, {
        node,
        container,
        glow,
        core,
        labelBox,
        nameText,
        metaText,
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

  /** Any deliberate input ends the cinematic auto-tour for good. */
  private markInteracted(): void {
    if (this.userInteracted) return;
    this.userInteracted = true;
    if (this.tourFocusId) {
      this.tourFocusId = null;
      this.recomputeHighlight();
    }
  }

  private onPointerDown = (e: FederatedPointerEvent): void => {
    this.markInteracted();
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
      const [remaining] = [...this.pointers.values()];
      this.dragging = true;
      this.lastDrag = { x: remaining.x, y: remaining.y };
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.markInteracted();
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
    this.markInteracted();
    this.applySelection(id, true);
    this.opts.onSelect(id);
  }

  private recomputeHighlight(): void {
    const focus = this.hoveredId ?? this.selectedId ?? this.tourFocusId;
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

  private focusOn(node: SimNode, tour = false): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = w < 760;
    if (tour) {
      // Touring: keep the focal product comfortably centred, lower third
      // free for labels.
      this.target = {
        scale: CONFIG.tourScale,
        x: w / 2 - (node.x ?? 0) * CONFIG.tourScale,
        y: h * 0.46 - (node.y ?? 0) * CONFIG.tourScale,
      };
      return;
    }
    // Selection: nudge left of centre on wide screens so the node isn't
    // hidden behind the detail panel.
    const anchorX = compact ? w / 2 : w / 2 - 180;
    const anchorY = compact ? h * 0.4 : h / 2;
    const scale = Math.max(this.camera.scale, CONFIG.focusScale);
    this.target = {
      scale,
      x: anchorX - (node.x ?? 0) * scale,
      y: anchorY - (node.y ?? 0) * scale,
    };
  }

  private advanceTour(): void {
    if (this.tourOrder.length === 0) return;
    this.tourIndex = (this.tourIndex + 1) % this.tourOrder.length;
    const id = this.tourOrder[this.tourIndex];
    const node = this.nodeIndex.get(id);
    if (!node) return;
    this.tourFocusId = id;
    this.recomputeHighlight();
    this.focusOn(node, true);
  }

  /* ----------------------------- frame ----------------------------- */

  private tick = (ticker: Ticker): void => {
    if (!this.ready) return;
    const dtMs = ticker.deltaMS;
    const dt = dtMs / 1000;
    this.elapsed += dtMs;

    this.updateTour(dtMs);

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
      (this.camera.x - this.app.screen.width / 2) * 0.16,
      (this.camera.y - this.app.screen.height / 2) * 0.16,
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

  private updateTour(dtMs: number): void {
    if (this.opts.reducedMotion || this.userInteracted) return;
    const sinceIntro = performance.now() - this.introStart;

    // Once the layout has settled, frame the whole portfolio as an overview.
    if (!this.framedOnce && sinceIntro > CONFIG.introDurationMs + 300) {
      this.framedOnce = true;
      this.frameAll();
    }

    if (sinceIntro < CONFIG.introDurationMs + CONFIG.tourStartDelayMs) return;

    if (!this.tourStarted) {
      this.tourStarted = true;
      this.advanceTour();
      this.tourTimer = 0;
      return;
    }
    this.tourTimer += dtMs;
    if (this.tourTimer >= CONFIG.tourHoldMs) {
      this.tourTimer = 0;
      this.advanceTour();
    }
  }

  private updateNodes(dt: number, introT: number): void {
    let i = 0;
    const n = Math.max(this.nodeViews.size, 1);
    for (const view of this.nodeViews.values()) {
      const { node, container, glow, labelBox } = view;

      container.x = node.x ?? 0;
      container.y = node.y ?? 0;

      const inHighlight = !this.highlight || this.highlight.has(node.id);
      const isFocus =
        node.id === this.hoveredId ||
        node.id === this.selectedId ||
        node.id === this.tourFocusId;

      const stagger = clamp((introT - (i / n) * 0.4) / 0.6, 0, 1);
      const targetAlpha = (inHighlight ? 1 : CONFIG.dimAlpha) * stagger;
      view.alpha = damp(view.alpha, targetAlpha, CONFIG.alphaSmoothing, dt);
      container.alpha = view.alpha;

      const targetPulse = isFocus ? 1.2 : 1;
      view.glowPulse = damp(view.glowPulse, targetPulse, 0.0009, dt);
      glow.scale.set((node.size * 4.6 * view.glowPulse) / glow.texture.width);
      glow.alpha = (inHighlight ? 0.95 : 0.4) * stagger;

      // Screen-space label placement keeps text crisp at every zoom level.
      const sx = (node.x ?? 0) * this.camera.scale + this.camera.x;
      const sy = (node.y ?? 0) * this.camera.scale + this.camera.y;
      labelBox.position.set(sx, sy + node.size * 0.55 * this.camera.scale + 10);

      const labelVisible =
        view.important || this.camera.scale >= CONFIG.labelZoomThreshold;
      const labelTarget =
        labelVisible && stagger > 0.5 ? (inHighlight ? 1 : 0.14) : 0;
      view.labelAlpha = damp(view.labelAlpha, labelTarget, 0.0007, dt);
      labelBox.alpha = view.labelAlpha;
      labelBox.visible = view.labelAlpha > 0.02;

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

      const meta = edgeMeta(link.type);
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

      this.strokeEdge(
        g,
        s.x ?? 0,
        s.y ?? 0,
        tt.x ?? 0,
        tt.y ?? 0,
        meta.color,
        alpha * edgeFade,
        width * widthScale,
        meta.dashed,
      );
    }
  }

  /** Draw a straight or dashed edge in world space. */
  private strokeEdge(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    alpha: number,
    width: number,
    dashed: boolean,
  ): void {
    if (!dashed) {
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha });
      return;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return;
    const ux = dx / len;
    const uy = dy / len;
    const dash = 11 / this.camera.scale;
    const gap = 7 / this.camera.scale;
    for (let d = 0; d < len; d += dash + gap) {
      const a = d;
      const b = Math.min(d + dash, len);
      g.moveTo(x1 + ux * a, y1 + uy * a)
        .lineTo(x1 + ux * b, y1 + uy * b)
        .stroke({ width, color, alpha });
    }
  }

  private updateSelectionRing(t: number): void {
    const g = this.selectionRing;
    g.clear();
    const id = this.selectedId ?? this.tourFocusId;
    if (!id) return;
    const node = this.nodeIndex.get(id);
    if (!node) return;
    const color = colorForEngine(node.engine);
    const pulse = 1 + Math.sin(t * 2.4) * 0.04;
    const r = (node.size * 0.7 + 9) * pulse;
    g.circle(node.x ?? 0, node.y ?? 0, r).stroke({
      width: 1.4 / this.camera.scale,
      color,
      alpha: this.selectedId ? 0.75 : 0.4,
    });
  }

  /* --------------------------- public API -------------------------- */

  /** React pushes selection changes (e.g. panel close, legend click) here. */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    if (id !== null) this.markInteracted();
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
    const pad = 220;
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

  /** "Reset view": frame everything and stop the auto-tour. */
  resetView(): void {
    this.markInteracted();
    this.frameAll();
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
}
