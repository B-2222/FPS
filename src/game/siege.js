// ============ SIEGE — attack vs defend, one life, plant or defuse ============
// Attackers must reach the objective and plant the defuser, then hold for its
// timer. Defenders win by wiping the attack, running out the clock, or pulling
// the defuser back out. Sides swap every round.
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { clamp } from '../core/util.js';

export const PHASE = { PREP: 'prep', ACTION: 'action', OVER: 'over' };

const PLANT_TIME = 4.0;
const DEFUSE_TIME = 5.0;
const DEFUSER_FUSE = 32;

export class SiegeMode {
  constructor(game) {
    this.game = game;
    this.rounds = [0, 0];          // [player-team wins, enemy-team wins]
    this.roundNo = 0;
    this.phase = PHASE.PREP;
    this.t = 0;
    this.site = null;
    this.planted = false;
    this.defuser = null;           // {pos, mesh, fuse}
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.playerSide = 'atk';
  }

  /* ---------- lifecycle ---------- */
  begin(cfg) {
    this.cfg = cfg;
    this.rounds = [0, 0];
    this.roundNo = 0;
    this.beginRound(true);
  }

  beginRound(first = false) {
    const g = this.game;
    this.roundNo++;
    // sides swap every round so you play both halves of the game
    this.playerSide = this.roundNo % 2 === 1 ? 'atk' : 'def';
    this.phase = PHASE.PREP;
    this.t = this.cfg.prepTime ?? 8;
    this.planted = false;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.clearDefuser();
    this.site = g.objectives[(this.roundNo - 1) % g.objectives.length];

    g.assignSides(this.playerSide);
    g.frozen = false;
    g.attackersFrozen = true;      // attackers hold outside during prep
    g.gadgets.clear();
    g.restoreGeometry();
    for (const a of g.actors) g.respawn(a, true);
    g.hud.setSpectating(null);
    g.hud.showRespawn(false);
    if (!first) g.hud.centerToast(`ROUND ${this.roundNo}`);
    g.hud.pickupToast(this.playerSide === 'atk' ? 'YOU ARE ATTACKING' : 'YOU ARE DEFENDING',
      this.playerSide === 'atk' ? '#ff9f43' : '#4cc9ff');
    this.updateHud();
  }

  endRound(winnerSide, reason) {
    if (this.phase === PHASE.OVER) return;
    const g = this.game;
    this.phase = PHASE.OVER;
    this.t = 5;
    g.frozen = true;
    const playerWon = winnerSide === this.playerSide;
    this.rounds[playerWon ? 0 : 1]++;
    g.hud.centerToast(playerWon ? 'ROUND WON' : 'ROUND LOST');
    g.hud.pickupToast(reason, playerWon ? '#00ffa8' : '#ff3b5c');
    audio.tone(playerWon ? 660 : 300, 0.5, 0.3, 'triangle', playerWon ? 990 : 200);
    this.updateHud();
  }

  /* ---------- per frame ---------- */
  update(dt) {
    const g = this.game;
    this.t -= dt;

    if (this.phase === PHASE.PREP) {
      g.hud.setPrep(this.t);
      g.hud.setObjective(this.playerSide === 'atk'
        ? `PREPARE — <b>${this.site.name}</b> IS THE SITE`
        : `FORTIFY — DEFEND <b>${this.site.name}</b>`, this.playerSide);
      if (this.t <= 0) {
        this.phase = PHASE.ACTION;
        this.t = this.cfg.roundTime ?? 150;
        g.attackersFrozen = false;
        g.hud.setPrep(null);
        g.hud.centerToast('GO');
      }
      this.updateHud();
      return;
    }

    if (this.phase === PHASE.ACTION) {
      const atkAlive = g.sideAlive('atk'), defAlive = g.sideAlive('def');
      if (this.planted) {
        this.defuser.fuse -= dt;
        if (this.defuser.mesh) {
          const fast = this.defuser.fuse < 10;
          this.defuser.blink = (this.defuser.blink || 0) + dt * (fast ? 14 : 6);
          this.defuser.mesh.children[1].visible = Math.sin(this.defuser.blink) > 0;
          if (Math.sin(this.defuser.blink) > 0.98) audio.click(this.defuser.pos, { freq: fast ? 1600 : 1200, dur: 0.04, vol: 0.16 });
        }
        if (this.defuser.fuse <= 0) return this.endRound('atk', 'DEFUSER DETONATED');
      }
      if (defAlive === 0) return this.endRound('atk', 'DEFENDERS ELIMINATED');
      if (atkAlive === 0 && !this.planted) return this.endRound('def', 'ATTACKERS ELIMINATED');
      if (this.t <= 0 && !this.planted) return this.endRound('def', 'TIME EXPIRED');
      g.hud.setTimer(this.planted ? this.defuser.fuse : this.t);
      this.updateHud();
      return;
    }

    if (this.t <= 0) {
      const need = this.cfg.roundsToWin ?? 4;
      if (this.rounds[0] >= need || this.rounds[1] >= need) {
        this.game.endMatch({ siegeWin: this.rounds[0] > this.rounds[1] });
      } else this.beginRound();
    }
  }

  updateHud() {
    const g = this.game;
    g.hud.setScores(this.rounds[0], this.rounds[1], 'YOU', 'THEM');
    g.hud.setAlive(g.sideAlive(this.playerSide), g.sideAlive(this.playerSide === 'atk' ? 'def' : 'atk'));
    if (this.phase === PHASE.ACTION) {
      if (this.planted) {
        g.hud.setObjective(this.playerSide === 'atk'
          ? 'DEFUSER PLANTED — HOLD THEM OFF' : 'DEFUSER PLANTED — DEFUSE IT', 'planted');
      } else {
        g.hud.setObjective(this.playerSide === 'atk'
          ? `PLANT AT <b>${this.site.name}</b>` : `DEFEND <b>${this.site.name}</b>`, this.playerSide);
      }
    }
  }

  /* ---------- objective interaction ---------- */
  atSite(pos) {
    const s = this.site;
    return Math.hypot(pos.x - s.x, pos.z - s.z) < s.r && Math.abs(pos.y - s.y) < 3.2;
  }

  /** called while an actor holds the use key; returns {label, frac} for the HUD */
  interact(actor, dt) {
    if (this.phase !== PHASE.ACTION) return null;
    const side = this.game.sideOf(actor);
    if (side === 'atk' && !this.planted) {
      if (!this.atSite(actor.pos)) return null;
      this.plantProgress += dt;
      if (this.plantProgress >= PLANT_TIME) this.plant(actor);
      return { label: 'PLANTING DEFUSER', frac: this.plantProgress / PLANT_TIME };
    }
    if (side === 'def' && this.planted) {
      if (actor.pos.distanceTo(this.defuser.pos) > 2.6) return null;
      this.defuseProgress += dt;
      if (this.defuseProgress >= DEFUSE_TIME) this.endRound('def', 'DEFUSER DISARMED');
      return { label: 'DEFUSING', frac: this.defuseProgress / DEFUSE_TIME };
    }
    return null;
  }

  releaseInteract(actor) {
    const side = this.game.sideOf(actor);
    if (side === 'atk') this.plantProgress = Math.max(0, this.plantProgress - 0.06);
    else this.defuseProgress = Math.max(0, this.defuseProgress - 0.06);
  }

  plant(actor) {
    const g = this.game;
    this.planted = true;
    this.plantProgress = 0;
    const pos = actor.pos.clone();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.34),
      new THREE.MeshLambertMaterial({ color: 0x2a2f36 }));
    body.position.y = 0.17;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2d55 }));
    led.position.set(0, 0.4, 0);
    grp.add(body, led);
    grp.position.copy(pos);
    g.scene.add(grp);
    this.defuser = { pos, mesh: grp, fuse: DEFUSER_FUSE };
    g.hud.centerToast('DEFUSER PLANTED');
    audio.tone(520, 0.3, 0.3, 'square', 900);
  }

  clearDefuser() {
    if (this.defuser?.mesh) this.game.scene.remove(this.defuser.mesh);
    this.defuser = null;
  }

  /** where a bot should be heading, and what it should do when it arrives */
  goalFor(bot) {
    const g = this.game;
    const side = g.sideOf(bot);
    if (this.phase !== PHASE.ACTION) {
      if (side === 'def') return { pos: this.sitePos(), action: null, radius: 9 };
      return null;
    }
    if (side === 'atk') {
      if (this.planted) return null;                       // planted: go hunting
      return { pos: this.sitePos(), action: 'plant', radius: this.site.r * 0.7 };
    }
    if (this.planted) return { pos: this.defuser.pos, action: 'defuse', radius: 2.2 };
    return { pos: this.sitePos(), action: null, radius: 10 };
  }

  sitePos() {
    if (!this._sitePos) this._sitePos = new THREE.Vector3();
    return this._sitePos.set(this.site.x, this.site.y, this.site.z);
  }

  get roundsScore() { return this.rounds; }
}
