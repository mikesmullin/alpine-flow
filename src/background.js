/**
 * Alpine Flow - Background Component
 * SVG-based grid background (dots, lines, cross patterns).
 * Follows xyflow's approach: SVG <pattern> that tracks viewport transform.
 */

import { BackgroundVariant } from './constants.js';
import { createSvgElement, uniqueId } from './dom.js';

/**
 * Create a background element.
 * @param {HTMLElement} container - Parent container
 * @param {Function} getState - Returns { viewport, options }
 * @returns {{ update: Function, destroy: Function }}
 */
export function createBackground(container, getState) {
  const patternId = uniqueId('bg-pattern');
  const svg = createSvgElement('svg', {
    class: 'alpine-flow__background',
    style: {
      position: 'absolute',
      width: '100%',
      height: '100%',
      top: '0',
      left: '0',
      zIndex: '-1',
      pointerEvents: 'none',
    },
  }, container);

  const defs = createSvgElement('defs', {}, svg);
  const pattern = createSvgElement('pattern', {
    id: patternId,
    patternUnits: 'userSpaceOnUse',
  }, defs);

  const patternElement = createSvgElement('circle', {}, pattern); // Will be replaced based on variant
  const rect = createSvgElement('rect', {
    x: '0',
    y: '0',
    width: '100%',
    height: '100%',
    fill: `url(#${patternId})`,
  }, svg);

  // Keep a second element for cross pattern (needs two lines)
  let patternElement2 = null;

  function update() {
    const state = getState();
    const { viewport } = state;
    const bgOptions = state.options?.background ?? {};

    const variant = bgOptions.variant ?? BackgroundVariant.Dots;
    const gap = bgOptions.gap ?? 20;
    const size = bgOptions.size ?? (variant === BackgroundVariant.Dots ? 1 : undefined);
    const color = bgOptions.color ?? null;
    const offset = bgOptions.offset ?? [0, 0];
    const lineWidth = bgOptions.lineWidth ?? 1;

    const gapX = Array.isArray(gap) ? gap[0] : gap;
    const gapY = Array.isArray(gap) ? gap[1] : gap;
    const scaledGapX = gapX * viewport.zoom;
    const scaledGapY = gapY * viewport.zoom;
    const offsetX = Array.isArray(offset) ? offset[0] : offset;
    const offsetY = Array.isArray(offset) ? offset[1] : offset;

    pattern.setAttribute('x', String((viewport.x % scaledGapX) - offsetX * viewport.zoom));
    pattern.setAttribute('y', String((viewport.y % scaledGapY) - offsetY * viewport.zoom));
    pattern.setAttribute('width', String(scaledGapX));
    pattern.setAttribute('height', String(scaledGapY));

    // Remove old pattern elements and rebuild
    while (pattern.firstChild) pattern.removeChild(pattern.firstChild);
    patternElement2 = null;

    const resolvedColor = color || getCSSVar('--alpine-flow-bg-pattern-color', variant === BackgroundVariant.Dots ? '#91919a' : '#eee');

    if (variant === BackgroundVariant.Dots) {
      const dotSize = (size ?? 1) * viewport.zoom;
      const dot = createSvgElement('circle', {
        cx: String(dotSize),
        cy: String(dotSize),
        r: String(dotSize),
        fill: resolvedColor,
      }, pattern);
    } else if (variant === BackgroundVariant.Lines) {
      const scaledLineWidth = lineWidth * viewport.zoom;
      createSvgElement('path', {
        d: `M ${scaledGapX / 2} 0 V ${scaledGapY} M 0 ${scaledGapY / 2} H ${scaledGapX}`,
        stroke: resolvedColor,
        'stroke-width': String(scaledLineWidth),
        fill: 'none',
      }, pattern);
    } else if (variant === BackgroundVariant.Cross) {
      const crossSize = (size ?? 6) * viewport.zoom;
      const scaledLineWidth = lineWidth * viewport.zoom;
      createSvgElement('path', {
        d: `M ${scaledGapX / 2 - crossSize / 2} ${scaledGapY / 2} H ${scaledGapX / 2 + crossSize / 2} M ${scaledGapX / 2} ${scaledGapY / 2 - crossSize / 2} V ${scaledGapY / 2 + crossSize / 2}`,
        stroke: resolvedColor,
        'stroke-width': String(scaledLineWidth),
        fill: 'none',
      }, pattern);
    }
  }

  update();

  return { update, destroy: () => svg.remove() };
}

function getCSSVar(name, fallback) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)?.trim();
  return value || fallback;
}
