// ============ procedural weapon models (boxes + cylinders, zero assets) ============
// Every model exposes:
//   userData.muzzle — where rounds and muzzle flash come from
//   userData.ironY  — height of the iron sight line above the weapon origin
//   userData.railY  — top of the optic rail, where sights get mounted
// The viewmodel derives the ADS pose from those, so the sight picture lands
// dead centre on screen for every weapon and every optic.
import * as THREE from 'three';
import { WEAPONS } from './defs.js';
import { attachmentById } from './attachments.js';

const M = {
  dark:  new THREE.MeshLambertMaterial({ color: 0x24282f }),
  body:  new THREE.MeshLambertMaterial({ color: 0x3a4149 }),
  light: new THREE.MeshLambertMaterial({ color: 0x596471 }),
  grip:  new THREE.MeshLambertMaterial({ color: 0x1a1d22 }),
  steel: new THREE.MeshLambertMaterial({ color: 0x8d97a3 }),
  wood:  new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
  glass: new THREE.MeshLambertMaterial({ color: 0x0b2436, transparent: true, opacity: 0.55 }),
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
function cyl(g, x, y, z, r, len, mat, axis = 'z') {
  const m = new THREE.Mesh(CYL, mat);
  m.position.set(x, y, z);
  m.scale.set(r, len, r);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  g.add(m); return m;
}

/**
 * Open iron sights: a front post and a rear notch with a real gap between the
 * posts. You aim *through* them — nothing solid sits on the sight line.
 */
function ironSights(g, ironY, frontZ, rearZ, postW = 0.011) {
  const railTop = ironY - 0.05;
  b(g, 0, (railTop + ironY) / 2, frontZ, postW, ironY - railTop, 0.014, M.steel);          // front post
  b(g, -0.026, (railTop + ironY) / 2, rearZ, postW, ironY - railTop, 0.016, M.steel);       // rear notch, left
  b(g, 0.026, (railTop + ironY) / 2, rearZ, postW, ironY - railTop, 0.016, M.steel);        // rear notch, right
  b(g, 0, railTop - 0.004, rearZ, 0.07, 0.01, 0.02, M.dark);                                // rear base
}

/* Each builder returns a Group whose barrel points down -Z. */
const BUILD = {
  rifle(g, ac) {
    b(g, 0, 0, 0, 0.085, 0.115, 0.62, M.body);
    b(g, 0, -0.055, 0.11, 0.075, 0.16, 0.13, M.grip);
    b(g, 0, -0.10, -0.02, 0.07, 0.20, 0.11, M.dark);         // magazine
    b(g, 0, 0.005, 0.30, 0.07, 0.10, 0.22, M.dark);          // stock
    cyl(g, 0, 0.015, -0.44, 0.021, 0.42, M.steel);           // barrel
    b(g, 0, 0.02, -0.30, 0.055, 0.06, 0.26, M.light);        // handguard
    b(g, 0, 0.072, 0.02, 0.032, 0.02, 0.36, M.dark);         // rail
    b(g, 0.045, 0.02, -0.05, 0.006, 0.03, 0.3, accent(ac));
    b(g, -0.045, 0.02, -0.05, 0.006, 0.03, 0.3, accent(ac));
    ironSights(g, 0.118, -0.36, 0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.66);
    g.userData.ironY = 0.118; g.userData.railY = 0.082;
    g.userData.railZ = 0.0; g.userData.barrelZ = -0.60; g.userData.underZ = -0.28;
  },
  smg(g, ac) {
    b(g, 0, 0, 0, 0.08, 0.12, 0.40, M.body);
    b(g, 0, -0.055, 0.06, 0.07, 0.15, 0.12, M.grip);
    b(g, 0, -0.13, -0.05, 0.055, 0.26, 0.09, M.dark);
    b(g, 0, 0.01, 0.22, 0.05, 0.07, 0.16, M.dark);
    cyl(g, 0, 0.015, -0.28, 0.019, 0.24, M.steel);
    b(g, 0, 0.02, -0.19, 0.05, 0.055, 0.16, M.light);
    b(g, 0, 0.07, -0.02, 0.03, 0.02, 0.26, M.dark);
    b(g, 0.042, 0.0, -0.02, 0.005, 0.05, 0.22, accent(ac));
    b(g, -0.042, 0.0, -0.02, 0.005, 0.05, 0.22, accent(ac));
    ironSights(g, 0.112, -0.24, 0.08);
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.41);
    g.userData.ironY = 0.112; g.userData.railY = 0.08;
    g.userData.railZ = -0.02; g.userData.barrelZ = -0.38; g.userData.underZ = -0.18;
  },
  shotgun(g, ac) {
    b(g, 0, 0, 0.02, 0.09, 0.13, 0.50, M.body);
    b(g, 0, -0.05, 0.16, 0.075, 0.15, 0.13, M.wood);
    b(g, 0, 0.0, 0.34, 0.07, 0.11, 0.22, M.wood);
    cyl(g, 0, 0.03, -0.40, 0.032, 0.52, M.steel);
    cyl(g, 0, -0.035, -0.36, 0.026, 0.44, M.dark);
    b(g, 0, -0.035, -0.30, 0.085, 0.075, 0.16, M.wood);
    b(g, 0.05, 0.0, 0.02, 0.006, 0.05, 0.24, accent(ac));
    b(g, -0.05, 0.0, 0.02, 0.006, 0.05, 0.24, accent(ac));
    ironSights(g, 0.112, -0.6, 0.1);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.68);
    g.userData.ironY = 0.112; g.userData.railY = 0.078;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.64; g.userData.underZ = -0.3;
    g.userData.pump = g.children[5];
  },
  sniper(g, ac) {
    b(g, 0, 0, 0.05, 0.08, 0.11, 0.78, M.body);
    b(g, 0, -0.05, 0.22, 0.07, 0.15, 0.12, M.grip);
    b(g, 0, -0.02, 0.44, 0.075, 0.16, 0.22, M.dark);
    b(g, 0, -0.09, 0.02, 0.06, 0.13, 0.10, M.dark);
    cyl(g, 0, 0.012, -0.62, 0.021, 0.62, M.steel);
    cyl(g, 0, 0.012, -0.94, 0.032, 0.10, M.dark);
    cyl(g, 0, 0.125, 0.02, 0.040, 0.34, M.dark);             // scope tube
    cyl(g, 0, 0.125, -0.16, 0.048, 0.04, M.glass);
    b(g, 0, 0.085, 0.10, 0.028, 0.045, 0.05, M.dark);
    b(g, 0, 0.085, -0.08, 0.028, 0.045, 0.05, M.dark);
    b(g, 0.043, 0.0, -0.1, 0.005, 0.05, 0.4, accent(ac));
    b(g, -0.043, 0.0, -0.1, 0.005, 0.05, 0.4, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.012, -1.02);
    g.userData.ironY = 0.125; g.userData.railY = 0.06;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.94; g.userData.underZ = -0.4;
    g.userData.bolt = b(g, 0.06, 0.045, 0.16, 0.03, 0.03, 0.12, M.steel);
    g.userData.fixedScope = true;
  },
  pistol(g, ac) {
    b(g, 0, 0.02, -0.02, 0.055, 0.085, 0.30, M.body);
    b(g, 0, -0.09, 0.06, 0.055, 0.19, 0.09, M.grip);
    cyl(g, 0, 0.02, -0.20, 0.014, 0.10, M.steel);
    b(g, 0.03, 0.02, -0.02, 0.004, 0.035, 0.16, accent(ac));
    b(g, -0.03, 0.02, -0.02, 0.004, 0.035, 0.16, accent(ac));
    ironSights(g, 0.088, -0.14, 0.09, 0.009);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.26);
    g.userData.ironY = 0.088; g.userData.railY = 0.062;
    g.userData.railZ = -0.02; g.userData.barrelZ = -0.2; g.userData.underZ = -0.12;
    g.userData.slide = g.children[0];
  },
  revolver(g, ac) {
    b(g, 0, 0.02, -0.04, 0.045, 0.08, 0.26, M.steel);
    cyl(g, 0, 0.0, 0.02, 0.055, 0.11, M.dark);
    b(g, 0, -0.09, 0.10, 0.055, 0.18, 0.10, M.wood);
    cyl(g, 0, 0.02, -0.22, 0.016, 0.16, M.steel);
    b(g, 0, 0.0, 0.02, 0.115, 0.012, 0.10, accent(ac));
    ironSights(g, 0.086, -0.26, 0.06, 0.009);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.31);
    g.userData.ironY = 0.086; g.userData.railY = 0.06;
    g.userData.railZ = -0.04; g.userData.barrelZ = -0.26; g.userData.underZ = -0.16;
    g.userData.cyl = g.children[1];
  },
  lmg(g, ac) {
    b(g, 0, 0, 0.02, 0.10, 0.14, 0.70, M.body);
    b(g, 0, -0.055, 0.20, 0.08, 0.16, 0.13, M.grip);
    b(g, 0, -0.13, -0.02, 0.14, 0.22, 0.24, M.dark);
    b(g, 0, 0.01, 0.42, 0.08, 0.11, 0.20, M.dark);
    cyl(g, 0, 0.02, -0.56, 0.026, 0.56, M.steel);
    b(g, 0, 0.085, 0.05, 0.034, 0.02, 0.34, M.light);        // rail
    b(g, 0, -0.05, -0.62, 0.02, 0.16, 0.02, M.dark);
    b(g, 0.05, 0.0, 0.02, 0.007, 0.06, 0.4, accent(ac));
    b(g, -0.05, 0.0, 0.02, 0.007, 0.06, 0.4, accent(ac));
    ironSights(g, 0.132, -0.5, 0.14);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.86);
    g.userData.ironY = 0.132; g.userData.railY = 0.095;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.8; g.userData.underZ = -0.4;
  },
  rocket(g, ac) {
    cyl(g, 0, 0.02, -0.05, 0.075, 1.0, M.body);
    cyl(g, 0, 0.02, -0.60, 0.095, 0.14, M.dark);
    cyl(g, 0, 0.02, 0.46, 0.105, 0.14, M.dark);
    b(g, 0, -0.10, 0.10, 0.07, 0.16, 0.11, M.grip);
    b(g, 0, -0.10, -0.20, 0.06, 0.13, 0.10, M.grip);
    b(g, 0, 0.0, -0.05, 0.16, 0.008, 0.5, accent(ac));
    b(g, -0.075, 0.13, -0.02, 0.03, 0.05, 0.14, M.dark);     // offset optic
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.70);
    g.userData.ironY = 0.155; g.userData.railY = 0.10;
    g.userData.railZ = -0.02; g.userData.barrelZ = -0.6; g.userData.underZ = -0.3;
  },
  machinepistol(g, ac) {
    b(g, 0, 0.02, -0.04, 0.058, 0.09, 0.34, M.body);
    b(g, 0, -0.09, 0.06, 0.058, 0.19, 0.09, M.grip);
    b(g, 0, -0.20, 0.05, 0.05, 0.24, 0.08, M.dark);          // extended mag
    cyl(g, 0, 0.02, -0.24, 0.015, 0.14, M.steel);
    b(g, 0, 0.075, -0.06, 0.026, 0.02, 0.2, M.dark);         // rail
    b(g, 0.032, 0.02, -0.02, 0.004, 0.035, 0.2, accent(ac));
    b(g, -0.032, 0.02, -0.02, 0.004, 0.035, 0.2, accent(ac));
    ironSights(g, 0.094, -0.18, 0.09, 0.009);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.32);
    g.userData.ironY = 0.094; g.userData.railY = 0.068;
    g.userData.railZ = -0.06; g.userData.barrelZ = -0.28; g.userData.underZ = -0.16;
    g.userData.slide = g.children[0];
  },
  pdw(g, ac) {
    b(g, 0, 0, 0, 0.075, 0.115, 0.34, M.body);
    b(g, 0, -0.055, 0.05, 0.068, 0.15, 0.11, M.grip);
    b(g, 0, -0.135, -0.04, 0.05, 0.27, 0.075, M.dark);       // long straight mag
    b(g, 0, 0.01, 0.20, 0.045, 0.06, 0.16, M.dark);          // folding stock
    cyl(g, 0, 0.015, -0.24, 0.017, 0.2, M.steel);
    b(g, 0, 0.02, -0.17, 0.048, 0.05, 0.14, M.light);
    b(g, 0, 0.068, -0.02, 0.03, 0.018, 0.26, M.dark);
    b(g, 0.04, 0.0, -0.02, 0.005, 0.045, 0.2, accent(ac));
    b(g, -0.04, 0.0, -0.02, 0.005, 0.045, 0.2, accent(ac));
    ironSights(g, 0.108, -0.21, 0.07);
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.36);
    g.userData.ironY = 0.108; g.userData.railY = 0.078;
    g.userData.railZ = -0.02; g.userData.barrelZ = -0.33; g.userData.underZ = -0.16;
  },
  carbine(g, ac) {
    b(g, 0, 0, 0, 0.082, 0.112, 0.52, M.body);
    b(g, 0, -0.055, 0.09, 0.072, 0.155, 0.12, M.grip);
    b(g, 0, -0.10, -0.02, 0.068, 0.19, 0.1, M.dark);
    b(g, 0, 0.005, 0.25, 0.065, 0.095, 0.18, M.dark);        // collapsed stock
    cyl(g, 0, 0.015, -0.36, 0.02, 0.3, M.steel);
    cyl(g, 0, 0.015, -0.52, 0.03, 0.08, M.dark);             // flash hider
    b(g, 0, 0.02, -0.26, 0.052, 0.055, 0.22, M.light);
    b(g, 0, 0.07, 0.0, 0.03, 0.02, 0.32, M.dark);
    b(g, 0.043, 0.02, -0.04, 0.006, 0.03, 0.26, accent(ac));
    b(g, -0.043, 0.02, -0.04, 0.006, 0.03, 0.26, accent(ac));
    ironSights(g, 0.114, -0.31, 0.11);
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.57);
    g.userData.ironY = 0.114; g.userData.railY = 0.08;
    g.userData.railZ = 0.0; g.userData.barrelZ = -0.5; g.userData.underZ = -0.25;
  },
  bullpup(g, ac) {
    b(g, 0, 0, 0.06, 0.084, 0.13, 0.66, M.body);
    b(g, 0, -0.055, -0.16, 0.072, 0.15, 0.12, M.grip);       // grip forward of the mag
    b(g, 0, -0.09, 0.22, 0.066, 0.17, 0.11, M.dark);         // mag behind the grip
    cyl(g, 0, 0.02, -0.42, 0.02, 0.36, M.steel);
    b(g, 0, 0.025, -0.28, 0.055, 0.06, 0.2, M.light);
    b(g, 0, 0.085, 0.06, 0.032, 0.022, 0.44, M.light);       // full-length carry rail
    b(g, 0.046, 0.0, 0.06, 0.006, 0.05, 0.4, accent(ac));
    b(g, -0.046, 0.0, 0.06, 0.006, 0.05, 0.4, accent(ac));
    ironSights(g, 0.132, -0.3, 0.2);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.62);
    g.userData.ironY = 0.132; g.userData.railY = 0.098;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.56; g.userData.underZ = -0.26;
  },
  autoshotgun(g, ac) {
    b(g, 0, 0, 0.02, 0.092, 0.135, 0.5, M.body);
    b(g, 0, -0.055, 0.14, 0.076, 0.15, 0.12, M.grip);
    b(g, 0, -0.125, -0.03, 0.08, 0.22, 0.13, M.dark);        // box magazine
    b(g, 0, 0.0, 0.32, 0.07, 0.11, 0.2, M.dark);
    cyl(g, 0, 0.03, -0.38, 0.03, 0.48, M.steel);
    b(g, 0, 0.03, -0.26, 0.07, 0.06, 0.2, M.light);
    b(g, 0.05, 0.0, 0.02, 0.006, 0.05, 0.26, accent(ac));
    b(g, -0.05, 0.0, 0.02, 0.006, 0.05, 0.26, accent(ac));
    ironSights(g, 0.12, -0.52, 0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.64);
    g.userData.ironY = 0.12; g.userData.railY = 0.086;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.6; g.userData.underZ = -0.3;
  },
  slug(g, ac) {
    b(g, 0, 0, 0.04, 0.088, 0.125, 0.42, M.body);
    b(g, 0, -0.05, 0.16, 0.072, 0.15, 0.12, M.wood);
    b(g, 0, 0.0, 0.3, 0.066, 0.1, 0.18, M.wood);             // stubby stock
    cyl(g, 0, 0.03, -0.26, 0.034, 0.34, M.steel);            // short thick barrel
    cyl(g, 0, -0.035, -0.24, 0.026, 0.3, M.dark);
    b(g, 0, -0.035, -0.2, 0.085, 0.075, 0.15, M.wood);       // pump
    b(g, 0.05, 0.0, 0.04, 0.006, 0.05, 0.22, accent(ac));
    b(g, -0.05, 0.0, 0.04, 0.006, 0.05, 0.22, accent(ac));
    ironSights(g, 0.118, -0.4, 0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.46);
    g.userData.ironY = 0.118; g.userData.railY = 0.084;
    g.userData.railZ = 0.04; g.userData.barrelZ = -0.42; g.userData.underZ = -0.22;
    g.userData.pump = g.children[5];
  },
  dmr(g, ac) {
    b(g, 0, 0, 0.04, 0.082, 0.12, 0.74, M.body);
    b(g, 0, -0.055, 0.14, 0.072, 0.155, 0.12, M.grip);
    b(g, 0, -0.10, -0.06, 0.068, 0.2, 0.1, M.dark);
    b(g, 0, 0.0, 0.38, 0.07, 0.12, 0.22, M.dark);
    cyl(g, 0, 0.015, -0.52, 0.021, 0.5, M.steel);
    cyl(g, 0, 0.015, -0.78, 0.031, 0.08, M.dark);
    b(g, 0, 0.025, -0.32, 0.052, 0.055, 0.28, M.light);
    cyl(g, 0, 0.118, 0.02, 0.034, 0.26, M.dark);             // low-power scope
    cyl(g, 0, 0.118, -0.12, 0.042, 0.035, M.glass);
    b(g, 0.045, 0.0, -0.06, 0.006, 0.05, 0.4, accent(ac));
    b(g, -0.045, 0.0, -0.06, 0.006, 0.05, 0.4, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.84);
    g.userData.ironY = 0.118; g.userData.railY = 0.082;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.78; g.userData.underZ = -0.32;
    g.userData.fixedScope = true;
  },
  crossbow(g, ac) {
    b(g, 0, 0, 0.06, 0.05, 0.07, 0.72, M.body);              // stock rail
    b(g, 0, -0.06, 0.16, 0.058, 0.16, 0.1, M.grip);
    b(g, 0, 0.0, 0.34, 0.06, 0.1, 0.18, M.dark);
    // limbs, swept forward
    const limbL = b(g, -0.17, 0.02, -0.3, 0.24, 0.022, 0.05, M.dark);
    limbL.rotation.y = 0.42;
    const limbR = b(g, 0.17, 0.02, -0.3, 0.24, 0.022, 0.05, M.dark);
    limbR.rotation.y = -0.42;
    b(g, 0, 0.02, -0.28, 0.09, 0.05, 0.12, M.light);          // riser
    b(g, 0, 0.055, -0.05, 0.014, 0.014, 0.44, accent(ac));    // the bolt on the rail
    cyl(g, 0, 0.02, -0.44, 0.012, 0.16, M.steel);
    ironSights(g, 0.104, -0.34, 0.14, 0.009);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -0.5);
    g.userData.ironY = 0.104; g.userData.railY = 0.074;
    g.userData.railZ = 0.02; g.userData.barrelZ = -0.46; g.userData.underZ = -0.24;
  },
  grenadier(g, ac) {
    cyl(g, 0, 0.02, -0.16, 0.056, 0.62, M.body);             // fat tube
    cyl(g, 0, 0.02, -0.5, 0.062, 0.06, M.dark);
    b(g, 0, -0.06, 0.16, 0.07, 0.16, 0.12, M.grip);
    b(g, 0, 0.0, 0.3, 0.07, 0.12, 0.2, M.dark);
    cyl(g, 0, -0.02, 0.06, 0.085, 0.12, M.dark);             // revolving drum
    b(g, 0, 0.03, -0.28, 0.06, 0.05, 0.16, M.light);         // fore-grip shroud
    b(g, 0.06, 0.0, -0.1, 0.006, 0.05, 0.3, accent(ac));
    b(g, -0.06, 0.0, -0.1, 0.006, 0.05, 0.3, accent(ac));
    b(g, 0, 0.1, 0.12, 0.05, 0.06, 0.03, M.dark);            // ladder leaf sight
    ironSights(g, 0.13, -0.4, 0.16);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.56);
    g.userData.ironY = 0.13; g.userData.railY = 0.09;
    g.userData.railZ = -0.02; g.userData.barrelZ = -0.5; g.userData.underZ = -0.26;
    g.userData.cyl = g.children[4];
  },
  knife(g, ac) {
    b(g, 0, 0, 0.06, 0.03, 0.09, 0.16, M.grip);
    b(g, 0, 0.0, -0.06, 0.012, 0.055, 0.26, M.steel);
    b(g, 0, 0.03, -0.06, 0.014, 0.008, 0.24, accent(ac));
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
    g.userData.ironY = 0.05; g.userData.railY = 0.05;
  },
};

/* ---------- attachment visuals ---------- */
/** A hollow window frame — the middle of an optic has to stay empty or the
 *  sight itself becomes the thing hiding your target. */
function opticFrame(g, y, z, halfW, halfH, depth, bar) {
  b(g, 0, y + halfH, z, halfW * 2 + bar, bar, depth, M.dark);        // top
  b(g, 0, y - halfH, z, halfW * 2 + bar, bar, depth, M.dark);        // bottom
  b(g, -halfW, y, z, bar, halfH * 2, depth, M.dark);                 // left
  b(g, halfW, y, z, bar, halfH * 2, depth, M.dark);                  // right
}

function addOptic(g, optic) {
  const ud = g.userData;
  const y = ud.railY + optic.rise;
  const z = ud.railZ ?? 0;
  if (optic.id === 'reddot') {
    b(g, 0, ud.railY + optic.rise * 0.45, z, 0.036, optic.rise * 0.9, 0.05, M.dark);   // mount, below the glass
    opticFrame(g, y, z, 0.032, 0.028, 0.05, 0.008);
  } else if (optic.id === 'holo') {
    b(g, 0, ud.railY + optic.rise * 0.4, z + 0.03, 0.05, optic.rise * 0.8, 0.06, M.dark);
    opticFrame(g, y, z - 0.02, 0.045, 0.036, 0.05, 0.009);
  } else if (optic.id === 'acog') {
    // magnified: the model is hidden behind the scope overlay while aimed
    cyl(g, 0, y, z - 0.02, 0.032, 0.2, M.dark);
    b(g, 0, ud.railY + optic.rise / 2, z + 0.02, 0.03, optic.rise, 0.05, M.dark);
  }
  ud.sightY = y;
}

function addAttachmentParts(g, w) {
  const ud = g.userData;
  ud.sightY = ud.ironY;
  const a = w.attachments || {};
  const optic = attachmentById('optic', a.optic);
  if (optic && optic.id !== 'iron') addOptic(g, optic);

  if (a.barrel === 'suppressor') cyl(g, 0, ud.muzzle.y, ud.barrelZ - 0.16, 0.034, 0.3, M.dark);
  else if (a.barrel === 'comp') cyl(g, 0, ud.muzzle.y, ud.barrelZ - 0.05, 0.032, 0.09, M.steel);
  else if (a.barrel === 'brake') {
    cyl(g, 0, ud.muzzle.y, ud.barrelZ - 0.05, 0.03, 0.1, M.steel);
    b(g, 0, ud.muzzle.y + 0.03, ud.barrelZ - 0.05, 0.05, 0.008, 0.08, M.dark);
  }

  if (a.grip === 'vertical') b(g, 0, ud.muzzle.y - 0.09, ud.underZ, 0.032, 0.14, 0.04, M.grip);
  else if (a.grip === 'angled') {
    const m = b(g, 0, ud.muzzle.y - 0.07, ud.underZ, 0.03, 0.12, 0.045, M.grip);
    m.rotation.x = -0.5;
  }

  if (a.laser === 'laser') {
    b(g, 0.05, ud.muzzle.y - 0.02, ud.underZ + 0.05, 0.028, 0.028, 0.07, M.dark);
    const dot = b(g, 0.05, ud.muzzle.y - 0.02, ud.underZ + 0.012, 0.012, 0.012, 0.008, accent(0xff2d55));
    ud.laserDot = dot;
  } else if (a.laser === 'foregrip') b(g, 0, ud.muzzle.y - 0.06, ud.underZ - 0.04, 0.028, 0.1, 0.06, M.grip);

  if (a.mag === 'extended') {
    const magMesh = g.children.find(c => c.scale.y > 0.18 && c.position.y < -0.05);
    if (magMesh) { magMesh.scale.y *= 1.35; magMesh.position.y -= 0.03; }
  }
}

/**
 * @param {string} id weapon id
 * @param {object} [resolved] weapon def already run through resolveWeapon (for attachments)
 */
export function buildWeaponModel(id, resolved) {
  const def = resolved || WEAPONS[id] || WEAPONS.rifle;
  const g = new THREE.Group();
  (BUILD[id] || BUILD.rifle)(g, def.color);
  addAttachmentParts(g, def);
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

/** slightly beefier copy for third-person / floor pickups */
export function buildWorldWeapon(id) {
  const g = buildWeaponModel(id);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** hip-fire resting transform per weapon, in camera space (ADS is derived from the sight) */
export const VM_HIP = {
  rifle:    [0.32, -0.30, -0.66],
  smg:      [0.30, -0.29, -0.62],
  shotgun:  [0.32, -0.31, -0.66],
  sniper:   [0.33, -0.30, -0.70],
  pistol:   [0.28, -0.27, -0.58],
  revolver: [0.29, -0.28, -0.60],
  lmg:      [0.35, -0.33, -0.70],
  rocket:   [0.33, -0.26, -0.72],
  knife:    [0.34, -0.30, -0.52],
  machinepistol: [0.28, -0.27, -0.58],
  pdw:      [0.30, -0.29, -0.60],
  carbine:  [0.31, -0.30, -0.64],
  bullpup:  [0.32, -0.30, -0.62],
  autoshotgun: [0.33, -0.31, -0.66],
  slug:     [0.32, -0.31, -0.62],
  dmr:      [0.33, -0.30, -0.70],
  crossbow: [0.32, -0.29, -0.66],
  grenadier: [0.33, -0.28, -0.66],
};
export const VM_ADS_Z = {
  rifle: -0.46, smg: -0.42, shotgun: -0.46, sniper: -0.40,
  pistol: -0.40, revolver: -0.40, lmg: -0.50, rocket: -0.52, knife: -0.50,
  machinepistol: -0.40, pdw: -0.42, carbine: -0.44, bullpup: -0.44,
  autoshotgun: -0.46, slug: -0.44, dmr: -0.42, crossbow: -0.46, grenadier: -0.48,
};
