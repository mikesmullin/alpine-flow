/**
 * Alpine Flow - Main Plugin
 * A drop-in graph/node editor for Alpine.js projects.
 *
 * Usage:
 *   Alpine.plugin(AlpineFlow)
 *   <div x-data="alpineFlow({ nodes: [...], edges: [...] })" class="w-full h-screen"></div>
 */

import { DEFAULTS, Position, BackgroundVariant, ConnectionLineType, ConnectionMode } from './constants.js';
import { clamp, getNodesBounds, getNodeDimensions, getViewportRect, snapPosition, isEdgeVisible } from './geometry.js';
import { createElement, createSvgElement, uniqueId, getZoomFromElement } from './dom.js';
import { screenToFlowPosition, flowToScreenPosition, getPointerPosition, zoomAtPoint, getTransformForBounds, createPanZoomHandler, wheelDelta } from './viewport.js';
import { buildNodeLookup, createNodeResizeObserver, createNodeDragHandler, defaultNodeTypes } from './nodes.js';
import { getHandlePosition, getEdgePosition, createConnectionHandler } from './handles.js';
import { getBezierPath, getSmoothStepPath, getStraightPath, getStepPath, getPathForEdgeType } from './edges.js';
import { getIncomers, getOutgoers, getConnectedEdges, addEdge, reconnectEdge, applyNodeChanges, applyEdgeChanges, deleteElements, isNode, isEdge } from './graph.js';
import { createBackground } from './background.js';
import { createControls } from './controls.js';
import { createMinimap } from './minimap.js';
import { layoutNodes, LAYOUT_DEFAULTS } from './layout.js';
import { createForceSimulation, FORCE_DEFAULTS } from './force.js';

const FORCE_LAYOUT_DEFAULTS = {
  enabled: false,
  autoStart: true,
  linkDistance: FORCE_DEFAULTS.linkDistance,
  linkStrength: FORCE_DEFAULTS.linkStrength,
  chargeStrength: FORCE_DEFAULTS.chargeStrength,
  collisionRadius: FORCE_DEFAULTS.collisionRadius,
  centerStrength: FORCE_DEFAULTS.centerStrength,
  centerX: FORCE_DEFAULTS.centerX,
  centerY: FORCE_DEFAULTS.centerY,
  anchorNodeId: FORCE_DEFAULTS.anchorNodeId,
  alpha: FORCE_DEFAULTS.alpha,
  alphaMin: FORCE_DEFAULTS.alphaMin,
  alphaDecay: FORCE_DEFAULTS.alphaDecay,
  alphaTarget: FORCE_DEFAULTS.alphaTarget,
  velocityDecay: FORCE_DEFAULTS.velocityDecay,
  ambientMotion: true,
  ambientIntervalMs: 50,
  ambientPhaseStep: 0.001,
  ambientAlphaPulse: 0.1,
};

/**
 * Alpine.js Plugin
 */
export default function AlpineFlow(Alpine) {
  Alpine.data('alpineFlow', (config = {}) => ({
    // ──────────────────────────────────────────
    // Reactive State
    // ──────────────────────────────────────────
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: config.nodes ? config.nodes.map(normalizeNode) : [],
    edges: config.edges ? config.edges.map(normalizeEdge) : [],
    connectionState: null,

    // ──────────────────────────────────────────
    // Options (merged with defaults)
    // ──────────────────────────────────────────
    options: {
      minZoom: DEFAULTS.minZoom,
      maxZoom: DEFAULTS.maxZoom,
      snapToGrid: false,
      snapGrid: [...DEFAULTS.snapGrid],
      nodesDraggable: true,
      nodesConnectable: true,
      elementsSelectable: true,
      panOnDrag: true,
      panOnScroll: false,
      panOnScrollMode: 'free',
      panOnScrollSpeed: DEFAULTS.panOnScrollSpeed,
      zoomOnScroll: true,
      zoomOnPinch: true,
      zoomOnDoubleClick: true,
      fitView: false,
      fitViewPadding: DEFAULTS.fitViewPadding,
      connectionMode: DEFAULTS.connectionMode,
      connectionLineType: DEFAULTS.connectionLineType,
      connectionRadius: DEFAULTS.connectionRadius,
      deleteKeyCode: 'Backspace',
      selectionKeyCode: 'Shift',
      multiSelectionKeyCode: 'Meta',
      noDragClassName: 'nodrag',
      noWheelClassName: 'nowheel',
      noPanClassName: 'nopan',
      nodeDragThreshold: DEFAULTS.nodeDragThreshold,
      autoPanOnNodeDrag: true,
      autoPanSpeed: DEFAULTS.autoPanSpeed,
      autoPanEdgeDistance: DEFAULTS.autoPanEdgeDistance,
      nodeOrigin: [...DEFAULTS.nodeOrigin],
      defaultEdgeType: 'default',
      background: { variant: BackgroundVariant.Dots, gap: 20, size: 1, color: null },
      showBackground: true,
      showControls: true,
      showMinimap: false,
      minimapPanSensitivity: 0.02,
      isValidConnection: null,
      autoLayout: false,           // true | { direction, nodeSpacing, rankSpacing, ... }
      forceLayout: false,
      ...config.options,
    },

    // ──────────────────────────────────────────
    // Internal State (non-reactive where possible)
    // ──────────────────────────────────────────
    _containerEl: null,
    _viewportEl: null,
    _nodesContainerEl: null,
    _edgesSvgEl: null,
    _edgesGroupEl: null,
    _connectionLineSvgEl: null,
    _connectionPathEl: null,
    _markerDefs: null,
    _nodeLookup: new Map(),
    _edgeLookup: new Map(),
    _nodeElements: new Map(),
    _edgeElements: new Map(),
    _edgeInteractionElements: new Map(),
    _edgeLabelElements: new Map(),
    _resizeObserver: null,
    _panZoomHandler: null,
    _dragHandler: null,
    _connectionHandler: null,
    _backgroundComponent: null,
    _controlsComponent: null,
    _minimapComponent: null,
    _containerWidth: 0,
    _containerHeight: 0,
    _flowId: uniqueId('flow'),
    _nodeTypes: { ...defaultNodeTypes, ...(config.nodeTypes || {}) },
    _initialized: false,
    _selectionBoxEl: null,
    _isSelecting: false,
    _selectionStart: null,
    _hoveredNodeId: null,
    _hoverNeighborIds: new Set(),
    _forceSimulation: null,
    _forceTickCount: 0,
    _boundVisibilityChange: null,
    _ambientPhase: 0,
    _ambientIntervalId: null,
    _persistentPinnedNodeIds: new Set(),
    _autoLayoutOptionsCache: null,
    _lastNodePointerDown: null,

    // User callbacks
    _onConnect: config.onConnect || null,
    _onNodesChange: config.onNodesChange || null,
    _onEdgesChange: config.onEdgesChange || null,
    _onNodeClick: config.onNodeClick || null,
    _onNodeDoubleClick: config.onNodeDoubleClick || null,
    _onNodeDragStart: config.onNodeDragStart || null,
    _onNodeDrag: config.onNodeDrag || null,
    _onNodeDragStop: config.onNodeDragStop || null,
    _onEdgeClick: config.onEdgeClick || null,
    _onPaneClick: config.onPaneClick || null,
    _onViewportChange: config.onViewportChange || null,
    _onConnectStart: config.onConnectStart || null,
    _onConnectEnd: config.onConnectEnd || null,
    _onSelectionChange: config.onSelectionChange || null,
    _onInit: config.onInit || null,

    // ──────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────
    init() {
      this._containerEl = this.$el;
      this._containerEl.classList.add('alpine-flow');
      this._containerEl.setAttribute('tabindex', '0');

      this._buildDOM();
      this._updateContainerDimensions();

      if (this.options.autoLayout) {
        this._autoLayoutOptionsCache = this.options.autoLayout === true
          ? true
          : { ...this.options.autoLayout };
      }

      this._applyAutoLayout();
      this._initNodeLookup();
      this._initPanZoom();
      this._initNodeDrag();
      this._initConnectionHandler();
      this._initResizeObserver();
      this._initKeyboardHandler();
      this._renderAllNodes();
      this._renderAllEdges();
      this._initForceSimulation();

      if (this.options.showBackground) {
        this._backgroundComponent = createBackground(this._containerEl, () => this._getState());
      }
      if (this.options.showControls) {
        this._controlsComponent = createControls(this._containerEl, () => this._getState(), {
          zoomIn: () => this.zoomIn(),
          zoomOut: () => this.zoomOut(),
          fitView: () => this.fitView(),
          toggleInteractivity: () => this.toggleInteractivity(),
        });
      }
      if (this.options.showMinimap) {
        this._minimapComponent = createMinimap(this._containerEl, () => this._getState(), {
          setViewport: (vp) => { this._setViewport(vp); },
        });
      }

      // Container resize observer
      this._containerResizeObserver = new ResizeObserver(() => {
        this._updateContainerDimensions();
      });
      this._containerResizeObserver.observe(this._containerEl);

      if (this.options.fitView) {
        // Defer fitView to next tick to allow measurements
        requestAnimationFrame(() => this.fitView());
      }

      this._initialized = true;

      // Expose the public API for cross-component access:
      //   1. On the container DOM element: el.__alpineFlow
      //   2. On window (keyed by element id or flow id): window.__alpineFlow[id]
      const api = this._getPublicAPI();
      this._containerEl.__alpineFlow = api;
      if (!window.__alpineFlow) window.__alpineFlow = {};
      const key = this._containerEl.id || this._flowId;
      window.__alpineFlow[key] = api;
      // Also set a default reference for single-flow pages
      if (!window.__alpineFlow.default) window.__alpineFlow.default = api;

      this._onInit?.(api);
    },

    destroy() {
      this._destroyForceSimulation();
      this._panZoomHandler?.destroy();
      this._dragHandler?.destroy();
      this._connectionHandler?.destroy();
      this._resizeObserver?.disconnect();
      this._containerResizeObserver?.disconnect();
      this._backgroundComponent?.destroy();
      this._controlsComponent?.destroy();
      this._minimapComponent?.destroy();
    },

    // ──────────────────────────────────────────
    // DOM Construction
    // ──────────────────────────────────────────
    _buildDOM() {
      // Zoom pane (receives pan/zoom events)
      const zoomPane = createElement('div', {
        className: 'alpine-flow__renderer',
        style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', overflow: 'hidden' },
      }, this._containerEl);

      // Pane (click/selection target)
      const pane = zoomPane;

      // Viewport (CSS transform container)
      this._viewportEl = createElement('div', {
        className: 'alpine-flow__viewport',
        style: { position: 'absolute', top: '0', left: '0', transformOrigin: '0 0' },
      }, pane);

      // Edges SVG container (below nodes)
      // Use explicit large dimensions instead of 100% to avoid 0-size parent issues
      // The SVG coordinate space matches the flow coordinate space (nodes at positive x,y)
      this._edgesSvgEl = createSvgElement('svg', {
        class: 'alpine-flow__edges',
        style: { position: 'absolute', top: '0', left: '0', overflow: 'visible', pointerEvents: 'none' },
        width: '10000',
        height: '10000',
      }, this._viewportEl);

      // SVG defs for markers
      this._markerDefs = createSvgElement('defs', {}, this._edgesSvgEl);
      this._createDefaultMarkers();

      this._edgesGroupEl = createSvgElement('g', { class: 'alpine-flow__edge-group' }, this._edgesSvgEl);

      // Connection line SVG
      this._connectionLineSvgEl = createSvgElement('svg', {
        class: 'alpine-flow__connection-line',
        style: { position: 'absolute', top: '0', left: '0', overflow: 'visible', pointerEvents: 'none' },
        width: '10000',
        height: '10000',
      }, this._viewportEl);
      this._connectionPathEl = createSvgElement('path', {
        class: 'alpine-flow__connection-path',
        fill: 'none',
        stroke: '#b1b1b7',
        'stroke-width': '2',
      }, this._connectionLineSvgEl);

      // Nodes container
      this._nodesContainerEl = createElement('div', {
        className: 'alpine-flow__nodes',
        style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' },
      }, this._viewportEl);

      // Selection box
      this._selectionBoxEl = createElement('div', {
        className: 'alpine-flow__selection-box',
        style: { position: 'absolute', display: 'none', border: '1px dashed #4f8ff7', background: 'rgba(79,143,247,0.08)', pointerEvents: 'none', zIndex: '10' },
      }, this._viewportEl);

      // Pane click handler
      pane.addEventListener('pointerdown', (event) => this._onPanePointerDown(event));
      pane.addEventListener('click', (event) => {
        const clickedInsideInteractiveElement = !!event.target.closest(
          '.alpine-flow__node, .alpine-flow__edge, .alpine-flow__edge-label, .alpine-flow__handle'
        );
        if (clickedInsideInteractiveElement) return;

        this._setHoveredNode(null);
        this._deselectAll();
        this._onPaneClick?.(event);
        this._maybeReheatForce(0.06);
      });

      this._zoomPaneEl = zoomPane;
      this._paneEl = pane;
    },

    _createDefaultMarkers() {
      const markerTypes = ['default', 'default-selected'];
      const colors = ['#b1b1b7', '#555'];

      for (let i = 0; i < markerTypes.length; i++) {
        const marker = createSvgElement('marker', {
          id: `${this._flowId}-arrow-${markerTypes[i]}`,
          markerWidth: '12.5',
          markerHeight: '12.5',
          viewBox: '-10 -10 20 20',
          markerUnits: 'strokeWidth',
          orient: 'auto-start-reverse',
          refX: '0',
          refY: '0',
        }, this._markerDefs);

        createSvgElement('polyline', {
          stroke: colors[i],
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-width': '1',
          fill: colors[i],
          points: '-5,-4 0,0 -5,4 -5,-4',
        }, marker);
      }
    },

    // ──────────────────────────────────────────
    // State Getter (for sub-modules)
    // ──────────────────────────────────────────
    _getState() {
      return {
        viewport: this.viewport,
        nodes: this.nodes,
        edges: this.edges,
        options: this.options,
        nodeLookup: this._nodeLookup,
        edgeLookup: this._edgeLookup,
        containerBounds: this._containerEl?.getBoundingClientRect(),
        containerWidth: this._containerWidth,
        containerHeight: this._containerHeight,
        connectionState: this.connectionState,
      };
    },

    _getPublicAPI() {
      return {
        fitView: (opts) => this.fitView(opts),
        zoomIn: (opts) => this.zoomIn(opts),
        zoomOut: (opts) => this.zoomOut(opts),
        zoomTo: (level, opts) => this.zoomTo(level, opts),
        setViewport: (vp) => this._setViewport(vp),
        getViewport: () => ({ ...this.viewport }),
        screenToFlowPosition: (pos) => this.screenToFlowPosition(pos),
        flowToScreenPosition: (pos) => this.flowToScreenPosition(pos),
        getNode: (id) => this.getNode(id),
        getEdge: (id) => this.getEdge(id),
        getNodes: () => [...this.nodes],
        getEdges: () => [...this.edges],
        getSelectedNodes: () => this.nodes.filter((n) => n.selected),
        getSelectedEdges: () => this.edges.filter((e) => e.selected),
        addNodes: (n) => this.addNodes(n),
        addEdges: (e) => this.addEdges(e),
        selectAll: () => this._selectAll(),
        deselectAll: () => this._deselectAll(),
        deleteElements: (els) => this.deleteSelectedElements(els),
        toJSON: () => this.toJSON(),
        fromJSON: (json) => this.fromJSON(json),
        layoutNodes: (opts) => this.layoutNodesAndRender(opts),
        setAutoLayoutEnabled: (enabled) => this.setAutoLayoutEnabled(enabled),
        getAutoLayoutEnabled: () => this.getAutoLayoutEnabled(),
        startForce: () => this.startForce(),
        stopForce: () => this.stopForce(),
        reheatForce: (alpha) => this.reheatForce(alpha),
        setForceOptions: (opts) => this.setForceOptions(opts),
        pinNode: (id, point) => this.pinNode(id, point),
        unpinNode: (id) => this.unpinNode(id),
      };
    },

    // ──────────────────────────────────────────
    // Container Dimensions
    // ──────────────────────────────────────────
    _updateContainerDimensions() {
      this._containerWidth = this._containerEl.clientWidth;
      this._containerHeight = this._containerEl.clientHeight;
    },

    getAutoLayoutEnabled() {
      return !!this.options.autoLayout;
    },

    setAutoLayoutEnabled(enabled) {
      const shouldEnable = enabled === true;
      const isEnabled = this.getAutoLayoutEnabled();

      if (shouldEnable === isEnabled) {
        return isEnabled;
      }

      if (shouldEnable) {
        if (!this.options.autoLayout) {
          if (this._autoLayoutOptionsCache === true) {
            this.options.autoLayout = true;
          } else if (this._autoLayoutOptionsCache && typeof this._autoLayoutOptionsCache === 'object') {
            this.options.autoLayout = { ...this._autoLayoutOptionsCache };
          } else {
            this.options.autoLayout = true;
          }
        }

        // Run auto layout exactly once on OFF -> ON transition, forcing all
        // visible nodes through layout (not only nodes marked as needing layout).
        const layoutOpts = this.options.autoLayout && typeof this.options.autoLayout === 'object'
          ? { ...this.options.autoLayout }
          : {};
        this.layoutNodesAndRender({ ...layoutOpts, force: true });
        return this.getAutoLayoutEnabled();
      } else {
        if (this.options.autoLayout) {
          this._autoLayoutOptionsCache = this.options.autoLayout === true
            ? true
            : { ...this.options.autoLayout };
        }
        this.options.autoLayout = false;
      }

      this._initNodeLookup();
      this._renderAllNodes();
      this._renderAllEdges();
      this._minimapComponent?.update();
      this._controlsComponent?.update();
      this._refreshForceGraphData({ restart: true, reheat: true });

      return this.getAutoLayoutEnabled();
    },

    // ──────────────────────────────────────────
    // Auto Layout
    // ──────────────────────────────────────────
    _applyAutoLayout() {
      if (!this.options.autoLayout) return;
      const opts = typeof this.options.autoLayout === 'object' ? this.options.autoLayout : {};

      // Only layout visible nodes/edges (precedence may have hidden some)
      const visibleNodes = this.nodes
        .filter((n) => !n.hidden)
        .map((n) => ({ ...n, _needsLayout: true }));
      const visibleEdges = this.edges.filter((e) => !e.hidden);
      const laid = layoutNodes(visibleNodes, visibleEdges, opts);

      // Merge computed positions back into the full array
      const posMap = new Map(laid.map((n) => [n.id, n.position]));
      this.nodes = this.nodes.map((n) => {
        const pos = posMap.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
    },

    // ──────────────────────────────────────────
    // Force Layout
    // ──────────────────────────────────────────
    _getForceLayoutOptions() {
      const raw = this.options.forceLayout;
      if (!raw) return { ...FORCE_LAYOUT_DEFAULTS, enabled: false };
      if (raw === true) return { ...FORCE_LAYOUT_DEFAULTS, enabled: true };
      return {
        ...FORCE_LAYOUT_DEFAULTS,
        ...raw,
        enabled: raw.enabled !== false,
      };
    },

    _isForceEnabled() {
      return this._getForceLayoutOptions().enabled;
    },

    _initForceSimulation() {
      if (!this._isForceEnabled()) return;

      const forceOptions = this._getForceLayoutOptions();
      this._forceSimulation = createForceSimulation(forceOptions);
      this._refreshForceGraphData({ restart: false, reheat: false });
      this._updateAmbientLoop();

      if (!this._boundVisibilityChange) {
        this._boundVisibilityChange = () => {
          if (!this._forceSimulation) return;
          if (document.hidden) {
            this._forceSimulation.stop();
            return;
          }
          this._syncForceAnchorNode();
          if (this._isForceEnabled() && this._getForceLayoutOptions().autoStart) {
            this._forceSimulation.start((state) => this._onForceTick(state));
          }
        };
        document.addEventListener('visibilitychange', this._boundVisibilityChange);
      }

      if (forceOptions.autoStart) {
        this._forceSimulation.start((state) => this._onForceTick(state));
      }
    },

    _destroyForceSimulation() {
      this._stopAmbientLoop();
      this._forceSimulation?.stop();
      this._forceSimulation = null;
      if (this._boundVisibilityChange) {
        document.removeEventListener('visibilitychange', this._boundVisibilityChange);
        this._boundVisibilityChange = null;
      }
    },

    _refreshForceGraphData({ restart = true, reheat = false } = {}) {
      if (!this._forceSimulation || !this._isForceEnabled()) return;

      const visibleNodes = this.nodes.filter((node) => !node.hidden);
      const visibleEdges = this.edges.filter((edge) => !edge.hidden);

      this._forceSimulation.setOptions(this._getForceLayoutOptions());
      this._forceSimulation.setNodes(visibleNodes);
      this._forceSimulation.setEdges(visibleEdges);
      this._applyPersistentPins();
      this._syncForceAnchorNode();
      this._updateAmbientLoop();

      if (reheat) {
        this._forceSimulation.reheat(0.2);
      }

      if (restart && this._getForceLayoutOptions().autoStart) {
        this._forceSimulation.start((state) => this._onForceTick(state));
      }
    },

    _onForceTick(state) {
      if (!state?.nodes || state.nodes.size === 0) return;

      const movedNodeIds = new Set();

      for (const node of this.nodes) {
        const simNode = state.nodes.get(node.id);
        if (!simNode || node.hidden) continue;

        if (node.position.x !== simNode.x || node.position.y !== simNode.y) {
          node.position = { x: simNode.x, y: simNode.y };
          movedNodeIds.add(node.id);
        }

        const lookupNode = this._nodeLookup.get(node.id);
        if (lookupNode) {
          lookupNode.position = { ...node.position };
          lookupNode.internals.positionAbsolute = { ...node.position };
        }

        const nodeEl = this._nodeElements.get(node.id);
        if (nodeEl) {
          nodeEl.style.transform = `translate(${simNode.x}px, ${simNode.y}px)`;
        }
      }

      if (movedNodeIds.size > 0) {
        this._updateEdgesForNodes(movedNodeIds);
        this._forceTickCount += 1;
        if (this._forceTickCount % 4 === 0) {
          this._minimapComponent?.update();
        }
        this._applyHoverEmphasis();
      }
    },

    _maybeReheatForce(alpha = 0.12) {
      if (!this._forceSimulation || !this._isForceEnabled()) return;
      this._forceSimulation.reheat(alpha);
    },

    _syncForceAnchorNode() {
      if (!this._forceSimulation || !this._isForceEnabled()) return;
      const forceOptions = this._getForceLayoutOptions();
      const anchorNodeId = forceOptions.anchorNodeId || 'streamline';
      const anchorNode = this.nodes.find((node) => node.id === anchorNodeId && !node.hidden);
      if (!anchorNode) return;

      const centerFlowPos = {
        x: (this._containerWidth / 2 - this.viewport.x) / this.viewport.zoom,
        y: (this._containerHeight / 2 - this.viewport.y) / this.viewport.zoom,
      };

      this._forceSimulation.setOptions({ centerX: centerFlowPos.x, centerY: centerFlowPos.y });
      this._forceSimulation.pinNode(anchorNodeId, centerFlowPos.x, centerFlowPos.y);
    },

    _applyPersistentPins() {
      if (!this._forceSimulation || !this._isForceEnabled()) return;
      for (const nodeId of this._persistentPinnedNodeIds) {
        const node = this._nodeLookup.get(nodeId) || this.getNode(nodeId);
        if (!node || node.hidden) continue;
        const absPos = node.internals?.positionAbsolute ?? node.position;
        this._forceSimulation.pinNode(nodeId, absPos.x, absPos.y);
      }
    },

    _stopAmbientLoop() {
      if (!this._ambientIntervalId) return;
      clearInterval(this._ambientIntervalId);
      this._ambientIntervalId = null;
    },

    _updateAmbientLoop() {
      const forceOptions = this._getForceLayoutOptions();
      const shouldRunAmbient = this._isForceEnabled() && !!forceOptions.ambientMotion;

      if (!shouldRunAmbient) {
        this._stopAmbientLoop();
        return;
      }

      if (this._ambientIntervalId) return;

      const intervalMs = Math.max(10, forceOptions.ambientIntervalMs ?? 50);
      const phaseStep = forceOptions.ambientPhaseStep ?? 0.001;
      const alphaPulse = forceOptions.ambientAlphaPulse ?? 0.1;

      this._ambientIntervalId = setInterval(() => {
        if (document.hidden) return;
        if (!this._forceSimulation || !this._isForceEnabled()) return;

        this._ambientPhase += phaseStep;
        this._forceSimulation.pulseAmbient(this._ambientPhase);
        this._forceSimulation.setAlpha(alphaPulse);
        this._syncForceAnchorNode();
        this._forceSimulation.start((state) => this._onForceTick(state));
      }, intervalMs);
    },

    // ──────────────────────────────────────────
    // Node Lookup Management
    // ──────────────────────────────────────────
    _initNodeLookup() {
      this._nodeLookup = buildNodeLookup(this.nodes, this._nodeLookup);
      this._edgeLookup = new Map(this.edges.map((e) => [e.id, e]));
      const nodeIds = new Set(this.nodes.map((node) => node.id));
      for (const nodeId of this._persistentPinnedNodeIds) {
        if (!nodeIds.has(nodeId)) {
          this._persistentPinnedNodeIds.delete(nodeId);
        }
      }
    },

    // ──────────────────────────────────────────
    // Pan/Zoom Initialization
    // ──────────────────────────────────────────
    _initPanZoom() {
      this._panZoomHandler = createPanZoomHandler(
        this._zoomPaneEl,
        () => this._getState(),
        {
          onViewportChange: (vp, opts) => {
            this.viewport = { ...vp };
            this._applyViewportTransform();
            this._backgroundComponent?.update();
            this._minimapComponent?.update();
            this._controlsComponent?.update();
            this._syncForceAnchorNode();
            this._onViewportChange?.(vp);
            this._maybeReheatForce(0.08);
          },
          onPanZoomStart: (event, vp) => {},
          onPanZoom: (event, vp) => {},
          onPanZoomEnd: (event, vp) => {},
        }
      );
    },

    _applyViewportTransform() {
      if (!this._viewportEl) return;
      const { x, y, zoom } = this.viewport;
      this._viewportEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    },

    _setViewport(vp) {
      this.viewport = { ...vp };
      this._applyViewportTransform();
      this._backgroundComponent?.update();
      this._minimapComponent?.update();
      this._controlsComponent?.update();
      this._onViewportChange?.(this.viewport);
      this._syncForceAnchorNode();
      this._maybeReheatForce(0.08);
    },

    // ──────────────────────────────────────────
    // Node Drag Initialization
    // ──────────────────────────────────────────
    _initNodeDrag() {
      this._dragHandler = createNodeDragHandler(
        () => this._getState(),
        {
          onNodeDragStart: (event, nodeId, nodes) => {
            if (this._isForceEnabled() && this._forceSimulation) {
              for (const node of nodes) {
                this._persistentPinnedNodeIds.delete(node.id);
                const currentNode = this._nodeLookup.get(node.id) || node;
                const absPos = currentNode.internals?.positionAbsolute ?? currentNode.position;
                this._forceSimulation.pinNode(node.id, absPos.x, absPos.y);
              }
              this._forceSimulation.setAlphaTarget(0.3);
              this._forceSimulation.start((state) => this._onForceTick(state));
            }
            this._onNodeDragStart?.(event, this.getNode(nodeId), nodes);
          },
          onNodeDrag: (event, nodeId, changes) => {
            this._onNodeDrag?.(event, this.getNode(nodeId), changes);
          },
          onNodeDragStop: (event, nodeId, nodes) => {
            if (this._isForceEnabled() && this._forceSimulation) {
              for (const node of nodes) {
                if (this._persistentPinnedNodeIds.has(node.id)) {
                  const currentNode = this._nodeLookup.get(node.id) || node;
                  const absPos = currentNode.internals?.positionAbsolute ?? currentNode.position;
                  this._forceSimulation.pinNode(node.id, absPos.x, absPos.y);
                } else {
                  this._forceSimulation.unpinNode(node.id);
                }
              }
              this._syncForceAnchorNode();
              this._forceSimulation.setAlphaTarget(0);
            }
            this._onNodeDragStop?.(event, this.getNode(nodeId), nodes);
          },
          onDragHold: (nodeId) => {
            if (!this._isForceEnabled() || !this._forceSimulation) return;
            const currentNode = this._nodeLookup.get(nodeId) || this.getNode(nodeId);
            if (!currentNode || currentNode.hidden) return;
            const absPos = currentNode.internals?.positionAbsolute ?? currentNode.position;
            this._persistentPinnedNodeIds.add(nodeId);
            this._forceSimulation.pinNode(nodeId, absPos.x, absPos.y);
            this._playPinFeedback(nodeId);
          },
          onPositionChange: (changes, isFinal) => {
            this._applyPositionChanges(changes, isFinal);
          },
          onViewportChange: (vp) => {
            this.viewport = { ...vp };
            this._applyViewportTransform();
            this._backgroundComponent?.update();
            this._minimapComponent?.update();
            this._syncForceAnchorNode();
          },
        }
      );
    },

    _applyPositionChanges(changes, isFinal) {
      // Direct DOM updates for performance during drag (bypass full re-render)
      for (const change of changes) {
        const node = this._nodeLookup.get(change.id);
        if (!node) continue;

        if (change.position) {
          // Update the reactive node
          const nodeIndex = this.nodes.findIndex((n) => n.id === change.id);
          if (nodeIndex >= 0) {
            this.nodes[nodeIndex] = {
              ...this.nodes[nodeIndex],
              position: { ...change.position },
              dragging: change.dragging ?? false,
            };
          }

          // Update lookup
          node.position = { ...change.position };
          if (change.positionAbsolute) {
            node.internals.positionAbsolute = { ...change.positionAbsolute };
          }

          // Direct DOM update for the node element (fast path)
          const nodeEl = this._nodeElements.get(change.id);
          if (nodeEl) {
            const pos = change.positionAbsolute || change.position;
            nodeEl.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
            if (change.dragging) {
              nodeEl.classList.add('dragging');
            } else {
              nodeEl.classList.remove('dragging');
            }
          }

          if (this._isForceEnabled() && this._forceSimulation) {
            const absolutePos = change.positionAbsolute || change.position;
            if (change.dragging) {
              this._forceSimulation.movePinnedNode(change.id, absolutePos.x, absolutePos.y);
            } else {
              this._forceSimulation.unpinNode(change.id);
            }
          }
        }

        if (change.dragging !== undefined && !change.position) {
          const nodeIndex = this.nodes.findIndex((n) => n.id === change.id);
          if (nodeIndex >= 0) {
            this.nodes[nodeIndex] = { ...this.nodes[nodeIndex], dragging: change.dragging };
          }
          const nodeEl = this._nodeElements.get(change.id);
          if (nodeEl) {
            nodeEl.classList.toggle('dragging', change.dragging);
          }
        }
      }

      // Update edges connected to moved nodes
      const movedNodeIds = new Set(changes.filter((c) => c.position).map((c) => c.id));
      this._updateEdgesForNodes(movedNodeIds);
      this._updateConnectionLine();
      this._minimapComponent?.update();
      this._applyHoverEmphasis();

      // Fire change callback
      if (this._onNodesChange) {
        this._onNodesChange(changes.map((c) => ({
          type: 'position',
          id: c.id,
          position: c.position,
          dragging: c.dragging,
        })));
      }
    },

    // ──────────────────────────────────────────
    // Connection Handler Initialization
    // ──────────────────────────────────────────
    _initConnectionHandler() {
      this._connectionHandler = createConnectionHandler(
        () => this._getState(),
        {
          onConnectStart: (event, params) => {
            this._onConnectStart?.(event, params);
          },
          onConnect: (connection) => {
            if (this._onConnect) {
              this._onConnect(connection);
            } else {
              // Auto-add edge
              this.edges = addEdge(connection, this.edges);
              this._initNodeLookup();
              this._renderAllEdges();
              this._refreshForceGraphData({ restart: true, reheat: true });
            }
          },
          onConnectEnd: (event) => {
            this._onConnectEnd?.(event);
          },
          onConnectionStateChange: (state) => {
            this.connectionState = state;
            this._updateConnectionLine();
          },
        }
      );
    },

    _updateConnectionLine() {
      if (!this._connectionPathEl) return;

      if (!this.connectionState || !this.connectionState.inProgress) {
        this._connectionPathEl.setAttribute('d', '');
        return;
      }

      const { from, to, fromPosition } = this.connectionState;
      const toPosition = this.connectionState.toPosition || Position.Top;
      const lineType = this.options.connectionLineType ?? DEFAULTS.connectionLineType;
      const pathFn = getPathForEdgeType(lineType);

      const [path] = pathFn({
        sourceX: from.x,
        sourceY: from.y,
        sourcePosition: fromPosition,
        targetX: to.x,
        targetY: to.y,
        targetPosition: toPosition,
      });

      this._connectionPathEl.setAttribute('d', path);

      // Color based on validity
      const { isValid } = this.connectionState;
      if (isValid === true) {
        this._connectionPathEl.setAttribute('stroke', '#4f8ff7');
      } else if (isValid === false) {
        this._connectionPathEl.setAttribute('stroke', '#ff4444');
      } else {
        this._connectionPathEl.setAttribute('stroke', '#b1b1b7');
      }
    },

    // ──────────────────────────────────────────
    // Node Resize Observer
    // ──────────────────────────────────────────
    _initResizeObserver() {
      this._resizeObserver = createNodeResizeObserver((nodeId, dims) => {
        const node = this._nodeLookup.get(nodeId);
        if (!node) return;

        // Get the actual zoom to correct measurements
        const zoom = this.viewport.zoom || 1;
        const correctedDims = {
          width: dims.width / zoom,
          height: dims.height / zoom,
        };

        // Update node measured dimensions
        node.measured = { ...correctedDims };
        const nodeIndex = this.nodes.findIndex((n) => n.id === nodeId);
        if (nodeIndex >= 0) {
          this.nodes[nodeIndex] = { ...this.nodes[nodeIndex], measured: { ...correctedDims } };
        }

        // Measure handle positions from DOM
        this._measureHandleBounds(nodeId);

        // Update edges connected to this node
        this._updateEdgesForNodes(new Set([nodeId]));
        this._minimapComponent?.update();

        // Make node visible after first measurement
        const nodeEl = this._nodeElements.get(nodeId);
        if (nodeEl && nodeEl.style.visibility === 'hidden') {
          nodeEl.style.visibility = 'visible';
        }
      });
    },

    _measureHandleBounds(nodeId) {
      const nodeEl = this._nodeElements.get(nodeId);
      const node = this._nodeLookup.get(nodeId);
      if (!nodeEl || !node) return;

      const zoom = this.viewport.zoom || 1;
      const nodePos = node.internals.positionAbsolute;
      const handles = nodeEl.querySelectorAll('.alpine-flow__handle');

      const sourceHandles = [];
      const targetHandles = [];

      handles.forEach((handleEl) => {
        const handleId = handleEl.dataset.handleid || null;
        const handleType = handleEl.dataset.handletype || 'source';
        const handlePosition = handleEl.dataset.handleposition || Position.Bottom;

        const handleRect = handleEl.getBoundingClientRect();
        const nodeRect = nodeEl.getBoundingClientRect();

        const handle = {
          id: handleId || null,
          nodeId: nodeId,
          type: handleType,
          position: handlePosition,
          x: (handleRect.left - nodeRect.left) / zoom,
          y: (handleRect.top - nodeRect.top) / zoom,
          width: handleRect.width / zoom,
          height: handleRect.height / zoom,
        };

        if (handleType === 'source') {
          sourceHandles.push(handle);
        } else {
          targetHandles.push(handle);
        }
      });

      node.internals.handleBounds = { source: sourceHandles, target: targetHandles };
    },

    // ──────────────────────────────────────────
    // Keyboard Handler
    // ──────────────────────────────────────────
    _initKeyboardHandler() {
      this._containerEl.addEventListener('keydown', (event) => {
        // Delete selected elements
        if (event.key === this.options.deleteKeyCode || event.key === 'Delete') {
          this._deleteSelected();
          return;
        }

        // Select all (Ctrl/Cmd + A)
        if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
          event.preventDefault();
          this._selectAll();
          return;
        }

        // Escape: deselect all
        if (event.key === 'Escape') {
          this._deselectAll();
          return;
        }

        // Arrow keys: move selected nodes
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          this._moveSelectedNodes(dx, dy);
        }
      });
    },

    // ──────────────────────────────────────────
    // Selection
    // ──────────────────────────────────────────
    _onPanePointerDown(event) {
      // Only handle selection box on the pane (not on nodes/edges)
      if (!event.target.classList.contains('alpine-flow__pane') &&
          !event.target.classList.contains('alpine-flow__renderer')) return;

      // Check if shift is held for selection box
      const isSelectionKey = event.shiftKey;
      if (!isSelectionKey) return;

      event.preventDefault();
      const rect = this._containerEl.getBoundingClientRect();
      const startX = (event.clientX - rect.left - this.viewport.x) / this.viewport.zoom;
      const startY = (event.clientY - rect.top - this.viewport.y) / this.viewport.zoom;

      this._isSelecting = true;
      this._selectionStart = { x: startX, y: startY };
      this._selectionBoxEl.style.display = 'block';
      this._selectionBoxEl.style.left = `${startX}px`;
      this._selectionBoxEl.style.top = `${startY}px`;
      this._selectionBoxEl.style.width = '0px';
      this._selectionBoxEl.style.height = '0px';

      const onMove = (e) => {
        const currX = (e.clientX - rect.left - this.viewport.x) / this.viewport.zoom;
        const currY = (e.clientY - rect.top - this.viewport.y) / this.viewport.zoom;

        const x = Math.min(startX, currX);
        const y = Math.min(startY, currY);
        const w = Math.abs(currX - startX);
        const h = Math.abs(currY - startY);

        this._selectionBoxEl.style.left = `${x}px`;
        this._selectionBoxEl.style.top = `${y}px`;
        this._selectionBoxEl.style.width = `${w}px`;
        this._selectionBoxEl.style.height = `${h}px`;
      };

      const onUp = (e) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);

        const currX = (e.clientX - rect.left - this.viewport.x) / this.viewport.zoom;
        const currY = (e.clientY - rect.top - this.viewport.y) / this.viewport.zoom;

        const selRect = {
          x: Math.min(startX, currX),
          y: Math.min(startY, currY),
          width: Math.abs(currX - startX),
          height: Math.abs(currY - startY),
        };

        // Select nodes in the selection rectangle
        this._selectNodesInRect(selRect);

        this._selectionBoxEl.style.display = 'none';
        this._isSelecting = false;
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },

    _selectNodesInRect(rect) {
      const changes = [];
      for (const node of this.nodes) {
        const nodePos = this._nodeLookup.get(node.id)?.internals?.positionAbsolute ?? node.position;
        const dims = getNodeDimensions(node);
        const nodeRect = { x: nodePos.x, y: nodePos.y, width: dims.width, height: dims.height };

        // Check overlap
        const overlaps = !(
          rect.x > nodeRect.x + nodeRect.width ||
          rect.x + rect.width < nodeRect.x ||
          rect.y > nodeRect.y + nodeRect.height ||
          rect.y + rect.height < nodeRect.y
        );

        if (overlaps && !node.selected) {
          changes.push({ type: 'select', id: node.id, selected: true });
        }
      }

      if (changes.length > 0) {
        this.nodes = applyNodeChanges(changes, this.nodes);
        this._initNodeLookup();
        this._updateNodeSelectionStyles();
        this._onSelectionChange?.({
          nodes: this.nodes.filter((n) => n.selected),
          edges: this.edges.filter((e) => e.selected),
        });
      }
    },

    _selectAll() {
      const nodeChanges = this.nodes.filter((n) => !n.selected).map((n) => ({ type: 'select', id: n.id, selected: true }));
      const edgeChanges = this.edges.filter((e) => !e.selected).map((e) => ({ type: 'select', id: e.id, selected: true }));

      if (nodeChanges.length) this.nodes = applyNodeChanges(nodeChanges, this.nodes);
      if (edgeChanges.length) this.edges = applyEdgeChanges(edgeChanges, this.edges);
      this._initNodeLookup();
      this._updateNodeSelectionStyles();
      this._updateEdgeSelectionStyles();
    },

    _deselectAll() {
      const nodeChanges = this.nodes.filter((n) => n.selected).map((n) => ({ type: 'select', id: n.id, selected: false }));
      const edgeChanges = this.edges.filter((e) => e.selected).map((e) => ({ type: 'select', id: e.id, selected: false }));

      if (nodeChanges.length) this.nodes = applyNodeChanges(nodeChanges, this.nodes);
      if (edgeChanges.length) this.edges = applyEdgeChanges(edgeChanges, this.edges);
      this._initNodeLookup();
      this._updateNodeSelectionStyles();
      this._updateEdgeSelectionStyles();
    },

    _deleteSelected() {
      const nodesToRemove = this.nodes.filter((n) => n.selected);
      const edgesToRemove = this.edges.filter((e) => e.selected);

      if (nodesToRemove.length === 0 && edgesToRemove.length === 0) return;

      const result = deleteElements({ nodesToRemove, edgesToRemove }, this.nodes, this.edges);
      this.nodes = result.nodes;
      this.edges = result.edges;
      this._initNodeLookup();
      this._renderAllNodes();
      this._renderAllEdges();
      this._minimapComponent?.update();
      this._refreshForceGraphData({ restart: true, reheat: true });
      this._applyHoverEmphasis();
    },

    _moveSelectedNodes(dx, dy) {
      const changes = [];
      for (const node of this.nodes) {
        if (!node.selected || node.draggable === false) continue;
        changes.push({
          type: 'position',
          id: node.id,
          position: { x: node.position.x + dx, y: node.position.y + dy },
        });
      }

      if (changes.length > 0) {
        this.nodes = applyNodeChanges(changes, this.nodes);
        this._initNodeLookup();
        // Update DOM positions
        for (const change of changes) {
          const enriched = this._nodeLookup.get(change.id);
          const el = this._nodeElements.get(change.id);
          if (enriched && el) {
            const pos = enriched.internals.positionAbsolute;
            el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
          }
        }
        // Update connected edges
        const movedIds = new Set(changes.map((c) => c.id));
        this._updateEdgesForNodes(movedIds);
        this._minimapComponent?.update();
        this._refreshForceGraphData({ restart: false, reheat: true });
      }
    },

    _updateNodeSelectionStyles() {
      for (const [id, el] of this._nodeElements) {
        const node = this.nodes.find((n) => n.id === id);
        if (node) {
          el.classList.toggle('selected', !!node.selected);
        }
      }
    },

    _updateEdgeSelectionStyles() {
      for (const [id, el] of this._edgeElements) {
        const edge = this.edges.find((e) => e.id === id);
        if (edge) {
          el.classList.toggle('selected', !!edge.selected);
        }
      }
    },

    // ──────────────────────────────────────────
    // Node Rendering
    // ──────────────────────────────────────────
    _renderAllNodes() {
      const currentIds = new Set(this.nodes.map((n) => n.id));

      // Remove stale node elements
      for (const [id, el] of this._nodeElements) {
        if (!currentIds.has(id)) {
          if (this._hoveredNodeId === id) this._setHoveredNode(null);
          this._resizeObserver.unobserve(el);
          el.remove();
          this._nodeElements.delete(id);
        }
      }

      // Create or update node elements
      for (const node of this.nodes) {
        if (node.hidden) {
          const existing = this._nodeElements.get(node.id);
          if (existing) {
            if (this._hoveredNodeId === node.id) this._setHoveredNode(null);
            this._resizeObserver.unobserve(existing);
            existing.remove();
            this._nodeElements.delete(node.id);
          }
          continue;
        }

        let nodeEl = this._nodeElements.get(node.id);
        const enriched = this._nodeLookup.get(node.id);
        const pos = enriched?.internals?.positionAbsolute ?? node.position;

        if (!nodeEl) {
          nodeEl = createElement('div', {
            className: `alpine-flow__node alpine-flow__node-${node.type || 'default'} ${node.data?.iconMode === 'icon' ? 'icon-only' : ''} ${node.className || ''} ${node.selected ? 'selected' : ''} ${node.draggable === false ? 'not-draggable' : ''}`.trim(),
            'data-id': node.id,
            style: {
              position: 'absolute',
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              zIndex: String(enriched?.internals?.z ?? 0),
              visibility: 'hidden', // Hidden until measured
            },
          }, this._nodesContainerEl);

          // Render node content
          const nodeType = this._nodeTypes[node.type || 'default'] || this._nodeTypes.default;
          if (typeof nodeType === 'function') {
            nodeEl.innerHTML = nodeType(node);
          } else {
            nodeEl.innerHTML = `<div class="alpine-flow__node-header">${node.data?.label ?? node.id}</div>`;
          }

          this._hydrateNodeIcons(nodeEl);

          // Set up drag
          if (node.draggable !== false && this.options.nodesDraggable) {
            nodeEl.style.cursor = 'grab';
            nodeEl.addEventListener('pointerdown', (event) => {
              this._onNodePointerDown(event, node.id);
            });
          }

          // Click handler
          nodeEl.addEventListener('click', (event) => {
            event.stopPropagation();
            this._onNodeClickHandler(event, node.id);
          });

          nodeEl.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            this._onNodeDoubleClick?.(event, this.getNode(node.id));
          });

          nodeEl.addEventListener('mouseenter', () => {
            this._setHoveredNode(node.id);
          });

          nodeEl.addEventListener('mouseleave', () => {
            if (this._hoveredNodeId === node.id) {
              this._setHoveredNode(null);
            }
          });

          // Handle pointerdown for connections
          nodeEl.querySelectorAll('.alpine-flow__handle').forEach((handleEl) => {
            handleEl.addEventListener('pointerdown', (event) => {
              if (!this.options.nodesConnectable) return;
              const handleId = handleEl.dataset.handleid || null;
              const handleType = handleEl.dataset.handletype || 'source';
              const handlePosition = handleEl.dataset.handleposition || Position.Bottom;
              this._connectionHandler.handlePointerDown(event, node.id, handleId, handleType, handlePosition);
            });
          });

          this._nodeElements.set(node.id, nodeEl);
          this._resizeObserver.observe(nodeEl);
        } else {
          // Update existing node
          nodeEl.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
          nodeEl.style.zIndex = String(enriched?.internals?.z ?? 0);
          nodeEl.classList.toggle('selected', !!node.selected);
          nodeEl.classList.toggle('icon-only', node.data?.iconMode === 'icon');
        }
      }

      this._applyHoverEmphasis();
    },

    _setHoveredNode(nodeId) {
      this._hoveredNodeId = nodeId;
      this._hoverNeighborIds = new Set();

      if (nodeId) {
        this._hoverNeighborIds.add(nodeId);
        for (const edge of this.edges) {
          if (edge.hidden) continue;
          if (edge.source === nodeId) this._hoverNeighborIds.add(edge.target);
          if (edge.target === nodeId) this._hoverNeighborIds.add(edge.source);
        }
      }

      this._applyHoverEmphasis();
    },

    _hydrateNodeIcons(nodeEl) {
      if (!nodeEl) return;
      if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
      try {
        window.lucide.createIcons({
          attrs: {
            width: '16',
            height: '16',
            strokeWidth: '2',
          },
        });
      } catch (error) {
      }
    },

    _applyHoverEmphasis() {
      const hoveredNodeId = this._hoveredNodeId;
      const hoveredNode = hoveredNodeId ? this.getNode(hoveredNodeId) : null;
      const hoveredStroke = hoveredNode ? this._getNodeTypeHoverStroke(hoveredNode.type) : null;

      for (const [id, nodeEl] of this._nodeElements) {
        if (!hoveredNodeId) {
          nodeEl.classList.remove('is-hover-focus', 'is-hover-dim');
          continue;
        }

        const inNeighborhood = this._hoverNeighborIds.has(id);
        nodeEl.classList.toggle('is-hover-focus', inNeighborhood);
        nodeEl.classList.toggle('is-hover-dim', !inNeighborhood);
      }

      for (const edge of this.edges) {
        const edgeGroup = this._edgeElements.get(edge.id);
        const edgeLabel = this._edgeLabelElements.get(edge.id);
        if (!edgeGroup) continue;
        const edgePath = edgeGroup.querySelector('.alpine-flow__edge-path');
        const baseStroke = edge.style?.stroke || 'var(--alpine-flow-edge-stroke, #333)';
        const baseWidth = String(edge.style?.strokeWidth || 'var(--alpine-flow-edge-stroke-width, 1)');

        if (!hoveredNodeId) {
          edgeGroup.classList.remove('is-edge-focus', 'is-edge-dim');
          edgeLabel?.classList.remove('is-edge-focus', 'is-edge-dim');
          if (edgePath) {
            edgePath.setAttribute('stroke', baseStroke);
            edgePath.setAttribute('stroke-width', baseWidth);
          }
          continue;
        }

        const isConnected = edge.source === hoveredNodeId || edge.target === hoveredNodeId;
        edgeGroup.classList.toggle('is-edge-focus', isConnected);
        edgeGroup.classList.toggle('is-edge-dim', !isConnected);
        edgeLabel?.classList.toggle('is-edge-focus', isConnected);
        edgeLabel?.classList.toggle('is-edge-dim', !isConnected);

        if (edgePath) {
          if (isConnected) {
            edgePath.setAttribute('stroke', hoveredStroke || baseStroke);
            edgePath.setAttribute('stroke-width', '2');
          } else {
            edgePath.setAttribute('stroke', '#333');
            edgePath.setAttribute('stroke-width', '1');
          }
        }
      }
    },

    _playPinFeedback(nodeId) {
      const nodeEl = this._nodeElements.get(nodeId);
      if (!nodeEl) return;

      nodeEl.classList.remove('is-pin-confirmed');
      void nodeEl.offsetWidth;
      nodeEl.classList.add('is-pin-confirmed');

      const onAnimationEnd = () => {
        nodeEl.classList.remove('is-pin-confirmed');
        nodeEl.removeEventListener('animationend', onAnimationEnd);
      };

      nodeEl.addEventListener('animationend', onAnimationEnd);
    },

    _getNodeTypeHoverStroke(nodeType) {
      const cssStroke = this._containerEl
        ? getComputedStyle(this._containerEl).getPropertyValue('--alpine-flow-hover-edge-stroke').trim()
        : '';
      if (cssStroke) return cssStroke;

      switch (nodeType) {
        case 'input':
          return '#4f8ff7';
        case 'output':
          return '#22c55e';
        default:
          return '#4f8ff7';
      }
    },

    _onNodePointerDown(event, nodeId) {
      // Select node on click (with multi-select support)
      const node = this.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey;
      this._lastNodePointerDown = {
        nodeId,
        wasSelected: !!node.selected,
        isMultiSelect,
      };

      if (!isMultiSelect && !node.selected) {
        // Deselect all, then select this
        const changes = this.nodes
          .filter((n) => n.selected && n.id !== nodeId)
          .map((n) => ({ type: 'select', id: n.id, selected: false }));
        changes.push({ type: 'select', id: nodeId, selected: true });
        this.nodes = applyNodeChanges(changes, this.nodes);
        this._initNodeLookup();
        this._updateNodeSelectionStyles();
      } else if (isMultiSelect && !node.selected) {
        this.nodes = applyNodeChanges([{ type: 'select', id: nodeId, selected: true }], this.nodes);
        this._initNodeLookup();
        this._updateNodeSelectionStyles();
      }

      // Start drag
      if (this.options.nodesDraggable && node.draggable !== false) {
        this._dragHandler.onPointerDown(event, nodeId);
      }
    },

    _onNodeClickHandler(event, nodeId) {
      const node = this.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const pointerMeta = this._lastNodePointerDown;
      const isSamePointerTarget = pointerMeta?.nodeId === nodeId;
      const wasSelected = isSamePointerTarget ? !!pointerMeta.wasSelected : !!node.selected;
      const isMultiSelect = isSamePointerTarget
        ? !!pointerMeta.isMultiSelect
        : (event.shiftKey || event.metaKey || event.ctrlKey);

      if (wasSelected) {
        if (isMultiSelect) {
          // Shift/Cmd/Ctrl + click toggles this node out of the selection.
          this.nodes = applyNodeChanges([{ type: 'select', id: nodeId, selected: false }], this.nodes);
          this._initNodeLookup();
          this._updateNodeSelectionStyles();
        } else {
          // Plain click on an already selected node deselects it.
          this.nodes = applyNodeChanges([{ type: 'select', id: nodeId, selected: false }], this.nodes);
          this._initNodeLookup();
          this._updateNodeSelectionStyles();
        }
      }

      this._lastNodePointerDown = null;
      this._onNodeClick?.(event, this.getNode(nodeId));
      this._maybeReheatForce(0.08);
    },

    // ──────────────────────────────────────────
    // Edge Rendering
    // ──────────────────────────────────────────
    _renderAllEdges() {
      const currentIds = new Set(this.edges.map((e) => e.id));

      // Remove stale
      for (const [id, el] of this._edgeElements) {
        if (!currentIds.has(id)) {
          el.remove();
          this._edgeElements.delete(id);
          this._edgeInteractionElements.get(id)?.remove();
          this._edgeInteractionElements.delete(id);
          this._edgeLabelElements.get(id)?.remove();
          this._edgeLabelElements.delete(id);
        }
      }

      for (const edge of this.edges) {
        if (edge.hidden) {
          // Remove existing DOM elements for hidden edges
          const existing = this._edgeElements.get(edge.id);
          if (existing) {
            existing.remove();
            this._edgeElements.delete(edge.id);
            this._edgeInteractionElements.get(edge.id)?.remove();
            this._edgeInteractionElements.delete(edge.id);
            this._edgeLabelElements.get(edge.id)?.remove();
            this._edgeLabelElements.delete(edge.id);
          }
          continue;
        }
        this._renderEdge(edge);
      }

      this._applyHoverEmphasis();
    },

    _renderEdge(edge) {
      const sourceNode = this._nodeLookup.get(edge.source);
      const targetNode = this._nodeLookup.get(edge.target);
      if (!sourceNode || !targetNode) return;

      const edgePos = getEdgePosition(sourceNode, edge.sourceHandle, targetNode, edge.targetHandle);
      const edgeType = edge.type || this.options.defaultEdgeType || 'default';
      const pathFn = getPathForEdgeType(edgeType);
      const [path, labelX, labelY] = pathFn({
        sourceX: edgePos.sourceX,
        sourceY: edgePos.sourceY,
        sourcePosition: edgePos.sourcePosition,
        targetX: edgePos.targetX,
        targetY: edgePos.targetY,
        targetPosition: edgePos.targetPosition,
      });

      let edgeGroup = this._edgeElements.get(edge.id);

      if (!edgeGroup) {
        edgeGroup = createSvgElement('g', {
          class: `alpine-flow__edge alpine-flow__edge-${edgeType} ${edge.animated ? 'animated' : ''} ${edge.selected ? 'selected' : ''} ${edge.className || ''}`.trim(),
          'data-id': edge.id,
        }, this._edgesGroupEl);

        // Interaction path (invisible, wider for clicking)
        const interactionPath = createSvgElement('path', {
          class: 'alpine-flow__edge-interaction',
          d: path,
          fill: 'none',
          stroke: 'transparent',
          'stroke-width': String(edge.interactionWidth ?? 20),
          style: { pointerEvents: 'stroke', cursor: 'pointer' },
        }, edgeGroup);

        interactionPath.addEventListener('click', (event) => {
          event.stopPropagation();
          this._onEdgeClickHandler(event, edge.id);
        });

        this._edgeInteractionElements.set(edge.id, interactionPath);

        // Visible path
        const visiblePath = createSvgElement('path', {
          class: 'alpine-flow__edge-path',
          d: path,
          fill: 'none',
          stroke: edge.style?.stroke || 'var(--alpine-flow-edge-stroke, #b1b1b7)',
          'stroke-width': edge.style?.strokeWidth || 'var(--alpine-flow-edge-stroke-width, 1)',
          'marker-end': edge.markerEnd ? `url(#${this._flowId}-arrow-${edge.selected ? 'default-selected' : 'default'})` : '',
          'marker-start': edge.markerStart ? `url(#${this._flowId}-arrow-${edge.selected ? 'default-selected' : 'default'})` : '',
        }, edgeGroup);

        this._edgeElements.set(edge.id, edgeGroup);

        // Label
        if (edge.label) {
          const fo = createSvgElement('foreignObject', {
            x: String(labelX - 50),
            y: String(labelY - 12),
            width: '100',
            height: '24',
            class: 'alpine-flow__edge-label-container',
          }, edgeGroup);

          const labelDiv = document.createElement('div');
          labelDiv.className = 'alpine-flow__edge-label';
          labelDiv.textContent = edge.label;
          if (edge.labelStyle) Object.assign(labelDiv.style, edge.labelStyle);
          fo.appendChild(labelDiv);

          this._edgeLabelElements.set(edge.id, fo);
        }
      } else {
        // Update existing edge
        const visiblePath = edgeGroup.querySelector('.alpine-flow__edge-path');
        const interactionPath = edgeGroup.querySelector('.alpine-flow__edge-interaction');
        if (visiblePath) visiblePath.setAttribute('d', path);
        if (interactionPath) interactionPath.setAttribute('d', path);

        // Update label position
        const label = this._edgeLabelElements.get(edge.id);
        if (label) {
          label.setAttribute('x', String(labelX - 50));
          label.setAttribute('y', String(labelY - 12));
        }

        edgeGroup.className.baseVal = `alpine-flow__edge alpine-flow__edge-${edgeType} ${edge.animated ? 'animated' : ''} ${edge.selected ? 'selected' : ''} ${edge.className || ''}`.trim();
      }
    },

    _updateEdgesForNodes(nodeIds) {
      for (const edge of this.edges) {
        if (edge.hidden) continue;
        if (nodeIds.has(edge.source) || nodeIds.has(edge.target)) {
          this._renderEdge(edge);
        }
      }
    },

    _onEdgeClickHandler(event, edgeId) {
      const edge = this.edges.find((e) => e.id === edgeId);
      if (!edge) return;

      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey;

      if (!isMultiSelect) {
        // Deselect all nodes and edges, select this edge
        const nodeChanges = this.nodes.filter((n) => n.selected).map((n) => ({ type: 'select', id: n.id, selected: false }));
        const edgeChanges = this.edges.filter((e) => e.selected && e.id !== edgeId).map((e) => ({ type: 'select', id: e.id, selected: false }));
        edgeChanges.push({ type: 'select', id: edgeId, selected: !edge.selected });

        if (nodeChanges.length) this.nodes = applyNodeChanges(nodeChanges, this.nodes);
        this.edges = applyEdgeChanges(edgeChanges, this.edges);
      } else {
        this.edges = applyEdgeChanges([{ type: 'select', id: edgeId, selected: !edge.selected }], this.edges);
      }

      this._initNodeLookup();
      this._updateNodeSelectionStyles();
      this._updateEdgeSelectionStyles();
      this._onEdgeClick?.(event, edge);
      this._maybeReheatForce(0.08);
    },

    // ──────────────────────────────────────────
    // Public API Methods
    // ──────────────────────────────────────────
    fitView(options = {}) {
      if (this.nodes.length === 0) return;

      const visibleNodes = Array.from(this._nodeLookup.values()).filter((node) => !node.hidden);
      if (visibleNodes.length === 0) return;

      let bounds = getNodesBounds(visibleNodes);

      if (bounds.width === 0 && bounds.height === 0) {
        const FALLBACK_NODE_WIDTH = 120;
        const FALLBACK_NODE_HEIGHT = 56;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const node of visibleNodes) {
          const pos = node.internals?.positionAbsolute ?? node.position;
          if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;

          const dims = getNodeDimensions(node);
          const width = Number.isFinite(dims?.width) && dims.width > 0 ? dims.width : FALLBACK_NODE_WIDTH;
          const height = Number.isFinite(dims?.height) && dims.height > 0 ? dims.height : FALLBACK_NODE_HEIGHT;

          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + width);
          maxY = Math.max(maxY, pos.y + height);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

        bounds = {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY)
        };
      }

      const padding = options.padding ?? this.options.fitViewPadding ?? DEFAULTS.fitViewPadding;
      const vp = getTransformForBounds(
        bounds,
        this._containerWidth,
        this._containerHeight,
        options.minZoom ?? this.options.minZoom ?? DEFAULTS.minZoom,
        options.maxZoom ?? this.options.maxZoom ?? DEFAULTS.maxZoom,
        padding,
      );

      this.viewport = vp;
      this._applyViewportTransform();
      this._backgroundComponent?.update();
      this._minimapComponent?.update();
      this._controlsComponent?.update();
      this._maybeReheatForce(0.08);
    },

    zoomIn(options = {}) {
      const step = options.step ?? 0.5;
      this.zoomTo(this.viewport.zoom + step, options);
    },

    zoomOut(options = {}) {
      const step = options.step ?? 0.5;
      this.zoomTo(this.viewport.zoom - step, options);
    },

    zoomTo(level, options = {}) {
      const minZoom = this.options.minZoom ?? DEFAULTS.minZoom;
      const maxZoom = this.options.maxZoom ?? DEFAULTS.maxZoom;
      const nextZoom = clamp(level, minZoom, maxZoom);
      const center = { x: this._containerWidth / 2, y: this._containerHeight / 2 };

      this.viewport = zoomAtPoint(this.viewport, center, nextZoom);
      this._applyViewportTransform();
      this._backgroundComponent?.update();
      this._minimapComponent?.update();
      this._controlsComponent?.update();
      this._onViewportChange?.(this.viewport);
      this._maybeReheatForce(0.1);
    },

    panBy(delta) {
      this.viewport = {
        ...this.viewport,
        x: this.viewport.x + delta.x,
        y: this.viewport.y + delta.y,
      };
      this._applyViewportTransform();
      this._backgroundComponent?.update();
      this._minimapComponent?.update();
      this._maybeReheatForce(0.08);
    },

    screenToFlowPosition(pos) {
      const bounds = this._containerEl?.getBoundingClientRect();
      return screenToFlowPosition(pos, this.viewport, bounds);
    },

    flowToScreenPosition(pos) {
      return flowToScreenPosition(pos, this.viewport);
    },

    toggleInteractivity() {
      const isInteractive = this.options.nodesDraggable !== false;
      this.options.nodesDraggable = !isInteractive;
      this.options.nodesConnectable = !isInteractive;
      this.options.elementsSelectable = !isInteractive;
    },

    getNode(id) {
      return this.nodes.find((n) => n.id === id) ?? null;
    },

    getEdge(id) {
      return this.edges.find((e) => e.id === id) ?? null;
    },

    addNodes(newNodes) {
      const normalized = (Array.isArray(newNodes) ? newNodes : [newNodes]).map(normalizeNode);
      this.nodes = [...this.nodes, ...normalized];
      this._initNodeLookup();
      this._renderAllNodes();
      this._minimapComponent?.update();
      this._refreshForceGraphData({ restart: true, reheat: true });
    },

    addEdges(newEdges) {
      let edges = this.edges;
      const edgeArray = Array.isArray(newEdges) ? newEdges : [newEdges];
      for (const e of edgeArray) {
        edges = addEdge(normalizeEdge(e), edges);
      }
      this.edges = edges;
      this._initNodeLookup();
      this._renderAllEdges();
      this._refreshForceGraphData({ restart: true, reheat: true });
    },

    deleteSelectedElements() {
      this._deleteSelected();
    },

    getIncomers(nodeOrId) {
      return getIncomers(nodeOrId, this.nodes, this.edges);
    },

    getOutgoers(nodeOrId) {
      return getOutgoers(nodeOrId, this.nodes, this.edges);
    },

    getConnectedEdges(nodeOrNodes) {
      return getConnectedEdges(nodeOrNodes, this.edges);
    },

    toJSON() {
      return {
        nodes: this.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: { ...n.position },
          data: n.data ? { ...n.data } : {},
          ...(n.sourcePosition && { sourcePosition: n.sourcePosition }),
          ...(n.targetPosition && { targetPosition: n.targetPosition }),
          ...(n.className && { className: n.className }),
          ...(n.style && { style: { ...n.style } }),
          ...(n.parentId && { parentId: n.parentId }),
          ...(n.handles && { handles: n.handles }),
          ...(n.width && { width: n.width }),
          ...(n.height && { height: n.height }),
          ...(n.hidden && { hidden: n.hidden }),
          ...(n.draggable === false && { draggable: false }),
          ...(n.selectable === false && { selectable: false }),
          ...(n.connectable === false && { connectable: false }),
          ...(n.deletable === false && { deletable: false }),
        })),
        edges: this.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.sourceHandle && { sourceHandle: e.sourceHandle }),
          ...(e.targetHandle && { targetHandle: e.targetHandle }),
          ...(e.type && { type: e.type }),
          ...(e.label && { label: e.label }),
          ...(e.animated && { animated: e.animated }),
          ...(e.data && { data: { ...e.data } }),
          ...(e.style && { style: { ...e.style } }),
          ...(e.className && { className: e.className }),
          ...(e.markerStart && { markerStart: e.markerStart }),
          ...(e.markerEnd && { markerEnd: e.markerEnd }),
        })),
        viewport: { ...this.viewport },
      };
    },

    fromJSON(json) {
      if (json.viewport) this.viewport = { ...json.viewport };
      if (json.nodes) this.nodes = json.nodes.map(normalizeNode);
      if (json.edges) this.edges = json.edges.map(normalizeEdge);

      this._initNodeLookup();
      this._applyViewportTransform();
      this._renderAllNodes();
      this._renderAllEdges();
      this._backgroundComponent?.update();
      this._minimapComponent?.update();
      this._controlsComponent?.update();
      this._refreshForceGraphData({ restart: true, reheat: true });
    },

    layoutNodesAndRender(opts = {}) {
      // Force all nodes through layout (ignore existing positions)
      const forceAll = opts.force === true;
      const layoutOpts = { ...opts };
      delete layoutOpts.force;

      if (forceAll) {
        // Temporarily mark all nodes as needing layout
        this.nodes = this.nodes.map((n) => ({ ...n, _needsLayout: true }));
      }

      // Only layout visible nodes/edges (precedence may have hidden some)
      const visibleNodes = this.nodes.filter((n) => !n.hidden);
      const visibleEdges = this.edges.filter((e) => !e.hidden);
      const laid = layoutNodes(visibleNodes, visibleEdges, layoutOpts);
      const posMap = new Map(laid.map((n) => [n.id, n.position]));
      this.nodes = this.nodes.map((n) => {
        const pos = posMap.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });

      // Clean up flags
      this.nodes = this.nodes.map((n) => {
        const { _needsLayout, ...rest } = n;
        return rest;
      });

      this._initNodeLookup();
      this._renderAllNodes();
      this._renderAllEdges();
      this._minimapComponent?.update();
      requestAnimationFrame(() => this.fitView());
      this._refreshForceGraphData({ restart: true, reheat: true });
    },

    startForce() {
      if (!this._isForceEnabled()) return;
      if (!this._forceSimulation) {
        this._initForceSimulation();
      }
      this._forceSimulation?.start((state) => this._onForceTick(state));
    },

    stopForce() {
      this._forceSimulation?.stop();
    },

    reheatForce(alpha = 0.2) {
      this._maybeReheatForce(alpha);
    },

    setForceOptions(opts = {}) {
      const current = this.options.forceLayout;
      this.options.forceLayout = {
        ...(current && current !== true ? current : {}),
        ...opts,
      };

      if (!this._isForceEnabled()) {
        this._destroyForceSimulation();
        return;
      }

      if (!this._forceSimulation) {
        this._initForceSimulation();
        return;
      }

      this._refreshForceGraphData({ restart: true, reheat: true });
      this._updateAmbientLoop();
    },

    pinNode(id, point = null) {
      if (!this._forceSimulation || !this._isForceEnabled()) return;
      const node = this._nodeLookup.get(id) || this.getNode(id);
      if (!node) return;
      const absPos = node.internals?.positionAbsolute ?? node.position;
      this._persistentPinnedNodeIds.add(id);
      this._forceSimulation.pinNode(id, point?.x ?? absPos.x, point?.y ?? absPos.y);
    },

    unpinNode(id) {
      if (!this._forceSimulation || !this._isForceEnabled()) return;
      this._persistentPinnedNodeIds.delete(id);
      this._forceSimulation.unpinNode(id);
      this._maybeReheatForce(0.1);
    },
  }));
}

// ─── Normalization Helpers ───────────────────────────────────

function normalizeNode(node) {
  const hasPosition = node.position != null &&
    (node.position.x !== undefined || node.position.y !== undefined);
  return {
    id: node.id,
    type: node.type || 'default',
    position: hasPosition ? { ...node.position } : { x: 0, y: 0 },
    _needsLayout: node._needsLayout ?? !hasPosition,
    data: node.data || {},
    style: node.style || {},
    className: node.className || '',
    sourcePosition: node.sourcePosition || Position.Bottom,
    targetPosition: node.targetPosition || Position.Top,
    hidden: node.hidden || false,
    selected: node.selected || false,
    draggable: node.draggable !== false,
    selectable: node.selectable !== false,
    connectable: node.connectable !== false,
    deletable: node.deletable !== false,
    dragHandle: node.dragHandle || null,
    width: node.width || null,
    height: node.height || null,
    initialWidth: node.initialWidth || null,
    initialHeight: node.initialHeight || null,
    parentId: node.parentId || null,
    extent: node.extent || null,
    expandParent: node.expandParent || false,
    origin: node.origin || null,
    handles: node.handles || null,
    measured: node.measured || { width: null, height: null },
    zIndex: node.zIndex || 0,
    dragging: false,
  };
}

function normalizeEdge(edge) {
  return {
    id: edge.id || `e-${edge.source}-${edge.target}`,
    type: edge.type || null,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    animated: edge.animated || false,
    hidden: edge.hidden || false,
    selected: edge.selected || false,
    selectable: edge.selectable !== false,
    deletable: edge.deletable !== false,
    data: edge.data || {},
    style: edge.style || {},
    className: edge.className || '',
    label: edge.label || '',
    labelStyle: edge.labelStyle || {},
    markerStart: edge.markerStart || null,
    markerEnd: edge.markerEnd || null,
    zIndex: edge.zIndex || 0,
    interactionWidth: edge.interactionWidth || 20,
  };
}

// ─── Static helpers on default export ────────────────────────
AlpineFlow.layoutNodes = layoutNodes;
AlpineFlow.LAYOUT_DEFAULTS = LAYOUT_DEFAULTS;
AlpineFlow.createForceSimulation = createForceSimulation;
AlpineFlow.FORCE_DEFAULTS = FORCE_DEFAULTS;

// ─── Named Exports (for advanced usage) ─────────────────────

export {
  // Constants
  Position, BackgroundVariant, ConnectionLineType, ConnectionMode,
  DEFAULTS,
  // Geometry
  clamp, getNodesBounds, getNodeDimensions, getViewportRect, snapPosition,
  // Viewport
  screenToFlowPosition, flowToScreenPosition, getTransformForBounds, zoomAtPoint,
  // Edge Paths
  getBezierPath, getSmoothStepPath, getStraightPath, getStepPath, getPathForEdgeType,
  // Graph Utilities
  getIncomers, getOutgoers, getConnectedEdges,
  addEdge, reconnectEdge,
  applyNodeChanges, applyEdgeChanges,
  deleteElements, isNode, isEdge,
  // Handle Utilities
  getHandlePosition, getEdgePosition,
  // Layout
  layoutNodes, LAYOUT_DEFAULTS,
  // Force
  createForceSimulation, FORCE_DEFAULTS,
};
