# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['/Volumes/Seagate Exp/Ankit/Work/OtherProjects/Proctora/Proctora-Production/ai-engine/api.py'],
    pathex=[],
    binaries=[],
    datas=[('/Volumes/Seagate Exp/Ankit/Work/OtherProjects/Proctora/Proctora-Production/ai-engine/yolov8n.pt', 'yolov8n.pt'), ('/Volumes/Seagate Exp/Ankit/Work/OtherProjects/Proctora/Proctora-Production/ai-engine/face_landmarker.task', 'face_landmarker.task'), ('/Volumes/Seagate Exp/Ankit/Work/OtherProjects/Proctora/Proctora-Production/ai-engine/lbfmodel.yaml', 'lbfmodel.yaml'), ('/Volumes/Seagate Exp/Ankit/Work/OtherProjects/Proctora/Proctora-Production/ai-engine/proctor_db', 'proctor_db'), ('/Volumes/Seagate Exp/Ankit/Work/OtherProjects/Proctora/Proctora-Production/ai-engine/pretrained_models', 'pretrained_models')],
    hiddenimports=['uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespans', 'uvicorn.lifespans.on', 'fastapi', 'ultralytics', 'cv2', 'mediapipe', 'soundfile', 'scipy', 'scipy.signal', 'scipy.spatial.transform._rotation_groups', 'torch', 'torchvision', 'torchaudio'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='proctora-ai',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='proctora-ai',
)
