// Plays a score (arrange.js) on recorded string sections (samples/, see the README).
// The same code runs on a live AudioContext (the page) and on an
// OfflineAudioContext (renders), so what is rendered is what was heard.
//
//   chorale parts (cb vc va vn2 vn1): every note sounds on three layers at once,
//     a soft bow (legato p), a full bow (legato f) and a tremolo; the score's
//     curves mix them:  dyn → loudness and soft ↔ full, trem → bow ↔ tremolo,
//     bright → a low-pass on the section
//   lines (solo, vcl): soft and full bow mixed by each note's own strength,
//     loudness shaped by the `solo` curve (the hands' speed)
//   pizzicato and harp: one-shots
//
// Sections sit left to right as on a stage and share one hall (a generated
// impulse response).
import { PART_INFO, PARTS, DYN_OF } from './arrange.js';

export const MIX = {                      // defaults; the page's mixer overrides gain per part
  gain: { cb: 0.9, vc: 0.85, va: 0.8, vn2: 0.75, vn1: 0.7, solo: 0.55, vcl: 0.7, pzh: 0.8, pzb: 0.5, harp: 0.55 },
  pan: { cb: 0.5, vc: 0.32, va: 0.12, vn2: -0.18, vn1: -0.42, solo: -0.3, vcl: 0.25, pzh: 0.1, pzb: 0.45, harp: -0.6 },
  send: { cb: 0.18, vc: 0.25, va: 0.3, vn2: 0.32, vn1: 0.34, solo: 0.36, vcl: 0.3, pzh: 0.35, pzb: 0.25, harp: 0.4 },
  hallS: 2.8, master: 0.85, curveHz: 30,
  loudExp: 1.4,                           // loudness = dynamic ^ this: with the dynamic's floor at 0.4, about 11 dB from the softest bow to the fullest
  attack: { chord: 0.32, line: 0.09 }, release: { chord: 0.55, line: 0.3 },
};
const CHORALE = ['cb', 'vc', 'va', 'vn2', 'vn1'];

export class Samples {
  constructor(base = '/data/samples/') { this.base = base; this.manifest = null; this.buf = new Map(); this.raw = new Map(); }
  async init() { if (!this.manifest) this.manifest = await (await fetch(this.base + 'manifest.json')).json(); return this; }
  // the nearest recorded note of a set's articulation
  pick(set, art, midi) {
    const list = this.manifest.sections[set]?.[art]; if (!list) return null;
    let best = list[0]; for (const e of list) if (Math.abs(e.midi - midi) < Math.abs(best.midi - midi)) best = e;
    return best;
  }
  needed(score) {
    const out = new Map();
    for (const n of score.notes) {
      const set = PART_INFO[n.part].set;
      const arts = n.art === 'sus' ? (CHORALE.includes(n.part) ? ['legato_p', 'legato_f', 'tremolo'] : ['legato_p', 'legato_f']) : [n.art === 'pluck' ? 'pluck' : 'pizz'];
      for (const a of arts) { const e = this.pick(set, a, n.midi); if (e) out.set(e.file, e); }
    }
    return [...out.values()];
  }
  // everything a live score could ask for: every recorded note of the sections that are switched on
  all(P) {
    const parts = P.mode === 'octave' ? ['cb', 'vc', 'va', 'vn1'] : ['cb', 'vc', 'va', 'vn2', 'vn1', 'solo'];
    if (P.leg) parts.push('vcl'); if (P.steps) parts.push('pzb'); if (P.acc) parts.push('pzh'); if (P.harp || P.harpSpin) parts.push('harp');
    const out = new Map();
    for (const p of parts) { const set = PART_INFO[p].set, arts = CHORALE.includes(p) ? ['legato_p', 'legato_f', 'tremolo'] : p === 'solo' || p === 'vcl' ? ['legato_p', 'legato_f'] : [p === 'harp' ? 'pluck' : 'pizz'];
      for (const a of arts) for (const e of this.manifest.sections[set]?.[a] || []) out.set(e.file, e); }
    return [...out.values()];
  }
  // fetch (once) and decode for this context
  async load(ctx, entries, onProgress = () => {}) {
    let done = 0;
    await Promise.all(entries.map(async e => {
      const key = e.file;
      if (!this.raw.has(key)) this.raw.set(key, fetch(this.base + e.file).then(r => r.arrayBuffer()));
      const cacheKey = key + '@' + ctx.sampleRate;
      if (!this.buf.has(cacheKey)) this.buf.set(cacheKey, this.raw.get(key).then(ab => ctx.decodeAudioData(ab.slice(0))));
      await this.buf.get(cacheKey); onProgress(++done, entries.length);
    }));
    this.ready = new Map();
    for (const [k, p] of this.buf) this.ready.set(k, await p);
  }
  get(ctx, e) { return this.ready.get(e.file + '@' + ctx.sampleRate); }
}

function hall(ctx, seconds) {             // a plain hall: decaying noise, darker as it decays
  const n = Math.floor(seconds * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate, env = Math.exp(-t * 6.9 / seconds) * (t < 0.012 ? t / 0.012 : 1);
      const a = 0.25 + 0.6 * Math.exp(-t * 2.2);                // the low-pass closes over time
      lp += a * (rnd() - lp); d[i] = lp * env * (i % 2 || c ? 1 : 0.97);
    }
  }
  return b;
}

// a per-frame curve → uniform samples from `from` seconds to the end
function resample(times, values, from, hz, fn = x => x) {
  const dur = times[times.length - 1], n = Math.max(2, Math.ceil((dur - from) * hz) + 1), out = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = from + i / hz;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const t0 = times[j], t1 = times[j + 1], u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    out[i] = fn(values[j] + (values[j + 1] - values[j]) * u, j, u);
  }
  return out;
}

export class Player {
  // mix: {gain: {part: 0..1}, mute: {part: bool}, master, reverb}
  constructor(ctx, samples, mix = {}) {
    this.ctx = ctx; this.samples = samples; this.session = null;
    this.out = ctx.createGain(); this.out.gain.value = mix.master ?? MIX.master;
    // a soft ceiling instead of a compressor: untouched below −6 dB, rounded off above, so the dynamics stay the body's
    const lim = ctx.createWaveShaper(), cv = new Float32Array(2049), kn = 0.5;
    for (let i = 0; i < cv.length; i++) { const x = (i / 1024 - 1) * 2, ax = Math.abs(x); cv[i] = Math.sign(x) * (ax <= kn ? ax : kn + (1 - kn) * Math.tanh((ax - kn) / (1 - kn))); }
    const pre = ctx.createGain(); pre.gain.value = 0.5; const post = ctx.createGain(); post.gain.value = 1;   // the shaper's input spans ±2
    lim.curve = cv; lim.oversample = '2x';
    this.out.connect(pre); pre.connect(lim); lim.connect(post); post.connect(ctx.destination);
    this.tap = post;                                           // for a recorder / analyser
    this.verb = ctx.createConvolver(); this.verb.buffer = hall(ctx, MIX.hallS);
    this.wet = ctx.createGain(); this.wet.gain.value = mix.reverb ?? 0.9; this.verb.connect(this.wet); this.wet.connect(this.out);
    this.part = {};
    for (const p of PARTS) {
      const g = ctx.createGain(), pan = ctx.createStereoPanner(), send = ctx.createGain();
      pan.pan.value = MIX.pan[p]; send.gain.value = MIX.send[p];
      g.connect(pan); pan.connect(this.out); pan.connect(send); send.connect(this.verb);
      this.part[p] = { g };
    }
    this.setMix(mix);
  }
  setMix(mix = {}) {
    this.mix = mix;
    const solo = Object.entries(mix.solo || {}).filter(([, v]) => v).map(([k]) => k);
    for (const p of PARTS) {
      const on = solo.length ? solo.includes(p) : !(mix.mute && mix.mute[p]);
      this.part[p].g.gain.setTargetAtTime(on ? (mix.gain?.[p] ?? 1) * MIX.gain[p] : 0, this.ctx.currentTime, 0.03);
    }
    if (mix.master != null) this.out.gain.setTargetAtTime(mix.master, this.ctx.currentTime, 0.03);
    if (mix.reverb != null) this.wet.gain.setTargetAtTime(mix.reverb, this.ctx.currentTime, 0.03);
  }

  stop() {
    const s = this.session; if (!s) return; this.session = null;
    const now = this.ctx.currentTime;
    for (const r of s.roots) { try { r.gain.setValueAtTime(1, now); r.gain.linearRampToValueAtTime(0, now + 0.04); } catch (e) {} }
    const kill = () => { for (const n of s.nodes) { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} } for (const g of s.graph) { try { g.disconnect(); } catch (e) {} } };
    if (this.ctx.constructor.name.startsWith('Offline')) kill(); else setTimeout(kill, 80);
  }

  // Schedule the score from clip time `from`, so that clip time t sounds at
  // context time at0 + (t − from). Everything is scheduled at once.
  play(score, times, from = 0, at0 = this.ctx.currentTime + 0.06) {
    this.stop();
    const ctx = this.ctx, S = { nodes: [], graph: [], roots: [] }; this.session = S;
    const when = t => at0 + (t - from), hz = MIX.curveHz, dur = score.dur;
    if (dur - from < 0.05) return;
    const C = score.curves, curveDur = Math.max(0.05, dur - from);
    const auto = (param, values) => { param.setValueAtTime(values[0], Math.max(0, at0 - 0.01)); param.setValueCurveAtTime(values, at0, curveDur); };
    const mk = (dest) => { const g = ctx.createGain(); g.connect(dest); S.graph.push(g); return g; };

    // per part: session root → part bus; the chorale gets three layer buses and a low-pass
    const bus = {};
    for (const p of PARTS) {
      const root = mk(this.part[p].g); S.roots.push(root);
      if (CHORALE.includes(p)) {
        const D = C[DYN_OF[p]] || C.dyn;                          // this voice's own dynamic
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.connect(root); S.graph.push(lp);
        auto(lp.frequency, resample(times, C.bright, from, hz, (b, j, u) => { const d = D[j] + (D[j + 1] - D[j]) * u; return 700 * Math.pow(2, 4.2 * Math.min(1, 0.55 * b + 0.6 * d)); }));
        const soft = mk(lp), full = mk(lp), trem = mk(lp);
        const lv = d => Math.pow(d, MIX.loudExp);
        const dm = fn => resample(times, D, from, hz, (d, j, u) => fn(d, C.trem[j] + (C.trem[j + 1] - C.trem[j]) * u));
        auto(soft.gain, dm((d, m) => lv(d) * Math.cos(d * Math.PI / 2) * (1 - 0.85 * m)));
        auto(full.gain, dm((d, m) => lv(d) * Math.sin(d * Math.PI / 2) * (1 - 0.85 * m) * 1.1));
        auto(trem.gain, dm((d, m) => lv(d) * m * 1.25));
        bus[p] = { legato_p: soft, legato_f: full, tremolo: trem };
      } else if (p === 'solo' || p === 'vcl') {
        const g = mk(root); auto(g.gain, resample(times, C.solo, from, hz, x => 0.25 + 0.75 * x));
        bus[p] = { line: g };
      } else { const g = mk(root); auto(g.gain, resample(times, C.on, from, hz)); bus[p] = { shot: g }; }
    }
    const voice = (e, dest, t0, t1, gain, att, rel, loop) => {
      const buf = this.samples.get(ctx, e); if (!buf) return;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const midi = voice.midi; src.playbackRate.value = Math.pow(2, (midi - e.midi) / 12);
      const g = ctx.createGain(); src.connect(g); g.connect(dest);
      const a0 = Math.max(when(t0), at0), late = Math.max(0, from - t0);
      let offset = 0;
      if (loop) {
        src.loop = true; src.loopStart = e.loopStart; src.loopEnd = e.loopEnd;
        if (late > 0.05) { const len = e.loopEnd - e.loopStart; offset = e.loopStart + ((late * src.playbackRate.value) % len); att = 0.06; }   // joined mid-note: inside the loop
        const a1 = when(t1);
        g.gain.setValueAtTime(0, a0); g.gain.linearRampToValueAtTime(gain, a0 + att);
        g.gain.setValueAtTime(gain, Math.max(a0 + att, a1)); g.gain.linearRampToValueAtTime(0, Math.max(a0 + att, a1) + rel);
        src.start(a0, offset); src.stop(Math.max(a0 + att, a1) + rel + 0.05);
      } else {
        if (late > 0.02) return;                               // a one-shot already past its attack: skip
        g.gain.setValueAtTime(gain, a0); src.start(a0);
      }
      S.nodes.push(src); S.graph.push(g);
    };

    for (const n of score.notes) {
      if (n.t1 <= from && n.art === 'sus') continue;
      if (n.t0 < from - 0.02 && n.art !== 'sus') continue;
      const set = PART_INFO[n.part].set; voice.midi = n.midi;
      if (n.art !== 'sus') {
        const e = this.samples.pick(set, n.art === 'pluck' ? 'pluck' : 'pizz', n.midi);
        if (e) voice(e, bus[n.part].shot, n.t0, n.t1, n.vel, 0, 0, false);
      } else if (CHORALE.includes(n.part)) {
        for (const art of ['legato_p', 'legato_f', 'tremolo']) {
          const e = this.samples.pick(set, art, n.midi);
          if (e) voice(e, bus[n.part][art], n.t0, n.t1, n.vel, art === 'tremolo' ? 0.12 : MIX.attack.chord, MIX.release.chord, true);
        }
      } else {
        const v = n.vel;                                         // a line note: soft and full bow by its own strength
        const ep = this.samples.pick(set, 'legato_p', n.midi), ef = this.samples.pick(set, 'legato_f', n.midi);
        if (ep) voice(ep, bus[n.part].line, n.t0, n.t1, Math.cos(v * Math.PI / 2) * (0.5 + 0.5 * v), MIX.attack.line * 1.4, MIX.release.line, true);
        if (ef) voice(ef, bus[n.part].line, n.t0, n.t1, Math.sin(v * Math.PI / 2) * (0.5 + 0.5 * v), MIX.attack.line, MIX.release.line, true);
      }
    }
    S.at0 = at0; S.from = from;
  }

  // ── live: the score is still being written (Arranger.step), one frame at a time ──
  // liveStart(score), then liveFrame(i, t) after every step: new notes start now, notes that have
  // been given an end are released, and the frame's curves steer the layers.
  liveStart(score) {
    this.stop();
    const ctx = this.ctx, S = { nodes: [], graph: [], roots: [], live: true, score, next: 0, open: [], bus: {} }; this.session = S;
    const mk = (dest, v = 0) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); S.graph.push(g); return g; };
    for (const p of PARTS) {
      const root = mk(this.part[p].g, 1); S.roots.push(root);
      if (CHORALE.includes(p)) {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 2000; lp.connect(root); S.graph.push(lp);
        S.bus[p] = { lp, legato_p: mk(lp), legato_f: mk(lp), tremolo: mk(lp) };
      } else if (p === 'solo' || p === 'vcl') S.bus[p] = { line: mk(root) };
      else S.bus[p] = { shot: mk(root) };
    }
  }
  liveFrame(i, t) {
    const S = this.session; if (!S || !S.live) return;
    const ctx = this.ctx, now = ctx.currentTime + 0.02, C = S.score.curves, set = (param, v) => param.setTargetAtTime(v, now, 0.03);
    for (const p of PARTS) {
      const b = S.bus[p];
      if (b.lp) {
        const d = (C[DYN_OF[p]] || C.dyn)[i], m = C.trem[i], lv = Math.pow(d, MIX.loudExp);
        set(b.lp.frequency, 700 * Math.pow(2, 4.2 * Math.min(1, 0.55 * C.bright[i] + 0.6 * d)));
        set(b.legato_p.gain, lv * Math.cos(d * Math.PI / 2) * (1 - 0.85 * m)); set(b.legato_f.gain, lv * Math.sin(d * Math.PI / 2) * (1 - 0.85 * m) * 1.1); set(b.tremolo.gain, lv * m * 1.25);
      } else if (b.line) set(b.line.gain, 0.25 + 0.75 * C.solo[i]); else set(b.shot.gain, C.on[i]);
    }
    const start = (e, dest, n, gain, att, loop) => {
      const buf = e && this.samples.get(ctx, e); if (!buf) return null;
      const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = Math.pow(2, (n.midi - e.midi) / 12);
      const g = ctx.createGain(); src.connect(g); g.connect(dest);
      const a0 = now + Math.max(0, n.t0 - t);
      if (loop) { src.loop = true; src.loopStart = e.loopStart; src.loopEnd = e.loopEnd; g.gain.setValueAtTime(0, a0); g.gain.linearRampToValueAtTime(gain, a0 + att); src.start(a0, t - n.t0 > 0.3 ? e.loopStart : 0); }
      else { g.gain.setValueAtTime(gain, a0); src.start(a0); src.onended = () => { try { g.disconnect(); } catch (err) {} }; }
      S.nodes.push(src); return { src, g, gain, a1: a0 + att };
    };
    const notes = S.score.notes;
    for (; S.next < notes.length; S.next++) {
      const n = notes[S.next], set2 = PART_INFO[n.part].set, pick = art => this.samples.pick(set2, art, n.midi);
      if (n.art !== 'sus') { if (n.t0 >= t - 0.05) start(pick(n.art === 'pluck' ? 'pluck' : 'pizz'), S.bus[n.part].shot, n, n.vel, 0, false); continue; }
      if (n.t1 !== null && n.t1 <= t) continue;                 // over before we came in
      const vs = [];
      if (CHORALE.includes(n.part)) for (const art of ['legato_p', 'legato_f', 'tremolo']) vs.push(start(pick(art), S.bus[n.part][art], n, n.vel, art === 'tremolo' ? 0.12 : MIX.attack.chord, true));
      else { const v = n.vel; vs.push(start(pick('legato_p'), S.bus[n.part].line, n, Math.cos(v * Math.PI / 2) * (0.5 + 0.5 * v), MIX.attack.line * 1.4, true), start(pick('legato_f'), S.bus[n.part].line, n, Math.sin(v * Math.PI / 2) * (0.5 + 0.5 * v), MIX.attack.line, true)); }
      S.open.push({ n, vs: vs.filter(Boolean), rel: CHORALE.includes(n.part) ? MIX.release.chord : MIX.release.line });
    }
    S.open = S.open.filter(o => {
      if (o.n.t1 === null) return true;
      for (const v of o.vs) { const a1 = Math.max(v.a1, now + Math.max(0, o.n.t1 - t));
        v.g.gain.cancelScheduledValues(a1); v.g.gain.setValueAtTime(v.gain, a1); v.g.gain.linearRampToValueAtTime(0, a1 + o.rel); v.src.stop(a1 + o.rel + 0.05);
        v.src.onended = () => { try { v.g.disconnect(); } catch (err) {} const k = S.nodes.indexOf(v.src); if (k >= 0) S.nodes.splice(k, 1); }; }
      return false;
    });
  }
  // clip time now, while a session plays
  time() { return this.session && !this.session.live ? this.session.from + (this.ctx.currentTime - this.session.at0) : null; }
}

// render the whole score offline → AudioBuffer (stereo)
export async function render(score, times, samples, mix = {}, tail = 3, sampleRate = 44100) {
  const ctx = new OfflineAudioContext(2, Math.ceil((score.dur + tail) * sampleRate), sampleRate);
  await samples.load(ctx, samples.needed(score));
  const p = new Player(ctx, samples, mix);
  p.play(score, times, 0, 0.05);
  return ctx.startRendering();
}

export function wavBlob(buf) {
  const n = buf.length, ch = buf.numberOfChannels, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, d[c][i])); out.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}
