"""
ANPR + Parking Violation Detection Pipeline
============================================
Vehicle detection (YOLOv8) → License plate crop → OCR (EasyOCR) → Violation check

Usage:
    from anpr import ANPRPipeline
    pipeline = ANPRPipeline()
    results = pipeline.process_image("photo.jpg")
    results = pipeline.process_video("clip.mp4", sample_fps=2)
"""

import re
import time
from pathlib import Path
from dataclasses import dataclass, field, asdict

import cv2
import numpy as np
from PIL import Image


@dataclass
class PlateReading:
    text: str
    confidence: float
    raw_texts: list[str] = field(default_factory=list)


@dataclass
class Detection:
    vehicle_bbox: list[int]        # [x1, y1, x2, y2]
    vehicle_type: str              # car, motorcycle, bus, truck, auto
    vehicle_confidence: float
    plate_bbox: list[int] | None   # [x1, y1, x2, y2] relative to full image
    plate_reading: PlateReading | None
    is_parked: bool
    in_violation_zone: bool
    violation_confidence: float
    frame_index: int

    def to_dict(self):
        d = asdict(self)
        return d


@dataclass
class PipelineResult:
    image_path: str
    processing_time_ms: float
    detections: list[Detection]
    frame_count: int = 1

    def to_dict(self):
        return {
            "image_path": self.image_path,
            "processing_time_ms": self.processing_time_ms,
            "frame_count": self.frame_count,
            "total_vehicles": len(self.detections),
            "plates_read": sum(1 for d in self.detections if d.plate_reading and d.plate_reading.text != ""),
            "violations": sum(1 for d in self.detections if d.in_violation_zone),
            "detections": [d.to_dict() for d in self.detections],
        }


# Indian license plate regex patterns
INDIAN_PLATE_PATTERNS = [
    # Standard: KA01AB1234
    re.compile(r'[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{1,4}'),
    # Older: KA-01-AB-1234
    re.compile(r'[A-Z]{2}[-\s]*\d{1,2}[-\s]*[A-Z]{1,3}[-\s]*\d{1,4}'),
    # Partial: at least state code + numbers
    re.compile(r'[A-Z]{2}\s*\d{2,}'),
]

# YOLO class IDs for vehicles (COCO dataset)
VEHICLE_CLASSES = {2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
# We also detect "auto-rickshaw" if available in custom model, else map from car


def clean_plate_text(raw: str) -> str:
    """Clean OCR output to extract Indian plate number."""
    # Remove common OCR noise
    text = raw.upper().strip()
    text = text.replace('O', '0').replace('I', '1').replace('S', '5')
    text = text.replace('|', '1').replace('/', '1').replace('\\', '1')
    text = re.sub(r'[^A-Z0-9\s-]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()

    # Try to match Indian plate pattern
    for pattern in INDIAN_PLATE_PATTERNS:
        match = pattern.search(text)
        if match:
            plate = match.group(0)
            # Normalize: remove spaces and dashes
            plate = re.sub(r'[-\s]', '', plate)
            return plate

    # Return cleaned text even if no pattern match
    return re.sub(r'[-\s]', '', text)


class ANPRPipeline:
    def __init__(self, device: str = "cpu"):
        """
        Initialize the ANPR pipeline.
        Downloads YOLOv8n on first run (~6MB).
        Downloads EasyOCR English model on first run (~100MB).
        """
        print("[ANPR] Loading YOLOv8 model...")
        from ultralytics import YOLO
        self.yolo = YOLO("yolov8n.pt")
        self.device = device

        print("[ANPR] Loading EasyOCR engine...")
        import easyocr
        self.reader = easyocr.Reader(['en'], gpu=(device != "cpu"), verbose=False)

        self.prev_frame_boxes: list[list[int]] = []
        print("[ANPR] Pipeline ready.")

    def _detect_vehicles(self, frame: np.ndarray) -> list[dict]:
        """Run YOLOv8 on a frame, return vehicle detections."""
        results = self.yolo(frame, verbose=False, device=self.device)
        vehicles = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                if cls_id in VEHICLE_CLASSES:
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    vehicles.append({
                        "bbox": [x1, y1, x2, y2],
                        "type": VEHICLE_CLASSES[cls_id],
                        "confidence": float(box.conf[0]),
                    })
        return vehicles

    def _crop_plate_region(self, frame: np.ndarray, vehicle_bbox: list[int]) -> np.ndarray | None:
        """
        Crop the likely license plate region from a vehicle bounding box.
        For Indian vehicles, plates are typically in the bottom 35% of the vehicle bbox.
        """
        x1, y1, x2, y2 = vehicle_bbox
        h = y2 - y1
        w = x2 - x1

        if h < 30 or w < 40:
            return None

        # Bottom portion of vehicle (plate area)
        plate_y1 = y1 + int(h * 0.55)
        plate_y2 = y2
        # Slight horizontal margin
        plate_x1 = x1 + int(w * 0.1)
        plate_x2 = x2 - int(w * 0.1)

        crop = frame[plate_y1:plate_y2, plate_x1:plate_x2]
        if crop.size == 0:
            return None

        return crop

    def _preprocess_plate(self, plate_img: np.ndarray) -> np.ndarray:
        """Preprocess plate crop for better OCR accuracy."""
        # Resize to standard height
        h, w = plate_img.shape[:2]
        target_h = 80
        scale = target_h / h
        plate_img = cv2.resize(plate_img, (int(w * scale), target_h))

        # Convert to grayscale
        gray = cv2.cvtColor(plate_img, cv2.COLOR_BGR2GRAY)

        # Apply CLAHE for contrast enhancement
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # Slight blur to reduce noise
        enhanced = cv2.GaussianBlur(enhanced, (3, 3), 0)

        # Threshold
        _, thresh = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        return thresh

    def _read_plate(self, plate_img: np.ndarray) -> PlateReading:
        """Run OCR on a plate crop."""
        # Try on preprocessed version
        preprocessed = self._preprocess_plate(plate_img)

        raw_results = self.reader.readtext(preprocessed, detail=1)
        if not raw_results:
            # Fallback: try on original color image
            raw_results = self.reader.readtext(plate_img, detail=1)

        if not raw_results:
            return PlateReading(text="", confidence=0.0, raw_texts=[])

        raw_texts = [r[1] for r in raw_results]
        confidences = [r[2] for r in raw_results]

        # Concatenate all text segments
        combined = " ".join(raw_texts)
        cleaned = clean_plate_text(combined)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        return PlateReading(
            text=cleaned,
            confidence=round(avg_conf * 100, 1),
            raw_texts=raw_texts,
        )

    def _check_parked(self, bbox: list[int], frame_idx: int) -> bool:
        """
        Simple parked vehicle heuristic:
        If bounding box overlaps significantly with previous frame → stationary → parked.
        """
        if not self.prev_frame_boxes:
            return False

        x1, y1, x2, y2 = bbox
        for prev in self.prev_frame_boxes:
            px1, py1, px2, py2 = prev
            # IoU calculation
            ix1 = max(x1, px1)
            iy1 = max(y1, py1)
            ix2 = min(x2, px2)
            iy2 = min(y2, py2)
            if ix1 >= ix2 or iy1 >= iy2:
                continue
            inter = (ix2 - ix1) * (iy2 - iy1)
            area1 = (x2 - x1) * (y2 - y1)
            area2 = (px2 - px1) * (py2 - py1)
            iou = inter / (area1 + area2 - inter)
            if iou > 0.5:
                return True
        return False

    def _check_violation_zone(
        self,
        bbox: list[int],
        frame_shape: tuple,
        zones: list[list[list[float]]] | None = None,
    ) -> tuple[bool, float]:
        """
        Check if vehicle center falls in a no-parking zone polygon.
        If no zones provided, uses a heuristic: vehicles parked on road edges
        (left/right 20% of frame) are flagged as potential violations.
        """
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        h, w = frame_shape[:2]

        if zones:
            # Point-in-polygon for each zone
            from shapely.geometry import Point, Polygon
            point = Point(cx / w, cy / h)  # normalized
            for zone_pts in zones:
                poly = Polygon(zone_pts)
                if poly.contains(point):
                    return True, 0.85
            return False, 0.0

        # Heuristic: vehicle near road edges or bottom of frame
        edge_ratio = min(cx / w, 1 - cx / w)
        if edge_ratio < 0.15:
            return True, 0.6
        return False, 0.0

    def process_image(
        self,
        image_path: str,
        violation_zones: list[list[list[float]]] | None = None,
    ) -> PipelineResult:
        """
        Process a single image through the full pipeline.

        Args:
            image_path: Path to image file
            violation_zones: Optional list of polygon zones [[x,y], ...] in normalized coords (0-1)

        Returns:
            PipelineResult with all detections
        """
        t0 = time.time()

        frame = cv2.imread(image_path)
        if frame is None:
            return PipelineResult(image_path=image_path, processing_time_ms=0, detections=[])

        vehicles = self._detect_vehicles(frame)
        detections = []

        for v in vehicles:
            # Plate detection + OCR
            plate_crop = self._crop_plate_region(frame, v["bbox"])
            plate_reading = None
            plate_bbox = None

            if plate_crop is not None:
                plate_reading = self._read_plate(plate_crop)
                # Approximate plate bbox (bottom portion of vehicle)
                vx1, vy1, vx2, vy2 = v["bbox"]
                vh = vy2 - vy1
                vw = vx2 - vx1
                plate_bbox = [
                    vx1 + int(vw * 0.1),
                    vy1 + int(vh * 0.55),
                    vx2 - int(vw * 0.1),
                    vy2,
                ]

            # Violation check
            in_zone, zone_conf = self._check_violation_zone(v["bbox"], frame.shape, violation_zones)

            detections.append(Detection(
                vehicle_bbox=v["bbox"],
                vehicle_type=v["type"],
                vehicle_confidence=round(v["confidence"] * 100, 1),
                plate_bbox=plate_bbox,
                plate_reading=plate_reading,
                is_parked=False,  # Can't determine from single image
                in_violation_zone=in_zone,
                violation_confidence=round(zone_conf * 100, 1),
                frame_index=0,
            ))

        elapsed = (time.time() - t0) * 1000
        return PipelineResult(
            image_path=image_path,
            processing_time_ms=round(elapsed, 1),
            detections=detections,
        )

    def process_video(
        self,
        video_path: str,
        sample_fps: float = 2.0,
        max_frames: int = 100,
        violation_zones: list[list[list[float]]] | None = None,
    ) -> PipelineResult:
        """
        Process a video file frame-by-frame.

        Args:
            video_path: Path to video file
            sample_fps: Process this many frames per second (skip the rest)
            max_frames: Maximum frames to process
            violation_zones: Optional no-parking zone polygons

        Returns:
            PipelineResult with detections across all sampled frames
        """
        t0 = time.time()
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return PipelineResult(image_path=video_path, processing_time_ms=0, detections=[])

        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_interval = max(1, int(video_fps / sample_fps))
        all_detections = []
        frame_idx = 0
        processed = 0

        while processed < max_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_interval == 0:
                vehicles = self._detect_vehicles(frame)
                current_boxes = [v["bbox"] for v in vehicles]

                for v in vehicles:
                    plate_crop = self._crop_plate_region(frame, v["bbox"])
                    plate_reading = None
                    plate_bbox = None

                    if plate_crop is not None:
                        plate_reading = self._read_plate(plate_crop)
                        vx1, vy1, vx2, vy2 = v["bbox"]
                        vh = vy2 - vy1
                        vw = vx2 - vx1
                        plate_bbox = [
                            vx1 + int(vw * 0.1),
                            vy1 + int(vh * 0.55),
                            vx2 - int(vw * 0.1),
                            vy2,
                        ]

                    is_parked = self._check_parked(v["bbox"], frame_idx)
                    in_zone, zone_conf = self._check_violation_zone(
                        v["bbox"], frame.shape, violation_zones
                    )

                    all_detections.append(Detection(
                        vehicle_bbox=v["bbox"],
                        vehicle_type=v["type"],
                        vehicle_confidence=round(v["confidence"] * 100, 1),
                        plate_bbox=plate_bbox,
                        plate_reading=plate_reading,
                        is_parked=is_parked,
                        in_violation_zone=in_zone and is_parked,
                        violation_confidence=round(zone_conf * 100, 1) if is_parked else 0,
                        frame_index=frame_idx,
                    ))

                self.prev_frame_boxes = current_boxes
                processed += 1

            frame_idx += 1

        cap.release()
        elapsed = (time.time() - t0) * 1000

        return PipelineResult(
            image_path=video_path,
            processing_time_ms=round(elapsed, 1),
            detections=all_detections,
            frame_count=processed,
        )


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Usage: python anpr.py <image_or_video_path>")
        sys.exit(1)

    path = sys.argv[1]
    pipeline = ANPRPipeline()

    ext = Path(path).suffix.lower()
    if ext in ('.mp4', '.avi', '.mov', '.mkv', '.webm'):
        print(f"Processing video: {path}")
        result = pipeline.process_video(path, sample_fps=2)
    else:
        print(f"Processing image: {path}")
        result = pipeline.process_image(path)

    print(json.dumps(result.to_dict(), indent=2))
