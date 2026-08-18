// ============ small math / helpers ============
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const sign = v => v < 0 ? -1 : 1;
/** frame-rate independent exponential smoothing */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = t => t * t * (3 - 2 * t);
/** gaussian-ish random in [-1,1], clusters near 0 */
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
export const angleDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const fmtTime = s => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
let _id = 0;
export const uid = () => ++_id;

const FIRST = ['Vex', 'Nyx', 'Rook', 'Zed', 'Kilo', 'Ash', 'Ghost', 'Rax', 'Juno', 'Volt', 'Onyx', 'Fury',
  'Cypher', 'Blitz', 'Havoc', 'Drift', 'Riven', 'Static', 'Nova', 'Kobra', 'Slate', 'Wraith', 'Echo', 'Talon'];
const LAST = ['77', 'X', '_YT', 'zz', '99', 'ok', 'HD', '_TTV', '', '', '', '4k', 'pro', 'v2', '_1'];
export function botName(used) {
  for (let i = 0; i < 200; i++) {
    const n = pick(FIRST) + pick(LAST);
    if (!used.has(n)) { used.add(n); return n; }
  }
  return 'Bot' + uid();
}
