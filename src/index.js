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
      isValidConnection: null,
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
      this._initNodeLookup();
      this._initPanZoom();
      this._initNodeDrag();
      this._initConnectionHandler();
      this._initResizeObserver();
      this._initKeyboardHandler();
      this._renderAllNodes();
      this._renderAllEdges();

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
          setViewport: (vp) => { this.viewport = vp; },
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
      this._onInit?.(this._getPublicAPI());
    },

    destroy() {
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
      const pane = createElement('div', {
        className: 'alpine-flow__pane',
        style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' },
      }, zoomPane);

      // Viewport (CSS transform container)
      this._viewportEl = createElement('div', {
        className: 'alpine-flow__viewport',
        style: { position: 'absolute', top: '0', left: '0', transformOrigin: '0 0' },
      }, pane);

      // Edges SVG container (below nodes)
      this._edgesSvgEl = createSvgElement('svg', {
        class: 'alpine-flow__edges',
        style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' },
      }, this._viewportEl);

      // SVG defs for markers
      this._markerDefs = createSvgElement('defs', {}, this._edgesSvgEl);
      this._createDefaultMarkers();

      this._edgesGroupEl = createSvgElement('g', { class: 'alpine-flow__edge-group' }, this._edgesSvgEl);

      // Connection line SVG
      this._connectionLineSvgEl = createSvgElement('svg', {
        class: 'alpine-flow__connection-line',
        style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' },
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
        if (event.target === pane || event.target.classList.contains('alpine-flow__pane')) {
          this._deselectAll();
          this._onPaneClick?.(event);
        }
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
        setViewport: (vp) => { this.viewport = { ...vp }; },
        getViewport: () => ({ ...this.viewport }),
        screenToFlowPosition: (pos) => this.screenToFlowPosition(pos),
        flowToScreenPosition: (pos) => this.flowToScreenPosition(pos),
        getNode: (id) => this.getNode(id),
        getEdge: (id) => this.getEdge(id),
        getNodes: () => [...this.nodes],
        getEdges: () => [...this.edges],
        addNodes: (n) => this.addNodes(n),
        addEdges: (e) => this.addEdges(e),
        deleteElements: (els) => this.deleteSelectedElements(els),
        toJSON: () => this.toJSON(),
        fromJSON: (json) => this.fromJSON(json),
      };
    },

    // ──────────────────────────────────────────
    // Container Dimensions
    // ──────────────────────────────────────────
    _updateContainerDimensions() {
      this._containerWidth = this._containerEl.clientWidth;
      this._containerHeight = this._containerEl.clientHeight;
    },

    // ──────────────────────────────────────────
    // Node Lookup Management
    // ──────────────────────────────────────────
    _initNodeLookup() {
      this._nodeLookup = buildNodeLookup(this.nodes, this._nodeLookup);
      this._edgeLookup = new Map(this.edges.map((e) => [e.id, e]));
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
            this._onViewportChange?.(vp);
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

    // ──────────────────────────────────────────
    // Node Drag Initialization
    // ──────────────────────────────────────────
    _initNodeDrag() {
      this._dragHandler = createNodeDragHandler(
        () => this._getState(),
        {
          onNodeDragStart: (event, nodeId, nodes) => {
            this._onNodeDragStart?.(event, this.getNode(nodeId), nodes);
          },
          onNodeDrag: (event, nodeId, changes) => {
            this._onNodeDrag?.(event, this.getNode(nodeId), changes);
          },
          onNodeDragStop: (event, nodeId, nodes) => {
            this._onNodeDragStop?.(event, this.getNode(nodeId), nodes);
          },
          onPositionChange: (changes, isFinal) => {
            this._applyPositionChanges(changes, isFinal);
          },
          onViewportChange: (vp) => {
            this.viewport = { ...vp };
            this._applyViewportTransform();
            this._backgroundComponent?.update();
            this._minimapComponent?.update();
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
            className: `alpine-flow__node alpine-flow__node-${node.type || 'default'} ${node.className || ''} ${node.selected ? 'selected' : ''} ${node.draggable === false ? 'not-draggable' : ''}`.trim(),
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
        }
      }
    },

    _onNodePointerDown(event, nodeId) {
      // Select node on click (with multi-select support)
      const node = this.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey;

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
      this._onNodeClick?.(event, this.getNode(nodeId));
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
        if (edge.hidden) continue;
        this._renderEdge(edge);
      }
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
    },

    // ──────────────────────────────────────────
    // Public API Methods
    // ──────────────────────────────────────────
    fitView(options = {}) {
      if (this.nodes.length === 0) return;

      const bounds = getNodesBounds(Array.from(this._nodeLookup.values()));
      if (bounds.width === 0 && bounds.height === 0) return;

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
    },
  }));
}

// ─── Normalization Helpers ───────────────────────────────────

function normalizeNode(node) {
  return {
    id: node.id,
    type: node.type || 'default',
    position: node.position ? { ...node.position } : { x: 0, y: 0 },
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
};
