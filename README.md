# OVERCLOCK — arena FPS

A fast browser shooter with bots that actually hunt you: they path through the map, take
cover, strafe, reload behind walls, chase health packs, lead their shots and fight each
other when you're not around. Eight weapons, three modes, a multi-level arena, no assets to
download and no build step.

![menu](docs/menu.png)

## Run it

```bash
npm start          # → http://localhost:8080
```

That's it — `serve.js` is a dependency-free static server, and Three.js is vendored in
`vendor/`, so the game works completely offline. (`npm install` is only needed if you want
to run the tests or update Three.js.)

You need a local server rather than opening `index.html` directly, because the game is
built from ES modules.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump — chain them to bunny-hop and keep your speed |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch — hold while sprinting to slide |
| `Mouse 1` | Fire |
| `Mouse 2` | Aim down sights (scopes the sniper) |
| `R` | Reload |
| `1`–`8`, wheel | Switch weapon |
| `Q` | Quick-swap to your last weapon |
| `E` | Pick up the weapon you're standing on |
| `F` | Quick knife |
| `Tab` | Scoreboard |
| `Esc` | Pause |

## Weapons

Every gun has its own recoil pattern, spread behaviour, damage falloff, reload style and
movement penalty. Headshots do double damage (2.4× on the sniper), limbs do 0.85×.

| Weapon | Class | Damage | RPM | Mag | Notes |
| --- | --- | --- | --- | --- | --- |
| TR-9 Rifle | Assault | 24 | 660 | 30 | The all-rounder; climbing recoil through the spray |
| Wasp SMG | Submachine | 16 | 1020 | 34 | Fastest movement, falls off hard past 18 m |
| Breach-12 | Shotgun | 11.5 × 9 | 78 | 6 | Shell-by-shell reload you can interrupt |
| Longshot | Sniper | 92 | 48 | 5 | Scoped, near-zero spread when aimed, huge hipfire cone |
| Sidearm P7 | Pistol | 27 | 420 | 15 | Semi-auto, quickest swap |
| Magnum .44 | Hand cannon | 61 | 165 | 6 | Two-tap body shots, heavy kick |
| Hailstorm | Heavy | 21 | 820 | 80 | 80-round belt, slow to carry and slow to reload |
| Skybreaker | Explosive | 42 + 82 splash | 55 | 1 | Rocket jumps: aim down, fire, ~8 m of air for ~27 HP |

Guns also lie around the map on lit pads — walk over one and press `E` to take it.
Health (+45), shield (+50, absorbs 72% of incoming damage) and ammo crates respawn on timers.

## Modes

- **Free for all** — first to the score limit.
- **Team deathmatch** — Mint vs Crimson, friendly fire off, bots split across both teams.
- **Gun game** — everyone starts on the pistol and climbs a nine-rung ladder, one kill per
  rung, knife to finish.

Four difficulty tiers change reaction time, aim error, aim settle speed, burst discipline,
field of view, hearing, and how readily bots use cover:

| | Reaction | Aim error | Sight | Uses cover |
| --- | --- | --- | --- | --- |
| Recruit | 0.42–0.78 s | 5.4° | 46 m | rarely |
| Regular | 0.25–0.46 s | 3.0° | 58 m | sometimes |
| Veteran | 0.15–0.27 s | 1.7° | 72 m | often |
| Nightmare | 0.07–0.15 s | 0.85° | 90 m | almost always |

## How the bots work

Bots run the same weapons, ballistics, physics and hitboxes as you do — they aren't cheating
with instant hits or wall vision.

- **Perception** — a vision cone plus line-of-sight raycasts, re-scanned ~7×/second. They
  also hear gunfire within 42 m and snap toward whoever shot them from off-screen.
- **Aim** — the view turns toward a predicted aim point at a capped rate, offset by an error
  angle that grows with distance and target speed and *shrinks the longer they track you*.
  So a bot that has been staring at you for a second is far deadlier than one that just
  spotted you. They only pull the trigger once the muzzle is genuinely on target and the
  line is clear of their own cover.
- **Movement** — A\* over a multi-level nav grid generated from the map geometry (2,600
  nodes; stairs, catwalks and drops are all linked), with straight-line shortcutting, ledge
  probing so they don't walk off catwalks, and stuck detection.
- **Tactics** — they hold a preferred range per weapon (shotguns close, snipers back off),
  strafe, hop, break line of sight to reload, go hunting for health when hurt, pick up guns
  when dry, and rush with the knife.

## Layout

```
index.html          markup for menus + HUD
style.css           all UI styling
serve.js            zero-dependency static server
src/
  main.js           boot, menu wiring, main loop
  core/             input, settings, procedural WebAudio, math helpers
  world/
    collision.js    AABB broadphase, raycasting, swept character movement
    map.js          the arena, built from boxes + a world-space grid shader
    nav.js          nav grid generation and A*
  entities/
    movement.js     shared physics: accel, friction, bhop, air-strafe, slide
    actor.js        health, hitboxes, weapon inventory
    player.js       look, recoil, camera feel, firing
    bot.js          perception → decisions → aim → movement → shooting
    botmodel.js     procedural animated humanoid + nametag
  weapons/          definitions, procedural gun models, viewmodel animation
  game/
    game.js         match flow, spawning, pickups, modes, scoring
    combat.js       ballistics shared by players and bots
  fx/effects.js     particles, tracers, decals, explosions
  ui/               HUD and minimap
test/smoke.mjs      headless integration tests
```

Nothing is loaded from a CDN and there are no image or audio files: the map, weapons,
characters, muzzle flashes and every sound effect are generated in code.

## Tuning

- Weapon stats: `src/weapons/defs.js` — one object per gun, all values live.
- Bot skill: `DIFFICULTY` at the top of `src/entities/bot.js`.
- Movement feel (speed, gravity, jump height, air control): `MOVE` in `src/entities/movement.js`.
- The arena itself: `buildMap()` in `src/world/map.js` — `B.box()` and `B.stairs()` calls,
  with `sym4()` mirroring anything you want on all four sides.

## Tests

```bash
npm install        # once, for Playwright
npm start          # in another shell
npm test
```

The suite boots the real game in headless Chromium and asserts traversal routes, collision,
weapon behaviour, the rocket jump, kill/respawn flow, all three game modes running to
completion, and the simulation frame budget with 15 Nightmare bots.
