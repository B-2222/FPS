// ============ rebindable controls ============
// A binding code is either a KeyboardEvent.code ('KeyW'), a mouse button
// ('Mouse0'..'Mouse4') or a wheel direction ('WheelUp' / 'WheelDown').

const KEY = 'overclock.binds.v1';

export const ACTION_GROUPS = ['Movement', 'Combat', 'Weapons', 'Interface'];

export const ACTIONS = [
  { id: 'forward',   label: 'Move Forward',      group: 'Movement', def: ['KeyW', 'ArrowUp'] },
  { id: 'back',      label: 'Move Backward',     group: 'Movement', def: ['KeyS', 'ArrowDown'] },
  { id: 'left',      label: 'Strafe Left',       group: 'Movement', def: ['KeyA', 'ArrowLeft'] },
  { id: 'right',     label: 'Strafe Right',      group: 'Movement', def: ['KeyD', 'ArrowRight'] },
  { id: 'sprint',    label: 'Sprint',            group: 'Movement', def: ['ShiftLeft', null] },
  { id: 'walk',      label: 'Walk (silent)',     group: 'Movement', def: ['AltLeft', null] },
  { id: 'crouch',    label: 'Crouch',            group: 'Movement', def: ['ControlLeft', 'KeyC'] },
  { id: 'jump',      label: 'Jump',              group: 'Movement', def: ['Space', null] },
  { id: 'leanLeft',  label: 'Lean Left',         group: 'Movement', def: ['KeyQ', null] },
  { id: 'leanRight', label: 'Lean Right',        group: 'Movement', def: ['KeyE', null] },

  { id: 'fire',      label: 'Fire',              group: 'Combat',   def: ['Mouse0', null] },
  { id: 'aim',       label: 'Aim Down Sights',   group: 'Combat',   def: ['Mouse2', null] },
  { id: 'reload',    label: 'Reload',            group: 'Combat',   def: ['KeyR', null] },
  { id: 'melee',     label: 'Melee',             group: 'Combat',   def: ['KeyV', 'Mouse1'] },
  { id: 'use',       label: 'Use / Pick Up',     group: 'Combat',   def: ['KeyF', null] },

  { id: 'weapon1',   label: 'Slot 1',            group: 'Weapons',  def: ['Digit1', null] },
  { id: 'weapon2',   label: 'Slot 2',            group: 'Weapons',  def: ['Digit2', null] },
  { id: 'weapon3',   label: 'Slot 3',            group: 'Weapons',  def: ['Digit3', null] },
  { id: 'weapon4',   label: 'Slot 4',            group: 'Weapons',  def: ['Digit4', null] },
  { id: 'weapon5',   label: 'Slot 5',            group: 'Weapons',  def: ['Digit5', null] },
  { id: 'weapon6',   label: 'Slot 6',            group: 'Weapons',  def: ['Digit6', null] },
  { id: 'weapon7',   label: 'Slot 7',            group: 'Weapons',  def: ['Digit7', null] },
  { id: 'weapon8',   label: 'Slot 8',            group: 'Weapons',  def: ['Digit8', null] },
  { id: 'nextWeapon', label: 'Next Weapon',      group: 'Weapons',  def: ['WheelDown', null] },
  { id: 'prevWeapon', label: 'Previous Weapon',  group: 'Weapons',  def: ['WheelUp', null] },
  { id: 'lastWeapon', label: 'Last Weapon',      group: 'Weapons',  def: ['KeyX', null] },

  { id: 'scoreboard', label: 'Scoreboard',       group: 'Interface', def: ['Tab', null] },
  // only reachable while dead in a round-based match, so sharing keys with
  // fire/jump is deliberate rather than a conflict
  { id: 'spectNext',  label: 'Spectate Next',    group: 'Interface', def: ['Mouse0', 'Space'], contextual: true },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

/** actionId -> [primary, secondary] */
export const binds = {};

export function resetBinds() {
  for (const a of ACTIONS) binds[a.id] = [a.def[0] ?? null, a.def[1] ?? null];
  saveBinds();
}

export function loadBinds() {
  resetBinds();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const a of ACTIONS) if (Array.isArray(saved[a.id])) binds[a.id] = [saved[a.id][0] ?? null, saved[a.id][1] ?? null];
    }
  } catch (e) { /* storage blocked — defaults are fine */ }
  return binds;
}

let saveT = 0;
export function saveBinds() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch (e) {} }, 200);
}

export function setBind(actionId, slot, code) {
  if (!binds[actionId]) return;
  binds[actionId][slot] = code;
  saveBinds();
}
export function clearBind(actionId, slot) { setBind(actionId, slot, null); }

/** every action already using this code (so the UI can warn / steal it) */
export function conflicts(code, exceptAction) {
  const out = [];
  const self = ACTION_BY_ID[exceptAction];
  if (self?.contextual) return out;          // context-only actions never clash
  for (const a of ACTIONS) {
    if (a.id === exceptAction || a.contextual) continue;
    if ((binds[a.id] || []).includes(code)) out.push(a.id);
  }
  return out;
}

/* ---------- display names ---------- */
const MOUSE_NAMES = ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'];
const SPECIAL = {
  Space: 'Space', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓',
  ArrowLeft: '←', ArrowRight: '→', WheelUp: 'Wheel Up', WheelDown: 'Wheel Down',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

export function codeLabel(code) {
  if (!code) return '—';
  if (SPECIAL[code]) return SPECIAL[code];
  if (code.startsWith('Mouse')) return MOUSE_NAMES[+code.slice(5)] || code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('F') && code.length <= 3) return code;
  return code;
}
