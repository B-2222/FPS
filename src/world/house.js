// ============ CHALET — the house ============
// A two-storey house in a walled yard: attackers come in from outside, defenders
// hold the objective inside. Interior partitions are soft (destructible), the
// exterior shell is not, and two ceiling hatches let attackers open the floor above.
import * as THREE from 'three';
import { World } from './collision.js';

export const PALETTE = {
  grass:   0x4a5f43,
  path:    0x7d7a72,
  brick:   0x8a5b4a,
  brick2:  0x7a4f40,
  plaster: 0xcfc6b6,
  plaster2:0xbdb3a2,
  wood:    0x8a6440,
  wood2:   0x6f4f32,
  tile:    0xb9bfc4,
  carpet:  0x6b5f7a,
  roof:    0x4d4038,
  metal:   0x565f6a,
  glassy:  0x9fd8ff,
  fence:   0x50565e,
  soft:    0xd8cfbe,     // destructible drywall
  hatch:   0x9a8f7d,
  concrete:0x8d9299,
};

/* ---------- geometry builder ---------- */
class Builder {
  constructor(scene, world, quality) {
    this.scene = scene; this.world = world; this.quality = quality;
    this.groups = new Map();
  }
  /** cx/cz centre, y bottom, w/h/d size */
  box(cx, y, cz, w, h, d, matKey = 'plaster', opts = {}) {
    const min = { x: cx - w / 2, y, z: cz - d / 2 };
    const max = { x: cx + w / 2, y: y + h, z: cz + d / 2 };
    let box = null;
    if (opts.solid !== false) box = this.world.addBox(min, max, { mat: matKey, ...opts });
    let g = this.groups.get(matKey);
    if (!g) this.groups.set(matKey, g = { color: PALETTE[matKey] ?? 0x888888, list: [] });
    if (box) { box.gfxKey = matKey; box.gfxIndex = g.list.length; }
    g.list.push([cx, y + h / 2, cz, w, h, d]);
    return box;
  }
  /** wall running along X at fixed z; openings are [from,to] ranges in X */
  wallX(z, x0, x1, y0, y1, mat, o = {}) {
    this._wall('x', z, x0, x1, y0, y1, mat, o);
  }
  /** wall running along Z at fixed x */
  wallZ(x, z0, z1, y0, y1, mat, o = {}) {
    this._wall('z', x, z0, z1, y0, y1, mat, o);
  }
  _wall(axis, at, a0, a1, y0, y1, mat, o) {
    const t = o.thick ?? 0.5;
    const openings = (o.openings || []).slice().sort((p, q) => p[0] - q[0]);
    const emit = (from, to, yy0, yy1) => {
      const c = (from + to) / 2, len = to - from;
      if (axis === 'x') this.box(c, yy0, at, len, yy1 - yy0, t, mat, o);
      else this.box(at, yy0, c, t, yy1 - yy0, len, mat, o);
    };
    // destructible walls are built as panels so a breach opens a hole, not the
    // whole room's wall
    const put = (from, to, yy0, yy1) => {
      if (to - from < 0.02 || yy1 - yy0 < 0.02) return;
      if (!o.breakable) return emit(from, to, yy0, yy1);
      const cols = Math.max(1, Math.round((to - from) / 1.7));
      const rows = Math.max(1, Math.round((yy1 - yy0) / 1.9));
      const cw = (to - from) / cols, rh = (yy1 - yy0) / rows;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          emit(from + i * cw, from + (i + 1) * cw, yy0 + j * rh, yy0 + (j + 1) * rh);
        }
      }
    };
    // trim around every opening so windows and doors read as openings
    const frame = (from, to, oy0, oy1) => {
      if (o.noFrame) return;
      const th = 0.16, ft = t + 0.12;
      const fmat = 'plaster2';
      if (axis === 'x') {
        this.box((from + to) / 2, oy1 - th, at, to - from + 0.3, th, ft, fmat, { solid: false });
        if (oy0 > y0 + 0.05) this.box((from + to) / 2, oy0, at, to - from + 0.3, th, ft, fmat, { solid: false });
        this.box(from, oy0, at, th, oy1 - oy0, ft, fmat, { solid: false });
        this.box(to, oy0, at, th, oy1 - oy0, ft, fmat, { solid: false });
      } else {
        this.box(at, oy1 - th, (from + to) / 2, ft, th, to - from + 0.3, fmat, { solid: false });
        if (oy0 > y0 + 0.05) this.box(at, oy0, (from + to) / 2, ft, th, to - from + 0.3, fmat, { solid: false });
        this.box(at, oy0, from, ft, oy1 - oy0, th, fmat, { solid: false });
        this.box(at, oy0, to, ft, oy1 - oy0, th, fmat, { solid: false });
      }
    };
    let cursor = a0;
    for (const op of openings) {
      const [from, to, oy0 = y0, oy1 = y1] = op;
      put(cursor, Math.max(cursor, from), y0, y1);
      if (oy0 > y0) put(Math.max(cursor, from), to, y0, oy0);      // sill under a window
      if (oy1 < y1) put(Math.max(cursor, from), to, oy1, y1);      // header above it
      frame(from, to, oy0, oy1);
      cursor = Math.max(cursor, to);
    }
    put(cursor, a1, y0, y1);
  }
  /** horizontal slab (floor / ceiling) */
  slab(x0, x1, z0, z1, y, h, mat, o = {}) {
    this.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, h, z1 - z0, mat, o);
  }
  stairs(cx, cz, dir, fromY, toY, width, run, matKey = 'wood2') {
    const rise = toY - fromY;
    const n = Math.max(2, Math.round(rise / 0.42));
    const stepRun = run / n, stepRise = rise / n;
    for (let i = 0; i < n; i++) {
      const h = stepRise * (i + 1);
      const off = -run / 2 + stepRun * (i + 0.5);
      const sx = dir === '+x' ? cx + off : dir === '-x' ? cx - off : cx;
      const sz = dir === '+z' ? cz + off : dir === '-z' ? cz - off : cz;
      const w = (dir === '+x' || dir === '-x') ? stepRun : width;
      const d = (dir === '+x' || dir === '-x') ? width : stepRun;
      this.box(sx, fromY, sz, w + 0.02, h, d, matKey);
    }
  }
  finalize() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    this.meshes = new Map();
    for (const [key, g] of this.groups) {
      const mat = gridify(new THREE.MeshLambertMaterial({ color: 0xffffff }), key === 'path' || key === 'grass' ? 3 : 1.2, 0.22);
      const inst = new THREE.InstancedMesh(geo, mat, g.list.length);
      inst.castShadow = this.quality !== 'low';
      inst.receiveShadow = true;
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(g.list.length * 3), 3);
      for (let i = 0; i < g.list.length; i++) {
        const [x, y, z, w, h, d] = g.list[i];
        m4.makeScale(w, h, d); m4.setPosition(x, y, z);
        inst.setMatrixAt(i, m4);
        const t = 0.93 + ((Math.sin(x * 12.9898 + z * 78.233 + y * 37.719) * 43758.5453) % 1 + 1) % 1 * 0.14;
        col.setHex(g.color).multiplyScalar(t);
        inst.setColorAt(i, col);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
      this.meshes.set(key, inst);
    }
    // let the world hide pieces when they get destroyed
    for (const b of this.world.boxes) {
      if (b.gfxKey) { b.inst = this.meshes.get(b.gfxKey); b.instIndex = b.gfxIndex; }
    }
  }
}

/* world-space grid shading, so surfaces read at a glance */
function gridify(mat, gridSize = 1.2, strength = 0.22) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uGrid = { value: gridSize };
    shader.uniforms.uGStr = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; uniform float uGrid; uniform float uGStr;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(normalize(vWNrm));
          vec2 guv = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
          guv /= uGrid;
          vec2 gw = fwidth(guv);
          vec2 gg = abs(fract(guv - 0.5) - 0.5) / max(gw, vec2(1e-5));
          float line = 1.0 - min(min(gg.x, gg.y), 1.0);
          diffuseColor.rgb *= mix(1.0, 0.72, line * uGStr * 3.0);
          diffuseColor.rgb *= mix(0.9, 1.06, an.y);
        }`);
  };
  mat.customProgramCacheKey = () => 'grid' + gridSize + '_' + strength;
  return mat;
}

/* ---------- the map ---------- */
export const YARD = 44;          // half-extent of the walled yard
const G0 = 0, G1 = 4.0;          // ground floor
const F0 = 4.4, F1 = 8.4;        // first floor
const ROOF = 8.4;
const HX = 18, HZ = 13;          // house half-extents

export function buildHouse(scene, quality) {
  const world = new World();
  const B = new Builder(scene, world, quality);

  const atkSpawns = [], defSpawns = [], objectives = [], cameras = [];
  const pickups = [], weaponSpawns = [], spawns = [];

  const SOFT = { breakable: true, hp: 120, soft: true };
  const HATCH = { breakable: true, hp: 200, hatch: true };

  // ---------- ground & yard ----------
  B.slab(-YARD - 4, YARD + 4, -YARD - 4, YARD + 4, -2, 2, 'grass');
  B.slab(-HX - 5, HX + 5, -HZ - 7, HZ + 5, -0.12, 0.12, 'path', { solid: false });
  // yard fence
  B.wallX(-YARD, -YARD, YARD, 0, 3.4, 'fence', { thick: 0.6 });
  B.wallX(YARD, -YARD, YARD, 0, 3.4, 'fence', { thick: 0.6 });
  B.wallZ(-YARD, -YARD, YARD, 0, 3.4, 'fence', { thick: 0.6 });
  B.wallZ(YARD, -YARD, YARD, 0, 3.4, 'fence', { thick: 0.6 });

  // yard cover
  for (const [x, z, w, d, h] of [
    [-30, -22, 5, 2.4, 1.6], [28, -20, 2.4, 6, 1.6], [-26, 24, 6, 2.4, 1.6], [30, 26, 2.4, 5, 1.6],
    [0, -30, 8, 2.4, 1.4], [-34, 4, 2.4, 8, 1.8], [34, -2, 2.4, 7, 1.8], [6, 30, 7, 2.4, 1.4],
  ]) B.box(x, 0, z, w, h, d, 'concrete');
  for (const [x, z] of [[-24, -8], [24, 10], [-12, 26], [14, -26], [-30, 14], [26, -30]])
    B.box(x, 0, z, 2, 2, 2, 'wood2');

  /* ============================================================
     GROUND FLOOR
     x: -18 … 18   z: -13 … 13
     south wall z=-13 (front door), north wall z=13 (back door)
     ============================================================ */
  B.slab(-HX, HX, -HZ, HZ, -0.3, 0.32, 'wood');                    // floorboards

  // exterior shell — windows are [from, to, yFrom, yTo]
  B.wallX(-HZ, -HX, HX, G0, G1, 'brick', { thick: 0.6, openings: [[-2, 2], [-14, -10, 1.1, 2.7], [8, 12, 1.1, 2.7]] });
  B.wallX(HZ, -HX, HX, G0, G1, 'brick', { thick: 0.6, openings: [[-3, 0], [7, 11, 1.1, 2.7]] });
  B.wallZ(-HX, -HZ, HZ, G0, G1, 'brick', { thick: 0.6, openings: [[-11, -4], [4, 8, 1.1, 2.7]] });   // garage door
  B.wallZ(HX, -HZ, HZ, G0, G1, 'brick', { thick: 0.6, openings: [[-9, -5, 1.1, 2.7], [3, 7, 1.1, 2.7]] });

  // interior partitions (soft: shootable through and destructible)
  B.wallZ(-6, -HZ, -3, G0, G1, 'soft', { thick: 0.34, openings: [[-8, -5]], ...SOFT });     // garage | kitchen
  B.wallZ(3, -HZ, -1, G0, G1, 'soft', { thick: 0.34, openings: [[-6, -3]], ...SOFT });      // kitchen | living
  B.wallX(-3, -HX, 3, G0, G1, 'soft', { thick: 0.34, openings: [[-16, -13], [-2, 1]], ...SOFT });  // hall south
  B.wallX(1, -HX, -4, G0, G1, 'soft', { thick: 0.34, openings: [[-15, -12]], ...SOFT });    // hall | dining
  B.wallX(-1, 3, HX, G0, G1, 'soft', { thick: 0.34, openings: [[12, 15]], ...SOFT });       // living | back
  B.wallZ(4, 1, HZ, G0, G1, 'soft', { thick: 0.34, openings: [[3, 6]], ...SOFT });          // stairs | back room
  B.wallZ(-4, 1, HZ, G0, G1, 'soft', { thick: 0.34, openings: [[2, 5]], ...SOFT });         // dining | stairs

  // kitchen counters + garage clutter, cover you can actually use
  B.box(-1.5, 0, -10, 6, 1.0, 1.0, 'tile');
  B.box(-5, 0, -6.5, 1.0, 1.0, 4, 'tile');
  B.box(-12, 0, -9, 4.4, 1.6, 2.2, 'metal');       // workbench
  B.box(-15, 0, -5, 2, 2.2, 2, 'wood2');
  B.box(10, 0, -8, 4, 0.9, 2.2, 'wood2');          // sofa
  B.box(14, 0, -4, 2.2, 1.1, 3.4, 'wood2');
  B.box(-12, 0, 7, 5, 1.0, 2.4, 'wood2');          // dining table
  B.box(11, 0, 8, 2.4, 2.0, 2.4, 'metal');         // shelving

  // ceiling / first floor slab, with two breachable hatches
  B.slab(-HX, -3.2, -HZ, HZ, G1, 0.4, 'plaster2');
  B.slab(3.2, HX, -HZ, HZ, G1, 0.4, 'plaster2');
  B.slab(-3.2, 3.2, -HZ, -6.2, G1, 0.4, 'plaster2');
  B.slab(-3.2, 3.2, 5.4, HZ, G1, 0.4, 'plaster2');      // landing at the top of the stairs
  B.slab(-9, -5, 4, 8, G1, 0.4, 'hatch', HATCH);     // hatch: dining ↔ bathroom
  B.slab(8, 12, -9, -5, G1, 0.4, 'hatch', HATCH);    // hatch: living ↔ office

  // stairwell: ground → first floor
  B.stairs(0, 1.6, '+z', G0, F0, 4.6, 7.6, 'wood2');
  B.wallZ(-2.6, -6.2, 5.4, G0, F1, 'plaster', { thick: 0.3, openings: [[-6, -3, G0, G1]] });
  B.wallZ(2.6, -6.2, 5.4, G0, F1, 'plaster', { thick: 0.3, openings: [[-6, -3, G0, G1]] });
  // landing railings so you can see down the stairwell without falling in
  B.wallZ(-2.6, 5.4, 9.4, F0, F0 + 1.1, 'wood2', { thick: 0.3 });
  B.wallZ(2.6, 5.4, 9.4, F0, F0 + 1.1, 'wood2', { thick: 0.3 });

  /* ============================================================
     FIRST FLOOR
     ============================================================ */
  B.wallX(-HZ, -HX, HX, F0, F1, 'brick', { thick: 0.6, openings: [[-13, -9, 5.5, 7.1], [9, 13, 5.5, 7.1]] });
  B.wallX(HZ, -HX, HX, F0, F1, 'brick', { thick: 0.6, openings: [[-12, -8, 5.5, 7.1], [6, 10, 5.5, 7.1]] });
  B.wallZ(-HX, -HZ, HZ, F0, F1, 'brick', { thick: 0.6, openings: [[-9, -5, 5.5, 7.1], [5, 9, 5.5, 7.1]] });
  B.wallZ(HX, -HZ, HZ, F0, F1, 'brick', { thick: 0.6, openings: [[-4, 0, 5.5, 7.1], [6, 10, 5.5, 7.1]] });

  B.wallX(-2, -HX, -3.2, F0, F1, 'soft', { thick: 0.34, openings: [[-14, -11]], ...SOFT });   // master | bathroom
  B.wallX(2, 3.2, HX, F0, F1, 'soft', { thick: 0.34, openings: [[11, 14]], ...SOFT });        // office | kids
  B.wallZ(-5, -HZ, -2, F0, F1, 'soft', { thick: 0.34, openings: [[-9, -6]], ...SOFT });       // master | landing
  B.wallZ(5, -HZ, 2, F0, F1, 'soft', { thick: 0.34, openings: [[-8, -5]], ...SOFT });         // office | landing
  B.wallZ(-6, 2, HZ, F0, F1, 'soft', { thick: 0.34, openings: [[5, 8]], ...SOFT });
  B.wallZ(6, 2, HZ, F0, F1, 'soft', { thick: 0.34, openings: [[4, 7]], ...SOFT });

  // upstairs furniture
  B.box(-12, F0, -8, 4.4, 1.0, 5, 'carpet');       // bed
  B.box(-16, F0, -3, 1.4, 2.0, 3, 'wood2');
  B.box(12, F0, -9, 4, 1.1, 2, 'wood2');           // desk
  B.box(15, F0, -3, 2.2, 2.2, 2.2, 'metal');
  B.box(-14, F0, 8, 3, 1.0, 3, 'tile');            // bathroom fittings
  B.box(11, F0, 7, 3.6, 1.0, 4.4, 'carpet');       // kids bed

  // roof: stepped gable — keeps axis-aligned collision but reads as pitched
  B.slab(-HX - 0.8, HX + 0.8, -HZ - 0.8, HZ + 0.8, ROOF, 0.45, 'roof');
  B.slab(-HX + 1.4, HX - 1.4, -HZ + 1.4, HZ - 1.4, ROOF + 0.45, 0.55, 'roof');
  B.slab(-HX + 3.4, HX - 3.4, -HZ + 3.4, HZ - 3.4, ROOF + 1.0, 0.6, 'roof');
  B.slab(-HX + 6, HX - 6, -HZ + 6, HZ - 6, ROOF + 1.6, 0.7, 'roof');
  B.box(11, ROOF + 1.0, 6, 1.8, 3.2, 1.8, 'brick2');            // chimney
  B.box(11, ROOF + 4.0, 6, 2.2, 0.3, 2.2, 'roof');

  // porch over the front door
  B.box(0, G1 - 0.5, -HZ - 1.6, 7, 0.35, 3.2, 'wood2', { solid: false });
  B.box(-3.2, 0, -HZ - 2.9, 0.35, G1 - 0.5, 0.35, 'wood2');
  B.box(3.2, 0, -HZ - 2.9, 0.35, G1 - 0.5, 0.35, 'wood2');
  B.box(0, -0.1, -HZ - 1.8, 8, 0.24, 3.6, 'concrete');
  // floor band between storeys
  B.box(0, G1 + 0.35, 0, HX * 2 + 1.2, 0.3, HZ * 2 + 1.2, 'plaster2', { solid: false });

  /* ---------- objectives ---------- */
  objectives.push(
    { id: 'A', name: 'MASTER BEDROOM', x: -11, y: F0 + 0.1, z: -7, r: 5.5, floor: 1 },
    { id: 'B', name: 'KITCHEN', x: -1.5, y: G0 + 0.1, z: -7.5, r: 5.5, floor: 0 },
  );

  /* ---------- cameras (defenders watch, attackers shoot out) ---------- */
  cameras.push(
    { id: 1, name: 'FRONT YARD', x: 0, y: 3.4, z: -14.2, yaw: Math.PI, pitch: -0.12 },
    { id: 2, name: 'GARAGE', x: -17.4, y: 3.2, z: -8, yaw: -Math.PI / 2, pitch: -0.16 },
    { id: 3, name: 'STAIRS', x: 0, y: 3.5, z: 9.4, yaw: 0, pitch: -0.3 },
    { id: 4, name: 'LANDING', x: 0, y: F0 + 3.2, z: 2.4, yaw: Math.PI, pitch: -0.25 },
  );

  /* ---------- spawns ---------- */
  for (const [x, z] of [[-34, -34], [0, -38], [34, -34], [-38, 6], [38, 4], [-30, 32], [4, 38], [32, 30]])
    atkSpawns.push({ x, y: 0.2, z });
  for (const [x, y, z] of [
    [-13, F0, -5], [-8, F0, -10], [-14, F0, -10], [-6, F0, -4],
    [-2, G0, -9], [-4, G0, -5], [1, G0, -11], [-9, G0, -6],
    [6, G0, -6], [-12, G0, 6], [10, G0, 6], [0, F0, 4],
  ]) defSpawns.push({ x, y: y + 0.2, z });
  spawns.push(...atkSpawns, ...defSpawns);

  /* ---------- pickups & floor weapons (non-objective modes) ---------- */
  pickups.push(
    { type: 'health', x: -12, y: G0, z: 8 }, { type: 'health', x: 13, y: F0, z: 8 },
    { type: 'shield', x: -14, y: F0, z: 6 }, { type: 'shield', x: 12, y: G0, z: -10 },
    { type: 'ammo', x: 0, y: G0, z: 11 }, { type: 'ammo', x: 0, y: F0, z: -2 },
    { type: 'ammo', x: -30, y: 0, z: -20 }, { type: 'ammo', x: 30, y: 0, z: 22 },
  );
  weaponSpawns.push(
    { id: 'rifle', x: -28, y: 0, z: 4 }, { id: 'smg', x: 26, y: 0, z: -6 },
    { id: 'shotgun', x: -12, y: G0, z: -10 }, { id: 'sniper', x: 14, y: F0, z: -10 },
    { id: 'pistol', x: 0, y: G0, z: 6 }, { id: 'revolver', x: -14, y: F0, z: -12 },
    { id: 'lmg', x: 12, y: F0, z: 10 }, { id: 'rocket', x: 0, y: 0, z: 34 },
  );

  B.finalize();
  world.build();
  addSky(scene);
  addLights(scene, quality);

  return {
    world, spawns, pickups, weaponSpawns, jumpPads: [],
    bounds: YARD, objectives, cameras, atkSpawns, defSpawns,
    houseBounds: { x0: -HX, x1: HX, z0: -HZ, z1: HZ, floors: [G0, F0], top: ROOF },
  };
}

function addSky(scene) {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 low  = vec3(0.30,0.26,0.24);
        vec3 mid  = vec3(0.42,0.44,0.48);
        vec3 high = vec3(0.30,0.40,0.56);
        vec3 c = mix(low, mid, smoothstep(-0.2, 0.15, h));
        c = mix(c, high, smoothstep(0.1, 0.9, h));
        vec3 sd = normalize(vec3(0.45, 0.55, -0.4));
        float s = max(dot(normalize(vP), sd), 0.0);
        c += vec3(1.0,0.9,0.75) * pow(s, 120.0) * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0x5a5f66, 70, 240);
}

function addLights(scene, quality) {
  scene.add(new THREE.HemisphereLight(0xbcd0e8, 0x50493f, 0.9));
  scene.add(new THREE.AmbientLight(0x8b93a0, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.45);
  sun.position.set(52, 78, -46);
  if (quality !== 'low') {
    sun.castShadow = true;
    const s = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(s, s);
    const c = sun.shadow.camera;
    c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 10; c.far = 220;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.7);
  fill.position.set(-50, 36, 44);
  scene.add(fill);
}
