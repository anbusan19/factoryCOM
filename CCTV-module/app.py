import os
import time
from dataclasses import dataclass
from typing import Dict, List, Sequence

import cv2
import numpy as np
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
        self.tracks: Dict[int, Dict[str, Sequence[float]]] = {}
        self.next_id = 1

    def update(self, detections: List[Dict]) -> List[Dict]:
        assignments: List[Dict] = []
        assigned_track_ids = set()

        for det in detections:
            bbox = det["bbox"]
            best_iou = 0.0
            best_track_id = None

            for track_id, track in self.tracks.items():
                iou = compute_iou(bbox, track["bbox"])
                if iou > best_iou:
                    best_iou = iou
                    best_track_id = track_id

            if best_iou >= self.iou_threshold and best_track_id is not None:
                self.tracks[best_track_id]["bbox"] = bbox
                self.tracks[best_track_id]["age"] = 0
                det_with_track = det.copy()
                det_with_track["track_id"] = best_track_id
                assignments.append(det_with_track)
                assigned_track_ids.add(best_track_id)
            else:
                track_id = self.next_id
                self.next_id += 1
                self.tracks[track_id] = {"bbox": bbox, "age": 0}
                det_with_track = det.copy()
                det_with_track["track_id"] = track_id
                assignments.append(det_with_track)
                assigned_track_ids.add(track_id)

        for track_id in list(self.tracks.keys()):
            if track_id not in assigned_track_ids:
                self.tracks[track_id]["age"] = self.tracks[track_id].get("age", 0) + 1
                if self.tracks[track_id]["age"] > self.max_age:
                    self.tracks.pop(track_id, None)

        return assignments


class AlertManager:
    def __init__(self, threshold: int = ALERT_STREAK_FRAMES) -> None:
        self.threshold = threshold
        self.state: Dict[int, Dict[str, int]] = {}

    def update(self, track_id: int, violation: bool) -> bool:
        record = self.state.setdefault(track_id, {"streak": 0, "alerted": False})

        if violation:
            record["streak"] += 1
        else:
            record["streak"] = 0
            record["alerted"] = False

        if violation and record["streak"] >= self.threshold and not record["alerted"]:
            record["alerted"] = True
            return True
        return False

    def prune(self, active_ids: Sequence[int]) -> None:
        active_set = set(active_ids)
        for track_id in list(self.state.keys()):
            if track_id not in active_set:
                self.state.pop(track_id, None)


def compute_iou(box_a: Sequence[float], box_b: Sequence[float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_area = max(0.0, inter_x2 - inter_x1) * max(0.0, inter_y2 - inter_y1)

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    denom = area_a + area_b - inter_area

    return inter_area / denom if denom > 0 else 0.0


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
        tracker.update([])
        alert_manager.prune([])
        return people_summary, helmet_detections, bare_detections, stats, alerts

    names = result.names or model.names
    xyxy = boxes.xyxy.cpu().numpy()
    classes = boxes.cls.int().cpu().tolist()
    scores = boxes.conf.cpu().tolist()

    person_detections: List[Dict] = []

    for box, cls_id, score in zip(xyxy, classes, scores):
        label = names.get(int(cls_id), str(cls_id)) if isinstance(names, dict) else names[int(cls_id)]
        if label not in TARGET_CLASSES:
            continue

        det = {"bbox": box.tolist(), "conf": float(score), "label": label}
        if label == "person":
            person_detections.append(det)
        elif label == "helmet":
            helmet_detections.append(det)
        elif label == "no-helmet":
            bare_detections.append(det)

    tracked_people = tracker.update(person_detections)
    active_ids = [det["track_id"] for det in tracked_people]
    alert_manager.prune(active_ids)

    for det in tracked_people:
        bbox = det["bbox"]
        helmet_overlap = max((compute_iou(bbox, helm["bbox"]) for helm in helmet_detections), default=0.0)
        bare_overlap = max((compute_iou(bbox, bare["bbox"]) for bare in bare_detections), default=0.0)

        if helmet_overlap >= correlation_iou:
            state = "with_helmet"
        elif bare_overlap >= correlation_iou:
            state = "without_helmet"
        else:
            state = "without_helmet"

        violation = state == "without_helmet"
        triggered = alert_manager.update(det["track_id"], violation)

        det_summary = {
            "track_id": det["track_id"],
            "bbox": bbox,
            "conf": det["conf"],
            "state": state,
            "alert": triggered,
            "overlap": max(helmet_overlap, bare_overlap),
        }
        people_summary.append(det_summary)

        if triggered:
            alerts.append(f"ALERT: Person #{det['track_id']} without helmet for {ALERT_STREAK_FRAMES}+ frames")

    stats.total_people = len(people_summary)
    stats.with_helmet = sum(1 for det in people_summary if det["state"] == "with_helmet")
    stats.without_helmet = stats.total_people - stats.with_helmet

    return people_summary, helmet_detections, bare_detections, stats, alerts


def draw_analytics(
    frame: np.ndarray,
    people: List[Dict],
    helmets: List[Dict],
    bare: List[Dict],
    stats: FrameStats,
    *,
    show_helmets: bool,
    show_bare: bool,
) -> np.ndarray:
    annotated = frame.copy()

    def _draw_box(bbox, color, label):
        x1, y1, x2, y2 = map(int, bbox)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 1)
        cv2.putText(annotated, label, (x1, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA)

    if show_helmets:
        for helmet in helmets:
            _draw_box(helmet["bbox"], (0, 180, 255), f"Helmet {helmet['conf']:.2f}")

    if show_bare:
        for bare_det in bare:
            _draw_box(bare_det["bbox"], (255, 0, 0), f"NoHelmet {bare_det['conf']:.2f}")

    for person in people:
        color = (0, 200, 0) if person["state"] == "with_helmet" else (0, 0, 255)
        thickness = 3 if person.get("alert") else 2
        label = f"ID {person['track_id']} | {'Helmet' if person['state']=='with_helmet' else 'No Helmet'}"
        x1, y1, x2, y2 = map(int, person["bbox"])
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness)
        cv2.putText(
            annotated,
            f"{label} ({person['conf']:.2f})",
            (x1, max(20, y1 - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            2 if person.get("alert") else 1,
            cv2.LINE_AA,
        )
        if person.get("alert"):
            cv2.putText(
                annotated,
                "ALERT",
                (x1, y2 + 20),
                cv2.FONT_HERSHEY_DUPLEX,
                0.6,
                (0, 0, 255),
                2,
                cv2.LINE_AA,
            )

    overlay = annotated.copy()
    cv2.rectangle(overlay, (10, 10), (280, 120), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.35, annotated, 0.65, 0, annotated)

    cv2.putText(annotated, f"Total: {stats.total_people}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.putText(annotated, f"Helmet: {stats.with_helmet}", (20, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    cv2.putText(annotated, f"No Helmet: {stats.without_helmet}", (20, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    if stats.fps:
        cv2.putText(annotated, f"FPS: {stats.fps:.1f}", (20, 125), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

    return annotated


def main_loop() -> None:
    st.title("CCTV Helmet Detector")
    st.caption("YOLOv11 (Ultralytics) + Streamlit dashboard")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    st.sidebar.markdown(f"**Compute device:** {device.upper()}")

    weights_path = st.sidebar.text_input("YOLOv11 weights", DEFAULT_WEIGHTS)
    conf_th = st.sidebar.slider("Confidence threshold", 0.1, 0.95, 0.4, 0.05)
    nms_iou = st.sidebar.slider("NMS IoU", 0.1, 0.95, 0.5, 0.05)
    correlation_iou = st.sidebar.slider("Helmet correlation IoU", 0.1, 0.9, 0.3, 0.05)
    resize_width = st.sidebar.slider("Inference width (px)", 320, 1920, 960, 40)
    target_fps = st.sidebar.slider("Target FPS cap", 10, 60, 30, 5)
    show_helmets = st.sidebar.checkbox("Show helmet boxes", value=True)
    show_bare = st.sidebar.checkbox("Show no-helmet boxes", value=True)

    source_choice = st.sidebar.selectbox(
        "Video source",
        ("RTSP/HTTP URL", "Video file", "Webcam 0", "Webcam 1"),
    )

    if source_choice.startswith("Webcam"):
        video_source: int | str = int(source_choice.split()[-1])
    elif source_choice == "Video file":
        video_source = st.sidebar.text_input("Path to video file", "sample.mp4")
    else:
        video_source = st.sidebar.text_input("RTSP or HTTP URL", "rtsp://user:pass@host/stream")

    run_stream = st.sidebar.checkbox("Run detector", value=False, key="run_detector")
    if not run_stream:
        st.info("Enable **Run detector** in the sidebar to start streaming. Select your video source first.")
        return

    try:
        model = load_model(weights_path, device)
    except Exception as exc:  # pylint: disable=broad-except
        st.error(f"Unable to load YOLOv11 weights: {exc}")
        st.stop()

    tracker = PersonTracker()
    alert_manager = AlertManager()

    try:
        capture = cv2.VideoCapture(video_source)
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, resize_width)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception as exc:
        st.error(f"Failed to open video source: {exc}")
        st.stop()

    if not capture.isOpened():
        src_label = f"webcam {video_source}" if isinstance(video_source, int) else str(video_source)
        st.error(f"Unable to open **{src_label}**. On Streamlit Cloud, webcam access is not supported — use an RTSP/HTTP URL or a video file instead.")
        st.stop()

    frame_placeholder = st.empty()
    alert_placeholder = st.empty()
    total_col, helmet_col, no_helmet_col, fps_col = st.columns(4)
    stop_requested = st.sidebar.button("Stop stream", key="stop_stream")

    while capture.isOpened() and st.session_state.get("run_detector", True):
        grabbed, frame = capture.read()
        if not grabbed:
            st.warning("No frame received from the source. Releasing camera...")
            break

        if frame.shape[1] != resize_width:
            scale = resize_width / frame.shape[1]
            new_height = int(frame.shape[0] * scale)
            frame = cv2.resize(frame, (resize_width, new_height))

        start_time = time.perf_counter()
        (
            people,
            helmets,
            bare,
            stats,
            alerts,
        ) = process_frame(
            frame,
            model,
            tracker,
            alert_manager,
            device=device,
            conf=conf_th,
            iou=nms_iou,
            correlation_iou=correlation_iou,
        )
        frame_time = time.perf_counter() - start_time
        stats.fps = 1.0 / max(frame_time, 1e-6)

        annotated = draw_analytics(
            frame,
            people,
            helmets,
            bare,
            stats,
            show_helmets=show_helmets,
            show_bare=show_bare,
        )

        frame_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
        frame_placeholder.image(frame_rgb, channels="RGB")

        total_col.metric("Total People", stats.total_people)
        helmet_col.metric("With Helmet", stats.with_helmet)
        no_helmet_col.metric("Without Helmet", stats.without_helmet)
        fps_col.metric("FPS", f"{stats.fps:.1f}")

        if alerts:
            alert_placeholder.error("\n".join(alerts))
        else:
            alert_placeholder.empty()

        if stop_requested:
            st.session_state["run_detector"] = False
            break

        delay = max(0.0, (1.0 / target_fps) - frame_time)
        if delay > 0:
            time.sleep(delay)

    capture.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main_loop()

