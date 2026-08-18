import os
import io
import subprocess
import cv2
import numpy as np
import soundfile as sf
import uvicorn
import gradio as gr
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ZeroGPU space support
try:
    import spaces
except ImportError:
    class spaces:
        @staticmethod
        def GPU(func=None, duration=None):
            if func is None:
                return lambda f: f
            return func

# Import our core machine learning proctor engine
from exam_proctor import ExamProctor

app = FastAPI(title="Proctora AI Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize global engine instance
print("Initializing ExamProctor engine...")
proctor = ExamProctor()

# Ensure temp directory exists for incoming buffers if needed
os.makedirs("temp_uploads", exist_ok=True)

async def _read_image(file_storage: UploadFile) -> np.ndarray:
    """Safely decode an uploaded image to an OpenCV BGR numpy array."""
    img_bytes = await file_storage.read()
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return frame

async def _read_audio(file_storage: UploadFile) -> np.ndarray:
    """Safely decode an uploaded audio file (WAV/WebM/OGG) to a 16kHz float32 numpy array."""
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

# ─────────────────────────────────────────────────────────────────────────────
# ZeroGPU accelerated inference helpers
# ─────────────────────────────────────────────────────────────────────────────

@spaces.GPU
def run_frame_analysis(frame: np.ndarray) -> dict:
    analysis = {
        "contraband_detected": None,
        "multiple_persons": False,
        "gaze_away": False,
        "mouth_movement": False,
        "absent": False
    }

    # 1. Contraband Check (YOLOv8)
    analysis["contraband_detected"] = proctor._detect_contraband(frame)

    # 2. Persons / Gaze / Mouth (MediaPipe)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_stats = proctor._analyze_mediapipe(rgb)
    
    analysis["face_count"] = mp_stats.get("face_count", 0)
    analysis["head_pose"] = mp_stats.get("head_pose", {"yaw": 0.0, "pitch": 0.0, "roll": 0.0})

    if mp_stats["face_count"] == 0:
        analysis["absent"] = True
        analysis["gaze_away"] = False
    elif mp_stats["face_count"] > 1:
        analysis["multiple_persons"] = True
        analysis["gaze_away"] = False
    else:
        analysis["gaze_away"] = mp_stats["gaze_away"]
        analysis["gaze_desk"] = mp_stats.get("gaze_desk", False)
        analysis["mouth_movement"] = mp_stats["mouth_open"]

    return analysis

@spaces.GPU
def run_secondary_analysis(frame: np.ndarray) -> dict:
    return proctor._analyze_secondary_workspace(frame)

@spaces.GPU
def run_extract_vectors(frame: np.ndarray, audio: np.ndarray, strict: bool = False):
    face_vec = proctor.extract_face_vec(frame, strict=strict)
    voice_vec = proctor.extract_voice_vec(audio)
    return face_vec, voice_vec


# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "message": "Proctoring AI service is actively running."}

@app.post("/enroll")
async def enroll(user_id: str = Form(...), face_image: UploadFile = File(...), voice_audio: UploadFile = File(...)):
    try:
        frame = await _read_image(face_image)
        audio = await _read_audio(voice_audio)

        if frame is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "Failed to decode image frame."})
        if audio is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "Failed to decode audio stream."})

        # Extract embeddings with ZeroGPU acceleration
        face_vec, voice_vec = run_extract_vectors(frame, audio, strict=False)

        if face_vec is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "No face detected. Please ensure your face is well-lit and facing the camera."})
        if voice_vec is None:
            return JSONResponse(status_code=400, content={"status": "failed", "error": "Voice sample could not be encoded. Please speak clearly into your microphone."})

        success = proctor.register_with_vectors(user_id, face_vec, voice_vec)
        if success:
            return {"status": "success", "user_id": user_id, "message": "User enrolled successfully."}
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
    Stateless endpoint to analyze a single frame for behaviors (Gaze, Mouth, Contraband)
    so the frontend can process video in chunks.
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
    contraband (phones, books, additional devices), and multiple persons.
    """
    try:
        frame = await _read_image(image)
        if frame is None:
            return JSONResponse(status_code=400, content={"error": "Invalid image."})

        return run_secondary_analysis(frame)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

# ─────────────────────────────────────────────────────────────────────────────
# Gradio Dashboard UI (for Hugging Face Spaces compatibility)
# ─────────────────────────────────────────────────────────────────────────────

with gr.Blocks(title="Proctora AI Engine") as demo:
    gr.Markdown("# 👁️ Proctora Multi-Modal AI Engine")
    gr.Markdown("✅ **Status:** Engine is online and actively serving REST endpoints.")
    with gr.Accordion("Registered API Endpoints", open=True):
        gr.Markdown("""
        - `POST /enroll` — Biometric enrollment (face image + voice audio)
        - `POST /verify` — Biometric identity verification
        - `POST /analyze_frame` — Primary webcam stream analysis (gaze, head pose, contraband)
        - `POST /analyze_secondary_frame` — Desk/phone camera workspace integrity analysis
        - `GET /health` — Service healthcheck
        """)

# Mount the Gradio dashboard at root `/` while keeping all FastAPI routes accessible
app = gr.mount_gradio_app(app, demo, path="/")

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
