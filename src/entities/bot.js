// ============ bot AI: perception → decision → aim → move → shoot ============
import * as THREE from 'three';
import { Actor } from './actor.js';
import { stepMovement, MOVE } from './movement.js';
import { BotModel } from './botmodel.js';
import { fireWeapon } from '../game/combat.js';
import { getWeapon, WEAPON_IDS } from '../weapons/defs.js';
import { clamp, damp, lerp, rand, randInt, gauss, angleDiff, pick } from '../core/util.js';
import { bodyFree } from '../world/collision.js';

export const DIFFICULTY = {
  easy: {
    label: 'RECRUIT', sight: 40, fov: 112, react: [0.5, 0.9], aimSpeed: 5, maxTurn: 4.5,
    aimError: 5.5, errPeriod: [0.35, 0.7], fireCone: 8, spreadMult: 1.8, burstMult: 1.4,
    headChance: 0.02, strafeChance: 0.3, jumpChance: 0, coverSkill: 0.15, lead: 0.25,
    moveMult: 0.9, memory: 2.5, reloadEarly: 0.1, holdAngle: 0.1,
  },
  normal: {
    label: 'REGULAR', sight: 52, fov: 132, react: [0.3, 0.52], aimSpeed: 8, maxTurn: 7,
    aimError: 3.2, errPeriod: [0.3, 0.55], fireCone: 6, spreadMult: 1.3, burstMult: 1.15,
    headChance: 0.08, strafeChance: 0.5, jumpChance: 0.01, coverSkill: 0.4, lead: 0.55,
    moveMult: 1.0, memory: 4, reloadEarly: 0.2, holdAngle: 0.3,
  },
  hard: {
    label: 'VETERAN', sight: 66, fov: 152, react: [0.18, 0.3], aimSpeed: 12, maxTurn: 10,
    aimError: 1.8, errPeriod: [0.25, 0.45], fireCone: 4.2, spreadMult: 1.0, burstMult: 1.0,
    headChance: 0.22, strafeChance: 0.62, jumpChance: 0.03, coverSkill: 0.7, lead: 0.8,
    moveMult: 1.02, memory: 6, reloadEarly: 0.3, holdAngle: 0.55,
  },
  insane: {
    label: 'NIGHTMARE', sight: 85, fov: 185, react: [0.09, 0.17], aimSpeed: 17, maxTurn: 14,
    aimError: 0.95, errPeriod: [0.18, 0.34], fireCone: 3, spreadMult: 0.85, burstMult: 0.9,
    headChance: 0.45, strafeChance: 0.75, jumpChance: 0.05, coverSkill: 0.9, lead: 1.0,
    moveMult: 1.05, memory: 8, reloadEarly: 0.4, holdAngle: 0.75,
  },
};

const PREF_RANGE = { shotgun: 7, smg: 12, rifle: 20, sniper: 38, pistol: 14, revolver: 17, lmg: 24, rocket: 18, knife: 2 };
const WEAPON_RANK = { knife: 0, pistol: 1, smg: 2, shotgun: 3, revolver: 3, rifle: 4, lmg: 4, sniper: 5, rocket: 5 };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _eye = new THREE.Vector3(), _aim = new THREE.Vector3();

export class Bot extends Actor {
  constructor(game, opts) {
    super(game, { ...opts, isBot: true });
    this.cfg = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.difficulty = opts.difficulty;
    this.model = new BotModel(game.scene, opts.color, opts.accent, this.name);
    this.model.setWeapon(this.arsenal.current);

    this.state = 'roam';
    this.target = null; this.trackTime = 0;
    this.lastSeen = new THREE.Vector3(); this.lastSeenT = -99;
    this.canSee = false;
    this.path = null; this.pathIdx = 0; this.dest = null;
    this.repathT = rand(0, 0.5);
    this.senseT = rand(0, 0.15);
    this.reactT = 0;
    this.burstLeft = 0; this.pauseT = 0;
    this.errYaw = 0; this.errPitch = 0; this.errT = 0;
    this.strafeDir = pick([-1, 1]); this.strafeT = rand(0.4, 1.2);
    this.jumpT = rand(1, 3);
    this.stuckT = 0; this.lastPosCheck = new THREE.Vector3();
    this.deadT = 0;
    this.wanderLook = rand(0, 6.28);
    this.speedMult = this.cfg.moveMult;
    this.pickupCd = 0;
  }

  /* ---------- lifecycle ---------- */
  spawn(pos) {
    this.resetForSpawn(pos);
    this.state = 'roam'; this.target = null; this.path = null; this.dest = null;
    this.canSee = false; this.reactT = 0; this.deadT = 0;
    this.model.setVisible(true);
    this.model.root.rotation.z = 0;
    this.model.setWeapon(this.arsenal.current);
    this.game.fx.spawnBeam(pos);
  }

  onDamaged(dmg, attacker, hitInfo) {
    this.model.hitFlash();
    if (!attacker || attacker === this) return;
    // getting shot from off-screen snaps their attention around
    if (!this.canSee || !this.target) {
      this.lastSeen.copy(attacker.pos); this.lastSeenT = this.game.time;
      if (!this.target) { this.target = attacker; this.reactT = rand(this.cfg.react[0], this.cfg.react[1]) * 1.3; }
      if (this.state === 'roam') this.setState('hunt');
    }
  }

  onHitConfirm() { this.trackTime += 0.15; }

  setState(s) { if (this.state !== s) { this.state = s; this.path = null; } }

  /* ---------- main update ---------- */
  update(dt) {
    const g = this.game;
    if (!this.alive) {
      this.deadT += dt;
      this.model.setDead(true, dt);
      if (this.deadT > 2.2) this.model.setVisible(false);
      return;
    }

    if (g.frozen) { this.model.update(dt, this, g.camera.position); return; }

    this.arsenal.update(dt);
    this.senseT -= dt; this.repathT -= dt; this.pickupCd -= dt;
    if (this.senseT <= 0) { this.senseT = rand(0.1, 0.18); this.sense(); }

    // fresh line of sight every frame while engaged (cheap; broadphase-backed)
    if (this.target && this.target.alive) {
      this.eyePos(_eye);
      _v.set(this.target.pos.x, this.target.pos.y + this.target.height * 0.6, this.target.pos.z);
      const dist = _eye.distanceTo(_v);
      this.canSee = dist <= this.cfg.sight && g.world.losClear(_eye, _v);
      if (this.canSee) { this.lastSeen.copy(this.target.pos); this.lastSeenT = g.time; this.trackTime += dt; }
      else this.trackTime = Math.max(0, this.trackTime - dt * 2);
      this.targetDist = dist;
    } else {
      this.canSee = false; this.target = null; this.trackTime = 0;
    }

    // shouldering the weapon costs mobility and buys accuracy, same as the player
    this.adsing = !!(this.target && this.canSee && this.trackTime > 0.12 &&
                     (this.targetDist ?? 99) > 5 && !this.arsenal.def.melee);

    this.think(dt);
    this.aim(dt);
    this.move(dt);
    this.shoot(dt);
    this.manageWeapon(dt);

    this.model.update(dt, this, g.camera.position);
    this.model.setWeapon(this.arsenal.current);
  }

  /* ---------- perception ---------- */
  sense() {
    const g = this.game;
    this.eyePos(_eye);
    let best = null, bestScore = Infinity;
    const fwd = _v2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const fovCos = Math.cos((this.cfg.fov * 0.5) * Math.PI / 180);

    for (const a of g.actors) {
      if (a === this || !a.alive || g.friendly(this, a)) continue;
      _v.set(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z);
      const d = _eye.distanceTo(_v);
      if (d > this.cfg.sight) continue;
      const toA = _v.clone().sub(_eye).normalize();
      const inFov = (toA.x * fwd.x + toA.z * fwd.z) > fovCos || d < 7;
      if (!inFov) continue;
      if (!g.world.losClear(_eye, _v)) continue;
      let score = d;
      if (a === this.target) score -= 14;               // target stickiness
      if (a === this.lastAttacker) score -= 8;
      if (a === g.player) score -= 3;                   // bots love hunting the player a little
      if (score < bestScore) { bestScore = score; best = a; }
    }

    if (best && best !== this.target) {
      this.target = best;
      this.reactT = rand(this.cfg.react[0], this.cfg.react[1]);
      this.trackTime = 0;
      this.burstLeft = 0; this.pauseT = 0;
      this.errT = 0;
    }
  }

  /** called by the game when a shot is fired nearby */
  hearShot(pos, shooter) {
    if (!this.alive || this.game.friendly(this, shooter)) return;
    const d = this.pos.distanceTo(pos);
    if (d > 42) return;
    if (!this.target) {
      this.lastSeen.copy(pos); this.lastSeenT = this.game.time;
      if (this.state === 'roam' && Math.random() < 0.75) this.setState('hunt');
    }
  }

  /* ---------- decision making ---------- */
  think(dt) {
    const g = this.game, ars = this.arsenal;
    this.reactT = Math.max(0, this.reactT - dt);

    const lowHp = this.health < 42;
    const noAmmo = !ars.def.melee && ars.ammo.mag <= 0 && ars.ammo.reserve <= 0;
    const memoryFresh = g.time - this.lastSeenT < this.cfg.memory;

    // retreat for health when hurt and skilled enough to think about it
    if (lowHp && Math.random() < 0.02 + this.cfg.coverSkill * 0.03 && this.state !== 'pickup') {
      const p = g.nearestPickup(this.pos, this.health < 42 ? 'health' : 'shield', 45);
      if (p) { this.pickupTarget = p; this.setState('pickup'); }
    }
    if (noAmmo && this.state !== 'pickup') {
      const p = g.nearestPickup(this.pos, 'ammo', 60);
      if (p) { this.pickupTarget = p; this.setState('pickup'); }
    }

    switch (this.state) {
      case 'roam':
        if (this.target && this.canSee) this.setState('engage');
        else if (memoryFresh && this.target) this.setState('hunt');
        break;
      case 'engage':
        if (!this.target || !this.target.alive) { this.setState('roam'); this.target = null; break; }
        if (!this.canSee) { if (memoryFresh) this.setState('hunt'); else this.setState('roam'); break; }
        // duck into cover to reload when the skill level supports it
        if (ars.reloading && Math.random() < this.cfg.coverSkill * 0.02) this.setState('cover');
        if (lowHp && this.cfg.coverSkill > 0.5 && Math.random() < 0.008) this.setState('cover');
        break;
      case 'hunt':
        if (this.target && this.canSee) this.setState('engage');
        else if (!memoryFresh) { this.setState('roam'); this.target = null; }
        break;
      case 'cover':
        if (!ars.reloading && this.health > 45) this.setState(this.target && this.canSee ? 'engage' : 'roam');
        break;
      case 'pickup':
        if (!this.pickupTarget || !this.pickupTarget.active) this.setState(this.target && this.canSee ? 'engage' : 'roam');
        else if (this.pos.distanceTo(this.pickupTarget.pos) < 2) this.setState('roam');
        else if (this.canSee && this.target && this.health > 65) this.setState('engage');
        break;
    }
  }

  /* ---------- aiming ---------- */
  aim(dt) {
    const cfg = this.cfg;
    let desiredYaw = this.yaw, desiredPitch = this.pitch;

    if (this.target && (this.canSee || this.game.time - this.lastSeenT < 1.2)) {
      const t = this.target;
      this.eyePos(_eye);
      // aim at chest, sometimes at the head
      if (this.headTargetT === undefined || this.headTargetT <= 0) {
        this.headTargetT = rand(0.3, 0.9);
        this.aimHigh = Math.random() < cfg.headChance;
      }
      this.headTargetT -= dt;
      const aimY = t.pos.y + (this.aimHigh ? t.height - 0.2 : t.height * 0.58);
      _aim.set(t.pos.x, aimY, t.pos.z);

      // prediction — essential for the rocket launcher, subtle for hitscan
      const w = this.arsenal.def;
      const dist = _eye.distanceTo(_aim);
      if (w.projectile) {
        const tof = dist / w.projectile.speed;
        _aim.addScaledVector(t.vel, tof * cfg.lead);
        _aim.y += 0.5 * w.projectile.gravity * tof * tof;
      } else {
        _aim.addScaledVector(t.vel, 0.035 * cfg.lead);
      }

      _v.copy(_aim).sub(_eye);
      desiredYaw = Math.atan2(-_v.x, -_v.z);
      desiredPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));

      // aim error: re-rolled periodically, tightens the longer they track you
      this.errT -= dt;
      if (this.errT <= 0) {
        this.errT = rand(cfg.errPeriod[0], cfg.errPeriod[1]);
        const settle = lerp(1.7, 0.55, clamp(this.trackTime / 1.4, 0, 1));
        const moveErr = 1 + clamp(t.speed, 0, 12) * 0.055 + clamp(this.speed, 0, 12) * 0.03;
        const distErr = 1 + clamp(dist / 60, 0, 1) * 0.7;
        const mag = cfg.aimError * settle * moveErr * distErr * Math.PI / 180;
        this.errYaw = gauss() * mag;
        this.errPitch = gauss() * mag * 0.7;
      }
      desiredYaw += this.errYaw; desiredPitch += this.errPitch;
      this.aimDistance = dist;
    } else if (this.game.time - this.lastSeenT < this.cfg.memory && this.lastSeenT > 0) {
      _v.copy(this.lastSeen).sub(this.pos);
      desiredYaw = Math.atan2(-_v.x, -_v.z);
      desiredPitch = 0;
    } else if (this.moveDir) {
      // look where you're going, with a slow scan
      this.wanderLook += dt * 0.6;
      desiredYaw = Math.atan2(-this.moveDir.x, -this.moveDir.z) + Math.sin(this.wanderLook) * 0.35;
      desiredPitch = 0;
    }

    const speed = this.canSee ? this.cfg.aimSpeed : this.cfg.aimSpeed * 0.55;
    const dy = angleDiff(this.yaw, desiredYaw);
    const dp = angleDiff(this.pitch, desiredPitch);
    const maxStep = this.cfg.maxTurn * dt;
    this.yaw += clamp(dy * speed * dt, -maxStep, maxStep);
    this.pitch += clamp(dp * speed * dt, -maxStep, maxStep);
    this.pitch = clamp(this.pitch, -1.3, 1.3);
    this.aimOff = Math.abs(dy) + Math.abs(dp) * 0.6;
  }

  /* ---------- movement ---------- */
  move(dt) {
    const g = this.game;
    let forward = 0, strafe = 0, jump = false, sprint = false, crouch = false;

    let goal = null;
    if (this.state === 'engage' && this.target) goal = null;                 // handled below
    else if (this.state === 'hunt') goal = this.lastSeen;
    else if (this.state === 'pickup' && this.pickupTarget) goal = this.pickupTarget.pos;
    else if (this.state === 'cover') {
      if (!this.coverSpot || this.pos.distanceTo(this.coverSpot) < 2.2) {
        const threat = this.target ? _v.set(this.target.pos.x, this.target.pos.y + 1.4, this.target.pos.z) : this.lastSeen;
        const c = g.nav.findCover(this.pos, threat, 24);
        this.coverSpot = c ? new THREE.Vector3(c.x, c.y, c.z) : null;
        this.path = null;
      }
      goal = this.coverSpot;
    }

    if (this.state === 'engage' && this.target) {
      // ---- combat footwork ----
      const w = this.arsenal.def;
      const pref = PREF_RANGE[w.id] ?? 16;
      const d = this.targetDist ?? 99;
      const canReachDirect = this.canSee;

      if (d > pref * 1.35) forward = 1;
      else if (d < pref * 0.62) forward = -1;
      else forward = 0;

      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = rand(0.7, 1.9);
        this.strafeDir = Math.random() < this.cfg.strafeChance ? pick([-1, 1]) : 0;
      }
      strafe = this.strafeDir;
      sprint = forward > 0.5 && d > pref * 2.2;

      // settle before shooting: a bot that is nearly on target stops moving,
      // exactly like a player counter-strafing for an accurate shot
      const onTarget = (this.aimOff ?? 9) < this.cfg.fireCone * Math.PI / 180 * 2.2;
      if (onTarget && d < pref * 1.5 && Math.random() < 0.5 + this.cfg.holdAngle * 0.5) {
        forward *= 0.15; strafe *= 0.2; sprint = false;
      }
      // hold long angles from a crouch
      crouch = onTarget && d > pref * 1.1 && Math.abs(forward) < 0.2 && Math.random() < this.cfg.holdAngle;

      // don't strafe off a ledge or into a wall
      if (strafe && !this.probeSafe(strafe, 0)) { this.strafeDir *= -1; strafe = this.strafeDir; if (!this.probeSafe(strafe, 0)) strafe = 0; }
      if (forward !== 0 && !this.probeSafe(0, forward)) forward = 0;

      // if we can't see them but are engaging, path instead of blind-walking
      if (!canReachDirect) goal = this.lastSeen;

      // the odd hop over cover — jumping is a liability now, so it is rare
      this.jumpT -= dt;
      if (this.jumpT <= 0) {
        this.jumpT = rand(2.5, 6);
        if (Math.random() < this.cfg.jumpChance * 4 && this.grounded && d < 20) jump = true;
      }
      // knife rushers charge
      if (w.melee) { forward = 1; sprint = true; strafe *= 0.4; }
    }

    if (goal || this.state === 'roam') {
      if (this.state === 'roam' && (!this.dest || this.pos.distanceTo(this.dest) < 3 || this.repathT <= 0)) {
        if (!this.dest || this.pos.distanceTo(this.dest) < 3) {
          // with a round clock running down, sweep toward the enemy instead of wandering
          const hunt = g.roundPressure && Math.random() < 0.8 ? this.pickHuntSpot() : null;
          const n = hunt || g.nav.randomNode();
          this.dest = new THREE.Vector3(n.x, n.y, n.z);
          this.path = null;
        }
      }
      const target = goal || this.dest;
      if (target) {
        const dir = this.followPath(target, dt);
        if (dir) {
          // convert world direction to local forward/strafe
          const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
          const f = -sy * dir.x - cy * dir.z;
          const s = cy * dir.x - sy * dir.z;
          if (this.state === 'engage') {
            forward = clamp(forward + f * 0.8, -1, 1);
            strafe = clamp(strafe + s * 0.8, -1, 1);
          } else {
            forward = f; strafe = s;
            sprint = this.state !== 'pickup' || this.pos.distanceTo(target) > 8;
          }
          if (dir.needJump && this.grounded) jump = true;
        }
      }
    }

    // ---- stuck recovery ----
    this.stuckT += dt;
    if (this.stuckT > 0.85) {
      const moved = this.pos.distanceTo(this.lastPosCheck);
      const wanted = Math.abs(forward) + Math.abs(strafe) > 0.2;
      if (wanted && moved < 0.5) {
        jump = true; this.path = null; this.repathT = 0;
        this.strafeDir *= -1;
        if (moved < 0.15) { this.dest = null; this.stuckCount = (this.stuckCount || 0) + 1; }
        if ((this.stuckCount || 0) > 3) { this.stuckCount = 0; const n = this.game.nav.randomNode(); this.dest = new THREE.Vector3(n.x, n.y, n.z); }
      } else this.stuckCount = 0;
      this.lastPosCheck.copy(this.pos); this.stuckT = 0;
    }

    this.moveDir = _v2.set(-Math.sin(this.yaw) * forward, 0, -Math.cos(this.yaw) * forward).clone();
    stepMovement(this, { forward, strafe, jump, sprint, crouch }, dt, g.world, g);

    // footsteps for nearby ears
    if (this.grounded && this.speed > 2) {
      this.stepDist = (this.stepDist || 0) + this.speed * dt;
      if (this.stepDist > 2.0) { this.stepDist = 0; audioFootstep(this); }
    }
  }

  /** a spot near a living enemy — used to break round stalemates */
  pickHuntSpot() {
    const g = this.game;
    const foes = g.actors.filter(a => a.alive && a !== this && !g.friendly(this, a));
    if (!foes.length) return null;
    const foe = pick(foes);
    const n = g.nav.nodes[g.nav.nearest(foe.pos)];
    return n && n.open ? n : null;
  }

  /** true if moving this way keeps us on solid ground */
  probeSafe(strafe, forward) {
    const g = this.game;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dx = -sy * forward + cy * strafe;
    const dz = -cy * forward - sy * strafe;
    const l = Math.hypot(dx, dz) || 1;
    const px = this.pos.x + (dx / l) * 1.4, pz = this.pos.z + (dz / l) * 1.4;
    if (!bodyFree(g.world, px, this.pos.y + 0.1, pz, MOVE.radius, this.height)) return false;
    // ledge check — allow small drops only
    _v.set(0, -1, 0);
    const hit = g.world.raycast(_v2.set(px, this.pos.y + 0.3, pz), _v, 6.5);
    if (!hit) return false;
    return (this.pos.y + 0.3 - hit.point.y) < 4.2;
  }

  /** A* path following with straight-line shortcuts; returns a world direction */
  followPath(target, dt) {
    const g = this.game;
    // direct walk if the way is clear
    if (g.nav.canWalkStraight(this.pos, target) && this.pos.distanceTo(target) < 26) {
      this.path = null;
      return _v.copy(target).sub(this.pos).setY(0).normalize();
    }
    if (!this.path || this.repathT <= 0 || this.pathIdx >= this.path.length) {
      if (g.pathBudget > 0) {
        g.pathBudget--;
        this.path = g.nav.findPath(this.pos, target);
        this.pathIdx = 0;
        this.repathT = rand(0.7, 1.4);
      } else this.repathT = 0.1;
    }
    if (!this.path || !this.path.length) {
      return _v.copy(target).sub(this.pos).setY(0).normalize();
    }
    // advance through reached waypoints, skipping ahead where we can
    let wp = this.path[this.pathIdx];
    while (wp && this.pos.distanceTo(wp) < 1.7) { this.pathIdx++; wp = this.path[this.pathIdx]; }
    for (let k = Math.min(this.path.length - 1, this.pathIdx + 3); k > this.pathIdx; k--) {
      if (g.nav.canWalkStraight(this.pos, this.path[k])) { this.pathIdx = k; break; }
    }
    wp = this.path[this.pathIdx];
    if (!wp) { this.path = null; return null; }
    const out = _v.copy(wp).sub(this.pos);
    const climb = out.y;
    out.y = 0;
    if (out.lengthSq() < 1e-4) return null;
    out.normalize();
    out.needJump = climb > 0.7 && climb < 2.6;
    return out;
  }

  /* ---------- shooting ---------- */
  shoot(dt) {
    const g = this.game, ars = this.arsenal, w = ars.def;
    this.pauseT = Math.max(0, this.pauseT - dt);
    if (!this.target || !this.canSee || this.reactT > 0 || this.pauseT > 0) return;
    if (ars.busy || !ars.canFire()) return;

    // melee needs contact
    if (w.melee) {
      if ((this.targetDist ?? 99) > 2.6) return;
    } else {
      // only shoot when actually pointed at them
      const coneRad = this.cfg.fireCone * Math.PI / 180;
      if ((this.aimOff ?? 9) > coneRad) return;
      // and only if the muzzle line is clear (don't shoot our own cover)
      this.eyePos(_eye);
      this.dirVec(_v);
      const wall = g.world.raycast(_eye, _v, Math.min(this.targetDist ?? 60, 60));
      if (wall && wall.dist < (this.targetDist ?? 60) - 0.8) return;
      // rockets at point blank = suicide
      if (w.projectile && (this.targetDist ?? 99) < 6.5) return;
    }

    if (this.burstLeft <= 0) {
      this.burstLeft = Math.max(1, Math.round(randInt(w.botBurst[0], w.botBurst[1]) * this.cfg.burstMult));
    }

    const spread = ars.currentSpread(this.speed / MOVE.walk, !this.grounded, this.adsing, this.crouching) * this.cfg.spreadMult;
    const dir = this.dirVec(new THREE.Vector3());
    const muzzle = this.model.muzzleWorld(new THREE.Vector3());
    fireWeapon(g, this, dir, spread, { origin: this.eyePos().clone(), muzzle });
    g.onGunshot(this.pos, this);

    this.burstLeft--;
    if (this.burstLeft <= 0 || (!w.auto && !w.melee)) {
      this.pauseT = rand(w.botPause[0], w.botPause[1]) * this.cfg.burstMult;
      this.burstLeft = 0;
    }
  }

  /* ---------- weapon housekeeping ---------- */
  manageWeapon(dt) {
    const ars = this.arsenal, w = ars.def;
    if (w.melee) return;
    const a = ars.ammo;
    if (!ars.reloading) {
      const lull = !this.canSee || !this.target;
      if (a.mag <= 0 && a.reserve > 0) ars.startReload();
      else if (lull && a.mag < w.mag * (0.3 + this.cfg.reloadEarly) && a.reserve > 0) ars.startReload();
    }
    if (a.mag <= 0 && a.reserve <= 0) {
      // out of ammo → pick the best thing we still have bullets for
      let best = null, bestRank = -1;
      for (const [id, s] of ars.slots) {
        const def = getWeapon(id);
        if (def.melee) continue;
        if (s.mag + s.reserve <= 0) continue;
        const rank = WEAPON_RANK[id] ?? 0;
        if (rank > bestRank) { bestRank = rank; best = id; }
      }
      ars.select(best || 'knife');
    }
  }

  dispose() { this.model.dispose(); }
}

function audioFootstep(bot) {
  const g = bot.game;
  if (!g.player.alive) return;
  const d = bot.pos.distanceTo(g.player.pos);
  if (d < 30) g.audio.footstep(bot.pos, bot.speed > 5);
}
