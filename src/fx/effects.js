// ============ particles, tracers, decals, explosions ============
import * as THREE from 'three';
import { rand, clamp } from '../core/util.js';

/* ---------- point-sprite particle pool ---------- */
class Particles {
  constructor(scene, max = 2400) {
    this.max = max; this.head = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPix: { value: window.devicePixelRatio || 1 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA; uniform float uPix;
        void main(){
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPix * 320.0 / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float a = smoothstep(0.25, 0.0, r);
          gl_FragColor = vec4(vC, a * vA);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
  }
  spawn(p, v, color, size, life, gravity = 9, drag = 1.2) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x; this.vel[i3 + 1] = v.y; this.vel[i3 + 2] = v.z;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.siz[i] = size; this.alp[i] = 1; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = gravity; this.drag[i] = drag;
  }
  update(dt) {
    const { pos, vel, life, alp, siz, maxLife, grav, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alp[i] !== 0) alp[i] = 0; continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const dm = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= dm; vel[i3 + 2] *= dm;
      vel[i3 + 1] = vel[i3 + 1] * dm - grav[i] * dt;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = clamp(life[i] / maxLife[i], 0, 1);
      alp[i] = t * t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/* ---------- bullet-hole decals ---------- */
function decalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.45, 'rgba(10,10,12,0.65)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.globalCompositeOperation = 'lighter';
  x.fillStyle = 'rgba(120,120,130,0.25)';
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.28, r = 8 + Math.random() * 18;
    x.beginPath(); x.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1 + Math.random() * 2, 0, 6.28); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

class Decals {
  constructor(scene, max = 90) {
    this.max = max; this.head = 0; this.pool = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = decalTexture();
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: 0,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      m.visible = false; m.renderOrder = 2;
      scene.add(m); this.pool.push({ m, life: 0 });
    }
  }
  add(pos, normal, size = 0.28, color = 0x000000) {
    const d = this.pool[this.head]; this.head = (this.head + 1) % this.max;
    d.m.position.copy(pos).addScaledVector(normal, 0.012);
    d.m.lookAt(_v.copy(pos).add(normal));
    d.m.rotation.z = rand(0, 6.28);
    d.m.scale.setScalar(size * rand(0.8, 1.25));
    d.m.material.color.setHex(color);
    d.m.material.opacity = 1; d.m.visible = true;
    d.life = 14;
  }
  update(dt) {
    for (const d of this.pool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life < 2) d.m.material.opacity = clamp(d.life / 2, 0, 1);
      if (d.life <= 0) d.m.visible = false;
    }
  }
}

/* ---------- tracers ---------- */
class Tracers {
  constructor(scene, max = 48) {
    this.pool = []; this.head = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.pool.push({ m, life: 0, max: 1 });
    }
  }
  add(from, to, color = 0xffe9a8, width = 0.035, life = 0.055) {
    const t = this.pool[this.head]; this.head = (this.head + 1) % this.pool.length;
    const len = from.distanceTo(to);
    if (len < 0.2) return;
    t.m.position.copy(from).add(to).multiplyScalar(0.5);
    t.m.lookAt(to);
    t.m.scale.set(width, width, len);
    t.m.material.color.setHex(color);
    t.m.material.opacity = 0.95;
    t.m.visible = true; t.life = life; t.max = life;
  }
  update(dt) {
    for (const t of this.pool) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.m.material.opacity = clamp(t.life / t.max, 0, 1) * 0.95;
      if (t.life <= 0) t.m.visible = false;
    }
  }
}

/* ---------- muzzle flashes & explosion shells ---------- */
class Flashes {
  constructor(scene, max = 10) {
    this.pool = []; this.head = 0;
    const geo = new THREE.SphereGeometry(1, 7, 5);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffd88a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false; scene.add(m);
      this.pool.push({ m, life: 0, max: 1, grow: 0 });
    }
  }
  add(pos, size, color = 0xffd88a, life = 0.05, grow = 0) {
    const f = this.pool[this.head]; this.head = (this.head + 1) % this.pool.length;
    f.m.position.copy(pos);
    f.m.scale.setScalar(size);
    f.m.material.color.setHex(color);
    f.m.material.opacity = 1; f.m.visible = true;
    f.life = life; f.max = life; f.grow = grow; f.base = size;
  }
  update(dt) {
    for (const f of this.pool) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = clamp(f.life / f.max, 0, 1);
      f.m.material.opacity = t;
      if (f.grow) f.m.scale.setScalar(f.base * (1 + (1 - t) * f.grow));
      if (f.life <= 0) f.m.visible = false;
    }
  }
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class FX {
  constructor(scene, vmScene, quality) {
    this.quality = quality;
    this.scale = quality === 'low' ? 0.45 : quality === 'med' ? 0.8 : 1.2;
    this.parts = new Particles(scene, quality === 'low' ? 900 : 2400);
    this.vmParts = new Particles(vmScene, 200);
    this.decals = new Decals(scene, quality === 'low' ? 30 : 90);
    this.tracers = new Tracers(scene, 56);
    this.flashes = new Flashes(scene, 12);
    this.vmFlash = new Flashes(vmScene, 4);
    this.light = new THREE.PointLight(0xffbb66, 0, 26, 2);
    this.light.visible = false;
    scene.add(this.light);
    this.lightLife = 0;
    this.blood = true;
  }

  update(dt) {
    this.parts.update(dt); this.vmParts.update(dt);
    this.decals.update(dt); this.tracers.update(dt);
    this.flashes.update(dt); this.vmFlash.update(dt);
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity = Math.max(0, this.lightLife) * this.lightIntensity;
      if (this.lightLife <= 0) this.light.visible = false;
    }
  }

  pointLight(pos, color, intensity, life) {
    this.light.position.copy(pos);
    this.light.color.setHex(color);
    this.lightIntensity = intensity / life;
    this.lightLife = life;
    this.light.visible = true;
  }

  tracer(from, to, color, width) { this.tracers.add(from, to, color, width); }

  muzzleFlash(worldPos, dir, size, color, viewLocal = null) {
    this.flashes.add(worldPos, size * 0.5, color, 0.045);
    if (viewLocal) this.vmFlash.add(viewLocal, size * 0.55, color, 0.05);
    this.pointLight(worldPos, 0xffc070, 9 * size, 0.07);
    const n = Math.round(4 * this.scale);
    _c.setHex(0xffcf7a);
    for (let i = 0; i < n; i++) {
      _v.copy(dir).multiplyScalar(rand(6, 16)).add(_v.clone().set(rand(-2, 2), rand(-2, 2), rand(-2, 2)));
      this.parts.spawn(worldPos, _v, _c, rand(0.02, 0.06), rand(0.05, 0.14), 4, 5);
    }
  }

  impact(pos, normal, kind = 'wall', color = 0xffd9a0) {
    const n = Math.round((kind === 'flesh' ? 9 : 7) * this.scale);
    if (kind === 'flesh') {
      if (!this.blood) return;
      _c.setHex(0xc41c33);
      for (let i = 0; i < n; i++) {
        _v.set(rand(-2.6, 2.6), rand(0.4, 3.6), rand(-2.6, 2.6)).addScaledVector(normal, rand(1, 4));
        this.parts.spawn(pos, _v, _c, rand(0.05, 0.13), rand(0.25, 0.55), 12, 1.4);
      }
      this.decals.add(pos, normal, 0.22, 0x5c0b16);
      return;
    }
    _c.setHex(color);
    for (let i = 0; i < n; i++) {
      _v.copy(normal).multiplyScalar(rand(2, 7));
      _v.x += rand(-2.5, 2.5); _v.y += rand(-1, 3.5); _v.z += rand(-2.5, 2.5);
      this.parts.spawn(pos, _v, _c, rand(0.02, 0.07), rand(0.12, 0.4), 11, 2);
    }
    // dust puff
    _c.setHex(0x555a63);
    for (let i = 0; i < Math.round(3 * this.scale); i++) {
      _v.copy(normal).multiplyScalar(rand(0.4, 1.6));
      this.parts.spawn(pos, _v, _c, rand(0.1, 0.28), rand(0.25, 0.5), 0.6, 2.6);
    }
    this.decals.add(pos, normal, rand(0.16, 0.3));
  }

  explosion(pos, radius = 7.5) {
    this.flashes.add(pos, radius * 0.28, 0xffb15a, 0.34, 3.2);
    this.pointLight(pos, 0xff8a3c, 60, 0.45);
    const n = Math.round(70 * this.scale);
    for (let i = 0; i < n; i++) {
      const s = Math.random();
      _c.setHex(s > 0.6 ? 0xffd27a : s > 0.25 ? 0xff7a2a : 0x552218);
      const sp = rand(4, 26);
      _v.set(rand(-1, 1), rand(-0.35, 1), rand(-1, 1)).normalize().multiplyScalar(sp);
      this.parts.spawn(pos, _v, _c, rand(0.14, 0.5), rand(0.3, 0.95), 7, 1.5);
    }
    _c.setHex(0x30343c);
    for (let i = 0; i < Math.round(22 * this.scale); i++) {
      _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 7));
      this.parts.spawn(pos, _v, _c, rand(0.4, 1.1), rand(0.7, 1.5), -0.5, 1.1);
    }
    this.decals.add(pos.clone().setY(pos.y - 0.0), new THREE.Vector3(0, 1, 0), radius * 0.5, 0x14100e);
  }

  /** brass casing puff in the viewmodel scene */
  shell(localPos, dir) {
    _c.setHex(0xd9a441);
    for (let i = 0; i < 1; i++) {
      _v.set(dir.x * rand(0.5, 1.2) + rand(-.2, .2), rand(0.5, 1.1), rand(-.3, .3));
      this.vmParts.spawn(localPos, _v, _c, 0.02, 0.45, 3.2, 0.6);
    }
  }

  /** rising smoke from a fired rocket */
  smokeTrail(pos) {
    _c.setHex(0x8a8f98);
    _v.set(rand(-0.4, 0.4), rand(0.1, 0.8), rand(-0.4, 0.4));
    this.parts.spawn(pos, _v, _c, rand(0.14, 0.3), rand(0.4, 0.8), -0.4, 1.6);
  }

  spawnBeam(pos) {
    _c.setHex(0x00ffa8);
    for (let i = 0; i < Math.round(26 * this.scale); i++) {
      const a = rand(0, 6.283), r = rand(0, 0.7);
      _v.set(Math.cos(a) * 0.4, rand(3, 9), Math.sin(a) * 0.4);
      this.parts.spawn(_v.clone().set(pos.x + Math.cos(a) * r, pos.y + 0.1, pos.z + Math.sin(a) * r),
        _v, _c, rand(0.06, 0.16), rand(0.3, 0.7), -1.2, 1.4);
    }
  }
}
