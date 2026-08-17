import sys

try:
    content = open('api.py', 'r', encoding='utf-8').read()
except FileNotFoundError:
    print("api.py not found.")
    sys.exit(1)

old_api = '''        # 2. Persons / Gaze / Mouth
        if proctor._haar is not None:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = proctor._haar.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=3, minSize=(60, 60))
            
            if len(faces) > 1:
                analysis["multiple_persons"] = True
            elif len(faces) == 1 and getattr(proctor, 'facemark', None):
                ok, lmarks = proctor.facemark.fit(gray, faces)
                if ok and len(lmarks) > 0:
                    landmarks = lmarks[0][0]
                    h, w, _ = frame.shape
                    
                    analysis["gaze_away"] = proctor._check_gaze(landmarks, w, h)
                    analysis["mouth_movement"] = proctor._check_mouth(landmarks)'''

new_api = '''        # 2. Persons / Gaze / Mouth
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_stats = proctor._analyze_mediapipe(rgb)
        
        if mp_stats["face_count"] > 1:
            analysis["multiple_persons"] = True
        else:
            analysis["gaze_away"] = mp_stats["gaze_away"]
            analysis["mouth_movement"] = mp_stats["mouth_open"]'''

content = content.replace(old_api, new_api)

with open('api.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Successfully rewrote api.py')
