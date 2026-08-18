// ============ raw input → bound actions ============
import { binds, ACTIONS } from './keybinds.js';

export const input = {
  mouseDX: 0, mouseDY: 0,
  locked: false,
  onLockChange: null,
  onPause: null,
  capture: null,          // set while the UI is listening for a new binding
};

const heldCodes = new Set();     // physically down right now
const edgeCodes = new Set();     // went down during this frame
let canvas = null;

/* ---------- queries ---------- */
export const codeDown = code => heldCodes.has(code);
export const codeHit = code => edgeCodes.has(code);

export function actionDown(id) {
  const b = binds[id];
  if (!b) return false;
  return (b[0] && heldCodes.has(b[0])) || (b[1] && heldCodes.has(b[1])) || false;
}
export function actionHit(id) {
  const b = binds[id];
  if (!b) return false;
  return (b[0] && edgeCodes.has(b[0])) || (b[1] && edgeCodes.has(b[1])) || false;
}
/** analogue axis from two opposing actions */
export const axis = (neg, pos) => (actionDown(pos) ? 1 : 0) - (actionDown(neg) ? 1 : 0);

/* ---------- capture for the rebinding UI ---------- */
export function beginCapture(cb) { input.capture = cb; }
function tryCapture(code, ev) {
  if (!input.capture) return false;
  ev?.preventDefault?.();
  const cb = input.capture;
  input.capture = null;
  cb(code === 'Escape' ? null : code);
  return true;
}

/* ---------- wiring ---------- */
export function initInput(cv) {
  canvas = cv;

  addEventListener('keydown', e => {
    if (tryCapture(e.code, e)) return;
    if (e.code === 'Tab' || (e.code === 'Space' && input.locked)) e.preventDefault();
    if (e.repeat) return;
    heldCodes.add(e.code);
    edgeCodes.add(e.code);
  });
  addEventListener('keyup', e => heldCodes.delete(e.code));

  addEventListener('blur', () => { heldCodes.clear(); });

  addEventListener('mousedown', e => {
    const code = 'Mouse' + e.button;
    if (tryCapture(code, e)) return;
    if (!input.locked) return;
    if (e.button === 1) e.preventDefault();
    heldCodes.add(code);
    edgeCodes.add(code);
  });
  addEventListener('mouseup', e => heldCodes.delete('Mouse' + e.button));
  addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('mousemove', e => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });

  addEventListener('wheel', e => {
    const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    if (tryCapture(code, e)) return;
    if (!input.locked) return;
    e.preventDefault();
    edgeCodes.add(code);
  }, { passive: false });

  document.addEventListener('pointerlockchange', () => {
    const was = input.locked;
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) heldCodes.clear();
    if (was && !input.locked && input.onPause) input.onPause();
    if (input.onLockChange) input.onLockChange(input.locked);
  });
}

export function requestLock(rawInput = true) {
  if (!canvas || document.pointerLockElement === canvas) return;
  try {
    const p = canvas.requestPointerLock(rawInput ? { unadjustedMovement: true } : undefined);
    if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch (e) {} });
  } catch (e) { try { canvas.requestPointerLock(); } catch (e2) {} }
}
export function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

/** call at the end of every frame */
export function endFrameInput() {
  input.mouseDX = 0; input.mouseDY = 0;
  edgeCodes.clear();
}

/** used by the settings UI to show what is currently held */
export const heldSnapshot = () => [...heldCodes];
