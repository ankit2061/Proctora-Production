# 🔬 Multi-Modal Biometric Proctoring System

A real-time, background proctoring application that uses **Face + Voice biometrics** to ensure identity consistency from login through exam completion.

---

## Architecture

```
User ──► Register ──► [FaceNet Embedding]  ──► ChromaDB (face_embeddings)
                  ──► [ECAPA-TDNN d-vector] ──► ChromaDB (voice_embeddings)

Exam  ──► Verify ──► Cosine Similarity vs. Reference ──► Gate (Allow/Deny)
                                │
                                ▼
                    Background Heartbeat Thread
                    (every N seconds, silent capture)
                    → logs distance scores to proctor_logs.json
                    → increments violation_score on mismatch
                    → FLAG_USER if violations ≥ limit
```

## Models & Thresholds

| Biometric | Model           | Threshold (Cosine) | Match Condition |
|-----------|-----------------|--------------------|-----------------|
| Face      | FaceNet (128-d) | < 0.40             | Below threshold |
| Voice     | ECAPA-TDNN      | < 0.30             | Below threshold |

---

## Setup

### 1. Prerequisites
- Python 3.9–3.11
- A working webcam
- A working microphone

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

> **First run note**: SpeechBrain will download the ECAPA-TDNN model weights (~100 MB) automatically. DeepFace will download FaceNet weights on first use.

---

## Usage

### Step 1 — Enrol a User
```bash
python main.py --register student_01
```
- A webcam preview window opens → press **any key** to capture your face.
- A 5-second voice recording then starts → **speak clearly** (read anything aloud).
- Embeddings are stored persistently in `./proctor_db/`.

### Step 2 — Start Proctored Exam
```bash
python main.py --start-exam student_01
```
- Identity is **verified** at login (face + voice check).
- If verification succeeds, a **background monitor thread** launches.
- Every 30 seconds it silently checks face and voice.
- All events and distance scores are written to `proctor_logs.json`.

### Optional Flags
```bash
# Custom heartbeat interval (e.g. every 15 seconds)
python main.py --start-exam student_01 --interval 15

# List all enrolled users
python main.py --list-users

# Re-enrol (wipe existing biometrics for a user)
python main.py --reset-user student_01
python main.py --register student_01

# Debug/verbose logging
python main.py --start-exam student_01 --verbose
```

---

## Log File Format (`proctor_logs.json`)

Each event is appended as a JSON object in an array:

```json
[
  {
    "event": "REGISTRATION",
    "user_id": "student_01",
    "timestamp": "2026-04-08T11:00:00",
    "status": "SUCCESS"
  },
  {
    "event": "VERIFICATION",
    "user_id": "student_01",
    "timestamp": "2026-04-08T11:01:00",
    "status": "ACCESS_GRANTED",
    "face_cosine_distance": 0.1823,
    "voice_cosine_distance": 0.2101,
    "face_match": true,
    "voice_match": true
  },
  {
    "event": "HEARTBEAT_OK",
    "user_id": "student_01",
    "timestamp": "2026-04-08T11:01:30",
    "check_number": 1,
    "face_cosine_distance": 0.1950,
    "voice_cosine_distance": 0.2230,
    "violation_score": 0
  },
  {
    "event": "FLAG_USER",
    "user_id": "student_01",
    "timestamp": "2026-04-08T11:03:00",
    "reason": "Violation score reached 3/3"
  }
]
```

### Event Types

| Event              | Meaning                                              |
|--------------------|------------------------------------------------------|
| `REGISTRATION`     | User enrolled successfully                           |
| `VERIFICATION`     | Login-time identity check result                     |
| `HEARTBEAT_OK`     | Periodic check passed (both biometrics matched)     |
| `FACE_MISMATCH`    | Heartbeat: face distance exceeded threshold          |
| `VOICE_MISMATCH`   | Heartbeat: voice distance exceeded threshold         |
| `ABSENT_FACE`      | No face detected in frame                            |
| `NO_FACE_DETECTED` | Verification failed – no face found                  |
| `FLAG_USER`        | Violation limit breached – exam flagged/terminated   |
| `EXAM_ENDED`       | Session manually terminated (Ctrl+C)                 |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `sounddevice` errors on Windows | Install `pipwin` then `pipwin install PyAudio` |
| Camera doesn't open | Check no other app is using the webcam |
| DeepFace `No face` errors | Improve lighting; face camera directly |
| SpeechBrain download hanging | Run with `--verbose` to see download progress |
| First-run is slow | Model weights are being downloaded – subsequent runs are fast |
