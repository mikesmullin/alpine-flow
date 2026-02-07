/**
 * Alpine Flow - Graph Utilities
 * Functions for querying and manipulating the graph structure.
 */

/**
 * Get all incoming nodes (nodes that have edges pointing to this node).
 */
export function getIncomers(nodeOrId, nodes, edges) {
  const nodeId = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
  const incomingEdges = edges.filter((e) => e.target === nodeId);
  const incomingIds = new Set(incomingEdges.map((e) => e.source));
  return nodes.filter((n) => incomingIds.has(n.id));
}

/**
 * Get all outgoing nodes (nodes that this node has edges pointing to).
 */
export function getOutgoers(nodeOrId, nodes, edges) {
  const nodeId = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
  const outgoingEdges = edges.filter((e) => e.source === nodeId);
  const outgoingIds = new Set(outgoingEdges.map((e) => e.target));
  return nodes.filter((n) => outgoingIds.has(n.id));
}

/**
 * Get all edges connected to the given node(s).
 */
export function getConnectedEdges(nodeOrNodes, edges) {
  const nodeIds = new Set(
    Array.isArray(nodeOrNodes)
      ? nodeOrNodes.map((n) => (typeof n === 'string' ? n : n.id))
      : [typeof nodeOrNodes === 'string' ? nodeOrNodes : nodeOrNodes.id]
  );
  return edges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target));
}

/**
 * Add an edge to the edges array, deduplicating by source+target+handles.
 */
export function addEdge(edgeParams, edges) {
  if (!edgeParams.source || !edgeParams.target) {
    console.warn('[Alpine Flow] addEdge: source and target are required');
    return edges;
  }

  const existing = edges.find(
    (e) =>
      e.source === edgeParams.source &&
      e.target === edgeParams.target &&
      (e.sourceHandle ?? null) === (edgeParams.sourceHandle ?? null) &&
      (e.targetHandle ?? null) === (edgeParams.targetHandle ?? null)
  );

  if (existing) return edges;

  const newEdge = {
    id: edgeParams.id || `e-${edgeParams.source}${edgeParams.sourceHandle ? `-${edgeParams.sourceHandle}` : ''}-${edgeParams.target}${edgeParams.targetHandle ? `-${edgeParams.targetHandle}` : ''}`,
    ...edgeParams,
  };

  return [...edges, newEdge];
}

/**
 * Replace an edge with a new connection.
 */
export function reconnectEdge(oldEdge, newConnection, edges) {
  if (!newConnection.source || !newConnection.target) {
    console.warn('[Alpine Flow] reconnectEdge: source and target are required');
    return edges;
  }
  return edges.map((e) => {
    if (e.id === oldEdge.id) {
      return {
        ...e,
        id: `e-${newConnection.source}-${newConnection.target}`,
        source: newConnection.source,
        target: newConnection.target,
        sourceHandle: newConnection.sourceHandle ?? null,
        targetHandle: newConnection.targetHandle ?? null,
      };
    }
    return e;
  });
}

/**
 * Apply an array of node changes (add, remove, position, dimensions, select, reset) to the nodes array.
 * Each change has a { type, id, ... } shape.
 */
export function applyNodeChanges(changes, nodes) {
  let result = [...nodes];

  for (const change of changes) {
    switch (change.type) {
      case 'add':
        result.push(change.item);
        break;

      case 'remove':
        result = result.filter((n) => n.id !== change.id);
        break;

      case 'position':
        result = result.map((n) => {
          if (n.id !== change.id) return n;
          const updated = { ...n };
          if (change.position) updated.position = change.position;
          if (change.dragging !== undefined) updated.dragging = change.dragging;
          return updated;
        });
        break;

      case 'dimensions':
        result = result.map((n) => {
          if (n.id !== change.id) return n;
          return {
            ...n,
            measured: {
              ...n.measured,
              width: change.dimensions?.width ?? n.measured?.width,
              height: change.dimensions?.height ?? n.measured?.height,
            },
          };
        });
        break;

      case 'select':
        result = result.map((n) => {
          if (n.id !== change.id) return n;
          return { ...n, selected: change.selected };
        });
        break;

      case 'reset':
        result = change.item ? [change.item] : [];
        break;

      default:
        break;
    }
  }

  return result;
}

/**
 * Apply an array of edge changes (add, remove, select, reset) to the edges array.
 */
export function applyEdgeChanges(changes, edges) {
  let result = [...edges];

  for (const change of changes) {
    switch (change.type) {
      case 'add':
        result.push(change.item);
        break;

      case 'remove':
        result = result.filter((e) => e.id !== change.id);
        break;

      case 'select':
        result = result.map((e) => {
          if (e.id !== change.id) return e;
          return { ...e, selected: change.selected };
        });
        break;

      case 'reset':
        result = change.item ? [change.item] : [];
        break;

      default:
        break;
    }
  }

  return result;
}

/**
 * Check if an element looks like a node (has position property).
 */
export function isNode(element) {
  return element != null && typeof element === 'object' && 'position' in element && !('source' in element);
}

/**
 * Check if an element looks like an edge (has source/target properties).
 */
export function isEdge(element) {
  return element != null && typeof element === 'object' && 'source' in element && 'target' in element;
}

/**
 * Delete elements from the graph. Returns { nodes, edges } with deletions applied.
 */
export function deleteElements({ nodesToRemove = [], edgesToRemove = [] }, nodes, edges) {
  const nodeIdsToRemove = new Set(
    nodesToRemove
      .filter((n) => n.deletable !== false)
      .map((n) => (typeof n === 'string' ? n : n.id))
  );
  const edgeIdsToRemove = new Set(
    edgesToRemove
      .filter((e) => e.deletable !== false)
      .map((e) => (typeof e === 'string' ? e : e.id))
  );

  // Also remove edges connected to deleted nodes
  for (const edge of edges) {
    if (nodeIdsToRemove.has(edge.source) || nodeIdsToRemove.has(edge.target)) {
      edgeIdsToRemove.add(edge.id);
    }
  }

  return {
    nodes: nodes.filter((n) => !nodeIdsToRemove.has(n.id)),
    edges: edges.filter((e) => !edgeIdsToRemove.has(e.id)),
  };
}
