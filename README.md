# Alpine Flow

A high-performance, drop-in graph/node editor for [Alpine.js](https://alpinejs.dev/) projects. Inspired by [React Flow](https://reactflow.dev/), rebuilt from scratch using vanilla ES6 modules, Alpine.js reactivity, and pure DOM/SVG rendering.

**Zero build step required.** Import the plugin, register it with Alpine, and you have an interactive node graph.

## Features

- **Infinite canvas** — pan, zoom, and scroll across an unbounded workspace with a dotted/lines/cross grid background
- **Draggable nodes** — pointer-event-driven dragging with snap-to-grid, multi-select, and auto-pan at edges
- **Multiple edge types** — bezier (default), smoothstep, step, and straight paths with animated and labeled edges
- **Drag-to-connect** — draw connections between handles with closest-handle detection and validation
- **Minimap** — bird's-eye overview with click-to-pan
- **Controls** — zoom in/out, fit-view, and lock/unlock interactivity
- **Keyboard shortcuts** — delete, select-all, arrow-key nudge, escape to deselect
- **Selection box** — shift-drag to marquee-select multiple nodes
- **JSON export/import** — serialize the entire graph state and restore it
- **Auto-layout** — built-in hierarchical layout (Sugiyama-style) for nodes without explicit positions; manually-positioned nodes are preserved
- **Themeable** — dark mode by default, light mode via CSS class, full CSS custom property override
- **Tiny footprint** — no dependencies beyond Alpine.js; pure ES6 modules, no bundler needed
- **Performance-first** — direct DOM mutation during drag (bypasses reactive diffing), `ResizeObserver` for node measurement, `requestAnimationFrame` auto-pan loop

---

## Quick Start

### Option A: CDN (no build step)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="alpine-flow.css" />
  <style> html, body { margin: 0; height: 100%; } </style>
</head>
<body>
  <div id="app" style="width: 100%; height: 100vh;"
    x-data="alpineFlow({
      nodes: [
        { id: '1', type: 'input',   position: { x: 50,  y: 50  }, data: { label: 'Start' } },
        { id: '2', type: 'default', position: { x: 300, y: 100 }, data: { label: 'Process' } },
        { id: '3', type: 'output',  position: { x: 550, y: 50  }, data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1-2', source: '1', target: '2', animated: true },
        { id: 'e2-3', source: '2', target: '3' },
      ],
      options: { fitView: true },
    })">
  </div>

  <script type="module">
    import Alpine from 'https://esm.sh/alpinejs@3.14.8';
    import AlpineFlow from './src/index.js';

    Alpine.plugin(AlpineFlow);
    Alpine.start();
  </script>
</body>
</html>
```

### Option B: npm / ES module bundler

```bash
# Copy alpine-flow into your project (or npm link)
npm install alpinejs
```

```js
import Alpine from 'alpinejs';
import AlpineFlow from './path-to/alpine-flow/src/index.js';

Alpine.plugin(AlpineFlow);
Alpine.start();
```

Then include `alpine-flow.css` in your HTML or import it in your CSS pipeline.

---

## How It Works

Alpine Flow registers an `alpineFlow` data component via `Alpine.plugin()`. When you put `x-data="alpineFlow({...})"` on a container element, it:

1. Builds the internal DOM (viewport div, edges SVG, nodes container, connection line, selection box)
2. Initializes pan/zoom via Pointer Events + wheel listeners on the renderer pane
3. Renders each node as a positioned `<div>` inside the viewport
4. Renders each edge as an SVG `<path>` inside the viewport
5. Observes node dimensions via `ResizeObserver` and measures handle positions from the DOM
6. Optionally adds a background grid, control buttons, and a minimap as overlay elements

All viewport transforms use `translate(x, y) scale(zoom)` on a single container div. Node positions during drag are written directly to `element.style.transform` for maximum frame rate — Alpine's reactive system is updated in parallel but doesn't drive the hot loop.

---

## Configuration

Pass a config object to `alpineFlow({...})`:

```js
alpineFlow({
  // ── Data ──────────────────────────────────
  nodes: [],                   // Array of node objects (see Node shape below)
  edges: [],                   // Array of edge objects (see Edge shape below)

  // ── Options ───────────────────────────────
  options: {
    fitView: false,            // Auto-fit all nodes into view on init
    fitViewPadding: 0.1,       // Padding ratio for fitView

    // Zoom
    minZoom: 0.1,              // Minimum zoom level
    maxZoom: 2,                // Maximum zoom level
    zoomOnScroll: true,        // Mouse wheel zooms
    zoomOnPinch: true,         // Trackpad pinch zooms
    zoomOnDoubleClick: true,   // Double-click zooms in

    // Pan
    panOnDrag: true,           // Click-drag on empty space pans
    panOnScroll: false,        // Mouse wheel pans instead of zooms
    panOnScrollMode: 'free',   // 'free' | 'horizontal' | 'vertical'
    panOnScrollSpeed: 0.5,     // Pan speed multiplier

    // Nodes
    nodesDraggable: true,      // Nodes can be dragged
    nodesConnectable: true,    // Handles are active for connections
    elementsSelectable: true,  // Nodes/edges can be selected
    snapToGrid: false,         // Snap node positions to grid
    snapGrid: [20, 20],        // Grid cell size [x, y]
    nodeDragThreshold: 1,      // Pixels before drag starts
    autoPanOnNodeDrag: true,   // Auto-pan when dragging near edges
    autoPanSpeed: 15,          // Auto-pan speed
    nodeOrigin: [0, 0],        // Node position origin [0-1, 0-1]

    // Connections
    connectionMode: 'strict',  // 'strict' (source→target only) | 'loose'
    connectionLineType: 'bezier', // 'bezier' | 'smoothstep' | 'step' | 'straight'
    connectionRadius: 20,      // Max distance to snap to a handle

    // Edges
    defaultEdgeType: 'default', // 'default' (bezier) | 'smoothstep' | 'step' | 'straight'

    // Keyboard
    deleteKeyCode: 'Backspace',
    selectionKeyCode: 'Shift',
    multiSelectionKeyCode: 'Meta',

    // CSS class overrides
    noDragClassName: 'nodrag',   // Class that prevents dragging
    noWheelClassName: 'nowheel', // Class that prevents wheel zoom
    noPanClassName: 'nopan',     // Class that prevents panning

    // Background
    showBackground: true,
    background: {
      variant: 'dots',         // 'dots' | 'lines' | 'cross'
      gap: 20,                 // Grid spacing in pixels
      size: 1,                 // Dot radius / line stroke width
      color: null,             // Override pattern color (CSS color string)
    },

    // UI components
    showControls: true,
    showMinimap: false,

    // Auto Layout
    autoLayout: false,         // true | object (see Auto Layout section)

    // Validation
    isValidConnection: null,   // (connection) => boolean
  },

  // ── Custom node renderers ─────────────────
  nodeTypes: {
    // 'myType': (node) => '<div>...</div>'
  },

  // ── Callbacks ─────────────────────────────
  onConnect(connection) {},        // New edge connected
  onConnectStart(event, params) {},
  onConnectEnd(event) {},
  onNodeClick(event, node) {},
  onNodeDoubleClick(event, node) {},
  onNodeDragStart(event, node, nodes) {},
  onNodeDrag(event, node, changes) {},
  onNodeDragStop(event, node, nodes) {},
  onEdgeClick(event, edge) {},
  onPaneClick(event) {},
  onViewportChange(viewport) {},
  onNodesChange(changes) {},
  onEdgesChange(changes) {},
  onSelectionChange({ nodes, edges }) {},
  onInit(api) {},                  // Fired once; receives the public API object
})
```

---

## Data Shapes

### Node

```js
{
  id: 'node-1',                    // Required — unique string
  type: 'default',                 // 'default' | 'input' | 'output' | custom key
  position: { x: 100, y: 200 },   // Required — flow-space coordinates
  data: { label: 'My Node' },     // Arbitrary payload; label is used by default renderer
  sourcePosition: 'bottom',       // 'top' | 'right' | 'bottom' | 'left'
  targetPosition: 'top',          // 'top' | 'right' | 'bottom' | 'left'

  // Optional overrides
  width: null,                     // Explicit width (otherwise measured from DOM)
  height: null,                    // Explicit height
  hidden: false,
  selected: false,
  draggable: true,                 // false to lock this node
  selectable: true,
  connectable: true,
  deletable: true,
  className: '',                   // Extra CSS classes on the node wrapper
  style: {},                       // Extra inline styles
  zIndex: 0,
  parentId: null,                  // For nested / grouped nodes
  dragHandle: null,                // CSS selector for drag-handle sub-element
  handles: null,                   // Programmatic handle definitions (advanced)
}
```

### Edge

```js
{
  id: 'edge-1',                    // Required — unique string
  source: 'node-1',               // Required — source node ID
  target: 'node-2',               // Required — target node ID
  sourceHandle: null,              // Handle ID on source (null = first handle)
  targetHandle: null,              // Handle ID on target
  type: null,                      // 'default' | 'bezier' | 'smoothstep' | 'step' | 'straight'
  label: '',                       // Text label on the edge
  animated: false,                 // Animated dashed stroke
  hidden: false,
  selected: false,
  selectable: true,
  deletable: true,
  data: {},                        // Arbitrary payload
  style: {},                       // { stroke, strokeWidth, ... }
  className: '',
  labelStyle: {},
  markerStart: null,               // Arrow marker at start
  markerEnd: null,                 // Arrow marker at end
  interactionWidth: 20,            // Invisible click-target width
  zIndex: 0,
}
```

### Viewport

```js
{ x: 0, y: 0, zoom: 1 }
```

### Connection (passed to `onConnect`)

```js
{ source: 'node-1', target: 'node-2', sourceHandle: null, targetHandle: null }
```

---

## Public API

The `onInit` callback receives an API object. You can also get it any time via `Alpine.$data(containerEl)`.

| Method | Description |
|--------|-------------|
| `fitView(options?)` | Fit all nodes into the viewport. Options: `{ padding, minZoom, maxZoom }` |
| `zoomIn(options?)` | Zoom in by `step` (default 0.5). Options: `{ step }` |
| `zoomOut(options?)` | Zoom out by `step` |
| `zoomTo(level, options?)` | Zoom to an exact level (clamped to min/max) |
| `panBy({ x, y })` | Pan the viewport by a pixel delta |
| `setViewport({ x, y, zoom })` | Set the viewport transform directly |
| `getViewport()` | Get the current `{ x, y, zoom }` |
| `screenToFlowPosition({ x, y })` | Convert screen pixel coords → flow-space coords |
| `flowToScreenPosition({ x, y })` | Convert flow-space coords → screen pixel coords |
| `getNode(id)` | Get a node by ID (or `null`) |
| `getEdge(id)` | Get an edge by ID (or `null`) |
| `getNodes()` | Get a copy of all nodes |
| `getEdges()` | Get a copy of all edges |
| `addNodes(nodeOrArray)` | Add one or more nodes |
| `addEdges(edgeOrArray)` | Add one or more edges |
| `deleteElements()` | Delete all currently selected nodes and edges |
| `getIncomers(nodeOrId)` | Get nodes with edges pointing **to** this node |
| `getOutgoers(nodeOrId)` | Get nodes with edges pointing **from** this node |
| `getConnectedEdges(nodeOrNodes)` | Get all edges touching the given node(s) |
| `toJSON()` | Serialize the graph to a plain object `{ nodes, edges, viewport }` |
| `fromJSON(json)` | Restore graph state from a `toJSON()` object |
| `layoutNodes(options?)` | Run auto-layout on all nodes. Options: `{ direction, nodeSpacing, rankSpacing, force }`. Pass `force: true` to re-layout even nodes that have positions |
| `toggleInteractivity()` | Toggle dragging, connecting, and selection on/off |

---

## Custom Node Types

Register custom renderers by passing a `nodeTypes` map. Each value is a function that receives the node object and returns an HTML string:

```js
alpineFlow({
  nodeTypes: {
    colorPicker: (node) => `
      <div class="alpine-flow__node-content" style="padding: 12px;">
        <strong>${node.data.label}</strong>
        <input type="color" value="${node.data.color || '#ff0000'}" class="nodrag" />
        <div class="alpine-flow__handle alpine-flow__handle-target"
             data-handletype="target" data-handleposition="top"></div>
        <div class="alpine-flow__handle alpine-flow__handle-source"
             data-handletype="source" data-handleposition="bottom"></div>
      </div>
    `,
  },
  nodes: [
    { id: '1', type: 'colorPicker', position: { x: 0, y: 0 }, data: { label: 'Pick', color: '#00ff88' } },
  ],
  // ...
})
```

> **Important:** Include `.alpine-flow__handle` elements with `data-handletype` (`source` or `target`) and `data-handleposition` (`top`, `right`, `bottom`, `left`) for connections to work. Add the `nodrag` class to interactive sub-elements (inputs, buttons) so they don't trigger node drag.

### Built-in node types

| Type | Description |
|------|-------------|
| `default` | Source handle (bottom) + target handle (top) + label |
| `input` | Source handle only (no target) — entry point |
| `output` | Target handle only (no source) — exit point |

---

## Auto Layout

Alpine Flow includes a built-in hierarchical layout algorithm (Sugiyama-style). It computes clean, readable positions for graph nodes based on the edge topology — no external dependencies required.

### Key behavior: explicit positions always win

When `autoLayout` is enabled, it only assigns positions to **nodes that don't already have one**. If a node provides `position: { x, y }`, that position is used as-is. This means:

1. On first render with `autoLayout: true`, nodes without `position` get laid out automatically
2. Users drag nodes to new positions → those positions are now explicit
3. You call `toJSON()` and save — every node now has an `x,y`
4. On next load, even with `autoLayout: true`, no nodes are moved because they all have positions

This is ideal for an **edit-then-save** workflow.

### Enable on init

```js
alpineFlow({
  nodes: [
    { id: '1', data: { label: 'Start' } },          // ← no position → auto-laid-out
    { id: '2', data: { label: 'Process' } },         // ← no position → auto-laid-out
    { id: '3', position: { x: 500, y: 0 }, data: { label: 'Pinned' } },  // ← has position → stays put
  ],
  edges: [
    { id: 'e1-2', source: '1', target: '2' },
    { id: 'e2-3', source: '2', target: '3' },
  ],
  options: {
    autoLayout: true,    // use defaults (TB direction, 50px spacing)
    fitView: true,
  },
})
```

### Layout options

Pass an object instead of `true` for fine control:

```js
options: {
  autoLayout: {
    direction: 'LR',      // 'TB' (top→bottom) | 'LR' (left→right) | 'BT' | 'RL'
    nodeSpacing: 60,      // gap between nodes in the same rank (default: 50)
    rankSpacing: 120,     // gap between ranks/layers (default: 100)
    nodeWidth: 172,       // fallback node width if not yet measured (default: 172)
    nodeHeight: 36,       // fallback node height (default: 36)
    alignment: 'center',  // 'start' | 'center' | 'end' within each rank
  },
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `direction` | `'TB'` | Flow direction: `TB` (top→bottom), `LR` (left→right), `BT` (bottom→top), `RL` (right→left) |
| `nodeSpacing` | `50` | Horizontal gap between sibling nodes in the same rank |
| `rankSpacing` | `100` | Vertical gap between ranks (layers) |
| `nodeWidth` | `172` | Fallback width when node hasn't been measured yet |
| `nodeHeight` | `36` | Fallback height |
| `alignment` | `'center'` | Cross-axis alignment of nodes within each rank |

### Run layout on demand

Call `layoutNodes()` any time via the public API:

```js
// Layout only nodes that don't have positions
api.layoutNodes({ direction: 'LR' });

// Force re-layout ALL nodes (ignoring existing positions)
api.layoutNodes({ direction: 'TB', force: true });
```

### How the algorithm works

1. **Rank assignment** — topological sort assigns each node to a layer (handles cycles and disconnected subgraphs)
2. **Barycenter ordering** — nodes within each layer are reordered to minimize edge crossings
3. **Coordinate assignment** — each layer is spaced evenly along the rank axis, nodes spaced along the cross axis
4. **Position merge** — computed positions are only applied to nodes that lack explicit `{ x, y }`

For more advanced layout needs (e.g., elk, dagre), you can import `layoutNodes` standalone and feed it your own data:

```js
import { layoutNodes } from 'alpine-flow/layout';

const positioned = layoutNodes(myNodes, myEdges, { direction: 'LR' });
```

---

## Edge Types

| Type | Path | Description |
|------|------|-------------|
| `default` / `bezier` | Cubic bezier | Smooth curves with a configurable curvature factor |
| `smoothstep` | Orthogonal + rounded corners | Right-angle routing with border-radius bends |
| `step` | Orthogonal | Right-angle routing with sharp corners |
| `straight` | Straight line | Direct point-to-point |

Set the type per-edge via `edge.type`, or set the global default via `options.defaultEdgeType`.

---

## Theming

Alpine Flow ships with a dark theme by default. Add the `light` class to switch:

```html
<div x-data="alpineFlow({...})" class="light">
```

### CSS Custom Properties

Override any of these on `.alpine-flow` or on a parent element:

```css
.alpine-flow {
  /* Background */
  --alpine-flow-bg: #1a1a2e;
  --alpine-flow-pattern-color: rgba(255, 255, 255, 0.06);

  /* Nodes */
  --alpine-flow-node-bg: #16213e;
  --alpine-flow-node-border: #0f3460;
  --alpine-flow-node-color: #e4e4e7;
  --alpine-flow-node-border-radius: 8px;
  --alpine-flow-node-box-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.15);
  --alpine-flow-node-selected-border: #4f8ff7;
  --alpine-flow-node-selected-box-shadow: 0 0 0 2px #4f8ff7, 0 4px 16px rgba(79,143,247,0.25);

  /* Handles */
  --alpine-flow-handle-bg: #4f8ff7;
  --alpine-flow-handle-border: #1a1a2e;
  --alpine-flow-handle-size: 10px;

  /* Edges */
  --alpine-flow-edge-stroke: #4a5568;
  --alpine-flow-edge-stroke-width: 2;
  --alpine-flow-edge-selected-stroke: #4f8ff7;
  --alpine-flow-edge-selected-stroke-width: 2.5;

  /* Controls panel */
  --alpine-flow-controls-bg: #16213e;
  --alpine-flow-controls-border: #0f3460;
  --alpine-flow-controls-color: #e4e4e7;
  --alpine-flow-controls-button-hover: #0f3460;

  /* Minimap */
  --alpine-flow-minimap-bg: rgba(22, 33, 62, 0.85);
  --alpine-flow-minimap-border: #0f3460;
  --alpine-flow-minimap-node-color: #4a5568;
  --alpine-flow-minimap-node-selected: #4f8ff7;

  /* Selection */
  --alpine-flow-selection-bg: rgba(79, 143, 247, 0.08);
  --alpine-flow-selection-border: #4f8ff7;
}
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Backspace` / `Delete` | Delete selected nodes and edges |
| `Ctrl+A` / `Cmd+A` | Select all |
| `Escape` | Deselect all |
| `Arrow keys` | Nudge selected nodes by 1px |
| `Shift + Arrow keys` | Nudge selected nodes by 10px |
| `Shift + drag` on pane | Selection box |

---

## Advanced: Importing Individual Modules

Every module is a standalone ES6 file you can import directly:

```js
// Edge path math (no Alpine dependency)
import { getBezierPath, getSmoothStepPath, getStraightPath } from 'alpine-flow/edges';

// Graph utilities
import { getIncomers, getOutgoers, addEdge, deleteElements } from 'alpine-flow/graph';

// Geometry
import { getNodesBounds, snapPosition, clamp } from 'alpine-flow/geometry';

// Viewport math
import { screenToFlowPosition, flowToScreenPosition, zoomAtPoint } from 'alpine-flow/viewport';
```

---

## API Reference

### `src/index.js` — Plugin & Main Component

The default export is an Alpine.js plugin function.

```js
import AlpineFlow from 'alpine-flow';
Alpine.plugin(AlpineFlow);
```

This registers the `alpineFlow(config)` data component globally. See [Configuration](#configuration) for the full config shape.

**Named exports** (re-exported from sub-modules for convenience):

```js
import {
  // Constants
  Position, BackgroundVariant, ConnectionLineType, ConnectionMode, DEFAULTS,

  // Geometry
  clamp, getNodesBounds, getNodeDimensions, getViewportRect, snapPosition,

  // Viewport
  screenToFlowPosition, flowToScreenPosition, getTransformForBounds, zoomAtPoint,

  // Edge paths
  getBezierPath, getSmoothStepPath, getStraightPath, getStepPath, getPathForEdgeType,

  // Graph utilities
  getIncomers, getOutgoers, getConnectedEdges,
  addEdge, reconnectEdge,
  applyNodeChanges, applyEdgeChanges,
  deleteElements, isNode, isEdge,

  // Handle utilities
  getHandlePosition, getEdgePosition,
} from 'alpine-flow';
```

---

### `src/constants.js`

| Export | Type | Value |
|--------|------|-------|
| `Position` | Object | `{ Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' }` |
| `OppositePosition` | Object | Maps each position to its opposite |
| `ConnectionMode` | Object | `{ Strict: 'strict', Loose: 'loose' }` |
| `ConnectionLineType` | Object | `{ Bezier: 'bezier', SmoothStep: 'smoothstep', Step: 'step', Straight: 'straight' }` |
| `PanOnScrollMode` | Object | `{ Free: 'free', Horizontal: 'horizontal', Vertical: 'vertical' }` |
| `SelectionMode` | Object | `{ Partial: 'partial', Full: 'full' }` |
| `BackgroundVariant` | Object | `{ Dots: 'dots', Lines: 'lines', Cross: 'cross' }` |
| `DEFAULTS` | Object | All default option values |
| `infiniteExtent` | Array | `[[-Infinity, -Infinity], [Infinity, Infinity]]` |

---

### `src/geometry.js`

| Function | Signature | Returns |
|----------|-----------|---------|
| `clamp(val, min, max)` | `(number, number, number)` | Clamped number |
| `rectToBox(rect)` | `({ x, y, width, height })` | `{ x, y, x2, y2 }` |
| `boxToRect(box)` | `({ x, y, x2, y2 })` | `{ x, y, width, height }` |
| `getBoundsOfRects(a, b)` | `(rect, rect)` | Combined bounding rect |
| `getOverlappingArea(a, b)` | `(rect, rect)` | Overlap area (0 if none) |
| `getNodeRect(node)` | `(internalNode)` | `{ x, y, width, height }` |
| `getNodesBounds(nodes)` | `(internalNode[])` | Bounding rect of all nodes |
| `isRectVisible(rect, viewRect)` | `(rect, rect)` | `boolean` |
| `getViewportRect(viewport, w, h)` | `(viewport, number, number)` | Flow-space visible rect |
| `snapPosition(pos, grid)` | `({ x, y }, [gx, gy])` | Snapped `{ x, y }` |
| `getNodeDimensions(node)` | `(node)` | `{ width, height }` — uses measured → explicit → initial → 0 |
| `calcAutoPanVelocity(pos, bounds, dist, speed)` | `(...)` | `[dx, dy]` velocity vector |
| `rectsIntersect(a, b)` | `(rect, rect)` | `boolean` |
| `isEdgeVisible(edge, lookup, viewRect)` | `(edge, nodeLookup, rect)` | `boolean` |
| `clampPosition(pos, extent)` | `(pos, [[minX,minY],[maxX,maxY]])` | Clamped `{ x, y }` |

---

### `src/viewport.js`

| Function | Signature | Returns |
|----------|-----------|---------|
| `screenToFlowPosition(screenPos, viewport, containerBounds)` | `({ x, y }, viewport, DOMRect)` | `{ x, y }` in flow space |
| `flowToScreenPosition(flowPos, viewport)` | `({ x, y }, viewport)` | `{ x, y }` in screen space |
| `getPointerPosition(event, { transform, snapGrid, snapToGrid, containerBounds })` | `(Event, options)` | `{ x, y, xSnapped, ySnapped }` |
| `zoomAtPoint(viewport, point, newZoom)` | `(viewport, { x, y }, number)` | New viewport `{ x, y, zoom }` — keeps screen point stable |
| `getTransformForBounds(bounds, width, height, minZoom, maxZoom, padding)` | `(rect, ...)` | `{ x, y, zoom }` to fit bounds in container |
| `wheelDelta(event)` | `(WheelEvent)` | Normalized zoom delta (handles deltaMode, macOS pinch) |
| `createPanZoomHandler(domNode, getState, callbacks)` | `(HTMLElement, fn, { onViewportChange, ... })` | `{ destroy() }` — attaches pointer + wheel listeners |

---

### `src/edges.js`

All path functions return `[pathString, labelX, labelY, offsetX, offsetY]`.

| Function | Key Parameters | Description |
|----------|---------------|-------------|
| `getStraightPath({ sourceX, sourceY, targetX, targetY })` | positions | Direct line; label at midpoint |
| `getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature? })` | positions + curvature (default 0.25) | Cubic bezier with auto-directed control points |
| `getSmoothStepPath({ ..., borderRadius?, offset? })` | positions + borderRadius (default 5), offset (default 0.5) | Orthogonal routing with rounded corners |
| `getStepPath({ ... })` | same as smoothstep | Alias with `borderRadius: 0` |
| `getPathForEdgeType(type)` | `string` | Returns the path function for `'bezier'`/`'smoothstep'`/`'step'`/`'straight'` |

---

### `src/graph.js`

| Function | Signature | Returns |
|----------|-----------|---------|
| `getIncomers(nodeOrId, nodes, edges)` | `(string\|node, node[], edge[])` | Nodes with edges pointing to the given node |
| `getOutgoers(nodeOrId, nodes, edges)` | `(string\|node, node[], edge[])` | Nodes the given node points to |
| `getConnectedEdges(nodeOrNodes, edges)` | `(node\|node[], edge[])` | All edges touching the given node(s) |
| `addEdge(edgeOrConnection, edges)` | `(edge, edge[])` | New array with edge added (deduped by source+target+handles) |
| `reconnectEdge(oldEdge, newConnection, edges)` | `(edge, connection, edge[])` | Array with edge replaced |
| `applyNodeChanges(changes, nodes)` | `(change[], node[])` | New node array with changes applied |
| `applyEdgeChanges(changes, edges)` | `(change[], edge[])` | New edge array with changes applied |
| `deleteElements({ nodesToRemove, edgesToRemove }, nodes, edges)` | `(targets, node[], edge[])` | `{ nodes, edges }` with elements removed |
| `isNode(obj)` | `(any)` | `boolean` — has `id` + `position`, no `source` |
| `isEdge(obj)` | `(any)` | `boolean` — has `id` + `source` + `target` |

**Change types** for `applyNodeChanges`:

```js
{ type: 'position', id, position, dragging }
{ type: 'dimensions', id, dimensions }
{ type: 'select', id, selected }
{ type: 'remove', id }
{ type: 'add', item }
{ type: 'reset', item }
```

---

### `src/handles.js`

| Function | Signature | Returns |
|----------|-----------|---------|
| `getHandlePosition(node, handle, fallbackPosition, center?)` | `(internalNode, handle, string, boolean)` | `{ x, y }` absolute position of the handle's connection point |
| `getEdgePosition(sourceNode, sourceHandleId, targetNode, targetHandleId)` | `(internalNode, string?, internalNode, string?)` | `{ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }` |
| `getClosestHandle(position, connectionRadius, handles, fromHandleType)` | `(pos, number, handle[], string)` | Closest handle within radius (prefers opposite type) |
| `createConnectionHandler(getState, callbacks)` | `(fn, { onConnect, ... })` | `{ handlePointerDown(e, nodeId, handleId, type, position), destroy() }` |

---

### `src/nodes.js`

| Function | Signature | Returns |
|----------|-----------|---------|
| `buildNodeLookup(nodes, existingLookup?)` | `(node[], Map?)` | `Map<id, internalNode>` with `positionAbsolute`, `z`, `measured`, `handleBounds` |
| `createNodeResizeObserver(callback)` | `((nodeId, dims) => void)` | `ResizeObserver` that reports per-node dimension changes |
| `createNodeDragHandler(getState, callbacks)` | `(fn, { onPositionChange, ... })` | `{ onPointerDown(e, nodeId), destroy() }` |
| `defaultNodeTypes` | Object | `{ default, input, output }` — each `(node) => htmlString` |

---

### `src/dom.js`

| Function | Signature | Description |
|----------|-----------|-------------|
| `getHostForElement(el)` | `(Element)` | Returns the ShadowRoot or `document` owning the element |
| `getEventPosition(event, bounds?)` | `(Event, DOMRect?)` | Extracts `{ x, y }` from mouse or touch event |
| `hasSelector(target, selector, root)` | `(Element, string, Element)` | Walks up the DOM checking `.matches(selector)` |
| `isMacOs()` | `()` | Platform detection |
| `createElement(tag, attrs, parent?)` | `(string, object, Element?)` | Create + configure + append an HTML element |
| `createSvgElement(tag, attrs, parent?)` | `(string, object, Element?)` | Create + configure + append an SVG element |
| `uniqueId(prefix?)` | `(string?)` | Returns `prefix-xxxxxxxx` |
| `getZoomFromElement(el)` | `(Element)` | Reads the CSS `transform: scale(...)` value from an element |

---

### `src/background.js`

```js
createBackground(containerEl, getState) → { update(), destroy() }
```

Creates an SVG with a `<pattern>` + `<rect fill="url(#...)">` overlay. The pattern's position and scale track the viewport transform. Supports `dots`, `lines`, and `cross` variants.

---

### `src/controls.js`

```js
createControls(containerEl, getState, actions) → { update(), destroy() }
```

Creates a button panel (default: bottom-left) with zoom in, zoom out, fit view, and lock/unlock. `actions` is `{ zoomIn, zoomOut, fitView, toggleInteractivity }`.

---

### `src/minimap.js`

```js
createMinimap(containerEl, getState, actions) → { update(), destroy() }
```

Creates an SVG minimap (default: bottom-right) showing all nodes as rectangles and the current viewport as a highlighted window. Click/drag on the minimap to pan. `actions` is `{ setViewport }`.

---

### `src/layout.js`

| Function | Signature | Returns |
|----------|-----------|---------|
| `layoutNodes(nodes, edges, options?)` | `(node[], edge[], object?)` | New node array with positions computed for nodes lacking explicit `{ x, y }` |

**Options** (all optional, merged with `LAYOUT_DEFAULTS`):

| Option | Default | Description |
|--------|---------|-------------|
| `direction` | `'TB'` | `'TB'` \| `'LR'` \| `'BT'` \| `'RL'` |
| `nodeSpacing` | `50` | Gap between nodes in the same rank |
| `rankSpacing` | `100` | Gap between ranks |
| `nodeWidth` | `172` | Fallback width for unmeasured nodes |
| `nodeHeight` | `36` | Fallback height |
| `alignment` | `'center'` | `'start'` \| `'center'` \| `'end'` |

Also exports `LAYOUT_DEFAULTS` (the default options object).

---

## CSS Class Reference

| Class | Applied to | Purpose |
|-------|-----------|---------|
| `.alpine-flow` | Container | Root; scopes all custom properties |
| `.alpine-flow.light` | Container | Activates light theme |
| `.alpine-flow__renderer` | Zoom pane | Receives pan/zoom pointer events |
| `.alpine-flow__pane` | Pane | Click target for pane clicks / selection |
| `.alpine-flow__viewport` | Viewport | CSS `transform: translate(x,y) scale(z)` |
| `.alpine-flow__nodes` | Nodes wrapper | Contains all node elements |
| `.alpine-flow__node` | Each node | Positioned via `transform: translate(x,y)` |
| `.alpine-flow__node.selected` | Selected node | Highlighted border/shadow |
| `.alpine-flow__node.dragging` | Dragging node | Slightly elevated shadow |
| `.alpine-flow__node-default` | Default type | Type-specific class |
| `.alpine-flow__node-input` | Input type | Type-specific class |
| `.alpine-flow__node-output` | Output type | Type-specific class |
| `.alpine-flow__handle` | Connection handle | Circle on node edge |
| `.alpine-flow__handle-source` | Source handle | Outgoing connection point |
| `.alpine-flow__handle-target` | Target handle | Incoming connection point |
| `.alpine-flow__edges` | Edges SVG | Contains all edge paths |
| `.alpine-flow__edge` | Each edge group | SVG `<g>` for one edge |
| `.alpine-flow__edge.animated` | Animated edge | Dashed stroke animation |
| `.alpine-flow__edge.selected` | Selected edge | Highlighted color |
| `.alpine-flow__edge-path` | Visible path | The rendered stroke |
| `.alpine-flow__edge-interaction` | Hit area path | Invisible wider stroke for clicking |
| `.alpine-flow__edge-label` | Edge label | Positioned at path midpoint |
| `.alpine-flow__background` | Background SVG | Grid overlay |
| `.alpine-flow__controls` | Controls panel | Button group |
| `.alpine-flow__minimap` | Minimap SVG | Overview panel |
| `.alpine-flow__selection-box` | Selection rect | Shift-drag marquee |
| `.nodrag` | Any sub-element | Prevents node drag when interacting |
| `.nowheel` | Any element | Prevents wheel-zoom |
| `.nopan` | Any element | Prevents panning |
