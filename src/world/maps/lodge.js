// ============ LODGE — a tight two-storey house ============
// Rooms are small, corridors are narrow and every room has at least two ways in.
// Sight lines rarely exceed 12 m, which is what makes shotguns and knives work.
import { Builder, SOFT, HATCH, finishMap, newWorld } from '../mapkit.js';

const HX = 15, HZ = 11;               // building half-extents
const G0 = 0, G1 = 3.2;               // ground floor
const F0 = 3.6, F1 = 6.8;             // upper floor
const YARD = 26;

export const meta = { id: 'lodge', name: 'LODGE', blurb: 'Two floors, tight halls, four ways in.', tint: 'dusk' };

export function build(scene, quality) {
  const world = newWorld();
  const B = new Builder(scene, world, quality);
  const objectives = [], cameras = [], atkSpawns = [], defSpawns = [], pickups = [];

  // ---------- ground & yard ----------
  B.slab(-YARD - 3, YARD + 3, -YARD - 3, YARD + 3, -2, 2, 'grass');
  B.slab(-HX - 6, HX + 6, -HZ - 7, HZ + 6, -0.1, 0.1, 'path', { solid: false });
  for (const [x, z, w, d] of [[-YARD, -YARD, YARD * 2, 0.6], [YARD, -YARD, YARD * 2, 0.6]])
    B.box(0, 0, x < 0 ? -YARD : YARD, YARD * 2, 3.2, 0.6, 'fence');
  B.box(-YARD, 0, 0, 0.6, 3.2, YARD * 2, 'fence');
  B.box(YARD, 0, 0, 0.6, 3.2, YARD * 2, 'fence');
  // exterior cover — attackers need somewhere to stage
  for (const [x, z, w, h, d, m] of [
    [-20, -16, 4, 1.5, 2, 'concrete'], [19, -15, 2, 1.5, 4, 'concrete'],
    [-19, 15, 2, 1.5, 5, 'concrete'], [17, 17, 4, 1.5, 2, 'concrete'],
    [0, -18, 5, 1.4, 2, 'wood2'], [-9, 17, 2, 1.4, 4, 'wood2'], [9, 16, 3, 2, 3, 'wood2'],
  ]) B.box(x, 0, z, w, h, d, m);

  // ---------- shell ----------
  B.slab(-HX, HX, -HZ, HZ, -0.25, 0.27, 'wood');
  // south face: front door + two windows
  B.wallX(-HZ, -HX, HX, G0, G1, 'brick', { thick: 0.5, openings: [[-1.6, 1.6], [-11, -8, 1.0, 2.3], [7, 10, 1.0, 2.3]] });
  // north face: back door + window
  B.wallX(HZ, -HX, HX, G0, G1, 'brick', { thick: 0.5, openings: [[5.5, 8.5], [-10, -7, 1.0, 2.3]] });
  // west: garage opening
  B.wallZ(-HX, -HZ, HZ, G0, G1, 'brick', { thick: 0.5, openings: [[-7, -2.5], [4, 7, 1.0, 2.3]] });
  // east: side door + window
  B.wallZ(HX, -HZ, HZ, G0, G1, 'brick', { thick: 0.5, openings: [[-2, 1], [5, 8, 1.0, 2.3]] });

  // ---------- ground interior ----------
  // garage | kitchen divider
  B.wallZ(-5.5, -HZ, -1.5, G0, G1, 'soft', { thick: 0.3, openings: [[-7.5, -4.5]], ...SOFT });
  // kitchen | living divider
  B.wallZ(4.5, -HZ, -1.5, G0, G1, 'soft', { thick: 0.3, openings: [[-6, -3]], ...SOFT });
  // main hall wall (south side)
  B.wallX(-1.5, -HX, HX, G0, G1, 'soft', { thick: 0.3, openings: [[-13, -10], [-1, 2], [9, 12]], ...SOFT });
  // hall | north rooms
  B.wallX(2.2, -HX, -3.2, G0, G1, 'soft', { thick: 0.3, openings: [[-12, -9]], ...SOFT });
  B.wallX(2.2, 3.2, HX, G0, G1, 'soft', { thick: 0.3, openings: [[9, 12]], ...SOFT });
  // storage | stairwell
  // stairwell walls are ground-floor only — upstairs the landing opens onto the hall
  B.wallZ(-3.2, 2.2, HZ, G0, G1, 'plaster', { thick: 0.3, openings: [[3, 6]] });
  B.wallZ(3.2, 2.2, HZ, G0, G1, 'plaster', { thick: 0.3, openings: [[3, 6]] });

  // kitchen fittings, garage clutter, living-room furniture
  // furniture is deliberately small: a counter that spans a room seals it off
  B.clutter(-1, -7.5, [[-1.4, 0, 2.2, 0.95, 0.9, 'tile'], [1.6, 0, 1.8, 0.95, 0.9, 'tile'],
                       [-4.2, 2.2, 0.9, 0.95, 1.8, 'tile'], [3.2, 2.6, 1.1, 1.8, 1.1, 'metal']]);
  B.clutter(-10.5, -6, [[0, 0, 2.4, 1.3, 1.6, 'metal'], [2.6, 3.4, 1.4, 2.1, 1.4, 'wood2'], [-2.6, -2, 1.3, 1.4, 1.3, 'wood2']]);
  B.clutter(10, -6.5, [[0, 0, 2.6, 0.85, 1.5, 'wood2'], [3, 3.4, 1.6, 1.0, 2.0, 'wood2'], [-2.4, 3, 1.2, 1.7, 1.2, 'wood2']]);
  B.clutter(-9, 6, [[0, 0, 2.6, 0.9, 1.6, 'wood2'], [3, -1.4, 1.2, 1.8, 1.2, 'metal']]);
  B.clutter(9.5, 6.5, [[0, 0, 2.2, 1.9, 1.3, 'metal'], [-3.2, 1, 1.4, 1.0, 2.0, 'wood2']]);

  // ---------- ceiling / upper floor, with two hatches ----------
  B.slab(-HX, -3.4, -HZ, HZ, G1, 0.4, 'plaster2');
  B.slab(3.4, HX, -HZ, HZ, G1, 0.4, 'plaster2');
  B.slab(-3.4, 3.4, -HZ, -2.4, G1, 0.4, 'plaster2');
  B.slab(-3.4, 3.4, 5.6, HZ, G1, 0.4, 'plaster2');
  B.slab(-11, -7.5, -9, -5.5, G1, 0.4, 'hatch', HATCH);      // hatch into the kitchen-side room
  B.slab(7.5, 11, 4, 7.5, G1, 0.4, 'hatch', HATCH);          // hatch into the north-east room

  // ---------- stairs ----------
  B.stairs(0, -0.4, '+z', G0, F0, 3.0, 6.6, 'wood2');
  B.slab(-3.4, 3.4, 2.9, 5.6, G1, 0.4, 'plaster2');           // landing

  // ---------- upper floor ----------
  B.wallX(-HZ, -HX, HX, F0, F1, 'brick', { thick: 0.5, openings: [[-10, -7.2, 4.7, 6.0], [7, 9.8, 4.7, 6.0]] });
  B.wallX(HZ, -HX, HX, F0, F1, 'brick', { thick: 0.5, openings: [[-9, -6.2, 4.7, 6.0], [6, 8.8, 4.7, 6.0]] });
  B.wallZ(-HX, -HZ, HZ, F0, F1, 'brick', { thick: 0.5, openings: [[-6, -3.2, 4.7, 6.0], [3, 6, 4.7, 6.0]] });
  B.wallZ(HX, -HZ, HZ, F0, F1, 'brick', { thick: 0.5, openings: [[-5, -2.2, 4.7, 6.0], [4, 7, 4.7, 6.0]] });

  B.wallZ(-4.5, -HZ, 2.6, F0, F1, 'soft', { thick: 0.3, openings: [[-6.5, -3.5]], ...SOFT });   // master | landing
  B.wallZ(4.5, -HZ, 2.6, F0, F1, 'soft', { thick: 0.3, openings: [[-6, -3]], ...SOFT });        // office | landing
  B.wallX(-2.5, -HX, -4.5, F0, F1, 'soft', { thick: 0.3, openings: [[-12, -9]], ...SOFT });     // master split
  B.wallZ(-4.5, 5.4, HZ, F0, F1, 'soft', { thick: 0.3, openings: [[6.5, 9.5]], ...SOFT });      // bathroom
  B.wallZ(4.5, 5.4, HZ, F0, F1, 'soft', { thick: 0.3, openings: [[6, 9]], ...SOFT });
  B.wallX(5.4, -4.5, 4.5, F0, F1, 'soft', { thick: 0.3, openings: [[-1.5, 1.5]], ...SOFT });    // landing → north

  B.box(-12.4, F0, -6.5, 2.8, 0.85, 4.2, 'carpet');   // bed — off the objective, against the west wall
  B.box(-13, F0, -1, 1.2, 1.8, 2.4, 'wood2');
  B.box(10, F0, -6.5, 3.2, 0.95, 1.6, 'wood2');       // desk
  B.box(12.5, F0, -1, 1.6, 1.9, 1.6, 'metal');
  B.box(-9, F0, 8, 2.4, 0.9, 2.4, 'tile');
  B.box(9, F0, 8, 2.8, 0.85, 3.4, 'carpet');
  // landing railing
  B.box(-3.4, F0, 4.2, 0.25, 1.0, 2.6, 'wood2');
  B.box(3.4, F0, 4.2, 0.25, 1.0, 2.6, 'wood2');

  // ---------- roof ----------
  B.slab(-HX - 0.7, HX + 0.7, -HZ - 0.7, HZ + 0.7, F1, 0.4, 'roof');
  B.slab(-HX + 1.6, HX - 1.6, -HZ + 1.6, HZ - 1.6, F1 + 0.4, 0.5, 'roof');
  B.slab(-HX + 4, HX - 4, -HZ + 4, HZ - 4, F1 + 0.9, 0.55, 'roof');
  B.box(9, F1 + 0.4, 5, 1.5, 2.6, 1.5, 'brick2');

  objectives.push(
    { id: 'A', name: 'MASTER BEDROOM', x: -10, y: F0 + 0.1, z: -5, r: 5.0, floor: 1 },
    { id: 'B', name: 'KITCHEN', x: -0.5, y: G0 + 0.1, z: -6.5, r: 5.0, floor: 0 },
  );
  cameras.push(
    { id: 1, name: 'FRONT PORCH', x: 0, y: 2.7, z: -11.6, yaw: Math.PI, pitch: -0.15 },
    { id: 2, name: 'GARAGE', x: -14.4, y: 2.6, z: -5, yaw: -Math.PI / 2, pitch: -0.15 },
    { id: 3, name: 'HALL', x: 0, y: 2.8, z: 1.9, yaw: Math.PI, pitch: -0.25 },
    { id: 4, name: 'LANDING', x: 0, y: F0 + 2.6, z: 2.6, yaw: Math.PI, pitch: -0.3 },
  );
  for (const [x, z] of [[-21, -19], [0, -21], [21, -19], [-22, 4], [22, 3], [-16, 19], [4, 21], [19, 17]])
    atkSpawns.push({ x, y: 0.2, z });
  for (const [x, y, z] of [
    [-11, F0, -3], [-8, F0, -8], [-13, F0, -8], [-6, F0, 0],
    [-1, G0, -8], [-3, G0, -4], [2, G0, -9], [-4, G0, -6],
    [8, G0, -6], [-9, G0, 6], [9, G0, 6], [0, F0, 4.5],
  ]) defSpawns.push({ x, y: y + 0.2, z });
  pickups.push(
    { type: 'health', x: -9, y: G0, z: 6 }, { type: 'health', x: 10, y: F0, z: 8 },
    { type: 'ammo', x: 0, y: G0, z: 0 }, { type: 'ammo', x: 0, y: F0, z: 1 },
  );

  return finishMap(B, world, scene, quality, {
    name: meta.name, tint: meta.tint, bounds: YARD, objectives, cameras, atkSpawns, defSpawns, pickups,
  });
}
