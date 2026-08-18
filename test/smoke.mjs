/**
 * Headless smoke test — boots the game in Chromium, exercises the real systems
 * and asserts the things that would ruin a match if they broke.
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
// wait for readiness rather than a fixed delay: building the map + navmesh takes
// noticeably longer on a software renderer
let booted = true;
try {
  await page.waitForFunction(() => !!window.__game && document.getElementById('loading').classList.contains('hidden'), { timeout: 30000 });
} catch (e) { booted = false; }

check('boots and builds the arena', booted);
if (!booted) { console.log('\nboot failed — aborting'); await browser.close(); process.exit(1); }
const world = await page.evaluate(() => ({ boxes: window.__game.world.boxes.length, nav: window.__game.nav.nodes.length }));
check('world + navmesh built', world.boxes > 100 && world.nav > 800, world);

/* ---------------- controls UI ---------------- */
const ui = await page.evaluate(() => ({
  rows: document.querySelectorAll('.bind-row').length,
  slots: document.querySelectorAll('.bind-key').length,
  falseConflicts: [...document.querySelectorAll('.bind-key.dupe')].length,
}));
check('every action has two rebindable slots', ui.rows >= 25 && ui.slots === ui.rows * 2, ui);
check('default binds report no conflicts', ui.falseConflicts === 0, ui);

const rebind = await page.evaluate(async () => {
  const mod = await import('/src/core/keybinds.js');
  const inp = await import('/src/core/input.js');
  const before = mod.binds.forward[0];
  // drive the real capture path the settings UI uses
  document.querySelector('.bind-key[data-action="forward"][data-slot="0"]').click();
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
  const after = mod.binds.forward[0];
  const worksAsAction = (() => {
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    const down = inp.actionDown('forward');
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyI', bubbles: true }));
    return down;
  })();
  mod.resetBinds();
  return { before, after, worksAsAction, restored: mod.binds.forward[0] };
});
check('rebinding a key takes effect immediately', rebind.after === 'KeyI' && rebind.worksAsAction && rebind.restored === 'KeyW', rebind);

const sens = await page.evaluate(async () => {
  const { settings, cm360 } = await import('/src/core/settings.js');
  const a = cm360(1.0, 800), b = cm360(2.0, 800), c = cm360(1.0, 1600);
  return { at1: +a.toFixed(1), at2: +b.toFixed(1), dpi1600: +c.toFixed(1) };
});
check('cm/360 maths scales with sens and DPI',
  sens.at1 > 15 && sens.at1 < 35 && Math.abs(sens.at2 - sens.at1 / 2) < 0.2 && Math.abs(sens.dpi1600 - sens.at1 / 2) < 0.2, sens);

await page.click('#btn-play');
await page.waitForFunction(() => window.__game?.running, { timeout: 15000 });

/* ---------------- simulation ---------------- */
const sim = await page.evaluate(async () => {
  const g = window.__game;
  const { stepMovement, MOVE } = window.__mv;
  const out = {};
  // deterministic starting point: a respawning mode with nothing frozen
  g.startMatch({ mode: 'ffa', bots: 7, difficulty: 'normal', scoreLimit: 99, timeLimit: 600 });
  const put = (x, y, z, yaw = 0) => {
    g.player.pos.set(x, y, z); g.player.vel.set(0, 0, 0); g.player.yaw = yaw; g.player.pitch = 0;
    g.player.alive = true; g.player.health = 100; g.player.shield = 0; g.player.height = MOVE.height;
    g.player.leanAmt = 0; g.player.leanVec.set(0, 0, 0);
  };
  const walk = (n, cmd) => { let peak = -99; for (let i = 0; i < n; i++) { stepMovement(g.player, cmd, 1 / 60, g.world, g); peak = Math.max(peak, g.player.pos.y); } return peak; };
  const FWD = { forward: 1, strafe: 0, jump: false, sprint: true, crouch: false, slow: false, lean: 0 };

  // --- traversal: every level still reachable at the slower pace ---
  put(27, 0.2, 7, Math.PI / 2);  out.coreRoof = walk(360, FWD) > 5.5;
  put(11, 5.95, 0, Math.PI / 2); out.coreTier = walk(220, FWD) > 7.5;
  put(0, 7.95, 8, 0);            out.sniperTower = walk(300, FWD) > 10.4;
  put(0, 0.2, 27, Math.PI);      out.catwalk = walk(360, FWD) > 5.5;
  put(13, 0.2, 33, -Math.PI / 2); out.bunkerRoof = walk(300, FWD) > 5.5;
  put(0, 0.2, 50, Math.PI);      walk(300, FWD); out.wallsStop = g.player.pos.z < 57.5;

  // --- pacing: this is a walk-and-hold game, not a rocket-jump game ---
  put(12, 0.2, 40); walk(150, FWD);
  out.sprintSpeed = +g.player.speed.toFixed(1);
  put(12, 0.2, 40); walk(150, { ...FWD, sprint: false });
  out.walkSpeed = +g.player.speed.toFixed(1);
  // bunny hopping must not beat running
  put(12, 0.2, 40);
  for (let i = 0; i < 300; i++) stepMovement(g.player, { ...FWD, jump: true, strafe: 0.4 }, 1 / 60, g.world, g);
  out.hopSpeed = +g.player.speed.toFixed(1);

  // --- crouch / stand ---
  put(12, 0.2, 30);
  walk(60, { ...FWD, forward: 0, sprint: false, crouch: true });
  const crouched = g.player.height;
  walk(120, { ...FWD, forward: 0, sprint: false });
  out.crouch = crouched < 1.3 && g.player.height > 1.75;

  // --- leaning shifts the camera AND the hitbox ---
  {
    put(12, 0.2, 30, 0);
    walk(60, { ...FWD, forward: 0, sprint: false, lean: 1 });
    const off = Math.hypot(g.player.leanVec.x, g.player.leanVec.z);
    // a ray that misses the head when upright should connect when leaned into it
    const THREE = g.camera.constructor;
    const headY = g.player.pos.y + g.player.height - 0.17;
    const from = { x: 12 + off, y: headY, z: 20 };
    const dir = { x: 0, y: 0, z: 1 };
    const hitLeaned = g.player.hitTest(from, dir, 40);
    walk(90, { ...FWD, forward: 0, sprint: false, lean: 0 });
    const hitUpright = g.player.hitTest(from, dir, 40);
    out.lean = { offset: +off.toFixed(2), leanedHit: hitLeaned?.part ?? null, uprightHit: hitUpright?.part ?? null };
  }

  // --- one-shot headshots, for anyone holding a gun ---
  {
    const v = g.bots[0];
    v.alive = true; v.health = 100; v.shield = 100;      // armour must not save the head
    put(12, 0.2, 30, 0);
    v.pos.set(12, 0.2, 18); v.vel.set(0, 0, 0); v.height = 1.82;
    g.player.arsenal.give('pistol', true); g.player.arsenal.select('pistol', true);
    g.player.adsAmt = 1;                                  // aimed shot, as intended
    const dy = (v.pos.y + v.height - 0.17) - g.player.eyeY;
    g.player.pitch = Math.atan2(dy, 12);
    g.player.recoilPitch = 0; g.player.arsenal.fireTimer = 0; g.player.arsenal.spread = 0;
    g.player.fire();
    out.headshotKill = { alive: v.alive, hp: Math.round(v.health) };
  }

  // --- body shots take the advertised number of rounds ---
  {
    const v = g.bots[0];
    // park everyone else so a stray bot can't finish the target mid-measurement
    const others = g.actors.filter(a => a !== v && a !== g.player);
    const wasAlive = others.map(a => a.alive);
    others.forEach(a => { a.alive = false; });
    v.alive = true; v.health = 1000; v.maxHealth = 1000; v.shield = 0; v.height = 1.82;
    put(12, 0.2, 30, 0);
    v.pos.set(12, 0.2, 18); v.vel.set(0, 0, 0);
    g.player.arsenal.give('rifle', true); g.player.arsenal.select('rifle', true);
    g.player.adsAmt = 1;
    g.player.pitch = Math.atan2((v.pos.y + v.height * 0.5) - g.player.eyeY, 12);
    g.player.recoilPitch = 0; g.player.recoilYaw = 0;
    g.player.arsenal.fireTimer = 0; g.player.arsenal.spread = 0; g.player.arsenal.sprayIndex = 0;
    const before = v.health;
    g.player.fire();
    out.bodyDamage = Math.round(before - v.health);
    out.bodyShotsToKill = Math.ceil(100 / Math.max(1, out.bodyDamage));
    v.maxHealth = 100; v.health = 100;
    others.forEach((a, i) => { a.alive = wasAlive[i]; });
  }

  // --- aimed + still is precise, hipfire on the move is not ---
  {
    const ars = g.player.arsenal;
    ars.select('rifle', true); ars.spread = 0;
    out.spread = {
      adsStill: +ars.currentSpread(0, false, true, false).toFixed(2),
      adsMoving: +ars.currentSpread(1, false, true, false).toFixed(2),
      hipStill: +ars.currentSpread(0, false, false, false).toFixed(2),
      inAir: +ars.currentSpread(0, true, true, false).toFixed(2),
    };
  }

  // --- recoil patterns are fixed, not random ---
  {
    const { WEAPONS, recoilStep } = await import('/src/weapons/defs.js');
    const a = [0, 1, 2, 5, 9].map(i => recoilStep(WEAPONS.rifle, i).join(','));
    const b = [0, 1, 2, 5, 9].map(i => recoilStep(WEAPONS.rifle, i).join(','));
    const climbs = WEAPONS.rifle.pattern.slice(0, 4).map(p => p[1]);
    out.pattern = { deterministic: a.join('|') === b.join('|'), climbsThenFlattens: climbs[0] > climbs[3] };
  }

  // --- walls still stop bullets ---
  {
    const bot = g.bots[0]; bot.alive = true; bot.health = 1000; bot.maxHealth = 1000; bot.shield = 0;
    put(9.5, 0.2, 22, 0); bot.pos.set(9.5, 0.2, 2);
    g.player.arsenal.select('rifle', true);
    const h0 = bot.health;
    for (let i = 0; i < 6; i++) { g.player.arsenal.fireTimer = 0; g.player.recoilPitch = 0; g.player.fire(); g.update(1 / 60); }
    out.wallsStopBullets = bot.health === h0;
    bot.maxHealth = 100; bot.health = 100;
  }

  // --- rocket jump still works (physics sanity), with the bots parked ---
  const liveBots = g.bots; g.bots = [];
  {
    put(12, 0.2, 40); g.player.pitch = -1.45;
    for (let i = 0; i < 8; i++) g.update(1 / 60);
    g.player.arsenal.give('rocket', true); g.player.arsenal.select('rocket', true);
    g.player.arsenal.fireTimer = 0; g.player.arsenal.ammo.mag = 1; g.player.health = 100;
    const y0 = g.player.pos.y; g.player.fire();
    let peak = y0; for (let i = 0; i < 150; i++) { g.update(1 / 60); peak = Math.max(peak, g.player.pos.y); }
    out.rocketJump = { rise: +(peak - y0).toFixed(1), hp: Math.round(g.player.health), alive: g.player.alive };
  }
  g.bots = liveBots;

  // --- every weapon selects and builds a viewmodel ---
  {
    const ids = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'revolver', 'lmg', 'rocket'];
    const bad = [];
    for (const id of ids) {
      g.player.arsenal.give(id, true); g.player.arsenal.select(id, true);
      for (let i = 0; i < 3; i++) g.update(1 / 60);
      g.render();
      if (g.viewModel.id !== id) bad.push(id);
    }
    out.allWeapons = bad.length === 0;
  }

  // --- frame budget with a full lobby of the hardest bots ---
  {
    g.startMatch({ mode: 'ffa', bots: 15, difficulty: 'insane', scoreLimit: 50, timeLimit: 600 });
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const t = performance.now();
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    out.simMs = +((performance.now() - t) / 120).toFixed(2);
  }

  // --- tactical rounds: prep → live → round win → match win, no respawns ---
  {
    let ended = null;
    g.onMatchEnd = r => { ended = r; };
    g.startMatch({ mode: 'tactical', bots: 7, difficulty: 'normal', roundsToWin: 2, prepTime: 2, roundTime: 90 });
    const seen = new Set([g.roundState]);
    let f = 0, respawnedMidRound = false, maxRound = 1;
    while (!ended && f < 60 * 60 * 14) {
      const aliveBefore = g.teamAlive(0) + g.teamAlive(1);
      g.update(1 / 60); f++;
      seen.add(g.roundState);
      maxRound = Math.max(maxRound, g.roundNo);
      if (g.roundState === 'live' && g.teamAlive(0) + g.teamAlive(1) > aliveBefore) respawnedMidRound = true;
    }
    out.tactical = {
      ended: !!ended, states: [...seen].sort(), rounds: g.rounds, roundsPlayed: maxRound,
      respawnedMidRound, simSec: Math.round(f / 60),
    };
  }

  // --- the other three modes still run to completion ---
  {
    let ended = null; g.onMatchEnd = r => { ended = r; };
    g.startMatch({ mode: 'ffa', bots: 8, difficulty: 'normal', scoreLimit: 10, timeLimit: 600 });
    let f = 0; while (!ended && f < 60 * 60 * 14) { g.update(1 / 60); f++; }
    out.ffa = { ended: !!ended, kills: g.actors.reduce((s, a) => s + a.kills, 0), simSec: Math.round(f / 60) };

    ended = null;
    g.startMatch({ mode: 'tdm', bots: 8, difficulty: 'normal', scoreLimit: 12, timeLimit: 600 });
    const mate = g.bots.find(b => b.team === 0), foe = g.bots.find(b => b.team === 1);
    out.teams = g.friendly(g.player, mate) && !g.friendly(g.player, foe);
    f = 0; while (!ended && f < 60 * 60 * 14) { g.update(1 / 60); f++; }
    out.tdm = { ended: !!ended, scores: [g.teamScore(0), g.teamScore(1)], simSec: Math.round(f / 60),
                alive: [g.teamAlive(0), g.teamAlive(1)] };

    g.startMatch({ mode: 'gungame', bots: 6, difficulty: 'hard', scoreLimit: 30, timeLimit: 600 });
    const start = new Set(g.actors.map(a => a.arsenal.current));
    f = 0; let top = 0;
    while (f < 60 * 120) { g.update(1 / 60); f++; top = Math.max(top, ...g.actors.map(a => a.gunGameTier)); }
    out.gungame = { start: [...start], topTier: top };
  }
  return out;
});

check('core roof reachable', sim.coreRoof);
check('core second tier reachable', sim.coreTier);
check('sniper tower reachable', sim.sniperTower);
check('catwalk reachable', sim.catwalk);
check('bunker roof reachable', sim.bunkerRoof);
check('perimeter walls are solid', sim.wallsStop);
check('sprint is tactical-paced, not arcade', sim.sprintSpeed > 5 && sim.sprintSpeed < 7, { sprint: sim.sprintSpeed, walk: sim.walkSpeed });
check('bunny hopping gains no speed', sim.hopSpeed <= sim.sprintSpeed + 0.3, { hop: sim.hopSpeed, sprint: sim.sprintSpeed });
check('crouch and stand back up', sim.crouch);
check('leaning moves the camera and exposes the head',
  sim.lean.offset > 0.3 && sim.lean.leanedHit === 'head' && sim.lean.uprightHit === null, sim.lean);
check('headshots kill through full armour', !sim.headshotKill.alive, sim.headshotKill);
check('rifle body TTK is 3 rounds', sim.bodyShotsToKill === 3, { damagePerShot: sim.bodyDamage, shots: sim.bodyShotsToKill });
check('aimed + still beats hipfire and jumping',
  sim.spread.adsStill < 0.1 && sim.spread.adsMoving > sim.spread.adsStill * 5 &&
  sim.spread.hipStill > sim.spread.adsStill * 20 && sim.spread.inAir > sim.spread.hipStill, sim.spread);
check('recoil patterns are fixed and learnable', sim.pattern.deterministic && sim.pattern.climbsThenFlattens, sim.pattern);
check('walls stop bullets', sim.wallsStopBullets);
check('rocket jump still launches without suiciding',
  sim.rocketJump.rise > 3 && sim.rocketJump.alive && sim.rocketJump.hp < 90, sim.rocketJump);
check('all weapons switch + render', sim.allWeapons);
check('15 insane bots stay inside frame budget', sim.simMs < 8, { simMs: sim.simMs });
check('tactical runs prep → live → round end → match end',
  sim.tactical.ended && sim.tactical.states.join() === 'live,over,prep' && sim.tactical.roundsPlayed >= 2, sim.tactical);
check('no respawns inside a tactical round', !sim.tactical.respawnedMidRound);
check('FFA reaches its score limit', sim.ffa.ended && sim.ffa.kills >= 10, sim.ffa);
check('TDM teams + friendly fire off', sim.teams && sim.tdm.ended, { friendlyLogic: sim.teams, ...sim.tdm });
check('gun game starts on the pistol and promotes',
  sim.gungame.start.length === 1 && sim.gungame.start[0] === 'pistol' && sim.gungame.topTier > 0, sim.gungame);
check('no console/page errors', errors.length === 0, errors.slice(0, 3));

await browser.close();
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
