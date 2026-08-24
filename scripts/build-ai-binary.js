#!/usr/bin/env node

/**
 * Cross-Platform PyInstaller Bundler for Proctora AI Engine
 * ─────────────────────────────────────────────────────────
 * Bundles ai-engine/api.py into a standalone binary distribution
 * (ai-engine/dist/proctora-ai) containing Python runtime, PyTorch,
 * MediaPipe, and YOLOv8 weights so clean client machines need ZERO
 * Python or PyTorch installed.
 */

import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const aiDir = path.join(rootDir, 'ai-engine');

const isWindows = process.platform === 'win32';
const pathSep = isWindows ? ';' : ':';

function findPythonCommand() {
  // 0. Check explicit environment variables (e.g. from CI actions/setup-python or custom PYTHON env)
  if (process.env.PYTHON && fs.existsSync(process.env.PYTHON)) {
    return { cmd: process.env.PYTHON, args: [] };
  }
  if (process.env.pythonLocation) {
    const candidate = isWindows
      ? path.join(process.env.pythonLocation, 'python.exe')
      : path.join(process.env.pythonLocation, 'bin', 'python');
    if (fs.existsSync(candidate)) {
      return { cmd: candidate, args: [] };
    }
  }

  // 1. Check local virtual environments inside ai-engine or root
  const venvCandidates = isWindows
    ? [
        path.join(aiDir, '.venv', 'Scripts', 'python.exe'),
        path.join(aiDir, 'venv', 'Scripts', 'python.exe'),
        path.join(rootDir, '.venv', 'Scripts', 'python.exe'),
        path.join(rootDir, 'venv', 'Scripts', 'python.exe')
      ]
    : [
        path.join(aiDir, '.venv', 'bin', 'python'),
        path.join(aiDir, 'venv', 'bin', 'python'),
        path.join(rootDir, '.venv', 'bin', 'python'),
        path.join(rootDir, 'venv', 'bin', 'python')
      ];

  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        execSync(`"${candidate}" --version`, { stdio: 'ignore' });
        return { cmd: candidate, args: [] };
      } catch {
        // search next candidate
      }
    }
  }

  // 2. Check active system python in PATH (configured by setup-python / venv)
  const systemCandidates = isWindows
    ? [
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] },
        { cmd: 'py', args: ['-3.11'] },
        { cmd: 'py', args: ['-3'] }
      ]
    : [
        { cmd: 'python3', args: [] },
        { cmd: 'python', args: [] }
      ];

  for (const { cmd, args } of systemCandidates) {
    try {
      execSync(`${cmd} ${args.join(' ')} --version`, { stdio: 'ignore' });
      return { cmd, args };
    } catch {
      // search next candidate
    }
  }

  return isWindows ? { cmd: 'python', args: [] } : { cmd: 'python3', args: [] };
}

const python = findPythonCommand();
console.log(`🔨 [Proctora AI Bundler] Using Python: ${python.cmd} ${python.args.join(' ')}`);

// Ensure PyInstaller is installed in the active environment
try {
  const pyinstallerCheck = python.args.length > 0
    ? `${python.cmd} ${python.args.join(' ')} -m PyInstaller --version`
    : `"${python.cmd}" -m PyInstaller --version`;
  execSync(pyinstallerCheck, { stdio: 'ignore', cwd: aiDir });
  console.log('✅ [Proctora AI Bundler] PyInstaller detected.');
} catch {
  console.log('📦 [Proctora AI Bundler] Installing PyInstaller in Python environment...');
  const pipInstall = python.args.length > 0
    ? `${python.cmd} ${python.args.join(' ')} -m pip install pyinstaller`
    : `"${python.cmd}" -m pip install pyinstaller`;
  execSync(pipInstall, { stdio: 'inherit', cwd: aiDir });
}

// Prepare model assets list for packaging
const addDataArgs = [];
const assetsToInclude = [
  'yolov8n.pt',
  'face_landmarker.task',
  'lbfmodel.yaml',
  'proctor_db',
  'pretrained_models'
];

for (const asset of assetsToInclude) {
  const assetPath = path.join(aiDir, asset);
  if (fs.existsSync(assetPath)) {
    addDataArgs.push(`--add-data=${assetPath}${pathSep}${asset}`);
  }
}

// Hidden imports for uvicorn, torch, and computer vision stack
const hiddenImports = [
  'uvicorn',
  'uvicorn.logging',
  'uvicorn.loops',
  'uvicorn.loops.auto',
  'uvicorn.protocols',
  'uvicorn.protocols.http',
  'uvicorn.protocols.http.auto',
  'uvicorn.protocols.websockets',
  'uvicorn.protocols.websockets.auto',
  'uvicorn.lifespans',
  'uvicorn.lifespans.on',
  'fastapi',
  'ultralytics',
  'cv2',
  'mediapipe',
  'soundfile',
  'scipy',
  'scipy.signal',
  'scipy.spatial.transform._rotation_groups',
  'torch',
  'torchvision',
  'torchaudio'
];

const hiddenImportArgs = hiddenImports.map(pkg => `--hidden-import=${pkg}`);

// Package data & metadata collection for Ultralytics YOLO, OpenCV, and MediaPipe
const collectArgs = [
  '--collect-all=ultralytics',
  '--collect-all=cv2',
  '--collect-all=mediapipe',
  '--copy-metadata=torch',
  '--copy-metadata=torchvision',
  '--copy-metadata=tqdm',
  '--copy-metadata=requests'
];

const pyinstallerArgs = [
  ...python.args,
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--onedir',
  '--name=proctora-ai',
  '--clean',
  `--distpath=${path.join(aiDir, 'dist')}`,
  `--workpath=${path.join(aiDir, 'build')}`,
  `--specpath=${aiDir}`,
  ...addDataArgs,
  ...hiddenImportArgs,
  ...collectArgs,
  path.join(aiDir, 'api.py')
];

console.log(`🚀 [Proctora AI Bundler] Running PyInstaller...`);

const child = spawn(python.cmd, pyinstallerArgs, {
  cwd: aiDir,
  stdio: 'inherit'
});

child.on('error', (err) => {
  console.error(`❌ [PyInstaller Error]: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(`\n🎉 [Proctora AI Bundler] Successfully bundled standalone AI engine!`);
    console.log(`📁 Distribution output: ${path.join(aiDir, 'dist', 'proctora-ai')}`);
  } else {
    console.error(`\n❌ [Proctora AI Bundler] PyInstaller failed with code ${code}`);
  }
  process.exit(code || 0);
});
