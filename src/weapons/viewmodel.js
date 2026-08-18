// ============ first-person weapon rendering & animation ============
import * as THREE from 'three';
import { buildWeaponModel, VM_POSE } from './models.js';
import { getWeapon } from './defs.js';
import { clamp, damp, lerp } from '../core/util.js';

const _v = new THREE.Vector3(), _mz = new THREE.Vector3();

export class ViewModel {
  constructor(vmScene, camera) {
    this.scene = vmScene; this.camera = camera;
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.68);        // tuned against the 68° viewmodel camera
    vmScene.add(this.root);
    this.models = new Map();
    this.current = null;
    this.id = null;
    this.bobT = 0; this.stepPhase = 0;
    this.swayX = 0; this.swayY = 0;
    this.kick = 0; this.kickRot = 0; this.kickSide = 0;
    this.adsAmt = 0;
    this.lowerAmt = 0;     // sprint / reload lowering
    this.reloadAmt = 0;
    this.spin = 0;
    this.pos = new THREE.Vector3();
    this.rot = new THREE.Euler();
  }

  setWeapon(id) {
    if (this.id === id) return;
    if (this.current) this.current.visible = false;
    let m = this.models.get(id);
    if (!m) { m = buildWeaponModel(id); this.models.set(id, m); this.root.add(m); }
    m.visible = true;
    this.current = m; this.id = id;
    this.lowerAmt = 1;
  }

  /** world-space muzzle position (viewmodel lives in camera space) */
  muzzleWorld(out = _v) {
    if (!this.current) return out.copy(this.camera.position);
    // refresh matrices: firing can happen before the frame is rendered
    this.current.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();
    const local = this.current.userData.muzzle || _mz.set(0, 0, -0.5);
    out.copy(local).applyMatrix4(this.current.matrixWorld);
    return out.applyMatrix4(this.camera.matrixWorld);   // camera space → world
  }
  muzzleLocal(out = new THREE.Vector3()) {
    if (!this.current) return out.set(0, 0, -0.5);
    this.current.updateWorldMatrix(true, false);
    return out.copy(this.current.userData.muzzle || _mz.set(0, 0, -0.5)).applyMatrix4(this.current.matrixWorld);
  }

  onFire(w) {
    this.kick = Math.min(0.14, this.kick + w.kick);
    this.kickRot = Math.min(0.5, this.kickRot + w.kick * 2.6);
    this.kickSide += (Math.random() - 0.5) * w.kick * 1.6;
  }

  update(dt, st) {
    // st: {speed, grounded, ads, sprint, reloading, reloadFrac, swapFrac, crouching, mouseDX, mouseDY, weaponId, melee}
    this.setWeapon(st.weaponId);
    const pose = VM_POSE[st.weaponId] || VM_POSE.rifle;
    // a magnified optic replaces the weapon on screen — don't draw the gun through it
    this.root.visible = !(st.scoped && this.adsAmt > 0.7);
    if (!this.root.visible) { this.adsAmt = damp(this.adsAmt, st.ads ? 1 : 0, 16, dt); return; }

    this.adsAmt = damp(this.adsAmt, st.ads ? 1 : 0, 16, dt);
    const lowerTarget = (st.sprint ? 1 : 0);
    this.lowerAmt = damp(this.lowerAmt, lowerTarget, 12, dt);
    this.reloadAmt = damp(this.reloadAmt, st.reloading ? 1 : 0, 14, dt);

    // --- sway from mouse movement (gun lags the view) ---
    this.swayX = damp(this.swayX, clamp(-st.mouseDX * 0.0016, -0.06, 0.06), 9, dt);
    this.swayY = damp(this.swayY, clamp(-st.mouseDY * 0.0014, -0.05, 0.05), 9, dt);

    // --- walk bob ---
    const moving = st.speed > 1.2 && st.grounded;
    const bobSpeed = st.sprint ? 13 : 9.5;
    if (moving) this.bobT += dt * bobSpeed * clamp(st.speed / 8, 0.5, 1.5);
    const bobAmt = (moving ? clamp(st.speed / 11, 0, 1) : 0) * (1 - this.adsAmt * 0.75) * (st.bobEnabled ? 1 : 0.15);
    const bx = Math.sin(this.bobT) * 0.022 * bobAmt;
    const by = (Math.abs(Math.cos(this.bobT)) - 0.5) * 0.02 * bobAmt;

    // --- recoil kick decay ---
    this.kick = damp(this.kick, 0, 11, dt);
    this.kickRot = damp(this.kickRot, 0, 10, dt);
    this.kickSide = damp(this.kickSide, 0, 9, dt);

    // --- position blend hip → ads ---
    const hip = pose.hip, ads = pose.ads;
    const px = lerp(hip[0], ads[0], this.adsAmt) + bx + this.swayX;
    const py = lerp(hip[1], ads[1], this.adsAmt) + by + this.swayY
      - this.lowerAmt * 0.09 - this.reloadAmt * 0.11 + (st.crouching ? -0.015 : 0);
    const pz = lerp(hip[2], ads[2], this.adsAmt) + this.kick;

    this.root.position.set(px, py, pz);

    const swapDip = st.swapFrac > 0 ? Math.sin(st.swapFrac * Math.PI) * 0.22 : 0;
    this.root.position.y -= swapDip;

    // --- rotation ---
    const rx = -this.kickRot * 0.5 + this.reloadAmt * 0.5 + this.lowerAmt * 0.25 + swapDip * 1.4
      + (pose.rot?.[0] || 0) + this.swayY * 1.4;
    const ry = this.kickSide * 0.4 + this.lowerAmt * 0.5 + (pose.rot?.[1] || 0) - this.swayX * 2.4;
    const rz = this.lowerAmt * 0.35 + this.kickSide * 0.8 + (pose.rot?.[2] || 0)
      + Math.sin(this.bobT * 0.5) * 0.02 * bobAmt + this.reloadAmt * 0.3;
    this.root.rotation.set(rx, ry, rz);

    // --- per-weapon moving parts ---
    const m = this.current;
    if (m) {
      const ud = m.userData;
      if (ud.slide) ud.slide.position.z = lerp(-0.02, 0.05, clamp(this.kick / 0.08, 0, 1));
      if (ud.pump) ud.pump.position.z = -0.30 + (st.pumping ? Math.sin(st.pumpFrac * Math.PI) * 0.14 : 0);
      if (ud.bolt) ud.bolt.position.z = 0.16 + (st.pumping ? Math.sin(st.pumpFrac * Math.PI) * 0.13 : 0);
      if (ud.cyl) ud.cyl.rotation.z += (this.kick > 0.02 ? dt * 22 : 0);
    }
    if (st.melee) {
      const t = clamp(st.meleeFrac, 0, 1);
      const sw = Math.sin(t * Math.PI);
      this.root.position.z += sw * 0.28;
      this.root.position.x -= sw * 0.12;
      this.root.rotation.z -= sw * 1.1;
      this.root.rotation.y += sw * 0.5;
    }
  }
}
