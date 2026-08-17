import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../../data.db');
const schemaPath = path.resolve(__dirname, '../../../infrastructure/db/schema.sql');

sqlite3.verbose();
export const db = new sqlite3.Database(dbPath);

export function initDb() {
  return new Promise((resolve, reject) => {
    try {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schemaSql, (err) => {
        if (err) {
          console.error('Failed to initialize database schema:', err);
          return reject(err);
        }
        
        // Seed default demo exam if none exists
        db.get('SELECT COUNT(*) as count FROM exams', (err, row) => {
          if (!err && row && row.count === 0) {
            db.run(
              `INSERT INTO exams (id, title, description, duration_minutes) VALUES (?, ?, ?, ?)`,
              ['exam_456', 'Advanced Algorithms & System Design Midterm', 'Final comprehensive assessment testing core heuristics and data architectures.', 45],
              (insertErr) => {
                if (insertErr) console.error('Error seeding demo exam:', insertErr);
                else console.log('✅ Demo exam initialized (exam_456)');
              }
            );
          }
        });

        console.log('✅ Database schema initialized successfully at:', dbPath);
        resolve();
      });
    } catch (error) {
      console.error('Error loading schema file:', error);
      reject(error);
    }
  });
}

export function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
