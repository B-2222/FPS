// ============ procedural WebAudio engine (no sample files) ============
import { settings } from './settings.js';
import { clamp, rand } from './util.js';

class AudioEngine {
  constructor() {
    this.ctx = null; this.master = null; this.noise = null; this.ready = false;
    this.voices = 0; this.lastAt = Object.create(null);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = clamp(settings.volume / 100, 0, 1);
    // gentle limiter so 12 guns firing at once doesn't clip into mush
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 9;
    comp.attack.value = 0.003; comp.release.value = 0.22;
    this.master.connect(comp); comp.connect(this.ctx.destination);

    // shared white-noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.ready = true;
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  /** listener follows the camera so gunfire has real direction */
  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, .01);
      l.positionY.setTargetAtTime(pos.y, t, .01);
      l.positionZ.setTargetAtTime(pos.z, t, .01);
      l.forwardX.setTargetAtTime(fwd.x, t, .01);
      l.forwardY.setTargetAtTime(fwd.y, t, .01);
      l.forwardZ.setTargetAtTime(fwd.z, t, .01);
      l.upX.setTargetAtTime(up.x, t, .01); l.upY.setTargetAtTime(up.y, t, .01); l.upZ.setTargetAtTime(up.z, t, .01);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** returns the node everything in one sound connects into */
  _bus(pos, gain, refDist = 9, maxDist = 130) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = refDist; p.maxDistance = maxDist; p.rolloffFactor = 1.1;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _noiseSrc(dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.playbackRate.value = rate;
    s.loop = true;
    s.start(this.ctx.currentTime, rand(0, 1.5));
    s.stop(this.ctx.currentTime + dur + .05);
    return s;
  }

  /** throttle identical sounds fired in the same millisecond-ish window */
  _spam(key, minGap) {
    const now = performance.now();
    if (this.lastAt[key] && now - this.lastAt[key] < minGap) return true;
    this.lastAt[key] = now; return false;
  }

  // ---------- weapon fire ----------
  gunshot(pos, o = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const dur = o.dur ?? .28, vol = (o.vol ?? .5);
    const bus = this._bus(pos, vol, o.ref ?? 10, o.max ?? 190);

    // crack: bright noise through a fast-closing bandpass
    const n = this._noiseSrc(dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = .7;
    bp.frequency.setValueAtTime(o.crack ?? 2600, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(120, (o.crack ?? 2600) * .16), t + dur * .8);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(1, t + .002);
    ng.gain.exponentialRampToValueAtTime(.0008, t + dur);
    n.connect(bp); bp.connect(ng); ng.connect(bus);

    // body: pitched-down thump gives each gun its weight
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(o.body ?? 190, t);
    osc.frequency.exponentialRampToValueAtTime((o.body ?? 190) * .32, t + dur * .55);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(o.bodyVol ?? .9, t);
    og.gain.exponentialRampToValueAtTime(.001, t + dur * .75);
    osc.connect(og); og.connect(bus);
    osc.start(t); osc.stop(t + dur + .02);

    // tail: a short slap of "room"
    if (o.tail !== false) {
      const tn = this._noiseSrc(.34);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0, t + .02);
      tg.gain.linearRampToValueAtTime(.16, t + .05);
      tg.gain.exponentialRampToValueAtTime(.001, t + .34);
      tn.connect(lp); lp.connect(tg); tg.connect(bus);
    }
  }

  explosion(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const bus = this._bus(pos, .95, 14, 240);
    const n = this._noiseSrc(1.1, .8);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + .9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(.001, t + 1.0);
    n.connect(lp); lp.connect(g); g.connect(bus);
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(28, t + .6);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(1.1, t); og.gain.exponentialRampToValueAtTime(.001, t + .7);
    o.connect(og); og.connect(bus); o.start(t); o.stop(t + .75);
  }

  /** tiny filtered click — reload steps, weapon swap, dry fire */
  click(pos, { freq = 1400, dur = .06, vol = .32, type = 'square' } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const bus = this._bus(pos, vol, 8, 60);
    const n = this._noiseSrc(dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 3.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(bus);
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq * .5, t);
    o.frequency.exponentialRampToValueAtTime(freq * .22, t + dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(.25, t); og.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(og); og.connect(bus); o.start(t); o.stop(t + dur + .01);
  }

  /** melodic blip — hitmarker, pickups, kill chime */
  tone(freq, dur = .1, vol = .25, type = 'sine', slideTo = null) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const bus = this._bus(null, vol);
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + .006);
    g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + .02);
  }

  impact(pos, kind = 'wall') {
    if (!this.ready || this._spam('imp' + kind, 22)) return;
    const t = this.ctx.currentTime;
    const bus = this._bus(pos, kind === 'flesh' ? .34 : .26, 8, 70);
    const n = this._noiseSrc(.1, rand(.85, 1.25));
    const f = this.ctx.createBiquadFilter();
    f.type = kind === 'flesh' ? 'lowpass' : 'highpass';
    f.frequency.value = kind === 'flesh' ? 700 : 1500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(.8, t); g.gain.exponentialRampToValueAtTime(.001, t + .1);
    n.connect(f); f.connect(g); g.connect(bus);
  }

  /** supersonic near-miss — the single best "they're shooting at me" cue */
  whizby(pos) {
    if (!this.ready || this._spam('whiz', 45)) return;
    const t = this.ctx.currentTime;
    const bus = this._bus(pos, .3, 4, 26);
    const n = this._noiseSrc(.14, 1.6);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(3400, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + .13);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + .015);
    g.gain.exponentialRampToValueAtTime(.001, t + .14);
    n.connect(bp); bp.connect(g); g.connect(bus);
  }

  footstep(pos, run) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const bus = this._bus(pos, run ? .17 : .1, 5, 34);
    const n = this._noiseSrc(.07, rand(.8, 1.2));
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = run ? 900 : 620;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .075);
    n.connect(f); f.connect(g); g.connect(bus);
  }

  hurt() { this.tone(220, .16, .3, 'sawtooth', 90); this.impact(null, 'flesh'); }
  hitmark(headshot) { this.tone(headshot ? 1500 : 1050, .07, .22, 'square', headshot ? 900 : 700); }
  killChime() { this.tone(880, .09, .22, 'triangle'); setTimeout(() => this.tone(1320, .16, .22, 'triangle'), 70); }
  died() { this.tone(300, .5, .3, 'sawtooth', 70); }
  pickup(kind) {
    const f = kind === 'health' ? 660 : kind === 'shield' ? 520 : 760;
    this.tone(f, .09, .24, 'sine'); setTimeout(() => this.tone(f * 1.5, .12, .2, 'sine'), 75);
  }
  spawn() { this.tone(440, .1, .18, 'sine'); setTimeout(() => this.tone(660, .14, .16, 'sine'), 90); }
}

export const audio = new AudioEngine();
export const setAudioVolume = v => audio.setVolume(clamp(v, 0, 1));
