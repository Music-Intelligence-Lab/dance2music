// Song: no harmony. One or two sung lines, and everything the body does goes
// into HOW they are played. DOM-free and audio-free; causal.
//
//   A line is a hand. What a string player does with two hands and a bow, the
//   dancer does with one hand and the rest of her body:
//
//   PITCH        the hand's height against her own hips and head is a place on a
//                scale (P.sngScale on P.key). The line goes where the hand goes.
//                A slow hand steps from note to note, each one glided into
//                (P.sngGlideS). A fast hand (more than P.sngRunV notes a
//                second) does not run the scale: the note is held while the
//                hand flies, leaning towards it by P.sngGliss (0: not at all,
//                1: the pitch slides with the hand, a full glissando), and
//                where the hand lands the line LEAPS there, with a portamento
//                that is longer for a wider leap (P.sngPortS). So the notes of
//                the tune are where the hand dwells, as in singing, and the
//                score has a continuous pitch curve for each line as well as
//                its notes.
//   BOW          an open hand is the bow on the string; a FIST lifts it (silence,
//                P.sngGate). A hand that hangs at her side (below P.sngRestUp)
//                or stops moving for P.sngRestS lets the line rest too: a
//                phrase is one excursion of the hand. Opening the hand, lifting
//                it, or moving again starts a new bow: its attack is as sudden
//                as the hand is fast.
//   DYNAMIC      the hand's speed is the bow's speed (quick to swell, slower to
//                fall), on top of a slow phrase level from the whole body's
//                energy; rising lines swell a little; sudden movements accent.
//   VIBRATO      grows into every held note (none at first, P.vibDelayS, then
//                wider over P.vibGrowS), wider and a little faster when loud;
//                it stops while the line moves.
//   COLOUR       a hand far from the body and a loud bow are bright; a hand held
//                close, and a body low to the floor, are darker.
//   LANDING      in a duet a leap, or a new bow, lands on the note nearest the hand
//                that is consonant with the other line (a step aside at most).
//   RESOLUTION   a note held for P.sngSettleS by a hand that has stopped climbing or
//                falling (a line on its way somewhere is left alone), and that is not at rest, resolves by
//                step: alone, to a note of the tonic triad; in a duet, to a
//                consonance with the other line (thirds, sixths, fifths,
//                octaves). So a dissonance lingers, then melts: an appoggiatura.
//
//   One line (P.sngVoices 1): the higher open hand leads.
//   Two lines: P.sngUpper hand is the upper line, the other the lower. The lower
//   line's scale lies P.sngApart scale steps under the upper one (9: a tenth),
//   so hands at the same height sing in tenths, hands that part or cross make
//   the other intervals, and hands moving against each other, contrary motion.
//
// Output, for line k = 1, 2:  notes on part 's' + k (art 'sus'; slur: true when
// the bow did not change, and then glide: how long the slide into it is), and per-frame curves
//   pitch k   MIDI pitch, fractional (held while silent)
//   amp k     loudness 0..1, the bow's attack and release included
//   vib k     vibrato depth 0..1,  vibHz k its rate
//   bri k     brightness 0..1
//   gate k    1 while the bow is on the string
const mod = x => ((x % 12) + 12) % 12;
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;

export const SCALES = {
  dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  major: [0, 2, 4, 5, 7, 9, 11], 'minor pentatonic': [0, 3, 5, 7, 10], 'major pentatonic': [0, 2, 4, 7, 9],
};
export const SONG_PARTS = ['s1', 's2'];
const CONSONANT = new Set([0, 3, 4, 7, 8, 9]);
const P_RESOLVE_GLIDE = 0.12;                        // a resolution is fingered, not slid (s)       // against the other line: unison/octave, thirds, the fifth, sixths

// one hand: is it closed, is it moving (both with hysteresis, so a flicker is not a gesture)
class Hand {
  constructor(sd) { this.sd = sd; this.closed = false; this.fistSince = null; this.moving = false; this.lastMove = -1e9; this.stopAt = -1e9; this.started = false; this.lastUp = -1e9; this.down = true; }
  read(S, i, t, P) {
    const sd = this.sd, sp = S[sd === 'L' ? 'spLH' : 'spRH'][i];
    this.up = S['up' + sd][i]; this.sp = sp; this.vy = S['vy' + sd][i]; this.out = S['out' + sd][i]; this.fist = S['fist' + sd][i];
    if (this.up > P.sngRestUp + (this.down ? 0.05 : 0)) this.lastUp = t;
    this.down = t - this.lastUp > 0.35;                       // hanging at her side: not playing
    if (this.fist > P.fistOn) { if (this.fistSince === null) this.fistSince = t; } else this.fistSince = null;
    if (!this.closed && this.fistSince !== null && t - this.fistSince >= P.fistHoldS) this.closed = true;
    else if (this.closed && this.fist < P.fistOff) this.closed = false;
    const was = this.moving;
    this.moving = was ? sp > 0.6 * P.sngMove : sp > P.sngMove;
    this.started = this.moving && !was;                       // a new stroke begins
    if (was && !this.moving) this.stopAt = t;
    if (this.moving) this.lastMove = t;
  }
}

class Voice {
  constructor(k, L, P, notes) {
    this.k = k; this.part = 's' + k; this.P = P; this.notes = notes; this.L = L; this.g = 0; this.fast = false; this.glide = P.sngGlideS;
    const sc = SCALES[P.sngScale] || SCALES.dorian;
    this.stable = new Set([0, sc.includes(4) ? 4 : 3, 7].map(x => mod(P.key + x)));
    this.gate = false; this.idx = Math.floor(this.L.length / 2); this.noteIdx = null; this.cur = null; this.pend = null; this.pendSince = 0;
    this.pc = this.pitch = this.L[this.idx]; this.scoop = 0; this.changed = -1e9; this.resolved = true; this.holdX = null; this.x = 0;
    this.bow = 0; this.acc = 0; this.lvl = P.sngFloor; this.env = 0; this.dip = 0; this.attack = 0.1; this.release = 0.3;
    this.vib = 0; this.bri = 0.5; this.vel = 0.6; this.bowAt = -1e9; this.calm = -1e9;
  }
  midi() { return this.L[this.idx]; }
  note(t0, slur) {
    if (this.cur) this.cur.t1 = Math.max(t0, this.cur.t0 + 0.03);
    const n = { part: this.part, art: 'sus', midi: this.L[this.idx], t0, t1: null, vel: this.vel, src: 'hand', slur, glide: slur ? this.glide : 0 };
    this.notes.push(n); this.cur = n; this.noteIdx = this.idx; this.pend = null;
  }
  // h: the hand that plays this line (null: none); c: what the whole body gives {present, on, phrase, level, niente, evs}
  step(t, dt, h, c) {
    const P = this.P, L = this.L, k = tau => 1 - Math.exp(-dt / Math.max(1e-3, tau));
    const resting = !h || h.down || (P.sngRestS > 0 && t - h.lastMove > P.sngRestS);
    const gate = !!h && c.present && !c.niente && !(P.sngGate === 'fist' && h.closed) && !resting;
    if (h) {
      const x = clip((h.up - P.sngULo) / Math.max(0.05, P.sngUHi - P.sngULo)) * (L.length - 1); this.x = x;
      // how fast the hand crosses the scale, in notes a second (vy is torsos a second; 1.9 torsos span hips to above the head)
      const vn = Math.abs(h.vy) / 1.9 / Math.max(0.05, P.sngUHi - P.sngULo) * (L.length - 1);
      this.fast = gate && (this.fast ? vn > 0.6 * P.sngRunV : vn > P.sngRunV);
      this.landing = this.wasFast && !this.fast; this.wasFast = this.fast;
      if (vn > P.sngCalmV) this.calm = t;                     // the hand is still on its way up or down
      const g = this.fast ? P.sngGliss : 0;
      this.g += k(g > this.g ? 0.06 : 0.12) * (g - this.g);  // how far the pitch leans out of the held note towards the hand
      const xi = Math.min(L.length - 1, Math.floor(x)); this.cont = L[xi] + (L[Math.min(L.length - 1, xi + 1)] - L[xi]) * (x - xi);
      // where a leap or a new bow lands: the note under the hand, or its neighbour when only that agrees with the other line
      const land = () => { const r = Math.max(0, Math.min(L.length - 1, Math.round(x)));
        if (!c.ok || c.ok(L[r])) return r;
        for (const j of (x >= r ? [r + 1, r - 1] : [r - 1, r + 1])) if (j >= 0 && j < L.length && c.ok(L[j])) { this.holdX = x; return j; }
        return r; };
      if (gate && !this.gate) {                               // a new bow: the line starts where the hand is
        this.holdX = null; this.idx = land(); this.pc = this.pitch = L[this.idx]; this.scoop = -P.sngScoop; this.resolved = false; this.g = 0;
        this.attack = lerp(P.sngAttSlowS, P.sngAttFastS, clip(h.sp / 0.3)); this.vel = clip(0.35 + 1.8 * h.sp, 0.3, 1);
        this.changed = t; this.bowAt = t; this.note(t, false);
      } else if (gate) {
        if (this.holdX !== null && Math.abs(x - this.holdX) >= 1) this.holdX = null;          // the hand has left the note it resolved from
        if (this.holdX === null && !this.fast && Math.abs(x - this.idx) > 0.5 + P.sngHyst) {
          const want = this.landing ? land() : Math.max(0, Math.min(L.length - 1, Math.round(x)));
          if (want !== this.idx) { this.glide = P.sngGlideS + P.sngPortS * clip(Math.abs(L[want] - this.pitch) / 12); this.idx = want; this.changed = t; this.resolved = false; }
        }
        // the same note, a new stroke after a pause: a new bow on it
        if (P.sngRebow && h.started && t - h.stopAt >= P.sngBowRestS && t - this.changed > 0.25 && t - this.bowAt > 0.4 && this.idx === this.noteIdx) {
          this.dip = 1; this.bowAt = t; this.vel = clip(0.35 + 1.8 * h.sp, 0.3, 1); this.note(t, false);
        }
      }
      this.bow += k(clip(h.sp / P.sngSpTop) > this.bow ? 0.08 : P.sngBowFallS) * (clip(h.sp / P.sngSpTop) - this.bow);
      for (const e of c.evs) if (e.type === 'sudden' && e.part === (h.sd === 'L' ? 'lhand' : 'rhand')) this.acc = Math.max(this.acc, e.strength);
      const bt = clip(0.15 + 0.5 * clip((h.out - 0.25) / 0.6) + 0.45 * this.lvl + 0.3 * this.acc) * (0.7 + 0.3 * clip(c.level));
      this.bri += k(0.25) * (bt - this.bri);
    } else this.bow *= Math.exp(-dt / P.sngBowFallS);
    this.acc *= Math.exp(-dt / 0.3);
    if (gate !== this.gate) { this.release = h && h.closed ? P.sngRelS : P.sngRestRelS; if (!gate && this.cur) { this.cur.t1 = t; this.cur = null; this.noteIdx = null; } }
    this.gate = gate;

    // a note of the score: the target, once it has stayed (a slide passes through notes without stopping on them)
    if (gate && this.idx !== this.noteIdx && this.g < 0.5) {
      if (this.pend !== this.idx) { this.pend = this.idx; this.pendSince = t; }
      if (t - this.pendSince >= P.sngNoteS) { this.vel = clip(0.35 + 1.8 * (h ? h.sp : 0), 0.3, 1); this.note(this.pendSince, true); }
    } else this.pend = null;

    // loudness: the bow's speed on top of the phrase; a rising line swells
    const contour = L.length > 1 ? this.idx / (L.length - 1) - 0.5 : 0;
    const want = P.sngFloor + (1 - P.sngFloor) * clip(P.sngBow * this.bow + P.sngPhrase * c.phrase + P.sngContour * contour + P.sngAccent * this.acc);
    this.lvl += k(want > this.lvl ? P.sngUpS : P.sngDownS) * (want - this.lvl);
    this.env += k(gate ? this.attack : this.release) * ((gate ? 1 : 0) - this.env);
    this.dip *= Math.exp(-dt / 0.07);
    // pitch: two smoothings in a row, so a change starts and lands softly
    const tau = this.glide / 2;
    const target = lerp(L[this.idx], this.cont ?? L[this.idx], this.g);
    this.pc += k(tau) * (target - this.pc); this.pitch += k(tau) * (this.pc - this.pitch);
    this.scoop *= Math.exp(-dt / 0.05);
    // vibrato grows into a held note
    if (gate) { const vt = P.vibDepth * clip((t - this.changed - P.vibDelayS) / Math.max(0.05, P.vibGrowS)) * (0.45 + 0.55 * this.lvl) * (1 - this.g);
      this.vib += k(vt > this.vib ? 0.3 : 0.08) * (vt - this.vib); }
    return { pitch: this.pitch + this.scoop, amp: this.lvl * this.env * (1 - 0.45 * this.dip) * c.on, vib: this.vib,
             vibHz: P.vibHz + P.vibHzDyn * (this.lvl - 0.6), bri: this.bri, gate: gate ? 1 : 0 };
  }
  // a held note that is not at rest resolves by step (ok: is this pitch at rest?)
  resolve(t, ok) {
    if (this.resolved) return;
    this.resolved = true;
    if (ok(this.L[this.idx])) return;
    const L = this.L, i = this.idx, dn = i > 0 ? L[i] - L[i - 1] : 99, up = i < L.length - 1 ? L[i + 1] - L[i] : 99;
    for (const j of (up === 1 && dn !== 1 ? [i + 1, i - 1] : [i - 1, i + 1])) {      // a semitone above pulls up; otherwise down first
      if (j < 0 || j >= L.length || !ok(L[j])) continue;
      this.idx = j; this.changed = t; this.holdX = this.x; this.glide = P_RESOLVE_GLIDE; return;
    }
  }
}

export class Song {
  constructor(P, notes) {
    this.P = P; this.two = P.sngVoices >= 2;
    this.hands = { L: new Hand('L'), R: new Hand('R') };
    const sc = SCALES[P.sngScale] || SCALES.dorian, all = []; for (let m = 12; m <= 108; m++) if (sc.includes(mod(m - P.key))) all.push(m);
    const a = all.findIndex(m => m >= P.sngLo1), b = all.findLastIndex(m => m <= P.sngHi1), lo2 = Math.max(0, a - P.sngApart);
    this.voices = [new Voice(1, all.slice(a, b + 1), P, notes)]; if (this.two) this.voices.push(new Voice(2, all.slice(lo2, lo2 + b - a + 1), P, notes));
    this.lead = 'R';
    this.info = { voices: this.voices.length, scale: P.sngScale, key: P.key, ladders: this.voices.map(v => v.L) };
  }
  // S: the analysis signals; i: frame; c: {present, on, phrase, level, niente, evs}; out: the score's curves
  frame(i, t, dt, S, c, out) {
    const P = this.P, H = this.hands;
    H.L.read(S, i, t, P); H.R.read(S, i, t, P);
    let assign;
    if (this.two) assign = P.sngUpper === 'left' ? [H.L, H.R] : [H.R, H.L];
    else {                                                    // one line: the higher open hand leads
      const a = H[this.lead], b = H[this.lead === 'L' ? 'R' : 'L'], fist = P.sngGate === 'fist', can = h => !(fist && h.closed) && !h.down;
      if (can(b) && (!can(a) || (b.up > a.up + 0.1 && b.moving))) this.lead = b.sd;       // the other hand takes over when it can play and this one cannot, or when it is clearly higher
      assign = [H[this.lead]];
    }
    this.voices.forEach((v, q) => {
      const o = this.voices.find(w => w !== v && w.gate);      // the other line, if it is sounding
      const r = v.step(t, dt, assign[q], { ...c, ok: o && P.sngConsonant ? m => CONSONANT.has(mod(Math.abs(m - o.midi()))) : null }), k = q + 1;
      out['pitch' + k][i] = r.pitch; out['amp' + k][i] = r.amp; out['vib' + k][i] = r.vib; out['vibHz' + k][i] = r.vibHz; out['bri' + k][i] = r.bri; out['gate' + k][i] = r.gate;
    });
    // resolutions: the line that has held longer goes first
    if (P.sngResolve) for (const v of [...this.voices].sort((a, b) => a.changed - b.changed)) {
      if (!v.gate || v.resolved || t - Math.max(v.changed, v.calm) < P.sngSettleS) continue;
      const o = this.voices.find(w => w !== v && w.gate);
      v.resolve(t, o ? m => CONSONANT.has(mod(Math.abs(m - o.midi()))) : m => v.stable.has(mod(m)));
    }
  }
}

// The stretches one bow plays, from a finished or growing score: a new bow starts at every unslurred note of
// line k and lasts until the line has faded out (amp under EPS) or the next bow starts. [{t0, t1, midi, vel}]
export const EPS = 0.004;
export function bowsOf(score, times, k) {
  const amp = score.curves['amp' + k], n = times.length, notes = score.notes.filter(x => x.part === 's' + k), starts = notes.filter(x => !x.slur), out = [];
  let i = 0;
  starts.forEach((b, q) => {
    const next = q + 1 < starts.length ? starts[q + 1].t0 : score.dur;
    let last = b.t0; for (const x of notes) if (x.t0 >= b.t0 && x.t0 < next) last = Math.max(last, x.t1 ?? score.dur);
    while (i < n - 1 && times[i] < last) i++;
    while (i < n - 1 && times[i] < next && amp[i] > EPS) i++;
    out.push({ t0: b.t0, t1: Math.max(b.t0 + 0.05, Math.min(next, times[i])), midi: b.midi, vel: b.vel });
  });
  return out;
}
