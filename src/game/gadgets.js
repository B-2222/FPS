// ============ throwables, deployables and operator abilities ============
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { clamp, rand } from '../core/util.js';
import { explode } from './combat.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

const THROW_SPEED = 17;
const GRAV = 20;

/* shared geometry so hundreds of gadgets cost nothing */
const GEO = {
  ball: new THREE.IcosahedronGeometry(0.11, 0),
  can: new THREE.CylinderGeometry(0.09, 0.09, 0.24, 8),
  disc: new THREE.CylinderGeometry(0.22, 0.22, 0.07, 10),
  box: new THREE.BoxGeometry(1, 1, 1),
  cam: new THREE.SphereGeometry(0.12, 8, 6),
};

export class GadgetSystem {
  constructor(game) {
    this.game = game;
    this.items = [];         // live throwables / deployables
    this.smokes = [];        // {pos, r, life}
    this.reveals = [];       // {team, until}
    this.mats = {
      frag: new THREE.MeshLambertMaterial({ color: 0x394048 }),
      smoke: new THREE.MeshLambertMaterial({ color: 0x8b929b }),
      flash: new THREE.MeshLambertMaterial({ color: 0xd8d2a8 }),
      mine: new THREE.MeshLambertMaterial({ color: 0xff3b5c, emissive: 0x400008 }),
      nitro: new THREE.MeshLambertMaterial({ color: 0xffd60a, emissive: 0x3a2a00 }),
      charge: new THREE.MeshLambertMaterial({ color: 0xff7a3d, emissive: 0x3a1200 }),
      drone: new THREE.MeshLambertMaterial({ color: 0x8f7bff, emissive: 0x180d3a }),
      shield: new THREE.MeshLambertMaterial({ color: 0x51606f }),
    };
  }

  clear() {
    for (const it of this.items) if (it.mesh) this.game.scene.remove(it.mesh);
    this.items.length = 0;
    this.smokes.length = 0;
    this.reveals.length = 0;
  }

  /* ---------------- throwing ---------------- */
  throwGadget(owner, kind, dir, power = 1) {
    const g = this.game;
    const pos = owner.eyePos(_v).clone().addScaledVector(dir, 0.5);
    const mesh = new THREE.Mesh(
      kind === 'mine' ? GEO.disc : kind === 'nitro' ? GEO.can : GEO.ball,
      this.mats[kind] || this.mats.frag);
    mesh.castShadow = true;
    g.scene.add(mesh);
    const item = {
      kind, owner, team: owner.team, mesh,
      pos: pos.clone(),
      vel: dir.clone().multiplyScalar(THROW_SPEED * power).add(new THREE.Vector3(0, 2.4, 0)),
      fuse: kind === 'frag' ? 2.6 : kind === 'flash' ? 1.9 : kind === 'smoke' ? 1.6 : Infinity,
      armed: false, rest: 0, life: 60,
    };
    this.items.push(item);
    audio.click(pos, { freq: 520, dur: 0.06, vol: 0.22 });
    return item;
  }

  /* ---------------- abilities ---------------- */
  useAbility(actor, op) {
    const g = this.game;
    const id = op.ability.id;
    const dir = actor.aimDir ? actor.aimDir(_v).clone() : actor.dirVec(_v).clone();
    const eye = actor.eyePos(_v2).clone();

    switch (id) {
      case 'charge': {
        const hit = g.world.raycast(eye, dir, 4.5);
        if (!hit || !hit.box?.soft) return { ok: false, msg: 'NEEDS A SOFT WALL' };
        this.placeCharge(actor, hit);
        return { ok: true };
      }
      case 'sledge': {
        const hit = g.world.raycast(eye, dir, 2.8);
        if (!hit || !hit.box?.soft) return { ok: false, msg: 'NOTHING TO BREAK' };
        g.world.destroyBox(hit.box);
        g.fx.impact(hit.point, hit.normal, 'wall');
        audio.click(hit.point, { freq: 260, dur: 0.2, vol: 0.5 });
        g.onGeometryDestroyed(hit.box);
        return { ok: true };
      }
      case 'pulse': {
        this.reveals.push({ team: actor.team, until: g.time + 5, origin: actor.pos.clone(), range: 40 });
        audio.tone(880, 0.25, 0.25, 'sine', 1500);
        for (const a of g.actors) {
          if (a.alive && !g.friendly(actor, a) && a.pos.distanceTo(actor.pos) < 40) a.revealedUntil = g.time + 5;
        }
        return { ok: true };
      }
      case 'drone': {
        const item = this.throwGadget(actor, 'drone', dir, 0.85);
        item.fuse = Infinity; item.isCamera = true;
        return { ok: true };
      }
      case 'mine': {
        const item = this.throwGadget(actor, 'mine', dir, 0.55);
        return { ok: true };
      }
      case 'barricade': {
        const p = actor.pos.clone().addScaledVector(_v.set(dir.x, 0, dir.z).normalize(), 1.6);
        return this.deployShield(actor, p, actor.yaw);
      }
      case 'reinforce': {
        const hit = g.world.raycast(eye, dir, 4);
        if (!hit || !hit.box?.soft) return { ok: false, msg: 'NEEDS A SOFT WALL' };
        hit.box.soft = false; hit.box.breakable = false; hit.box.reinforced = true;
        if (hit.box.inst) {
          const c = new THREE.Color(0x46505c);
          hit.box.inst.setColorAt(hit.box.instIndex, c);
          hit.box.inst.instanceColor.needsUpdate = true;
        }
        audio.click(hit.point, { freq: 380, dur: 0.18, vol: 0.4 });
        return { ok: true };
      }
      case 'camera': {
        const hit = g.world.raycast(eye, dir, 6);
        if (!hit) return { ok: false, msg: 'AIM AT A SURFACE' };
        g.addCamera({
          id: 100 + g.cameras.length, name: 'SPY CAM',
          x: hit.point.x + hit.normal.x * 0.2, y: hit.point.y, z: hit.point.z + hit.normal.z * 0.2,
          yaw: Math.atan2(-hit.normal.x, -hit.normal.z), pitch: -0.1, placed: true, team: actor.team,
        });
        return { ok: true };
      }
    }
    return { ok: false };
  }

  placeCharge(actor, hit) {
    const g = this.game;
    const mesh = new THREE.Mesh(GEO.box, this.mats.charge);
    mesh.scale.set(0.5, 0.5, 0.12);
    mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.08);
    mesh.lookAt(_v.copy(hit.point).add(hit.normal));
    g.scene.add(mesh);
    this.items.push({
      kind: 'charge', owner: actor, team: actor.team, mesh, static: true,
      pos: mesh.position.clone(), fuse: 2.2, box: hit.box, normal: hit.normal.clone(), life: 30,
    });
    audio.click(hit.point, { freq: 900, dur: 0.1, vol: 0.3 });
  }

  deployShield(actor, pos, yaw) {
    const g = this.game;
    const floor = g.world.raycast(_v.set(pos.x, pos.y + 1.5, pos.z), _v2.set(0, -1, 0), 4);
    const y = floor ? floor.point.y : pos.y;
    const w = 1.8, h = 1.05, d = 0.28;
    const sin = Math.abs(Math.sin(yaw)), cos = Math.abs(Math.cos(yaw));
    const sx = cos > sin ? w : d, sz = cos > sin ? d : w;
    const box = g.world.addBox(
      { x: pos.x - sx / 2, y, z: pos.z - sz / 2 },
      { x: pos.x + sx / 2, y: y + h, z: pos.z + sz / 2 },
      { breakable: true, hp: 260, deployed: true });
    const mesh = new THREE.Mesh(GEO.box, this.mats.shield);
    mesh.scale.set(sx, h, sz);
    mesh.position.set(pos.x, y + h / 2, pos.z);
    mesh.castShadow = true;
    g.scene.add(mesh);
    box.mesh = mesh;
    g.world.build();
    g.nav.relinkNear(box.min, box.max);
    this.items.push({ kind: 'shield', owner: actor, team: actor.team, mesh, static: true, box, life: 999, fuse: Infinity });
    audio.click(pos, { freq: 300, dur: 0.16, vol: 0.35 });
    return { ok: true };
  }

  /* ---------------- per-frame ---------------- */
  update(dt) {
    const g = this.game;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;

      if (!it.static) {
        it.vel.y -= GRAV * dt;
        const step = it.vel.length() * dt;
        if (step > 1e-4) {
          _v.copy(it.vel).normalize();
          const hit = g.world.raycast(it.pos, _v, step + 0.12);
          if (hit) {
            it.pos.copy(hit.point).addScaledVector(hit.normal, 0.09);
            const bounce = it.kind === 'mine' || it.kind === 'nitro' || it.kind === 'drone' ? 0.05 : 0.42;
            it.vel.reflect(hit.normal).multiplyScalar(bounce);
            if (it.vel.length() < 1.6) { it.vel.set(0, 0, 0); it.rest += dt; }
            if (it.kind === 'frag' || it.kind === 'flash') audio.click(it.pos, { freq: 1500, dur: 0.05, vol: 0.18 });
          } else it.pos.addScaledVector(it.vel, dt);
        }
        it.mesh.position.copy(it.pos);
        it.mesh.rotation.x += dt * 6; it.mesh.rotation.z += dt * 4;
        if (it.rest > 0.25 && (it.kind === 'mine' || it.kind === 'drone')) {
          it.static = true; it.armed = true;
          it.mesh.rotation.set(0, 0, 0);
          if (it.kind === 'drone') g.addCamera({
            id: 200 + g.cameras.length, name: 'DRONE', x: it.pos.x, y: it.pos.y + 0.2, z: it.pos.z,
            yaw: 0, pitch: 0, placed: true, team: it.team, spin: true,
          });
        }
      }

      // fuses
      if (it.fuse !== Infinity) {
        it.fuse -= dt;
        if (it.fuse <= 0) { this.detonate(it); this.remove(i); continue; }
      }

      // proximity mines
      if (it.kind === 'mine' && it.armed) {
        for (const a of g.actors) {
          if (!a.alive || g.friendly(it.owner, a)) continue;
          if (a.pos.distanceTo(it.pos) < 2.6) { this.detonate(it); this.remove(i); break; }
        }
      }

      // drones reveal nearby enemies for their team
      if (it.kind === 'drone' && it.armed) {
        for (const a of g.actors) {
          if (!a.alive || g.friendly(it.owner, a)) continue;
          if (a.pos.distanceTo(it.pos) < 18 && g.world.losClear(it.pos, _v.set(a.pos.x, a.pos.y + 1.2, a.pos.z))) {
            a.revealedUntil = g.time + 1.2;
          }
        }
      }

      if (it.life <= 0) { this.remove(i); continue; }
    }

    // smoke clouds thin out
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.life -= dt;
      s.r = clamp(s.r + dt * (s.life > 10 ? 3.2 : 0), 0, s.maxR);
      if (Math.random() < dt * 22) {
        _v.set(s.pos.x + rand(-s.r, s.r), s.pos.y + rand(-0.6, s.r * 0.8), s.pos.z + rand(-s.r, s.r));
        this.game.fx.smokePuff(_v, s.life < 3 ? 0.4 : 1);
      }
      if (s.life <= 0) this.smokes.splice(i, 1);
    }

    for (let i = this.reveals.length - 1; i >= 0; i--) if (this.reveals[i].until < g.time) this.reveals.splice(i, 1);
  }

  remove(i) {
    const it = this.items[i];
    if (it.mesh) this.game.scene.remove(it.mesh);
    this.items.splice(i, 1);
  }

  /** the player's nitro cell, triggered by pressing the gadget key again */
  detonateRemote(owner) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].kind === 'nitro' && this.items[i].owner === owner) {
        this.detonate(this.items[i]); this.remove(i); return true;
      }
    }
    return false;
  }

  detonate(it) {
    const g = this.game;
    switch (it.kind) {
      case 'frag':
      case 'nitro': {
        const power = it.kind === 'nitro' ? 1.25 : 1;
        explode(g, {
          def: { id: it.kind, dmg: 0, projectile: { splash: 6.5 * power, splashDmg: 95 * power, selfMult: 1, knock: 9 } },
          owner: it.owner,
        }, it.pos.clone(), null);
        break;
      }
      case 'charge': {
        // blow a doorway: take the wall panel and its immediate neighbours
        g.world.destroyBox(it.box);
        for (const b of g.world.breakablesNear(it.pos, 2.6)) if (b.soft) g.world.destroyBox(b);
        g.fx.explosion(it.pos, 4);
        audio.explosion(it.pos);
        g.shakeFromExplosion(it.pos, 4);
        g.onGeometryDestroyed(it.box);
        break;
      }
      case 'smoke': {
        this.smokes.push({ pos: it.pos.clone(), r: 1, maxR: 4.2, life: 12 });
        audio.click(it.pos, { freq: 200, dur: 0.4, vol: 0.35 });
        break;
      }
      case 'flash': {
        g.fx.flashBurst(it.pos);
        audio.explosion(it.pos);
        for (const a of g.actors) {
          if (!a.alive) continue;
          const d = a.pos.distanceTo(it.pos);
          if (d > 16) continue;
          if (!g.world.losClear(it.pos, a.eyePos(_v))) continue;
          // only blinds if it went off in front of you
          a.dirVec ? a.dirVec(_v2) : _v2.set(0, 0, -1);
          _v.copy(it.pos).sub(a.pos).normalize();
          const facing = _v.dot(_v2);
          if (facing < -0.1) continue;
          const strength = clamp((1 - d / 16) * (0.4 + facing * 0.6), 0, 1);
          a.blindUntil = Math.max(a.blindUntil || 0, g.time + 1.2 + strength * 2.6);
          if (a === g.player) g.hud.flash(strength);
        }
        break;
      }
      case 'mine': {
        explode(g, {
          def: { id: 'mine', dmg: 0, projectile: { splash: 4.5, splashDmg: 85, selfMult: 1, knock: 7 } },
          owner: it.owner,
        }, it.pos.clone(), null);
        break;
      }
    }
  }

  /** does smoke block this sight line? */
  blocksSight(from, to) {
    if (!this.smokes.length) return false;
    for (const s of this.smokes) {
      if (segmentSphere(from, to, s.pos, s.r * 0.92)) return true;
    }
    return false;
  }
}

function segmentSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-8) return false;
  let t = (acx * abx + acy * aby + acz * abz) / ab2;
  t = clamp(t, 0, 1);
  const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz <= r * r;
}
