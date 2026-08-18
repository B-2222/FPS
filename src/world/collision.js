// ============ AABB world: broadphase, raycasting, swept character movement ============
import * as THREE from 'three';

const EPS = 1e-4;
const CELL = 10;               // broadphase cell size (XZ)

export class World {
  constructor() {
    this.boxes = [];           // {min:{x,y,z}, max:{x,y,z}, mat, breakable}
    this.grid = new Map();
    this._stamp = 0;
    this.bounds = { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 };
  }

  addBox(min, max, meta = {}) {
    const b = { min, max, ...meta, id: this.boxes.length };
    this.boxes.push(b);
    return b;
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  build() {
    this.grid.clear();
    for (const b of this.boxes) {
      const x0 = Math.floor(b.min.x / CELL), x1 = Math.floor(b.max.x / CELL);
      const z0 = Math.floor(b.min.z / CELL), z1 = Math.floor(b.max.z / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, arr = []);
        arr.push(b);
      }
    }
  }

  /** all boxes whose cells overlap the given AABB (dedup via visit stamps) */
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.grid.get(this._key(cx, cz));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (b._s === stamp) continue;
        b._s = stamp; out.push(b);
      }
    }
    return out;
  }

  /** does an axis-aligned body volume intersect anything solid? */
  overlaps(minx, miny, minz, maxx, maxy, maxz, scratch = []) {
    const c = this.query(minx, minz, maxx, maxz, scratch);
    for (let i = 0; i < c.length; i++) {
      const b = c[i];
      if (minx < b.max.x && maxx > b.min.x &&
          miny < b.max.y && maxy > b.min.y &&
          minz < b.max.z && maxz > b.min.z) return b;
    }
    return null;
  }

  /**
   * Ray vs world. origin/dir are THREE.Vector3 (dir normalized).
   * Returns {dist, point, normal, box} or null.
   */
  raycast(origin, dir, maxDist = 500, out = _rayOut) {
    const minx = Math.min(origin.x, origin.x + dir.x * maxDist);
    const maxx = Math.max(origin.x, origin.x + dir.x * maxDist);
    const minz = Math.min(origin.z, origin.z + dir.z * maxDist);
    const maxz = Math.max(origin.z, origin.z + dir.z * maxDist);
    const cand = this.query(minx, minz, maxx, maxz, _scratchA);

    let best = maxDist, bb = null, bAxis = 0, bSign = 0;
    const ix = 1 / (dir.x || 1e-12), iy = 1 / (dir.y || 1e-12), iz = 1 / (dir.z || 1e-12);

    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      let t1 = (b.min.x - origin.x) * ix, t2 = (b.max.x - origin.x) * ix;
      let axis = 0, sgn = t1 > t2 ? 1 : -1;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);

      t1 = (b.min.y - origin.y) * iy; t2 = (b.max.y - origin.y) * iy;
      const ymin = Math.min(t1, t2);
      if (ymin > tmin) { tmin = ymin; axis = 1; sgn = t1 > t2 ? 1 : -1; }
      tmax = Math.min(tmax, Math.max(t1, t2));

      t1 = (b.min.z - origin.z) * iz; t2 = (b.max.z - origin.z) * iz;
      const zmin = Math.min(t1, t2);
      if (zmin > tmin) { tmin = zmin; axis = 2; sgn = t1 > t2 ? 1 : -1; }
      tmax = Math.min(tmax, Math.max(t1, t2));

      if (tmax < Math.max(tmin, 0) || tmin > best || tmin < 0) continue;
      best = tmin; bb = b; bAxis = axis; bSign = sgn;
    }
    if (!bb) return null;
    out.dist = best;
    out.point.copy(dir).multiplyScalar(best).add(origin);
    out.normal.set(0, 0, 0);
    out.normal.setComponent(bAxis, bSign);
    out.box = bb;
    return out;
  }

  /** cheap yes/no line-of-sight between two points */
  losClear(a, b) {
    _v1.subVectors(b, a);
    const d = _v1.length();
    if (d < 1e-4) return true;
    _v1.multiplyScalar(1 / d);
    return !this.raycast(a, _v1, d - 0.05, _rayOut2);
  }
}

const _rayOut = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null };
const _rayOut2 = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null };
const _scratchA = [];
const _scratchB = [];
const _v1 = new THREE.Vector3();

/**
 * Move a character volume (vertical cylinder approximated by an AABB) through the world.
 * `pos` is the FEET position and is mutated. Returns collision flags.
 */
export function moveBody(world, pos, vel, dt, opts) {
  const r = opts.radius, h = opts.height, step = opts.stepHeight ?? 0.55;
  const res = { grounded: false, ceiling: false, wallX: false, wallZ: false, groundBox: null };

  // If we start the frame embedded in something (spawned into a step, blasted into a
  // crate, teleported), climb out first — otherwise every axis reads as a collision and
  // the body is frozen in place.
  for (let attempt = 0; attempt < 3; attempt++) {
    const boxes = world.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, _scratchB);
    let top = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (pos.x - r < b.max.x && pos.x + r > b.min.x &&
          pos.y + 0.02 < b.max.y && pos.y + h > b.min.y &&
          pos.z - r < b.max.z && pos.z + r > b.min.z && b.max.y > top) top = b.max.y;
    }
    if (top === -Infinity) break;                       // not embedded in anything
    const lift = top + EPS;
    if (lift - pos.y > 3.0) break;                      // too deep to climb out of — let the axis pushes handle it
    if (world.overlaps(pos.x - r, lift + 0.02, pos.z - r, pos.x + r, lift + h, pos.z + r, _scratchB)) break;
    pos.y = lift;
    if (vel.y < 0) vel.y = 0;
    break;
  }

  // substep so fast movers (rocket jumps, launch pads) never tunnel
  const dist = Math.hypot(vel.x, vel.y, vel.z) * dt;
  const steps = Math.min(8, Math.max(1, Math.ceil(dist / 0.35)));
  const sdt = dt / steps;

  for (let s = 0; s < steps; s++) {
    // ---- Y ----
    const dy = vel.y * sdt;
    pos.y += dy;
    let hitBox = world.overlaps(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + h, pos.z + r, _scratchB);
    if (hitBox) {
      if (dy <= 0) {
        // find the highest surface we could be standing on
        let top = -Infinity;
        const c = world.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, _scratchB);
        for (const b of c) {
          if (pos.x - r < b.max.x && pos.x + r > b.min.x && pos.z - r < b.max.z && pos.z + r > b.min.z &&
              b.max.y <= pos.y - dy + 0.02 && b.max.y > top && b.max.y > pos.y - 0.6) {
            top = b.max.y; res.groundBox = b;
          }
        }
        pos.y = top > -Infinity ? top + EPS : pos.y - dy;
        res.grounded = true;
      } else {
        let bot = Infinity;
        const c = world.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, _scratchB);
        for (const b of c) {
          if (pos.x - r < b.max.x && pos.x + r > b.min.x && pos.z - r < b.max.z && pos.z + r > b.min.z &&
              b.min.y >= pos.y + h - dy - 0.02 && b.min.y < bot) bot = b.min.y;
        }
        pos.y = bot < Infinity ? bot - h - EPS : pos.y - dy;
        res.ceiling = true;
      }
      vel.y = 0;
    }

    // ---- X ----
    const dx = vel.x * sdt;
    if (dx !== 0) {
      pos.x += dx;
      hitBox = world.overlaps(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + h, pos.z + r, _scratchB);
      if (hitBox) {
        const climbed = tryStep(world, pos, r, h, step);
        if (!climbed) {
          pos.x = dx > 0 ? hitBox.min.x - r - EPS : hitBox.max.x + r + EPS;
          // if that still overlaps (corner case) revert entirely
          if (world.overlaps(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + h, pos.z + r, _scratchB)) pos.x -= dx;
          vel.x *= 0.0; res.wallX = true;
        }
      }
    }

    // ---- Z ----
    const dz = vel.z * sdt;
    if (dz !== 0) {
      pos.z += dz;
      hitBox = world.overlaps(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + h, pos.z + r, _scratchB);
      if (hitBox) {
        const climbed = tryStep(world, pos, r, h, step);
        if (!climbed) {
          pos.z = dz > 0 ? hitBox.min.z - r - EPS : hitBox.max.z + r + EPS;
          if (world.overlaps(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + h, pos.z + r, _scratchB)) pos.z -= dz;
          vel.z *= 0.0; res.wallZ = true;
        }
      }
    }
  }

  // ground probe: stay "grounded" over tiny gaps so stairs feel solid
  if (!res.grounded && vel.y <= 0.05) {
    const probe = world.overlaps(pos.x - r, pos.y - 0.12, pos.z - r, pos.x + r, pos.y, pos.z + r, _scratchB);
    if (probe) { pos.y = probe.max.y + EPS; res.grounded = true; res.groundBox = probe; vel.y = 0; }
  }
  return res;
}

/** try to hop up onto a ledge (stairs / crate edges) */
function tryStep(world, pos, r, h, step) {
  for (let up = 0.18; up <= step; up += 0.16) {
    if (!world.overlaps(pos.x - r, pos.y + up, pos.z - r, pos.x + r, pos.y + up + h, pos.z + r, _scratchB)) {
      // make sure there's actually floor right below the new spot
      pos.y += up;
      return true;
    }
  }
  return false;
}

/** is a body-sized volume free at this feet position? */
export function bodyFree(world, x, y, z, r, h) {
  return !world.overlaps(x - r, y + 0.05, z - r, x + r, y + h, z + r, _scratchB);
}

/** drop a point to the floor; returns floor Y or null */
export function floorAt(world, x, z, fromY, r = 0.3) {
  _v1.set(0, -1, 0);
  const hit = world.raycast(new THREE.Vector3(x, fromY, z), _v1, 200, _rayOut2);
  return hit ? hit.point.y : null;
}
