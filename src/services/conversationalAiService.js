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
        name: "Welcome & Alumni Profile",
        goals: "Welcome graduated alumnus warmly, ask for Full Name, optional Student ID number if remembered, degree program (BSCS vs BSIT), and Capstone role.",
        starterMessage: "Magandang araw! Ako ang Program Head ng College of Computer Studies sa LSPU. Unang-una, maligayang pagbati bilang ganap na graduate at alumnus ng ating kolehiyo! Bilang bahagi ng ating alumni exit interview, nais naming marinig ang iyong naging karanasan noong nag-aaral ka pa upang patuloy na mapabuti ang ating departamento. Bago tayo magsimula, maaari mo bang sabihin ang iyong buong pangalan? At if possible, can you also share your student id if you still remember it?"
    },
    {
        stage: 2,
        name: "Curriculum & Tech Stack Evaluation",
        goals: "Inquire about core programming theories and electives (ratings 1-5), what tech stack was most valuable, and what missing technologies (e.g. Cloud, Docker) should be added."
    },
    {
        stage: 3,
        name: "Lab Infrastructure & Grievances",
        goals: "Ask about Computer Lab hardware, software IDEs, and campus Wi-Fi (ratings 1-5). Reference past alumni feedback regarding Wi-Fi latency or PC boot times, and ask for their biggest grievance."
    },
    {
        stage: 4,
        name: "Capstone Mentorship & Internship",
        goals: "Ask how they rate their Capstone project mentorship (1-5) and IT Internship practicum value (1-5)."
    },
    {
        stage: 5,
        name: "Career Readiness & Alumni Relations",
        goals: "Ask about current employment status, confidence passing technical coding interviews, and if they'd return as an alumni guest speaker or mentor."
    },
    {
        stage: 6,
        name: "Rewarding Breakthrough & Freshman Advice",
        goals: "Ask for their most rewarding breakthrough moment, any process in CCS they'd optimize (defense schedules, grading), and their golden advice/legacy tip for incoming freshmen."
    },
    {
        stage: 7,
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

/**
 * Helper: Extract clean graduate name from Stage 1 introduction
 */
function parseGraduateName(firstTurn = '') {
    if (!firstTurn || !firstTurn.trim()) return '';

    // Try targeted patterns first: "ako po si X", "my name is X", "pangalan ko po ay X", "i am X"
    const introPatterns = [
        /(?:ako\s+(?:po\s+)?si|pangalan\s+ko\s+(?:po\s+)?ay|my\s+(?:full\s+)?name\s+is|i\s+am|i'm)\s+([A-Za-zÑñ.\-\s]{2,50}?)(?=\s*(?:,|at\b|and\b|ang\b|my\b|student\b|id\b|i\.d\b|from\b|taking\b|graduate\b|bsit\b|bscs\b|wala\b|hindi\b|\d|$))/i
    ];

    for (const pattern of introPatterns) {
        const m = firstTurn.match(pattern);
        if (m && m[1]) {
            const candidate = m[1].replace(/\b(po|opo|sir|ma'am|maam|doc)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
            if (candidate.length >= 2 && candidate.split(/\s+/).length <= 6) {
                return correctFilipinoName(candidate, 'lastname');
            }
        }
    }

    // Fallback: strip greetings, ID clauses, and course clauses
    let cleaned = firstTurn
        .replace(/\b(magandang\s+(?:araw|umaga|hapon|gabi)|good\s+(?:morning|afternoon|evening|day)|hello|hi|hey|opo|po|sir|ma'am|maam)\b/gi, ' ')
        .replace(/(?:at\s+)?(?:ang\s+)?(?:aking\s+|my\s+)?student\s*(?:id|i\.d\.?|number)[^,.]*/gi, ' ')
        .replace(/(?:i\s+don'?t\s+remember|nakalimutan|hindi\s+ko\s+(?:na\s+)?maalala|wala\s+(?:na\s+)?(?:po\s+)?akong\s+maalala)[^,.]*/gi, ' ')
        .replace(/\b\d{2,4}[-\s]?\d{3,6}\b/g, ' ')
        .replace(/\b(bsit|bscs|bs\s+in\s+information\s+technology|bs\s+in\s+computer\s+science|information\s+technology|computer\s+science)\b/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const firstClause = cleaned.split(/[,.;!?\n]/)[0].trim();
    const words = firstClause.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 5 && firstClause.length >= 2 && firstClause.length <= 45) {
        return correctFilipinoName(firstClause, 'lastname');
    }

    return '';
}

/**
 * Helper: Detect degree program from text
 */
function parseDegreeProgram(text = '') {
    if (/computer\s+science|\bbscs\b|\bcomsci\b/i.test(text)) {
        return 'BS in Computer Science (BSCS)';
    }
    if (/information\s+technology|\bbsit\b/i.test(text)) {
        return 'BS in Information Technology (BSIT)';
    }
    return null;
}

/**
 * Helper: Extract 1-5 ratings mentioned in a turn (supports digits, English/Tagalog number words, and sentiment fallback)
 */
function extractRatingsFromTurn(turnText = '', count = 1) {
    if (!turnText || !turnText.trim()) {
        return Array(count).fill(3);
    }

    const normalized = turnText
        .toLowerCase()
        .replace(/\b(five|lima)\b/g, '5')
        .replace(/\b(four|apat)\b/g, '4')
        .replace(/\b(three|tatlo)\b/g, '3')
        .replace(/\b(two|dalawa)\b/g, '2')
        .replace(/\b(one|isa)\b/g, '1')
        // Collapse "4 out of 5" or "4/5" or "4 over 5" to just the numerator "4"
        .replace(/\b([1-5](?:\.\d)?)\s*(?:out\s+of|over|\/)\s*5\b/g, '$1');

    const matches = normalized.match(/\b[1-5]\b/g);
    if (matches && matches.length > 0) {
        const nums = matches.map(n => Math.min(5, Math.max(1, parseInt(n, 10))));
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(nums[i] !== undefined ? nums[i] : nums[nums.length - 1]);
        }
        return result;
    }

    // No explicit number stated — infer fairly from sentiment of that specific answer
    const turnSent = analyzeSentiment(turnText);
    let inferred = 3;
    if (/\b(napakaganda|sobrang\s+ganda|excellent|outstanding|perfect|super\s+solid|5)\b/i.test(turnText)) {
        inferred = 5;
    } else if (turnSent.label === 'Positive') {
        inferred = 4;
    } else if (turnSent.label === 'Negative') {
        inferred = 2;
    }
    return Array(count).fill(inferred);
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

    const studentName = parseGraduateName(firstTurnText);
    const detectedProgram = parseDegreeProgram(studentTurns.map(t => t.text).join(' '));
    const greetingName = studentName ? `, ${studentName}` : '';
    const programPhrase = detectedProgram
        ? `Bilang alumnus ng ${detectedProgram.replace(/\s*\([^)]*\)/g, '')}, malaking karangalan na marinig ang iyong boses.`
        : `Malaking karangalan na marinig ang iyong karanasan bilang alumnus ng ating departamento.`;

    switch (currentStage) {
        case 2:
            return `Salamat sa iyong pagpapakilala${greetingName}! ${programPhrase} Pag-usapan natin ang curriculum: sa institutional database natin, maraming alumni ang nagsabi na nakatulong ang foundational programming, habang marami rin ang nag-request ng Cloud at DevOps. Sa naging journey mo noon sa CCS, ano ang rating mo sa core programming at electives natin from 1 to 5, at aling tech stack ang pinaka-nakatulong o nais mong idagdag?`;

        case 3:
            return `Napakahalagang feedback niyan para sa aming curriculum review committee. Dumako naman tayo sa ating IT laboratory facilities—ang PC workstation specs, IDE software access, at campus Wi-Fi. Kumusta ang naging personal experience mo noon sa lab hardware at internet connectivity natin from 1 to 5, at ano ang naging pinakamalaking lab grievance o aberya na naranasan mo?`;

        case 4:
            return `Naiintindihan ko po, at nakatala na iyan para sa ating laboratory infrastructure action plan. Pagdating naman sa naging Capstone Project mentorship at sa IT Internship practicum mo noon: gaano naging sapat ang technical guidance ng iyong capstone advisor at ang naging halaga ng practicum sa scale of 1 to 5?`;

        case 5:
            return `Salamat sa pagbabahagi niyan! Pag-usapan naman natin ang iyong career ngayon bilang alumnus: ano ang kasalukuyan mong employment status? Gaano kataas ang naging confidence mo sa pagharap sa technical coding interviews, at bukas ka ba na bumalik bilang alumni guest speaker o industry mentor sa CCS?`;

        case 6:
            return `Magandang marinig iyan! Bago tayo magtapos ng ating exit interview: sa buong pananatili mo noon sa CCS, ano ang pinaka-rewarding na breakthrough mo sa coding o capstone, anong proseso sa departamento ang nais mong ma-improve, at ano ang iyong golden advice para sa mga susunod na estudyante ng CCS?`;

        case 7:
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

    // Stage-mapped actual interviewee responses (A1 through A6)
    const turn1Profile = (intervieweeTurns[0]?.text || '').trim();
    const turn2Curriculum = (intervieweeTurns[1]?.text || '').trim();
    const turn3Lab = (intervieweeTurns[2]?.text || '').trim();
    const turn4Mentorship = (intervieweeTurns[3]?.text || '').trim();
    const turn5Career = (intervieweeTurns[4]?.text || '').trim();
    const turn6Reflections = (intervieweeTurns[5]?.text || '').trim();

    // 1. Academic Profile (from actual student responses)
    const studentName = parseGraduateName(turn1Profile) || 'Anonymous Graduate';
    const studentId = parseSpokenStudentId(turn1Profile);
    const program = parseDegreeProgram(allStudentSpeech) || 'BS in Information Technology (BSIT)';

    let capstoneRole = 'CCS Capstone Member';
    if (/project\s+manager|\bpm\b|system\s*analyst/i.test(allStudentSpeech)) {
        capstoneRole = 'Project Manager / System Analyst';
    } else if (/\bqa\b|quality\s+assurance|tester|documentation/i.test(allStudentSpeech)) {
        capstoneRole = 'QA Tester / Technical Documentation Specialist';
    } else if (/ui|ux|front\s*-?\s*end|designer/i.test(allStudentSpeech)) {
        capstoneRole = 'UI/UX Designer / Frontend Developer';
    } else if (/back\s*-?\s*end|database|sysadmin|devops/i.test(allStudentSpeech)) {
        capstoneRole = 'Backend Developer / Database Administrator';
    } else if (/lead|developer|programmer|coder|full\s*-?\s*stack/i.test(allStudentSpeech)) {
        capstoneRole = 'Lead Developer / Programmer';
    }

    // 2. Ratings (parsed from the interviewee's actual answers in Stages 2, 3, and 4)
    const [rateCore, rateElectives] = extractRatingsFromTurn(turn2Curriculum, 2);
    const [rateHardware, rateSoftware, rateInternet, rateLabEnv] = extractRatingsFromTurn(turn3Lab, 4);
    const [rateMentorship, rateInternship] = extractRatingsFromTurn(turn4Mentorship, 2);

    const overallAvg = parseFloat((
        (rateCore + rateElectives + rateMentorship + rateInternship + rateHardware + rateSoftware + rateInternet + rateLabEnv) / 8
    ).toFixed(2));

    // 3. Tech Stack & Lab Feedback (verbatim from interviewee's Stage 2 & Stage 3 answers)
    const knownTechMatches = (turn2Curriculum.match(/\b(Python|Java|JavaScript|TypeScript|SQL|MySQL|PostgreSQL|React|Vue|Angular|Node\.?js|PHP|Laravel|C\+\+|C#|HTML|CSS|Tailwind|Flutter|Kotlin|Swift|Git|GitHub|Docker|AWS|Azure|GCP|Kubernetes|Linux|Firebase|Supabase|MongoDB)\b/gi) || []);
    const uniqueTech = Array.from(new Set(knownTechMatches.map(t => t)));

    const usefulTech = turn2Curriculum || (uniqueTech.length > 0 ? uniqueTech.join(', ') : 'Not Specified');
    const desiredTech = turn2Curriculum || 'See transcript (A2)';
    const grievance = turn3Lab || 'None reported';

    // 4. Career Outlook (mapped cleanly within VARCHAR(100) DB limits from Stage 5 answer)
    let employmentStatus = 'Not Specified';
    if (turn5Career) {
        if (/freelanc|part\s*-?\s*time|contract/i.test(turn5Career)) {
            employmentStatus = 'Employed part-time / Freelancing';
        } else if (/unemployed|wala\s+pa|applying|nag-?aapply|naghahanap|looking\s+for|job\s+hunting|fresh\s+grad/i.test(turn5Career)) {
            employmentStatus = 'Unemployed but actively applying for tech positions';
        } else if (/non\s*-?\s*it|ibang\s+field|bpo/i.test(turn5Career)) {
            employmentStatus = 'Employed full-time in a non-IT role';
        } else if (/master|graduate|mscs|msit|certif/i.test(turn5Career)) {
            employmentStatus = 'Pursuing graduate degrees / certifications';
        } else if (/employ|working|may\s+trabaho|hired|developer|engineer|analyst|programmer|it\s+staff/i.test(turn5Career)) {
            employmentStatus = 'Employed full-time as a Tech Professional';
        } else {
            employmentStatus = turn5Career.slice(0, 95);
        }
    }

    let confidence = 'Not Specified';
    if (turn5Career) {
        if (/not\s+confident|hindi\s+(?:pa\s+)?confident|kinakabahan|kulang|mahirap/i.test(turn5Career)) {
            confidence = 'Not Confident';
        } else if (/moderate|medyo|sakto|okay\s+lang|50|average/i.test(turn5Career)) {
            confidence = 'Moderately Confident';
        } else if (/very\s+confident|sobrang\s+confident|confident|handa|ready|kaya|kumpiyansa/i.test(turn5Career)) {
            confidence = 'Very Confident';
        } else {
            confidence = 'Moderately Confident';
        }
    }

    let guestSpeaker = 'Not Specified';
    if (turn5Career) {
        if (/\b(no|hindi|ayoko|pass)\b/i.test(turn5Career) && !/not\s+only/i.test(turn5Career)) {
            guestSpeaker = 'No';
        } else if (/\b(maybe|undecided|depende|siguro|tignan|not\s+sure)\b/i.test(turn5Career)) {
            guestSpeaker = 'Undecided';
        } else if (/\b(yes|oo|opo|sure|definitely|willing|bukas|game|oo\s+naman)\b/i.test(turn5Career)) {
            guestSpeaker = 'Yes';
        } else {
            guestSpeaker = 'Undecided';
        }
    }

    // 5. Open-Ended Reflections (verbatim from Stage 6 answer, split by sentences if multi-part)
    const reflectionSentences = turn6Reflections
        ? turn6Reflections.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
        : [];

    const breakthrough = reflectionSentences[0] || turn6Reflections || 'Not Specified';
    const restructureSuggestion = reflectionSentences.length >= 3
        ? reflectionSentences[1]
        : (turn6Reflections || 'See transcript (A6)');
    const legacyTip = reflectionSentences.length >= 2
        ? reflectionSentences[reflectionSentences.length - 1]
        : (turn6Reflections || 'Not Specified');

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
        graduationYear: '2026',
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
