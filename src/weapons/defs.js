// ============ weapon definitions ============
// dmg values are per-bullet at close range; falloff scales them with distance.

const base = {
  headMult: 2.0, limbMult: 0.85, pellets: 1, burst: 0, auto: false,
  spreadBase: 0.6, spreadMove: 1.6, spreadAir: 3.2, spreadCrouch: 0.7, spreadAds: 0.25,
  spreadPerShot: 0.35, spreadDecay: 5.0, spreadMax: 7,
  recoilV: 0.45, recoilH: 0.22, recoilRecover: 7, recoilRamp: 0.05,
  adsFovMult: 0.72, adsTime: 0.18, scope: false,
  range: 300, falloffStart: 30, falloffEnd: 90, falloffMin: 0.6,
  moveMult: 1, swapTime: 0.42, reloadPerShell: false,
  kick: 0.045, shakeAmt: 0.5, tracer: 0xfff0b0, tracerWidth: 0.035,
  shellEject: true, botBurst: [3, 6], botPause: [0.14, 0.4],
};

export const WEAPONS = {
  rifle: {
    ...base, id: 'rifle', name: 'TR-9 RIFLE', cls: 'ASSAULT', slot: 1,
    dmg: 24, rpm: 660, auto: true, mag: 30, reserve: 180, reload: 2.05,
    spreadBase: 0.55, spreadPerShot: 0.30, spreadMax: 5.2, spreadDecay: 5.5,
    recoilV: 0.42, recoilH: 0.20, recoilRecover: 8, recoilRamp: 0.045,
    falloffStart: 34, falloffEnd: 95, falloffMin: 0.62, moveMult: 1.0,
    sound: { crack: 2600, body: 190, vol: 0.5, dur: 0.26 },
    stats: { dmg: .55, rate: .7, range: .7, mob: .65, ctrl: .75 },
    color: 0x3ad2a0, botBurst: [3, 7], botPause: [0.12, 0.35],
  },
  smg: {
    ...base, id: 'smg', name: 'WASP SMG', cls: 'SUBMACHINE', slot: 2,
    dmg: 16, rpm: 1020, auto: true, mag: 34, reserve: 210, reload: 1.72,
    spreadBase: 0.95, spreadPerShot: 0.34, spreadMax: 6.4, spreadDecay: 6.4, spreadMove: 1.15,
    recoilV: 0.30, recoilH: 0.30, recoilRecover: 10, recoilRamp: 0.035,
    falloffStart: 18, falloffEnd: 52, falloffMin: 0.45, moveMult: 1.14, swapTime: 0.33,
    sound: { crack: 3000, body: 240, vol: 0.4, dur: 0.19 },
    stats: { dmg: .38, rate: .95, range: .35, mob: .9, ctrl: .55 },
    color: 0xffc94a, botBurst: [4, 9], botPause: [0.1, 0.28],
  },
  shotgun: {
    ...base, id: 'shotgun', name: 'BREACH-12', cls: 'SHOTGUN', slot: 3,
    dmg: 11.5, pellets: 9, rpm: 78, mag: 6, reserve: 42, reload: 0.52, reloadPerShell: true,
    headMult: 1.5, spreadBase: 3.6, spreadAds: 2.2, spreadPerShot: 0, spreadMove: 1.1, spreadMax: 6,
    recoilV: 2.4, recoilH: 0.5, recoilRecover: 6, kick: 0.16, shakeAmt: 1.5,
    falloffStart: 9, falloffEnd: 26, falloffMin: 0.18, moveMult: 1.02,
    sound: { crack: 1700, body: 105, vol: 0.72, dur: 0.42 },
    stats: { dmg: .95, rate: .2, range: .18, mob: .7, ctrl: .35 },
    color: 0xff6a3d, botBurst: [1, 2], botPause: [0.5, 0.9],
  },
  sniper: {
    ...base, id: 'sniper', name: 'LONGSHOT', cls: 'SNIPER', slot: 4,
    dmg: 92, headMult: 2.4, rpm: 48, mag: 5, reserve: 30, reload: 2.75,
    spreadBase: 4.2, spreadAds: 0.02, spreadPerShot: 1.6, spreadDecay: 2.4, spreadMax: 8,
    recoilV: 3.2, recoilH: 0.35, recoilRecover: 4.5, kick: 0.2, shakeAmt: 1.4,
    adsFovMult: 0.22, adsTime: 0.26, scope: true,
    falloffStart: 200, falloffEnd: 300, falloffMin: 0.9, moveMult: 0.86, swapTime: 0.6,
    sound: { crack: 2100, body: 88, vol: 0.85, dur: 0.55 },
    stats: { dmg: 1, rate: .12, range: 1, mob: .45, ctrl: .3 },
    color: 0x62b8ff, tracer: 0xbfe4ff, tracerWidth: 0.05, botBurst: [1, 1], botPause: [0.85, 1.6],
  },
  pistol: {
    ...base, id: 'pistol', name: 'SIDEARM P7', cls: 'PISTOL', slot: 5,
    dmg: 27, rpm: 420, mag: 15, reserve: 120, reload: 1.35,
    spreadBase: 0.5, spreadPerShot: 0.45, spreadDecay: 7, spreadMax: 4.5,
    recoilV: 0.7, recoilH: 0.25, recoilRecover: 11,
    falloffStart: 22, falloffEnd: 62, falloffMin: 0.5, moveMult: 1.16, swapTime: 0.28,
    sound: { crack: 2800, body: 210, vol: 0.42, dur: 0.2 },
    stats: { dmg: .45, rate: .5, range: .45, mob: .95, ctrl: .7 },
    color: 0xc9d3de, botBurst: [2, 4], botPause: [0.2, 0.45],
  },
  revolver: {
    ...base, id: 'revolver', name: 'MAGNUM .44', cls: 'HAND CANNON', slot: 6,
    dmg: 61, headMult: 2.1, rpm: 165, mag: 6, reserve: 42, reload: 2.35,
    spreadBase: 0.5, spreadPerShot: 1.1, spreadDecay: 4, spreadMax: 5.5,
    recoilV: 2.1, recoilH: 0.45, recoilRecover: 6.5, kick: 0.13, shakeAmt: 1.1,
    falloffStart: 30, falloffEnd: 78, falloffMin: 0.62, moveMult: 1.05, swapTime: 0.38,
    sound: { crack: 2200, body: 130, vol: 0.7, dur: 0.4 },
    stats: { dmg: .85, rate: .3, range: .65, mob: .8, ctrl: .4 },
    color: 0xd8b25a, botBurst: [1, 2], botPause: [0.35, 0.7],
  },
  lmg: {
    ...base, id: 'lmg', name: 'HAILSTORM', cls: 'HEAVY', slot: 7,
    dmg: 21, rpm: 820, auto: true, mag: 80, reserve: 320, reload: 4.1,
    spreadBase: 1.1, spreadPerShot: 0.26, spreadMax: 7.2, spreadDecay: 3.6, spreadMove: 2.1,
    recoilV: 0.36, recoilH: 0.34, recoilRecover: 6, recoilRamp: 0.03,
    falloffStart: 30, falloffEnd: 88, falloffMin: 0.55, moveMult: 0.84, swapTime: 0.62,
    sound: { crack: 2400, body: 150, vol: 0.55, dur: 0.3 },
    stats: { dmg: .5, rate: .85, range: .7, mob: .3, ctrl: .45 },
    color: 0x8f7bff, botBurst: [6, 14], botPause: [0.25, 0.6],
  },
  rocket: {
    ...base, id: 'rocket', name: 'SKYBREAKER', cls: 'EXPLOSIVE', slot: 8,
    dmg: 42, rpm: 55, mag: 1, reserve: 10, reload: 2.5, headMult: 1, limbMult: 1,
    spreadBase: 0.2, spreadAds: 0.1, spreadPerShot: 0,
    recoilV: 2.0, recoilH: 0.2, recoilRecover: 5, kick: 0.22, shakeAmt: 2.2,
    moveMult: 0.9, swapTime: 0.6, shellEject: false,
    projectile: { speed: 62, radius: 0.28, gravity: 2.2, splash: 7.5, splashDmg: 82, selfMult: 0.4, knock: 15 },
    sound: { crack: 1200, body: 90, vol: 0.75, dur: 0.5 },
    stats: { dmg: 1, rate: .1, range: .5, mob: .5, ctrl: .25 },
    color: 0xff4d6a, botBurst: [1, 1], botPause: [1.1, 2.0],
  },
  knife: {
    ...base, id: 'knife', name: 'COMBAT KNIFE', cls: 'MELEE', slot: 9,
    dmg: 55, headMult: 1.6, rpm: 130, mag: Infinity, reserve: 0, reload: 0,
    melee: true, range: 3.0, spreadBase: 0, moveMult: 1.25, swapTime: 0.22,
    falloffStart: 3, falloffEnd: 3.2, falloffMin: 1, kick: 0.1, shakeAmt: 0.3,
    sound: { crack: 3200, body: 300, vol: 0.3, dur: 0.12 },
    stats: { dmg: .6, rate: .4, range: .05, mob: 1, ctrl: 1 },
    color: 0xdfe6ee, hidden: true,
  },
};

export const WEAPON_IDS = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'revolver', 'lmg', 'rocket'];
export const getWeapon = id => WEAPONS[id] || WEAPONS.rifle;
export const fireDelay = w => 60 / w.rpm;

/** damage after distance falloff */
export function falloffDamage(w, dist) {
  if (dist <= w.falloffStart) return w.dmg;
  if (dist >= w.falloffEnd) return w.dmg * w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return w.dmg * (1 + (w.falloffMin - 1) * t);
}

/** gun-game ladder */
export const GUNGAME_LADDER = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'revolver', 'rocket', 'sniper', 'knife'];
