// Apply the export profile only to the compositor. Detectors use the source video.
// Return the target bitrate for the codec passed to MediaRecorder. The study
// pages previously exported uncapped video; the live app capped it at 1920px.
export function configureRecordingCanvas(canvas, sourceWidth, sourceHeight, mimeType, previousMaxEdge = 1920) {
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const avc = mimeType.startsWith('video/mp4;codecs=avc1');
  const compact = avc && sourceLongEdge > 640;
  if (!avc && previousMaxEdge === Infinity) {
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    return mimeType ? 6_000_000 : null;
  }
  const scale = Math.min(1, (compact ? 1280 : previousMaxEdge) / sourceLongEdge);
  // Codecs require even dimensions. Round down when retaining the source size.
  const round = avc && scale === 1 ? Math.floor : Math.round;
  canvas.width = Math.max(2, 2 * round(sourceWidth * scale / 2));
  canvas.height = Math.max(2, 2 * round(sourceHeight * scale / 2));
  // Native 640px camera footage lost pose and hand detail at lower bitrates.
  if (!mimeType) return null;
  return compact ? 3_500_000 : 6_000_000;
}
