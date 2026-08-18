// ============ persisted user settings ============
const KEY = 'overclock.settings.v1';

export const settings = {
  sens: 1.0, adsSens: 0.7, fov: 95, volume: 0.7,
  crosshairColor: '#00ffa8', quality: 'med',
  shake: true, bob: true, blood: true, invertY: false,
  // match config
  mode: 'ffa', bots: 7, difficulty: 'normal', scoreLimit: 30, loadout: 'rifle',
};

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
