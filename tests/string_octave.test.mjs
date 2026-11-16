// web/orchestra: the map of chords, the voicing, the arranger on a synthetic body, the MIDI file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNALS } from '../web/experiments/string-octave/analyze.js';
import { arrange, Arranger, chordOf, voice, DEFAULTS, PART_INFO } from '../web/experiments/string-octave/arrange.js';
import { smf, messages, CHANNEL, MidiOut } from '../web/experiments/string-octave/midi.js';
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
