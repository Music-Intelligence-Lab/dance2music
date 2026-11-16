// The score as MIDI: a Standard MIDI File, and live out through Web MIDI (on a
// Mac: the IAC Driver bus into Ableton Live or Logic, where the real string
// instruments are).
//
// One channel per part (10 is left free for drums, as in the rope's Live set):
//    1 soprano (Violins I)   2 alto (Violas)   3 tenor (Cellos)   4 bass (Basses)     ← the rope set's four SWAM tracks
//    5 Violins II (chord-map texture only)   6 arm line   7 leg line   8 harp   9 accents (pizz.)   11 steps (bass pizz.)
// Controllers on the sustained parts, 20 per second:
//    CC 11   each voice's own dynamic (SWAM expression)
//    CC 1    vibrato depth, growing into each held note (SWAM); or the dynamic again (MIDI_OPTS.cc1 = 'dynamic', Spitfire)
//    CC 21            tremolo amount        CC 74   brightness
// The file is format 1, 480 PPQ at 120 bpm, so one second is exactly 960 ticks.
import { PART_INFO, PARTS, DYN_OF } from './arrange.js';

export const CHANNEL = { vn1: 1, va: 2, vc: 3, cb: 4, vn2: 5, solo: 6, vcl: 7, harp: 8, pzh: 9, pzb: 11 };
export const MIDI_OPTS = { cc1: 'vibrato' };          // 'vibrato' (SWAM) or 'dynamic' (Spitfire and most samplers)
const CHORALE = ['cb', 'vc', 'va', 'vn2', 'vn1'], CC_HZ = 20;
const c7 = x => Math.max(0, Math.min(127, Math.round(127 * x)));

// every MIDI message of the score: [{t, bytes}] sorted by time
export function messages(score, times) {
  const out = [], C = score.curves, dur = score.dur;
  const at = (arr, t, j) => { while (j.i < times.length - 2 && times[j.i + 1] < t) j.i++; return arr[j.i]; };
  for (const p of PARTS) {
    const ch = CHANNEL[p] - 1, sus = CHORALE.includes(p) || p === 'solo' || p === 'vcl';
    for (const n of score.notes) if (n.part === p) {
      const D0 = C[DYN_OF[p]]; let vel = n.vel;
      if (D0) { let q = 0; while (q < times.length - 1 && times[q] < n.t0) q++; vel = 0.3 + 0.55 * D0[q]; }      // a sustained part's attack follows its dynamic
      vel = Math.max(1, c7(vel));
      out.push({ t: n.t0, bytes: [0x90 | ch, n.midi, vel] });
      out.push({ t: Math.max(n.t0 + 0.05, n.art === 'sus' ? n.t1 : n.t0 + 0.25), bytes: [0x80 | ch, n.midi, 0], off: true });
    }
    if (!sus) continue;
    const last = {}, j = { i: 0 }, mine = score.notes.filter(n => n.part === p && n.art === 'sus'); let ni = 0;
    for (let t = 0; t <= dur; t += 1 / CC_HZ) {
      const dyn = CHORALE.includes(p) ? at(C[DYN_OF[p]] || C.dyn, t, j) : 0.25 + 0.75 * at(C.solo, t, j);
      // vibrato grows into a held note (nothing for the first 0.3 s, full after 1.3 s) and with the dynamic
      while (ni < mine.length - 1 && mine[ni + 1].t0 <= t) ni++;
      const age = mine.length && mine[ni].t0 <= t && t < mine[ni].t1 ? t - mine[ni].t0 : 0;
      const vib = Math.max(0, Math.min(1, (age - 0.3) / 1.0)) * (0.2 + 0.5 * dyn);
      const vals = { 11: c7(dyn), 1: c7(MIDI_OPTS.cc1 === 'vibrato' ? vib : dyn) };
      if (CHORALE.includes(p)) { vals[21] = c7(C.trem[j.i]); vals[74] = c7(C.bright[j.i]); }
      for (const [cc, v] of Object.entries(vals)) if (last[cc] !== v) { last[cc] = v; out.push({ t, bytes: [0xB0 | ch, +cc, v], cc: true }); }
    }
  }
  // at the same instant: controllers, then note-offs, then note-ons
  const rank = m => (m.cc ? 0 : m.off ? 1 : 2);
  return out.sort((a, b) => a.t - b.t || rank(a) - rank(b));
}

export function smf(score, times) {
  const vlq = n => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const msgs = messages(score, times), tracks = [];
  const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
  const text = s => [...new TextEncoder().encode(s)];
  tracks.push([0, ...meta(0x51, [0x07, 0xa1, 0x20]), 0, ...meta(0x03, text('dance2music string octave')), 0, ...meta(0x2f, [])]);
  for (const p of PARTS) {
    const ch = CHANNEL[p] - 1, ev = msgs.filter(m => (m.bytes[0] & 0x0f) === ch);
    if (!ev.length) continue;
    const tr = [0, ...meta(0x03, text(PART_INFO[p].label))]; let tick = 0;
    for (const m of ev) { const k = Math.round(m.t * 960); tr.push(...vlq(Math.max(0, k - tick)), ...m.bytes); tick = Math.max(tick, k); }
    tr.push(0, ...meta(0x2f, [])); tracks.push(tr);
  }
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], u16 = n => [(n >> 8) & 255, n & 255];
  const bytes = [...text('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(480)];
  for (const tr of tracks) bytes.push(...text('MTrk'), ...u32(tr.length), ...tr);
  return new Uint8Array(bytes);
}

// live out: feed the port a little ahead of the clock, so a stop is a stop
export class MidiOut {
  constructor() { this.access = null; this.port = null; this.msgs = null; this.i = 0; this.on = new Map(); }
  supported() { return !!navigator.requestMIDIAccess; }
  async ports() { if (!this.access) this.access = await navigator.requestMIDIAccess(); return [...this.access.outputs.values()].map(p => ({ id: p.id, name: p.name })); }
  select(id) { this.stop(); this.port = id && this.access ? this.access.outputs.get(id) || null : null; }
  load(score, times) { this.msgs = messages(score, times); }
  // start from clip time `from`; clock() returns the clip time now
  start(from) {
    this.stop(); if (!this.port || !this.msgs) return;
    this.i = this.msgs.findIndex(m => m.t >= from); if (this.i < 0) this.i = this.msgs.length;
    // notes already sounding at `from`, and the controllers as they stand
    const cc = new Map(), held = new Map();
    for (let k = 0; k < this.i; k++) { const m = this.msgs[k], b = m.bytes, key = b[0] & 0x0f;
      if (m.cc) cc.set(key + ':' + b[1], b); else if (m.off) held.delete(key + ':' + b[1]); else held.set(key + ':' + b[1], b); }
    for (const b of cc.values()) this.port.send(b);
    for (const b of held.values()) { this.port.send(b); this.on.set((b[0] & 0x0f) + ':' + b[1], true); }
    this.running = true;
  }
  tick(clipNow) {
    if (!this.running || !this.port) return;
    const now = performance.now();
    while (this.i < this.msgs.length && this.msgs[this.i].t < clipNow + 0.15) {
      const m = this.msgs[this.i++], key = (m.bytes[0] & 0x0f) + ':' + m.bytes[1];
      this.port.send(m.bytes, now + Math.max(0, (m.t - clipNow) * 1000));
      if (!m.cc) { if (m.off) this.on.delete(key); else this.on.set(key, true); }
    }
  }
  // live: the score is still being written. liveStart(score), then liveFrame(i, t) after every Arranger.step
  liveStart(score) { this.stop(); this.live = { score, next: 0, open: [], last: {}, ccAt: -1 }; }
  liveFrame(i, t) {
    const L = this.live; if (!L || !this.port) return;
    const now = performance.now(), C = L.score.curves, notes = L.score.notes, at = x => now + Math.max(0, (x - t) * 1000);
    if (t - L.ccAt >= 1 / CC_HZ) { L.ccAt = t;
      for (const p of PARTS) { const sus = CHORALE.includes(p) || p === 'solo' || p === 'vcl'; if (!sus) continue;
        const ch = CHANNEL[p] - 1, dyn = CHORALE.includes(p) ? (C[DYN_OF[p]] || C.dyn)[i] : 0.25 + 0.75 * C.solo[i];
        const held = L.open.find(o => o.ch === ch), age = held ? t - held.n.t0 : 0, vib = Math.max(0, Math.min(1, (age - 0.3) / 1.0)) * (0.2 + 0.5 * dyn);
        const vals = { 11: c7(dyn), 1: c7(MIDI_OPTS.cc1 === 'vibrato' ? vib : dyn) };
        if (CHORALE.includes(p)) { vals[21] = c7(C.trem[i]); vals[74] = c7(C.bright[i]); }
        for (const [cc, v] of Object.entries(vals)) if (L.last[ch + ':' + cc] !== v) { L.last[ch + ':' + cc] = v; this.port.send([0xB0 | ch, +cc, v]); } } }
    for (; L.next < notes.length; L.next++) {
      const n = notes[L.next], ch = CHANNEL[n.part] - 1, D0 = C[DYN_OF[n.part]];
      if (n.art !== 'sus') { if (n.t0 < t - 0.05) continue; this.port.send([0x90 | ch, n.midi, Math.max(1, c7(n.vel))], at(n.t0)); this.port.send([0x80 | ch, n.midi, 0], at(n.t0 + 0.25)); continue; }
      if (n.t1 !== null && n.t1 <= t) continue;
      this.port.send([0x90 | ch, n.midi, Math.max(1, c7(D0 ? 0.3 + 0.55 * D0[i] : n.vel))], at(n.t0)); this.on.set(ch + ':' + n.midi, true); L.open.push({ n, ch });
    }
    // a voice's new note starts before the old one ends (a slur for a monophonic instrument): the old note-off follows
    L.open = L.open.filter(o => { if (o.n.t1 === null) return true; this.port.send([0x80 | o.ch, o.n.midi, 0], at(Math.max(o.n.t0 + 0.05, o.n.t1))); this.on.delete(o.ch + ':' + o.n.midi); return false; });
  }
  stop() {
    this.live = null;
    this.running = false; if (!this.port) return;
    const t = performance.now() + 160;                      // after anything already queued
    for (const key of this.on.keys()) { const [ch, note] = key.split(':').map(Number); this.port.send([0x80 | ch, note, 0], t); }
    this.on.clear();
  }
}
