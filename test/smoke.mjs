/**
 * Headless smoke test — boots the real game in Chromium and asserts the things
 * that would ruin a match if they broke.
 *
 *   npm start          # in one shell
 *   npm test           # in another
 *
 * Set CHROME_PATH if Playwright's bundled Chromium isn't where it expects.
 */
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:8080/';
const results = [];
let failures = 0;

function check(name, pass, detail) {
  results.push({ name, pass });
  if (!pass) failures++;
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail !== undefined ? `  → ${JSON.stringify(detail)}` : ''}`);
}

const launchOpts = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'networkidle' });
let booted = true;
try {
  await page.waitForFunction(() => !!window.__game && document.getElementById('loading').classList.contains('hidden'), { timeout: 40000 });
} catch (e) { booted = false; }
check('boots and builds the map', booted);
if (!booted) { console.log('\nboot failed — aborting'); await browser.close(); process.exit(1); }

const world = await page.evaluate(() => ({
  boxes: window.__game.world.boxes.length,
  nav: window.__game.nav.nodes.length,
  soft: window.__game.world.boxes.filter(b => b.soft).length,
  objectives: window.__game.objectives.length,
  cameras: window.__game.cameraSpecs.length,
}));
check('house, navmesh, soft walls and objectives exist',
  world.boxes > 150 && world.nav > 1500 && world.soft > 40 && world.objectives === 2 && world.cameras >= 4, world);

/* ---------------- controls & aim settings ---------------- */
const ui = await page.evaluate(() => ({
  rows: document.querySelectorAll('.bind-row').length,
  slots: document.querySelectorAll('.bind-key').length,
  conflicts: document.querySelectorAll('.bind-key.dupe').length,
}));
check('every action has two rebindable slots', ui.rows >= 28 && ui.slots === ui.rows * 2, ui);
check('default binds report no conflicts', ui.conflicts === 0, ui);

const rebind = await page.evaluate(async () => {
  const mod = await import('/src/core/keybinds.js');
  const inp = await import('/src/core/input.js');
  document.querySelector('.bind-key[data-action="forward"][data-slot="0"]').click();
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
  const after = mod.binds.forward[0];
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
  const works = inp.actionDown('forward');
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyI', bubbles: true }));
  mod.resetBinds();
  return { after, works, restored: mod.binds.forward[0] };
});
check('rebinding a key takes effect immediately', rebind.after === 'KeyI' && rebind.works && rebind.restored === 'KeyW', rebind);

const sens = await page.evaluate(async () => {
  const { cm360 } = await import('/src/core/settings.js');
  return { at1: +cm360(1, 800).toFixed(1), at2: +cm360(2, 800).toFixed(1), dpi1600: +cm360(1, 1600).toFixed(1) };
});
check('cm/360 maths scales with sens and DPI',
  sens.at1 > 15 && sens.at1 < 35 && Math.abs(sens.at2 - sens.at1 / 2) < 0.2 && Math.abs(sens.dpi1600 - sens.at1 / 2) < 0.2, sens);

await page.evaluate(() => document.getElementById('btn-play').click());
await page.waitForFunction(() => window.__game?.running, { timeout: 20000 });

/* ---------------- everything else runs inside the page ---------------- */
const sim = await page.evaluate(async () => {
  const g = window.__game;
  const { stepMovement, MOVE } = window.__mv;
  const { traceShot } = await import('/src/game/combat.js');
  const { resolveWeapon } = await import('/src/weapons/attachments.js');
  const { WEAPONS, recoilStep } = await import('/src/weapons/defs.js');
  const V = (x, y, z) => new (g.player.pos.constructor)(x, y, z);
  const out = {};

  const put = (x, y, z, yaw = 0) => {
    g.player.pos.set(x, y, z); g.player.vel.set(0, 0, 0); g.player.yaw = yaw; g.player.pitch = 0;
    g.player.alive = true; g.player.health = 100; g.player.shield = 0; g.player.height = MOVE.height;
    g.player.leanAmt = 0; g.player.leanVec.set(0, 0, 0); g.player.sliding = false; g.player.slideCd = 0;
  };
  const walk = (n, cmd) => { for (let i = 0; i < n; i++) stepMovement(g.player, cmd, 1 / 60, g.world, g); };
  const FWD = { forward: 1, strafe: 0, jump: false, sprint: true, crouch: false, slow: false, lean: 0 };

  // ---- the objective has to be reachable, from every attacker spawn ----
  {
    const misses = [];
    for (const sp of g.atkSpawns) {
      for (const obj of g.objectives) {
        const p = g.nav.findPath({ x: sp.x, y: sp.y, z: sp.z }, { x: obj.x, y: obj.y, z: obj.z });
        if (!p) misses.push(`${sp.x},${sp.z}→${obj.id}`);
      }
    }
    out.routes = { spawns: g.atkSpawns.length, misses };
  }

  // ---- pacing ----
  put(0, 0.2, -30); walk(150, FWD); out.sprintSpeed = +g.player.speed.toFixed(1);
  put(0, 0.2, -30); walk(150, { ...FWD, sprint: false }); out.walkSpeed = +g.player.speed.toFixed(1);
  put(0, 0.2, -30);
  for (let i = 0; i < 240; i++) stepMovement(g.player, { ...FWD, jump: true, strafe: 0.4 }, 1 / 60, g.world, g);
  out.hopSpeed = +g.player.speed.toFixed(1);

  // ---- slide: a burst of speed out of a sprint ----
  put(0, 0.2, -34);
  walk(120, FWD);
  let slidePeak = 0, slid = false;
  for (let i = 0; i < 90; i++) {
    stepMovement(g.player, { ...FWD, crouch: true }, 1 / 60, g.world, g);
    slid = slid || g.player.sliding;
    slidePeak = Math.max(slidePeak, g.player.speed);
  }
  out.slide = { triggered: slid, peak: +slidePeak.toFixed(1), faster: slidePeak > out.sprintSpeed + 1 };

  // ---- leaning: no speed penalty, and it moves the head hitbox ----
  {
    put(0, 0.2, -30, 0);
    walk(120, { ...FWD, lean: 1 });
    out.leanSpeed = +g.player.speed.toFixed(1);
    put(0, 0.2, -30, 0);
    walk(60, { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false, slow: false, lean: 1 });
    const off = Math.hypot(g.player.leanVec.x, g.player.leanVec.z);
    const headY = g.player.pos.y + g.player.height - 0.17;
    const from = { x: g.player.pos.x + off, y: headY, z: g.player.pos.z - 8 };
    const leaned = g.player.hitTest(from, { x: 0, y: 0, z: 1 }, 40);
    walk(90, { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false, slow: false, lean: 0 });
    const upright = g.player.hitTest(from, { x: 0, y: 0, z: 1 }, 40);
    out.lean = { offset: +off.toFixed(2), leanedHit: leaned?.part ?? null, uprightHit: upright?.part ?? null };
  }

  // ---- soft walls: shoot through them, break them, get them back ----
  {
    const soft = g.world.boxes.find(b => b.soft && !b.dead);
    const cx = (soft.min.x + soft.max.x) / 2, cy = (soft.min.y + soft.max.y) / 2, cz = (soft.min.z + soft.max.z) / 2;
    const thin = (soft.max.x - soft.min.x) < (soft.max.z - soft.min.z);
    const hit = traceShot(g, g.player, thin ? V(cx - 3, cy, cz) : V(cx, cy, cz - 3), thin ? V(1, 0, 0) : V(0, 0, 1), 30);
    out.penetration = { through: hit.punched.length > 0, power: +(hit.power ?? 1).toFixed(2) };
    for (let i = 0; i < 12; i++) g.world.damageBox(soft, 30);
    out.wallDestroyed = soft.dead === true;
    g.restoreGeometry();
    out.wallRestored = soft.dead === false;
  }

  // ---- a breached wall opens new routes for the AI ----
  {
    // blow a doorway-sized hole, the way a charge does, not a single panel
    const soft = g.world.boxes.find(b => b.soft && !b.dead);
    const centre = V((soft.min.x + soft.max.x) / 2, soft.min.y + 1, (soft.min.z + soft.max.z) / 2);
    const before = g.nav.nodes.reduce((s, n) => s + n.links.length, 0);
    for (const b of g.world.breakablesNear(centre, 2.4)) if (b.soft) g.world.destroyBox(b);
    const after = g.nav.nodes.reduce((s, n) => s + n.links.length, 0);
    out.navRelink = { linksGained: after - before };
    g.restoreGeometry();
  }

  // ---- gadgets ----
  {
    g.gadgets.smokes.push({ pos: V(0, 1.5, -30), r: 4, maxR: 4, life: 10 });
    out.smoke = { blocks: g.gadgets.blocksSight(V(-8, 1.5, -30), V(8, 1.5, -30)),
                  clear: !g.gadgets.blocksSight(V(-8, 1.5, -20), V(8, 1.5, -20)) };
    g.gadgets.smokes.length = 0;

    const bot = g.bots[0];
    bot.alive = true; bot.pos.set(0, 0.2, -20); bot.yaw = 0; bot.blindUntil = 0;
    g.gadgets.items.push({ kind: 'flash', owner: g.player, team: 0, mesh: null, pos: V(0, 1.4, -24), fuse: 0.001, life: 5, static: true });
    for (let i = 0; i < 5; i++) g.gadgets.update(1 / 60);
    out.flashBlinds = (bot.blindUntil || 0) > g.time;

    const foe = g.bots.find(b => b.team === 1) || g.bots[0];
    foe.alive = true; foe.health = 100; foe.team = 1; foe.pos.set(24, 0.2, 24);
    g.gadgets.items.push({ kind: 'mine', owner: g.player, team: 0, mesh: null, static: true, armed: true, pos: V(24, 0.3, 24), fuse: Infinity, life: 30 });
    for (let i = 0; i < 6; i++) g.gadgets.update(1 / 60);
    out.mineTriggers = foe.health < 100 || !foe.alive;

    const boxesBefore = g.world.boxes.length;
    g.gadgets.deployShield(g.player, V(30, 0.2, -30), 0);
    out.shield = { added: g.world.boxes.length - boxesBefore, blocks: !g.world.losClear(V(28, 0.6, -30), V(32, 0.6, -30)) };
  }

  // ---- breach charge opens a hole ----
  {
    const soft = g.world.boxes.find(b => b.soft && !b.dead);
    const before = g.world.boxes.filter(b => b.soft && !b.dead).length;
    g.gadgets.items.push({ kind: 'charge', owner: g.player, team: 0, mesh: null, static: true,
      pos: V((soft.min.x + soft.max.x) / 2, soft.min.y + 1.2, (soft.min.z + soft.max.z) / 2), fuse: 0.001, box: soft, life: 5 });
    for (let i = 0; i < 5; i++) g.gadgets.update(1 / 60);
    out.breachOpens = before - g.world.boxes.filter(b => b.soft && !b.dead).length;
    g.restoreGeometry();
  }

  // ---- lethality ----
  {
    const v = g.bots[0];
    const others = g.actors.filter(a => a !== v && a !== g.player);
    const wasAlive = others.map(a => a.alive);
    others.forEach(a => { a.alive = false; });

    v.alive = true; v.health = 100; v.maxHealth = 100; v.shield = 100; v.height = 1.82;
    put(0, 0.2, -30, 0);
    v.pos.set(0, 0.2, -42); v.vel.set(0, 0, 0);
    g.player.arsenal.give('pistol', true); g.player.arsenal.select('pistol', true);
    g.player.adsAmt = 1;
    g.player.pitch = Math.atan2((v.pos.y + v.height - 0.17) - g.player.eyeY, 12);
    g.player.recoilPitch = 0; g.player.arsenal.fireTimer = 0; g.player.arsenal.spread = 0;
    g.player.fire();
    out.headshotKill = !v.alive;

    v.alive = true; v.health = 1000; v.maxHealth = 1000; v.shield = 0;
    g.player.arsenal.give('rifle', true); g.player.arsenal.select('rifle', true);
    g.player.adsAmt = 1;
    g.player.pitch = Math.atan2((v.pos.y + v.height * 0.5) - g.player.eyeY, 12);
    g.player.recoilPitch = 0; g.player.arsenal.fireTimer = 0; g.player.arsenal.spread = 0; g.player.arsenal.sprayIndex = 0;
    const before = v.health;
    g.player.fire();
    out.bodyDamage = Math.round(before - v.health);
    v.maxHealth = 100; v.health = 100;
    others.forEach((a, i) => { a.alive = wasAlive[i]; });
  }

  // ---- spread + recoil model ----
  {
    const ars = g.player.arsenal;
    ars.select('rifle', true); ars.spread = 0;
    out.spread = {
      adsStill: +ars.currentSpread(0, false, true, false).toFixed(2),
      adsMoving: +ars.currentSpread(1, false, true, false).toFixed(2),
      hipStill: +ars.currentSpread(0, false, false, false).toFixed(2),
      inAir: +ars.currentSpread(0, true, true, false).toFixed(2),
    };
    const a = [0, 1, 2, 5, 9].map(i => recoilStep(WEAPONS.rifle, i).join(','));
    const b = [0, 1, 2, 5, 9].map(i => recoilStep(WEAPONS.rifle, i).join(','));
    out.pattern = { deterministic: a.join('|') === b.join('|'),
                    climbsThenFlattens: WEAPONS.rifle.pattern[0][1] > WEAPONS.rifle.pattern[3][1] };
  }

  // ---- attachments ----
  {
    const base = WEAPONS.rifle;
    const plain = resolveWeapon(base, { optic: 'iron', barrel: 'none', grip: 'none', laser: 'none', mag: 'none' });
    const kitted = resolveWeapon(base, { optic: 'acog', barrel: 'comp', grip: 'vertical', laser: 'laser', mag: 'extended' });
    out.attachments = {
      magUp: kitted.mag > plain.mag,
      recoilDown: (kitted.recoilVMul ?? 1) < 1 && (kitted.recoilHMul ?? 1) < 1,
      hipTighter: kitted.hipSpread < plain.hipSpread,
      zoomIn: kitted.adsFovMult < plain.adsFovMult,
      reticle: kitted.reticle,
    };
  }

  // ---- ADS sight picture lines the sight up with screen centre ----
  {
    const vm = g.viewModel;
    vm.setWeapon('rifle', resolveWeapon(WEAPONS.rifle, { optic: 'reddot' }));
    const withDot = vm.sightHeight;
    vm.setWeapon('rifle', resolveWeapon(WEAPONS.rifle, { optic: 'iron' }));
    const withIron = vm.sightHeight;
    out.sight = { iron: +withIron.toFixed(3), reddot: +withDot.toFixed(3), opticSitsHigher: withDot > withIron };
  }

  // ---- cameras ----
  {
    const cam = g.cameras[0];
    out.cameras = g.cameras.length;
    g.world.damageBox(cam.box, 40);
    out.cameraDestroyed = cam.dead === true;
  }

  // ---- gun game hands out the ladder and nothing else ----
  {
    g.startMatch({ mode: 'gungame', bots: 5, difficulty: 'normal', scoreLimit: 30, timeLimit: 600 });
    out.gunGameNoPickups = g.weaponCrates.length === 0;
    const start = new Set(g.actors.map(a => a.arsenal.current));
    let f = 0, top = 0;
    while (f < 60 * 120) { g.update(1 / 60); f++; top = Math.max(top, ...g.actors.map(a => a.gunGameTier)); }
    out.gungame = { start: [...start], topTier: top };
  }

  // ---- frame budget ----
  {
    g.startMatch({ mode: 'ffa', bots: 15, difficulty: 'insane', scoreLimit: 99, timeLimit: 600 });
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const t = performance.now();
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    out.simMs = +((performance.now() - t) / 120).toFixed(2);
  }

  // ---- plant and defuse work end to end ----
  {
    g.startMatch({ mode: 'siege', bots: 5, difficulty: 'normal', roundsToWin: 3, prepTime: 1, roundTime: 150 });
    g.siege.phase = 'action'; g.attackersFrozen = false;
    g.siege.planted = false; g.siege.plantProgress = 0; g.siege.defuseProgress = 0;
    const atk = g.actors.find(a => g.sideOf(a) === 'atk');
    atk.pos.set(g.siege.site.x, g.siege.site.y, g.siege.site.z);
    for (let i = 0; i < 400 && !g.siege.planted; i++) g.siege.interact(atk, 1 / 60);
    const planted = g.siege.planted;
    const def = g.actors.find(a => g.sideOf(a) === 'def');
    def.pos.copy(g.siege.defuser.pos);
    const roundsBefore = g.siege.rounds.slice();
    for (let i = 0; i < 500 && g.siege.phase === 'action'; i++) g.siege.interact(def, 1 / 60);
    out.objective = { planted, defused: g.siege.phase === 'over', scored: g.siege.rounds.join() !== roundsBefore.join() };
  }

  // ---- siege runs a full match: prep → action → rounds → result ----
  {
    let ended = null;
    g.onMatchEnd = r => { ended = r; };
    g.startMatch({ mode: 'siege', bots: 7, difficulty: 'normal', roundsToWin: 2, prepTime: 2, roundTime: 120 });
    const phases = new Set();
    const sides = new Set();
    let f = 0, planted = false, respawnedMidRound = false;
    while (!ended && f < 60 * 60 * 14) {
      const aliveBefore = g.sideAlive('atk') + g.sideAlive('def');
      g.update(1 / 60); f++;
      phases.add(g.siege.phase);
      sides.add(g.siege.playerSide);
      planted = planted || g.siege.planted;
      if (g.siege.phase === 'action' && g.sideAlive('atk') + g.sideAlive('def') > aliveBefore) respawnedMidRound = true;
    }
    out.siege = {
      ended: !!ended, phases: [...phases].sort(), sidesPlayed: [...sides].sort(),
      rounds: g.siege.rounds, everPlanted: planted, respawnedMidRound, simSec: Math.round(f / 60),
    };
  }

  // ---- the other modes still finish ----
  {
    let ended = null; g.onMatchEnd = r => { ended = r; };
    g.startMatch({ mode: 'ffa', bots: 8, difficulty: 'normal', scoreLimit: 10, timeLimit: 600 });
    let f = 0; while (!ended && f < 60 * 60 * 14) { g.update(1 / 60); f++; }
    out.ffa = { ended: !!ended, kills: g.actors.reduce((s, a) => s + a.kills, 0) };

    ended = null;
    g.startMatch({ mode: 'tdm', bots: 8, difficulty: 'normal', scoreLimit: 12, timeLimit: 600 });
    const mate = g.bots.find(b => b.team === 0), foe = g.bots.find(b => b.team === 1);
    out.teams = g.friendly(g.player, mate) && !g.friendly(g.player, foe);
    f = 0; while (!ended && f < 60 * 60 * 14) { g.update(1 / 60); f++; }
    out.tdm = !!ended;
  }
  return out;
});

check('every attacker spawn can reach both objectives', sim.routes.misses.length === 0, sim.routes);
check('sprint is tactical-paced', sim.sprintSpeed > 6 && sim.sprintSpeed < 8, { sprint: sim.sprintSpeed, walk: sim.walkSpeed });
check('bunny hopping gains no speed', sim.hopSpeed <= sim.sprintSpeed + 0.3, { hop: sim.hopSpeed, sprint: sim.sprintSpeed });
check('slide gives a burst of speed', sim.slide.triggered && sim.slide.faster, sim.slide);
check('leaning costs no movement speed', sim.leanSpeed >= sim.sprintSpeed - 0.2, { leaning: sim.leanSpeed, sprint: sim.sprintSpeed });
check('leaning exposes the head hitbox',
  sim.lean.offset > 0.3 && sim.lean.leanedHit === 'head' && sim.lean.uprightHit === null, sim.lean);
check('bullets punch through drywall and lose power', sim.penetration.through && sim.penetration.power < 1, sim.penetration);
check('soft walls break and come back next round', sim.wallDestroyed && sim.wallRestored);
check('destruction opens new AI routes', sim.navRelink.linksGained > 0, sim.navRelink);
check('breach charge opens a hole', sim.breachOpens > 0, { panels: sim.breachOpens });
check('smoke blocks sight lines', sim.smoke.blocks && sim.smoke.clear, sim.smoke);
check('flashbang blinds', sim.flashBlinds);
check('proximity mine triggers on enemies', sim.mineTriggers);
check('deployable shield becomes real cover', sim.shield.added === 1 && sim.shield.blocks, sim.shield);
check('headshots kill through full armour', sim.headshotKill);
check('rifle body damage is 3-shot lethal', sim.bodyDamage >= 33 && sim.bodyDamage <= 35, { damage: sim.bodyDamage });
check('aimed + still beats hipfire and jumping',
  sim.spread.adsStill < 0.1 && sim.spread.adsMoving > sim.spread.adsStill * 5 &&
  sim.spread.hipStill > sim.spread.adsStill * 20 && sim.spread.inAir > sim.spread.hipStill, sim.spread);
check('recoil patterns are fixed and learnable', sim.pattern.deterministic && sim.pattern.climbsThenFlattens, sim.pattern);
check('attachments change how a gun handles', Object.values(sim.attachments).slice(0, 4).every(Boolean), sim.attachments);
check('optics raise the sight line above the irons', sim.sight.opticSitsHigher, sim.sight);
check('cameras exist and can be shot out', sim.cameras >= 4 && sim.cameraDestroyed, { cameras: sim.cameras });
check('gun game has no floor weapons', sim.gunGameNoPickups);
check('gun game starts on the pistol and promotes',
  sim.gungame.start.length === 1 && sim.gungame.start[0] === 'pistol' && sim.gungame.topTier > 0, sim.gungame);
check('15 insane bots stay inside frame budget', sim.simMs < 9, { simMs: sim.simMs });
check('siege plays prep → action → round end → match end',
  sim.siege.ended && sim.siege.phases.join() === 'action,over,prep', sim.siege);
check('siege swaps sides between rounds', sim.siege.sidesPlayed.length === 2, sim.siege.sidesPlayed);
check('defuser can be planted and defused',
  sim.objective.planted && sim.objective.defused && sim.objective.scored, sim.objective);
check('no respawns inside a siege round', !sim.siege.respawnedMidRound);
check('FFA reaches its score limit', sim.ffa.ended && sim.ffa.kills >= 10, sim.ffa);
check('TDM teams + friendly fire off', sim.teams && sim.tdm);
check('no console/page errors', errors.length === 0, errors.slice(0, 3));

await browser.close();
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
