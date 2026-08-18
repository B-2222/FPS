// ============ rotating minimap ============
import { clamp } from '../core/util.js';

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.range = 46;                      // world units shown from centre to edge
    this.static = document.createElement('canvas');
    this.static.width = this.static.height = 512;
    this.buildStatic();
    this.t = 0;
  }

  buildStatic() {
    const g = this.game, s = this.static, x = s.getContext('2d');
    const H = g.bounds + 4;
    const scale = s.width / (H * 2);
    x.clearRect(0, 0, s.width, s.height);
    x.fillStyle = 'rgba(14,20,28,0.9)';
    x.fillRect(0, 0, s.width, s.height);
    const boxes = [...g.world.boxes].sort((a, b) => a.max.y - b.max.y);
    for (const b of boxes) {
      const h = b.max.y;
      if (h <= 0.05) continue;
      const w = (b.max.x - b.min.x), d = (b.max.z - b.min.z);
      if (w > 100 && d > 100) continue;                       // skip the ground slab
      const t = clamp(h / 11, 0, 1);
      const shade = Math.round(56 + t * 120);
      x.fillStyle = `rgb(${Math.round(shade * 0.82)},${Math.round(shade * 0.9)},${shade})`;
      x.fillRect((b.min.x + H) * scale, (b.min.z + H) * scale, w * scale, d * scale);
    }
    // arena border
    x.strokeStyle = 'rgba(0,255,168,.55)'; x.lineWidth = 4;
    x.strokeRect(2, 2, s.width - 4, s.height - 4);
  }

  draw(dt) {
    const g = this.game, c = this.c, x = this.x;
    const W = c.width, Hh = c.height;
    const p = g.player;
    x.clearRect(0, 0, W, Hh);
    x.save();
    x.beginPath(); x.arc(W / 2, Hh / 2, W / 2 - 2, 0, 6.283); x.clip();
    x.fillStyle = '#080b10'; x.fillRect(0, 0, W, Hh);

    const H = g.bounds + 4;
    const px = (p.pos.x + H) / (H * 2) * this.static.width;
    const pz = (p.pos.z + H) / (H * 2) * this.static.height;
    const zoom = (W / 2) / (this.range / (H * 2) * this.static.width);

    x.translate(W / 2, Hh / 2);
    x.rotate(-p.yaw + Math.PI);              // player-up
    x.scale(zoom, zoom);
    x.translate(-px, -pz);
    x.imageSmoothingEnabled = false;
    x.drawImage(this.static, 0, 0);
    x.restore();

    // ---- blips ----
    const toScreen = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      const a = -p.yaw + Math.PI;
      const rx = dx * Math.cos(a) - dz * Math.sin(a);
      const rz = dx * Math.sin(a) + dz * Math.cos(a);
      const s = (W / 2) / this.range;
      return [W / 2 + rx * s, Hh / 2 + rz * s];
    };

    for (const a of g.actors) {
      if (a === p || !a.alive) continue;
      const d = a.pos.distanceTo(p.pos);
      const friendly = g.friendly(p, a);
      const known = friendly || g.time - (a.lastFiredAt ?? -99) < 2.6 || (d < 52 && g.canPlayerSee(a));
      if (!known || d > 70) continue;
      const [sx, sy] = toScreen(a.pos.x, a.pos.z);
      if (Math.hypot(sx - W / 2, sy - Hh / 2) > W / 2 - 8) continue;
      x.beginPath();
      x.fillStyle = friendly ? '#00ffa8' : '#ff2d55';
      const r = clamp(7 - Math.abs(a.pos.y - p.pos.y) * 0.25, 4, 7);
      x.arc(sx, sy, r, 0, 6.283); x.fill();
      // height indicator
      if (a.pos.y > p.pos.y + 1.5) { x.fillStyle = '#fff'; x.fillRect(sx - 1.5, sy - r - 5, 3, 3); }
      else if (a.pos.y < p.pos.y - 1.5) { x.fillStyle = '#fff'; x.fillRect(sx - 1.5, sy + r + 2, 3, 3); }
    }

    // pickups
    for (const pk of g.pickups) {
      if (!pk.active) continue;
      const [sx, sy] = toScreen(pk.pos.x, pk.pos.z);
      if (Math.hypot(sx - W / 2, sy - Hh / 2) > W / 2 - 6) continue;
      x.fillStyle = pk.type === 'health' ? '#2ee68a' : pk.type === 'shield' ? '#4cc9ff' : '#ffd60a';
      x.fillRect(sx - 3, sy - 3, 6, 6);
    }

    // player arrow
    x.save();
    x.translate(W / 2, Hh / 2);
    x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(0, -11); x.lineTo(8, 9); x.lineTo(0, 4); x.lineTo(-8, 9); x.closePath(); x.fill();
    x.restore();
  }
}
