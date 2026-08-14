import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
    console.log(`🚀 VAlumni Express PostgreSQL API running on http://localhost:${PORT}`);
});
