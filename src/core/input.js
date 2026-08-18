// ============ keyboard / mouse / pointer-lock ============
export const input = {
  keys: new Set(),
  mouseDX: 0, mouseDY: 0,
  fire: false, ads: false,
  wheel: 0,
  locked: false,
  pressed: new Set(),   // edge-triggered this frame
  onLockChange: null,
  onPause: null,
};

let canvas = null;

export function initInput(cv) {
  canvas = cv;

  addEventListener('keydown', e => {
    if (e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    // Escape is swallowed by the browser to exit pointer lock; handled via lockchange
    input.keys.add(e.code);
    input.pressed.add(e.code);
  });
  addEventListener('keyup', e => input.keys.delete(e.code));
  addEventListener('blur', () => { input.keys.clear(); input.fire = false; input.ads = false; });

  canvas.addEventListener('mousedown', e => {
    if (!input.locked) return;
    if (e.button === 0) input.fire = true;
    if (e.button === 2) input.ads = true;
    if (e.button === 1) e.preventDefault();
  });
  addEventListener('mouseup', e => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.ads = false;
  });
  addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('mousemove', e => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });

  addEventListener('wheel', e => {
    if (!input.locked) return;
    e.preventDefault();
    input.wheel += Math.sign(e.deltaY);
  }, { passive: false });

  document.addEventListener('pointerlockchange', () => {
    const was = input.locked;
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) { input.fire = false; input.ads = false; input.keys.clear(); }
    if (was && !input.locked && input.onPause) input.onPause();
    if (input.onLockChange) input.onLockChange(input.locked);
  });
}

export function requestLock() {
  if (!canvas || document.pointerLockElement === canvas) return;
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch (e) {} });
  } catch (e) { try { canvas.requestPointerLock(); } catch (e2) {} }
}
export function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

export const down = code => input.keys.has(code);
export const hit = code => input.pressed.has(code);
/** call at end of every frame */
export function endFrameInput() {
  input.mouseDX = 0; input.mouseDY = 0; input.wheel = 0; input.pressed.clear();
}
