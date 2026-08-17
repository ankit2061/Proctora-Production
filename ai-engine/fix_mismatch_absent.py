import sys
import re

try:
    content = open('exam_proctor.py', 'r', encoding='utf-8').read()
except FileNotFoundError:
    print("exam_proctor.py not found.")
    sys.exit(1)

# Overhaul _monitor_loop
loop_regex = r'    def _monitor_loop\(self, user_id, check_interval, callback=None\):.*?    # ─── CLI-oriented convenience methods'

monitor_new = '''    def _monitor_loop(self, user_id, check_interval, callback=None):
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

    # ─── CLI-oriented convenience methods'''

content = re.sub(loop_regex, monitor_new, content, flags=re.DOTALL)

with open('exam_proctor.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Successfully fixed exam_proctor.py for strict mismatch and absent checks')
