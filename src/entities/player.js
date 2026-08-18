// ============ the local player ============
import * as THREE from 'three';
import { Actor } from './actor.js';
import { stepMovement, MOVE } from './movement.js';
import { input, down, hit } from '../core/input.js';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { clamp, damp, lerp, rand } from '../core/util.js';
import { fireWeapon } from '../game/combat.js';
import { getWeapon, WEAPON_IDS } from '../weapons/defs.js';

const _dir = new THREE.Vector3(), _mz = new THREE.Vector3(), _vml = new THREE.Vector3();

export class Player extends Actor {
  constructor(game) {
    super(game, { name: 'YOU', team: 0, isBot: false, weapon: settings.loadout });
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.shake = 0; this.shakeT = 0;
    this.fovCur = settings.fov;
    this.roll = 0;
    this.bobT = 0; this.stepDist = 0;
    this.adsing = false; this.adsAmt = 0;
    this.meleeT = 0; this.meleeCd = 0;
    this.sprintLock = 0;
    this.autoReloadT = 0;
    this.landKick = 0;
    this.lastFireAt = -9;
  }

  spawn(pos) {
    this.resetForSpawn(pos);
    this.recoilPitch = this.recoilYaw = 0;
    this.shake = 0; this.roll = 0; this.meleeT = 0;
    this.pitch = 0;
    audio.spawn();
    this.game.fx.spawnBeam(pos);
  }

  /** camera-space aim direction, including recoil */
  aimDir(out = _dir) {
    const p = this.pitch + this.recoilPitch, y = this.yaw + this.recoilYaw;
    const cp = Math.cos(p);
    return out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
  }

  update(dt) {
    const g = this.game;
    if (!this.alive) { this.updateCamera(dt, true); return; }

    // ---------- look ----------
    const sensScale = 0.00205 * settings.sens * (this.adsAmt > 0.1 ? lerp(1, settings.adsSens, this.adsAmt) : 1);
    this.yaw -= input.mouseDX * sensScale;
    this.pitch -= input.mouseDY * sensScale * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.54, 1.54);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // recoil recovery pulls the view back down
    this.recoilPitch = damp(this.recoilPitch, 0, this.arsenal.def.recoilRecover, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, this.arsenal.def.recoilRecover * 0.85, dt);

    // ---------- weapon state ----------
    const ars = this.arsenal;
    ars.update(dt);
    const w = ars.def;
    this.sprintLock = Math.max(0, this.sprintLock - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    if (this.meleeT > 0) this.meleeT = Math.max(0, this.meleeT - dt);

    const wantAds = input.ads && !w.melee && this.meleeT <= 0;
    this.adsing = wantAds && !ars.reloading;
    this.adsAmt = damp(this.adsAmt, this.adsing ? 1 : 0, 16, dt);

    const wantSprint = down('ShiftLeft') && !this.adsing && this.sprintLock <= 0 && !ars.reloading;

    // ---------- movement ----------
    const cmd = {
      forward: (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0),
      strafe: (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0),
      jump: down('Space'),
      sprint: wantSprint,
      crouch: down('ControlLeft') || down('KeyC'),
    };
    this.sprinting = wantSprint && cmd.forward > 0.1 && this.speed > 4;
    stepMovement(this, cmd, dt, g.world, g);

    // footsteps
    if (this.grounded && this.speed > 1.5) {
      this.stepDist += this.speed * dt;
      const gap = this.sprinting ? 2.35 : this.crouching ? 3.2 : 2.0;
      if (this.stepDist > gap) {
        this.stepDist = 0;
        audio.footstep(this.pos, this.sprinting);
      }
    }

    // ---------- weapon switching ----------
    for (let i = 0; i < 8; i++) {
      if (hit('Digit' + (i + 1))) {
        const id = WEAPON_IDS[i];
        if (ars.has(id)) ars.select(id);
        else g.hud.pickupToast(`YOU DON'T HAVE THE ${getWeapon(id).name}`, '#ff7a90');
      }
    }
    if (hit('KeyQ')) ars.select(ars.previous);
    if (input.wheel) ars.cycle(input.wheel > 0 ? 1 : -1);
    if (hit('KeyR')) ars.startReload();
    if (hit('KeyE')) g.tryPickup(this);
    if (hit('KeyF') && this.meleeCd <= 0) this.quickMelee();

    // ---------- firing ----------
    const wantFire = input.fire && this.meleeT <= 0;
    if (wantFire && !ars.triggerHeld) ars.triggerHeld = true;
    if (!input.fire) ars.triggerHeld = false;

    if (wantFire && ars.canFire() && (w.auto || !this._semiLatch)) {
      this.fire();
      if (!w.auto) this._semiLatch = true;    // semi-autos need a fresh click per shot
    }
    if (!input.fire) this._semiLatch = false;

    // dry fire + auto reload
    if (wantFire && !w.melee && ars.ammo.mag <= 0 && !ars.reloading && ars.fireTimer <= 0 && ars.swapT <= 0) {
      audio.click(null, { freq: 700, dur: 0.05, vol: 0.25 });
      ars.fireTimer = 0.25;
      ars.startReload();
    }
    if (!w.melee && ars.ammo.mag <= 0 && !ars.reloading && ars.ammo.reserve > 0) {
      this.autoReloadT += dt;
      if (this.autoReloadT > 0.25) { ars.startReload(); this.autoReloadT = 0; }
    } else this.autoReloadT = 0;

    this.updateCamera(dt, false);
  }

  fire() {
    const g = this.game, ars = this.arsenal, w = ars.def;
    const spread = ars.currentSpread(this.speed > 2.5, !this.grounded, this.adsAmt > 0.85, this.crouching);
    const dir = this.aimDir(_dir).clone();
    const muzzle = g.viewModel.muzzleWorld(_mz).clone();
    const vmMuzzle = g.viewModel.muzzleLocal(_vml).clone();

    fireWeapon(g, this, dir, spread, { origin: this.eyePos().clone(), muzzle, vmMuzzle });
    g.onGunshot(this.pos, this);   // bots hear you shoot

    // recoil: vertical climb + horizontal wander, growing through the spray
    const ramp = 1 + ars.sprayIndex * w.recoilRamp;
    const adsCut = lerp(1, 0.72, this.adsAmt);
    this.recoilPitch += (w.recoilV * Math.PI / 180) * ramp * adsCut;
    this.recoilYaw += (rand(-w.recoilH, w.recoilH) * Math.PI / 180) * ramp * adsCut;
    g.viewModel.onFire(w);
    this.addShake(w.shakeAmt * 0.55);
    this.sprintLock = 0.32;
    this.lastFireAt = g.time;
    if (w.shellEject) g.fx.shell(g.viewModel.muzzleLocal(_vml), { x: 1, y: 0.6, z: 0 });
  }

  quickMelee() {
    const g = this.game;
    this.meleeT = 0.42; this.meleeCd = 0.62;
    const knife = getWeapon('knife');
    const saved = this.arsenal.current;
    setTimeout(() => {
      if (!this.alive) return;
      const dir = this.aimDir(_dir).clone();
      const origin = this.eyePos().clone();
      // temporary knife swing without changing the held weapon
      const prev = this.arsenal.current;
      this.arsenal.current = 'knife';
      this.arsenal.fireTimer = 0;
      fireWeapon(g, this, dir, 0, { origin, muzzle: origin.clone().addScaledVector(dir, 0.6) });
      this.arsenal.current = prev;
      this.arsenal.fireTimer = 0.1;
    }, 120);
    audio.click(null, { freq: 500, dur: 0.09, vol: 0.2 });
  }

  addShake(amount) {
    if (!settings.shake) return;
    this.shake = Math.min(1.6, this.shake + amount * 0.5);
  }

  onDamaged(dmg, attacker, hitInfo, w) {
    if (dmg <= 0) return;
    audio.hurt();
    this.addShake(clamp(dmg / 28, 0.2, 1.3));
    this.game.hud.damageFlash(clamp(dmg / 45, 0.25, 1));
    if (attacker && attacker !== this) {
      const ang = Math.atan2(attacker.pos.x - this.pos.x, -(attacker.pos.z - this.pos.z));
      this.game.hud.damageDirection(ang - this.yaw);
    }
  }

  updateCamera(dt, dead) {
    const g = this.game, cam = g.camera;

    // shake
    this.shake = damp(this.shake, 0, 6, dt);
    this.shakeT += dt * 34;
    const sh = this.shake * this.shake;
    const shx = Math.sin(this.shakeT * 1.3) * sh * 0.028 + rand(-0.004, 0.004) * sh;
    const shy = Math.cos(this.shakeT * 1.7) * sh * 0.026 + rand(-0.004, 0.004) * sh;

    // strafe lean + slide tilt
    const strafe = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
    const targetRoll = -strafe * 0.023 + (this.sliding ? 0.06 : 0);
    this.roll = damp(this.roll, dead ? 0.9 : targetRoll, 8, dt);

    // vertical bob
    const moving = this.grounded && this.speed > 1.2;
    if (moving) this.bobT += dt * (this.sprinting ? 12.5 : 9) * clamp(this.speed / 8, 0.6, 1.4);
    const bobAmt = settings.bob ? clamp(this.speed / 11, 0, 1) * (1 - this.adsAmt * 0.7) : 0;
    const bobY = moving ? Math.abs(Math.sin(this.bobT)) * 0.045 * bobAmt : 0;
    const bobX = moving ? Math.sin(this.bobT * 0.5) * 0.03 * bobAmt : 0;

    this.landKick = damp(this.landKick, 0, 9, dt);

    const eyeY = dead ? this.pos.y + 0.45 : this.eyeY + bobY - this.landKick;
    cam.position.set(this.pos.x + bobX * 0.4, eyeY, this.pos.z);
    cam.rotation.set(
      (dead ? -0.35 : this.pitch + this.recoilPitch) + shy,
      (this.yaw + this.recoilYaw) + shx,
      this.roll + shx * 0.5, 'YXZ');

    // fov: sprint punch + ads zoom
    const w = this.arsenal.def;
    const base = settings.fov;
    const sprintAdd = this.sprinting ? 7 : 0;
    const target = dead ? base : lerp(base + sprintAdd, base * w.adsFovMult, this.adsAmt);
    this.fovCur = damp(this.fovCur, target, 12, dt);
    if (Math.abs(cam.fov - this.fovCur) > 0.01) { cam.fov = this.fovCur; cam.updateProjectionMatrix(); }
  }
}
