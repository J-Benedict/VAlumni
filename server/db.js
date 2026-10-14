import pkg from 'pg';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load server/.env (and fallback to root .env)
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const { Pool } = pkg;

// Ensure server/data directory exists for local embedded SQLite database
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const sqliteDbPath = path.join(dataDir, 'valumni.db');

// 1. Initialize SQLite Database (Standalone, Zero-app, 100% offline persistence)
const sqliteDb = new sqlite3.Database(sqliteDbPath, (err) => {
    if (err) {
        console.error('Failed to open local SQLite fallback database:', err);
    } else {
        console.log(`📁 Embedded SQLite database ready at: ${sqliteDbPath}`);
        initSqliteSchema();
    }
});

function initSqliteSchema() {
    sqliteDb.serialize(() => {
        sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS interview_transcripts (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                source TEXT DEFAULT 'voice_interview',
                student_id TEXT,
                name TEXT NOT NULL,
                program TEXT,
                graduation_year TEXT,
                capstone_role TEXT,
                rate_core INTEGER DEFAULT 0,
                rate_electives INTEGER DEFAULT 0,
                rate_mentorship INTEGER DEFAULT 0,
                rate_internship INTEGER DEFAULT 0,
                rate_hardware INTEGER DEFAULT 0,
                rate_software INTEGER DEFAULT 0,
                rate_internet INTEGER DEFAULT 0,
                rate_lab_env INTEGER DEFAULT 0,
                overall_avg REAL DEFAULT 0.0,
                useful_tech TEXT,
                desired_tech TEXT,
                grievance TEXT,
                employment_status TEXT,
                confidence TEXT,
                guest_speaker TEXT,
                breakthrough TEXT,
                restructure_suggestion TEXT,
                legacy_tip TEXT,
                sentiment_label TEXT DEFAULT 'Neutral',
                sentiment_score REAL DEFAULT 0.50,
                raw_responses TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);

        sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed default admin account in SQLite if not present
        sqliteDb.run(`
            INSERT OR IGNORE INTO admin_users (id, username, password)
            VALUES (1, 'admin', 'admin123')
        `);
    });
}

// 2. Initialize PostgreSQL Pool (Local or Cloud Supabase/Neon)
let isPgAvailable = false;
let pool = null;

try {
    const poolConfig = process.env.DATABASE_URL
        ? {
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        }
        : {
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_NAME || 'valumni_db',
            password: process.env.DB_PASSWORD || 'postgres',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            connectionTimeoutMillis: 2500, // Quick timeout if postgres app is closed
        };

    pool = new Pool(poolConfig);

    pool.on('connect', () => {
        isPgAvailable = true;
        console.log('✅ Connected to PostgreSQL database successfully.');
    });

    pool.on('error', (err) => {
        isPgAvailable = false;
        console.warn('⚠️ PostgreSQL connection inactive (using SQLite embedded database):', err.message);
    });

    // Initial connection test
    pool.query('SELECT NOW()')
        .then(() => {
            isPgAvailable = true;
            console.log('✅ PostgreSQL service is ACTIVE and verified.');
        })
        .catch((err) => {
            isPgAvailable = false;
            console.log('ℹ️ PostgreSQL app/daemon is currently closed or offline.');
            console.log('🛡️ Auto-switched to Embedded SQLite database (server/data/valumni.db). All interview sessions will persist safely!');
        });
} catch (e) {
    isPgAvailable = false;
    console.warn('PostgreSQL initialization skipped:', e.message);
}

/**
 * Universal Database Query Runner
 * Seamlessly executes queries against PostgreSQL when available,
 * and automatically executes against embedded SQLite when PostgreSQL is closed!
 */
export async function query(sqlText, params = []) {
    // A. Attempt PostgreSQL first if currently available
    if (isPgAvailable && pool) {
        try {
            return await pool.query(sqlText, params);
        } catch (pgErr) {
            console.warn('PostgreSQL query error, falling back to embedded SQLite:', pgErr.message);
            isPgAvailable = false;
        }
    }

    // B. Autonomous Embedded SQLite Runner
    return new Promise((resolve, reject) => {
        // Convert PostgreSQL syntax to SQLite syntax:
        // 1. Replace $1, $2, $3 with ?
        let sqliteSql = sqlText.replace(/\$\d+/g, '?');

        // 2. Map SELECT NOW()
        sqliteSql = sqliteSql.replace(/SELECT\s+NOW\(\)/gi, "SELECT datetime('now') AS now");

        // 3. Map PostgreSQL data types for dynamic DDL
        sqliteSql = sqliteSql.replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT");
        sqliteSql = sqliteSql.replace(/\bTIMESTAMPTZ\b/gi, "TEXT");
        sqliteSql = sqliteSql.replace(/\bVARCHAR\(\d+\)/gi, "TEXT");
        sqliteSql = sqliteSql.replace(/\bJSONB\b/gi, "TEXT");
        sqliteSql = sqliteSql.replace(/\bNUMERIC\([^)]+\)/gi, "REAL");

        // 4. Handle RETURNING * in INSERT statements
        const isInsertWithReturning = /INSERT\s+INTO/i.test(sqliteSql) && /RETURNING\s+\*/i.test(sqliteSql);
        if (isInsertWithReturning) {
            sqliteSql = sqliteSql.replace(/RETURNING\s+\*;/gi, ';').replace(/RETURNING\s+\*/gi, '');
        }

        const trimmed = sqliteSql.trim();
        const isSelect = /^SELECT/i.test(trimmed);

        if (isSelect) {
            sqliteDb.all(sqliteSql, params, (err, rows) => {
                if (err) return reject(err);
                resolve({ rows: rows || [], rowCount: (rows || []).length });
            });
        } else {
            sqliteDb.run(sqliteSql, params, function (err) {
                if (err) return reject(err);
                
                if (isInsertWithReturning && params.length > 0) {
                    // For transcript inserts, the ID is typically param $1 (params[0])
                    const insertedId = params[0] || this.lastID;
                    sqliteDb.get('SELECT * FROM interview_transcripts WHERE id = ?', [insertedId], (getErr, row) => {
                        if (getErr || !row) {
                            resolve({ rows: [{ id: insertedId }], rowCount: 1 });
                        } else {
                            resolve({ rows: [row], rowCount: 1 });
                        }
                    });
                } else {
                    resolve({ rows: [], rowCount: this.changes });
                }
            });
        }
    });
}

export default { query };
