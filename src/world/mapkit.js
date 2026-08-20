// ============ shared map construction kit ============
// Every map is built from axis-aligned boxes so collision, raycasting and the
// nav grid stay exact. Walls record their own openings, which become barricade
// slots and vault points for free.
import * as THREE from 'three';
import { World } from './collision.js';

export const PALETTE = {
  grass: 0x46583f, dirt: 0x6d6152, path: 0x7d7a72, concrete: 0x8d9299,
  brick: 0x8a5b4a, brick2: 0x74473a, stone: 0x8f8d86,
  plaster: 0xcfc6b6, plaster2: 0xb9ae9c, soft: 0xd8cfbe,
  wood: 0x8a6440, wood2: 0x6b4c30, wood3: 0x533d28,
  tile: 0xb9bfc4, carpet: 0x6b5f7a, metal: 0x565f6a, metal2: 0x414954,
  roof: 0x4a3f38, hatch: 0x9a8f7d, fence: 0x50565e, glassy: 0x9fd8ff,
  red: 0x8d3b3b, green: 0x3d6b4a, blue: 0x3b5a8d,
};

export const SOFT = { breakable: true, hp: 110, soft: true };
export const HATCH = { breakable: true, hp: 190, hatch: true };

export class Builder {
  constructor(scene, world, quality) {
    this.scene = scene; this.world = world; this.quality = quality;
    this.groups = new Map();
    this.openings = [];        // every door/window, for barricades + vaulting
  }

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

  wallX(z, x0, x1, y0, y1, mat, o = {}) { this._wall('x', z, x0, x1, y0, y1, mat, o); }
  wallZ(x, z0, z1, y0, y1, mat, o = {}) { this._wall('z', x, z0, z1, y0, y1, mat, o); }

  _wall(axis, at, a0, a1, y0, y1, mat, o) {
    const t = o.thick ?? 0.4;
    const openings = (o.openings || []).slice().sort((p, q) => p[0] - q[0]);
    const emit = (from, to, yy0, yy1) => {
      const c = (from + to) / 2, len = to - from;
      if (axis === 'x') this.box(c, yy0, at, len, yy1 - yy0, t, mat, o);
      else this.box(at, yy0, c, t, yy1 - yy0, len, mat, o);
    };
    // destructible walls are panelled so a breach opens a hole, not a room
    const put = (from, to, yy0, yy1) => {
      if (to - from < 0.02 || yy1 - yy0 < 0.02) return;
      if (!o.breakable) return emit(from, to, yy0, yy1);
      const cols = Math.max(1, Math.round((to - from) / 1.5));
      const rows = Math.max(1, Math.round((yy1 - yy0) / 1.6));
      const cw = (to - from) / cols, rh = (yy1 - yy0) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++)
        emit(from + i * cw, from + (i + 1) * cw, yy0 + j * rh, yy0 + (j + 1) * rh);
    };
    const frame = (from, to, oy0, oy1) => {
      if (o.noFrame) return;
      const th = 0.14, ft = t + 0.1, fmat = 'wood3';
      if (axis === 'x') {
        this.box((from + to) / 2, oy1 - th, at, to - from + 0.26, th, ft, fmat, { solid: false });
        if (oy0 > y0 + 0.05) this.box((from + to) / 2, oy0, at, to - from + 0.26, th, ft, fmat, { solid: false });
        this.box(from, oy0, at, th, oy1 - oy0, ft, fmat, { solid: false });
        this.box(to, oy0, at, th, oy1 - oy0, ft, fmat, { solid: false });
      } else {
        this.box(at, oy1 - th, (from + to) / 2, ft, th, to - from + 0.26, fmat, { solid: false });
        if (oy0 > y0 + 0.05) this.box(at, oy0, (from + to) / 2, ft, th, to - from + 0.26, fmat, { solid: false });
        this.box(at, oy0, from, ft, oy1 - oy0, th, fmat, { solid: false });
        this.box(at, oy0, to, ft, oy1 - oy0, th, fmat, { solid: false });
      }
    };

    let cursor = a0;
    for (const op of openings) {
      const [from, to, oy0 = y0, oy1 = y1] = op;
      put(cursor, Math.max(cursor, from), y0, y1);
      if (oy0 > y0) put(Math.max(cursor, from), to, y0, oy0);
      if (oy1 < y1) put(Math.max(cursor, from), to, oy1, y1);
      frame(from, to, oy0, oy1);
      if (o.noBarricade !== true) {
        const mid = (from + to) / 2;
        this.openings.push({
          axis, x: axis === 'x' ? mid : at, z: axis === 'x' ? at : mid,
          y0: oy0, y1: oy1, width: to - from, thick: t,
          window: oy0 > y0 + 0.3,
        });
      }
      cursor = Math.max(cursor, to);
    }
    put(cursor, a1, y0, y1);
  }

  slab(x0, x1, z0, z1, y, h, mat, o = {}) {
    this.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, h, z1 - z0, mat, o);
  }

  /** solid staircase; dir is the direction of travel while ascending */
  stairs(cx, cz, dir, fromY, toY, width, run, matKey = 'wood2') {
    const rise = toY - fromY;
    const n = Math.max(2, Math.round(rise / 0.36));
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

  /** a room's worth of loose cover */
  clutter(cx, cz, items) {
    for (const [dx, dz, w, h, d, mat] of items) this.box(cx + dx, 0, cz + dz, w, h, d, mat || 'wood2');
  }

  finalize() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    this.meshes = new Map();
    for (const [key, g] of this.groups) {
      const mat = gridify(new THREE.MeshLambertMaterial({ color: 0xffffff }),
        key === 'grass' || key === 'path' || key === 'dirt' ? 2.5 : 1.1, 0.22);
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
    for (const b of this.world.boxes) {
      if (b.gfxKey) { b.inst = this.meshes.get(b.gfxKey); b.instIndex = b.gfxIndex; }
    }
  }
}

/** world-space grid shading so surfaces read at a glance */
function gridify(mat, gridSize = 1.1, strength = 0.22) {
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
          diffuseColor.rgb *= mix(1.0, 0.74, line * uGStr * 3.0);
          diffuseColor.rgb *= mix(0.9, 1.06, an.y);
        }`);
  };
  mat.customProgramCacheKey = () => 'grid' + gridSize + '_' + strength;
  return mat;
}

export function addSky(scene, tint = 'day') {
  const cols = {
    day:   [[0.34, 0.30, 0.27], [0.46, 0.48, 0.52], [0.32, 0.44, 0.60]],
    dusk:  [[0.30, 0.20, 0.18], [0.42, 0.30, 0.30], [0.20, 0.24, 0.40]],
    night: [[0.08, 0.09, 0.12], [0.11, 0.13, 0.18], [0.09, 0.12, 0.20]],
  }[tint] || [[0.34, 0.30, 0.27], [0.46, 0.48, 0.52], [0.32, 0.44, 0.60]];
  const geo = new THREE.SphereGeometry(400, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uLow: { value: new THREE.Vector3(...cols[0]) },
                uMid: { value: new THREE.Vector3(...cols[1]) },
                uHigh: { value: new THREE.Vector3(...cols[2]) } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 uLow; uniform vec3 uMid; uniform vec3 uHigh;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(uLow, uMid, smoothstep(-0.2, 0.15, h));
        c = mix(c, uHigh, smoothstep(0.1, 0.9, h));
        vec3 sd = normalize(vec3(0.45, 0.55, -0.4));
        c += vec3(1.0,0.9,0.75) * pow(max(dot(normalize(vP), sd), 0.0), 120.0) * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(tint === 'night' ? 0x171b22 : 0x5a5f66, 40, 170);
  return sky;
}

export function addLights(scene, quality, tint = 'day') {
  const night = tint === 'night';
  scene.add(new THREE.HemisphereLight(night ? 0x5a6a86 : 0xbcd0e8, 0x4a443c, night ? 0.55 : 0.9));
  scene.add(new THREE.AmbientLight(night ? 0x6a7382 : 0x8b93a0, night ? 0.6 : 0.62));
  const sun = new THREE.DirectionalLight(night ? 0x9fb6e0 : 0xfff2dd, night ? 0.7 : 1.35);
  sun.position.set(44, 70, -38);
  if (quality !== 'low') {
    sun.castShadow = true;
    const s = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(s, s);
    const c = sun.shadow.camera;
    c.left = -46; c.right = 46; c.top = 46; c.bottom = -46; c.near = 8; c.far = 190;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb8ff, night ? 0.4 : 0.62);
  fill.position.set(-40, 30, 36);
  scene.add(fill);
}

/** builds the standard descriptor every map returns */
export function finishMap(B, world, scene, quality, data) {
  B.finalize();
  world.build();
  addSky(scene, data.tint);
  addLights(scene, quality, data.tint);
  return {
    world, jumpPads: [],
    spawns: [...data.atkSpawns, ...data.defSpawns],
    pickups: data.pickups || [], weaponSpawns: data.weaponSpawns || [],
    bounds: data.bounds, objectives: data.objectives, cameras: data.cameras,
    atkSpawns: data.atkSpawns, defSpawns: data.defSpawns,
    openings: B.openings, name: data.name, tint: data.tint,
    droneSpawns: data.droneSpawns || data.atkSpawns,
  };
}

export const newWorld = () => new World();
