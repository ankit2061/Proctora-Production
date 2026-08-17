import sys
import re

try:
    content = open('exam_proctor.py', 'r', encoding='utf-8').read()
except FileNotFoundError:
    print("exam_proctor.py not found.")
    sys.exit(1)

# 1. Update Thresholds
content = content.replace('FACE_COSINE_THRESHOLD  = 0.60', 'FACE_COSINE_THRESHOLD  = 0.68')

# 2. Update Initialization
init_old = '''        # Haar cascade for quick face-presence checks
        self._haar = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        
        # Initialize Watcher Models (OpenCV FaceMark & YOLOv8)
        try:
            self.facemark = cv2.face.createFacemarkLBF()
            if not os.path.exists("lbfmodel.yaml"):
                logger.info("Downloading OpenCV facemark model (lbfmodel.yaml) - 54MB...")
                import urllib.request
                urllib.request.urlretrieve("https://raw.githubusercontent.com/kurnianggoro/GSOC2017/master/data/lbfmodel.yaml", "lbfmodel.yaml")
            self.facemark.loadModel("lbfmodel.yaml")
            logger.info("OpenCV FaceMark LBF loaded ✓")
        except Exception as e:
            logger.error(f"Failed to load OpenCV FaceMark: {e}")
            self.facemark = None

        try:
            from ultralytics import YOLO
            self.yolo = YOLO("yolov8n.pt")
            logger.info("YOLOv8 Contraband detector loaded ✓")
        except Exception as e:
            logger.error(f"Failed to load YOLOv8: {e}")
            self.yolo = None'''

init_new = '''        # MediaPipe Setup for zero-latency face tracking
        import mediapipe as mp
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        logger.info("MediaPipe FaceMesh loaded ✓")
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
            self.dino = None'''
content = content.replace(init_old, init_new)

# 3. Update detect_face_in_frame
df_old = '''    def detect_face_in_frame(self, frame: np.ndarray) -> bool:
        """Quick Haar-cascade check: is there at least one face in the frame?"""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self._haar.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=3,
                                             minSize=(60, 60))
        return len(faces) > 0'''

df_new = '''    def detect_face_in_frame(self, frame: np.ndarray) -> bool:
        """Quick layout check via MediaPipe: is there at least one face?"""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = self.face_mesh.process(rgb)
        return res.multi_face_landmarks is not None'''
content = content.replace(df_old, df_new)

# 4. Update ArcFace inside extract_face_vec
content = content.replace('model_name="Facenet",', 'model_name="ArcFace",')

# 5. Overhaul Vision Helpers
vision_old = '''    def _check_gaze(self, landmarks, frame_width, frame_height) -> bool:
        """
        Returns True if the user is looking away from the screen.
        Uses head pose heuristic from 68 landmarks: compares distance 
        from nose tip (30) to left cheek (0) and right cheek (16).
        """
        nose = landmarks[30]
        left_cheek = landmarks[0]
        right_cheek = landmarks[16]
        
        # Calculate horizontal distances
        dist_left = abs(nose[0] - left_cheek[0])
        dist_right = abs(right_cheek[0] - nose[0])
        
        if dist_left == 0 or dist_right == 0:
            return False
            
        ratio = dist_left / dist_right
        # If ratio > 2.0 or < 0.5, head is turned significantly
        if ratio > 2.5 or ratio < 0.4:
            return True
        return False

    def _check_mouth(self, landmarks) -> bool:
        """
        Returns True if the mouth is open (lip distance exceeds threshold).
        Inner lips = 62 (top), 66 (bottom).
        """
        top_inner_lip = landmarks[62]
        bottom_inner_lip = landmarks[66]
        lip_dist = abs(top_inner_lip[1] - bottom_inner_lip[1])
        
        left_eye = landmarks[36]
        right_eye = landmarks[45]
        eye_dist = abs(right_eye[0] - left_eye[0])
        
        if eye_dist == 0:
            return False
            
        return (lip_dist / eye_dist) > 0.15'''

vision_new = '''    def _analyze_mediapipe(self, rgb_frame) -> dict:
        results = self.face_mesh.process(rgb_frame)
        h, w, _ = rgb_frame.shape
        
        analysis = {
            "face_count": 0,
            "gaze_away": False,
            "mouth_open": False
        }
        
        if not results.multi_face_landmarks:
            analysis["gaze_away"] = True 
            return analysis
            
        analysis["face_count"] = len(results.multi_face_landmarks)
        
        landmarks = results.multi_face_landmarks[0].landmark
        
        # Mouth Open
        upper_lip = landmarks[13]
        lower_lip = landmarks[14]
        left_eye = landmarks[33]
        right_eye = landmarks[263]
        lip_dist = abs(upper_lip.y - lower_lip.y) * h
        eye_dist = abs(right_eye.x - left_eye.x) * w
        if lip_dist / max(eye_dist, 1) > 0.12:
            analysis["mouth_open"] = True
            
        # Gaze / Head Pose
        nose = landmarks[1]
        left_cheek = landmarks[234]
        right_cheek = landmarks[454]
        dist_left = abs(nose.x - left_cheek.x)
        dist_right = abs(right_cheek.x - nose.x)
        ratio = dist_left / max(dist_right, 0.001)
        if ratio > 2.5 or ratio < 0.4:
            analysis["gaze_away"] = True
            
        return analysis

    def _get_dino_embedding(self, frame) -> 'Optional[np.ndarray]':
        import torch
        if getattr(self, 'dino', None) is None: return None
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        tensor = self.dino_transform(rgb).unsqueeze(0).to(self.device)
        with torch.no_grad():
            features = self.dino(tensor)
        return features.cpu().numpy().flatten()'''

content = content.replace(vision_old, vision_new)

# 6. Overhaul _monitor_loop
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
        TARGET_VIOLATION_FRAMES = 6 
        
        last_heartbeat_time = time.time()
        last_fast_tick = time.time()
        yolo_check_counter = 0

        def _flag_violation(reason, score_inc=1):
            nonlocal violation_score
            violation_score += score_inc
            logger.warning(f"  WATCHER: {reason}  violations={violation_score}")
            res = {"event": reason, "user_id": user_id, "timestamp": datetime.now().isoformat(), "violation_score": violation_score, "flagged": violation_score >= VIOLATION_SCORE_LIMIT}
            _append_log(res, self.log_file)
            if callback: callback(res)

        # Heartbeat Thread (Heavy Layer 2)
        def _heartbeat_worker():
            nonlocal check_count, violation_score
            check_count += 1
            frame = cam_buffer.latest
            if frame is None: return
            
            # Layer 2: DINO Anomaly
            if getattr(self, 'dino_baseline', None) is not None:
                d_curr = self._get_dino_embedding(frame)
                if d_curr is not None:
                    d_dist = self._cosine_distance(self.dino_baseline, d_curr)
                    if d_dist > 0.4: 
                        _flag_violation("DINO_ANOMALY (Room change/objects)")
            
            # Layer 2: ArcFace Verify
            fv = self.extract_face_vec(frame, strict=True)
            face_ok = False
            face_dist = None
            event = "HEARTBEAT_OK"
            
            if fv is not None:
                face_dist = self._cosine_distance(ref_face, fv)
                face_ok = face_dist < FACE_COSINE_THRESHOLD
                if not face_ok:
                    violation_score += 1
                    event = "FACE_MISMATCH (ArcFace)"
            else:
                violation_score += 1
                event = "ABSENT_FACE"
                
            # Layer 2: Audio verify (Blocks this thread only)
            audio = self._silent_capture_audio(MONITOR_AUDIO_SECONDS, for_monitor=True)
            voice_ok = False; voice_dist = None
            if audio is not None:
                vv = self.extract_voice_vec(audio)
                if vv is not None:
                    voice_dist = self._cosine_distance(ref_voice, vv)
                    voice_ok = voice_dist < VOICE_COSINE_THRESHOLD
                    if not voice_ok:
                        violation_score += 1
                        if event == "HEARTBEAT_OK": event = "VOICE_MISMATCH"
                        
            res = {
                "event": event, "user_id": user_id, "timestamp": datetime.now().isoformat(),
                "check_number": check_count, "face_cosine_distance": round(face_dist, 4) if face_dist is not None else None,
                "voice_cosine_distance": round(voice_dist, 4) if voice_dist is not None else None,
                "face_ok": face_ok, "voice_ok": voice_ok, "violation_score": violation_score, "flagged": violation_score >= VIOLATION_SCORE_LIMIT
            }
            _append_log(res, self.log_file); 
            if callback: callback(res)

        while not self._monitor_stop.is_set():
            t_now = time.time()
            frame = cam_buffer.latest
            
            # Fast Layer 1 Loop (~10-15 FPS)
            if frame is not None and t_now - last_fast_tick > 0.08: 
                last_fast_tick = t_now
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_stats = self._analyze_mediapipe(rgb)
                
                if mp_stats["face_count"] > 1:
                    _flag_violation("MULTIPLE_PERSONS")
                    gaze_away_frames += 1
                    time.sleep(1)
                else:
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

            # Fire heartbeat 
            if t_now - last_heartbeat_time >= check_interval:
                last_heartbeat_time = t_now
                threading.Thread(target=_heartbeat_worker, daemon=True).start()
                
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
print('Successfully rewrote exam_proctor.py')
