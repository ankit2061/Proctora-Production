#!/usr/bin/env node

/**
 * Cross-Platform Python AI Engine Runner
 * ──────────────────────────────────────
 * Automatically resolves the correct Python 3 executable on Windows, macOS, and Linux,
 * checking local virtual environments (.venv/venv), Windows Python launcher (py -3),
 * python, and python3, and runs the FastAPI AI Engine on port 5001.
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const aiDir = path.join(rootDir, 'ai-engine');

const isWindows = process.platform === 'win32';

function findPythonCommand() {
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
        // Continue searching candidates
      }
    }
  }

  // 2. Check standard system commands
  const systemCandidates = isWindows
    ? [
        { cmd: 'py', args: ['-3'] },
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] }
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
      // Continue searching candidates
    }
  }

  // Fallback
  return isWindows ? { cmd: 'python', args: [] } : { cmd: 'python3', args: [] };
}

const isCheckOnly = process.argv.includes('--check');
const python = findPythonCommand();

if (isCheckOnly) {
  console.log(`[Python AI Launcher] Detected: ${python.cmd} ${python.args.join(' ')}`);
  process.exit(0);
}

console.log(`🚀 [Proctora AI Engine] Launching via ${python.cmd} in ${aiDir}...`);

const targetScript = path.join(aiDir, 'api.py');
const spawnArgs = [...python.args, targetScript];

const child = spawn(python.cmd, spawnArgs, {
  cwd: aiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PORT: process.env.PORT || '5001'
  }
});

child.on('error', (err) => {
  console.error(`❌ [AI Engine Launch Error]: ${err.message}`);
  console.error(`Please ensure Python 3.10+ is installed and dependencies are satisfied:`);
  console.error(`cd ai-engine && pip install -r requirements.txt`);
  process.exit(1);
});

child.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.warn(`[AI Engine] Process exited with code ${code}`);
  }
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
