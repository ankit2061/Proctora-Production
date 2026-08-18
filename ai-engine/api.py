"""
api.py
──────
Standalone In-House FastAPI AI Engine for Proctora.
Runs locally on http://127.0.0.1:5001 with zero cloud dependencies.

Provides:
  • POST /enroll                 - Multi-modal biometric enrollment (Face + Voice)
  • POST /verify                 - Biometric verification against registered embedding
  • POST /analyze_frame          - Real-time Primary Webcam behavioral & contraband analysis
  • POST /analyze_secondary_frame - Real-time Desk / Phone Camera workspace inspection
  • GET  /health                 - AI Engine healthcheck
"""

import os
import io
import subprocess
import cv2
import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Import our core machine learning proctor engine
from exam_proctor import ExamProctor

app = FastAPI(
    title="Proctora In-House AI Engine",
    description="Local real-time computer vision and biometric analysis engine",
    version="2.0.0"
)

# Enable CORS for local and network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize local engine instance
print("🧠 [AI Engine] Initializing ExamProctor (MediaPipe + YOLOv8 + DeepFace + ECAPA-TDNN)...")
proctor = ExamProctor()
print("✅ [AI Engine] ExamProctor initialized successfully!")

# Ensure temp directory exists for incoming buffers if needed
os.makedirs("temp_uploads", exist_ok=True)

async def _read_image(file_storage: UploadFile) -> np.ndarray:
    """Safely decode an uploaded image to an OpenCV BGR numpy array."""
    try:
        img_bytes = await file_storage.read()
        if not img_bytes:
            return None
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        return frame
    except Exception as e:
        print(f"Error decoding image: {e}")
        return None

async def _read_audio(file_storage: UploadFile) -> np.ndarray:
    """Safely decode an uploaded audio file (WAV/WebM/OGG) to a 16kHz float32 numpy array."""
    try:
        raw_bytes = await file_storage.read()
        if not raw_bytes:
            return None

        # 1. Try direct soundfile read
        try:
            data, samplerate = sf.read(io.BytesIO(raw_bytes))
            if len(data.shape) > 1:
                data = np.mean(data, axis=1)
            # Resample if not 16kHz
            if samplerate != 16000:
                import scipy.signal
                num_samples = int(len(data) * 16000 / samplerate)
                data = scipy.signal.resample(data, num_samples)
            return data.astype(np.float32)
        except Exception:
            pass

        # 2. Fallback to ffmpeg stream conversion to 16kHz mono WAV
        try:
            proc = subprocess.Popen(
                ['ffmpeg', '-i', 'pipe:0', '-f', 'wav', '-ar', '16000', '-ac', '1', 'pipe:1'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL
            )
            out, _ = proc.communicate(input=raw_bytes)
            data, samplerate = sf.read(io.BytesIO(out))
            if len(data.shape) > 1:
                data = np.mean(data, axis=1)
            return data.astype(np.float32)
        except Exception as e:
            print(f"Error decoding audio via ffmpeg: {e}")
            return None
    except Exception as e:
        print(f"Error reading audio file: {e}")
        return None

def run_frame_analysis(frame: np.ndarray) -> dict:
    """Analyze primary webcam frame with local YOLOv8 and MediaPipe."""
    analysis = {
        "contraband_detected": None,
        "multiple_persons": False,
        "gaze_away": False,
        "gaze_desk": False,
        "mouth_movement": False,
        "mouth_covered": False,
        "absent": False,
        "face_count": 0,
        "head_pose": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
    }

    # 1. Contraband Check (YOLOv8)
    try:
        analysis["contraband_detected"] = proctor._detect_contraband(frame)
    except Exception as e:
        print(f"[YOLOv8 Detection Error]: {e}")

    # 2. Persons / Gaze / Mouth / Hands (MediaPipe 3D SolvePnP, Face Mesh & Hands)
    try:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_stats = proctor._analyze_mediapipe(rgb)
        
        face_count = mp_stats.get("face_count", 0)
        analysis["face_count"] = face_count
        analysis["head_pose"] = mp_stats.get("head_pose", {"yaw": 0.0, "pitch": 0.0, "roll": 0.0})
        analysis["mouth_covered"] = mp_stats.get("mouth_covered", False)

        if face_count == 0:
            analysis["absent"] = True
            analysis["gaze_away"] = False
        elif face_count > 1:
            analysis["multiple_persons"] = True
            analysis["gaze_away"] = False
        else:
            analysis["gaze_away"] = mp_stats.get("gaze_away", False)
            analysis["gaze_desk"] = mp_stats.get("gaze_desk", False)
            analysis["mouth_movement"] = mp_stats.get("mouth_open", False)
    except Exception as e:
        print(f"[MediaPipe Analysis Error]: {e}")

    return analysis

def run_secondary_analysis(frame: np.ndarray) -> dict:
    """Analyze secondary desk camera frame for workspace integrity & contraband."""
    try:
        return proctor._analyze_secondary_workspace(frame)
    except Exception as e:
        print(f"[Desk Analysis Error]: {e}")
        return {
            "contraband_detected": None,
            "detected_objects": [],
            "multiple_persons": False
        }

def run_extract_vectors(frame: np.ndarray, audio: np.ndarray, strict: bool = False):
    face_vec = proctor.extract_face_vec(frame, strict=strict)
    voice_vec = proctor.extract_voice_vec(audio)
    return face_vec, voice_vec

# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "proctora-ai-engine",
        "version": "2.0.0",
        "mode": "in-house-local",
        "message": "In-house Python AI Engine is online and operational."
    }

@app.post("/enroll")
async def enroll(user_id: str = Form(...), face_image: UploadFile = File(...), voice_audio: UploadFile = File(...)):
    try:
        frame = await _read_image(face_image)
        audio = await _read_audio(voice_audio)

        if frame is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "Failed to decode image frame."})
        if audio is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "Failed to decode audio stream."})

        # Extract embeddings locally
        face_vec, voice_vec = run_extract_vectors(frame, audio, strict=False)

        if face_vec is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "No face detected. Please ensure your face is well-lit and facing the camera."})
        if voice_vec is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "Voice sample could not be encoded. Please speak clearly into your microphone."})

        success = proctor.register_with_vectors(user_id, face_vec, voice_vec)
        if success:
            return {"status": "success", "user_id": user_id, "message": "User enrolled successfully in local vector store."}
        else:
            return JSONResponse(status_code=500, content={"status": "failed", "error": "Failed to persist biometric embeddings to vector DB."})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/verify")
async def verify(user_id: str = Form(...), face_image: UploadFile = File(...), voice_audio: UploadFile = File(...)):
    try:
        frame = await _read_image(face_image)
        audio = await _read_audio(voice_audio)

        if frame is None or audio is None:
            return JSONResponse(status_code=400, content={"error": "Failed to decode media."})

        face_vec, voice_vec = run_extract_vectors(frame, audio, strict=True)

        if face_vec is None:
            return {
                "status": "ACCESS_DENIED",
                "face_match": False,
                "voice_match": False,
                "error": "No face detected in verification image."
            }

        if voice_vec is None:
            return {
                "status": "ACCESS_DENIED",
                "face_match": False,
                "voice_match": False,
                "error": "No voice audio detected."
            }

        passed, result = proctor.verify_with_vectors(user_id, face_vec, voice_vec)
        return result
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/analyze_frame")
async def analyze_frame(image: UploadFile = File(...)):
    """
    Stateless high-speed endpoint to analyze primary webcam frame for:
    Head pose, gaze angle, mouth movement, face count, and YOLO contraband.
    """
    try:
        frame = await _read_image(image)
        if frame is None:
            return JSONResponse(status_code=400, content={"error": "Invalid image."})

        return run_frame_analysis(frame)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/analyze_secondary_frame")
async def analyze_secondary_frame(image: UploadFile = File(...)):
    """
    Analyzes the secondary desk/phone camera stream for workspace integrity,
    contraband (smartphones, laptops, books), and unauthorized presence.
    """
    try:
        frame = await _read_image(image)
        if frame is None:
            return JSONResponse(status_code=400, content={"error": "Invalid image."})

        return run_secondary_analysis(frame)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"🚀 Starting Proctora In-House AI Server on http://127.0.0.1:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
