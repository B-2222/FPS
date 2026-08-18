// ============ boot, menus, main loop ============
import { Game } from './game/game.js';
import { settings, loadSettings, saveSettings } from './core/settings.js';
import { initInput, input, requestLock, exitLock, endFrameInput } from './core/input.js';
import { audio, setAudioVolume } from './core/audio.js';
import { WEAPON_IDS, WEAPONS, getWeapon } from './weapons/defs.js';

const $ = id => document.getElementById(id);
const canvas = $('scene');

loadSettings();
initInput(canvas);

let game = null;
let last = performance.now();
let started = false;

/* ================= menu plumbing ================= */
function bindRange(id, key, fmt = v => v, onChange) {
  const el = $(id), lab = $('lab-' + id.replace('in-', ''));
  if (!el) return;
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

// settings controls
const syncSens = bindRange('in-sens', 'sens', v => v.toFixed(2));
bindRange('in-adssens', 'adsSens', v => v.toFixed(2));
bindRange('in-fov', 'fov', v => Math.round(v), v => { if (game) game.camera.fov = v; });
const syncVol = bindRange('in-vol', 'volume', v => Math.round(v), v => setAudioVolume(v / 100));
bindRange('in-bots', 'bots', v => Math.round(v));
bindRange('in-score', 'scoreLimit', v => Math.round(v));
bindSeg('sel-mode', 'mode');
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
bindCheck('in-invert', 'invertY');

// migrate saves from when volume was stored 0..1
if (settings.volume <= 1) { settings.volume = Math.round(settings.volume * 100); saveSettings(); }
$('in-vol').value = settings.volume;
$('lab-vol').textContent = Math.round(settings.volume);
document.documentElement.style.setProperty('--ch', settings.crosshairColor);

// pause-menu duplicates
function bindPauseRange(id, key, labId, transform = v => v) {
  const el = $(id);
  el.addEventListener('input', () => {
    settings[key] = parseFloat(el.value);
    $(labId).textContent = transform(settings[key]);
    el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
    if (key === 'volume') setAudioVolume(settings[key] / 100);
    saveSettings();
    // keep the main menu control in sync
    const main = $(id.replace('2', ''));
    if (main) { main.value = el.value; main.style.setProperty('--p', el.style.getPropertyValue('--p')); }
    const mainLab = $(labId.replace('2', ''));
    if (mainLab) mainLab.textContent = transform(settings[key]);
  });
}
bindPauseRange('in-sens2', 'sens', 'lab-sens2', v => v.toFixed(2));
bindPauseRange('in-vol2', 'volume', 'lab-vol2', v => Math.round(v));

/* ---------- loadout grid ---------- */
function buildLoadout() {
  const grid = $('loadout-grid');
  grid.innerHTML = '';
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const card = document.createElement('button');
    card.className = 'wcard' + (settings.loadout === id ? ' on' : '');
    card.dataset.id = id;
    const bar = (label, v, color) => `<div class="wstat"><i>${label}</i><div class="track"><b style="width:${Math.round(v * 100)}%;background:${color}"></b></div></div>`;
    card.innerHTML = `
      <h4 style="color:#${w.color.toString(16).padStart(6, '0')}">${w.name}</h4>
      <div class="cls">${w.cls}</div>
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
    difficulty: settings.difficulty, scoreLimit: Math.round(settings.scoreLimit),
  });
  requestLock();
}

function resumeMatch() {
  if (!game || game.over) return;
  pause.classList.add('hidden');
  game.paused = false;
  requestLock();
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
  if (game && game.running && !game.paused && !game.over && !input.locked) requestLock();
});

/* ================= end card ================= */
function showEndcard(res) {
  endcard.classList.remove('hidden');
  const t = $('end-title');
  t.textContent = res.title;
  t.classList.toggle('defeat', !res.won);
  t.innerHTML = res.won ? 'VICT<span>ORY</span>' : 'DEF<span>EAT</span>';
  const s = res.stats;
  $('end-stats').innerHTML = `
    <div class="estat"><b>${s.kills}</b><span>KILLS</span></div>
    <div class="estat"><b>${s.deaths}</b><span>DEATHS</span></div>
    <div class="estat"><b>${s.acc}%</b><span>ACCURACY</span></div>
    <div class="estat"><b>${s.streak}</b><span>BEST STREAK</span></div>`;
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
  // idle camera so the menu has a live backdrop
  game.player.pos.set(0, 8.2, 34);
  game.player.yaw = Math.PI; game.player.pitch = -0.12;
  game.camera.position.set(0, 9.4, 34);
  game.camera.rotation.set(-0.12, Math.PI, 0);
  loading.classList.add('hidden');
  $('menu-hint').textContent = `${game.nav.nodes.length} nav nodes · ${game.world.boxes.length} solids`;
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
