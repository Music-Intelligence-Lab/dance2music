// Four real voices instead of blocks of chords: the body walks a bass line,
// the hands sing the top line, and two inner voices fill in by the oldest
// recipe for it, the Rule of the Octave (the 18th-century partimento rule that
// gives every step of a scale in the bass its own chord, different going up
// and coming down). DOM-free and audio-free; causal.
//
//   BASS (double basses)   The octave is the body's height. Standing tall is
//                          the upper tonic; as she lowers, lunges, folds and
//                          goes to the floor the bass walks DOWN the scale, one
//                          step at a time, to the lower tonic; rising walks it
//                          back UP. Steps land on her landings.
//
//   degree        1     2      3    4      5     6       7     (8 = 1)
//   going up      5/3   6/4/3  6    6/5    5/3   6       6/5
//   coming down   5/3   6/4/3  6    4/2    5/3   ♯6/4/3  6
//   (major:       I     V4/3   I6   ii6/5  V     IV6     V6/5  going up;
//                 I     V4/3   I6   V4/2   V     V4/3/V  V6    coming down)
//
//   SOPRANO (violins)      The hands. In 'height' control the higher hand's
//                          height is a place on the scale and the line walks
//                          to it step by step (raise an arm: a rising scale);
//                          in 'stroke' control every decisive arm stroke is a
//                          note and the stroke's rise or fall is the interval.
//                          Settling lands on a chord tone.
//
//   ALTO, TENOR            (violas, cellos) realise the figure under the
//                          soprano: the missing chord tones, smallest motion,
//                          no doubled leading tones or sevenths, parallel
//                          fifths and octaves avoided.
const mod = x => ((x % 12) + 12) % 12;
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// per bass degree: [pitch classes above the tonic (bass first), figure, root]
export const RULE = {
  major: {
    scaleUp: [0, 2, 4, 5, 7, 9, 11], scaleDown: [0, 2, 4, 5, 7, 9, 11],
    up:   [[[0, 4, 7], '5/3', 0], [[2, 5, 7, 11], '6/4/3', 7], [[4, 7, 0], '6', 0], [[5, 9, 0, 2], '6/5', 2], [[7, 11, 2], '5/3', 7], [[9, 0, 5], '6', 5], [[11, 2, 5, 7], '6/5', 7]],
    down: [[[0, 4, 7], '5/3', 0], [[2, 5, 7, 11], '6/4/3', 7], [[4, 7, 0], '6', 0], [[5, 7, 11, 2], '4/2', 7], [[7, 11, 2], '5/3', 7], [[9, 0, 2, 6], '♯6/4/3', 2], [[11, 2, 7], '6', 7]],
  },
  minor: {                                      // the bass takes ♮6 ♮7 going up, ♭7 ♭6 coming down
    scaleUp: [0, 2, 3, 5, 7, 9, 11], scaleDown: [0, 2, 3, 5, 7, 8, 10],
    up:   [[[0, 3, 7], '5/3', 0], [[2, 5, 7, 11], '6/4/3', 7], [[3, 7, 0], '6', 0], [[5, 8, 0, 2], '6/5', 2], [[7, 11, 2], '5/3', 7], [[9, 0, 5], '6', 5], [[11, 2, 5, 7], '6/5', 7]],
    down: [[[0, 3, 7], '5/3', 0], [[2, 5, 7, 11], '6/4/3', 7], [[3, 7, 0], '6', 0], [[5, 7, 11, 2], '4/2', 7], [[7, 11, 2], '5/3', 7], [[8, 0, 2, 6], '♯6/4/3', 2], [[10, 2, 7], '6', 7]],
  },
};
export const OCT_PLACES = ['1', '2', '3', '4', '5', '6', '7', '8'];
const RANGE = { cb: [33, 52], vc: [45, 64], va: [53, 72], vn1: [60, 91] };

export class Octave {
  constructor(P, notes, chords) {
    this.P = P; this.notes = notes; this.chords = chords;
    this.rule = RULE[P.octMode === 'minor' ? 'minor' : 'major'];
    let base = 36; while (mod(base) !== mod(P.key)) base++;        // the low tonic, C2 … B2
    if (base > 43) base -= 12;                                     // … kept inside the basses' comfortable octave
    this.base = base < 33 ? base + 12 : base;
    this.pos = 7; this.dir = 1; this.target = 7; this.lastStep = -1e9; this.wantSince = null;
    this.v = null; this.held = {}; this.ch = null;
    this.mel = { idx: null, lastOn: -1e9, settleSince: null, lastMove: -1e9 };
  }

  // the chord on bass position `pos` (0 … 7) reached in direction `dir`
  chord(pos, dir) {
    const d = pos % 7, [rel, fig, rootRel] = this.rule[dir >= 0 ? 'up' : 'down'][d], key = this.P.key;
    const pcs = rel.map(x => mod(key + x)), root = mod(key + rootRel);
    const third = pcs.find(x => mod(x - root) === 4 || mod(x - root) === 3), seventh = pcs.find(x => mod(x - root) === 10);
    const tend = new Set([mod(key + 11), seventh, rel.includes(6) ? mod(key + 6) : null].filter(x => x != null));
    const sc = (dir >= 0 ? this.rule.scaleUp : this.rule.scaleDown).slice();
    // the line's scale bends to the chord: a raised note in the chord replaces its natural neighbour
    for (const x of rel) if (!sc.includes(x)) { const j = sc.findIndex(y => Math.abs(y - x) === 1); if (j >= 0) sc[j] = x; }
    const bass = this.base + rel[0] + (pos === 7 ? 12 : 0);
    return { pos, deg: String(d + 1), fig, pcs, bassPc: pcs[0], bass, root, fifth: mod(root + 7), third, seventh, tend,
             scale: sc.map(x => mod(key + x)), symbol: `${NAMES[pcs[0]]} ${fig}`, dark: false };
  }

  ladder(ch) { const out = []; for (let m = this.P.melLo; m <= this.P.melHi; m++) if (ch.scale.includes(mod(m))) out.push(m); return out; }

  // alto and tenor under a given soprano and bass
  inner(ch, sop, prev) {
    const need = ch.pcs.filter(x => x !== ch.bassPc && x !== mod(sop));
    const ok = m => ch.pcs.includes(mod(m));
    let best = null;
    for (let a = RANGE.va[0]; a <= Math.min(RANGE.va[1], sop - 1); a++) { if (!ok(a)) continue;
      for (let tn = Math.max(RANGE.vc[0], ch.bass + 2); tn <= Math.min(RANGE.vc[1], a - 1); tn++) { if (!ok(tn)) continue;
        const pa = mod(a), pt = mod(tn); let cost = 0;
        for (const x of need) if (pa !== x && pt !== x) cost += x === ch.third || x === ch.seventh ? 7 : 2.5;
        for (const x of [pa, pt]) if (ch.tend.has(x) && (x === ch.bassPc || x === mod(sop))) cost += 6;      // a doubled tendency tone
        if (pa === pt) cost += ch.tend.has(pa) ? 6 : 2;
        if (sop - a > 12) cost += 1.2 * (sop - a - 12); if (a - tn > 12) cost += 1.5 * (a - tn - 12);
        if (tn - ch.bass < 5 && tn < 50) cost += 2;
        if (prev) {
          cost += Math.abs(a - prev.va) + Math.abs(tn - prev.vc) + (Math.abs(a - prev.va) > 4 ? 3 : 0) + (Math.abs(tn - prev.vc) > 4 ? 3 : 0);
          const now = { cb: ch.bass, vc: tn, va: a, vn1: sop }, ks = ['cb', 'vc', 'va', 'vn1'];
          for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {              // parallel fifths and octaves
            const p0 = prev[ks[i]], p1 = prev[ks[j]], q0 = now[ks[i]], q1 = now[ks[j]];
            if (p0 == null || p1 == null || p0 === q0 || p1 === q1) continue;
            const i0 = mod(p1 - p0), i1 = mod(q1 - q0);
            if (i0 === i1 && (i0 === 7 || i0 === 0) && Math.sign(q0 - p0) === Math.sign(q1 - p1)) cost += 8;
          }
        } else cost += 0.3 * (Math.abs(a - 62) + Math.abs(tn - 54));
        if (!best || cost < best.cost) best = { cost, va: a, vc: tn };
      } }
    return best || { va: Math.min(sop - 3, 62), vc: Math.max(ch.bass + 7, 50) };
  }

  sound(part, midi, t, vel = 1, src = 'chord') {
    const h = this.held[part];
    if (h && h.midi === midi) return;
    if (h) h.t1 = t + 0.12;
    const n = { part, art: 'sus', midi, t0: t, t1: null, vel, src }; this.notes.push(n); this.held[part] = n;
  }

  // a new chord: the soprano keeps its note when it belongs, else steps to the nearest tone (against the bass by preference)
  setChord(pos, dir, t, cause) {
    const ch = this.chord(pos, dir), L = this.ladder(ch), prev = this.v;
    let sop;
    if (!prev) { sop = L.reduce((b, m) => (ch.pcs.includes(mod(m)) && Math.abs(m - 71) < Math.abs(b - 71) ? m : b), L.find(m => ch.pcs.includes(mod(m)))); }
    else {
      const bassDir = Math.sign(ch.bass - prev.cb); let bc = 1e9; sop = prev.vn1;
      for (const m of L) { if (!ch.pcs.includes(mod(m))) continue;
        const d = m - prev.vn1; let c = Math.abs(d) + (Math.abs(d) > 2 ? 2 * (Math.abs(d) - 2) : 0);
        if (d !== 0 && Math.sign(d) === bassDir) c += 0.8;                       // contrary motion is better
        if (ch.tend.has(mod(m)) && mod(m) === ch.bassPc) c += 5;
        const i0 = mod(prev.vn1 - prev.cb), i1 = mod(m - ch.bass);
        if (d !== 0 && i0 === i1 && (i0 === 0 || i0 === 7) && Math.sign(d) === bassDir) c += 6;
        if (c < bc) { bc = c; sop = m; } }
    }
    const inn = this.inner(ch, sop, prev);
    this.v = { cb: ch.bass, vc: inn.vc, va: inn.va, vn1: sop }; this.ch = ch;
    this.sound('cb', ch.bass, t); this.sound('vc', inn.vc, t); this.sound('va', inn.va, t);
    if (!prev || sop !== prev.vn1) { this.sound('vn1', sop, t, 0.7, 'chord'); this.mel.idx = L.indexOf(sop); }
    else this.mel.idx = L.indexOf(sop);
    this.chords.push({ t, deg: ch.deg, pos, symbol: ch.symbol, fig: ch.fig, cause, voicing: { ...this.v },
                       lag: this.wantSince === null ? 0 : t - this.wantSince });
    this.pos = pos; this.dir = dir; this.lastStep = t; this.wantSince = null;
    return ch;
  }

  // sm: the shape as read on arrival {level, fold, invert}; returns the target position 0 … 7
  place(sm) {
    const P = this.P;
    const raw = clip(Math.max((P.octTop - sm.level) / Math.max(0.05, P.octTop - P.octBottom), P.octFold * sm.fold, sm.invert));
    const depth = clip((raw - P.octRest) / Math.max(0.05, 1 - 2 * P.octRest));       // both tonics are wide: standing and the floor are places of rest
    // the upper tetrachord (8 7 6 5: tonic down to the dominant) takes most of the body's range, standing to a deep
    // lunge; the lower one (4 3 2 1) is for the floor
    const x = 7 - 3 * clip(depth / P.octKnee) - 4 * clip((depth - P.octKnee) / Math.max(0.05, 1 - P.octKnee));
    if (Math.abs(x - this.target) > P.octHyst) this.target = Math.round(x);
    return this.target;
  }

  // one frame of the bass: step towards the target, on landings
  bassFrame(t, sm, landing) {
    const P = this.P;
    if (!this.ch) return this.setChord(7, 1, t, 'start');
    const target = this.place(sm), gap = target - this.pos;
    if (gap === 0) { this.wantSince = null; return this.ch; }
    if (this.wantSince === null) this.wantSince = t;
    const every = Math.abs(gap) >= 3 ? P.octRunS : P.octStepS, since = t - this.lastStep;
    if (since >= every && (landing || Math.abs(gap) >= 3 || since >= every + P.waitS))
      return this.setChord(this.pos + Math.sign(gap), Math.sign(gap), t, landing ? 'landing' : 'held');
    return this.ch;
  }

  // the soprano between chords.  'height': walk the scale towards the hand;  'stroke': see strokeNote()
  melodyFrame(t, u, handSpeed, active) {
    const P = this.P, M = this.mel, ch = this.ch; if (!ch || M.idx === null || P.melControl !== 'height') return;
    const L = this.ladder(ch); M.idx = Math.max(0, Math.min(L.length - 1, M.idx));
    const lowest = L.findIndex(m => m > this.v.va + 1), floorIdx = lowest < 0 ? L.length - 1 : lowest;
    const moving = active && handSpeed > P.melMove;
    if (moving) {
      M.settleSince = null;
      const want = Math.max(floorIdx, Math.round(clip(u) * (L.length - 1))), gap = want - M.idx;
      const every = Math.abs(gap) >= 4 ? P.melRunS : P.melGapS;
      if (Math.abs(gap) >= P.melDead && t - M.lastOn >= every) {
        // near the hand: a step; far from it: a third when that lands on a chord tone (the line arpeggiates instead of running scales)
        let nx = M.idx + Math.sign(gap);
        const third = M.idx + 2 * Math.sign(gap);
        if (Math.abs(gap) >= 4 && P.melThirds && L[third] != null && ch.pcs.includes(mod(L[third]))) nx = third;
        M.idx = nx; this.sing(L[nx], t, clip(0.45 + handSpeed));
      }
    } else {
      if (M.settleSince === null) M.settleSince = t;
      // settled: come to rest on a chord tone, by step
      if (t - M.settleSince >= P.melSettleS && !ch.pcs.includes(mod(L[M.idx])) && t - M.lastOn >= P.melGapS) {
        let j = null; for (const d of [-1, 1, -2, 2]) { const q = M.idx + d; if (q >= floorIdx && q < L.length && ch.pcs.includes(mod(L[q]))) { j = q; break; } }
        if (j !== null) { M.idx = j; this.sing(L[j], t, 0.5); }
      }
    }
  }
  // 'stroke' control: one decisive arm stroke, one note; the stroke's rise or fall is the interval
  strokeNote(t, e, space) {
    const P = this.P, M = this.mel, ch = this.ch; if (!ch || M.idx === null || t - M.lastOn < P.melGapS) return;
    const L = this.ladder(ch); M.idx = Math.max(0, Math.min(L.length - 1, M.idx));
    const lowest = L.findIndex(m => m > this.v.va + 1), floorIdx = lowest < 0 ? L.length - 1 : lowest;
    const abs = Math.round(clip((e.up - P.melMinUp) / (1.05 - P.melMinUp)) * (L.length - 1));
    let d = Math.round((e.dir ? e.dir[1] * e.path * e.straight : 0) * P.melDeg);
    if (d === 0) d = Math.sign(abs - M.idx);
    if (Math.abs(abs - M.idx) > 5 && Math.sign(abs - M.idx) !== Math.sign(d)) d = Math.sign(abs - M.idx);
    const maxStep = space > 0.6 ? P.melStep : P.melLeap;
    let idx = Math.max(floorIdx, Math.min(L.length - 1, M.idx + Math.max(-maxStep, Math.min(maxStep, d))));
    if (e.peak < 2 && !ch.pcs.includes(mod(L[idx]))) { const dn = Math.sign(idx - M.idx) || 1; if (L[idx + dn] != null && ch.pcs.includes(mod(L[idx + dn]))) idx += dn; else if (L[idx - dn] != null && idx - dn >= floorIdx && ch.pcs.includes(mod(L[idx - dn]))) idx -= dn; }
    if (idx === M.idx) return;
    M.idx = idx; this.sing(L[idx], t, clip(0.4 + e.peak / 9, 0.3, 1));
  }
  sing(midi, t, vel) { this.sound('vn1', midi, t, vel, 'hands'); this.v.vn1 = midi; this.mel.lastOn = t; }

  home(t) { if (this.ch && this.pos % 7 !== 0) this.setChord(this.pos >= 4 ? 7 : 0, this.pos >= 4 ? 1 : -1, t, 'exit'); }
}
