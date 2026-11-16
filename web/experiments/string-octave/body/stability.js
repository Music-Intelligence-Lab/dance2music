// Stability and tension of the body (papers/movement-music-tension, section 3),
// computed causally in the camera plane. DOM-free and audio-free (Node tests).
//
// One camera sees the frontal plane, so balance is lateral balance (left ↔
// right) and heights; balance front ↔ back needs a second camera. Every
// constant is in STAB and documented in methods.html, "Stability and tension".
//
//   centre of mass   c = Σ m_i p_i / Σ m_i        (de Leva 1996 segment masses)
//   base of support  the x-interval spanned by the contact points on the floor
//   balance margin   μ = distance from c_x (static) or from the extrapolated
//                    centre of mass ξ = c_x + v_x/ω₀, ω₀ = √(g/ℓ) (Hof 2005,
//                    dynamic) to the nearer edge of the base; < 0 outside
//   limb potential   V(θ) = −m g r cos θ about the shoulder (elbow): the holding
//                    torque τ = m g r sin θ is the arm's horizontal reach,
//                    the stiffness k = m g r cos θ its drop below the joint;
//                    effort = τ², fragility = max(0, −k) (raised = inverted)
//   accumulated      dA/dt = e − A/T_r: a held squat builds, rest releases
//
// Outputs (all 0..1 unless noted): balance, instability, effort, fragility,
// tension, grounded, openness, lean; plus geometry for the overlay and
// events 'unbalanced' (the dynamic margin goes negative) and 'landed' (a foot
// comes down after it), the body's cadence.

export const STAB = {
  heightM: 1.7, torsoRatio: 0.3, g: 9.81,     // body height, torso = 0.3·height (as world/space.js)
  smoothS: 0.06,                              // landmark smoothing time constant
  contactTol: 0.12, contactSpeed: 1.2,        // contact: within tol·torso of the floor, slower than speed·torso/s
  marginRef: 0.25,                            // margin (in torsos) that counts as fully balanced
  velS: 0.12,                                 // CoM velocity smoothing
  refS: 20,                                   // memory of the reference lengths (straight arm, standing leg)
  squatDepth: 0.45,                           // hip-to-ankle drop (fraction of leg) that counts as a full squat
  oneLegEffort: 0.25,                         // standing on one leg costs this much effort by itself
  wArm: 0.5, wLeg: 1.0,                       // effort weights (an arm is light; legs carry the body)
  Tr: 4,                                      // tension recovery time (s): dA/dt = e − A/Tr
  tensionRef: 0.6,                            // effort held for ~Tr that counts as full tension
  openLo: 0.06, openHi: 0.36,                 // convex-hull area / height², closed → open
  leanDeg: 30,                                // torso tilt that reads as full lean
  wBal: 0.5, wFrag: 0.3, wTen: 0.45, wAir: 0.6, groundCalm: 0.7,   // instability = weighted sum, calmed when lying
  landWindowS: 0.6,                           // a landing within this long of losing balance resolves
};

// de Leva (1996), male: mass fractions and CoM position along the segment (proximal → distal)
const SEG = {
  head:  { m: 0.0694 }, trunk: { m: 0.4346, at: 0.5 },
  upper: { m: 0.0271, at: 0.577 }, fore: { m: 0.0162, at: 0.457 }, hand: { m: 0.0061 },
  thigh: { m: 0.1416, at: 0.41 }, shank: { m: 0.0433, at: 0.44 }, foot: { m: 0.0137 },
};
const K = { NOSE: 0, LE: 7, RE: 8, LS: 11, RS: 12, LEL: 13, REL: 14, LW: 15, RW: 16, LI: 19, RI: 20,
            LH: 23, RH: 24, LK: 25, RK: 26, LA: 27, RA: 28, LHE: 29, RHE: 30, LT: 31, RT: 32 };
const USED = Object.values(K);

const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const mid = (a, b) => lerp(a, b, 0.5);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);

function hullArea(pts) {                     // monotone chain
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return 0;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  const h = lo.slice(0, -1).concat(hi.slice(0, -1));
  let a = 0; for (let i = 0; i < h.length; i++) { const u = h[i], v = h[(i + 1) % h.length]; a += u[0] * v[1] - v[0] * u[1]; }
  return Math.abs(a) / 2;
}

class Peak {                                  // running maximum that forgets over STAB.refS
  constructor() { this.v = []; }
  push(t, x) { this.v.push([t, x]); while (this.v.length && this.v[0][0] < t - STAB.refS) this.v.shift(); return this.max(); }
  max() { return this.v.reduce((m, [, x]) => Math.max(m, x), 0); }
}

export class Stability {
  constructor() { this.reset(); }
  reset() {
    this.t = null; this.p = {}; this.prevY = {}; this.c = null; this.v = 0;
    this.A = 0; this.out = null; this.lostAt = -1e9; this.wasOut = false; this.contacts = new Set();
    this.ref = { armL: new Peak(), armR: new Peak(), foreL: new Peak(), foreR: new Peak(), leg: new Peak(), torso: new Peak() };
  }

  // lms: 33 normalised landmarks {x, y, visibility}; floorPx: the floor's
  // image row (world/space.js), or null; t in seconds
  update(lms, t, W, H, floorPx = null) {
    const dt = this.t === null ? 1 / 30 : Math.max(1e-3, Math.min(0.2, t - this.t));
    this.t = t;
    const a = 1 - Math.exp(-dt / STAB.smoothS);
    for (const j of USED) {
      const m = lms && lms[j];
      if (!m || (m.visibility ?? 1) < 0.3) continue;
      const q = [m.x * W, m.y * H];
      this.prevY[j] = this.p[j] ? this.p[j][1] : q[1];
      this.p[j] = this.p[j] ? lerp(this.p[j], q, a) : q;
    }
    const P = this.p;
    if (![K.LS, K.RS, K.LH, K.RH, K.LA, K.RA].every(j => P[j])) return (this.out = null);

    const sh = mid(P[K.LS], P[K.RS]), hip = mid(P[K.LH], P[K.RH]);
    const torso = this.ref.torso.push(t, len(sub(sh, hip))) || 1;
    const floor = floorPx ?? Math.max(...[K.LHE, K.RHE, K.LT, K.RT, K.LA, K.RA].filter(j => P[j]).map(j => P[j][1]));
    const mpp = STAB.torsoRatio * STAB.heightM / torso;          // metres per pixel
    const pt = j => P[j] || null;

    // ── centre of mass ──
    const parts = [];
    const add = (m, q) => q && parts.push([m, q]);
    const head = P[K.LE] && P[K.RE] ? mid(P[K.LE], P[K.RE]) : P[K.NOSE];
    add(SEG.head.m, head);
    add(SEG.trunk.m, lerp(hip, sh, SEG.trunk.at));
    for (const [S, E, Wr, I] of [[K.LS, K.LEL, K.LW, K.LI], [K.RS, K.REL, K.RW, K.RI]]) {
      if (P[S] && P[E]) add(SEG.upper.m, lerp(P[S], P[E], SEG.upper.at));
      if (P[E] && P[Wr]) add(SEG.fore.m, lerp(P[E], P[Wr], SEG.fore.at));
      add(SEG.hand.m, P[I] && P[Wr] ? mid(P[Wr], P[I]) : pt(Wr));
    }
    for (const [Hp, Kn, An, He, To] of [[K.LH, K.LK, K.LA, K.LHE, K.LT], [K.RH, K.RK, K.RA, K.RHE, K.RT]]) {
      if (P[Hp] && P[Kn]) add(SEG.thigh.m, lerp(P[Hp], P[Kn], SEG.thigh.at));
      if (P[Kn] && P[An]) add(SEG.shank.m, lerp(P[Kn], P[An], SEG.shank.at));
      add(SEG.foot.m, P[He] && P[To] ? mid(P[He], P[To]) : pt(An));
    }
    const M = parts.reduce((s, [m]) => s + m, 0);
    const c = parts.reduce((s, [m, q]) => [s[0] + m * q[0] / M, s[1] + m * q[1] / M], [0, 0]);
    const av = 1 - Math.exp(-dt / STAB.velS);
    const vx = this.c ? (c[0] - this.c[0]) / dt : 0;
    this.v += av * (vx - this.v);
    this.c = c;

    // ── contacts and base of support (x-interval on the floor) ──
    const tol = STAB.contactTol * torso, vmax = STAB.contactSpeed * torso;
    const cand = [K.LHE, K.RHE, K.LT, K.RT, K.LA, K.RA, K.LK, K.RK, K.LW, K.RW, K.LH, K.RH, K.LS, K.RS, K.NOSE];
    const contacts = cand.filter(j => P[j] && floor - P[j][1] < tol && Math.abs(P[j][1] - this.prevY[j]) / dt < vmax);
    const xs = contacts.map(j => P[j][0]);
    const airborne = xs.length === 0;
    const base = airborne ? null : [Math.min(...xs), Math.max(...xs)];
    const feet = new Set(contacts.filter(j => [K.LHE, K.LT, K.LA].includes(j)).length ? ['L'] : []);
    if (contacts.some(j => [K.RHE, K.RT, K.RA].includes(j))) feet.add('R');

    const ell = Math.max(0.2, (floor - c[1]) * mpp);                // CoM height (m)
    const w0 = Math.sqrt(STAB.g / ell);
    const xi = c[0] + this.v / w0;                                   // extrapolated centre of mass (px)
    const margin = x => (base ? Math.min(x - base[0], base[1] - x) / torso : -1);
    const mu = margin(c[0]), muD = margin(xi);

    // ── limbs: holding torque (horizontal reach) and fragility (height above the joint) ──
    const arm = (S, E, Wr, I, refA, refF) => {
      if (!(P[S] && P[E] && P[Wr])) return { tau: 0, frag: 0, elbow: 0 };
      const pts = [[SEG.upper.m, lerp(P[S], P[E], SEG.upper.at)], [SEG.fore.m, lerp(P[E], P[Wr], SEG.fore.at)],
                   [SEG.hand.m, P[I] ? mid(P[Wr], P[I]) : P[Wr]]];
      const m = pts.reduce((s, [mm]) => s + mm, 0);
      const ca = pts.reduce((s, [mm, q]) => [s[0] + mm * q[0] / m, s[1] + mm * q[1] / m], [0, 0]);
      const r = refA.push(t, len(sub(ca, P[S]))) || 1;               // the straight arm's CoM distance
      const d = sub(ca, P[S]);
      const fo = [[SEG.fore.m, lerp(P[E], P[Wr], SEG.fore.at)], [SEG.hand.m, P[Wr]]];
      const mf = fo.reduce((s, [mm]) => s + mm, 0);
      const cf = fo.reduce((s, [mm, q]) => [s[0] + mm * q[0] / mf, s[1] + mm * q[1] / mf], [0, 0]);
      const rf = refF.push(t, len(sub(cf, P[E]))) || 1;
      return { tau: clip(Math.abs(d[0]) / r), frag: clip(-d[1] / r),   // y grows downward: above the joint is −
               elbow: clip(Math.abs(cf[0] - P[E][0]) / rf) };
    };
    const L = arm(K.LS, K.LEL, K.LW, K.LI, this.ref.armL, this.ref.foreL);
    const R = arm(K.RS, K.REL, K.RW, K.RI, this.ref.armR, this.ref.foreR);

    // legs: how far the hips have dropped towards the ankles, on the feet that carry the body
    const legLen = this.ref.leg.push(t, Math.max(P[K.LA][1], P[K.RA][1]) - hip[1]) || 1;
    const drop = s => clip(1 - (P[s === 'L' ? K.LA : K.RA][1] - hip[1]) / legLen);
    const squat = feet.size ? Math.max(...[...feet].map(drop)) : 0;
    const legE = clip(squat / STAB.squatDepth) ** 2 + (feet.size === 1 ? STAB.oneLegEffort : 0);
    const armE = (L.tau ** 2 + R.tau ** 2 + 0.3 * (L.elbow ** 2 + R.elbow ** 2)) / 2.6;
    const effort = clip((STAB.wArm * armE + STAB.wLeg * legE) / (STAB.wArm + STAB.wLeg) * 2);
    const fragility = clip((L.frag + R.frag) / 2);

    // accumulated tension: a leaky integral of effort
    this.A += dt * (effort - this.A / STAB.Tr);
    const tension = clip(this.A / (STAB.Tr * STAB.tensionRef));

    // grounded: how low the centre of mass is (lying ≈ 1, standing ≈ 0)
    const standingCoM = 0.55 * STAB.heightM;
    const grounded = clip(1 - ell / standingCoM);

    // openness: the space the body occupies (convex hull / height²)
    const hullPts = USED.filter(j => P[j] && j <= 28).map(j => P[j]);
    const hPx = STAB.heightM / mpp;
    const openness = clip((hullArea(hullPts) / (hPx * hPx) - STAB.openLo) / (STAB.openHi - STAB.openLo));

    // lean: torso tilt from vertical, 0.5 upright, 0 / 1 full lean to the image's left / right
    const tv = sub(sh, hip), tilt = Math.atan2(tv[0], -tv[1]) * 180 / Math.PI;
    const lean = clip(0.5 + tilt / (2 * STAB.leanDeg));

    const balance = airborne ? 0 : clip(muD / STAB.marginRef);
    const instability = clip((STAB.wBal * (1 - balance) + STAB.wFrag * fragility + STAB.wTen * tension
                              + (airborne ? STAB.wAir : 0)) * (1 - STAB.groundCalm * grounded));

    // events: losing balance, then a foot landing (the body's cadence)
    const events = [];
    const out_ = muD < 0;
    if (out_ && !this.wasOut) { events.push({ type: 'unbalanced' }); this.lostAt = t; }
    const newFoot = [...feet].some(s => !this.contacts.has(s));
    if (newFoot && t - this.lostAt < STAB.landWindowS) { events.push({ type: 'landed', feet: [...feet] }); this.lostAt = -1e9; }
    this.wasOut = out_; this.contacts = feet;

    return (this.out = {
      t, balance, instability, effort, fragility, tension, grounded, openness, lean, events,
      margin: mu, marginD: muD, airborne, feet: [...feet],
      geo: { c, xi: [xi, c[1]], floor, base, torso, armL: L, armR: R, squat },
    });
  }

  // the signals this module adds (names as in core/signals.js)
  signals() {
    const o = this.out;
    const z = { balance: 0, instability: 0, effort: 0, fragility: 0, tension: 0, grounded: 0, openness: 0, lean: 0.5 };
    if (!o) return z;
    return { balance: o.balance, instability: o.instability, effort: o.effort, fragility: o.fragility,
             tension: o.tension, grounded: o.grounded, openness: o.openness, lean: o.lean };
  }
}
