import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '../../../infrastructure/db/schema.sql');
const dbPath = path.resolve(__dirname, '../../data.db');

export let pool = null;
export let sqliteDb = null;
let isPostgres = false;

export async function initDb() {
  if (process.env.DATABASE_URL) {
    // ─── PostgreSQL Mode (Supabase / Render / Neon) ───────────────────
    isPostgres = true;
    const { default: pg } = await import('pg');
    const { Pool } = pg;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    try {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schemaSql);

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
  } else {
    // ─── SQLite Local In-House Mode (Zero-Config) ─────────────────────
    isPostgres = false;
    const { default: sqlite3 } = await import('sqlite3');
    sqlite3.verbose();

    return new Promise((resolve, reject) => {
      sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Failed to connect to SQLite data.db:', err);
          return reject(err);
        }

        try {
          const schemaSql = fs.readFileSync(schemaPath, 'utf8');
          sqliteDb.exec(schemaSql, (execErr) => {
            if (execErr) {
              console.error('Failed to initialize SQLite schema:', execErr);
              return reject(execErr);
            }

            sqliteDb.get('SELECT COUNT(*) as count FROM exams', (getErr, row) => {
              if (!getErr && row && row.count === 0) {
                sqliteDb.run(
                  `INSERT INTO exams (id, title, description, duration_minutes) VALUES (?, ?, ?, ?)`,
                  ['exam_456', 'Advanced Algorithms & System Design Midterm', 'Final comprehensive assessment testing core heuristics and data architectures.', 45],
                  (insertErr) => {
                    if (insertErr) console.error('Error seeding demo exam:', insertErr);
                    else console.log('✅ Demo exam initialized (exam_456)');
                  }
                );
              }
            });

            console.log('✅ In-House SQLite database initialized successfully at:', dbPath);
            resolve();
          });
        } catch (schemaErr) {
          console.error('Error reading schema file:', schemaErr);
          reject(schemaErr);
        }
      });
    });
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
  if (isPostgres) {
    if (!pool) throw new Error('Postgres pool not initialized');
    const pgSql = convertSqliteToPg(sql);
    const res = await pool.query(pgSql, params);
    return { changes: res.rowCount };
  } else {
    return new Promise((resolve, reject) => {
      if (!sqliteDb) return reject(new Error('SQLite database not initialized'));
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
}

export async function getQuery(sql, params = []) {
  if (isPostgres) {
    if (!pool) throw new Error('Postgres pool not initialized');
    const pgSql = convertSqliteToPg(sql);
    const res = await pool.query(pgSql, params);
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      if (!sqliteDb) return reject(new Error('SQLite database not initialized'));
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }
}

export async function allQuery(sql, params = []) {
  if (isPostgres) {
    if (!pool) throw new Error('Postgres pool not initialized');
    const pgSql = convertSqliteToPg(sql);
    const res = await pool.query(pgSql, params);
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      if (!sqliteDb) return reject(new Error('SQLite database not initialized'));
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}
