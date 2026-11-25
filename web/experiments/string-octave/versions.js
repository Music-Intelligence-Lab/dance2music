// Named versions of the mapping: each is a set of overrides on DEFAULTS
// (arrange.js). The page offers them in the Version menu; the lab scores them
// with the judge  and can search around
// them (… search), which rewrites TUNED below.
export const VERSIONS = [
  { id: 'walking', name: 'Walking octave', about: 'The default: the bass walks the octave with her height, the hands lead the top line by height.', params: {} },
  { id: 'adagio', name: 'Adagio', about: 'The same, slower: a bass step every 2.6 s at most, a calmer top line, longer swells.',
    params: { octStepS: 2.6, octRunS: 1.1, melGapS: 0.75, melRunS: 0.45, melDead: 3, dynUpS: 1.0, dynDownS: 7, transit: 3.5 } },
  { id: 'strokes', name: 'Sung strokes', about: 'The top line sings one note per decisive arm stroke; the stroke\'s rise or fall is the interval.',
    params: { melControl: 'stroke', melGapS: 0.45 } },
  { id: 'bowed', name: 'Bowed', about: 'Each voice is bowed by its own limbs: the top by the hands, the bass by the legs. The most gestural dynamics.',
    params: { dynLink: 1, dynFast: 0.8, dynUpS: 0.4 } },
  { id: 'lament', name: 'Lament (minor)', about: 'The octave in the minor: the descending tetrachord, with the augmented sixth on the way down.',
    params: { octMode: 'minor', octStepS: 2.0, octRunS: 0.8, melGapS: 0.6, melDead: 3 } },
  { id: 'duet', name: 'Duet (two hands, no harmony)', about: 'Two sung lines and nothing else: each hand is a line (hers right: violin, left: cello a tenth below). Height is pitch, a fast hand slides, a fist lifts the bow, the hand\'s speed is the bow, vibrato grows into held notes, and a dissonance held between the two melts by step.',
    params: { mode: 'song', sngVoices: 2 } },
  { id: 'song', name: 'Song (one line)', about: 'One sung line: the higher open hand leads it. Everything else as in the duet.',
    params: { mode: 'song', sngVoices: 1 } },
  { id: 'duet-penta', name: 'Duet, pentatonic', about: 'The duet on a five-note scale, the lines an octave apart: no semitones, so nothing needs resolving and a slow arm is a tune rather than a scale.',
    params: { mode: 'song', sngVoices: 2, sngScale: 'minor pentatonic', sngApart: 5, sngLo1: 62, sngHi1: 81, sngResolve: 0 } },
  { id: 'ornate', name: 'Octave with ornaments', about: 'The walking octave plus the leg line in the cellos, plucked steps and accents, and the harp.',
    params: { leg: 1, steps: 1, acc: 1, harp: 1, harpSpin: 1 } },
  { id: 'map', name: 'Chord map (Nov 14)', about: 'Yesterday\'s texture: blocks of chords chosen by her shape, an arm line above them.',
    params: { mode: 'map', melGapS: 0.5, leg: 1, steps: 1, acc: 1, harp: 1, harpSpin: 1, dynLink: 0 } },
];
// what the search found around each version (empty until the lab's search has run). The range and the time
// constants of the dynamics are not searched: they were set by ear (Nov 16: a narrower range, a slow fall)
export const TUNED = {"walking": {"octStepS": 1.95, "melDead": 2, "dynLink": 0.68, "dynGesture": 0.3, "octRunS": 0.75, "octKnee": 0.71, "octHyst": 0.5, "melGapS": 0.6, "melRunS": 0.31, "melLo": 66, "dynFast": 0.74, "waitS": 0.7, "octRest": 0.09, "melSettleS": 0.25, "transit": 2.9, "melMove": 0.09, "melHi": 84}, "adagio": {"transit": 2.5, "melRunS": 0.34, "melLo": 66, "dynFast": 0.48, "dynGesture": 0.23, "octStepS": 1.7, "melDead": 5, "melMove": 0.11, "melHi": 79, "dynLink": 0.63, "melGapS": 0.8, "melSettleS": 0.25, "octHyst": 0.9, "waitS": 0.65, "octRest": 0.11, "octRunS": 0.95, "octKnee": 0.84}, "strokes": {"octKnee": 0.95, "octRest": 0.09, "transit": 2.15, "melSettleS": 0.4, "melDeg": 2.4, "octRunS": 0.5, "octHyst": 0.9, "melGapS": 0.35, "melHi": 84, "dynLink": 0.92, "dynGesture": 0.21, "waitS": 0.75, "octStepS": 1.3, "melPeak": 2, "melLo": 60, "dynFast": 0.67}, "bowed": {"octHyst": 0.7, "transit": 3.25, "dynGesture": 0.19, "octStepS": 1.2, "octRunS": 0.5, "octKnee": 0.87, "octRest": 0.11, "melDead": 2, "waitS": 0.75, "melGapS": 0.6, "melRunS": 0.33, "melHi": 84, "dynLink": 1, "melMove": 0.17, "melSettleS": 0.35}, "lament": {"octKnee": 0.95, "melDead": 2, "melMove": 0.17, "dynFast": 0.5, "dynGesture": 0.22, "octRest": 0.13, "octHyst": 0.65, "transit": 3, "waitS": 0.95, "melRunS": 0.25, "melLo": 60, "melHi": 78, "octStepS": 1.55, "octRunS": 0.65, "dynLink": 0.61}, "ornate": {"octStepS": 1.65, "melGapS": 1.15, "melLo": 67, "dynFast": 0.86, "waitS": 0.95, "octRest": 0.1, "octHyst": 0.8, "melSettleS": 0.55, "transit": 2.5, "melDead": 2, "dynLink": 0.71, "melRunS": 0.28, "melHi": 84, "octRunS": 0.5, "melMove": 0.12, "octKnee": 0.73, "dynGesture": 0.28}, "map": {"melGapS": 0.55, "melPath": 0.35, "melPeak": 2.7, "dynLink": 0.1, "minChordS": 1.8, "leanOn": 24, "waitS": 1.1, "melLo": 67, "melDeg": 1.4, "dynFast": 0.45, "dynGesture": 0.2, "dwellS": 0.25, "melHi": 82, "transit": 3.8}};
export const paramsOf = id => { const v = VERSIONS.find(x => x.id === id); return v ? { ...v.params, ...(TUNED[id] || {}) } : {}; };
