# Proctora: Multi-Modal In-House Remote Exam Proctoring Ecosystem

**Proctora** is a high-performance, in-house remote exam proctoring platform featuring native kiosk lockdown, real-time local computer vision AI (<30ms latency), acoustic anomaly detection, and direct mobile desk pairing over LAN/Ngrok.

---

## System Architecture

```mermaid
graph TD
    subgraph Student Desktop Machine [In-House Student Machine]
        SK[Electron Desktop Kiosk App :5173]
        AI[Local Python AI Engine :5001]
        BE[Node.js Express Backend :4000]
        
        SK -->|Webcam Video Frames <30ms| AI
        AI -->|3D Pose, MAR, YOLOv8 Contraband| SK
        SK -->|Telemetry Events & Primary Preview| BE
        BE -->|Session State & Risk Scores| DB[(SQLite / PostgreSQL)]
    end

    subgraph Mobile Desk Camera [Student Smartphone]
        PH[Mobile Browser 45° Cam]
        PH -->|Direct LAN Stream http://192.168.x.x:4000 or Ngrok HTTPS Tunnel| BE
    end

    subgraph Invigilator Dashboard [Admin Supervisor]
        ADM[React Admin Dashboard :5174]
        ADM -->|Real-time Dual Feeds & Risk Scores| BE
        ADM -->|Force Terminate Session| BE
        BE -->|Session Terminated| SK
    end
```

---

## Repository Structure

```
├── ai-engine/                  # Local Python 3.12 Vision AI (YOLOv8 + MediaPipe 3D Pose + DeepFace)
│   ├── api.py                  # Standalone FastAPI In-House Engine (Port 5001)
│   ├── exam_proctor.py         # Multi-modal detection algorithms & ChromaDB vectors
│   ├── requirements.txt        # Python dependency manifest
│   └── Dockerfile              # Container definition for local / cloud deployment
│
├── backend/                    # Node.js Express REST API & Database
│   ├── src/app/server.js       # Main server & AI proxy (Port 4000)
│   ├── src/routes/             # Session, telemetry & secondary-stream endpoints
│   ├── src/models/db.js        # SQLite persistence & schema migrations
│   └── Dockerfile              # Backend container definition
│
├── frontend-student/           # Student Client (React + Vite + Electron Kiosk)
│   ├── electron/main.cjs       # Fullscreen, kiosk lockdown & shortcut interceptor
│   ├── electron/preload.cjs    # Secure IPC bridge
│   └── src/App.jsx             # Dual-camera HUD, question runner & exit controls
│
├── frontend-admin/             # Invigilator Dashboard (React + Vite)
│   └── src/App.jsx             # Live dual-camera grid, risk timeline & drill-down review
│
├── docker-compose.yml          # One-command full-stack containerization
└── package.json                # Monorepo concurrent script runner
```

---

##  Quick Start (Local Development)

### 1. Prerequisites
- **Node.js**: v18+ or v20+
- **Python**: 3.11 or 3.12
- **npm** or **bun**

---

### 2. Option A: Run All Microservices Concurrently (One Command)

If you want to spin up the entire ecosystem at once:

```bash
# 1. Install all Node.js dependencies across subprojects
npm run install:all

# 2. Setup Python AI environment
cd ai-engine
pip install -r requirements.txt
cd ..

# 3. Launch all services concurrently
npm run dev
```

---

### 3. Option B: Running Individual Services (Terminal by Terminal)

For modular testing, debugging, or running specific components individually, open separate terminal windows for each service:

#### A. Python AI Engine Microservice (YOLOv8 + MediaPipe + DINOv2)
```bash
cd ai-engine

# (Optional) Create & activate a virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the Flask AI server (Port 5001)
python3 api.py
```
> **Runs on:** `http://localhost:5001`

---

#### B. Node.js Backend Server (REST API & SQLite)
```bash
cd backend

# Install dependencies
npm install

# Start backend server in development mode (with --watch)
npm run dev
```
> **Runs on:** `http://localhost:4000`

---

#### C. Student Desktop Kiosk App (Electron + React)
```bash
cd frontend-student

# Install dependencies
npm install

# Option C1: Run full Electron Kiosk Desktop App locally (Vite + Electron)
npm run electron:dev

# Option C2: Run Web Client mode in browser only
npm run dev
```
> **Student Web App:** `http://localhost:5173`  
> **Mobile Desk Cam Pairing URL:** `http://<YOUR_LOCAL_IP>:5173/?mode=mobile&session=<SESSION_ID>`

---

#### D. Invigilator Admin Dashboard (React)
```bash
cd frontend-admin

# Install dependencies
npm install

# Start Admin Dashboard
npm run dev
```
> **Runs on:** `http://localhost:5174`

---

### 4. Service Summary & Ports

| Component | Directory | Local Command | Default URL / Port |
|---|---|---|---|
| **Python AI Engine** | `ai-engine/` | `python3 api.py` | `http://localhost:5001` |
| **Node Backend** | `backend/` | `npm run dev` | `http://localhost:4000` |
| **Student Web Client** | `frontend-student/` | `npm run dev` | `http://localhost:5173` |
| **Student Electron App** | `frontend-student/` | `npm run electron:dev` | Desktop App Window |
| **Admin Dashboard** | `frontend-admin/` | `npm run dev` | `http://localhost:5174` |

---

## Cloud Hosting & Deployment Guide

### A. Database (Supabase PostgreSQL)
1. Create a free project at [Supabase](https://supabase.com).
2. Go to **Project Settings** -> **Database** and copy the **URI Connection String** (Transaction pooler or Direct).
3. Paste into `backend/.env` as `DATABASE_URL`. The backend automatically creates all tables and seeds the demo exam on first run.

### B. Central Backend (Render / Railway / Fly.io)
1. Create a new **Web Service** pointing to the `backend/` folder on GitHub.
2. Build command: `npm install`.
3. Start command: `node src/app/server.js`.
4. Environment Variables:
   ```env
   NODE_ENV=production
   PORT=4000
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres
   ALLOWED_ORIGINS=https://your-admin-dashboard.vercel.app
   ```
5. Note your deployed Backend URL (e.g. `https://proctora-backend.onrender.com`).

### C. Invigilator Admin Dashboard (Vercel)
1. Import repository into [Vercel](https://vercel.com).
2. Set **Root Directory** to `frontend-admin`.
3. Build command: `npm run build` | Output directory: `dist`.
4. Add Environment Variable:
   ```env
   VITE_API_URL=https://proctora-backend.onrender.com
   ```
5. The Admin Dashboard will automatically connect to the cloud backend, display live candidate tiles, and use the **Anti-Sleep Keepalive Heartbeat** to keep Render awake.

### D. Packaging In-House Student Desktop App (macOS & Windows)
```bash
cd frontend-student

# 1. Package for macOS (.dmg / .app)
npm run build && npx electron-builder --mac

# 2. Package for Windows (.exe)
npm run build && npx electron-builder --win
```
Installers will be generated in `frontend-student/dist-electron/`. Direct mobile desk pairing runs 100% in-house over local Wi-Fi or in-house Ngrok tunnel.

---

## Security & Proctoring Capabilities

| Feature | Technology | Behavior |
|---|---|---|
| **Kiosk Lockdown** | Electron IPC + OS Hooks | Blocks Alt+Tab, Cmd+W, DevTools, multi-window blur |
| **Desk Cam Pair** | WebRTC / Snapshot Relay | Mobile phone stream verifies desk surface & hands |
| **3D Gaze Tracking** | MediaPipe SolvePnP | Detects looking away ($>22^\circ$) while allowing desk writing |
| **Speaking Detection** | MediaPipe Lips (MAR) | Detects vocalization & whispering |
| **Contraband AI** | YOLOv8n Computer Vision | Real-time detection of smartphones, laptops, books |
| **Voice Biometrics** | SpeechBrain ECAPA-TDNN | Verifies speaker acoustic identity |
| **Face Biometrics** | DINOv2 / DeepFace | Verifies enrolled candidate identity |

---

## License
This project is open-source and licensed under the [MIT License](LICENSE).
Copyright (c) 2026 Ankit Talukder.
