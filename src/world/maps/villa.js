// ============ VILLA — two floors wrapped around an open courtyard ============
// The courtyard is the only long angle on the map; everything else is doorways.
import { Builder, SOFT, HATCH, finishMap, newWorld } from '../mapkit.js';

const HX = 14, HZ = 12;
const G0 = 0, G1 = 3.2;
const F0 = 3.6, F1 = 6.8;
const CX = 4.5, CZ = 3.5;             // courtyard half-extents
const YARD = 25;

export const meta = { id: 'villa', name: 'VILLA', blurb: 'A ring of rooms around an open courtyard.', tint: 'day' };

export function build(scene, quality) {
  const world = newWorld();
  const B = new Builder(scene, world, quality);
  const objectives = [], cameras = [], atkSpawns = [], defSpawns = [], pickups = [];

  B.slab(-YARD - 3, YARD + 3, -YARD - 3, YARD + 3, -2, 2, 'dirt');
  B.slab(-HX - 6, HX + 6, -HZ - 6, HZ + 6, -0.1, 0.1, 'stone', { solid: false });
  B.box(0, 0, -YARD, YARD * 2, 2.8, 0.6, 'stone');
  B.box(0, 0, YARD, YARD * 2, 2.8, 0.6, 'stone');
  B.box(-YARD, 0, 0, 0.6, 2.8, YARD * 2, 'stone');
  B.box(YARD, 0, 0, 0.6, 2.8, YARD * 2, 'stone');
  for (const [x, z, w, d] of [[-19, -13, 4, 2], [18, -14, 2, 4], [-18, 14, 2, 4], [17, 16, 4, 2], [0, -19, 5, 2], [-4, 18, 4, 2]])
    B.box(x, 0, z, w, 1.5, d, 'stone');

  // ---------- shell ----------
  B.slab(-HX, HX, -HZ, HZ, -0.25, 0.27, 'tile');
  B.wallX(-HZ, -HX, HX, G0, G1, 'plaster', { thick: 0.5, openings: [[-1.5, 1.5], [-10, -7, 1.0, 2.3], [7, 10, 1.0, 2.3]] });
  B.wallX(HZ, -HX, HX, G0, G1, 'plaster', { thick: 0.5, openings: [[5, 8], [-9, -6, 1.0, 2.3]] });
  B.wallZ(-HX, -HZ, HZ, G0, G1, 'plaster', { thick: 0.5, openings: [[-3, 0], [5, 8, 1.0, 2.3]] });
  B.wallZ(HX, -HZ, HZ, G0, G1, 'plaster', { thick: 0.5, openings: [[-8, -5, 1.0, 2.3], [2, 5]] });

  // ---------- courtyard walls (interior ring) ----------
  B.wallX(-CZ, -CX, CX, G0, G1, 'soft', { thick: 0.3, openings: [[-1.5, 1.5]], ...SOFT });
  B.wallX(CZ, -CX, CX, G0, G1, 'soft', { thick: 0.3, openings: [[-1.5, 1.5]], ...SOFT });
  B.wallZ(-CX, -CZ, CZ, G0, G1, 'soft', { thick: 0.3, openings: [[-1.2, 1.2]], ...SOFT });
  B.wallZ(CX, -CZ, CZ, G0, G1, 'soft', { thick: 0.3, openings: [[-1.2, 1.2]], ...SOFT });

  // ---------- ground rooms ----------
  B.wallZ(-6.5, -HZ, -CZ, G0, G1, 'soft', { thick: 0.3, openings: [[-8, -5]], ...SOFT });   // kitchen | bar
  B.wallZ(6.5, -HZ, -CZ, G0, G1, 'soft', { thick: 0.3, openings: [[-8, -5]], ...SOFT });    // bar | lounge
  B.wallX(-CZ, -HX, -CX, G0, G1, 'soft', { thick: 0.3, openings: [[-11, -8]], ...SOFT });
  B.wallX(-CZ, CX, HX, G0, G1, 'soft', { thick: 0.3, openings: [[8, 11]], ...SOFT });
  B.wallX(CZ, -HX, -CX, G0, G1, 'soft', { thick: 0.3, openings: [[-10, -7]], ...SOFT });
  B.wallX(CZ, CX, HX, G0, G1, 'soft', { thick: 0.3, openings: [[7, 10]], ...SOFT });

  // the bar counter is split so there is a way past it on both sides
  B.clutter(0, -8.5, [[-2.2, 0, 2.6, 1.05, 0.9, 'wood2'], [2.2, 0, 2.6, 1.05, 0.9, 'wood2'],
                      [-5.0, 1.6, 1.0, 1.9, 2.0, 'wood3'], [5.0, 1.6, 1.0, 1.9, 2.0, 'wood3']]);
  B.clutter(-10, -8, [[0, 0, 2.4, 0.95, 1.1, 'tile'], [1.8, 3, 1.3, 1.8, 1.3, 'metal']]);
  B.clutter(10, -8, [[0, 0, 2.4, 0.9, 1.5, 'wood2'], [-2.6, 3, 1.3, 1.6, 1.3, 'wood3']]);
  B.clutter(-9, 8, [[0, 0, 2.4, 1.0, 1.6, 'wood2'], [3.2, -2, 1.2, 1.8, 1.2, 'wood3']]);
  B.clutter(9, 8, [[0, 0, 2.2, 1.9, 1.3, 'wood3'], [-3.2, 1, 1.3, 1.0, 2.2, 'wood2']]);
  // courtyard fountain
  B.box(0, 0, 0, 2.4, 1.0, 2.4, 'stone');

  // ---------- upper floor: ring, courtyard stays open ----------
  const ring = (x0, x1, z0, z1) => B.slab(x0, x1, z0, z1, G1, 0.4, 'plaster2');
  ring(-HX, HX, -HZ, -CZ - 0.4);
  ring(-HX, HX, CZ + 0.4, HZ);
  // west wing, with a hole cut for the staircase
  ring(-10.0, -CX - 0.4, -CZ - 0.4, CZ + 0.4);
  ring(-HX, -13.0, -CZ - 0.4, CZ + 0.4);
  ring(-13.0, -10.0, 2.1, CZ + 0.4);
  ring(CX + 0.4, HX, -CZ - 0.4, CZ + 0.4);
  B.slab(-12, -8.5, -10, -6.5, G1, 0.4, 'hatch', HATCH);
  B.slab(8.5, 12, 6, 9.5, G1, 0.4, 'hatch', HATCH);

  B.stairs(-11.5, -1, '+z', G0, F0, 2.6, 6.2, 'stone');

  B.wallX(-HZ, -HX, HX, F0, F1, 'plaster', { thick: 0.5, openings: [[-9, -6.2, 4.6, 5.9], [6, 8.8, 4.6, 5.9]] });
  B.wallX(HZ, -HX, HX, F0, F1, 'plaster', { thick: 0.5, openings: [[-8, -5.2, 4.6, 5.9], [5, 7.8, 4.6, 5.9]] });
  B.wallZ(-HX, -HZ, HZ, F0, F1, 'plaster', { thick: 0.5, openings: [[-5, -2.2, 4.6, 5.9], [3, 6, 4.6, 5.9]] });
  B.wallZ(HX, -HZ, HZ, F0, F1, 'plaster', { thick: 0.5, openings: [[-6, -3.2, 4.6, 5.9], [3, 6, 4.6, 5.9]] });
  // courtyard balcony railings
  B.wallX(-CZ - 0.4, -CX - 0.4, CX + 0.4, F0, F0 + 1.0, 'stone', { thick: 0.25, noBarricade: true });
  B.wallX(CZ + 0.4, -CX - 0.4, CX + 0.4, F0, F0 + 1.0, 'stone', { thick: 0.25, noBarricade: true });
  B.wallZ(-CX - 0.4, -CZ - 0.4, CZ + 0.4, F0, F0 + 1.0, 'stone', { thick: 0.25, noBarricade: true });
  B.wallZ(CX + 0.4, -CZ - 0.4, CZ + 0.4, F0, F0 + 1.0, 'stone', { thick: 0.25, noBarricade: true });
  // upstairs rooms
  B.wallZ(-6.5, -HZ, -CZ, F0, F1, 'soft', { thick: 0.3, openings: [[-8, -5]], ...SOFT });
  B.wallZ(6.5, -HZ, -CZ, F0, F1, 'soft', { thick: 0.3, openings: [[-8, -5]], ...SOFT });
  B.wallZ(-6.5, CZ, HZ, F0, F1, 'soft', { thick: 0.3, openings: [[6, 9]], ...SOFT });
  B.wallZ(6.5, CZ, HZ, F0, F1, 'soft', { thick: 0.3, openings: [[6, 9]], ...SOFT });

  B.box(0, F0, 9, 3.6, 0.85, 4.2, 'carpet');       // master bed
  B.box(-4, F0, 11, 1.4, 1.8, 1.6, 'wood3');
  B.box(-10, F0, -8, 3.0, 0.9, 1.6, 'wood2');
  B.box(10, F0, -8, 2.6, 1.8, 1.4, 'wood3');
  B.box(11, F0, 8, 2.4, 0.9, 2.4, 'tile');

  B.slab(-HX - 0.7, HX + 0.7, -HZ - 0.7, -CZ - 0.4, F1, 0.4, 'roof');
  B.slab(-HX - 0.7, HX + 0.7, CZ + 0.4, HZ + 0.7, F1, 0.4, 'roof');
  B.slab(-HX - 0.7, -CX - 0.4, -CZ - 0.4, CZ + 0.4, F1, 0.4, 'roof');
  B.slab(CX + 0.4, HX + 0.7, -CZ - 0.4, CZ + 0.4, F1, 0.4, 'roof');

  objectives.push(
    { id: 'A', name: 'MASTER SUITE', x: 0, y: F0 + 0.1, z: 8.5, r: 4.8, floor: 1 },
    { id: 'B', name: 'BAR', x: 0, y: G0 + 0.1, z: -8, r: 4.8, floor: 0 },
  );
  cameras.push(
    { id: 1, name: 'FRONT ARCH', x: 0, y: 2.7, z: -12.6, yaw: Math.PI, pitch: -0.15 },
    { id: 2, name: 'COURTYARD', x: 0, y: 2.9, z: 0, yaw: 0, pitch: -0.2 },
    { id: 3, name: 'KITCHEN', x: -13.6, y: 2.7, z: -6, yaw: -Math.PI / 2, pitch: -0.18 },
    { id: 4, name: 'BALCONY', x: 0, y: F0 + 2.4, z: -4.6, yaw: 0, pitch: -0.28 },
  );
  for (const [x, z] of [[-20, -17], [0, -21], [20, -17], [-22, 2], [22, 2], [-16, 18], [2, 20], [18, 16]])
    atkSpawns.push({ x, y: 0.2, z });
  for (const [x, y, z] of [
    [0, F0, 8], [-3, F0, 10], [3, F0, 10], [0, F0, 5],
    [0, G0, -8], [-4, G0, -9], [4, G0, -9], [0, G0, -5],
    [-10, G0, -7], [10, G0, -7], [-10, G0, 8], [10, G0, 8],
  ]) defSpawns.push({ x, y: y + 0.2, z });
  pickups.push(
    { type: 'health', x: -10, y: G0, z: 8 }, { type: 'health', x: 10, y: F0, z: -8 },
    { type: 'ammo', x: 0, y: G0, z: 6 }, { type: 'ammo', x: -11, y: F0, z: 0 },
  );

  return finishMap(B, world, scene, quality, {
    name: meta.name, tint: meta.tint, bounds: YARD, objectives, cameras, atkSpawns, defSpawns, pickups,
  });
}
