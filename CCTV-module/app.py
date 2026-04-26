import os
import sys
import time
from dataclasses import dataclass
from types import ModuleType
from typing import Dict, List, Sequence

import numpy as np
from PIL import Image, ImageDraw

# ── cv2 shim ──────────────────────────────────────────────────────────────────
# ultralytics hard-imports cv2 at module level (no try/except).
# On Python 3.14 the wheel has no pre-built .so and libGL.so.1 is absent,
# so the real import crashes the app.  We inject a lightweight shim into
# sys.modules BEFORE ultralytics loads so it gets our PIL-backed stubs instead.
# The shim covers every cv2 symbol ultralytics touches during LetterBox
# preprocessing and YOLO inference on numpy arrays.
try:
    import cv2 as _real_cv2
    _CV2_OK = True
    cv2 = _real_cv2
except Exception:
    _CV2_OK = False

    def _resize(src, dsize, interpolation=1, dst=None):
        h, w = int(dsize[1]), int(dsize[0])
        return np.array(Image.fromarray(src).resize((w, h)))

    def _copy_make_border(src, top, bottom, left, right, borderType=0, dst=None, value=0):
        if isinstance(value, (int, float)):
            value = [value] * (src.shape[2] if src.ndim == 3 else 1)
        h, w = src.shape[:2]
        ch = src.shape[2] if src.ndim == 3 else 1
        out = np.full((h + top + bottom, w + left + right, ch), value, dtype=src.dtype)
        out[top:top + h, left:left + w] = src
        return out

    _shim = ModuleType("cv2")
    _shim.__version__ = "4.8.1.78"
    _shim.__spec__ = None
    # ── constants ──────────────────────────────────────────────────────────────
    for _k, _v in {
        "INTER_NEAREST": 0, "INTER_LINEAR": 1, "INTER_CUBIC": 2,
        "INTER_AREA": 3, "INTER_LANCZOS4": 4,
        "BORDER_CONSTANT": 0, "BORDER_REFLECT": 4,
        "COLOR_BGR2RGB": 4, "COLOR_RGB2BGR": 4, "COLOR_BGR2GRAY": 6,
        "COLOR_BGRA2BGR": 3, "COLOR_GRAY2BGR": 8,
        "CAP_PROP_FRAME_WIDTH": 3, "CAP_PROP_FRAME_HEIGHT": 4,
        "CAP_PROP_FPS": 5, "CAP_PROP_BUFFERSIZE": 38,
        "FONT_HERSHEY_SIMPLEX": 0, "LINE_AA": 16,
        "FILLED": -1,
    }.items():
        setattr(_shim, _k, _v)
    # ── functions ──────────────────────────────────────────────────────────────
    _shim.resize = _resize
    _shim.copyMakeBorder = _copy_make_border
    _shim.cvtColor = lambda src, code, **kw: src          # passthrough; we stay RGB
    _shim.rectangle = lambda *a, **kw: a[0] if a else None
    _shim.putText   = lambda *a, **kw: None
    _shim.addWeighted = lambda s1, a, s2, b, g, **kw: np.clip(s1*a + s2*b + g, 0, 255).astype(np.uint8)
    _shim.imencode  = lambda ext, img, params=None: (True, np.array([]))
    _shim.imdecode  = lambda buf, flags: None
    _shim.destroyAllWindows = lambda: None

    class _VideoCapture:
        def __init__(self, *a, **kw): pass
        def isOpened(self): return False
        def read(self): return False, None
        def release(self): pass
        def set(self, *a, **kw): pass

    _shim.VideoCapture = _VideoCapture
    sys.modules["cv2"] = _shim
    cv2 = _shim

# ── heavy imports (AFTER cv2 shim is in sys.modules) ─────────────────────────
import streamlit as st
import torch
from ultralytics import YOLO

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

TARGET_CLASSES = {"person", "helmet", "no-helmet"}
DEFAULT_WEIGHTS = os.getenv("YOLO11_WEIGHTS", "yolo11n.pt")
ALERT_STREAK_FRAMES = 3

st.set_page_config(page_title="CCTV Helmet Compliance", layout="wide")


@dataclass
class FrameStats:
    total_people: int = 0
    with_helmet: int = 0
    without_helmet: int = 0
    fps: float = 0.0


class PersonTracker:
    def __init__(self, iou_threshold: float = 0.5, max_age: int = 15) -> None:
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        self.tracks: Dict[int, Dict] = {}
        self.next_id = 1

    def update(self, detections: List[Dict]) -> List[Dict]:
        assignments: List[Dict] = []
        assigned_track_ids: set = set()

        for det in detections:
            bbox = det["bbox"]
            best_iou, best_track_id = 0.0, None
            for track_id, track in self.tracks.items():
                iou = compute_iou(bbox, track["bbox"])
                if iou > best_iou:
                    best_iou, best_track_id = iou, track_id

            if best_iou >= self.iou_threshold and best_track_id is not None:
                self.tracks[best_track_id]["bbox"] = bbox
                self.tracks[best_track_id]["age"] = 0
                d = det.copy(); d["track_id"] = best_track_id
                assignments.append(d); assigned_track_ids.add(best_track_id)
            else:
                tid = self.next_id; self.next_id += 1
                self.tracks[tid] = {"bbox": bbox, "age": 0}
                d = det.copy(); d["track_id"] = tid
                assignments.append(d); assigned_track_ids.add(tid)

        for tid in list(self.tracks):
            if tid not in assigned_track_ids:
                self.tracks[tid]["age"] = self.tracks[tid].get("age", 0) + 1
                if self.tracks[tid]["age"] > self.max_age:
                    self.tracks.pop(tid, None)
        return assignments


class AlertManager:
    def __init__(self, threshold: int = ALERT_STREAK_FRAMES) -> None:
        self.threshold = threshold
        self.state: Dict[int, Dict] = {}

    def update(self, track_id: int, violation: bool) -> bool:
        rec = self.state.setdefault(track_id, {"streak": 0, "alerted": False})
        if violation:
            rec["streak"] += 1
        else:
            rec["streak"] = 0; rec["alerted"] = False
        if violation and rec["streak"] >= self.threshold and not rec["alerted"]:
            rec["alerted"] = True; return True
        return False

    def prune(self, active_ids: Sequence[int]) -> None:
        active = set(active_ids)
        for tid in list(self.state):
            if tid not in active:
                self.state.pop(tid, None)


def compute_iou(box_a: Sequence[float], box_b: Sequence[float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (max(0.0, ax2-ax1)*max(0.0, ay2-ay1) +
             max(0.0, bx2-bx1)*max(0.0, by2-by1) - inter)
    return inter / union if union > 0 else 0.0


@st.cache_resource(show_spinner=False)
def load_model(weights_path: str, device: str) -> YOLO:
    model = YOLO(weights_path)
    model.to(device)
    try:
        model.fuse()
    except AttributeError:
        pass
    return model


def process_frame(
    frame: np.ndarray,
    model: YOLO,
    tracker: PersonTracker,
    alert_manager: AlertManager,
    *,
    device: str,
    conf: float,
    iou: float,
    correlation_iou: float,
) -> tuple:
    stats = FrameStats()
    people_summary: List[Dict] = []
    helmet_detections: List[Dict] = []
    bare_detections: List[Dict] = []
    alerts: List[str] = []

    if frame is None:
        return people_summary, helmet_detections, bare_detections, stats, alerts

    with torch.inference_mode():
        result = model.predict(frame, conf=conf, iou=iou, device=device, verbose=False)[0]

    boxes = getattr(result, "boxes", None)
    if boxes is None or boxes.cls is None or boxes.xyxy is None:
        tracker.update([]); alert_manager.prune([])
        return people_summary, helmet_detections, bare_detections, stats, alerts

    names = result.names or model.names
    xyxy = boxes.xyxy.cpu().numpy()
    classes = boxes.cls.int().cpu().tolist()
    scores = boxes.conf.cpu().tolist()
    person_detections: List[Dict] = []

    for box, cls_id, score in zip(xyxy, classes, scores):
        label = (names.get(int(cls_id), str(cls_id))
                 if isinstance(names, dict) else names[int(cls_id)])
        if label not in TARGET_CLASSES:
            continue
        det = {"bbox": box.tolist(), "conf": float(score), "label": label}
        if label == "person":       person_detections.append(det)
        elif label == "helmet":     helmet_detections.append(det)
        elif label == "no-helmet":  bare_detections.append(det)

    tracked = tracker.update(person_detections)
    active_ids = [d["track_id"] for d in tracked]
    alert_manager.prune(active_ids)

    for det in tracked:
        bbox = det["bbox"]
        h_iou = max((compute_iou(bbox, h["bbox"]) for h in helmet_detections), default=0.0)
        b_iou = max((compute_iou(bbox, b["bbox"]) for b in bare_detections), default=0.0)
        state = "with_helmet" if h_iou >= correlation_iou else "without_helmet"
        violation = state == "without_helmet"
        triggered = alert_manager.update(det["track_id"], violation)
        people_summary.append({
            "track_id": det["track_id"], "bbox": bbox, "conf": det["conf"],
            "state": state, "alert": triggered,
            "overlap": max(h_iou, b_iou),
        })
        if triggered:
            alerts.append(f"ALERT: Person #{det['track_id']} without helmet for {ALERT_STREAK_FRAMES}+ frames")

    stats.total_people = len(people_summary)
    stats.with_helmet = sum(1 for d in people_summary if d["state"] == "with_helmet")
    stats.without_helmet = stats.total_people - stats.with_helmet
    return people_summary, helmet_detections, bare_detections, stats, alerts


def draw_analytics_pil(
    image: Image.Image,
    people: List[Dict],
    helmets: List[Dict],
    bare: List[Dict],
    stats: FrameStats,
    *,
    show_helmets: bool,
    show_bare: bool,
) -> Image.Image:
    """Annotate frame using PIL only — no cv2 required."""
    img = image.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    def _rect(bbox, color, width=2):
        x1, y1, x2, y2 = map(int, bbox)
        for i in range(width):
            draw.rectangle([x1-i, y1-i, x2+i, y2+i], outline=(*color, 230))

    def _label(bbox, text, color):
        x1, y1 = int(bbox[0]), int(bbox[1])
        tw, th = len(text) * 6, 14
        ty = max(y1 - th - 2, 0)
        draw.rectangle([x1, ty, x1 + tw + 4, ty + th + 2], fill=(*color, 200))
        draw.text((x1 + 2, ty + 1), text, fill=(255, 255, 255, 255))

    if show_helmets:
        for h in helmets:
            _rect(h["bbox"], (0, 180, 255)); _label(h["bbox"], f"Helmet {h['conf']:.2f}", (0, 140, 200))
    if show_bare:
        for b in bare:
            _rect(b["bbox"], (220, 50, 50)); _label(b["bbox"], f"NoHelmet {b['conf']:.2f}", (180, 30, 30))

    for p in people:
        color = (0, 200, 0) if p["state"] == "with_helmet" else (220, 30, 30)
        width = 4 if p.get("alert") else 2
        _rect(p["bbox"], color, width)
        lbl = f"ID{p['track_id']} {'OK' if p['state']=='with_helmet' else 'NO HELMET'} ({p['conf']:.2f})"
        _label(p["bbox"], lbl, color)
        if p.get("alert"):
            x1, _, _, y2 = map(int, p["bbox"])
            draw.text((x1, y2 + 4), "!! ALERT", fill=(255, 50, 50, 255))

    # Stats box
    draw.rectangle([8, 8, 220, 95], fill=(0, 0, 0, 140))
    draw.text((16, 14), f"People : {stats.total_people}", fill=(240, 240, 240, 255))
    draw.text((16, 34), f"Helmet : {stats.with_helmet}",  fill=(60, 220, 60, 255))
    draw.text((16, 54), f"No Helmet: {stats.without_helmet}", fill=(220, 60, 60, 255))
    if stats.fps:
        draw.text((16, 74), f"FPS    : {stats.fps:.1f}", fill=(220, 200, 60, 255))

    return Image.alpha_composite(img, overlay).convert("RGB")


def _run_rtsp_loop(
    video_source,
    model, tracker, alert_manager,
    *,
    device, conf_th, nms_iou, correlation_iou,
    resize_width, target_fps,
    show_helmets, show_bare,
) -> None:
    """cv2-based loop for RTSP / file / local webcam. Only called when cv2 is available."""
    capture = cv2.VideoCapture(video_source)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, resize_width)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not capture.isOpened():
        src = f"webcam {video_source}" if isinstance(video_source, int) else str(video_source)
        st.error(f"Cannot open **{src}**. On Streamlit Cloud, webcam access via OpenCV is not supported — use the **Camera (Browser)** source instead.")
        return

    frame_ph = st.empty()
    alert_ph = st.empty()
    c1, c2, c3, c4 = st.columns(4)
    stop_btn = st.sidebar.button("Stop stream", key="stop_stream")

    while capture.isOpened() and st.session_state.get("run_detector", True):
        grabbed, frame = capture.read()
        if not grabbed:
            st.warning("No frame received. Stream ended.")
            break
        if frame.shape[1] != resize_width:
            scale = resize_width / frame.shape[1]
            frame = cv2.resize(frame, (resize_width, int(frame.shape[0] * scale)))

        t0 = time.perf_counter()
        frame_rgb = frame[:, :, ::-1]  # BGR→RGB for PIL
        pil_frame = Image.fromarray(frame_rgb)
        people, helmets, bare, stats, alerts = process_frame(
            frame, model, tracker, alert_manager,
            device=device, conf=conf_th, iou=nms_iou, correlation_iou=correlation_iou,
        )
        stats.fps = 1.0 / max(time.perf_counter() - t0, 1e-6)

        annotated = draw_analytics_pil(pil_frame, people, helmets, bare, stats,
                                       show_helmets=show_helmets, show_bare=show_bare)
        frame_ph.image(annotated, use_container_width=True)
        c1.metric("People", stats.total_people)
        c2.metric("With Helmet", stats.with_helmet)
        c3.metric("Without Helmet", stats.without_helmet)
        c4.metric("FPS", f"{stats.fps:.1f}")
        alert_ph.error("\n".join(alerts)) if alerts else alert_ph.empty()

        if stop_btn:
            st.session_state["run_detector"] = False
            break
        delay = max(0.0, 1.0 / target_fps - (time.perf_counter() - t0))
        if delay:
            time.sleep(delay)

    capture.release()


def main_loop() -> None:
    st.title("CCTV Helmet Detector")
    st.caption("YOLOv11 (Ultralytics) — Streamlit dashboard")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    st.sidebar.markdown(f"**Compute:** {device.upper()}")

    weights_path  = st.sidebar.text_input("YOLOv11 weights", DEFAULT_WEIGHTS)
    conf_th       = st.sidebar.slider("Confidence", 0.1, 0.95, 0.4, 0.05)
    nms_iou       = st.sidebar.slider("NMS IoU", 0.1, 0.95, 0.5, 0.05)
    correlation_iou = st.sidebar.slider("Helmet corr. IoU", 0.1, 0.9, 0.3, 0.05)
    resize_width  = st.sidebar.slider("Inference width (px)", 320, 1280, 640, 40)
    target_fps    = st.sidebar.slider("FPS cap (RTSP/file)", 5, 30, 15, 5)
    show_helmets  = st.sidebar.checkbox("Show helmet boxes", value=True)
    show_bare     = st.sidebar.checkbox("Show no-helmet boxes", value=True)

    source_options = ["Camera (Browser)", "RTSP/HTTP URL", "Video file", "Webcam 0", "Webcam 1"]
    source_choice  = st.sidebar.selectbox("Video source", source_options)

    # Load model
    try:
        model = load_model(weights_path, device)
    except Exception as exc:
        st.error(f"Cannot load weights: {exc}")
        st.stop()

    tracker       = PersonTracker()
    alert_manager = AlertManager()

    # ── Browser camera path (no cv2 needed) ──────────────────────────────────
    if source_choice == "Camera (Browser)":
        run = st.sidebar.checkbox("Run detector", value=False, key="run_detector")
        if not run:
            st.info("Select **Camera (Browser)**, allow camera access, then enable **Run detector**.")
            return

        img_file = st.camera_input("Point camera at workers", key="cam_snap",
                                   label_visibility="collapsed")
        if img_file is None:
            st.info("Waiting for camera frame…")
            return

        pil_frame = Image.open(img_file).convert("RGB")
        frame_np  = np.array(pil_frame)

        t0 = time.perf_counter()
        people, helmets, bare, stats, alerts = process_frame(
            frame_np, model, tracker, alert_manager,
            device=device, conf=conf_th, iou=nms_iou, correlation_iou=correlation_iou,
        )
        stats.fps = 1.0 / max(time.perf_counter() - t0, 1e-6)

        annotated = draw_analytics_pil(pil_frame, people, helmets, bare, stats,
                                       show_helmets=show_helmets, show_bare=show_bare)
        st.image(annotated, use_container_width=True)

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("People",       stats.total_people)
        c2.metric("With Helmet",  stats.with_helmet)
        c3.metric("No Helmet",    stats.without_helmet)
        c4.metric("FPS",          f"{stats.fps:.1f}")

        if alerts:
            st.error("\n".join(alerts))

        # Auto-rerun for continuous detection
        time.sleep(0.05)
        st.rerun()
        return

    # ── cv2-dependent paths (RTSP / file / local webcam) ─────────────────────
    if not _CV2_OK:
        st.error(
            "OpenCV is not available in this environment. "
            "Use **Camera (Browser)** source for Streamlit Cloud, "
            "or run the app locally with OpenCV installed."
        )
        return

    run = st.sidebar.checkbox("Run detector", value=False, key="run_detector")
    if not run:
        st.info("Enable **Run detector** in the sidebar to start streaming.")
        return

    if source_choice == "RTSP/HTTP URL":
        video_source: str | int = st.sidebar.text_input("RTSP or HTTP URL", "rtsp://user:pass@host/stream")
    elif source_choice == "Video file":
        video_source = st.sidebar.text_input("Path to video file", "sample.mp4")
    elif source_choice == "Webcam 0":
        video_source = 0
    else:
        video_source = 1

    _run_rtsp_loop(
        video_source, model, tracker, alert_manager,
        device=device, conf_th=conf_th, nms_iou=nms_iou,
        correlation_iou=correlation_iou, resize_width=resize_width,
        target_fps=target_fps, show_helmets=show_helmets, show_bare=show_bare,
    )


if __name__ == "__main__":
    main_loop()
