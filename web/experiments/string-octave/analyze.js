// Movement characterisation of a tracked clip, for the orchestra.
// DOM-free and audio-free (runs in Node and in the page). Causal: every value
// at time t uses only frames up to t, so what is tuned here on a cached clip
// behaves the same from a live camera.
//
// It runs the repo's three readers over the cached pose and lays their
// outputs side by side on one timeline:
//
//   body/features.js    kinematics and the Laban Efforts (weight, time, flow, space), energy
//   body/stability.js   centre of mass, balance, effort, fragility, tension, grounded, openness
//   dictionary.js       the dancer's five notes: verticality, spine, head, elbows-knees, circles
//   body/strokes.js     strokes of the four extremities (wrists and ankles)
//
// and adds what an arranger needs that none of them has yet:
//
//   level     how high the hips are above the lowest point of the body (lying 0 … standing 1): Laban's levels
//   top       the highest point of the body (standing head 1; arms overhead ≈ 1.25)
//   axis      the hips → head line on screen, signed degrees from vertical; fold; invert
//   reachUp   the higher hand against the head (below the hips 0 … above the head 1)
//   stageX    where she is across the stage (camera's left 0 … right 1)
//   near      how close she is to the camera (torso / frame height)
//   move      whole-body speed 0..1, and `still` (move below AN.stillBelow for AN.stillS)
//   upL upR   each hand's height against her own hips and head (hips 0 … above the head 1), vyL vyR its
//             vertical speed (torsos a second, up positive), extL extR how straight the arm is (folded 0.3 … 1),
//             outL outR how far the hand is from the body's vertical axis (at her side 0.2 … arm's length 1)
//   fistL fistR  how closed each hand is (0 open … 1 a fist), when the clip's hands were read
//             (pose.js); held while a hand is out of sight. seenL seenR: read this frame
//
// analyze(pose) → { n, t[], sig: {name: Float32Array}, events: [{t, type, …}], dur }
import { Features, J, REF } from './body/features.js';
import { Stability } from './body/stability.js';
import { Strokes } from './body/strokes.js';
import { Dictionary } from './dictionary.js';

export const AN = {
  stillBelow: 0.07, stillS: 0.7,           // whole-body speed under this, for this long, is stillness
  moveAbove: 0.11,                         // … and it ends when the speed passes this
  hipM: 0.86, headM: 1.6,                  // standing hip height and standing extent (feet to head top), metres (world landmarks)
  headTorsos: 3.0,                         // standing head height in torsos (extremity heights on screen)
  torsoPct: 75,                            // percentile of the last minute's torso length used as the body's scale
  floorS: 0.25,                            // smoothing of the floor row (s)
  levelS: 0.15,                            // smoothing of level / top (s)
  footStroke: { vOn: 1.1, vOff: 0.45, turnDeg: 70, minS: 0.1 },   // ankles: a little less eager than wrists
  fistS: 0.08,                             // smoothing of the fist reading (s)
};

export const SIGNALS = ['move', 'hands', 'weight', 'time', 'flow', 'space', 'energy', 'height', 'spread', 'lateral',
  'balance', 'instability', 'effort', 'fragility', 'tension', 'grounded', 'openness', 'lean',
  'level', 'top', 'axis', 'fold', 'invert', 'reachUp', 'stageX', 'near', 'still',
  'tilt', 'tiltLeft', 'tiltFwd', 'curve', 'curl', 'bend', 'yaw', 'pitch', 'reach', 'close', 'spin',
  'spLH', 'spRH', 'spLF', 'spRF', 'spHead', 'hLH', 'hRH', 'hLF', 'hRF', 'feet', 'seen',
  'upL', 'upR', 'vyL', 'vyR', 'extL', 'extR', 'outL', 'outR', 'fistL', 'fistR', 'seenL', 'seenR'];

const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const obj = a => a && a.map(p => ({ x: p[0], y: p[1], visibility: p[2] }));
const wobj = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2] }));

// The analysis one frame at a time (a live camera, or a video as it plays):
//   const A = new Analyzer(width, height);  A.push(image, world, t)  per frame
// `image` and `world` are the frame's 33 landmarks as arrays ([x, y, visibility] normalised; [x, y, z] metres),
// or null when no body was found; `hands` (optional) is [left, right], each null or [fist, palm, curl, open].
// A itself is the analysis so far: { n, t, sig, events, dur }.
export class Analyzer {
  constructor(width, height, name = 'live', cap = 4096) {
    this.W = width; this.H = height; this.name = name; this.n = 0; this.t = []; this.dur = 0; this.cap = cap;
    this.sig = {}; for (const k of SIGNALS) this.sig[k] = new Float32Array(cap);
    this.events = [];
    const strokes = { lh: new Strokes(), rh: new Strokes(), lf: new Strokes(AN.footStroke), rf: new Strokes(AN.footStroke) };
    this.st = { F: new Features(), S: new Stability(), D: new Dictionary(), strokes, nearS: 0.5, floor: null, level: 1, top: 1, quietSince: null, still: false, prevT: null, fist: [0, 0] };
    this.hasHands = false;
  }
  push(image, world, t, hands = null) {
    const i = this.n, sig = this.sig, events = this.events, W = this.W, H = this.H, st = this.st, { F, S, D, strokes } = st;
    if (i >= this.cap) { this.cap *= 2; for (const k of SIGNALS) { const b = new Float32Array(this.cap); b.set(sig[k]); sig[k] = b; } }
    this.n = i + 1; this.t.push(t); this.dur = t;
    let { nearS, floor, level, top, quietSince, still, prevT } = st;
    const dt = prevT === null ? 1 / 30 : Math.max(1e-3, Math.min(0.2, t - prevT)); prevT = t; st.prevT = t;
    const img = obj(image), wld = wobj(world);
    const f = img ? F.update(img, t, W, H) : null;
    const s = img ? S.update(img, t, W, H) : null;
    const d = img ? D.update(img, wld, t, W, H) : null;
    const put = (k, v) => { sig[k][i] = Number.isFinite(v) ? v : (i ? sig[k][i - 1] : 0); };
    if (!f) { for (const k of SIGNALS) sig[k][i] = i ? sig[k][i - 1] : 0; sig.seen[i] = 0; sig.move[i] = 0; sig.seenL[i] = 0; sig.seenR[i] = 0; sig.vyL[i] = 0; sig.vyR[i] = 0; return i; }
    sig.seen[i] = 1;
    // the body's scale: the torso when it is upright (a fold towards the camera shortens it on screen)
    const L = Math.max(f.L, F.torsoLong.pct(AN.torsoPct));

    // whole-body speed (features.js reports it as `body`, then overwrites it with a flag)
    const move = clip(1.3 * (f.speed[1] + f.speed[2] + f.speed[3] + f.speed[4]) / 4 / REF.speed98);
    put('move', move); put('hands', f.hands);
    for (const k of ['weight', 'time', 'flow', 'space', 'energy', 'height', 'spread', 'lateral']) put(k, f[k]);
    ['spHead', 'spLH', 'spRH', 'spLF', 'spRF'].forEach((k, e) => put(k, f.nspeed[e]));
    if (s) for (const k of ['balance', 'instability', 'effort', 'fragility', 'tension', 'grounded', 'openness', 'lean']) put(k, s[k]);
    else for (const k of ['balance', 'instability', 'effort', 'fragility', 'tension', 'grounded', 'openness', 'lean']) put(k, NaN);
    put('feet', s ? s.feet.length : NaN);

    // the floor is whatever is lowest: something of hers is on it (except in a jump)
    let lowest = -1e9, highest = 1e9;
    for (let j = 0; j < 33; j++) { const m = img[j]; if (!m || m.visibility < 0.5) continue; lowest = Math.max(lowest, m.y * H); highest = Math.min(highest, m.y * H); }
    if (lowest > -1e9) floor = floor === null ? lowest : floor + (1 - Math.exp(-dt / AN.floorS)) * (lowest - floor);
    const hip = f.pos(J.L_HIP) && f.pos(J.R_HIP) ? (f.pos(J.L_HIP)[1] + f.pos(J.R_HIP)[1]) / 2 : null;
    const kL = 1 - Math.exp(-dt / AN.levelS);
    // level and top come from the world landmarks (metres, origin at the hips, y down), so they do
    // not depend on how far she is from the camera or on her feet being in the frame
    let wLow = -1e9, wHigh = 1e9;
    if (wld) for (let j = 0; j < 33; j++) { if (img[j].visibility < 0.3) continue; wLow = Math.max(wLow, wld[j].y); wHigh = Math.min(wHigh, wld[j].y); }
    if (wLow > -1e9) { level += kL * (clip(wLow / AN.hipM, 0, 1.2) - level); top += kL * (clip((wLow - wHigh) / AN.headM, 0, 1.5) - top); }
    put('level', level); put('top', top);
    // the axis on screen: hips → head against vertical. axis: signed degrees (+ = towards the camera's
    // right), fold: how much shorter than upright the hips → shoulders line looks (a fold towards or away
    // from the camera), invert: the head below the hips
    const sh = f.pos(J.L_SH) && f.pos(J.R_SH) ? [(f.pos(J.L_SH)[0] + f.pos(J.R_SH)[0]) / 2, (f.pos(J.L_SH)[1] + f.pos(J.R_SH)[1]) / 2] : null;
    const hx = f.pos(J.L_HIP) && f.pos(J.R_HIP) ? (f.pos(J.L_HIP)[0] + f.pos(J.R_HIP)[0]) / 2 : null;
    if (sh && hip !== null) {
      put('axis', Math.atan2(sh[0] - hx, hip - sh[1]) * 180 / Math.PI);
      const ws = wld && [(wld[11].x + wld[12].x) / 2, (wld[11].y + wld[12].y) / 2, (wld[11].z + wld[12].z) / 2];
      put('fold', ws ? clip(1 - Math.max(0, -ws[1]) / (Math.hypot(ws[0], ws[1], ws[2]) || 1)) : NaN);   // 0 upright … 1 horizontal or upside down
      put('invert', f.pos(J.NOSE) ? clip((f.pos(J.NOSE)[1] - hip) / L + 0.2) : NaN);
    } else { put('axis', NaN); put('fold', NaN); put('invert', NaN); }

    // each extremity's height in her own frame: 0 at the floor, 1 at the standing head
    const hOf = j => (wld && wLow > -1e9 ? clip((wLow - wld[j].y) / AN.headM, 0, 1.5) : NaN);
    put('hLH', hOf(J.L_WR)); put('hRH', hOf(J.R_WR)); put('hLF', hOf(J.L_AN)); put('hRF', hOf(J.R_AN));
    // the higher hand against her own head and hips (posture-relative, so it works on the floor too)
    const nose = f.pos(J.NOSE), wy = Math.min(f.pos(J.L_WR) ? f.pos(J.L_WR)[1] : 1e9, f.pos(J.R_WR) ? f.pos(J.R_WR)[1] : 1e9);
    if (nose && hip !== null && wy < 1e9) put('reachUp', clip((hip - wy) / L / 1.9)); else put('reachUp', NaN);
    // each hand on its own: height against the hips and the head, vertical speed, how straight the arm is, open or closed
    [['L', J.L_WR, J.L_EL, J.L_SH], ['R', J.R_WR, J.R_EL, J.R_SH]].forEach(([sd, wj, ej, sj], hk) => {
      const w = f.pos(wj), ok = w && f.conf(wj) >= 0.5;
      put('up' + sd, ok && hip !== null ? clip((hip - w[1]) / L / 1.9, -0.4, 1.3) : NaN);
      sig['vy' + sd][i] = ok ? -f.vel(wj)[1] / L : 0;
      const d3 = (a, b) => Math.hypot(wld[a].x - wld[b].x, wld[a].y - wld[b].y, wld[a].z - wld[b].z);
      put('ext' + sd, wld && ok ? clip(d3(sj, wj) / Math.max(1e-6, d3(sj, ej) + d3(ej, wj))) : NaN);
      put('out' + sd, wld && ok ? clip(Math.hypot(wld[wj].x - (wld[11].x + wld[12].x) / 2, wld[wj].z - (wld[11].z + wld[12].z) / 2) / 0.7) : NaN);
      const h = hands && hands[hk];
      if (h) { this.hasHands = true; st.fist[hk] += (1 - Math.exp(-dt / AN.fistS)) * (h[0] - st.fist[hk]); }
      sig['fist' + sd][i] = st.fist[hk]; sig['seen' + sd][i] = h ? 1 : 0;
    });
    const sx = f.pos(J.L_HIP) && f.pos(J.R_HIP) ? (f.pos(J.L_HIP)[0] + f.pos(J.R_HIP)[0]) / 2 / W : NaN;
    put('stageX', sx);
    // how close she is, from this frame alone (the torso, or the shoulders when the torso is foreshortened)
    const shw = f.pos(J.L_SH) && f.pos(J.R_SH) ? Math.hypot(f.pos(J.L_SH)[0] - f.pos(J.R_SH)[0], f.pos(J.L_SH)[1] - f.pos(J.R_SH)[1]) : 0;
    nearS += (1 - Math.exp(-dt / 0.3)) * (Math.max(f.L, 1.1 * shw) / H - nearS);
    put('near', nearS);

    // the dancer's five notes
    if (d) {
      put('tilt', d.vertical.tilt); put('tiltLeft', d.vertical.left); put('tiltFwd', d.vertical.forward);
      put('curve', d.spine.curve); put('curl', d.spine.curl); put('bend', d.spine.bend);
      put('yaw', d.head.yaw); put('pitch', d.head.pitch); put('reach', d.arms.breath ?? NaN);
      const ps = Object.values(d.pairs).filter(x => x !== null);
      put('close', ps.length ? clip(1 - (Math.min(...ps) - 0.28) / 1.2) : NaN);       // elbow to knee: touching 1 … far 0
      put('spin', d.circleSpin.rate);
      for (const e of d.events) events.push({ t, ...e });
    } else for (const k of ['tilt', 'tiltLeft', 'tiltFwd', 'curve', 'curl', 'bend', 'yaw', 'pitch', 'reach', 'close', 'spin']) put(k, NaN);

    // stillness, with hysteresis
    if (move < AN.stillBelow && f.hands < 1.5 * AN.stillBelow) { if (quietSince === null) quietSince = t; }
    else if (move > AN.moveAbove || f.hands > 2 * AN.moveAbove) quietSince = null;
    const nowStill = quietSince !== null && t - quietSince >= AN.stillS;
    if (nowStill && !still) events.push({ t, type: 'still' });
    if (!nowStill && still) events.push({ t, type: 'move' });
    still = nowStill; sig.still[i] = still ? 1 : 0;

    // sudden limb events and balance events
    for (const e of f.events) events.push({ t, type: 'sudden', part: e.part, strength: e.strength });
    if (s) for (const e of s.events) events.push({ t, type: e.type });

    // strokes of the four extremities, in her frame (x to her right, y up, torso units)
    for (const [limb, j] of Object.entries(LIMB_J)) {
      const p = f.pos(j); if (!p || f.conf(j) < 0.5) continue;
      const v = f.vel(j);
      for (const e of strokes[limb].update(t, [-p[0] / L, -p[1] / L], [-v[0] / L, -v[1] / L])) {
        if (e.type !== 'end') continue;
        events.push({ t, type: 'stroke', limb, kind: e.kind, t0: e.t0, dir: e.dir, path: e.path, peak: e.peak, straight: e.straight,
                      h: hOf(j), up: clip((hip - p[1]) / L / 1.9, -1, 1.2) });
      }
    }
    Object.assign(st, { nearS, floor, level, top, quietSince, still });
    return i;
  }
}
const LIMB_J = { lh: J.L_WR, rh: J.R_WR, lf: J.L_AN, rf: J.R_AN };

// a whole tracked clip at once
export function analyze(pose) {
  const A = new Analyzer(pose.width, pose.height, pose.name, Math.max(1, pose.t.length));
  for (let i = 0; i < pose.t.length; i++) A.push(pose.image[i], pose.world[i], pose.t[i], pose.hands ? pose.hands[i] : null);
  A.events.sort((a, b) => a.t - b.t);
  return { n: A.n, t: pose.t, sig: A.sig, events: A.events, dur: pose.duration, name: pose.name, hasHands: A.hasHands };
}

// percentiles of each signal while a body is seen (for the lab and the page's legends)
export function summary(a, qs = [5, 25, 50, 75, 95]) {
  const out = {};
  for (const k of SIGNALS) {
    const v = []; for (let i = 0; i < a.n; i++) if (a.sig.seen[i]) v.push(a.sig[k][i]);
    v.sort((x, y) => x - y);
    out[k] = qs.map(q => v[Math.min(v.length - 1, Math.floor(q / 100 * v.length))]);
  }
  return out;
}
