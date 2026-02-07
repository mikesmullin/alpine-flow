/**
 * Alpine Flow - Handle Utilities and Connection System
 */

import { Position, DEFAULTS } from './constants.js';
import { getEventPosition, getHostForElement } from './dom.js';
import { getNodeDimensions } from './geometry.js';

// ─── Handle Position ─────────────────────────────────────────

/**
 * Get the absolute position of a handle's connection point.
 * @param {object} node - The node (must have internals.positionAbsolute)
 * @param {object|null} handle - The handle object { x, y, width, height, position }
 * @param {string} fallbackPosition - Position enum value if handle is null
 * @param {boolean} center - If true, returns the center of the handle bounds
 * @returns {{ x: number, y: number }}
 */
export function getHandlePosition(node, handle, fallbackPosition = Position.Top, center = false) {
  const nodePos = node.internals?.positionAbsolute ?? node.position;
  const handleX = (handle?.x ?? 0) + nodePos.x;
  const handleY = (handle?.y ?? 0) + nodePos.y;
  const handleWidth = handle?.width ?? 0;
  const handleHeight = handle?.height ?? 0;
  const position = handle?.position ?? fallbackPosition;

  if (center) {
    return { x: handleX + handleWidth / 2, y: handleY + handleHeight / 2 };
  }

  switch (position) {
    case Position.Top:
      return { x: handleX + handleWidth / 2, y: handleY };
    case Position.Right:
      return { x: handleX + handleWidth, y: handleY + handleHeight / 2 };
    case Position.Bottom:
      return { x: handleX + handleWidth / 2, y: handleY + handleHeight };
    case Position.Left:
      return { x: handleX, y: handleY + handleHeight / 2 };
    default:
      return { x: handleX + handleWidth / 2, y: handleY + handleHeight / 2 };
  }
}

/**
 * Resolve the source and target positions for an edge.
 * @param {object} sourceNode - Source node with internals
 * @param {string|null} sourceHandleId
 * @param {object} targetNode - Target node with internals
 * @param {string|null} targetHandleId
 * @returns {{ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }}
 */
export function getEdgePosition(sourceNode, sourceHandleId, targetNode, targetHandleId) {
  const sourceHandle = findHandle(sourceNode, sourceHandleId, 'source');
  const targetHandle = findHandle(targetNode, targetHandleId, 'target');

  const sourcePos = getHandlePosition(
    sourceNode, sourceHandle,
    sourceNode.sourcePosition ?? Position.Bottom
  );
  const targetPos = getHandlePosition(
    targetNode, targetHandle,
    targetNode.targetPosition ?? Position.Top
  );

  return {
    sourceX: sourcePos.x,
    sourceY: sourcePos.y,
    targetX: targetPos.x,
    targetY: targetPos.y,
    sourcePosition: sourceHandle?.position ?? sourceNode.sourcePosition ?? Position.Bottom,
    targetPosition: targetHandle?.position ?? targetNode.targetPosition ?? Position.Top,
  };
}

/**
 * Find a handle on a node by id and type.
 */
function findHandle(node, handleId, type) {
  const bounds = node.internals?.handleBounds;
  if (!bounds) return null;

  const handles = type === 'source' ? bounds.source : bounds.target;
  if (!handles || handles.length === 0) return null;

  if (handleId) {
    return handles.find((h) => h.id === handleId) ?? handles[0];
  }
  return handles[0];
}

/**
 * Find the closest handle within a connection radius.
 */
export function getClosestHandle(position, connectionRadius, nodeLookup, fromHandle) {
  let closestDistance = Infinity;
  let closestHandles = [];

  for (const [, node] of nodeLookup) {
    const bounds = node.internals?.handleBounds;
    if (!bounds) continue;

    const allHandles = [...(bounds.source || []), ...(bounds.target || [])];

    for (const handle of allHandles) {
      // Skip the originating handle
      if (handle.nodeId === fromHandle?.nodeId && handle.id === fromHandle?.id && handle.type === fromHandle?.type) {
        continue;
      }

      const handlePos = getHandlePosition(node, handle, handle.position, true);
      const dx = handlePos.x - position.x;
      const dy = handlePos.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > connectionRadius) continue;

      if (dist < closestDistance) {
        closestDistance = dist;
        closestHandles = [{ ...handle, absX: handlePos.x, absY: handlePos.y }];
      } else if (Math.abs(dist - closestDistance) < 0.01) {
        closestHandles.push({ ...handle, absX: handlePos.x, absY: handlePos.y });
      }
    }
  }

  if (closestHandles.length === 0) return null;

  // Prefer opposite handle type
  if (closestHandles.length > 1 && fromHandle) {
    const oppositeType = fromHandle.type === 'source' ? 'target' : 'source';
    const preferred = closestHandles.find((h) => h.type === oppositeType);
    if (preferred) return preferred;
  }

  return closestHandles[0];
}

// ─── Connection State Machine ────────────────────────────────

/**
 * Create a connection handler. Manages the state machine for drag-to-connect.
 *
 * @param {Function} getState - Returns { viewport, nodeLookup, options, containerBounds }
 * @param {object} callbacks - { onConnectStart, onConnect, onConnectEnd, onConnectionStateChange }
 * @returns {{ handlePointerDown: Function, destroy: Function }}
 */
export function createConnectionHandler(getState, callbacks) {
  let isConnecting = false;
  let fromHandle = null;
  let fromNode = null;
  let fromPosition = null;
  let connectionState = null;
  let doc = document;

  function handlePointerDown(event, nodeId, handleId, handleType, handlePosition) {
    event.stopPropagation();

    const state = getState();
    const { nodeLookup, viewport, containerBounds } = state;
    const node = nodeLookup.get(nodeId);
    if (!node) return;

    doc = getHostForElement(event.target);

    const handle = findHandle(node, handleId, handleType);
    fromHandle = { nodeId, id: handleId, type: handleType, position: handlePosition, ...(handle || {}) };
    fromNode = node;
    fromPosition = handlePosition;

    const handlePos = getHandlePosition(node, handle, handlePosition);

    isConnecting = true;
    connectionState = {
      inProgress: true,
      isValid: null,
      from: { x: handlePos.x, y: handlePos.y },
      fromHandle,
      fromNode: node,
      fromPosition: handlePosition,
      to: { x: handlePos.x, y: handlePos.y },
      toHandle: null,
      toNode: null,
      toPosition: null,
    };

    callbacks.onConnectStart?.(event, { nodeId, handleId, handleType });
    callbacks.onConnectionStateChange?.(connectionState);

    doc.addEventListener('mousemove', onPointerMove);
    doc.addEventListener('mouseup', onPointerUp);
    doc.addEventListener('touchmove', onPointerMove);
    doc.addEventListener('touchend', onPointerUp);
  }

  function onPointerMove(event) {
    if (!isConnecting) return;

    const state = getState();
    const { viewport, nodeLookup, containerBounds, options } = state;
    const connectionRadius = options.connectionRadius ?? DEFAULTS.connectionRadius;

    // Get pointer position in flow coordinates
    const { clientX, clientY } = event.touches ? event.touches[0] : event;
    const containerX = clientX - (containerBounds?.left ?? 0);
    const containerY = clientY - (containerBounds?.top ?? 0);
    const flowX = (containerX - viewport.x) / viewport.zoom;
    const flowY = (containerY - viewport.y) / viewport.zoom;
    const pointerPos = { x: flowX, y: flowY };

    // Find closest handle
    const closest = getClosestHandle(pointerPos, connectionRadius, nodeLookup, fromHandle);

    let isValid = null;
    let toPos = pointerPos;
    let toHandle = null;
    let toNode = null;
    let toPosition = null;

    if (closest) {
      // Validate connection
      const isValidConnection = validateConnection(fromHandle, closest, state);
      isValid = isValidConnection;
      toHandle = closest;
      toNode = nodeLookup.get(closest.nodeId);
      toPosition = closest.position;
      toPos = { x: closest.absX, y: closest.absY };
    }

    connectionState = {
      inProgress: true,
      isValid,
      from: connectionState.from,
      fromHandle,
      fromNode,
      fromPosition,
      to: toPos,
      toHandle,
      toNode,
      toPosition,
      pointer: pointerPos,
    };

    callbacks.onConnectionStateChange?.(connectionState);
  }

  function onPointerUp(event) {
    if (!isConnecting) return;

    doc.removeEventListener('mousemove', onPointerMove);
    doc.removeEventListener('mouseup', onPointerUp);
    doc.removeEventListener('touchmove', onPointerMove);
    doc.removeEventListener('touchend', onPointerUp);

    // If we had a valid connection target, fire onConnect
    if (connectionState?.isValid && connectionState.toHandle) {
      const connection = {
        source: fromHandle.type === 'source' ? fromHandle.nodeId : connectionState.toHandle.nodeId,
        target: fromHandle.type === 'source' ? connectionState.toHandle.nodeId : fromHandle.nodeId,
        sourceHandle: fromHandle.type === 'source' ? (fromHandle.id ?? null) : (connectionState.toHandle.id ?? null),
        targetHandle: fromHandle.type === 'source' ? (connectionState.toHandle.id ?? null) : (fromHandle.id ?? null),
      };
      callbacks.onConnect?.(connection);
    }

    callbacks.onConnectEnd?.(event);
    callbacks.onConnectionStateChange?.(null);

    isConnecting = false;
    fromHandle = null;
    fromNode = null;
    fromPosition = null;
    connectionState = null;
  }

  function validateConnection(from, to, state) {
    const { options } = state;

    // Can't connect to self (same node + same handle)
    if (from.nodeId === to.nodeId && from.id === to.id) return false;

    // In strict mode, source must connect to target (not source→source)
    if (options.connectionMode === 'strict') {
      if (from.type === to.type) return false;
    }

    // User-provided validation
    if (options.isValidConnection) {
      const connection = {
        source: from.type === 'source' ? from.nodeId : to.nodeId,
        target: from.type === 'source' ? to.nodeId : from.nodeId,
        sourceHandle: from.type === 'source' ? (from.id ?? null) : (to.id ?? null),
        targetHandle: from.type === 'source' ? (to.id ?? null) : (from.id ?? null),
      };
      return options.isValidConnection(connection);
    }

    return true;
  }

  return {
    handlePointerDown,
    getConnectionState() {
      return connectionState;
    },
    destroy() {
      doc.removeEventListener('mousemove', onPointerMove);
      doc.removeEventListener('mouseup', onPointerUp);
      doc.removeEventListener('touchmove', onPointerMove);
      doc.removeEventListener('touchend', onPointerUp);
    },
  };
}
