import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { initDb } from '../models/db.js';
import sessionRoutes from '../routes/sessionRoutes.js';

const app = express();
const PORT = process.env.PORT || 4000;
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://127.0.0.1:5001';

app.use(cors({ origin: '*' }));

// Proxy Python AI endpoints (enroll, verify, analyze_frame) to the Flask AI server
app.use('/api/ai', createProxyMiddleware({
  target: PYTHON_AI_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/ai': '', // /api/ai/enroll -> /enroll
  },
  onError: (err, req, res) => {
    res.status(503).json({
      error: 'ai_service_unavailable',
      message: 'Python AI Proctoring Service is starting up or unavailable on port 5000.',
      details: err.message
    });
  }
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Routes
app.use('/api', sessionRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'proctora-backend', timestamp: new Date().toISOString() });
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
