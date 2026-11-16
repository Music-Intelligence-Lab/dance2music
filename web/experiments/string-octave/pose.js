// MediaPipe Pose Landmarker in the page (tasks-vision), for a camera or a video
// as it plays: GPU with a CPU fallback. Returns the frame as the cached clips
// store it: 33 image landmarks [x, y, visibility] and 33 world landmarks
// [x, y, z] (metres, origin at the hips, y down), or nulls when nobody is seen.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const r4 = x => Math.round(x * 1e4) / 1e4;

export class LivePose {
  constructor() { this.mod = null; this.fileset = null; this.landmarker = null; this.model = ''; this.lastMs = -1; }
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
    if (!im || !wd) return { image: null, world: null };
    return { image: im.map(p => [r4(p.x), r4(p.y), Math.round(100 * (p.visibility ?? 0)) / 100]), world: wd.map(p => [r4(p.x), r4(p.y), r4(p.z)]) };
  }
}
