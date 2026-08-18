import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '../../../infrastructure/db/schema.sql');

export let pool;

export async function initDb() {
  if (!process.env.DATABASE_URL) {
    // For local dev without Postgres, we throw a clear error
    console.error('❌ DATABASE_URL environment variable is missing.');
    console.error('Please create a free Supabase Postgres DB, get the connection string, and add it to backend/.env');
    throw new Error('DATABASE_URL environment variable is required.');
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    // pg cannot run multiple statements in a single query easily if they contain certain constructs, 
    // but simple CREATE TABLE statements usually work fine.
    await pool.query(schemaSql);
    
    // Seed default demo exam if none exists
    const res = await pool.query('SELECT COUNT(*) as count FROM exams');
    const count = parseInt(res.rows[0].count, 10);
    
    if (count === 0) {
      await pool.query(
        `INSERT INTO exams (id, title, description, duration_minutes) VALUES ($1, $2, $3, $4)`,
        ['exam_456', 'Advanced Algorithms & System Design Midterm', 'Final comprehensive assessment testing core heuristics and data architectures.', 45]
      );
      console.log('✅ Demo exam initialized (exam_456)');
    }
    
    console.log('✅ PostgreSQL database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing PostgreSQL database:', error);
    throw error;
  }
}

/**
 * Helper to convert SQLite '?' to Postgres '$1, $2'
 */
function convertSqliteToPg(sql) {
  let pgSql = sql;
  let paramCount = 1;
  while (pgSql.includes('?')) {
    pgSql = pgSql.replace('?', `$${paramCount}`);
    paramCount++;
  }
  return pgSql;
}

export async function runQuery(sql, params = []) {
  if (!pool) throw new Error('Database pool not initialized');
  const pgSql = convertSqliteToPg(sql);
  const res = await pool.query(pgSql, params);
  return { changes: res.rowCount };
}

export async function getQuery(sql, params = []) {
  if (!pool) throw new Error('Database pool not initialized');
  const pgSql = convertSqliteToPg(sql);
  const res = await pool.query(pgSql, params);
  return res.rows[0] || null;
}

export async function allQuery(sql, params = []) {
  if (!pool) throw new Error('Database pool not initialized');
  const pgSql = convertSqliteToPg(sql);
  const res = await pool.query(pgSql, params);
  return res.rows;
}
