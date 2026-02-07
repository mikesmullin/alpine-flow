/**
 * Alpine Flow - DOM Utilities
 */

/**
 * Get the owner document or shadow root for an element.
 */
export function getHostForElement(element) {
  const doc = element?.getRootNode?.();
  if (doc instanceof ShadowRoot) return doc;
  return document;
}

/**
 * Extract event position (handles mouse and touch events).
 */
export function getEventPosition(event, bounds) {
  const isMouse = 'clientX' in event;
  const evtX = isMouse ? event.clientX : (event.touches?.[0]?.clientX ?? 0);
  const evtY = isMouse ? event.clientY : (event.touches?.[0]?.clientY ?? 0);
  return {
    x: evtX - (bounds?.left ?? 0),
    y: evtY - (bounds?.top ?? 0),
  };
}

/**
 * Check if an element (or any ancestor up to root) matches a CSS selector.
 */
export function hasSelector(target, selector, root) {
  let current = target;
  while (current && current !== root) {
    if (current.matches?.(selector)) return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * Detect macOS platform.
 */
export function isMacOs() {
  return typeof navigator !== 'undefined' && navigator.userAgent.indexOf('Mac') !== -1;
}

/**
 * Create elements with attributes in one call.
 */
export function createElement(tag, attrs = {}, parent = null) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('data')) {
      el.setAttribute(key.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  if (parent) parent.appendChild(el);
  return el;
}

/**
 * Create SVG elements with attributes.
 */
export function createSvgElement(tag, attrs = {}, parent = null) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  if (parent) parent.appendChild(el);
  return el;
}

/**
 * Generate a unique ID.
 */
let idCounter = 0;
export function uniqueId(prefix = 'af') {
  return `${prefix}-${++idCounter}-${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * Read the CSS transform scale from a DOM element (for node measurement at zoom).
 */
export function getZoomFromElement(element) {
  try {
    const style = window.getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(style.transform);
    return matrix.m22;
  } catch {
    return 1;
  }
}
