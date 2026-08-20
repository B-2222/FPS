// ============ boot, menus, main loop ============
import { Game } from './game/game.js';
import { settings, loadSettings, saveSettings, cm360 } from './core/settings.js';
import { initInput, input, requestLock, exitLock, endFrameInput, beginCapture } from './core/input.js';
import {
  ACTIONS, ACTION_GROUPS, binds, loadBinds, saveBinds, resetBinds,
  setBind, clearBind, conflicts, codeLabel,
} from './core/keybinds.js';
import { audio, setAudioVolume } from './core/audio.js';
import { WEAPON_IDS, WEAPONS, getWeapon } from './weapons/defs.js';
import { ATTACKERS, DEFENDERS, GADGET_INFO } from './game/operators.js';
import { MAP_META } from './world/maps/index.js';
import { ATTACHMENTS, SLOTS, SLOT_LABEL, attachmentById, resolveWeapon, DEFAULT_LOADOUT } from './weapons/attachments.js';

const $ = id => document.getElementById(id);
const canvas = $('scene');

loadSettings();
loadBinds();
initInput(canvas);

let game = null;
let last = performance.now();

/* ================= generic control binding ================= */
function bindRange(id, key, fmt = v => v, onChange) {
  const el = $(id), lab = $('lab-' + id.replace('in-', ''));
  if (!el) return () => {};
  const sync = () => {
    el.value = settings[key];
    el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
    if (lab) lab.textContent = fmt(settings[key]);
  };
  el.addEventListener('input', () => {
    settings[key] = parseFloat(el.value);
    sync(); saveSettings(); onChange?.(settings[key]);
  });
  sync();
  return sync;
}

function bindSeg(id, key, onChange) {
  const el = $(id);
  if (!el) return;
  const buttons = [...el.querySelectorAll('button')];
  const sync = () => buttons.forEach(b => b.classList.toggle('on', b.dataset.v === String(settings[key])));
  buttons.forEach(b => b.addEventListener('click', () => {
    settings[key] = b.dataset.v; sync(); saveSettings(); onChange?.(settings[key]);
  }));
  sync();
}

function bindCheck(id, key, onChange) {
  const el = $(id);
  if (!el) return;
  el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); onChange?.(el.checked); });
}

// tabs
document.querySelectorAll('.menu-tabs .tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.menu-tabs .tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelector(`.pane[data-pane="${t.dataset.tab}"]`)?.classList.add('active');
  });
});

/* ================= aim settings ================= */
const showCm360 = () => { $('cm360').textContent = `≈ ${cm360().toFixed(1)} cm/360°`; };
const syncSens = bindRange('in-sens', 'sens', v => v.toFixed(2), showCm360);
bindRange('in-adssens', 'adsSens', v => v.toFixed(2));
bindRange('in-scopesens', 'scopeSens', v => v.toFixed(2));
bindRange('in-yx', 'yxRatio', v => v.toFixed(2));
bindRange('in-dpi', 'dpi', v => Math.round(v), showCm360);
bindSeg('sel-zoom', 'zoomMode');
bindCheck('in-invert', 'invertY');
bindCheck('in-raw', 'rawInput');
showCm360();

/* ================= game settings ================= */
bindRange('in-fov', 'fov', v => Math.round(v), v => { if (game) game.camera.fov = v; });
bindRange('in-vol', 'volume', v => Math.round(v), v => setAudioVolume(v / 100));
bindRange('in-bots', 'bots', v => Math.round(v));
bindRange('in-rounds', 'roundsToWin', v => Math.round(v));
bindSeg('sel-mode', 'mode', syncModeUI);
bindSeg('sel-diff', 'difficulty');
bindSeg('sel-chcol', 'crosshairColor', v => document.documentElement.style.setProperty('--ch', v));
bindSeg('sel-qual', 'quality', q => {
  if (!game) return;
  game.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'med' ? 1.5 : 1));
  game.renderer.shadowMap.enabled = q !== 'low';
  game.scene.traverse(o => { if (o.isInstancedMesh) o.castShadow = q !== 'low'; });
  game.renderer.shadowMap.needsUpdate = true;
});
bindCheck('in-shake', 'shake');
bindCheck('in-bob', 'bob');
bindCheck('in-blood', 'blood', v => { if (game) game.fx.blood = v; });
bindCheck('in-toggleads', 'toggleAds');
bindCheck('in-togglecrouch', 'toggleCrouch');
bindCheck('in-autoreload', 'autoReload');

// migrate saves from when volume was stored 0..1
if (settings.volume <= 1) { settings.volume = Math.round(settings.volume * 100); saveSettings(); }
$('in-vol').value = settings.volume;
$('lab-vol').textContent = Math.round(settings.volume);
document.documentElement.style.setProperty('--ch', settings.crosshairColor);

const MODE_NOTES = {
  siege: 'Attack and defend. Attackers drone the building, then breach and plant the defuser; defenders barricade, reinforce, trap and hold. One life per round, sides swap every round, walls come down.',
  gungame: 'Eighteen guns, one kill each, sidearm to knife. No pickups, no teams — and a knife kill knocks its victim back a rung.',
};
function syncModeUI() {
  $('mode-note').textContent = MODE_NOTES[settings.mode] || '';
  $('field-rounds').style.display = settings.mode === 'siege' ? '' : 'none';
}

function buildMapPicker() {
  const seg = $('sel-map');
  if (!seg) return;
  seg.innerHTML = '';
  const entries = [...MAP_META.map(m => ({ v: m.id, label: m.name, blurb: m.blurb })),
                   { v: 'random', label: 'RANDOM', blurb: 'A different map every match.' }];
  const sync = () => {
    [...seg.children].forEach(b => b.classList.toggle('on', b.dataset.v === settings.mapId));
    const cur = entries.find(e => e.v === settings.mapId);
    $('map-note').textContent = cur ? cur.blurb : '';
  };
  for (const e of entries) {
    const btn = document.createElement('button');
    btn.dataset.v = e.v; btn.textContent = e.label;
    btn.addEventListener('click', () => { settings.mapId = e.v; saveSettings(); sync(); });
    seg.appendChild(btn);
  }
  sync();
}
buildMapPicker();
syncModeUI();

// pause-menu duplicates
function bindPauseRange(id, key, labId, transform = v => v) {
  const el = $(id);
  el.addEventListener('input', () => {
    settings[key] = parseFloat(el.value);
    $(labId).textContent = transform(settings[key]);
    el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
    if (key === 'volume') setAudioVolume(settings[key] / 100);
    saveSettings();
    const main = $(id.replace('2', ''));
    if (main) { main.value = el.value; main.style.setProperty('--p', el.style.getPropertyValue('--p')); }
    const mainLab = $(labId.replace('2', ''));
    if (mainLab) mainLab.textContent = transform(settings[key]);
    if (key === 'sens') showCm360();
  });
}
bindPauseRange('in-sens2', 'sens', 'lab-sens2', v => v.toFixed(2));
bindPauseRange('in-vol2', 'volume', 'lab-vol2', v => Math.round(v));

/* ================= keybinding UI ================= */
function buildBindsUI() {
  const list = $('binds-list');
  list.innerHTML = '';
  for (const group of ACTION_GROUPS) {
    const actions = ACTIONS.filter(a => a.group === group);
    if (!actions.length) continue;
    const h = document.createElement('div');
    h.className = 'bind-group';
    h.textContent = group.toUpperCase();
    list.appendChild(h);
    for (const a of actions) {
      const row = document.createElement('div');
      row.className = 'bind-row';
      row.innerHTML = `<span>${a.label}</span>`;
      for (let slot = 0; slot < 2; slot++) {
        const btn = document.createElement('button');
        btn.className = 'bind-key';
        btn.dataset.action = a.id; btn.dataset.slot = slot;
        row.appendChild(btn);
        btn.addEventListener('click', () => startCapture(a.id, slot, btn));
        btn.addEventListener('contextmenu', e => {
          e.preventDefault();
          clearBind(a.id, slot);
          refreshBindsUI();
        });
      }
      list.appendChild(row);
    }
  }
  refreshBindsUI();
}

function refreshBindsUI() {
  game?.hud?.refreshKeyHints();
  for (const btn of document.querySelectorAll('.bind-key')) {
    const code = (binds[btn.dataset.action] || [])[+btn.dataset.slot];
    btn.textContent = codeLabel(code);
    btn.classList.toggle('empty', !code);
    btn.classList.toggle('dupe', !!code && conflicts(code, btn.dataset.action).length > 0);
    btn.classList.remove('listening');
  }
}

function startCapture(actionId, slot, btn) {
  refreshBindsUI();
  btn.textContent = 'PRESS…';
  btn.classList.add('listening');
  beginCapture(code => {
    if (code) setBind(actionId, slot, code);
    refreshBindsUI();
    updateMenuFooter();
  });
}

$('btn-binds-reset').addEventListener('click', () => { resetBinds(); refreshBindsUI(); updateMenuFooter(); });
buildBindsUI();

/* ================= operators ================= */
function pips(label, n) {
  return `<div class="pips"><span>${label}</span>${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}

function buildOperators() {
  for (const [gridId, list, key] of [['op-grid-atk', ATTACKERS, 'operatorAtk'], ['op-grid-def', DEFENDERS, 'operatorDef']]) {
    const grid = $(gridId);
    if (!grid) continue;
    grid.innerHTML = '';
    for (const op of list) {
      const card = document.createElement('button');
      card.className = 'opcard' + (settings[key] === op.id ? ' on' : '');
      card.dataset.id = op.id;
      const hex = '#' + op.colour.toString(16).padStart(6, '0');
      card.innerHTML = `
        <h4 style="color:${hex}">${op.name}</h4>
        <div class="role">${op.role}</div>
        <div class="kit">
          <b>${getWeapon(op.primary).name}</b> + ${getWeapon(op.secondary).name}<br>
          ${op.ability.name} ×${op.ability.charges}<br>
          ${GADGET_INFO[op.gadget.id].name} ×${op.gadget.count}
        </div>
        ${pips('ARMOUR', op.armour)}${pips('SPEED', op.speed)}
        <div class="blurb">${op.blurb}</div>`;
      card.addEventListener('click', () => {
        settings[key] = op.id; saveSettings();
        grid.querySelectorAll('.opcard').forEach(c => c.classList.toggle('on', c.dataset.id === op.id));
        audio.init(); audio.click(null, { freq: 1100, dur: 0.05, vol: 0.2 });
      });
      grid.appendChild(card);
    }
  }
}
buildOperators();

/* ================= armoury ================= */
let armouryGun = WEAPON_IDS[0];

function gunLoadout(id) {
  if (!settings.gunLoadouts) settings.gunLoadouts = {};
  if (!settings.gunLoadouts[id]) settings.gunLoadouts[id] = { ...DEFAULT_LOADOUT };
  return settings.gunLoadouts[id];
}
const ownedKey = (slot, id) => `${slot}:${id}`;
const isOwned = (slot, a) => a.cost === 0 || !!settings.owned?.[ownedKey(slot, a.id)];

function buildArmoury() {
  const gunSeg = $('sel-gun');
  if (!gunSeg) return;
  gunSeg.innerHTML = '';
  for (const id of WEAPON_IDS) {
    const btn = document.createElement('button');
    btn.textContent = WEAPONS[id].name;
    btn.className = id === armouryGun ? 'on' : '';
    btn.addEventListener('click', () => { armouryGun = id; buildArmoury(); });
    gunSeg.appendChild(btn);
  }

  const defSeg = $('sel-default-gun');
  defSeg.innerHTML = '';
  for (const id of WEAPON_IDS) {
    const btn = document.createElement('button');
    btn.textContent = WEAPONS[id].name;
    btn.className = settings.loadout === id ? 'on' : '';
    btn.addEventListener('click', () => { settings.loadout = id; saveSettings(); buildArmoury(); });
    defSeg.appendChild(btn);
  }

  $('credit-balance').textContent = Math.round(settings.credits || 0);

  const lo = gunLoadout(armouryGun);
  const base = WEAPONS[armouryGun];
  const res = resolveWeapon(base, lo);
  $('gun-summary').innerHTML =
    `<b>${base.name}</b> — ${Math.ceil(100 / res.dmg)} body shots · ${res.mag} rounds · ` +
    `${(res.adsTime * 1000).toFixed(0)} ms to aim · recoil ${Math.round((res.recoilVMul ?? 1) * 100)}% vertical, ` +
    `${Math.round((res.recoilHMul ?? 1) * 100)}% horizontal`;

  const wrap = $('attach-slots');
  wrap.innerHTML = '';
  for (const slot of SLOTS) {
    const div = document.createElement('div');
    div.className = 'aslot';
    div.innerHTML = `<h5>${SLOT_LABEL[slot]}</h5><div class="aopts"></div>`;
    const opts = div.querySelector('.aopts');
    for (const a of ATTACHMENTS[slot]) {
      const owned = isOwned(slot, a);
      const equipped = lo[slot] === a.id;
      const btn = document.createElement('button');
      btn.className = 'aopt' + (equipped ? ' on' : '') + (owned ? ' owned' : ' locked');
      btn.innerHTML = `<b>${a.name}</b><span>${a.desc || '—'}</span>` +
        `<em>${owned ? (equipped ? 'EQUIPPED' : 'OWNED') : a.cost + ' CR'}</em>`;
      btn.addEventListener('click', () => {
        audio.init();
        if (!owned) {
          if ((settings.credits || 0) < a.cost) {
            audio.click(null, { freq: 300, dur: 0.1, vol: 0.25 });
            $('gun-summary').innerHTML = `<span style="color:var(--red)">NOT ENOUGH CREDITS — need ${a.cost}, you have ${Math.round(settings.credits || 0)}</span>`;
            return;
          }
          settings.credits -= a.cost;
          settings.owned = settings.owned || {};
          settings.owned[ownedKey(slot, a.id)] = true;
          audio.tone(760, 0.12, 0.25, 'sine', 1200);
        } else audio.click(null, { freq: 1100, dur: 0.05, vol: 0.2 });
        lo[slot] = a.id;
        saveSettings();
        buildArmoury();
        if (game?.player) game.viewModel.setWeapon(game.player.arsenal.current, game.resolvedWeapon(game.player));
      });
      opts.appendChild(btn);
    }
    wrap.appendChild(div);
  }
}
buildArmoury();

/* ================= loadout ================= */
function buildLoadout() {
  const grid = $('loadout-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const card = document.createElement('button');
    card.className = 'wcard' + (settings.loadout === id ? ' on' : '');
    card.dataset.id = id;
    const bar = (label, v, color) => `<div class="wstat"><i>${label}</i><div class="track"><b style="width:${Math.round(v * 100)}%;background:${color}"></b></div></div>`;
    card.innerHTML = `
      <h4 style="color:#${w.color.toString(16).padStart(6, '0')}">${w.name}</h4>
      <div class="cls">${w.cls} · ${Math.ceil(100 / w.dmg)} BODY SHOTS</div>
      ${bar('DMG', w.stats.dmg, '#ff6b7f')}
      ${bar('RATE', w.stats.rate, '#ffd60a')}
      ${bar('RANGE', w.stats.range, '#4cc9ff')}
      ${bar('MOBIL', w.stats.mob, '#00ffa8')}
      ${bar('CTRL', w.stats.ctrl, '#a06bff')}`;
    card.addEventListener('click', () => {
      settings.loadout = id; saveSettings();
      grid.querySelectorAll('.wcard').forEach(c => c.classList.toggle('on', c.dataset.id === id));
      audio.init(); audio.click(null, { freq: 1200, dur: 0.05, vol: 0.2 });
    });
    grid.appendChild(card);
  }
}
buildLoadout();

/* ================= screens ================= */
const menu = $('menu'), pause = $('pause'), endcard = $('endcard'), loading = $('loading');

function showMenu() {
  menu.classList.remove('hidden');
  pause.classList.add('hidden');
  endcard.classList.add('hidden');
  if (game) { game.running = false; game.hud.show(false); }
  exitLock();
}

function startMatch() {
  audio.init();                       // AudioContext needs a user gesture
  setAudioVolume(settings.volume / 100);
  menu.classList.add('hidden');
  endcard.classList.add('hidden');
  pause.classList.add('hidden');
  game.fx.blood = settings.blood;
  game.startMatch({
    mode: settings.mode, bots: Math.round(settings.bots),
    difficulty: settings.difficulty, map: settings.mapId,
    roundsToWin: Math.round(settings.roundsToWin),
  });
  requestLock(settings.rawInput);
}

function resumeMatch() {
  if (!game || game.over) return;
  pause.classList.add('hidden');
  game.paused = false;
  requestLock(settings.rawInput);
}

function pauseMatch() {
  if (!game || !game.running || game.over) return;
  game.paused = true;
  pause.classList.remove('hidden');
  $('in-sens2').value = settings.sens;
  $('lab-sens2').textContent = settings.sens.toFixed(2);
  $('in-vol2').value = settings.volume;
  $('lab-vol2').textContent = Math.round(settings.volume);
}

input.onPause = () => { if (game && game.running && !game.over) pauseMatch(); };

$('btn-play').addEventListener('click', startMatch);
$('btn-resume').addEventListener('click', resumeMatch);
$('btn-restart').addEventListener('click', startMatch);
$('btn-quit').addEventListener('click', showMenu);
$('btn-again').addEventListener('click', startMatch);
$('btn-menu').addEventListener('click', showMenu);
canvas.addEventListener('click', () => {
  if (game && game.running && !game.paused && !game.over && !input.locked) requestLock(settings.rawInput);
});

/* ================= end card ================= */
function showEndcard(res) {
  endcard.classList.remove('hidden');
  const t = $('end-title');
  t.classList.toggle('defeat', !res.won);
  t.innerHTML = res.won ? 'VICT<span>ORY</span>' : 'DEF<span>EAT</span>';
  const s = res.stats;
  $('end-stats').innerHTML = `
    <div class="estat"><b>${s.kills}</b><span>KILLS</span></div>
    <div class="estat"><b>${s.headshots}</b><span>HEADSHOTS</span></div>
    <div class="estat"><b>${s.acc}%</b><span>ACCURACY</span></div>
    <div class="estat"><b style="color:var(--gold)">+${Math.round(res.credits || 0)}</b><span>CREDITS EARNED</span></div>`;
  buildArmoury();
  const rows = res.rows.map((r, i) => `
    <div class="sb-row ${r.isMe ? 'me' : ''} ${r.team === 0 ? 'teamA' : 'teamB'}">
      <span>${i + 1}</span><span class="n">${r.name}</span>
      <span class="num">${r.kills}</span><span class="num">${r.deaths}</span>
      <span class="num">${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</span>
    </div>`).join('');
  $('end-board').innerHTML =
    `<div class="sb-row hd"><span>#</span><span>PLAYER</span><span class="num">KILLS</span><span class="num">DEATHS</span><span class="num">K/D</span></div>` + rows;
  exitLock();
}

function updateMenuFooter() {
  const k = id => codeLabel((binds[id] || [])[0]);
  document.querySelector('.menu-foot').innerHTML =
    `Headshots kill instantly · aim with <b>${k('aim')}</b> and stop moving to shoot straight · lean with <b>${k('leanLeft')}</b>/<b>${k('leanRight')}</b> · walk silently with <b>${k('walk')}</b>`;
}

/* ================= main loop ================= */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game && game.running && !game.paused) game.update(dt);
  if (game) game.render();
  endFrameInput();
}

/* ================= init ================= */
async function boot() {
  await new Promise(r => setTimeout(r, 30));
  game = new Game(canvas).init();
  window.__game = game;                    // handy for debugging from the console
  window.__mv = await import('./entities/movement.js');   // used by test/smoke.mjs
  game.onMatchEnd = showEndcard;
  game.hud.show(false);
  game.player.pos.set(0, 8.2, 34);
  game.player.yaw = Math.PI; game.player.pitch = -0.12;
  game.camera.position.set(0, 9.4, 34);
  game.camera.rotation.set(-0.12, Math.PI, 0);
  game.hud.refreshKeyHints();
  updateMenuFooter();
  loading.classList.add('hidden');
  requestAnimationFrame(frame);
}

// slow idle orbit behind the menu
let orbit = 0;
setInterval(() => {
  if (!game || game.running) return;
  orbit += 0.0016;
  game.camera.position.set(Math.sin(orbit) * 42, 14 + Math.sin(orbit * 0.7) * 3, Math.cos(orbit) * 42);
  game.camera.lookAt(0, 6, 0);
}, 16);

boot();
