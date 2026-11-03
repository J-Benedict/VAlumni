/**
 * Aspect-Aware Rating Extractor for the CCS Conversational Exit Interview.
 *
 * Converts a single spoken (Taglish / Filipino / English) answer into 1–5 ratings for each
 * institutional aspect asked in that interview stage (e.g. Mentorship + OJT, or Hardware +
 * Software + Wi-Fi + Lab Environment).
 *
 * Pipeline:
 *   1. Strip rating-SCALE definitions ("in a scale of 1 to 5", "from 1-5", "out of 5") so the
 *      scale bounds are never mistaken for the interviewee's actual score.
 *   2. Detect explicit rating values (digits, decimals, "4 or 5" ranges, "8 out of 10",
 *      and English / Tagalog number words ONLY when spoken in a rating context), while ignoring
 *      durations, counts, years, IDs, and idioms like "isa sa..." / "one of...".
 *   3. Segment the answer into topic clauses and attribute each explicit rating to the aspect
 *      being discussed (e.g. "professors ... siguro 5" -> Mentorship).
 *   4. For aspects without an explicit number, infer a score from the sentiment of the clauses
 *      that discuss that aspect (with negation + intensity handling); if the aspect was never
 *      discussed, use the interviewee's overall stated rating for that question, else the
 *      overall sentiment of the answer.
 *
 * Pure module (no imports) so it runs in the browser AND in Node backfill scripts.
 */

/* --------------------------------------------------------------------------------------------
 * Aspect definitions per interview question
 * ------------------------------------------------------------------------------------------ */
export const RATING_ASPECTS = {
    coreProgramming: /\b(core|programming|program(?:s)?|major\s+subjects?|major|fundamentals?|coding\s+subjects?|curriculum|subjects?)\b/i,
    electives: /\b(electives?|selectives?|specializations?|tracks?)\b/i,
    hardware: /\b(hardware|pcs?|computers?|workstations?|specs?|ram|ssd|hdd|cpu|gpu|processor|equipment|units?|render(?:ing)?|magrender|monitors?|keyboards?|mouse)\b/i,
    software: /\b(software|softwares|ide|ides|vs\s*code|visual\s+studio|android\s+studio|apps?|applications?|programs?\s+installed|license[sd]?|xampp|installed|install|updated\s+versions?)\b/i,
    internet: /\b(wi[\s-]*fi|wifi|internet|connection|connectivity|signal|network|net|bandwidth|latency|lag)\b/i,
    labEnvironment: /\b(lab(?:oratory|oratories|s)?\s+environment|environment|aircon|air\s*con|ac|room|rooms|upuan|chairs?|ventilation|lighting|ilaw|malinis|cleanliness|init|mainit|space|facility|facilities)\b/i,
    mentorship: /\b(mentor(?:s|ship)?|advis[eo]rs?|adviser|professors?|profs?|faculty|instructors?|teachers?|guro|guidance|panel(?:ists)?|capstone|thesis|sir|ma'?am)\b/i,
    internship: /\b(internship|intern|ojt|on[\s-]+the[\s-]+job|practicum|company|host\s+company|training|immersion)\b/i
};

/* --------------------------------------------------------------------------------------------
 * Lightweight Taglish sentiment lexicon (aspect-clause level)
 * ------------------------------------------------------------------------------------------ */
const POSITIVE_WORDS = [
    'maganda', 'magandang', 'ganda', 'magaling', 'galing', 'mahusay', 'husay', 'maayos', 'ayos', 'okay', 'ok', 'oks',
    'good', 'great', 'excellent', 'outstanding', 'perfect', 'awesome', 'amazing', 'helpful', 'nakatulong', 'tumulong',
    'matulungin', 'supportive', 'approachable', 'sapat', 'mabilis', 'malinis', 'solid', 'satisfied', 'satisfying',
    'clear', 'malinaw', 'sulit', 'best', 'useful', 'organized', 'responsive', 'updated', 'maaasahan', 'reliable',
    'smooth', 'fast', 'stable', 'comfortable', 'enjoy', 'enjoyed', 'nice', 'fine', 'decent',
    'thorough', 'knowledgeable', 'competent', 'patient', 'mabait', 'naipaliwanag', 'na-explain', 'naexplain', 'explained',
    'naituro', 'natuto', 'learned', 'valuable', 'relevant', 'effective', 'malamig', 'maluwag', 'kumpleto', 'complete'
];
const NEGATIVE_WORDS = [
    'pangit', 'sira', 'sirang', 'mabagal', 'bagal', 'luma', 'lumang', 'outdated', 'kulang', 'kakulangan', 'hirap',
    'mahirap', 'nahirapan', 'problema', 'problem', 'problems', 'issue', 'issues', 'slow', 'bad', 'poor', 'laggy',
    'nagloloko', 'loko', 'mainit', 'maingay', 'crash', 'nagcra-crash', 'nag-crash', 'hang', 'naghahang', 'limitado',
    'limited', 'disappointing', 'disappointed', 'unhelpful', 'palpak', 'bulok', 'mahina', 'hina', 'underwhelming',
    'kawawa', 'terrible', 'worst', 'unstable', 'nawawala', 'putol', 'pumuputol', 'delay', 'delayed', 'lacking',
    'insufficient', 'inadequate', 'broken', 'magulo', 'confusing', 'absent', 'unavailable', 'masikip', 'madumi'
];
const NEGATORS = new Set(['hindi', 'di', "di'", 'not', 'no', 'never', 'wala', 'walang', "isn't", "wasn't", "aren't", "don't", "didn't"]);
const INTENSIFIERS = new Set(['sobrang', 'sobra', 'napaka', 'napakaganda', 'very', 'super', 'really', 'talagang', 'talaga', 'extremely', 'grabe', 'lubos', 'totally', 'highly']);
const DAMPENERS = new Set(['medyo', 'somewhat', 'slightly', 'bahagya', 'konti', 'kaunti', 'kinda', 'parang']);

const POS_SET = new Set(POSITIVE_WORDS);
const NEG_SET = new Set(NEGATIVE_WORDS);

function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[“”"()[\]{}]/g, ' ')
        .split(/\s+/)
        .map(t => t.replace(/^[^a-z0-9ñ'-]+|[^a-z0-9ñ'-]+$/g, ''))
        .filter(Boolean);
}

/**
 * Scores a clause on the 1–5 scale from Taglish sentiment cues. Returns null when no cue found.
 */
export function inferRatingFromSentiment(text = '') {
    const tokens = tokenize(text);
    if (tokens.length === 0) return null;

    let pos = 0;
    let neg = 0;
    let intense = false;
    let damp = false;

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (INTENSIFIERS.has(tok) || /^napaka/.test(tok)) intense = true;
        if (DAMPENERS.has(tok)) damp = true;

        const isPos = POS_SET.has(tok) || /^napaka(ganda|galing|husay|ayos)/.test(tok);
        const isNeg = NEG_SET.has(tok);
        if (!isPos && !isNeg) continue;

        // Negation within the previous 3 tokens flips polarity ("hindi maayos", "walang problema")
        const window = tokens.slice(Math.max(0, i - 3), i);
        const negated = window.some(w => NEGATORS.has(w));

        if (isPos) negated ? (neg += 1) : (pos += 1);
        if (isNeg) negated ? (pos += 0.75) : (neg += 1);
    }

    // "hindi masyadong ..." / "not really ..." = mild shortfall even without a lexicon hit
    if (/\b(hindi|di)\s+(?:\w+\s+)?masyado(?:ng)?\b|\bnot\s+(?:really|very|that)\b/i.test(text)) {
        neg += 1;
    }

    if (pos === 0 && neg === 0) return null;

    const net = pos - neg;
    let score;
    if (net >= 2 && intense) score = 5;
    else if (net >= 3) score = 5;
    else if (net > 0) score = 4;
    else if (net === 0) score = 3;
    else if (net <= -2 && intense) score = 1;
    else if (net <= -3) score = 1;
    else score = 2;

    if (damp) {
        if (score === 5) score = 4;
        if (score === 1) score = 2;
    }
    return score;
}

/* --------------------------------------------------------------------------------------------
 * Explicit rating detection
 * ------------------------------------------------------------------------------------------ */
const NUMBER_WORDS = {
    one: 1, isa: 1, uno: 1,
    two: 2, dalawa: 2, dos: 2,
    three: 3, tatlo: 3, tres: 3,
    four: 4, apat: 4, kwatro: 4, cuatro: 4,
    five: 5, lima: 5, singko: 5, cinco: 5
};
const UNIT_AFTER = /^(years?|yrs?|taon|buwan|months?|weeks?|linggo|days?|araw|hours?|hrs?|oras|minutes?|mins?|minuto|seconds?|members?|miyembro|tao|people|persons?|beses|times|groups?|subjects?|semesters?|sems?|units?|pcs?|computers?|gb|ghz|mb|tb|%|percent|am|pm|o'clock|st|nd|rd|th|sa\s+mga|beses|batch|sections?|rooms?)$/i;
const CONTEXT_BEFORE = /\b(rate|rating|rated|i'?d|would|give|gave|bigyan|bibigyan|ibibigay|binibigay|bigay|score|grade|marka|siguro|maybe|probably|mga|around|about|approximately|is|ay|at|equals?|nasa|lang|solid)\s*$/i;

function stripScaleDefinitions(text) {
    return text
        // "in a scale of 1 to 5", "on a scale from one to five", "scale 1-5", "sa scale na 1 hanggang 5"
        .replace(/\b(?:in|on|sa|from|using)?\s*(?:a|the|ng|na)?\s*scale\s*(?:of|from|na|ng)?\s*(?:1|one|isa|uno)\s*(?:to|-|–|hanggang|up\s+to|until)\s*(?:5|five|lima|10|ten)\b/gi, ' ')
        // "from 1 to 5", "1 to 5", "1-5", "isa hanggang lima"
        .replace(/\b(?:from\s+)?(?:1|one|isa|uno)\s*(?:to|-|–|hanggang|up\s+to)\s*(?:5|five|lima|10|ten)\b/gi, ' ')
        // dangling "out of five" with no numerator handled below; remove standalone "scale" filler
        .replace(/\bscale\b/gi, ' ');
}

/**
 * Returns explicit rating mentions as [{ value, index }] with index = char position in `clean`.
 */
function findExplicitRatings(clean) {
    const results = [];

    // A. "8 out of 10" / "8/10" -> 4
    const tenScale = /\b(10|[1-9](?:\.\d)?)\s*(?:out\s+of|over|\/|sa)\s*(?:10|ten|sampu)\b/gi;
    let m;
    const consumed = [];
    while ((m = tenScale.exec(clean)) !== null) {
        const v = Math.max(1, Math.min(5, Math.round(parseFloat(m[1]) / 2)));
        results.push({ value: v, index: m.index });
        consumed.push([m.index, m.index + m[0].length]);
    }

    // B. Ranges "4 or 5", "4 to 5", "4-5", "3 o 4" -> average
    const range = /\b([1-5](?:\.\d)?)\s*(?:or|o|to|-|–|hanggang|or\s+maybe)\s*([1-5](?:\.\d)?)\b(?!\s*(?:out\s+of|over|\/)\s*10)/gi;
    while ((m = range.exec(clean)) !== null) {
        if (consumed.some(([s, e]) => m.index >= s && m.index < e)) continue;
        const a = parseFloat(m[1]);
        const b = parseFloat(m[2]);
        results.push({ value: (a + b) / 2, index: m.index });
        consumed.push([m.index, m.index + m[0].length]);
    }

    // C. Single digits / decimals 1–5 (with optional "out of 5" / "/5" / "stars")
    const single = /\b([1-5](?:\.\d)?)\b(?:\s*(?:out\s+of|over|\/|sa)\s*(?:5|five|lima))?/gi;
    while ((m = single.exec(clean)) !== null) {
        const start = m.index;
        if (consumed.some(([s, e]) => start >= s && start < e)) continue;

        // Skip parts of larger numbers / IDs / years (e.g. 0123-0296, 2026, 1.45 GWA-like 2-decimal values)
        const before = clean.slice(Math.max(0, start - 2), start);
        const afterChar = clean.charAt(start + m[1].length);
        if (/[\d-]$/.test(before) && !/\s$/.test(before)) continue;
        if (/[\d-]/.test(afterChar) && !/\s/.test(afterChar)) continue;

        // Skip durations / counts ("2 years", "3 members", "4 subjects")
        const nextWord = (clean.slice(start + m[0].length).match(/^\s*([a-z%']+)/i) || [])[1] || '';
        if (UNIT_AFTER.test(nextWord)) continue;

        results.push({ value: parseFloat(m[1]), index: start });
    }

    // D. Number words — ONLY in a rating context (avoid "isa sa mga...", "one of the...", "isang subject")
    const wordRe = /\b(one|isa|uno|two|dalawa|dos|three|tatlo|tres|four|apat|kwatro|cuatro|five|lima|singko|cinco)\b/gi;
    while ((m = wordRe.exec(clean)) !== null) {
        const start = m.index;
        const word = m[1].toLowerCase();
        const after = clean.slice(start + m[0].length);
        const beforeText = clean.slice(Math.max(0, start - 40), start);

        // Idioms: "isa sa mga...", "one of the...", "isa na naman" are never ratings
        const isOneWord = /^(one|isa|uno)$/.test(word);
        if (isOneWord && /^\s*(?:sa|of|ng|na\s+\w+|lang\s+sa)\b/i.test(after) && !/^\s*(?:sa|of)\s*(?:5|five|lima|10|ten)\b/i.test(after)) continue;
        const nextWord = (after.match(/^\s*([a-z%']+)/i) || [])[1] || '';
        if (UNIT_AFTER.test(nextWord)) continue;

        const ratingFollows = /^\s*(?:out\s+of|over|\/|stars?|sa\s+(?:5|lima|five))\b/i.test(after);
        const ratingPrecedes = CONTEXT_BEFORE.test(beforeText);
        if (!ratingFollows && !ratingPrecedes) continue;

        results.push({ value: NUMBER_WORDS[word], index: start });
    }

    return results
        .filter(r => r.value >= 1 && r.value <= 5)
        .sort((a, b) => a.index - b.index);
}

/* --------------------------------------------------------------------------------------------
 * Topic segmentation & attribution
 * ------------------------------------------------------------------------------------------ */
function findAspectHits(text, aspectKeys) {
    const hits = [];
    for (const key of aspectKeys) {
        const re = new RegExp(RATING_ASPECTS[key].source, 'gi');
        let m;
        while ((m = re.exec(text)) !== null) {
            hits.push({ key, index: m.index, end: m.index + m[0].length });
        }
    }
    return hits.sort((a, b) => a.index - b.index);
}

/**
 * Splits the answer into clauses on punctuation and contrastive connectors, and starts a new
 * clause whenever the speaker switches to a different aspect. Each clause inherits the most
 * recently discussed aspect when it does not name one itself.
 */
function segmentByAspect(text, aspectKeys) {
    const hits = findAspectHits(text, aspectKeys);
    const boundaries = new Set([0, text.length]);

    const punct = /[.!?;]+|,\s+(?=(?:pero|ngunit|kaso|tapos|then|but|however|while|sa\s+\w+\s+naman)\b)|\b(?:pero|ngunit|kaso|subalit|however|but|whereas|tapos\s+sa|then\s+for|as\s+for|pagdating\s+sa)\b/gi;
    let m;
    while ((m = punct.exec(text)) !== null) {
        boundaries.add(m.index);
    }

    // Aspect switch boundaries (include a leading "sa"/"for"/"yung"/"ang"/"the" preposition)
    let lastKey = null;
    for (const h of hits) {
        if (h.key !== lastKey) {
            const pre = text.slice(Math.max(0, h.index - 12), h.index);
            const prepMatch = pre.match(/(?:\b(?:sa|for|yung|iyung|ang|the|our|mga|naman\s+sa|about)\s+)+$/i);
            boundaries.add(prepMatch ? h.index - prepMatch[0].length : h.index);
            lastKey = h.key;
        }
    }

    const sorted = Array.from(boundaries).sort((a, b) => a - b);
    const segments = [];
    let carriedKey = null;
    for (let i = 0; i < sorted.length - 1; i++) {
        const start = sorted[i];
        const end = sorted[i + 1];
        const segText = text.slice(start, end);
        if (!segText.trim()) continue;
        const ownHits = hits.filter(h => h.index >= start && h.index < end);
        const ownKeys = Array.from(new Set(ownHits.map(h => h.key)));
        const key = ownKeys[0] || carriedKey;
        if (ownKeys.length > 0) carriedKey = ownKeys[ownKeys.length - 1];
        segments.push({ start, end, text: segText, keys: ownKeys.length > 0 ? ownKeys : (key ? [key] : []) });
    }
    return segments;
}

function clampRating(v) {
    return Math.max(1, Math.min(5, Math.round(v)));
}

/**
 * Extracts 1–5 ratings for each aspect of a single interview answer.
 *
 * @param {string} answerText  The interviewee's spoken answer for one stage.
 * @param {string[]} aspectKeys Ordered aspect keys asked in that stage (e.g. ['mentorship','internship']).
 * @returns {{ ratings: Object<string, number>, details: Object<string, {value:number, source:string}> }}
 */
export function extractAspectRatings(answerText = '', aspectKeys = []) {
    const ratings = {};
    const details = {};
    const text = (answerText || '').trim();

    if (!text) {
        aspectKeys.forEach(k => {
            ratings[k] = 3;
            details[k] = { value: 3, source: 'no-answer-default' };
        });
        return { ratings, details };
    }

    const clean = stripScaleDefinitions(text);
    const explicit = findExplicitRatings(clean);
    const segments = segmentByAspect(clean, aspectKeys);
    const anyAspectMentioned = segments.some(s => s.keys.length > 0);

    const explicitByAspect = {};
    const unattributed = [];

    if (!anyAspectMentioned) {
        // No topical cues at all -> follow the order the aspects were asked in
        explicit.forEach((r, i) => {
            if (i < aspectKeys.length) {
                (explicitByAspect[aspectKeys[i]] ||= []).push(r.value);
            } else {
                unattributed.push(r.value);
            }
        });
    } else {
        for (const r of explicit) {
            // "5 for the hardware" / "4 sa wifi" / "lima naman sa electives" -> look ahead for a named aspect
            const ahead = clean.slice(r.index, r.index + 48);
            const aheadMatch = aspectKeys.find(k =>
                new RegExp(
                    `^\\S+(?:\\s+(?:naman|po|lang|ko|siguro|rating))*\\s+(?:for|sa|para\\s+sa|in|on|ang|ng|yung|the)\\s+(?:\\S+\\s+){0,2}?(?:${RATING_ASPECTS[k].source})`,
                    'i'
                ).test(ahead)
            );
            if (aheadMatch) {
                (explicitByAspect[aheadMatch] ||= []).push(r.value);
                continue;
            }
            const seg = segments.find(s => r.index >= s.start && r.index < s.end);
            if (seg && seg.keys.length > 0) {
                seg.keys.forEach(k => (explicitByAspect[k] ||= []).push(r.value));
            } else {
                unattributed.push(r.value);
            }
        }
    }

    const allExplicitValues = explicit.map(r => r.value);
    const generalStated = allExplicitValues.length > 0
        ? allExplicitValues.reduce((a, b) => a + b, 0) / allExplicitValues.length
        : null;
    const wholeAnswerSentiment = inferRatingFromSentiment(clean);

    // Coordinated aspects share one stated rating: "core programming and electives, siguro 4",
    // "program na selectives ... 4", "hardware at software, mga 3".
    if (anyAspectMentioned) {
        const hits = findAspectHits(clean, aspectKeys);
        for (let i = 0; i < hits.length - 1; i++) {
            const a = hits[i];
            const b = hits[i + 1];
            if (a.key === b.key) continue;
            const between = clean.slice(a.end, b.index);
            if (!/^\s*(?:,|\/|&|\band\b|\bat\b|\bna\b|\btsaka\b|\bsaka\b|\bpati\b|\bpati\s+na\s+(?:rin\s+)?(?:ang|yung)\b|\bor\b|\bo\b)?\s*(?:(?:the|yung|ang|sa|mga|our)\s+)*$/i.test(between)) continue;
            const aHas = explicitByAspect[a.key]?.length;
            const bHas = explicitByAspect[b.key]?.length;
            if (aHas && !bHas) explicitByAspect[b.key] = [...explicitByAspect[a.key]];
            else if (bHas && !aHas) explicitByAspect[a.key] = [...explicitByAspect[b.key]];
        }
    }

    // Tagalog often states the verdict BEFORE the subject ("nagloloko yung wifi") — capture the
    // few words preceding each aspect keyword as additional evidence for that aspect.
    const preKeywordEvidence = (key) => {
        const hits = findAspectHits(clean, aspectKeys);
        return hits
            .filter(h => h.key === key)
            .map(h => {
                const prevOther = hits.filter(o => o.key !== key && o.end <= h.index).pop();
                const floor = prevOther ? prevOther.end : 0;
                const words = clean.slice(floor, h.index).trim().split(/\s+/).slice(-4).join(' ');
                return words;
            })
            .join('. ');
    };

    for (const key of aspectKeys) {
        if (explicitByAspect[key]?.length) {
            const vals = explicitByAspect[key];
            const v = clampRating(vals.reduce((a, b) => a + b, 0) / vals.length);
            ratings[key] = v;
            details[key] = { value: v, source: 'explicit' };
            continue;
        }

        const aspectText = segments.filter(s => s.keys.includes(key)).map(s => s.text).join('. ');
        let aspectSentiment = aspectText ? inferRatingFromSentiment(aspectText) : null;
        if (aspectSentiment === null) {
            const pre = preKeywordEvidence(key);
            aspectSentiment = pre ? inferRatingFromSentiment(pre) : null;
        }
        if (aspectSentiment !== null) {
            ratings[key] = aspectSentiment;
            details[key] = { value: aspectSentiment, source: 'aspect-sentiment' };
            continue;
        }

        if (unattributed.length > 0 || generalStated !== null) {
            const pool = unattributed.length > 0 ? unattributed : allExplicitValues;
            const v = clampRating(pool.reduce((a, b) => a + b, 0) / pool.length);
            ratings[key] = v;
            details[key] = { value: v, source: 'overall-stated-rating' };
            continue;
        }

        // Aspect never discussed and no number given: lean on overall tone, tempered toward neutral
        const v = wholeAnswerSentiment !== null ? clampRating((wholeAnswerSentiment + 3) / 2) : 3;
        ratings[key] = v;
        details[key] = { value: v, source: wholeAnswerSentiment !== null ? 'answer-sentiment' : 'neutral-default' };
    }

    return { ratings, details };
}

/* --------------------------------------------------------------------------------------------
 * Whole-interview helper (shared by live save + backfill)
 * ------------------------------------------------------------------------------------------ */
export const RATING_STAGE_ASPECTS = {
    curriculum: ['coreProgramming', 'electives'],
    labs: ['hardware', 'software', 'internet', 'labEnvironment'],
    mentorship: ['mentorship', 'internship']
};

/**
 * Computes all eight institutional ratings + overall average from the three rating answers.
 */
export function computeInterviewRatings({ curriculumAnswer = '', labsAnswer = '', mentorshipAnswer = '' } = {}) {
    const cur = extractAspectRatings(curriculumAnswer, RATING_STAGE_ASPECTS.curriculum);
    const lab = extractAspectRatings(labsAnswer, RATING_STAGE_ASPECTS.labs);
    const men = extractAspectRatings(mentorshipAnswer, RATING_STAGE_ASPECTS.mentorship);

    const ratings = { ...cur.ratings, ...lab.ratings, ...men.ratings };
    const keys = [...RATING_STAGE_ASPECTS.curriculum, ...RATING_STAGE_ASPECTS.labs, ...RATING_STAGE_ASPECTS.mentorship];
    const overallAvg = parseFloat((keys.reduce((sum, k) => sum + ratings[k], 0) / keys.length).toFixed(2));

    return {
        ratings: { ...ratings, overallAvg },
        details: { ...cur.details, ...lab.details, ...men.details }
    };
}

/**
 * Locates the curriculum / labs / mentorship answers inside a saved Q&A transcript, supporting
 * both the current 7-answer flow (Q2 = Academic Standing) and the legacy 6-answer flow.
 */
export function locateRatingAnswers(qaPairs = []) {
    const answers = qaPairs.filter(p => p.type === 'answer').sort((a, b) => a.index - b.index);
    const q2 = qaPairs.find(p => p.type === 'question' && p.index === 2);
    const isAcademicFlow =
        (q2 && /\b(gwa|general\s+weighted\s+average|latin\s+honors|cum\s+laude|college\s+department)\b/i.test(q2.text || '')) ||
        answers.length >= 7;
    const offset = isAcademicFlow ? 1 : 0;
    return {
        curriculumAnswer: answers[1 + offset]?.text || '',
        labsAnswer: answers[2 + offset]?.text || '',
        mentorshipAnswer: answers[3 + offset]?.text || '',
        flow: isAcademicFlow ? 'academic-7' : 'legacy-6'
    };
}
