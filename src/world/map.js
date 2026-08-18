// ============ FOUNDRY — the arena ============
import * as THREE from 'three';
import { World } from './collision.js';

/* ---------- materials: flat colours + world-space grid lines ---------- */
function gridify(mat, gridSize = 2.0, strength = 0.30) {
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
          diffuseColor.rgb *= mix(1.0, 0.62, line * uGStr * 3.0);
          // subtle top-face lift so floors read brighter than walls
          diffuseColor.rgb *= mix(0.92, 1.05, an.y);
        }`);
  };
  mat.customProgramCacheKey = () => 'grid' + gridSize + '_' + strength;
  return mat;
}

export const PALETTE = {
  floor:  0x6f7a86,
  floor2: 0x5d6774,
  wall:   0x8b95a1,
  wall2:  0x79838f,
  accent: 0x00c88a,
  accentB:0xff3b5c,
  metal:  0x4e5866,
  crate:  0xb98a4e,
  crate2: 0x8f6b3d,
  trim:   0x2f3742,
  pad:    0x00ffa8,
  glassy: 0x9fd8ff,
};

/* ---------- builder ---------- */
class Builder {
  constructor(scene, world, quality) {
    this.scene = scene; this.world = world; this.quality = quality;
    this.groups = new Map();   // matKey -> {color, list:[matrix data]}
  }
  /** cx/cz = centre, y = BOTTOM, w/h/d = size */
  box(cx, y, cz, w, h, d, matKey = 'wall', opts = {}) {
    const min = { x: cx - w / 2, y, z: cz - d / 2 };
    const max = { x: cx + w / 2, y: y + h, z: cz + d / 2 };
    if (opts.solid !== false) this.world.addBox(min, max, { mat: matKey, ...opts });
    let g = this.groups.get(matKey);
    if (!g) this.groups.set(matKey, g = { color: PALETTE[matKey] ?? 0x888888, list: [] });
    g.list.push([cx, y + h / 2, cz, w, h, d]);
    return { min, max };
  }
  /** solid staircase; dir: '+x','-x','+z','-z' = direction of travel while ascending */
  stairs(cx, cz, dir, fromY, toY, width, run, matKey = 'metal') {
    const rise = toY - fromY;
    const n = Math.max(2, Math.round(rise / 0.44));
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
    for (const [key, g] of this.groups) {
      // base white: the real colour rides on instanceColor (which MULTIPLIES the material colour)
      const mat = gridify(new THREE.MeshLambertMaterial({ color: 0xffffff }), key === 'crate' ? 1.0 : 2.0, 0.26);
      const inst = new THREE.InstancedMesh(geo, mat, g.list.length);
      inst.castShadow = this.quality !== 'low';
      inst.receiveShadow = true;
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(g.list.length * 3), 3);
      for (let i = 0; i < g.list.length; i++) {
        const [x, y, z, w, h, d] = g.list[i];
        m4.makeScale(w, h, d); m4.setPosition(x, y, z);
        inst.setMatrixAt(i, m4);
        // a little per-block value noise keeps large surfaces from looking dead
        const t = 0.94 + ((Math.sin(x * 12.9898 + z * 78.233 + y * 37.719) * 43758.5453) % 1 + 1) % 1 * 0.12;
        col.setHex(g.color).multiplyScalar(t);
        inst.setColorAt(i, col);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
    }
  }
}

/** apply 4-fold rotational symmetry */
function sym4(fn) {
  for (let k = 0; k < 4; k++) {
    const rot = (x, z) => k === 0 ? [x, z] : k === 1 ? [-z, x] : k === 2 ? [-x, -z] : [z, -x];
    const swap = k % 2 === 1;
    fn((x, z, w, d) => {
      const [rx, rz] = rot(x, z);
      return [rx, rz, swap ? d : w, swap ? w : d];
    }, k, rot);
  }
}

const DIR_ROT = { '+x': ['+x', '+z', '-x', '-z'], '-x': ['-x', '-z', '+x', '+z'], '+z': ['+z', '-x', '-z', '+x'], '-z': ['-z', '+x', '+z', '-x'] };

export const ARENA = { half: 58, wallH: 20 };

export function buildMap(scene, quality) {
  const world = new World();
  const B = new Builder(scene, world, quality);
  const H = ARENA.half;

  const spawns = [];        // {x,y,z}
  const pickups = [];       // {type,x,y,z}
  const weaponSpawns = [];  // {id,x,y,z}
  const jumpPads = [];      // {x,y,z,r,power}

  // ---------- ground & perimeter ----------
  B.box(0, -2, 0, H * 2 + 8, 2, H * 2 + 8, 'floor');
  B.box(0, -1.9, 0, 60, 0.02, 60, 'floor2', { solid: false });   // mid-field decal ring (visual)
  sym4(t => {
    let [x, z, w, d] = t(0, -H - 1.5, H * 2 + 8, 3);
    B.box(x, 0, z, w, ARENA.wallH, d, 'wall2');
    // wall trim
    [x, z, w, d] = t(0, -H, H * 2 + 8, 0.6);
    B.box(x, 0, z, w, 0.35, d, 'accent', { solid: false });
  });

  // ---------- THE CORE (centre building) ----------
  // outer walls with a doorway on each side  → ground-level room with 4 entries
  sym4(t => {
    // two wall segments per side leaving a 8-wide door
    for (const s of [-1, 1]) {
      const [x, z, w, d] = t(s * 9.5, -13, 9, 3);
      B.box(x, 0, z, w, 5.0, d, 'wall');
    }
    // door lintel
    const [lx, lz, lw, ld] = t(0, -13, 10, 3);
    B.box(lx, 4.0, lz, lw, 1.0, ld, 'trim');
  });
  B.box(0, 5.0, 0, 29, 0.9, 29, 'metal');            // core roof, top = 5.9
  // interior pillars + crates
  B.box(0, 0, 0, 3, 5, 3, 'metal');
  sym4(t => { const [x, z, w, d] = t(7.5, 7.5, 2, 2); B.box(x, 0, z, w, 2, d, 'crate'); });
  // second tier on the roof
  B.box(0, 5.9, 0, 15, 2.0, 15, 'wall');             // top = 7.9
  B.box(0, 7.9, 0, 6.5, 2.8, 6.5, 'metal');          // sniper tower, top = 10.7
  sym4(t => {
    // roof cover walls
    const [x, z, w, d] = t(11, 0, 1.2, 12);
    B.box(x, 5.9, z, w, 1.3, d, 'trim');
  });
  // stairs: ground → core roof (4 diagonals), roof → tier → tower
  sym4((t, k) => {
    // ground → roof: runs from x=26.5 in to the roof lip at x=14.5
    const [x, z] = t(20.5, 7);
    B.stairs(x, z, DIR_ROT['-x'][k], 0, 5.9, 5, 12, 'metal');
    // roof → second tier
    const [x2, z2] = t(9.5, 0);
    B.stairs(x2, z2, DIR_ROT['-x'][k], 5.9, 7.9, 3.4, 4.6, 'metal');
  });
  B.stairs(0, 5.2, '-z', 7.9, 10.7, 2.6, 4.2, 'metal');   // tier → sniper tower
  weaponSpawns.push({ id: 'sniper', x: 0, y: 10.7, z: 0 });
  pickups.push({ type: 'shield', x: 0, y: 0, z: 6.5 });   // inside the core room, off the pillar

  // ---------- CORNER BUNKERS ----------
  sym4((t, k, rot) => {
    const [bx, bz] = rot(38, 38);
    // three walls + roof, opening faces the centre
    const wall = (ox, oz, w, d, h = 5) => { const [x, z, ww, dd] = t(38 + ox, 38 + oz, w, d); B.box(x, 0, z, ww, h, dd, 'wall'); };
    wall(0, 9, 20, 2);        // outer (far) wall
    wall(9, 0, 2, 20);
    wall(-9, -3.5, 2, 13);    // partial near wall → doorway
    wall(-3.5, -9, 13, 2);
    const [rx, rz, rw, rd] = t(38, 38, 21, 21);
    B.box(rx, 5, rz, rw, 1.0, rd, 'metal');            // roof top = 6
    // roof lip
    const [cx1, cz1, cw1, cd1] = t(38, 46.5, 20, 1.2);
    B.box(cx1, 6, cz1, cw1, 1.2, cd1, 'trim');
    // interior cover + goodies
    const [ix, iz, iw, id] = t(41, 41, 2.4, 2.4);
    B.box(ix, 0, iz, iw, 2.2, id, 'crate');
    pickups.push({ type: k % 2 === 0 ? 'health' : 'shield', x: bx * 0.86, y: 0, z: bz * 0.86 });
    weaponSpawns.push({ id: ['shotgun', 'lmg', 'revolver', 'smg'][k], x: bx * 0.93, y: 0, z: bz * 0.93 });
    // staircase up the inner face, topping out flush with the roof edge (x = 27.5)
    const [sx, sz] = t(21, 33);
    B.stairs(sx, sz, DIR_ROT['+x'][k], 0, 6, 4.5, 13, 'metal');
    spawns.push({ x: bx * 0.8, y: 0.2, z: bz * 0.8 }, { x: bx, y: 6.2, z: bz });
  });

  // ---------- CATWALKS (bunker roof ↔ bunker roof, along each edge) ----------
  sym4((t, k) => {
    const [x, z, w, d] = t(0, 46, 56, 6);
    B.box(x, 5.2, z, w, 0.8, d, 'metal');              // top = 6
    const [rx, rz, rw, rd] = t(0, 43, 56, 0.7);
    B.box(rx, 6, rz, rw, 1.3, rd, 'trim');             // inner railing
    // mid-edge staircase from the floor up to the catwalk lip (z = 43)
    const [sx, sz] = t(0, 36);
    B.stairs(sx, sz, DIR_ROT['+z'][k], 0, 6, 6, 14, 'metal');
    pickups.push({ type: 'ammo', x: t(0, 46)[0], y: 6, z: t(0, 46)[1] });
    spawns.push({ x: t(0, 50)[0], y: 6.2, z: t(0, 50)[1] });
  });

  // ---------- MID-FIELD COVER ----------
  const cover = [
    // [x, z, w, h, d, mat]
    [26, 0, 3, 2.2, 3, 'crate'], [26, 4.2, 3, 2.2, 3, 'crate'], [28.5, 2, 2, 4.4, 2, 'crate2'],
    [-26, 0, 3, 2.2, 3, 'crate'], [-26, -4.2, 3, 2.2, 3, 'crate'], [-28.5, -2, 2, 4.4, 2, 'crate2'],
    [0, 26, 3, 2.2, 3, 'crate'], [4.2, 26, 3, 2.2, 3, 'crate'], [2, 28.5, 2, 4.4, 2, 'crate2'],
    [0, -26, 3, 2.2, 3, 'crate'], [-4.2, -26, 3, 2.2, 3, 'crate'], [-2, -28.5, 2, 4.4, 2, 'crate2'],
    [20, 20, 8, 1.4, 2, 'trim'], [-20, -20, 8, 1.4, 2, 'trim'],
    [20, -20, 2, 1.4, 8, 'trim'], [-20, 20, 2, 1.4, 8, 'trim'],
    [46, 20, 2.5, 5.5, 2.5, 'metal'], [-46, -20, 2.5, 5.5, 2.5, 'metal'],
    [20, -46, 2.5, 5.5, 2.5, 'metal'], [-20, 46, 2.5, 5.5, 2.5, 'metal'],
    [34, 12, 6, 1.3, 2, 'trim'], [-34, -12, 6, 1.3, 2, 'trim'],
    [12, -34, 2, 1.3, 6, 'trim'], [-12, 34, 2, 1.3, 6, 'trim'],
    [40, -8, 3, 3, 3, 'crate'], [-40, 8, 3, 3, 3, 'crate'],
    [8, 40, 3, 3, 3, 'crate'], [-8, -40, 3, 3, 3, 'crate'],
  ];
  for (const [x, z, w, h, d, m] of cover) B.box(x, 0, z, w, h, d, m);

  // ---------- JUMP PADS ----------
  for (const [x, z] of [[24, -24], [-24, 24]]) {
    B.box(x, 0, z, 4, 0.25, 4, 'pad');
    jumpPads.push({ x, y: 0.25, z, r: 2.4, power: 20.5 });
  }

  // ---------- pickup + weapon scatter on the floor ----------
  pickups.push(
    { type: 'health', x: 24, z: -24, y: 0.3 }, { type: 'health', x: -24, z: 24, y: 0.3 },
    { type: 'ammo', x: 18, z: 0, y: 0 }, { type: 'ammo', x: -18, z: 0, y: 0 },
    { type: 'ammo', x: 0, z: 18, y: 0 }, { type: 'ammo', x: 0, z: -18, y: 0 },
    { type: 'health', x: 0, z: 0, y: 6.9, onCore: true },
  );
  weaponSpawns.push(
    { id: 'rifle', x: 20, y: 0, z: 20 }, { id: 'rifle', x: -20, y: 0, z: -20 },
    { id: 'smg', x: -20, y: 0, z: 20 }, { id: 'shotgun', x: 20, y: 0, z: -20 },
    { id: 'rocket', x: 0, y: 5.9, z: 12 }, { id: 'lmg', x: 0, y: 5.9, z: -12 },
    { id: 'revolver', x: 12, y: 5.9, z: 0 }, { id: 'sniper', x: -12, y: 5.9, z: 0 },
    { id: 'pistol', x: 46, y: 6.2, z: 0 }, { id: 'pistol', x: -46, y: 6.2, z: 0 },
  );

  // ---------- extra spawn points ----------
  for (const [x, z] of [[9, 34], [-9, -34], [34, 9], [-34, -9], [16, 16], [-16, -16], [16, -16], [-16, 16],
                        [50, 50], [-50, -50], [50, -50], [-50, 50], [0, 50], [0, -50], [50, 0], [-50, 0]]) {
    spawns.push({ x, y: 0.2, z });
  }

  B.finalize();
  world.build();

  addSky(scene, quality);
  addLights(scene, quality);

  return { world, spawns, pickups, weaponSpawns, jumpPads, bounds: H };
}

/* ---------- sky + lights ---------- */
function addSky(scene, quality) {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 low  = vec3(0.055,0.075,0.105);
        vec3 mid  = vec3(0.10,0.16,0.24);
        vec3 high = vec3(0.16,0.30,0.46);
        vec3 c = mix(low, mid, smoothstep(-0.25, 0.12, h));
        c = mix(c, high, smoothstep(0.08, 0.85, h));
        // sun glow
        vec3 sd = normalize(vec3(0.5, 0.6, 0.35));
        float s = max(dot(normalize(vP), sd), 0.0);
        c += vec3(1.0,0.85,0.6) * pow(s, 26.0) * 0.9;
        c += vec3(0.9,0.7,0.5) * pow(s, 5.0) * 0.10;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0x18222f, 90, 260);
}

function addLights(scene, quality) {
  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x3a3f48, 0.85));
  scene.add(new THREE.AmbientLight(0x6b7d96, 0.55));   // keeps roofed interiors readable
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.55);
  sun.position.set(70, 96, 50);
  if (quality !== 'low') {
    sun.castShadow = true;
    const s = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(s, s);
    const c = sun.shadow.camera;
    c.left = -80; c.right = 80; c.top = 80; c.bottom = -80; c.near = 10; c.far = 260;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.035;
  }
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fb4ff, 0.8);   // lifts faces turned away from the sun
  fill.position.set(-60, 40, -40);
  scene.add(fill);
}
