/**
 * Alpine Flow - Edge Path Calculations
 * Provides getBezierPath, getSmoothStepPath, getStraightPath.
 * All return [path, labelX, labelY, offsetX, offsetY].
 */

import { Position } from './constants.js';

// ─── Straight Edge ───────────────────────────────────────────

/**
 * Calculate a straight edge path.
 * @param {{ sourceX, sourceY, targetX, targetY }} params
 * @returns {[string, number, number, number, number]}
 */
export function getStraightPath({ sourceX, sourceY, targetX, targetY }) {
  const [labelX, labelY, offsetX, offsetY] = getEdgeCenter({
    sourceX, sourceY, targetX, targetY,
  });
  return [
    `M ${sourceX},${sourceY}L ${targetX},${targetY}`,
    labelX, labelY, offsetX, offsetY,
  ];
}

// ─── Bezier Edge ─────────────────────────────────────────────

/**
 * Calculate a cubic bezier edge path.
 * @param {{ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature? }} params
 * @returns {[string, number, number, number, number]}
 */
export function getBezierPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
  curvature = 0.25,
}) {
  const [sourceControlX, sourceControlY] = getBezierControlPoint(
    sourceX, sourceY, sourcePosition, curvature, targetX, targetY
  );
  const [targetControlX, targetControlY] = getBezierControlPoint(
    targetX, targetY, targetPosition, curvature, sourceX, sourceY
  );

  const [labelX, labelY, offsetX, offsetY] = getBezierEdgeCenter({
    sourceX, sourceY, targetX, targetY,
    sourceControlX, sourceControlY,
    targetControlX, targetControlY,
  });

  return [
    `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
    labelX, labelY, offsetX, offsetY,
  ];
}

function getBezierControlPoint(x, y, position, curvature, otherX, otherY) {
  let ctX = x;
  let ctY = y;

  if (position === Position.Left || position === Position.Right) {
    const dist = Math.abs(otherX - x);
    const offset = dist >= 0 ? dist * curvature : 25 * curvature;
    ctX = position === Position.Left ? x - offset : x + offset;
  } else {
    const dist = Math.abs(otherY - y);
    const offset = dist >= 0 ? dist * curvature : 25 * curvature;
    ctY = position === Position.Top ? y - offset : y + offset;
  }

  return [ctX, ctY];
}

function getBezierEdgeCenter({ sourceX, sourceY, targetX, targetY, sourceControlX, sourceControlY, targetControlX, targetControlY }) {
  // Cubic bezier at t = 0.5
  const centerX = sourceX * 0.125 + sourceControlX * 0.375 + targetControlX * 0.375 + targetX * 0.125;
  const centerY = sourceY * 0.125 + sourceControlY * 0.375 + targetControlY * 0.375 + targetY * 0.125;
  const offsetX = Math.abs(centerX - sourceX);
  const offsetY = Math.abs(centerY - sourceY);
  return [centerX, centerY, offsetX, offsetY];
}

// ─── Smooth Step Edge ────────────────────────────────────────

/**
 * Calculate a smooth step (orthogonal with rounded corners) edge path.
 * @param {{ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius?, offset? }} params
 * @returns {[string, number, number, number, number]}
 */
export function getSmoothStepPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
  borderRadius = 5,
  offset = 20,
}) {
  const points = getEdgePoints({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    offset,
  });

  const path = pointsToPath(points, borderRadius);

  const [labelX, labelY, offsetX, offsetY] = getEdgeCenter({
    sourceX, sourceY, targetX, targetY,
  });

  return [path, labelX, labelY, offsetX, offsetY];
}

/**
 * Calculate a step edge (orthogonal, no rounded corners).
 */
export function getStepPath(params) {
  return getSmoothStepPath({ ...params, borderRadius: 0 });
}

function getEdgePoints({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, offset }) {
  const sourceDir = getDirection(sourcePosition);
  const targetDir = getDirection(targetPosition);

  const sourceGapX = sourceX + sourceDir.x * offset;
  const sourceGapY = sourceY + sourceDir.y * offset;
  const targetGapX = targetX + targetDir.x * offset;
  const targetGapY = targetY + targetDir.y * offset;

  const isHorizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const isHorizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right;

  const points = [{ x: sourceX, y: sourceY }];

  if (isHorizontalSource && isHorizontalTarget) {
    // Both horizontal — use S-shape or Z-shape
    const midX = (sourceGapX + targetGapX) / 2;
    points.push({ x: sourceGapX, y: sourceY });
    points.push({ x: midX, y: sourceY });
    points.push({ x: midX, y: targetY });
    points.push({ x: targetGapX, y: targetY });
  } else if (!isHorizontalSource && !isHorizontalTarget) {
    // Both vertical
    const midY = (sourceGapY + targetGapY) / 2;
    points.push({ x: sourceX, y: sourceGapY });
    points.push({ x: sourceX, y: midY });
    points.push({ x: targetX, y: midY });
    points.push({ x: targetX, y: targetGapY });
  } else if (isHorizontalSource && !isHorizontalTarget) {
    // Source horizontal, target vertical
    points.push({ x: sourceGapX, y: sourceY });
    points.push({ x: sourceGapX, y: targetGapY });
    points.push({ x: targetX, y: targetGapY });
  } else {
    // Source vertical, target horizontal
    points.push({ x: sourceX, y: sourceGapY });
    points.push({ x: targetGapX, y: sourceGapY });
    points.push({ x: targetGapX, y: targetY });
  }

  points.push({ x: targetX, y: targetY });
  return points;
}

function getDirection(position) {
  switch (position) {
    case Position.Top: return { x: 0, y: -1 };
    case Position.Bottom: return { x: 0, y: 1 };
    case Position.Left: return { x: -1, y: 0 };
    case Position.Right: return { x: 1, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

function pointsToPath(points, borderRadius) {
  if (points.length < 2) return '';

  const parts = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const toPrev = distance(prev, curr);
    const toNext = distance(curr, next);
    const bend = Math.min(borderRadius, toPrev / 2, toNext / 2);

    if (bend > 0) {
      // Direction from curr to prev and curr to next
      const dxPrev = (prev.x - curr.x) / (toPrev || 1);
      const dyPrev = (prev.y - curr.y) / (toPrev || 1);
      const dxNext = (next.x - curr.x) / (toNext || 1);
      const dyNext = (next.y - curr.y) / (toNext || 1);

      // Start and end points of the rounded corner
      const startX = curr.x + dxPrev * bend;
      const startY = curr.y + dyPrev * bend;
      const endX = curr.x + dxNext * bend;
      const endY = curr.y + dyNext * bend;

      parts.push(`L ${startX} ${startY}`);
      parts.push(`Q ${curr.x} ${curr.y} ${endX} ${endY}`);
    } else {
      parts.push(`L ${curr.x} ${curr.y}`);
    }
  }

  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);

  return parts.join(' ');
}

function distance(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// ─── Shared Utilities ────────────────────────────────────────

function getEdgeCenter({ sourceX, sourceY, targetX, targetY }) {
  const xOffset = Math.abs(targetX - sourceX) / 2;
  const yOffset = Math.abs(targetY - sourceY) / 2;
  const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset;
  const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset;
  return [centerX, centerY, xOffset, yOffset];
}

/**
 * Get the path function for a given edge type string.
 */
export function getPathForEdgeType(type) {
  switch (type) {
    case 'straight': return getStraightPath;
    case 'smoothstep': return getSmoothStepPath;
    case 'step': return getStepPath;
    case 'bezier':
    case 'default':
    default:
      return getBezierPath;
  }
}
