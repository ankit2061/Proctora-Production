import os
import io
import subprocess
import cv2
import numpy as np
import soundfile as sf
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

# Import our core machine learning proctor engine
from exam_proctor import ExamProctor

app = Flask(__name__)
CORS(app)

# Initialize global engine instance
print("Initializing ExamProctor engine...")
proctor = ExamProctor()

# Ensure temp directory exists for incoming buffers if needed
os.makedirs("temp_uploads", exist_ok=True)

def _read_image(file_storage) -> np.ndarray:
    """Safely decode an uploaded image to an OpenCV BGR numpy array."""
    img_bytes = file_storage.read()
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return frame

def _read_audio(file_storage) -> np.ndarray:
    """Safely decode an uploaded audio file (WAV/WebM/OGG) to a 16kHz float32 numpy array."""
    raw_bytes = file_storage.read()
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

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "Proctoring AI service is actively running."})

@app.route("/enroll", methods=["POST"])
def enroll():
    if "face_image" not in request.files or "voice_audio" not in request.files:
        return jsonify({"error": "Missing 'face_image' or 'voice_audio' files."}), 400
        
    user_id = request.form.get("user_id")
    if not user_id:
        return jsonify({"error": "Missing 'user_id' form field."}), 400

    try:
        frame = _read_image(request.files["face_image"])
        audio = _read_audio(request.files["voice_audio"])

        if frame is None:
            return jsonify({"status": "failed", "error": "Failed to decode image frame."}), 400
        if audio is None:
            return jsonify({"status": "failed", "error": "Failed to decode audio stream."}), 400

        # Extract embeddings
        face_vec = proctor.extract_face_vec(frame)
        voice_vec = proctor.extract_voice_vec(audio)

        if face_vec is None:
            return jsonify({"status": "failed", "error": "No face detected. Please ensure your face is well-lit and facing the camera."}), 400
        if voice_vec is None:
            return jsonify({"status": "failed", "error": "Voice sample could not be encoded. Please speak clearly into your microphone."}), 400

        success = proctor.register_with_vectors(user_id, face_vec, voice_vec)
        if success:
            return jsonify({"status": "success", "user_id": user_id, "message": "User enrolled successfully."})
        else:
            return jsonify({"status": "failed", "error": "Failed to persist biometric embeddings to vector DB."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/verify", methods=["POST"])
def verify():
    if "face_image" not in request.files or "voice_audio" not in request.files:
        return jsonify({"error": "Missing 'face_image' or 'voice_audio' files."}), 400
        
    user_id = request.form.get("user_id")
    if not user_id:
        return jsonify({"error": "Missing 'user_id' form field."}), 400

    try:
        frame = _read_image(request.files["face_image"])
        audio = _read_audio(request.files["voice_audio"])

        if frame is None or audio is None:
            return jsonify({"error": "Failed to decode media."}), 400

        face_vec = proctor.extract_face_vec(frame, strict=True)
        voice_vec = proctor.extract_voice_vec(audio)

        if face_vec is None:
            return jsonify({
                "status": "ACCESS_DENIED",
                "face_match": False,
                "voice_match": False,
                "error": "No face detected in verification image."
            }), 200

        if voice_vec is None:
            return jsonify({
                "status": "ACCESS_DENIED",
                "face_match": False,
                "voice_match": False,
                "error": "No voice audio detected."
            }), 200

        passed, result = proctor.verify_with_vectors(user_id, face_vec, voice_vec)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/analyze_frame", methods=["POST"])
def analyze_frame():
    """
    Stateless endpoint to analyze a single frame for behaviors (Gaze, Mouth, Contraband)
    so the frontend can process video in chunks.
    """
    if "image" not in request.files:
        return jsonify({"error": "Missing 'image' file."}), 400
        
    try:
        frame = _read_image(request.files["image"])
        if frame is None:
            return jsonify({"error": "Invalid image."}), 400

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

        return jsonify(analysis)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/analyze_secondary_frame", methods=["POST"])
def analyze_secondary_frame():
    """
    Analyzes the secondary desk/phone camera stream for workspace integrity,
    contraband (phones, books, additional devices), and multiple persons.
    """
    if "image" not in request.files:
        return jsonify({"error": "Missing 'image' file."}), 400

    try:
        frame = _read_image(request.files["image"])
        if frame is None:
            return jsonify({"error": "Invalid image."}), 400

        analysis = proctor._analyze_secondary_workspace(frame)
        return jsonify(analysis)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"🚀 Proctora Python AI Engine running on port {port}...")
    app.run(host="0.0.0.0", port=port)


