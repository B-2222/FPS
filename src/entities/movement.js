// ============ grounded, tactical character movement ============
// Deliberately *not* an arcade mover: no bunny-hopping, no air-strafe acceleration,
// no slide. Speed comes from stance and commitment, so holding an angle beats
// jumping around it.
import * as THREE from 'three';
import { moveBody } from '../world/collision.js';
import { clamp, damp } from '../core/util.js';

export const MOVE = {
  walk: 3.7, sprint: 6.0, crouch: 1.95, ads: 2.35, slow: 1.7,
  groundAccel: 11, airAccel: 1.8,
  friction: 11, gravity: 22, jumpVel: 6.2,
  radius: 0.42, height: 1.82, crouchHeight: 1.15, stepHeight: 0.56,
  leanDist: 0.44, leanRoll: 0.21, leanSpeedMult: 0.55,
  landRecover: 0.3,
};

const _probe = new THREE.Vector3();

function accelerate(vel, wx, wz, wishSpeed, accel, dt) {
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * wishSpeed * dt;
  if (a > add) a = add;
  vel.x += wx * a; vel.z += wz * a;
}

/**
 * cmd: { forward, strafe, jump, sprint, crouch, slow, lean }  — lean is -1..1
 * Mutates actor.pos / actor.vel. Returns the collision result.
 */
export function stepMovement(actor, cmd, dt, world, game) {
  const v = actor.vel, p = actor.pos;

  // ---- wish direction in world space (yaw 0 looks down -Z) ----
  const sy = Math.sin(actor.yaw), cy = Math.cos(actor.yaw);
  let wx = -sy * cmd.forward + cy * cmd.strafe;
  let wz = -cy * cmd.forward - sy * cmd.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 0.0001) { wx /= wl; wz /= wl; } else { wx = wz = 0; }
  const wishing = wl > 0.001;

  // ---- stance ----
  const wantCrouch = cmd.crouch;
  const targetH = wantCrouch ? MOVE.crouchHeight : MOVE.height;
  if (!wantCrouch && actor.height < MOVE.height) {
    const free = !world.overlaps(p.x - MOVE.radius, p.y, p.z - MOVE.radius,
      p.x + MOVE.radius, p.y + MOVE.height, p.z + MOVE.radius, []);
    if (free) actor.height = Math.min(MOVE.height, actor.height + dt * 4.5);
  } else {
    actor.height += (targetH - actor.height) * Math.min(1, dt * 9);
  }
  actor.crouching = wantCrouch || actor.height < MOVE.height - 0.25;

  // ---- lean ----
  updateLean(actor, cmd.lean ?? 0, dt, world);

  // ---- target speed ----
  actor.landT = Math.max(0, (actor.landT ?? 0) - dt);
  let wishSpeed = MOVE.walk;
  if (cmd.slow) wishSpeed = MOVE.slow;
  else if (actor.crouching) wishSpeed = MOVE.crouch;
  else if (cmd.sprint && cmd.forward > 0.1) wishSpeed = MOVE.sprint;
  else if (actor.adsing) wishSpeed = MOVE.ads;
  if (actor.leanAmt) wishSpeed *= 1 - Math.abs(actor.leanAmt) * (1 - MOVE.leanSpeedMult);
  if (actor.landT > 0) wishSpeed *= 0.62;             // brief recovery after landing
  wishSpeed *= actor.speedMult ?? 1;
  actor.sprinting = cmd.sprint && cmd.forward > 0.1 && !actor.crouching && !actor.adsing && actor.grounded;

  // ---- ground / air ----
  if (actor.grounded) {
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.01) {
      const drop = Math.max(sp, 3) * MOVE.friction * dt;
      const ns = Math.max(0, sp - drop) / sp;
      v.x *= ns; v.z *= ns;
    }
    if (wishing) accelerate(v, wx, wz, wishSpeed, MOVE.groundAccel, dt);
  } else if (wishing) {
    // almost no air control: you commit to a jump
    accelerate(v, wx, wz, wishSpeed * 0.85, MOVE.airAccel, dt);
  }

  // ---- jump ----
  if (cmd.jump && actor.grounded && actor.jumpCd <= 0 && !actor.crouching) {
    v.y = MOVE.jumpVel;
    actor.grounded = false; actor.jumpCd = 0.32;
    game?.onJump?.(actor);
  }
  actor.jumpCd = Math.max(0, actor.jumpCd - dt);

  // ---- gravity + integration ----
  v.y = Math.max(v.y - MOVE.gravity * dt, -70);
  const wasAir = !actor.grounded;
  const res = moveBody(world, p, v, dt, { radius: MOVE.radius, height: actor.height, stepHeight: MOVE.stepHeight });
  actor.grounded = res.grounded;
  if (res.grounded && wasAir) {
    actor.landT = MOVE.landRecover;
    game?.onLand?.(actor, actor.lastFallVel ?? 0);
  }
  actor.lastFallVel = v.y;

  // ---- arena bounds safety net ----
  const B = (game?.bounds ?? 58) - 1.2;
  p.x = clamp(p.x, -B, B); p.z = clamp(p.z, -B, B);
  if (p.y < -12) { p.y = 20; v.set(0, 0, 0); }

  actor.speed = Math.hypot(v.x, v.z);
  return res;
}

/**
 * Leaning shifts the camera *and* the head/torso hitboxes sideways, so peeking
 * an angle really does expose you — it is not a free wallhack.
 */
function updateLean(actor, want, dt, world) {
  if (!actor.leanVec) actor.leanVec = new THREE.Vector3();
  let target = clamp(want, -1, 1);
  if (target !== 0 && world) {
    // don't lean into geometry: probe sideways from the eye
    const sy = Math.sin(actor.yaw), cy = Math.cos(actor.yaw);
    const rx = cy * Math.sign(target), rz = -sy * Math.sign(target);
    _probe.set(actor.pos.x, actor.pos.y + actor.height - 0.25, actor.pos.z);
    const dir = _probe.clone().set(rx, 0, rz).normalize();
    const hit = world.raycast(_probe, dir, MOVE.leanDist + 0.35);
    if (hit) {
      const room = Math.max(0, hit.dist - 0.35) / MOVE.leanDist;
      target = Math.sign(target) * Math.min(Math.abs(target), room);
    }
  }
  actor.leanAmt = damp(actor.leanAmt ?? 0, target, 11, dt);
  if (Math.abs(actor.leanAmt) < 0.002) actor.leanAmt = 0;
  const sy = Math.sin(actor.yaw), cy = Math.cos(actor.yaw);
  actor.leanVec.set(cy, 0, -sy).multiplyScalar(actor.leanAmt * MOVE.leanDist);
}
