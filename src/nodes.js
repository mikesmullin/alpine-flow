/**
 * Alpine Flow - Node System
 * Handles node rendering, measurement, dragging, and position management.
 */

import { DEFAULTS, Position } from './constants.js';
import { getEventPosition, hasSelector, getHostForElement, createElement } from './dom.js';
import { getNodeDimensions, snapPosition, calcAutoPan, clampPosition } from './geometry.js';

// ─── Node Internals ──────────────────────────────────────────

/**
 * Build the node lookup map from an array of nodes.
 * Enriches each node with internals (positionAbsolute, z, handleBounds).
 * @param {Array} nodes
 * @param {Map} existingLookup - Previous lookup to preserve measured data and handleBounds
 * @returns {Map<string, object>}
 */
export function buildNodeLookup(nodes, existingLookup = new Map()) {
  const lookup = new Map();
  const parentLookup = new Map();

  // First pass: create all enriched nodes
  for (const node of nodes) {
    const existing = existingLookup.get(node.id);
    const enriched = {
      ...node,
      measured: node.measured ?? existing?.measured ?? { width: null, height: null },
      internals: {
        positionAbsolute: { ...node.position },
        z: node.zIndex ?? 0,
        handleBounds: existing?.internals?.handleBounds ?? { source: [], target: [] },
        userNode: node,
      },
    };
    lookup.set(node.id, enriched);

    if (node.parentId) {
      if (!parentLookup.has(node.parentId)) {
        parentLookup.set(node.parentId, new Map());
      }
      parentLookup.get(node.parentId).set(node.id, enriched);
    }
  }

  // Second pass: compute absolute positions (handle parent nesting)
  for (const [id, node] of lookup) {
    if (node.parentId) {
      const parent = lookup.get(node.parentId);
      if (parent) {
        const parentPos = parent.internals.positionAbsolute;
        node.internals.positionAbsolute = {
          x: parentPos.x + node.position.x,
          y: parentPos.y + node.position.y,
        };
        // Child nodes render above parents
        node.internals.z = Math.max(node.internals.z, (parent.internals.z || 0) + 1);
      }
    }
  }

  return lookup;
}

// ─── Node Measurement ────────────────────────────────────────

/**
 * Create a ResizeObserver that measures node DOM elements and reports dimensions.
 * @param {Function} onMeasure - Called with (nodeId, { width, height })
 * @returns {ResizeObserver}
 */
export function createNodeResizeObserver(onMeasure) {
  return new ResizeObserver((entries) => {
    for (const entry of entries) {
      const nodeId = entry.target.dataset?.id;
      if (!nodeId) continue;

      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        onMeasure(nodeId, { width, height });
      }
    }
  });
}

// ─── Node Drag Handler ───────────────────────────────────────

/**
 * Create a node drag handler using raw Pointer Events.
 * Following xyflow's pattern: distance vector from grab point, snap-to-grid, auto-pan.
 *
 * @param {Function} getState - Returns current state
 * @param {object} callbacks - { onNodeDragStart, onNodeDrag, onNodeDragStop, onPositionChange }
 * @returns {{ onPointerDown: Function, destroy: Function }}
 */
export function createNodeDragHandler(getState, callbacks) {
  let isDragging = false;
  let dragNodeId = null;
  let dragItems = new Map(); // nodeId → { node, distance: {x, y}, startPosition: {x, y} }
  let lastPos = null;
  let mousePosition = { x: 0, y: 0 };
  let containerBounds = null;
  let startMousePosition = null;
  let autoPanId = null;

  function onPointerDown(event, nodeId) {
    const state = getState();
    const { viewport, nodeLookup, options } = state;

    // Check for noDragClassName
    if (options.noDragClassName && hasSelector(event.target, `.${options.noDragClassName}`, event.currentTarget)) {
      return;
    }

    // Check for dragHandle selector
    const nodeEl = event.currentTarget;
    if (options.dragHandle && !hasSelector(event.target, options.dragHandle, nodeEl)) {
      return;
    }

    // Only primary button
    if (event.button !== 0) return;

    event.stopPropagation();

    containerBounds = state.containerBounds;
    const { clientX, clientY } = event;
    startMousePosition = { x: clientX, y: clientY };
    mousePosition = {
      x: clientX - (containerBounds?.left ?? 0),
      y: clientY - (containerBounds?.top ?? 0),
    };

    // Compute pointer in flow coordinates
    const flowX = (mousePosition.x - viewport.x) / viewport.zoom;
    const flowY = (mousePosition.y - viewport.y) / viewport.zoom;
    lastPos = { x: flowX, y: flowY };

    dragNodeId = nodeId;

    // Build drag items: the clicked node + any other selected nodes
    dragItems.clear();
    const clickedNode = nodeLookup.get(nodeId);
    if (!clickedNode) return;

    // Add clicked node
    const absPos = clickedNode.internals.positionAbsolute;
    dragItems.set(nodeId, {
      node: clickedNode,
      distance: { x: flowX - absPos.x, y: flowY - absPos.y },
      startPosition: { ...clickedNode.position },
    });

    // Add other selected & draggable nodes
    if (clickedNode.selected) {
      for (const [id, node] of nodeLookup) {
        if (id === nodeId) continue;
        if (!node.selected || node.draggable === false) continue;
        const nPos = node.internals.positionAbsolute;
        dragItems.set(id, {
          node,
          distance: { x: flowX - nPos.x, y: flowY - nPos.y },
          startPosition: { ...node.position },
        });
      }
    }

    // Use pointer capture for reliable tracking
    event.currentTarget.setPointerCapture(event.pointerId);

    // We defer actual drag start until threshold is met
    const doc = getHostForElement(event.target);
    // Attach move/up to the node element (via pointer capture) or document
    nodeEl.addEventListener('pointermove', onPointerMove);
    nodeEl.addEventListener('pointerup', onPointerUp);
    nodeEl.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(event) {
    const state = getState();
    const { viewport, options } = state;
    const threshold = options.nodeDragThreshold ?? DEFAULTS.nodeDragThreshold;

    const { clientX, clientY } = event;

    // Check threshold before starting drag
    if (!isDragging) {
      const dx = clientX - startMousePosition.x;
      const dy = clientY - startMousePosition.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return;

      isDragging = true;
      callbacks.onNodeDragStart?.(event, dragNodeId, Array.from(dragItems.values()).map((d) => d.node));

      // Start auto-pan loop
      startAutoPan(state);
    }

    containerBounds = state.containerBounds;
    mousePosition = {
      x: clientX - (containerBounds?.left ?? 0),
      y: clientY - (containerBounds?.top ?? 0),
    };

    const flowX = (mousePosition.x - viewport.x) / viewport.zoom;
    const flowY = (mousePosition.y - viewport.y) / viewport.zoom;

    // Apply snap for multi-node
    const snapGrid = options.snapToGrid ? (options.snapGrid ?? DEFAULTS.snapGrid) : null;
    let snapOffset = { x: 0, y: 0 };
    if (snapGrid) {
      const refItem = dragItems.values().next().value;
      const refPos = { x: flowX - refItem.distance.x, y: flowY - refItem.distance.y };
      const snapped = snapPosition(refPos, snapGrid);
      snapOffset = { x: snapped.x - refPos.x, y: snapped.y - refPos.y };
    }

    lastPos = { x: flowX, y: flowY };
    updateNodePositions(flowX, flowY, snapOffset, state);
  }

  function updateNodePositions(flowX, flowY, snapOffset, state) {
    const positionChanges = [];

    for (const [id, item] of dragItems) {
      let nextX = flowX - item.distance.x + snapOffset.x;
      let nextY = flowY - item.distance.y + snapOffset.y;

      // Apply extent clamping
      const node = item.node;
      if (node.extent === 'parent' && node.parentId) {
        const parent = state.nodeLookup.get(node.parentId);
        if (parent) {
          const parentDims = getNodeDimensions(parent);
          const nodeDims = getNodeDimensions(node);
          const parentAbsPos = parent.internals.positionAbsolute;
          nextX = Math.max(0, Math.min(nextX - parentAbsPos.x, parentDims.width - nodeDims.width)) + parentAbsPos.x;
          nextY = Math.max(0, Math.min(nextY - parentAbsPos.y, parentDims.height - nodeDims.height)) + parentAbsPos.y;
        }
      }

      // For child nodes, position is relative to parent
      let positionX = nextX;
      let positionY = nextY;
      if (node.parentId) {
        const parent = state.nodeLookup.get(node.parentId);
        if (parent) {
          positionX = nextX - parent.internals.positionAbsolute.x;
          positionY = nextY - parent.internals.positionAbsolute.y;
        }
      }

      positionChanges.push({
        id,
        position: { x: positionX, y: positionY },
        positionAbsolute: { x: nextX, y: nextY },
        dragging: true,
      });
    }

    if (positionChanges.length > 0) {
      callbacks.onPositionChange?.(positionChanges, false);
      callbacks.onNodeDrag?.(null, dragNodeId, positionChanges);
    }
  }

  function startAutoPan(state) {
    if (autoPanId) cancelAnimationFrame(autoPanId);

    function autoPanLoop() {
      if (!isDragging) return;

      const currentState = getState();
      const { viewport, options } = currentState;
      const speed = options.autoPanSpeed ?? DEFAULTS.autoPanSpeed;
      const edgeDist = options.autoPanEdgeDistance ?? DEFAULTS.autoPanEdgeDistance;

      if (!containerBounds) {
        autoPanId = requestAnimationFrame(autoPanLoop);
        return;
      }

      const [xMovement, yMovement] = calcAutoPan(mousePosition, containerBounds, speed, edgeDist);

      if (xMovement !== 0 || yMovement !== 0) {
        const newViewport = {
          x: viewport.x - xMovement,
          y: viewport.y - yMovement,
          zoom: viewport.zoom,
        };
        callbacks.onViewportChange?.(newViewport);

        // Adjust lastPos to account for the viewport shift
        lastPos.x += xMovement / viewport.zoom;
        lastPos.y += yMovement / viewport.zoom;

        const snapGrid = options.snapToGrid ? (options.snapGrid ?? DEFAULTS.snapGrid) : null;
        let snapOffset = { x: 0, y: 0 };
        if (snapGrid) {
          const refItem = dragItems.values().next().value;
          const refPos = { x: lastPos.x - refItem.distance.x, y: lastPos.y - refItem.distance.y };
          const snapped = snapPosition(refPos, snapGrid);
          snapOffset = { x: snapped.x - refPos.x, y: snapped.y - refPos.y };
        }

        updateNodePositions(lastPos.x, lastPos.y, snapOffset, currentState);
      }

      autoPanId = requestAnimationFrame(autoPanLoop);
    }

    autoPanId = requestAnimationFrame(autoPanLoop);
  }

  function onPointerUp(event) {
    const nodeEl = event.currentTarget;
    nodeEl.removeEventListener('pointermove', onPointerMove);
    nodeEl.removeEventListener('pointerup', onPointerUp);
    nodeEl.removeEventListener('pointercancel', onPointerUp);

    try {
      nodeEl.releasePointerCapture(event.pointerId);
    } catch (e) { /* may already be released */ }

    if (autoPanId) {
      cancelAnimationFrame(autoPanId);
      autoPanId = null;
    }

    if (isDragging) {
      // Final position update with dragging: false
      const finalChanges = [];
      for (const [id, item] of dragItems) {
        finalChanges.push({
          id,
          dragging: false,
        });
      }
      callbacks.onPositionChange?.(finalChanges, true);
      callbacks.onNodeDragStop?.(event, dragNodeId, Array.from(dragItems.values()).map((d) => d.node));
    }

    isDragging = false;
    dragNodeId = null;
    dragItems.clear();
    lastPos = null;
  }

  return {
    onPointerDown,
    destroy() {
      if (autoPanId) cancelAnimationFrame(autoPanId);
    },
  };
}

// ─── Default Node Renderers ──────────────────────────────────

/**
 * Built-in node type renderers.
 * Each returns an HTML string for the node's inner content.
 */
export const defaultNodeTypes = {
  default(node) {
    return `
      ${renderNodeBody(node)}
      ${renderHandles(node, ['target', 'source'])}
    `;
  },

  input(node) {
    return `
      ${renderNodeBody(node)}
      ${renderHandles(node, ['source'])}
    `;
  },

  output(node) {
    return `
      ${renderNodeBody(node)}
      ${renderHandles(node, ['target'])}
    `;
  },

  group(node) {
    return `
      <div class="alpine-flow__node-header alpine-flow__group-header">${node.data?.label ?? ''}</div>
    `;
  },
};

function renderNodeBody(node) {
  const label = node.data?.label ?? node.id;
  const icon = node.data?.icon;
  const mode = node.data?.iconMode || (icon ? 'icon-label' : 'label');

  const iconHtml = icon
    ? `<span class="alpine-flow__node-icon" aria-hidden="true"><i data-lucide="${icon}"></i></span>`
    : '';

  if (mode === 'icon' && icon) {
    return `
      <div class="alpine-flow__node-title alpine-flow__node-title-icon-only">
        ${iconHtml}
      </div>
    `;
  }

  if (mode === 'icon-label' && icon) {
    return `
      <div class="alpine-flow__node-title alpine-flow__node-title-icon-label">
        ${iconHtml}
        <div class="alpine-flow__node-header">${label}</div>
      </div>
    `;
  }

  return `<div class="alpine-flow__node-header">${label}</div>`;
}

function renderHandles(node, types) {
  let html = '';

  if (types.includes('target')) {
    const targetHandles = node.handles?.filter((h) => h.type === 'target') ?? [];
    if (targetHandles.length > 0) {
      for (const h of targetHandles) {
        html += `<div class="alpine-flow__handle alpine-flow__handle-${h.position ?? node.targetPosition ?? 'top'} alpine-flow__handle-target" data-handleid="${h.id ?? ''}" data-handletype="target" data-handleposition="${h.position ?? node.targetPosition ?? 'top'}"></div>`;
      }
    } else {
      const pos = node.targetPosition ?? Position.Top;
      html += `<div class="alpine-flow__handle alpine-flow__handle-${pos} alpine-flow__handle-target" data-handleid="" data-handletype="target" data-handleposition="${pos}"></div>`;
    }
  }

  if (types.includes('source')) {
    const sourceHandles = node.handles?.filter((h) => h.type === 'source') ?? [];
    if (sourceHandles.length > 0) {
      for (const h of sourceHandles) {
        html += `<div class="alpine-flow__handle alpine-flow__handle-${h.position ?? node.sourcePosition ?? 'bottom'} alpine-flow__handle-source" data-handleid="${h.id ?? ''}" data-handletype="source" data-handleposition="${h.position ?? node.sourcePosition ?? 'bottom'}"></div>`;
      }
    } else {
      const pos = node.sourcePosition ?? Position.Bottom;
      html += `<div class="alpine-flow__handle alpine-flow__handle-${pos} alpine-flow__handle-source" data-handleid="" data-handletype="source" data-handleposition="${pos}"></div>`;
    }
  }

  return html;
}
