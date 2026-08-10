/**
 * VAlumni Interview Transcript Persistence Layer
 * Uses localStorage to store completed exit interview transcripts.
 * Each transcript is stored with a unique ID and timestamp.
 */

const STORAGE_KEY = 'valumni_interview_transcripts';

/**
 * Save a completed interview transcript to localStorage.
 * @param {Object} responses - Dictionary of { questionId: responseText }
 * @param {Array} allQuestions - Full survey question array for metadata
 * @returns {Object} The saved transcript record
 */
export function saveInterviewTranscript(responses, allQuestions) {
    const existing = getInterviewTranscripts();

    // Build structured record from responses
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

    // Simple sentiment from overall average
    let sentimentLabel = 'Positive';
    let sentimentScore = 0.85;
    if (overallAvg < 3.2) {
        sentimentLabel = 'Negative';
        sentimentScore = 0.35;
    } else if (overallAvg < 3.8) {
        sentimentLabel = 'Neutral';
        sentimentScore = 0.55;
    }

    const record = {
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

    existing.push(record);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
        console.error('Failed to save interview transcript to localStorage:', e);
    }

    return record;
}

/**
 * Get all saved interview transcripts from localStorage.
 * @returns {Array} Array of transcript records
 */
export function getInterviewTranscripts() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        console.error('Failed to read interview transcripts from localStorage:', e);
        return [];
    }
}

/**
 * Delete a specific transcript by ID.
 * @param {string} id - Transcript ID to delete
 */
export function deleteInterviewTranscript(id) {
    const existing = getInterviewTranscripts();
    const filtered = existing.filter(t => t.id !== id);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.error('Failed to delete transcript:', e);
    }
}

/**
 * Clear all saved transcripts.
 */
export function clearAllTranscripts() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.error('Failed to clear transcripts:', e);
    }
}
