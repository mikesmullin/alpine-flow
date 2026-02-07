/**
 * Alpine Flow - Viewport Transform Management
 * Handles pan, zoom, coordinate conversion, and animated transitions.
 * No d3 dependency — uses raw Pointer Events and Wheel Events.
 */

import { clamp, getViewportRect, snapPosition } from './geometry.js';
import { getEventPosition, isMacOs } from './dom.js';
import { DEFAULTS } from './constants.js';

// ─── Coordinate Conversion ───────────────────────────────────

/**
 * Convert screen-space position to flow/world coordinates.
 * @param {{ x: number, y: number }} screenPos
 * @param {{ x: number, y: number, zoom: number }} viewport
 * @param {DOMRect} [containerBounds]
 * @returns {{ x: number, y: number }}
 */
export function screenToFlowPosition(screenPos, viewport, containerBounds) {
  const x = (screenPos.x - (containerBounds?.left ?? 0) - viewport.x) / viewport.zoom;
  const y = (screenPos.y - (containerBounds?.top ?? 0) - viewport.y) / viewport.zoom;
  return { x, y };
}

/**
 * Convert flow/world coordinates to screen-space position.
 */
export function flowToScreenPosition(flowPos, viewport) {
  return {
    x: flowPos.x * viewport.zoom + viewport.x,
    y: flowPos.y * viewport.zoom + viewport.y,
  };
}

/**
 * Get the pointer position in flow coordinates, with optional grid snapping.
 */
export function getPointerPosition(event, viewport, snapGrid, snapToGrid, containerBounds) {
  const { x: clientX, y: clientY } = getEventPosition(event);
  const containerX = clientX - (containerBounds?.left ?? 0);
  const containerY = clientY - (containerBounds?.top ?? 0);
  const x = (containerX - viewport.x) / viewport.zoom;
  const y = (containerY - viewport.y) / viewport.zoom;
  if (snapToGrid) {
    const snapped = snapPosition({ x, y }, snapGrid);
    return { x, y, xSnapped: snapped.x, ySnapped: snapped.y };
  }
  return { x, y, xSnapped: x, ySnapped: y };
}

// ─── Zoom Math ───────────────────────────────────────────────

/**
 * Zoom at a specific point, keeping that point stable in screen space.
 */
export function zoomAtPoint(viewport, point, nextZoom) {
  const ratio = nextZoom / viewport.zoom;
  return {
    x: point.x - (point.x - viewport.x) * ratio,
    y: point.y - (point.y - viewport.y) * ratio,
    zoom: nextZoom,
  };
}

/**
 * Compute viewport to fit given bounds within a container.
 */
export function getTransformForBounds(bounds, containerWidth, containerHeight, minZoom, maxZoom, padding = 0.1) {
  const xZoom = containerWidth / (bounds.width * (1 + padding * 2));
  const yZoom = containerHeight / (bounds.height * (1 + padding * 2));
  const zoom = clamp(Math.min(xZoom, yZoom), minZoom, maxZoom);

  const x = containerWidth / 2 - (bounds.x + bounds.width / 2) * zoom;
  const y = containerHeight / 2 - (bounds.y + bounds.height / 2) * zoom;

  return { x, y, zoom };
}

/**
 * Normalize mouse wheel delta across browsers and input devices.
 * Follows xyflow's approach from d3-zoom integration.
 */
export function wheelDelta(event) {
  const factor = event.ctrlKey && isMacOs() ? 10 : 1;
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * factor;
}

// ─── Pan/Zoom Event Handler ──────────────────────────────────

/**
 * Create a pan/zoom handler that attaches to a container element.
 * Uses raw Pointer Events (pan) and Wheel Events (zoom).
 *
 * @param {HTMLElement} container - The zoom pane element
 * @param {object} stateGetter - Function returning current state
 * @param {object} callbacks - { onViewportChange, onPanZoomStart, onPanZoom, onPanZoomEnd }
 * @returns {{ update: Function, destroy: Function }}
 */
export function createPanZoomHandler(container, stateGetter, callbacks) {
  let isPanning = false;
  let panStartPoint = null;
  let panStartViewport = null;
  let currentPointerId = null;
  let animationFrameId = null;

  function getState() {
    return stateGetter();
  }

  function onWheel(event) {
    const state = getState();
    const { viewport, options } = state;
    const {
      zoomOnScroll = true,
      zoomOnPinch = true,
      panOnScroll = false,
      panOnScrollMode = 'free',
      panOnScrollSpeed = DEFAULTS.panOnScrollSpeed,
      minZoom = DEFAULTS.minZoom,
      maxZoom = DEFAULTS.maxZoom,
      preventScrolling = true,
    } = options;

    // Check for .nowheel class
    if (event.target.closest?.('.nowheel')) return;

    if (preventScrolling) {
      event.preventDefault();
    }

    // Pinch zoom (Ctrl+wheel on trackpads)
    if (event.ctrlKey && zoomOnPinch) {
      const rect = container.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const delta = wheelDelta(event);
      const nextZoom = clamp(viewport.zoom * Math.pow(2, delta), minZoom, maxZoom);
      if (nextZoom !== viewport.zoom) {
        const next = zoomAtPoint(viewport, point, nextZoom);
        callbacks.onViewportChange?.(next);
      }
      return;
    }

    // Pan on scroll mode
    if (panOnScroll) {
      const deltaNormalize = event.deltaMode === 1 ? 20 : 1;
      let deltaX = panOnScrollMode === 'vertical' ? 0 : event.deltaX * deltaNormalize;
      let deltaY = panOnScrollMode === 'horizontal' ? 0 : event.deltaY * deltaNormalize;

      // Shift+scroll for horizontal on Windows
      if (!isMacOs() && event.shiftKey && panOnScrollMode !== 'vertical') {
        deltaX = event.deltaY * deltaNormalize;
        deltaY = 0;
      }

      const next = {
        x: viewport.x - (deltaX / viewport.zoom) * panOnScrollSpeed,
        y: viewport.y - (deltaY / viewport.zoom) * panOnScrollSpeed,
        zoom: viewport.zoom,
      };
      callbacks.onViewportChange?.(next);
      return;
    }

    // Zoom on scroll
    if (zoomOnScroll) {
      const rect = container.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const delta = wheelDelta(event);
      const nextZoom = clamp(viewport.zoom * Math.pow(2, delta), minZoom, maxZoom);
      if (nextZoom !== viewport.zoom) {
        const next = zoomAtPoint(viewport, point, nextZoom);
        callbacks.onViewportChange?.(next);
      }
    }
  }

  function onPointerDown(event) {
    const state = getState();
    const { viewport, options } = state;
    const { panOnDrag = true } = options;

    // Check for .nopan class
    if (event.target.closest?.('.nopan')) return;

    // Determine which buttons allow panning
    const allowedButtons = Array.isArray(panOnDrag) ? panOnDrag : (panOnDrag ? [0, 1] : [1]);
    if (!allowedButtons.includes(event.button)) return;

    // Don't start panning if we're on a node (unless middle mouse)
    if (event.button === 0 && event.target.closest?.('.alpine-flow__node')) return;

    isPanning = true;
    currentPointerId = event.pointerId;
    panStartPoint = { x: event.clientX, y: event.clientY };
    panStartViewport = { ...viewport };

    container.setPointerCapture(event.pointerId);
    container.style.cursor = 'grabbing';

    callbacks.onPanZoomStart?.(event, viewport);
  }

  function onPointerMove(event) {
    if (!isPanning || event.pointerId !== currentPointerId) return;

    const dx = event.clientX - panStartPoint.x;
    const dy = event.clientY - panStartPoint.y;

    const next = {
      x: panStartViewport.x + dx,
      y: panStartViewport.y + dy,
      zoom: panStartViewport.zoom,
    };

    callbacks.onViewportChange?.(next);
    callbacks.onPanZoom?.(event, next);
  }

  function onPointerUp(event) {
    if (!isPanning || event.pointerId !== currentPointerId) return;

    isPanning = false;
    currentPointerId = null;
    container.releasePointerCapture(event.pointerId);
    container.style.cursor = '';

    const state = getState();
    callbacks.onPanZoomEnd?.(event, state.viewport);
  }

  function onDoubleClick(event) {
    const state = getState();
    const { options, viewport } = state;
    if (!options.zoomOnDoubleClick) return;
    if (event.target.closest?.('.alpine-flow__node, .alpine-flow__edge')) return;

    const rect = container.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const nextZoom = clamp(viewport.zoom * 1.5, options.minZoom ?? DEFAULTS.minZoom, options.maxZoom ?? DEFAULTS.maxZoom);
    const next = zoomAtPoint(viewport, point, nextZoom);
    callbacks.onViewportChange?.(next, { duration: 300 });
  }

  // Attach listeners
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('dblclick', onDoubleClick);

  return {
    update(newOptions) {
      // Options updated via stateGetter, no action needed here
    },
    destroy() {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('dblclick', onDoubleClick);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    },
  };
}
