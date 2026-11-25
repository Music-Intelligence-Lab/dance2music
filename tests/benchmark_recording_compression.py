r"""Compare saved-video reanalysis against the browser's previous recording profile.

Example (repeat --clip or --profile to compare multiple inputs or candidates):
    python tests/benchmark_recording_compression.py --clip dancer.mp4 20 \
        --profile h264:640:500 --profile vp9:1280:2000

Requires FFmpeg with libx264/libvpx, OpenCV, NumPy, SciPy, MediaPipe Tasks, and
the app's downloaded pose_landmarker_full.task. Each excerpt is encoded at
30 fps with no audio. Results concern the full-body model and dance_pose.signals.
The browser's original per-frame observations are independent of this experiment.
Output is JSON Lines, one result per clip/profile/keyframe interval. Each metric
is the median comparison against the references. Control-adjusted limits include
the worst leave-one-out reference variation observed for that excerpt.
"""

import argparse
import contextlib
import io
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

import cv2
import mediapipe as mp
import numpy as np
from numpy.typing import NDArray

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import dance_pose  # noqa: E402

SIGN = np.array([1, -1, 1, -1])
METRICS = ("recall", "p95_xy", "label_agreement", "energy_mae")
TARGETS = np.array([0.98, 0.03, 0.90, 0.10])


class Profile(NamedTuple):
    codec: str
    edge: int
    kbps: int


class Analysis(NamedTuple):
    landmarks: NDArray[np.float32]
    labels: NDArray[np.str_]
    energy: NDArray[np.float64]
    accents: list[float]


def profile_arg(value: str) -> Profile:
    try:
        codec, edge_text, rate_text = value.split(":")
        edge, rate = int(edge_text), int(rate_text)
        if codec not in {"h264", "vp8", "vp9"} or edge < 2 or edge % 2 or rate < 1:
            raise ValueError
        return Profile(codec, edge, rate)
    except ValueError as error:
        raise argparse.ArgumentTypeError("use h264|vp8|vp9:even_long_edge:positive_kbps") from error


def encode(
    source: Path, start: float, seconds: float, profile: Profile, dest: Path, gop: int = 60
) -> Path:
    codec, edge, rate = profile
    if codec == "h264":
        encoder = ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency"]
    else:
        encoder = [
            "-c:v",
            "libvpx-vp9" if codec == "vp9" else "libvpx",
            "-deadline",
            "realtime",
            "-cpu-used",
            "6",
        ]
        if codec == "vp9":
            encoder += ["-row-mt", "1"]

    def dimension(axis: str) -> str:
        return (
            f"if(gt(max(iw,ih),{edge}),max(2,2*round({axis}*{edge}/max(iw,ih)/2)),"
            f"max(2,2*trunc({axis}/2)))"
        )

    scale = f"scale=w='{dimension('iw')}':h='{dimension('ih')}':flags=bilinear"
    output = dest.with_suffix(".mp4" if codec == "h264" else ".webm")
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-ss",
            str(start),
            "-i",
            str(source),
            "-t",
            str(seconds),
            "-an",
            "-vf",
            f"fps=30,{scale},setsar=1",
            *encoder,
            "-g",
            str(gop),
            "-b:v",
            f"{rate}k",
            "-maxrate",
            f"{rate}k",
            "-bufsize",
            f"{rate}k",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "2",
            str(output),
        ],
        check=True,
    )
    return output


def analyze(video: Path, model: Path) -> Analysis:
    vis = mp.tasks.vision
    options = vis.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=vis.RunningMode.VIDEO,
    )
    cap = cv2.VideoCapture(str(video))
    image_points: list[NDArray[np.float32]] = []
    world_points: list[NDArray[np.float32]] = []
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        with vis.PoseLandmarker.create_from_options(options) as pose:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = pose.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb),
                    round(len(image_points) * 1000 / fps),
                )
                if result.pose_landmarks:
                    image_points.append(
                        np.asarray(
                            [[p.x, p.y, p.z, p.visibility] for p in result.pose_landmarks[0]],
                            dtype=np.float32,
                        )
                    )
                    world_points.append(
                        np.asarray(
                            [[p.x, p.y, p.z] for p in result.pose_world_landmarks[0]],
                            dtype=np.float32,
                        )
                    )
                else:
                    image_points.append(np.full((33, 4), np.nan, dtype=np.float32))
                    world_points.append(np.full((33, 3), np.nan, dtype=np.float32))
    finally:
        cap.release()
    if not image_points or len(image_points) < 3 * fps:
        raise ValueError(f"{video.name}: at least three seconds of decodable frames are required")
    points = np.asarray(image_points, dtype=np.float32)
    directory = Path(dance_pose.out_dir(str(video)))
    np.savez_compressed(
        directory / "landmarks.npz",
        X=points,
        W=np.asarray(world_points, dtype=np.float32),
        fps=fps,
        t=np.arange(len(points)) / fps,
    )
    with contextlib.redirect_stdout(io.StringIO()):
        dance_pose.signals(str(video))
    with np.load(directory / "signals.npz") as signals:
        peaks = json.loads((directory / "signals.json").read_text())["peaks"]
        return Analysis(
            points, signals["labels"], signals["energy"], [peak["time"] for peak in peaks]
        )


def accent_f1(reference: list[float], candidate: list[float]) -> float:
    # Greedy ordered matching gives the maximum number of matches within the window.
    ref = cand = matches = 0
    while ref < len(reference) and cand < len(candidate):
        dt = candidate[cand] - reference[ref]
        if dt < -0.100001:
            cand += 1
        elif dt > 0.100001:
            ref += 1
        else:
            matches += 1
            ref += 1
            cand += 1
    count = len(reference) + len(candidate)
    return 2 * matches / count if count else 1.0


def compare(reference: Analysis, candidate: Analysis) -> list[float]:
    old, old_labels, old_energy, _ = reference
    new, labels, energy, _ = candidate
    if old.shape != new.shape:
        raise ValueError(f"frame counts differ ({len(old)} vs {len(new)})")
    detected = np.isfinite(old[:, 0, 0])
    if not detected.any():
        raise ValueError("reference detected no body; choose an excerpt with visible movement")
    paired = detected & np.isfinite(new[:, 0, 0])
    distances = np.linalg.norm(old[:, :, :2] - new[:, :, :2], axis=2)
    visible = distances[(old[:, :, 3] >= 0.5) & paired[:, None]]
    return [
        paired.sum() / detected.sum(),
        np.percentile(visible, 95) if visible.size else np.inf,
        np.mean(old_labels == labels),
        np.mean(abs(old_energy - energy)),
    ]


def reference_limits(references: list[Analysis]) -> NDArray[np.float64]:
    # Measure each unchanged-quality control against the other controls. Where
    # repeatability itself misses a target, expose this separately from a pass.
    if len(references) < 2:
        return TARGETS
    controls = []
    for index, candidate in enumerate(references):
        peers = [compare(other, candidate) for i, other in enumerate(references) if i != index]
        controls.append(np.median(peers, axis=0) * SIGN)
    return np.minimum(TARGETS * SIGN, np.min(controls, axis=0)) * SIGN


def benchmark(args: argparse.Namespace) -> None:
    with tempfile.TemporaryDirectory(prefix="dance2music-compression-") as scratch:
        directory = Path(scratch)
        dance_pose.OUT_ROOT = str(directory / "analysis")
        for index, (source, start) in enumerate(args.clip):
            source = Path(source)
            if not source.is_file() or not math.isfinite(float(start)) or float(start) < 0:
                raise ValueError("--clip needs an existing video and a nonnegative start time")
            references, sizes = [], []
            for repeat in range(args.references):
                baseline = encode(
                    source,
                    start,
                    args.seconds,
                    Profile(args.reference_codec, 1920, 6000),
                    directory / f"{index}-reference-{repeat}",
                )
                references.append(analyze(baseline, args.model))
                sizes.append(baseline.stat().st_size)
            limits = reference_limits(references)
            for profile in args.profile:
                codec, edge, rate = profile
                for gop in args.gop or [60]:
                    video = encode(
                        source,
                        start,
                        args.seconds,
                        profile,
                        directory / f"{index}-{codec}-{edge}-{rate}-{gop}",
                        gop,
                    )
                    candidate = analyze(video, args.model)
                    scores = np.median([compare(b, candidate) for b in references], axis=0)
                    recall, drift, agreement, energy = scores
                    result = {
                        "clip": source.name,
                        "start_s": float(start),
                        "codec": codec,
                        "edge": edge,
                        "kbps": rate,
                        "gop": gop,
                        "frames": len(candidate.landmarks),
                        "video_bytes": video.stat().st_size,
                        "reference_codec": args.reference_codec,
                        "reference_video_bytes": int(np.median(sizes)),
                        "recall": round(recall, 4),
                        "p95_xy": round(drift, 4) if np.isfinite(drift) else None,
                        "label_agreement": round(agreement, 4),
                        "energy_mae": round(energy, 4),
                        "control_adjusted_limits": {
                            k: round(v, 4) if np.isfinite(v) else None
                            for k, v in zip(METRICS, limits, strict=True)
                        },
                        "accent_f1_100ms": round(
                            float(
                                np.median(
                                    [accent_f1(b.accents, candidate.accents) for b in references]
                                )
                            ),
                            4,
                        ),
                        "passed": bool(np.all((scores - TARGETS) * SIGN >= 0)),
                        "passed_with_control_tolerance": bool(
                            np.all((scores - limits) * SIGN >= 0)
                        ),
                    }
                    print(json.dumps(result, allow_nan=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--clip", nargs=2, action="append", metavar=("VIDEO", "START_SECONDS"), required=True
    )
    parser.add_argument(
        "--profile", type=profile_arg, action="append", required=True, metavar="CODEC:EDGE:KBPS"
    )
    parser.add_argument(
        "--gop",
        type=int,
        action="append",
        help="candidate keyframe interval; repeat to compare intervals (default 60)",
    )
    parser.add_argument("--reference-codec", choices=("h264", "vp8", "vp9"), default="h264")
    parser.add_argument("--seconds", type=float, default=6)
    parser.add_argument(
        "--references", type=int, default=4, help="independent encodes at the previous settings"
    )
    parser.add_argument(
        "--model", type=Path, default=ROOT / "web/live/vendor/mediapipe/pose_landmarker_full.task"
    )
    args = parser.parse_args()
    if not math.isfinite(args.seconds) or args.seconds < 3 or args.references < 1:
        parser.error("choose at least three seconds and one reference")
    if any(g < 1 for g in args.gop or []):
        parser.error("keyframe intervals must be positive")
    benchmark(args)
