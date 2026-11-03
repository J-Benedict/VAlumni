import pkg from 'pg';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { computeInterviewRatings, locateRatingAnswers } from '../src/utils/ratingExtractor.js';

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
let resolveSqliteReady;
const sqliteReadyPromise = new Promise((resolve) => {
    resolveSqliteReady = resolve;
});

const sqliteDb = new sqlite3.Database(sqliteDbPath, (err) => {
    if (err) {
        console.error('Failed to open local SQLite fallback database:', err);
        resolveSqliteReady();
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
                department TEXT,
                graduation_year TEXT,
                gwa TEXT,
                latin_honors TEXT,
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

        // Non-destructive column migration for existing SQLite databases
        sqliteDb.run(`ALTER TABLE interview_transcripts ADD COLUMN department TEXT`, () => {});
        sqliteDb.run(`ALTER TABLE interview_transcripts ADD COLUMN gwa TEXT`, () => {});
        sqliteDb.run(`ALTER TABLE interview_transcripts ADD COLUMN latin_honors TEXT`, () => {});

        sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ensure legacy default account is purged
        sqliteDb.run(`DELETE FROM admin_users WHERE LOWER(username) = 'admin'`);

        // Seed secure admin account in SQLite if not present
        sqliteDb.run(
            `INSERT OR IGNORE INTO admin_users (username, password) VALUES ('SQAdmin23-26-27', 'CCSAlumni_Admin%092627')`,
            () => resolveSqliteReady()
        );
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
    // A. Attempt PostgreSQL first if pool is initialized
    if (pool) {
        try {
            const res = await pool.query(sqlText, params);
            isPgAvailable = true;
            return res;
        } catch (pgErr) {
            isPgAvailable = false;
        }
    }

    // B. Autonomous Embedded SQLite Runner
    await sqliteReadyPromise;
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

let pgColumnsMigrated = false;
async function ensurePgAcademicColumns() {
    if (pgColumnsMigrated || !pool) return;
    try {
        await pool.query(`
            ALTER TABLE interview_transcripts
                ADD COLUMN IF NOT EXISTS department VARCHAR(150),
                ADD COLUMN IF NOT EXISTS gwa VARCHAR(30),
                ADD COLUMN IF NOT EXISTS latin_honors VARCHAR(80);
        `);
        pgColumnsMigrated = true;
    } catch (e) {
        // Table may not exist yet or PostgreSQL offline
    }
}

const TRANSCRIPT_SELECT_SQL = `
    SELECT 
        id,
        timestamp,
        source,
        name,
        student_id AS "studentId",
        program,
        department,
        graduation_year AS "graduationYear",
        gwa,
        latin_honors AS "latinHonors",
        capstone_role AS "capstoneRole",
        rate_core AS "rateCore",
        rate_electives AS "rateElectives",
        rate_mentorship AS "rateMentorship",
        rate_internship AS "rateInternship",
        rate_hardware AS "rateHardware",
        rate_software AS "rateSoftware",
        rate_internet AS "rateInternet",
        rate_lab_env AS "rateLabEnv",
        overall_avg AS "overallAvg",
        useful_tech AS "usefulTech",
        desired_tech AS "desiredTech",
        grievance,
        employment_status AS "employmentStatus",
        confidence,
        guest_speaker AS "guestSpeaker",
        breakthrough,
        restructure_suggestion AS "restructureSuggestion",
        legacy_tip AS "legacyTip",
        sentiment_label,
        sentiment_score,
        raw_responses AS "rawResponses"
    FROM interview_transcripts
    ORDER BY timestamp DESC
`;

function formatTranscriptRow(r, dbSource) {
    const parsedRaw = typeof r.rawResponses === 'string'
        ? (() => { try { return JSON.parse(r.rawResponses); } catch(e) { return r.rawResponses; } })()
        : (r.rawResponses || {});

    const standing = (parsedRaw && typeof parsedRaw === 'object' && parsedRaw.academicStanding) || {};

    let ratings = {
        coreProgramming: Number(r.rateCore) || 0,
        electives: Number(r.rateElectives) || 0,
        mentorship: Number(r.rateMentorship) || 0,
        internship: Number(r.rateInternship) || 0,
        hardware: Number(r.rateHardware) || 0,
        software: Number(r.rateSoftware) || 0,
        internet: Number(r.rateInternet) || 0,
        labEnvironment: Number(r.rateLabEnv) || 0,
        overallAvg: Number(r.overallAvg) || 0.0
    };

    // If verbatim Q&A pairs are present, calibrate ratings with the aspect-aware extractor
    // to safeguard against legacy naive regex bugs (e.g. scale definitions "1 to 5" parsed as score 1)
    if (Array.isArray(parsedRaw?.qaPairs) && parsedRaw.qaPairs.length >= 4) {
        try {
            const { curriculumAnswer, labsAnswer, mentorshipAnswer } = locateRatingAnswers(parsedRaw.qaPairs);
            if (curriculumAnswer || labsAnswer || mentorshipAnswer) {
                const computed = computeInterviewRatings({ curriculumAnswer, labsAnswer, mentorshipAnswer });
                ratings = computed.ratings;
            }
        } catch (e) {
            // Keep DB ratings
        }
    }

    return {
        id: r.id,
        timestamp: r.timestamp,
        source: r.source,
        name: r.name,
        studentId: r.studentId,
        program: r.program,
        department: r.department || standing.department || 'College of Computer Studies (CCS)',
        graduationYear: r.graduationYear || standing.graduationYear || '2026',
        gwa: r.gwa || standing.gwa || 'Not Provided',
        latinHonors: r.latinHonors || standing.latinHonors || 'None',
        capstoneRole: r.capstoneRole,
        ratings,
        usefulTech: r.usefulTech || 'N/A',
        desiredTech: r.desiredTech || 'N/A',
        grievance: r.grievance || 'N/A',
        employmentStatus: r.employmentStatus || 'N/A',
        confidence: r.confidence || 'N/A',
        guestSpeaker: r.guestSpeaker || 'N/A',
        breakthrough: r.breakthrough || 'N/A',
        restructureSuggestion: r.restructureSuggestion || 'N/A',
        legacyTip: r.legacyTip || 'N/A',
        sentiment: {
            label: r.sentiment_label || 'Neutral',
            score: Number(r.sentiment_score) || 0.50
        },
        rawResponses: parsedRaw,
        dbSource: dbSource || 'Database'
    };
}

/**
 * Retrieve unified exit interview transcripts from BOTH Cloud PostgreSQL (Neon.tech)
 * AND Local Embedded SQLite, merging and deduplicating by ID so all records display in Admin Portal.
 */
export async function getUnifiedTranscripts() {
    await sqliteReadyPromise;
    let pgRows = [];
    if (pool) {
        try {
            await ensurePgAcademicColumns();
            const pgRes = await pool.query(TRANSCRIPT_SELECT_SQL);
            pgRows = pgRes.rows || [];
            isPgAvailable = true;
        } catch (pgErr) {
            // PostgreSQL offline or unreachable
        }
    }

    const sqliteRows = await new Promise((resolve) => {
        sqliteDb.all(TRANSCRIPT_SELECT_SQL, (err, rows) => {
            if (err) {
                console.error('SQLite query error in getUnifiedTranscripts:', err);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });

    const recordMap = new Map();

    // 1. Process SQLite entries first
    for (const r of sqliteRows) {
        recordMap.set(r.id, formatTranscriptRow(r, 'Local SQLite'));
    }

    // 2. Process & Merge Cloud PostgreSQL entries
    for (const r of pgRows) {
        if (recordMap.has(r.id)) {
            const existing = recordMap.get(r.id);
            recordMap.set(r.id, {
                ...existing,
                ...formatTranscriptRow(r, 'Cloud + SQLite')
            });
        } else {
            recordMap.set(r.id, formatTranscriptRow(r, 'Cloud (Neon)'));
        }
    }

    const unified = Array.from(recordMap.values());
    unified.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return unified;
}

/**
 * Save a new interview transcript to BOTH Cloud PostgreSQL and Local SQLite.
 */
export async function saveTranscriptUnified(record) {
    await sqliteReadyPromise;
    const rawResponsesStr = typeof record.rawResponses === 'string'
        ? record.rawResponses
        : JSON.stringify(record.rawResponses || {});

    const values = [
        record.id,
        record.timestamp || new Date().toISOString(),
        record.source || 'voice_interview',
        record.studentId || 'N/A',
        record.name || 'Anonymous',
        record.program || 'N/A',
        record.department || 'College of Computer Studies (CCS)',
        record.graduationYear || 'N/A',
        record.gwa || 'Not Provided',
        record.latinHonors || 'None',
        record.capstoneRole || 'N/A',
        record.ratings?.coreProgramming || 0,
        record.ratings?.electives || 0,
        record.ratings?.mentorship || 0,
        record.ratings?.internship || 0,
        record.ratings?.hardware || 0,
        record.ratings?.software || 0,
        record.ratings?.internet || 0,
        record.ratings?.labEnvironment || 0,
        record.ratings?.overallAvg || 0.0,
        record.usefulTech || 'N/A',
        record.desiredTech || 'N/A',
        record.grievance || 'N/A',
        record.employmentStatus || 'N/A',
        record.confidence || 'N/A',
        record.guestSpeaker || 'N/A',
        record.breakthrough || 'N/A',
        record.restructureSuggestion || 'N/A',
        record.legacyTip || 'N/A',
        record.sentiment?.label || 'Neutral',
        record.sentiment?.score || 0.50,
        rawResponsesStr
    ];

    let savedToPg = false;
    let savedToSqlite = false;

    // 1. Save to PostgreSQL if available
    if (pool) {
        try {
            await ensurePgAcademicColumns();
            await pool.query(`
                INSERT INTO interview_transcripts (
                    id, timestamp, source, student_id, name, program, department, graduation_year, gwa, latin_honors, capstone_role,
                    rate_core, rate_electives, rate_mentorship, rate_internship,
                    rate_hardware, rate_software, rate_internet, rate_lab_env, overall_avg,
                    useful_tech, desired_tech, grievance, employment_status, confidence,
                    guest_speaker, breakthrough, restructure_suggestion, legacy_tip,
                    sentiment_label, sentiment_score, raw_responses
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                    $12, $13, $14, $15,
                    $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25,
                    $26, $27, $28, $29,
                    $30, $31, $32
                )
                ON CONFLICT (id) DO UPDATE SET
                    timestamp = EXCLUDED.timestamp,
                    name = EXCLUDED.name,
                    student_id = EXCLUDED.student_id,
                    program = EXCLUDED.program,
                    department = EXCLUDED.department,
                    graduation_year = EXCLUDED.graduation_year,
                    gwa = EXCLUDED.gwa,
                    latin_honors = EXCLUDED.latin_honors,
                    capstone_role = EXCLUDED.capstone_role,
                    overall_avg = EXCLUDED.overall_avg,
                    raw_responses = EXCLUDED.raw_responses;
            `, values);
            savedToPg = true;
        } catch (pgErr) {
            console.warn('PostgreSQL save error in saveTranscriptUnified:', pgErr.message);
        }
    }

    // 2. Always save to local SQLite database as well
    try {
        await new Promise((resolve, reject) => {
            sqliteDb.run(`
                INSERT INTO interview_transcripts (
                    id, timestamp, source, student_id, name, program, department, graduation_year, gwa, latin_honors, capstone_role,
                    rate_core, rate_electives, rate_mentorship, rate_internship,
                    rate_hardware, rate_software, rate_internet, rate_lab_env, overall_avg,
                    useful_tech, desired_tech, grievance, employment_status, confidence,
                    guest_speaker, breakthrough, restructure_suggestion, legacy_tip,
                    sentiment_label, sentiment_score, raw_responses
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?
                )
                ON CONFLICT(id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    name = excluded.name,
                    student_id = excluded.student_id,
                    program = excluded.program,
                    department = excluded.department,
                    graduation_year = excluded.graduation_year,
                    gwa = excluded.gwa,
                    latin_honors = excluded.latin_honors,
                    capstone_role = excluded.capstone_role,
                    overall_avg = excluded.overall_avg,
                    raw_responses = excluded.raw_responses;
            `, values, function (err) {
                if (err) reject(err);
                else {
                    savedToSqlite = true;
                    resolve();
                }
            });
        });
    } catch (sqliteErr) {
        console.warn('SQLite save error in saveTranscriptUnified:', sqliteErr.message);
    }

    return {
        success: savedToPg || savedToSqlite,
        savedToPg,
        savedToSqlite,
        id: record.id
    };
}

/**
 * Delete a transcript from BOTH Cloud PostgreSQL and Local SQLite.
 */
export async function deleteTranscriptUnified(id) {
    if (pool) {
        try {
            await pool.query('DELETE FROM interview_transcripts WHERE id = $1', [id]);
        } catch (e) {
            console.warn('PostgreSQL delete error in deleteTranscriptUnified:', e.message);
        }
    }
    await new Promise((resolve) => {
        sqliteDb.run('DELETE FROM interview_transcripts WHERE id = ?', [id], (err) => {
            if (err) console.warn('SQLite delete error in deleteTranscriptUnified:', err.message);
            resolve();
        });
    });
    return { success: true, id };
}

/**
 * Clear all transcripts from BOTH Cloud PostgreSQL and Local SQLite.
 */
export async function clearAllTranscriptsUnified() {
    if (pool) {
        try {
            await pool.query('DELETE FROM interview_transcripts');
        } catch (e) {
            console.warn('PostgreSQL clear error in clearAllTranscriptsUnified:', e.message);
        }
    }
    await new Promise((resolve) => {
        sqliteDb.run('DELETE FROM interview_transcripts', (err) => {
            if (err) console.warn('SQLite clear error in clearAllTranscriptsUnified:', err.message);
            resolve();
        });
    });
    return { success: true };
}

export default {
    query,
    getUnifiedTranscripts,
    saveTranscriptUnified,
    deleteTranscriptUnified,
    clearAllTranscriptsUnified
};
