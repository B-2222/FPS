// ============ weapon definitions (tactical tuning) ============
// Design rules:
//  · Headshots with any bullet weapon are lethal — aim is the primary skill.
//  · Aimed + stationary is near pin-point; hipfire, movement and jumping are punished.
//  · Recoil follows a fixed, learnable pattern per weapon with only a little jitter,
//    so controlling a spray is a thing you can practise rather than a dice roll.

/* deterministic PRNG so every player learns the same patterns */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Per-shot recoil deltas in degrees: [horizontal, vertical].
 * Vertical kicks hardest at the start then flattens; horizontal wanders in
 * coherent sweeps, so a long spray traces a repeatable shape.
 */
function makePattern(seed, n, o) {
  const rnd = mulberry32(seed);
  const out = [];
  let h = 0, dir = rnd() > 0.5 ? 1 : -1, run = 0;
  for (let i = 0; i < n; i++) {
    const decay = o.plateau + (1 - o.plateau) * Math.exp(-i / o.rise);
    const v = o.climb * decay;
    if (run-- <= 0) { dir = -dir; run = 2 + Math.floor(rnd() * o.swayLen); }
    h += dir * o.sway * (0.6 + rnd() * 0.8);
    h = Math.max(-o.hMax, Math.min(o.hMax, h));
    out.push([h * 0.35 + dir * o.sway * 0.4, v]);
  }
  return out;
}

const base = {
  headMult: 2.0, limbMult: 0.85, pellets: 1, auto: false,
  headshotKill: true,          // a head hit ends it, regardless of remaining health
  hipSpread: 2.6, adsSpread: 0.06, hipMovePenalty: 2.2, adsMovePenalty: 0.9,
  airPenalty: 4.5, crouchBonus: 0.72,
  spreadPerShot: 0.07, spreadDecay: 3.2, spreadMax: 2.2,
  recoilRecover: 6.5, recoilJitter: 0.1,
  adsFovMult: 0.8, adsTime: 0.25, scope: false,
  range: 300, falloffStart: 30, falloffEnd: 90, falloffMin: 0.65,
  moveMult: 1, swapTime: 0.5, reloadPerShell: false,
  kick: 0.05, shakeAmt: 0.4, tracer: 0xfff0b0, tracerWidth: 0.03,
  shellEject: true, botBurst: [3, 5], botPause: [0.25, 0.55],
};

export const WEAPONS = {
  rifle: {
    ...base, id: 'rifle', name: 'TR-9 RIFLE', cls: 'ASSAULT', slot: 1,
    dmg: 34, rpm: 700, auto: true, mag: 30, reserve: 150, reload: 2.3,
    hipSpread: 2.5, adsSpread: 0.05, adsMovePenalty: 0.85, adsTime: 0.24,
    pattern: makePattern(11, 30, { climb: 0.62, plateau: 0.42, rise: 5, sway: 0.13, swayLen: 4, hMax: 1.6 }),
    falloffStart: 34, falloffEnd: 95, falloffMin: 0.7, moveMult: 1.0,
    sound: { crack: 2600, body: 190, vol: 0.5, dur: 0.26 },
    stats: { dmg: .7, rate: .7, range: .75, mob: .7, ctrl: .75 },
    color: 0x3ad2a0, botBurst: [3, 5], botPause: [0.28, 0.6],
  },
  smg: {
    ...base, id: 'smg', name: 'WASP SMG', cls: 'SUBMACHINE', slot: 2,
    dmg: 26, rpm: 900, auto: true, mag: 32, reserve: 180, reload: 2.0,
    hipSpread: 3.0, adsSpread: 0.11, adsMovePenalty: 0.6, adsTime: 0.19,
    pattern: makePattern(23, 32, { climb: 0.44, plateau: 0.5, rise: 6, sway: 0.2, swayLen: 3, hMax: 2.2 }),
    falloffStart: 16, falloffEnd: 46, falloffMin: 0.5, moveMult: 1.1, swapTime: 0.4,
    sound: { crack: 3000, body: 240, vol: 0.4, dur: 0.19 },
    stats: { dmg: .5, rate: .95, range: .35, mob: .95, ctrl: .55 },
    color: 0xffc94a, botBurst: [4, 7], botPause: [0.22, 0.5],
  },
  shotgun: {
    ...base, id: 'shotgun', name: 'BREACH-12', cls: 'SHOTGUN', slot: 3,
    dmg: 15, pellets: 12, rpm: 88, mag: 7, reserve: 42, reload: 0.5, reloadPerShell: true,
    headshotKill: false, headMult: 1.8,          // pellets: a head hit hurts, it doesn't delete
    hipSpread: 2.3, adsSpread: 1.5, hipMovePenalty: 0.55, adsMovePenalty: 0.35, adsTime: 0.22,
    spreadPerShot: 0, pattern: makePattern(31, 8, { climb: 2.6, plateau: 0.8, rise: 3, sway: 0.3, swayLen: 2, hMax: 1.4 }),
    kick: 0.15, shakeAmt: 1.3,
    falloffStart: 9, falloffEnd: 21, falloffMin: 0.12, moveMult: 1.06,
    sound: { crack: 1700, body: 105, vol: 0.72, dur: 0.42 },
    stats: { dmg: .95, rate: .2, range: .18, mob: .8, ctrl: .4 },
    color: 0xff6a3d, botBurst: [1, 2], botPause: [0.7, 1.1],
  },
  sniper: {
    ...base, id: 'sniper', name: 'LONGSHOT', cls: 'SNIPER', slot: 4,
    dmg: 100, rpm: 40, mag: 5, reserve: 25, reload: 3.0,
    hipSpread: 7.5, adsSpread: 0.005, hipMovePenalty: 3, adsMovePenalty: 2.6,
    spreadPerShot: 0, adsFovMult: 0.28, adsTime: 0.42, scope: true,
    pattern: makePattern(41, 6, { climb: 3.4, plateau: 0.9, rise: 2, sway: 0.25, swayLen: 2, hMax: 1 }),
    kick: 0.2, shakeAmt: 1.3, recoilRecover: 4,
    falloffStart: 200, falloffEnd: 300, falloffMin: 0.95, moveMult: 0.86, swapTime: 0.75,
    sound: { crack: 2100, body: 88, vol: 0.85, dur: 0.55 },
    stats: { dmg: 1, rate: .1, range: 1, mob: .45, ctrl: .3 },
    color: 0x62b8ff, tracer: 0xbfe4ff, tracerWidth: 0.045, botBurst: [1, 1], botPause: [1.1, 2.0],
  },
  pistol: {
    ...base, id: 'pistol', name: 'SIDEARM P7', cls: 'PISTOL', slot: 5,
    dmg: 30, rpm: 380, mag: 15, reserve: 90, reload: 1.6,
    hipSpread: 1.9, adsSpread: 0.09, adsMovePenalty: 0.7, adsTime: 0.17,
    pattern: makePattern(53, 15, { climb: 0.85, plateau: 0.6, rise: 4, sway: 0.16, swayLen: 3, hMax: 1.4 }),
    falloffStart: 20, falloffEnd: 55, falloffMin: 0.55, moveMult: 1.14, swapTime: 0.32,
    sound: { crack: 2800, body: 210, vol: 0.42, dur: 0.2 },
    stats: { dmg: .55, rate: .5, range: .45, mob: 1, ctrl: .7 },
    color: 0xc9d3de, botBurst: [2, 3], botPause: [0.3, 0.6],
  },
  revolver: {
    ...base, id: 'revolver', name: 'MAGNUM .44', cls: 'HAND CANNON', slot: 6,
    dmg: 58, rpm: 150, mag: 6, reserve: 36, reload: 2.7,
    hipSpread: 2.4, adsSpread: 0.06, adsMovePenalty: 1.2, adsTime: 0.27,
    pattern: makePattern(67, 8, { climb: 2.2, plateau: 0.75, rise: 3, sway: 0.3, swayLen: 2, hMax: 1.5 }),
    kick: 0.13, shakeAmt: 1.0, recoilRecover: 5.5,
    falloffStart: 32, falloffEnd: 80, falloffMin: 0.7, moveMult: 1.04, swapTime: 0.42,
    sound: { crack: 2200, body: 130, vol: 0.7, dur: 0.4 },
    stats: { dmg: .9, rate: .3, range: .65, mob: .85, ctrl: .45 },
    color: 0xd8b25a, botBurst: [1, 2], botPause: [0.45, 0.8],
  },
  lmg: {
    ...base, id: 'lmg', name: 'HAILSTORM', cls: 'HEAVY', slot: 7,
    dmg: 31, rpm: 720, auto: true, mag: 60, reserve: 240, reload: 5.0,
    hipSpread: 3.6, adsSpread: 0.1, hipMovePenalty: 3, adsMovePenalty: 1.6, adsTime: 0.44,
    pattern: makePattern(71, 60, { climb: 0.7, plateau: 0.55, rise: 8, sway: 0.22, swayLen: 5, hMax: 2.6 }),
    recoilRecover: 5,
    falloffStart: 30, falloffEnd: 88, falloffMin: 0.6, moveMult: 0.78, swapTime: 0.8,
    sound: { crack: 2400, body: 150, vol: 0.55, dur: 0.3 },
    stats: { dmg: .65, rate: .85, range: .7, mob: .25, ctrl: .4 },
    color: 0x8f7bff, botBurst: [5, 9], botPause: [0.35, 0.75],
  },
  rocket: {
    ...base, id: 'rocket', name: 'SKYBREAKER', cls: 'EXPLOSIVE', slot: 8,
    dmg: 42, rpm: 50, mag: 1, reserve: 8, reload: 3.0, headMult: 1, limbMult: 1,
    headshotKill: false, hipSpread: 1.2, adsSpread: 0.4, adsTime: 0.35,
    spreadPerShot: 0, pattern: makePattern(89, 4, { climb: 2.2, plateau: 0.9, rise: 2, sway: 0.2, swayLen: 2, hMax: 1 }),
    kick: 0.2, shakeAmt: 2.0, moveMult: 0.88, swapTime: 0.8, shellEject: false,
    projectile: { speed: 55, radius: 0.28, gravity: 3.0, splash: 7, splashDmg: 82, selfMult: 0.42, knock: 13 },
    sound: { crack: 1200, body: 90, vol: 0.75, dur: 0.5 },
    stats: { dmg: 1, rate: .1, range: .5, mob: .6, ctrl: .25 },
    color: 0xff4d6a, botBurst: [1, 1], botPause: [1.4, 2.4],
  },
  /* ---- the gun-game ladder brings in guns that never show up in a loadout ---- */
  machinepistol: {
    ...base, id: 'machinepistol', name: 'VIPER MP', cls: 'MACHINE PISTOL', slot: 5,
    dmg: 21, rpm: 1100, auto: true, mag: 24, reserve: 144, reload: 1.7,
    hipSpread: 2.9, adsSpread: 0.14, adsMovePenalty: 0.5, adsTime: 0.15,
    pattern: makePattern(97, 24, { climb: 0.52, plateau: 0.45, rise: 5, sway: 0.26, swayLen: 3, hMax: 2.4 }),
    falloffStart: 11, falloffEnd: 32, falloffMin: 0.45, moveMult: 1.18, swapTime: 0.32,
    sound: { crack: 3200, body: 250, vol: 0.38, dur: 0.16 },
    stats: { dmg: .4, rate: 1, range: .22, mob: 1, ctrl: .3 },
    color: 0xff8fd0, botBurst: [5, 8], botPause: [0.22, 0.45],
  },
  pdw: {
    ...base, id: 'pdw', name: 'HORNET PDW', cls: 'PDW', slot: 2,
    dmg: 24, rpm: 980, auto: true, mag: 40, reserve: 200, reload: 2.1,
    hipSpread: 2.7, adsSpread: 0.1, adsMovePenalty: 0.55, adsTime: 0.17,
    pattern: makePattern(103, 40, { climb: 0.4, plateau: 0.52, rise: 7, sway: 0.18, swayLen: 4, hMax: 2.0 }),
    falloffStart: 14, falloffEnd: 40, falloffMin: 0.5, moveMult: 1.13, swapTime: 0.36,
    sound: { crack: 3100, body: 235, vol: 0.4, dur: 0.18 },
    stats: { dmg: .45, rate: .95, range: .3, mob: .95, ctrl: .6 },
    color: 0x7bf0c8, botBurst: [5, 8], botPause: [0.22, 0.5],
  },
  carbine: {
    ...base, id: 'carbine', name: 'SHORTHAND CQB', cls: 'CARBINE', slot: 1,
    dmg: 30, rpm: 780, auto: true, mag: 25, reserve: 150, reload: 2.1,
    hipSpread: 2.4, adsSpread: 0.07, adsMovePenalty: 0.8, adsTime: 0.2,
    pattern: makePattern(109, 25, { climb: 0.58, plateau: 0.4, rise: 4, sway: 0.16, swayLen: 3, hMax: 1.8 }),
    falloffStart: 24, falloffEnd: 66, falloffMin: 0.6, moveMult: 1.06, swapTime: 0.42,
    sound: { crack: 2700, body: 205, vol: 0.48, dur: 0.24 },
    stats: { dmg: .6, rate: .8, range: .55, mob: .85, ctrl: .65 },
    color: 0x4fd0ff, botBurst: [3, 6], botPause: [0.26, 0.55],
  },
  bullpup: {
    ...base, id: 'bullpup', name: 'CINDER BP', cls: 'BULLPUP', slot: 1,
    dmg: 29, rpm: 860, auto: true, mag: 35, reserve: 175, reload: 2.6,
    hipSpread: 2.8, adsSpread: 0.06, adsMovePenalty: 0.9, adsTime: 0.27,
    pattern: makePattern(113, 35, { climb: 0.46, plateau: 0.6, rise: 7, sway: 0.11, swayLen: 6, hMax: 1.2 }),
    recoilRecover: 7.5,
    falloffStart: 30, falloffEnd: 84, falloffMin: 0.65, moveMult: 0.96, swapTime: 0.55,
    sound: { crack: 2500, body: 175, vol: 0.5, dur: 0.25 },
    stats: { dmg: .6, rate: .85, range: .7, mob: .6, ctrl: .85 },
    color: 0xb0ff6a, botBurst: [4, 7], botPause: [0.28, 0.6],
  },
  autoshotgun: {
    ...base, id: 'autoshotgun', name: 'RIPTIDE AA', cls: 'AUTO SHOTGUN', slot: 3,
    dmg: 10, pellets: 9, rpm: 240, auto: true, mag: 12, reserve: 60, reload: 3.2,
    headshotKill: false, headMult: 1.7,
    hipSpread: 3.2, adsSpread: 2.3, hipMovePenalty: 0.6, adsMovePenalty: 0.4, adsTime: 0.24,
    spreadPerShot: 0, pattern: makePattern(127, 12, { climb: 1.5, plateau: 0.7, rise: 4, sway: 0.35, swayLen: 2, hMax: 1.8 }),
    kick: 0.12, shakeAmt: 0.9,
    falloffStart: 7, falloffEnd: 17, falloffMin: 0.1, moveMult: 0.98, swapTime: 0.6,
    sound: { crack: 1850, body: 120, vol: 0.62, dur: 0.32 },
    stats: { dmg: .8, rate: .55, range: .15, mob: .6, ctrl: .3 },
    color: 0xff8c42, botBurst: [2, 4], botPause: [0.5, 0.9],
  },
  slug: {
    ...base, id: 'slug', name: 'DOORKNOCKER', cls: 'SLUG GUN', slot: 3,
    dmg: 88, rpm: 65, mag: 5, reserve: 30, reload: 0.55, reloadPerShell: true,
    hipSpread: 4.0, adsSpread: 0.09, hipMovePenalty: 1.6, adsMovePenalty: 1.4, adsTime: 0.3,
    spreadPerShot: 0, pattern: makePattern(131, 6, { climb: 3.0, plateau: 0.85, rise: 2, sway: 0.3, swayLen: 2, hMax: 1.2 }),
    kick: 0.18, shakeAmt: 1.4, recoilRecover: 4.5,
    falloffStart: 22, falloffEnd: 52, falloffMin: 0.55, moveMult: 0.94, swapTime: 0.6,
    sound: { crack: 1600, body: 95, vol: 0.8, dur: 0.46 },
    stats: { dmg: .95, rate: .18, range: .5, mob: .65, ctrl: .3 },
    color: 0xe0603a, tracerWidth: 0.04, botBurst: [1, 1], botPause: [0.8, 1.3],
  },
  dmr: {
    ...base, id: 'dmr', name: 'VERDICT DMR', cls: 'MARKSMAN', slot: 4,
    dmg: 62, rpm: 260, mag: 20, reserve: 100, reload: 2.6,
    hipSpread: 4.2, adsSpread: 0.02, hipMovePenalty: 2.4, adsMovePenalty: 1.9,
    spreadPerShot: 0, adsFovMult: 0.46, adsTime: 0.33, scope: true,
    pattern: makePattern(137, 20, { climb: 1.5, plateau: 0.6, rise: 3, sway: 0.22, swayLen: 3, hMax: 1.4 }),
    kick: 0.14, shakeAmt: 0.9, recoilRecover: 5,
    falloffStart: 60, falloffEnd: 150, falloffMin: 0.8, moveMult: 0.9, swapTime: 0.6,
    sound: { crack: 2300, body: 120, vol: 0.7, dur: 0.36 },
    stats: { dmg: .85, rate: .35, range: .9, mob: .55, ctrl: .5 },
    color: 0x9fb6ff, tracer: 0xd8e6ff, botBurst: [2, 3], botPause: [0.5, 0.9],
  },
  crossbow: {
    ...base, id: 'crossbow', name: 'WHISPER XB', cls: 'CROSSBOW', slot: 6,
    dmg: 110, rpm: 42, mag: 1, reserve: 20, reload: 1.5,
    hipSpread: 2.0, adsSpread: 0.02, adsMovePenalty: 1.2, adsFovMult: 0.6, adsTime: 0.3,
    spreadPerShot: 0, pattern: makePattern(139, 4, { climb: 1.0, plateau: 0.9, rise: 2, sway: 0.1, swayLen: 2, hMax: 0.6 }),
    kick: 0.08, shakeAmt: 0.4, silent: true, shellEject: false,
    projectile: { kind: 'bolt', speed: 78, radius: 0.1, gravity: 6.5, splash: 0, splashDmg: 0, selfMult: 0, knock: 0 },
    falloffStart: 300, falloffEnd: 400, falloffMin: 1, moveMult: 1.02, swapTime: 0.5,
    sound: { crack: 1400, body: 320, vol: 0.22, dur: 0.14 },
    stats: { dmg: 1, rate: .12, range: .7, mob: .8, ctrl: .8 },
    color: 0x8ce07a, botBurst: [1, 1], botPause: [1.0, 1.8],
  },
  grenadier: {
    ...base, id: 'grenadier', name: 'THUMPER 40', cls: 'LAUNCHER', slot: 8,
    dmg: 30, rpm: 70, mag: 4, reserve: 12, reload: 3.4, headMult: 1, limbMult: 1,
    headshotKill: false, hipSpread: 1.6, adsSpread: 0.5, adsTime: 0.3,
    spreadPerShot: 0, pattern: makePattern(149, 4, { climb: 1.8, plateau: 0.9, rise: 2, sway: 0.2, swayLen: 2, hMax: 1 }),
    kick: 0.16, shakeAmt: 1.5, moveMult: 0.94, swapTime: 0.65, shellEject: false,
    projectile: { speed: 34, radius: 0.22, gravity: 13, splash: 5.2, splashDmg: 68, selfMult: 0.5, knock: 9 },
    sound: { crack: 1500, body: 140, vol: 0.62, dur: 0.36 },
    stats: { dmg: .8, rate: .25, range: .4, mob: .7, ctrl: .4 },
    color: 0xffb648, botBurst: [1, 2], botPause: [1.0, 1.8],
  },
  knife: {
    ...base, id: 'knife', name: 'COMBAT KNIFE', cls: 'MELEE', slot: 9,
    dmg: 55, headMult: 1.6, headshotKill: false, rpm: 135, mag: Infinity, reserve: 0, reload: 0,
    melee: true, backstabKill: true, range: 3.0, hipSpread: 0, adsSpread: 0, spreadPerShot: 0,
    hipMovePenalty: 0, adsMovePenalty: 0, airPenalty: 0,
    moveMult: 1.2, swapTime: 0.25, falloffStart: 3, falloffEnd: 3.2, falloffMin: 1,
    kick: 0.1, shakeAmt: 0.3, pattern: [[0, 0.4]],
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

/** recoil for shot `index` of a spray, in degrees [horizontal, vertical] */
export function recoilStep(w, index) {
  const p = w.pattern;
  if (!p || !p.length) return [0, 0.5];
  return p[Math.min(index, p.length - 1)];
}

/** gun-game ladder */
/**
 * Gun-game ladder — eighteen rungs that walk from a sidearm to a knife.
 * Ordered so the gun keeps changing how you have to play: spray, then burst,
 * then close-quarters, then precision, and every explosive tier is followed by
 * something that punishes you for standing still.
 */
export const GUNGAME_LADDER = [
  'pistol', 'machinepistol', 'pdw', 'smg', 'autoshotgun', 'carbine',
  'rifle', 'bullpup', 'lmg', 'slug', 'shotgun', 'dmr',
  'revolver', 'crossbow', 'grenadier', 'rocket', 'sniper', 'knife',
];

/** every gun in the game, loadout guns first */
export const ALL_WEAPON_IDS = Object.keys(WEAPONS);
