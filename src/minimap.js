/**
 * Alpine Flow - Minimap Component
 * SVG-based overview of the entire graph with viewport indicator.
 */

import { createElement, createSvgElement, uniqueId } from './dom.js';
import { getNodesBounds, getNodeDimensions, getViewportRect } from './geometry.js';

/**
 * Create a minimap panel.
 * @param {HTMLElement} container
 * @param {Function} getState - Returns { nodes, viewport, containerWidth, containerHeight }
 * @param {object} actions - { setViewport }
 * @returns {{ update: Function, destroy: Function }}
 */
export function createMinimap(container, getState, actions) {
  const minimapId = uniqueId('minimap');

  const panel = createElement('div', {
    className: 'alpine-flow__minimap alpine-flow__panel bottom-right',
  }, container);

  const svg = createSvgElement('svg', {
    class: 'alpine-flow__minimap-svg',
    style: {
      width: '200px',
      height: '150px',
      overflow: 'hidden',
      cursor: 'pointer',
    },
  }, panel);

  const maskId = uniqueId('minimap-mask');
  const defs = createSvgElement('defs', {}, svg);
  const mask = createSvgElement('mask', { id: maskId }, defs);
  const maskRect = createSvgElement('rect', { fill: 'white' }, mask);
  const maskViewport = createSvgElement('rect', { fill: 'black' }, mask);

  const nodesGroup = createSvgElement('g', { class: 'alpine-flow__minimap-nodes' }, svg);
  const viewportMask = createSvgElement('rect', {
    class: 'alpine-flow__minimap-mask',
    fill: 'rgba(0,0,0,0.3)',
    mask: `url(#${maskId})`,
  }, svg);

  // Click to pan
  svg.addEventListener('pointerdown', onPointerDown);

  let isPanning = false;

  function onPointerDown(event) {
    event.preventDefault();
    isPanning = true;
    svg.setPointerCapture(event.pointerId);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    handlePanToPoint(event);
  }

  function onPointerMove(event) {
    if (!isPanning) return;
    handlePanToPoint(event);
  }

  function onPointerUp(event) {
    isPanning = false;
    svg.releasePointerCapture(event.pointerId);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', onPointerUp);
  }

  function handlePanToPoint(event) {
    const state = getState();
    const { viewport } = state;
    const svgRect = svg.getBoundingClientRect();
    const svgViewBox = currentViewBox;

    if (!svgViewBox) return;

    // Convert click position to flow coordinates
    const ratioX = (event.clientX - svgRect.left) / svgRect.width;
    const ratioY = (event.clientY - svgRect.top) / svgRect.height;

    const flowX = svgViewBox.x + ratioX * svgViewBox.width;
    const flowY = svgViewBox.y + ratioY * svgViewBox.height;

    // Center viewport on this point
    const containerW = state.containerWidth ?? 800;
    const containerH = state.containerHeight ?? 600;

    actions.setViewport({
      x: -flowX * viewport.zoom + containerW / 2,
      y: -flowY * viewport.zoom + containerH / 2,
      zoom: viewport.zoom,
    });
  }

  let currentViewBox = null;
  let nodeElements = new Map();

  function update() {
    const state = getState();
    const { viewport, nodeLookup } = state;
    const nodes = nodeLookup ? Array.from(nodeLookup.values()) : [];
    const containerW = state.containerWidth ?? 800;
    const containerH = state.containerHeight ?? 600;

    if (nodes.length === 0) {
      svg.setAttribute('viewBox', '0 0 100 100');
      currentViewBox = { x: 0, y: 0, width: 100, height: 100 };
      return;
    }

    // Compute bounds of all nodes
    const nodesBounds = getNodesBounds(nodes);
    const viewportBounds = getViewportRect(viewport, containerW, containerH);

    // Combine nodes bounds with viewport bounds for full view
    const combinedX = Math.min(nodesBounds.x, viewportBounds.x);
    const combinedY = Math.min(nodesBounds.y, viewportBounds.y);
    const combinedX2 = Math.max(nodesBounds.x + nodesBounds.width, viewportBounds.x + viewportBounds.width);
    const combinedY2 = Math.max(nodesBounds.y + nodesBounds.height, viewportBounds.y + viewportBounds.height);

    const padding = 50;
    const vbX = combinedX - padding;
    const vbY = combinedY - padding;
    const vbW = combinedX2 - combinedX + padding * 2;
    const vbH = combinedY2 - combinedY + padding * 2;

    currentViewBox = { x: vbX, y: vbY, width: vbW, height: vbH };
    svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

    // Update mask rect (full area)
    maskRect.setAttribute('x', String(vbX));
    maskRect.setAttribute('y', String(vbY));
    maskRect.setAttribute('width', String(vbW));
    maskRect.setAttribute('height', String(vbH));

    // Update viewport indicator mask hole
    maskViewport.setAttribute('x', String(viewportBounds.x));
    maskViewport.setAttribute('y', String(viewportBounds.y));
    maskViewport.setAttribute('width', String(viewportBounds.width));
    maskViewport.setAttribute('height', String(viewportBounds.height));

    // Update viewport mask overlay
    viewportMask.setAttribute('x', String(vbX));
    viewportMask.setAttribute('y', String(vbY));
    viewportMask.setAttribute('width', String(vbW));
    viewportMask.setAttribute('height', String(vbH));

    // Update node rects
    const currentIds = new Set();
    for (const node of nodes) {
      if (node.hidden) continue;
      currentIds.add(node.id);

      const pos = node.internals?.positionAbsolute ?? node.position;
      const dims = getNodeDimensions(node);

      let nodeRect = nodeElements.get(node.id);
      if (!nodeRect) {
        nodeRect = createSvgElement('rect', {
          class: 'alpine-flow__minimap-node',
          rx: '2',
          ry: '2',
        }, nodesGroup);
        nodeElements.set(node.id, nodeRect);
      }

      nodeRect.setAttribute('x', String(pos.x));
      nodeRect.setAttribute('y', String(pos.y));
      nodeRect.setAttribute('width', String(dims.width || 50));
      nodeRect.setAttribute('height', String(dims.height || 30));
      nodeRect.setAttribute('fill', node.selected ? 'var(--alpine-flow-minimap-node-selected, #4f8ff7)' : 'var(--alpine-flow-minimap-node, #e2e2e2)');
    }

    // Remove stale node rects
    for (const [id, el] of nodeElements) {
      if (!currentIds.has(id)) {
        el.remove();
        nodeElements.delete(id);
      }
    }
  }

  update();

  return { update, destroy: () => panel.remove() };
}
