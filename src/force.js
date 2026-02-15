/**
 * Alpine Flow - Force Simulation Engine
 * Lightweight, dependency-free force-directed simulation runtime.
 */

const FORCE_DEFAULTS = {
  linkDistance: 100,
  linkStrength: 0.08,
  chargeStrength: -300,
  collisionRadius: 45,
  centerStrength: 0.05,
  centerX: 0,
  centerY: 0,
  anchorNodeId: 'streamline',
  alpha: 0.3,
  alphaMin: 0.002,
  alphaDecay: 0.04,
  alphaTarget: 0,
  velocityDecay: 0.2,
  maxChargeDistance: 500,
  minDistance: 8,
};

export function createForceSimulation(initialOptions = {}) {
  let options = { ...FORCE_DEFAULTS, ...initialOptions };
  let alpha = options.alpha;
  let nodes = new Map();
  let links = [];

  let frameId = null;
  let running = false;
  let onTick = null;

  function setOptions(nextOptions = {}) {
    options = { ...options, ...nextOptions };
    if (nextOptions.alpha !== undefined) {
      alpha = nextOptions.alpha;
    }
  }

  function setNodes(nodeList = []) {
    const next = new Map();

    for (const node of nodeList) {
      const existing = nodes.get(node.id);
      const x = Number.isFinite(existing?.x) ? existing.x : (Number.isFinite(node.position?.x) ? node.position.x : 0);
      const y = Number.isFinite(existing?.y) ? existing.y : (Number.isFinite(node.position?.y) ? node.position.y : 0);

      next.set(node.id, {
        id: node.id,
        x,
        y,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: existing?.fx ?? null,
        fy: existing?.fy ?? null,
        mass: 1,
      });
    }

    nodes = next;
  }

  function setEdges(edgeList = []) {
    links = edgeList
      .filter((edge) => nodes.has(edge.source) && nodes.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target }));
  }

  function reheat(nextAlphaTarget = 0.2) {
    alpha = Math.max(alpha, nextAlphaTarget);
    options.alphaTarget = Math.max(options.alphaTarget, nextAlphaTarget);
    if (!running) {
      start(onTick);
    }
  }

  function setAlphaTarget(nextAlphaTarget = 0) {
    options.alphaTarget = Math.max(0, nextAlphaTarget);
    if (!running && (alpha > options.alphaMin || options.alphaTarget > options.alphaMin)) {
      start(onTick);
    }
  }

  function setAlpha(nextAlpha = alpha) {
    alpha = Math.max(0, nextAlpha);
  }

  function stop() {
    running = false;
    if (frameId != null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  function start(tickCallback) {
    if (tickCallback) onTick = tickCallback;
    if (running) return;

    running = true;

    const loop = () => {
      if (!running) return;

      tick();
      onTick?.(getState());

      if (alpha <= options.alphaMin && options.alphaTarget <= options.alphaMin) {
        stop();
        return;
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
  }

  function pinNode(id, x, y) {
    const node = nodes.get(id);
    if (!node) return;
    if (Number.isFinite(x)) node.x = x;
    if (Number.isFinite(y)) node.y = y;
    node.fx = Number.isFinite(x) ? x : node.x;
    node.fy = Number.isFinite(y) ? y : node.y;
    node.vx = 0;
    node.vy = 0;
  }

  function movePinnedNode(id, x, y) {
    const node = nodes.get(id);
    if (!node) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    node.x = x;
    node.y = y;
    node.fx = x;
    node.fy = y;
    node.vx = 0;
    node.vy = 0;
  }

  function unpinNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    node.fx = null;
    node.fy = null;
  }

  function tick(dt = 1) {
    if (nodes.size === 0) return;

    alpha += (options.alphaTarget - alpha) * options.alphaDecay;

    applyCenterForce(alpha, dt);
    applyLinkForce(alpha, dt);
    applyChargeForce(alpha, dt);
    applyCollisionForce(dt);

    const velocityScale = Math.max(0, 1 - options.velocityDecay);

    for (const node of nodes.values()) {
      if (node.fx != null && node.fy != null) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      node.vx *= velocityScale;
      node.vy *= velocityScale;
      node.x += node.vx * dt;
      node.y += node.vy * dt;
    }
  }

  function applyCenterForce(currentAlpha, dt) {
    if (!options.centerStrength) return;
    if (nodes.size === 0) return;

    const targetX = Number.isFinite(options.centerX) ? options.centerX : 0;
    const targetY = Number.isFinite(options.centerY) ? options.centerY : 0;

    const strength = options.centerStrength * currentAlpha * dt;
    for (const node of nodes.values()) {
      if (node.fx != null && node.fy != null) continue;
      node.vx += (targetX - node.x) * strength;
      node.vy += (targetY - node.y) * strength;
    }
  }

  function pulseAmbient(phase = 0) {
    const anchorNodeId = options.anchorNodeId || 'streamline';
    let index = 0;

    for (const node of nodes.values()) {
      if (node.id === anchorNodeId) {
        index += 1;
        continue;
      }
      if (node.fx != null && node.fy != null) {
        index += 1;
        continue;
      }

      const k = 0.3 * Math.sin(phase + 0.5 * index);
      node.vx += 0.01 * k;
      node.vy += 0.01 * 0.3 * Math.cos(phase + 0.5 * index);
      index += 1;
    }
  }

  function applyLinkForce(currentAlpha, dt) {
    if (links.length === 0 || options.linkStrength === 0) return;

    const targetDistance = Math.max(1, options.linkDistance);
    const strength = options.linkStrength * currentAlpha * dt;

    for (const link of links) {
      const source = nodes.get(link.source);
      const target = nodes.get(link.target);
      if (!source || !target) continue;

      let dx = target.x - source.x;
      let dy = target.y - source.y;
      let dist = Math.hypot(dx, dy);

      if (!dist) {
        dist = 0.001;
        dx = 0.001;
      }

      const delta = dist - targetDistance;
      const force = (delta / dist) * strength;
      const fx = dx * force;
      const fy = dy * force;

      if (source.fx == null) {
        source.vx += fx;
        source.vy += fy;
      }
      if (target.fx == null) {
        target.vx -= fx;
        target.vy -= fy;
      }
    }
  }

  function applyChargeForce(currentAlpha, dt) {
    const nodeList = Array.from(nodes.values());
    if (nodeList.length < 2 || options.chargeStrength === 0) return;

    const maxDist = Math.max(1, options.maxChargeDistance);
    const minDist = Math.max(1, options.minDistance);
    const k = options.chargeStrength * currentAlpha * dt;

    for (let i = 0; i < nodeList.length; i++) {
      const a = nodeList[i];
      for (let j = i + 1; j < nodeList.length; j++) {
        const b = nodeList[j];

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;

        if (!distSq) {
          dx = (Math.random() - 0.5) * 0.01;
          dy = (Math.random() - 0.5) * 0.01;
          distSq = dx * dx + dy * dy;
        }

        const dist = Math.sqrt(distSq);
        if (dist > maxDist) continue;

        const clamped = Math.max(minDist, dist);
        const force = k / (clamped * clamped);
        const nx = dx / clamped;
        const ny = dy / clamped;

        if (a.fx == null) {
          a.vx -= nx * force;
          a.vy -= ny * force;
        }
        if (b.fx == null) {
          b.vx += nx * force;
          b.vy += ny * force;
        }
      }
    }
  }

  function applyCollisionForce(dt) {
    const nodeList = Array.from(nodes.values());
    if (nodeList.length < 2 || options.collisionRadius <= 0) return;

    const radius = options.collisionRadius;
    const minDistance = radius * 2;

    for (let i = 0; i < nodeList.length; i++) {
      const a = nodeList[i];
      for (let j = i + 1; j < nodeList.length; j++) {
        const b = nodeList[j];

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);

        if (!dist) {
          dist = 0.001;
          dx = 0.001;
        }

        const overlap = minDistance - dist;
        if (overlap <= 0) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const push = overlap * 0.5 * dt;

        if (a.fx == null) {
          a.x -= nx * push;
          a.y -= ny * push;
        }
        if (b.fx == null) {
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  function getState() {
    return {
      alpha,
      running,
      options: { ...options },
      nodes: new Map(nodes),
      links: [...links],
    };
  }

  return {
    setNodes,
    setEdges,
    setOptions,
    reheat,
    setAlphaTarget,
    setAlpha,
    tick,
    start,
    stop,
    pinNode,
    movePinnedNode,
    unpinNode,
    pulseAmbient,
    getState,
  };
}

export { FORCE_DEFAULTS };
