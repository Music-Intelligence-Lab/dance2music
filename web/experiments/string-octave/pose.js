// MediaPipe Pose Landmarker in the page (tasks-vision), for a camera or a video
// as it plays: GPU with a CPU fallback. Returns the frame as the cached clips
// store it: 33 image landmarks [x, y, visibility] and 33 world landmarks
// [x, y, z] (metres, origin at the hips, y down), or nulls when nobody is seen.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const HANDS = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';
const r4 = x => Math.round(x * 1e4) / 1e4, r2 = x => Math.round(x * 100) / 100;
// the hands: a crop around each wrist (a full-body dancer's hand is ~40 px), the
// gesture model on the crop → [fist, palm, curl, open]. One hand every third frame, in turn (each hand about five times
// a second), because reading a hand costs about as much as the pose itself.
const HAND_EVERY = 3, CROP = 256, CROP_TORSO = 1.1, CROP_MIN = 64, REACH = 0.35, CHAIN = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
function flex(L, a, b, c) {
  const u = [L[a].x - L[b].x, L[a].y - L[b].y, L[a].z - L[b].z], v = [L[c].x - L[b].x, L[c].y - L[b].y, L[c].z - L[b].z];
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) + 1e-9))));
}
const curl = L => CHAIN.reduce((z, [m, p, d, t]) => z + Math.min(1, (flex(L, 0, m, p) + flex(L, m, p, d) + flex(L, p, d, t)) / 4), 0) / 4;
function openness(L) {
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y); let r = 0;
  for (const [t, m] of [[8, 5], [12, 9], [16, 13], [20, 17]]) r += d(L[t], L[0]) / Math.max(1e-6, d(L[m], L[0]));
  return Math.min(1, Math.max(0, (r / 4 - 1.1) / 0.8));
}

export class LivePose {
  constructor() { this.mod = null; this.fileset = null; this.landmarker = null; this.model = ''; this.lastMs = -1; this.hands = null; this.wantHands = false; this.turn = 0; }
  // the hand reader (optional: only Song mode with a fist for a gate needs it). Call after load().
  async loadHands() {
    if (this.hands) return;
    this.hands = await this.mod.GestureRecognizer.createFromOptions(this.fileset, { baseOptions: { modelAssetPath: HANDS, delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 1,
      minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3, cannedGesturesClassifierOptions: { maxResults: -1, scoreThreshold: 0 } });
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = CROP; this.cx = this.canvas.getContext('2d');
  }
  readHand(video, im, wj, ej) {
    const W = video.videoWidth, H = video.videoHeight, P = j => [im[j].x * W, im[j].y * H];
    if ((im[wj].visibility ?? 0) < 0.3) return null;
    const w = P(wj), e = P(ej), torso = Math.hypot((P(11)[0] + P(12)[0] - P(23)[0] - P(24)[0]) / 2, (P(11)[1] + P(12)[1] - P(23)[1] - P(24)[1]) / 2);
    const sz = Math.max(CROP_MIN, CROP_TORSO * torso), x = w[0] + REACH * (w[0] - e[0]) - sz / 2, y = w[1] + REACH * (w[1] - e[1]) - sz / 2;
    const g = this.cx; g.fillStyle = '#000'; g.fillRect(0, 0, CROP, CROP);
    const sx = Math.max(0, x), sy = Math.max(0, y), ex = Math.min(W, x + sz), ey = Math.min(H, y + sz); if (ex <= sx || ey <= sy) return null;
    g.drawImage(video, sx, sy, ex - sx, ey - sy, (sx - x) / sz * CROP, (sy - y) / sz * CROP, (ex - sx) / sz * CROP, (ey - sy) / sz * CROP);
    const r = this.hands.recognize(this.canvas); if (!r.landmarks || !r.landmarks[0]) return null;
    const sc = {}; for (const c of (r.gestures && r.gestures[0]) || []) sc[c.categoryName] = c.score;
    return [r2(sc.Closed_Fist || 0), r2(sc.Open_Palm || 0), r2(r.worldLandmarks && r.worldLandmarks[0] ? curl(r.worldLandmarks[0]) : 0), r2(openness(r.landmarks[0]))];
  }
  async load(model = 'heavy') {
    if (this.landmarker && this.model === model) return;
    if (!this.mod) { this.mod = await import(MP + 'vision_bundle.mjs'); this.fileset = await this.mod.FilesetResolver.forVisionTasks(MP + 'wasm'); }
    if (this.landmarker) this.landmarker.close();
    const opts = delegate => ({ baseOptions: { modelAssetPath: MODEL(model), delegate }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { this.landmarker = await this.mod.PoseLandmarker.createFromOptions(this.fileset, opts('GPU')); }
    catch (e) { this.landmarker = await this.mod.PoseLandmarker.createFromOptions(this.fileset, opts('CPU')); }
    this.model = model;
  }
  detect(video) {
    const ms = Math.max(performance.now(), this.lastMs + 1); this.lastMs = ms;      // the model wants a clock that only goes forward
    const res = this.landmarker.detectForVideo(video, ms), im = res.landmarks && res.landmarks[0], wd = res.worldLandmarks && res.worldLandmarks[0];
    if (!im || !wd) return { image: null, world: null, hands: null };
    let hands = null;
    if (this.hands && this.wantHands) { hands = [null, null]; const q = this.turn++;                // one hand every HAND_EVERY frames, in turn
      if (q % HAND_EVERY === 0) { const k = (q / HAND_EVERY) % 2; try { hands[k] = this.readHand(video, im, k ? 16 : 15, k ? 14 : 13); } catch (e) {} } }
    return { hands, image: im.map(p => [r4(p.x), r4(p.y), Math.round(100 * (p.visibility ?? 0)) / 100]), world: wd.map(p => [r4(p.x), r4(p.y), r4(p.z)]) };
  }
}
