// ============ DOM heads-up display ============
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { clamp, fmtTime } from '../core/util.js';
import { getWeapon, WEAPON_IDS } from '../weapons/defs.js';
import { binds, codeLabel } from '../core/keybinds.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'), scope: $('scope'),
      hpFill: $('hp-fill'), hpNum: $('hp-num'), shFill: $('sh-fill'), shNum: $('sh-num'),
      ammo: $('ammo'), mag: $('ammo-mag'), res: $('ammo-res'), wname: $('weapon-name'),
      reloadHint: $('reload-hint'), reloadBar: $('reload-bar'), reloadFill: $('reload-fill'),
      wheel: $('weapon-wheel'), killfeed: $('killfeed'), toast: $('center-toast'),
      killPopup: $('kill-popup'), pickupToast: $('pickup-toast'), vignette: $('dmg-vignette'),
      hitDirs: $('hit-dirs'), floatDmg: $('float-dmg'), scoreA: $('score-a'), scoreB: $('score-b'),
      lblA: $('lbl-a'), lblB: $('lbl-b'), timer: $('match-timer'), modeTag: $('mode-tag'),
      scoreboard: $('scoreboard'), sbBody: $('sb-body'), sbTitle: $('sb-title'), sbSub: $('sb-sub'),
      respawn: $('respawn'), rsName: $('rs-name'), rsWeapon: $('rs-weapon'), rsSec: $('rs-sec'),
      streak: $('streak-chip'), streakN: $('streak-n'),
      fps: $('fps'), usePrompt: $('use-prompt'), alive: $('alive-count'),
      prep: $('prep'), prepNum: $('prep-num'), spectating: $('spectating'), specName: $('spec-name'),
      stance: $('stance'),
    };
    this.vigT = 0; this.hitmarkT = 0;
    this.keyHint = id => codeLabel((binds[id] || [])[0]);
    this.kfItems = [];
    this.slotEls = new Map();
    this.buildWheel();
    this.refreshKeyHints();
    document.documentElement.style.setProperty('--ch', settings.crosshairColor);
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  /** every on-screen key prompt reads from the live bindings */
  refreshKeyHints() {
    this.el.reloadHint.innerHTML = `PRESS <b>${this.keyHint('reload')}</b> TO RELOAD`;
    const foot = document.querySelector('.sb-foot');
    if (foot) foot.innerHTML = `HOLD <b>${this.keyHint('scoreboard')}</b>`;
    const spec = document.querySelector('#spectating i');
    if (spec) spec.textContent = `${this.keyHint('spectNext')} for next`;
    this._crate = null;                      // force the pickup prompt to redraw
  }

  buildWheel() {
    this.el.wheel.innerHTML = '';
    this.slotEls.clear();
    for (const id of WEAPON_IDS) {
      const w = getWeapon(id);
      const d = document.createElement('div');
      d.className = 'wslot';
      d.innerHTML = `<span>${w.name}</span><b>${w.slot}</b>`;
      d.style.display = 'none';
      this.el.wheel.appendChild(d);
      this.slotEls.set(id, d);
    }
  }

  updateWheel(arsenal) {
    for (const [id, el] of this.slotEls) {
      const has = arsenal.has(id);
      el.style.display = has ? 'flex' : 'none';
      el.classList.toggle('on', arsenal.current === id);
    }
  }

  /* ---------- per-frame ---------- */
  update(dt, player) {
    const hpF = clamp(player.health / player.maxHealth, 0, 1);
    this.el.hpFill.style.width = (hpF * 100) + '%';
    this.el.hpNum.textContent = Math.ceil(Math.max(0, player.health));
    this.el.hpNum.classList.toggle('low', hpF < 0.3);
    const shF = clamp(player.shield / player.maxShield, 0, 1);
    this.el.shFill.style.width = (shF * 100) + '%';
    this.el.shNum.textContent = Math.ceil(player.shield);

    const ars = player.arsenal, w = ars.def;
    const a = ars.ammo;
    this.el.mag.textContent = w.melee ? '∞' : a.mag;
    this.el.res.textContent = w.melee ? '' : a.reserve;
    this.el.ammo.classList.toggle('empty', !w.melee && a.mag === 0);
    this.el.wname.textContent = w.name;
    this.el.reloadHint.classList.toggle('hidden', !(!w.melee && a.mag === 0 && a.reserve > 0 && !ars.reloading));

    if (ars.reloading) {
      this.el.reloadBar.classList.add('on');
      this.el.reloadFill.style.width = ((1 - ars.reloadT / ars.reloadTotal) * 100) + '%';
    } else this.el.reloadBar.classList.remove('on');

    // crosshair opens with the real spread cone
    const spread = ars.currentSpread(player.speed / 3.7, !player.grounded, player.adsAmt > 0.8, player.crouching);
    const gap = clamp(3 + spread * 7, 3, 60);
    this.el.crosshair.style.setProperty('--gap', gap + 'px');
    const scoped = w.scope && player.adsAmt > 0.72;
    this.el.scope.classList.toggle('hidden', !scoped);
    this.el.crosshair.style.opacity = scoped ? 0 : (player.alive ? 1 : 0);

    // vignette decay
    if (this.vigT > 0) {
      this.vigT -= dt;
      this.el.vignette.style.opacity = clamp(this.vigT * 1.6, 0, 1) * this.vigAmt;
      if (this.vigT <= 0) this.el.vignette.style.opacity = 0;
    }
    // permanent low-hp tint
    if (hpF < 0.3 && player.alive) this.el.vignette.style.opacity = Math.max(this.el.vignette.style.opacity || 0, (0.3 - hpF) * 1.4);

    this.updateWheel(ars);
    this.setStance(player);

    if (player.streak >= 2 && player.alive) {
      this.el.streak.classList.remove('hidden');
      this.el.streakN.textContent = player.streak;
    } else this.el.streak.classList.add('hidden');
  }

  setFps(v) { if (this.el.fps) this.el.fps.textContent = v + ' FPS'; }

  setAlive(a, b) {
    if (!this.el.alive) return;
    this.el.alive.classList.remove('hidden');
    this.el.alive.innerHTML = `<b class="a">${a}</b><span>ALIVE</span><b class="b">${b}</b>`;
  }

  setPrep(seconds) {
    if (!this.el.prep) return;
    if (seconds == null) { this.el.prep.classList.add('hidden'); return; }
    this.el.prep.classList.remove('hidden');
    this.el.prepNum.textContent = Math.max(0, Math.ceil(seconds));
  }

  setSpectating(name) {
    if (!this.el.spectating) return;
    this.el.spectating.classList.toggle('hidden', !name);
    if (name) this.el.specName.textContent = name;
  }

  /** stance + silent-walk readout, so you always know how loud you are */
  setStance(player) {
    if (!this.el.stance) return;
    const s = player.crouching ? 'CROUCH' : player.walking ? 'WALK' : player.sprinting ? 'SPRINT' : 'STAND';
    const quiet = player.walking || player.crouching;
    this.el.stance.textContent = s;
    this.el.stance.classList.toggle('quiet', quiet);
    this.el.stance.classList.toggle('loud', player.sprinting);
  }

  usePrompt(crate) {
    const el = this.el.usePrompt;
    if (!el) return;
    if (!crate) { el.classList.add('hidden'); this._crate = null; return; }
    if (this._crate !== crate.id) {
      this._crate = crate.id;
      el.innerHTML = `<b>${this.keyHint('use')}</b> PICK UP ${getWeapon(crate.id).name}`;
    }
    el.classList.remove('hidden');
  }

  /* ---------- feedback ---------- */
  hitmarker(kill, head) {
    const el = this.el.hitmarker;
    el.classList.remove('show'); void el.offsetWidth;
    el.classList.toggle('kill', !!kill);
    el.classList.add('show');
    this.game.audio.hitmark(head);
    if (kill) this.game.audio.killChime();
  }

  floatDamage(worldPos, amount, head) {
    const cam = this.game.camera;
    _v.copy(worldPos).project(cam);
    if (_v.z > 1) return;
    const x = (_v.x * 0.5 + 0.5) * innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * innerHeight;
    const d = document.createElement('div');
    d.className = 'fdmg' + (head ? ' head' : '');
    d.textContent = head ? amount + '!' : amount;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    this.el.floatDmg.appendChild(d);
    setTimeout(() => d.remove(), 760);
  }

  damageFlash(amount) { this.vigT = 0.55; this.vigAmt = amount; }

  damageDirection(angleRad) {
    const d = document.createElement('div');
    d.className = 'hitdir';
    d.style.transform = `rotate(${angleRad}rad)`;
    this.el.hitDirs.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  killfeed(killerName, victimName, weaponId, headshot, isMe, victimIsMe) {
    const w = getWeapon(weaponId);
    const d = document.createElement('div');
    d.className = 'kf' + (isMe ? ' me' : '') + (victimIsMe ? ' victim-me' : '');
    d.innerHTML = `<span class="k">${killerName}</span><span class="ico">${headshot ? '<span class="hs">✧</span>' : ''} ⟶</span><span class="v">${victimName}</span>`;
    d.title = w.name;
    this.el.killfeed.appendChild(d);
    this.kfItems.push(d);
    if (this.kfItems.length > 5) this.kfItems.shift().remove();
    setTimeout(() => { d.remove(); const i = this.kfItems.indexOf(d); if (i >= 0) this.kfItems.splice(i, 1); }, 6500);
  }

  centerToast(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  killPopup(text) {
    const el = this.el.killPopup;
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  pickupToast(text, color = '#00ffa8') {
    const d = document.createElement('div');
    d.className = 'pk'; d.textContent = text; d.style.color = color;
    this.el.pickupToast.appendChild(d);
    setTimeout(() => d.remove(), 1450);
  }

  /* ---------- match state ---------- */
  setMode(text) { this.el.modeTag.textContent = text; }
  setScores(a, b, labelA, labelB) {
    this.el.scoreA.textContent = a; this.el.scoreB.textContent = b;
    this.el.lblA.textContent = labelA; this.el.lblB.textContent = labelB;
  }
  setTimer(sec) {
    this.el.timer.textContent = fmtTime(sec);
    this.el.timer.classList.toggle('urgent', sec <= 30);
  }

  showRespawn(show, killer, weaponId, secs) {
    this.el.respawn.classList.toggle('hidden', !show);
    if (show) {
      this.el.rsName.textContent = killer || '—';
      this.el.rsWeapon.textContent = weaponId ? getWeapon(weaponId).name : '';
      this.el.rsSec.textContent = Math.ceil(secs);
    }
  }

  scoreboard(show, data) {
    this.el.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    const { title, sub, rows, teams } = data;
    this.el.sbTitle.textContent = title;
    this.el.sbSub.textContent = sub;
    const head = `<div class="sb-row hd"><span>#</span><span>PLAYER</span><span class="num">KILLS</span><span class="num">DEATHS</span><span class="num">K/D</span></div>`;
    const renderRows = list => list.map((r, i) => `
      <div class="sb-row ${r.isMe ? 'me' : ''} ${r.team === 0 ? 'teamA' : 'teamB'} ${r.alive ? '' : 'dead'}">
        <span>${i + 1}</span><span class="n">${r.name}</span>
        <span class="num">${r.kills}</span><span class="num">${r.deaths}</span>
        <span class="num">${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</span>
      </div>`).join('');
    if (teams) {
      this.el.sbBody.innerHTML = head +
        `<div class="sb-team-hd" style="color:var(--mint)">TEAM MINT — ${teams[0]}</div>` + renderRows(rows.filter(r => r.team === 0)) +
        `<div class="sb-team-hd" style="color:var(--red)">TEAM CRIMSON — ${teams[1]}</div>` + renderRows(rows.filter(r => r.team === 1));
    } else {
      this.el.sbBody.innerHTML = head + renderRows(rows);
    }
  }
}
