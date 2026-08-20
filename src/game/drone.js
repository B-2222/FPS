// ============ attacker drone ============
// Driven during prep (and after), it is the attackers' answer to not knowing
// the layout: low to the ground, fast, fragile, and it reveals what it sees.
import * as THREE from 'three';
import { moveBody } from '../world/collision.js';
import { actionDown, axis } from '../core/input.js';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { clamp, damp } from '../core/util.js';

const SPEED = 5.4;
const RADIUS = 0.22, HEIGHT = 0.34;

export class Drone {
  constructor(game, owner) {
    this.game = game; this.owner = owner; this.team = owner.team;
    this.pos = new THREE.Vector3().copy(owner.pos).setY(owner.pos.y + 0.1);
    this.vel = new THREE.Vector3();
    this.yaw = owner.yaw; this.pitch = 0;
    this.alive = true;
    this.height = HEIGHT;
    this.grounded = false;

    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x2c3138 }));
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x36e0ff }));
    lens.position.set(0, 0.06, -0.17);
    const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14171c });
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.21, -0.05, 0);
      g.add(wheel);
    }
    g.add(body, lens);
    g.castShadow = true;
    game.mapRoot.add(g);
    this.mesh = g;
    this.lens = lens;
  }

  /** ray vs drone, so defenders can shoot it out */
  hitTest(o, d, maxDist) {
    if (!this.alive) return null;
    const mx = o.x - this.pos.x, my = o.y - (this.pos.y + 0.18), mz = o.z - this.pos.z;
    const b = mx * d.x + my * d.y + mz * d.z;
    const c = mx * mx + my * my + mz * mz - 0.26 * 0.26;
    if (c > 0 && b > 0) return null;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t >= 0 && t <= maxDist ? { t, part: 'drone' } : null;
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.game.fx.explosion(this.pos, 1.2);
    audio.click(this.pos, { freq: 300, dur: 0.2, vol: 0.4 });
    this.dispose();
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
  }

  update(dt, controlled, input) {
    if (!this.alive) return;
    const g = this.game;
    if (controlled) {
      this.yaw -= input.mouseDX * 0.0022 * settings.sens * 1.2;
      this.pitch = clamp(this.pitch - input.mouseDY * 0.0022 * settings.sens * 1.2, -0.9, 0.5);
      const f = axis('back', 'forward'), s = axis('left', 'right');
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
      const l = Math.hypot(wx, wz);
      if (l > 0.001) { wx /= l; wz /= l; }
      const boost = actionDown('sprint') ? 1.5 : 1;
      this.vel.x = damp(this.vel.x, wx * SPEED * boost, 12, dt);
      this.vel.z = damp(this.vel.z, wz * SPEED * boost, 12, dt);
      // a little hop, because getting over a doorstep matters
      if (actionDown('jump') && this.grounded) this.vel.y = 4.2;
    } else {
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
    }
    this.vel.y -= 20 * dt;
    const res = moveBody(g.world, this.pos, this.vel, dt, { radius: RADIUS, height: HEIGHT, stepHeight: 0.32 });
    this.grounded = res.grounded;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw + Math.PI;

    // whatever it sees, the team sees
    for (const a of g.actors) {
      if (!a.alive || g.friendly(this.owner, a)) continue;
      _v.set(a.pos.x, a.pos.y + 1.0, a.pos.z);
      _eye.set(this.pos.x, this.pos.y + 0.2, this.pos.z);
      if (_eye.distanceTo(_v) < 22 && g.canSee(_eye, _v)) a.revealedUntil = g.time + 1.4;
    }
  }

  applyCamera(camera) {
    camera.position.set(this.pos.x, this.pos.y + 0.26, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

const _v = new THREE.Vector3(), _eye = new THREE.Vector3();
