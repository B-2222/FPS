// ============ shared character movement (quake-flavoured: bhop, air-strafe, slide) ============
import * as THREE from 'three';
import { moveBody } from '../world/collision.js';
import { clamp } from '../core/util.js';

export const MOVE = {
  walk: 7.4, sprint: 10.8, crouch: 3.9, ads: 4.6,
  groundAccel: 13, airAccel: 22, airWishCap: 2.6,
  friction: 8.5, gravity: 26, jumpVel: 9.3,
  slideBoost: 3.4, slideTime: 0.62, slideFriction: 1.6,
  radius: 0.42, height: 1.82, crouchHeight: 1.16, stepHeight: 0.56,
};

const _wish = new THREE.Vector3();

function accelerate(vel, wx, wz, wishSpeed, accel, dt) {
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * wishSpeed * dt;
  if (a > add) a = add;
  vel.x += wx * a; vel.z += wz * a;
}

/**
 * cmd: {forward, strafe, jump, sprint, crouch}  — forward/strafe in [-1,1], already in world space via yaw
 * Mutates actor.pos / actor.vel and returns move info.
 */
export function stepMovement(actor, cmd, dt, world, game) {
  const v = actor.vel, p = actor.pos;

  // ---- desired direction in world space ----
  const sy = Math.sin(actor.yaw), cy = Math.cos(actor.yaw);
  // yaw 0 looks down -Z
  let wx = -sy * cmd.forward + cy * cmd.strafe;
  let wz = -cy * cmd.forward - sy * cmd.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 0.0001) { wx /= wl; wz /= wl; } else { wx = wz = 0; }
  const wishing = wl > 0.001;

  // ---- stance ----
  const wantCrouch = cmd.crouch;
  const speed2 = Math.hypot(v.x, v.z);

  // start a slide: sprinting + crouch while grounded and moving fast
  if (wantCrouch && actor.grounded && cmd.sprint && speed2 > 7.0 && actor.slideCd <= 0 && !actor.sliding) {
    actor.sliding = true; actor.slideT = MOVE.slideTime; actor.slideCd = 1.0;
    const s = Math.max(speed2, 8) + MOVE.slideBoost;
    const inv = 1 / Math.max(speed2, 0.001);
    v.x = v.x * inv * s; v.z = v.z * inv * s;
    if (game) game.onSlide?.(actor);
  }
  if (actor.sliding) {
    actor.slideT -= dt;
    if (actor.slideT <= 0 || !wantCrouch || !actor.grounded) actor.sliding = false;
  }
  actor.slideCd = Math.max(0, actor.slideCd - dt);

  const crouching = (wantCrouch || actor.sliding);
  const targetH = crouching ? MOVE.crouchHeight : MOVE.height;
  // can we stand back up?
  if (!crouching && actor.height < MOVE.height) {
    const free = !world.overlaps(p.x - MOVE.radius, p.y, p.z - MOVE.radius,
                                p.x + MOVE.radius, p.y + MOVE.height, p.z + MOVE.radius, []);
    actor.height = free ? Math.min(MOVE.height, actor.height + dt * 6) : actor.height;
  } else {
    actor.height += (targetH - actor.height) * Math.min(1, dt * 14);
  }
  actor.crouching = crouching;

  // ---- speed target ----
  let wishSpeed = MOVE.walk;
  if (actor.sliding) wishSpeed = 2.0;
  else if (crouching) wishSpeed = MOVE.crouch;
  else if (cmd.sprint && cmd.forward > 0.1) wishSpeed = MOVE.sprint;
  else if (actor.adsing) wishSpeed = MOVE.ads;
  wishSpeed *= actor.speedMult ?? 1;

  // ---- ground vs air ----
  if (actor.grounded) {
    const fric = actor.sliding ? MOVE.slideFriction : MOVE.friction;
    // no friction on the frame you jump → bunny hops keep momentum
    if (!actor.hopping) {
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.01) {
        const drop = Math.max(sp, 4) * fric * dt;
        const ns = Math.max(0, sp - drop) / sp;
        v.x *= ns; v.z *= ns;
      }
    }
    if (wishing) accelerate(v, wx, wz, wishSpeed, MOVE.groundAccel, dt);
  } else {
    if (wishing) {
      accelerate(v, wx, wz, Math.min(wishSpeed, MOVE.airWishCap), MOVE.airAccel, dt);
      // mild extra air control so you can still curve mid-flight
      accelerate(v, wx, wz, wishSpeed * 0.55, 2.2, dt);
    }
  }
  actor.hopping = false;

  // ---- jump ----
  const canJump = actor.grounded || actor.coyote > 0;
  if (cmd.jump && canJump && actor.jumpCd <= 0) {
    v.y = MOVE.jumpVel;
    actor.grounded = false; actor.coyote = 0; actor.jumpCd = 0.09; actor.hopping = true;
    actor.sliding = false;
    if (game) game.onJump?.(actor);
  }
  actor.jumpCd = Math.max(0, actor.jumpCd - dt);

  // ---- gravity ----
  v.y -= MOVE.gravity * dt;
  v.y = Math.max(v.y, -70);

  // ---- integrate + collide ----
  const wasAir = !actor.grounded;
  const res = moveBody(world, p, v, dt, { radius: MOVE.radius, height: actor.height, stepHeight: MOVE.stepHeight });
  actor.grounded = res.grounded;
  actor.coyote = res.grounded ? 0.11 : Math.max(0, actor.coyote - dt);
  if (res.grounded && wasAir && game) {
    const impact = actor.lastFallVel ?? 0;
    game.onLand?.(actor, impact);
  }
  actor.lastFallVel = v.y;

  // ---- jump pads ----
  if (game && game.jumpPads && res.grounded) {
    for (const jp of game.jumpPads) {
      if (Math.abs(p.x - jp.x) < jp.r && Math.abs(p.z - jp.z) < jp.r && Math.abs(p.y - jp.y) < 0.7) {
        v.y = jp.power; actor.grounded = false;
        game.onJumpPad?.(actor, jp);
        break;
      }
    }
  }

  // ---- arena bounds safety net ----
  const B = (game?.bounds ?? 58) - 1.2;
  p.x = clamp(p.x, -B, B); p.z = clamp(p.z, -B, B);
  if (p.y < -12) { p.y = 20; v.set(0, 0, 0); }

  actor.speed = Math.hypot(v.x, v.z);
  return res;
}
