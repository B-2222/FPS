// ============ match orchestration ============
import * as THREE from 'three';
import { buildMap, ARENA } from '../world/map.js';
import { NavGrid } from '../world/nav.js';
import { FX } from '../fx/effects.js';
import { HUD } from '../ui/hud.js';
import { Minimap } from '../ui/minimap.js';
import { Player } from '../entities/player.js';
import { Bot, DIFFICULTY } from '../entities/bot.js';
import { ViewModel } from '../weapons/viewmodel.js';
import { buildWorldWeapon } from '../weapons/models.js';
import { Arsenal } from '../entities/actor.js';
import { updateProjectiles } from './combat.js';
import { bodyFree } from '../world/collision.js';
import { MOVE } from '../entities/movement.js';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { input, down, hit, requestLock, exitLock, endFrameInput } from '../core/input.js';
import { clamp, rand, randInt, pick, botName, damp } from '../core/util.js';
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
    this.pathBudget = 3;
    this.onMatchEnd = null;
    this.usedNames = new Set();
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

    // viewmodel gets its own scene + camera so walls never clip the gun
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.005, 12);
    this.vmScene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3038, 1.35));
    const vmKey = new THREE.DirectionalLight(0xffffff, 1.5);
    vmKey.position.set(-0.6, 1.2, 0.9);
    this.vmScene.add(vmKey);
    const vmRim = new THREE.DirectionalLight(0x88bbff, 0.7);
    vmRim.position.set(0.9, -0.2, -1);
    this.vmScene.add(vmRim);

    // world
    const built = buildMap(this.scene, quality);
    this.world = built.world;
    this.spawnPoints = built.spawns;
    this.jumpPads = built.jumpPads;
    this.bounds = built.bounds;
    this.mapPickups = built.pickups;
    this.mapWeapons = built.weaponSpawns;

    this.nav = new NavGrid(this.world, { half: this.bounds + 2, cell: 2.4 }).build();
    this.validateSpawns();

    this.fx = new FX(this.scene, this.vmScene, quality);
    this.fx.blood = settings.blood;
    this.hud = new HUD(this);
    this.minimap = new Minimap(this, document.getElementById('minimap'));
    this.viewModel = new ViewModel(this.vmScene, this.camera);

    this.player = new Player(this);

    addEventListener('resize', () => this.resize());
    this.resize();
    return this;
  }

  /** drop spawn points that sit inside geometry, and top the list up from the nav grid */
  validateSpawns() {
    const ok = [];
    for (const sp of this.spawnPoints) {
      if (bodyFree(this.world, sp.x, sp.y + 0.05, sp.z, MOVE.radius, MOVE.height)) { ok.push(sp); continue; }
      // try the walkable node nearest to it before giving up on the location
      const n = this.nav.nodes[this.nav.nearest({ x: sp.x, y: sp.y, z: sp.z })];
      if (n && bodyFree(this.world, n.x, n.y + 0.05, n.z, MOVE.radius, MOVE.height)) ok.push({ x: n.x, y: n.y, z: n.z });
    }
    while (ok.length < 12) {
      const n = this.nav.randomNode();
      if (n) ok.push({ x: n.x, y: n.y, z: n.z });
    }
    this.spawnPoints = ok;
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
      mode: cfg.mode || 'ffa', botCount: cfg.bots ?? 7, difficulty: cfg.difficulty || 'normal',
      scoreLimit: cfg.scoreLimit ?? 30, timeLimit: cfg.timeLimit ?? 600,
    };
    this.clearMatch();
    this.time = 0;
    this.matchTime = this.cfg.timeLimit;
    this.over = false;
    this.multiKill = 0; this.lastKillT = -9;

    const teams = this.cfg.mode === 'tdm';
    this.player.team = 0;
    this.player.kills = this.player.deaths = this.player.score = this.player.streak = 0;
    this.player.damageDealt = this.player.shotsFired = this.player.shotsHit = this.player.headshots = 0;
    this.player.gunGameTier = 0;
    this.player.arsenal = new Arsenal(this.player, settings.loadout);
    this.actors = [this.player];

    for (let i = 0; i < this.cfg.botCount; i++) {
      const team = teams ? (i % 2 === 0 ? 1 : 0) : i + 1;
      const color = teams ? TEAM_COLORS[team] : FFA_COLORS[i % FFA_COLORS.length];
      const weapon = this.cfg.mode === 'gungame' ? GUNGAME_LADDER[0] : pick(WEAPON_IDS);
      const bot = new Bot(this, {
        name: botName(this.usedNames), team, difficulty: this.cfg.difficulty,
        weapon, color, accent: teams ? (team === 0 ? 0x0e8a63 : 0xa61f38) : 0x2a2f38,
      });
      this.bots.push(bot);
      this.actors.push(bot);
    }

    this.spawnPickups();
    this.spawnWeaponCrates();

    // everyone into the world
    this.respawn(this.player, true);
    for (const b of this.bots) this.respawn(b, true);

    const modeName = this.cfg.mode === 'ffa' ? 'FREE FOR ALL' : this.cfg.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'GUN GAME';
    const sub = this.cfg.mode === 'gungame'
      ? `${GUNGAME_LADDER.length} WEAPONS — ONE KILL EACH`
      : `FIRST TO ${this.cfg.scoreLimit} — ${DIFFICULTY[this.cfg.difficulty].label} BOTS`;
    this.hud.setMode(`${modeName} — ${sub}`);
    this.hud.show(true);
    this.updateScoreHud();
    this.running = true; this.paused = false;
    this.hud.centerToast('FIGHT');
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
    this.usedNames.clear();
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
    for (const spec of this.mapWeapons) {
      const g = new THREE.Group();
      const model = buildCrateWeapon(spec.id);
      g.add(model);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.035, 6, 24),
        new THREE.MeshBasicMaterial({ color: getWeapon(spec.id).color, transparent: true, opacity: 0.75 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.position.set(spec.x, (spec.y ?? 0) + 0.9, spec.z);
      this.scene.add(g);
      this.weaponCrates.push({
        id: spec.id, pos: g.position.clone(), mesh: g, active: true, t: rand(0, 6), respawn: 0, ring,
      });
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
        if (this.grantPickup(a, p)) {
          p.active = false; p.mesh.visible = false; p.respawn = p.respawnTime;
          break;
        }
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
      // bots grab crates that upgrade them; the player presses E
      for (const b of this.bots) {
        if (!b.alive || b.pos.distanceTo(c.pos) > 1.9) continue;
        const cur = b.arsenal.ammo;
        const wantsIt = !b.arsenal.has(c.id) || (cur && cur.mag + cur.reserve <= 0);
        if (wantsIt && this.cfg.mode !== 'gungame') {
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
      if (a === this.player) { audio.pickup('shield'); this.hud.pickupToast(`+${Math.round(got)} SHIELD`, '#4cc9ff'); }
      return true;
    }
    if (p.type === 'ammo') {
      if (!a.arsenal.refillAmmo(0.5)) return false;
      if (a === this.player) { audio.pickup('ammo'); this.hud.pickupToast('AMMO RESUPPLIED', '#ffd60a'); }
      return true;
    }
    return false;
  }

  /** the weapon crate the player could pick up right now, if any */
  nearbyCrate() {
    if (this.cfg.mode === 'gungame' || !this.player.alive) return null;
    let best = null, bd = 3.2;
    for (const c of this.weaponCrates) {
      if (!c.active) continue;
      const d = c.pos.distanceTo(this.player.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** player pressing E near a weapon crate */
  tryPickup(actor) {
    if (this.cfg.mode === 'gungame') { this.hud.pickupToast('WEAPONS ARE LOCKED IN GUN GAME', '#ff7a90'); return; }
    let best = null, bd = 3.2;
    for (const c of this.weaponCrates) {
      if (!c.active) continue;
      const d = c.pos.distanceTo(actor.pos);
      if (d < bd) { bd = d; best = c; }
    }
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
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < this.spawnPoints.length; i++) {
      const sp = this.spawnPoints[(i + randInt(0, 3)) % this.spawnPoints.length];
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
    actor.yaw = Math.atan2(-(0 - sp.x), -(0 - sp.z)) + Math.PI;   // face the middle of the map
    if (this.cfg.mode === 'gungame') {
      const id = GUNGAME_LADDER[clamp(actor.gunGameTier, 0, GUNGAME_LADDER.length - 1)];
      actor.arsenal.slots.clear(); actor.arsenal.order = [];
      actor.arsenal.give(id, true);
      actor.arsenal.select(id, true);
    }
    if (actor === this.player) {
      this.hud.showRespawn(false);
      this.viewModel.setWeapon(actor.arsenal.current);
    }
  }

  /* ================= events ================= */
  friendly(a, b) {
    if (a === b) return true;
    if (this.cfg?.mode !== 'tdm') return false;
    return a.team === b.team;
  }

  canPlayerSee(actor) {
    const p = this.player;
    if (!p.alive) return false;
    p.eyePos(_v);
    _v2.set(actor.pos.x, actor.pos.y + actor.height * 0.6, actor.pos.z);
    if (_v.distanceTo(_v2) > 70) return false;
    // rough frustum check
    _v3.copy(_v2).sub(_v).normalize();
    p.aimDir(_v4);
    if (_v3.dot(_v4) < 0.25) return false;
    return this.world.losClear(_v, _v2);
  }

  onGunshot(pos, shooter) {
    shooter.lastFiredAt = this.time;
    for (const b of this.bots) if (b !== shooter) b.hearShot(pos, shooter);
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
      if (this.cfg.mode === 'gungame') {
        killer.gunGameTier++;
        if (killer.gunGameTier >= GUNGAME_LADDER.length) { this.endMatch(killer); return; }
        const nid = GUNGAME_LADDER[killer.gunGameTier];
        killer.arsenal.slots.clear(); killer.arsenal.order = [];
        killer.arsenal.give(nid, true);
        killer.arsenal.select(nid, true);
        if (killer === this.player) {
          this.viewModel.setWeapon(nid);
          this.hud.killPopup(`TIER ${killer.gunGameTier + 1} — ${getWeapon(nid).name}`);
        }
      }
    } else if (isSuicide) {
      killer = null;
    }

    this.hud.killfeed(killer ? killer.name : 'THE VOID', victim.name, weaponId, headshot,
      killer === this.player, victim === this.player);

    if (killer === this.player) {
      // multi-kill escalation
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
      this.respawnTimer = 3;
      this.hud.showRespawn(true, killer?.name || 'THE VOID', weaponId, this.respawnTimer);
      this.hud.damageFlash(1);
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
      if (v > 26) {
        const res = actor.applyDamage(clamp((v - 26) * 2.4, 0, 60), null, { fall: true });
        actor.onDamaged?.(res.dealt, null, { point: actor.pos, part: 'legs' }, { id: 'fall' });
        if (res.killed) this.onKill(null, actor, 'fall', false);
      }
    }
  }
  onJumpPad(actor, pad) {
    audio.tone(520, 0.18, 0.3, 'sine', 1100);
    if (actor === this.player) actor.addShake(0.25);
    this.fx.spawnBeam(_v.set(pad.x, pad.y, pad.z));
  }
  onSlide(actor) { if (actor === this.player) audio.footstep(actor.pos, true); }
  onReloadStart(actor, w) {
    if (actor === this.player || actor.pos.distanceTo(this.player.pos) < 22) {
      audio.click(actor === this.player ? null : actor.pos, { freq: 780, dur: 0.09, vol: 0.3 });
      setTimeout(() => audio.click(actor === this.player ? null : actor.pos, { freq: 1250, dur: 0.07, vol: 0.26 }), w.reload * 500);
    }
  }
  onReloadEnd(actor, w) {
    if (actor === this.player) audio.click(null, { freq: 1600, dur: 0.06, vol: 0.28 });
  }
  onShellLoaded(actor, w) {
    if (actor === this.player) audio.click(null, { freq: 1100, dur: 0.05, vol: 0.24 });
  }
  onWeaponChanged(actor, id) {
    if (actor === this.player) {
      this.viewModel.setWeapon(id);
      audio.click(null, { freq: 900, dur: 0.07, vol: 0.22 });
    } else if (actor.model) actor.model.setWeapon(id);
  }

  shakeFromExplosion(pos, radius) {
    const d = this.player.pos.distanceTo(pos);
    if (d < radius * 2.6) this.player.addShake(clamp(1.8 * (1 - d / (radius * 2.6)), 0, 1.8));
  }

  /* ================= scoring ================= */
  teamScore(t) { return this.actors.filter(a => a.team === t).reduce((s, a) => s + a.kills, 0); }

  updateScoreHud() {
    if (this.cfg.mode === 'tdm') {
      this.hud.setScores(this.teamScore(0), this.teamScore(1), 'MINT', 'CRIMSON');
    } else if (this.cfg.mode === 'gungame') {
      const top = Math.max(...this.actors.filter(a => a !== this.player).map(a => a.gunGameTier), 0);
      this.hud.setScores(this.player.gunGameTier + 1, top + 1, 'TIER', 'BEST BOT');
    } else {
      const top = Math.max(...this.actors.filter(a => a !== this.player).map(a => a.kills), 0);
      this.hud.setScores(this.player.kills, top, 'YOU', 'BEST BOT');
    }
  }

  checkWin() {
    if (this.over) return;
    const lim = this.cfg.scoreLimit;
    if (this.cfg.mode === 'tdm') {
      if (this.teamScore(0) >= lim) return this.endMatch({ team: 0 });
      if (this.teamScore(1) >= lim) return this.endMatch({ team: 1 });
    } else if (this.cfg.mode === 'ffa') {
      for (const a of this.actors) if (a.kills >= lim) return this.endMatch(a);
    }
  }

  endMatch(winner) {
    if (this.over) return;
    this.over = true; this.running = false;
    exitLock();
    const rows = this.scoreRows();
    let won = false, title = 'DEFEAT';
    if (this.cfg.mode === 'tdm') {
      won = winner?.team === 0; title = won ? 'VICTORY' : 'DEFEAT';
    } else {
      won = winner === this.player; title = won ? 'VICTORY' : 'DEFEAT';
    }
    this.hud.show(false);
    this.onMatchEnd?.({
      title, won, rows, teams: this.cfg.mode === 'tdm',
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
      score: this.cfg.mode === 'gungame' ? a.gunGameTier : a.kills,
    })).sort((x, y) => y.score - x.score || x.deaths - y.deaths);
  }

  /* ================= main loop ================= */
  update(dt) {
    this.time += dt;
    this.pathBudget = 3;

    if (this.cfg.timeLimit > 0) {
      this.matchTime -= dt;
      this.hud.setTimer(this.matchTime);
      if (this.matchTime <= 0) {
        const rank = this.cfg.mode === 'gungame'
          ? (a, b) => b.gunGameTier - a.gunGameTier || b.kills - a.kills
          : (a, b) => b.kills - a.kills;
        this.endMatch(this.cfg.mode === 'tdm'
          ? { team: this.teamScore(0) >= this.teamScore(1) ? 0 : 1 }
          : this.actors.slice().sort(rank)[0]);
        return;
      }
    }

    // ---- player ----
    this.player.update(dt);
    if (!this.player.alive) {
      this.respawnTimer -= dt;
      this.hud.showRespawn(true, this.player.killedBy, this.player.killedWith, this.respawnTimer);
      if (this.respawnTimer <= 0) this.respawn(this.player);
    }

    // ---- bots ----
    for (const b of this.bots) {
      b.update(dt);
      if (!b.alive) {
        b.respawnTimer -= dt;
        if (b.respawnTimer <= 0) this.respawn(b);
      }
    }

    updateProjectiles(this, dt);
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
    if (down('Tab')) this.hud.scoreboard(true, {
      title: this.cfg.mode === 'tdm' ? 'TEAM DEATHMATCH' : this.cfg.mode === 'gungame' ? 'GUN GAME' : 'FREE FOR ALL',
      sub: this.cfg.mode === 'gungame' ? `TIER ${this.player.gunGameTier + 1} / ${GUNGAME_LADDER.length}` : `FIRST TO ${this.cfg.scoreLimit}`,
      rows: this.scoreRows(), teams: this.cfg.mode === 'tdm' ? [this.teamScore(0), this.teamScore(1)] : null,
    });
    else this.hud.scoreboard(false);

    // ---- viewmodel ----
    const ars = this.player.arsenal;
    this.viewModel.update(dt, {
      weaponId: ars.current, speed: this.player.speed, grounded: this.player.grounded,
      ads: this.player.adsing, sprint: this.player.sprinting, crouching: this.player.crouching,
      reloading: ars.reloading, reloadFrac: ars.reloading ? 1 - ars.reloadT / ars.reloadTotal : 0,
      swapFrac: ars.swapT > 0 ? 1 - ars.swapT / ars.swapTotal : 0,
      pumping: ars.pumpT > 0, pumpFrac: ars.pumpT > 0 ? 1 - ars.pumpT / 0.28 : 0,
      melee: this.player.meleeT > 0, meleeFrac: 1 - this.player.meleeT / 0.42,
      mouseDX: input.mouseDX, mouseDY: input.mouseDY, bobEnabled: settings.bob,
    });

    // audio listener rides the camera
    const cam = this.camera;
    _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, _v, _v2);
  }

  render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }
}

/* ---------- pickup meshes ---------- */
function makePickupMesh(type) {
  const g = new THREE.Group();
  if (type === 'health') {
    const m = new THREE.MeshLambertMaterial({ color: 0x2ee68a, emissive: 0x0a4a2c });
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.22), m);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.66, 0.22), m);
    g.add(a, b);
  } else if (type === 'shield') {
    const m = new THREE.MeshLambertMaterial({ color: 0x4cc9ff, emissive: 0x0d3c55 });
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), m);
    g.add(s);
  } else {
    const m = new THREE.MeshLambertMaterial({ color: 0xffd60a, emissive: 0x4a3a00 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.42), m);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 0.44),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    g.add(box, stripe);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function buildCrateWeapon(id) {
  const w = buildWorldWeapon(id);
  w.rotation.y = Math.PI / 2;
  w.scale.setScalar(1.05);
  return w;
}
