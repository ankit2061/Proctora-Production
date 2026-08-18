import 'dotenv/config'; // Load .env variables
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { initDb } from '../models/db.js';
import sessionRoutes from '../routes/sessionRoutes.js';

const app = express();
const PORT = process.env.PORT || 4000;
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://127.0.0.1:5001';

// Security: Set HTTP headers
app.use(helmet());

// Logging: Standardized request logging
app.use(morgan('dev'));

// CORS: Allow local, LAN, and ngrok tunnel connections
app.use(cors({
  origin: true,
  credentials: true
}));

// Rate Limiting: High-capacity for real-time video snapshots and telemetry
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  message: { error: 'rate_limit_exceeded', message: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.includes('/primary-stream') || req.path.includes('/secondary-stream') || req.path.includes('/events')
});

app.use(generalLimiter);

// Proxy Python AI endpoints (enroll, verify, analyze_frame) to the Flask AI server
app.use('/api/ai', createProxyMiddleware({
  target: PYTHON_AI_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/ai': '', // /api/ai/enroll -> /enroll
  },
  onError: (err, req, res) => {
    console.error('[AI Proxy Error]', err.code, err.message);
    let message = 'Python AI Proctoring Service is starting up or unavailable.';
    
    if (err.code === 'ECONNREFUSED') {
      message = 'Connection refused. AI Service is down.';
    } else if (err.code === 'ETIMEDOUT') {
      message = 'Connection timed out. AI Service is not responding.';
    }

    res.status(503).json({
      error: 'ai_service_unavailable',
      message: message,
      details: err.message
    });
  }
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Apply stricter rate limit to specific sensitive routes (example)
// app.use('/api/auth', sensitiveLimiter); // Uncomment when auth routes exist

// Routes
app.use('/api', sessionRoutes);

// Health check & wake-up keepalive endpoint
app.get('/health', async (req, res) => {
  let activeSessionsCount = 0;
  try {
    const { allQuery } = await import('../models/db.js');
    const rows = await allQuery(`SELECT COUNT(*) as count FROM sessions WHERE status = 'active'`);
    if (rows && rows.length > 0) {
      activeSessionsCount = parseInt(rows[0].count || 0, 10);
    }
  } catch (e) {}

  res.json({
    status: 'ok',
    service: 'proctora-backend',
    version: '2.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
    activeSessions: activeSessionsCount,
    timestamp: new Date().toISOString()
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack || err.message);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'cors_error', message: 'Origin not allowed' });
  }

  res.status(err.status || 500).json({
    error: 'internal_server_error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Start server after DB init
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Proctora Backend Server running on http://localhost:${PORT}`);
      console.log(`🧠 AI Bridge proxying /api/ai/* -> ${PYTHON_AI_URL}/*`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
