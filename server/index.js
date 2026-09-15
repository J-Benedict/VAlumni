import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import pool from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://127.0.0.1:8000';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

// Check Whisper STT Microservice Status
app.get('/api/stt/status', async (req, res) => {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        const resp = await fetch(`${STT_SERVICE_URL}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (resp.ok) {
            const data = await resp.json();
            return res.json({ online: true, ...data });
        }
    } catch (e) { }
    return res.json({ online: false, message: 'Whisper STT service offline. Using Web Speech API fallback.' });
});

// Forward audio upload to faster-whisper microservice
app.post('/api/stt/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No audio file provided in request.' });
        }

        const formData = new FormData();
        const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
        formData.append('file', audioBlob, req.file.originalname || 'recording.webm');

        const resp = await fetch(`${STT_SERVICE_URL}/transcribe`, {
            method: 'POST',
            body: formData
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error('Whisper service error response:', errText);
            return res.status(502).json({ success: false, message: 'Whisper service transcription error', detail: errText });
        }

        const data = await resp.json();
        return res.json(data);
    } catch (err) {
        console.error('Error forwarding to Whisper STT service:', err);
        return res.status(500).json({ success: false, message: 'Failed to contact Whisper speech-to-text service.', error: err.message });
    }
});

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
    try {
        const dbRes = await pool.query('SELECT NOW()');
        res.json({ status: 'ok', dbTime: dbRes.rows[0].now });
    } catch (err) {
        console.error('Database connection test failed:', err);
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

// GET /api/transcripts - Retrieve all exit interview transcripts
app.get('/api/transcripts', async (req, res) => {
    try {
        const query = `
            SELECT 
                id,
                timestamp,
                source,
                name,
                student_id AS "studentId",
                program,
                graduation_year AS "graduationYear",
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
            ORDER BY timestamp DESC;
        `;
        const { rows } = await pool.query(query);

        // Format to match frontend structure expected by VAlumni components
        const formatted = rows.map(r => ({
            id: r.id,
            timestamp: r.timestamp,
            source: r.source,
            name: r.name,
            studentId: r.studentId,
            program: r.program,
            graduationYear: r.graduationYear,
            capstoneRole: r.capstoneRole,
            ratings: {
                coreProgramming: Number(r.rateCore),
                electives: Number(r.rateElectives),
                mentorship: Number(r.rateMentorship),
                internship: Number(r.rateInternship),
                hardware: Number(r.rateHardware),
                software: Number(r.rateSoftware),
                internet: Number(r.rateInternet),
                labEnvironment: Number(r.rateLabEnv),
                overallAvg: Number(r.overallAvg)
            },
            usefulTech: r.usefulTech,
            desiredTech: r.desiredTech,
            grievance: r.grievance,
            employmentStatus: r.employmentStatus,
            confidence: r.confidence,
            guestSpeaker: r.guestSpeaker,
            breakthrough: r.breakthrough,
            restructureSuggestion: r.restructureSuggestion,
            legacyTip: r.legacyTip,
            sentiment: {
                label: r.sentiment_label,
                score: Number(r.sentiment_score)
            },
            rawResponses: r.rawResponses
        }));

        res.json(formatted);
    } catch (err) {
        console.error('Error fetching transcripts:', err);
        res.status(500).json({ error: 'Failed to retrieve transcripts from database' });
    }
});

// POST /api/transcripts - Save a new interview transcript
app.post('/api/transcripts', async (req, res) => {
    try {
        const record = req.body;

        const query = `
            INSERT INTO interview_transcripts (
                id, timestamp, source, student_id, name, program, graduation_year, capstone_role,
                rate_core, rate_electives, rate_mentorship, rate_internship,
                rate_hardware, rate_software, rate_internet, rate_lab_env, overall_avg,
                useful_tech, desired_tech, grievance, employment_status, confidence,
                guest_speaker, breakthrough, restructure_suggestion, legacy_tip,
                sentiment_label, sentiment_score, raw_responses
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21, $22,
                $23, $24, $25, $26,
                $27, $28, $29
            )
            RETURNING *;
        `;

        const values = [
            record.id,
            record.timestamp || new Date().toISOString(),
            record.source || 'voice_interview',
            record.studentId || 'N/A',
            record.name || 'Anonymous',
            record.program || 'N/A',
            record.graduationYear || 'N/A',
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
            JSON.stringify(record.rawResponses || {})
        ];

        const { rows } = await pool.query(query, values);
        res.status(201).json({ success: true, insertedId: rows[0].id });
    } catch (err) {
        console.error('Error inserting interview transcript:', err);
        res.status(500).json({ error: 'Failed to save interview transcript to database' });
    }
});

// DELETE /api/transcripts/:id - Delete single transcript by ID
app.delete('/api/transcripts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM interview_transcripts WHERE id = $1', [id]);
        res.json({ success: true, message: `Transcript ${id} deleted` });
    } catch (err) {
        console.error('Error deleting transcript:', err);
        res.status(500).json({ error: 'Failed to delete transcript' });
    }
});

// DELETE /api/transcripts - Clear all transcripts
app.delete('/api/transcripts', async (req, res) => {
    try {
        await pool.query('DELETE FROM interview_transcripts');
        res.json({ success: true, message: 'All transcripts cleared' });
    } catch (err) {
        console.error('Error clearing transcripts:', err);
        res.status(500).json({ error: 'Failed to clear transcripts' });
    }
});

// POST /api/admin/login - Admin Account Authentication
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Admin username and password are required' });
    }

    try {
        const query = 'SELECT id, username, password FROM admin_users WHERE LOWER(username) = LOWER($1) LIMIT 1';
        const { rows } = await pool.query(query, [username.trim()]);

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials. Account not found.' });
        }

        const user = rows[0];
        // Verify plain-text match (standard for manually encoded postgres queries)
        const isMatch = (user.password === password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials. Incorrect password.' });
        }

        return res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username
            }
        });
    } catch (err) {
        console.error('Error during admin login:', err);
        // Dev fallback if PostgreSQL service is offline:
        if (username.toLowerCase() === 'admin' && password === 'admin123') {
            console.log('⚠️ [DEV FALLBACK] PostgreSQL offline: Authenticated default admin/admin123 for local UI evaluation.');
            return res.json({
                success: true,
                user: { id: 1, username: 'admin' },
                isDevFallback: true
            });
        }
        return res.status(500).json({ success: false, message: 'Authentication error. Please verify PostgreSQL connection and encoded credentials.' });
    }
});

// Auto-initialize admin_users table in PostgreSQL if not already present
async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (err) {
        console.warn('Admin DB initialization note:', err.message);
    }
}
initDb();

app.listen(PORT, () => {
    console.log(`🚀 VAlumni Express PostgreSQL API running on http://localhost:${PORT}`);
});

