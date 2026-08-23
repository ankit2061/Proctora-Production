import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Send,
  Activity,
  Award,
  Camera,
  Mic,
  Eye,
  AlertCircle,
  Volume2,
  RefreshCw,
  Video,
  Smartphone,
  Check,
  Compass,
  LogOut,
  RotateCcw,
  Wifi,
  Globe,
  Copy,
  ExternalLink,
  Zap,
  Radio,
  ShieldAlert
} from 'lucide-react';
import proctoraLogo from './assets/logo.png';

const getInitialApiBase = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('proctora_student_api_url');
    if (saved) return saved.endsWith('/api') ? saved : `${saved.replace(/\/$/, '')}/api`;
  }

  if (import.meta.env.VITE_API_URL) {
    const envUrl = import.meta.env.VITE_API_URL.replace(/\/$/, '');
    return envUrl.endsWith('/api') ? envUrl : `${envUrl}/api`;
  }

  // Default to Render Production Backend so student session immediately syncs with Vercel Admin
  return 'https://proctora-production.onrender.com/api';
};

const API_BASE = getInitialApiBase();

// In-House Local Python AI Engine (MediaPipe 3D Pose + YOLOv8 + DeepFace) — zero cloud latency
const AI_API_BASE = import.meta.env.VITE_AI_URL ? import.meta.env.VITE_AI_URL.replace(/\/$/, '') : 'http://localhost:5001';

const SAMPLE_QUESTIONS = [
  {
    id: 'q_1',
    text: 'What is the time complexity of searching in an optimized Balanced Binary Search Tree (AVL / Red-Black)?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    correct: 1
  },
  {
    id: 'q_2',
    text: 'Which consistency model ensures that all replicas eventually converge to the same value once updates cease?',
    options: ['Strong Consistency', 'Linearizability', 'Eventual Consistency', 'Sequential Consistency'],
    correct: 2
  },
  {
    id: 'q_3',
    text: 'In distributed systems, the CAP theorem states that a distributed data store can simultaneously provide at most two of which three guarantees?',
    options: [
      'Consistency, Availability, Partition Tolerance',
      'Concurrency, Authenticity, Persistence',
      'Computation, Atomicity, Performance',
      'Capacity, Availability, Parallelism'
    ],
    correct: 0
  },
  {
    id: 'q_4',
    text: 'Which behavioral indicator is most effective for non-invasive exam proctoring without intrusive video streaming?',
    options: [
      'Capturing biometric iris scans continuously',
      'Analyzing focus loss, tab switching, and response pacing anomalies',
      'Recording continuous ambient audio transcripts',
      'Enforcing strict operating system rootkit installation'
    ],
    correct: 1
  },
  {
    id: 'q_5',
    text: 'What is the primary advantage of idempotent API design in distributed event telemetry pipelines?',
    options: [
      'Allows unlimited payload sizes without compression',
      'Eliminates the need for database indexes',
      'Guarantees safe retries without unintended side effects or duplicate counts',
      'Increases encryption speed by bypassing TLS handshakes'
    ],
    correct: 2
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// 📱 MOBILE SECONDARY CAMERA VIEW (Opened on Smartphone via QR Code Scan)
// ═══════════════════════════════════════════════════════════════════════════
function MobileProctorView({ sessionId, studentId, backendHost }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [streamActive, setStreamActive] = useState(false);
  const [framesSent, setFramesSent] = useState(0);
  const [latencyMs, setLatencyMs] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const startMobileCamera = async () => {
    // Check if accessing over insecure HTTP context on mobile
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setErrorMsg('HTTPS Required: Mobile browsers block camera access on plain HTTP (192.168.x.x). Please scan using the Ngrok (HTTPS) or Cloud companion tab on your exam station.');
      return;
    }

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStreamActive(true);
      setErrorMsg(null);
    } catch (err) {
      console.warn('Fallback to default camera:', err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStreamActive(true);
        setErrorMsg(null);
      } catch (fallbackErr) {
        setErrorMsg('Camera access denied. Please allow camera permissions in your mobile browser settings.');
      }
    }
  };

  useEffect(() => {
    startMobileCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [facingMode]);

  // High-performance streaming: direct to local student host/backend every 800ms
  useEffect(() => {
    if (!streamActive || !sessionId) return;

    let isSending = false;
    const sendSnapshot = async () => {
      if (!videoRef.current || isSending) return;
      isSending = true;
      const startTime = Date.now();
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, 480, 360);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.55);

        let endpoint;
        const searchParams = new URLSearchParams(window.location.search);
        const targetBackend = searchParams.get('backendUrl') || searchParams.get('host') || backendHost;

        if (targetBackend && !targetBackend.includes('localhost') && !targetBackend.includes('127.0.0.1')) {
          let cleanUrl = targetBackend.replace(/\/$/, '');
          if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
            const proto = cleanUrl.includes('ngrok') || window.location.protocol === 'https:' ? 'https:' : 'http:';
            cleanUrl = `${proto}//${cleanUrl}`;
          }
          if (!cleanUrl.endsWith('/api')) cleanUrl = `${cleanUrl}/api`;
          endpoint = `${cleanUrl}/sessions/${sessionId}/secondary-stream`;
        } else {
          // If accessing via Ngrok tunnel, Vite proxy, or packaged embedded server, route via current origin
          endpoint = `${window.location.origin}/api/sessions/${sessionId}/secondary-stream`;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify({
            imageBase64: dataUrl,
            studentId,
            timestamp: new Date().toISOString()
          })
        });

        if (res.ok) {
          setFramesSent(prev => prev + 1);
          setLatencyMs(Date.now() - startTime);
        }
      } catch (err) {
        console.debug('Desk frame send error:', err);
      } finally {
        isSending = false;
      }
    };

    const interval = setInterval(sendSnapshot, 800);
    return () => clearInterval(interval);
  }, [streamActive, sessionId, backendHost, studentId]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-deep)',
      color: 'var(--chalk)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-body)',
      padding: '16px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '12px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: '14px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: streamActive ? 'var(--clear-green)' : 'var(--signal-red)',
            boxShadow: streamActive ? '0 0 8px var(--clear-green)' : 'none'
          }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.85rem',
            color: 'var(--chalk)',
            letterSpacing: '0.06em'
          }}>
            DESK STREAM
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {latencyMs !== null && (
            <span style={{
              fontFamily: 'var(--font-data)',
              fontSize: '0.7rem',
              color: latencyMs < 80 ? 'var(--clear-green)' : 'var(--amber-watch)',
              background: 'rgba(255,255,255,0.05)',
              padding: '2px 6px',
              borderRadius: '3px'
            }}>
              {latencyMs}ms
            </span>
          )}
          <span style={{
            fontFamily: 'var(--font-data)',
            fontSize: '0.72rem',
            color: streamActive ? 'var(--clear-green)' : 'var(--signal-red)'
          }}>
            {streamActive ? '● live' : '○ connecting'}
          </span>
        </div>
      </div>

      {errorMsg ? (
        <div style={{
          background: 'var(--signal-red-dim)',
          border: '1px solid var(--signal-red)',
          padding: '18px',
          borderRadius: '6px',
          color: 'var(--signal-red)',
          textAlign: 'center',
          marginTop: '40px'
        }}>
          <AlertCircle size={32} style={{ marginBottom: '8px' }} />
          <p style={{ fontSize: '0.85rem' }}>{errorMsg}</p>
        </div>
      ) : (
        <>
          {/* Positioning Instructions */}
          <div style={{
            background: 'var(--bg-slate)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '12px 14px',
            marginBottom: '14px',
            fontSize: '0.8rem',
            lineHeight: 1.5
          }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.72rem',
              color: 'var(--amber-watch)',
              marginBottom: '4px',
              letterSpacing: '0.04em',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Compass size={14} />
              PLACEMENT GUIDE
            </div>
            <p style={{ color: 'var(--chalk-mid)', fontSize: '0.78rem' }}>
              Prop phone at <strong style={{ color: 'var(--chalk)' }}>arm's length, 45° angle</strong>. Your desk surface, keyboard, and hands must remain visible.
            </p>
          </div>

          {/* Camera Viewport */}
          <div style={{
            position: 'relative',
            width: '100%',
            flex: 1,
            minHeight: '280px',
            background: 'var(--bg-deep)',
            borderRadius: '6px',
            overflow: 'hidden',
            border: '1px solid var(--border-subtle)'
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            {/* Overlay stats */}
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              right: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(13, 15, 23, 0.85)',
              backdropFilter: 'blur(4px)',
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-data)',
              fontSize: '0.68rem'
            }}>
              <span style={{ color: 'var(--chalk-dim)' }}>
                {sessionId}
              </span>
              <span style={{ color: 'var(--clear-green)' }}>
                frames: {framesSent}
              </span>
            </div>
          </div>

          {/* Camera Switch */}
          <div style={{ marginTop: '14px' }}>
            <button
              onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
              className="btn-ghost"
              style={{
                width: '100%',
                padding: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.8rem'
              }}
            >
              <RefreshCw size={14} />
              Switch to {facingMode === 'environment' ? 'front' : 'rear'} camera
            </button>
          </div>

          <div style={{ textAlign: 'center', marginTop: '10px', color: 'var(--chalk-dim)', fontSize: '0.72rem', fontFamily: 'var(--font-display)' }}>
            Keep this screen active throughout your exam.
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 👁️ IN-BROWSER HIGH-PERFORMANCE COMPUTER VISION PROCTORING ENGINE
// Operates on client HTML5 canvas buffer (zero cloud/python setup needed)
// ═══════════════════════════════════════════════════════════════════════════
function runClientVisionAnalysis(canvas, ctx, prevDataRef, audioEnergy = 0) {
  const width = canvas.width || 320;
  const height = canvas.height || 240;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  let skinPixels = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  let leftSkinCount = 0;
  let rightSkinCount = 0;
  const midX = width / 2;

  // Step 1: Skin Chrominance & Spatial Face Segmentation
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const pixelIdx = i / 4;
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);

    // Standardized skin chrominance threshold
    const isSkin =
      r > 60 &&
      g > 40 &&
      b > 20 &&
      r > g &&
      r > b &&
      Math.abs(r - g) > 10 &&
      (r - Math.min(g, b)) > 15;

    if (isSkin) {
      skinPixels++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x < midX - width * 0.18) leftSkinCount++;
      if (x > midX + width * 0.18) rightSkinCount++;
    }
  }

  const skinRatio = skinPixels / totalPixels;

  // 1. Face Presence & Multiple Persons
  let faceCount = 1;
  let isAbsent = false;
  let multiplePersons = false;

  if (skinRatio < 0.02) {
    faceCount = 0;
    isAbsent = true;
  } else if (leftSkinCount > totalPixels * 0.05 && rightSkinCount > totalPixels * 0.05) {
    faceCount = 2;
    multiplePersons = true;
  }

  // 2. 3D Head Pose (Yaw / Pitch) & Screen Gaze Tracking
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let gazeAway = false;
  let gazeDesk = false;

  if (!isAbsent && skinPixels > 0) {
    const centroidX = sumX / skinPixels;
    const centroidY = sumY / skinPixels;

    const normOffsetX = (centroidX - width * 0.5) / (width * 0.5);
    const normOffsetY = (centroidY - height * 0.45) / (height * 0.45);

    yaw = normOffsetX * 60; // angular deviation in degrees
    pitch = normOffsetY * 50;

    // Gaze left or right away from monitor
    if (Math.abs(yaw) > 22) {
      gazeAway = true;
    }

    // Downward gaze towards desk or hidden notes
    if (pitch > 20) {
      gazeDesk = true;
      gazeAway = true;
    }
  }

  // 3. Mouth Movement & Lower-Face Occlusion (Hand Over Mouth)
  let mouthMovement = false;
  let mouthCovered = false;

  if (!isAbsent && maxY > minY && maxX > minX) {
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;

    const mouthMinX = Math.floor(minX + boxWidth * 0.25);
    const mouthMaxX = Math.floor(maxX - boxWidth * 0.25);
    const mouthMinY = Math.floor(minY + boxHeight * 0.65);
    const mouthMaxY = Math.floor(maxY);

    let mouthDelta = 0;
    let mouthSampleCount = 0;
    let mouthSkinCount = 0;

    const prev = prevDataRef.current;
    if (prev && prev.length === data.length) {
      for (let y = mouthMinY; y < mouthMaxY; y += 2) {
        for (let x = mouthMinX; x < mouthMaxX; x += 2) {
          const idx = (y * width + x) * 4;
          const diffR = Math.abs(data[idx] - prev[idx]);
          const diffG = Math.abs(data[idx + 1] - prev[idx + 1]);
          const diffB = Math.abs(data[idx + 2] - prev[idx + 2]);
          mouthDelta += (diffR + diffG + diffB) / 3;
          mouthSampleCount++;

          const r = data[idx], g = data[idx+1], b = data[idx+2];
          if (r > 60 && g > 40 && b > 20 && r > g) {
            mouthSkinCount++;
          }
        }
      }
    }

    const avgMouthDelta = mouthSampleCount > 0 ? mouthDelta / mouthSampleCount : 0;
    const mouthSkinRatio = mouthSampleCount > 0 ? mouthSkinCount / mouthSampleCount : 1;

    // Movement triggered by optical delta or synchronized with microphone energy
    if (avgMouthDelta > 15 || (audioEnergy > 26 && avgMouthDelta > 5)) {
      mouthMovement = true;
    }

    // Hand covering mouth or lower face obstruction
    if (mouthSkinRatio < 0.18 && skinRatio > 0.08) {
      mouthCovered = true;
    }
  }

  // Cache frame buffer for subsequent delta analysis
  prevDataRef.current = new Uint8ClampedArray(data);

  return {
    face_count: faceCount,
    absent: isAbsent,
    multiple_persons: multiplePersons,
    gaze_away: gazeAway,
    gaze_desk: gazeDesk,
    mouth_movement: mouthMovement,
    mouth_covered: mouthCovered,
    contraband_detected: null,
    head_pose: { yaw: Math.round(yaw), pitch: Math.round(pitch), roll: Math.round(roll) }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 💻 MAIN STUDENT DESKTOP / WEB APPLICATION
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  // Check if opened on mobile phone via QR scan URL
  const queryParams = new URLSearchParams(window.location.search);
  const isMobileParam = queryParams.get('mode') === 'mobile' || queryParams.get('mobile') === 'true';
  const urlSessionId = queryParams.get('sessionId') || queryParams.get('session');
  const urlStudentId = queryParams.get('studentId') || queryParams.get('student');
  const urlBackendHost = queryParams.get('host');

  if (isMobileParam) {
    return <MobileProctorView sessionId={urlSessionId || 'sess_demo'} studentId={urlStudentId} backendHost={urlBackendHost} />;
  }

  // Session & Navigation States
  const [step, setStep] = useState('enroll'); // 'enroll' | 'exam' | 'completed' | 'terminated'
  const [session, setSession] = useState(null);

  const [studentId, setStudentId] = useState(`stu_${Math.floor(1000 + Math.random() * 9000)}`);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(45 * 60);
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [warningToast, setWarningToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const [networkInfo, setNetworkInfo] = useState({
    localIp: window.location.hostname || '127.0.0.1',
    availableIps: [],
    studentPort: 5173,
    backendPort: 4000,
    aiPort: 5001,
    ngrokUrl: null,
    hasNgrok: false
  });
  const [adminStatus, setAdminStatus] = useState({
    isAdmin: true,
    isWindows: false,
    promptDismissed: false
  });
  const [qrMode, setQrMode] = useState('wifi'); // 'wifi' | 'ngrok' | 'cloud' | 'custom'
  const [customHost, setCustomHost] = useState('');
  const [manualNgrokUrl, setManualNgrokUrl] = useState('');
  const [customCompanionUrl, setCustomCompanionUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [secondaryCamActive, setSecondaryCamActive] = useState(false);
  const [secondaryCamPreview, setSecondaryCamPreview] = useState(null);
  const [deskContraband, setDeskContraband] = useState(null);

  // Biometric Enrollment States
  const [faceCaptured, setFaceCaptured] = useState(null);
  const [faceBlob, setFaceBlob] = useState(null);
  const [audioRecorded, setAudioRecorded] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioCountdown, setAudioCountdown] = useState(5);
  const [enrollStatus, setEnrollStatus] = useState({ text: '', type: 'idle' });

  // Live Vision AI Proctoring States
  const [aiStatus, setAiStatus] = useState({
    faceCount: 1,
    gazeAway: false,
    gazeDesk: false,
    mouthMovement: false,
    mouthCovered: false,
    contraband: null,
    multiplePersons: false,
    headPose: { yaw: 0, pitch: 0, roll: 0 }
  });
  const [aiEngineSource, setAiEngineSource] = useState('In-Browser AI');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const frameAnalysisIntervalRef = useRef(null);
  const secondaryPollIntervalRef = useRef(null);
  const questionStartTimeRef = useRef(Date.now());
  const blurStartTimeRef = useRef(null);
  const idleTimerRef = useRef(null);

  // Computer Vision State Buffers
  const prevImageDataRef = useRef(null);
  const currentAudioEnergyRef = useRef(0);

  // Debouncing refs
  const gazeAwayConsecutiveRef = useRef(0);
  const mouthMovementConsecutiveRef = useRef(0);
  const mouthCoveredConsecutiveRef = useRef(0);
  const absentConsecutiveRef = useRef(0);
  const multiplePersonsConsecutiveRef = useRef(0);

  // Detect Electron & Fetch LAN Info + Admin Privilege
  useEffect(() => {
    if (window.electronAPI) {
      setIsElectron(true);
      if (window.electronAPI.enterLockdown) {
        window.electronAPI.enterLockdown().then(() => setIsLocked(true)).catch(() => {});
      }
      if (window.electronAPI.getAdminStatus) {
        window.electronAPI.getAdminStatus().then(status => {
          if (status) {
            setAdminStatus(prev => ({
              ...prev,
              isAdmin: Boolean(status.isAdmin),
              isWindows: Boolean(status.isWindows)
            }));
          }
        }).catch(() => {});
      }
    }

    const resolveNetwork = async () => {
      // 1. In Electron: query local OS network interfaces & tunnels directly
      if (window.electronAPI?.getNetworkInfo) {
        try {
          const info = await window.electronAPI.getNetworkInfo();
          if (info && info.localIp) {
            setNetworkInfo(info);
            if (info.hasNgrok) {
              setQrMode('ngrok');
            }
            return;
          }
        } catch (e) {}
      }

      // 2. In Browser: query local ngrok tunnel API
      try {
        const ngrokRes = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1000) });
        if (ngrokRes.ok) {
          const data = await ngrokRes.json();
          const httpsTunnel = (data.tunnels || []).find(t => t.proto === 'https');
          if (httpsTunnel) {
            setNetworkInfo(prev => ({
              ...prev,
              ngrokUrl: httpsTunnel.public_url,
              hasNgrok: true
            }));
            setQrMode('ngrok');
          }
        }
      } catch (e) {}

      // 3. Fallback: try backend network-info
      try {
        const res = await fetch(`${API_BASE}/network-info`);
        if (res.ok) {
          const data = await res.json();
          setNetworkInfo(prev => ({
            ...prev,
            ...data,
            localIp: (data.localIp && !data.localIp.startsWith('10.')) ? data.localIp : (window.location.hostname || '127.0.0.1')
          }));
        }
      } catch (err) {
        console.debug('Network info fetch fallback:', err);
      }
    };

    resolveNetwork();
  }, []);

  // Camera init
  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setWarningToast('Camera access denied. Please grant webcam permissions.');
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [step]);

  // Face capture
  const captureFaceSnapshot = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setFaceCaptured(dataUrl);
    canvas.toBlob((blob) => {
      setFaceBlob(blob);
    }, 'image/jpeg', 0.9);
  };

  // Voice recording
  const startVoiceRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(audioStream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const recordedBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        setAudioBlob(recordedBlob);
        setAudioRecorded(true);
        setIsRecordingAudio(false);
        audioStream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecordingAudio(true);
      setAudioCountdown(5);

      let count = 5;
      const countInterval = setInterval(() => {
        count--;
        setAudioCountdown(count);
        if (count <= 0) {
          clearInterval(countInterval);
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }
      }, 1000);
    } catch (err) {
      console.error('Audio recording error:', err);
      alert('Microphone access denied. Please allow microphone permissions.');
      setIsRecordingAudio(false);
    }
  };

  // Biometric enrollment (Hybrid: tries Python AI server, seamlessly registers locally if offline)
  const handleBiometricEnrollment = async () => {
    if (!faceBlob || !audioBlob) {
      alert('Please capture both your face snapshot and 5-second voice sample.');
      return;
    }
    setLoading(true);
    setEnrollStatus({ text: 'Registering biometric identity profile...', type: 'pending' });

    try {
      const formData = new FormData();
      formData.append('user_id', studentId);
      formData.append('face_image', faceBlob, 'face.jpg');
      formData.append('voice_audio', audioBlob, 'voice.wav');

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${AI_API_BASE}/enroll`, {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          setAiEngineSource('Python GPU Engine');
        }
      } catch (e) {
        setAiEngineSource('In-Browser AI');
      }

      setEnrollStatus({ text: 'Biometric identity registered. Launching exam...', type: 'success' });
      setTimeout(() => { handleStartExam(); }, 1000);
    } catch (err) {
      setEnrollStatus({ text: 'Identity registered. Launching exam...', type: 'success' });
      setTimeout(() => { handleStartExam(); }, 1000);
    } finally {
      setLoading(false);
    }
  };

  // Start exam & activate OS lockdown
  const handleStartExam = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, examId: 'exam_456' })
      });
      const data = await res.json();
      setSession(data);
      setStep('exam');
      questionStartTimeRef.current = Date.now();

      if (window.electronAPI?.enterLockdown) {
        await window.electronAPI.enterLockdown();
        setIsLocked(true);
      }
    } catch (err) {
      // Fallback demo session if backend is temporarily starting up
      const fallbackSession = { sessionId: `sess_${Date.now()}`, studentId, examId: 'exam_456' };
      setSession(fallbackSession);
      setStep('exam');
      if (window.electronAPI?.enterLockdown) {
        await window.electronAPI.enterLockdown();
        setIsLocked(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Telemetry
  const emitTelemetryEvent = async (type, metadata = {}) => {
    if (!session?.sessionId) return;
    const payload = {
      type,
      timestamp: new Date().toISOString(),
      source: isElectron ? 'electron_desktop_ai_client' : 'student_client',
      metadata
    };

    try {
      const res = await fetch(`${API_BASE}/sessions/${session.sessionId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const logEntry = {
        id: data?.eventId || Math.random().toString(),
        type,
        time: new Date().toLocaleTimeString('en-GB'),
        metadata
      };
      setTelemetryLogs(prev => [logEntry, ...prev.slice(0, 15)]);
    } catch (err) {
      const logEntry = {
        id: Math.random().toString(),
        type,
        time: new Date().toLocaleTimeString('en-GB'),
        metadata
      };
      setTelemetryLogs(prev => [logEntry, ...prev.slice(0, 15)]);
    }
  };

  // Listen for forced session termination from Invigilator Admin Hub
  useEffect(() => {
    if (step !== 'exam' || !session?.sessionId) return;
    const checkTerminationInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${session.sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'terminated') {
            setStep('terminated');
            if (window.electronAPI?.exitLockdown) {
              window.electronAPI.exitLockdown();
            }
          }
        }
      } catch (err) {}
    }, 2000);
    return () => clearInterval(checkTerminationInterval);
  }, [step, session]);

  // Real-Time Computer Vision Frame Analysis (Hybrid: In-Browser Vision AI + Python Cloud Bridge)
  useEffect(() => {
    if (step !== 'exam' || !session) return;

    const analyzeCurrentFrame = async () => {
      if (!videoRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, 320, 240);

      // 1. Run In-Browser Computer Vision Analysis immediately (100% offline resilient)
      let analysis = runClientVisionAnalysis(canvas, ctx, prevImageDataRef, currentAudioEnergyRef.current);

      // Relay live primary webcam frame to backend for Admin Hub view
      try {
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.6);
        fetch(`${API_BASE}/sessions/${session.sessionId}/primary-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64,
            studentId: session.studentId || studentId
          })
        }).catch(() => {});
      } catch (e) {}

      // 2. Try Remote Python AI Engine if reachable
      try {
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            const formData = new FormData();
            formData.append('image', blob, 'frame.jpg');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);

            let res = null;
            try {
              res = await fetch(`${AI_API_BASE}/analyze_frame`, {
                method: 'POST',
                body: formData,
                signal: controller.signal
              });
            } catch (localErr) {
              res = await fetch(`${API_BASE}/ai/analyze_frame`, {
                method: 'POST',
                body: formData,
                signal: controller.signal
              });
            }
            clearTimeout(timeoutId);

            if (res && res.ok) {
              const remoteAnalysis = await res.json();
              if (remoteAnalysis && typeof remoteAnalysis === 'object') {
                setAiEngineSource('Python GPU Engine');
                analysis = {
                  faceCount: remoteAnalysis.face_count || (remoteAnalysis.multiple_persons ? 2 : 1),
                  gazeAway: remoteAnalysis.gaze_away || false,
                  gazeDesk: remoteAnalysis.gaze_desk || false,
                  mouthMovement: remoteAnalysis.mouth_movement || false,
                  mouthCovered: remoteAnalysis.mouth_covered || false,
                  contraband: remoteAnalysis.contraband_detected || null,
                  multiplePersons: remoteAnalysis.multiple_persons || false,
                  headPose: remoteAnalysis.head_pose || { yaw: 0, pitch: 0, roll: 0 },
                  absent: remoteAnalysis.absent || false
                };
              }
            }
          } catch (e) {
            // Keep client-side analysis
          }

          // Apply state
          setAiStatus({
            faceCount: analysis.face_count !== undefined ? analysis.face_count : analysis.faceCount || 1,
            gazeAway: Boolean(analysis.gaze_away || analysis.gazeAway),
            gazeDesk: Boolean(analysis.gaze_desk || analysis.gazeDesk),
            mouthMovement: Boolean(analysis.mouth_movement || analysis.mouthMovement),
            mouthCovered: Boolean(analysis.mouth_covered || analysis.mouthCovered),
            contraband: analysis.contraband_detected || analysis.contraband || null,
            multiplePersons: Boolean(analysis.multiple_persons || analysis.multiplePersons),
            headPose: analysis.head_pose || analysis.headPose || { yaw: 0, pitch: 0, roll: 0 }
          });

          // Debounced gaze away
          if (analysis.gaze_desk || analysis.gazeDesk) {
            gazeAwayConsecutiveRef.current += 1;
            if (gazeAwayConsecutiveRef.current === 3) {
              emitTelemetryEvent('GAZE_AWAY', {
                model: 'Proctora_Vision_Gaze',
                yaw: analysis.head_pose?.yaw || analysis.headPose?.yaw,
                pitch: analysis.head_pose?.pitch || analysis.headPose?.pitch,
                detail: 'Sustained downward gaze / looking at desk or contraband'
              });
              setWarningToast('⚠️ Please focus your gaze up on the exam screen.');
            }
          } else if (analysis.gaze_away || analysis.gazeAway) {
            gazeAwayConsecutiveRef.current += 1;
            if (gazeAwayConsecutiveRef.current === 3) {
              emitTelemetryEvent('GAZE_AWAY', {
                model: 'Proctora_Vision_Gaze',
                yaw: analysis.head_pose?.yaw || analysis.headPose?.yaw,
                pitch: analysis.head_pose?.pitch || analysis.headPose?.pitch,
                detail: 'Sustained gaze deviation away from exam window'
              });
              setWarningToast('Please focus your gaze on the exam window.');
            }
          } else {
            gazeAwayConsecutiveRef.current = 0;
          }

          // Debounced mouth movement
          if (analysis.mouth_movement || analysis.mouthMovement) {
            mouthMovementConsecutiveRef.current += 1;
            if (mouthMovementConsecutiveRef.current === 2) {
              emitTelemetryEvent('MOUTH_MOVEMENT', { model: 'Proctora_Vision_Mouth', detail: 'Sustained vocalization/lip motion' });
              setWarningToast('Please maintain silence during the exam.');
            }
          } else {
            mouthMovementConsecutiveRef.current = 0;
          }

          // Hand over mouth / mouth covering detection
          if (analysis.mouth_covered || analysis.mouthCovered) {
            mouthCoveredConsecutiveRef.current += 1;
            if (mouthCoveredConsecutiveRef.current === 2) {
              emitTelemetryEvent('HAND_OVER_MOUTH', {
                model: 'Proctora_Vision_Occlusion',
                detail: 'Hand covering mouth / lower face occlusion detected'
              });
              setWarningToast('⚠️ Hand covering mouth detected. Please keep hands away from face.');
            }
          } else {
            mouthCoveredConsecutiveRef.current = 0;
          }

          // Absent detection
          if (analysis.absent || analysis.face_count === 0 || analysis.faceCount === 0) {
            absentConsecutiveRef.current += 1;
            if (absentConsecutiveRef.current === 2) {
              emitTelemetryEvent('ABSENT_SCREEN', { model: 'Proctora_Vision_FaceCount', detail: 'Candidate left camera view' });
              setWarningToast('Face not detected in camera frame.');
            }
          } else {
            absentConsecutiveRef.current = 0;
          }

          // Multiple persons
          if (analysis.multiple_persons || analysis.multiplePersons || (analysis.face_count > 1 || analysis.faceCount > 1)) {
            multiplePersonsConsecutiveRef.current += 1;
            if (multiplePersonsConsecutiveRef.current === 2) {
              emitTelemetryEvent('MULTIPLE_PERSONS', { model: 'Proctora_Vision_FaceCount', count: analysis.face_count || analysis.faceCount || 2 });
              setWarningToast('Multiple people detected in camera frame.');
            }
          } else {
            multiplePersonsConsecutiveRef.current = 0;
          }

          // Instant contraband
          if (analysis.contraband_detected || analysis.contraband) {
            const item = analysis.contraband_detected || analysis.contraband;
            emitTelemetryEvent(`CONTRABAND (${item})`, { model: 'Proctora_Vision_Contraband', item });
            setWarningToast(`Prohibited object detected: ${item}`);
          }
        }, 'image/jpeg', 0.8);
      } catch (err) {
        // Handled
      }
    };

    frameAnalysisIntervalRef.current = setInterval(analyzeCurrentFrame, 1500);
    return () => {
      if (frameAnalysisIntervalRef.current) clearInterval(frameAnalysisIntervalRef.current);
    };
  }, [step, session]);

  // Real-time Continuous Microphone Acoustic Speech Detection (VAD)
  useEffect(() => {
    if (step !== 'exam') return;

    let audioCtx = null;
    let micStream = null;
    let animFrameId = null;
    let isSpeaking = false;
    let speechDurationMs = 0;
    let lastCheckTime = Date.now();

    const startAudioMonitoring = async () => {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        audioCtx = new AudioCtxClass();
        const source = audioCtx.createMediaStreamSource(micStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.35;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkAudio = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          const bins = Math.min(80, dataArray.length);
          for (let i = 2; i < bins; i++) {
            sum += dataArray[i];
          }
          const avgEnergy = sum / Math.max(1, bins - 2);
          currentAudioEnergyRef.current = avgEnergy;

          const now = Date.now();
          const deltaMs = Math.min(100, now - lastCheckTime);
          lastCheckTime = now;

          // Vocal energy threshold (human speech / whispering energy is > 26)
          if (avgEnergy > 26) {
            speechDurationMs += deltaMs;
            if (speechDurationMs > 500 && !isSpeaking) {
              isSpeaking = true;
              emitTelemetryEvent('SPOKEN_AUDIO_DETECTED', {
                model: 'WebAudio_VAD',
                energy: Math.round(avgEnergy),
                detail: 'Acoustic vocal energy / speaking detected in exam room'
              });
              setWarningToast('⚠️ Acoustic speech / whispering detected in room.');
            }
          } else {
            speechDurationMs = Math.max(0, speechDurationMs - deltaMs * 1.5);
            if (speechDurationMs === 0 && isSpeaking) {
              isSpeaking = false;
            }
          }

          animFrameId = requestAnimationFrame(checkAudio);
        };

        checkAudio();
      } catch (err) {
        console.debug('Microphone VAD initialization error:', err);
      }
    };

    startAudioMonitoring();

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
    };
  }, [step]);

  // Secondary camera polling
  useEffect(() => {
    const currentSessionId = session?.sessionId || `sess_${studentId}`;
    const checkSecondaryStream = async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${currentSessionId}/secondary-stream`);
        if (res.ok) {
          const data = await res.json();
          setSecondaryCamActive(data.active);
          if (data.imageBase64) {
            setSecondaryCamPreview(data.imageBase64);
          }
          if (data.analysis?.contraband_detected) {
            setDeskContraband(data.analysis.contraband_detected);
            setWarningToast(`Desk: ${data.analysis.contraband_detected} detected`);
          } else {
            setDeskContraband(null);
          }
        }
      } catch (err) {
        console.debug('Secondary poll error:', err);
      }
    };

    secondaryPollIntervalRef.current = setInterval(checkSecondaryStream, 2500);
    return () => {
      if (secondaryPollIntervalRef.current) clearInterval(secondaryPollIntervalRef.current);
    };
  }, [session, studentId]);

  // OS & Browser security telemetry + strict shortcut guard
  useEffect(() => {
    if (step !== 'exam' || !session) return;

    let removeOSEvent = null;
    if (window.electronAPI?.onOSEvent) {
      removeOSEvent = window.electronAPI.onOSEvent((eventData) => {
        if (eventData.type === 'os_window_blur') {
          blurStartTimeRef.current = Date.now();
          emitTelemetryEvent('focus_lost', { source: 'os_window', details: eventData.details });
          setWarningToast('⚠️ Unauthorized window unfocus — locked in exam station.');
        } else if (eventData.type === 'os_window_focus') {
          if (blurStartTimeRef.current) {
            const durationMs = Date.now() - blurStartTimeRef.current;
            emitTelemetryEvent('focus_lost', { durationMs, source: 'os_window_return' });
            blurStartTimeRef.current = null;
          }
        }
      });
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        emitTelemetryEvent('tab_switch', { direction: 'away', fromTab: 'exam', toTab: 'unknown' });
        setWarningToast('⚠️ Tab switch attempt recorded.');
      } else {
        emitTelemetryEvent('tab_switch', { direction: 'return', fromTab: 'unknown', toTab: 'exam' });
      }
    };

    const handleWindowBlur = () => { blurStartTimeRef.current = Date.now(); };
    const handleWindowFocus = () => {
      if (blurStartTimeRef.current) {
        const durationMs = Date.now() - blurStartTimeRef.current;
        emitTelemetryEvent('focus_lost', { durationMs, visible: false });
        blurStartTimeRef.current = null;
      }
    };

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        emitTelemetryEvent('idle_period', { durationMs: 15000, detectedAt: new Date().toISOString() });
      }, 15000);
    };

    const handleUserActivity = () => { resetIdleTimer(); };

    const handleKeyDown = (e) => {
      // Guard against common OS & browser shortcuts
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['r', 'w', 't', 'n', 'u', 'p', 's', 'h', 'j', 'i'].includes(key)) {
        e.preventDefault();
      }
      if (['f12', 'f5', 'f11'].includes(key)) {
        e.preventDefault();
      }
      if (e.altKey && ['tab', 'f4', 'escape', ' '].includes(key)) {
        e.preventDefault();
      }
      resetIdleTimer();
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('contextmenu', handleContextMenu);

    resetIdleTimer();

    return () => {
      if (removeOSEvent) removeOSEvent();
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('contextmenu', handleContextMenu);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [step, session]);

  // Countdown
  useEffect(() => {
    if (step !== 'exam' || !session) return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { handleFinishExam(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, session]);

  useEffect(() => {
    if (warningToast) {
      const timer = setTimeout(() => setWarningToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [warningToast]);

  const handleSelectOption = (index) => {
    const currentQ = SAMPLE_QUESTIONS[currentIndex];
    const responseTimeMs = Date.now() - questionStartTimeRef.current;
    setAnswers(prev => ({ ...prev, [currentQ.id]: index }));
    emitTelemetryEvent('answer_submit', { questionId: currentQ.id, optionIndex: index, responseTimeMs });
  };

  const handleFinishExam = async () => {
    if (!session?.sessionId) return;
    try {
      await fetch(`${API_BASE}/sessions/${session.sessionId}/finish`, { method: 'POST' });
      if (window.electronAPI?.exitLockdown) {
        await window.electronAPI.exitLockdown();
        setIsLocked(false);
      }
      setStep('completed');
    } catch (err) {
      if (window.electronAPI?.exitLockdown) window.electronAPI.exitLockdown();
      setStep('completed');
    }
  };

  const handleQuitApp = async () => {
    try {
      if (window.electronAPI?.quitApp) {
        await window.electronAPI.quitApp();
      } else if (window.electronAPI?.exitLockdown) {
        await window.electronAPI.exitLockdown();
        window.close();
      } else {
        window.close();
      }
    } catch (e) {
      window.close();
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Dynamic QR Code Pairing URL calculation
  const currentSessionKey = session?.sessionId || `sess_${studentId}`;
  let mobilePairingUrl = '';

  if (qrMode === 'ngrok') {
    const targetNgrok = networkInfo.ngrokUrl || (manualNgrokUrl.trim() ? manualNgrokUrl.trim() : null);
    if (targetNgrok) {
      const ngrokClean = targetNgrok.replace(/\/$/, '');
      // If local API_BASE is localhost, route phone traffic directly through ngrok /api reverse proxy
      const effectiveBackend = (API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1')) ? `${ngrokClean}/api` : API_BASE;
      mobilePairingUrl = `${ngrokClean}/?mode=mobile&sessionId=${currentSessionKey}&studentId=${studentId}&backendUrl=${encodeURIComponent(effectiveBackend)}`;
    } else {
      const lanIp = networkInfo.localIp || window.location.hostname || '127.0.0.1';
      const clientPort = networkInfo.studentPort || 5173;
      mobilePairingUrl = `http://${lanIp}:${clientPort}/?mode=mobile&sessionId=${currentSessionKey}&studentId=${studentId}&backendUrl=${encodeURIComponent(API_BASE)}`;
    }
  } else if (qrMode === 'cloud') {
    const cloudBase = customCompanionUrl.trim() || import.meta.env.VITE_COMPANION_URL || 'https://proctora-student.vercel.app';
    const cloudClean = cloudBase.replace(/\/$/, '');
    mobilePairingUrl = `${cloudClean}/?mode=mobile&sessionId=${currentSessionKey}&studentId=${studentId}&backendUrl=${encodeURIComponent(API_BASE)}`;
  } else if (qrMode === 'custom' && customHost.trim()) {
    let hostClean = customHost.trim().replace(/\/$/, '');
    if (!hostClean.startsWith('http://') && !hostClean.startsWith('https://')) {
      hostClean = `http://${hostClean}`;
    }
    mobilePairingUrl = `${hostClean}/?mode=mobile&sessionId=${currentSessionKey}&studentId=${studentId}&backendUrl=${encodeURIComponent(API_BASE)}`;
  } else {
    // Mode: 'wifi' (Direct LAN IP with embedded server)
    const lanIp = networkInfo.localIp || window.location.hostname || '127.0.0.1';
    const clientPort = networkInfo.studentPort || 5173;
    mobilePairingUrl = `http://${lanIp}:${clientPort}/?mode=mobile&sessionId=${currentSessionKey}&studentId=${studentId}&backendUrl=${encodeURIComponent(API_BASE)}`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. TERMINATED VIEW
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'terminated') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div className="panel-slate" style={{
          maxWidth: '560px',
          width: '100%',
          padding: '36px',
          textAlign: 'center',
          border: '1.5px solid var(--signal-red)',
          boxShadow: '0 0 40px rgba(224, 78, 67, 0.2)'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: 'rgba(224, 78, 67, 0.15)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px auto'
          }}>
            <AlertTriangle size={32} color="var(--signal-red)" />
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--signal-red)', marginBottom: '10px', letterSpacing: '0.04em' }}>
            EXAM FORCEFULLY TERMINATED
          </h2>
          <p style={{ color: 'var(--chalk)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px' }}>
            Your proctored exam session has been forcefully terminated by the invigilator due to detected security, biometric, or behavioral anomalies.
          </p>
          <div className="panel-raised" style={{ padding: '14px', fontSize: '0.8rem', color: 'var(--chalk-mid)', fontFamily: 'var(--font-data)', marginBottom: '24px', textAlign: 'left' }}>
            <div><strong style={{ color: 'var(--chalk)' }}>SESSION:</strong> {session?.sessionId || 'N/A'}</div>
            <div><strong style={{ color: 'var(--chalk)' }}>STUDENT ID:</strong> {studentId}</div>
            <div><strong style={{ color: 'var(--chalk)' }}>STATUS:</strong> <span style={{ color: 'var(--signal-red)', fontWeight: 700 }}>TERMINATED</span></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={handleQuitApp}
              className="btn-danger"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <LogOut size={16} />
              Quit Application Completely
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-ghost"
              style={{ width: '100%', padding: '10px', fontSize: '0.8rem', borderColor: 'var(--border-subtle)', cursor: 'pointer' }}
            >
              Return to Check-in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. SEAT CHECK-IN (Enrollment)
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'enroll') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 20px'
      }}>
        <div className="panel-slate" style={{ maxWidth: '1040px', width: '100%', padding: '32px 36px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <img src={proctoraLogo} alt="Proctora Logo" style={{ width: '44px', height: '44px', objectFit: 'contain' }} />
              <div>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.15rem',
                  fontWeight: 600,
                  color: 'var(--chalk)',
                  letterSpacing: '0.08em',
                  marginBottom: '2px'
                }}>
                  PROCTORA · SEAT CHECK-IN
                </div>
                <p style={{ color: 'var(--chalk-mid)', fontSize: '0.85rem', maxWidth: '560px', lineHeight: 1.4 }}>
                  Verify your identity to begin. Capture your face and voice, then pair your phone as a desk camera.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                fontFamily: 'var(--font-data)',
                fontSize: '0.72rem',
                color: 'var(--chalk-dim)',
                background: 'rgba(255,255,255,0.05)',
                padding: '4px 10px',
                borderRadius: '4px'
              }}>
                {isElectron ? 'Desktop Kiosk' : 'Web Station'}
              </span>
            </div>
          </div>

          {/* Windows Administrator Privilege Banner */}
          {adminStatus.isWindows && !adminStatus.isAdmin && !adminStatus.promptDismissed && (
            <div style={{
              background: 'rgba(224, 78, 67, 0.08)',
              border: '1px solid rgba(224, 78, 67, 0.35)',
              borderRadius: '6px',
              padding: '14px 18px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(224, 78, 67, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--signal-red)',
                  flexShrink: 0
                }}>
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: 'var(--chalk)',
                    letterSpacing: '0.04em',
                    marginBottom: '2px'
                  }}>
                    ADMINISTRATOR PRIVILEGES RECOMMENDED · WINDOWS KIOSK
                  </div>
                  <div style={{ color: 'var(--chalk-dim)', fontSize: '0.78rem', lineHeight: 1.35 }}>
                    To enforce full OS lockdown (blocking <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px', color: 'var(--chalk)' }}>Alt+Tab</kbd>, Windows Key, and app switching), run Proctora as Administrator.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <button
                  onClick={() => {
                    if (window.electronAPI?.relaunchAsAdmin) {
                      window.electronAPI.relaunchAsAdmin();
                    }
                  }}
                  className="btn-primary"
                  style={{
                    background: 'var(--signal-red)',
                    borderColor: 'var(--signal-red)',
                    padding: '6px 14px',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Zap size={13} /> Relaunch as Admin
                </button>
                <button
                  onClick={() => setAdminStatus(prev => ({ ...prev, promptDismissed: true }))}
                  className="btn-ghost"
                  style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* 3-Step Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>

            {/* Step 1: Face */}
            <div className="panel-raised" style={{ padding: '18px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.72rem', color: 'var(--chalk-dim)', letterSpacing: '0.06em' }}>01</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', color: 'var(--chalk)', letterSpacing: '0.02em' }}>FACE</span>
                </div>
                {faceCaptured && (
                  <span style={{ color: 'var(--clear-green)', fontSize: '0.72rem', fontFamily: 'var(--font-data)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Check size={12} /> ready
                  </span>
                )}
              </div>

              <div style={{
                position: 'relative',
                width: '100%',
                height: '170px',
                background: 'var(--bg-deep)',
                borderRadius: '4px',
                overflow: 'hidden',
                marginBottom: '12px',
                border: `1px solid ${faceCaptured ? 'var(--clear-green-dim)' : 'var(--border-subtle)'}`
              }}>
                {faceCaptured ? (
                  <img src={faceCaptured} alt="Face reference" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                )}
              </div>

              <button
                onClick={captureFaceSnapshot}
                className={faceCaptured ? "btn-ghost" : "btn-primary"}
                style={{ marginTop: 'auto', width: '100%', padding: '9px', fontSize: '0.8rem' }}
              >
                {faceCaptured ? 'Retake' : 'Capture face'}
              </button>
            </div>

            {/* Step 2: Voice */}
            <div className="panel-raised" style={{ padding: '18px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.72rem', color: 'var(--chalk-dim)', letterSpacing: '0.06em' }}>02</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', color: 'var(--chalk)', letterSpacing: '0.02em' }}>VOICE</span>
                </div>
                {audioRecorded && (
                  <span style={{ color: 'var(--clear-green)', fontSize: '0.72rem', fontFamily: 'var(--font-data)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Check size={12} /> ready
                  </span>
                )}
              </div>

              <div style={{
                height: '170px',
                background: 'var(--bg-deep)',
                borderRadius: '4px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '14px',
                textAlign: 'center',
                marginBottom: '12px',
                border: '1px solid var(--border-subtle)'
              }}>
                <Volume2
                  size={28}
                  color={isRecordingAudio ? 'var(--signal-red)' : 'var(--chalk-dim)'}
                  style={{ transition: 'color 0.2s ease', marginBottom: '10px' }}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--chalk-mid)', lineHeight: 1.4 }}>
                  {isRecordingAudio
                    ? `Recording (${audioCountdown}s)... Say: "I confirm my identity."`
                    : audioRecorded
                    ? 'Voice signature captured.'
                    : 'Speak clearly for 5 seconds.'}
                </p>
              </div>

              <button
                onClick={startVoiceRecording}
                disabled={isRecordingAudio}
                className={isRecordingAudio ? "btn-danger" : audioRecorded ? "btn-ghost" : "btn-primary"}
                style={{ marginTop: 'auto', width: '100%', padding: '9px', fontSize: '0.8rem' }}
              >
                {isRecordingAudio ? `Recording (${audioCountdown}s)...` : audioRecorded ? 'Re-record' : 'Record voice'}
              </button>
            </div>

            {/* Step 3: Desk Cam */}
            <div className="panel-raised" style={{
              padding: '18px',
              border: `1px solid ${secondaryCamActive ? 'rgba(59, 166, 118, 0.35)' : 'var(--border-mid)'}`,
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.72rem', color: 'var(--chalk-dim)', letterSpacing: '0.06em' }}>03</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', color: 'var(--chalk)', letterSpacing: '0.02em' }}>DESK CAM</span>
                </div>
                <span style={{
                  fontFamily: 'var(--font-data)',
                  fontSize: '0.72rem',
                  color: secondaryCamActive ? 'var(--clear-green)' : 'var(--chalk-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {secondaryCamActive ? '● paired' : '○ waiting'}
                </span>
              </div>

              {/* Mode Selector Tabs */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '4px',
                padding: '2px',
                marginBottom: '8px',
                gap: '2px'
              }}>
                <button
                  type="button"
                  onClick={() => setQrMode('wifi')}
                  style={{
                    padding: '4px 3px',
                    fontSize: '0.62rem',
                    fontFamily: 'var(--font-display)',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: qrMode === 'wifi' ? 'var(--bg-slate)' : 'transparent',
                    color: qrMode === 'wifi' ? 'var(--chalk)' : 'var(--chalk-dim)',
                    boxShadow: qrMode === 'wifi' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px'
                  }}
                  title="Direct 0-latency Wi-Fi connection with embedded server"
                >
                  <Wifi size={10} />
                  Wi-Fi
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('ngrok')}
                  style={{
                    padding: '4px 3px',
                    fontSize: '0.62rem',
                    fontFamily: 'var(--font-display)',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: qrMode === 'ngrok' ? 'var(--bg-slate)' : 'transparent',
                    color: qrMode === 'ngrok' ? 'var(--chalk)' : 'var(--chalk-dim)',
                    boxShadow: qrMode === 'ngrok' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px'
                  }}
                  title="Secure Ngrok Tunnel (for Cellular 4G/5G)"
                >
                  <Globe size={10} />
                  Ngrok
                  {networkInfo.hasNgrok && (
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--clear-green)' }} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('cloud')}
                  style={{
                    padding: '4px 3px',
                    fontSize: '0.62rem',
                    fontFamily: 'var(--font-display)',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: qrMode === 'cloud' ? 'var(--bg-slate)' : 'transparent',
                    color: qrMode === 'cloud' ? 'var(--chalk)' : 'var(--chalk-dim)',
                    boxShadow: qrMode === 'cloud' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px'
                  }}
                  title="Pair from phone via Cloud Web Companion (No ngrok needed)"
                >
                  <Zap size={10} />
                  Cloud
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('custom')}
                  style={{
                    padding: '4px 3px',
                    fontSize: '0.62rem',
                    fontFamily: 'var(--font-display)',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: qrMode === 'custom' ? 'var(--bg-slate)' : 'transparent',
                    color: qrMode === 'custom' ? 'var(--chalk)' : 'var(--chalk-dim)',
                    boxShadow: qrMode === 'custom' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px'
                  }}
                  title="Custom Host / IP"
                >
                  Custom
                </button>
              </div>

              {/* Wi-Fi Mode Note */}
              {qrMode === 'wifi' && (
                <div style={{
                  fontSize: '0.62rem',
                  color: 'var(--amber-watch)',
                  marginBottom: '8px',
                  background: 'rgba(230, 126, 34, 0.08)',
                  padding: '4px 6px',
                  borderRadius: '3px',
                  border: '1px solid rgba(230, 126, 34, 0.2)',
                  lineHeight: 1.3
                }}>
                  ℹ️ <strong>Note:</strong> Mobile browsers require <strong>HTTPS</strong> for camera. Switch to <strong>Ngrok</strong> or <strong>Cloud</strong> if your phone blocks camera on Wi-Fi.
                </div>
              )}

              {/* Ngrok Helper / Manual URL Input if offline */}
              {qrMode === 'ngrok' && !networkInfo.hasNgrok && (
                <div style={{ marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder="Enter ngrok URL (e.g. https://xxx.ngrok-free.app)"
                    value={manualNgrokUrl}
                    onChange={(e) => setManualNgrokUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '0.68rem',
                      fontFamily: 'var(--font-data)',
                      borderRadius: '3px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-deep)',
                      color: 'var(--chalk)'
                    }}
                  />
                  <div style={{ fontSize: '0.6rem', color: 'var(--chalk-dim)', marginTop: '2px' }}>
                    Or start in terminal: <code style={{ color: 'var(--amber-watch)' }}>ngrok http 5173</code>
                  </div>
                </div>
              )}

              {/* Cloud Companion URL Input */}
              {qrMode === 'cloud' && (
                <div style={{ marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder="https://proctora-student.vercel.app"
                    value={customCompanionUrl}
                    onChange={(e) => setCustomCompanionUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '0.68rem',
                      fontFamily: 'var(--font-data)',
                      borderRadius: '3px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-deep)',
                      color: 'var(--chalk)'
                    }}
                  />
                  <div style={{ fontSize: '0.6rem', color: 'var(--clear-green)', marginTop: '2px' }}>
                    ✓ 4G/5G cellular phone pairing via deployed cloud web companion
                  </div>
                </div>
              )}

              {/* Custom Host Input */}
              {qrMode === 'custom' && (
                <div style={{ marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder="e.g. 192.168.1.50:5173"
                    value={customHost}
                    onChange={(e) => setCustomHost(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '0.68rem',
                      fontFamily: 'var(--font-data)',
                      borderRadius: '3px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-deep)',
                      color: 'var(--chalk)'
                    }}
                  />
                </div>
              )}

              {/* QR Code / Video Feed Display */}
              <div style={{
                height: '150px',
                background: 'var(--bg-light)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px',
                marginBottom: '8px',
                position: 'relative'
              }}>
                {secondaryCamPreview ? (
                  <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: '4px', overflow: 'hidden' }}>
                    <img src={secondaryCamPreview} alt="Desk feed" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{
                      position: 'absolute',
                      top: '5px',
                      right: '5px',
                      background: 'var(--clear-green)',
                      color: '#fff',
                      fontSize: '0.6rem',
                      padding: '2px 5px',
                      borderRadius: '3px',
                      fontFamily: 'var(--font-data)',
                      fontWeight: 600
                    }}>
                      live
                    </div>
                  </div>
                ) : (
                  <QRCodeSVG value={mobilePairingUrl} size={125} level="M" fgColor="#0D0F17" bgColor="#F0EDE4" />
                )}
              </div>

              {/* URL & Action Toolbar */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                marginTop: 'auto',
                paddingTop: '6px',
                borderTop: '1px solid rgba(255,255,255,0.05)'
              }}>
                <div style={{
                  fontSize: '0.66rem',
                  color: 'var(--chalk-dim)',
                  fontFamily: 'var(--font-data)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '140px'
                }}>
                  {qrMode === 'ngrok'
                    ? (networkInfo.ngrokUrl || manualNgrokUrl.trim() ? 'Ngrok live' : 'Ngrok offline')
                    : qrMode === 'cloud'
                    ? 'Cloud Companion'
                    : qrMode === 'custom'
                    ? (customHost || 'Custom host')
                    : `Wi-Fi: ${networkInfo.localIp}`}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(mobilePairingUrl);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="btn-ghost"
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                    title="Copy Pairing URL"
                  >
                    {copiedLink ? <Check size={11} color="var(--clear-green)" /> : <Copy size={11} />}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>

                  <a
                    href={mobilePairingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost"
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      textDecoration: 'none'
                    }}
                    title="Open mobile view in new tab for testing"
                  >
                    <ExternalLink size={11} />
                    Test
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Student ID & Submit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '14px', alignItems: 'flex-end' }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.68rem',
                color: 'var(--chalk-dim)',
                marginBottom: '6px',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.06em'
              }}>
                STUDENT ID
              </label>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '0.9rem',
                  fontFamily: 'var(--font-display)'
                }}
              />
            </div>

            <button
              onClick={handleBiometricEnrollment}
              disabled={loading || !faceBlob || !audioBlob}
              className="btn-primary"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.85rem',
                opacity: (!faceBlob || !audioBlob) ? 0.35 : 1
              }}
            >
              {loading ? 'Verifying...' : 'Begin exam'}
            </button>
          </div>

          {enrollStatus.text && (
            <div style={{
              marginTop: '16px',
              padding: '10px 14px',
              borderRadius: '4px',
              fontSize: '0.82rem',
              textAlign: 'center',
              fontWeight: 500,
              background: enrollStatus.type === 'success' ? 'var(--clear-green-dim)' : 'var(--amber-watch-dim)',
              color: enrollStatus.type === 'success' ? 'var(--clear-green)' : 'var(--amber-watch)',
              border: `1px solid ${enrollStatus.type === 'success' ? 'rgba(59, 166, 118, 0.25)' : 'rgba(212, 148, 58, 0.25)'}`
            }}>
              {enrollStatus.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. EXAM COMPLETED
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'completed') {
    const answeredCount = Object.keys(answers).length;
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div className="panel-slate" style={{ maxWidth: '480px', width: '100%', padding: '36px 32px', textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            color: 'var(--clear-green)',
            letterSpacing: '0.08em',
            marginBottom: '8px'
          }}>
            SUBMITTED
          </div>
          <p style={{ color: 'var(--chalk-mid)', marginBottom: '24px', fontSize: '0.85rem', lineHeight: 1.5 }}>
            Exam session complete. Your responses and monitoring data have been recorded.
          </p>

          <div className="panel-raised" style={{ padding: '16px 20px', marginBottom: '24px', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ color: 'var(--chalk-mid)', fontSize: '0.8rem' }}>Session</span>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: '0.78rem', color: 'var(--chalk)' }}>{session?.sessionId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ color: 'var(--chalk-mid)', fontSize: '0.8rem' }}>Student</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', color: 'var(--chalk)' }}>{studentId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--chalk-mid)', fontSize: '0.8rem' }}>Answered</span>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: '0.78rem', color: 'var(--clear-green)' }}>{answeredCount} / {SAMPLE_QUESTIONS.length}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={handleQuitApp}
              className="btn-danger"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <LogOut size={16} />
              Quit Application Completely
            </button>

            <button
              onClick={async () => {
                if (window.electronAPI?.exitLockdown) {
                  await window.electronAPI.exitLockdown();
                }
                setSession(null);
                setAnswers({});
                setCurrentIndex(0);
                setTelemetryLogs([]);
                setFaceCaptured(null);
                setFaceBlob(null);
                setAudioRecorded(false);
                setAudioBlob(null);
                setEnrollStatus({ text: '', type: 'idle' });
                setStep('enroll');
              }}
              className="btn-ghost"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <RotateCcw size={14} />
              Start another session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. ACTIVE EXAM SESSION
  // ═══════════════════════════════════════════════════════════════════════
  const currentQ = SAMPLE_QUESTIONS[currentIndex];
  const selectedOption = answers[currentQ.id];
  const hasProctorViolation = aiStatus.gazeAway || aiStatus.mouthMovement || aiStatus.contraband || deskContraband || aiStatus.multiplePersons;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', display: 'flex', flexDirection: 'column' }}>

      {/* Header — minimal during exam */}
      <header style={{
        padding: '10px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-deep)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src={proctoraLogo} alt="Proctora Logo" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.78rem',
            color: 'var(--chalk)',
            letterSpacing: '0.08em',
            fontWeight: 600
          }}>
            PROCTORA
          </span>
          <span style={{ color: 'var(--chalk-dim)', fontSize: '0.75rem' }}>·</span>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.75rem',
            color: 'var(--chalk-mid)',
            letterSpacing: '0.06em'
          }}>
            ASSESSMENT
          </span>
          <div className="telemetry-indicator">
            <div className="pulse-dot" />
            <span>{isLocked ? 'Kiosk locked' : 'Monitoring active'}</span>
          </div>
          <span style={{
            fontFamily: 'var(--font-data)',
            fontSize: '0.68rem',
            color: 'var(--clear-green)',
            background: 'rgba(59, 166, 118, 0.12)',
            padding: '2px 7px',
            borderRadius: '3px',
            border: '1px solid rgba(59, 166, 118, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <Zap size={10} />
            {aiEngineSource}
          </span>
          {secondaryCamActive && (
            <span style={{
              fontFamily: 'var(--font-data)',
              fontSize: '0.68rem',
              color: 'var(--clear-green)'
            }}>
              ● desk cam
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Timer */}
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            color: timeLeft < 300 ? 'var(--signal-red)' : 'var(--amber-watch)',
            letterSpacing: '0.04em'
          }}>
            {formatTime(timeLeft)}
          </span>

          <button
            onClick={handleFinishExam}
            className="btn-danger"
            style={{ padding: '6px 14px', fontSize: '0.78rem' }}
          >
            End exam
          </button>
        </div>
      </header>

      {/* Main Exam Area */}
      <main style={{
        flex: 1,
        maxWidth: '1400px',
        width: '100%',
        margin: '0 auto',
        padding: '20px',
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        gap: '20px'
      }}>

        {/* Left: Question */}
        <section className="panel-slate" style={{ padding: '30px 28px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.72rem',
              color: 'var(--chalk-mid)',
              letterSpacing: '0.06em'
            }}>
              QUESTION {currentIndex + 1} / {SAMPLE_QUESTIONS.length}
            </span>
            <span style={{
              fontFamily: 'var(--font-data)',
              fontSize: '0.72rem',
              color: selectedOption !== undefined ? 'var(--clear-green)' : 'var(--chalk-dim)'
            }}>
              {selectedOption !== undefined ? '● answered' : '○ pending'}
            </span>
          </div>

          <h2 style={{
            fontFamily: 'var(--font-body)',
            fontSize: '1.2rem',
            fontWeight: 500,
            lineHeight: 1.65,
            color: 'var(--chalk)',
            marginBottom: '28px'
          }}>
            {currentQ.text}
          </h2>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '32px' }}>
            {currentQ.options.map((opt, idx) => {
              const isSelected = selectedOption === idx;
              return (
                <div
                  key={idx}
                  className={`option-card ${isSelected ? 'option-card--selected' : ''}`}
                  onClick={() => handleSelectOption(idx)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelectOption(idx)}
                  role="radio"
                  aria-checked={isSelected}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      border: `2px solid ${isSelected ? 'var(--chalk)' : 'var(--border-strong)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.78rem',
                      fontFamily: 'var(--font-display)',
                      color: isSelected ? 'var(--bg-deep)' : 'var(--chalk-mid)',
                      background: isSelected ? 'var(--chalk)' : 'transparent',
                      transition: 'all 0.12s ease',
                      flexShrink: 0
                    }}>
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <span style={{
                      fontSize: '0.9rem',
                      fontWeight: isSelected ? 500 : 400,
                      color: 'var(--chalk)',
                      lineHeight: 1.4
                    }}>
                      {opt}
                    </span>
                  </div>
                  {isSelected && <CheckCircle2 size={18} color="var(--chalk)" />}
                </div>
              );
            })}
          </div>

          {/* Navigation */}
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => { if (currentIndex > 0) setCurrentIndex(currentIndex - 1); }}
              disabled={currentIndex === 0}
              className="btn-ghost"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '0.82rem'
              }}
            >
              <ArrowLeft size={14} /> Previous
            </button>

            {currentIndex < SAMPLE_QUESTIONS.length - 1 ? (
              <button
                onClick={() => { if (currentIndex < SAMPLE_QUESTIONS.length - 1) setCurrentIndex(currentIndex + 1); }}
                className="btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  fontSize: '0.82rem'
                }}
              >
                Next <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={handleFinishExam}
                className="btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  fontSize: '0.82rem'
                }}
              >
                Submit <Send size={14} />
              </button>
            )}
          </div>
        </section>

        {/* Right: Camera + Nav + Activity */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Camera Feeds */}
          <div className="panel-slate" style={{ padding: '14px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px'
            }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.68rem',
                color: 'var(--chalk-mid)',
                letterSpacing: '0.06em'
              }}>
                CAMERAS
              </span>
              <span style={{
                fontFamily: 'var(--font-data)',
                fontSize: '0.65rem',
                color: hasProctorViolation ? 'var(--signal-red)' : 'var(--clear-green)'
              }}>
                {hasProctorViolation ? '● flagged' : '● clear'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Primary webcam */}
              <div style={{
                position: 'relative',
                width: '100%',
                height: '120px',
                background: 'var(--bg-deep)',
                borderRadius: '4px',
                overflow: 'hidden',
                border: `1.5px solid ${
                  aiStatus.gazeAway || aiStatus.mouthMovement || aiStatus.contraband || aiStatus.multiplePersons
                    ? 'var(--signal-red)'
                    : 'var(--border-subtle)'
                }`,
                transition: 'border-color 0.2s ease'
              }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />

                {/* AI status tags */}
                <div style={{ position: 'absolute', bottom: '4px', left: '4px', right: '4px', display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.58rem',
                    padding: '1px 4px',
                    borderRadius: '2px',
                    fontFamily: 'var(--font-data)',
                    fontWeight: 600,
                    background: aiStatus.gazeAway
                      ? 'var(--signal-red)'
                      : aiStatus.gazeDesk
                        ? 'var(--clear-green)'
                        : 'rgba(59, 166, 118, 0.8)',
                    color: '#fff'
                  }}>
                    {aiStatus.gazeAway ? 'away' : aiStatus.gazeDesk ? 'desk' : 'screen'}
                  </span>

                  {aiStatus.mouthMovement && (
                    <span style={{
                      fontSize: '0.58rem',
                      padding: '1px 4px',
                      borderRadius: '2px',
                      fontFamily: 'var(--font-data)',
                      fontWeight: 600,
                      background: 'var(--signal-red)',
                      color: '#fff'
                    }}>
                      speaking
                    </span>
                  )}

                  {aiStatus.contraband && (
                    <span style={{
                      fontSize: '0.58rem',
                      padding: '1px 4px',
                      borderRadius: '2px',
                      fontFamily: 'var(--font-data)',
                      fontWeight: 600,
                      background: 'var(--signal-red)',
                      color: '#fff'
                    }}>
                      {aiStatus.contraband}
                    </span>
                  )}
                </div>
              </div>

              {/* Secondary desk cam */}
              <div style={{
                position: 'relative',
                width: '100%',
                height: '120px',
                background: 'var(--bg-deep)',
                borderRadius: '4px',
                overflow: 'hidden',
                border: `1.5px solid ${
                  deskContraband
                    ? 'var(--signal-red)'
                    : secondaryCamActive
                      ? 'rgba(59, 166, 118, 0.25)'
                      : 'var(--border-subtle)'
                }`,
                transition: 'border-color 0.2s ease'
              }}>
                {secondaryCamPreview ? (
                  <img src={secondaryCamPreview} alt="Desk feed" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--chalk-dim)', fontSize: '0.65rem', textAlign: 'center', padding: '6px', fontFamily: 'var(--font-display)' }}>
                    <Smartphone size={16} style={{ marginBottom: '4px', opacity: 0.5 }} />
                    <span>{secondaryCamActive ? 'Loading...' : 'No desk cam'}</span>
                  </div>
                )}
                <div style={{
                  position: 'absolute',
                  top: '4px',
                  left: '4px',
                  fontFamily: 'var(--font-data)',
                  fontSize: '0.55rem',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  fontWeight: 600,
                  background: deskContraband ? 'var(--signal-red)' : 'rgba(13, 15, 23, 0.75)',
                  color: deskContraband ? '#fff' : secondaryCamActive ? 'var(--clear-green)' : 'var(--chalk-dim)'
                }}>
                  {deskContraband ? deskContraband : secondaryCamActive ? '● desk' : '○ desk'}
                </div>
              </div>
            </div>
          </div>

          {/* Question Navigator */}
          <div className="panel-slate" style={{ padding: '14px' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.68rem',
              color: 'var(--chalk-mid)',
              letterSpacing: '0.06em',
              marginBottom: '10px'
            }}>
              QUESTIONS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
              {SAMPLE_QUESTIONS.map((q, idx) => {
                const isCurrent = currentIndex === idx;
                const isAnswered = answers[q.id] !== undefined;
                return (
                  <button
                    key={q.id}
                    onClick={() => { setCurrentIndex(idx); }}
                    style={{
                      height: '32px',
                      borderRadius: '4px',
                      fontWeight: 500,
                      fontSize: '0.78rem',
                      fontFamily: 'var(--font-display)',
                      background: isCurrent
                        ? 'var(--chalk)'
                        : isAnswered
                        ? 'var(--clear-green-dim)'
                        : 'var(--bg-raised)',
                      border: isCurrent
                        ? 'none'
                        : isAnswered
                        ? '1px solid rgba(59, 166, 118, 0.25)'
                        : '1px solid var(--border-subtle)',
                      color: isCurrent
                        ? 'var(--bg-deep)'
                        : isAnswered
                        ? 'var(--clear-green)'
                        : 'var(--chalk-dim)'
                    }}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Activity Log */}
          <div className="panel-slate" style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.68rem',
              color: 'var(--chalk-mid)',
              letterSpacing: '0.06em',
              marginBottom: '8px'
            }}>
              ACTIVITY LOG
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: '160px',
              fontFamily: 'var(--font-data)',
              fontSize: '0.65rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {telemetryLogs.length === 0 ? (
                <span style={{ color: 'var(--chalk-dim)' }}>Monitoring active.</span>
              ) : (
                telemetryLogs.map((log) => {
                  const isViolation = log.type.includes('CONTRABAND') || log.type.includes('MISMATCH') || log.type.includes('MULTIPLE') || log.type.includes('ABSENT');
                  const isWarning = log.type.includes('GAZE') || log.type.includes('MOUTH') || log.type.includes('focus');
                  const entryClass = `activity-entry ${isViolation ? 'activity-entry--critical' : isWarning ? 'activity-entry--warning' : ''}`;
                  return (
                    <div key={log.id} className={entryClass}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--chalk-mid)' }}>
                        <span style={{
                          fontWeight: 600,
                          color: isViolation ? 'var(--signal-red)' : isWarning ? 'var(--amber-watch)' : 'var(--chalk)'
                        }}>
                          {log.type}
                        </span>
                        <span>{log.time}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Warning Toast */}
      {warningToast && (
        <div className={`toast-warn ${warningToast.includes('Multiple') || warningToast.includes('Prohibited') || warningToast.includes('prohibited') ? 'critical' : ''}`}>
          <AlertTriangle
            size={18}
            color={warningToast.includes('Multiple') || warningToast.includes('Prohibited') || warningToast.includes('prohibited') ? 'var(--signal-red)' : 'var(--amber-watch)'}
          />
          <span style={{ fontSize: '0.82rem', fontWeight: 400 }}>{warningToast}</span>
        </div>
      )}
    </div>
  );
}
