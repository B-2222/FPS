// ============ procedural humanoid + nametag ============
import * as THREE from 'three';
import { buildWorldWeapon } from '../weapons/models.js';
import { clamp, lerp, damp } from '../core/util.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function part(parent, x, y, z, w, h, d, mat) {
  const m = new THREE.Mesh(BOX, mat);
  m.position.set(x, y, z); m.scale.set(w, h, d);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

export class BotModel {
  constructor(scene, teamColor, accent, name) {
    this.scene = scene;
    this.root = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: teamColor });
    const dark = new THREE.MeshLambertMaterial({ color: 0x22262c });
    const skin = new THREE.MeshLambertMaterial({ color: accent });
    this.mats = [body, dark, skin];
    this.bodyMat = body;

    // legs
    this.legL = new THREE.Group(); this.legL.position.set(-0.15, 0.82, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.15, 0.82, 0);
    part(this.legL, 0, -0.41, 0, 0.24, 0.82, 0.26, dark);
    part(this.legR, 0, -0.41, 0, 0.24, 0.82, 0.26, dark);
    this.root.add(this.legL, this.legR);

    // torso
    this.torso = new THREE.Group(); this.torso.position.set(0, 0.82, 0);
    part(this.torso, 0, 0.32, 0, 0.62, 0.66, 0.36, body);
    part(this.torso, 0, 0.30, -0.02, 0.66, 0.22, 0.40, skin);   // chest stripe
    this.root.add(this.torso);

    // head
    this.head = new THREE.Group(); this.head.position.set(0, 0.70, 0);
    part(this.head, 0, 0.17, 0, 0.36, 0.36, 0.36, skin);
    part(this.head, 0, 0.19, -0.17, 0.26, 0.12, 0.06, dark);     // visor
    this.torso.add(this.head);

    // arms
    this.armR = new THREE.Group(); this.armR.position.set(-0.38, 0.52, 0);
    part(this.armR, 0, -0.22, -0.05, 0.16, 0.5, 0.16, body);
    this.armL = new THREE.Group(); this.armL.position.set(0.38, 0.52, 0);
    part(this.armL, 0, -0.22, -0.05, 0.16, 0.5, 0.16, body);
    this.torso.add(this.armR, this.armL);

    // gun mount (between the hands)
    this.gunMount = new THREE.Group();
    this.gunMount.position.set(0, -0.36, -0.30);
    this.armR.add(this.gunMount);

    // nametag
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256; this.canvas.height = 74;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter;
    const sm = new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true });
    this.tag = new THREE.Sprite(sm);
    this.tag.scale.set(1.7, 0.49, 1);
    this.tag.position.set(0, 2.28, 0);
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
    this.name = name; this.teamColor = teamColor;
    this._hpDrawn = -1;
    this.drawTag(1);

    scene.add(this.root);
    this.legPhase = 0;
    this.weaponId = null;
    this.gun = null;
    this.flash = 0;
  }

  drawTag(hpFrac) {
    const c = this.canvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.font = 'bold 30px system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'top';
    x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,.85)';
    x.strokeText(this.name, 128, 4);
    x.fillStyle = '#' + this.teamColor.toString(16).padStart(6, '0');
    x.fillText(this.name, 128, 4);
    // health bar
    const bw = 170, bh = 11, bx = (256 - bw) / 2, by = 46;
    x.fillStyle = 'rgba(0,0,0,.7)'; x.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    x.fillStyle = hpFrac > 0.55 ? '#2ee68a' : hpFrac > 0.25 ? '#ffc23d' : '#ff3b5c';
    x.fillRect(bx, by, bw * clamp(hpFrac, 0, 1), bh);
    this.tex.needsUpdate = true;
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.gun) this.gunMount.remove(this.gun);   // geometry is shared — never dispose it here
    this.gun = buildWorldWeapon(id);
    this.gun.scale.setScalar(0.9);
    this.gun.position.set(0, 0, -0.1);
    this.gunMount.add(this.gun);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.gun) return this.root.getWorldPosition(out);
    const local = this.gun.userData.muzzle || out.set(0, 0, -0.5);
    return out.copy(local).applyMatrix4(this.gun.matrixWorld);
  }

  hitFlash() { this.flash = 0.14; }

  update(dt, actor, camPos) {
    const r = this.root;
    r.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
    // body faces the aim yaw; legs lag toward movement direction
    r.rotation.y = actor.yaw + Math.PI;

    const crouch = actor.height < 1.5;
    const sc = crouch ? 0.72 : 1;
    this.torso.position.y = 0.82 * sc;
    this.legL.scale.y = this.legR.scale.y = sc;
    this.legL.position.y = this.legR.position.y = 0.82 * sc;

    // walk cycle
    const sp = actor.speed;
    if (actor.grounded && sp > 0.6) {
      this.legPhase += dt * clamp(sp * 1.15, 2, 16);
      const a = Math.sin(this.legPhase) * clamp(sp / 9, 0.15, 0.85);
      this.legL.rotation.x = a; this.legR.rotation.x = -a;
      this.torso.rotation.z = Math.sin(this.legPhase) * 0.035;
      this.torso.position.y += Math.abs(Math.sin(this.legPhase)) * 0.035;
    } else {
      this.legL.rotation.x = damp(this.legL.rotation.x, actor.grounded ? 0 : 0.35, 8, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, actor.grounded ? 0 : -0.2, 8, dt);
      this.torso.rotation.z = damp(this.torso.rotation.z, 0, 8, dt);
    }

    // aim pitch through the torso + head
    this.torso.rotation.x = damp(this.torso.rotation.x, -actor.pitch * 0.55, 12, dt);
    this.head.rotation.x = damp(this.head.rotation.x, -actor.pitch * 0.45, 12, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, -1.35 - actor.pitch * 0.5, 12, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, -1.2 - actor.pitch * 0.5, 12, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, -0.45, 10, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, 0.18, 10, dt);

    // damage flash
    if (this.flash > 0) {
      this.flash -= dt;
      this.bodyMat.emissive.setHex(0xff2222).multiplyScalar(clamp(this.flash * 6, 0, 1));
    } else if (this.bodyMat.emissive.r > 0.001) this.bodyMat.emissive.setHex(0x000000);

    // nametag faces the camera, hides at distance and behind cover
    if (camPos) {
      const d = r.position.distanceTo(camPos);
      this._losT = (this._losT ?? 0) - dt;
      if (this._losT <= 0) {
        this._losT = 0.12 + Math.random() * 0.1;
        this._visible = d < 70 && actor.game.canPlayerSee(actor);
      }
      this.tag.visible = !!this._visible && actor.alive;
      const s = clamp(d / 22, 0.75, 2.4);
      this.tag.scale.set(1.7 * s, 0.49 * s, 1);
      this.tag.position.y = actor.height + 0.5;
    }
    const hpFrac = actor.health / actor.maxHealth;
    if (Math.abs(hpFrac - this._hpDrawn) > 0.02) { this._hpDrawn = hpFrac; this.drawTag(hpFrac); }
  }

  setDead(dead, dt) {
    if (dead) {
      this.root.rotation.z = lerp(this.root.rotation.z, 1.45, 0.18);
      this.root.position.y = Math.max(this.root.position.y - 1.2 * (dt || 0.016), this._deadY ?? 0);
      this.tag.visible = false;
    } else {
      this.root.rotation.z = 0;
    }
  }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    this.scene.remove(this.root);
    this.tex.dispose();
    this.mats.forEach(m => m.dispose());
  }
}
