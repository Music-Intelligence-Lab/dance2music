// The orchestra page: a cached clip, its movement, the score the body
// arranges, and the controls of the mapping. Changing a control re-arranges
// the whole clip (milliseconds) and playback continues from where it is.
import { analyze, Analyzer } from './analyze.js';
import { CONFIG } from './config.js';
import { LivePose } from './pose.js';
import { arrange, Arranger, stats, DEFAULTS, PARAM_META, SOURCES, PARTS, DEGS, chordOf } from './arrange.js';
import { Samples, Player, render, wavBlob } from './sampler.js';
import { smf, MidiOut, MIDI_OPTS } from './midi.js';
import { RULE } from './octave.js';
import { SCALES } from './song.js';
import { judge } from './judge.js';
import { VERSIONS as ALL_VERSIONS, paramsOf } from './versions.js';
const VERSIONS = CONFIG.versions ? ALL_VERSIONS.filter(v => CONFIG.versions.includes(v.id)) : ALL_VERSIONS;
import { drawTimeline, drawBody, PART_COLOR, DEG_COLOR, TIMELINE_H, partLabel } from './view.js';

const $ = id => document.getElementById(id);
const LS = 'dance2music.stringOctave.';
const load = (k, d) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };
const query = new URLSearchParams(location.search);

const A = {
  clip: null, pose: null, analysis: null, score: null, stats: null,
  params: { ...DEFAULTS, ...load('params', {}) },
  mix: { gain: {}, mute: {}, solo: {}, master: 0.85, reverb: 0.9, ...load('mix', {}) },
  ctx: null, samples: new Samples(CONFIG.samples), player: null, midi: new MidiOut(), playing: false, zoom: 0,
};
window.orchestra = A;
const video = $('video'), status = s => { $('status').textContent = s; };
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ── clip ──
async function loadClip(name) {
  if (name === CAMERA) return startLive('camera');
  if (name === FILE) { $('file').value = ''; $('file').click(); return; }
  stopLive(false); pause(); status('loading the pose…');
  video.srcObject = null;
  A.clip = name; save('clip', name);
  A.pose = await (await fetch(`/data/${name}/pose.json`)).json();
  video.src = `/video/${name}`;
  status('reading the movement…'); await new Promise(r => setTimeout(r, 20));
  A.analysis = analyze(A.pose);
  rearrange(); status('');
}

function rearrange() {
  if (!A.analysis) return;
  if (A.live) return rearrangeLive();
  A.score = arrange(A.analysis, A.params); A.stats = stats(A.analysis, A.score); A.judge = judge(A.analysis, A.score);
  A.midi.load(A.score, A.analysis.t);
  drawStats(); drawSeq(); draw();
  if (A.playing) startAudio(currentTime());
}

// ── transport: the audio clock leads, the video follows ──
const currentTime = () => (A.live ? A.live.an ? A.live.an.dur : 0 : A.playing && A.player && A.player.time() != null ? Math.min(A.score.dur, A.player.time()) : video.currentTime);
async function ensureAudio() {
  if (!A.ctx) { A.ctx = new AudioContext({ latencyHint: 'interactive' }); await A.samples.init(); A.player = new Player(A.ctx, A.samples, pageMix()); }
  if (A.ctx.state !== 'running') await A.ctx.resume();
  if (A.live) { const all = A.samples.all(A.params), miss = all.filter(e => !A.samples.ready || !A.samples.get(A.ctx, e));
    if (miss.length) { await A.samples.load(A.ctx, all, (d, n) => status(`loading the strings ${d}/${n}`)); status(''); } return; }
  const need = A.samples.needed(A.score).filter(e => !A.samples.ready || !A.samples.get(A.ctx, e));
  if (need.length) { status(`loading ${need.length} samples…`); await A.samples.load(A.ctx, A.samples.needed(A.score), (d, n) => status(`loading samples ${d}/${n}`)); status(''); }
}
const pageMix = () => ({ ...A.mix, master: $('mutePage').checked ? 0 : A.mix.master });
let starting = 0;
async function startAudio(from) {
  const mine = ++starting;
  await ensureAudio(); if (mine !== starting || !A.playing) return;
  A.player.play(A.score, A.analysis.t, from);
  A.midi.start(from);
}
async function play() {
  if (A.source === CAMERA && !A.live) return startLive('camera');
  if (!A.score) return;
  if (video.currentTime >= A.score.dur - 0.1) video.currentTime = 0;
  A.playing = true; $('play').textContent = 'Pause'; $('play').classList.add('on');
  await startAudio(video.currentTime);
  video.play().catch(() => {});
}
function pause() {
  if (A.live) return stopLive(true);
  A.playing = false; starting++; $('play').textContent = 'Play'; $('play').classList.remove('on');
  if (A.player) A.player.stop(); A.midi.stop(); video.pause(); video.playbackRate = 1;
}
function seek(t) {
  if (A.live) return;
  t = Math.max(0, Math.min((A.score ? A.score.dur : 0) - 0.05, t)); video.currentTime = t;
  if (A.playing) startAudio(t); else draw();
}
$('play').onclick = () => (A.playing || A.live ? pause() : play());
video.addEventListener('ended', pause);
document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (e.code === 'Space') { e.preventDefault(); A.playing || A.live ? pause() : play(); }
  else if (e.key === 'ArrowLeft' && e.target.type !== 'range') seek(currentTime() - 5);
  else if (e.key === 'ArrowRight' && e.target.type !== 'range') seek(currentTime() + 5);
});

// ── live: a camera, or a video as it plays. The pose is tracked in the page and the score is written
// one frame at a time (Analyzer.push → Arranger.step); what sounds is what the body did a frame ago ──
const CAMERA = '__camera', FILE = '__file', livePose = new LivePose();
const wantHands = () => A.params.mode === 'song' && A.params.sngGate === 'fist';      // only then are the hands read (it costs frame rate)
async function startLive(kind, file) {
  stopLive(false); A.playing = false; if (A.player) A.player.stop(); A.midi.stop(); video.pause();
  const mine = ++starting;
  try {
    status('loading the pose model…'); await livePose.load(query.get('model') || CONFIG.model);
    livePose.wantHands = wantHands(); if (livePose.wantHands) { status('loading the hand model…'); await livePose.loadHands(); }
    A.clip = kind === 'camera' ? 'camera' : file.name.replace(/\.[^.]+$/, ''); A.fromFile = true;
    A.analysis = null; A.score = null;
    A.live = { kind, an: null, arr: null, pose: { name: A.clip, t: [], image: [], world: [], hands: [], width: 0, height: 0, duration: 0 }, t0: null, last: -1, fps: 0 };
    await ensureAudio(); if (mine !== starting) return;
    if (kind === 'camera') { A.live.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }); video.srcObject = A.live.stream; video.removeAttribute('src'); }
    else { video.srcObject = null; if (A.fileURL) URL.revokeObjectURL(A.fileURL); A.fileURL = URL.createObjectURL(file); video.src = A.fileURL; video.currentTime = 0; }
    video.playbackRate = 1; await video.play();
  } catch (e) { A.live = null; status(kind === 'camera' ? 'the camera could not be opened' : 'that video could not be played: ' + e.message); return; }
  status(''); $('play').textContent = 'Stop'; $('play').classList.add('on'); $('judge').innerHTML = ''; $('stats').innerHTML = '<div><b>live</b><span>the score is being written as the body moves; stop to see it judged and to save it</span></div>'; seqN = -1;
  const L = A.live, next = () => { if (A.live !== L) return; if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame); else requestAnimationFrame(() => onFrame(performance.now(), null)); };
  const onFrame = (now, meta) => {
    if (A.live !== L) return;
    if (video.readyState >= 2 && video.videoWidth) {
      if (L.t0 === null) L.t0 = performance.now();
      const t = L.kind === 'file' ? (meta ? meta.mediaTime : video.currentTime) : (performance.now() - L.t0) / 1000;
      if (t > L.last + 0.005) {
        const r = livePose.detect(video);
        if (!L.an) { L.pose.width = video.videoWidth; L.pose.height = video.videoHeight; L.an = new Analyzer(video.videoWidth, video.videoHeight, A.clip); newLiveArranger(); A.analysis = L.an; A.pose = L.pose; }
        L.pose.t.push(Math.round(t * 1000) / 1000); L.pose.image.push(r.image); L.pose.world.push(r.world); L.pose.hands.push(r.hands); L.pose.duration = t;
        const i = L.an.push(r.image, r.world, t, r.hands); L.arr.step(i);
        A.player.liveFrame(i, t); A.midi.liveFrame(i, t);
        if (L.last >= 0) L.fps += 0.05 * (1 / Math.max(1e-3, t - L.last) - L.fps); L.last = t;
      }
    }
    next();
  };
  next();
}
function newLiveArranger() {
  const L = A.live; L.arr = new Arranger(L.an, A.params);
  for (let i = 0; i < L.an.n; i++) L.arr.step(i);              // a changed control: the past is re-read in silence, the music carries on from now
  A.score = L.arr.score; A.player.liveStart(A.score); A.midi.liveStart(A.score);
}
function rearrangeLive() {
  livePose.wantHands = wantHands(); if (livePose.wantHands && !livePose.hands) livePose.loadHands().catch(() => {});
  if (A.live.an) { ensureAudio().then(() => { if (A.live && A.live.an) { newLiveArranger(); seqN = -1; } }); }
}
// stop: the pass becomes a clip like any other (a video can then be replayed, seeked, re-arranged and saved)
function stopLive(keep) {
  const L = A.live; if (!L) return; A.live = null; starting++;
  if (A.player) A.player.stop(); A.midi.stop(); video.pause();
  if (L.stream) { for (const tr of L.stream.getTracks()) tr.stop(); video.srcObject = null; }
  $('play').textContent = 'Play'; $('play').classList.remove('on'); A.playing = false;
  if (!keep || !L.an || L.an.n < 10) { if (keep) status('nothing was seen'); return; }
  A.pose = L.pose; A.analysis = analyze(L.pose); if (L.kind === 'file') video.currentTime = 0;
  rearrange(); status(L.kind === 'camera' ? 'stopped: this is what was played (Play starts the camera again)' : '');
}
window.orchestraLive = () => (A.live ? { n: A.live.an ? A.live.an.n : 0, t: A.live.last, fps: A.live.fps, notes: A.score ? A.score.notes.length : 0, chords: A.score ? A.score.chords.length : 0 } : null);

// ── drawing ──
function frameAt(t) { const T = A.analysis.t; let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; } return lo; }
function viewRange(now) {
  if (A.live) { const w = A.zoom || 45; return [Math.max(0, now - 0.92 * w), Math.max(0, now - 0.92 * w) + w]; }
  const dur = A.score.dur; if (!A.zoom || A.zoom >= dur) return [0, dur];
  const a = Math.max(0, Math.min(dur - A.zoom, now - A.zoom * 0.35)); return [a, a + A.zoom];
}
let lastChord = null, lastPlace = null, seqN = 0;
function draw() {
  if (!A.score) return;
  const now = currentTime(), cv = $('timeline');
  cv.style.height = TIMELINE_H + 'px';
  const hidden = {}; for (const p of PARTS) if (A.mix.mute[p] || (Object.values(A.mix.solo).some(Boolean) && !A.mix.solo[p])) hidden[p] = true;
  drawTimeline(cv, A.analysis, A.score, viewRange(now), now, { hidden });
  let c = null; for (const x of A.score.chords) { if (x.t <= now) c = x; else break; }
  const color = c ? DEG_COLOR[c.deg] : '#efe9df';
  drawBody($('overlay'), video, A.pose, frameAt(now), color);
  $('clock').textContent = `${fmt(now)} / ${fmt(A.score.dur)}`;
  if (A.score.mode === 'song') return drawSong(frameAt(now));
  const pl = A.score.places[frameAt(now)], oct = A.score.mode === 'octave', place = pl >= 0 ? (oct ? String(pl) : DEGS[pl]) : null;
  if (place !== lastPlace) { lastPlace = place; for (const d of $('map').children) d.classList.toggle('body', (oct ? d.dataset.pos : d.dataset.deg) === place); }
  if (c !== lastChord) {
    lastChord = c; $('chord').textContent = c ? c.symbol : '–'; $('degree').textContent = c ? c.deg : ''; $('chord').style.color = color;
    for (const d of $('map').children) { const on = c && (c.pos != null ? +d.dataset.pos === c.pos : d.dataset.deg === c.deg); d.classList.toggle('here', !!on); d.style.background = on ? DEG_COLOR[d.dataset.deg] : ''; }
  }
}
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'], noteName = m => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
// Song mode: the notes the lines are on, the hands (open or closed), and the place of each line on its scale
function drawSong(i) {
  const C = A.score.curves, S = A.analysis.sig, P = A.params, on = k => k <= A.score.song.voices && C['amp' + k][i] > 0.004;
  const txt = []; for (let k = 1; k <= A.score.song.voices; k++) txt.push(on(k) ? noteName(C['pitch' + k][i]) : '·');
  $('chord').textContent = txt.join('   '); $('chord').style.color = PART_COLOR.s1;
  const hand = sd => (S['fist' + sd][i] > P.fistOn ? '✊' : '✋');
  $('degree').textContent = P.sngGate === 'fist' && (A.analysis.hasHands || A.live) ? `her left ${hand('L')}  right ${hand('R')}` : '';
  const near = k => { const L = A.score.song.ladders[k - 1]; let b = 0; L.forEach((m, j) => { if (Math.abs(m - C['pitch' + k][i]) < Math.abs(L[b] - C['pitch' + k][i])) b = j; }); return b; };
  const j1 = on(1) ? near(1) : -1, j2 = on(2) ? near(2) : -1;
  for (const d of $('map').children) { const j = +d.dataset.j; d.classList.toggle('here', j === j1); d.style.background = j === j1 ? PART_COLOR.s1 : ''; d.classList.toggle('body', j === j2); }
}
function loop() {
  if (A.live) { if (A.score && A.score.chords.length !== seqN) { seqN = A.score.chords.length; drawSeq(); } }
  else if (A.playing && A.player) {
    const at = A.player.time();
    if (at != null) {
      if (at >= A.score.dur) pause();
      else {
        const d = at - video.currentTime;                      // keep the picture on the sound
        if (Math.abs(d) > 0.3) video.currentTime = at; else video.playbackRate = Math.max(0.9, Math.min(1.1, 1 + 0.6 * d));
        A.midi.tick(at);
      }
    }
  }
  draw(); requestAnimationFrame(loop);
}

// seek by clicking or dragging on the timeline
{ const cv = $('timeline'); let drag = false;
  const at = e => { const r = cv.getBoundingClientRect(), [a, b] = viewRange(currentTime()); return a + (e.clientX - r.left) / r.width * (b - a); };
  cv.addEventListener('pointerdown', e => { drag = true; cv.setPointerCapture(e.pointerId); seek(at(e)); });
  cv.addEventListener('pointermove', e => { if (drag && !A.zoom) seek(at(e)); });
  cv.addEventListener('pointerup', () => { drag = false; }); }

function drawStats() {
  const j = A.judge, lab = { voices: 'voices move well', melody: 'melody', harmony: 'harmony', fit: 'fits her movement', expression: 'expression',
                             line: 'the lines', together: 'together', phrasing: 'phrasing' };
  $('judge').innerHTML = `<div class="total"><b>${Math.round(100 * j.total)}</b><span>judge, of 100</span><i style="width:${100 * j.total}%"></i></div>`
    + Object.entries(j.scores).map(([k, v]) => `<div title="${Object.entries(j.why).map(([a, b]) => a + ' ' + (b == null ? '–' : b.toFixed(2))).join(' · ')}"><b>${Math.round(100 * v)}</b><span>${lab[k]}</span><i style="width:${100 * v}%"></i></div>`).join('');
  const s = A.stats, f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
  if (s.song) {
    $('stats').innerHTML = s.lines.map((l, q) => [[l.n, `${q ? 'lower' : 'upper'} line: notes · ${f(l.perMin, 0)} a minute`], [l.bows, 'bows'], [f(100 * l.sounding, 0) + '%', `of the time sounding, in ${l.phrases} phrases`], [`${noteName(l.lo)}–${noteName(l.hi)}`, 'range']])
      .flat().map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join('')
      + (A.analysis.hasHands ? '' : '<div><b>✋</b><span>no hand was read: every hand counts as open (hands are read while a video or the camera is tracked in a Song version)</span></div>');
    return;
  }
  const oct = A.score.mode === 'octave', home = ((oct ? s.share['1'] : s.share.I) || 0) * 100;
  const dark = (oct ? (s.share['5'] || 0) : (s.share['♭VI'] || 0) + (s.share.i || 0) + (s.share.iv || 0)) * 100;
  const cells = [[s.chords, `chords · ${f(s.perMin)} a minute`], [f(s.durMed) + ' s', 'typical chord length'], [f(home, 0) + '%', oct ? `on the tonic · ${f(dark, 0)}% on the dominant` : `at home · ${f(dark, 0)}% in the dark chords`],
    [s.solo.n, `${oct ? 'top-line' : 'arm-line'} notes · ${f(s.solo.perMin, 0)} a minute`], [f(s.solo.steps * 100, 0) + '%', 'of them by step'], [s.vcl.n, 'leg-line notes'],
    [`${s.pzb} · ${s.pzh} · ${s.harp}`, 'steps · accents · harp'], [f(s.dynMean * 100, 0) + '%', `mean dynamic · tremolo ${f(s.tremShare * 100, 0)}% of the time`]];
  $('stats').innerHTML = cells.map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join('');
}
function drawSeq() {
  $('seq').innerHTML = A.score.chords.map(c => `<span style="background:${DEG_COLOR[c.deg]}" data-t="${c.t}" title="${fmt(c.t)} · ${c.deg} · ${c.cause}">${c.symbol}</span>`).join('');
  for (const el of $('seq').children) el.onclick = () => seek(+el.dataset.t);
}
function buildMap() {
  if (A.params.mode === 'song') {                // the scale as a ladder: each line's notes, the upper line's on the left
    const P = A.params, sc = SCALES[P.sngScale] || SCALES.dorian, all = []; for (let m = 12; m <= 108; m++) if (sc.includes((((m - P.key) % 12) + 12) % 12)) all.push(m);
    const a = all.findIndex(m => m >= P.sngLo1), b = all.findLastIndex(m => m <= P.sngHi1), lo2 = Math.max(0, a - P.sngApart), two = P.sngVoices >= 2; let h = '';
    for (let j = b - a; j >= 0; j--) h += `<div class="wide" data-j="${j}"><b>${noteName(all[a + j])}</b>${two ? `<span>${noteName(all[lo2 + j])}</span>` : ''}<span>${j === b - a ? 'hand above the head' : j === 0 ? 'hand at the hip' : ''}</span></div>`;
    $('map').innerHTML = h;
    $('mapcap').textContent = `No harmony: ${two ? 'two sung lines, a hand each (her right: the upper)' : 'one sung line, led by the higher open hand'}. A hand's height is its place on this scale; a fast hand leaps and slides into the note; a fist lifts the bow. Filled: the upper line now${two ? '. Outline: the lower line (its own notes are the second column)' : ''}.`;
    lastChord = null; lastPlace = null; return;
  }
  if (A.params.mode === 'octave') {             // the octave as a ladder: the bass note and its chord going up and coming down
    const r = RULE[A.params.octMode === 'minor' ? 'minor' : 'major'], N = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'], k = A.params.key;
    const where = ['standing tall', '', '', 'deep lunge', '', '', '', 'floor, inverted'];
    let h = '';
    for (let pos = 7; pos >= 0; pos--) { const d = pos % 7;
      h += `<div class="wide" data-pos="${pos}" data-deg="${d + 1}"><b>${N[(k + r.scaleDown[d]) % 12]}</b><span>${d + 1}</span><span>↑ ${r.up[d][1]} · ↓ ${r.down[d][1]}</span><span>${where[7 - pos]}</span></div>`; }
    $('map').innerHTML = h; $('mapcap').textContent = 'The octave is her height: the bass walks down the scale as she lowers and folds, and back up as she rises, one step at a time, each step with its Rule-of-the-Octave chord (different going up and coming down). Outline: where her body is. Filled: the bass now.';
    lastChord = null; lastPlace = null; return;
  }
  $('mapcap').textContent = 'Her shape chooses the chord. Rows: how high the hips are; columns: which way the axis leans (as the camera sees it). Folding the torso leaves the major for the borrowed minor chords. Outline: where her body is. Filled: the chord sounding.';
  const key = A.params.key, name = d => chordOf(d, key, 0).symbol;
  const cell = (d, label, wide) => `<div data-deg="${d}"${wide ? ' class="wide"' : ''}><b>${name(d)}</b>${label}</div>`;
  $('map').innerHTML = cell('IV', 'tall, leaning left') + cell('I', 'standing tall') + cell('V', 'tall, leaning right')
    + cell('ii', 'lowered, left') + cell('vi', 'lowered') + cell('iii', 'lowered, right')
    + cell('♭VI', 'torso horizontal', 1) + cell('i', 'on the floor', 1) + cell('iv', 'head below the hips', 1);
  lastChord = null; lastPlace = null;
}
$('legend').innerHTML = PARTS.map(p => `<span><i style="background:${PART_COLOR[p]}"></i>${partLabel(p)}</span>`).join('');

// ── the mapping panel, built from PARAM_META ──
let debounce = 0;
function setVersion(id) {
  const v = VERSIONS.find(x => x.id === id);
  $('about').innerHTML = v ? `<b>${v.name}.</b> ${v.about}` : '<b>Custom.</b> Your own settings.';
  $('version').value = v ? id : ''; save('version', v ? id : '');
}
function setParam(k, v) {
  A.params[k] = v; save('params', A.params); setVersion('');
  if (['key', 'mode', 'octMode', 'sngScale', 'sngLo1', 'sngHi1', 'sngApart', 'sngVoices', 'sngUpper'].includes(k)) buildMap();
  if (k === 'mode') buildParams();
  clearTimeout(debounce); debounce = setTimeout(rearrange, 60);
}
function buildParams() {
  // Song mode has its own controls; the harmony's are hidden then (and the other way round)
  const song = A.params.mode === 'song', SONG_G = ['Song', 'Bow', 'Expression'], SHARED = ['mode', 'key', 'dynSrc', 'dynLo', 'dynHi', 'nienteS', 'nearMax'];
  const groups = {}; for (const m of PARAM_META) if (song ? SONG_G.includes(m[5]) || SHARED.includes(m[0]) : !SONG_G.includes(m[5])) (groups[m[5]] = groups[m[5]] || []).push(m);
  const hints = { Harmony: 'shape → chord', Voicing: 'space → spread', Dynamics: 'effort → loudness', Tremolo: 'sudden → bow', 'Arm line': 'arms → violins', 'Leg line': 'legs → cellos', 'Steps and accents': 'pizzicato', Harp: 'circles, turns', Song: 'hands → sung lines', Bow: 'open hand, fist, rest', Expression: 'loudness, vibrato' };
  const open = load('open', { Harmony: true, 'Arm line': true, Song: true, Bow: true, Expression: true });
  $('pane-map').innerHTML = Object.entries(groups).map(([g, ms]) => `<details data-g="${g}"${open[g] ? ' open' : ''}><summary>${g}<small>${hints[g] || ''}</small></summary>${ms.map(row).join('')}</details>`).join('');
  for (const d of $('pane-map').querySelectorAll('details')) d.ontoggle = () => { open[d.dataset.g] = d.open; save('open', open); };
  for (const el of $('pane-map').querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    el.oninput = () => {
      const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.tagName === 'SELECT' ? el.value : +el.value;
      setParam(k, v); const o = el.parentElement.querySelector('output'); if (o) o.textContent = v;
      el.parentElement.classList.toggle('changed', v !== DEFAULTS[k]);
    };
  }
}
function row([k, def, min, max, step, , label]) {
  const v = A.params[k], ch = v !== def ? ' changed' : '';
  if (typeof def === 'string') return `<div class="row${ch}"><label for="p-${k}">${label}</label><select id="p-${k}" data-k="${k}">${(Array.isArray(min) ? min : SOURCES).map(s => `<option${s === v ? ' selected' : ''}>${s}</option>`).join('')}</select></div>`;
  if (min === 0 && max === 1 && step === 1) return `<div class="row${ch}"><label for="p-${k}">${label}</label><input type="checkbox" id="p-${k}" data-k="${k}"${v ? ' checked' : ''}></div>`;
  return `<div class="row${ch}"><label for="p-${k}">${label}</label><input type="range" id="p-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${v}</output></div>`;
}

// ── mixer ──
function buildMix() {
  const rowM = p => `<div class="mixrow"><i style="background:${PART_COLOR[p]}"></i><span>${partLabel(p)}</span><input type="range" min="0" max="1.6" step="0.01" value="${A.mix.gain[p] ?? 1}" data-p="${p}" aria-label="${partLabel(p)} level">`
    + `<button data-m="${p}" class="${A.mix.mute[p] ? 'on' : ''}" title="mute">M</button><button data-s="${p}" class="s ${A.mix.solo[p] ? 'on' : ''}" title="solo">S</button></div>`;
  $('pane-mix').innerHTML = `<p class="note">Levels of the sections. Solo a part to hear what one mapping does on its own.</p>${PARTS.map(rowM).join('')}`
    + `<div class="row" style="margin-top:10px"><label for="mxHall">Hall</label><input type="range" id="mxHall" min="0" max="2" step="0.01" value="${A.mix.reverb}"><output>${A.mix.reverb}</output></div>`
    + `<div class="row"><label for="mxMaster">Master</label><input type="range" id="mxMaster" min="0" max="1.5" step="0.01" value="${A.mix.master}"><output>${A.mix.master}</output></div>`;
  const apply = () => { save('mix', A.mix); if (A.player) A.player.setMix(pageMix()); };
  for (const el of $('pane-mix').querySelectorAll('[data-p]')) el.oninput = () => { A.mix.gain[el.dataset.p] = +el.value; apply(); };
  for (const el of $('pane-mix').querySelectorAll('[data-m]')) el.onclick = () => { const p = el.dataset.m; A.mix.mute[p] = !A.mix.mute[p]; el.classList.toggle('on', A.mix.mute[p]); apply(); };
  for (const el of $('pane-mix').querySelectorAll('[data-s]')) el.onclick = () => { const p = el.dataset.s; A.mix.solo[p] = !A.mix.solo[p]; el.classList.toggle('on', A.mix.solo[p]); apply(); };
  $('mxHall').oninput = e => { A.mix.reverb = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; apply(); };
  $('mxMaster').oninput = e => { A.mix.master = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; apply(); };
}
$('mutePage').onchange = () => { if (A.player) A.player.setMix(pageMix()); };
$('songMidi').onchange = e => { MIDI_OPTS.song = e.target.value; if (A.score) A.midi.load(A.score, A.analysis.t); if (A.playing) A.midi.start(currentTime()); };
$('cc1').onchange = e => { MIDI_OPTS.cc1 = e.target.value; if (A.score) A.midi.load(A.score, A.analysis.t); if (A.playing) A.midi.start(currentTime()); };

// ── tabs, slots, zoom ──
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => {
  for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
  for (const t of ['map', 'mix', 'out', 'read']) $('pane-' + t).hidden = t !== b.dataset.tab;
};
for (const s of ['A', 'B']) $('slot' + s).onclick = e => {
  if (e.shiftKey) { save('slot' + s, A.params); status(`stored in ${s}`); return; }
  const p = load('slot' + s, null); if (!p) { status(`${s} is empty: shift-click stores the current settings`); return; }
  A.params = { ...DEFAULTS, ...p }; save('params', A.params); setVersion(''); buildParams(); buildMap(); rearrange(); status(`settings ${s}`);
};
$('reset').onclick = () => $('version').onchange({ target: { value: 'walking' } });
$('version').innerHTML = VERSIONS.map(v => `<option value="${v.id}">${v.name}</option>`).join('') + '<option value="">Custom</option>';
$('version').onchange = e => { const id = e.target.value; if (!id) return;
  A.params = { ...DEFAULTS, ...paramsOf(id) }; save('params', A.params); setVersion(id); buildParams(); buildMap(); rearrange(); };
$('zoom').onchange = e => { A.zoom = +e.target.value; draw(); };

// ── out ──
const post = async (name, blob) => {
  if (CONFIG.server && !A.fromFile) { await fetch(`/data/${A.clip}/${name}`, { method: 'POST', body: blob }); return `saved output/orchestra/${A.clip}/${name}`; }
  const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `${A.clip || 'live'}-${name}`; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 5000); return `downloaded ${el.download}`;
};
const msg = s => { $('exMsg').textContent = s; };
$('exMid').onclick = async () => { if (A.live || !A.score) return msg('stop first: the score is still being written'); msg(await post('orchestra.mid', new Blob([smf(A.score, A.analysis.t)]))); };
$('exSet').onclick = async () => { msg(await post('settings.json', new Blob([JSON.stringify({ params: A.params, mix: A.mix }, null, 1)]))); };
$('exWav').onclick = async () => { if (A.live || !A.score) return msg('stop first: the score is still being written'); msg('rendering…'); await A.samples.init(); const buf = await render(A.score, A.analysis.t, A.samples, A.mix); msg(await post('orchestra.wav', wavBlob(buf))); };
async function initMidi() {
  if (!A.midi.supported()) { $('midiPort').disabled = true; return; }
  $('midiPort').onfocus = async () => {
    try { const ports = await A.midi.ports(), cur = $('midiPort').value;
      $('midiPort').innerHTML = '<option value="">off</option>' + ports.map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${p.name}</option>`).join(''); } catch (e) { msg('MIDI access was refused'); }
  };
  $('midiPort').onchange = e => { A.midi.select(e.target.value); save('midiPort', e.target.selectedOptions[0]?.textContent || ''); if (A.playing) A.midi.start(currentTime()); };
  // the port chosen last time comes back by itself (the browser already has the permission)
  const want = load('midiPort', '');
  if (want) try { const ports = await A.midi.ports(), p = ports.find(x => x.name === want);
    if (p) { $('midiPort').innerHTML = '<option value="">off</option>' + ports.map(x => `<option value="${x.id}"${x.id === p.id ? ' selected' : ''}>${x.name}</option>`).join(''); A.midi.select(p.id); } } catch (e) {}
}

// for headless renders: arrange and render without the page's controls
window.renderClip = async (name, params = {}, mix = {}, file = 'orchestra', version = null) => {
  if (version) params = { ...paramsOf(version), ...params };
  const pose = await (await fetch(`/data/${name}/pose.json`)).json(), a = analyze(pose), s = arrange(a, { ...DEFAULTS, ...params });
  await A.samples.init();
  const buf = await render(s, a.t, A.samples, { gain: {}, mute: {}, solo: {}, master: 0.85, reverb: 0.9, ...mix });
  await fetch(`/data/${name}/${file}.wav`, { method: 'POST', body: wavBlob(buf) });
  await fetch(`/data/${name}/${file}.mid`, { method: 'POST', body: new Blob([smf(s, a.t)]) });
  return { stats: stats(a, s), judge: judge(a, s), seconds: buf.duration };
};

// ── start ──
(async () => {
  const v0 = query.get('version') ?? load('version', 'bowed');
  if (v0 && (query.has('version') || !load('params', null))) A.params = { ...DEFAULTS, ...paramsOf(v0) };
  setVersion(v0); buildParams(); buildMix(); buildMap(); initMidi();
  let clips = []; if (CONFIG.server) try { clips = await (await fetch('/data/clips')).json(); } catch (e) {}
  $('clip').innerHTML = (clips.length ? '' : '<option value="">Choose a source…</option>') + clips.map(c => `<option>${c.name}</option>`).join('')
    + `<option value="${FILE}">Open a video…</option><option value="${CAMERA}">Camera (live)</option>`;
  $('clip').onchange = e => { A.source = e.target.value; if (e.target.value) loadClip(e.target.value); };
  $('file').onchange = e => { const f = e.target.files[0]; if (f) startLive('file', f); };
  window.addEventListener('resize', draw); requestAnimationFrame(loop);
  if (!clips.length) { status('open a video of someone moving, or use the camera'); window.orchestraReady = true; return; }
  const first = query.get('clip') || load('clip', clips[0].name);
  $('clip').value = clips.some(c => c.name === first) ? first : clips[0].name;
  A.source = $('clip').value;
  if (!query.has('headless')) await loadClip($('clip').value);
  window.orchestraReady = true;
})();
