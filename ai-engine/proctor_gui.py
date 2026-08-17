"""
proctor_gui.py
──────────────
Dark-themed tkinter GUI for the Multi-Modal Biometric Proctoring System.

Run:  python proctor_gui.py
"""

import json
import logging
import queue
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import sounddevice as sd
from PIL import Image, ImageTk, ImageDraw, ImageFont

from exam_proctor import (
    ExamProctor,
    FACE_COSINE_THRESHOLD,
    VOICE_COSINE_THRESHOLD,
    VIOLATION_SCORE_LIMIT,
    AUDIO_SAMPLE_RATE,
    ENROLL_AUDIO_SECONDS,
    MONITOR_HEARTBEAT_SEC,
    LOG_FILE,
    _append_log,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ProctorGUI")

# ── Colours ──────────────────────────────────────────────────────────────────
C = {
    "bg":          "#0d1117",
    "bg_card":     "#161b22",
    "bg_surface":  "#1c2333",
    "bg_input":    "#0d1117",
    "border":      "#30363d",
    "primary":     "#00d4aa",
    "primary_dim": "#00a88a",
    "secondary":   "#58a6ff",
    "text":        "#c9d1d9",
    "text_dim":    "#8b949e",
    "text_bright": "#f0f6fc",
    "success":     "#3fb950",
    "error":       "#f85149",
    "warning":     "#d29922",
    "danger":      "#ff1744",
}

FONT = "Segoe UI"
CAM_W, CAM_H = 380, 280
CAM_EXAM_H   = 200          # smaller preview on exam page
CAM_MS       = 33


def _blank_photo(w, h, text=""):
    img = Image.new("RGB", (w, h), color=(13, 17, 23))
    if text:
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("segoeui.ttf", 14)
        except Exception:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((w - tw) // 2, (h - th) // 2), text,
                  fill=(139, 148, 158), font=font)
    return ImageTk.PhotoImage(img)


class ProctorGUI:

    def __init__(self, root):
        self.root = root
        root.title("Biometric Proctor")
        root.geometry("1120x760")
        root.configure(bg=C["bg"])
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        self.proctor = ExamProctor()
        self.cap = None
        self.camera_running = False
        self._current_frame = None

        # Register state
        self.captured_frame = None
        self.captured_face_vec = None
        self.captured_audio = None
        self.captured_voice_vec = None

        # Exam state
        self._exam_face_vec = None
        self._exam_voice_vec = None

        self.recording = False
        self.audio_buffer = []
        self.current_rms = 0.0

        self.monitor_queue = queue.Queue()
        self.exam_active = False

        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

        self._photo_refs = {}
        self._active_page = None    # track which page uses the camera

        self._setup_styles()
        self._build_sidebar()
        self._build_pages()
        self._show_page("register")

    # ─── STYLES ──────────────────────────────────────────────────────────
    def _setup_styles(self):
        s = ttk.Style(); s.theme_use("default")
        s.configure("TFrame",       background=C["bg"])
        s.configure("Card.TFrame",  background=C["bg_card"])
        s.configure("TLabel",       background=C["bg"],      foreground=C["text"], font=(FONT, 10))
        s.configure("Card.TLabel",  background=C["bg_card"], foreground=C["text"], font=(FONT, 10))
        s.configure("H1.TLabel",    background=C["bg"],      foreground=C["text_bright"], font=(FONT, 18, "bold"))
        s.configure("H2.TLabel",    background=C["bg_card"], foreground=C["text_bright"], font=(FONT, 12, "bold"))
        s.configure("Dim.TLabel",   background=C["bg_card"], foreground=C["text_dim"],    font=(FONT, 9))
        s.configure("Status.TLabel",  background=C["bg_card"], foreground=C["primary"],  font=(FONT, 10, "bold"))
        s.configure("Success.TLabel", background=C["bg_card"], foreground=C["success"],  font=(FONT, 10, "bold"))
        s.configure("Error.TLabel",   background=C["bg_card"], foreground=C["error"],    font=(FONT, 10, "bold"))

        s.configure("Accent.TButton",    background=C["primary"],    foreground=C["bg"],    font=(FONT, 10, "bold"), borderwidth=0, padding=(14, 7))
        s.map("Accent.TButton",    background=[("active", C["primary_dim"]), ("disabled", C["border"])])
        s.configure("Secondary.TButton", background=C["bg_surface"], foreground=C["text"],  font=(FONT, 10), borderwidth=0, padding=(14, 7))
        s.map("Secondary.TButton", background=[("active", C["border"]),      ("disabled", C["bg"])])
        s.configure("Danger.TButton",    background=C["error"],      foreground="#fff",      font=(FONT, 10, "bold"), borderwidth=0, padding=(14, 7))
        s.map("Danger.TButton", background=[("active", C["danger"])])
        s.configure("Nav.TButton", background=C["bg"], foreground=C["text_dim"], font=(FONT, 11), borderwidth=0, padding=(12, 10), anchor="w")
        s.map("Nav.TButton", background=[("active", C["bg_card"])], foreground=[("active", C["primary"])])

        s.configure("TEntry", fieldbackground=C["bg_input"], foreground=C["text"], insertcolor=C["text"], borderwidth=1, padding=6)
        s.configure("Treeview",         background=C["bg_card"], foreground=C["text"], fieldbackground=C["bg_card"], borderwidth=0, font=(FONT, 9), rowheight=26)
        s.configure("Treeview.Heading", background=C["bg_surface"], foreground=C["primary"], font=(FONT, 9, "bold"), borderwidth=0)
        s.map("Treeview", background=[("selected", C["bg_surface"])])

    # ─── SIDEBAR ─────────────────────────────────────────────────────────
    def _build_sidebar(self):
        sb = tk.Frame(self.root, bg=C["bg_card"], width=190); sb.pack(side="left", fill="y"); sb.pack_propagate(False)
        tk.Label(sb, text="🔬", font=(FONT, 26), bg=C["bg_card"], fg=C["primary"]).pack(pady=(20, 0))
        tk.Label(sb, text="Biometric\nProctor", font=(FONT, 14, "bold"), bg=C["bg_card"], fg=C["text_bright"], justify="center").pack(pady=(2, 2))
        tk.Label(sb, text="Face + Voice • v1.0", font=(FONT, 8), bg=C["bg_card"], fg=C["text_dim"]).pack(pady=(0, 16))
        tk.Frame(sb, bg=C["border"], height=1).pack(fill="x", padx=14, pady=4)
        for lbl, pg in [("📝  Register", "register"), ("🎓  Exam", "exam"), ("📋  Logs", "logs")]:
            ttk.Button(sb, text=lbl, style="Nav.TButton", command=lambda p=pg: self._show_page(p)).pack(fill="x", padx=8, pady=2)
        tk.Frame(sb, bg=C["bg_card"]).pack(fill="both", expand=True)
        ttk.Button(sb, text="✕  Quit", style="Danger.TButton", command=self._on_close).pack(fill="x", padx=14, pady=14)

    # ─── PAGES ───────────────────────────────────────────────────────────
    def _build_pages(self):
        self.container = tk.Frame(self.root, bg=C["bg"]); self.container.pack(side="right", fill="both", expand=True)
        self.pages = {}
        self._build_register_page()
        self._build_exam_page()
        self._build_logs_page()

    def _show_page(self, name):
        self._stop_camera()
        self._stop_recording_if_active()
        for f in self.pages.values(): f.pack_forget()
        self.pages[name].pack(fill="both", expand=True)
        self._active_page = name
        if name == "logs": self._refresh_logs()

    # ═════════════════════════════════════════════════════════════════════
    #  REGISTER PAGE
    # ═════════════════════════════════════════════════════════════════════
    def _build_register_page(self):
        page = tk.Frame(self.container, bg=C["bg"]); self.pages["register"] = page

        ttk.Label(page, text="User Registration", style="H1.TLabel").pack(anchor="w", padx=20, pady=(16, 2))
        ttk.Label(page, text="Enrol face and voice biometrics for a new user.", style="TLabel").pack(anchor="w", padx=20, pady=(0, 8))

        id_row = tk.Frame(page, bg=C["bg"]); id_row.pack(fill="x", padx=20, pady=(0, 8))
        tk.Label(id_row, text="User ID", font=(FONT, 10, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        self.reg_uid = ttk.Entry(id_row, width=22); self.reg_uid.pack(side="left", padx=(10, 0))

        cols = tk.Frame(page, bg=C["bg"]); cols.pack(fill="both", expand=True, padx=20, pady=(0, 8))
        cols.columnconfigure(0, weight=1); cols.columnconfigure(1, weight=1)

        # LEFT: Face
        fc = tk.Frame(cols, bg=C["bg_card"], highlightbackground=C["border"], highlightthickness=1)
        fc.grid(row=0, column=0, padx=(0, 4), sticky="nsew")
        ttk.Label(fc, text="Step 1 — Face Capture", style="H2.TLabel").pack(anchor="w", padx=10, pady=(10, 4))
        self._photo_refs["cam_blank"] = _blank_photo(CAM_W, CAM_H, "Click ▶ Start Camera")
        self.reg_cam_label = tk.Label(fc, image=self._photo_refs["cam_blank"], bg="#000"); self.reg_cam_label.pack(padx=10, pady=(4, 4))
        self.reg_face_status = ttk.Label(fc, text="● Camera off", style="Dim.TLabel"); self.reg_face_status.pack(anchor="w", padx=10)
        fb = tk.Frame(fc, bg=C["bg_card"]); fb.pack(fill="x", padx=10, pady=(4, 10))
        self.btn_cam_start   = ttk.Button(fb, text="▶ Start Camera", style="Accent.TButton",    command=self._reg_start_camera);  self.btn_cam_start.pack(side="left", padx=(0, 4))
        self.btn_cam_capture = ttk.Button(fb, text="📸 Capture",     style="Secondary.TButton", command=self._reg_capture_face,   state="disabled"); self.btn_cam_capture.pack(side="left", padx=(0, 4))
        self.btn_cam_retake  = ttk.Button(fb, text="↻ Retake",       style="Secondary.TButton", command=self._reg_retake_face,    state="disabled"); self.btn_cam_retake.pack(side="left")

        # RIGHT: Voice
        vc = tk.Frame(cols, bg=C["bg_card"], highlightbackground=C["border"], highlightthickness=1)
        vc.grid(row=0, column=1, padx=(4, 0), sticky="nsew")
        ttk.Label(vc, text="Step 2 — Voice Sample", style="H2.TLabel").pack(anchor="w", padx=10, pady=(10, 4))
        tk.Label(vc, text="Audio Level", font=(FONT, 9), bg=C["bg_card"], fg=C["text_dim"]).pack(anchor="w", padx=10, pady=(16, 2))
        self.reg_meter = tk.Canvas(vc, height=24, bg=C["bg"], highlightthickness=0); self.reg_meter.pack(fill="x", padx=10, pady=(0, 4))
        self.reg_rms_label = ttk.Label(vc, text="RMS: —", style="Dim.TLabel"); self.reg_rms_label.pack(anchor="w", padx=10)
        self.reg_countdown = ttk.Label(vc, text="", style="Status.TLabel"); self.reg_countdown.pack(anchor="w", padx=10, pady=(4, 0))
        self.reg_voice_status = ttk.Label(vc, text="● Waiting", style="Dim.TLabel"); self.reg_voice_status.pack(anchor="w", padx=10, pady=(4, 0))
        vb = tk.Frame(vc, bg=C["bg_card"]); vb.pack(fill="x", padx=10, pady=(10, 4))
        self.btn_reg_voice = ttk.Button(vb, text="🎤 Record Voice (5 s)", style="Accent.TButton", command=self._reg_start_voice); self.btn_reg_voice.pack(side="left")
        tk.Label(vc, text="Speak clearly for 5 seconds.\nRead anything aloud.", font=(FONT, 9), bg=C["bg_card"], fg=C["text_dim"], justify="left").pack(anchor="w", padx=10, pady=(8, 10))

        # Bottom
        bot = tk.Frame(page, bg=C["bg"]); bot.pack(fill="x", padx=20, pady=(0, 14))
        self.btn_register = ttk.Button(bot, text="✓  Complete Registration", style="Accent.TButton", command=self._do_register, state="disabled"); self.btn_register.pack(side="right")
        self.reg_result = ttk.Label(bot, text="", style="Status.TLabel"); self.reg_result.pack(side="left")

    # ═════════════════════════════════════════════════════════════════════
    #  EXAM PAGE  (interactive verification + monitoring dashboard)
    # ═════════════════════════════════════════════════════════════════════
    def _build_exam_page(self):
        page = tk.Frame(self.container, bg=C["bg"]); self.pages["exam"] = page

        ttk.Label(page, text="Exam Session", style="H1.TLabel").pack(anchor="w", padx=20, pady=(16, 2))
        ttk.Label(page, text="Verify identity, then begin proctored monitoring.", style="TLabel").pack(anchor="w", padx=20, pady=(0, 8))

        ctrl = tk.Frame(page, bg=C["bg"]); ctrl.pack(fill="x", padx=20, pady=(0, 8))
        tk.Label(ctrl, text="User ID", font=(FONT, 10, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        self.exam_uid = ttk.Entry(ctrl, width=22); self.exam_uid.pack(side="left", padx=(10, 10))
        self.btn_exam_stop = ttk.Button(ctrl, text="■  Stop Exam", style="Danger.TButton", command=self._stop_exam, state="disabled"); self.btn_exam_stop.pack(side="right")

        # ── Verification cards (camera + voice, interactive) ─────────────
        vf = tk.Frame(page, bg=C["bg"]); vf.pack(fill="x", padx=20, pady=(0, 6))
        vf.columnconfigure(0, weight=1); vf.columnconfigure(1, weight=1)

        # LEFT: exam face
        efc = tk.Frame(vf, bg=C["bg_card"], highlightbackground=C["border"], highlightthickness=1)
        efc.grid(row=0, column=0, padx=(0, 4), sticky="nsew")
        ttk.Label(efc, text="Verify — Face", style="H2.TLabel").pack(anchor="w", padx=10, pady=(8, 4))
        self._photo_refs["exam_cam_blank"] = _blank_photo(CAM_W, CAM_EXAM_H, "Click ▶ Start Camera")
        self.exam_cam_label = tk.Label(efc, image=self._photo_refs["exam_cam_blank"], bg="#000"); self.exam_cam_label.pack(padx=10, pady=(2, 4))
        self.exam_face_status = ttk.Label(efc, text="● Waiting", style="Dim.TLabel"); self.exam_face_status.pack(anchor="w", padx=10)
        efb = tk.Frame(efc, bg=C["bg_card"]); efb.pack(fill="x", padx=10, pady=(4, 8))
        self.btn_exam_cam_start   = ttk.Button(efb, text="▶ Start Camera", style="Accent.TButton",    command=self._exam_start_camera);  self.btn_exam_cam_start.pack(side="left", padx=(0, 4))
        self.btn_exam_cam_capture = ttk.Button(efb, text="📸 Capture",     style="Secondary.TButton", command=self._exam_capture_face, state="disabled"); self.btn_exam_cam_capture.pack(side="left")

        # RIGHT: exam voice
        evc = tk.Frame(vf, bg=C["bg_card"], highlightbackground=C["border"], highlightthickness=1)
        evc.grid(row=0, column=1, padx=(4, 0), sticky="nsew")
        ttk.Label(evc, text="Verify — Voice", style="H2.TLabel").pack(anchor="w", padx=10, pady=(8, 4))
        tk.Label(evc, text="Audio Level", font=(FONT, 9), bg=C["bg_card"], fg=C["text_dim"]).pack(anchor="w", padx=10, pady=(10, 2))
        self.exam_meter = tk.Canvas(evc, height=22, bg=C["bg"], highlightthickness=0); self.exam_meter.pack(fill="x", padx=10, pady=(0, 4))
        self.exam_rms_label = ttk.Label(evc, text="RMS: —", style="Dim.TLabel"); self.exam_rms_label.pack(anchor="w", padx=10)
        self.exam_countdown = ttk.Label(evc, text="", style="Status.TLabel"); self.exam_countdown.pack(anchor="w", padx=10, pady=(4, 0))
        self.exam_voice_status = ttk.Label(evc, text="● Waiting", style="Dim.TLabel"); self.exam_voice_status.pack(anchor="w", padx=10, pady=(4, 0))
        evb = tk.Frame(evc, bg=C["bg_card"]); evb.pack(fill="x", padx=10, pady=(8, 8))
        self.btn_exam_voice = ttk.Button(evb, text="🎤 Record Voice (5 s)", style="Accent.TButton", command=self._exam_start_voice); self.btn_exam_voice.pack(side="left")

        # Verify + result
        vbtn = tk.Frame(page, bg=C["bg"]); vbtn.pack(fill="x", padx=20, pady=(0, 6))
        self.btn_exam_verify = ttk.Button(vbtn, text="✓  Verify & Start Exam", style="Accent.TButton", command=self._exam_run_verify, state="disabled"); self.btn_exam_verify.pack(side="right")
        self.exam_verify_lbl = ttk.Label(vbtn, text="", style="Status.TLabel"); self.exam_verify_lbl.pack(side="left")

        # ── Monitoring dashboard ─────────────────────────────────────────
        dash = tk.Frame(page, bg=C["bg_card"], highlightbackground=C["border"], highlightthickness=1)
        dash.pack(fill="both", expand=True, padx=20, pady=(0, 14))
        ttk.Label(dash, text="Monitoring Dashboard", style="H2.TLabel").pack(anchor="w", padx=12, pady=(10, 6))
        grid = tk.Frame(dash, bg=C["bg_card"]); grid.pack(fill="x", padx=12, pady=(0, 8))
        grid_items = [
            ("Status",     "exam_status",     "● Idle"),
            ("Checks",     "exam_checks",     "0"),
            ("Face Dist",  "exam_face_dist",  "—"),
            ("Voice Dist", "exam_voice_dist", "—"),
            ("Gaze",       "exam_gaze",       "OK"),
            ("Mouth",      "exam_mouth",      "Silent"),
            ("Environment","exam_contraband", "Clean"),
            ("Violations", "exam_violations", f"0 / {VIOLATION_SCORE_LIMIT}"),
        ]
        
        for i, (title, attr, default) in enumerate(grid_items):
            r_idx = (i // 4) * 2
            c_idx = i % 4
            tk.Label(grid, text=title, font=(FONT, 9), bg=C["bg_card"], fg=C["text_dim"]).grid(row=r_idx, column=c_idx, padx=14, sticky="w", pady=(0, 2))
            lbl = tk.Label(grid, text=default, font=(FONT, 13, "bold"), bg=C["bg_card"], fg=C["text_bright"])
            lbl.grid(row=r_idx+1, column=c_idx, padx=14, sticky="w", pady=(0, 6))
            setattr(self, f"lbl_{attr}", lbl)
        self.violation_canvas = tk.Canvas(dash, height=14, bg=C["bg"], highlightthickness=0); self.violation_canvas.pack(fill="x", padx=12, pady=(0, 6))
        self.exam_event_log = tk.Label(dash, text="", font=(FONT, 9), bg=C["bg_card"], fg=C["text_dim"], anchor="w", justify="left"); self.exam_event_log.pack(fill="x", padx=12, pady=(0, 10))

    # ═════════════════════════════════════════════════════════════════════
    #  LOGS PAGE
    # ═════════════════════════════════════════════════════════════════════
    def _build_logs_page(self):
        page = tk.Frame(self.container, bg=C["bg"]); self.pages["logs"] = page
        hdr = tk.Frame(page, bg=C["bg"]); hdr.pack(fill="x", padx=20, pady=(16, 10))
        ttk.Label(hdr, text="Proctor Logs", style="H1.TLabel").pack(side="left")
        ttk.Button(hdr, text="↻  Refresh", style="Secondary.TButton", command=self._refresh_logs).pack(side="right")
        cols = ("timestamp", "event", "user", "face_dist", "voice_dist", "violations", "note")
        self.log_tree = ttk.Treeview(page, columns=cols, show="headings", height=22)
        for c in cols:
            self.log_tree.heading(c, text=c.replace("_", " ").title())
            self.log_tree.column(c, width=120, anchor="center")
        self.log_tree.column("timestamp", width=160); self.log_tree.column("event", width=140); self.log_tree.column("note", width=200)
        vsb = ttk.Scrollbar(page, orient="vertical", command=self.log_tree.yview); self.log_tree.configure(yscrollcommand=vsb.set)
        self.log_tree.pack(side="left", fill="both", expand=True, padx=(20, 0), pady=(0, 14))
        vsb.pack(side="right", fill="y", padx=(0, 20), pady=(0, 14))

    def _refresh_logs(self):
        for r in self.log_tree.get_children(): self.log_tree.delete(r)
        if not Path(LOG_FILE).exists(): return
        try:
            with open(LOG_FILE, "r", encoding="utf-8") as f: entries = json.load(f)
        except Exception: return
        for e in entries:
            self.log_tree.insert("", "end", values=(
                e.get("timestamp", "")[:19], e.get("event", ""), e.get("user_id", ""),
                e.get("face_cosine_distance", ""), e.get("voice_cosine_distance", ""),
                e.get("violation_score", ""), e.get("note", e.get("reason", e.get("status", ""))),
            ))

    # ═════════════════════════════════════════════════════════════════════
    #  CAMERA  (shared helpers — page-agnostic)
    # ═════════════════════════════════════════════════════════════════════
    def _start_camera(self, label, ref_key, size, status_lbl, start_btn, cap_btn):
        """Open webcam and feed frames into `label`."""
        self._stop_camera()
        self.cap = cv2.VideoCapture(0)
        if not self.cap.isOpened():
            messagebox.showerror("Camera Error", "Cannot open webcam."); return
        self.camera_running = True
        self._cam_label   = label
        self._cam_ref     = ref_key
        self._cam_size    = size
        start_btn.configure(state="disabled")
        cap_btn.configure(state="normal")
        status_lbl.configure(text="● Camera active — position face", style="Status.TLabel")
        self._update_camera()

    def _update_camera(self):
        if not self.camera_running or self.cap is None: return
        ret, frame = self.cap.read()
        if ret:
            display = frame.copy()
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)
            for (x, y, w, h) in faces:
                cv2.rectangle(display, (x, y), (x+w, y+h), (0, 212, 170), 2)
            rgb = cv2.cvtColor(display, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(rgb).resize(self._cam_size)
            imtk = ImageTk.PhotoImage(img)
            self._photo_refs[self._cam_ref] = imtk
            self._cam_label.configure(image=imtk)
            self._current_frame = frame.copy()
        self.root.after(CAM_MS, self._update_camera)

    def _stop_camera(self):
        self.camera_running = False
        if self.cap is not None: self.cap.release(); self.cap = None

    # ═════════════════════════════════════════════════════════════════════
    #  AUDIO RECORDING  (shared — _active_meter/_active_status etc track
    #  which page's widgets to update)
    # ═════════════════════════════════════════════════════════════════════
    def _start_recording(self, meter, rms_lbl, cd_lbl, status_lbl, rec_btn, finish_cb):
        if self.recording: return
        self.audio_buffer = []; self.current_rms = 0.0
        self.recording = True; self._rec_start = time.time()
        self._rec_meter = meter; self._rec_rms = rms_lbl
        self._rec_cd = cd_lbl; self._rec_status = status_lbl
        self._rec_btn = rec_btn; self._rec_finish_cb = finish_cb

        rec_btn.configure(state="disabled")
        status_lbl.configure(text="● Recording…", style="Status.TLabel")

        self._audio_stream = sd.InputStream(samplerate=AUDIO_SAMPLE_RATE, channels=1, dtype="float32", callback=self._audio_cb)
        self._audio_stream.start()
        self._tick_meter()

    def _audio_cb(self, indata, frames, time_info, status):
        if self.recording:
            self.audio_buffer.append(indata.copy())
            self.current_rms = float(np.sqrt(np.mean(indata**2)))

    def _tick_meter(self):
        if not self.recording: return
        elapsed = time.time() - self._rec_start
        remaining = max(0, ENROLL_AUDIO_SECONDS - elapsed)
        self._rec_cd.configure(text=f"⏱  {remaining:.1f} s remaining")
        self._rec_rms.configure(text=f"RMS: {self.current_rms:.4f}")
        self._rec_meter.delete("bar")
        cw = max(self._rec_meter.winfo_width(), 1)
        level = min(self.current_rms * 8, 1.0)
        bw = int(level * cw)
        clr = C["success"] if level < 0.5 else C["warning"] if level < 0.8 else C["error"]
        if bw > 0: self._rec_meter.create_rectangle(0, 0, bw, 24, fill=clr, tags="bar", outline="")
        if elapsed >= ENROLL_AUDIO_SECONDS:
            self._finish_recording()
        else:
            self.root.after(50, self._tick_meter)

    def _finish_recording(self):
        self.recording = False
        if hasattr(self, "_audio_stream"): self._audio_stream.stop(); self._audio_stream.close()
        if not self.audio_buffer:
            self._rec_status.configure(text="● No audio captured", style="Error.TLabel")
            self._rec_btn.configure(state="normal"); return
        audio = np.concatenate(self.audio_buffer).flatten()
        rms = float(np.sqrt(np.mean(audio**2)))
        if rms < 0.005:
            self._rec_status.configure(text="● Too silent — retry", style="Error.TLabel")
            self._rec_btn.configure(state="normal"); return
        self._rec_status.configure(text="● Processing…", style="Status.TLabel")
        self._rec_cd.configure(text="")
        self._rec_finish_cb(audio)

    def _stop_recording_if_active(self):
        if self.recording:
            self.recording = False
            if hasattr(self, "_audio_stream"):
                try: self._audio_stream.stop(); self._audio_stream.close()
                except Exception: pass

    # ═════════════════════════════════════════════════════════════════════
    #  REGISTER — camera & voice wrappers
    # ═════════════════════════════════════════════════════════════════════
    def _reg_start_camera(self):
        self.captured_frame = None; self.captured_face_vec = None; self.reg_result.configure(text=""); self.btn_register.configure(state="disabled")
        self._start_camera(self.reg_cam_label, "reg_cam", (CAM_W, CAM_H), self.reg_face_status, self.btn_cam_start, self.btn_cam_capture)

    def _reg_capture_face(self):
        if self._current_frame is None: return
        self.captured_frame = self._current_frame.copy()
        self._stop_camera()
        rgb = cv2.cvtColor(self.captured_frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb).resize((CAM_W, CAM_H))
        imtk = ImageTk.PhotoImage(img); self._photo_refs["reg_frozen"] = imtk; self.reg_cam_label.configure(image=imtk)
        self.reg_face_status.configure(text="● Processing…", style="Status.TLabel")
        self.btn_cam_capture.configure(state="disabled"); self.btn_cam_retake.configure(state="normal")
        def _bg():
            vec = self.proctor.extract_face_vec(self.captured_frame)
            if vec is not None:
                self.captured_face_vec = vec
                self.root.after(0, lambda: self.reg_face_status.configure(text="● Face ready  ✓", style="Success.TLabel"))
            else:
                self.root.after(0, lambda: self.reg_face_status.configure(text="● Failed — Retake", style="Error.TLabel"))
            self.root.after(0, self._reg_maybe_enable)
        threading.Thread(target=_bg, daemon=True).start()

    def _reg_retake_face(self):
        self.captured_frame = None; self.captured_face_vec = None
        self.btn_cam_retake.configure(state="disabled"); self.btn_register.configure(state="disabled")
        self._reg_start_camera()

    def _reg_start_voice(self):
        self.captured_voice_vec = None
        self._start_recording(self.reg_meter, self.reg_rms_label, self.reg_countdown, self.reg_voice_status, self.btn_reg_voice, self._reg_voice_done)

    def _reg_voice_done(self, audio):
        def _bg():
            vec = self.proctor.extract_voice_vec(audio)
            if vec is not None:
                self.captured_voice_vec = vec
                self.root.after(0, lambda: self.reg_voice_status.configure(text="● Voice ready  ✓", style="Success.TLabel"))
            else:
                self.root.after(0, lambda: self.reg_voice_status.configure(text="● Failed — record again", style="Error.TLabel"))
                self.root.after(0, lambda: self.btn_reg_voice.configure(state="normal"))
            self.root.after(0, self._reg_maybe_enable)
        threading.Thread(target=_bg, daemon=True).start()

    def _reg_maybe_enable(self):
        self.btn_register.configure(state="normal" if self.captured_face_vec is not None and self.captured_voice_vec is not None else "disabled")

    def _do_register(self):
        uid = self.reg_uid.get().strip()
        if not uid: messagebox.showwarning("Missing ID", "Enter a User ID."); return
        ok = self.proctor.register_with_vectors(uid, self.captured_face_vec, self.captured_voice_vec)
        self.reg_result.configure(text=f"✓  '{uid}' enrolled!" if ok else "✗  Failed.", style="Success.TLabel" if ok else "Error.TLabel")

    # ═════════════════════════════════════════════════════════════════════
    #  EXAM — camera & voice wrappers
    # ═════════════════════════════════════════════════════════════════════
    def _exam_start_camera(self):
        self._exam_face_vec = None; self.btn_exam_verify.configure(state="disabled"); self.exam_verify_lbl.configure(text="")
        self._start_camera(self.exam_cam_label, "exam_cam", (CAM_W, CAM_EXAM_H), self.exam_face_status, self.btn_exam_cam_start, self.btn_exam_cam_capture)

    def _exam_capture_face(self):
        if self._current_frame is None: return
        frame = self._current_frame.copy()
        self._stop_camera()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb).resize((CAM_W, CAM_EXAM_H))
        imtk = ImageTk.PhotoImage(img); self._photo_refs["exam_frozen"] = imtk; self.exam_cam_label.configure(image=imtk)
        self.exam_face_status.configure(text="● Processing…", style="Status.TLabel")
        self.btn_exam_cam_capture.configure(state="disabled")
        def _bg():
            vec = self.proctor.extract_face_vec(frame)
            if vec is not None:
                self._exam_face_vec = vec
                self.root.after(0, lambda: self.exam_face_status.configure(text="● Face ready  ✓", style="Success.TLabel"))
            else:
                self.root.after(0, lambda: self.exam_face_status.configure(text="● Failed — restart camera", style="Error.TLabel"))
                self.root.after(0, lambda: self.btn_exam_cam_start.configure(state="normal"))
            self.root.after(0, self._exam_maybe_enable)
        threading.Thread(target=_bg, daemon=True).start()

    def _exam_start_voice(self):
        self._exam_voice_vec = None
        self._start_recording(self.exam_meter, self.exam_rms_label, self.exam_countdown, self.exam_voice_status, self.btn_exam_voice, self._exam_voice_done)

    def _exam_voice_done(self, audio):
        def _bg():
            vec = self.proctor.extract_voice_vec(audio)
            if vec is not None:
                self._exam_voice_vec = vec
                self.root.after(0, lambda: self.exam_voice_status.configure(text="● Voice ready  ✓", style="Success.TLabel"))
            else:
                self.root.after(0, lambda: self.exam_voice_status.configure(text="● Failed — record again", style="Error.TLabel"))
                self.root.after(0, lambda: self.btn_exam_voice.configure(state="normal"))
            self.root.after(0, self._exam_maybe_enable)
        threading.Thread(target=_bg, daemon=True).start()

    def _exam_maybe_enable(self):
        self.btn_exam_verify.configure(state="normal" if self._exam_face_vec is not None and self._exam_voice_vec is not None else "disabled")

    def _exam_run_verify(self):
        uid = self.exam_uid.get().strip()
        if not uid: messagebox.showwarning("Missing ID", "Enter a User ID."); return
        if not self.proctor.is_enrolled(uid):
            messagebox.showerror("Not Enrolled", f"'{uid}' not registered."); return

        ok, details = self.proctor.verify_with_vectors(uid, self._exam_face_vec, self._exam_voice_vec)
        fd = details.get("face_cosine_distance", "?"); vd = details.get("voice_cosine_distance", "?")
        if ok:
            self.exam_verify_lbl.configure(text=f"✓  Verified!  Face={fd}  Voice={vd}", style="Success.TLabel")
            self.btn_exam_verify.configure(state="disabled")
            self._start_exam_monitoring(uid)
        else:
            self.exam_verify_lbl.configure(text=f"✗  Mismatch — Face={fd}  Voice={vd}", style="Error.TLabel")
            self.btn_exam_cam_start.configure(state="normal"); self.btn_exam_voice.configure(state="normal")
            self._exam_face_vec = None; self._exam_voice_vec = None; self.btn_exam_verify.configure(state="disabled")

    # ═════════════════════════════════════════════════════════════════════
    #  MONITORING
    # ═════════════════════════════════════════════════════════════════════
    def _start_exam_monitoring(self, uid):
        self.exam_active = True; self.btn_exam_stop.configure(state="normal")
        self.lbl_exam_status.configure(text="● MONITORING", fg=C["success"])
        self.exam_event_log.configure(text=f"Monitoring started — heartbeat every {MONITOR_HEARTBEAT_SEC} s…")
        self.proctor.start_monitoring(uid, check_interval=MONITOR_HEARTBEAT_SEC, callback=lambda r: self.monitor_queue.put(r))
        self._poll_monitor()

    def _poll_monitor(self):
        if not self.exam_active: return
        try:
            while True:
                r = self.monitor_queue.get_nowait(); self._update_dash(r)
        except queue.Empty: pass
        self.root.after(500, self._poll_monitor)

    def _update_dash(self, r):
        evt = r.get("event", "")
        ts = r.get("timestamp", "")[:19]
        vs = r.get("violation_score", 0)
        
        # Only update Core distances if it's a heartbeat (not a fast-tick vision event)
        if "check_number" in r:
            self.lbl_exam_checks.configure(text=str(r.get("check_number", "?")))
            fd = r.get("face_cosine_distance"); vd = r.get("voice_cosine_distance")
            self.lbl_exam_face_dist.configure(text=f"{fd:.4f}" if fd else "N/A", fg=C["success"] if r.get("face_ok") else C["error"])
            self.lbl_exam_voice_dist.configure(text=f"{vd:.4f}" if vd else "N/A", fg=C["success"] if r.get("voice_ok") else C["error"])
            self.exam_event_log.configure(text=f"[{ts}]  {evt}  |  face={'✓' if r.get('face_ok') else '✗'}  voice={'✓' if r.get('voice_ok') else '✗'}")
        else:
            self.exam_event_log.configure(text=f"[{ts}]  {evt}")

        # Update Vision labels briefly if they flagged, keep warning visible for 4s
        if evt == "GAZE_AWAY":
            self.lbl_exam_gaze.configure(text="Away!", fg=C["error"])
            self.root.after(4000, lambda: getattr(self, "lbl_exam_gaze", None) and self.lbl_exam_gaze.configure(text="OK", fg=C["text_bright"]))
            
        if evt == "MOUTH_MOVEMENT":
            self.lbl_exam_mouth.configure(text="Talking!", fg=C["error"])
            self.root.after(4000, lambda: getattr(self, "lbl_exam_mouth", None) and self.lbl_exam_mouth.configure(text="Silent", fg=C["text_bright"]))
            
        if "CONTRABAND" in evt:
            self.lbl_exam_contraband.configure(text="Detected!", fg=C["error"])
            self.root.after(4000, lambda: getattr(self, "lbl_exam_contraband", None) and self.lbl_exam_contraband.configure(text="Clean", fg=C["text_bright"]))
        elif "MULTIPLE" in evt:
            self.lbl_exam_contraband.configure(text="2+ People!", fg=C["error"])
            self.root.after(4000, lambda: getattr(self, "lbl_exam_contraband", None) and self.lbl_exam_contraband.configure(text="Clean", fg=C["text_bright"]))

        clr = C["success"] if vs == 0 else C["warning"] if vs < VIOLATION_SCORE_LIMIT else C["error"]
        self.lbl_exam_violations.configure(text=f"{vs} / {VIOLATION_SCORE_LIMIT}", fg=clr)
        self.violation_canvas.delete("bar")
        cw = max(self.violation_canvas.winfo_width(), 1); frac = min(vs / VIOLATION_SCORE_LIMIT, 1.0)
        if frac > 0: self.violation_canvas.create_rectangle(0, 0, int(frac * cw), 14, fill=clr, tags="bar", outline="")
        
        if r.get("flagged"):
            self.lbl_exam_status.configure(text="⚠  FLAGGED", fg=C["danger"]); self.exam_active = False
            self.btn_exam_stop.configure(state="disabled")
            messagebox.showwarning("Flagged", f"Violations: {vs}/{VIOLATION_SCORE_LIMIT}\nExam terminated.")

    def _stop_exam(self):
        self.exam_active = False; self.proctor.stop_monitoring()
        uid = self.exam_uid.get().strip()
        _append_log({"event": "EXAM_ENDED", "user_id": uid, "timestamp": datetime.now().isoformat(), "reason": "Stopped via GUI"}, self.proctor.log_file)
        self.lbl_exam_status.configure(text="● Stopped", fg=C["text_dim"]); self.btn_exam_stop.configure(state="disabled")
        self.btn_exam_cam_start.configure(state="normal"); self.btn_exam_voice.configure(state="normal")
        self.exam_event_log.configure(text="Session ended.")

    # ─── CLEANUP ─────────────────────────────────────────────────────────
    def _on_close(self):
        self._stop_camera(); self._stop_recording_if_active()
        if self.exam_active: self.proctor.stop_monitoring()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = ProctorGUI(root)
    root.mainloop()
