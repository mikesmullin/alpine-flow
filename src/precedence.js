/**
 * Alpine Flow — Precedence Pre-Filter (v2)
 *
 * A DSL-driven graph filter that controls which nodes and edges are
 * visible.  Supports class (type) selectors, instance (id) selectors,
 * and wildcards for graph traversal.
 *
 * This is a **pre-filter** — it runs before auto-layout and applies
 * regardless of whether `autoLayout` is enabled.
 *
 * ─── Selector Syntax ───────────────────────────────────────
 *
 *   :Type           Class selector  — matches all nodes with node.type === 'Type'
 *   id:Type         Instance selector — matches node.id === 'id' AND node.type === 'Type'
 *   id              ID selector     — matches node.id === 'id' (any type)
 *   *               Wildcard        — one level of connected nodes
 *   **              Deep wildcard   — all transitively connected nodes
 *
 * ─── Chain Syntax ──────────────────────────────────────────
 *
 *   :A > :B > :C       A has higher precedence than B, B higher than C
 *   :A > :B & :C       A higher than both B and C (peers at same rank)
 *   :A > :B; :C > :D   Two independent chains combined with ";"
 *   ** > teamx:Team    teamx and every node that (transitively) leads to it
 *   :Person > ** > :Product   Person, Product, and all nodes on paths between
 *   * > :Team          Team nodes and their direct parents only
 *
 * ─── API ───────────────────────────────────────────────────
 *
 *   parsePrecedence(str)                → rules | null
 *   applyPrecedence(nodes, edges, rules) → void (mutates in place)
 *   clearPrecedence(nodes, edges)        → void (undoes hiding)
 */

// ─── Selector Parsing ───────────────────────────────────────

/**
 * Parse a single token into a selector object.
 *
 * @param {string} token
 * @returns {{ kind: 'type'|'id'|'instance'|'wildcard', ... } | null}
 */
function parseSelector(token) {
  const t = token.trim();
  if (!t) return null;
  if (t === '**') return { kind: 'wildcard', depth: Infinity };
  if (t === '*')  return { kind: 'wildcard', depth: 1 };

  const colonIdx = t.indexOf(':');

  if (colonIdx === -1) {
    // No colon → bare instance ID
    return { kind: 'id', id: t };
  }
  if (colonIdx === 0) {
    // :Type → class/type selector
    const type = t.slice(1);
    return type ? { kind: 'type', type } : null;
  }
  // id:Type → instance selector
  const id   = t.slice(0, colonIdx);
  const type = t.slice(colonIdx + 1);
  return (id && type) ? { kind: 'instance', id, type } : null;
}

// ─── Parser ─────────────────────────────────────────────────

/**
 * Parse a precedence DSL string into structured rules.
 *
 * @param {string} str — e.g. "** > teamx:Team; :Person > ** > :Product"
 * @returns {{ chains: Array<Array<{ selectors, rank, isWildcard, wildcardDepth }>> } | null}
 */
export function parsePrecedence(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  const chains = [];

  for (const stmt of trimmed.split(';')) {
    const s = stmt.trim();
    if (!s) continue;

    const groups = s.split('>').map((g) => {
      const selectors = g.split('&').map(parseSelector).filter(Boolean);
      const hasWild = selectors.length === 1 && selectors[0].kind === 'wildcard';
      return {
        selectors,
        rank: 0,           // assigned below
        isWildcard: hasWild,
        wildcardDepth: hasWild ? selectors[0].depth : 0,
      };
    }).filter((g) => g.selectors.length > 0);

    if (groups.length === 0) continue;
    groups.forEach((g, i) => { g.rank = i; });
    chains.push(groups);
  }

  return chains.length > 0 ? { chains } : null;
}

// ─── Selector Matching ──────────────────────────────────────

function matchesSelector(node, sel) {
  switch (sel.kind) {
    case 'type':     return node.type === sel.type;
    case 'id':       return node.id === sel.id;
    case 'instance': return node.id === sel.id && node.type === sel.type;
    default:         return false;
  }
}

function matchesAnyConcreteSelector(node, selectors) {
  return selectors.some((s) => s.kind !== 'wildcard' && matchesSelector(node, s));
}

// ─── Graph Walks ────────────────────────────────────────────

/**
 * BFS walk from a seed set along an adjacency map, up to `maxSteps` hops.
 * Returns all discovered node IDs **excluding** the seeds themselves.
 */
function bfsWalk(seeds, adjMap, maxSteps) {
  const visited = new Set(seeds);
  let frontier = new Set(seeds);

  for (let step = 0; step < maxSteps; step++) {
    const next = new Set();
    for (const id of frontier) {
      for (const neighbor of adjMap.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  // Remove original seeds — caller decides whether to include them
  for (const id of seeds) visited.delete(id);
  return visited;
}

/**
 * Find all nodes that lie on some directed path from any source to any target.
 * Forward-reachable from sources ∩ Backward-reachable from targets.
 * Returns the intersection (may include sources/targets themselves).
 */
function findPathNodes(sources, targets, forwardAdj, backwardAdj, maxSteps) {
  // Forward from sources
  const fwd = bfsWalk(sources, forwardAdj, maxSteps);
  for (const id of sources) fwd.add(id);

  // Backward from targets
  const bwd = bfsWalk(targets, backwardAdj, maxSteps);
  for (const id of targets) bwd.add(id);

  // Intersection
  const result = new Set();
  for (const id of fwd) {
    if (bwd.has(id)) result.add(id);
  }
  return result;
}

// ─── Applicator ─────────────────────────────────────────────

/**
 * Apply precedence rules to nodes and edges **in place**.
 *
 * @param {Array}  nodes — normalised node array (will be mutated)
 * @param {Array}  edges — normalised edge array (will be mutated)
 * @param {{ chains }} rules — output from parsePrecedence()
 */
export function applyPrecedence(nodes, edges, rules) {
  if (!rules || !rules.chains) return;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeCount = nodes.length;

  // ── Build adjacency lists ────────────────────────────────
  const forward  = new Map(); // source → Set<target>
  const backward = new Map(); // target → Set<source>
  for (const n of nodes) {
    forward.set(n.id, new Set());
    backward.set(n.id, new Set());
  }
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      forward.get(e.source).add(e.target);
      backward.get(e.target).add(e.source);
    }
  }

  // ── Accumulate visible nodes and ranks across all chains ─
  const visibleNodeIds = new Set();
  const nodeRanks = new Map(); // nodeId → minimum rank (lower = higher precedence)

  for (const chain of rules.chains) {
    // 1. Resolve concrete (non-wildcard) groups → node ID sets
    const resolved = chain.map((group) => {
      if (group.isWildcard) return new Set();
      const ids = new Set();
      for (const node of nodes) {
        if (matchesAnyConcreteSelector(node, group.selectors)) {
          ids.add(node.id);
        }
      }
      return ids;
    });

    // 2. Expand wildcard groups via graph traversal
    for (let i = 0; i < chain.length; i++) {
      if (!chain[i].isWildcard) continue;

      const depth = chain[i].wildcardDepth;
      const maxSteps = depth === Infinity ? nodeCount : depth;

      // Nearest concrete group to the left
      let leftIdx = -1;
      for (let l = i - 1; l >= 0; l--) {
        if (!chain[l].isWildcard) { leftIdx = l; break; }
      }

      // Nearest concrete group to the right
      let rightIdx = -1;
      for (let r = i + 1; r < chain.length; r++) {
        if (!chain[r].isWildcard) { rightIdx = r; break; }
      }

      if (leftIdx >= 0 && rightIdx >= 0) {
        // Between two concrete anchors — find nodes on paths
        const path = findPathNodes(
          resolved[leftIdx], resolved[rightIdx],
          forward, backward, maxSteps,
        );
        // Remove anchor nodes (they're in their own groups already)
        for (const id of resolved[leftIdx])  path.delete(id);
        for (const id of resolved[rightIdx]) path.delete(id);
        resolved[i] = path;
      } else if (rightIdx >= 0) {
        // At left edge — walk BACKWARD from right anchor
        resolved[i] = bfsWalk(resolved[rightIdx], backward, maxSteps);
      } else if (leftIdx >= 0) {
        // At right edge — walk FORWARD from left anchor
        resolved[i] = bfsWalk(resolved[leftIdx], forward, maxSteps);
      }
      // else: wildcard with no concrete anchor on either side → empty (no-op)
    }

    // 3. Mark visible and assign ranks
    for (let i = 0; i < chain.length; i++) {
      for (const nodeId of resolved[i]) {
        visibleNodeIds.add(nodeId);
        const existing = nodeRanks.get(nodeId);
        // Use the minimum rank (highest precedence) if a node appears in multiple groups
        if (existing === undefined || chain[i].rank < existing) {
          nodeRanks.set(nodeId, chain[i].rank);
        }
      }
    }
  }

  // ── 4. Hide nodes not in the visible set ─────────────────
  for (const node of nodes) {
    if (!visibleNodeIds.has(node.id)) {
      node.hidden = true;
      node._precedenceHidden = true;
    }
  }

  // ── 5. Hide edges ────────────────────────────────────────
  for (const edge of edges) {
    // Source or target hidden → edge hidden
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      edge.hidden = true;
      edge._precedenceHidden = true;
      continue;
    }

    const sourceRank = nodeRanks.get(edge.source);
    const targetRank = nodeRanks.get(edge.target);

    // Both ranks known and edge goes backward → hidden (cycle-breaking)
    if (sourceRank !== undefined && targetRank !== undefined && sourceRank > targetRank) {
      edge.hidden = true;
      edge._precedenceHidden = true;
    }
  }
}

// ─── Clear ──────────────────────────────────────────────────

/**
 * Remove precedence-hidden flags from all nodes and edges.
 * Useful when the precedence option is changed or removed at runtime.
 *
 * @param {Array} nodes
 * @param {Array} edges
 */
export function clearPrecedence(nodes, edges) {
  for (const node of nodes) {
    if (node._precedenceHidden) {
      node.hidden = false;
      delete node._precedenceHidden;
    }
  }
  for (const edge of edges) {
    if (edge._precedenceHidden) {
      edge.hidden = false;
      delete edge._precedenceHidden;
    }
  }
}
