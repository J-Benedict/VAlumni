import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import pool, {
    getUnifiedTranscripts,
    saveTranscriptUnified,
    deleteTranscriptUnified,
    clearAllTranscriptsUnified
} from './db.js';
import { seedTranscriptsIfEmpty } from './seedTranscripts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
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

// Forward audio upload + context hints to VoiceCleaner + faster-whisper microservice
app.post('/api/stt/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No audio file provided in request.' });
        }

        const formData = new FormData();
        const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/wav' });
        formData.append('file', audioBlob, req.file.originalname || 'cleaned_speech.wav');

        if (req.body?.stage !== undefined && req.body.stage !== '') {
            formData.append('stage', String(req.body.stage));
        }
        if (req.body?.field_hint) {
            formData.append('field_hint', String(req.body.field_hint));
        }

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

// POST /api/tts/generate - Native Neural TTS (Microsoft Edge voices: Angelo, Blessica, James, Rosa)
const ALLOWED_TTS_VOICES = new Set([
    'fil-PH-AngeloNeural',
    'fil-PH-BlessicaNeural',
    'en-PH-JamesNeural',
    'en-PH-RosaNeural'
]);
const TTS_CACHE_LIMIT = 200;
const ttsCache = new Map(); // key -> Buffer (simple LRU)

function cacheTts(key, buffer) {
    if (ttsCache.has(key)) ttsCache.delete(key);
    ttsCache.set(key, buffer);
    if (ttsCache.size > TTS_CACHE_LIMIT) {
        ttsCache.delete(ttsCache.keys().next().value);
    }
}

function synthesizeWithEdgeCli(text, voice) {
    return new Promise(async (resolve, reject) => {
        const id = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const tmpFile = path.join(os.tmpdir(), `tts_${id}.mp3`);
        const textFile = path.join(os.tmpdir(), `tts_${id}.txt`);
        try {
            await fs.promises.writeFile(textFile, text, 'utf8');
        } catch (e) {
            return reject(e);
        }

        // Voice is whitelisted above; text is passed via file (never via the shell).
        exec(
            `py -m edge_tts --voice "${voice}" --rate=-4% --file "${textFile}" --write-media "${tmpFile}"`,
            { timeout: 30000 },
            async (error) => {
                try {
                    if (fs.existsSync(textFile)) await fs.promises.unlink(textFile);
                    if (error || !fs.existsSync(tmpFile)) {
                        return reject(error || new Error('edge-tts produced no audio'));
                    }
                    const audioBuffer = await fs.promises.readFile(tmpFile);
                    await fs.promises.unlink(tmpFile);
                    resolve(audioBuffer);
                } catch (cleanupErr) {
                    reject(cleanupErr);
                }
            }
        );
    });
}

app.post('/api/tts/generate', async (req, res) => {
    try {
        const { text } = req.body || {};
        const voice = ALLOWED_TTS_VOICES.has(req.body?.voice) ? req.body.voice : 'fil-PH-AngeloNeural';
        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text payload is required.' });
        }

        // Text is already phonetically pre-processed by the client (acronyms -> letter-by-letter).
        const cleanText = text.replace(/[*_#`~]/g, '').trim().slice(0, 3000);
        const cacheKey = `${voice}:${cleanText}`;

        if (ttsCache.has(cacheKey)) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('X-TTS-Cache', 'HIT');
            return res.send(ttsCache.get(cacheKey));
        }

        // 1. In-process synthesis via the Python microservice (fastest, if running)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);
            const resp = await fetch(`${STT_SERVICE_URL}/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: cleanText, voice, rate: '-4%', pitch: '+0Hz' }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (resp.ok) {
                const buffer = Buffer.from(await resp.arrayBuffer());
                if (buffer.length > 500) {
                    cacheTts(cacheKey, buffer);
                    res.setHeader('Content-Type', 'audio/mpeg');
                    return res.send(buffer);
                }
            }
        } catch (e) {
            // Microservice not running; fall through to CLI
        }

        // 2. edge-tts CLI fallback
        try {
            const audioBuffer = await synthesizeWithEdgeCli(cleanText, voice);
            cacheTts(cacheKey, audioBuffer);
            res.setHeader('Content-Type', 'audio/mpeg');
            return res.send(audioBuffer);
        } catch (cliErr) {
            console.error('Neural TTS failed (edge-tts). If this is a 403, run: py -m pip install -U edge-tts\n', cliErr?.message || cliErr);
            return res.status(502).json({ error: 'Neural TTS unavailable. Update edge-tts: py -m pip install -U edge-tts' });
        }
    } catch (err) {
        console.error('Error generating neural speech:', err);
        return res.status(500).json({ error: 'TTS generation server error' });
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

// GET /api/transcripts - Retrieve all exit interview transcripts (unified Neon.tech Cloud + Local SQLite)
app.get('/api/transcripts', async (req, res) => {
    try {
        const unified = await getUnifiedTranscripts();
        res.json(unified);
    } catch (err) {
        console.error('Error fetching unified transcripts:', err);
        res.status(500).json({ error: 'Failed to retrieve transcripts from databases' });
    }
});

// POST /api/transcripts - Save a new interview transcript to both Neon.tech and Local SQLite
app.post('/api/transcripts', async (req, res) => {
    try {
        const result = await saveTranscriptUnified(req.body);
        res.status(201).json({ success: true, insertedId: result.id, details: result });
    } catch (err) {
        console.error('Error inserting interview transcript:', err);
        res.status(500).json({ error: 'Failed to save interview transcript to database' });
    }
});

// DELETE /api/transcripts/:id - Delete single transcript by ID from both databases
app.delete('/api/transcripts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await deleteTranscriptUnified(id);
        res.json({ success: true, message: `Transcript ${id} deleted` });
    } catch (err) {
        console.error('Error deleting transcript:', err);
        res.status(500).json({ error: 'Failed to delete transcript' });
    }
});

// DELETE /api/transcripts - Clear all transcripts from both databases
app.delete('/api/transcripts', async (req, res) => {
    try {
        await clearAllTranscriptsUnified();
        res.json({ success: true, message: 'All transcripts cleared from both databases' });
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
        if (username.toLowerCase() === 'sqadmin23-26-27' && password === 'CCSAlumni_Admin%092627') {
            console.log('⚠️ [DEV FALLBACK] PostgreSQL offline: Authenticated SQAdmin23-26-27 for local UI evaluation.');
            return res.json({
                success: true,
                user: { id: 1, username: 'SQAdmin23-26-27' },
                isDevFallback: true
            });
        }
        return res.status(500).json({ success: false, message: 'Authentication error. Please verify PostgreSQL connection and encoded credentials.' });
    }
});

// Auto-initialize tables in PostgreSQL/Cloud database if not already present
async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS interview_transcripts (
                id VARCHAR(100) PRIMARY KEY,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                source VARCHAR(50) DEFAULT 'voice_interview',
                student_id VARCHAR(50),
                name VARCHAR(255) NOT NULL,
                program VARCHAR(100),
                department VARCHAR(150),
                graduation_year VARCHAR(20),
                gwa VARCHAR(30),
                latin_honors VARCHAR(80),
                capstone_role VARCHAR(100),
                rate_core INTEGER DEFAULT 0,
                rate_electives INTEGER DEFAULT 0,
                rate_mentorship INTEGER DEFAULT 0,
                rate_internship INTEGER DEFAULT 0,
                rate_hardware INTEGER DEFAULT 0,
                rate_software INTEGER DEFAULT 0,
                rate_internet INTEGER DEFAULT 0,
                rate_lab_env INTEGER DEFAULT 0,
                overall_avg NUMERIC(3,2) DEFAULT 0.0,
                useful_tech TEXT,
                desired_tech TEXT,
                grievance TEXT,
                employment_status VARCHAR(100),
                confidence VARCHAR(100),
                guest_speaker VARCHAR(100),
                breakthrough TEXT,
                restructure_suggestion TEXT,
                legacy_tip TEXT,
                sentiment_label VARCHAR(20) DEFAULT 'Neutral',
                sentiment_score NUMERIC(3,2) DEFAULT 0.50,
                raw_responses JSONB,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`ALTER TABLE interview_transcripts ADD COLUMN IF NOT EXISTS department VARCHAR(150);`);
        await pool.query(`ALTER TABLE interview_transcripts ADD COLUMN IF NOT EXISTS gwa VARCHAR(30);`);
        await pool.query(`ALTER TABLE interview_transcripts ADD COLUMN IF NOT EXISTS latin_honors VARCHAR(80);`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Purge legacy default account and ensure secured admin account is seeded
        await pool.query('DELETE FROM admin_users WHERE LOWER(username) = $1;', ['admin']);
        await pool.query('INSERT INTO admin_users (username, password) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING;', ['SQAdmin23-26-27', 'CCSAlumni_Admin%092627']);
        await seedTranscriptsIfEmpty();
    } catch (err) {
        console.warn('Database initialization note:', err.message);
    }
}
initDb();

app.listen(PORT, () => {
    console.log(`🚀 VAlumni Express PostgreSQL API running on http://localhost:${PORT}`);
});

