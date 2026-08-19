// ============ operators ============
// Each side has four. Armour trades speed for health, and every operator brings
// one ability (unique, limited charges) plus a throwable gadget.

export const OPERATORS = {
  /* ---------------- ATTACK ---------------- */
  breach: {
    id: 'breach', name: 'BREACH', side: 'atk', role: 'ENTRY',
    primary: 'rifle', secondary: 'pistol',
    armour: 2, speed: 2, health: 110,
    ability: { id: 'charge', name: 'BREACH CHARGE', charges: 2, cooldown: 1,
      desc: 'Sticks to a soft wall and blows a doorway through it.' },
    gadget: { id: 'frag', count: 2 },
    colour: 0x3ad2a0,
    blurb: 'Opens rotations nobody was watching.',
  },
  scout: {
    id: 'scout', name: 'SCOUT', side: 'atk', role: 'RECON',
    primary: 'smg', secondary: 'pistol',
    armour: 1, speed: 3, health: 100,
    ability: { id: 'pulse', name: 'RECON PULSE', charges: 3, cooldown: 8,
      desc: 'Scans 40 m and outlines every enemy through walls for 5 seconds.' },
    gadget: { id: 'smoke', count: 2 },
    colour: 0x4cc9ff,
    blurb: 'Fast, fragile, always knows where they are.',
  },
  hammer: {
    id: 'hammer', name: 'HAMMER', side: 'atk', role: 'BREACHER',
    primary: 'shotgun', secondary: 'revolver',
    armour: 3, speed: 1, health: 125,
    ability: { id: 'sledge', name: 'SLEDGEHAMMER', charges: 6, cooldown: 0.6,
      desc: 'Melee that removes a soft wall panel in one swing.' },
    gadget: { id: 'flash', count: 2 },
    colour: 0xff6a3d,
    blurb: 'Walls are a suggestion.',
  },
  longbow: {
    id: 'longbow', name: 'LONGBOW', side: 'atk', role: 'SUPPORT',
    primary: 'sniper', secondary: 'pistol',
    armour: 1, speed: 2, health: 100,
    ability: { id: 'drone', name: 'SPOTTER DRONE', charges: 2, cooldown: 4,
      desc: 'Throwable camera that also outlines enemies within 18 m.' },
    gadget: { id: 'smoke', count: 2 },
    colour: 0x8f7bff,
    blurb: 'Holds the long angle and calls the rest.',
  },

  /* ---------------- DEFENCE ---------------- */
  anchor: {
    id: 'anchor', name: 'ANCHOR', side: 'def', role: 'ANCHOR',
    primary: 'lmg', secondary: 'revolver',
    armour: 3, speed: 1, health: 125,
    ability: { id: 'barricade', name: 'DEPLOYABLE SHIELD', charges: 2, cooldown: 1,
      desc: 'Drops waist-high hard cover you can hold an angle behind.' },
    gadget: { id: 'mine', count: 2 },
    colour: 0xffc94a,
    blurb: 'Sits on site and refuses to move.',
  },
  trapper: {
    id: 'trapper', name: 'TRAPPER', side: 'def', role: 'TRAPPER',
    primary: 'smg', secondary: 'pistol',
    armour: 2, speed: 2, health: 110,
    ability: { id: 'mine', name: 'PROXIMITY MINE', charges: 3, cooldown: 1,
      desc: 'Arms on the floor and detonates on the first enemy through.' },
    gadget: { id: 'smoke', count: 2 },
    colour: 0xff3b5c,
    blurb: 'Punishes every entry you did not clear.',
  },
  warden: {
    id: 'warden', name: 'WARDEN', side: 'def', role: 'SUPPORT',
    primary: 'shotgun', secondary: 'pistol',
    armour: 2, speed: 2, health: 110,
    ability: { id: 'reinforce', name: 'REINFORCEMENT', charges: 4, cooldown: 0.5,
      desc: 'Hardens a soft wall so bullets and charges stop bouncing through it.' },
    gadget: { id: 'nitro', count: 1 },
    colour: 0xd8b25a,
    blurb: 'Decides which walls the attackers get.',
  },
  spectre: {
    id: 'spectre', name: 'SPECTRE', side: 'def', role: 'ROAMER',
    primary: 'rifle', secondary: 'pistol',
    armour: 1, speed: 3, health: 100,
    ability: { id: 'camera', name: 'SPY CAMERA', charges: 2, cooldown: 2,
      desc: 'Places another camera on the wall you are looking at.' },
    gadget: { id: 'flash', count: 2 },
    colour: 0xa06bff,
    blurb: 'Roams, watches, kills from behind.',
  },
};

export const ATTACKERS = Object.values(OPERATORS).filter(o => o.side === 'atk');
export const DEFENDERS = Object.values(OPERATORS).filter(o => o.side === 'def');
export const getOperator = id => OPERATORS[id] || OPERATORS.breach;

/** speed rating 1-3 → movement multiplier */
export const speedMult = op => 0.9 + (op.speed - 1) * 0.075;

export const GADGET_INFO = {
  frag:  { name: 'FRAG GRENADE', desc: 'Cooked throw, lethal blast.', colour: 0xff6a3d },
  smoke: { name: 'SMOKE GRENADE', desc: 'Blocks sight lines for 12 s — both ways.', colour: 0x9aa5b1 },
  flash: { name: 'FLASHBANG', desc: 'Blinds anyone looking at it.', colour: 0xfff0a0 },
  mine:  { name: 'PROXIMITY MINE', desc: 'Arms on the floor, triggers on enemies.', colour: 0xff3b5c },
  nitro: { name: 'NITRO CELL', desc: 'Remote charge — press the gadget key again to detonate.', colour: 0xffd60a },
};
