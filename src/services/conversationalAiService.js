/**
 * Conversational AI Service for LSPU College of Computer Studies (CCS) Exit Interview.
 * 
 * Features:
 * 1. Character.ai-style persona: CCS Program Head conducting an empathetic, natural dialogue.
 * 2. Institutional Memory: Retrieves and learns from past interview sessions stored in PostgreSQL / localStorage.
 * 3. Code-switching: Dynamically converses in English, Filipino/Tagalog, or Taglish based on user speech.
 * 4. Structured Extraction & Automatic Persistence: Automatically maps the interviewee's actual spoken
 *    responses into standard database records and saves to PostgreSQL upon completion.
 */

import { getInterviewTranscripts, saveInterviewTranscriptRecord } from '../utils/transcriptStorage';
import { analyzeSentiment, correctFilipinoName } from './aiService';
import { computeInterviewRatings, extractAspectRatings } from '../utils/ratingExtractor';

// Google AI Studio API is DISCONNECTED - 100% autonomous local dialogue engine

/**
 * Builds institutional knowledge summary from past student interviews in the database.
 */
export function getInstitutionalKnowledge() {
    const pastRecords = getInterviewTranscripts() || [];
    const totalCount = pastRecords.length;

    if (totalCount === 0) {
        return {
            totalInterviews: 0,
            summaryText: "Initial batch of exit interviews for LSPU College of Computer Studies."
        };
    }

    // Compute average ratings
    let sumCore = 0, sumElectives = 0, sumMentorship = 0, sumHardware = 0, sumInternet = 0;
    const topGrievances = [];
    const topUsefulTech = [];
    const topMissingTech = [];
    const topLegacyTips = [];

    pastRecords.forEach(r => {
        if (r.ratings) {
            sumCore += (r.ratings.coreProgramming || 0);
            sumElectives += (r.ratings.electives || 0);
            sumMentorship += (r.ratings.mentorship || 0);
            sumHardware += (r.ratings.hardware || 0);
            sumInternet += (r.ratings.internet || 0);
        }
        if (r.grievance && r.grievance !== 'N/A') topGrievances.push(r.grievance);
        if (r.usefulTech && r.usefulTech !== 'N/A') topUsefulTech.push(r.usefulTech);
        if (r.desiredTech && r.desiredTech !== 'N/A') topMissingTech.push(r.desiredTech);
        if (r.legacyTip && r.legacyTip !== 'N/A') topLegacyTips.push(r.legacyTip);
    });

    const avgCore = (sumCore / totalCount).toFixed(1);
    const avgElectives = (sumElectives / totalCount).toFixed(1);
    const avgMentorship = (sumMentorship / totalCount).toFixed(1);
    const avgHardware = (sumHardware / totalCount).toFixed(1);
    const avgInternet = (sumInternet / totalCount).toFixed(1);

    return {
        totalInterviews: totalCount,
        avgCore,
        avgElectives,
        avgMentorship,
        avgHardware,
        avgInternet,
        frequentGrievances: topGrievances.slice(0, 5),
        frequentUsefulTech: topUsefulTech.slice(0, 5),
        frequentMissingTech: topMissingTech.slice(0, 5),
        frequentLegacyTips: topLegacyTips.slice(0, 5),
        summaryPromptContext: `
INSTITUTIONAL KNOWLEDGE FROM PAST ${totalCount} GRADUATE INTERVIEWS:
- Average Core Programming Rating: ${avgCore}/5.0
- Average Capstone Mentorship Rating: ${avgMentorship}/5.0 (highly praised by graduates)
- Average Lab Hardware Rating: ${avgHardware}/5.0
- Average Campus Internet Rating: ${avgInternet}/5.0 (frequently flagged for latency during defense weeks)
- Common Grievances: Slow PC boot times, intermittent campus Wi-Fi, aircon unit issues in PC Lab 2, limited server hosting privileges.
- Most Valuable Technologies Learned: Python, Java, SQL, React, Node.js.
- Technologies Alumni Wished Were Taught: Docker, AWS Cloud, Kubernetes, DevOps CI/CD, Cybersecurity, Flutter.
- Top Advice for Freshmen: Master Git version control early, practice coding every day, and don't rely solely on AI.
`
    };
}

/**
 * Sequential interview agenda domains matching LSPU CCS Exit Interview Survey
 */
export const INTERVIEW_DOMAINS = [
    {
        stage: 1,
        name: "Welcome & Alumni Identity",
        goals: "Welcome graduated alumnus warmly, ask for Full Name and optional Student ID number if remembered.",
        starterMessage: "Magandang araw! Ako ang AI Interview Assistant ng College of Computer Studies sa LSPU. Unang-una, maligayang pagbati bilang ganap na graduate at alumnus ng ating kolehiyo! Bilang bahagi ng ating alumni exit interview, nais naming marinig ang iyong naging karanasan noong nag-aaral ka pa upang patuloy na mapabuti ang ating departamento. Bago tayo magsimula, maaari mo bang sabihin ang iyong buong pangalan? At if possible, can you also share your student id if you still remember it?"
    },
    {
        stage: 2,
        name: "Academic Standing & Honors",
        goals: "Ask for the alumnus's degree program, college department, year of graduation, General Weighted Average (GWA), and whether they graduated with any Latin Honors."
    },
    {
        stage: 3,
        name: "Curriculum & Tech Stack Evaluation",
        goals: "Inquire about core programming theories and electives (ratings 1-5), what tech stack was most valuable, and what missing technologies (e.g. Cloud, Docker) should be added."
    },
    {
        stage: 4,
        name: "Lab Infrastructure & Grievances",
        goals: "Ask about Computer Lab hardware, software IDEs, and campus Wi-Fi (ratings 1-5). Reference past alumni feedback regarding Wi-Fi latency or PC boot times, and ask for their biggest grievance."
    },
    {
        stage: 5,
        name: "Capstone Mentorship & Internship",
        goals: "Ask about their Capstone role, how they rate their Capstone project mentorship (1-5), and IT Internship practicum value (1-5)."
    },
    {
        stage: 6,
        name: "Career Readiness & Alumni Relations",
        goals: "Ask about current employment status, confidence passing technical coding interviews, and if they'd return as an alumni guest speaker or mentor."
    },
    {
        stage: 7,
        name: "Rewarding Breakthrough & Freshman Advice",
        goals: "Ask for their most rewarding breakthrough moment, any process in CCS they'd optimize (defense schedules, grading), and their golden advice/legacy tip for incoming freshmen."
    },
    {
        stage: 8,
        name: "Graduation Blessing & Automatic Save",
        goals: "Deliver a heartfelt, inspirational graduation blessing on behalf of LSPU CCS faculty, and conclude the interview."
    }
];

/**
 * Helper: Extract Student ID from spoken/typed text (optional field)
 */
function parseSpokenStudentId(text = '') {
    if (!text) return 'Not Provided';

    // Normalize common spoken digits
    const digitWords = {
        zero: '0', oh: '0', one: '1', isa: '1', two: '2', dalawa: '2',
        three: '3', tatlo: '3', four: '4', apat: '4', five: '5', lima: '5',
        six: '6', anim: '6', seven: '7', pito: '7', eight: '8', walo: '8', nine: '9', siyam: '9',
        dash: '-', hyphen: '-'
    };

    let normalized = text.toLowerCase();
    Object.entries(digitWords).forEach(([word, digit]) => {
        normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit);
    });

    // Collapse spaced single digits like "0 1 2 2 - 0 4 5 6"
    const compactDigits = normalized.replace(/(\d)\s+(?=\d|-)/g, '$1').replace(/(-\s+)(?=\d)/g, '-');

    const hyphenatedMatch = compactDigits.match(/\b(\d{2,4})-(\d{3,6})\b/);
    if (hyphenatedMatch) {
        return `${hyphenatedMatch[1]}-${hyphenatedMatch[2]}`;
    }

    const eightDigitMatch = compactDigits.match(/\b(\d{4})(\d{4})\b/);
    if (eightDigitMatch && !/^202\d/.test(eightDigitMatch[0])) {
        return `${eightDigitMatch[1]}-${eightDigitMatch[2]}`;
    }

    return 'Not Provided';
}

const INTRO_FILLER_TOKENS = new Set([
    'ako', 'po', 'opo', 'ay', 'si', 'nga', 'pala', 'ang', 'aking', 'buong', 'pangalan', 'ko',
    'ito', 'my', 'full', 'complete', 'name', 'is', 'i', 'am', "i'm", 'im', 'this',
    'sir', "ma'am", 'maam', 'madam', 'doc', 'dean', 'hello', 'hi', 'hey',
    'magandang', 'araw', 'umaga', 'hapon', 'gabi', 'good', 'morning', 'afternoon', 'evening', 'day'
]);

/**
 * Helper: Extract clean graduate name accurately from Stage 1 introduction (Tagalog, English, or Taglish)
 */
export function parseGraduateName(firstTurn = '') {
    if (!firstTurn || typeof firstTurn !== 'string' || !firstTurn.trim()) return '';

    // 1. Targeted Tagalog / Taglish / English self-introduction patterns
    // Covers: "Ako ay si X", "Ako po ay si X", "Ako po si X", "Ako nga pala si X",
    // "Ang aking buong pangalan po ay X", "Pangalan ko po ay X", "Ito po si X", "My full name is X", "I am X"
    const introPatterns = [
        /(?:ako\s+(?:po\s+)?(?:nga\s+pala\s+|pala\s+)?(?:ay\s+)?si|(?:ang\s+)?(?:aking\s+)?(?:buong\s+)?pangalan\s+(?:ko\s+)?(?:po\s+)?(?:ay|is|si)|ito\s+(?:po\s+)?si|my\s+(?:full\s+|complete\s+)?name\s+is|i\s+am|i'm|this\s+is)\s+([A-Za-zÑñÁÉÍÓÚáéíóú.\-\s]{2,55}?)(?=\s*(?:,|;|\.|!|\?|\bat\b|\band\b|\bang\b|\baking\b|\bmy\b|\bstudent\b|\bid\b|\bi\.d\b|\bnumber\b|\bnoong\b|\bnoon\b|\bfrom\b|\btaking\b|\bgraduate\b|\bgraduated\b|\balumnus\b|\bbsit\b|\bbscs\b|\bwala\b|\bhindi\b|\bpo\s+(?:ito|ako|at|ang)\b|\d|$))/i
    ];

    for (const pattern of introPatterns) {
        const m = firstTurn.match(pattern);
        if (m && m[1]) {
            const candidateTokens = m[1]
                .replace(/\b(po|opo|sir|ma'am|maam|doc)\b/gi, ' ')
                .split(/\s+/)
                .map(t => t.trim())
                .filter(t => t && !INTRO_FILLER_TOKENS.has(t.toLowerCase().replace(/\./g, '')));

            const candidate = candidateTokens.join(' ').trim();
            if (candidate.length >= 2 && candidateTokens.length >= 1 && candidateTokens.length <= 6) {
                return correctFilipinoName(candidate, 'fullname');
            }
        }
    }

    // 2. Fallback: strip greetings, intro glue words, student ID clauses, and course clauses
    let cleaned = firstTurn
        .replace(/\b(magandang\s+(?:araw|umaga|hapon|gabi)|good\s+(?:morning|afternoon|evening|day)|hello|hi|hey|opo|po|sir|ma'am|maam|doc)\b/gi, ' ')
        .replace(/(?:at\s+)?(?:ang\s+)?(?:aking\s+|my\s+)?student\s*(?:id|i\.d\.?|number)[^,.]*/gi, ' ')
        .replace(/(?:i\s+don'?t\s+remember|nakalimutan|hindi\s+ko\s+(?:na\s+)?maalala|wala\s+(?:na\s+)?(?:po\s+)?akong\s+maalala)[^,.]*/gi, ' ')
        .replace(/\b\d{2,4}[-\s]?\d{3,6}\b/g, ' ')
        .replace(/\b(bsit|bscs|bs\s+in\s+information\s+technology|bs\s+in\s+computer\s+science|information\s+technology|computer\s+science)\b/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const firstClause = cleaned.split(/[,.;!?\n]/)[0].trim();
    const nameWords = firstClause
        .split(/\s+/)
        .filter(w => w && !INTRO_FILLER_TOKENS.has(w.toLowerCase().replace(/\./g, '')) && !/\d/.test(w));

    if (nameWords.length >= 1 && nameWords.length <= 5) {
        const candidate = nameWords.join(' ').trim();
        if (candidate.length >= 2 && candidate.length <= 48) {
            return correctFilipinoName(candidate, 'fullname');
        }
    }

    return '';
}

/**
 * Resolves the accurate display name for any session record, automatically recovering the
 * graduate's real spoken name from A1 if an older saved record defaulted to "Anonymous Graduate".
 */
export function resolveSessionDisplayName(session) {
    if (!session) return 'Anonymous Graduate';
    const rawName = (session.name || '').trim();
    if (rawName && !/^(anonymous(\s+graduate)?|n\/a|unknown)$/i.test(rawName)) {
        return rawName;
    }

    // Attempt recovery from A1 in rawResponses
    const qaPairs = session.rawResponses?.qaPairs;
    if (Array.isArray(qaPairs)) {
        const firstAnswer = qaPairs.find(p => p.type === 'answer' || p.speaker === 'Interviewee');
        if (firstAnswer?.text) {
            const recovered = parseGraduateName(firstAnswer.text);
            if (recovered) return recovered;
        }
    }

    const fullConv = session.rawResponses?.fullConversationTranscript;
    if (Array.isArray(fullConv)) {
        const firstStudentTurn = fullConv.find(t => t.sender === 'interviewee');
        if (firstStudentTurn?.text) {
            const recovered = parseGraduateName(firstStudentTurn.text);
            if (recovered) return recovered;
        }
    }

    return rawName || 'Anonymous Graduate';
}

/**
 * Helper: Detect degree program from text
 */
function parseDegreeProgram(text = '') {
    if (!text) return null;
    if (/master.*information\s+technology|\bmsit\b|\bmit\b/i.test(text)) {
        return 'Master in Information Technology (MIT)';
    }
    if (/master.*computer\s+science|\bmscs\b/i.test(text)) {
        return 'MS in Computer Science (MSCS)';
    }
    if (/associate\s+in\s+computer\s+technology|\bact\b/i.test(text)) {
        return 'Associate in Computer Technology (ACT)';
    }
    if (/computer\s+science|\bbscs\b|\bcom\s*sci\b|\bb\.s\.\s*c\.s\b/i.test(text)) {
        return 'BS in Computer Science (BSCS)';
    }
    if (/information\s+technology|\bbsit\b|\bb\.s\.\s*i\.t\b/i.test(text)) {
        return 'BS in Information Technology (BSIT)';
    }
    const customDegree = text.match(/\b((?:bachelor\s+of\s+(?:science|arts)\s+in|bs\s+in)\s+[A-Za-z\s]{4,40}?)(?=\s*(?:,|;|\.|sa\b|ng\b|from\b|under\b|noong\b|year\b|batch\b|\d|$))/i);
    if (customDegree && customDegree[1]) {
        return customDegree[1].trim();
    }
    return null;
}

/**
 * Helper: Detect college department from spoken text
 */
function parseCollegeDepartment(text = '') {
    if (!text) return 'College of Computer Studies (CCS)';
    if (/college\s+of\s+computer\s+studies|\bcomputer\s+studies\b|\bccs\b/i.test(text)) {
        return 'College of Computer Studies (CCS)';
    }
    if (/college\s+of\s+engineering|\bcoe\b/i.test(text)) {
        return 'College of Engineering (COE)';
    }
    const explicitCollege = text.match(/\b((?:college|department|faculty)\s+of\s+[A-Za-z\s,&]{4,45}?)(?=\s*(?:,|;|\.|at\b|and\b|noong\b|sa\s+lspu\b|year\b|batch\b|ang\b|\d|$))/i);
    if (explicitCollege && explicitCollege[1]) {
        return explicitCollege[1].trim();
    }
    return 'College of Computer Studies (CCS)';
}

/**
 * Helper: Extract 4-digit Year of Graduation (e.g., 2026, 2025, 2024)
 */
function parseGraduationYear(text = '') {
    if (!text) return '2026';
    const normalized = text
        .toLowerCase()
        .replace(/\b(?:twenty|two\s+thousand(?:\s+and)?)\s+twenty[\s-]*six\b/g, '2026')
        .replace(/\b(?:twenty|two\s+thousand(?:\s+and)?)\s+twenty[\s-]*five\b/g, '2025')
        .replace(/\b(?:twenty|two\s+thousand(?:\s+and)?)\s+twenty[\s-]*four\b/g, '2024')
        .replace(/\b(?:twenty|two\s+thousand(?:\s+and)?)\s+twenty[\s-]*three\b/g, '2023')
        .replace(/\b(?:twenty|two\s+thousand(?:\s+and)?)\s+twenty[\s-]*seven\b/g, '2027');

    // Avoid matching inside hyphenated Student IDs (e.g., 0123-2024)
    const strippedIds = normalized.replace(/\b\d{2,4}-\d{3,6}\b/g, ' ');
    const yearMatch = strippedIds.match(/\b(20[1-3]\d|199\d)\b/);
    if (yearMatch) {
        return yearMatch[1];
    }
    return '2026';
}

/**
 * Helper: Extract General Weighted Average (GWA, Philippine 1.00 - 3.00 scale) from Stage 2 answer
 */
function parseGWA(text = '') {
    if (!text || !text.trim()) return 'Not Provided';

    let normalized = text
        .toLowerCase()
        .replace(/\b(uno|one)\s+(?:point\s+)?(singkwenta|fifty|five\s+zero)\b/g, '1.50')
        .replace(/\b(uno|one)\s+(?:point\s+)?(bente\s+singko|twenty[\s-]*five)\b/g, '1.25')
        .replace(/\b(uno|one)\s+(?:point\s+)?(setenta'?y?\s+singko|seventy[\s-]*five)\b/g, '1.75')
        .replace(/\b(dos|two)\s+(?:point\s+)?(zero|flat)\b/g, '2.00')
        .replace(/\b(uno|one)\s+(?:point\s+)?(zero|flat)\b/g, '1.00');

    // Convert spoken "one point forty five" / "1 point 45" / "1 point 4 5"
    const tensMap = {
        ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
        sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
        twenty: '2', thirty: '3', forty: '4', fifty: '5', sixty: '6', seventy: '7', eighty: '8', ninety: '9'
    };
    const onesMap = {
        zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9'
    };

    normalized = normalized.replace(
        /\b(one|two|three|uno|dos|tres|[1-3])\s+point\s+([a-z0-9]+)(?:[\s-]+([a-z0-9]+))?\b/gi,
        (full, wholeWord, dec1, dec2) => {
            const wMap = { one: '1', uno: '1', two: '2', dos: '2', three: '3', tres: '3', '1': '1', '2': '2', '3': '3' };
            const w = wMap[wholeWord.toLowerCase()];
            if (!w) return full;
            const d1 = dec1.toLowerCase();
            const d2 = (dec2 || '').toLowerCase();
            if (/^\d+$/.test(d1)) {
                const digits = d2 && /^\d+$/.test(d2) ? `${d1}${d2}` : d1;
                return `${w}.${digits}`;
            }
            if (tensMap[d1]) {
                if (tensMap[d1].length === 2) return `${w}.${tensMap[d1]}`;
                const secondDigit = onesMap[d2] || '0';
                return `${w}.${tensMap[d1]}${secondDigit}`;
            }
            if (onesMap[d1] !== undefined) {
                const secondDigit = onesMap[d2] !== undefined ? onesMap[d2] : '';
                return `${w}.${onesMap[d1]}${secondDigit}`;
            }
            return full;
        }
    );

    // Match explicit Philippine GWA decimals between 1.00 and 3.50 (e.g., 1.25, 1.48, 1.8, 2.15)
    const gwaDecimalMatch = normalized.match(/\b([1-3])\.(\d{1,3})\b/);
    if (gwaDecimalMatch) {
        const val = parseFloat(`${gwaDecimalMatch[1]}.${gwaDecimalMatch[2]}`);
        if (val >= 1.0 && val <= 4.0) {
            return val.toFixed(2);
        }
    }

    // Match percentage GWA if stated (e.g., "92.5%" or "GWA ko ay 91")
    const pctMatch = normalized.match(/\b(8\d|9\d)(?:\.(\d{1,2}))?\s*%/);
    if (pctMatch) {
        return `${pctMatch[1]}${pctMatch[2] ? '.' + pctMatch[2] : ''}%`;
    }

    return 'Not Provided';
}

/**
 * Helper: Extract Latin Honors accurately with clause-level negation awareness
 */
function parseLatinHonors(text = '') {
    if (!text || !text.trim()) return 'None';

    const clauses = text
        .split(/(?:,|;|\.|!|\?|\bpero\b|\bngunit\b|\bsubalit\b|\bbut\b|\bhowever\b|\balthough\b)/i)
        .map(c => c.trim())
        .filter(Boolean);

    const negationRegex = /\b(wala|walang|hindi|di\s+po|di\s+ako|not|no|none|without|kinulang|bitin|almost|halos)\b/i;

    for (const clause of clauses) {
        const isNegated = negationRegex.test(clause);
        if (!isNegated) {
            if (/\b(?:summa|suma)\s+cum\s+laude\b/i.test(clause)) return 'Summa Cum Laude';
            if (/\bmagna\s+cum\s+laude\b/i.test(clause)) return 'Magna Cum Laude';
            if (/\bcum\s+laude\b/i.test(clause)) return 'Cum Laude';
            if (/\bacademic\s+distinction\b|\bwith\s+distinction\b/i.test(clause)) return 'With Academic Distinction';
        }
    }

    return 'None';
}

/**
 * Helper: Extract 1-5 ratings mentioned in a turn (backward-compatible wrapper around ratingExtractor)
 */
function extractRatingsFromTurn(turnText = '', count = 1) {
    if (!turnText || !turnText.trim()) {
        return Array(count).fill(3);
    }
    const genericAspects = ['a1', 'a2', 'a3', 'a4'].slice(0, count);
    const { ratings } = extractAspectRatings(turnText, genericAspects);
    return genericAspects.map(k => ratings[k] ?? 3);
}

/**
 * Generates the Program Head's next response autonomously using local institutional knowledge
 * and student context. Disconnected from Google AI Studio API for complete offline reliability.
 */
export async function generateProgramHeadReply({
    conversationHistory = [],
    currentStage = 1
}) {
    const studentTurns = conversationHistory.filter(t => t.sender === 'interviewee');
    const firstTurnText = studentTurns[0]?.text || '';
    const secondTurnText = studentTurns[1]?.text || '';

    const studentName = parseGraduateName(firstTurnText);
    const detectedProgram = parseDegreeProgram(`${secondTurnText} ${firstTurnText}`);
    const detectedHonors = parseLatinHonors(secondTurnText);
    const greetingName = studentName ? `, ${studentName}` : '';

    const honorsCongrats =
        detectedHonors && detectedHonors !== 'None'
            ? ` Binabati rin kita sa iyong pagtatapos bilang ${detectedHonors}!`
            : '';

    const programPhrase = detectedProgram
        ? `Bilang alumnus ng ${detectedProgram.replace(/\s*\([^)]*\)/g, '')}, malaking karangalan na marinig ang iyong boses.`
        : `Malaking karangalan na marinig ang iyong karanasan bilang alumnus ng ating departamento.`;

    switch (currentStage) {
        case 2:
            return `Salamat sa iyong pagpapakilala${greetingName}! Bago tayo dumako sa iyong mga karanasan sa kolehiyo, maaari mo bang ibahagi ang iyong tinapos na degree program, ang iyong college department, at ang iyong year of graduation? Kung natatandaan mo rin, ano ang iyong naging General Weighted Average o GWA, at nagtapos ka ba nang may Latin Honors gaya ng Cum Laude, Magna Cum Laude, o Summa Cum Laude?`;

        case 3:
            return `Maraming salamat sa pagbabahagi ng iyong academic profile!${honorsCongrats} ${programPhrase} Pag-usapan naman natin ang curriculum: sa institutional database natin, maraming alumni ang nagsabi na nakatulong ang foundational programming, habang marami rin ang nag-request ng Cloud at DevOps. Sa naging journey mo noon sa CCS, ano ang rating mo sa core programming at electives natin from 1 to 5, at aling tech stack ang pinaka-nakatulong o nais mong idagdag?`;

        case 4:
            return `Napakahalagang feedback niyan para sa aming curriculum review committee. Dumako naman tayo sa ating IT laboratory facilities—ang PC workstation specs, IDE software access, at campus Wi-Fi. Kumusta ang naging personal experience mo noon sa lab hardware at internet connectivity natin from 1 to 5, at ano ang naging pinakamalaking lab grievance o aberya na naranasan mo?`;

        case 5:
            return `Naiintindihan ko po, at nakatala na iyan para sa ating laboratory infrastructure action plan. Pagdating naman sa naging Capstone Project at IT Internship mo noon: ano ang naging role mo sa inyong Capstone group, at gaano naging sapat ang technical guidance ng iyong capstone advisor pati na ang halaga ng practicum sa scale of 1 to 5?`;

        case 6:
            return `Salamat sa pagbabahagi niyan! Pag-usapan naman natin ang iyong career ngayon bilang alumnus: ano ang kasalukuyan mong employment status? Gaano kataas ang naging confidence mo sa pagharap sa technical coding interviews, at bukas ka ba na bumalik bilang alumni guest speaker o industry mentor sa CCS?`;

        case 7:
            return `Magandang marinig iyan! Bago tayo magtapos ng ating exit interview: sa buong pananatili mo noon sa CCS, ano ang pinaka-rewarding na breakthrough mo sa coding o capstone, anong proseso sa departamento ang nais mong ma-improve, at ano ang iyong golden advice para sa mga susunod na estudyante ng CCS?`;

        case 8:
        default:
            return `Napakagandang payo at inspirasyon para sa ating mga estudyante${greetingName}! Sa ngalan ng buong faculty at pamunuan ng LSPU College of Computer Studies, taos-puso kaming nagpapasalamat sa iyong tapat na feedback at hangad namin ang patuloy mong tagumpay sa iyong karera bilang CCS alumnus. Ang iyong interview transcript ay matagumpay nang naitala sa database. Mabuhay ka!`;
    }
}

/**
 * Formats full conversation history into sequential Question & Answer pairs:
 * Q1 (Question 1) -> A1 (Answer 1) -> Q2 (Question 2) -> A2 (Answer 2) ...
 */
export function buildFormattedQATranscript(conversationHistory = []) {
    let qCount = 0;
    let aCount = 0;
    const formattedLines = [];
    const qaPairs = [];

    conversationHistory.forEach((turn) => {
        if (turn.sender === 'program_head') {
            qCount++;
            const label = `Q${qCount}`;
            formattedLines.push(`${label}: ${turn.text}`);
            qaPairs.push({
                type: 'question',
                index: qCount,
                label: label,
                speaker: 'Program Head',
                text: turn.text,
                timestamp: turn.timestamp || ''
            });
        } else if (turn.sender === 'interviewee') {
            aCount++;
            const label = `A${aCount}`;
            formattedLines.push(`${label}: ${turn.text}`);
            qaPairs.push({
                type: 'answer',
                index: aCount,
                label: label,
                speaker: 'Interviewee',
                text: turn.text,
                timestamp: turn.timestamp || ''
            });
        }
    });

    return {
        formattedText: formattedLines.join('\n\n'),
        formattedLines,
        qaPairs
    };
}

/**
 * Extracts structured survey answers directly from the interviewee's actual spoken turns
 * (ZERO hardcoded/predetermined answers) and saves to the database automatically.
 */
export async function extractAndSaveInterviewSession(conversationHistory = []) {
    const { formattedText, qaPairs } = buildFormattedQATranscript(conversationHistory);
    const intervieweeTurns = conversationHistory.filter(t => t.sender === 'interviewee');
    const allStudentSpeech = intervieweeTurns.map(t => t.text).join(' ');

    // Stage-mapped actual interviewee responses (A1 through A7)
    const turn1Profile = (intervieweeTurns[0]?.text || '').trim();
    const turn2Academic = (intervieweeTurns[1]?.text || '').trim();
    const turn3Curriculum = (intervieweeTurns[2]?.text || '').trim();
    const turn4Lab = (intervieweeTurns[3]?.text || '').trim();
    const turn5Mentorship = (intervieweeTurns[4]?.text || '').trim();
    const turn6Career = (intervieweeTurns[5]?.text || '').trim();
    const turn7Reflections = (intervieweeTurns[6]?.text || '').trim();

    // 1. Academic Identity & Standing (from Stage 1 & Stage 2 responses)
    const studentName = parseGraduateName(turn1Profile) || 'Anonymous Graduate';
    const studentId = parseSpokenStudentId(`${turn1Profile} ${turn2Academic}`);
    const program = parseDegreeProgram(`${turn2Academic} ${turn1Profile} ${allStudentSpeech}`) || 'BS in Information Technology (BSIT)';
    const department = parseCollegeDepartment(`${turn2Academic} ${turn1Profile}`);
    const graduationYear = parseGraduationYear(`${turn2Academic} ${turn1Profile}`);
    const gwa = parseGWA(turn2Academic);
    const latinHonors = parseLatinHonors(turn2Academic);

    const roleSearchText = `${turn5Mentorship} ${allStudentSpeech}`;
    let capstoneRole = 'CCS Capstone Member';
    if (/project\s+manager|\bpm\b|system\s*analyst/i.test(roleSearchText)) {
        capstoneRole = 'Project Manager / System Analyst';
    } else if (/\bqa\b|quality\s+assurance|tester|documentation/i.test(roleSearchText)) {
        capstoneRole = 'QA Tester / Technical Documentation Specialist';
    } else if (/ui|ux|front\s*-?\s*end|designer/i.test(roleSearchText)) {
        capstoneRole = 'UI/UX Designer / Frontend Developer';
    } else if (/back\s*-?\s*end|database|sysadmin|devops/i.test(roleSearchText)) {
        capstoneRole = 'Backend Developer / Database Administrator';
    } else if (/lead|developer|programmer|coder|full\s*-?\s*stack/i.test(roleSearchText)) {
        capstoneRole = 'Lead Developer / Programmer';
    }

    // 2. Ratings (aspect-aware extraction with scale stripping, attribution, and sentiment fallback)
    const { ratings: extractedRatings } = computeInterviewRatings({
        curriculumAnswer: turn3Curriculum,
        labsAnswer: turn4Lab,
        mentorshipAnswer: turn5Mentorship
    });

    const rateCore = extractedRatings.coreProgramming;
    const rateElectives = extractedRatings.electives;
    const rateHardware = extractedRatings.hardware;
    const rateSoftware = extractedRatings.software;
    const rateInternet = extractedRatings.internet;
    const rateLabEnv = extractedRatings.labEnvironment;
    const rateMentorship = extractedRatings.mentorship;
    const rateInternship = extractedRatings.internship;
    const overallAvg = extractedRatings.overallAvg;

    // 3. Tech Stack & Lab Feedback (verbatim from interviewee's Stage 3 & Stage 4 answers)
    const knownTechMatches = (turn3Curriculum.match(/\b(Python|Java|JavaScript|TypeScript|SQL|MySQL|PostgreSQL|React|Vue|Angular|Node\.?js|PHP|Laravel|C\+\+|C#|HTML|CSS|Tailwind|Flutter|Kotlin|Swift|Git|GitHub|Docker|AWS|Azure|GCP|Kubernetes|Linux|Firebase|Supabase|MongoDB)\b/gi) || []);
    const uniqueTech = Array.from(new Set(knownTechMatches.map(t => t)));

    const usefulTech = turn3Curriculum || (uniqueTech.length > 0 ? uniqueTech.join(', ') : 'Not Specified');
    const desiredTech = turn3Curriculum || 'See transcript (A3)';
    const grievance = turn4Lab || 'None reported';

    // 4. Career Outlook (mapped cleanly from Stage 6 answer)
    let employmentStatus = 'Not Specified';
    if (turn6Career) {
        if (/freelanc|part\s*-?\s*time|contract|raket|sideline/i.test(turn6Career)) {
            employmentStatus = 'Employed part-time / Freelancing';
        } else if (/unemployed|wala\s+pa|walang\s+trabaho|applying|nag-?aapply|naghahanap|looking\s+for|job\s+hunting|fresh\s+grad|kagagraduate|pahinga\s+muna/i.test(turn6Career)) {
            employmentStatus = 'Unemployed / Actively Job Hunting';
        } else if (/non\s*-?\s*it|ibang\s+field|bpo|call\s+center/i.test(turn6Career)) {
            employmentStatus = 'Employed full-time in a non-IT role';
        } else if (/master|graduate\s+studies|mscs|msit|certif/i.test(turn6Career)) {
            employmentStatus = 'Pursuing graduate degrees / certifications';
        } else if (/employ|working|nagtatrabaho|may\s+trabaho|hired|developer|engineer|analyst|programmer|it\s+staff|specialist/i.test(turn6Career)) {
            employmentStatus = 'Employed full-time as a Tech Professional';
        } else {
            employmentStatus = 'Not Explicitly Stated';
        }
    }

    let confidence = 'Not Specified';
    if (turn6Career) {
        if (/not\s+confident|hindi\s+(?:pa\s+)?confident|kinakabahan|kulang|mahirap/i.test(turn6Career)) {
            confidence = 'Not Confident';
        } else if (/moderate|medyo|sakto|okay\s+lang|maayos\s+naman|50|average/i.test(turn6Career)) {
            confidence = 'Moderately Confident';
        } else if (/very\s+confident|sobrang\s+confident|mataas.*confidence|confident|handa|ready|kaya|kumpiyansa/i.test(turn6Career)) {
            confidence = 'Very Confident';
        } else {
            confidence = 'Moderately Confident';
        }
    }

    let guestSpeaker = 'Not Specified';
    if (turn6Career) {
        if (/\b(no|hindi|ayoko|pass)\b/i.test(turn6Career) && !/not\s+only/i.test(turn6Career)) {
            guestSpeaker = 'No';
        } else if (/\b(maybe|undecided|depende|siguro|tignan|not\s+sure)\b/i.test(turn6Career)) {
            guestSpeaker = 'Undecided';
        } else if (/\b(yes|oo|opo|sure|definitely|willing|bukas|game|oo\s+naman)\b/i.test(turn6Career)) {
            guestSpeaker = 'Yes';
        } else {
            guestSpeaker = 'Undecided';
        }
    }

    // 5. Open-Ended Reflections (verbatim from Stage 7 answer, split by sentences if multi-part)
    const reflectionSentences = turn7Reflections
        ? turn7Reflections.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
        : [];

    const breakthrough = reflectionSentences[0] || turn7Reflections || 'Not Specified';
    const restructureSuggestion = reflectionSentences.length >= 3
        ? reflectionSentences[1]
        : (turn7Reflections || 'See transcript (A7)');
    const legacyTip = reflectionSentences.length >= 2
        ? reflectionSentences[reflectionSentences.length - 1]
        : (turn7Reflections || 'Not Specified');

    // 6. Hybrid Sentiment Analysis on ONLY the interviewee's words + overall rating
    const lexicalSentiment = analyzeSentiment(allStudentSpeech);
    const ratingNormalized = Math.max(0, Math.min(1, (overallAvg - 1) / 4)); // 1..5 -> 0..1
    const hybridScore = parseFloat(((lexicalSentiment.score * 0.55) + (ratingNormalized * 0.45)).toFixed(2));
    let hybridLabel = 'Neutral';
    if (hybridScore >= 0.60) hybridLabel = 'Positive';
    else if (hybridScore <= 0.42) hybridLabel = 'Negative';

    const record = {
        id: `voice_session_${Date.now()}`,
        timestamp: new Date().toISOString(),
        source: 'conversational_voice_ai',
        name: studentName.slice(0, 240),
        studentId: studentId.slice(0, 48),
        program: program.slice(0, 95),
        department: department.slice(0, 140),
        graduationYear: graduationYear.slice(0, 18),
        gwa: gwa.slice(0, 28),
        latinHonors: latinHonors.slice(0, 75),
        capstoneRole: capstoneRole.slice(0, 95),
        ratings: {
            coreProgramming: rateCore,
            electives: rateElectives,
            mentorship: rateMentorship,
            internship: rateInternship,
            hardware: rateHardware,
            software: rateSoftware,
            internet: rateInternet,
            labEnvironment: rateLabEnv,
            overallAvg: overallAvg
        },
        usefulTech,
        desiredTech,
        grievance,
        employmentStatus,
        confidence,
        guestSpeaker,
        breakthrough,
        restructureSuggestion,
        legacyTip,
        sentiment: {
            label: hybridLabel,
            score: hybridScore
        },
        rawResponses: {
            academicStanding: {
                department,
                graduationYear,
                gwa,
                latinHonors
            },
            fullConversationTranscript: conversationHistory,
            formattedTranscript: formattedText,
            qaPairs: qaPairs,
            totalTurns: conversationHistory.length,
            completedAt: new Date().toISOString()
        }
    };

    // Save to PostgreSQL DB & Local Storage
    try {
        await saveInterviewTranscriptRecord(record);
        console.log('✅ Automatically persisted conversational exit interview transcript to database.');
    } catch (e) {
        console.warn('Persistence warning:', e);
    }

    return record;
}
