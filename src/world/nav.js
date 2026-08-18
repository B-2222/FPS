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
        // candidate standing heights = tops of boxes under this column
        const cands = [];
        const boxes = world.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, scratch);
        for (const b of boxes) {
          if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
          const y = b.max.y;
          if (y > 12.5) continue;
          if (!cands.some(c => Math.abs(c - y) < 0.35)) cands.push(y);
        }
        if (!cands.length) continue;
        cands.sort((a, b) => a - b);
        const ci = this._ci(ix, iz);
        for (const y of cands) {
          if (!bodyFree(world, x, y + 0.03, z, radius, height)) continue;
          const idx = this.nodes.length;
          this.nodes.push({ x, y: y + 0.03, z, ix, iz, ci, links: [], cover: 0, i: idx });
          let arr = this.cells.get(ci);
          if (!arr) this.cells.set(ci, arr = []);
          arr.push(idx);
        }
      }
    }

    // ---- link neighbours ----
    for (const n of this.nodes) {
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
          if (dy > this.step + 0.02) continue;      // too high to step up
          if (dy < -4.2) continue;                  // too far to drop safely
          // diagonals must not cut corners
          if (d >= 4) {
            const oA = this.cells.get(this._ci(n.ix + dx, n.iz));
            const oB = this.cells.get(this._ci(n.ix, n.iz + dz));
            if (!oA || !oB) continue;
            if (!oA.some(k => Math.abs(this.nodes[k].y - n.y) <= this.step) ||
                !oB.some(k => Math.abs(this.nodes[k].y - n.y) <= this.step)) continue;
          }
          // body must fit through the gap between the two cells
          const my = Math.max(n.y, m.y);
          if (!bodyFree(this.world, (n.x + m.x) / 2, my, (n.z + m.z) / 2, this.radius, this.height)) continue;
          const flat = Math.hypot(m.x - n.x, m.z - n.z);
          const cost = flat + (dy > 0.1 ? dy * 2.2 : dy < -0.5 ? -dy * 0.8 : 0);
          n.links.push({ n: j, cost });
          linked = true;
        }
        if (!linked && d < 4) n.cover |= (1 << d);
      }
    }
    // strip unreachable pockets (nodes with no links at all)
    this.nodes.forEach(n => { n.open = n.links.length > 0; });
    return this;
  }

  nearest(pos, maxCells = 3) {
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
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  /** A* — returns array of THREE.Vector3 waypoints (excluding start), or null */
  findPath(from, to, maxExpand = 2600) {
    const s = this.nearest(from), g = this.nearest(to);
    if (s < 0 || g < 0) return null;
    if (s === g) return [new THREE.Vector3(to.x, to.y, to.z)];
    const nodes = this.nodes;
    const gScore = this._g || (this._g = new Float32Array(nodes.length));
    const came = this._c || (this._c = new Int32Array(nodes.length));
    const seen = this._s || (this._s = new Int32Array(nodes.length));
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
      if (++expand > maxExpand) break;
      const cn = nodes[cur];
      for (const l of cn.links) {
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
