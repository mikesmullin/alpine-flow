/**
 * Alpine Flow - Auto Layout
 *
 * A built-in hierarchical/layered layout algorithm (Sugiyama-style) that
 * computes x,y positions for nodes based on the graph topology.
 *
 * Supports:
 *  - Four directions: TB (top→bottom), LR (left→right), BT, RL
 *  - Configurable node and rank spacing
 *  - Handles disconnected subgraphs
 *  - Handles cycles (breaks back-edges)
 *  - Barycenter ordering within ranks (reduces edge crossings)
 *  - Only assigns positions to nodes that don't already have one
 *
 * Usage:
 *   import { layoutNodes } from './layout.js';
 *   const positioned = layoutNodes(nodes, edges, { direction: 'TB' });
 */

// ─── Default layout options ─────────────────────────────────

const LAYOUT_DEFAULTS = {
  direction: 'TB',      // 'TB' | 'LR' | 'BT' | 'RL'
  nodeSpacing: 50,      // horizontal gap between nodes in the same rank
  rankSpacing: 100,     // vertical gap between ranks
  nodeWidth: 172,       // fallback node width (used if not measured)
  nodeHeight: 36,       // fallback node height (used if not measured)
  alignment: 'center',  // 'start' | 'center' | 'end'  (within-rank alignment)
};

// ─── Main entry point ───────────────────────────────────────

/**
 * Compute layout positions for nodes that lack explicit positions.
 *
 * @param {Array} nodes  — array of node objects
 * @param {Array} edges  — array of edge objects
 * @param {Object} opts  — layout options (merged with LAYOUT_DEFAULTS)
 * @returns {Array}      — new array of nodes with positions filled in
 */
export function layoutNodes(nodes, edges, opts = {}) {
  if (!nodes || nodes.length === 0) return nodes;

  const options = { ...LAYOUT_DEFAULTS, ...opts };
  const isHorizontal = options.direction === 'LR' || options.direction === 'RL';
  const isReversed = options.direction === 'BT' || options.direction === 'RL';

  // ── 1. Identify which nodes need layout ──────────────────
  const needsLayout = new Set();
  const nodeMap = new Map();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    if (!_hasExplicitPosition(node)) {
      needsLayout.add(node.id);
    }
  }

  // If every node already has a position, nothing to do
  if (needsLayout.size === 0) return nodes;

  // ── 2. Build adjacency from ALL nodes/edges (so rank
  //       structure respects the full graph, even pinned nodes) ──
  const adj = new Map();     // id → Set<id>  (forward edges)
  const inAdj = new Map();   // id → Set<id>  (reverse edges)

  for (const node of nodes) {
    adj.set(node.id, new Set());
    inAdj.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adj.get(edge.source).add(edge.target);
    inAdj.get(edge.target).add(edge.source);
  }

  // ── 3. Topological sort with cycle breaking ──────────────
  const ranks = _assignRanks(nodes, adj, inAdj);

  // ── 4. Group nodes into layers by rank ───────────────────
  const maxRank = Math.max(...Array.from(ranks.values()), 0);
  const layers = [];
  for (let r = 0; r <= maxRank; r++) {
    layers.push([]);
  }
  for (const node of nodes) {
    const r = ranks.get(node.id) ?? 0;
    layers[r].push(node.id);
  }

  // ── 5. Barycenter ordering to reduce edge crossings ──────
  _barycenterOrdering(layers, adj, inAdj);

  // ── 6. Assign coordinates ────────────────────────────────
  const positions = _assignCoordinates(layers, nodeMap, options, isHorizontal, isReversed);

  // ── 7. Apply: only overwrite nodes that need layout ──────
  return nodes.map((node) => {
    if (!needsLayout.has(node.id)) return node;
    const pos = positions.get(node.id);
    if (!pos) return node;
    return { ...node, position: { x: pos.x, y: pos.y } };
  });
}

/**
 * Check whether a node was given an explicit position by the user.
 * A node "has no position" if:
 *  - node.position is undefined/null, OR
 *  - node.position is { x: 0, y: 0 } (the normalizeNode default) AND
 *    the original raw node had no position property
 *
 * We use a sentinel: if the raw config node had `position`, normalizeNode
 * copies it. If it didn't, normalizeNode sets { x: 0, y: 0 }. We mark
 * this via a `_autoLayout` flag set during the layout pass in index.js.
 *
 * For the layout module itself, we use a simple heuristic:
 * if `node._needsLayout` is explicitly true, it needs layout.
 * Otherwise if `node.position` exists and is not {0,0}, it has a position.
 */
function _hasExplicitPosition(node) {
  // Explicit flag set by the integration layer
  if (node._needsLayout === true) return false;
  if (node._needsLayout === false) return true;

  // Fallback heuristic: {0,0} is ambiguous but we treat it as "no position"
  // only if the flag isn't set. In practice the integration layer always sets it.
  if (!node.position) return false;
  return true;
}

// ─── Rank Assignment (longest-path, with cycle handling) ────

function _assignRanks(nodes, adj, inAdj) {
  const ranks = new Map();
  const visited = new Set();
  const inStack = new Set(); // for cycle detection

  // DFS-based longest-path ranking
  function dfs(id, depth) {
    if (inStack.has(id)) return; // back-edge → cycle, skip
    if (visited.has(id)) return;

    inStack.add(id);
    visited.add(id);
    ranks.set(id, Math.max(ranks.get(id) ?? 0, depth));

    for (const child of adj.get(id) || []) {
      // Ensure child rank is at least parent + 1
      const childCurrentRank = ranks.get(child) ?? 0;
      if (depth + 1 > childCurrentRank) {
        ranks.set(child, depth + 1);
      }
      dfs(child, depth + 1);
    }

    inStack.delete(id);
  }

  // Start DFS from roots (nodes with no incoming edges)
  const roots = nodes.filter((n) => (inAdj.get(n.id)?.size ?? 0) === 0);

  // If no roots (all nodes in cycles), pick arbitrary starting points
  if (roots.length === 0) {
    dfs(nodes[0].id, 0);
  }

  for (const root of roots) {
    dfs(root.id, 0);
  }

  // Handle any disconnected nodes not yet visited
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, 0);
    }
  }

  return ranks;
}

// ─── Barycenter Ordering ────────────────────────────────────

/**
 * Reorder nodes within each layer to minimize edge crossings
 * using the barycenter heuristic (2 passes: down then up).
 */
function _barycenterOrdering(layers, adj, inAdj) {
  const iterations = 4; // more = fewer crossings, but diminishing returns

  for (let iter = 0; iter < iterations; iter++) {
    // Down pass: order each layer by average position of parents
    for (let i = 1; i < layers.length; i++) {
      _orderLayerByBarycenter(layers, i, inAdj, layers[i - 1]);
    }
    // Up pass: order each layer by average position of children
    for (let i = layers.length - 2; i >= 0; i--) {
      _orderLayerByBarycenter(layers, i, adj, layers[i + 1]);
    }
  }
}

function _orderLayerByBarycenter(layers, layerIndex, adjacency, referenceLayer) {
  const layer = layers[layerIndex];
  const refPositions = new Map();
  referenceLayer.forEach((id, idx) => refPositions.set(id, idx));

  const barycenters = new Map();

  for (const nodeId of layer) {
    const neighbors = adjacency.get(nodeId);
    if (!neighbors || neighbors.size === 0) {
      barycenters.set(nodeId, Infinity); // no connections → keep current position
      continue;
    }

    let sum = 0;
    let count = 0;
    for (const neighbor of neighbors) {
      const pos = refPositions.get(neighbor);
      if (pos !== undefined) {
        sum += pos;
        count++;
      }
    }

    barycenters.set(nodeId, count > 0 ? sum / count : Infinity);
  }

  // Stable sort by barycenter
  layers[layerIndex] = [...layer].sort((a, b) => {
    const ba = barycenters.get(a);
    const bb = barycenters.get(b);
    if (ba === bb) return 0;
    return ba - bb;
  });
}

// ─── Coordinate Assignment ──────────────────────────────────

function _assignCoordinates(layers, nodeMap, options, isHorizontal, isReversed) {
  const { nodeSpacing, rankSpacing, nodeWidth, nodeHeight, alignment } = options;
  const positions = new Map();

  // Compute each layer's total extent so we can center them
  const layerWidths = layers.map((layer) => {
    let total = 0;
    for (const id of layer) {
      total += _getNodeSize(nodeMap.get(id), isHorizontal ? nodeHeight : nodeWidth, isHorizontal);
    }
    total += Math.max(0, layer.length - 1) * nodeSpacing;
    return total;
  });

  const maxLayerWidth = Math.max(...layerWidths, 0);

  let rankOffset = 0;

  for (let r = 0; r < layers.length; r++) {
    const layer = layers[r];
    const layerWidth = layerWidths[r];

    // Alignment offset within rank
    let crossOffset = 0;
    if (alignment === 'center') {
      crossOffset = (maxLayerWidth - layerWidth) / 2;
    } else if (alignment === 'end') {
      crossOffset = maxLayerWidth - layerWidth;
    }

    let cursor = crossOffset;

    for (const id of layer) {
      const node = nodeMap.get(id);
      const w = _getNodeDim(node, nodeWidth, 'width');
      const h = _getNodeDim(node, nodeHeight, 'height');
      const crossSize = isHorizontal ? h : w;

      let x, y;
      if (isHorizontal) {
        // rank axis = x, cross axis = y
        x = rankOffset;
        y = cursor;
      } else {
        // rank axis = y, cross axis = x
        x = cursor;
        y = rankOffset;
      }

      if (isReversed) {
        // Flip: we'll negate the rank axis later
        if (isHorizontal) x = -x;
        else y = -y;
      }

      positions.set(id, { x, y });
      cursor += crossSize + nodeSpacing;
    }

    // Advance rank offset
    const rankSize = _getMaxRankSize(layer, nodeMap, isHorizontal ? nodeWidth : nodeHeight, isHorizontal);
    rankOffset += rankSize + rankSpacing;
  }

  // If reversed, shift everything so minimum is at 0
  if (isReversed) {
    _normalizePositions(positions, isHorizontal);
  }

  return positions;
}

/**
 * Get the size of a node along the cross-axis.
 */
function _getNodeSize(node, fallback, isHorizontal) {
  if (!node) return fallback;
  if (isHorizontal) {
    return node.measured?.height || node.height || node.initialHeight || fallback;
  }
  return node.measured?.width || node.width || node.initialWidth || fallback;
}

/**
 * Get a specific dimension of a node.
 */
function _getNodeDim(node, fallback, dim) {
  if (!node) return fallback;
  return node.measured?.[dim] || node[dim] || node[`initial${dim.charAt(0).toUpperCase() + dim.slice(1)}`] || fallback;
}

/**
 * Get the max node size along the rank axis for a given layer.
 */
function _getMaxRankSize(layer, nodeMap, fallback, isHorizontal) {
  let max = 0;
  for (const id of layer) {
    const node = nodeMap.get(id);
    const size = isHorizontal
      ? (node?.measured?.width || node?.width || node?.initialWidth || fallback)
      : (node?.measured?.height || node?.height || node?.initialHeight || fallback);
    if (size > max) max = size;
  }
  return max || fallback;
}

/**
 * Shift all positions so the minimum x and y are at 0.
 */
function _normalizePositions(positions, isHorizontal) {
  let minX = Infinity, minY = Infinity;
  for (const pos of positions.values()) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
  }
  for (const pos of positions.values()) {
    pos.x -= minX;
    pos.y -= minY;
  }
}

// ─── Named export for standalone use ────────────────────────

export { LAYOUT_DEFAULTS };
