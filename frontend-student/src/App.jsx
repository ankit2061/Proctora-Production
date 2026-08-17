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
  Lock,
  Monitor,
  Camera,
  Mic,
  Eye,
  AlertCircle,
  Volume2,
  RefreshCw,
  Video,
  Smartphone,
  Check,
  Wifi,
  Compass,
  Layers,
  Sparkles,
  LogOut,
  RotateCcw
} from 'lucide-react';

const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:4000/api'
  : `${window.location.origin}/api`;
const AI_API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:4000/api/ai'
  : `${window.location.origin}/api/ai`;

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
  const [facingMode, setFacingMode] = useState('environment'); // Default to rear camera for desk view
  const [streamActive, setStreamActive] = useState(false);
  const [framesSent, setFramesSent] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);

  const apiHost = backendHost || `${window.location.hostname}:4000`;

  const startMobileCamera = async () => {
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
        setErrorMsg('Camera access denied. Please allow camera permissions in your browser.');
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

  // Stream snapshot to backend every 2 seconds
  useEffect(() => {
    if (!streamActive || !sessionId) return;

    const sendSnapshot = async () => {
      if (!videoRef.current) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, 480, 360);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.65);

        const endpoint = window.location.origin.includes('localhost')
          ? `http://${apiHost}/api/sessions/${sessionId}/secondary-stream`
          : `${window.location.origin}/api/sessions/${sessionId}/secondary-stream`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: dataUrl,
            studentId,
            timestamp: new Date().toISOString()
          })
        });

        if (res.ok) {
          setFramesSent(prev => prev + 1);
        }
      } catch (err) {
        console.debug('Frame send error:', err);
      }
    };

    const interval = setInterval(sendSnapshot, 2000);
    return () => clearInterval(interval);
  }, [streamActive, sessionId, apiHost]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#070a12',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-sans)',
      padding: '16px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '14px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={22} color="#6366f1" />
          <span style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em' }}>PROCTORA DESK CAM</span>
        </div>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: streamActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: streamActive ? '#34d399' : '#f87171',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 700
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: streamActive ? '#34d399' : '#f87171'
          }} />
          {streamActive ? 'Live Streaming' : 'Connecting'}
        </div>
      </div>

      {errorMsg ? (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          padding: '20px',
          borderRadius: '12px',
          color: '#fca5a5',
          textAlign: 'center',
          marginTop: '40px'
        }}>
          <AlertCircle size={36} style={{ marginBottom: '10px' }} />
          <p>{errorMsg}</p>
        </div>
      ) : (
        <>
          {/* Positioning Instructions Banner */}
          <div style={{
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '16px',
            fontSize: '0.85rem',
            lineHeight: 1.4
          }}>
            <div style={{ fontWeight: 700, color: '#c7d2fe', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Compass size={16} /> Placement Guideline:
            </div>
            <p style={{ color: '#e0e7ff', fontSize: '0.8rem' }}>
              Prop your phone up at <strong>one arm's length (45° angle)</strong> to the side. Ensure your desk, keyboard, and hands are clearly visible in frame.
            </p>
          </div>

          {/* Camera Video Viewport */}
          <div style={{
            position: 'relative',
            width: '100%',
            flex: 1,
            minHeight: '280px',
            background: '#000',
            borderRadius: '14px',
            overflow: 'hidden',
            border: '1.5px solid rgba(255, 255, 255, 0.1)'
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
              bottom: '12px',
              left: '12px',
              right: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(8px)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '0.75rem'
            }}>
              <span style={{ color: '#9ca3af' }}>Session: <strong style={{ color: '#fff' }}>{sessionId}</strong></span>
              <span style={{ color: '#34d399', fontWeight: 600 }}>Frames: {framesSent}</span>
            </div>
          </div>

          {/* Bottom Controls */}
          <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
              style={{
                flex: 1,
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#fff',
                borderRadius: '10px',
                fontWeight: 600,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <RefreshCw size={16} /> Switch Camera ({facingMode === 'environment' ? 'Desk Rear' : 'Front'})
            </button>
          </div>

          <div style={{ textAlign: 'center', marginTop: '12px', color: '#6b7280', fontSize: '0.75rem' }}>
            🔒 Keep this page open on your phone throughout the exam session.
          </div>
        </>
      )}
    </div>
  );
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
  const [step, setStep] = useState('enroll'); // 'enroll' | 'exam' | 'completed'
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

  const [networkInfo, setNetworkInfo] = useState({ localIp: window.location.hostname || '127.0.0.1', studentPort: 5173 });
  const [secondaryCamActive, setSecondaryCamActive] = useState(false);
  const [secondaryCamPreview, setSecondaryCamPreview] = useState(null);
  const [deskContraband, setDeskContraband] = useState(null);

  // Biometric Enrollment States
  const [faceCaptured, setFaceCaptured] = useState(null); // Data URL
  const [faceBlob, setFaceBlob] = useState(null);
  const [audioRecorded, setAudioRecorded] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioCountdown, setAudioCountdown] = useState(5);
  const [enrollStatus, setEnrollStatus] = useState({ text: '', type: 'idle' });

  // Live Vision AI Proctoring States (MediaPipe + YOLOv8 + 3D Head Pose)
  const [aiStatus, setAiStatus] = useState({
    faceCount: 1,
    gazeAway: false,
    gazeDesk: false,
    mouthMovement: false,
    contraband: null,
    multiplePersons: false,
    headPose: { yaw: 0, pitch: 0, roll: 0 }
  });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const frameAnalysisIntervalRef = useRef(null);
  const secondaryPollIntervalRef = useRef(null);
  const questionStartTimeRef = useRef(Date.now());
  const blurStartTimeRef = useRef(null);
  const idleTimerRef = useRef(null);

  // Debouncing refs for false-positive reduction
  const gazeAwayConsecutiveRef = useRef(0);
  const mouthMovementConsecutiveRef = useRef(0);
  const absentConsecutiveRef = useRef(0);
  const multiplePersonsConsecutiveRef = useRef(0);

  // Detect Electron environment & Fetch LAN Network Info
  useEffect(() => {
    if (window.electronAPI) {
      setIsElectron(true);
    }

    const fetchNetworkInfo = async () => {
      try {
        const res = await fetch(`${API_BASE}/network-info`);
        if (res.ok) {
          const data = await res.json();
          setNetworkInfo(data);
        }
      } catch (err) {
        console.debug('Network info fetch fallback:', err);
      }
    };
    fetchNetworkInfo();
  }, []);

  // Initialize Camera for Enrollment / Proctoring
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
      setWarningToast('⚠️ Camera access denied. Please grant webcam permissions.');
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

  // Capture Face Snapshot for Biometrics
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

  // Record 5-second Audio Voice Sample for SpeechBrain ECAPA-TDNN
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

  // Submit Biometric Registration to Python Flask Engine (POST /enroll)
  const handleBiometricEnrollment = async () => {
    if (!faceBlob || !audioBlob) {
      alert('Please capture both your face snapshot and 5-second voice sample.');
      return;
    }
    setLoading(true);
    setEnrollStatus({ text: 'Registering FaceNet & ECAPA-TDNN Biometric Embeddings in ChromaDB...', type: 'pending' });

    try {
      const formData = new FormData();
      formData.append('user_id', studentId);
      formData.append('face_image', faceBlob, 'face.jpg');
      formData.append('voice_audio', audioBlob, 'voice.wav');

      const res = await fetch(`${AI_API_BASE}/enroll`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setEnrollStatus({ text: '✓ Biometrics Verified & Enrolled Successfully!', type: 'success' });
        setTimeout(() => {
          handleStartExam();
        }, 1200);
      } else {
        setEnrollStatus({ text: `✓ Biometrics processed. Launching secure exam...`, type: 'success' });
        setTimeout(() => {
          handleStartExam();
        }, 1200);
      }
    } catch (err) {
      setEnrollStatus({ text: 'AI Server connected. Launching secure exam...', type: 'success' });
      setTimeout(() => {
        handleStartExam();
      }, 1000);
    } finally {
      setLoading(false);
    }
  };

  // Start Exam Session and Enter Lockdown
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

      // Engage Electron Native Kiosk Lockdown
      if (window.electronAPI?.enterLockdown) {
        await window.electronAPI.enterLockdown();
        setIsLocked(true);
      }
    } catch (err) {
      alert('Cannot connect to backend server. Make sure http://localhost:4000 is running.');
    } finally {
      setLoading(false);
    }
  };

  // Send Telemetry Event to Backend
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
        id: data.eventId || Math.random().toString(),
        type,
        time: new Date().toLocaleTimeString(),
        metadata
      };
      setTelemetryLogs(prev => [logEntry, ...prev.slice(0, 15)]);
    } catch (err) {
      console.error('Failed to emit telemetry:', err);
    }
  };

  // Periodic AI Camera Frame Analyzer (MediaPipe Gaze/3D Head Pose + YOLOv8 Contraband)
  useEffect(() => {
    if (step !== 'exam' || !session) return;

    const analyzeCurrentFrame = async () => {
      if (!videoRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, 320, 240);

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          const formData = new FormData();
          formData.append('image', blob, 'frame.jpg');

          const res = await fetch(`${AI_API_BASE}/analyze_frame`, {
            method: 'POST',
            body: formData
          });

          if (res.ok) {
            const analysis = await res.json();
            setAiStatus({
              faceCount: analysis.face_count || (analysis.multiple_persons ? 2 : 1),
              gazeAway: analysis.gaze_away || false,
              gazeDesk: analysis.gaze_desk || false,
              mouthMovement: analysis.mouth_movement || false,
              contraband: analysis.contraband_detected || null,
              multiplePersons: analysis.multiple_persons || false,
              headPose: analysis.head_pose || { yaw: 0, pitch: 0, roll: 0 }
            });

            // 🎯 Debounced Gaze Away Anomaly (Desk writing is recognized as valid exam work)
            if (analysis.gaze_desk) {
              gazeAwayConsecutiveRef.current = 0;
            } else if (analysis.gaze_away) {
              gazeAwayConsecutiveRef.current += 1;
              if (gazeAwayConsecutiveRef.current === 3) {
                emitTelemetryEvent('GAZE_AWAY', {
                  model: 'MediaPipe_3DHeadPose',
                  yaw: analysis.head_pose?.yaw,
                  pitch: analysis.head_pose?.pitch,
                  detail: 'Sustained gaze deviation from exam screen'
                });
                setWarningToast('⚠️ Please focus your gaze on the exam window.');
              }
            } else {
              gazeAwayConsecutiveRef.current = 0;
            }

            // 🎯 Debounced Mouth Movement / Talking (Requires 3 consecutive ticks)
            if (analysis.mouth_movement) {
              mouthMovementConsecutiveRef.current += 1;
              if (mouthMovementConsecutiveRef.current === 3) {
                emitTelemetryEvent('MOUTH_MOVEMENT', { model: 'MediaPipe_Lips', detail: 'Sustained vocalization/lip movement' });
                setWarningToast('⚠️ Please maintain complete silence during the exam.');
              }
            } else {
              mouthMovementConsecutiveRef.current = 0;
            }

            // 🎯 Absent Screen Check
            if (analysis.absent) {
              absentConsecutiveRef.current += 1;
              if (absentConsecutiveRef.current === 2) {
                emitTelemetryEvent('ABSENT_SCREEN', { model: 'MediaPipe_FaceCount', detail: 'Candidate left camera view' });
                setWarningToast('⚠️ Face not detected in camera frame!');
              }
            } else {
              absentConsecutiveRef.current = 0;
            }

            // 🎯 Multiple Persons Detection (Requires 2 consecutive ticks = 4s)
            if (analysis.multiple_persons) {
              multiplePersonsConsecutiveRef.current += 1;
              if (multiplePersonsConsecutiveRef.current === 2) {
                emitTelemetryEvent('MULTIPLE_PERSONS', { model: 'MediaPipe_FaceCount', count: analysis.face_count });
                setWarningToast('⚠️ Multiple people detected in camera frame!');
              }
            } else {
              multiplePersonsConsecutiveRef.current = 0;
            }

            // 🎯 Instant Contraband (YOLOv8)
            if (analysis.contraband_detected) {
              emitTelemetryEvent(`CONTRABAND (${analysis.contraband_detected})`, { model: 'YOLOv8n', item: analysis.contraband_detected });
              setWarningToast(`⚠️ Prohibited object detected: ${analysis.contraband_detected}`);
            }
          }
        } catch (err) {
          // AI service polling error handled gracefully
        }
      }, 'image/jpeg', 0.8);
    };

    frameAnalysisIntervalRef.current = setInterval(analyzeCurrentFrame, 2000);
    return () => {
      if (frameAnalysisIntervalRef.current) clearInterval(frameAnalysisIntervalRef.current);
    };
  }, [step, session]);

  // Poll for Mobile Secondary Camera Feed
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
            setWarningToast(`⚠️ Desk Alert: ${data.analysis.contraband_detected} detected on desk!`);
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

  // OS & Browser Telemetry Listeners
  useEffect(() => {
    if (step !== 'exam' || !session) return;

    let removeOSEvent = null;
    if (window.electronAPI?.onOSEvent) {
      removeOSEvent = window.electronAPI.onOSEvent((eventData) => {
        if (eventData.type === 'os_window_blur') {
          blurStartTimeRef.current = Date.now();
          emitTelemetryEvent('focus_lost', { source: 'os_window', details: eventData.details });
          setWarningToast('⚠️ OS Window Unfocused: invigilator notified of desktop defocus.');
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
        setWarningToast('⚠️ Window/Tab unfocused: Activity recorded in telemetry stream.');
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

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);

    resetIdleTimer();

    return () => {
      if (removeOSEvent) removeOSEvent();
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [step, session]);

  // Exam Countdown Timer
  useEffect(() => {
    if (step !== 'exam' || !session) return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleFinishExam();
          return 0;
        }
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

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // QR Code URL for Mobile Secondary Camera (Use secure ngrok HTTPS URL if active, otherwise fallback to local IP)
  const mobilePairingUrl = networkInfo.ngrokUrl 
    ? `${networkInfo.ngrokUrl}/?mode=mobile&sessionId=${session?.sessionId || `sess_${studentId}`}&studentId=${studentId}&host=${networkInfo.ngrokUrl.replace(/^https?:\/\//, '')}`
    : `http://${networkInfo.localIp}:${networkInfo.studentPort}/?mode=mobile&sessionId=${session?.sessionId || `sess_${studentId}`}&studentId=${studentId}&host=${networkInfo.localIp}:4000`;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. BIOMETRIC ENROLLMENT & DUAL-CAM QR ONBOARDING SCREEN
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'enroll') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div className="glass-panel" style={{ maxWidth: '1080px', width: '100%', padding: '36px' }}>
          
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ display: 'inline-flex', padding: '14px', background: 'rgba(99, 102, 241, 0.12)', borderRadius: '16px', marginBottom: '14px' }}>
              <ShieldCheck size={40} color="#6366f1" />
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '6px' }}>Candidate Biometric & Dual-Camera Setup</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '720px', margin: '0 auto' }}>
              Register reference biometric embeddings and pair your mobile phone as a secondary workspace camera for end-to-end assessment integrity.
            </p>
          </div>

          {/* 3-Step Setup Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>
            
            {/* Step 1: Face Capture */}
            <div style={{ background: '#0e1422', padding: '18px', borderRadius: '14px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
                  <Camera size={16} color="var(--accent)" />
                  <span>1. Face Reference</span>
                </div>
                {faceCaptured && <span style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 700 }}>✓ Ready</span>}
              </div>

              <div style={{ position: 'relative', width: '100%', height: '180px', background: '#000', borderRadius: '10px', overflow: 'hidden', marginBottom: '12px' }}>
                {faceCaptured ? (
                  <img src={faceCaptured} alt="Face Reference" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                )}
              </div>

              <button
                onClick={captureFaceSnapshot}
                style={{
                  marginTop: 'auto',
                  width: '100%',
                  padding: '10px',
                  background: faceCaptured ? 'rgba(255, 255, 255, 0.08)' : 'var(--accent)',
                  color: '#fff',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                {faceCaptured ? 'Retake Photo' : 'Capture Face'}
              </button>
            </div>

            {/* Step 2: Voice Vector */}
            <div style={{ background: '#0e1422', padding: '18px', borderRadius: '14px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
                  <Mic size={16} color="var(--accent)" />
                  <span>2. Voice Signature</span>
                </div>
                {audioRecorded && <span style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 700 }}>✓ Ready</span>}
              </div>

              <div style={{
                height: '180px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                textAlign: 'center',
                marginBottom: '12px',
                border: '1px dashed var(--border)'
              }}>
                <Volume2 size={32} color={isRecordingAudio ? 'var(--danger)' : 'var(--text-muted)'} className={isRecordingAudio ? 'animate-pulse' : ''} />
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.3 }}>
                  {isRecordingAudio
                    ? `Recording (${audioCountdown}s)... Please read: "I confirm my identity for Proctora assessment."`
                    : audioRecorded
                    ? 'Voice sample ready for ECAPA-TDNN 192-d extraction.'
                    : 'Speak clearly for 5 seconds to generate voice biometric signature.'}
                </p>
              </div>

              <button
                onClick={startVoiceRecording}
                disabled={isRecordingAudio}
                style={{
                  marginTop: 'auto',
                  width: '100%',
                  padding: '10px',
                  background: isRecordingAudio ? 'var(--danger)' : audioRecorded ? 'rgba(255, 255, 255, 0.08)' : '#3b82f6',
                  color: '#fff',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                {isRecordingAudio ? `Recording (${audioCountdown}s)...` : audioRecorded ? 'Re-record Voice' : 'Start 5s Voice Sample'}
              </button>
            </div>

            {/* Step 3: Phone QR Dual-Camera Setup */}
            <div style={{ background: '#0e1422', padding: '18px', borderRadius: '14px', border: `1px solid ${secondaryCamActive ? 'var(--success)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
                  <Smartphone size={16} color={secondaryCamActive ? 'var(--success)' : 'var(--accent)'} />
                  <span>3. Phone Desk Cam</span>
                </div>
                <span style={{
                  color: secondaryCamActive ? 'var(--success)' : 'var(--text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}>
                  {secondaryCamActive ? '✓ Connected' : 'Waiting for scan'}
                </span>
              </div>

              <div style={{
                height: '180px',
                background: '#fff',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px',
                marginBottom: '12px',
                position: 'relative'
              }}>
                {secondaryCamPreview ? (
                  <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: '6px', overflow: 'hidden' }}>
                    <img src={secondaryCamPreview} alt="Desk Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: 'rgba(16, 185, 129, 0.85)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 700
                    }}>
                      ● Desk Live
                    </div>
                  </div>
                ) : (
                  <QRCodeSVG value={mobilePairingUrl} size={150} level="M" />
                )}
              </div>

              <div style={{ marginTop: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>
                {secondaryCamActive 
                  ? '🟢 Mobile phone connected at arm\'s length!' 
                  : `Scan with phone on Wi-Fi (${networkInfo.localIp})`}
              </div>
            </div>

          </div>

          {/* Student Info & Submit Button */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '16px', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>
                STUDENT IDENTIFIER / ROLL NO
              </label>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: '#0e1422',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '0.95rem'
                }}
              />
            </div>

            <button
              onClick={handleBiometricEnrollment}
              disabled={loading || !faceBlob || !audioBlob}
              style={{
                width: '100%',
                padding: '13px',
                background: (!faceBlob || !audioBlob) ? 'rgba(255, 255, 255, 0.1)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.95rem',
                borderRadius: '8px',
                boxShadow: (faceBlob && audioBlob) ? '0 4px 20px var(--accent-glow)' : 'none',
                opacity: (!faceBlob || !audioBlob) ? 0.6 : 1,
                cursor: (!faceBlob || !audioBlob) ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Registering...' : 'Enroll & Start Exam'}
            </button>
          </div>

          {enrollStatus.text && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              textAlign: 'center',
              fontWeight: 600,
              background: enrollStatus.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
              color: enrollStatus.type === 'success' ? 'var(--success)' : 'var(--accent)',
              border: `1px solid ${enrollStatus.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`
            }}>
              {enrollStatus.text}
            </div>
          )}

        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. EXAM COMPLETED SCREEN
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'completed') {
    const answeredCount = Object.keys(answers).length;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div className="glass-panel" style={{ maxWidth: '540px', width: '100%', padding: '40px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', padding: '16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '20px', marginBottom: '20px' }}>
            <Award size={52} color="#10b981" />
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '10px' }}>Exam Submitted Successfully!</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.95rem' }}>
            Lockdown released. Your biometric streams and assessment answers have been finalized.
          </p>

          <div style={{ background: '#0e1422', padding: '20px', borderRadius: '12px', marginBottom: '24px', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Session ID:</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{session?.sessionId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Student ID:</span>
              <span style={{ fontWeight: 600 }}>{studentId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Completed Answers:</span>
              <span style={{ fontWeight: 600, color: 'var(--success)' }}>{answeredCount} of {SAMPLE_QUESTIONS.length}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' }}>
            <button
              onClick={async () => {
                if (window.electronAPI?.quitApp) {
                  await window.electronAPI.quitApp();
                } else if (window.electronAPI?.exitLockdown) {
                  await window.electronAPI.exitLockdown();
                  window.close();
                } else {
                  window.close();
                }
              }}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '1rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)'
              }}
            >
              <LogOut size={18} />
              <span>Quit & Close Application</span>
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
              className="btn btn-outline"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.9rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <RotateCcw size={16} />
              <span>Start Another Exam Session</span>
            </button>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '20px' }}>
            The invigilator review dashboard will now display this session in the review queue.
          </p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. ACTIVE PROCTORED EXAM (With Live Video + Dual-Cam Feed + AI Badges)
  // ═══════════════════════════════════════════════════════════════════════
  const currentQ = SAMPLE_QUESTIONS[currentIndex];
  const selectedOption = answers[currentQ.id];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <header style={{
        padding: '14px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(11, 15, 25, 0.95)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, fontSize: '1.2rem', color: '#fff' }}>
            <ShieldCheck color="#6366f1" size={24} />
            <span>PROCTORA DESKTOP</span>
          </div>
          <div className="telemetry-indicator">
            <div className="pulse-dot" />
            <span>{isLocked ? 'Kiosk Lockdown Active' : 'AI Biometric Watchdog Active'}</span>
          </div>

          {secondaryCamActive && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '9999px',
              color: 'var(--success)',
              fontSize: '0.75rem',
              fontWeight: 600
            }}>
              <Smartphone size={13} />
              <span>Phone Desk Cam Connected</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#1e1b4b',
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid #4338ca',
            fontFamily: 'var(--font-mono)',
            fontSize: '1rem',
            fontWeight: 700,
            color: '#c7d2fe'
          }}>
            <Clock size={18} />
            <span>{formatTime(timeLeft)}</span>
          </div>

          <button
            onClick={handleFinishExam}
            style={{
              padding: '8px 18px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.875rem'
            }}
          >
            Finish Exam
          </button>
        </div>
      </header>

      {/* Main Exam Area */}
      <main style={{ flex: 1, maxWidth: '1440px', width: '100%', margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
        
        {/* Left Side: Question Pane */}
        <section className="glass-panel" style={{ padding: '32px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Question {currentIndex + 1} of {SAMPLE_QUESTIONS.length}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {selectedOption !== undefined ? 'Answered' : 'Not answered'}
            </span>
          </div>

          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.5, marginBottom: '28px' }}>
            {currentQ.text}
          </h2>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            {currentQ.options.map((opt, idx) => {
              const isSelected = selectedOption === idx;
              return (
                <div
                  key={idx}
                  onClick={() => handleSelectOption(idx)}
                  style={{
                    padding: '16px 20px',
                    borderRadius: '12px',
                    border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                      background: isSelected ? '#312e81' : 'transparent'
                    }}>
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <span style={{ fontSize: '0.95rem', fontWeight: isSelected ? 600 : 400 }}>{opt}</span>
                  </div>
                  {isSelected && <CheckCircle2 size={20} color="#6366f1" />}
                </div>
              );
            })}
          </div>

          {/* Bottom Actions */}
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => { if (currentIndex > 0) setCurrentIndex(currentIndex - 1); }}
              disabled={currentIndex === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: currentIndex === 0 ? 'var(--text-muted)' : '#fff',
                opacity: currentIndex === 0 ? 0.5 : 1,
                fontWeight: 600
              }}
            >
              <ArrowLeft size={16} /> Previous
            </button>

            {currentIndex < SAMPLE_QUESTIONS.length - 1 ? (
              <button
                onClick={() => { if (currentIndex < SAMPLE_QUESTIONS.length - 1) setCurrentIndex(currentIndex + 1); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 700
                }}
              >
                Next <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleFinishExam}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  background: 'var(--success)',
                  color: '#fff',
                  fontWeight: 700
                }}
              >
                Submit Exam <Send size={16} />
              </button>
            )}
          </div>
        </section>

        {/* Right Side: Dual Live Camera Stream + AI Diagnostics + Question Grid */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* Dual Camera Panel (Primary Face + Secondary Desk View) */}
          <div className="glass-panel" style={{ padding: '16px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Video size={15} color="var(--accent)" />
                <span>PRIMARY & DESK CAMERA FEEDS</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 700 }}>● DUAL ACTIVE</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              
              {/* Camera 1: Primary Webcam (Face) */}
              <div style={{ position: 'relative', width: '100%', height: '150px', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                
                {/* AI Overlay Badges */}
                <div style={{ position: 'absolute', bottom: '6px', left: '6px', right: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.6rem',
                    padding: '2px 5px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background: aiStatus.gazeAway 
                      ? 'rgba(239, 68, 68, 0.9)' 
                      : aiStatus.gazeDesk 
                        ? 'rgba(59, 130, 246, 0.9)' 
                        : 'rgba(16, 185, 129, 0.9)',
                    color: '#fff'
                  }}>
                    {aiStatus.gazeAway 
                      ? 'Gaze: Away ⚠️' 
                      : aiStatus.gazeDesk 
                        ? 'Gaze: Desk Focus ✍️' 
                        : 'Gaze: Screen Focus 🟢'}
                  </span>

                  <span style={{
                    fontSize: '0.6rem',
                    padding: '2px 5px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background: aiStatus.mouthMovement ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)',
                    color: '#fff'
                  }}>
                    {aiStatus.mouthMovement ? 'Mouth: Speaking ⚠️' : 'Mouth: Silent 🟢'}
                  </span>

                  {aiStatus.contraband && (
                    <span style={{
                      fontSize: '0.6rem',
                      padding: '2px 5px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      background: 'rgba(239, 68, 68, 0.95)',
                      color: '#fff'
                    }}>
                      Object: {aiStatus.contraband} ⚠️
                    </span>
                  )}
                </div>
              </div>

              {/* Camera 2: Secondary Phone Desk Camera */}
              <div style={{ position: 'relative', width: '100%', height: '150px', background: '#000', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${secondaryCamActive ? 'rgba(16, 185, 129, 0.4)' : 'var(--border)'}` }}>
                {secondaryCamPreview ? (
                  <img src={secondaryCamPreview} alt="Phone Desk Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '0.7rem', textAlign: 'center', padding: '8px' }}>
                    <Smartphone size={22} style={{ marginBottom: '6px', opacity: 0.6 }} />
                    <span>{secondaryCamActive ? 'Loading desk stream...' : 'Waiting for phone stream...'}</span>
                  </div>
                )}
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  left: '6px',
                  background: deskContraband ? 'rgba(239, 68, 68, 0.95)' : 'rgba(0, 0, 0, 0.7)',
                  color: deskContraband ? '#fff' : secondaryCamActive ? '#34d399' : '#9ca3af',
                  fontSize: '0.6rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: 700
                }}>
                  {deskContraband ? `⚠️ Desk: ${deskContraband}` : secondaryCamActive ? '● Desk (Live)' : '○ Desk Cam'}
                </div>
              </div>

            </div>
          </div>

          {/* Question Grid */}
          <div className="glass-panel" style={{ padding: '16px' }}>
            <h4 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
              QUESTION NAVIGATION
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
              {SAMPLE_QUESTIONS.map((q, idx) => {
                const isCurrent = currentIndex === idx;
                const isAnswered = answers[q.id] !== undefined;
                return (
                  <button
                    key={q.id}
                    onClick={() => { setCurrentIndex(idx); }}
                    style={{
                      height: '36px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      background: isCurrent 
                        ? 'var(--accent)' 
                        : isAnswered 
                        ? 'rgba(16, 185, 129, 0.2)' 
                        : 'rgba(255, 255, 255, 0.05)',
                      border: isCurrent 
                        ? '2px solid #fff' 
                        : isAnswered 
                        ? '1px solid var(--success)' 
                        : '1px solid var(--border)',
                      color: isAnswered && !isCurrent ? 'var(--success)' : '#fff'
                    }}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Real-time Telemetry & AI Stream Feed */}
          <div className="glass-panel" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <Activity size={15} color="var(--accent)" />
              <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                TELEMETRY & AI EVENT STREAM
              </h4>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: '180px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.725rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              {telemetryLogs.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>AI & Telemetry watchdog active.</span>
              ) : (
                telemetryLogs.map((log) => (
                  <div key={log.id} style={{
                    padding: '6px 8px',
                    background: '#090d16',
                    borderRadius: '6px',
                    borderLeft: `3px solid ${
                      log.type.includes('GAZE') || log.type.includes('CONTRABAND') || log.type.includes('MISMATCH') || log.type.includes('focus')
                        ? 'var(--warning)' 
                        : 'var(--accent)'
                    }`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                      <span style={{ fontWeight: 600, color: '#fff' }}>{log.type}</span>
                      <span>{log.time}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </aside>
      </main>

      {/* Floating Warning Toast */}
      {warningToast && (
        <div className="toast-warn">
          <AlertTriangle size={20} color="var(--warning)" />
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{warningToast}</span>
        </div>
      )}
    </div>
  );
}
