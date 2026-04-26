import os
import sys
import time
import threading
from dataclasses import dataclass
from types import ModuleType
from typing import Dict, List, Sequence

import numpy as np
from PIL import Image, ImageDraw

# ── cv2 shim ──────────────────────────────────────────────────────────────────
# ultralytics/utils/__init__.py line 24 does a bare `import cv2` with no
# try/except. On Streamlit Cloud the opencv wheel links against libGL.so.1
# which is absent, crashing before any user code runs.
# We inject a PIL-backed shim into sys.modules BEFORE ultralytics loads.
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
    for _k, _v in {
        "INTER_NEAREST": 0, "INTER_LINEAR": 1, "INTER_CUBIC": 2,
        "INTER_AREA": 3, "INTER_LANCZOS4": 4,
        "BORDER_CONSTANT": 0, "BORDER_REFLECT": 4,
        "COLOR_BGR2RGB": 4, "COLOR_RGB2BGR": 4, "COLOR_BGR2GRAY": 6,
        "COLOR_BGRA2BGR": 3, "COLOR_GRAY2BGR": 8,
        "CAP_PROP_FRAME_WIDTH": 3, "CAP_PROP_FRAME_HEIGHT": 4,
        "CAP_PROP_FPS": 5, "CAP_PROP_BUFFERSIZE": 38,
        "FONT_HERSHEY_SIMPLEX": 0, "LINE_AA": 16, "FILLED": -1,
    }.items():
        setattr(_shim, _k, _v)
    _shim.resize = _resize
    _shim.copyMakeBorder = _copy_make_border
    _shim.cvtColor = lambda src, code, **kw: src
    _shim.rectangle = lambda *a, **kw: a[0] if a else None
    _shim.putText = lambda *a, **kw: None
    _shim.addWeighted = lambda s1, a, s2, b, g, **kw: np.clip(
        s1.astype(float) * a + s2.astype(float) * b + g, 0, 255
    ).astype(np.uint8)
    _shim.imencode = lambda ext, img, params=None: (True, np.array([]))
    _shim.imdecode = lambda buf, flags: None
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

# ── imports after shim ────────────────────────────────────────────────────────
import streamlit as st
import torch
from ultralytics import YOLO
import av
from streamlit_webrtc import webrtc_streamer, VideoProcessorBase, RTCConfiguration

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

# ── constants ─────────────────────────────────────────────────────────────────
TARGET_CLASSES = {"person", "helmet", "no-helmet"}
DEFAULT_WEIGHTS = os.getenv("YOLO11_WEIGHTS", "yolo11n.pt")
ALERT_STREAK_FRAMES = 3

RTC_CONFIGURATION = RTCConfiguration({"iceServers": [
    {"urls": ["stun:stun.l.google.com:19302"]},
    {"urls": ["stun:stun1.l.google.com:19302"]},
    {"urls": ["stun:stun2.l.google.com:19302"]},
    {"urls": ["stun:stun3.l.google.com:19302"]},
]})

st.set_page_config(page_title="CCTV Helmet Compliance", layout="wide")


# ── data classes ──────────────────────────────────────────────────────────────
@dataclass
class FrameStats:
    total_people: int = 0
    with_helmet: int = 0
    without_helmet: int = 0
    fps: float = 0.0


# ── tracker / alert manager ───────────────────────────────────────────────────
class PersonTracker:
    def __init__(self, iou_threshold: float = 0.5, max_age: int = 15) -> None:
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        self.tracks: Dict[int, Dict] = {}
        self.next_id = 1

    def update(self, detections: List[Dict]) -> List[Dict]:
        assignments: List[Dict] = []
        assigned: set = set()
        for det in detections:
            bbox = det["bbox"]
            best_iou, best_id = 0.0, None
            for tid, tr in self.tracks.items():
                iou = compute_iou(bbox, tr["bbox"])
                if iou > best_iou:
                    best_iou, best_id = iou, tid
            if best_iou >= self.iou_threshold and best_id is not None:
                self.tracks[best_id]["bbox"] = bbox
                self.tracks[best_id]["age"] = 0
                d = det.copy(); d["track_id"] = best_id
                assignments.append(d); assigned.add(best_id)
            else:
                tid = self.next_id; self.next_id += 1
                self.tracks[tid] = {"bbox": bbox, "age": 0}
                d = det.copy(); d["track_id"] = tid
                assignments.append(d); assigned.add(tid)
        for tid in list(self.tracks):
            if tid not in assigned:
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


# ── helpers ───────────────────────────────────────────────────────────────────
def compute_iou(a: Sequence[float], b: Sequence[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = ((ax2-ax1)*(ay2-ay1) + (bx2-bx1)*(by2-by1) - inter)
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
    people: List[Dict] = []
    helmets: List[Dict] = []
    bare: List[Dict] = []
    alerts: List[str] = []

    if frame is None:
        return people, helmets, bare, stats, alerts

    with torch.inference_mode():
        result = model.predict(frame, conf=conf, iou=iou, device=device, verbose=False)[0]

    boxes = getattr(result, "boxes", None)
    if boxes is None or boxes.cls is None or boxes.xyxy is None:
        tracker.update([]); alert_manager.prune([])
        return people, helmets, bare, stats, alerts

    names = result.names or model.names
    xyxy    = boxes.xyxy.cpu().numpy()
    classes = boxes.cls.int().cpu().tolist()
    scores  = boxes.conf.cpu().tolist()
    person_dets: List[Dict] = []

    for box, cls_id, score in zip(xyxy, classes, scores):
        label = (names.get(int(cls_id), str(cls_id))
                 if isinstance(names, dict) else names[int(cls_id)])
        if label not in TARGET_CLASSES:
            continue
        det = {"bbox": box.tolist(), "conf": float(score), "label": label}
        if label == "person":       person_dets.append(det)
        elif label == "helmet":     helmets.append(det)
        elif label == "no-helmet":  bare.append(det)

    tracked   = tracker.update(person_dets)
    active_ids = [d["track_id"] for d in tracked]
    alert_manager.prune(active_ids)

    for det in tracked:
        bbox  = det["bbox"]
        h_iou = max((compute_iou(bbox, h["bbox"]) for h in helmets), default=0.0)
        b_iou = max((compute_iou(bbox, b["bbox"]) for b in bare),    default=0.0)
        state = "with_helmet" if h_iou >= correlation_iou else "without_helmet"
        triggered = alert_manager.update(det["track_id"], state == "without_helmet")
        people.append({
            "track_id": det["track_id"], "bbox": bbox, "conf": det["conf"],
            "state": state, "alert": triggered,
        })
        if triggered:
            alerts.append(f"ALERT: Person #{det['track_id']} without helmet for {ALERT_STREAK_FRAMES}+ frames")

    stats.total_people  = len(people)
    stats.with_helmet   = sum(1 for d in people if d["state"] == "with_helmet")
    stats.without_helmet = stats.total_people - stats.with_helmet
    return people, helmets, bare, stats, alerts


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
    img = image.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    def _rect(bbox, color, width=2):
        x1, y1, x2, y2 = map(int, bbox)
        for i in range(width):
            draw.rectangle([x1-i, y1-i, x2+i, y2+i], outline=(*color, 230))

    def _label(bbox, text, color):
        x1, y1 = int(bbox[0]), int(bbox[1])
        tw = len(text) * 6
        ty = max(y1 - 16, 0)
        draw.rectangle([x1, ty, x1 + tw + 4, ty + 16], fill=(*color, 200))
        draw.text((x1 + 2, ty + 1), text, fill=(255, 255, 255, 255))

    if show_helmets:
        for h in helmets:
            _rect(h["bbox"], (0, 180, 255)); _label(h["bbox"], f"Helmet {h['conf']:.2f}", (0, 140, 200))
    if show_bare:
        for b in bare:
            _rect(b["bbox"], (220, 50, 50)); _label(b["bbox"], f"NoHelmet {b['conf']:.2f}", (180, 30, 30))
    for p in people:
        color = (0, 200, 0) if p["state"] == "with_helmet" else (220, 30, 30)
        _rect(p["bbox"], color, 4 if p.get("alert") else 2)
        lbl = f"ID{p['track_id']} {'OK' if p['state']=='with_helmet' else 'NO HELMET'} ({p['conf']:.2f})"
        _label(p["bbox"], lbl, color)
        if p.get("alert"):
            x1, _, _, y2 = map(int, p["bbox"])
            draw.text((x1, y2 + 4), "!! ALERT", fill=(255, 50, 50, 255))

    # Stats HUD
    draw.rectangle([8, 8, 225, 98], fill=(0, 0, 0, 140))
    draw.text((16, 14), f"People   : {stats.total_people}",   fill=(240, 240, 240, 255))
    draw.text((16, 34), f"Helmet   : {stats.with_helmet}",    fill=(60, 220, 60, 255))
    draw.text((16, 54), f"No Helmet: {stats.without_helmet}", fill=(220, 60, 60, 255))
    if stats.fps:
        draw.text((16, 74), f"FPS      : {stats.fps:.1f}",    fill=(220, 200, 60, 255))

    return Image.alpha_composite(img, overlay).convert("RGB")


# ── WebRTC video processor ────────────────────────────────────────────────────
class HelmetDetector(VideoProcessorBase):
    """Runs YOLO on each WebRTC frame and annotates using PIL — no libGL needed."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.model: YOLO | None = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        # Inference params — updated from main thread via direct assignment
        self.conf_th         = 0.4
        self.nms_iou         = 0.5
        self.correlation_iou = 0.3
        self.show_helmets    = True
        self.show_bare       = True
        # Per-processor state
        self._tracker     = PersonTracker()
        self._alert_mgr   = AlertManager()
        # Shared stats readable from main thread
        self.stats  = FrameStats()
        self.alerts: List[str] = []

    def recv(self, frame: av.VideoFrame) -> av.VideoFrame:
        img_rgb = frame.to_ndarray(format="rgb24")

        if self.model is None:
            return frame

        t0 = time.perf_counter()
        people, helmets, bare, stats, alerts = process_frame(
            img_rgb, self.model, self._tracker, self._alert_mgr,
            device=self.device,
            conf=self.conf_th,
            iou=self.nms_iou,
            correlation_iou=self.correlation_iou,
        )
        stats.fps = 1.0 / max(time.perf_counter() - t0, 1e-6)

        with self._lock:
            self.stats  = stats
            self.alerts = list(alerts)

        pil_img  = Image.fromarray(img_rgb)
        annotated = draw_analytics_pil(
            pil_img, people, helmets, bare, stats,
            show_helmets=self.show_helmets,
            show_bare=self.show_bare,
        )
        return av.VideoFrame.from_ndarray(np.array(annotated), format="rgb24")


# ── cv2 RTSP / file / local webcam fallback ───────────────────────────────────
def _run_rtsp_loop(
    video_source,
    model, tracker, alert_manager,
    *, device, conf_th, nms_iou, correlation_iou,
    resize_width, target_fps, show_helmets, show_bare,
) -> None:
    cap = cv2.VideoCapture(video_source)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, resize_width)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not cap.isOpened():
        src = f"webcam {video_source}" if isinstance(video_source, int) else str(video_source)
        st.error(f"Cannot open **{src}**. Use **Live Camera (WebRTC)** on Streamlit Cloud.")
        return

    frame_ph  = st.empty()
    alert_ph  = st.empty()
    c1, c2, c3, c4 = st.columns(4)
    stop_btn  = st.sidebar.button("Stop", key="stop_stream")

    while cap.isOpened() and st.session_state.get("run_detector", True):
        grabbed, frame = cap.read()
        if not grabbed:
            st.warning("Stream ended."); break
        if frame.shape[1] != resize_width:
            scale = resize_width / frame.shape[1]
            frame = cv2.resize(frame, (resize_width, int(frame.shape[0] * scale)))

        t0  = time.perf_counter()
        pil = Image.fromarray(frame[:, :, ::-1])  # BGR→RGB
        people, helmets, bare, stats, alerts = process_frame(
            frame[:, :, ::-1], model, tracker, alert_manager,
            device=device, conf=conf_th, iou=nms_iou, correlation_iou=correlation_iou,
        )
        stats.fps = 1.0 / max(time.perf_counter() - t0, 1e-6)

        annotated = draw_analytics_pil(pil, people, helmets, bare, stats,
                                       show_helmets=show_helmets, show_bare=show_bare)
        frame_ph.image(annotated, use_container_width=True)
        c1.metric("People", stats.total_people)
        c2.metric("With Helmet", stats.with_helmet)
        c3.metric("No Helmet", stats.without_helmet)
        c4.metric("FPS", f"{stats.fps:.1f}")
        alert_ph.error("\n".join(alerts)) if alerts else alert_ph.empty()

        if stop_btn:
            st.session_state["run_detector"] = False; break
        delay = max(0.0, 1.0 / target_fps - (time.perf_counter() - t0))
        if delay:
            time.sleep(delay)

    cap.release()


# ── main ──────────────────────────────────────────────────────────────────────
def main_loop() -> None:
    st.title("CCTV Helmet Detector")
    st.caption("YOLOv11 · real-time WebRTC inference")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    st.sidebar.markdown(f"**Compute:** {device.upper()}")

    weights_path     = st.sidebar.text_input("YOLOv11 weights", DEFAULT_WEIGHTS)
    conf_th          = st.sidebar.slider("Confidence",       0.1, 0.95, 0.4, 0.05)
    nms_iou          = st.sidebar.slider("NMS IoU",          0.1, 0.95, 0.5, 0.05)
    correlation_iou  = st.sidebar.slider("Helmet corr. IoU", 0.1, 0.90, 0.3, 0.05)
    resize_width     = st.sidebar.slider("Inference width",  320, 1280, 640, 40)
    target_fps       = st.sidebar.slider("FPS cap (RTSP)",   5,   30,   15,  5)
    show_helmets     = st.sidebar.checkbox("Show helmet boxes",    value=True)
    show_bare        = st.sidebar.checkbox("Show no-helmet boxes", value=True)

    source_opts = ["Live Camera (WebRTC)"]
    if _CV2_OK:
        source_opts += ["Webcam 0 (local)", "Webcam 1 (local)",
                        "RTSP/HTTP URL",    "Video file"]
    source = st.sidebar.selectbox("Source", source_opts)

    # Load model (cached across reruns)
    with st.spinner("Loading YOLOv11…"):
        try:
            model = load_model(weights_path, device)
        except Exception as exc:
            st.error(f"Cannot load weights: {exc}"); st.stop()

    # ── WebRTC path ───────────────────────────────────────────────────────────
    if source == "Live Camera (WebRTC)":
        st.info(
            "Click **START** below to open your camera. "
            "Allow camera access when the browser asks.",
            icon="📷",
        )
        ctx = webrtc_streamer(
            key="helmet-detector",
            video_processor_factory=HelmetDetector,
            rtc_configuration=RTC_CONFIGURATION,
            media_stream_constraints={"video": True, "audio": False},
            async_processing=True,
        )

        if ctx.video_processor:
            # Push current sidebar params into the running processor
            ctx.video_processor.model           = model
            ctx.video_processor.conf_th         = conf_th
            ctx.video_processor.nms_iou         = nms_iou
            ctx.video_processor.correlation_iou = correlation_iou
            ctx.video_processor.show_helmets    = show_helmets
            ctx.video_processor.show_bare       = show_bare

            # Read stats that the recv() thread wrote
            with ctx.video_processor._lock:
                stats  = ctx.video_processor.stats
                alerts = ctx.video_processor.alerts

            c1, c2, c3, c4 = st.columns(4)
            c1.metric("People",       stats.total_people)
            c2.metric("With Helmet",  stats.with_helmet)
            c3.metric("No Helmet",    stats.without_helmet)
            c4.metric("FPS",          f"{stats.fps:.1f}")
            if alerts:
                st.error("\n".join(alerts))
        return

    # ── cv2 paths (local only) ────────────────────────────────────────────────
    if not _CV2_OK:
        st.error("OpenCV not available. Use **Live Camera (WebRTC)** on Streamlit Cloud.")
        return

    run = st.sidebar.checkbox("Run detector", value=False, key="run_detector")
    if not run:
        st.info("Enable **Run detector** to start."); return

    if source == "RTSP/HTTP URL":
        video_source: str | int = st.sidebar.text_input("RTSP or HTTP URL", "rtsp://user:pass@host/stream")
    elif source == "Video file":
        video_source = st.sidebar.text_input("Path to video file", "sample.mp4")
    elif source == "Webcam 0 (local)":
        video_source = 0
    else:
        video_source = 1

    _run_rtsp_loop(
        video_source, model, PersonTracker(), AlertManager(),
        device=device, conf_th=conf_th, nms_iou=nms_iou,
        correlation_iou=correlation_iou, resize_width=resize_width,
        target_fps=target_fps, show_helmets=show_helmets, show_bare=show_bare,
    )


if __name__ == "__main__":
    main_loop()
