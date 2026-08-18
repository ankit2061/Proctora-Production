"""
exam_proctor.py
───────────────
Core proctoring engine for the Multi-Modal Biometric Proctoring System.

Handles:
  • Face embedding via DeepFace (FaceNet)
  • Voice embedding via SpeechBrain (ECAPA-TDNN)
  • Persistent vector storage via ChromaDB
  • Registration, verification, and continuous monitoring

Exposes both CLI-oriented methods and lower-level public methods
for GUI integration.
"""

import os
import time
import json
import logging
import threading
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, Callable, Dict, Any

import sys
import cv2
import numpy as np
try:
    import sounddevice as sd
except (ImportError, OSError, Exception):
    sd = None
import chromadb
import scipy.spatial.distance as dist

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logger = logging.getLogger("ExamProctor")

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
FACE_COSINE_THRESHOLD  = 0.68   # < 0.60 → match (loosened significantly for easy login/testing)
VOICE_COSINE_THRESHOLD = 0.65   # < 0.65 → match
VIOLATION_SCORE_LIMIT  = 3
AUDIO_SAMPLE_RATE      = 16_000
ENROLL_AUDIO_SECONDS   = 5
MONITOR_AUDIO_SECONDS  = 3
MONITOR_HEARTBEAT_SEC  = 10      # seconds between background checks
FACE_CAPTURE_RETRIES   = 5       # seconds
RMS_SILENCE_THRESHOLD  = 0.005
RMS_MONITOR_THRESHOLD  = 0.001   # lower threshold for monitoring (catches quieter audio)

CHROMA_DB_PATH = "./proctor_db"
LOG_FILE       = "proctor_logs.json"

# Detector backends to try, in order of preference
DETECTOR_BACKENDS        = ["opencv", "ssd"]
DETECTOR_BACKENDS_STRICT = ["opencv", "ssd"]   # no skip — used by monitor to require real face

# Model save directory
_SPEAKER_SAVEDIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "pretrained_models", "spkrec-ecapa-voxceleb")
)

# ─────────────────────────────────────────────────────────────────────────────
# Windows symlink patch
# ─────────────────────────────────────────────────────────────────────────────
# SpeechBrain's fetch() calls os.symlink() internally for every model file.
# On Windows without admin/developer-mode, symlinks always fail with
# WinError 1314.  We monkey-patch os.symlink so it falls back to shutil.copy2.
import shutil

_original_symlink = os.symlink

def _safe_symlink(src, dst, *args, **kwargs):
    """Try a real symlink; on failure (Windows non-admin), copy instead."""
    try:
        _original_symlink(src, dst, *args, **kwargs)
    except OSError:
        # dst might already exist from a previous attempt
        if os.path.exists(dst):
            os.remove(dst)
        shutil.copy2(src, dst)

if sys.platform == "win32":
    os.symlink = _safe_symlink

# ─────────────────────────────────────────────────────────────────────────────
# Lazy model loader
# ─────────────────────────────────────────────────────────────────────────────
_speaker_model = None

def _get_speaker_model():
    """Load the ECAPA-TDNN speaker encoder (cached after first call)."""
    global _speaker_model
    if _speaker_model is not None:
        return _speaker_model

    from speechbrain.inference.speaker import EncoderClassifier

    savedir = _SPEAKER_SAVEDIR
    os.makedirs(savedir, exist_ok=True)

    logger.info("Loading SpeechBrain ECAPA-TDNN speaker model…")
    _speaker_model = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=savedir,
        run_opts={"device": "cpu"},
    )

    logger.info("Speaker model loaded ✓")
    return _speaker_model


# ─────────────────────────────────────────────────────────────────────────────
# JSON log helper
# ─────────────────────────────────────────────────────────────────────────────
def _append_log(entry: dict, log_path: str = LOG_FILE):
    entries = []
    if Path(log_path).exists():
        try:
            with open(log_path, "r", encoding="utf-8") as f:
                entries = json.load(f)
        except (json.JSONDecodeError, IOError):
            entries = []
    entries.append(entry)
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)


# ═════════════════════════════════════════════════════════════════════════════
# ExamProctor
# ═════════════════════════════════════════════════════════════════════════════
class ExamProctor:

    def __init__(self, log_file: str = LOG_FILE, db_path: str = CHROMA_DB_PATH):
        self.log_file = log_file
        self._monitor_stop   = threading.Event()
        self._monitor_thread: Optional[threading.Thread] = None

        logger.info(f"Connecting to ChromaDB at '{db_path}'…")
        self._client = chromadb.PersistentClient(path=db_path)
        self._face_col = self._client.get_or_create_collection(
            name="face_embeddings_arcface",
            metadata={"hnsw:space": "cosine"},
        )
        self._voice_col = self._client.get_or_create_collection(
            name="voice_embeddings",
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("ChromaDB collections ready.")

        # MediaPipe Setup for zero-latency face tracking
        import mediapipe as mp
        self.mp = mp
        try:
            if hasattr(mp, 'solutions') and hasattr(mp.solutions, 'face_mesh'):
                self.face_mesh = mp.solutions.face_mesh.FaceMesh(
                    max_num_faces=2,
                    refine_landmarks=True,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                logger.info("MediaPipe FaceMesh (solutions) loaded ✓")
            else:
                self.face_mesh = None
        except Exception as e:
            logger.warning(f"MediaPipe face_mesh error: {e}")
            self.face_mesh = None
        self._haar = None
        self.facemark = None

        try:
            from ultralytics import YOLO
            self.yolo = YOLO("yolov8n.pt")
            logger.info("YOLOv8 Contraband detector loaded ✓")
        except Exception as e:
            logger.error(f"Failed to load YOLOv8: {e}")
            self.yolo = None
            
        # DINOv2 setup
        try:
            import torch
            from torchvision import transforms
            from transformers import logging as hf_logging
            hf_logging.set_verbosity_error()
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.dino = torch.hub.load('facebookresearch/dinov2', 'dinov2_vits14').to(self.device).eval()
            self.dino_transform = transforms.Compose([
                transforms.ToTensor(),
                transforms.Resize((224, 224), antialias=True),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ])
            self.dino_baseline = None
            logger.info("DINOv2 loaded ✓")
        except Exception as e:
            logger.error(f"Failed to load DINOv2: {e}")
            self.dino = None

    # ─── Public: Embedding Extractors ─────────────────────────────────────

    def detect_face_in_frame(self, frame: np.ndarray) -> bool:
        """Quick layout check via MediaPipe: is there at least one face?"""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        res = self.face_mesh.detect(mp_image)
        return len(res.face_landmarks) > 0

    def extract_face_vec(self, frame: np.ndarray, strict: bool = False) -> Optional[np.ndarray]:
        """
        Extract a normalised 128-dim FaceNet embedding from a BGR frame.

        strict=False (default): tries opencv → ssd → skip  (for registration)
        strict=True:            tries opencv → ssd only     (for monitoring —
                                ensures a real face is detected, never falls
                                back to 'skip' which would embed an empty chair)
        """
        from deepface import DeepFace

        backends = DETECTOR_BACKENDS_STRICT if strict else DETECTOR_BACKENDS

        for backend in backends:
            enforce = (backend != "skip")
            try:
                result = DeepFace.represent(
                    img_path=frame,
                    model_name="ArcFace",
                    detector_backend=backend,
                    enforce_detection=enforce,
                )
                if result:
                    vec = np.array(result[0]["embedding"], dtype="float32")
                    vec /= (np.linalg.norm(vec) + 1e-9)
                    logger.info(f"Face embedding OK (detector={backend})")
                    return vec
            except Exception as e:
                logger.debug(f"Detector '{backend}' failed: {e}")
                continue

        logger.warning("All face-embedding backends failed.")
        return None

    def extract_voice_vec(self, audio: np.ndarray) -> Optional[np.ndarray]:
        """
        Extract a normalised ECAPA-TDNN d-vector from 16 kHz float32 audio.
        """
        import torch
        try:
            model  = _get_speaker_model()
            tensor = torch.from_numpy(audio).unsqueeze(0)
            emb    = model.encode_batch(tensor)
            vec    = emb.squeeze().detach().cpu().numpy().astype("float32")
            vec   /= (np.linalg.norm(vec) + 1e-9)
            return vec
        except Exception as e:
            logger.warning(f"Voice embedding failed: {e}")
            return None

    # ─── Public: DB operations ────────────────────────────────────────────

    def is_enrolled(self, user_id: str) -> bool:
        fv, vv = self._retrieve_embeddings(user_id)
        return fv is not None and vv is not None

    def get_enrolled_users(self) -> list:
        """Return a sorted list of enrolled user IDs."""
        results = self._face_col.get(include=["metadatas"])
        if not results["ids"]:
            return []
        return sorted({m["user_id"] for m in results["metadatas"]})

    def register_with_vectors(
        self, user_id: str,
        face_vec: np.ndarray,
        voice_vec: np.ndarray,
    ) -> bool:
        """Store pre-computed embeddings for a user (used by GUI)."""
        try:
            self._store_embeddings(user_id, face_vec, voice_vec)
            _append_log({
                "event": "REGISTRATION", "user_id": user_id,
                "timestamp": datetime.now().isoformat(), "status": "SUCCESS",
            }, self.log_file)
            return True
        except Exception as e:
            logger.error(f"Registration storage failed: {e}")
            return False

    def verify_with_vectors(
        self, user_id: str,
        live_face: np.ndarray,
        live_voice: np.ndarray,
    ) -> Tuple[bool, Dict[str, Any]]:
        """
        Verify a user with pre-computed live embeddings.
        Returns (passed, details_dict).
        """
        ref_face, ref_voice = self._retrieve_embeddings(user_id)
        if ref_face is None or ref_voice is None:
            return False, {"error": "User not enrolled."}

        face_dist  = self._cosine_distance(ref_face, live_face)
        voice_dist = self._cosine_distance(ref_voice, live_voice)
        face_ok    = face_dist < FACE_COSINE_THRESHOLD
        voice_ok   = voice_dist < VOICE_COSINE_THRESHOLD
        passed     = face_ok and voice_ok

        details = {
            "face_cosine_distance":  round(face_dist,  4),
            "voice_cosine_distance": round(voice_dist, 4),
            "face_match":  face_ok,
            "voice_match": voice_ok,
            "status": "ACCESS_GRANTED" if passed else "ACCESS_DENIED",
        }

        _append_log({
            "event": "VERIFICATION", "user_id": user_id,
            "timestamp": datetime.now().isoformat(), **details,
        }, self.log_file)

        return passed, details

    def delete_user(self, user_id: str):
        """Remove a user's embeddings from ChromaDB."""
        try:
            self._face_col.delete(ids=[f"face_{user_id}"])
            self._voice_col.delete(ids=[f"voice_{user_id}"])
        except Exception:
            pass

    # ─── Public: Monitoring ───────────────────────────────────────────────

    def start_monitoring(
        self, user_id: str,
        check_interval: int = 30,
        callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        """
        Launch background monitor thread.
        `callback(result_dict)` is called after each heartbeat — use it
        to update a GUI from the main thread via a queue.
        """
        if self._monitor_thread and self._monitor_thread.is_alive():
            logger.warning("Monitor already running.")
            return

        self._monitor_stop.clear()
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop,
            args=(user_id, check_interval, callback),
            daemon=True,
            name=f"ProctorMonitor-{user_id}",
        )
        self._monitor_thread.start()

    def stop_monitoring(self):
        self._monitor_stop.set()
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)

    @property
    def monitor_running(self) -> bool:
        return (self._monitor_thread is not None
                and self._monitor_thread.is_alive())

    # ─── Private helpers ──────────────────────────────────────────────────

    @staticmethod
    def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
        return float(dist.cosine(a, b))

    def _store_embeddings(self, user_id, face_vec, voice_vec):
        face_id  = f"face_{user_id}"
        voice_id = f"voice_{user_id}"

        def _upsert(col, doc_id, vec):
            existing = col.get(ids=[doc_id])
            if existing["ids"]:
                col.update(
                    ids=[doc_id],
                    embeddings=[vec.tolist()],
                    metadatas=[{"user_id": user_id}],
                )
            else:
                col.add(
                    ids=[doc_id],
                    embeddings=[vec.tolist()],
                    metadatas=[{"user_id": user_id}],
                    documents=[f"Embedding for {user_id}"],
                )

        _upsert(self._face_col,  face_id,  face_vec)
        _upsert(self._voice_col, voice_id, voice_vec)

    def _retrieve_embeddings(self, user_id):
        face_id  = f"face_{user_id}"
        voice_id = f"voice_{user_id}"
        face_res  = self._face_col.get(ids=[face_id],  include=["embeddings"])
        voice_res = self._voice_col.get(ids=[voice_id], include=["embeddings"])

        fv = None
        if face_res["embeddings"] is not None and len(face_res["embeddings"]) > 0:
            fv = np.array(face_res["embeddings"][0], dtype="float32")

        vv = None
        if voice_res["embeddings"] is not None and len(voice_res["embeddings"]) > 0:
            vv = np.array(voice_res["embeddings"][0], dtype="float32")

        return fv, vv

    # ─── Watcher Vision Helpers ───────────────────────────────────────────

    def _analyze_mediapipe(self, rgb_frame) -> dict:
        analysis = {
            "face_count": 0,
            "gaze_away": False,
            "mouth_open": False,
            "head_pose": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
        }
        if self.face_mesh is None:
            return analysis
            
        try:
            h, w, _ = rgb_frame.shape
            results = self.face_mesh.process(rgb_frame)
            if not results or not results.multi_face_landmarks:
                analysis["face_count"] = 0
                return analysis

            # Filter valid faces (reject micro-artifacts/neck reflections)
            valid_faces = []
            for face_lm in results.multi_face_landmarks:
                lm = face_lm.landmark
                fw = abs(lm[454].x - lm[234].x) * w
                fh = abs(lm[152].y - lm[10].y) * h
                if fw >= (0.08 * w) and fh >= (0.08 * h):
                    valid_faces.append(face_lm)

            if len(valid_faces) == 0:
                analysis["face_count"] = 0
                return analysis
                
            analysis["face_count"] = len(valid_faces)
            landmarks = valid_faces[0].landmark
            
            # 1. Mouth Open / Speaking Measurement (Upper: 13, Lower: 14; Left: 61, Right: 291)
            upper_lip = landmarks[13]
            lower_lip = landmarks[14]
            left_mouth = landmarks[61]
            right_mouth = landmarks[291]
            lip_vertical = abs(upper_lip.y - lower_lip.y) * h
            mouth_horizontal = abs(right_mouth.x - left_mouth.x) * w
            mar = lip_vertical / max(mouth_horizontal, 1.0)
            if mar > 0.16:  # Sensitive to natural talking / whispering
                analysis["mouth_open"] = True
                
            # 2. 3D Head Pose Estimation via SolvePnP
            image_points = np.array([
                (landmarks[1].x * w, landmarks[1].y * h),       # Nose tip
                (landmarks[152].x * w, landmarks[152].y * h),   # Chin
                (landmarks[33].x * w, landmarks[33].y * h),     # Left eye left corner
                (landmarks[263].x * w, landmarks[263].y * h),   # Right eye right corner
                (landmarks[61].x * w, landmarks[61].y * h),     # Left mouth corner
                (landmarks[291].x * w, landmarks[291].y * h)    # Right mouth corner
            ], dtype="double")
            
            model_points = np.array([
                (0.0, 0.0, 0.0),             # Nose tip
                (0.0, -330.0, -65.0),        # Chin
                (-225.0, 170.0, -135.0),     # Left eye left corner
                (225.0, 170.0, -135.0),      # Right eye right corner
                (-150.0, -150.0, -125.0),    # Left mouth corner
                (150.0, -150.0, -125.0)      # Right mouth corner
            ])
            
            focal_length = w
            center = (w / 2, h / 2)
            camera_matrix = np.array([
                [focal_length, 0, center[0]],
                [0, focal_length, center[1]],
                [0, 0, 1]
            ], dtype="double")
            dist_coeffs = np.zeros((4, 1))
            
            success, rvec, tvec = cv2.solvePnP(
                model_points, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE
            )
            
            if success:
                rmat, _ = cv2.Rodrigues(rvec)
                angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
                pitch, yaw, roll = angles[0], angles[1], angles[2]
                
                # Normalize Euler pitch around 0° (facing camera)
                norm_pitch = pitch
                if norm_pitch > 90:
                    norm_pitch = 180 - norm_pitch
                elif norm_pitch < -90:
                    norm_pitch = -180 - norm_pitch
                
                analysis["head_pose"] = {
                    "yaw": round(float(yaw), 2),
                    "pitch": round(float(norm_pitch), 2),
                    "roll": round(float(roll), 2)
                }
                
                # Downward desk / scratchpad writing detection (pitch between -8° and -45° with centered yaw)
                if norm_pitch < -8.0 and abs(yaw) <= 22.0:
                    analysis["gaze_desk"] = True
                    analysis["gaze_away"] = False
                elif abs(yaw) > 24.0 or norm_pitch > 22.0 or norm_pitch < -48.0:
                    # Head turned sideways or looking up
                    analysis["gaze_away"] = True

            # 3. Iris Eye Gaze Ratio (only if not already looking at desk)
            try:
                if not analysis.get("gaze_desk") and len(landmarks) > 473:
                    left_iris = landmarks[468]
                    left_inner = landmarks[133]
                    left_outer = landmarks[33]
                    eye_w = abs(left_inner.x - left_outer.x)
                    if eye_w > 0.005:
                        iris_ratio_x = abs(left_iris.x - min(left_inner.x, left_outer.x)) / eye_w
                        if iris_ratio_x < 0.22 or iris_ratio_x > 0.78:
                            analysis["gaze_away"] = True
            except Exception:
                pass

        except Exception as e:
            logger.debug(f"MediaPipe process error: {e}")
            
        return analysis

    def _analyze_secondary_workspace(self, frame) -> dict:
        """
        Analyzes the secondary desk/phone camera feed for contraband (smartphones, laptops, books)
        and validates genuine multiple persons via face detection.
        """
        analysis = {
            "contraband_detected": None,
            "detected_objects": [],
            "multiple_persons": False
        }
        if self.yolo is None:
            return analysis

        try:
            # Calibrated thresholds for desk inspection:
            # 67: cell phone (0.20), 63: laptop (0.30), 65: remote (0.30), 73: book (0.45)
            prohibited_thresholds = {
                67: ("cell phone", 0.20),
                63: ("laptop", 0.30),
                65: ("remote", 0.30),
                73: ("book", 0.45)
            }
            results = self.yolo.predict(frame, verbose=False, conf=0.18)
            if len(results) > 0:
                for box in results[0].boxes:
                    cls_id = int(box.cls[0].item())
                    conf = float(box.conf[0].item())
                    if cls_id in prohibited_thresholds:
                        item_name, min_conf = prohibited_thresholds[cls_id]
                        if conf >= min_conf:
                            if item_name not in analysis["detected_objects"]:
                                analysis["detected_objects"].append(item_name)
                            if analysis["contraband_detected"] is None:
                                analysis["contraband_detected"] = item_name

            # Check multiple persons ONLY via FaceMesh (avoids torso/arm fragmentation false positives)
            if self.face_mesh is not None:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                fm_res = self.face_mesh.process(rgb)
                if fm_res.multi_face_landmarks and len(fm_res.multi_face_landmarks) > 1:
                    h, w, _ = frame.shape
                    valid_faces = 0
                    for face_lm in fm_res.multi_face_landmarks:
                        lm = face_lm.landmark
                        fw = abs(lm[454].x - lm[234].x) * w
                        fh = abs(lm[152].y - lm[10].y) * h
                        if fw >= (0.08 * w) and fh >= (0.08 * h):
                            valid_faces += 1
                    if valid_faces > 1:
                        analysis["multiple_persons"] = True

        except Exception as e:
            logger.debug(f"Secondary workspace analysis error: {e}")

        return analysis

    def _get_dino_embedding(self, frame) -> 'Optional[np.ndarray]':
        import torch
        if getattr(self, 'dino', None) is None: return None
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        tensor = self.dino_transform(rgb).unsqueeze(0).to(self.device)
        with torch.no_grad():
            features = self.dino(tensor)
        return features.cpu().numpy().flatten()

    def _detect_contraband(self, frame) -> Optional[str]:
        """
        Runs YOLOv8 and checks explicitly for prohibited items (cell phone, laptop, book)
        with strict confidence thresholds to prevent false positives from background room objects.
        """
        if self.yolo is None:
            return None
            
        prohibited_thresholds = {
            67: ("cell phone", 0.40),
            63: ("laptop", 0.45),
            73: ("book", 0.50)
        }
        
        results = self.yolo.predict(frame, verbose=False, conf=0.35)
        if len(results) == 0:
            return None
            
        boxes = results[0].boxes
        for box in boxes:
            cls_id = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            if cls_id in prohibited_thresholds:
                name, min_conf = prohibited_thresholds[cls_id]
                if conf >= min_conf:
                    return name
                
        return None

    # ─── Silent capture (used by monitor) ─────────────────────────────────

    def _silent_capture_face(self) -> Optional[np.ndarray]:
        """
        Open webcam, sample multiple frames over a window, check each for face
        presence. Returns the last frame IF a face was found. If no face was
        found in ANY frame during the window → returns the frame (without face)
        so the caller can distinguish 'camera failed' from 'no face in frame'.
        """
        try:
            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                logger.warning("Monitor: cannot open webcam.")
                return None

            # Quick warm-up (8 frames to let auto-exposure settle)
            for _ in range(8):
                cap.read()
            time.sleep(0.3)

            # Sample frames over a 2-second window, checking each for a face
            best_frame = None
            face_found = False
            sample_count = 0
            deadline = time.time() + 2.0

            while time.time() < deadline:
                ret, img = cap.read()
                if ret and img is not None:
                    best_frame = img.copy()
                    sample_count += 1
                    # Check for face presence
                    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    faces = self._haar.detectMultiScale(
                        gray, scaleFactor=1.2, minNeighbors=3, minSize=(60, 60))
                    if len(faces) > 0:
                        face_found = True
                time.sleep(0.1)   # ~10 samples over 2 seconds

            cap.release()
            logger.info(f"Monitor: sampled {sample_count} frames, face_found={face_found}")
            return best_frame   # may be a frame with or without a face

        except Exception as e:
            logger.error(f"Monitor: camera error: {e}")
            return None

    def _silent_capture_audio(self, duration: int, for_monitor: bool = False) -> Optional[np.ndarray]:
        """Record `duration` seconds of 16 kHz mono audio."""
        if sd is None:
            logger.warning("Monitor: sounddevice not available on this system.")
            return None
        try:
            audio = sd.rec(
                frames=duration * AUDIO_SAMPLE_RATE,
                samplerate=AUDIO_SAMPLE_RATE,
                channels=1, dtype="float32",
            )
            sd.wait()
            audio = audio.flatten()
        except Exception as e:
            logger.error(f"Monitor: audio error: {e}")
            return None
        rms = float(np.sqrt(np.mean(audio ** 2)))
        threshold = RMS_MONITOR_THRESHOLD if for_monitor else RMS_SILENCE_THRESHOLD
        if rms < threshold:
            logger.info(f"Monitor: audio RMS={rms:.5f} below threshold {threshold}, skipping voice.")
            return None
        logger.info(f"Monitor: audio RMS={rms:.5f} — proceeding with voice check.")
        return audio

    # ─── Monitor loop ─────────────────────────────────────────────────────

    def _monitor_loop(self, user_id, check_interval, callback=None):
        logger.info(f"Cascaded multi-threaded watchdog started for '{user_id}'.")
        try:
            ref_face, ref_voice = self._retrieve_embeddings(user_id)
        except Exception as e:
            logger.error(f"Monitor error: {e}"); return
        if ref_face is None or ref_voice is None: return

        cap = cv2.VideoCapture(0)
        if not cap.isOpened(): return

        # Zero-latency camera buffer thread
        class CameraBuffer:
            def __init__(self, c, ev):
                self.c = c; self.latest = None; self.ev = ev; self.run = True
                self.t = threading.Thread(target=self._u, daemon=True); self.t.start()
            def _u(self):
                while self.run and not self.ev.is_set():
                    ret, fr = self.c.read()
                    if ret: self.latest = fr.copy()
                    time.sleep(0.01)
        
        cam_buffer = CameraBuffer(cap, self._monitor_stop)
        
        # Warmup and Baseline
        time.sleep(1.0)
        baseline_frame = cam_buffer.latest
        if baseline_frame is not None and getattr(self, 'dino', None) is not None:
            self.dino_baseline = self._get_dino_embedding(baseline_frame)

        violation_score = 0
        check_count = 0
        gaze_away_frames = 0
        mouth_open_frames = 0
        absent_frames = 0
        TARGET_VIOLATION_FRAMES = 6 
        
        last_audio_hb = time.time()
        last_face_hb = time.time()
        last_fast_tick = time.time()
        yolo_check_counter = 0

        def _flag_violation(reason, score_inc=1):
            nonlocal violation_score
            violation_score += score_inc
            logger.warning(f"  WATCHER: {reason}  violations={violation_score}")
            res = {"event": reason, "user_id": user_id, "timestamp": datetime.now().isoformat(), "violation_score": violation_score, "flagged": violation_score >= VIOLATION_SCORE_LIMIT}
            _append_log(res, self.log_file)
            if callback: callback(res)

        # Audio Thread (Slow, Blocking 3s)
        def _audio_worker():
            nonlocal check_count, violation_score
            check_count += 1
            audio = self._silent_capture_audio(MONITOR_AUDIO_SECONDS, for_monitor=True)
            voice_ok = False; voice_dist = None
            if audio is not None:
                vv = self.extract_voice_vec(audio)
                if vv is not None:
                    voice_dist = self._cosine_distance(ref_voice, vv)
                    voice_ok = voice_dist < VOICE_COSINE_THRESHOLD
                    if not voice_ok:
                        _flag_violation("VOICE_MISMATCH")

        # Identity Thread (Runs quickly via ArcFace, off-thread)
        def _face_worker():
            nonlocal violation_score
            frame = cam_buffer.latest
            if frame is None: return
            
            # Layer 2: ArcFace Verify
            fv = self.extract_face_vec(frame, strict=True)
            if fv is not None:
                face_dist = self._cosine_distance(ref_face, fv)
                if face_dist > FACE_COSINE_THRESHOLD:
                    _flag_violation("FACE_MISMATCH (Different Candidate)")
                    
            # Layer 2: DINO Anomaly
            if getattr(self, 'dino_baseline', None) is not None:
                d_curr = self._get_dino_embedding(frame)
                if d_curr is not None:
                    d_dist = self._cosine_distance(self.dino_baseline, d_curr)
                    if d_dist > 0.4: 
                        _flag_violation("DINO_ANOMALY (Room change/objects)")

        while not self._monitor_stop.is_set():
            t_now = time.time()
            frame = cam_buffer.latest
            
            # Fast Layer 1 Loop (~10-15 FPS)
            if frame is not None and t_now - last_fast_tick > 0.08: 
                last_fast_tick = t_now
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_stats = self._analyze_mediapipe(rgb)
                
                if mp_stats["face_count"] == 0:
                    absent_frames += 1
                    gaze_away_frames = 0
                    mouth_open_frames = 0
                    if absent_frames >= TARGET_VIOLATION_FRAMES:
                        _flag_violation("ABSENT_SCREEN")
                        absent_frames = 0
                elif mp_stats["face_count"] > 1:
                    _flag_violation("MULTIPLE_PERSONS")
                    absent_frames = 0
                    time.sleep(1)
                else:
                    absent_frames = 0
                    if mp_stats["gaze_away"]: gaze_away_frames += 1
                    else: gaze_away_frames = 0
                    
                    if mp_stats["mouth_open"]: mouth_open_frames += 1
                    else: mouth_open_frames = 0
                    
                if gaze_away_frames >= TARGET_VIOLATION_FRAMES:
                    _flag_violation("GAZE_AWAY")
                    gaze_away_frames = 0
                    
                if mouth_open_frames >= TARGET_VIOLATION_FRAMES:
                    _flag_violation("MOUTH_MOVEMENT")
                    mouth_open_frames = 0
                    
                # YOLO Check (Throttled Layer 1)
                yolo_check_counter += 1
                if yolo_check_counter % 15 == 0: 
                     item = self._detect_contraband(frame)
                     if item: _flag_violation(f"CONTRABAND ({item})")

            # Fire Face Verify heartbeat very frequently (every 1.5 seconds)
            if t_now - last_face_hb >= 1.5:
                last_face_hb = t_now
                threading.Thread(target=_face_worker, daemon=True).start()

            # Fire Audio heartbeat
            if t_now - last_audio_hb >= check_interval:
                last_audio_hb = t_now
                threading.Thread(target=_audio_worker, daemon=True).start()
                
            if violation_score >= VIOLATION_SCORE_LIMIT:
                _append_log({"event":"FLAG_USER", "user_id":user_id, "timestamp": datetime.now().isoformat(), "reason":f"Score {violation_score}/{VIOLATION_SCORE_LIMIT}"}, self.log_file)
                self._monitor_stop.set()
                
            time.sleep(0.01) # Ultra small sleep for loop idle
            
        cam_buffer.run = False
        cap.release()
        logger.info("Monitor exited cleanly.")

    # ─── CLI-oriented convenience methods (kept for backward compat) ──────

    def register(self, user_id: str) -> bool:
        """CLI enrollment: opens a preview window and records voice."""
        print(f"\n[REGISTER] Starting enrollment for '{user_id}'…")
        print("[REGISTER] Preview window will open — press any key to capture.")

        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("[ERROR] Cannot open webcam."); return False
        for _ in range(5): cap.read()

        frame = None
        while True:
            ret, img = cap.read()
            if not ret: continue
            cv2.imshow("Enroll — press any key", img)
            if cv2.waitKey(1) & 0xFF != 255:
                frame = img.copy(); break
        cap.release(); cv2.destroyAllWindows()

        if frame is None:
            print("[ERROR] No frame captured."); return False

        fv = self.extract_face_vec(frame)
        if fv is None:
            print("[ERROR] Face embedding failed."); return False
        print("[REGISTER] ✓ Face captured.")

        print(f"[REGISTER] Recording {ENROLL_AUDIO_SECONDS}s voice — speak now…")
        audio = self._silent_capture_audio(ENROLL_AUDIO_SECONDS)
        if audio is None:
            print("[ERROR] Voice capture failed / silent."); return False

        vv = self.extract_voice_vec(audio)
        if vv is None:
            print("[ERROR] Voice embedding failed."); return False
        print("[REGISTER] ✓ Voice captured.")

        return self.register_with_vectors(user_id, fv, vv)

    def verify(self, user_id: str) -> Tuple[bool, str]:
        """CLI verification: silent capture, no preview."""
        if not self.is_enrolled(user_id):
            return False, f"'{user_id}' is not enrolled."

        frame = self._silent_capture_face()
        if frame is None:
            return False, "No face detected."
        fv = self.extract_face_vec(frame)
        if fv is None:
            return False, "Face embedding failed."

        print(f"[VERIFY] Recording {ENROLL_AUDIO_SECONDS}s voice — speak now…")
        audio = self._silent_capture_audio(ENROLL_AUDIO_SECONDS)
        if audio is None:
            return False, "Voice capture failed / silent."
        vv = self.extract_voice_vec(audio)
        if vv is None:
            return False, "Voice embedding failed."

        ok, details = self.verify_with_vectors(user_id, fv, vv)
        msg = details.get("status", "UNKNOWN")
        return ok, msg
