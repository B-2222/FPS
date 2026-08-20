// ============ match orchestration ============
import * as THREE from 'three';
import { buildMapById, randomMapId, MAP_META } from '../world/maps/index.js';
import { NavGrid } from '../world/nav.js';
import { bodyFree } from '../world/collision.js';
import { FX } from '../fx/effects.js';
import { HUD } from '../ui/hud.js';
import { Minimap } from '../ui/minimap.js';
import { Player } from '../entities/player.js';
import { Bot, DIFFICULTY } from '../entities/bot.js';
import { MOVE } from '../entities/movement.js';
import { Arsenal } from '../entities/actor.js';
import { ViewModel } from '../weapons/viewmodel.js';
import { buildWorldWeapon } from '../weapons/models.js';
import { updateProjectiles } from './combat.js';
import { GadgetSystem } from './gadgets.js';
import { SiegeMode, PHASE } from './siege.js';
import { Drone } from './drone.js';
import { OPERATORS, ATTACKERS, DEFENDERS, getOperator, speedMult } from './operators.js';
import { resolveWeapon, DEFAULT_LOADOUT } from '../weapons/attachments.js';
import { audio } from '../core/audio.js';
import { settings, saveSettings } from '../core/settings.js';
import { input, actionDown, actionHit, requestLock, exitLock } from '../core/input.js';
import { clamp, rand, randInt, pick, botName } from '../core/util.js';
import { getWeapon, WEAPON_IDS, GUNGAME_LADDER } from '../weapons/defs.js';

const TEAM_COLORS = [0x1fd6a0, 0xff3b5c];
const FFA_COLORS = [0xff5566, 0xff8a3d, 0xd94fd0, 0xff3b5c, 0xff9f1c, 0xe8506b, 0xc94fff, 0xff6b3d];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.audio = audio;
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.actors = [];
    this.bots = [];
    this.projectiles = [];
    this.pickups = [];
    this.weaponCrates = [];
    this.cameras = [];
    this.destroyed = [];
    this.pathBudget = 3;
    this.onMatchEnd = null;
    this.usedNames = new Set();
    this.frozen = false;
    this.attackersFrozen = false;
    this.camIndex = -1;
    this.drones = [];
    this.viewMode = 'self';      // 'self' | 'camera' | 'drone'
  }

  /* ================= boot ================= */
  init() {
    const quality = settings.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: quality !== 'low', powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : quality === 'med' ? 1.5 : 1));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.autoClear = false;
    if (quality !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.06, 900);
    this.camera.rotation.order = 'YXZ';

    // the viewmodel lives in its own scene so walls never clip the gun
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.005, 12);
    this.vmScene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3038, 1.3));
    const vmKey = new THREE.DirectionalLight(0xffffff, 1.5);
    vmKey.position.set(-0.6, 1.2, 0.9);
    this.vmScene.add(vmKey);
    const vmRim = new THREE.DirectionalLight(0x88bbff, 0.7);
    vmRim.position.set(0.9, -0.2, -1);
    this.vmScene.add(vmRim);

    this.mapRoot = new THREE.Group();
    this.scene.add(this.mapRoot);
    this.loadMap(settings.mapId && settings.mapId !== 'random' ? settings.mapId : randomMapId());

    this.fx = new FX(this.scene, this.vmScene, quality);
    this.fx.blood = settings.blood;
    this.hud = new HUD(this);
    this.minimap = new Minimap(this, document.getElementById('minimap'));
    this.viewModel = new ViewModel(this.vmScene, this.camera);
    this.gadgets = new GadgetSystem(this);
    this.siege = new SiegeMode(this);

    this.player = new Player(this);

    addEventListener('resize', () => this.resize());
    this.resize();
    return this;
  }

  /** tear down the current map and build another one */
  loadMap(id) {
    const quality = settings.quality;
    if (this.mapRoot.children.length) {
      this.mapRoot.traverse(o => {
        if (o.isMesh || o.isInstancedMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
      this.mapRoot.clear();
      this.scene.fog = null;
    }
    const built = buildMapById(id, this.mapRoot, quality);
    this.mapId = id;
    this.mapName = built.name;
    this.world = built.world;
    this.spawnPoints = built.spawns;
    this.atkSpawns = built.atkSpawns;
    this.defSpawns = built.defSpawns;
    this.jumpPads = built.jumpPads;
    this.bounds = built.bounds;
    this.mapPickups = built.pickups;
    this.mapWeapons = built.weaponSpawns;
    this.objectives = built.objectives;
    this.cameraSpecs = built.cameras;
    this.openings = built.openings;
    this.world.onDestroy = box => this.onGeometryDestroyed(box);
    // fine cells: these maps are built from 1-3 m gaps, and a coarse grid drops
    // whole doorways between samples
    this.nav = new NavGrid(this.world, { half: this.bounds + 6, cell: 1.15 }).build();
    this.validateSpawns();
    this.destroyed = [];
  }

  validateSpawns() {
    const check = list => {
      const ok = [];
      for (const sp of list) {
        if (bodyFree(this.world, sp.x, sp.y + 0.05, sp.z, MOVE.radius, MOVE.height)) { ok.push(sp); continue; }
        const n = this.nav.nodes[this.nav.nearest({ x: sp.x, y: sp.y, z: sp.z })];
        if (n && bodyFree(this.world, n.x, n.y + 0.05, n.z, MOVE.radius, MOVE.height)) ok.push({ x: n.x, y: n.y, z: n.z });
      }
      return ok;
    };
    this.atkSpawns = check(this.atkSpawns);
    this.defSpawns = check(this.defSpawns);
    this.spawnPoints = check(this.spawnPoints);
    while (this.spawnPoints.length < 12) {
      const n = this.nav.randomNode();
      if (n) this.spawnPoints.push({ x: n.x, y: n.y, z: n.z });
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  }

  /* ================= match setup ================= */
  startMatch(cfg) {
    this.cfg = {
      mode: cfg.mode === 'gungame' ? 'gungame' : 'siege',
      botCount: cfg.bots ?? 7, difficulty: cfg.difficulty || 'normal',
      scoreLimit: cfg.scoreLimit ?? 30, timeLimit: cfg.timeLimit ?? 600,
      roundsToWin: cfg.roundsToWin ?? 4, roundTime: cfg.roundTime ?? 150, prepTime: cfg.prepTime ?? 12,
    };
    const wantMap = cfg.map || settings.mapId || 'random';
    const mapId = wantMap === 'random' ? randomMapId() : wantMap;
    if (mapId !== this.mapId) this.loadMap(mapId);
    this.clearMatch();
    this.time = 0;
    this.matchTime = this.cfg.timeLimit;
    this.over = false;
    this.multiKill = 0; this.lastKillT = -9;
    this.roundCredits = 0;

    const teamMode = this.cfg.mode === 'siege';
    this.player.team = 0;
    this.player.kills = this.player.deaths = this.player.score = this.player.streak = 0;
    this.player.damageDealt = this.player.shotsFired = this.player.shotsHit = this.player.headshots = 0;
    this.player.gunGameTier = 0;
    this.player.arsenal = new Arsenal(this.player, settings.loadout);
    this.actors = [this.player];

    for (let i = 0; i < this.cfg.botCount; i++) {
      const team = teamMode ? (i % 2 === 0 ? 1 : 0) : i + 1;
      const color = teamMode ? TEAM_COLORS[team] : FFA_COLORS[i % FFA_COLORS.length];
      const weapon = this.cfg.mode === 'gungame' ? GUNGAME_LADDER[0] : pick(WEAPON_IDS);
      const bot = new Bot(this, {
        name: botName(this.usedNames), team, difficulty: this.cfg.difficulty,
        weapon, color, accent: teamMode ? (team === 0 ? 0x0e8a63 : 0xa61f38) : 0x2a2f38,
      });
      this.bots.push(bot);
      this.actors.push(bot);
    }

    this.spawnPickups();
    this.spawnWeaponCrates();
    this.spawnCameras();

    if (this.cfg.mode === 'siege') {
      this.siege.begin(this.cfg);
    } else {
      this.frozen = false; this.attackersFrozen = false;
      // operators belong to siege; without this the gun-game HUD still offers a
      // breach charge and the player keeps a heavy operator's speed penalty
      for (const a of this.actors) {
        a.operator = null; a.speedMult = 1; a.abilityCharges = 0; a.gadgetCount = 0;
        a.maxHealth = 100; a.health = 100; a.maxShield = 100; a.shield = 0;
      }
      this.hud.clearRoundChrome();
      this.respawn(this.player, true);
      for (const b of this.bots) this.respawn(b, true);
      this.hud.centerToast('FIGHT');
    }

    const sub = this.cfg.mode === 'gungame'
      ? `${GUNGAME_LADDER.length} WEAPONS — ONE KILL EACH`
      : `ATTACK & DEFEND — FIRST TO ${this.cfg.roundsToWin} — ${DIFFICULTY[this.cfg.difficulty].label} BOTS`;
    this.hud.setMode(`${this.cfg.mode === 'gungame' ? 'GUN GAME' : 'SIEGE'} · ${this.mapName} — ${sub}`);
    this.hud.show(true);
    this.updateScoreHud();
    this.running = true; this.paused = false;
  }

  clearMatch() {
    for (const b of this.bots) b.dispose();
    this.bots = []; this.actors = [];
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    const dropMesh = m => {
      this.scene.remove(m);
      m.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
    };
    for (const p of this.pickups) dropMesh(p.mesh);
    this.pickups = [];
    for (const c of this.weaponCrates) dropMesh(c.mesh);
    this.weaponCrates = [];
    for (const c of this.cameras) if (c.mesh) dropMesh(c.mesh);
    this.cameras = [];
    this.clearDrones();
    this.gadgets?.clear();
    this.siege?.clearDefuser();
    this.restoreGeometry();
    this.usedNames.clear();
    this.camIndex = -1;
  }

  /* ================= destructible geometry ================= */
  onGeometryDestroyed(box) {
    if (!this.destroyed.includes(box)) this.destroyed.push(box);
    if (box.mesh) { this.scene.remove(box.mesh); box.mesh = null; }
    if (box.camera) box.camera.dead = true;
    this.nav.relinkNear(box.min, box.max);
    this.fx.debris?.(box);
  }

  /** put every soft wall, barricade and deployable back to its start state */
  restoreGeometry() {
    for (const o of this.openings || []) {
      if (o.barricaded) {
        const box = o.barricaded;
        if (box.mesh) { box.mesh.parent?.remove(box.mesh); box.mesh = null; }
        box.dead = true;
        o.barricaded = null;
      }
    }
    if (!this.destroyed?.length) return;
    const m4 = new THREE.Matrix4();
    for (const b of this.destroyed) {
      if (b.deployed) continue;                 // deployables stay gone
      b.dead = false;
      b.hp = b.maxHp ?? b.hp0 ?? 120;
      if (b.inst && b.instIndex !== undefined) {
        m4.makeScale(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
        m4.setPosition((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
        b.inst.setMatrixAt(b.instIndex, m4);
        b.inst.instanceMatrix.needsUpdate = true;
      }
      this.nav.relinkNear(b.min, b.max);
    }
    this.destroyed.length = 0;
    this.world.build();
  }

  /* ================= cameras ================= */
  spawnCameras() {
    for (const spec of this.cameraSpecs) this.addCamera({ ...spec });
  }

  addCamera(spec) {
    const geo = new THREE.SphereGeometry(0.14, 8, 6);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b3138, emissive: 0x220000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spec.x, spec.y, spec.z);
    this.scene.add(mesh);
    const cam = { ...spec, mesh, dead: false };
    // a small solid so bullets can take it out
    const box = this.world.addBox(
      { x: spec.x - 0.16, y: spec.y - 0.16, z: spec.z - 0.16 },
      { x: spec.x + 0.16, y: spec.y + 0.16, z: spec.z + 0.16 },
      { breakable: true, hp: 25, isCamera: true });
    box.camera = cam;
    cam.box = box;
    this.cameras.push(cam);
    this.world.build();
    return cam;
  }

  availableCameras() {
    const side = this.cfg?.mode === 'siege' ? this.siege.playerSide : null;
    return this.cameras.filter(c => !c.dead && (c.team === undefined ? side !== 'atk' : c.team === this.player.team));
  }

  /** B key: attackers get a drone, defenders get the camera network */
  toggleRemoteView() {
    if (this.cfg?.mode === 'siege' && this.sideOf(this.player) === 'atk') this.toggleDrone();
    else this.toggleCameras();
  }

  toggleDrone() {
    if (this.viewMode === 'drone') { this.exitRemote(); return; }
    let d = this.drones.find(x => x.owner === this.player && x.alive);
    if (!d) {
      d = new Drone(this, this.player);
      this.drones.push(d);
    }
    this.myDrone = d;
    this.viewMode = 'drone';
    this.hud.setCamera('DRONE');
  }

  clearDrones() {
    for (const d of this.drones) d.dispose();
    this.drones = [];
    this.myDrone = null;
    if (this.viewMode === 'drone') this.exitRemote();
  }

  exitRemote() {
    this.viewMode = 'self';
    this.camIndex = -1;
    this.hud.setCamera(null);
  }

  toggleCameras() {
    const list = this.availableCameras();
    if (!list.length) { this.hud.pickupToast('NO CAMERAS AVAILABLE', '#ff7a90'); return; }
    if (this.camIndex < 0) { this.camIndex = 0; this.viewMode = 'camera'; this.hud.setCamera(list[0].name); }
    else if (this.camIndex >= list.length - 1) { this.exitRemote(); }
    else { this.camIndex++; this.hud.setCamera(list[this.camIndex].name); }
  }
  exitCameras() { this.exitRemote(); }

  updateCameraView(dt) {
    const list = this.availableCameras();
    const cam = list[this.camIndex];
    if (!cam) { this.exitCameras(); return; }
    if (cam.spin) cam.yaw += dt * 0.35;
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
    if (Math.abs(this.camera.fov - settings.fov) > 0.01) { this.camera.fov = settings.fov; this.camera.updateProjectionMatrix(); }
    // watching a feed makes you blind to your own surroundings — mark nearby enemies
    for (const a of this.actors) {
      if (!a.alive || this.friendly(this.player, a)) continue;
      _v.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
      if (_v.distanceTo(this.camera.position) < 28 && this.world.losClear(this.camera.position, _v)) a.spottedUntil = this.time + 1.5;
    }
  }

  /* ================= operators & sides ================= */
  sideOf(actor) {
    if (this.cfg?.mode !== 'siege') return null;
    const mine = this.siege.playerSide;
    return actor.team === 0 ? mine : (mine === 'atk' ? 'def' : 'atk');
  }
  sideAlive(side) { return this.actors.filter(a => a.alive && this.sideOf(a) === side).length; }

  assignSides(playerSide) {
    for (const a of this.actors) {
      const side = this.sideOf(a);
      let op;
      if (a === this.player) op = getOperator(side === 'atk' ? settings.operatorAtk : settings.operatorDef);
      else op = pick(side === 'atk' ? ATTACKERS : DEFENDERS);
      this.applyOperator(a, op);
    }
  }

  applyOperator(actor, op) {
    actor.operator = op;
    actor.maxHealth = op.health;
    actor.health = op.health;
    actor.speedMult = speedMult(op);
    actor.abilityCharges = op.ability.charges;
    actor.abilityCd = 0;
    actor.gadgetCount = op.gadget.count;
    actor.arsenal = new Arsenal(actor, op.primary);
    actor.arsenal.give(op.secondary, false);
    if (actor === this.player) {
      this.viewModel.setWeapon(actor.arsenal.current, this.resolvedWeapon(actor));
      this.hud.setOperator(op);
    } else actor.model?.setWeapon(actor.arsenal.current);
  }

  /** the gun-game ladder readout, where siege puts the operator badge */
  showTier(actor) {
    const tier = clamp(actor.gunGameTier, 0, GUNGAME_LADDER.length - 1);
    const next = GUNGAME_LADDER[tier + 1];
    this.hud.setTier(tier + 1, GUNGAME_LADDER.length,
      getWeapon(GUNGAME_LADDER[tier]).name, next ? getWeapon(next).name : null);
  }

  /** weapon definition with the player's purchased attachments applied */
  resolvedWeapon(actor, id = actor.arsenal.current) {
    const base = getWeapon(id);
    if (actor !== this.player) return base;
    const loadout = settings.gunLoadouts?.[id] || DEFAULT_LOADOUT;
    return resolveWeapon(base, loadout);
  }

  /* ---------- pickups ---------- */
  spawnPickups() {
    for (const spec of this.mapPickups) {
      const mesh = makePickupMesh(spec.type);
      const y = (spec.y ?? 0) + 0.75;
      mesh.position.set(spec.x, y, spec.z);
      this.scene.add(mesh);
      this.pickups.push({
        type: spec.type, pos: new THREE.Vector3(spec.x, y, spec.z), mesh,
        active: true, t: rand(0, 6), respawn: 0,
        respawnTime: spec.type === 'ammo' ? 12 : spec.type === 'health' ? 18 : 25,
      });
    }
  }

  spawnWeaponCrates() {
    // Gun game hands you the ladder — floor weapons would defeat the point.
    if (this.cfg.mode === 'gungame' || this.cfg.mode === 'siege') return;
    for (const spec of this.mapWeapons) {
      const g = new THREE.Group();
      const model = buildWorldWeapon(spec.id);
      model.rotation.y = Math.PI / 2;
      g.add(model);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.035, 6, 24),
        new THREE.MeshBasicMaterial({ color: getWeapon(spec.id).color, transparent: true, opacity: 0.75 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.position.set(spec.x, (spec.y ?? 0) + 0.9, spec.z);
      this.scene.add(g);
      this.weaponCrates.push({ id: spec.id, pos: g.position.clone(), mesh: g, active: true, t: rand(0, 6), respawn: 0, ring });
    }
  }

  nearestPickup(pos, type, maxDist) {
    let best = null, bd = maxDist;
    for (const p of this.pickups) {
      if (!p.active || p.type !== type) continue;
      const d = p.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  updatePickups(dt) {
    for (const p of this.pickups) {
      p.t += dt;
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) { p.active = true; p.mesh.visible = true; }
        continue;
      }
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = p.pos.y + Math.sin(p.t * 2.2) * 0.14;
      for (const a of this.actors) {
        if (!a.alive) continue;
        if (Math.abs(a.pos.x - p.pos.x) > 1.7 || Math.abs(a.pos.z - p.pos.z) > 1.7) continue;
        if (Math.abs(a.pos.y + a.height * 0.5 - p.pos.y) > 2.2) continue;
        if (this.grantPickup(a, p)) { p.active = false; p.mesh.visible = false; p.respawn = p.respawnTime; break; }
      }
    }

    for (const c of this.weaponCrates) {
      c.t += dt;
      if (!c.active) {
        c.respawn -= dt;
        if (c.respawn <= 0) { c.active = true; c.mesh.visible = true; }
        continue;
      }
      c.mesh.rotation.y += dt * 1.1;
      c.mesh.position.y = c.pos.y + Math.sin(c.t * 1.8) * 0.12;
      c.ring.rotation.z += dt * 2.2;
      for (const b of this.bots) {
        if (!b.alive || b.pos.distanceTo(c.pos) > 1.9) continue;
        const cur = b.arsenal.ammo;
        if (!b.arsenal.has(c.id) || (cur && cur.mag + cur.reserve <= 0)) {
          b.arsenal.give(c.id, true);
          c.active = false; c.mesh.visible = false; c.respawn = 14;
          break;
        }
      }
    }
  }

  grantPickup(a, p) {
    if (p.type === 'health') {
      if (a.health >= a.maxHealth) return false;
      const got = a.heal(45);
      if (a === this.player) { audio.pickup('health'); this.hud.pickupToast(`+${Math.round(got)} HEALTH`, '#2ee68a'); }
      return true;
    }
    if (p.type === 'shield') {
      if (a.shield >= a.maxShield) return false;
      const got = a.addShield(50);
      if (a === this.player) { audio.pickup('shield'); this.hud.pickupToast(`+${Math.round(got)} ARMOUR`, '#4cc9ff'); }
      return true;
    }
    if (p.type === 'ammo') {
      if (!a.arsenal.refillAmmo(0.5)) return false;
      if (a === this.player) { audio.pickup('ammo'); this.hud.pickupToast('AMMO RESUPPLIED', '#ffd60a'); }
      return true;
    }
    return false;
  }

  nearbyCrate() {
    if (this.cfg.mode === 'gungame' || this.cfg.mode === 'siege' || !this.player.alive) return null;
    let best = null, bd = 3.2;
    for (const c of this.weaponCrates) {
      if (!c.active) continue;
      const d = c.pos.distanceTo(this.player.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  tryPickup(actor) {
    const best = this.nearbyCrate();
    if (!best) return;
    actor.arsenal.give(best.id, true);
    best.active = false; best.mesh.visible = false; best.respawn = 14;
    if (actor === this.player) {
      audio.pickup('weapon');
      this.hud.pickupToast(`PICKED UP ${getWeapon(best.id).name}`, '#00ffa8');
    }
  }

  /* ================= spawning ================= */
  pickSpawn(actor) {
    if (this.cfg.mode === 'siege') {
      const side = this.sideOf(actor);
      const pool = side === 'atk' ? this.atkSpawns : this.defSpawns;
      if (pool.length) {
        if (side === 'def' && this.siege.site) {
          // defenders spawn near the site they are holding
          const near = pool.slice().sort((a, b) =>
            Math.hypot(a.x - this.siege.site.x, a.z - this.siege.site.z) -
            Math.hypot(b.x - this.siege.site.x, b.z - this.siege.site.z));
          return pick(near.slice(0, Math.max(3, Math.ceil(near.length * 0.6))));
        }
        return pick(pool);
      }
    }
    const pool = this.spawnPoints;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const sp = pool[(i + randInt(0, 3)) % pool.length];
      let minEnemy = Infinity;
      for (const a of this.actors) {
        if (a === actor || !a.alive || this.friendly(actor, a)) continue;
        const d = _v.set(sp.x, sp.y, sp.z).distanceTo(a.pos);
        if (d < minEnemy) minEnemy = d;
      }
      const score = Math.min(minEnemy, 60) + rand(0, 12);
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    return best || this.spawnPoints[0];
  }

  respawn(actor, initial = false) {
    const sp = this.pickSpawn(actor);
    _v.set(sp.x, sp.y + 0.15, sp.z);
    actor.spawn(_v);
    actor.yaw = Math.atan2(-(0 - sp.x), -(0 - sp.z)) + Math.PI;
    actor.blindUntil = 0; actor.revealedUntil = 0; actor.spottedUntil = 0;
    if (this.cfg.mode === 'gungame') {
      const id = GUNGAME_LADDER[clamp(actor.gunGameTier, 0, GUNGAME_LADDER.length - 1)];
      actor.arsenal.slots.clear(); actor.arsenal.order = [];
      actor.arsenal.give(id, true);
      actor.arsenal.select(id, true);
    }
    if (this.cfg.mode === 'siege') {
      actor.abilityCharges = actor.operator?.ability.charges ?? 0;
      actor.gadgetCount = actor.operator?.gadget.count ?? 0;
    }
    if (actor === this.player) {
      this.hud.showRespawn(false);
      this.exitCameras();
      this.viewModel.setWeapon(actor.arsenal.current, this.resolvedWeapon(actor));
      if (this.cfg.mode === 'gungame') this.showTier(actor);
    }
  }

  /* ================= events ================= */
  friendly(a, b) {
    if (a === b) return true;
    if (this.cfg?.mode !== 'siege') return false;      // gun game is every-man-for-himself
    return a.team === b.team;
  }

  /** true if this actor can't act right now (round prep) */
  isFrozen(actor) {
    if (this.frozen) return true;
    if (this.attackersFrozen && this.cfg?.mode === 'siege' && this.sideOf(actor) === 'atk') return true;
    return false;
  }

  /** line of sight that respects smoke as well as walls */
  canSee(from, to) {
    if (!this.world.losClear(from, to)) return false;
    return !this.gadgets.blocksSight(from, to);
  }

  canPlayerSee(actor) {
    const p = this.player;
    if (!p.alive) return false;
    p.eyePos(_v);
    _v2.set(actor.pos.x, actor.pos.y + actor.height * 0.6, actor.pos.z);
    if (_v.distanceTo(_v2) > 70) return false;
    _v3.copy(_v2).sub(_v).normalize();
    p.aimDir(_v4);
    if (_v3.dot(_v4) < 0.25) return false;
    return this.canSee(_v, _v2);
  }

  onGunshot(pos, shooter) {
    shooter.lastFiredAt = this.time;
    const quiet = shooter === this.player && this.resolvedWeapon(shooter).quiet;
    if (!quiet) for (const b of this.bots) if (b !== shooter) b.hearShot(pos, shooter);
  }

  awardCredits(amount, reason) {
    settings.credits = Math.max(0, Math.round((settings.credits || 0) + amount));
    this.roundCredits += amount;
    saveSettings();
    if (reason) this.hud.pickupToast(`+${amount} CREDITS — ${reason}`, '#ffd60a');
  }

  onKill(killer, victim, weaponId, headshot) {
    victim.deaths++;
    victim.streak = 0;
    victim.alive = false;
    victim.killedBy = killer?.name; victim.killedWith = weaponId;

    const isSuicide = !killer || killer === victim;
    if (!isSuicide && !this.friendly(killer, victim)) {
      killer.kills++;
      killer.score += 100 + (headshot ? 50 : 0);
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      if (killer === this.player) this.awardCredits(headshot ? 75 : 50, headshot ? 'HEADSHOT' : 'KILL');
      if (this.cfg.mode === 'gungame') {
        // The knife is the last rung, and it takes a rung off whoever it kills —
        // it's the comeback rule that keeps a runaway leader in reach.
        if (weaponId === 'knife' && victim.gunGameTier > 0) {
          victim.gunGameTier--;
          if (victim === this.player) this.hud.centerToast('KNIFED — DEMOTED');
          else if (killer === this.player) this.hud.killPopup(`${victim.name} DEMOTED`);
        }
        killer.gunGameTier++;
        if (killer.gunGameTier >= GUNGAME_LADDER.length) { this.endMatch(killer); return; }
        const nid = GUNGAME_LADDER[killer.gunGameTier];
        killer.arsenal.slots.clear(); killer.arsenal.order = [];
        killer.arsenal.give(nid, true);
        killer.arsenal.select(nid, true);
        // a promotion is a small heal: pushing for the next tier has to beat hiding
        killer.health = Math.min(killer.maxHealth, killer.health + 30);
        if (killer === this.player) {
          this.viewModel.setWeapon(nid, this.resolvedWeapon(killer, nid));
          const next = GUNGAME_LADDER[killer.gunGameTier + 1];
          this.hud.killPopup(`TIER ${killer.gunGameTier + 1}/${GUNGAME_LADDER.length} — ${getWeapon(nid).name}`
            + (next ? `  ·  NEXT ${getWeapon(next).name}` : '  ·  FINAL RUNG'));
          this.showTier(killer);
        }
      }
    } else if (isSuicide) killer = null;

    this.hud.killfeed(killer ? killer.name : 'THE VOID', victim.name, weaponId, headshot,
      killer === this.player, victim === this.player);

    if (killer === this.player) {
      if (this.time - this.lastKillT < 4.2) this.multiKill++; else this.multiKill = 1;
      this.lastKillT = this.time;
      const mk = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'MEGA KILL', 'UNSTOPPABLE'][Math.min(this.multiKill, 6)];
      if (mk) this.hud.centerToast(mk);
      else if (headshot) this.hud.killPopup('HEADSHOT');
      if ([5, 10, 15, 20, 25].includes(this.player.streak)) this.hud.centerToast(`${this.player.streak} KILLSTREAK`);
      this.player.addShake(0.2);
    }

    if (victim === this.player) {
      audio.died();
      this.player.deadT = 0;
      this.hud.damageFlash(1);
      this.exitCameras();
      if (this.cfg.mode === 'siege') {
        this.hud.showRespawn(false);
        this.hud.pickupToast('ELIMINATED — SPECTATING', '#ff3b5c');
      } else {
        this.respawnTimer = 3;
        this.hud.showRespawn(true, killer?.name || 'THE VOID', weaponId, this.respawnTimer);
      }
    } else if (victim.isBot) {
      victim.respawnTimer = rand(2.4, 4.5);
      this.fx.impact(_v.set(victim.pos.x, victim.pos.y + 1, victim.pos.z), _v2.set(0, 1, 0), 'flesh');
    }

    this.updateScoreHud();
    this.checkWin();
  }

  onJump(actor) { if (actor === this.player) audio.click(null, { freq: 260, dur: 0.05, vol: 0.12, type: 'sine' }); }
  onLand(actor, fallVel) {
    const v = Math.abs(fallVel || 0);
    if (v < 6) return;
    audio.footstep(actor.pos, true);
    if (actor === this.player) {
      actor.addShake(clamp(v / 40, 0, 0.7));
      actor.landKick = clamp(v / 90, 0, 0.16);
      if (v > 24) {
        const res = actor.applyDamage(clamp((v - 24) * 2.6, 0, 70), null, { fall: true });
        actor.onDamaged?.(res.dealt, null, { point: actor.pos, part: 'legs' }, { id: 'fall' });
        if (res.killed) this.onKill(null, actor, 'fall', false);
      }
    }
  }
  onJumpPad() {}
  onSlide(actor) { if (actor === this.player) { audio.footstep(actor.pos, true); actor.addShake(0.12); } }
  onReloadStart(actor, w) {
    if (actor === this.player || actor.pos.distanceTo(this.player.pos) < 22) {
      audio.click(actor === this.player ? null : actor.pos, { freq: 780, dur: 0.09, vol: 0.3 });
      setTimeout(() => audio.click(actor === this.player ? null : actor.pos, { freq: 1250, dur: 0.07, vol: 0.26 }), w.reload * 500);
    }
  }
  onReloadEnd(actor) { if (actor === this.player) audio.click(null, { freq: 1600, dur: 0.06, vol: 0.28 }); }
  onShellLoaded(actor) { if (actor === this.player) audio.click(null, { freq: 1100, dur: 0.05, vol: 0.24 }); }
  onWeaponChanged(actor, id) {
    if (actor === this.player) {
      this.viewModel.setWeapon(id, this.resolvedWeapon(actor, id));
      audio.click(null, { freq: 900, dur: 0.07, vol: 0.22 });
    } else if (actor.model) actor.model.setWeapon(id);
  }

  shakeFromExplosion(pos, radius) {
    const d = this.player.pos.distanceTo(pos);
    if (d < radius * 2.6) this.player.addShake(clamp(1.8 * (1 - d / (radius * 2.6)), 0, 1.8));
  }

  /* ================= scoring ================= */
  teamScore(t) { return this.actors.filter(a => a.team === t).reduce((s, a) => s + a.kills, 0); }
  teamAlive(t) { return this.actors.filter(a => a.team === t && a.alive).length; }

  updateScoreHud() {
    if (this.cfg.mode === 'siege') { this.siege.updateHud(); return; }
    const top = Math.max(...this.actors.filter(a => a !== this.player).map(a => a.gunGameTier), 0);
    this.hud.setScores(this.player.gunGameTier + 1, top + 1, 'TIER', 'BEST BOT');
  }

  checkWin() { /* siege scores rounds; gun game ends on the last rung */ }

  endMatch(winner) {
    if (this.over) return;
    this.over = true; this.running = false;
    exitLock();
    const rows = this.scoreRows();
    const won = winner && winner.siegeWin !== undefined ? winner.siegeWin : winner === this.player;
    const bonus = won ? 400 : 150;
    this.awardCredits(bonus, won ? 'MATCH WON' : 'MATCH PLAYED');
    this.hud.show(false);
    this.onMatchEnd?.({
      title: won ? 'VICTORY' : 'DEFEAT', won, rows, teams: this.cfg.mode === 'siege',
      credits: this.roundCredits, balance: settings.credits,
      stats: {
        kills: this.player.kills, deaths: this.player.deaths,
        acc: this.player.shotsFired ? Math.round(this.player.shotsHit / this.player.shotsFired * 100) : 0,
        streak: this.player.bestStreak, headshots: this.player.headshots,
        damage: Math.round(this.player.damageDealt),
      },
    });
  }

  scoreRows() {
    return this.actors.map(a => ({
      name: a === this.player ? 'YOU' : a.name, kills: a.kills, deaths: a.deaths,
      team: a.team === 0 ? 0 : 1, isMe: a === this.player, alive: a.alive,
      op: a.operator?.name || '',
      score: this.cfg.mode === 'gungame' ? a.gunGameTier : a.kills,
      side: this.sideOf(a),
    })).sort((x, y) => y.score - x.score || x.deaths - y.deaths);
  }

  /** dead in a round-based match: ride along with a living teammate */
  updateSpectator(dt) {
    const mates = this.actors.filter(a => a !== this.player && a.alive && this.friendly(this.player, a));
    if (!mates.length) { this.hud.setSpectating(null); return; }
    if (!this.specTarget || !this.specTarget.alive || !mates.includes(this.specTarget)) this.specTarget = mates[0];
    if (actionHit('spectNext')) this.specTarget = mates[(mates.indexOf(this.specTarget) + 1) % mates.length];
    const a = this.specTarget;
    const cam = this.camera;
    cam.position.set(a.pos.x + a.leanVec.x, a.eyeY, a.pos.z + a.leanVec.z);
    cam.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
    if (Math.abs(cam.fov - settings.fov) > 0.01) { cam.fov = settings.fov; cam.updateProjectionMatrix(); }
    this.hud.setSpectating(a.name);
  }

  /* ================= main loop ================= */
  update(dt) {
    this.time += dt;
    this.pathBudget = 3;

    const roundMode = this.cfg.mode === 'siege';
    if (roundMode) {
      this.siege.update(dt);
      if (this.over) return;
    } else if (this.cfg.timeLimit > 0) {
      this.matchTime -= dt;
      this.hud.setTimer(this.matchTime);
      if (this.matchTime <= 0) {
        this.endMatch(this.actors.slice().sort(
          (a, b) => b.gunGameTier - a.gunGameTier || b.kills - a.kills)[0]);
        return;
      }
    }

    // ---- player ----
    this.player.update(dt);
    if (!this.player.alive) {
      if (roundMode) this.updateSpectator(dt);
      else {
        this.respawnTimer -= dt;
        this.hud.showRespawn(true, this.player.killedBy, this.player.killedWith, this.respawnTimer);
        if (this.respawnTimer <= 0) this.respawn(this.player);
      }
    } else if (this.viewMode === 'camera') this.updateCameraView(dt);

    // drones keep running whether or not you are looking through one
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      if (!d.alive) { this.drones.splice(i, 1); continue; }
      d.update(dt, this.viewMode === 'drone' && d === this.myDrone, input);
    }
    if (this.viewMode === 'drone') {
      if (this.myDrone?.alive) this.myDrone.applyCamera(this.camera);
      else { this.exitRemote(); this.hud.pickupToast('DRONE DESTROYED', '#ff3b5c'); }
    }

    // ---- bots ----
    for (const b of this.bots) {
      b.update(dt);
      if (!b.alive && !roundMode) {
        b.respawnTimer -= dt;
        if (b.respawnTimer <= 0) this.respawn(b);
      }
    }
    updateProjectiles(this, dt);
    this.gadgets.update(dt);
    this.updatePickups(dt);
    this.fx.update(dt);

    // ---- hud ----
    this.fpsAcc = (this.fpsAcc ?? 0) + dt;
    this.fpsFrames = (this.fpsFrames ?? 0) + 1;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
    this.hud.setFps(this.fps ?? 0);
    this.hud.usePrompt(this.nearbyCrate());
    this.hud.update(dt, this.player);
    this.minimap.draw(dt);
    if (actionDown('scoreboard')) this.hud.scoreboard(true, {
      title: this.cfg.mode === 'gungame' ? 'GUN GAME' : `SIEGE · ${this.mapName}`,
      sub: this.cfg.mode === 'gungame'
        ? `TIER ${this.player.gunGameTier + 1} / ${GUNGAME_LADDER.length}`
        : `ROUND ${this.siege.roundNo} — ${this.siege.rounds[0]} : ${this.siege.rounds[1]}`,
      rows: this.scoreRows(),
      teams: this.cfg.mode === 'siege' ? this.siege.rounds : null,
    });
    else this.hud.scoreboard(false);

    // ---- viewmodel ----
    const ars = this.player.arsenal;
    const rw = this.resolvedWeapon(this.player);
    this.viewModel.update(dt, {
      weaponId: ars.current, weapon: rw,
      speed: this.player.speed, grounded: this.player.grounded,
      ads: this.player.adsing, sprint: this.player.sprinting, crouching: this.player.crouching,
      scoped: !!(rw.scope || rw.magnified), lean: this.player.leanAmt,
      reloading: ars.reloading, reloadFrac: ars.reloading ? 1 - ars.reloadT / ars.reloadTotal : 0,
      swapFrac: ars.swapT > 0 ? 1 - ars.swapT / ars.swapTotal : 0,
      pumping: ars.pumpT > 0, pumpFrac: ars.pumpT > 0 ? 1 - ars.pumpT / 0.28 : 0,
      melee: this.player.meleeT > 0, meleeFrac: 1 - this.player.meleeT / 0.42,
      mouseDX: input.mouseDX, mouseDY: input.mouseDY, bobEnabled: settings.bob,
    });

    const cam = this.camera;
    _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, _v, _v2);
  }

  render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    if (this.viewMode === 'self') this.renderer.render(this.vmScene, this.vmCamera);
  }
}

/* ---------- pickup meshes ---------- */
function makePickupMesh(type) {
  const g = new THREE.Group();
  if (type === 'health') {
    const m = new THREE.MeshLambertMaterial({ color: 0x2ee68a, emissive: 0x0a4a2c });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.22), m),
      new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.66, 0.22), m));
  } else if (type === 'shield') {
    const m = new THREE.MeshLambertMaterial({ color: 0x4cc9ff, emissive: 0x0d3c55 });
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.42), m));
  } else {
    const m = new THREE.MeshLambertMaterial({ color: 0xffd60a, emissive: 0x4a3a00 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.42), m),
      new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 0.44), new THREE.MeshLambertMaterial({ color: 0x1a1a1a })));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
