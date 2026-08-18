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
    dmg: 13, pellets: 12, rpm: 70, mag: 6, reserve: 36, reload: 0.55, reloadPerShell: true,
    headshotKill: false, headMult: 1.8,          // pellets: a head hit hurts, it doesn't delete
    hipSpread: 3.2, adsSpread: 2.0, hipMovePenalty: 0.8, adsMovePenalty: 0.5, adsTime: 0.26,
    spreadPerShot: 0, pattern: makePattern(31, 8, { climb: 2.6, plateau: 0.8, rise: 3, sway: 0.3, swayLen: 2, hMax: 1.4 }),
    kick: 0.15, shakeAmt: 1.3,
    falloffStart: 8, falloffEnd: 24, falloffMin: 0.15, moveMult: 1.02,
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
  knife: {
    ...base, id: 'knife', name: 'COMBAT KNIFE', cls: 'MELEE', slot: 9,
    dmg: 65, headMult: 1.6, headshotKill: false, rpm: 110, mag: Infinity, reserve: 0, reload: 0,
    melee: true, range: 2.6, hipSpread: 0, adsSpread: 0, spreadPerShot: 0,
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
export const GUNGAME_LADDER = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'revolver', 'rocket', 'sniper', 'knife'];
