// ============ weapon attachments & the credit economy ============
// Attachments modify a weapon's resolved stats and add a small visual part.
// Everything is bought with credits earned in matches and persisted locally.

export const SLOTS = ['optic', 'barrel', 'grip', 'laser', 'mag'];

export const SLOT_LABEL = {
  optic: 'OPTIC', barrel: 'BARREL', grip: 'GRIP', laser: 'UNDERBARREL', mag: 'MAGAZINE',
};

/**
 * effects are applied as: multipliers (mul*) or additive deltas (add*).
 * sightY is the height of the aiming reference above the weapon rail, which is
 * what keeps the sight picture centred on screen for every optic.
 */
export const ATTACHMENTS = {
  optic: [
    { id: 'iron', name: 'IRON SIGHTS', cost: 0, desc: 'Stock sights. Fastest to bring up.', reticle: 'iron', rise: 0 },
    { id: 'reddot', name: 'RED DOT', cost: 400, desc: 'Clean 1× dot. Nothing in the way of the target.', reticle: 'dot', rise: 0.042, addAdsTime: -0.015 },
    { id: 'holo', name: 'HOLOGRAPHIC', cost: 750, desc: 'Wide 1× ring. Easy to track moving targets.', reticle: 'circle', rise: 0.052, addAdsTime: -0.005 },
    { id: 'acog', name: '2.5× ACOG', cost: 1400, desc: 'Magnified. Slower to aim, dominant at range.', reticle: 'chevron', rise: 0.058, mulAdsFov: 0.62, addAdsTime: 0.06, magnified: true },
  ],
  barrel: [
    { id: 'none', name: 'NONE', cost: 0, desc: '' },
    { id: 'comp', name: 'COMPENSATOR', cost: 600, desc: 'Cuts horizontal recoil sway by 40%.', mulRecoilH: 0.6 },
    { id: 'brake', name: 'MUZZLE BRAKE', cost: 600, desc: 'Cuts vertical climb by 22%.', mulRecoilV: 0.78 },
    { id: 'suppressor', name: 'SUPPRESSOR', cost: 1000, desc: 'Quiet, and hides you from the minimap. Slightly less damage.', mulDmg: 0.94, quiet: true },
  ],
  grip: [
    { id: 'none', name: 'NONE', cost: 0, desc: '' },
    { id: 'vertical', name: 'VERTICAL GRIP', cost: 550, desc: 'Steadier climb, 18% less vertical recoil.', mulRecoilV: 0.82 },
    { id: 'angled', name: 'ANGLED GRIP', cost: 550, desc: 'Aims down sights 20% faster.', mulAdsTime: 0.8 },
  ],
  laser: [
    { id: 'none', name: 'NONE', cost: 0, desc: '' },
    { id: 'laser', name: 'LASER SIGHT', cost: 400, desc: 'Tightens hipfire by 35%. Visible beam.', mulHipSpread: 0.65, beam: true },
    { id: 'foregrip', name: 'HANDSTOP', cost: 400, desc: 'Move 8% faster while aiming.', mulAdsMove: 1.08 },
  ],
  mag: [
    { id: 'none', name: 'STANDARD', cost: 0, desc: '' },
    { id: 'extended', name: 'EXTENDED MAG', cost: 500, desc: '+35% rounds, 15% slower reload.', mulMag: 1.35, mulReload: 1.15 },
    { id: 'quickdraw', name: 'QUICK MAG', cost: 500, desc: '25% faster reloads.', mulReload: 0.75 },
  ],
};

export const attachmentById = (slot, id) =>
  (ATTACHMENTS[slot] || []).find(a => a.id === id) || (ATTACHMENTS[slot] || [])[0];

/** apply a loadout's attachments to a weapon definition, returning a new object */
export function resolveWeapon(def, loadout) {
  const picks = SLOTS.map(s => attachmentById(s, loadout?.[s])).filter(Boolean);
  const w = { ...def, attachments: loadout || { ...DEFAULT_LOADOUT } };
  w.reticle = 'iron'; w.opticRise = 0;
  for (const a of picks) {
    if (a.reticle) { w.reticle = a.reticle; w.opticRise = a.rise || 0; }
    if (a.magnified) w.magnified = true;
    if (a.quiet) w.quiet = true;
    if (a.beam) w.beam = true;
    if (a.mulDmg) w.dmg *= a.mulDmg;
    if (a.mulRecoilV) w.recoilVMul = (w.recoilVMul ?? 1) * a.mulRecoilV;
    if (a.mulRecoilH) w.recoilHMul = (w.recoilHMul ?? 1) * a.mulRecoilH;
    if (a.mulHipSpread) w.hipSpread *= a.mulHipSpread;
    if (a.mulAdsMove) w.adsMovePenalty /= a.mulAdsMove;
    if (a.mulAdsTime) w.adsTime *= a.mulAdsTime;
    if (a.addAdsTime) w.adsTime = Math.max(0.08, w.adsTime + a.addAdsTime);
    if (a.mulAdsFov) w.adsFovMult *= a.mulAdsFov;
    if (a.mulMag) w.mag = Math.round(w.mag * a.mulMag);
    if (a.mulReload) w.reload *= a.mulReload;
  }
  return w;
}

/** total credits a loadout has spent — used to show what is owned */
export const attachmentCost = (slot, id) => attachmentById(slot, id)?.cost ?? 0;

export const DEFAULT_LOADOUT = { optic: 'iron', barrel: 'none', grip: 'none', laser: 'none', mag: 'none' };
