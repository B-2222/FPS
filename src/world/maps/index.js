// ============ map registry ============
import * as lodge from './lodge.js';
import * as depot from './depot.js';
import * as villa from './villa.js';

export const MAPS = [lodge, depot, villa];
export const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.meta.id, m]));
export const MAP_META = MAPS.map(m => m.meta);

export function buildMapById(id, scene, quality) {
  const m = MAP_BY_ID[id] || MAPS[0];
  return m.build(scene, quality);
}
export const randomMapId = () => MAPS[Math.floor(Math.random() * MAPS.length)].meta.id;
