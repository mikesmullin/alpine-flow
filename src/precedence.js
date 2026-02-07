/**
 * Alpine Flow — Precedence Pre-Filter
 *
 * A DSL-driven graph filter that resolves cyclical graphs by defining
 * a precedence ordering over node *types*.  Nodes whose type is not
 * mentioned are hidden; edges that violate the declared ordering
 * (i.e. flow from lower → higher precedence) are hidden.
 *
 * This is a **pre-filter** — it runs before auto-layout and applies
 * regardless of whether `autoLayout` is enabled.
 *
 * ─── Syntax ────────────────────────────────────────────────
 *
 *   "A > B > C"
 *       A has higher precedence than B, B higher than C.
 *       Only edges A→B, A→C, B→C are kept; C→A etc. are hidden.
 *
 *   "A > B & C"
 *       A is higher than both B and C (B, C are peers).
 *       Shorthand for "A > B; A > C".
 *
 *   "A > B & C > D"
 *       A → {B, C} → D.  Peers B and C are at the same rank.
 *
 *   "A > B; C > D"
 *       Two independent chains combined with ";".
 *       All four types are visible; edges must respect both chains.
 *
 *   Whitespace around >, &, ; is ignored. Type names are trimmed.
 *
 * ─── API ───────────────────────────────────────────────────
 *
 *   parsePrecedence(str)   → rules | null
 *   applyPrecedence(nodes, edges, rules) → { nodes, edges }
 */

// ─── Parser ─────────────────────────────────────────────────

/**
 * Parse a precedence DSL string into a structured rule object.
 *
 * @param {string} str — the precedence string, e.g. "A > B & C > D; E > F"
 * @returns {{ types: Set<string>, ranks: Map<string, number> } | null}
 */
export function parsePrecedence(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  const allTypes = new Set();

  // Adjacency list for the type-level DAG (higher → lower)
  const adj = new Map();   // type → Set<type>
  const inDeg = new Map(); // type → number

  const ensureType = (t) => {
    allTypes.add(t);
    if (!adj.has(t)) adj.set(t, new Set());
    if (!inDeg.has(t)) inDeg.set(t, 0);
  };

  // ── 1. Split by ";" into independent statements ──────────
  const statements = trimmed.split(';');

  for (const stmt of statements) {
    const s = stmt.trim();
    if (!s) continue;

    // ── 2. Split by ">" into ordered groups ────────────────
    const groups = s.split('>').map((g) =>
      g.split('&').map((t) => t.trim()).filter(Boolean)
    ).filter((g) => g.length > 0);

    // Register every mentioned type
    for (const group of groups) {
      for (const type of group) ensureType(type);
    }

    // ── 3. Create DAG edges: group[i] → group[i+1] ────────
    for (let i = 0; i < groups.length - 1; i++) {
      for (const higher of groups[i]) {
        for (const lower of groups[i + 1]) {
          if (higher === lower) continue; // self-loop guard
          if (!adj.get(higher).has(lower)) {
            adj.get(higher).add(lower);
            inDeg.set(lower, (inDeg.get(lower) || 0) + 1);
          }
        }
      }
    }
  }

  if (allTypes.size === 0) return null;

  // ── 4. Compute ranks via longest-path BFS (Kahn's-style) ─
  const ranks = new Map();
  const queue = [];

  for (const type of allTypes) {
    if ((inDeg.get(type) || 0) === 0) {
      ranks.set(type, 0);
      queue.push(type);
    }
  }

  // If the precedence DAG itself has cycles, fall back to rank 0 for all
  if (queue.length === 0) {
    for (const type of allTypes) ranks.set(type, 0);
    return { types: allTypes, ranks };
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentRank = ranks.get(current);
    for (const child of adj.get(current) || []) {
      const newRank = currentRank + 1;
      if (newRank > (ranks.get(child) ?? -1)) {
        ranks.set(child, newRank);
      }
      inDeg.set(child, inDeg.get(child) - 1);
      if (inDeg.get(child) === 0) {
        queue.push(child);
      }
    }
  }

  // Any type still un-ranked was caught in a cycle within the DSL itself
  for (const type of allTypes) {
    if (!ranks.has(type)) ranks.set(type, 0);
  }

  return { types: allTypes, ranks };
}

// ─── Applicator ─────────────────────────────────────────────

/**
 * Apply precedence rules to nodes and edges **in place**.
 *
 * - Nodes whose `type` is NOT mentioned in the precedence string
 *   are marked `hidden: true`.
 * - Edges whose source or target is hidden are marked `hidden: true`.
 * - Edges that flow from a *lower*-precedence type to a
 *   *higher*-precedence type (i.e. backwards) are marked `hidden: true`.
 * - Edges between nodes of the *same* type or at the *same* rank
 *   are left visible (lateral connections).
 *
 * Mutation is intentional — this runs once during init before any
 * rendering or layout happens.
 *
 * @param {Array}  nodes — normalised node array (will be mutated)
 * @param {Array}  edges — normalised edge array (will be mutated)
 * @param {{ types: Set<string>, ranks: Map<string, number> }} rules
 */
export function applyPrecedence(nodes, edges, rules) {
  if (!rules) return;

  const { types, ranks } = rules;

  // ── 1. Build nodeId → type map & mark hidden nodes ───────
  const nodeTypeMap = new Map();
  const visibleNodeIds = new Set();

  for (const node of nodes) {
    nodeTypeMap.set(node.id, node.type);

    if (types.has(node.type)) {
      visibleNodeIds.add(node.id);
      // Don't touch user-set `hidden`; only mark if type is excluded
    } else {
      node.hidden = true;
      node._precedenceHidden = true; // bookkeeping
    }
  }

  // ── 2. Filter edges ──────────────────────────────────────
  for (const edge of edges) {
    // Source or target hidden → edge hidden
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      edge.hidden = true;
      edge._precedenceHidden = true;
      continue;
    }

    const sourceType = nodeTypeMap.get(edge.source);
    const targetType = nodeTypeMap.get(edge.target);
    const sourceRank = ranks.get(sourceType);
    const targetRank = ranks.get(targetType);

    // Both ranks must be known (they should be if the types are visible)
    if (sourceRank === undefined || targetRank === undefined) continue;

    // Backwards edge: source has lower precedence (higher rank number)
    // than target — this is the cycle-breaking condition
    if (sourceRank > targetRank) {
      edge.hidden = true;
      edge._precedenceHidden = true;
    }
  }
}

/**
 * Remove precedence-hidden flags from all nodes and edges.
 * Useful when the precedence option is removed at runtime.
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
