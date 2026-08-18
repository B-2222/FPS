// ============ procedural weapon models (boxes + cylinders, zero assets) ============
import * as THREE from 'three';
import { WEAPONS } from './defs.js';

const M = {
  dark:  new THREE.MeshLambertMaterial({ color: 0x24282f }),
  body:  new THREE.MeshLambertMaterial({ color: 0x3a4149 }),
  light: new THREE.MeshLambertMaterial({ color: 0x596471 }),
  grip:  new THREE.MeshLambertMaterial({ color: 0x1a1d22 }),
  steel: new THREE.MeshLambertMaterial({ color: 0x8d97a3 }),
  wood:  new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
  glass: new THREE.MeshLambertMaterial({ color: 0x0b2436 }),
};
const accentCache = new Map();
function accent(hex) {
  if (!accentCache.has(hex)) accentCache.set(hex, new THREE.MeshBasicMaterial({ color: hex }));
  return accentCache.get(hex);
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);

function b(g, x, y, z, w, h, d, mat) {
  const m = new THREE.Mesh(BOX, mat);
  m.position.set(x, y, z); m.scale.set(w, h, d);
  g.add(m); return m;
}
function cyl(g, x, y, z, r, len, mat, axis = 'z', r2 = null) {
  const geo = r2 === null ? CYL : new THREE.CylinderGeometry(r2, r, 1, 12);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(r, len, r);
  if (r2 !== null) m.scale.set(1, len, 1);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  g.add(m); return m;
}

/* Each builder returns a Group whose barrel points down -Z, with .muzzle (local Vector3). */
const BUILD = {
  rifle(g, ac) {
    b(g, 0, 0, 0, 0.085, 0.115, 0.62, M.body);
    b(g, 0, -0.055, 0.11, 0.075, 0.16, 0.13, M.grip);       // pistol grip
    b(g, 0, -0.10, -0.02, 0.07, 0.20, 0.11, M.dark);        // magazine
    b(g, 0, 0.005, 0.30, 0.07, 0.10, 0.22, M.dark);         // stock
    cyl(g, 0, 0.015, -0.44, 0.021, 0.42, M.steel);          // barrel
    b(g, 0, 0.02, -0.30, 0.055, 0.06, 0.26, M.light);       // handguard
    b(g, 0, 0.075, 0.02, 0.03, 0.03, 0.34, M.dark);         // rail
    b(g, 0, 0.10, 0.14, 0.018, 0.05, 0.02, M.steel);        // rear sight
    b(g, 0, 0.10, -0.36, 0.018, 0.05, 0.02, M.steel);       // front post
    b(g, 0.045, 0.02, -0.05, 0.006, 0.03, 0.3, accent(ac)); // accent strip
    b(g, -0.045, 0.02, -0.05, 0.006, 0.03, 0.3, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.66);
  },
  smg(g, ac) {
    b(g, 0, 0, 0, 0.08, 0.12, 0.40, M.body);
    b(g, 0, -0.055, 0.06, 0.07, 0.15, 0.12, M.grip);
    b(g, 0, -0.13, -0.05, 0.055, 0.26, 0.09, M.dark);
    b(g, 0, 0.01, 0.22, 0.05, 0.07, 0.16, M.dark);
    cyl(g, 0, 0.015, -0.28, 0.019, 0.24, M.steel);
    b(g, 0, 0.02, -0.19, 0.05, 0.055, 0.16, M.light);
    b(g, 0, 0.075, -0.02, 0.026, 0.028, 0.22, M.dark);
    b(g, 0.042, 0.0, -0.02, 0.005, 0.05, 0.22, accent(ac));
    b(g, -0.042, 0.0, -0.02, 0.005, 0.05, 0.22, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.41);
  },
  shotgun(g, ac) {
    b(g, 0, 0, 0.02, 0.09, 0.13, 0.50, M.body);
    b(g, 0, -0.05, 0.16, 0.075, 0.15, 0.13, M.wood);
    b(g, 0, 0.0, 0.34, 0.07, 0.11, 0.22, M.wood);
    cyl(g, 0, 0.03, -0.40, 0.032, 0.52, M.steel);            // barrel
    cyl(g, 0, -0.035, -0.36, 0.026, 0.44, M.dark);           // tube mag
    b(g, 0, -0.035, -0.30, 0.085, 0.075, 0.16, M.wood);      // pump
    b(g, 0, 0.075, -0.55, 0.02, 0.03, 0.03, M.steel);
    b(g, 0.05, 0.0, 0.02, 0.006, 0.05, 0.24, accent(ac));
    b(g, -0.05, 0.0, 0.02, 0.006, 0.05, 0.24, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.68);
    g.userData.pump = g.children[5];
  },
  sniper(g, ac) {
    b(g, 0, 0, 0.05, 0.08, 0.11, 0.78, M.body);
    b(g, 0, -0.05, 0.22, 0.07, 0.15, 0.12, M.grip);
    b(g, 0, -0.02, 0.44, 0.075, 0.16, 0.22, M.dark);
    b(g, 0, -0.09, 0.02, 0.06, 0.13, 0.10, M.dark);
    cyl(g, 0, 0.012, -0.62, 0.021, 0.62, M.steel);
    cyl(g, 0, 0.012, -0.94, 0.032, 0.10, M.dark);            // muzzle brake
    cyl(g, 0, 0.115, 0.02, 0.042, 0.34, M.dark);             // scope tube
    cyl(g, 0, 0.115, -0.16, 0.05, 0.05, M.glass);            // objective
    b(g, 0, 0.075, 0.10, 0.03, 0.05, 0.05, M.dark);
    b(g, 0, 0.075, -0.08, 0.03, 0.05, 0.05, M.dark);
    b(g, 0.043, 0.0, -0.1, 0.005, 0.05, 0.4, accent(ac));
    b(g, -0.043, 0.0, -0.1, 0.005, 0.05, 0.4, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.012, -1.02);
    g.userData.bolt = b(g, 0.06, 0.045, 0.16, 0.03, 0.03, 0.12, M.steel);
  },
  pistol(g, ac) {
    b(g, 0, 0.02, -0.02, 0.055, 0.085, 0.30, M.body);
    b(g, 0, -0.09, 0.06, 0.055, 0.19, 0.09, M.grip);
    cyl(g, 0, 0.02, -0.20, 0.014, 0.10, M.steel);
    b(g, 0, 0.07, -0.05, 0.02, 0.02, 0.22, M.dark);
    b(g, 0, 0.075, 0.08, 0.016, 0.03, 0.016, M.steel);
    b(g, 0.03, 0.02, -0.02, 0.004, 0.035, 0.16, accent(ac));
    b(g, -0.03, 0.02, -0.02, 0.004, 0.035, 0.16, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.26);
    g.userData.slide = g.children[0];
  },
  revolver(g, ac) {
    b(g, 0, 0.02, -0.04, 0.045, 0.08, 0.26, M.steel);
    cyl(g, 0, 0.0, 0.02, 0.055, 0.11, M.dark);               // cylinder
    b(g, 0, -0.09, 0.10, 0.055, 0.18, 0.10, M.wood);
    cyl(g, 0, 0.02, -0.22, 0.016, 0.16, M.steel);
    b(g, 0, 0.065, -0.12, 0.015, 0.025, 0.16, M.dark);
    b(g, 0, 0.075, -0.20, 0.014, 0.03, 0.016, M.steel);
    b(g, 0, 0.0, 0.02, 0.115, 0.012, 0.10, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.31);
    g.userData.cyl = g.children[1];
  },
  lmg(g, ac) {
    b(g, 0, 0, 0.02, 0.10, 0.14, 0.70, M.body);
    b(g, 0, -0.055, 0.20, 0.08, 0.16, 0.13, M.grip);
    b(g, 0, -0.13, -0.02, 0.14, 0.22, 0.24, M.dark);         // drum/box mag
    b(g, 0, 0.01, 0.42, 0.08, 0.11, 0.20, M.dark);
    cyl(g, 0, 0.02, -0.56, 0.026, 0.56, M.steel);
    b(g, 0, 0.10, 0.05, 0.035, 0.05, 0.30, M.light);         // carry handle
    b(g, 0, -0.05, -0.62, 0.02, 0.16, 0.02, M.dark);         // bipod
    b(g, 0.05, 0.0, 0.02, 0.007, 0.06, 0.4, accent(ac));
    b(g, -0.05, 0.0, 0.02, 0.007, 0.06, 0.4, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.86);
  },
  rocket(g, ac) {
    cyl(g, 0, 0.02, -0.05, 0.075, 1.0, M.body);
    cyl(g, 0, 0.02, -0.60, 0.095, 0.14, M.dark);
    cyl(g, 0, 0.02, 0.46, 0.105, 0.14, M.dark);              // rear cone
    b(g, 0, -0.10, 0.10, 0.07, 0.16, 0.11, M.grip);
    b(g, 0, -0.10, -0.20, 0.06, 0.13, 0.10, M.grip);
    b(g, 0, 0.11, -0.02, 0.05, 0.07, 0.16, M.dark);          // optic
    b(g, 0, 0.0, -0.05, 0.16, 0.008, 0.5, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.70);
  },
  knife(g, ac) {
    b(g, 0, 0, 0.06, 0.03, 0.09, 0.16, M.grip);
    b(g, 0, 0.0, -0.06, 0.012, 0.055, 0.26, M.steel);
    b(g, 0, 0.03, -0.06, 0.014, 0.008, 0.24, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
  },
};

export function buildWeaponModel(id) {
  const def = WEAPONS[id] || WEAPONS.rifle;
  const g = new THREE.Group();
  (BUILD[id] || BUILD.rifle)(g, def.color);
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

/** slightly beefier copy for third-person / floor pickups */
export function buildWorldWeapon(id) {
  const g = buildWeaponModel(id);
  g.scale.setScalar(1.0);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** hip / ads resting transforms per weapon, in camera space */
// hip / ads resting transforms in camera space (root is scaled to 0.62)
export const VM_POSE = {
  rifle:    { hip: [0.32, -0.30, -0.66], ads: [0, -0.068, -0.50], rot: [0, 0, 0] },
  smg:      { hip: [0.30, -0.29, -0.62], ads: [0, -0.052, -0.46], rot: [0, 0, 0] },
  shotgun:  { hip: [0.32, -0.31, -0.66], ads: [0, -0.054, -0.50], rot: [0, 0, 0] },
  sniper:   { hip: [0.33, -0.30, -0.70], ads: [0, -0.079, -0.44], rot: [0, 0, 0] },
  pistol:   { hip: [0.28, -0.27, -0.58], ads: [0, -0.051, -0.44], rot: [0, 0, 0] },
  revolver: { hip: [0.29, -0.28, -0.60], ads: [0, -0.052, -0.44], rot: [0, 0, 0] },
  lmg:      { hip: [0.35, -0.33, -0.70], ads: [0, -0.070, -0.54], rot: [0, 0, 0] },
  rocket:   { hip: [0.33, -0.26, -0.72], ads: [0.01, -0.076, -0.56], rot: [0, 0, 0] },
  knife:    { hip: [0.34, -0.30, -0.52], ads: [0.28, -0.28, -0.50], rot: [0, -0.3, 0.2] },
};
