// ============ ballistics shared by player and bots ============
import * as THREE from 'three';
import { falloffDamage } from '../weapons/defs.js';
import { rand } from '../core/util.js';
import { audio } from '../core/audio.js';

const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _o = new THREE.Vector3(), _p = new THREE.Vector3(), _tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** enough damage that no amount of health survives it — used for lethal headshots */
const LETHAL = 100000;

function coneDir(out, dir, degrees) {
  out.copy(dir);
  if (degrees <= 0.0001) return out;
  _right.crossVectors(dir, UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, dir).normalize();
  const rad = degrees * Math.PI / 180;
  const a = rad * Math.sqrt(Math.random());
  const r = Math.random() * Math.PI * 2;
  out.addScaledVector(_right, Math.tan(a) * Math.cos(r));
  out.addScaledVector(_up, Math.tan(a) * Math.sin(r));
  return out.normalize();
}

/** distance from point P to segment A->A+dir*len */
function pointSegDist(px, py, pz, ax, ay, az, dx, dy, dz, len) {
  let t = (px - ax) * dx + (py - ay) * dy + (pz - az) * dz;
  t = Math.max(0, Math.min(len, t));
  const cx = ax + dx * t - px, cy = ay + dy * t - py, cz = az + dz * t - pz;
  return Math.hypot(cx, cy, cz);
}

/**
 * One trigger pull. Handles pellets, hitscan, melee and projectiles.
 * dirOverride lets bots aim with their own error model.
 */
export function fireWeapon(game, shooter, dirIn, spreadDeg, opts = {}) {
  const w = shooter.arsenal.def;
  shooter.arsenal.consume();
  shooter.shotsFired++;
  const origin = opts.origin ? _o.copy(opts.origin) : shooter.eyePos(_o).clone();
  const muzzle = opts.muzzle || origin;

  // ---- projectile weapons ----
  if (w.projectile) {
    spawnProjectile(game, shooter, muzzle, coneDir(_dir.copy(dirIn), dirIn, spreadDeg * 0.4).clone(), w);
    game.fx.muzzleFlash(muzzle, dirIn, 0.7, 0xffb45a, opts.vmMuzzle);
    audio.gunshot(muzzle, w.sound);
    return;
  }

  // ---- melee ----
  if (w.melee) {
    const hit = traceShot(game, shooter, origin, _dir.copy(dirIn), w.range);
    audio.click(muzzle, { freq: 900, dur: 0.12, vol: 0.35 });
    if (hit.actor) {
      const dmg = hit.part === 'head' && w.headshotKill ? LETHAL
        : w.dmg * (hit.part === 'head' ? w.headMult : hit.part === 'legs' ? w.limbMult : 1);
      resolveHit(game, shooter, hit.actor, dmg, hit, w);
    } else if (hit.world) {
      game.fx.impact(hit.point, hit.normal, 'wall');
    }
    return;
  }

  // ---- hitscan (with pellets) ----
  let anyHit = false, anyKill = false, anyHead = false;
  for (let i = 0; i < w.pellets; i++) {
    coneDir(_dir.copy(dirIn), dirIn, spreadDeg);
    const hit = traceShot(game, shooter, origin, _dir, w.range);
    const end = hit.point;
    if (i === 0 || w.pellets <= 3 || Math.random() < 0.5) {
      game.fx.tracer(muzzle, end, w.tracer, w.tracerWidth);
    }
    // near-miss crack for the local player
    if (shooter !== game.player && game.player.alive) {
      const pl = game.player;
      const d = pointSegDist(pl.pos.x, pl.pos.y + pl.height * 0.6, pl.pos.z,
        origin.x, origin.y, origin.z, _dir.x, _dir.y, _dir.z, origin.distanceTo(end));
      if (d < 2.2) audio.whizby(_tmp.set(pl.pos.x, pl.pos.y + 1.4, pl.pos.z));
    }
    if (hit.actor) {
      const dist = hit.t;
      let dmg = falloffDamage(w, dist);
      if (hit.part === 'head') {
        anyHead = true;
        dmg = w.headshotKill ? LETHAL : dmg * w.headMult;
      } else if (hit.part === 'legs') dmg *= w.limbMult;
      const r = resolveHit(game, shooter, hit.actor, dmg, hit, w);
      anyHit = true; anyKill = anyKill || r.killed;
    } else if (hit.world) {
      game.fx.impact(hit.point, hit.normal, 'wall');
    }
  }
  if (anyHit) {
    shooter.shotsHit++;
    if (anyHead) shooter.headshots++;
    if (shooter === game.player) game.hud.hitmarker(anyKill, anyHead);
    else if (shooter.isBot) shooter.onHitConfirm?.();
  }
  game.fx.muzzleFlash(muzzle, dirIn, w.pellets > 1 ? 0.55 : 0.34, 0xffd28a, opts.vmMuzzle);
  audio.gunshot(muzzle, w.sound);
}

/** raycast the world + all actors; nearest wins */
export function traceShot(game, shooter, origin, dir, maxDist) {
  const wallHit = game.world.raycast(origin, dir, maxDist);
  let bestT = wallHit ? wallHit.dist : maxDist;
  let actor = null, part = null;
  for (const a of game.actors) {
    if (a === shooter || !a.alive) continue;
    if (game.friendly(shooter, a)) continue;      // teammates don't block or take fire
    const h = a.hitTest(origin, dir, bestT);
    if (h && h.t < bestT) { bestT = h.t; actor = a; part = h.part; }
  }
  const point = new THREE.Vector3().copy(dir).multiplyScalar(bestT).add(origin);
  return { t: bestT, point, normal: wallHit && !actor ? wallHit.normal.clone() : dir.clone().negate(), actor, part, world: !actor && !!wallHit };
}

function resolveHit(game, shooter, victim, dmg, hit, w) {
  const headshot = hit.part === 'head';
  const res = victim.applyDamage(dmg, shooter, { weapon: w.id, part: hit.part, headshot });
  shooter.damageDealt += res.dealt;
  game.fx.impact(hit.point, hit.normal, 'flesh');
  audio.impact(hit.point, 'flesh');
  victim.onDamaged?.(res.dealt, shooter, hit, w);
  if (shooter === game.player) game.hud.floatDamage(hit.point, Math.round(res.dealt), headshot);
  if (res.killed) game.onKill(shooter, victim, w.id, headshot);
  return res;
}

/* ---------- projectiles ---------- */
export function spawnProjectile(game, owner, pos, dir, w) {
  const geo = game._rocketGeo || (game._rocketGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.62, 8));
  const mat = game._rocketMat || (game._rocketMat = new THREE.MeshLambertMaterial({ color: 0xd8dde4, emissive: 0x441100 }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  game.scene.add(mesh);
  const p = {
    pos: pos.clone(), vel: dir.clone().multiplyScalar(w.projectile.speed),
    def: w, owner, life: 6, mesh, trail: 0,
  };
  game.projectiles.push(p);
  return p;
}

export function updateProjectiles(game, dt) {
  const list = game.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    const pr = p.def.projectile;
    p.vel.y -= pr.gravity * dt;
    const stepLen = p.vel.length() * dt;
    _dir.copy(p.vel).normalize();

    // world / actor collision along this step
    const hit = game.world.raycast(p.pos, _dir, stepLen + pr.radius);
    let actorHit = null, actorT = stepLen + pr.radius;
    for (const a of game.actors) {
      if (a === p.owner || !a.alive) continue;
      if (game.friendly(p.owner, a)) continue;
      const h = a.hitTest(p.pos, _dir, actorT);
      if (h && h.t < actorT) { actorT = h.t; actorHit = a; }
    }
    const wallT = hit ? hit.dist : Infinity;

    if (actorHit && actorT <= wallT) {
      _p.copy(_dir).multiplyScalar(actorT).add(p.pos);
      explode(game, p, _p, actorHit);
      cleanupProjectile(game, list, i, p); continue;
    }
    if (hit && wallT <= stepLen + pr.radius) {
      _p.copy(hit.point).addScaledVector(hit.normal, 0.12);
      explode(game, p, _p, null);
      cleanupProjectile(game, list, i, p); continue;
    }

    p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(UP, _dir);
    p.trail -= dt;
    if (p.trail <= 0) { p.trail = 0.016; game.fx.smokeTrail(p.pos); }
    if (p.life <= 0) { explode(game, p, p.pos, null); cleanupProjectile(game, list, i, p); }
  }
}

function cleanupProjectile(game, list, i, p) {
  game.scene.remove(p.mesh);
  list.splice(i, 1);
}

export function explode(game, proj, at, directVictim) {
  const w = proj.def, pr = w.projectile;
  game.fx.explosion(at, pr.splash);
  audio.explosion(at);
  game.shakeFromExplosion(at, pr.splash);

  if (directVictim) {
    const res = directVictim.applyDamage(w.dmg, proj.owner, { weapon: w.id, part: 'body' });
    proj.owner.damageDealt += res.dealt;
    directVictim.onDamaged?.(res.dealt, proj.owner, { point: at, part: 'body' }, w);
    if (proj.owner === game.player) game.hud.floatDamage(at, Math.round(res.dealt), false);
    if (res.killed) game.onKill(proj.owner, directVictim, w.id, false);
  }

  for (const a of game.actors) {
    if (!a.alive) continue;      // a direct hit takes the impact damage AND the blast
    const isSelf = a === proj.owner;
    if (!isSelf && game.friendly(proj.owner, a)) continue;
    _tmp.set(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
    const d = _tmp.distanceTo(at);
    if (d > pr.splash) continue;
    if (!game.world.losClear(at, _tmp)) continue;
    const t = 1 - d / pr.splash;
    let dmg = pr.splashDmg * (t * t * 0.75 + t * 0.25);
    if (isSelf) dmg *= pr.selfMult;
    // knockback — this is what makes rocket jumps work
    _tmp.sub(at).normalize();
    const kb = pr.knock * (0.35 + t * 0.85) * (isSelf ? 1.35 : 1);
    a.vel.addScaledVector(_tmp, kb);
    a.vel.y = Math.max(a.vel.y, kb * 0.55);
    a.grounded = false;
    const res = a.applyDamage(dmg, proj.owner, { weapon: w.id, part: 'body', splash: true });
    if (!isSelf) proj.owner.damageDealt += res.dealt;
    a.onDamaged?.(res.dealt, proj.owner, { point: at, part: 'body', splash: true }, w);
    if (proj.owner === game.player && !isSelf && res.dealt > 0) {
      game.hud.hitmarker(res.killed, false);
      game.hud.floatDamage(_tmp.copy(a.pos).setY(a.pos.y + a.height * 0.6), Math.round(res.dealt), false);
    }
    if (res.killed) game.onKill(proj.owner, a, w.id, false);
  }
}
