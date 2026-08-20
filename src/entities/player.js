// ============ the local player ============
import * as THREE from 'three';
import { Actor } from './actor.js';
import { stepMovement, MOVE } from './movement.js';
import { input, actionDown, actionHit, axis } from '../core/input.js';
import { settings, RAD_PER_COUNT } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { clamp, damp, lerp, rand } from '../core/util.js';
import { fireWeapon } from '../game/combat.js';
import { bodyFree } from '../world/collision.js';
import { getWeapon, WEAPON_IDS, recoilStep } from '../weapons/defs.js';
import { GADGET_INFO } from '../game/operators.js';

const DEG = Math.PI / 180;
const _dir = new THREE.Vector3(), _mz = new THREE.Vector3(), _vml = new THREE.Vector3();

export class Player extends Actor {
  constructor(game) {
    super(game, { name: 'YOU', team: 0, isBot: false, weapon: settings.loadout });
    this.recoilPitch = 0; this.recoilYaw = 0; this.recoilHold = 0;
    this.shake = 0; this.shakeT = 0;
    this.fovCur = settings.fov;
    this.roll = 0;
    this.bobT = 0; this.stepDist = 0;
    this.adsAmt = 0; this.adsToggled = false; this.crouchToggled = false;
    this.meleeT = 0; this.meleeCd = 0;
    this.raiseT = 0;            // weapon-raise delay coming out of a sprint
    this.landKick = 0;
    this.walking = false;
    this.lastFireAt = -9;
    this.leanState = 0;         // -1 / 0 / +1 when leaning is a toggle
    this.vault = null;          // active window/ledge vault
    this.abilityCharges = 0; this.gadgetCount = 0; this.abilityCd = 0;
    this.interacting = false;
  }

  spawn(pos) {
    this.resetForSpawn(pos);
    this.recoilPitch = this.recoilYaw = 0;
    this.shake = 0; this.roll = 0; this.meleeT = 0; this.pitch = 0;
    this.adsToggled = false; this.crouchToggled = false;
    this.leanState = 0; this.interacting = false;
    audio.spawn();
    this.game.fx.spawnBeam(pos);
  }

  /** the weapon as it actually behaves, with purchased attachments applied */
  get weapon() { return this.game.resolvedWeapon(this); }

  /** radians of view rotation per mouse count, accounting for zoom */
  sensScale() {
    const base = RAD_PER_COUNT * settings.sens;
    if (this.adsAmt <= 0.001) return base;
    const w = this.weapon;
    const userMult = (w.scope || w.magnified) ? settings.scopeSens : settings.adsSens;
    let m = lerp(1, userMult, this.adsAmt);
    if (settings.zoomMode === 'relative') {
      // keep on-screen tracking distance constant as the FOV narrows
      m *= Math.tan(this.fovCur * DEG * 0.5) / Math.tan(settings.fov * DEG * 0.5);
    }
    return base * m;
  }

  /** aim direction including recoil */
  aimDir(out = _dir) {
    const p = this.pitch + this.recoilPitch, y = this.yaw + this.recoilYaw;
    const cp = Math.cos(p);
    return out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
  }

  update(dt) {
    const g = this.game;
    if (!this.alive) { this.updateCamera(dt, true); return; }

    // ---------- look ----------
    const sens = this.sensScale();
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * settings.yxRatio * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.54, 1.54);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // recoil settles back toward where you were pointing, but only once you
    // stop firing — during a spray it is yours to fight.
    this.recoilHold = Math.max(0, this.recoilHold - dt);
    if (this.recoilHold <= 0) {
      const rec = this.arsenal.def.recoilRecover;
      this.recoilPitch = damp(this.recoilPitch, 0, rec, dt);
      this.recoilYaw = damp(this.recoilYaw, 0, rec * 0.9, dt);
    }

    // driving a drone or watching a camera: you can look through it, but your
    // body is standing there and you cannot shoot
    if (g.viewMode !== 'self') {
      if (actionHit('cameras')) g.toggleRemoteView();
      if (g.viewMode === 'camera' && (actionDown('fire') || actionDown('aim') || Math.abs(axis('back', 'forward')) > 0.1)) g.exitRemote();
      if (actionHit('fire') && g.viewMode === 'drone') g.exitRemote();
      this.arsenal.update(dt);
      return;
    }
    if (actionHit('cameras')) { g.toggleRemoteView(); return; }

    // ---------- vaulting ----------
    if (this.vault) { this.updateVault(dt); this.updateCamera(dt, false); return; }

    // frozen during a round's prep phase — you can look around, nothing else
    if (g.isFrozen(this)) { this.adsAmt = damp(this.adsAmt, 0, 10, dt); this.updateCamera(dt, false); return; }

    // ---------- weapon state ----------
    const ars = this.arsenal;
    ars.update(dt);
    const w = ars.def;
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.raiseT = Math.max(0, this.raiseT - dt);
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    if (this.meleeT > 0) this.meleeT = Math.max(0, this.meleeT - dt);

    // ---------- stance inputs (hold or toggle) ----------
    if (settings.toggleAds) { if (actionHit('aim')) this.adsToggled = !this.adsToggled; }
    else this.adsToggled = actionDown('aim');
    if (settings.toggleCrouch) { if (actionHit('crouch')) this.crouchToggled = !this.crouchToggled; }
    else this.crouchToggled = actionDown('crouch');

    const rw = this.weapon;
    const wantAds = this.adsToggled && !w.melee && this.meleeT <= 0 && !ars.reloading;
    this.adsing = wantAds;
    this.adsAmt = damp(this.adsAmt, wantAds ? 1 : 0, 1 / Math.max(0.05, rw.adsTime) * 2.2, dt);

    const forward = axis('back', 'forward');
    const wantSprint = actionDown('sprint') && !wantAds && !ars.reloading && forward > 0.1;
    this.walking = actionDown('walk') && !wantSprint;

    // ---------- movement ----------
    const wasSprinting = this.sprinting;
    const cmd = {
      forward, strafe: axis('left', 'right'),
      jump: actionDown('jump'),
      sprint: wantSprint,
      crouch: this.crouchToggled,
      slow: this.walking,
      lean: this.readLean(),
    };
    if (cmd.jump && this.grounded && this.tryVault()) { this.updateCamera(dt, false); return; }
    stepMovement(this, cmd, dt, g.world, g);
    if (wasSprinting && !this.sprinting) this.raiseT = Math.max(this.raiseT, 0.16);

    // footsteps — silent while walking, loud while sprinting
    if (this.grounded && this.speed > 0.6 && !this.walking) {
      this.stepDist += this.speed * dt;
      const gap = this.sprinting ? 2.2 : this.crouching ? 2.6 : 1.9;
      if (this.stepDist > gap) { this.stepDist = 0; audio.footstep(this.pos, this.sprinting); }
    } else if (this.walking) this.stepDist = 0;

    // ---------- weapon switching ----------
    for (let i = 0; i < 8; i++) {
      if (actionHit('weapon' + (i + 1))) {
        const id = WEAPON_IDS[i];
        if (ars.has(id)) ars.select(id);
        else g.hud.pickupToast(`NO ${getWeapon(id).name} IN LOADOUT`, '#ff7a90');
      }
    }
    if (actionHit('lastWeapon')) ars.select(ars.previous);
    if (actionHit('gadget')) this.useGadget();
    if (actionHit('ability')) this.useAbility();
    if (actionHit('nextWeapon')) ars.cycle(1);
    if (actionHit('prevWeapon')) ars.cycle(-1);
    if (actionHit('reload')) ars.startReload();
    if (g.cfg.mode === 'siege') this.updateUseKey(dt);
    else if (actionHit('use')) g.tryPickup(this);
    if (actionHit('melee') && this.meleeCd <= 0) this.quickMelee();

    // ---------- firing ----------
    const holdingFire = actionDown('fire');
    const canShoot = this.meleeT <= 0 && this.raiseT <= 0 && !this.sprinting;
    if (holdingFire && canShoot && ars.canFire() && (w.auto || !this._semiLatch)) {
      this.fire();
      if (!w.auto) this._semiLatch = true;      // semi-autos need a fresh click
    }
    if (!holdingFire) { this._semiLatch = false; ars.sprayIdle = true; }

    // dry fire + optional auto reload
    if (holdingFire && canShoot && !w.melee && ars.ammo.mag <= 0 && !ars.reloading && ars.fireTimer <= 0 && ars.swapT <= 0) {
      audio.click(null, { freq: 700, dur: 0.05, vol: 0.25 });
      ars.fireTimer = 0.3;
      if (settings.autoReload) ars.startReload();
    }

    this.updateCamera(dt, false);
  }

  fire() {
    const g = this.game, ars = this.arsenal, w = this.weapon;
    const speedFrac = this.speed / MOVE.walk;
    const aimed = this.adsAmt > 0.8;
    const spread = ars.currentSpread(speedFrac, !this.grounded, aimed, this.crouching, w);
    const sprayIdx = ars.sprayIndex;           // read before the shot advances it
    const dir = this.aimDir(_dir).clone();
    const muzzle = g.viewModel.muzzleWorld(_mz).clone();
    const vmMuzzle = g.viewModel.muzzleLocal(_vml).clone();

    fireWeapon(g, this, dir, spread, { origin: this.eyePos().clone(), muzzle, vmMuzzle });
    g.onGunshot(this.pos, this);               // bots hear you shoot

    // learnable recoil: the pattern is fixed, the jitter is small
    const [h, v] = recoilStep(w, sprayIdx);
    const j = 1 + rand(-w.recoilJitter, w.recoilJitter);
    const adsCut = lerp(1, 0.78, this.adsAmt);
    this.recoilPitch += v * DEG * j * adsCut * (w.recoilVMul ?? 1);
    this.recoilYaw += h * DEG * j * adsCut * (w.recoilHMul ?? 1);
    this.recoilHold = 0.12;

    g.viewModel.onFire(w);
    this.addShake(w.shakeAmt * 0.5);
    this.lastFireAt = g.time;
    if (w.shellEject) g.fx.shell(g.viewModel.muzzleLocal(_vml), { x: 1, y: 0.6, z: 0 });
  }

  quickMelee() {
    const g = this.game;
    this.meleeT = 0.45; this.meleeCd = 0.75;
    setTimeout(() => {
      if (!this.alive) return;
      const dir = this.aimDir(_dir).clone();
      const origin = this.eyePos().clone();
      const prev = this.arsenal.current;
      this.arsenal.current = 'knife';
      this.arsenal.fireTimer = 0;
      fireWeapon(g, this, dir, 0, { origin, muzzle: origin.clone().addScaledVector(dir, 0.6) });
      this.arsenal.current = prev;
      this.arsenal.fireTimer = 0.12;
    }, 130);
    audio.click(null, { freq: 500, dur: 0.09, vol: 0.2 });
  }

  /**
   * One key does the contextual job: barricade a frame while setting up,
   * plant on site as an attacker, pull the defuser as a defender.
   */
  updateUseKey(dt) {
    const g = this.game;
    const holding = actionDown('use');
    const prep = g.siege.phase === 'prep';
    const side = g.sideOf(this);

    if (prep && side === 'def') {
      const opening = g.gadgets.nearestOpening(this.pos, 2.4);
      if (!holding || !opening) {
        this.barricadeT = 0;
        g.hud.setInteract(null);
        return;
      }
      this.barricadeT = (this.barricadeT || 0) + dt;
      if (this.barricadeT >= 1.2) {
        this.barricadeT = 0;
        g.gadgets.buildBarricade(this, opening);
        g.hud.pickupToast('BARRICADED', '#c99a5a');
      }
      g.hud.setInteract('BARRICADING', (this.barricadeT || 0) / 1.2);
      return;
    }

    if (holding) {
      const r = g.siege.interact(this, dt);
      g.hud.setInteract(r?.label ?? null, r?.frac ?? 0);
      this.interacting = !!r;
    } else if (this.interacting) {
      g.siege.releaseInteract(this); g.hud.setInteract(null); this.interacting = false;
    } else g.hud.setInteract(null);
  }

  /** climb a window sill or low ledge you are facing */
  tryVault() {
    const g = this.game;
    _dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _mz.set(this.pos.x, this.pos.y + 0.85, this.pos.z);
    const hit = g.world.raycast(_mz, _dir, 1.25);
    if (!hit) return false;
    const top = hit.box.max.y;
    const rise = top - this.pos.y;
    if (rise < 0.45 || rise > 1.75) return false;
    const lx = hit.point.x + _dir.x * 0.95, lz = hit.point.z + _dir.z * 0.95;
    if (!bodyFree(g.world, lx, top + 0.06, lz, MOVE.radius, MOVE.height)) return false;
    this.vault = {
      t: 0, dur: 0.42,
      from: this.pos.clone(),
      to: new THREE.Vector3(lx, top + 0.06, lz),
      peak: Math.max(top, this.pos.y) + 0.45,
    };
    this.vel.set(0, 0, 0);
    audio.footstep(this.pos, true);
    return true;
  }

  updateVault(dt) {
    const v = this.vault;
    v.t += dt;
    const t = clamp(v.t / v.dur, 0, 1);
    const ease = t * t * (3 - 2 * t);
    this.pos.lerpVectors(v.from, v.to, ease);
    this.pos.y = (1 - ease) * v.from.y + ease * v.to.y + Math.sin(t * Math.PI) * 0.28;
    this.height = MOVE.height * (1 - 0.25 * Math.sin(t * Math.PI));
    if (t >= 1) {
      this.pos.copy(v.to);
      this.height = MOVE.height;
      this.vault = null;
      this.grounded = true;
      this.landT = 0.18;
    }
  }

  /** lean as a toggle (default) or a hold, per settings */
  readLean() {
    if (!settings.toggleLean) {
      return (actionDown('leanRight') ? 1 : 0) - (actionDown('leanLeft') ? 1 : 0);
    }
    if (actionHit('leanLeft')) this.leanState = this.leanState === -1 ? 0 : -1;
    if (actionHit('leanRight')) this.leanState = this.leanState === 1 ? 0 : 1;
    if (this.sprinting) this.leanState = 0;          // you cannot sprint-lean
    return this.leanState;
  }

  useGadget() {
    const g = this.game, op = this.operator;
    if (!op) return;
    if (op.gadget.id === 'nitro' && g.gadgets.detonateRemote(this)) return;
    if (this.gadgetCount <= 0) { g.hud.pickupToast('NO GADGETS LEFT', '#ff7a90'); return; }
    this.gadgetCount--;
    const dir = this.aimDir(_dir).clone();
    dir.y += 0.12;
    g.gadgets.throwGadget(this, op.gadget.id, dir.normalize(), 1);
    g.hud.pickupToast(`${GADGET_INFO[op.gadget.id].name} THROWN`, '#ffd60a');
  }

  useAbility() {
    const g = this.game, op = this.operator;
    if (!op) return;
    if (this.abilityCd > 0) return;
    if (this.abilityCharges <= 0) { g.hud.pickupToast('ABILITY EXHAUSTED', '#ff7a90'); return; }
    const res = g.gadgets.useAbility(this, op);
    if (!res.ok) { if (res.msg) g.hud.pickupToast(res.msg, '#ff7a90'); return; }
    this.abilityCharges--;
    this.abilityCd = op.ability.cooldown;
    g.hud.pickupToast(`${op.ability.name} USED`, '#00ffa8');
  }

  addShake(amount) {
    if (!settings.shake) return;
    this.shake = Math.min(1.4, this.shake + amount * 0.45);
  }

  onDamaged(dmg, attacker, hitInfo, w) {
    if (dmg <= 0) return;
    audio.hurt();
    this.addShake(clamp(dmg / 30, 0.2, 1.1));
    this.game.hud.damageFlash(clamp(dmg / 45, 0.3, 1));
    if (attacker && attacker !== this) {
      const ang = Math.atan2(attacker.pos.x - this.pos.x, -(attacker.pos.z - this.pos.z));
      this.game.hud.damageDirection(ang - this.yaw);
    }
  }

  updateCamera(dt, dead) {
    const g = this.game, cam = g.camera;

    this.shake = damp(this.shake, 0, 6, dt);
    this.shakeT += dt * 32;
    const sh = this.shake * this.shake;
    const shx = Math.sin(this.shakeT * 1.3) * sh * 0.022 + rand(-0.003, 0.003) * sh;
    const shy = Math.cos(this.shakeT * 1.7) * sh * 0.02 + rand(-0.003, 0.003) * sh;

    // lean drives both the camera offset and the roll
    const leanRoll = -(this.leanAmt || 0) * MOVE.leanRoll;
    const strafe = axis('left', 'right');
    const targetRoll = leanRoll - strafe * 0.008;
    this.roll = damp(this.roll, dead ? 0.9 : targetRoll, 10, dt);

    const moving = this.grounded && this.speed > 0.8;
    if (moving) this.bobT += dt * (this.sprinting ? 9.5 : 6.5) * clamp(this.speed / MOVE.walk, 0.5, 1.6);
    const bobAmt = settings.bob ? clamp(this.speed / MOVE.walk, 0, 1) * (1 - this.adsAmt * 0.8) : 0;
    const bobY = moving ? Math.abs(Math.sin(this.bobT)) * 0.028 * bobAmt : 0;
    const bobX = moving ? Math.sin(this.bobT * 0.5) * 0.018 * bobAmt : 0;

    this.landKick = damp(this.landKick, 0, 9, dt);

    const l = this.leanVec;
    const eyeY = dead ? this.pos.y + 0.45 : this.eyeY + bobY - this.landKick - Math.abs(this.leanAmt) * 0.06;
    cam.position.set(this.pos.x + l.x + bobX * 0.4, eyeY, this.pos.z + l.z);
    cam.rotation.set(
      (dead ? -0.35 : this.pitch + this.recoilPitch) + shy,
      (this.yaw + this.recoilYaw) + shx,
      this.roll + shx * 0.4, 'YXZ');

    const w = this.weapon;
    const target = dead ? settings.fov : lerp(settings.fov, settings.fov * w.adsFovMult, this.adsAmt);
    this.fovCur = damp(this.fovCur, target, 14, dt);
    if (Math.abs(cam.fov - this.fovCur) > 0.01) { cam.fov = this.fovCur; cam.updateProjectionMatrix(); }
  }
}
