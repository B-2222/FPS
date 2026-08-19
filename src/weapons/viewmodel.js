// ============ first-person weapon rendering & animation ============
import * as THREE from 'three';
import { buildWeaponModel, VM_HIP, VM_ADS_Z } from './models.js';
import { clamp, damp, lerp } from '../core/util.js';

const _v = new THREE.Vector3(), _mz = new THREE.Vector3();

export class ViewModel {
  constructor(vmScene, camera) {
    this.scene = vmScene; this.camera = camera;
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.68);
    vmScene.add(this.root);
    this.models = new Map();
    this.current = null;
    this.id = null; this.key = null;
    this.bobT = 0;
    this.swayX = 0; this.swayY = 0;
    this.kick = 0; this.kickRot = 0; this.kickSide = 0;
    this.adsAmt = 0;
    this.lowerAmt = 0;
    this.reloadAmt = 0;
    this.leanTilt = 0;
    this.scopeFade = 0;
  }

  /** rebuilds only when the weapon or its attachments change */
  setWeapon(id, weaponDef) {
    const a = weaponDef?.attachments || {};
    const key = id + '|' + [a.optic, a.barrel, a.grip, a.laser, a.mag].join(',');
    if (this.key === key) return;
    if (this.current) this.current.visible = false;
    let m = this.models.get(key);
    if (!m) { m = buildWeaponModel(id, weaponDef); this.models.set(key, m); this.root.add(m); }
    m.visible = true;
    this.current = m; this.id = id; this.key = key;
    this.lowerAmt = 1;
  }

  /** where the sight sits above the weapon origin — drives the ADS pose */
  get sightHeight() { return this.current?.userData.sightY ?? this.current?.userData.ironY ?? 0.1; }

  muzzleWorld(out = _v) {
    if (!this.current) return out.copy(this.camera.position);
    this.current.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();
    const local = this.current.userData.muzzle || _mz.set(0, 0, -0.5);
    out.copy(local).applyMatrix4(this.current.matrixWorld);
    return out.applyMatrix4(this.camera.matrixWorld);
  }
  muzzleLocal(out = new THREE.Vector3()) {
    if (!this.current) return out.set(0, 0, -0.5);
    this.current.updateWorldMatrix(true, false);
    return out.copy(this.current.userData.muzzle || _mz.set(0, 0, -0.5)).applyMatrix4(this.current.matrixWorld);
  }

  onFire(w) {
    this.kick = Math.min(0.12, this.kick + w.kick);
    this.kickRot = Math.min(0.45, this.kickRot + w.kick * 2.4);
    this.kickSide += (Math.random() - 0.5) * w.kick * 1.4;
  }

  update(dt, st) {
    this.setWeapon(st.weaponId, st.weapon);
    const hip = VM_HIP[st.weaponId] || VM_HIP.rifle;
    const adsZ = VM_ADS_Z[st.weaponId] ?? -0.46;

    const adsSpeed = 1 / Math.max(0.06, (st.weapon?.adsTime ?? 0.24)) * 1.6;
    this.adsAmt = damp(this.adsAmt, st.ads ? 1 : 0, adsSpeed, dt);

    // A magnified optic replaces the gun on screen. Swap to the scope overlay
    // early and hide the model, so the body of the sight never covers the target.
    const scoped = !!st.scoped;
    this.scopeFade = damp(this.scopeFade, scoped && this.adsAmt > 0.45 ? 1 : 0, 22, dt);
    st.scopeFade = this.scopeFade;
    this.root.visible = !(scoped && this.adsAmt > 0.5);
    if (!this.root.visible) return;

    this.lowerAmt = damp(this.lowerAmt, st.sprint ? 1 : 0, 12, dt);
    this.reloadAmt = damp(this.reloadAmt, st.reloading ? 1 : 0, 14, dt);
    this.leanTilt = damp(this.leanTilt, st.lean || 0, 10, dt);

    // sway: the gun lags the view
    this.swayX = damp(this.swayX, clamp(-st.mouseDX * 0.0016, -0.05, 0.05), 9, dt);
    this.swayY = damp(this.swayY, clamp(-st.mouseDY * 0.0014, -0.045, 0.045), 9, dt);

    const moving = st.speed > 0.8 && st.grounded;
    const bobSpeed = st.sprint ? 9.5 : 6.5;
    if (moving) this.bobT += dt * bobSpeed * clamp(st.speed / 3.7, 0.5, 1.7);
    const bobAmt = (moving ? clamp(st.speed / 5, 0, 1) : 0) * (1 - this.adsAmt * 0.85) * (st.bobEnabled ? 1 : 0.15);
    const bx = Math.sin(this.bobT) * 0.016 * bobAmt;
    const by = (Math.abs(Math.cos(this.bobT)) - 0.5) * 0.014 * bobAmt;

    this.kick = damp(this.kick, 0, 11, dt);
    this.kickRot = damp(this.kickRot, 0, 10, dt);
    this.kickSide = damp(this.kickSide, 0, 9, dt);

    // ---- ADS pose is derived, not authored: put the sight line dead centre ----
    const s = this.root.scale.x;
    const adsX = 0, adsY = -this.sightHeight * s;

    const px = lerp(hip[0], adsX, this.adsAmt) + bx + this.swayX + this.leanTilt * 0.035;
    const py = lerp(hip[1], adsY, this.adsAmt) + by + this.swayY
      - this.lowerAmt * 0.09 - this.reloadAmt * 0.11 + (st.crouching ? -0.012 : 0);
    const pz = lerp(hip[2], adsZ, this.adsAmt) + this.kick;
    this.root.position.set(px, py, pz);

    const swapDip = st.swapFrac > 0 ? Math.sin(st.swapFrac * Math.PI) * 0.2 : 0;
    this.root.position.y -= swapDip;

    const aimSteady = 1 - this.adsAmt * 0.75;      // aiming settles the model down
    const rx = -this.kickRot * 0.5 + this.reloadAmt * 0.5 + this.lowerAmt * 0.25 + swapDip * 1.4
      + this.swayY * 1.4 * aimSteady;
    const ry = this.kickSide * 0.4 + this.lowerAmt * 0.5 - this.swayX * 2.4 * aimSteady;
    const rz = this.lowerAmt * 0.35 + this.kickSide * 0.8 + this.leanTilt * 0.12
      + Math.sin(this.bobT * 0.5) * 0.02 * bobAmt + this.reloadAmt * 0.3;
    this.root.rotation.set(rx, ry, rz);

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
