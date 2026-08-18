// ============ shared actor: health, hitboxes, inventory ============
import * as THREE from 'three';
import { MOVE } from './movement.js';
import { WEAPONS, getWeapon, fireDelay } from '../weapons/defs.js';
import { clamp } from '../core/util.js';

const _v = new THREE.Vector3();

/* ray vs axis-aligned box, returns t or -1 */
function rayAABB(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz) {
  const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
  let t1 = (minx - ox) * ix, t2 = (maxx - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (miny - oy) * iy; t2 = (maxy - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (minz - oz) * iz; t2 = (maxz - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0)) return -1;
  return tmin >= 0 ? tmin : -1;
}
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

export class Actor {
  constructor(game, opts = {}) {
    this.game = game;
    this.name = opts.name || 'PLAYER';
    this.team = opts.team ?? 0;          // 0/1 in TDM, unique-ish in FFA
    this.isBot = !!opts.isBot;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.height = MOVE.height;
    this.grounded = false; this.crouching = false; this.sliding = false;
    this.slideT = 0; this.slideCd = 0; this.coyote = 0; this.jumpCd = 0;
    this.speed = 0; this.speedMult = 1;
    this.maxHealth = 100;
    this.health = 100; this.shield = 0; this.maxShield = 100;
    this.alive = true;
    this.kills = 0; this.deaths = 0; this.score = 0; this.streak = 0; this.bestStreak = 0;
    this.damageDealt = 0; this.shotsFired = 0; this.shotsHit = 0; this.headshots = 0;
    this.lastHitTime = -99; this.lastAttacker = null;
    this.gunGameTier = 0;
    this.arsenal = new Arsenal(this, opts.weapon || 'rifle', opts.allWeapons);
    this.respawnAt = 0;
  }

  get eyeY() { return this.pos.y + this.height - 0.22; }
  eyePos(out = _v) { return out.set(this.pos.x, this.eyeY, this.pos.z); }

  /** forward vector from yaw/pitch */
  dirVec(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** ray vs this actor: returns {t, part} or null */
  hitTest(o, d, maxDist) {
    if (!this.alive) return null;
    const p = this.pos, h = this.height, r = 0.38;
    // quick reject via bounding sphere
    const cx = p.x, cy = p.y + h * 0.5, cz = p.z;
    const bs = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, cx, cy, cz, h * 0.62 + 0.3);
    if (bs < 0 || bs > maxDist) {
      const inside = (o.x - cx) ** 2 + (o.y - cy) ** 2 + (o.z - cz) ** 2 < (h * 0.62 + 0.3) ** 2;
      if (!inside) return null;
    }
    let best = Infinity, part = null;
    const headY = p.y + h - 0.17, headR = 0.245;
    const th = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.x, headY, p.z, headR);
    if (th >= 0 && th < best) { best = th; part = 'head'; }
    const tb = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z,
      p.x - r, p.y + h * 0.28, p.z - r, p.x + r, p.y + h - 0.30, p.z + r);
    if (tb >= 0 && tb < best) { best = tb; part = 'body'; }
    const tl = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z,
      p.x - r * 0.85, p.y, p.z - r * 0.85, p.x + r * 0.85, p.y + h * 0.28, p.z + r * 0.85);
    if (tl >= 0 && tl < best) { best = tl; part = 'legs'; }
    if (!part || best > maxDist) return null;
    return { t: best, part };
  }

  /** returns {dealt, killed} */
  applyDamage(amount, attacker, meta = {}) {
    if (!this.alive) return { dealt: 0, killed: false };
    let dealt = 0;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount * 0.72);
      this.shield -= absorbed; amount -= absorbed; dealt += absorbed;
    }
    const hp = Math.min(this.health, amount);
    this.health -= hp; dealt += hp;
    this.lastHitTime = performance.now() / 1000;
    if (attacker && attacker !== this) this.lastAttacker = attacker;
    const killed = this.health <= 0.001;
    if (killed) this.alive = false;
    return { dealt, killed };
  }

  heal(v) { const before = this.health; this.health = clamp(this.health + v, 0, this.maxHealth); return this.health - before; }
  addShield(v) { const b = this.shield; this.shield = clamp(this.shield + v, 0, this.maxShield); return this.shield - b; }

  resetForSpawn(pos) {
    this.pos.copy(pos); this.vel.set(0, 0, 0);
    this.health = this.maxHealth; this.shield = 0;
    this.alive = true; this.height = MOVE.height;
    this.grounded = false; this.sliding = false; this.crouching = false;
    this.arsenal.onSpawn();
  }
}

/* ---------- weapons carried by an actor ---------- */
export class Arsenal {
  constructor(owner, startId, all = false) {
    this.owner = owner;
    this.slots = new Map();
    this.order = [];
    this.give(startId, true);
    this.give('knife', false);
    if (all) for (const id of Object.keys(WEAPONS)) this.give(id, false);
    this.current = startId;
    this.previous = startId;
    this.fireTimer = 0;
    this.reloading = false; this.reloadT = 0; this.reloadTotal = 0;
    this.swapT = 0; this.swapTotal = 0; this.pendingSwap = null;
    this.spread = 0;
    this.sprayIndex = 0;
    this.triggerHeld = false;
    this.burstLeft = 0;
    this.pumpT = 0;
  }

  get def() { return getWeapon(this.current); }
  get ammo() { return this.slots.get(this.current); }
  get isEmpty() { const a = this.ammo; return a && a.mag <= 0; }
  get busy() { return this.reloading || this.swapT > 0; }

  give(id, makeCurrent) {
    const w = getWeapon(id);
    if (!this.slots.has(id)) {
      this.slots.set(id, { mag: w.mag, reserve: w.reserve });
      this.order.push(id);
      this.order.sort((a, b) => getWeapon(a).slot - getWeapon(b).slot);
    } else {
      const s = this.slots.get(id);
      s.reserve = Math.min(w.reserve, s.reserve + Math.ceil(w.reserve * 0.5));
      s.mag = Math.max(s.mag, Math.min(w.mag, s.mag + w.mag));
    }
    if (makeCurrent) this.select(id, true);
    return true;
  }

  has(id) { return this.slots.has(id); }

  select(id, instant = false) {
    if (id === this.current || !this.slots.has(id)) return false;
    if (this.swapT > 0 && !instant) return false;
    this.previous = this.current;
    this.cancelReload();
    if (instant) {
      this.current = id; this.swapT = 0; this.spread = 0; this.sprayIndex = 0;
      this.owner.game?.onWeaponChanged?.(this.owner, id);
    } else {
      this.pendingSwap = id;
      this.swapTotal = this.swapT = getWeapon(id).swapTime;
    }
    return true;
  }

  cycle(dir) {
    const list = this.order.filter(id => !getWeapon(id).hidden);
    if (!list.length) return;
    let i = list.indexOf(this.current);
    if (i < 0) i = 0;
    i = (i + dir + list.length * 2) % list.length;
    this.select(list[i]);
  }

  startReload() {
    const w = this.def, a = this.ammo;
    if (!a || this.reloading || w.melee) return false;
    if (a.mag >= w.mag || a.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTotal = this.reloadT = w.reload;
    this.owner.game?.onReloadStart?.(this.owner, w);
    return true;
  }
  cancelReload() { this.reloading = false; this.reloadT = 0; }

  onSpawn() {
    for (const [id, s] of this.slots) { const w = getWeapon(id); s.mag = w.mag; s.reserve = w.reserve; }
    this.cancelReload(); this.swapT = 0; this.spread = 0; this.pumpT = 0;
  }

  refillAmmo(frac = 1) {
    let got = false;
    for (const [id, s] of this.slots) {
      const w = getWeapon(id);
      if (w.melee) continue;
      const before = s.reserve + s.mag;
      s.reserve = Math.min(w.reserve, s.reserve + Math.ceil(w.reserve * frac));
      if (s.mag < w.mag && s.reserve > 0) {
        const need = Math.min(w.mag - s.mag, s.reserve);
        s.mag += need; s.reserve -= need;
      }
      if (s.reserve + s.mag > before) got = true;
    }
    return got;
  }

  update(dt) {
    const w = this.def;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.pumpT = Math.max(0, this.pumpT - dt);
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.swapT <= this.swapTotal * 0.5 && this.pendingSwap) {
        this.current = this.pendingSwap; this.pendingSwap = null;
        this.spread = 0; this.sprayIndex = 0;
        this.owner.game?.onWeaponChanged?.(this.owner, this.current);
      }
      if (this.swapT <= 0) this.swapT = 0;
    }
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const a = this.ammo;
        if (w.reloadPerShell) {
          if (a.reserve > 0 && a.mag < w.mag) { a.mag++; a.reserve--; }
          this.owner.game?.onShellLoaded?.(this.owner, w);
          if (a.mag < w.mag && a.reserve > 0) { this.reloadT = this.reloadTotal; }
          else { this.reloading = false; this.pumpT = 0.28; }
        } else {
          const need = Math.min(w.mag - a.mag, a.reserve);
          a.mag += need; a.reserve -= need;
          this.reloading = false;
          this.owner.game?.onReloadEnd?.(this.owner, w);
        }
      }
    }
    // spread recovery
    this.spread = Math.max(0, this.spread - w.spreadDecay * dt);
    if (this.spread <= 0.001) this.sprayIndex = Math.max(0, this.sprayIndex - dt * 12);
  }

  canFire() {
    const w = this.def, a = this.ammo;
    if (this.swapT > 0 || this.pumpT > 0) return false;
    if (this.fireTimer > 0) return false;
    if (w.melee) return true;
    if (this.reloading) return false;
    return a.mag > 0;
  }

  consume() {
    const w = this.def;
    this.fireTimer = fireDelay(w);
    if (!w.melee) {
      const a = this.ammo; a.mag--;
      this.spread = Math.min(w.spreadMax, this.spread + w.spreadPerShot);
      this.sprayIndex++;
      if (w.reloadPerShell) this.pumpT = Math.max(0, 60 / w.rpm * 0.55);
    }
  }

  /** total cone half-angle in degrees for the current state */
  currentSpread(moving, airborne, ads, crouch) {
    const w = this.def;
    let s = ads ? w.spreadAds : w.spreadBase;
    if (airborne) s *= w.spreadAir;
    else if (moving) s *= w.spreadMove;
    else if (crouch) s *= w.spreadCrouch;
    return s + this.spread;
  }
}
