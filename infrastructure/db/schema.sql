-- Proctora Database Schema
-- Compatible with SQLite & PostgreSQL

CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'completed', 'terminated'
    risk_score REAL DEFAULT 0.0,
    signals TEXT, -- JSON array of active trigger signals
    explanation TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'focus_lost', 'tab_switch', 'answer_submit', 'idle_period'
    source TEXT DEFAULT 'student_client',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT, -- JSON payload with durationMs, visible, direction, etc.
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flags (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    note TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
