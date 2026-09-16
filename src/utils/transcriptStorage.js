/**
 * VAlumni Interview Transcript Persistence Layer
 * Integrates PostgreSQL API Backend (/api/transcripts) with local fallback.
 */

import { parseLSPUDataset } from './datasetLoader';

const STORAGE_KEY = 'valumni_interview_transcripts';

/**
 * Helper to build transcript record from raw survey responses.
 */
export function buildTranscriptRecord(responses, allQuestions) {
    const fullName = [
        responses['demo_lastname'] || '',
        responses['demo_firstname'] || '',
        responses['demo_middleinitial'] || ''
    ].filter(Boolean).join(' ').trim() || 'Anonymous';

    const rateCore = parseInt(responses['rate_core_prog'] || '0', 10);
    const rateElectives = parseInt(responses['rate_electives'] || '0', 10);
    const rateMentorship = parseInt(responses['rate_mentorship'] || '0', 10);
    const rateInternship = parseInt(responses['rate_internship'] || '0', 10);
    const rateHardware = parseInt(responses['rate_hardware'] || '0', 10);
    const rateSoftware = parseInt(responses['rate_software'] || '0', 10);
    const rateInternet = parseInt(responses['rate_internet'] || '0', 10);
    const rateLabEnv = parseInt(responses['rate_aircon'] || '0', 10);

    const ratingCount = [rateCore, rateElectives, rateMentorship, rateInternship, rateHardware, rateSoftware, rateInternet, rateLabEnv].filter(r => r > 0).length || 1;
    const overallAvg = parseFloat(((rateCore + rateElectives + rateMentorship + rateInternship + rateHardware + rateSoftware + rateInternet + rateLabEnv) / ratingCount).toFixed(2));

    let sentimentLabel = 'Positive';
    let sentimentScore = 0.85;
    if (overallAvg < 3.2) {
        sentimentLabel = 'Negative';
        sentimentScore = 0.35;
    } else if (overallAvg < 3.8) {
        sentimentLabel = 'Neutral';
        sentimentScore = 0.55;
    }

    return {
        id: `voice_${Date.now()}`,
        timestamp: new Date().toISOString(),
        source: 'voice_interview',
        name: fullName,
        studentId: responses['demo_studentid'] || 'N/A',
        program: responses['demo_program'] || 'N/A',
        graduationYear: responses['demo_grad_year'] || 'N/A',
        capstoneRole: responses['demo_capstone_role'] || 'N/A',
        ratings: {
            coreProgramming: rateCore,
            electives: rateElectives,
            mentorship: rateMentorship,
            internship: rateInternship,
            hardware: rateHardware,
            software: rateSoftware,
            internet: rateInternet,
            labEnvironment: rateLabEnv,
            overallAvg
        },
        usefulTech: responses['qual_useful_tech'] || 'N/A',
        desiredTech: responses['qual_missing_tech'] || 'N/A',
        grievance: responses['qual_lab_grievance'] || 'N/A',
        employmentStatus: responses['outlook_employment'] || 'N/A',
        confidence: responses['outlook_confidence'] || 'N/A',
        guestSpeaker: responses['outlook_guest_speaker'] || 'N/A',
        breakthrough: responses['qual_breakthrough'] || 'N/A',
        restructureSuggestion: responses['qual_restructure'] || 'N/A',
        legacyTip: responses['qual_legacy_tip'] || 'N/A',
        sentiment: {
            label: sentimentLabel,
            score: sentimentScore
        },
        rawResponses: responses
    };
}

/**
 * Save interview transcript to PostgreSQL database API with localStorage fallback.
 */
export async function saveInterviewTranscriptToDB(responses, allQuestions) {
    const record = buildTranscriptRecord(responses, allQuestions);

    // 1. Always save locally as fallback
    saveInterviewTranscriptLocal(record);

    // 2. Post to PostgreSQL API Server
    try {
        const res = await fetch('/api/transcripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        });

        if (!res.ok) {
            console.warn('PostgreSQL API save returned error status:', res.status);
        } else {
            console.log('Successfully persisted interview transcript to PostgreSQL DB.');
        }
    } catch (e) {
        console.warn('Failed to reach PostgreSQL API server. Saved to localStorage fallback.', e);
    }

    return record;
}

/**
 * Synchronous save compatibility function (calls async API in background).
 */
export function saveInterviewTranscript(responses, allQuestions) {
    const record = buildTranscriptRecord(responses, allQuestions);
    saveInterviewTranscriptLocal(record);

    // Send async call to backend DB
    fetch('/api/transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
    }).catch(e => console.warn('PostgreSQL sync fallback note:', e));

    return record;
}

/**
 * Fetch interview transcripts from PostgreSQL API (falling back to localStorage if server offline).
 */
export async function getInterviewTranscriptsFromDB() {
    try {
        const res = await fetch('/api/transcripts');
        if (res.ok) {
            const data = await res.json();
            // Cache to localStorage for offline access
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { }
            return data;
        }
    } catch (e) {
        console.warn('PostgreSQL API unreachable, falling back to localStorage transcripts:', e);
    }
    return getInterviewTranscriptsLocal();
}

/**
 * Synchronous get function from localStorage.
 */
export function getInterviewTranscripts() {
    return getInterviewTranscriptsLocal();
}

/**
 * Delete a specific transcript by ID from PostgreSQL DB and localStorage.
 */
export async function deleteInterviewTranscriptFromDB(id) {
    deleteInterviewTranscriptLocal(id);
    try {
        const res = await fetch(`/api/transcripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            console.error('PostgreSQL API delete returned status:', res.status);
        }
    } catch (e) {
        console.warn('PostgreSQL API delete error:', e);
    }
}

export function deleteInterviewTranscript(id) {
    deleteInterviewTranscriptLocal(id);
    fetch(`/api/transcripts/${id}`, { method: 'DELETE' }).catch(() => { });
}

/**
 * Clear all transcripts.
 */
export async function clearAllTranscriptsFromDB() {
    clearAllTranscriptsLocal();
    try {
        await fetch('/api/transcripts', { method: 'DELETE' });
    } catch (e) {
        console.warn('PostgreSQL API clear error:', e);
    }
}

export function clearAllTranscripts() {
    clearAllTranscriptsLocal();
    fetch('/api/transcripts', { method: 'DELETE' }).catch(() => { });
}

// Internal localStorage helpers
function saveInterviewTranscriptLocal(record) {
    const existing = getInterviewTranscriptsLocal();
    const filtered = existing.filter(r => r.id !== record.id);
    filtered.unshift(record);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.error('Failed to save to localStorage:', e);
    }
}

function getInterviewTranscriptsLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
        // Fallback seed with baseline LSPU exit interview records
        const initial = parseLSPUDataset();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch (e) { }
        return initial;
    } catch (e) {
        return parseLSPUDataset();
    }
}

function deleteInterviewTranscriptLocal(id) {
    const existing = getInterviewTranscriptsLocal();
    const filtered = existing.filter(t => t.id !== id);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) { }
}

function clearAllTranscriptsLocal() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) { }
}
