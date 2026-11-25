// A judge for a score: numbers a counterpoint teacher and a choreographer
// would each look at, 0 … 1, and one total. It reads the notes, not the sound:
// it can say that the voices move well and that the music moves when she
// does; it cannot say that it is beautiful. Use it to rank versions and to
// see WHY one ranks above another, then listen.
//
//   voices        the inner voices move little; no parallel fifths or octaves;
//                 soprano and bass move against each other
//   melody        mostly steps with some thirds, few big leaps; a real range;
//                 not endless scales; long notes are chord tones; a sane pace
//   harmony       a harmonic rhythm you can follow; home about a third of the
//                 time; dominant → tonic arrivals; ends at home; some variety
//   fit           the bass follows her height; changes land on her landings;
//                 the music is where her body is; stillness is a little quieter
//   expression    each voice's dynamic follows its own limbs; the dynamic moves
//                 within a moderate range (by ear, Nov 16: a wide one is not
//                 musical); it swells and does not flicker
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mod = x => ((x % 12) + 12) % 12;
const band = (x, lo, hi, soft) => (x >= lo && x <= hi ? 1 : clip(1 - (x < lo ? lo - x : x - hi) / soft));
const mean = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
function corr(x, y, n) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
  const d = Math.sqrt((sxx - sx * sx / n) * (syy - sy * sy / n));
  return d > 1e-9 ? (sxy - sx * sy / n) / d : 0;
}
const pct = (arr, q) => { const v = Array.from(arr).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]; };

export const WEIGHTS = { voices: 0.2, melody: 0.25, harmony: 0.15, fit: 0.2, expression: 0.2 };

// Song mode (no harmony): the same idea with other questions.
//   line          each line moves mostly by step with some leaps, over a real range, at a singable pace;
//                 its long notes are at rest (the tonic triad, or a consonance with the other line)
//   together      (two lines) consonant when both hold; not glued to each other all the time
//   phrasing      the lines breathe: they sound most but not all of the time, in phrases of a few seconds
//   expression    the loudness follows the hand that bows it, within a moderate range; long notes get vibrato
//   fit           the pitch is where the hand is
export const SONG_WEIGHTS = { line: 0.25, together: 0.15, phrasing: 0.2, expression: 0.25, fit: 0.15 };
const CONS = new Set([0, 3, 4, 7, 8, 9]);
function judgeSong(a, s) {
  const n = a.n, S = a.sig, C = s.curves, P = s.params, why = {}, two = s.song.voices >= 2, T = a.t;
  const stable = new Set([0, [0, 4].every(x => (s.song.ladders[0] || []).some(m => mod(m - s.key) === x)) ? 4 : 3, 7].map(x => mod(s.key + x)));
  const per = { line: [], phrasing: [], expression: [], fit: [] };
  for (let k = 1; k <= s.song.voices; k++) {
    const ns = s.notes.filter(x => x.part === 's' + k), amp = C['amp' + k], gate = C['gate' + k], pitch = C['pitch' + k], vib = C['vib' + k];
    const side = two ? ((P.sngUpper === 'left') === (k === 1) ? 'L' : 'R') : null;
    const sp = new Float32Array(n), up = new Float32Array(n);
    for (let i = 0; i < n; i++) { sp[i] = side ? S[side === 'L' ? 'spLH' : 'spRH'][i] : Math.max(S.spLH[i], S.spRH[i]); up[i] = side ? S['up' + side][i] : Math.max(S.upL[i], S.upR[i]); }
    // line
    const iv = []; for (let i = 1; i < ns.length; i++) if (ns[i].slur) iv.push(Math.abs(ns[i].midi - ns[i - 1].midi));
    const steps = iv.length ? iv.filter(x => x >= 1 && x <= 2).length / iv.length : 0, leaps = iv.length ? iv.filter(x => x > 7).length / iv.length : 0;
    const range = ns.length ? Math.max(...ns.map(x => x.midi)) - Math.min(...ns.map(x => x.midi)) : 0, perMin = ns.length / s.dur * 60;
    const long = ns.filter(x => x.t1 - x.t0 >= 1), other = two ? C['pitch' + (3 - k)] : null, og = two ? C['gate' + (3 - k)] : null;
    let rest = 0; for (const x of long) { let i = 0; while (i < n - 1 && T[i] < x.t1 - 0.1) i++;
      rest += (og && og[i] ? CONS.has(mod(Math.abs(x.midi - Math.round(other[i])))) : stable.has(mod(x.midi))) ? 1 : 0; }
    const longRest = long.length ? rest / long.length : 1;
    per.line.push(ns.length < 4 ? 0 : mean([band(steps, 0.4, 0.8, 0.3), clip(1 - 3 * Math.max(0, leaps - 0.15)), clip(range / 9), band(perMin, 20, 70, 40), clip((longRest - 0.4) / 0.5)]));
    // phrasing
    const runs = []; let t0 = null, on = 0, seen = 0;
    for (let i = 0; i < n; i++) { if (S.seen[i]) seen++; if (gate[i]) { on++; if (t0 === null) t0 = T[i]; } else if (t0 !== null) { runs.push(T[i] - t0); t0 = null; } }
    if (t0 !== null) runs.push(s.dur - t0);
    const sounding = on / Math.max(1, seen), phraseMed = runs.length ? pct(runs, 0.5) : 0, phrasesPerMin = runs.length / s.dur * 60;
    per.phrasing.push(mean([band(sounding, 0.35, 0.8, 0.3), band(phraseMed, 2.5, 12, 6), band(phrasesPerMin, 3, 14, 6)]));
    // expression
    const g = [], h = [], av = []; let trav = 0, oldT = 0, vibT = 0, ni = 0;
    for (let i = 0; i < n; i++) { if (!gate[i]) continue; g.push(amp[i]); h.push(sp[i]); av.push(amp[i]); if (i && gate[i - 1]) trav += Math.abs(amp[i] - amp[i - 1]);
      while (ni < ns.length - 1 && ns[ni + 1].t0 <= T[i]) ni++;
      if (ns[ni] && T[i] - ns[ni].t0 > 1.2) { oldT++; if (vib[i] > 0.25) vibT++; } }
    const follows = g.length > 10 ? corr(g, h, g.length) : 0, dynRange = av.length ? pct(av, 0.95) - pct(av, 0.05) : 0, vibShare = oldT ? vibT / oldT : 1, travel = trav / Math.max(1, on / 30);
    per.expression.push(mean([clip(follows / 0.45), band(dynRange, 0.25, 0.5, 0.3), clip(vibShare / 0.6), clip(1 - (travel - 0.5) / 0.6)]));
    // fit
    const pg = [], ug = []; for (let i = 0; i < n; i++) if (gate[i]) { pg.push(pitch[i]); ug.push(up[i]); }
    const pitchFollows = pg.length > 10 ? corr(pg, ug, pg.length) : 0;
    per.fit.push(clip(pitchFollows / 0.75));
    Object.assign(why, Object.fromEntries(Object.entries({ steps, leaps, range, notesPerMin: perMin, longAtRest: longRest, sounding, phraseMed, phrasesPerMin, ampFollowsHand: follows, dynRange, vibratoOnLong: vibShare, pitchFollowsHand: pitchFollows })
      .map(([q, v]) => [q + k, v])));
  }
  const scores = Object.fromEntries(Object.entries(per).map(([q, v]) => [q, mean(v)]));
  if (two) {
    let both = 0, cons = 0, same = 0, either = 0;
    for (let i = 0; i < n; i++) { const g1 = C.gate1[i], g2 = C.gate2[i]; if (g1 || g2) either++; if (!(g1 && g2)) continue; both++;
      if (CONS.has(mod(Math.round(C.pitch1[i]) - Math.round(C.pitch2[i])))) cons++;
      if (i && Math.abs((C.pitch1[i] - C.pitch1[i - 1]) - (C.pitch2[i] - C.pitch2[i - 1])) < 0.02) same++; }
    why.both = both / Math.max(1, either); why.consonant = cons / Math.max(1, both); why.parallel = same / Math.max(1, both);
    scores.together = both < 30 ? 0.5 : mean([clip((why.consonant - 0.45) / 0.35), band(why.both, 0.3, 0.8, 0.3)]);
  }
  const W = Object.entries(SONG_WEIGHTS).filter(([q]) => q in scores), tot = W.reduce((z, [, w]) => z + w, 0);
  return { total: W.reduce((z, [q, w]) => z + w * scores[q], 0) / tot, scores, why };
}

export function judge(a, s) {
  if (s.mode === 'song') return judgeSong(a, s);
  const n = a.n, S = a.sig, C = s.curves, oct = s.mode === 'octave', why = {};
  const V = s.chords.map(c => c.voicing).filter(Boolean), parts = ['cb', 'vc', 'va', 'vn2', 'vn1'];

  // ── voices ──
  let inner = [], par = 0, pairs = 0, contrary = 0, moves = 0;
  for (let i = 1; i < V.length; i++) {
    const p = V[i - 1], q = V[i];
    for (const k of ['vc', 'va', 'vn2']) if (p[k] != null && q[k] != null) inner.push(Math.abs(q[k] - p[k]));
    for (let x = 0; x < 5; x++) for (let y = x + 1; y < 5; y++) {
      const p0 = p[parts[x]], p1 = p[parts[y]], q0 = q[parts[x]], q1 = q[parts[y]];
      if (p0 == null || p1 == null || q0 == null || q1 == null || p0 === q0 || p1 === q1) continue;
      pairs++; const i0 = mod(p1 - p0), i1 = mod(q1 - q0);
      if (i0 === i1 && (i0 === 0 || i0 === 7) && Math.sign(q0 - p0) === Math.sign(q1 - p1)) par++;
    }
    const lowP = p.cb ?? p.vc, lowQ = q.cb ?? q.vc;
    if (lowP !== lowQ) { moves++; if (Math.sign(q.vn1 - p.vn1) !== Math.sign(lowQ - lowP)) contrary++; }
  }
  why.innerMotion = mean(inner); why.parallels = par / Math.max(1, V.length - 1); why.contrary = contrary / Math.max(1, moves);
  const voices = mean([clip(1 - (why.innerMotion - 1.2) / 3), clip(1 - 3 * why.parallels), clip(why.contrary / 0.65)]);

  // ── melody ──
  const line = s.notes.filter(x => x.part === (oct ? 'vn1' : 'solo')), iv = [];
  for (let i = 1; i < line.length; i++) if (line[i].t0 - line[i - 1].t0 < 3) iv.push(line[i].midi - line[i - 1].midi);
  const ab = iv.map(Math.abs);
  why.steps = ab.length ? ab.filter(x => x >= 1 && x <= 2).length / ab.length : 0;
  why.thirds = ab.length ? ab.filter(x => x === 3 || x === 4).length / ab.length : 0;
  why.leaps = ab.length ? ab.filter(x => x > 7).length / ab.length : 0;
  why.range = line.length ? Math.max(...line.map(x => x.midi)) - Math.min(...line.map(x => x.midi)) : 0;
  why.notesPerMin = line.length / s.dur * 60;
  let run = 0, inRun = 0;                                   // notes inside same-direction runs of five or more: scales
  for (let i = 0; i <= iv.length; i++) { const same = i > 0 && i < iv.length && Math.sign(iv[i]) === Math.sign(iv[i - 1]) && iv[i] !== 0;
    if (same) run++; else { if (run >= 4) inRun += run + 1; run = 0; } }
  why.scales = iv.length ? inRun / iv.length : 0;
  let ct = 0, long = 0, ci = 0;                             // long notes on chord tones (the chord at the note's onset)
  for (const x of line) { if (x.t1 - x.t0 < 0.8) continue; while (ci + 1 < s.chords.length && s.chords[ci + 1].t <= x.t0 + 0.05) ci++;
    const v = s.chords[ci] && s.chords[ci].voicing; if (!v) continue; long++;
    if (Object.values(v).some(m => m != null && mod(m) === mod(x.midi))) ct++; }
  why.longOnChord = long ? ct / long : 1;
  const melody = line.length < 4 ? 0 : mean([band(why.steps, 0.45, 0.8, 0.3), band(why.thirds, 0.12, 0.45, 0.2), clip(1 - 6 * why.leaps), clip(why.range / 12),
                                             band(why.notesPerMin, 18, 70, 40), clip(1 - (why.scales - 0.3) / 0.5), clip((why.longOnChord - 0.4) / 0.5)]);

  // ── harmony ──
  const durs = s.chords.map((c, i) => (i + 1 < s.chords.length ? s.chords[i + 1].t : s.dur) - c.t), time = {};
  s.chords.forEach((c, i) => { time[c.deg] = (time[c.deg] || 0) + durs[i]; });
  const tonic = oct ? '1' : 'I', dom = oct ? '5' : 'V', tot = durs.reduce((x, y) => x + y, 0) || 1;
  why.chordsPerMin = s.chords.length / s.dur * 60; why.home = (time[tonic] || 0) / tot;
  let cad = 0; for (let i = 1; i < s.chords.length; i++) { const p = s.chords[i - 1], q = s.chords[i];
    if (q.deg === tonic && (p.deg === dom || (oct && (p.deg === '7' || p.deg === '2')))) cad++; }
  why.cadencesPerMin = cad / s.dur * 60;
  const ps = Object.values(time).map(x => x / tot); why.variety = ps.length > 1 ? -ps.reduce((z, p) => z + p * Math.log(p), 0) / Math.log(ps.length) : 0;
  why.endsHome = s.chords.length && s.chords[s.chords.length - 1].deg === tonic ? 1 : 0;
  const harmony = mean([band(why.chordsPerMin, 12, 30, 20), band(why.home, 0.2, 0.5, 0.25), clip(why.cadencesPerMin / 1.5), clip(why.variety / 0.8), why.endsHome]);

  // ── fit ──
  let agree = 0, seenN = 0, ci2 = 0; const bass = new Float32Array(n), depth = new Float32Array(n);
  const same = (pl, cd) => (pl === '8' ? '1' : pl) === cd || (!oct && cd === 'V' && pl === 'I');
  for (let i = 0; i < n; i++) { while (ci2 + 1 < s.chords.length && s.chords[ci2 + 1].t <= a.t[i]) ci2++;
    const c = s.chords[ci2]; bass[i] = c && c.voicing ? (c.voicing.cb ?? c.voicing.vc) : 0; depth[i] = Math.max(1 - S.level[i], 0.85 * S.fold[i], S.invert[i]);
    if (s.places[i] < 0 || !c) continue; seenN++; if (same(s.placeNames[s.places[i]], c.deg)) agree++; }
  why.agree = agree / Math.max(1, seenN);
  why.bassFollows = oct ? -corr(bass, depth, n) : null;        // the bass is low when she is low
  why.onLandings = s.chords.filter(c => c.cause === 'landing').length / Math.max(1, s.chords.length - 1);
  const st = [], mv = []; for (let i = 0; i < n; i++) (S.still[i] > 0 ? st : mv).push(C.dyn[i]);
  why.stillQuiet = st.length > 10 ? 1 - mean(st) / Math.max(1e-6, mean(mv)) : 0.5;
  const fit = mean([clip(why.agree / 0.7), oct ? clip(why.bassFollows / 0.7) : clip(why.agree / 0.7), clip(why.onLandings / 0.6), band(why.stillQuiet, 0.08, 0.3, 0.3)]);

  // ── expression ──
  const legs = new Float32Array(n); for (let i = 0; i < n; i++) legs[i] = Math.max(S.spLF[i], S.spRF[i]);
  why.topFollowsHands = corr(C.dynTop, S.hands, n); why.bassFollowsLegs = corr(C.dynBass, legs, n); why.allFollowsBody = corr(C.dynMid, S.move, n);
  why.dynRange = pct(C.dyn, 0.95) - pct(C.dyn, 0.05);
  // … but swells, not flicker: how much the top voice's dynamic travels per second
  let trav = 0; for (let i = 1; i < n; i++) trav += Math.abs(C.dynTop[i] - C.dynTop[i - 1]);
  why.dynTravel = trav / Math.max(1, s.dur);
  const expression = mean([clip(why.topFollowsHands / 0.5), clip(why.bassFollowsLegs / 0.45), clip(why.allFollowsBody / 0.5), band(why.dynRange, 0.2, 0.45, 0.3),
                           clip(1 - (why.dynTravel - 0.45) / 0.5)]);

  const scores = { voices, melody, harmony, fit, expression };
  const total = Object.entries(WEIGHTS).reduce((z, [k, w]) => z + w * scores[k], 0);
  return { total, scores, why };
}
