// ============ persisted user settings ============
// v2: sensitivity units changed with the tactical rework, so old saves would
// feel wildly wrong — start everyone on the retuned defaults.
const KEY = 'overclock.settings.v4';

export const settings = {
  // ---- aim ----
  sens: 1.0,            // hipfire; 1.0 ≈ 24 cm/360 at 800 DPI
  adsSens: 0.85,        // multiplier while aiming down sights
  scopeSens: 0.55,      // multiplier while using a magnified scope
  zoomMode: 'relative', // 'relative' = scale with FOV (consistent tracking), 'independent' = raw multipliers
  yxRatio: 1.0,         // vertical sensitivity relative to horizontal
  dpi: 800,             // only used to display cm/360
  invertY: false,
  rawInput: true,       // ask the browser for unaccelerated mouse deltas

  // ---- display ----
  fov: 90, adsFovMode: 'affected', volume: 70,   // volume is 0-100 everywhere
  crosshairColor: '#00ffa8', crosshairDot: true, quality: 'med',
  shake: true, bob: true, blood: true, tracers: true,

  // ---- input behaviour ----
  toggleAds: false, toggleCrouch: false, toggleSprint: false, toggleLean: true, autoReload: true,

  // ---- match config ----
  mode: 'siege', mapId: 'random', bots: 7, difficulty: 'normal', roundsToWin: 4, loadout: 'rifle',

  // ---- progression ----
  credits: 1200,
  operatorAtk: 'breach', operatorDef: 'anchor',
  owned: {},            // "slot:id" -> true
  gunLoadouts: {},      // weaponId -> { optic, barrel, grip, laser, mag }
};

/** cm of mousepad per 360° turn — the number competitive players actually tune */
export function cm360(sens = settings.sens, dpi = settings.dpi) {
  const degPerCount = RAD_PER_COUNT * sens * 180 / Math.PI;
  return (360 / degPerCount) / dpi * 2.54;
}
/** radians of yaw per mouse count at sens 1.0 */
export const RAD_PER_COUNT = 0.00082;

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) { /* private mode / disabled storage — defaults are fine */ }
  return settings;
}

let saveTimer = 0;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }, 250);
}
