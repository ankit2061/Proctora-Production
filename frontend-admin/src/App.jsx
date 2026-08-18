import React, { useState, useEffect, useRef } from 'react';
import {
  Eye,
  Flag,
  AlertCircle,
  Clock,
  RefreshCw,
  ArrowLeft,
  Camera,
  Video,
  Search,
  ChevronRight,
  Zap,
  ShieldAlert,
  Power,
  Activity,
  Server,
  Wifi,
  Play,
  CheckCircle,
  RotateCcw
} from 'lucide-react';

const ENV_API_URL = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : null;
const API_ROOT = ENV_API_URL || (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') ? 'http://localhost:4000' : window.location.origin);
const API_BASE = API_ROOT.endsWith('/api') ? API_ROOT : `${API_ROOT}/api`;
const HEALTH_URL = `${API_ROOT.replace(/\/api$/, '')}/health`;

// ═══════════════════════════════════════════════════════
// RISK DIAL — SVG radial gauge (the signature element)
// ═══════════════════════════════════════════════════════
function RiskDial({ score = 0, size = 60 }) {
  const pct = Math.round(score * 100);
  const radius = (size / 2) - 6;
  const circumference = 2 * Math.PI * radius;
  // Sweep 270° of the circle (0.75 of circumference)
  const arcLength = circumference * 0.75;
  const filled = arcLength * score;
  const gap = arcLength - filled;

  // Color based on severity
  let arcColor = 'var(--clear-green)';
  let label = 'LOW';
  if (score >= 0.6) { arcColor = 'var(--signal-red)'; label = 'HIGH'; }
  else if (score >= 0.25) { arcColor = 'var(--amber-watch)'; label = 'MED'; }

  const center = size / 2;
  // Font sizing scales with dial size
  const numSize = size >= 100 ? '1.1rem' : '0.7rem';
  const labelSize = size >= 100 ? '0.6rem' : '0.45rem';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', flexShrink: 0 }}
      role="img"
      aria-label={`Risk score: ${pct}% (${label})`}
    >
      {/* Background arc */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--bg-raised)"
        strokeWidth={size >= 100 ? 5 : 3.5}
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(135 ${center} ${center})`}
      />
      {/* Filled arc */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={arcColor}
        strokeWidth={size >= 100 ? 5 : 3.5}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(135 ${center} ${center})`}
        style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }}
      />
      {/* Center number */}
      <text
        x={center}
        y={center - 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={arcColor}
        fontFamily="var(--font-display)"
        fontSize={numSize}
        fontWeight="500"
      >
        {pct}
      </text>
      {/* Label */}
      <text
        x={center}
        y={center + (size >= 100 ? 16 : 10)}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--chalk-mid)"
        fontFamily="var(--font-display)"
        fontSize={labelSize}
        letterSpacing="0.08em"
      >
        {label}
      </text>
    </svg>
  );
}

const getEventSeverity = (type = '') => {
  const s = String(type).toLowerCase();
  if (s.includes('contraband') || s.includes('mismatch') || s.includes('multiple') || s.includes('absent') || s.includes('terminated')) return 'critical';
  if (s.includes('gaze') || s.includes('mouth') || s.includes('focus') || s.includes('idle')) return 'warning';
  return 'info';
};

const formatTime = (dateStr) => {
  if (!dateStr) return '--:--:--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleTimeString('en-GB');
  } catch (e) {
    return '--:--:--';
  }
};

// ═══════════════════════════════════════════════════════
// INCIDENT TAPE — weighted inline text (not pills)
// ═══════════════════════════════════════════════════════
function IncidentTape({ signals = [], compact = false }) {
  if (!signals || signals.length === 0) {
    return <span style={{ color: 'var(--chalk-dim)', fontFamily: 'var(--font-data)', fontSize: '0.72rem' }}>clear</span>;
  }

  const classify = (sig) => {
    const s = sig.toLowerCase();
    if (s.includes('contraband') || s.includes('mismatch') || s.includes('multiple') || s.includes('absent')) return 'critical';
    if (s.includes('gaze') || s.includes('mouth') || s.includes('focus')) return 'warning';
    return 'info';
  };

  // Sort: critical first, then warning, then info
  const sorted = [...signals].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[classify(a)] - order[classify(b)];
  });

  if (compact && sorted.length > 2) {
    // In compact (LOW) tiles, show count only
    const critCount = sorted.filter(s => classify(s) === 'critical').length;
    return (
      <span className="incident-tape">
        {critCount > 0 && <span className="tag-critical">{critCount} critical</span>}
        {critCount > 0 && sorted.length > critCount && <span className="tag-sep">·</span>}
        <span className="tag-info">{sorted.length} total</span>
      </span>
    );
  }

  return (
    <span className="incident-tape">
      {sorted.map((sig, i) => {
        const sev = classify(sig);
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className="tag-sep">·</span>}
            <span className={`tag-${sev}`}>{sig}</span>
          </React.Fragment>
        );
      })}
    </span>
  );
}

// ═══════════════════════════════════════════════════════
// LIVE CLOCK
// ═══════════════════════════════════════════════════════
function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--chalk)', letterSpacing: '0.04em' }}>
      {time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════
export default function App() {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [sessionEvents, setSessionEvents] = useState([]);
  const [sessionFlags, setSessionFlags] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [flagSeverity, setFlagSeverity] = useState('medium');
  const [submittingFlag, setSubmittingFlag] = useState(false);
  const [secondaryStream, setSecondaryStream] = useState(null);
  const [primaryStream, setPrimaryStream] = useState(null);
  const [terminatingSessionId, setTerminatingSessionId] = useState(null);

  // Backend Connection, Health & Wake-Up Controller States
  const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'waking' | 'offline' | 'checking'
  const [backendLatency, setBackendLatency] = useState(null);
  const [wakingElapsedSec, setWakingElapsedSec] = useState(0);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [preventSleep, setPreventSleep] = useState(true);
  const [serverDetails, setServerDetails] = useState(null);
  const wakingIntervalRef = useRef(null);
  const wakingTimerRef = useRef(null);

  // Check backend health & compute roundtrip latency
  const checkBackendHealth = async () => {
    const startTime = Date.now();
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        setBackendLatency(Date.now() - startTime);
        setBackendStatus('online');
        setServerDetails(data);
        return true;
      } else {
        if (!isWakingUp) setBackendStatus('offline');
        return false;
      }
    } catch (err) {
      if (!isWakingUp) {
        setBackendStatus('offline');
      }
      return false;
    }
  };

  // Wake up sleeping backend (e.g. Render 15-minute inactivity spin-down)
  const wakeUpBackend = async () => {
    setIsWakingUp(true);
    setBackendStatus('waking');
    setWakingElapsedSec(0);

    if (wakingTimerRef.current) clearInterval(wakingTimerRef.current);
    if (wakingIntervalRef.current) clearInterval(wakingIntervalRef.current);

    const startWakingTime = Date.now();
    wakingTimerRef.current = setInterval(() => {
      setWakingElapsedSec(Math.floor((Date.now() - startWakingTime) / 1000));
    }, 1000);

    const attemptWake = async () => {
      try {
        const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          setBackendStatus('online');
          setIsWakingUp(false);
          setServerDetails(data);
          setBackendLatency(Date.now() - startWakingTime);
          if (wakingTimerRef.current) clearInterval(wakingTimerRef.current);
          if (wakingIntervalRef.current) clearInterval(wakingIntervalRef.current);
          fetchSessions();
          return true;
        }
      } catch (err) {}
      return false;
    };

    // Immediate attempt
    const success = await attemptWake();
    if (!success) {
      // Retry every 3 seconds for up to 70 seconds (handles Render cold start)
      wakingIntervalRef.current = setInterval(async () => {
        const isUp = await attemptWake();
        if (isUp) {
          if (wakingIntervalRef.current) clearInterval(wakingIntervalRef.current);
        }
      }, 3000);

      setTimeout(() => {
        if (wakingIntervalRef.current) clearInterval(wakingIntervalRef.current);
        if (wakingTimerRef.current) clearInterval(wakingTimerRef.current);
        setIsWakingUp(false);
      }, 75000);
    }
  };

  // Periodic health check & keepalive to prevent Render sleep
  useEffect(() => {
    checkBackendHealth();

    const healthInterval = setInterval(() => {
      if (!isWakingUp) {
        checkBackendHealth();
      }
    }, 8000);

    // Auto-Keepalive ping every 3.5 minutes (210s) to keep cloud free-tier permanently awake
    const keepaliveInterval = setInterval(() => {
      if (preventSleep) {
        fetch(HEALTH_URL).catch(() => {});
      }
    }, 210000);

    return () => {
      clearInterval(healthInterval);
      clearInterval(keepaliveInterval);
      if (wakingTimerRef.current) clearInterval(wakingTimerRef.current);
      if (wakingIntervalRef.current) clearInterval(wakingIntervalRef.current);
    };
  }, [preventSleep, isWakingUp]);

  // Fetch all sessions
  const fetchSessions = async () => {
    try {
      let url = `${API_BASE}/admin/sessions`;
      if (statusFilter) url += `?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      setSessions(data.items || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };

  // Fetch details, events, and flags for a specific session
  const fetchSessionDetails = async (id) => {
    try {
      const [resSession, resEvents, resFlags, resSec, resPrim] = await Promise.all([
        fetch(`${API_BASE}/sessions/${id}`),
        fetch(`${API_BASE}/sessions/${id}/events`),
        fetch(`${API_BASE}/admin/sessions/${id}/flags`),
        fetch(`${API_BASE}/sessions/${id}/secondary-stream`),
        fetch(`${API_BASE}/sessions/${id}/primary-stream`)
      ]);

      const dataSession = await resSession.json();
      const dataEvents = await resEvents.json();
      const dataFlags = await resFlags.json();
      const dataSec = await resSec.json();
      const dataPrim = await resPrim.json();

      if (dataSession && !dataSession.error) {
        setSessionDetail(dataSession);
      }
      setSessionEvents(Array.isArray(dataEvents?.events) ? dataEvents.events : []);
      setSessionFlags(Array.isArray(dataFlags?.flags) ? dataFlags.flags : []);
      setSecondaryStream(dataSec && !dataSec.error ? dataSec : null);
      setPrimaryStream(dataPrim && !dataPrim.error ? dataPrim : null);
    } catch (err) {
      console.error('Failed to load session drilldown:', err);
    }
  };

  useEffect(() => {
    fetchSessions();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchSessions();
      if (selectedSessionId) {
        fetchSessionDetails(selectedSessionId);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedSessionId, statusFilter, autoRefresh]);

  const handleSelectSession = (id) => {
    setSelectedSessionId(id);
    fetchSessionDetails(id);
  };

  const handleTerminateSession = (sessionIdToTerminate, e) => {
    if (e) e.stopPropagation();
    const targetId = sessionIdToTerminate || selectedSessionId;
    if (!targetId) return;
    setTerminatingSessionId(targetId);
  };

  const confirmTermination = async () => {
    if (!terminatingSessionId) return;
    const targetId = terminatingSessionId;
    const reason = 'Terminated by Invigilator due to suspicious activity';

    try {
      const res = await fetch(`${API_BASE}/admin/sessions/${targetId}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });

      if (res.ok) {
        fetchSessions();
        if (selectedSessionId === targetId) {
          fetchSessionDetails(targetId);
        }
      } else {
        alert('Failed to terminate session.');
      }
    } catch (err) {
      console.error('Failed to terminate session:', err);
    } finally {
      setTerminatingSessionId(null);
    }
  };


  const handleAddFlag = async (e) => {
    e.preventDefault();
    if (!newNote.trim() || !selectedSessionId) return;
    setSubmittingFlag(true);
    try {
      await fetch(`${API_BASE}/admin/sessions/${selectedSessionId}/flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote, severity: flagSeverity })
      });
      setNewNote('');
      fetchSessionDetails(selectedSessionId);
    } catch (err) {
      console.error('Failed to add flag:', err);
    } finally {
      setSubmittingFlag(false);
    }
  };

  const filteredSessions = sessions.filter(s =>
    s.sessionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.studentId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Classify session severity for tile sizing
  const getSeverity = (score) => {
    if (score >= 0.6) return 'high';
    if (score >= 0.25) return 'med';
    return 'low';
  };

  // Sort: HIGH first, then MED, then LOW — proctor sees urgent first
  const sortedSessions = [...filteredSessions].sort((a, b) => {
    return (b.riskScore || 0) - (a.riskScore || 0);
  });

  const getEventSeverity = (type) => {
    if (type.includes('CONTRABAND') || type.includes('MISMATCH') || type.includes('MULTIPLE') || type.includes('ABSENT')) return 'critical';
    if (type.includes('GAZE') || type.includes('MOUTH') || type.includes('focus')) return 'warning';
    return 'info';
  };

  // Roll call counts
  const totalDesks = sessions.length;
  const activeDesks = sessions.filter(s => s.status === 'active').length;
  const flaggedDesks = sessions.filter(s => (s.riskScore || 0) >= 0.6).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', display: 'flex', flexDirection: 'column' }}>

      {/* ═══ CONTROL ROOM HEADER ═══ */}
      <header style={{
        padding: '10px 28px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-deep)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        {/* Left: Identity + Roll Call */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '24px' }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            fontWeight: 500,
            color: 'var(--chalk)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase'
          }}>
            Proctora
          </span>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.75rem',
            color: 'var(--chalk-mid)',
            letterSpacing: '0.04em'
          }}>
            Watch Floor
            {sessions.length > 0 && (
              <> · <span style={{ color: 'var(--chalk)' }}>{totalDesks}</span> desks</>
            )}
            {activeDesks > 0 && (
              <> · <span style={{ color: 'var(--amber-watch)' }}>{activeDesks}</span> active</>
            )}
            {flaggedDesks > 0 && (
              <> · <span style={{ color: 'var(--signal-red)' }}>{flaggedDesks}</span> flagged</>
            )}
          </span>
        </div>

        {/* Right: Backend Live Status + Wake Up Button + Keepalive + Clock + Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>

          {/* Backend Status & Wake-Up Controller Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-slate)',
            padding: '4px 10px',
            borderRadius: '4px',
            border: `1px solid ${backendStatus === 'online' ? 'rgba(59,166,118,0.25)' : backendStatus === 'waking' ? 'rgba(212,148,58,0.35)' : 'rgba(224,78,67,0.35)'}`
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: backendStatus === 'online' ? 'var(--clear-green)' : backendStatus === 'waking' ? 'var(--amber-watch)' : 'var(--signal-red)',
                boxShadow: backendStatus === 'online' ? '0 0 8px var(--clear-green)' : backendStatus === 'waking' ? '0 0 8px var(--amber-watch)' : '0 0 6px var(--signal-red)',
                animation: backendStatus === 'waking' ? 'pulse 1.2s infinite' : 'none'
              }} />
              <span style={{
                fontFamily: 'var(--font-data)',
                fontSize: '0.72rem',
                color: backendStatus === 'online' ? 'var(--clear-green)' : backendStatus === 'waking' ? 'var(--amber-watch)' : 'var(--signal-red)'
              }}>
                {backendStatus === 'online'
                  ? `Backend Live ${backendLatency !== null ? `(${backendLatency}ms)` : ''}`
                  : backendStatus === 'waking'
                  ? `Waking Server (${wakingElapsedSec}s)...`
                  : 'Backend Offline / Sleeping'}
              </span>
            </div>

            {/* Wake Up Button (when offline or waking) */}
            {backendStatus !== 'online' && (
              <button
                type="button"
                onClick={wakeUpBackend}
                disabled={isWakingUp}
                className="btn-primary"
                style={{
                  padding: '3px 8px',
                  fontSize: '0.68rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  borderRadius: '3px',
                  cursor: isWakingUp ? 'wait' : 'pointer'
                }}
                title="Send wake-up call to backend (wakes Render from inactivity sleep)"
              >
                {isWakingUp ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={11} />}
                {isWakingUp ? 'Waking...' : 'Wake Backend'}
              </button>
            )}

            {/* Anti-Sleep Keepalive Toggle */}
            <button
              type="button"
              onClick={() => setPreventSleep(!preventSleep)}
              style={{
                background: preventSleep ? 'rgba(59,166,118,0.15)' : 'transparent',
                border: '1px solid ' + (preventSleep ? 'rgba(59,166,118,0.3)' : 'var(--border-subtle)'),
                color: preventSleep ? 'var(--clear-green)' : 'var(--chalk-dim)',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '0.65rem',
                fontFamily: 'var(--font-data)',
                cursor: 'pointer'
              }}
              title="Sends background keepalive pings every 3.5 mins to prevent Render free-tier from sleeping"
            >
              Anti-Sleep: {preventSleep ? 'ON' : 'OFF'}
            </button>
          </div>

          <LiveClock />

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="btn-ghost"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              fontSize: '0.75rem'
            }}
            aria-label={autoRefresh ? 'Pause live feed' : 'Resume live feed'}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: autoRefresh ? 'var(--clear-green)' : 'var(--chalk-dim)',
              boxShadow: autoRefresh ? '0 0 6px var(--clear-green-glow)' : 'none',
              transition: 'background 0.2s ease'
            }} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main style={{ flex: 1, padding: '20px 28px', maxWidth: '1600px', width: '100%', margin: '0 auto' }}>

        {!selectedSessionId ? (
          /* ═══════════════════════════════════════════
             WATCH FLOOR — CCTV Monitor Wall
             ═══════════════════════════════════════════ */
          <div>
            {/* Search + Filter Strip */}
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '18px',
              alignItems: 'center'
            }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '340px' }}>
                <Search size={14} color="var(--chalk-dim)" style={{ position: 'absolute', left: '10px', top: '10px' }} />
                <input
                  type="text"
                  placeholder="Search desk ID or student..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px 8px 32px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-display)'
                  }}
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)'
                }}
              >
                <option value="">All desks</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {/* Tile Grid */}
            {sortedSessions.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '80px 20px',
                color: 'var(--chalk-dim)',
                fontFamily: 'var(--font-display)',
                fontSize: '0.85rem'
              }}>
                No exam sessions on this floor. Start an exam in the student kiosk.
              </div>
            ) : (
              <div className="watch-floor">
                {sortedSessions.map((s) => {
                  const sev = getSeverity(s.riskScore || 0);
                  const tileClass = `desk-tile desk-tile--${sev}`;

                  if (sev === 'low') {
                    // LOW: compact single-line strip
                    return (
                      <div
                        key={s.sessionId}
                        className={tileClass}
                        onClick={() => handleSelectSession(s.sessionId)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectSession(s.sessionId)}
                        role="button"
                        aria-label={`Focus desk ${s.studentId}, risk low`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                          <span className="sev-dot sev-dot--low" />
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', color: 'var(--chalk)' }}>
                            {s.studentId}
                          </span>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: '0.68rem', color: 'var(--chalk-dim)' }}>
                            {s.sessionId}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <RiskDial score={s.riskScore || 0} size={36} />
                          <ChevronRight size={14} color="var(--chalk-dim)" />
                        </div>
                      </div>
                    );
                  }

                  // HIGH & MEDIUM: standard tile
                  return (
                    <div
                      key={s.sessionId}
                      className={tileClass}
                      onClick={() => handleSelectSession(s.sessionId)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleSelectSession(s.sessionId)}
                      role="button"
                      aria-label={`Focus desk ${s.studentId}, risk ${sev}`}
                    >
                      {/* Tile header: student + status */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--chalk)', marginBottom: '2px' }}>
                            {s.studentId}
                          </div>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: '0.68rem', color: 'var(--chalk-dim)' }}>
                            {s.sessionId}
                            <span style={{ marginLeft: '8px', color: s.status === 'active' ? 'var(--amber-watch)' : 'var(--chalk-dim)' }}>
                              {s.status}
                            </span>
                          </div>
                        </div>
                        <RiskDial score={s.riskScore || 0} size={sev === 'high' ? 68 : 56} />
                      </div>

                      {/* Incident tape */}
                      <div>
                        <IncidentTape signals={s.signals} />
                      </div>

                      {/* Exam ID + action hint */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 'auto',
                        paddingTop: '8px',
                        borderTop: '1px solid var(--border-subtle)'
                      }}>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: '0.68rem', color: 'var(--chalk-dim)' }}>
                          {s.examId}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: '0.68rem',
                          color: 'var(--chalk-mid)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          Focus desk <ChevronRight size={12} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ═══════════════════════════════════════════
             DESK FOCUS — Session Detail Drilldown
             ═══════════════════════════════════════════ */
          <div>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setSelectedSessionId(null)}
                className="btn-ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-display)'
                }}
              >
                <ArrowLeft size={14} /> Return to floor
              </button>

              {sessionDetail && (
                <button
                  onClick={(e) => handleTerminateSession(sessionDetail.sessionId, e)}
                  disabled={sessionDetail.status === 'terminated'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 16px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                    background: sessionDetail.status === 'terminated' ? 'var(--bg-deep)' : 'var(--signal-red)',
                    color: sessionDetail.status === 'terminated' ? 'var(--chalk-dim)' : '#fff',
                    border: sessionDetail.status === 'terminated' ? '1px solid var(--border-subtle)' : 'none',
                    borderRadius: '4px',
                    cursor: sessionDetail.status === 'terminated' ? 'not-allowed' : 'pointer',
                    boxShadow: sessionDetail.status === 'terminated' ? 'none' : '0 0 12px rgba(224, 78, 67, 0.4)'
                  }}
                >
                  <ShieldAlert size={14} />
                  {sessionDetail.status === 'terminated' ? 'Exam Terminated' : 'Force End Exam'}
                </button>
              )}
            </div>

            {sessionDetail && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '20px' }}>

                {/* ─── Left Column: Risk Assessment + Watch Log ─── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                  {/* Desk Assessment Panel */}
                  <div className="panel-slate" style={{ padding: '22px' }}>
                    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '18px' }}>
                      <RiskDial score={sessionDetail.riskScore || 0} size={110} />
                      <div style={{ flex: 1 }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '6px'
                        }}>
                          <div style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: '1rem',
                            color: 'var(--chalk)',
                            letterSpacing: '0.02em'
                          }}>
                            Desk Focus — {sessionDetail.studentId}
                          </div>
                          <button
                            onClick={(e) => handleTerminateSession(sessionDetail.sessionId, e)}
                            disabled={sessionDetail.status === 'terminated'}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '5px 12px',
                              fontSize: '0.75rem',
                              fontFamily: 'var(--font-display)',
                              fontWeight: 600,
                              background: sessionDetail.status === 'terminated' ? 'var(--bg-deep)' : 'var(--signal-red)',
                              color: sessionDetail.status === 'terminated' ? 'var(--chalk-dim)' : '#fff',
                              border: sessionDetail.status === 'terminated' ? '1px solid var(--border-subtle)' : 'none',
                              borderRadius: '4px',
                              cursor: sessionDetail.status === 'terminated' ? 'not-allowed' : 'pointer'
                            }}
                          >
                            <ShieldAlert size={13} />
                            {sessionDetail.status === 'terminated' ? 'Terminated' : 'Force End Exam'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--chalk-dim)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em', marginBottom: '2px' }}>SESSION</div>
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: '0.78rem', color: 'var(--chalk)' }}>{sessionDetail.sessionId}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--chalk-dim)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em', marginBottom: '2px' }}>EVENTS</div>
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: '0.78rem', color: 'var(--chalk)' }}>{sessionEvents.length}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--chalk-dim)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em', marginBottom: '2px' }}>STATUS</div>
                            <div style={{
                              fontFamily: 'var(--font-data)',
                              fontSize: '0.78rem',
                              color: sessionDetail.status === 'active' ? 'var(--amber-watch)' : 'var(--chalk-mid)'
                            }}>
                              {sessionDetail.status}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* AI Explanation */}
                    {sessionDetail.explanation && (
                      <div className="panel-raised" style={{
                        padding: '12px 14px',
                        borderLeft: '3px solid var(--amber-watch)'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '6px',
                          fontFamily: 'var(--font-display)',
                          fontSize: '0.72rem',
                          color: 'var(--amber-watch)',
                          letterSpacing: '0.06em'
                        }}>
                          <Zap size={13} />
                          ANALYSIS
                        </div>
                        <p style={{ fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--chalk)' }}>
                          {sessionDetail.explanation}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Dual Camera Feeds */}
                  <div className="panel-slate" style={{ padding: '18px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '12px'
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.72rem',
                        color: 'var(--chalk-mid)',
                        letterSpacing: '0.06em'
                      }}>
                        CAMERA FEEDS
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-data)',
                        fontSize: '0.68rem',
                        color: secondaryStream?.active ? 'var(--clear-green)' : 'var(--chalk-dim)'
                      }}>
                        {secondaryStream?.active ? '● desk cam live' : '○ desk cam offline'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      {/* Primary webcam */}
                      <div className="panel-raised" style={{ padding: '10px' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--chalk-mid)', fontFamily: 'var(--font-display)', marginBottom: '8px', letterSpacing: '0.04em' }}>
                          CAM 1 · FACE
                        </div>
                        <div style={{
                          height: '160px',
                          background: 'var(--bg-deep)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: `1px solid ${primaryStream?.active ? 'var(--clear-green-dim)' : 'var(--border-subtle)'}`,
                          position: 'relative'
                        }}>
                          {primaryStream?.imageBase64 ? (
                            <img
                              src={primaryStream.imageBase64}
                              alt="Frontal webcam stream"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ textAlign: 'center', color: 'var(--chalk-dim)' }}>
                              <Eye size={24} style={{ marginBottom: '6px', opacity: 0.5 }} />
                              <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-display)' }}>Frontal stream</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Secondary desk cam */}
                      <div className="panel-raised" style={{ padding: '10px' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--chalk-mid)', fontFamily: 'var(--font-display)', marginBottom: '8px', letterSpacing: '0.04em' }}>
                          CAM 2 · DESK
                        </div>
                        <div style={{
                          height: '160px',
                          background: 'var(--bg-deep)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: `1px solid ${secondaryStream?.active ? 'var(--clear-green-dim)' : 'var(--border-subtle)'}`,
                          position: 'relative'
                        }}>
                          {secondaryStream?.imageBase64 ? (
                            <img
                              src={secondaryStream.imageBase64}
                              alt="Desk camera feed"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ textAlign: 'center', color: 'var(--chalk-dim)' }}>
                              <Camera size={24} style={{ marginBottom: '6px', opacity: 0.5 }} />
                              <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-display)' }}>Awaiting QR scan</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Watch Log (Event Timeline) */}
                  <div className="panel-slate" style={{ padding: '18px' }}>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '0.72rem',
                      color: 'var(--chalk-mid)',
                      letterSpacing: '0.06em',
                      marginBottom: '14px'
                    }}>
                      WATCH LOG · {sessionEvents.length} events
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
                      {sessionEvents.length === 0 ? (
                        <p style={{ color: 'var(--chalk-dim)', fontSize: '0.8rem' }}>No events recorded.</p>
                      ) : (
                        sessionEvents.map((evt, idx) => {
                          const sev = getEventSeverity(evt.type);
                          const entryClass = `watch-log-entry ${sev === 'critical' ? 'watch-log-entry--critical' : sev === 'warning' ? 'watch-log-entry--warning' : ''}`;
                          return (
                            <div key={evt.eventId || idx} className={entryClass}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{
                                  fontFamily: 'var(--font-display)',
                                  fontSize: '0.75rem',
                                  fontWeight: 500,
                                  color: sev === 'critical' ? 'var(--signal-red)' : sev === 'warning' ? 'var(--amber-watch)' : 'var(--chalk)'
                                }}>
                                  {evt.type}
                                </span>
                                <span style={{
                                  fontFamily: 'var(--font-data)',
                                  fontSize: '0.68rem',
                                  color: 'var(--chalk-dim)'
                                }}>
                                  {formatTime(evt.timestamp)}
                                </span>
                              </div>
                              <div style={{ fontFamily: 'var(--font-data)', fontSize: '0.68rem', color: 'var(--chalk-dim)', wordBreak: 'break-all' }}>
                                {JSON.stringify(evt.metadata)}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* ─── Right Column: Incident Logging + Flag History ─── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                  {/* Log Incident Form */}
                  <div className="panel-slate" style={{ padding: '20px' }}>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '0.72rem',
                      color: 'var(--chalk-mid)',
                      letterSpacing: '0.06em',
                      marginBottom: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <Flag size={13} />
                      LOG INCIDENT
                    </div>

                    <form onSubmit={handleAddFlag}>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{
                          display: 'block',
                          fontSize: '0.68rem',
                          color: 'var(--chalk-dim)',
                          marginBottom: '5px',
                          fontFamily: 'var(--font-display)',
                          letterSpacing: '0.04em'
                        }}>
                          SEVERITY
                        </label>
                        <select
                          value={flagSeverity}
                          onChange={(e) => setFlagSeverity(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            fontSize: '0.8rem',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="low">Low — routine observation</option>
                          <option value="medium">Medium — follow-up needed</option>
                          <option value="high">High — potential violation</option>
                        </select>
                      </div>

                      <div style={{ marginBottom: '14px' }}>
                        <label style={{
                          display: 'block',
                          fontSize: '0.68rem',
                          color: 'var(--chalk-dim)',
                          marginBottom: '5px',
                          fontFamily: 'var(--font-display)',
                          letterSpacing: '0.04em'
                        }}>
                          OBSERVATION
                        </label>
                        <textarea
                          rows={4}
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          placeholder="Describe the observed behavior..."
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            fontSize: '0.82rem',
                            resize: 'none',
                            lineHeight: 1.5
                          }}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submittingFlag || !newNote.trim()}
                        className="btn-primary"
                        style={{
                          width: '100%',
                          padding: '9px',
                          opacity: submittingFlag || !newNote.trim() ? 0.4 : 1
                        }}
                      >
                        {submittingFlag ? 'Recording...' : 'Record incident'}
                      </button>
                    </form>
                  </div>

                  {/* Incident History */}
                  <div className="panel-slate" style={{ padding: '20px', flex: 1 }}>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '0.72rem',
                      color: 'var(--chalk-mid)',
                      letterSpacing: '0.06em',
                      marginBottom: '14px'
                    }}>
                      INCIDENT LOG · {sessionFlags.length}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {sessionFlags.length === 0 ? (
                        <span style={{ fontSize: '0.78rem', color: 'var(--chalk-dim)' }}>No incidents logged.</span>
                      ) : (
                        sessionFlags.map((flag) => {
                          const isHigh = flag.severity === 'high';
                          const isMed = flag.severity === 'medium';
                          return (
                            <div key={flag.flagId} className="panel-raised" style={{
                              padding: '10px 12px',
                              borderLeft: `3px solid ${
                                isHigh ? 'var(--signal-red)' : isMed ? 'var(--amber-watch)' : 'var(--clear-green)'
                              }`
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{
                                  fontFamily: 'var(--font-display)',
                                  fontSize: '0.68rem',
                                  fontWeight: 500,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                  color: isHigh ? 'var(--signal-red)' : isMed ? 'var(--amber-watch)' : 'var(--clear-green)'
                                }}>
                                  {flag.severity}
                                </span>
                                <span style={{ fontFamily: 'var(--font-data)', fontSize: '0.68rem', color: 'var(--chalk-dim)' }}>
                                  {formatTime(flag.createdAt)}
                                </span>
                              </div>
                              <p style={{ fontSize: '0.8rem', color: 'var(--chalk)', lineHeight: 1.45 }}>{flag.note}</p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}
      </main>
      {/* Termination Confirmation Modal */}
      {terminatingSessionId && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(9, 10, 15, 0.85)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="panel-slate" style={{
            maxWidth: '480px',
            width: '100%',
            padding: '30px',
            border: '1.5px solid var(--signal-red)',
            boxShadow: '0 0 40px rgba(224, 78, 67, 0.2)'
          }}>
            <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--signal-red)', fontSize: '1.2rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={20} /> FORCE END EXAM
            </h3>
            <p style={{ color: 'var(--chalk)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '24px' }}>
              Are you sure you want to instantly terminate session <strong style={{ fontFamily: 'var(--font-data)' }}>{terminatingSessionId}</strong>? The student will be immediately locked out of their assessment.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setTerminatingSessionId(null)}
                className="btn-ghost"
                style={{ padding: '8px 16px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmTermination}
                style={{
                  padding: '8px 16px',
                  background: 'var(--signal-red)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Confirm Termination
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
