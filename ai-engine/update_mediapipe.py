import sys
import re

try:
    content = open('exam_proctor.py', 'r', encoding='utf-8').read()
except FileNotFoundError:
    print("exam_proctor.py not found.")
    sys.exit(1)

old_init = '''        # MediaPipe Setup for zero-latency face tracking
        import mediapipe as mp
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        logger.info("MediaPipe FaceMesh loaded ✓")'''

new_init = '''        # MediaPipe Setup for zero-latency face tracking
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        
        base_options = python.BaseOptions(model_asset_path='face_landmarker.task')
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=True,
            num_faces=2)
        self.face_mesh = vision.FaceLandmarker.create_from_options(options)
        self.mp = mp
        logger.info("MediaPipe FaceLandmarker loaded ✓")'''

content = content.replace(old_init, new_init)


old_detect = '''    def detect_face_in_frame(self, frame: np.ndarray) -> bool:
        """Quick layout check via MediaPipe: is there at least one face?"""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = self.face_mesh.process(rgb)
        return res.multi_face_landmarks is not None'''

new_detect = '''    def detect_face_in_frame(self, frame: np.ndarray) -> bool:
        """Quick layout check via MediaPipe: is there at least one face?"""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        res = self.face_mesh.detect(mp_image)
        return len(res.face_landmarks) > 0'''
content = content.replace(old_detect, new_detect)

old_analyze = '''    def _analyze_mediapipe(self, rgb_frame) -> dict:
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
        
        landmarks = results.multi_face_landmarks[0].landmark'''

new_analyze = '''    def _analyze_mediapipe(self, rgb_frame) -> dict:
        mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb_frame)
        results = self.face_mesh.detect(mp_image)
        h, w, _ = rgb_frame.shape
        
        analysis = {
            "face_count": 0,
            "gaze_away": False,
            "mouth_open": False
        }
        
        if not results.face_landmarks:
            analysis["gaze_away"] = True 
            return analysis
            
        analysis["face_count"] = len(results.face_landmarks)
        
        landmarks = results.face_landmarks[0]'''

content = content.replace(old_analyze, new_analyze)

with open('exam_proctor.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Successfully fixed MediaPipe in exam_proctor.py')
