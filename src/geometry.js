/**
 * Alpine Flow - Geometry and Math Utilities
 */

/**
 * Clamp a value between min and max.
 */
export function clamp(val, min = 0, max = 1) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Convert a Rect {x,y,width,height} to a Box {x,y,x2,y2}.
 */
export function rectToBox(rect) {
  return {
    x: rect.x,
    y: rect.y,
    x2: rect.x + rect.width,
    y2: rect.y + rect.height,
  };
}

/**
 * Convert a Box {x,y,x2,y2} to a Rect {x,y,width,height}.
 */
export function boxToRect(box) {
  return {
    x: box.x,
    y: box.y,
    width: box.x2 - box.x,
    height: box.y2 - box.y,
  };
}

/**
 * Get the bounding rect of two rects combined.
 */
export function getBoundsOfRects(rect1, rect2) {
  return boxToRect({
    x: Math.min(rect1.x, rect2.x),
    y: Math.min(rect1.y, rect2.y),
    x2: Math.max(rect1.x + rect1.width, rect2.x + rect2.width),
    y2: Math.max(rect1.y + rect1.height, rect2.y + rect2.height),
  });
}

/**
 * Get the overlapping area of two rects. Returns 0 if no overlap.
 */
export function getOverlappingArea(rectA, rectB) {
  const xOverlap = Math.max(0, Math.min(rectA.x + rectA.width, rectB.x + rectB.width) - Math.max(rectA.x, rectB.x));
  const yOverlap = Math.max(0, Math.min(rectA.y + rectA.height, rectB.y + rectB.height) - Math.max(rectA.y, rectB.y));
  return xOverlap * yOverlap;
}

/**
 * Convert a node to a Rect using its absolute position and dimensions.
 */
export function nodeToRect(node) {
  const pos = node.internals?.positionAbsolute ?? node.position;
  const dims = getNodeDimensions(node);
  return {
    x: pos.x,
    y: pos.y,
    width: dims.width,
    height: dims.height,
  };
}

/**
 * Get the bounding rect of an array of nodes.
 */
export function getNodesBounds(nodes) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let box = { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity };
  for (const node of nodes) {
    const rect = nodeToRect(node);
    box.x = Math.min(box.x, rect.x);
    box.y = Math.min(box.y, rect.y);
    box.x2 = Math.max(box.x2, rect.x + rect.width);
    box.y2 = Math.max(box.y2, rect.y + rect.height);
  }
  return boxToRect(box);
}

/**
 * Check if a rect is visible within a viewport rect.
 */
export function isRectVisible(rect, viewportRect) {
  return getOverlappingArea(rect, viewportRect) > 0;
}

/**
 * Get the visible rect from a viewport transform and container dimensions.
 */
export function getViewportRect(viewport, containerWidth, containerHeight) {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: containerWidth / viewport.zoom,
    height: containerHeight / viewport.zoom,
  };
}

/**
 * Snap a position to a grid.
 */
export function snapPosition(position, snapGrid = [1, 1]) {
  return {
    x: snapGrid[0] * Math.round(position.x / snapGrid[0]),
    y: snapGrid[1] * Math.round(position.y / snapGrid[1]),
  };
}

/**
 * Get the node dimensions, falling back through measured → explicit → initial → 0.
 */
export function getNodeDimensions(node) {
  return {
    width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0,
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? 0,
  };
}

/**
 * Calculate the auto-pan velocity when the pointer is near a container edge.
 * Returns [xMovement, yMovement].
 */
export function calcAutoPan(position, containerBounds, speed = 15, distance = 40) {
  const xMovement = calcAutoPanVelocity(position.x, distance, containerBounds.width - distance) * speed;
  const yMovement = calcAutoPanVelocity(position.y, distance, containerBounds.height - distance) * speed;
  return [xMovement, yMovement];
}

function calcAutoPanVelocity(value, min, max) {
  if (value < min) {
    return clamp(Math.abs(value - min), 1, min) / min;
  }
  if (value > max) {
    return -clamp(Math.abs(value - max), 1, min) / min;
  }
  return 0;
}

/**
 * Check if two rects intersect.
 */
export function rectsIntersect(rect1, rect2) {
  return !(
    rect2.x > rect1.x + rect1.width ||
    rect2.x + rect2.width < rect1.x ||
    rect2.y > rect1.y + rect1.height ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * Check if an edge's bounding box is visible in the viewport.
 */
export function isEdgeVisible({ sourceX, sourceY, targetX, targetY }, viewportRect) {
  const edgeRect = {
    x: Math.min(sourceX, targetX),
    y: Math.min(sourceY, targetY),
    width: Math.abs(targetX - sourceX),
    height: Math.abs(targetY - sourceY),
  };
  return isRectVisible(edgeRect, viewportRect);
}

/**
 * Clamp a node position within an extent.
 */
export function clampPosition(position, extent, dimensions = { width: 0, height: 0 }) {
  return {
    x: clamp(position.x, extent[0][0], extent[1][0] - dimensions.width),
    y: clamp(position.y, extent[0][1], extent[1][1] - dimensions.height),
  };
}
