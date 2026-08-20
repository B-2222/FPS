// ============ DEPOT — industrial, one floor plus a mezzanine ============
// Container aisles and workshop bays: everything is a corner, nothing is a lane.
import { Builder, SOFT, HATCH, finishMap, newWorld } from '../mapkit.js';

const HX = 16, HZ = 12;
const G0 = 0, G1 = 3.6;
const M0 = 4.0, M1 = 6.8;             // mezzanine
const YARD = 27;

export const meta = { id: 'depot', name: 'DEPOT', blurb: 'Container aisles, a workshop and a mezzanine overhead.', tint: 'night' };

export function build(scene, quality) {
  const world = newWorld();
  const B = new Builder(scene, world, quality);
  const objectives = [], cameras = [], atkSpawns = [], defSpawns = [], pickups = [];

  // ---------- yard ----------
  B.slab(-YARD - 3, YARD + 3, -YARD - 3, YARD + 3, -2, 2, 'concrete');
  B.slab(-HX - 8, HX + 8, -HZ - 8, HZ + 8, -0.1, 0.1, 'dirt', { solid: false });
  B.box(0, 0, -YARD, YARD * 2, 3.4, 0.6, 'fence');
  B.box(0, 0, YARD, YARD * 2, 3.4, 0.6, 'fence');
  B.box(-YARD, 0, 0, 0.6, 3.4, YARD * 2, 'fence');
  B.box(YARD, 0, 0, 0.6, 3.4, YARD * 2, 'fence');
  // stacked containers outside
  for (const [x, z, rot] of [[-21, -14, 0], [21, -12, 1], [-20, 12, 1], [20, 15, 0], [0, -20, 0], [-6, 19, 0]]) {
    const w = rot ? 2.6 : 6.4, d = rot ? 6.4 : 2.6;
    B.box(x, 0, z, w, 2.6, d, 'red');
    if (Math.abs(x) > 18) B.box(x, 2.6, z, w, 2.6, d, 'blue');
  }

  // ---------- shell ----------
  B.slab(-HX, HX, -HZ, HZ, -0.25, 0.27, 'concrete');
  B.wallX(-HZ, -HX, HX, G0, G1, 'metal2', { thick: 0.5, openings: [[-9, -5.5], [3, 6.5], [10, 13, 1.2, 2.6]] });
  B.wallX(HZ, -HX, HX, G0, G1, 'metal2', { thick: 0.5, openings: [[-6, -2.5], [8, 11, 1.2, 2.6]] });
  B.wallZ(-HX, -HZ, HZ, G0, G1, 'metal2', { thick: 0.5, openings: [[-4, 0], [5, 8, 1.2, 2.6]] });
  B.wallZ(HX, -HZ, HZ, G0, G1, 'metal2', { thick: 0.5, openings: [[-8, -5, 1.2, 2.6], [2, 5.5]] });

  // ---------- interior partitions ----------
  // server room (east) — the walls that matter are reinforceable soft panels
  B.wallZ(6.5, -HZ, 2.5, G0, G1, 'soft', { thick: 0.3, openings: [[-8.5, -5.5]], ...SOFT });
  B.wallX(2.5, 6.5, HX, G0, G1, 'soft', { thick: 0.3, openings: [[10, 13]], ...SOFT });
  // workshop (west)
  B.wallZ(-6.5, -HZ, 3, G0, G1, 'soft', { thick: 0.3, openings: [[-6, -3]], ...SOFT });
  B.wallX(3, -HX, -6.5, G0, G1, 'soft', { thick: 0.3, openings: [[-13, -10]], ...SOFT });
  // offices along the north
  B.wallX(5.5, -6.5, 6.5, G0, G1, 'soft', { thick: 0.3, openings: [[-4, -1], [2.5, 5]], ...SOFT });
  B.wallZ(0, 5.5, HZ, G0, G1, 'soft', { thick: 0.3, openings: [[7, 10]], ...SOFT });

  // container aisles in the middle — hard cover, tight corners
  for (const [x, z, rot] of [[-2.5, -7, 1], [1.5, -3, 0], [-3, 1, 0], [3.5, 0.5, 1]]) {
    const w = rot ? 2.4 : 5.2, d = rot ? 5.2 : 2.4;
    B.box(x, 0, z, w, 2.5, d, rot ? 'blue' : 'green');
  }
  B.clutter(-11, -6, [[0, 0, 3.6, 1.1, 1.8, 'metal'], [2.6, 3.4, 1.4, 1.9, 1.4, 'metal2'], [-2.4, 2.6, 1.2, 1.3, 2.6, 'metal']]);
  B.clutter(11, -7, [[0, 0, 2.2, 1.9, 2.2, 'metal2'], [-2.6, 2.4, 3.2, 1.0, 1.4, 'metal'], [2.4, 3.4, 1.6, 2.2, 1.6, 'metal2']]);
  B.clutter(10, 8, [[0, 0, 3.0, 0.95, 1.6, 'wood2'], [-3, -1.4, 1.4, 1.7, 1.4, 'metal']]);
  B.clutter(-11, 8, [[0, 0, 2.6, 2.2, 2.6, 'metal2'], [3.2, 1, 1.4, 1.2, 3.2, 'metal']]);

  // ---------- mezzanine over the east half ----------
  B.slab(1.5, HX, -HZ, HZ, G1, 0.4, 'metal');
  B.slab(-HX, 1.5, -HZ, -8.5, G1, 0.4, 'metal');
  B.slab(9, 12.5, -7, -3.5, G1, 0.4, 'hatch', HATCH);       // hatch into the server room
  B.slab(-4.5, -1, -5, -1.5, G1, 0.4, 'hatch', HATCH);      // hatch into the aisles (edge of slab)
  B.stairs(-1, -10, '+x', G0, M0, 2.6, 6.0, 'metal');
  // mezzanine railings + a couple of offices up top
  B.wallZ(1.5, -HZ, HZ, M0, M0 + 1.0, 'metal2', { thick: 0.2, openings: [[-11, -8]] });
  B.wallX(-4, 1.5, HX, M0, M1, 'soft', { thick: 0.3, openings: [[6, 9]], ...SOFT });
  B.wallX(4.5, 1.5, HX, M0, M1, 'soft', { thick: 0.3, openings: [[10, 13]], ...SOFT });
  B.box(11, M0, -8, 2.6, 0.95, 1.4, 'wood2');
  B.box(6, M0, 1, 1.6, 1.9, 1.6, 'metal2');
  B.box(12, M0, 8, 2.2, 1.2, 2.6, 'metal');

  // ---------- roof ----------
  B.slab(-HX - 0.6, HX + 0.6, -HZ - 0.6, HZ + 0.6, M1, 0.45, 'metal2');

  objectives.push(
    { id: 'A', name: 'SERVER ROOM', x: 11, y: G0 + 0.1, z: -6, r: 4.8, floor: 0 },
    { id: 'B', name: 'WORKSHOP', x: -11, y: G0 + 0.1, z: -5, r: 4.8, floor: 0 },
  );
  cameras.push(
    { id: 1, name: 'LOADING BAY', x: -7, y: 3.0, z: -12.6, yaw: Math.PI, pitch: -0.18 },
    { id: 2, name: 'AISLES', x: 0, y: 3.1, z: 0, yaw: -Math.PI / 2, pitch: -0.25 },
    { id: 3, name: 'EAST DOOR', x: 15.6, y: 3.0, z: 4, yaw: Math.PI / 2, pitch: -0.15 },
    { id: 4, name: 'MEZZANINE', x: 8, y: M0 + 2.2, z: -2, yaw: Math.PI, pitch: -0.3 },
  );
  for (const [x, z] of [[-22, -18], [0, -23], [22, -18], [-24, 3], [24, 2], [-18, 20], [3, 22], [20, 19]])
    atkSpawns.push({ x, y: 0.2, z });
  for (const [x, y, z] of [
    [11, G0, -4], [13, G0, -8], [8, G0, -7], [12, G0, 0],
    [-11, G0, -3], [-13, G0, -7], [-9, G0, -8], [-12, G0, 1],
    [0, G0, 6], [6, G0, 8], [10, M0, -6], [4, M0, 4],
  ]) defSpawns.push({ x, y: y + 0.2, z });
  pickups.push(
    { type: 'health', x: -12, y: G0, z: 8 }, { type: 'health', x: 12, y: M0, z: 8 },
    { type: 'ammo', x: 0, y: G0, z: 8 }, { type: 'ammo', x: 6, y: M0, z: -8 },
  );

  return finishMap(B, world, scene, quality, {
    name: meta.name, tint: meta.tint, bounds: YARD, objectives, cameras, atkSpawns, defSpawns, pickups,
  });
}
