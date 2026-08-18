/**
 * Headless smoke test — boots the game in Chromium, runs real matches at
 * accelerated speed and asserts the systems that matter still work.
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
  results.push({ name, pass, detail });
  if (!pass) failures++;
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? `  → ${JSON.stringify(detail)}` : ''}`);
}

const launchOpts = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const booted = await page.evaluate(() => !!window.__game && document.getElementById('loading').classList.contains('hidden'));
check('boots and builds the arena', booted);

const world = await page.evaluate(() => ({ boxes: window.__game.world.boxes.length, nav: window.__game.nav.nodes.length }));
check('world + navmesh built', world.boxes > 100 && world.nav > 800, world);

await page.click('#btn-play');
await page.waitForTimeout(1500);

const sim = await page.evaluate(async () => {
  const g = window.__game;
  const { stepMovement } = window.__mv;
  const out = {};
  const put = (x, y, z, yaw = 0) => {
    g.player.pos.set(x, y, z); g.player.vel.set(0, 0, 0); g.player.yaw = yaw;
    g.player.alive = true; g.player.health = 100; g.player.height = 1.82;
  };
  const walk = (n, cmd) => { let peak = -99; for (let i = 0; i < n; i++) { stepMovement(g.player, cmd, 1 / 60, g.world, g); peak = Math.max(peak, g.player.pos.y); } return peak; };
  const FWD = { forward: 1, strafe: 0, jump: false, sprint: true, crouch: false };

  // --- traversal: every level of the map has to be reachable on foot ---
  put(27, 0.2, 7, Math.PI / 2);  out.coreRoof = walk(200, FWD) > 5.5;
  put(11, 5.95, 0, Math.PI / 2); out.coreTier = walk(120, FWD) > 7.5;
  put(0, 7.95, 8, 0);            out.sniperTower = walk(180, { ...FWD, sprint: false }) > 10.4;
  put(0, 0.2, 27, Math.PI);      out.catwalk = walk(200, FWD) > 5.5;
  put(13, 0.2, 33, -Math.PI / 2); out.bunkerRoof = walk(160, FWD) > 5.5;
  put(0, 0.2, 50, Math.PI);      walk(200, FWD); out.wallsStop = g.player.pos.z < 57.5;

  // --- crouch / stand ---
  put(12, 0.2, 30);
  walk(40, { forward: 0, strafe: 0, jump: false, sprint: false, crouch: true });
  const crouched = g.player.height;
  walk(80, { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false });
  out.crouch = crouched < 1.3 && g.player.height > 1.75;

  // --- jump pad reaches the catwalk ring ---
  { const jp = g.jumpPads[0]; put(jp.x, 0.05, jp.z); g.player.grounded = true;
    let peak = 0; for (let i = 0; i < 150; i++) { g.update(1 / 60); peak = Math.max(peak, g.player.pos.y); }
    out.jumpPad = peak >= 6; }

  // --- rocket jump: launches you and hurts, but doesn't kill from full health ---
  { put(12, 0.2, 40); g.player.pitch = -1.45;
    for (let i = 0; i < 8; i++) g.update(1 / 60);
    g.player.arsenal.give('rocket', true); g.player.arsenal.select('rocket', true);
    g.player.arsenal.fireTimer = 0; g.player.arsenal.ammo.mag = 1; g.player.health = 100;
    const y0 = g.player.pos.y; g.player.fire();
    let peak = y0; for (let i = 0; i < 150; i++) { g.update(1 / 60); peak = Math.max(peak, g.player.pos.y); }
    out.rocketJump = { rise: +(peak - y0).toFixed(1), hp: Math.round(g.player.health), alive: g.player.alive }; }

  // --- walls stop bullets ---
  { const bot = g.bots[0]; bot.alive = true; bot.health = 1000; bot.maxHealth = 1000;
    put(9.5, 0.2, 22, 0); bot.pos.set(9.5, 0.2, 2);
    g.player.arsenal.select('rifle', true);
    const h0 = bot.health;
    for (let i = 0; i < 6; i++) { g.player.arsenal.fireTimer = 0; g.player.recoilPitch = 0; g.player.fire(); g.update(1 / 60); }
    out.wallsStopBullets = bot.health === h0;
    bot.maxHealth = 100; bot.health = 100; }

  // --- the player can kill a bot, and it respawns ---
  { const v = g.bots[0];
    put(12, 0.2, 30, 0); v.alive = true; v.health = 100;
    g.player.arsenal.select('rifle', true);
    const k0 = g.player.kills;
    for (let i = 0; i < 14 && v.alive; i++) {
      v.pos.set(12, 0.2, 18); v.vel.set(0, 0, 0);
      const dy = (v.pos.y + v.height * 0.55) - g.player.eyeY;
      g.player.yaw = 0; g.player.pitch = Math.atan2(dy, 12);
      g.player.recoilPitch = 0; g.player.arsenal.fireTimer = 0;
      g.player.fire(); g.update(1 / 60);
    }
    out.playerKill = !v.alive && g.player.kills === k0 + 1;
    let w = 0; while (!v.alive && w < 60 * 8) { g.update(1 / 60); w++; }
    out.botRespawn = v.alive; }

  // --- every weapon selects and builds a viewmodel ---
  { const ids = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'revolver', 'lmg', 'rocket'];
    const bad = [];
    for (const id of ids) {
      g.player.arsenal.give(id, true); g.player.arsenal.select(id, true);
      for (let i = 0; i < 3; i++) g.update(1 / 60);
      g.render();
      if (g.viewModel.id !== id) bad.push(id);
    }
    out.allWeapons = bad.length === 0; }

  // --- simulation cost with a full lobby of the hardest bots ---
  { g.startMatch({ mode: 'ffa', bots: 15, difficulty: 'insane', scoreLimit: 50, timeLimit: 600 });
    for (let i = 0; i < 60; i++) g.update(1 / 60);          // warm up
    const t = performance.now();
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    out.simMs = +((performance.now() - t) / 120).toFixed(2); }

  // --- bots fight: run an FFA to its score limit ---
  { let ended = null;
    g.onMatchEnd = r => { ended = r; };
    g.startMatch({ mode: 'ffa', bots: 8, difficulty: 'normal', scoreLimit: 10, timeLimit: 600 });
    let f = 0;
    while (!ended && f < 60 * 60 * 8) { g.update(1 / 60); f++; }
    out.ffa = { ended: !!ended, simSec: Math.round(f / 60), kills: g.actors.reduce((s, a) => s + a.kills, 0) }; }

  // --- team deathmatch ---
  { let ended = null;
    g.onMatchEnd = r => { ended = r; };
    g.startMatch({ mode: 'tdm', bots: 8, difficulty: 'normal', scoreLimit: 12, timeLimit: 600 });
    const mate = g.bots.find(b => b.team === 0), foe = g.bots.find(b => b.team === 1);
    out.teams = g.friendly(g.player, mate) && !g.friendly(g.player, foe);
    let f = 0;
    while (!ended && f < 60 * 60 * 8) { g.update(1 / 60); f++; }
    out.tdm = { ended: !!ended, scores: [g.teamScore(0), g.teamScore(1)] }; }

  // --- gun game hands everyone the first rung and promotes on kills ---
  { g.startMatch({ mode: 'gungame', bots: 6, difficulty: 'hard', scoreLimit: 30, timeLimit: 600 });
    const start = new Set(g.actors.map(a => a.arsenal.current));
    let f = 0, top = 0;
    while (f < 60 * 90) { g.update(1 / 60); f++; top = Math.max(top, ...g.actors.map(a => a.gunGameTier)); }
    out.gungame = { start: [...start], topTier: top }; }

  return out;
});

check('core roof reachable', sim.coreRoof);
check('core second tier reachable', sim.coreTier);
check('sniper tower reachable', sim.sniperTower);
check('catwalk reachable', sim.catwalk);
check('bunker roof reachable', sim.bunkerRoof);
check('perimeter walls are solid', sim.wallsStop);
check('crouch and stand back up', sim.crouch);
check('jump pad reaches the catwalk ring', sim.jumpPad);
check('rocket jump launches without suiciding', sim.rocketJump.rise > 4 && sim.rocketJump.alive && sim.rocketJump.hp < 90, sim.rocketJump);
check('walls stop bullets', sim.wallsStopBullets);
check('player can kill a bot', sim.playerKill);
check('killed bots respawn', sim.botRespawn);
check('all weapons switch + render', sim.allWeapons);
check('15 insane bots stay inside frame budget', sim.simMs < 8, { simMs: sim.simMs });
check('FFA reaches its score limit', sim.ffa.ended && sim.ffa.kills >= 10, sim.ffa);
check('TDM teams + friendly fire off', sim.teams && sim.tdm.ended, sim.tdm);
check('gun game starts on the pistol and promotes', sim.gungame.start.length === 1 && sim.gungame.start[0] === 'pistol' && sim.gungame.topTier > 0, sim.gungame);
check('no console/page errors', errors.length === 0, errors.slice(0, 3));

await browser.close();
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
