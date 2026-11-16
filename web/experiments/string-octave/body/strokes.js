// Strokes: a moving point's path cut into the units conductors, dancers and
// handwriting are made of. A stroke starts when the point gets moving and ends
// when it comes to rest or turns sharply (a new stroke then starts at once).
// Units are whatever the caller uses (torso lengths here), per second.
//
//   start   speed rises above vOn
//   end     speed falls below vOff                       (kind 'rest')
//           or the direction turns more than turnDeg     (kind 'turn')
//           against the stroke's recent direction
//
// Each finished stroke: {t0, t1, p0, p1, disp, path, dir, peak, straight, kind}.

export const STROKE = { vOn: 0.8, vOff: 0.35, turnDeg: 65, minS: 0.08, dirWinS: 0.1 };

export class Strokes {
  constructor(opts = {}) { this.o = { ...STROKE, ...opts }; this.reset(); }
  reset() { this.cur = null; this.restSince = null; this.recent = []; this.last = null; }

  // t: seconds; p: [x, y]; v: [vx, vy]. Returns events: {type: 'start'|'end', ...}
  update(t, p, v) {
    const o = this.o, ev = [], speed = Math.hypot(v[0], v[1]);
    this.recent.push({ t, v }); while (this.recent.length && this.recent[0].t < t - o.dirWinS) this.recent.shift();
    if (!this.cur) {
      if (this.restSince === null) this.restSince = t;
      if (speed > o.vOn) { this.begin(t, p, v); ev.push({ type: 'start', t, p: [...p] }); }
      return ev;
    }
    const c = this.cur;
    // the stroke's direction: its mean velocity so far; a sharp turn against it
    // ends the stroke where it turned (the previous point) and starts the next
    if (speed > o.vOff && t - c.t0 >= o.minS) {
      const d = c.sum, nd = Math.hypot(d[0], d[1]);
      if (nd > 1e-6 && speed > 1e-6) {
        const cos = (d[0] * v[0] + d[1] * v[1]) / (nd * speed);
        if (cos < Math.cos(o.turnDeg * Math.PI / 180)) {
          const at = [...c.pl];
          ev.push(this.finish(c.tl, at, 'turn')); this.begin(c.tl, at, v);
          this.cur.path = Math.hypot(p[0] - at[0], p[1] - at[1]); this.cur.pl = [...p]; this.cur.tl = t;
          ev.push({ type: 'start', t: c.tl, p: at });
          return ev;
        }
      }
    }
    c.path += Math.hypot(p[0] - c.pl[0], p[1] - c.pl[1]); c.pl = [...p]; c.tl = t; c.peak = Math.max(c.peak, speed);
    c.sum[0] += v[0]; c.sum[1] += v[1];
    if (speed < o.vOff && t - c.t0 >= o.minS) { ev.push(this.finish(t, p, 'rest')); this.restSince = t; }
    return ev;
  }

  begin(t, p, v) { this.cur = { t0: t, tl: t, p0: [...p], pl: [...p], path: 0, peak: Math.hypot(v[0], v[1]), sum: [v[0], v[1]] }; this.restSince = null; }

  finish(t, p, kind) {
    const c = this.cur, disp = [p[0] - c.p0[0], p[1] - c.p0[1]], len = Math.hypot(disp[0], disp[1]);
    this.cur = null;
    const s = { type: 'end', kind, t0: c.t0, t1: t, p0: c.p0, p1: [...p], disp, path: c.path, peak: c.peak,
                dir: len > 1e-9 ? [disp[0] / len, disp[1] / len] : [0, 0], straight: c.path > 1e-9 ? Math.min(1, len / c.path) : 1 };
    this.last = s;
    return s;
  }

  moving() { return !!this.cur; }
  // seconds the point has been at rest (0 while moving)
  dwell(t) { return this.cur || this.restSince === null ? 0 : t - this.restSince; }
}
