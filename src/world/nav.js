// ============ navigation: multi-level walk grid + A* ============
import * as THREE from 'three';
import { bodyFree } from './collision.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  clear() { this.a.length = 0; }
  push(node, f) {
    const a = this.a; a.push({ node, f });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break;[a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;[a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top.node;
  }
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class NavGrid {
  constructor(world, opts = {}) {
    this.world = world;
    this.cell = opts.cell ?? 2.4;
    this.half = opts.half ?? 58;
    this.radius = opts.radius ?? 0.46;
    this.height = opts.height ?? 1.85;
    this.step = opts.step ?? 0.55;
    this.dim = Math.floor((this.half * 2) / this.cell);
    this.nodes = [];          // {x,y,z,ci,links:[{n,cost}],cover:int}
    this.cells = new Map();   // cellIndex -> [nodeIdx]
    this.heap = new MinHeap();
    this.budget = 0;
  }

  _ci(ix, iz) { return iz * this.dim + ix; }
  _ix(x) { return Math.floor((x + this.half) / this.cell); }

  build() {
    const { world, cell, half, radius, height } = this;
    const scratch = [];
    for (let iz = 0; iz < this.dim; iz++) {
      for (let ix = 0; ix < this.dim; ix++) {
        const x = -half + (ix + 0.5) * cell;
        const z = -half + (iz + 0.5) * cell;
        // Candidate standing heights = tops of boxes under this column. Surfaces
        // within a step of each other are one surface — and it has to be the
        // HIGHEST of them, or a rug over a floor hides the floor from the grid.
        const tops = [];
        const boxes = world.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, scratch);
        for (const b of boxes) {
          if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
          if (b.max.y > 12.5) continue;
          tops.push(b.max.y);
        }
        if (!tops.length) continue;
        tops.sort((a, b) => a - b);
        const cands = [];
        for (const y of tops) {
          if (cands.length && y - cands[cands.length - 1] < 0.35) cands[cands.length - 1] = y;
          else cands.push(y);
        }
        const ci = this._ci(ix, iz);
        for (const y of cands) {
          // Clearance is measured from step height upward: anything lower than a
          // step is something a walker climbs, not something that blocks them.
          // Without this every staircase tread would veto its own node.
          if (!bodyFree(world, x, y + this.step, z, radius, height - this.step) &&
              !this.softFree(x, y + this.step, z, radius, height - this.step)) continue;
          const idx = this.nodes.length;
          this.nodes.push({ x, y: y + 0.03, z, ix, iz, ci, links: [], cover: 0, i: idx });
          let arr = this.cells.get(ci);
          if (!arr) this.cells.set(ci, arr = []);
          arr.push(idx);
        }
      }
    }

    // ---- link neighbours ----
    for (const n of this.nodes) this.linkNode(n);
    this.prune();
    return this;
  }

  /**
   * Links are directed: you can drop off a bed or a balcony but not climb back up.
   * A goal on such a node is unreachable no matter how good the search is, so keep
   * only the nodes that can be walked to AND walked back from — the largest
   * strongly-connected component. Furniture tops, roof ledges and sealed pockets
   * fall out of the grid instead of quietly swallowing paths.
   */
  prune() {
    const N = this.nodes, n = N.length;
    this.dirty = false;
    if (!n) return 0;
    const rev = this._rev && this._rev.length === n ? this._rev : (this._rev = Array.from({ length: n }, () => []));
    for (let i = 0; i < n; i++) rev[i].length = 0;
    for (let i = 0; i < n; i++) for (const l of N[i].links) rev[l.n].push(i);

    // Kosaraju, iterative — the grid is big enough that recursion would blow the stack
    const seen = new Uint8Array(n), order = new Int32Array(n);
    let oi = 0;
    const stack = [], it = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      seen[s] = 1; stack.push(s); it.push(0);
      while (stack.length) {
        const u = stack[stack.length - 1], links = N[u].links;
        let k = it[it.length - 1];
        let pushed = false;
        while (k < links.length) {
          const v = links[k++].n;
          if (!seen[v]) { seen[v] = 1; it[it.length - 1] = k; stack.push(v); it.push(0); pushed = true; break; }
        }
        if (pushed) continue;
        it[it.length - 1] = k;
        order[oi++] = u; stack.pop(); it.pop();
      }
    }

    const comp = this._comp && this._comp.length === n ? this._comp : (this._comp = new Int32Array(n));
    comp.fill(-1);
    let cid = 0, best = -1, bestSize = 0;
    for (let k = oi - 1; k >= 0; k--) {
      const s = order[k];
      if (comp[s] >= 0) continue;
      comp[s] = cid; stack.length = 0; stack.push(s);
      let size = 0;
      while (stack.length) {
        const u = stack.pop(); size++;
        for (const v of rev[u]) if (comp[v] < 0) { comp[v] = cid; stack.push(v); }
      }
      if (size > bestSize) { bestSize = size; best = cid; }
      cid++;
    }
    for (let i = 0; i < n; i++) N[i].open = comp[i] === best && N[i].links.length > 0;
    this.mainComp = best;
    return bestSize;
  }

  /**
   * Free once you take away everything a breach charge could remove.
   * Nodes are only ever created in build(), so a column sealed by drywall needs
   * one now — otherwise blowing that wall open produces a hole the AI can see
   * through and never walk through. The node starts with no links; the relink
   * after the wall comes down is what puts it in play.
   */
  softFree(x, y, z, r, h) {
    const boxes = this.world.query(x - r, z - r, x + r, z + r, this._sc || (this._sc = []));
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.dead || b.breakable) continue;
      if (x - r < b.max.x && x + r > b.min.x &&
          y + 0.05 < b.max.y && y + h > b.min.y &&
          z - r < b.max.z && z + r > b.min.z) return false;
    }
    return true;
  }

  /** (re)compute one node's links — also used when destruction opens a route */
  linkNode(n) {
    {
      n.links.length = 0; n.cover = 0;
      for (let d = 0; d < NB.length; d++) {
        const [dx, dz] = NB[d];
        const nx = n.ix + dx, nz = n.iz + dz;
        if (nx < 0 || nz < 0 || nx >= this.dim || nz >= this.dim) continue;
        const arr = this.cells.get(this._ci(nx, nz));
        if (!arr) { if (d < 4) n.cover |= (1 << d); continue; }
        let linked = false;
        for (const j of arr) {
          const m = this.nodes[j];
          const dy = m.y - n.y;
          // A staircase climbs faster than one grid cell allows, but a walker
          // still gets up it one small step at a time — so probe the ground
          // between the two nodes before rejecting the link.
          if (dy > this.step + 0.02) {
            if (dy > 2.2 || !this.rampBetween(n, m)) continue;
          }
          if (dy < -4.2) continue;                  // too far to drop safely
          // diagonals must not cut corners
          if (d >= 4) {
            const oA = this.cells.get(this._ci(n.ix + dx, n.iz));
            const oB = this.cells.get(this._ci(n.ix, n.iz + dz));
            if (!oA || !oB) continue;
            if (!oA.some(k => Math.abs(this.nodes[k].y - n.y) <= this.step) ||
                !oB.some(k => Math.abs(this.nodes[k].y - n.y) <= this.step)) continue;
          }
          // The body has to fit along the whole segment, not just at its midpoint:
          // a 0.3 m partition can hide between two samples and produce a link that
          // walks straight through a wall.
          if (!this.segmentFree(n, m)) continue;
          const flat = Math.hypot(m.x - n.x, m.z - n.z);
          const cost = flat + (dy > 0.1 ? dy * 2.2 : dy < -0.5 ? -dy * 0.8 : 0);
          n.links.push({ n: j, cost });
          linked = true;
        }
        if (!linked && d < 4) n.cover |= (1 << d);
      }
    }
    n.open = n.links.length > 0;
  }

  /**
   * A destroyed wall doesn't create new standing room, it just unblocks routes
   * between floor nodes that already exist — so relinking the neighbourhood is
   * enough, and costs a fraction of a full rebuild.
   */
  relinkNear(min, max, pad = 2) {
    const x0 = this._ix(min.x) - pad, x1 = this._ix(max.x) + pad;
    const z0 = this._ix(min.z) - pad, z1 = this._ix(max.z) + pad;
    const touched = [];
    for (let iz = Math.max(0, z0); iz <= Math.min(this.dim - 1, z1); iz++) {
      for (let ix = Math.max(0, x0); ix <= Math.min(this.dim - 1, x1); ix++) {
        const arr = this.cells.get(this._ci(ix, iz));
        if (arr) for (const j of arr) touched.push(this.nodes[j]);
      }
    }
    for (const n of touched) this.linkNode(n);
    // a breach can join two pockets — recompute reachability, but lazily: a
    // shotgun takes out several panels in one frame and one pass covers them all
    this.dirty = true;
    return touched.length;
  }

  /** can the body traverse the gap between two adjacent nodes? */
  segmentFree(n, m) {
    const dx = m.x - n.x, dz = m.z - n.z, dy = m.y - n.y;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(dist / 0.25));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // clearance follows the local floor: measuring from the higher end makes a
      // ceiling above the bottom of a staircase veto the whole flight
      const y = n.y + dy * t;
      if (!bodyFree(this.world, n.x + dx * t, y + this.step, n.z + dz * t,
                    this.radius, this.height - this.step)) return false;
    }
    return true;
  }

  /** is the ground between two nodes a climbable ramp (stairs) rather than a ledge? */
  rampBetween(a, b) {
    const steps = 6;
    let prev = a.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      _from.set(x, Math.max(a.y, b.y) + 1.2, z);
      _down.set(0, -1, 0);
      const hit = this.world.raycast(_from, _down, 4.0);
      if (!hit) return false;
      const y = hit.point.y;
      if (y - prev > this.step + 0.06) return false;       // a real step up, not a stair
      if (prev - y > 1.2) return false;                    // a hole in the middle
      // Probe from step height up, same as everywhere else: the next tread of a
      // staircase is something you climb, not something that blocks you.
      if (!bodyFree(this.world, x, y + this.step, z, 0.16, this.height - this.step)) return false;
      prev = y;
    }
    return Math.abs(prev - b.y) < 0.6;
  }

  nearest(pos, maxCells = 3) {
    if (this.dirty) this.prune();
    const cix = this._ix(pos.x), ciz = this._ix(pos.z);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxCells; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cix + dx, iz = ciz + dz;
        if (ix < 0 || iz < 0 || ix >= this.dim || iz >= this.dim) continue;
        const arr = this.cells.get(this._ci(ix, iz));
        if (!arr) continue;
        for (const j of arr) {
          const n = this.nodes[j];
          if (!n.open) continue;
          const dy = Math.abs(n.y - pos.y);
          const d = (n.x - pos.x) ** 2 + (n.z - pos.z) ** 2 + dy * dy * 6;
          if (d < bestD) { bestD = d; best = j; }
        }
      }
      // Stopping at the first ring that produced a hit picks the floor below a bed
      // over the floor beside it: a node one ring further out can still be nearer.
      if (best >= 0 && (r * this.cell) ** 2 >= bestD) break;
    }
    return best;
  }

  /** A* — returns array of THREE.Vector3 waypoints (excluding start), or null */
  findPath(from, to, maxExpand = 20000) {
    const s = this.nearest(from), g = this.nearest(to);
    if (s < 0 || g < 0) return null;
    if (s === g) return [new THREE.Vector3(to.x, to.y, to.z)];
    const nodes = this.nodes;
    const gScore = this._g || (this._g = new Float32Array(nodes.length));
    const came = this._c || (this._c = new Int32Array(nodes.length));
    const seen = this._s || (this._s = new Int32Array(nodes.length));
    const closed = this._cl || (this._cl = new Int32Array(nodes.length));
    const token = (this._t = (this._t || 0) + 1);

    const heap = this.heap; heap.clear();
    const gx = nodes[g];
    const h = n => Math.hypot(n.x - gx.x, n.z - gx.z) + Math.abs(n.y - gx.y) * 1.6;
    gScore[s] = 0; came[s] = -1; seen[s] = token;
    heap.push(s, h(nodes[s]));
    let expand = 0;

    while (heap.size) {
      const cur = heap.pop();
      if (cur === g) return this._reconstruct(came, g, to);
      // The heap holds one entry per relaxation, so the same node comes back out
      // several times. Without a closed set those stale pops burn the expansion
      // budget and a long route across a big map fails for no reason.
      if (closed[cur] === token) continue;
      closed[cur] = token;
      if (++expand > maxExpand) break;
      const cn = nodes[cur];
      for (const l of cn.links) {
        if (!nodes[l.n].open) continue;             // never route through a dead pocket
        const ng = gScore[cur] + l.cost;
        if (seen[l.n] === token && ng >= gScore[l.n]) continue;
        seen[l.n] = token; gScore[l.n] = ng; came[l.n] = cur;
        heap.push(l.n, ng + h(nodes[l.n]) * 1.08);
      }
    }
    return null;
  }

  _reconstruct(came, g, to) {
    const out = [];
    let c = g, guard = 0;
    while (c >= 0 && guard++ < 4000) { const n = this.nodes[c]; out.push(new THREE.Vector3(n.x, n.y, n.z)); c = came[c]; }
    out.reverse();
    out.shift();                                   // drop the node we're standing on
    if (to) out.push(new THREE.Vector3(to.x, to.y, to.z));
    return out;
  }

  /** can a body walk in a straight line between two points? (path smoothing) */
  canWalkStraight(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return true;
    const steps = Math.ceil(dist / 0.7);
    let prevY = a.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t, z = a.z + dz * t, y = a.y + dy * t;
      if (!bodyFree(this.world, x, y + 0.05, z, this.radius + 0.06, this.height)) return false;
      if (Math.abs(y - prevY) > this.step) return false;
      prevY = y;
    }
    return true;
  }

  randomNode(rng = Math.random) {
    for (let i = 0; i < 40; i++) {
      const n = this.nodes[Math.floor(rng() * this.nodes.length)];
      if (n && n.open) return n;
    }
    return this.nodes[0];
  }

  /** a walkable spot near `pos` that breaks line of sight to `threat` */
  findCover(pos, threat, maxDist = 26) {
    let best = null, bestScore = -Infinity;
    const start = this.nearest(pos);
    if (start < 0) return null;
    for (let i = 0; i < 90; i++) {
      const n = this.nodes[(start + i * 137) % this.nodes.length];
      if (!n || !n.open) continue;
      const d = Math.hypot(n.x - pos.x, n.z - pos.z);
      if (d > maxDist || d < 3) continue;
      const eye = _v.set(n.x, n.y + 1.5, n.z);
      const hidden = !this.world.losClear(eye, threat);
      if (!hidden) continue;
      const score = -d + (n.cover ? 6 : 0);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }
}
const _v = new THREE.Vector3();
const _from = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
