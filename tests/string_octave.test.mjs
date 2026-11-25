// web/orchestra: the map of chords, the voicing, the arranger on a synthetic body, the MIDI file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNALS } from '../web/experiments/string-octave/analyze.js';
import { arrange, Arranger, chordOf, voice, DEFAULTS, PART_INFO } from '../web/experiments/string-octave/arrange.js';
import { smf, messages, CHANNEL, MidiOut, MIDI_OPTS } from '../web/experiments/string-octave/midi.js';
import { bowsOf } from '../web/experiments/string-octave/song.js';
import { carriers, SONG_MIX } from '../web/experiments/string-octave/sampler.js';
import { Octave, RULE } from '../web/experiments/string-octave/octave.js';
import { judge } from '../web/experiments/string-octave/judge.js';

// a body described by hand: `shape(t)` returns the signals that differ from standing still
function body(dur, shape, events = []) {
  const n = Math.round(dur * 30), t = Array.from({ length: n }, (_, i) => i / 30), sig = {};
  for (const k of SIGNALS) sig[k] = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = { seen: 1, near: 0.12, level: 1, fold: 0, invert: 0, axis: 0, openness: 0.3, energy: 0.2, top: 1, space: 0.7, ...shape(t[i]) };
    for (const k in s) sig[k][i] = s[k];
  }
  return { n, t, sig, events, dur };
}
const degs = s => s.chords.map(c => c.deg);
const MAP = { mode: 'map' };

test('chords are spelled in the key', () => {
  assert.deepEqual(chordOf('I', 2, 0).pcs, [2, 6, 9]);                 // D major
  assert.deepEqual(chordOf('iv', 2, 0).pcs, [7, 10, 2]);               // G minor, borrowed
  assert.equal(chordOf('♭VI', 2, 0).symbol, 'B♭');
  assert.ok(chordOf('I', 2, 2).pcs.includes(1) && chordOf('I', 2, 2).pcs.includes(4));   // maj7 and 9
});

test('voicing: ordered parts, the third present, common tones held', () => {
  const I = chordOf('I', 2, 0), vi = chordOf('vi', 2, 0);
  const a = voice(I, null, 0.5, 0, DEFAULTS, true);
  assert.ok(a.cb < a.vc && a.vc < a.va && a.va < a.vn2 && a.vn2 < a.vn1);
  for (const p of ['cb', 'vc', 'va', 'vn2', 'vn1']) assert.ok(a[p] >= PART_INFO[p].lo && a[p] <= PART_INFO[p].hi && I.pcs.includes(a[p] % 12));
  assert.ok([a.vc, a.va, a.vn2, a.vn1].some(m => m % 12 === I.third));
  const b = voice(vi, a, 0.5, 0, DEFAULTS, true);                       // D → Bm share D and F♯
  const moved = ['vc', 'va', 'vn2', 'vn1'].reduce((q, p) => q + Math.abs(b[p] - a[p]), 0);
  assert.ok(moved <= 6, `the upper parts moved ${moved} semitones in all`);
  const closed = voice(I, null, 0, 0, DEFAULTS, false), open = voice(I, null, 1, 1, DEFAULTS, true);
  assert.equal(closed.cb, null);
  assert.ok(open.vn1 - open.vc > closed.vn1 - closed.vc + 7, 'an open body spreads the parts');
});

test('standing is home; a fold goes dark; rising comes home through V', () => {
  const s = arrange(body(20, t => (t > 5 && t < 10 ? { fold: 0.9, level: 0.75 } : {})), MAP);
  assert.deepEqual(degs(s), ['I', '♭VI', 'V', 'I']);
  assert.ok(s.chords[1].t > 5 && s.chords[1].t < 6.2, 'the fold is heard within about a second');
  assert.ok(s.chords[3].t - s.chords[2].t >= DEFAULTS.cadenceS - 0.05);
});

test('a lean on the axis picks the side; a shape passed through quickly is not a place', () => {
  assert.deepEqual(degs(arrange(body(12, t => (t > 4 && t < 8 ? { axis: -30 } : {})), MAP)), ['I', 'IV', 'I']);
  assert.deepEqual(degs(arrange(body(12, t => (t > 4 && t < 8 ? { axis: 30, level: 0.7 } : {})), MAP)), ['I', 'iii', 'I']);
  assert.deepEqual(degs(arrange(body(12, t => (t > 4 && t < 4.3 ? { axis: 30, move: 0.6 } : {})), MAP)), ['I']);
});

test('arm strokes sing, in the key, and stillness lets the line go', () => {
  const ev = [2, 3, 4, 5].map((t, i) => ({ t, type: 'stroke', limb: 'rh', kind: 'rest', dir: [0, 1], path: 1, peak: 3, straight: 1, up: 0.3 + 0.15 * i, h: 0.8 }));
  ev.push({ t: 6, type: 'still' });
  const s = arrange(body(12, () => ({})), MAP), s2 = arrange(body(12, () => ({}), ev), MAP);
  assert.equal(s.notes.filter(n => n.part === 'solo').length, 0);
  const line = s2.notes.filter(n => n.part === 'solo');
  assert.equal(line.length, 4);
  for (let i = 1; i < line.length; i++) assert.ok(line[i].midi > line[i - 1].midi, 'rising strokes rise');
  const scale = chordOf('I', DEFAULTS.key, 0).scale;
  for (const n of line) assert.ok(scale.includes(n.midi % 12));
  assert.ok(line[3].t1 <= 6.7, 'the last note ends with the stillness');
});

test('offstage is silent, and the score makes a MIDI file', () => {
  const s = arrange(body(14, t => (t > 5 ? { near: 0.5 } : {})), MAP);
  assert.ok(s.curves.dyn[30 * 4] > 0.2, 'sounding while she is there');
  assert.ok(s.curves.dyn[s.curves.dyn.length - 1] < 0.03, 'faded once she has walked up to the camera');
  const t = Array.from({ length: s.curves.dyn.length }, (_, i) => i / 30), f = smf(s, t);
  assert.equal(String.fromCharCode(...f.slice(0, 4)), 'MThd');
  const m = messages(s, t), on = m.filter(x => (x.bytes[0] & 0xf0) === 0x90).length, off = m.filter(x => (x.bytes[0] & 0xf0) === 0x80).length;
  assert.equal(on, off); assert.ok(on >= 4);
});

// ── the octave texture ──
const mod = x => ((x % 12) + 12) % 12;
test('rule of the octave: every bass degree has its chord, up and down, with the bass first', () => {
  for (const m of ['major', 'minor']) for (const dir of ['up', 'down']) {
    assert.equal(RULE[m][dir].length, 7);
    RULE[m][dir].forEach(([pcs, fig], d) => { assert.equal(pcs[0], RULE[m][dir === 'up' ? 'scaleUp' : 'scaleDown'][d], `${m} ${dir} degree ${d + 1} (${fig})`); assert.ok(pcs.length >= 3); });
  }
  const o = new Octave({ ...DEFAULTS, key: 0 }, [], []);
  assert.deepEqual(o.chord(3, 1).pcs, [5, 9, 0, 2]);       // on 4 going up: 6/5 (F A C D)
  assert.deepEqual(o.chord(3, -1).pcs, [5, 7, 11, 2]);     // on 4 coming down: 4/2 (F G B D)
  assert.deepEqual(o.chord(5, -1).pcs, [9, 0, 2, 6]);      // on 6 coming down: ♯6/4/3 (A C D F♯)
});

test('the bass walks down by step as she lowers and back up as she rises, and ends at home', () => {
  const s = arrange(body(30, t => (t > 5 && t < 15 ? { level: 0.62 } : {})));
  const bass = s.chords.map(c => c.voicing.cb);
  for (let i = 1; i < bass.length; i++) assert.ok(Math.abs(bass[i] - bass[i - 1]) <= 2, 'the bass moves by step');
  const low = Math.min(...bass), top = bass[0];
  assert.ok(top - low >= 4, 'it goes down at least to the dominant');
  assert.equal(s.chords[0].deg, '1'); assert.equal(s.chords[s.chords.length - 1].deg, '1');
  assert.equal(bass[bass.length - 1], top, 'and comes back to the upper tonic');
  for (const c of s.chords) { const v = c.voicing; assert.ok(v.cb < v.vc && v.vc < v.va && v.va < v.vn1, 'no crossed voices'); }
});

test('raising the hand walks the top line up the scale; lowering it brings it down', () => {
  const s = arrange(body(20, t => ({ hands: t > 3 && t < 12 ? 0.4 : 0, reachUp: t < 3 ? 0.2 : t < 7 ? 0.2 + 0.2 * (t - 3) : t < 12 ? 1 - 0.16 * (t - 7) : 0.2 })));
  const line = s.notes.filter(n => n.part === 'vn1' && n.src === 'hands');
  assert.ok(line.length >= 6, `the hands played ${line.length} notes`);
  const peak = line.reduce((b, n) => (n.midi > b.midi ? n : b));
  assert.ok(peak.t0 > 4 && peak.t0 < 9.5 && peak.midi - line[0].midi >= 7, 'up at least a fifth while the hand rises');
  assert.ok(line[line.length - 1].midi < peak.midi - 4, 'and down again');
  const scale = [0, 2, 4, 5, 7, 9, 11].map(x => mod(x + DEFAULTS.key));
  for (const n of line) assert.ok(scale.includes(mod(n.midi)), 'in the key');
});

test('each voice has its own dynamic, and the four voices go out on channels 1 to 4', () => {
  const s = arrange(body(12, t => ({ hands: t > 3 && t < 6 ? 0.8 : 0.02, spLF: t > 7 && t < 10 ? 0.6 : 0, energy: 0.1 })));
  const at = (k, t) => s.curves[k][Math.round(t * 30)];
  assert.ok(at('dynTop', 5) > at('dynBass', 5) + 0.05, 'hands swell the top voice');
  assert.ok(at('dynBass', 9.5) > at('dynBass', 7) + 0.04, 'legs swell the bass');
  assert.ok(at('dynTop', 7.5) > 0.6 * at('dynTop', 5.9), 'a swell falls slowly when the movement stops');
  assert.deepEqual([CHANNEL.vn1, CHANNEL.va, CHANNEL.vc, CHANNEL.cb], [1, 2, 3, 4]);
  const j = judge(body(12, () => ({})), arrange(body(12, () => ({}))));
  assert.ok(j.total >= 0 && j.total <= 1 && Object.values(j.scores).every(x => x >= 0 && x <= 1));
});

test('live: frame by frame gives the same score, and live MIDI closes every note it opens', () => {
  const a = body(20, t => ({ level: t > 6 && t < 13 ? 0.45 : 1, fold: t > 8 && t < 12 ? 0.8 : 0, hands: t % 4 < 2 ? 0.5 : 0.02, reachUp: 0.3 + 0.5 * Math.abs(Math.sin(t)), move: t % 5 < 3 ? 0.3 : 0.02 }));
  const whole = arrange(a), R = new Arranger(a), sent = [], midi = new MidiOut();
  midi.port = { send: b => sent.push(b) }; midi.liveStart(R.score);
  let openAtSomePoint = 0;
  for (let i = 0; i < a.n; i++) { R.step(i); midi.liveFrame(i, a.t[i]); openAtSomePoint = Math.max(openAtSomePoint, R.score.notes.filter(n => n.t1 === null).length); }
  midi.stop(); const live = R.finish(a.dur);
  const key = s => s.notes.map(n => `${n.part}${n.midi}@${n.t0.toFixed(3)}-${n.t1.toFixed(3)}`).join(' ');
  assert.equal(key(live), key(whole));
  assert.ok(openAtSomePoint >= 4, 'four voices sound while the score is being written');
  const count = {}; for (const b of sent) { const k = (b[0] & 0x0f) + ':' + b[1]; if ((b[0] & 0xf0) === 0x90) count[k] = (count[k] || 0) + 1; if ((b[0] & 0xf0) === 0x80) count[k] = (count[k] || 0) - 1; }
  assert.ok(Object.keys(count).length > 5 && Object.values(count).every(x => x === 0), 'every note-on has its note-off');
  assert.ok(sent.some(b => (b[0] & 0xf0) === 0xB0 && b[1] === 11), 'dynamics go out on CC 11');
});

// ── Song: sung lines, no harmony ──
// a hand at ladder place j (0 = lowest note … 9 = highest, with the default range)
const UP = j => j / 9 * 1.05 - 0.05, SONG = { mode: 'song', sngVoices: 1 }, DUET = { mode: 'song', sngVoices: 2 };
const DORIAN = [0, 2, 3, 5, 7, 9, 10].map(x => mod(x + DEFAULTS.key));
const line = (s, k = 1) => s.notes.filter(n => n.part === 's' + k);
const fr = t => Math.round(t * 30);

test('song: a slow hand steps up the scale; a fast hand holds its note and leaps to where it lands', () => {
  // the right hand rises slowly for 8 s (about one note a second), then drops in 0.4 s
  const up = t => (t < 1 ? UP(0) : t < 9 ? UP(0) + (UP(9) - UP(0)) * (t - 1) / 8 : t < 9.4 ? UP(9) + (UP(1) - UP(9)) * (t - 9) / 0.4 : UP(1));
  const s = arrange(body(13, t => ({ upR: up(t), upL: -0.4, spRH: t > 0.5 && t < 12 ? 0.15 : 0, vyR: (up(t + 1 / 30) - up(t)) * 30 * 1.9 })), SONG);
  assert.equal(s.mode, 'song'); assert.equal(s.chords.length, 0, 'no harmony');
  const L = line(s), rise = L.filter(n => n.t0 < 9);
  assert.ok(rise.length >= 9, `the rise sang ${rise.length} notes`);
  for (let i = 1; i < rise.length; i++) { assert.ok(rise[i].midi - rise[i - 1].midi >= 1 && rise[i].midi - rise[i - 1].midi <= 2, 'by step'); assert.ok(rise[i].slur, 'under one bow'); }
  for (const n of L) assert.ok(DORIAN.includes(mod(n.midi)), 'in the scale');
  const top = rise[rise.length - 1], after = L.filter(n => n.t0 > top.t0);
  assert.ok(after.length >= 1 && top.midi - after[0].midi >= 9, `then one leap down (${top.midi} → ${after[0] && after[0].midi}), no scale in between`);
  const P = s.curves.pitch1; let jump = 0; for (let i = fr(1.2); i < fr(12); i++) jump = Math.max(jump, Math.abs(P[i] - P[i - 1]));
  assert.ok(jump < 4, `the pitch glides, it never jumps (largest move in a frame: ${jump.toFixed(2)} semitones)`);
  assert.ok(Math.abs(P[fr(9.3)] - top.midi) < 4, 'the note is held while the hand flies');
});

test('song: a fist lifts the bow, an open hand sets it again; a hanging hand rests the line', () => {
  const s = arrange(body(16, t => ({ upR: t > 11 && t < 14 ? -0.35 : UP(4), upL: -0.4, spRH: 0.15, fistR: t > 4 && t < 6 ? 0.9 : 0.02 })), SONG);
  const g = s.curves.gate1, amp = s.curves.amp1;
  assert.ok(g[fr(3)] === 1 && amp[fr(3)] > 0.3, 'sounding while the hand is open');
  assert.ok(g[fr(4.4)] === 0 && amp[fr(5.5)] < 0.02, 'the fist: silence');
  assert.ok(g[fr(6.5)] === 1 && amp[fr(7.5)] > 0.3, 'open again: sounding');
  const bows = line(s).filter(n => !n.slur).map(n => n.t0);
  assert.ok(bows.some(t => t > 5.9 && t < 6.6), 'with a new bow');
  assert.ok(g[fr(12.5)] === 0 && amp[fr(13.5)] < 0.05, 'a hand hanging at her side rests the line');
  assert.ok(g[fr(15)] === 1, 'and lifting it starts the next phrase');
  assert.equal(bowsOf(s, s.curves.amp1 && body(16, () => ({})).t, 1).length, bows.length, 'bowsOf: one stretch a bow');
});

test('song: vibrato grows into a held note; the bow follows the hand; a rising line is louder', () => {
  const s = arrange(body(14, t => ({ upR: t < 7 ? UP(2) : UP(7), upL: -0.4, spRH: t > 3 && t < 4 ? 0.3 : 0.08 })), SONG), C = s.curves;
  assert.ok(C.vib1[fr(0.3)] < 0.05 && C.vib1[fr(2.8)] > 0.25, 'none at first, then it grows');
  assert.ok(C.vib1[fr(7.25)] < 0.5 * C.vib1[fr(6.8)], 'it stops when the line moves');
  assert.ok(C.amp1[fr(3.9)] > C.amp1[fr(2.9)] + 0.08, 'a faster hand is a faster bow');
  assert.ok(C.amp1[fr(6.5)] < C.amp1[fr(4.1)], 'and the swell falls back');
  assert.ok(C.amp1[fr(12)] > C.amp1[fr(2.9)] + 0.04, 'the same bow higher up is louder');
});

test('duet: level hands sing in tenths; a held dissonance melts by step', () => {
  const CONS = [0, 3, 4, 7, 8, 9];
  // both hands at place 4; from 5 s the left creeps up one place (a ninth against the upper line) and stays
  const upL = t => (t < 5 ? UP(4) : t < 6 ? UP(4) + (UP(5) - UP(4)) * (t - 5) : UP(5));
  const s = arrange(body(12, t => ({ upR: UP(4), upL: upL(t), spRH: 0.1, spLH: 0.1, vyL: (upL(t + 1 / 30) - upL(t)) * 30 * 1.9 })), DUET), C = s.curves;
  assert.equal(s.song.voices, 2);
  const iv = t => Math.round(C.pitch1[fr(t)]) - Math.round(C.pitch2[fr(t)]);
  assert.ok([15, 16].includes(iv(4)), `a tenth when the hands are level (${iv(4)} semitones)`);
  const lower = line(s, 2);
  assert.ok(lower.some(n => n.t0 > 5 && !CONS.includes(mod(Math.round(C.pitch1[fr(n.t0)]) - n.midi))), 'the creeping hand makes a dissonance');
  assert.ok(CONS.includes(mod(iv(9))), `which has resolved (${iv(9)} semitones)`);
  const diss = lower.find(n => n.t0 > 5 && !CONS.includes(mod(Math.round(C.pitch1[fr(n.t0)]) - n.midi))), res = lower.find(n => n.t0 > diss.t0);
  assert.ok(res && Math.abs(res.midi - diss.midi) <= 2 && res.t0 - diss.t0 >= DEFAULTS.sngSettleS - 0.2, 'by step, after it has been held');
});

test('song: live gives the same score; MIDI as bows with pitch bend, or as slurred notes; the judge reads it', () => {
  const a = body(20, t => ({ upR: UP(4.5 + 4 * Math.sin(t)), upL: UP(4.5 + 4 * Math.sin(0.7 * t + 1)), spRH: t % 6 < 4.5 ? 0.2 : 0, spLH: 0.15, vyR: 4 * Math.cos(t) * 1.05 / 9 * 1.9,
                             vyL: 2.8 * Math.cos(0.7 * t + 1) * 1.05 / 9 * 1.9, fistL: t > 8 && t < 10 ? 0.9 : 0, move: 0.2 }));
  const whole = arrange(a, DUET), R = new Arranger(a, DUET), sent = [], midi = new MidiOut();
  midi.port = { send: b => sent.push(b) }; MIDI_OPTS.song = 'bend'; midi.liveStart(R.score);
  let most = 0; const held = new Map();
  for (let i = 0; i < a.n; i++) { R.step(i); const from = sent.length; midi.liveFrame(i, a.t[i]);
    for (const b of sent.slice(from)) { const k = (b[0] & 15) + ':' + b[1]; if ((b[0] & 0xf0) === 0x90) held.set(k, 1); if ((b[0] & 0xf0) === 0x80) held.delete(k); }
    for (const ch of [0, 2]) most = Math.max(most, [...held.keys()].filter(k => k.startsWith(ch + ':')).length); }
  midi.stop(); const live = R.finish(a.dur);
  const key = s => s.notes.map(n => `${n.part}${n.midi}@${n.t0.toFixed(3)}-${n.t1.toFixed(3)}${n.slur ? 's' : ''}`).join(' ');
  assert.equal(key(live), key(whole));
  assert.ok(line(whole).length > 8 && line(whole, 2).length > 8, 'two lines');
  assert.equal(most, 1, 'one note at a time on each channel');
  assert.ok(sent.some(b => (b[0] & 0xf0) === 0xE0) && sent.some(b => (b[0] & 0xf0) === 0xB0 && b[1] === 1), 'pitch bend and vibrato go out');
  const m = messages(whole, a.t), ons = m.filter(x => (x.bytes[0] & 0xf0) === 0x90), offs = m.filter(x => (x.bytes[0] & 0xf0) === 0x80);
  assert.equal(ons.length, bowsOf(whole, a.t, 1).length + bowsOf(whole, a.t, 2).length); assert.equal(ons.length, offs.length);
  assert.deepEqual([...new Set(ons.map(x => (x.bytes[0] & 15) + 1))].sort(), [CHANNEL.s1, CHANNEL.s2]);
  // the bend of every bow stays inside the range, and returns the pitch curve
  const b0 = bowsOf(whole, a.t, 1)[0], pb = m.find(x => (x.bytes[0] & 0xff) === 0xE0 && x.t >= b0.t0 + 0.5);
  const semis = ((pb.bytes[1] | (pb.bytes[2] << 7)) - 8192) / 8192 * MIDI_OPTS.bendRange;
  assert.ok(Math.abs(b0.midi + semis - whole.curves.pitch1[fr(pb.t)]) < 0.3, 'note + bend is the pitch curve');
  MIDI_OPTS.song = 'notes'; const m2 = messages(whole, a.t);
  assert.equal(m2.filter(x => (x.bytes[0] & 0xf0) === 0x90).length, whole.notes.length); assert.ok(!m2.some(x => (x.bytes[0] & 0xf0) === 0xE0));
  assert.ok(smf(whole, a.t).length > 500);
  const j = judge(a, whole); assert.ok(j.total > 0 && j.total <= 1 && Object.values(j.scores).every(x => x >= 0 && x <= 1));
  assert.deepEqual(Object.keys(j.scores).sort(), ['expression', 'fit', 'line', 'phrasing', 'together']);
});

test('song sound: every sounding stretch is carried by recordings near its pitch', () => {
  const a = body(12, t => ({ upR: UP(4.5 + 4.4 * Math.sin(0.8 * t)), upL: -0.4, spRH: t > 5 && t < 7 ? 0 : 0.2, fistR: t > 5 && t < 7 ? 0.9 : 0, vyR: 0.5 })), s = arrange(a, SONG);
  const entries = [55, 59, 63, 67, 71, 75, 79, 83].map(midi => ({ midi, file: 'x' + midi }));
  const fake = { pick: (set, art, m) => entries.reduce((b, e) => (Math.abs(e.midi - m) < Math.abs(b.midi - m) ? e : b)) };
  const cs = carriers(fake, 'vn1', a.t, s.curves.amp1, s.curves.pitch1, a.n);
  assert.ok(cs.length >= 4 && cs.filter(c => c.first).length === cs.filter(c => c.last).length, 'stretches open and close');
  for (const c of cs) for (let i = fr(c.ta); i < fr(c.tb); i++) assert.ok(Math.abs(s.curves.pitch1[i] - c.e.midi) <= SONG_MIX.far + 2.5, 'never far from the pitch');
  let covered = 0, sounding = 0; for (let i = 0; i < a.n; i++) if (s.curves.amp1[i] > 0.004) { sounding++; if (cs.some(c => a.t[i] >= c.ta && a.t[i] <= c.tb)) covered++; }
  assert.equal(covered, sounding, 'all of it');
});
