/**
 * Alpine Flow - Controls Component
 * Zoom in, zoom out, fit view, and lock buttons.
 */

import { createElement } from './dom.js';
import { DEFAULTS } from './constants.js';

/**
 * Create a controls panel.
 * @param {HTMLElement} container
 * @param {Function} getState
 * @param {object} actions - { zoomIn, zoomOut, fitView, toggleInteractivity }
 * @returns {{ update: Function, destroy: Function }}
 */
export function createControls(container, getState, actions) {
  const panel = createElement('div', {
    className: 'alpine-flow__controls alpine-flow__panel bottom-left',
  }, container);

  const btnZoomIn = createButton(panel, 'zoom-in', zoomInIcon(), () => actions.zoomIn());
  const btnZoomOut = createButton(panel, 'zoom-out', zoomOutIcon(), () => actions.zoomOut());
  const btnFitView = createButton(panel, 'fit-view', fitViewIcon(), () => actions.fitView());
  const btnLock = createButton(panel, 'lock', unlockIcon(), () => {
    actions.toggleInteractivity();
    update();
  });

  function update() {
    const state = getState();
    const { viewport, options } = state;
    const minZoom = options.minZoom ?? DEFAULTS.minZoom;
    const maxZoom = options.maxZoom ?? DEFAULTS.maxZoom;

    btnZoomIn.disabled = viewport.zoom >= maxZoom;
    btnZoomOut.disabled = viewport.zoom <= minZoom;

    const isInteractive = options.nodesDraggable !== false ||
                          options.nodesConnectable !== false ||
                          options.elementsSelectable !== false;
    btnLock.innerHTML = isInteractive ? unlockIcon() : lockIcon();
    btnLock.title = isInteractive ? 'Lock interactivity' : 'Unlock interactivity';
  }

  update();

  return { update, destroy: () => panel.remove() };
}

function createButton(parent, name, iconHtml, onClick) {
  const btn = createElement('button', {
    className: `alpine-flow__controls-button alpine-flow__controls-${name}`,
    type: 'button',
  }, parent);
  btn.innerHTML = iconHtml;
  btn.addEventListener('click', onClick);
  return btn;
}

function zoomInIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}

function zoomOutIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}

function fitViewIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
}

function lockIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
}

function unlockIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>`;
}
