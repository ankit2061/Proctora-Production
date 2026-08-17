import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Activity, 
  Users, 
  Search, 
  Filter, 
  RefreshCw, 
  Eye, 
  Flag, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Layers, 
  TrendingUp, 
  MessageSquarePlus, 
  ArrowLeft,
  Calendar,
  Zap,
  Camera,
  Mic,
  Video,
  Radio
} from 'lucide-react';

const API_BASE = 'http://localhost:4000/api';

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
      const [resSession, resEvents, resFlags, resSec] = await Promise.all([
        fetch(`${API_BASE}/sessions/${id}`),
        fetch(`${API_BASE}/sessions/${id}/events`),
        fetch(`${API_BASE}/admin/sessions/${id}/flags`),
        fetch(`${API_BASE}/sessions/${id}/secondary-stream`)
      ]);

      const dataSession = await resSession.json();
      const dataEvents = await resEvents.json();
      const dataFlags = await resFlags.json();
      const dataSec = await resSec.json();

      setSessionDetail(dataSession);
      setSessionEvents(dataEvents.events || []);
      setSessionFlags(dataFlags.flags || []);
      setSecondaryStream(dataSec);
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

  const getRiskBadge = (score) => {
    if (score >= 0.6) return <span className="badge badge-high"><ShieldAlert size={12} /> High ({Math.round(score * 100)}%)</span>;
    if (score >= 0.25) return <span className="badge badge-med"><AlertCircle size={12} /> Medium ({Math.round(score * 100)}%)</span>;
    return <span className="badge badge-low"><CheckCircle size={12} /> Low ({Math.round(score * 100)}%)</span>;
  };

  const getEventBadgeColor = (type) => {
    if (type.includes('CONTRABAND') || type.includes('MISMATCH') || type.includes('MULTIPLE')) return 'var(--risk-high)';
    if (type.includes('GAZE') || type.includes('MOUTH') || type.includes('ABSENT') || type.includes('focus')) return 'var(--risk-med)';
    return 'var(--accent)';
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Top Admin Header */}
      <header style={{
        padding: '16px 32px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(9, 13, 22, 0.95)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ padding: '8px', background: '#312e81', borderRadius: '10px' }}>
            <ShieldAlert color="#818cf8" size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>PROCTORA INVIGILATOR HUB</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Multi-Modal Biometric & Vision AI Proctoring Triage</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', background: '#111827', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <Radio size={14} color="var(--success)" />
            <span>AI Stack: FaceNet · SpeechBrain · MediaPipe · YOLOv8 · DINOv2</span>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: autoRefresh ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: autoRefresh ? 'var(--risk-low)' : 'var(--text-muted)',
              border: `1px solid ${autoRefresh ? 'rgba(16, 185, 129, 0.3)' : 'var(--border)'}`
            }}
          >
            <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} />
            <span>{autoRefresh ? 'Live Feed (3s)' : 'Paused'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '28px 32px', maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
        
        {/* KPI Stats Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px', marginBottom: '28px' }}>
          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.825rem', marginBottom: '8px' }}>
              <span>Total Proctored Sessions</span>
              <Users size={18} color="var(--accent-light)" />
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{sessions.length}</div>
          </div>

          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.825rem', marginBottom: '8px' }}>
              <span>Active Candidates</span>
              <Activity size={18} color="var(--risk-low)" />
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--risk-low)' }}>
              {sessions.filter(s => s.status === 'active').length}
            </div>
          </div>

          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.825rem', marginBottom: '8px' }}>
              <span>High Risk / Biometric Violations</span>
              <ShieldAlert size={18} color="var(--risk-high)" />
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--risk-high)' }}>
              {sessions.filter(s => s.riskScore >= 0.6).length}
            </div>
          </div>

          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.825rem', marginBottom: '8px' }}>
              <span>Average Risk Index</span>
              <TrendingUp size={18} color="var(--risk-med)" />
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>
              {sessions.length > 0
                ? `${Math.round((sessions.reduce((acc, s) => acc + (s.riskScore || 0), 0) / sessions.length) * 100)}%`
                : '0%'}
            </div>
          </div>
        </div>

        {/* View Layout: Session Table OR Drilldown */}
        {!selectedSessionId ? (
          /* ================= SESSIONS LIST VIEW ================= */
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
                <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
                <input
                  type="text"
                  placeholder="Search by Session or Student ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    background: '#0d1320',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    padding: '10px 16px',
                    background: '#0d1320',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '0.875rem',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active Sessions</option>
                  <option value="completed">Completed Sessions</option>
                </select>
              </div>
            </div>

            {/* Sessions Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px' }}>SESSION ID</th>
                  <th style={{ padding: '12px 16px' }}>STUDENT ID</th>
                  <th style={{ padding: '12px 16px' }}>EXAM</th>
                  <th style={{ padding: '12px 16px' }}>STATUS</th>
                  <th style={{ padding: '12px 16px' }}>BEHAVIOR & AI RISK</th>
                  <th style={{ padding: '12px 16px' }}>ACTIVE AI / OS SIGNALS</th>
                  <th style={{ padding: '12px 16px' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No active exam sessions found. Start an exam in the Student portal to see live telemetry!
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s) => (
                    <tr 
                      key={s.sessionId}
                      style={{ 
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '14px 16px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.sessionId}</td>
                      <td style={{ padding: '14px 16px', fontWeight: 600 }}>{s.studentId}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{s.examId}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: s.status === 'active' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                          color: s.status === 'active' ? 'var(--risk-low)' : 'var(--text-muted)'
                        }}>
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {getRiskBadge(s.riskScore || 0)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {s.signals && s.signals.length > 0 ? (
                            s.signals.map((sig, i) => (
                              <span key={i} style={{
                                fontSize: '0.7rem',
                                padding: '2px 8px',
                                background: sig.includes('contraband') || sig.includes('mismatch') ? '#450a0a' : '#1e1b4b',
                                color: sig.includes('contraband') || sig.includes('mismatch') ? '#fca5a5' : '#a5b4fc',
                                borderRadius: '4px',
                                border: `1px solid ${sig.includes('contraband') || sig.includes('mismatch') ? '#991b1b' : '#3730a3'}`
                              }}>
                                {sig}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <button
                          onClick={() => handleSelectSession(s.sessionId)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            background: 'var(--accent)',
                            color: '#fff',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: 600
                          }}
                        >
                          <Eye size={14} /> Review
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* ================= SESSION DETAIL DRILLDOWN ================= */
          <div>
            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={() => setSelectedSessionId(null)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: 600
                }}
              >
                <ArrowLeft size={16} /> Back to Session Overview
              </button>
            </div>

            {sessionDetail && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
                
                {/* Left Column: Risk Summary & Event Timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Risk Score Diagnostic Card */}
                  <div className="glass-card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Multi-Modal Session Assessment</h2>
                      {getRiskBadge(sessionDetail.riskScore || 0)}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
                      <div style={{ background: '#0e1422', padding: '14px', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Student ID</span>
                        <div style={{ fontWeight: 700, marginTop: '4px' }}>{sessionDetail.studentId}</div>
                      </div>
                      <div style={{ background: '#0e1422', padding: '14px', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Session ID</span>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: '4px' }}>{sessionDetail.sessionId}</div>
                      </div>
                      <div style={{ background: '#0e1422', padding: '14px', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Ingested Events</span>
                        <div style={{ fontWeight: 700, marginTop: '4px' }}>{sessionEvents.length} events</div>
                      </div>
                    </div>

                    <div style={{ background: '#181e2e', padding: '16px', borderRadius: '8px', borderLeft: '4px solid var(--accent)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontWeight: 700, color: 'var(--accent-light)' }}>
                        <Zap size={16} />
                        <span>Behavioral & Vision AI Analysis</span>
                      </div>
                      <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                        {sessionDetail.explanation || 'Normal behavioral and biometric baseline maintained.'}
                      </p>
                    </div>
                  </div>

                  {/* Dual-Camera Live Workspace Monitor */}
                  <div className="glass-card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Video size={18} color="var(--accent)" />
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Dual-Camera Live Workspace Streams</h3>
                      </div>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '4px',
                        background: secondaryStream?.active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                        color: secondaryStream?.active ? 'var(--risk-low)' : 'var(--text-muted)'
                      }}>
                        {secondaryStream?.active ? '● Mobile Desk Feed Active' : '○ Mobile Cam Offline'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      {/* Stream 1: Primary Webcam (Frontal / Face) */}
                      <div style={{ background: '#0a0e1a', borderRadius: '10px', padding: '12px', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span style={{ fontWeight: 700, color: '#fff' }}>Camera 1: Primary Face View</span>
                          <span style={{ color: 'var(--risk-low)', fontWeight: 600 }}>Active (MediaPipe)</span>
                        </div>
                        <div style={{
                          height: '180px',
                          background: '#040711',
                          borderRadius: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          padding: '12px',
                          border: '1px dashed var(--border)'
                        }}>
                          <Eye size={28} color="var(--accent)" style={{ marginBottom: '8px' }} />
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>Candidate Frontal Stream</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Continuous 3D Head Pose & Identity Biometric Tracking
                          </span>
                        </div>
                      </div>

                      {/* Stream 2: Secondary Mobile Camera (Desk / Hands / Keyboard View) */}
                      <div style={{ background: '#0a0e1a', borderRadius: '10px', padding: '12px', border: `1px solid ${secondaryStream?.active ? 'rgba(16, 185, 129, 0.3)' : 'var(--border)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span style={{ fontWeight: 700, color: '#fff' }}>Camera 2: Mobile Desk View (45°)</span>
                          <span style={{ color: secondaryStream?.active ? 'var(--risk-low)' : 'var(--text-muted)', fontWeight: 600 }}>
                            {secondaryStream?.active ? 'Live Snapshot' : 'Not Connected'}
                          </span>
                        </div>
                        <div style={{
                          height: '180px',
                          background: '#040711',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative'
                        }}>
                          {secondaryStream?.imageBase64 ? (
                            <img
                              src={secondaryStream.imageBase64}
                              alt="Desk Camera Stream"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)' }}>
                              <Camera size={28} style={{ marginBottom: '8px', opacity: 0.5 }} />
                              <div style={{ fontSize: '0.8rem' }}>Waiting for student to scan QR code on mobile device...</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Multi-Modal Event Timeline */}
                  <div className="glass-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '20px' }}>
                      Biometric & Interaction Timeline ({sessionEvents.length})
                    </h3>

                    <div style={{ position: 'relative', paddingLeft: '24px', borderLeft: '2px solid var(--border)' }}>
                      {sessionEvents.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No events recorded for this session yet.</p>
                      ) : (
                        sessionEvents.map((evt, idx) => {
                          const dotColor = getEventBadgeColor(evt.type);
                          return (
                            <div key={evt.eventId || idx} style={{ position: 'relative', marginBottom: '20px' }}>
                              <div
                                className="timeline-dot"
                                style={{
                                  background: dotColor,
                                  boxShadow: dotColor !== 'var(--accent)' ? `0 0 8px ${dotColor}` : 'none'
                                }}
                              />
                              <div style={{
                                background: '#0d1320',
                                padding: '14px 18px',
                                borderRadius: '10px',
                                border: '1px solid var(--border)'
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <span style={{
                                    fontWeight: 700,
                                    fontSize: '0.875rem',
                                    color: dotColor !== 'var(--accent)' ? dotColor : '#e0e7ff'
                                  }}>
                                    {evt.type.toUpperCase()}
                                  </span>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    {new Date(evt.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  {JSON.stringify(evt.metadata)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                </div>

                {/* Right Column: Invigilator Review & Flags */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Add Review Flag / Note */}
                  <div className="glass-card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                      <Flag size={18} color="var(--risk-med)" />
                      <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Add Invigilator Note</h3>
                    </div>

                    <form onSubmit={handleAddFlag}>
                      <div style={{ marginBottom: '14px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          SEVERITY LEVEL
                        </label>
                        <select
                          value={flagSeverity}
                          onChange={(e) => setFlagSeverity(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px',
                            background: '#0d1320',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.875rem'
                          }}
                        >
                          <option value="low">Low - Routine Observation</option>
                          <option value="medium">Medium - Follow-up Recommended</option>
                          <option value="high">High - Potential Academic Violation</option>
                        </select>
                      </div>

                      <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          OBSERVATION NOTE
                        </label>
                        <textarea
                          rows={4}
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          placeholder="Document specific behavioral context, YOLO detections, or gaze anomalies..."
                          style={{
                            width: '100%',
                            padding: '10px',
                            background: '#0d1320',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.875rem',
                            resize: 'none'
                          }}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submittingFlag || !newNote.trim()}
                        style={{
                          width: '100%',
                          padding: '10px',
                          background: 'var(--accent)',
                          color: '#fff',
                          fontWeight: 700,
                          borderRadius: '8px',
                          fontSize: '0.875rem',
                          opacity: submittingFlag || !newNote.trim() ? 0.5 : 1
                        }}
                      >
                        {submittingFlag ? 'Recording...' : 'Attach Review Note'}
                      </button>
                    </form>
                  </div>

                  {/* Existing Flags History */}
                  <div className="glass-card" style={{ padding: '24px', flex: 1 }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '16px' }}>
                      Review Log ({sessionFlags.length})
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {sessionFlags.length === 0 ? (
                        <span style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>No flags recorded yet.</span>
                      ) : (
                        sessionFlags.map((flag) => (
                          <div key={flag.flagId} style={{
                            padding: '12px',
                            background: '#0d1320',
                            borderRadius: '8px',
                            borderLeft: `3px solid ${
                              flag.severity === 'high' ? 'var(--risk-high)' : flag.severity === 'medium' ? 'var(--risk-med)' : 'var(--risk-low)'
                            }`
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.75rem' }}>
                              <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{flag.severity}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{new Date(flag.createdAt).toLocaleTimeString()}</span>
                            </div>
                            <p style={{ fontSize: '0.85rem' }}>{flag.note}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
