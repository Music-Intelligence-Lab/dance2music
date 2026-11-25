// Drawing: the timeline (chords, the score as a piano roll, dynamics, the
// body's shape) and the skeleton over the video. No state of its own.
import { PART_INFO } from './arrange.js';

export const PART_COLOR = { cb: '#8f6b4e', vc: '#c08552', va: '#d6b25e', vn2: '#86b6a4', vn1: '#7ba7d9',
                            solo: '#ffd166', vcl: '#ef8354', pzh: '#e6e1d8', pzb: '#b99a7a', harp: '#c4a7e7', s1: '#7ba7d9', s2: '#e0a458' };
export const DEG_COLOR = { I: '#78dc78', IV: '#5ab4ff', V: '#ffaa50', vi: '#4fb8a0', ii: '#4a8fd0', iii: '#d98a5a',
                           '♭VI': '#9d7bd8', i: '#7a6fd0', iv: '#b86ab8',
                           1: '#78dc78', 2: '#4a8fd0', 3: '#4fb8a0', 4: '#5ab4ff', 5: '#ffaa50', 6: '#9d7bd8', 7: '#d98a5a' };
const EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
const ROWS = { chords: 26, roll: 230, dyn: 60, shape: 66, events: 24 };
export const TIMELINE_H = Object.values(ROWS).reduce((a, b) => a + b, 0) + 22;
const LO = 26, HI = 94;

export function drawTimeline(cv, a, score, view, now, opts = {}) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = TIMELINE_H;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), dim = css.getPropertyValue('--dim').trim(), line = css.getPropertyValue('--line').trim(), ink = css.getPropertyValue('--ink').trim();
  const [t0, t1] = view, X = t => (t - t0) / (t1 - t0) * W;
  g.font = '11px -apple-system, "SF Pro Text", sans-serif'; g.textBaseline = 'middle';
  let y = 0;
  const band = (h, label) => { const top = y; y += h; g.strokeStyle = line; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); return top; };

  // stillness, behind everything
  const S = a.sig; let s0 = null;
  g.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < a.n; i++) { const st = S.still[i] > 0; if (st && s0 === null) s0 = a.t[i]; if ((!st || i === a.n - 1) && s0 !== null) { g.fillRect(X(s0), 0, X(a.t[i]) - X(s0), H - 22); s0 = null; } }

  // chords; in Song mode there are none: the row shows each line's bow (on the string, or lifted)
  const song = score.mode === 'song', C = score.curves;
  let top = band(ROWS.chords);
  if (song) for (let k = 1; k <= score.song.voices; k++) {
    const gate = C['gate' + k], h = (ROWS.chords - 8) / score.song.voices, y0 = top + 4 + (k - 1) * h; let g0 = null;
    g.fillStyle = PART_COLOR['s' + k]; g.globalAlpha = 0.8;
    for (let i = 0; i < a.n; i++) { const on = gate[i] > 0; if (on && g0 === null) g0 = a.t[i]; if ((!on || i === a.n - 1) && g0 !== null) { g.fillRect(X(g0), y0, Math.max(1, X(a.t[i]) - X(g0)), h - 1); g0 = null; } }
    g.globalAlpha = 1;
  }
  score.chords.forEach((c, i) => {
    const xa = X(c.t), xb = X(i + 1 < score.chords.length ? score.chords[i + 1].t : score.dur);
    if (xb < 0 || xa > W) return;
    g.fillStyle = DEG_COLOR[c.deg] || '#888'; g.globalAlpha = 0.85; g.fillRect(xa + 0.5, top + 3, Math.max(1, xb - xa - 1), ROWS.chords - 6); g.globalAlpha = 1;
    if (xb - xa > 26) { g.fillStyle = '#14120f'; g.save(); g.beginPath(); g.rect(xa, top, xb - xa, ROWS.chords); g.clip(); g.fillText(xb - xa > 60 ? `${c.symbol}  ${c.deg}` : c.symbol, xa + 5, top + ROWS.chords / 2 + 0.5); g.restore(); }
  });

  // piano roll
  top = band(ROWS.roll);
  // (Song mode: the roll is just the lines' own range)
  const lad = song ? score.song.ladders.flat() : null, lo = song ? Math.min(...lad) - 4 : LO, hi = song ? Math.max(...lad) + 4 : HI;
  const Y = m => top + ROWS.roll - 4 - (m - lo) / (hi - lo) * (ROWS.roll - 8), nh = (ROWS.roll - 8) / (hi - lo);
  g.fillStyle = 'rgba(255,255,255,0.03)'; for (let m = 24; m <= hi; m += 12) if (m >= lo) g.fillRect(0, Y(m), W, 1);
  if (song) { g.fillStyle = 'rgba(255,255,255,0.025)'; for (const m of new Set(lad)) g.fillRect(0, Y(m), W, 1); }       // the scale's notes
  g.fillStyle = dim; for (let m = 36; m <= 84; m += 12) if (m > lo + 1 && m < hi) g.fillText('C' + (m / 12 - 1), 3, Y(m) - 6);
  const hide = opts.hidden || {};
  if (song) {                                               // each line's pitch as it sounds: thicker when louder
    const step = Math.max(1, Math.floor(a.n * (t1 - t0) / Math.max(1e-6, score.dur) / (W * 3)));
    for (let k = 1; k <= score.song.voices; k++) {
      if (hide['s' + k]) continue;
      const pitch = C['pitch' + k], amp = C['amp' + k]; g.strokeStyle = PART_COLOR['s' + k]; g.lineCap = 'round';
      for (let i = step; i < a.n; i += step) { if (!(amp[i] > 0.004) || !(amp[i - step] > 0.004)) continue; const xa = X(a.t[i - step]), xb = X(a.t[i]); if (xb < 0 || xa > W) continue;
        g.lineWidth = 1 + 4.5 * amp[i]; g.beginPath(); g.moveTo(xa, Y(pitch[i - step])); g.lineTo(xb, Y(pitch[i])); g.stroke(); }
      g.fillStyle = '#efe9df'; for (const n of score.notes) if (n.part === 's' + k && !n.slur) { const x = X(n.t0); if (x >= 0 && x <= W) g.fillRect(x - 0.5, Y(n.midi) - 7, 1.5, 14); }   // a new bow
    }
    g.lineWidth = 1; g.lineCap = 'butt';
  }
  for (const pass of [0, 1]) for (const n of score.notes) {
    if (song) break;
    const lineP = n.part === 'solo' || n.part === 'vcl';
    if ((pass === 1) !== (lineP || n.art !== 'sus') || hide[n.part]) continue;
    const xa = X(n.t0), xb = X(n.t1 ?? score.dur); if (xb < 0 || xa > W) continue;
    g.fillStyle = PART_COLOR[n.part];
    if (n.art !== 'sus') { g.globalAlpha = 0.5 + 0.5 * n.vel; g.beginPath(); g.arc(xa, Y(n.midi), n.part === 'harp' ? 2 : 2.6, 0, 7); g.fill(); g.globalAlpha = 1; continue; }
    const h = lineP ? Math.max(3, nh * 1.5) : Math.max(2, nh);
    g.globalAlpha = lineP ? 1 : 0.8; g.fillRect(xa, Y(n.midi) - h / 2, Math.max(1.5, xb - xa - 1), h); g.globalAlpha = 1;
  }

  // a row's legend, on a strip of background so the curves do not run through the words
  const label = (yy, items) => { let w = 6; for (const [t] of items) w += g.measureText(t).width + 10; g.fillStyle = 'rgba(18,17,16,0.78)'; g.fillRect(0, yy + 1, w, 15);
    let lx = 4; for (const [t, c] of items) { g.fillStyle = c; g.fillText(t, lx, yy + 9); lx += g.measureText(t).width + 10; } };

  // dynamics and tremolo
  top = band(ROWS.dyn);
  const curve = (arr, color, fill, scale = 1, base = ROWS.dyn) => {
    g.beginPath(); let started = false; const step = Math.max(1, Math.floor(a.n / (W * 2)));
    for (let i = 0; i < a.n; i += step) { const x = X(a.t[i]); if (x < -2 || x > W + 2) continue; const yy = top + base - 2 - arr[i] * scale * (base - 6); if (!started) { g.moveTo(x, yy); started = true; } else g.lineTo(x, yy); }
    if (fill) { g.lineTo(X(Math.min(t1, score.dur)), top + base - 2); g.lineTo(X(Math.max(t0, 0)), top + base - 2); g.closePath(); g.fillStyle = fill; g.fill(); }
    else { g.strokeStyle = color; g.lineWidth = 1.2; g.stroke(); }
  };
  if (song) {
    curve(C.amp1, null, 'rgba(123,167,217,0.35)'); if (score.song.voices > 1) curve(C.amp2, PART_COLOR.s2);
    curve(C.vib1, 'rgba(239,233,223,0.7)'); if (score.song.voices > 1) curve(C.vib2, 'rgba(224,164,88,0.55)');
    label(top, [['loudness: upper line', '#7ba7d9'], ...(score.song.voices > 1 ? [['lower line', PART_COLOR.s2]] : []), ['vibrato', '#efe9df']]);
  } else {
    curve(score.curves.dynMid, null, 'rgba(240,160,80,0.38)'); curve(score.curves.dynTop, '#7ba7d9'); curve(score.curves.dynBass, '#8f6b4e'); curve(S.move, 'rgba(239,233,223,0.45)');
    label(top, [['dynamic: middle', '#f0a050'], ['top (hands)', '#7ba7d9'], ['bass (legs)', '#b08a68'], ['her speed', '#efe9df']]);
  }

  // the body's shape
  top = band(ROWS.shape);
  if (song) {                                               // the hands: heights (shifted so that hanging is 0), and how closed each is
    const lift = k => { const v = new Float32Array(a.n); for (let i = 0; i < a.n; i++) v[i] = (S[k][i] + 0.4) / 1.7; return v; };
    curve(lift('upR'), '#7ba7d9', null, 1, ROWS.shape); curve(lift('upL'), PART_COLOR.s2, null, 1, ROWS.shape); curve(S.fistR, '#e06c75', null, 1, ROWS.shape); curve(S.fistL, '#b85a8a', null, 1, ROWS.shape);
    label(top, [['hand height: right', '#7ba7d9'], ['left', PART_COLOR.s2], ['fist: right', '#e06c75'], ['left', '#b85a8a']]);
  } else {
    curve(S.level, '#efe9df', null, 1 / 1.2, ROWS.shape); curve(S.fold, '#b86ab8', null, 1, ROWS.shape); curve(score.curves.span, '#78dc78', null, 1, ROWS.shape); curve(score.curves.lift, '#7ba7d9', null, 1, ROWS.shape);
    label(top, [['hips height', '#efe9df'], ['fold', '#b86ab8'], ['span', '#78dc78'], ['lift', '#7ba7d9']]);
  }

  // events: strokes that could be notes, sudden accents, landings, turns
  top = band(ROWS.events);
  for (const e of a.events) {
    const x = X(e.t); if (x < 0 || x > W) continue;
    if (e.type === 'stroke') { g.fillStyle = e.limb[1] === 'h' ? 'rgba(255,209,102,0.55)' : 'rgba(239,131,84,0.55)'; g.fillRect(x, top + (e.limb[1] === 'h' ? 3 : 12), 1.5, 7); }
    else if (e.type === 'sudden') { g.fillStyle = 'rgba(230,225,216,0.8)'; g.fillRect(x, top + 3, 1, 16); }
    else if (e.type === 'spin') { g.fillStyle = '#c4a7e7'; g.beginPath(); g.arc(x, top + 11, 3, 0, 7); g.fill(); }
  }
  label(top + 3, [['strokes: hands', '#ffd166'], ['feet', '#ef8354'], ['accents', '#e6e1d8'], ['turns', '#c4a7e7']]);

  // time axis and playhead
  const stepS = [1, 2, 5, 10, 15, 30, 60].find(s => (t1 - t0) / s <= 14) || 60;
  g.fillStyle = dim; g.textAlign = 'center';
  for (let t = Math.ceil(t0 / stepS) * stepS; t <= t1; t += stepS) g.fillText(`${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`, X(t), H - 10);
  g.textAlign = 'left';
  const xn = X(now); g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(xn + 0.5, 0); g.lineTo(xn + 0.5, H - 22); g.stroke();
}

// the skeleton, tinted by the chord, and the place on the map
export function drawBody(cv, video, pose, i, color) {
  const r = video.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  const lm = pose.image[i]; if (!lm) return;
  g.strokeStyle = color; g.lineWidth = 2; g.lineCap = 'round'; g.globalAlpha = 0.9;
  for (const [p, q] of EDGES) { if (lm[p][2] < 0.4 || lm[q][2] < 0.4) continue; g.beginPath(); g.moveTo(lm[p][0] * r.width, lm[p][1] * r.height); g.lineTo(lm[q][0] * r.width, lm[q][1] * r.height); g.stroke(); }
  g.fillStyle = color; for (const j of [0, 15, 16, 27, 28]) { if (lm[j][2] < 0.4) continue; g.beginPath(); g.arc(lm[j][0] * r.width, lm[j][1] * r.height, j ? 3.5 : 4.5, 0, 7); g.fill(); }
  g.globalAlpha = 1;
}

export const partLabel = p => PART_INFO[p].label;
