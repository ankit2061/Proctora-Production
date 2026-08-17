import express from 'express';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getQuery, allQuery } from '../models/db.js';
import { scoreSession } from '../../../detection-engine/src/index.js';

const router = express.Router();
const latestSecondaryFrames = new Map();
const latestPrimaryFrames = new Map();
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://127.0.0.1:5001';

/**
 * POST /api/sessions/:sessionId/primary-stream
 * Ingests primary webcam camera frame from student client
 */
router.post('/sessions/:sessionId/primary-stream', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { imageBase64, studentId, timestamp = new Date().toISOString() } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64' });
    }

    const entry = {
      imageBase64,
      updatedAt: timestamp
    };

    latestPrimaryFrames.set(sessionId, entry);
    latestPrimaryFrames.set('latest_active', entry);

    if (studentId) {
      latestPrimaryFrames.set(studentId, entry);
      latestPrimaryFrames.set(`sess_${studentId}`, entry);
    }

    res.json({ received: true, updatedAt: timestamp });
  } catch (error) {
    console.error('Error handling primary stream:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * GET /api/sessions/:sessionId/primary-stream
 * Retrieves the latest primary webcam snapshot and active status
 */
router.get('/sessions/:sessionId/primary-stream', async (req, res) => {
  const { sessionId } = req.params;
  let frameData = latestPrimaryFrames.get(sessionId);

  if (!frameData) {
    try {
      const dbSession = await getQuery('SELECT student_id FROM sessions WHERE id = ?', [sessionId]);
      if (dbSession && dbSession.student_id) {
        frameData = latestPrimaryFrames.get(dbSession.student_id) || latestPrimaryFrames.get(`sess_${dbSession.student_id}`);
      }
    } catch (e) {}
  }

  if (!frameData) {
    const latest = latestPrimaryFrames.get('latest_active');
    if (latest && (Date.now() - new Date(latest.updatedAt).getTime()) < 15000) {
      frameData = latest;
    }
  }

  if (!frameData) {
    return res.json({ active: false, imageBase64: null, updatedAt: null });
  }

  const isRecent = (Date.now() - new Date(frameData.updatedAt).getTime()) < 15000;
  res.json({
    active: isRecent,
    imageBase64: frameData.imageBase64,
    updatedAt: frameData.updatedAt
  });
});


router.get('/network-info', async (req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }

  let ngrokUrl = null;
  try {
    const ngrokRes = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (ngrokRes.ok) {
      const data = await ngrokRes.json();
      const publicTunnel = data.tunnels.find(t => t.proto === 'https');
      if (publicTunnel) {
        ngrokUrl = publicTunnel.public_url;
      }
    }
  } catch (err) {
    // ngrok local API not running or unavailable
  }

  res.json({
    localIp,
    studentPort: 5173,
    backendPort: 4000,
    ngrokUrl
  });
});

/**
 * POST /api/sessions/:sessionId/secondary-stream
 * Ingests mobile phone camera frame, stores in memory, and analyzes for desk contraband
 */
router.post('/sessions/:sessionId/secondary-stream', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { imageBase64, studentId, timestamp = new Date().toISOString() } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64' });
    }

    const entry = {
      imageBase64,
      updatedAt: timestamp
    };

    latestSecondaryFrames.set(sessionId, entry);
    latestSecondaryFrames.set('latest_active', entry);

    if (studentId) {
      latestSecondaryFrames.set(studentId, entry);
      latestSecondaryFrames.set(`sess_${studentId}`, entry);
    }
    if (sessionId.startsWith('sess_stu_')) {
      const parsed = sessionId.replace('sess_', '');
      latestSecondaryFrames.set(parsed, entry);
    }

    // Forward snapshot to Python AI Engine /analyze_secondary_frame
    let analysisResult = null;
    try {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      formData.append('image', blob, 'secondary_frame.jpg');

      const aiRes = await fetch(`${PYTHON_AI_URL}/analyze_secondary_frame`, {
        method: 'POST',
        body: formData
      });

      if (aiRes.ok) {
        analysisResult = await aiRes.json();
        entry.analysis = analysisResult;

        // If contraband detected on desk, record event
        if (analysisResult.contraband_detected) {
          const eventId = `evt_${uuidv4().substring(0, 8)}`;
          const metadataStr = JSON.stringify({
            source: 'mobile_secondary_camera',
            item: analysisResult.contraband_detected,
            detected_objects: analysisResult.detected_objects
          });

          await runQuery(
            `INSERT INTO events (id, session_id, type, source, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
            [eventId, sessionId, `CONTRABAND_DESK (${analysisResult.contraband_detected})`, 'mobile_secondary_camera', timestamp, metadataStr]
          );

          // Recalculate score
          const rawEvents = await allQuery(`SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`, [sessionId]);
          const scoreResult = scoreSession(rawEvents);
          await runQuery(
            `UPDATE sessions SET risk_score = ?, signals = ?, explanation = ?, updated_at = ? WHERE id = ?`,
            [scoreResult.riskScore, JSON.stringify(scoreResult.signals), scoreResult.explanation, timestamp, sessionId]
          );
        }
      }
    } catch (aiErr) {
      // Non-blocking for camera frame ingestion
    }

    res.json({
      received: true,
      analysis: analysisResult,
      updatedAt: timestamp
    });
  } catch (error) {
    console.error('Error handling secondary stream:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * GET /api/sessions/:sessionId/secondary-stream
 * Retrieves the latest mobile camera snapshot and active status
 */
router.get('/sessions/:sessionId/secondary-stream', async (req, res) => {
  const { sessionId } = req.params;
  let frameData = latestSecondaryFrames.get(sessionId);

  if (!frameData) {
    try {
      const dbSession = await getQuery('SELECT student_id FROM sessions WHERE id = ?', [sessionId]);
      if (dbSession && dbSession.student_id) {
        frameData = latestSecondaryFrames.get(dbSession.student_id) || latestSecondaryFrames.get(`sess_${dbSession.student_id}`);
      }
    } catch (e) {}
  }

  // Fallback: check latest_active if recent (< 15 seconds)
  if (!frameData) {
    const latest = latestSecondaryFrames.get('latest_active');
    if (latest && (Date.now() - new Date(latest.updatedAt).getTime()) < 15000) {
      frameData = latest;
    }
  }

  if (!frameData) {
    return res.json({ active: false, imageBase64: null, analysis: null, updatedAt: null });
  }

  // Active if updated in the last 15 seconds
  const isRecent = (Date.now() - new Date(frameData.updatedAt).getTime()) < 15000;
  res.json({
    active: isRecent,
    imageBase64: frameData.imageBase64,
    analysis: frameData.analysis || null,
    updatedAt: frameData.updatedAt
  });
});


/**
 * POST /api/sessions
 * Create a new exam session
 */
router.post('/sessions', async (req, res) => {
  try {
    const { studentId = `stu_${Math.floor(1000 + Math.random() * 9000)}`, examId = 'exam_456', startedAt = new Date().toISOString() } = req.body;
    const sessionId = `sess_${uuidv4().substring(0, 8)}`;

    await runQuery(
      `INSERT INTO sessions (id, student_id, exam_id, status, risk_score, started_at, updated_at) 
       VALUES (?, ?, ?, 'active', 0.0, ?, ?)`,
      [sessionId, studentId, examId, startedAt, startedAt]
    );

    res.status(201).json({
      sessionId,
      studentId,
      examId,
      status: 'active',
      startedAt
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'session_creation_failed', message: error.message });
  }
});

/**
 * GET /api/sessions/:sessionId
 * Fetch session details with latest risk scores
 */
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await getQuery(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);

    if (!session) {
      return res.status(404).json({ error: 'not_found', message: 'Session not found' });
    }

    res.json({
      sessionId: session.id,
      studentId: session.student_id,
      examId: session.exam_id,
      status: session.status,
      riskScore: session.risk_score,
      signals: session.signals ? JSON.parse(session.signals) : [],
      explanation: session.explanation,
      startedAt: session.started_at,
      updatedAt: session.updated_at,
      completedAt: session.completed_at
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * POST /api/sessions/:sessionId/events
 * Ingest telemetry event from student client and dynamically recalculate risk score
 */
router.post('/sessions/:sessionId/events', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { type, timestamp = new Date().toISOString(), source = 'student_client', metadata = {} } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'validation_failed', message: 'Event type is required' });
    }

    const session = await getQuery(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
    if (!session) {
      return res.status(404).json({ error: 'not_found', message: 'Session not found' });
    }

    const eventId = `evt_${uuidv4().substring(0, 8)}`;
    const metadataStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

    // 1. Store the event
    await runQuery(
      `INSERT INTO events (id, session_id, type, source, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [eventId, sessionId, type, source, timestamp, metadataStr]
    );

    // 2. Fetch all events for this session to run through the detection engine
    const rawEvents = await allQuery(
      `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`,
      [sessionId]
    );

    // 3. Score session behavior
    const scoreResult = scoreSession(rawEvents);

    // 4. Update session risk score and signals
    await runQuery(
      `UPDATE sessions 
       SET risk_score = ?, signals = ?, explanation = ?, updated_at = ? 
       WHERE id = ?`,
      [
        scoreResult.riskScore,
        JSON.stringify(scoreResult.signals),
        scoreResult.explanation,
        new Date().toISOString(),
        sessionId
      ]
    );

    res.status(200).json({
      accepted: true,
      eventId,
      currentRiskScore: scoreResult.riskScore,
      activeSignals: scoreResult.signals
    });
  } catch (error) {
    console.error('Error ingesting event:', error);
    res.status(500).json({ error: 'ingestion_failed', message: error.message });
  }
});

/**
 * GET /api/sessions/:sessionId/events
 * Retrieve ordered event timeline for a session
 */
router.get('/sessions/:sessionId/events', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rawEvents = await allQuery(
      `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`,
      [sessionId]
    );

    const events = rawEvents.map(evt => ({
      eventId: evt.id,
      sessionId: evt.session_id,
      type: evt.type,
      source: evt.source,
      timestamp: evt.timestamp,
      metadata: evt.metadata ? JSON.parse(evt.metadata) : {}
    }));

    res.json({
      sessionId,
      events
    });
  } catch (error) {
    console.error('Error retrieving events:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * POST /api/sessions/:sessionId/finish
 * Mark session as finished
 */
router.post('/sessions/:sessionId/finish', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const now = new Date().toISOString();
    await runQuery(
      `UPDATE sessions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, sessionId]
    );
    res.json({ sessionId, status: 'completed', completedAt: now });
  } catch (error) {
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * GET /api/admin/sessions
 * List all sessions with score filters
 */
router.get('/admin/sessions', async (req, res) => {
  try {
    // Auto-cleanup stale sessions (no activity for > 1 hour)
    const staleThreshold = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await runQuery(
      `UPDATE sessions SET status = 'completed', completed_at = updated_at WHERE status = 'active' AND updated_at < ?`,
      [staleThreshold]
    );

    const { status, riskMin, riskMax, examId } = req.query;

    let sql = `SELECT * FROM sessions WHERE 1=1`;
    const params = [];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (riskMin !== undefined && riskMin !== '') {
      sql += ` AND risk_score >= ?`;
      params.push(parseFloat(riskMin));
    }
    if (riskMax !== undefined && riskMax !== '') {
      sql += ` AND risk_score <= ?`;
      params.push(parseFloat(riskMax));
    }
    if (examId) {
      sql += ` AND exam_id = ?`;
      params.push(examId);
    }

    sql += ` ORDER BY updated_at DESC`;

    const sessions = await allQuery(sql, params);

    const items = sessions.map(s => ({
      sessionId: s.id,
      studentId: s.student_id,
      examId: s.exam_id,
      status: s.status,
      riskScore: s.risk_score,
      signals: s.signals ? JSON.parse(s.signals) : [],
      explanation: s.explanation,
      startedAt: s.started_at,
      updatedAt: s.updated_at,
      completedAt: s.completed_at
    }));

    res.json({ items });
  } catch (error) {
    console.error('Error fetching admin sessions:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * POST /api/admin/sessions/:sessionId/terminate
 * Force end / terminate a suspicious student exam session
 */
router.post('/admin/sessions/:sessionId/terminate', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason = 'Terminated by Invigilator due to suspicious activity' } = req.body;
    const now = new Date().toISOString();

    // 1. Update session status to 'terminated'
    await runQuery(
      `UPDATE sessions SET status = 'terminated', explanation = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      [reason, now, now, sessionId]
    );

    // 2. Log termination event
    const eventId = `evt_${uuidv4().substring(0, 8)}`;
    await runQuery(
      `INSERT INTO events (id, session_id, type, source, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [eventId, sessionId, 'EXAM_FORCE_TERMINATED', 'invigilator_admin', now, JSON.stringify({ reason })]
    );

    // 3. Log high-severity flag
    const flagId = `flag_${uuidv4().substring(0, 8)}`;
    await runQuery(
      `INSERT INTO flags (id, session_id, note, severity, created_at) VALUES (?, ?, ?, 'high', ?)`,
      [flagId, sessionId, `[FORCE TERMINATION] ${reason}`, now]
    );

    res.json({
      sessionId,
      status: 'terminated',
      reason,
      terminatedAt: now
    });
  } catch (error) {
    console.error('Error terminating session:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * POST /api/admin/sessions/:sessionId/flags
 * Add an invigilator review note/flag
 */
router.post('/admin/sessions/:sessionId/flags', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { note, severity = 'medium' } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'validation_failed', message: 'Note is required' });
    }

    const flagId = `flag_${uuidv4().substring(0, 8)}`;
    const createdAt = new Date().toISOString();

    await runQuery(
      `INSERT INTO flags (id, session_id, note, severity, created_at) VALUES (?, ?, ?, ?, ?)`,
      [flagId, sessionId, note, severity, createdAt]
    );

    res.status(201).json({
      flagId,
      sessionId,
      note,
      severity,
      createdAt
    });
  } catch (error) {
    console.error('Error creating flag:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

/**
 * GET /api/admin/sessions/:sessionId/flags
 * Fetch all review flags for a session
 */
router.get('/admin/sessions/:sessionId/flags', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const flags = await allQuery(
      `SELECT * FROM flags WHERE session_id = ? ORDER BY created_at DESC`,
      [sessionId]
    );

    res.json({
      sessionId,
      flags: flags.map(f => ({
        flagId: f.id,
        note: f.note,
        severity: f.severity,
        createdAt: f.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'server_error', message: error.message });
  }
});

export default router;
