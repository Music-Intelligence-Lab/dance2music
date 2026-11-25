// The body as arranger: a characterised clip (analyze.js) → a score for string
// orchestra. DOM-free and audio-free; causal (a decision at time t reads only
// the past), so the same rules can run from a live camera.
//
// Three things the body does, three jobs in the music:
//
//   SHAPE  → HARMONY   where the weight and the axis are choose the chord;
//                      how much space the body takes voices it
//   LIMBS  → LINES     arm strokes sing in the first violins, leg gestures in
//                      the cellos, steps pluck the basses, circles roll the harp
//   EFFORT → SOUND     how much she moves is the dynamic; sudden, bound
//                      movement turns the bow to tremolo and plucks accents
//
// HARMONY. The chord is a place on a small map, in the key P.key:
//
//                       leaning to       on the        leaning to
//                       camera-left      axis          camera-right
//   standing tall           IV             I               V
//   lowered (lunge, plié)   ii             vi              iii
//   torso horizontal        ───────────── ♭VI ─────────────
//   on the floor (plank)    ─────────────  i  ─────────────
//   head below the hips     ───────────── iv  ─────────────
//
// The lower she goes and the more she folds, the darker the mode (the bottom
// three rows borrow from the minor). The shape is read as she arrives: the faster
// she moves, the slower the reading (P.transit), so a shape passed through is not
// a place. A new place must hold for P.dwellS, then
// the chord changes ON her next landing (a stroke ending, an accent, a foot
// coming down) or after P.waitS at the latest; never sooner than P.minChordS
// after the last change. Coming home from the dark rows passes through V
// (the body's cadence: rising prepares, standing arrives).
//
// VOICING. Five parts (basses, cellos, violas, second and first violins),
// voice-led: common tones are held, the others move by the smallest step.
// `span` (how open the body is) spreads the parts from a close huddle in the
// viola register to four octaves, and brings the basses in; `lift` (how high
// the hands reach) raises the violins. Open shapes add colour (9ths, 7ths).
//
// arrange(analysis, params) → { chords, notes, curves, marks, parts }
//   notes  [{part, art: 'sus'|'pizz'|'pluck', midi, t0, t1, vel, src}]
//   curves per frame, 0..1: dyn (chorale dynamic), trem (tremolo mix),
//          bright, solo (line dynamic), span, lift
import { SIGNALS } from './analyze.js';
import { Octave, OCT_PLACES } from './octave.js';
import { Song, SCALES } from './song.js';

export const PARTS = ['cb', 'vc', 'va', 'vn2', 'vn1', 'solo', 'vcl', 'pzh', 'pzb', 'harp', 's1', 's2'];
export const PART_INFO = {
  cb: { label: 'Basses', set: 'cb', lo: 28, hi: 48 }, vc: { label: 'Cellos', set: 'vc', lo: 36, hi: 60 },
  va: { label: 'Violas', set: 'va', lo: 48, hi: 69 }, vn2: { label: 'Violins II', set: 'vn2', lo: 55, hi: 79 },
  vn1: { label: 'Violins I', set: 'vn1', lo: 57, hi: 93 },
  solo: { label: 'Arm line (Violins I)', set: 'vn1' }, vcl: { label: 'Leg line (Cellos)', set: 'vc' },
  pzh: { label: 'Accents (pizz.)', set: 'va' }, pzb: { label: 'Steps (bass pizz.)', set: 'cb' }, harp: { label: 'Harp', set: 'harp' },
  s1: { label: 'Upper line (violin)', set: 'vn1' }, s2: { label: 'Lower line (cello)', set: 'vc' },
};

// [key, default, min, max, step, group, label]
export const PARAM_META = [
  ['mode', 'octave', ['octave', 'map', 'song'], 0, 0, 'Texture', 'four voices on a walking bass (octave) · blocks of chords (map) · sung lines, no harmony (song)'],
  ['sngVoices', 2, 1, 2, 1, 'Song', 'lines: one (the higher open hand leads) · two (a hand each)'],
  ['sngUpper', 'right', ['right', 'left'], 0, 0, 'Song', 'the upper line is her … hand'],
  ['sngScale', 'dorian', Object.keys(SCALES), 0, 0, 'Song', 'scale (on the key)'],
  ['sngLo1', 62, 48, 79, 1, 'Song', 'upper line: lowest note (MIDI)'], ['sngHi1', 77, 60, 96, 1, 'Song', 'upper line: highest note'],
  ['sngApart', 9, 2, 16, 1, 'Song', 'lower line: this many scale steps under the upper (9 = a tenth)'],
  ['sngULo', -0.05, -0.3, 0.6, 0.01, 'Song', 'hand height of the lowest note (0 = hips)'],
  ['sngUHi', 1.0, 0.5, 1.3, 0.01, 'Song', 'hand height of the highest note (1 = above the head)'],
  ['sngHyst', 0.22, 0, 0.5, 0.01, 'Song', 'the hand must pass a note boundary by (notes)'],
  ['sngRunV', 5, 2, 30, 0.5, 'Song', 'a hand faster than this leaps instead of stepping (notes a second)'],
  ['sngGliss', 0.2, 0, 1, 0.01, 'Song', '… and while it flies the pitch leans after it by (0 holds · 1 slides with the hand)'],
  ['sngGlideS', 0.09, 0.01, 0.6, 0.01, 'Song', 'glide into every note (s)'],
  ['sngPortS', 0.2, 0, 1, 0.01, 'Song', '… longer by this for a leap of an octave (portamento, s)'],
  ['sngNoteS', 0.1, 0.03, 0.4, 0.01, 'Song', 'a pitch is a note once held (s)'],
  ['sngScoop', 0.15, 0, 1, 0.01, 'Song', 'a new bow starts this far under the note (semitones)'],
  ['sngConsonant', 1, 0, 1, 1, 'Song', 'two lines: a leap lands on a consonance with the other line'],
  ['sngResolve', 1, 0, 1, 1, 'Song', 'a held unrestful note resolves by step'],
  ['sngSettleS', 0.7, 0.2, 3, 0.05, 'Song', '… after (s)'],
  ['sngCalmV', 0.6, 0.1, 3, 0.05, 'Song', '… once the hand climbs or falls slower than (notes a second)'],
  ['sngGate', 'fist', ['fist', 'always'], 0, 0, 'Bow', 'a fist lifts the bow · the bow stays on'],
  ['fistOn', 0.55, 0.2, 0.95, 0.01, 'Bow', 'a fist: the reading above'], ['fistOff', 0.3, 0.05, 0.9, 0.01, 'Bow', 'open again: below'],
  ['fistHoldS', 0.12, 0, 0.6, 0.01, 'Bow', 'a fist must hold (s)'],
  ['sngMove', 0.07, 0.02, 0.3, 0.01, 'Bow', 'the hand is moving above (speed)'],
  ['sngRestUp', -0.12, -0.4, 0.5, 0.01, 'Bow', 'a hand hanging below this rests the line (0 = hips; −0.4: never)'],
  ['sngRestS', 2.5, 0, 12, 0.1, 'Bow', 'a hand this long without moving rests the line (0: never)'],
  ['sngRebow', 1, 0, 1, 1, 'Bow', 'a new stroke on the same note is a new bow'],
  ['sngBowRestS', 0.35, 0.1, 2, 0.05, 'Bow', '… after a pause of (s)'],
  ['sngAttFastS', 0.035, 0.01, 0.2, 0.005, 'Bow', 'attack of a sudden bow (s)'], ['sngAttSlowS', 0.22, 0.03, 1, 0.01, 'Bow', 'attack of a gentle bow (s)'],
  ['sngRelS', 0.16, 0.03, 1.5, 0.01, 'Bow', 'release when the hand closes (s)'], ['sngRestRelS', 0.8, 0.1, 4, 0.05, 'Bow', 'release when the hand comes to rest (s)'],
  ['sngFloor', 0.4, 0, 1, 0.01, 'Expression', 'softest bow'],
  ['sngBow', 0.55, 0, 1.5, 0.01, 'Expression', 'the hand\'s speed swells by'],
  ['sngSpTop', 0.32, 0.1, 1, 0.01, 'Expression', '… full at this speed'],
  ['sngPhrase', 0.3, 0, 1.5, 0.01, 'Expression', 'the whole body\'s energy lifts the phrase by'],
  ['sngContour', 0.2, 0, 1, 0.01, 'Expression', 'a rising line swells by'],
  ['sngAccent', 0.4, 0, 1.5, 0.01, 'Expression', 'a sudden movement accents by'],
  ['sngUpS', 0.14, 0.03, 2, 0.01, 'Expression', 'swell time (s)'], ['sngDownS', 1.4, 0.1, 8, 0.05, 'Expression', 'fall time (s)'],
  ['sngBowFallS', 0.7, 0.1, 4, 0.05, 'Expression', 'the bow slows over (s)'],
  ['vibDepth', 0.7, 0, 1, 0.01, 'Expression', 'vibrato depth'],
  ['vibDelayS', 0.25, 0, 1.5, 0.01, 'Expression', 'vibrato starts after (s)'], ['vibGrowS', 0.9, 0.1, 3, 0.05, 'Expression', '… and grows over (s)'],
  ['vibHz', 5.7, 4, 7.5, 0.1, 'Expression', 'vibrato rate (Hz)'], ['vibHzDyn', 1.2, 0, 3, 0.1, 'Expression', '… faster when loud by (Hz)'],
  ['octMode', 'major', ['major', 'minor'], 0, 0, 'Texture', 'mode of the octave'],
  ['octTop', 0.95, 0.7, 1.2, 0.01, 'Texture', 'hips this high = upper tonic'],
  ['octBottom', 0.5, 0.2, 0.8, 0.01, 'Texture', 'hips this low = lower tonic'],
  ['octFold', 0.85, 0, 1, 0.01, 'Texture', 'a horizontal torso counts as this deep'],
  ['octKnee', 0.7, 0.3, 0.95, 0.01, 'Texture', 'depth at which the bass reaches the dominant'],
  ['octRest', 0.1, 0, 0.3, 0.01, 'Texture', 'width of the two tonics (rest at the top and at the bottom)'],
  ['octHyst', 0.75, 0.5, 1.5, 0.05, 'Texture', 'a new bass note needs the body this far past the boundary (steps)'],
  ['octStepS', 1.6, 0.3, 4, 0.05, 'Texture', 'a bass step at most every (s)'],
  ['octRunS', 0.6, 0.15, 2, 0.05, 'Texture', '… or this fast when three or more steps away (s)'],
  ['melControl', 'height', ['height', 'stroke'], 0, 0, 'Hands', 'the top line follows the hand height · arm strokes'],
  ['melULo', 0.12, 0, 0.8, 0.01, 'Hands', 'hand height of the lowest note (0 = hips)'],
  ['melUHi', 1.0, 0.4, 1.3, 0.01, 'Hands', 'hand height of the highest note (1 = above the head)'],
  ['melDead', 2, 1, 5, 1, 'Hands', 'the hand must be this many notes away to move the line'],
  ['melThirds', 1, 0, 1, 1, 'Hands', 'far from the hand, move by thirds through the chord'],
  ['melMove', 0.12, 0.02, 0.6, 0.01, 'Hands', 'hands slower than this hold the note'],
  ['melRunS', 0.3, 0.08, 1, 0.01, 'Hands', 'fastest notes, in a run (s)'],
  ['melSettleS', 0.35, 0.1, 2, 0.05, 'Hands', 'settled this long: land on a chord tone (s)'],
  ['key', 2, 0, 11, 1, 'Harmony', 'key (0 = C … 2 = D … 11 = B)'],
  ['leanOn', 17, 5, 40, 1, 'Harmony', 'lean that leaves the axis (degrees)'],
  ['levelHigh', 0.88, 0.6, 1.1, 0.01, 'Harmony', 'hips this high = standing tall'],
  ['levelLow', 0.58, 0.3, 0.8, 0.01, 'Harmony', 'hips this low = on the floor'],
  ['foldOn', 0.55, 0.2, 0.95, 0.01, 'Harmony', 'torso this horizontal = folded'],
  ['invertOn', 0.6, 0.2, 0.95, 0.01, 'Harmony', 'head this far below the hips = inverted'],
  ['transit', 2.5, 0, 4, 0.05, 'Harmony', 'ignore shapes passed through at speed'],
  ['dwellS', 0.15, 0, 2, 0.05, 'Harmony', 'a new shape must hold (s)'],
  ['waitS', 0.7, 0, 3, 0.05, 'Harmony', 'then wait for a landing, at most (s)'],
  ['minChordS', 2.0, 0.3, 8, 0.1, 'Harmony', 'shortest chord (s)'],
  ['cadence', 1, 0, 1, 1, 'Harmony', 'come home through V'],
  ['cadenceS', 1.3, 0.4, 4, 0.1, 'Harmony', 'the V before home lasts at least (s)'],
  ['colour', 1, 0, 1, 1, 'Harmony', 'open shapes add 9ths and 7ths'],
  ['spanSrc', 'openness', 0, 0, 0, 'Voicing', 'spread of the parts follows'],
  ['spanLo', 0.05, 0, 1, 0.01, 'Voicing', '… from'], ['spanHi', 0.6, 0, 1.5, 0.01, 'Voicing', '… to'],
  ['liftSrc', 'reachUp', 0, 0, 0, 'Voicing', 'height of the violins follows'],
  ['liftLo', 0.45, 0, 1, 0.01, 'Voicing', '… from'], ['liftHi', 1.0, 0, 1.5, 0.01, 'Voicing', '… to'],
  ['liftSemis', 10, 0, 19, 1, 'Voicing', 'violins rise by up to (semitones)'],
  ['bassAt', 0.5, 0, 1, 0.01, 'Voicing', 'basses enter when span passes'],
  ['revoiceS', 3, 0.5, 12, 0.1, 'Voicing', 're-voice a held chord at most every (s)'],
  ['dynSrc', 'energy', 0, 0, 0, 'Dynamics', 'the dynamic follows'],
  ['dynLo', 0.06, 0, 1, 0.01, 'Dynamics', '… from (pp)'], ['dynHi', 0.34, 0, 1.5, 0.01, 'Dynamics', '… to (ff)'],
  ['dynFloor', 0.4, 0, 1, 0.01, 'Dynamics', 'softest dynamic while moving'],
  ['dynFast', 0.5, 0, 1, 0.01, 'Dynamics', 'share that follows the movement of the moment (Weight)'],
  ['dynLink', 0.6, 0, 1, 0.01, 'Dynamics', 'each voice follows its own limbs (top: hands · bass: legs)'],
  ['dynGesture', 0.2, 0, 1, 0.01, 'Dynamics', 'each strong movement swells by'],
  ['dynUpS', 0.6, 0.05, 4, 0.05, 'Dynamics', 'swell time (s)'], ['dynDownS', 5, 0.1, 12, 0.1, 'Dynamics', 'fall time when the movement stops (s)'],
  ['stillLevel', 0.8, 0, 1, 0.01, 'Dynamics', 'stillness sinks to (× the dynamic)'],
  ['nienteS', 15, 1, 60, 0.5, 'Dynamics', 'a stillness this long fades to nothing (s)'],
  ['nearMax', 0.2, 0.1, 0.6, 0.01, 'Dynamics', 'closer to the camera than this = offstage'],
  ['brightSrc', 'top', 0, 0, 0, 'Dynamics', 'brightness follows'],
  ['brightLo', 0.4, 0, 1.5, 0.01, 'Dynamics', '… from (dark)'], ['brightHi', 1.1, 0, 1.5, 0.01, 'Dynamics', '… to (bright)'],
  ['tremSrc', 'time', 0, 0, 0, 'Tremolo', 'tremolo follows'],
  ['tremLo', 0.3, 0, 1, 0.01, 'Tremolo', '… from'], ['tremHi', 0.6, 0, 1.5, 0.01, 'Tremolo', '… to'],
  ['tremAmount', 1, 0, 1, 0.01, 'Tremolo', 'amount'],
  ['mel', 1, 0, 1, 1, 'Arm line', 'arm strokes play the first violins'],
  ['melPath', 0.55, 0.1, 3, 0.05, 'Arm line', 'a stroke at least this long (torsos)'],
  ['melPeak', 1.5, 0.3, 8, 0.1, 'Arm line', '… and this fast (torsos/s)'],
  ['melMinUp', 0.05, -0.5, 1, 0.01, 'Arm line', 'hand at least this high (0 = hips, 1 = above the head)'],
  ['melGapS', 0.5, 0.05, 3, 0.05, 'Arm line', 'shortest note (s)'],
  ['melHoldS', 2.0, 0.3, 10, 0.1, 'Arm line', 'a note fades if nothing follows within (s)'],
  ['melLo', 62, 55, 84, 1, 'Arm line', 'lowest note (MIDI)'], ['melHi', 83, 67, 100, 1, 'Arm line', 'highest note (MIDI)'],
  ['melDeg', 2.5, 0.5, 8, 0.1, 'Arm line', 'scale degrees per torso length of rise or fall'],
  ['melStep', 2, 1, 7, 1, 'Arm line', 'largest step on a direct stroke (scale degrees)'],
  ['melLeap', 4, 1, 9, 1, 'Arm line', 'largest leap on a wandering stroke'],
  ['leg', 0, 0, 1, 1, 'Leg line', 'leg gestures play the cellos'],
  ['legMinH', 0.16, 0.02, 0.8, 0.01, 'Leg line', 'foot at least this high off the floor'],
  ['legPath', 0.6, 0.1, 3, 0.05, 'Leg line', 'a stroke at least this long (torsos)'],
  ['legGapS', 0.5, 0.05, 3, 0.05, 'Leg line', 'shortest note (s)'],
  ['legHoldS', 2.0, 0.3, 10, 0.1, 'Leg line', 'a note fades if nothing follows within (s)'],
  ['legLo', 43, 36, 60, 1, 'Leg line', 'lowest note (MIDI)'], ['legHi', 67, 48, 79, 1, 'Leg line', 'highest note (MIDI)'],
  ['steps', 0, 0, 1, 1, 'Steps and accents', 'steps pluck the basses'],
  ['stepPath', 0.7, 0.1, 3, 0.05, 'Steps and accents', 'a step at least this long (torsos)'],
  ['stepGapS', 0.6, 0.1, 3, 0.05, 'Steps and accents', 'at most one pluck every (s)'],
  ['acc', 0, 0, 1, 1, 'Steps and accents', 'sudden hands pluck the violas'],
  ['accMin', 0.6, 0.25, 1, 0.01, 'Steps and accents', 'only accents at least this strong'],
  ['accGapS', 0.5, 0.1, 3, 0.05, 'Steps and accents', 'at most one accent every (s)'],
  ['harp', 0, 0, 1, 1, 'Harp', 'circles of the hands roll the harp'],
  ['harpSpin', 0, 0, 1, 1, 'Harp', 'a half turn of the body sweeps the harp'],
];
export const DEFAULTS = Object.fromEntries(PARAM_META.map(m => [m[0], m[1]]));
export const DYN_OF = { vn1: 'dynTop', cb: 'dynBass', vc: 'dynMid', va: 'dynMid', vn2: 'dynMid' };
export const SOURCES = SIGNALS.filter(k => !['seen', 'still', 'feet', 'axis', 'yaw', 'pitch', 'spin', 'tiltLeft', 'tiltFwd', 'curl', 'bend', 'stageX', 'near'].includes(k));

const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
// root (semitones above the tonic), triad, colour tones by openness (1, 2), scale
const CHORDS = {
  I:   { r: 0, q: 'M', c1: [2], c2: [11, 2], sc: MAJ }, IV: { r: 5, q: 'M', c1: [2], c2: [11, 2], sc: MAJ },
  V:   { r: 7, q: 'M', c1: [2], c2: [2, 9], sc: MAJ },
  vi:  { r: 9, q: 'm', c1: [10], c2: [10, 2], sc: MAJ }, ii: { r: 2, q: 'm', c1: [10], c2: [10, 2], sc: MAJ },
  iii: { r: 4, q: 'm', c1: [10], c2: [10, 5], sc: MAJ },
  '♭VI': { r: 8, q: 'M', c1: [2], c2: [11, 2], sc: MIN }, i: { r: 0, q: 'm', c1: [2], c2: [10, 2], sc: MIN },
  iv:  { r: 5, q: 'm', c1: [2], c2: [10, 2], sc: MIN },
};
const DARK = new Set(['♭VI', 'i', 'iv']);
export const DEGS = Object.keys(CHORDS);
const mod = x => ((x % 12) + 12) % 12;
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;

export function chordOf(deg, key, colour) {
  const c = CHORDS[deg], root = mod(key + c.r), third = mod(root + (c.q === 'M' ? 4 : 3)), fifth = mod(root + 7);
  const extra = (colour >= 2 ? c.c2 : colour >= 1 ? c.c1 : []).map(x => mod(root + x));
  const suffix = c.q === 'M' ? ['', 'add9', deg === 'V' ? '6/9' : 'maj9'][colour] : ['m', 'm7', deg === 'iii' ? 'm7(11)' : 'm9'][colour];
  return { deg, root, third, fifth, extra, pcs: [root, third, fifth, ...extra], symbol: NAMES[root] + suffix, dark: DARK.has(deg),
           scale: c.sc.map(x => mod(key + x)) };
}

// the place on the map, with hysteresis kept in `st`
function place(st, level, fold, invert, axis, P) {
  const h = (on, x, a, b) => (on ? x > b : x > a);                   // a: switch on, b: switch off (a > b)
  st.folded = h(st.folded, fold, P.foldOn, P.foldOn - 0.2);
  st.inverted = h(st.inverted, invert, P.invertOn, P.invertOn - 0.25);
  st.high = h(st.high, level, P.levelHigh, P.levelHigh - 0.05);
  st.low = !h(!st.low, level, P.levelLow + 0.07, P.levelLow);
  const off = 0.6 * P.leanOn;
  if (st.side === 0) st.side = axis > P.leanOn ? 1 : axis < -P.leanOn ? -1 : 0;
  else if (Math.abs(axis) < off || Math.sign(axis) !== st.side) st.side = Math.abs(axis) > P.leanOn ? Math.sign(axis) : 0;
  if (st.inverted) return 'iv';
  if (st.folded) return st.low ? 'i' : '♭VI';
  if (st.high) return st.side < 0 ? 'IV' : st.side > 0 ? 'V' : 'I';
  return st.side < 0 ? 'ii' : st.side > 0 ? 'iii' : 'vi';
}

// five parts for a chord: the smallest motion from `prev` towards the
// registers that span and lift ask for
export function voice(ch, prev, span, lift, P, bassOn) {
  const R = PART_INFO;
  const target = { vc: lerp(55, 45, span), va: lerp(59, 56, span), vn2: lerp(63, 66, span) + 0.3 * P.liftSemis * lift,
                   vn1: lerp(67, 74, span) + P.liftSemis * lift };
  const order = ['vc', 'va', 'vn2', 'vn1'];
  const cand = order.map(p => { const out = [];
    for (let m = R[p].lo; m <= R[p].hi; m++) if (ch.pcs.includes(mod(m)) && Math.abs(m - target[p]) <= 9) out.push(m);
    return out; });
  let best = null;
  const colour = ch.extra;
  for (const a of cand[0]) for (const b of cand[1]) { if (b <= a) continue; for (const c of cand[2]) { if (c <= b || c - b > 12) continue; for (const d of cand[3]) {
    if (d <= c || d - c > 12) continue;
    const ps = [a, b, c, d], pcs = ps.map(mod);
    let cost = 0;
    ps.forEach((m, i) => { const p = order[i];
      cost += 0.45 * Math.abs(m - target[p]);
      if (prev && prev[p] != null) { const dm = Math.abs(m - prev[p]); cost += (p === 'vn1' ? 1.4 : 1) * dm + (dm > 4 ? (p === 'vn1' ? 3 : 1.5) * (dm - 4) : 0); } });
    if (!pcs.includes(ch.third)) cost += 9;
    if (!bassOn && pcs[0] !== ch.root) cost += pcs[0] === ch.fifth ? 2.5 : 5;       // without basses the cellos carry the root
    if (bassOn && pcs[0] !== ch.root && pcs[0] !== ch.fifth) cost += 2;
    for (const x of colour) if (!pcs.includes(x)) cost += 2.5;
    if (!colour.length && !pcs.includes(ch.fifth)) cost += 1;
    if (pcs.filter(x => x === ch.third).length > 1 && colour.length) cost += 1.5;
    if (colour.includes(pcs[0])) cost += 6;                                         // no colour tone in the bass
    if (b - a < 3 && a < 52) cost += 2;                                             // no mud low down
    if (!best || cost < best.cost) best = { cost, ps };
  } } }
  if (!best) { const f = p => { let bm = null; for (let m = R[p].lo; m <= R[p].hi; m++) if (ch.pcs.slice(0, 3).includes(mod(m)) && (bm === null || Math.abs(m - target[p]) < Math.abs(bm - target[p]))) bm = m; return bm; };
    best = { ps: order.map(f) }; }
  const out = { vc: best.ps[0], va: best.ps[1], vn2: best.ps[2], vn1: best.ps[3], cb: null };
  if (bassOn) { let m = 28; while (mod(m) !== ch.root) m++; if (m < 31 && prev && prev.cb != null && Math.abs(m + 12 - prev.cb) < Math.abs(m - prev.cb)) m += 12; out.cb = m; }
  return out;
}

export const SONG_CURVES = [1, 2].flatMap(k => ['pitch', 'amp', 'vib', 'vibHz', 'bri', 'gate'].map(c => c + k));
const ladderOf = (scale, lo, hi) => { const out = []; for (let m = lo; m <= hi; m++) if (scale.includes(mod(m))) out.push(m); return out; };
function nearestIdx(L, idx, ok) {
  for (let d = 0; d < L.length; d++) { if (idx - d >= 0 && ok(L[idx - d])) return idx - d; if (idx + d < L.length && ok(L[idx + d])) return idx + d; }
  return idx;
}

// a monophonic line played by strokes (after sound/melody.js, in the key's own scale)
class Line {
  constructor(part, o) { this.part = part; this.o = o; this.cur = null; this.prevMidi = null; this.lastOn = -1e9; }
  // u: 0..1 height; dir: stroke direction (y up); returns the note pushed, or null
  play(t, u, ev, ch, space, notes) {
    const o = this.o, L = ladderOf(ch.scale, o.lo, o.hi);
    if (t - this.lastOn < o.gapS) return null;
    const abs = Math.round(clip(u) * (L.length - 1));              // where the limb is
    let idx = abs;
    const tones = new Set(ch.pcs);
    if (this.prevMidi !== null) {
      let pi = 0; L.forEach((m, i) => { if (Math.abs(m - this.prevMidi) < Math.abs(L[pi] - this.prevMidi)) pi = i; });
      // the contour is the stroke: its rise or fall, in scale degrees; a level stroke leans towards where the limb is
      const dy = ev.dir ? ev.dir[1] * ev.path * ev.straight : 0;
      let d = Math.round(dy * o.degPerTorso);
      if (d === 0) d = Math.sign(abs - pi);
      if (Math.abs(abs - pi) > o.pull && Math.sign(abs - pi) !== Math.sign(d)) d = Math.sign(abs - pi);   // far from the limb: come back
      const maxStep = space > 0.6 ? o.step : o.leap;
      idx = Math.max(0, Math.min(L.length - 1, pi + Math.max(-maxStep, Math.min(maxStep, d))));
      if (ev.peak < o.slowPeak && !tones.has(mod(L[idx]))) {        // slow strokes land on chord tones, in the stroke's direction
        const dn = Math.sign(idx - pi) || 1; let j = idx;
        while (j + dn >= 0 && j + dn < L.length && !tones.has(mod(L[j])) && Math.abs(j + dn - pi) <= maxStep + 1) j += dn;
        if (tones.has(mod(L[j]))) idx = j;
      }
      if (idx === pi && this.cur && this.cur.t1 === null) return null;          // the same note, still sounding: no new bow
    } else idx = nearestIdx(L, idx, m => tones.has(mod(m)));                    // a phrase starts on a chord tone, where the limb is
    this.end(t + 0.06);
    const n = { part: this.part, art: 'sus', midi: L[idx], t0: t, t1: null, vel: clip(0.4 + ev.peak / 9, 0.3, 1), src: ev.limb };
    notes.push(n); this.cur = n; this.prevMidi = n.midi; this.lastOn = t;
    return n;
  }
  end(t) { if (this.cur && this.cur.t1 === null) this.cur.t1 = Math.max(t, this.cur.t0 + 0.45); }
  // called every frame: let a note go when nothing has followed it, and forget the line after a long rest
  tick(t, ch) {
    if (this.cur && this.cur.t1 === null) {
      if (t - this.cur.t0 > this.o.holdS) this.end(t);
      else if (ch && !ch.scale.includes(mod(this.cur.midi))) this.end(t + 0.15);   // the chord left the note's scale
    }
    if (this.prevMidi !== null && t - this.lastOn > 3 * this.o.holdS) this.prevMidi = null;
  }
}

// The arranger one frame at a time. `a` is an analysis (analyze.js), finished or still growing (an Analyzer):
//   const R = new Arranger(a, params);  R.step(i) for every frame i, in order;  R.score is the score so far
//   (notes still sounding have t1 === null);  R.finish() closes it.
export function Arranger(a, params = {}) {
  const P = { ...DEFAULTS, ...params };
  const S = a.sig, T = a.t; let cap = Math.max(1, a.cap || a.n);
  const curves = {}; const songMode = P.mode === 'song';
  for (const k of ['dyn', 'dynTop', 'dynMid', 'dynBass', 'trem', 'bright', 'solo', 'span', 'lift', 'on', ...(songMode ? SONG_CURVES : [])]) curves[k] = new Float32Array(cap);
  const notes = [], chords = [], marks = []; let places = new Int8Array(cap).fill(-1);
  const src = (name, i, lo, hi) => clip(((S[name] ? S[name][i] : 0) - lo) / Math.max(1e-6, hi - lo));

  const st = { folded: false, inverted: false, high: true, low: false, side: 0 };
  let sm = null;                                   // smoothed shape inputs
  let cur = null, curDeg = null, curColour = 0, lastChange = -1e9, lastVoice = -1e9;
  let cand = null, candSince = 0, pendingHome = false, wasPresent = false, lastSeen = -1e9, wantSince = null, mvPeak = 0, wasArriving = false;
  let voicing = null; const held = {};             // part → the sounding chorale note
  let dyn = 0, trem = 0, bright = 0.5, span = 0, lift = 0, on = 0, gest = 0, fast = 0, stillSince = null, soloDyn = 0;
  let lastStep = -1e9, lastAcc = -1e9, stepAlt = 0, harpIdx = 0, lastHarp = -1e9;
  const solo = new Line('solo', { lo: P.melLo, hi: P.melHi, gapS: P.melGapS, holdS: P.melHoldS, step: P.melStep, leap: P.melLeap, slowPeak: 2.0, degPerTorso: P.melDeg, pull: 5 });
  const cello = new Line('vcl', { lo: P.legLo, hi: P.legHi, gapS: P.legGapS, holdS: P.legHoldS, step: 2, leap: 3, slowPeak: 3.5, degPerTorso: 7, pull: 4 });
  let ei = 0; const E = a.events;
  const octave = P.mode === 'octave', oct = octave ? new Octave(P, notes, chords) : null;
  const song = songMode ? new Song(P, notes) : null; let phrase = 0, wasOn = false;
  const fsm = { dynTop: 0, dynMid: 0, dynBass: 0 }, dynV = { dynTop: 0, dynMid: 0, dynBass: 0 };

  const setChord = (deg, t, cause, colour) => {
    const ch = chordOf(deg, P.key, P.colour ? colour : 0);
    const bassOn = span >= P.bassAt || ch.dark;
    const v = voice(ch, voicing, span, lift, P, bassOn);
    for (const p of ['cb', 'vc', 'va', 'vn2', 'vn1']) {
      const h = held[p];
      if (h && h.midi === v[p]) continue;                         // a common tone is held
      if (h) { h.t1 = t + (v[p] == null ? 0.6 : 0.14); delete held[p]; }
      if (v[p] != null) { const nn = { part: p, art: 'sus', midi: v[p], t0: t, t1: null, vel: 1, src: 'chord' }; notes.push(nn); held[p] = nn; }
    }
    if (deg !== curDeg || !cur) chords.push({ t, deg, symbol: ch.symbol, cause, voicing: { ...v } });
    else chords[chords.length - 1].symbol = ch.symbol;
    if (deg !== curDeg) lastChange = t;
    voicing = v; cur = ch; curDeg = deg; curColour = colour; lastVoice = t;
  };

  const score = { chords, notes, curves, marks, places, placeNames: octave ? OCT_PLACES : DEGS, mode: P.mode, params: P, dur: 0, key: P.key, song: song ? song.info : null };
  this.score = score;
  this.step = i => {
    if (i >= cap) { while (i >= cap) cap *= 2; for (const k in curves) { const nb = new Float32Array(cap); nb.set(curves[k]); curves[k] = nb; }
      const np = new Int8Array(cap).fill(-1); np.set(places); places = score.places = np; }
    const t = T[i], dt = i ? Math.max(1e-3, Math.min(0.2, t - T[i - 1])) : 1 / 30;
    const k = tau => 1 - Math.exp(-dt / tau);
    // onstage: seen, and not up at the camera. A tracking dropout shorter than a second is not an exit
    if (S.seen[i] > 0) lastSeen = t;
    const nearNow = S.near[i] > (wasPresent ? P.nearMax * 1.25 : P.nearMax);
    const present = t - lastSeen < 1.0 && !nearNow && lastSeen > -1e8;
    const tracked = S.seen[i] > 0;
    on += k(present ? 0.8 : 1.2) * ((present ? 1 : 0) - on);
    const x = { level: S.level[i], fold: S.fold[i], invert: S.invert[i], axis: S.axis[i] };
    // the shape is read as she arrives: the faster she moves, the slower the reading (a shape passed through is not a place)
    if (!sm) sm = { ...x }; else { const kk = k(0.1 + P.transit * S.move[i]); for (const q in x) sm[q] += kk * (x[q] - sm[q]); }

    // ── voicing inputs ──
    span += k(0.6) * (src(P.spanSrc, i, P.spanLo, P.spanHi) - span);
    lift += k(0.5) * (src(P.liftSrc, i, P.liftLo, P.liftHi) - lift);
    const wantColour = span > 0.72 ? 2 : span > 0.38 ? 1 : 0;

    // ── events of this frame ──
    const evs = []; while (ei < E.length && E[ei].t <= t) evs.push(E[ei++]);
    // a landing: a stroke ending, an accent, a foot coming down, stillness, or the whole body arriving
    // (its speed falling to under half of its recent peak)
    mvPeak = Math.max(mvPeak * Math.exp(-dt / 1.0), S.move[i]);
    const arriving = mvPeak > 0.14 && S.move[i] < 0.5 * mvPeak;
    const arrived = arriving && !wasArriving; wasArriving = arriving;
    const landing = arrived || evs.some(e => (e.type === 'stroke' && e.peak >= 1.2 && e.path >= 0.3) || e.type === 'sudden' || e.type === 'landed' || e.type === 'still');

    // ── harmony ──
    if (songMode) {                                              // no harmony: the lines are written below, once the body's state is known
      if (present && tracked && !wasOn) { marks.push({ t, label: 'enter' }); wasOn = true; }
      else if (!present && wasOn) { marks.push({ t, label: 'exit' }); wasOn = false; }
    } else if (octave) {
      if (present && tracked) {
        if (!cur) marks.push({ t, label: 'enter' });
        cur = oct.bassFrame(t, sm, landing); places[i] = oct.target;
        oct.melodyFrame(t, (S.reachUp[i] - P.melULo) / Math.max(0.05, P.melUHi - P.melULo), S.hands[i], P.mel && S.reachUp[i] > 0.4 * P.melULo);
      } else if (!present && cur && wasPresent) { oct.home(t); cur = oct.ch; marks.push({ t, label: 'exit' }); }
    } else if (present && tracked) {
      let target = place(st, sm.level, sm.fold, sm.invert, sm.axis, P);
      places[i] = DEGS.indexOf(target);
      if (!cur) { setChord('I', t, 'start', wantColour); marks.push({ t, label: 'enter' }); }           // the piece starts at home, whatever the shape
      else {
        // the cadence: home from a dark place goes through V first
        if (P.cadence && target === 'I' && cur.dark) { target = 'V'; pendingHome = true; }
        if (pendingHome && curDeg === 'V' && target === 'I' && t - lastChange < P.cadenceS) target = 'V';
        if (target !== curDeg) {
          if (cand !== target) { cand = target; candSince = t; }
          if (wantSince === null) wantSince = t;
          const ready = t - candSince >= P.dwellS && t - lastChange >= P.minChordS;
          if (ready && (landing || t - candSince >= P.dwellS + P.waitS)) {
            setChord(target, t, landing ? 'landing' : 'held', wantColour);
            chords[chords.length - 1].lag = t - wantSince; wantSince = null;
            if (target !== 'V') pendingHome = false;
            cand = null;
          }
        } else {
          cand = null; wantSince = null;
          // the same chord, a different body: re-voice (colour, spread, height) now and then, on a landing
          if (t - lastVoice >= P.revoiceS && landing) {
            const v2 = voice(chordOf(curDeg, P.key, P.colour ? wantColour : 0), voicing, span, lift, P, span >= P.bassAt || cur.dark);
            const moved = ['vc', 'va', 'vn2', 'vn1'].reduce((q, p) => q + Math.abs(v2[p] - voicing[p]), 0) + (v2.cb == null) - (voicing.cb == null);
            if (wantColour !== curColour || moved >= 5) setChord(curDeg, t, 'revoice', wantColour);
          }
        }
      }
    }

    else if (!present && cur && wasPresent && curDeg !== 'I') { setChord('I', t, 'exit', 0); marks.push({ t, label: 'exit' }); }   // she leaves: home
    wasPresent = present;

    // ── dynamics ──
    const still = S.still[i] > 0;
    if (still) { if (stillSince === null) stillSince = t; } else stillSince = null;
    for (const e of evs) if (e.type === 'sudden' || (e.type === 'stroke' && e.peak > 3)) gest = Math.max(gest, clip(e.type === 'sudden' ? e.strength : e.peak / 8));
    gest *= Math.exp(-dt / 0.9);
    fast += k(0.35) * (clip((S.weight[i] - 0.04) / 0.5) - fast);
    let want = P.dynFloor + (1 - P.dynFloor) * clip((1 - P.dynFast) * src(P.dynSrc, i, P.dynLo, P.dynHi) + P.dynFast * fast + P.dynGesture * gest);
    if (stillSince !== null) want *= t - stillSince >= P.nienteS ? 0 : P.stillLevel;
    // (leaving the stage is its own, quicker fade: `on` multiplies the result, not the target)
    dyn += k(want > dyn ? P.dynUpS : P.dynDownS) * (want - dyn);
    // each voice also follows its own limbs: the top the hands (a bow), the bass the legs, the middle the whole body
    const own = { dynTop: clip(1.2 * S.hands[i]), dynBass: clip(1.8 * Math.max(S.spLF[i], S.spRF[i]) + 0.6 * S.move[i]), dynMid: fast };
    for (const v in own) {
      fsm[v] += k(0.18) * (own[v] - fsm[v]);
      let w = P.dynFloor + (1 - P.dynFloor) * clip((1 - P.dynFast) * src(P.dynSrc, i, P.dynLo, P.dynHi) + P.dynFast * ((1 - P.dynLink) * fast + P.dynLink * fsm[v]) + P.dynGesture * gest);
      if (stillSince !== null) w *= t - stillSince >= P.nienteS ? 0 : P.stillLevel;
      dynV[v] += k(w > dynV[v] ? P.dynUpS * (1 - 0.5 * P.dynLink) : P.dynDownS) * (w - dynV[v]); curves[v][i] = dynV[v] * on;
    }
    const wt = P.tremAmount * src(P.tremSrc, i, P.tremLo, P.tremHi) * (still ? 0 : 1);
    trem += k(wt > trem ? 0.15 : 0.7) * (wt - trem);
    bright += k(0.5) * (src(P.brightSrc, i, P.brightLo, P.brightHi) - bright);
    const ws = clip(0.45 + 0.9 * S.hands[i]) * on;
    soloDyn += k(ws > soloDyn ? 0.12 : 0.8) * (ws - soloDyn);
    curves.dyn[i] = dyn * on; curves.trem[i] = trem; curves.bright[i] = bright; curves.solo[i] = soloDyn;
    curves.span[i] = span; curves.lift[i] = lift; curves.on[i] = on;
    if (song) {
      const ph = src(P.dynSrc, i, P.dynLo, P.dynHi); phrase += k(ph > phrase ? 0.8 : 3) * (ph - phrase);
      song.frame(i, t, dt, S, { present: present && lastSeen > -1e8, on, phrase, level: S.level[i], evs, niente: stillSince !== null && t - stillSince >= P.nienteS }, curves);
    }

    // ── lines, steps, accents, harp ──
    if (cur && present && tracked) {
      for (const e of evs) {
        if (e.type === 'stroke' && (e.limb === 'lh' || e.limb === 'rh') && P.mel) {
          if (octave) { if (P.melControl === 'stroke' && e.path >= P.melPath && e.peak >= P.melPeak && e.up >= P.melMinUp) oct.strokeNote(t, e, S.space[i]); }
          else if (e.path >= P.melPath && e.peak >= P.melPeak && e.up >= P.melMinUp)
            solo.play(t, (e.up - P.melMinUp) / (1.05 - P.melMinUp), e, cur, S.space[i], notes);
        } else if (e.type === 'stroke' && (e.limb === 'lf' || e.limb === 'rf')) {
          if (P.leg && e.h >= P.legMinH && e.path >= P.legPath) cello.play(t, (e.h - P.legMinH) / 0.5, e, cur, S.space[i], notes);
          else if (P.steps && e.h < P.legMinH && e.path >= P.stepPath && t - lastStep >= P.stepGapS && !st.folded && sm.fold < P.foldOn) {
            let m = 28; const pc = stepAlt++ % 2 ? cur.fifth : cur.root; while (mod(m) !== pc) m++;
            if (m < 33) m += 12;
            notes.push({ part: 'pzb', art: 'pizz', midi: m, t0: t, t1: t + 1.2, vel: clip(0.45 + e.peak / 9, 0.3, 1), src: e.limb }); lastStep = t;
          }
        } else if (e.type === 'sudden' && P.acc && (e.part === 'lhand' || e.part === 'rhand') && e.strength >= P.accMin && t - lastAcc >= P.accGapS) {
          const h = S[e.part === 'lhand' ? 'hLH' : 'hRH'][i], L = ladderOf(cur.pcs, 55, 84);
          notes.push({ part: 'pzh', art: 'pizz', midi: L[Math.round(clip(h / 1.2) * (L.length - 1))], t0: t, t1: t + 0.9, vel: clip(0.3 + 0.7 * e.strength), src: e.part }); lastAcc = t;
        } else if (P.harp && (e.type === 'quarter' || e.type === 'circle') && (e.point === 'lhand' || e.point === 'rhand') && t - lastHarp >= 0.12) {
          const L = ladderOf(cur.pcs, 50, 88);
          harpIdx = e.type === 'circle' ? Math.round(clip(S[e.point === 'lhand' ? 'hLH' : 'hRH'][i] / 1.2) * (L.length - 1)) : harpIdx + (e.dir >= 0 ? 1 : -1);
          if (harpIdx >= L.length) harpIdx = L.length - 4; if (harpIdx < 0) harpIdx = 3;
          notes.push({ part: 'harp', art: 'pluck', midi: L[harpIdx], t0: t, t1: t + 2.5, vel: 0.6, src: e.point }); lastHarp = t;
        } else if (P.harpSpin && e.type === 'spin') {
          const L = ladderOf(cur.scale, 55, 91), up = e.dir >= 0, i0 = up ? 2 : L.length - 3;
          for (let q = 0; q < 6; q++) notes.push({ part: 'harp', art: 'pluck', midi: L[i0 + (up ? 1 : -1) * q * 2] ?? L[up ? L.length - 1 : 0], t0: t + 0.07 * q, t1: t + 0.07 * q + 2.5, vel: 0.35 + 0.05 * q, src: 'spin' });
          marks.push({ t, label: 'turn' });
        }
      }
    }
    if (evs.some(e => e.type === 'still')) { solo.end(t + 0.6); cello.end(t + 0.6); }      // stillness lets the line go
    solo.tick(t, cur); cello.tick(t, cur);
    score.dur = t;
  };
  this.finish = (end = a.dur) => {
    for (const nn of notes) if (nn.t1 === null) nn.t1 = end;
    notes.sort((p, q) => p.t0 - q.t0); score.dur = end;
    return score;
  };
}

export function arrange(a, params = {}) {
  const R = new Arranger(a, params);
  for (let i = 0; i < a.n; i++) R.step(i);
  return R.finish();
}

// numbers to judge a score by (the lab prints them; the page shows a few)
export function stats(a, s) {
  if (s.mode === 'song') {
    const lines = [];
    for (let k = 1; k <= s.song.voices; k++) {
      const ns = s.notes.filter(x => x.part === 's' + k), gate = s.curves['gate' + k], amp = s.curves['amp' + k]; let on = 0, runs = 0, sum = 0;
      for (let i = 0; i < a.n; i++) if (gate[i]) { on++; sum += amp[i]; if (!i || !gate[i - 1]) runs++; }
      lines.push({ n: ns.length, perMin: ns.length / s.dur * 60, bows: ns.filter(x => !x.slur).length, lo: Math.min(...ns.map(x => x.midi)), hi: Math.max(...ns.map(x => x.midi)),
                   sounding: on / Math.max(1, a.n), phrases: runs, ampMean: on ? sum / on : 0 });
    }
    return { song: true, lines };
  }
  const d = s.chords.map((c, i) => (i + 1 < s.chords.length ? s.chords[i + 1].t : s.dur) - c.t).sort((x, y) => x - y);
  const q = (v, p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0);
  const time = {}; s.chords.forEach((c, i) => { time[c.deg] = (time[c.deg] || 0) + ((i + 1 < s.chords.length ? s.chords[i + 1].t : s.dur) - c.t); });
  const by = {}; for (const p of PARTS) by[p] = s.notes.filter(x => x.part === p);
  const line = p => { const v = by[p], iv = []; for (let i = 1; i < v.length; i++) if (v[i].t0 - v[i - 1].t0 < 3) iv.push(Math.abs(v[i].midi - v[i - 1].midi));
    return { n: v.length, perMin: v.length / s.dur * 60, lo: Math.min(...v.map(x => x.midi)), hi: Math.max(...v.map(x => x.midi)),
             steps: iv.length ? iv.filter(x => x <= 2).length / iv.length : 0, leaps: iv.length ? iv.filter(x => x > 4).length / iv.length : 0,
             sounding: v.reduce((z, x) => z + x.t1 - x.t0, 0) / s.dur, medDur: q(v.map(x => x.t1 - x.t0).sort((x, y) => x - y), 0.5) }; };
  const mean = k => s.curves[k].reduce((z, x) => z + x, 0) / a.n;
  let c = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < a.n; i++) { const x = a.sig.move[i], y = s.curves.dyn[i]; c++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
  const corr = (sxy - sx * sy / c) / Math.sqrt((sxx - sx * sx / c) * (syy - sy * sy / c) || 1);
  // agreement: how much of the time the sounding chord is the place she is in (V on the way home counts);
  // persistence: how often a chord's place is still her place a second after it sounds
  const same = (pl, cd) => (pl === '8' ? '1' : pl) === cd || (s.mode === 'map' && cd === 'V' && pl === 'I');
  let agree = 0, tot = 0, ci = 0, persist = 0;
  for (let i = 0; i < a.n; i++) { if (s.places[i] < 0) continue; while (ci + 1 < s.chords.length && s.chords[ci + 1].t <= a.t[i]) ci++;
    tot++; if (same(s.placeNames[s.places[i]], s.chords[ci].deg)) agree++; }
  for (const c of s.chords) { const j = a.t.findIndex(t => t >= c.t + 1); if (j >= 0 && s.places[j] >= 0 && same(s.placeNames[s.places[j]], c.deg)) persist++; }
  return { agree: agree / Math.max(1, tot), persist: persist / Math.max(1, s.chords.length), chords: s.chords.length, perMin: s.chords.length / s.dur * 60, durMed: q(d, 0.5), dur10: q(d, 0.1), dur90: q(d, 0.9),
           share: Object.fromEntries(Object.entries(time).map(([k2, v]) => [k2, v / s.dur])),
           causes: s.chords.reduce((z, x) => { z[x.cause] = (z[x.cause] || 0) + 1; return z; }, {}),
           solo: line(s.mode === 'octave' ? 'vn1' : 'solo'), vcl: line('vcl'), pzb: by.pzb.length, pzh: by.pzh.length, harp: by.harp.length,
           top: line('vn1'), dynMean: mean('dyn'), dynMax: Math.max(...s.curves.dyn), tremShare: s.curves.trem.filter(x => x > 0.3).length / a.n,
           dynMoveCorr: corr, bassShare: by.cb.reduce((z, x) => z + x.t1 - x.t0, 0) / s.dur, first: s.chords[0]?.deg, last: s.chords[s.chords.length - 1]?.deg };
}
