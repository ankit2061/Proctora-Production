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

// CORS: Restrict to allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5173', 'http://localhost:5174'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Rate Limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window`
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Strict limit for auth/sensitive routes
  message: 'Too many sensitive requests from this IP, please try again later',
});

// Apply general rate limiter to all API requests
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'proctora-backend', timestamp: new Date().toISOString() });
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
