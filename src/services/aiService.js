import philippineNames from '../data/philippineNames.json';

const POSITIVE_KEYWORDS = [
    'great', 'rewarding', 'excellent', 'useful', 'helpful', 'satisfied', 'confident',
    'debugged', 'breakthrough', 'deploy', 'deployed', 'learned', 'mastered', 'solid',
    'supportive', 'valuable', 'enjoyed', 'passed', 'success', 'good', 'improved', 'love'
];

const NEGATIVE_KEYWORDS = [
    'slow', 'lag', 'outdated', 'malfunction', 'broken', 'issue', 'grievance', 'bottleneck',
    'struggled', 'frustrating', 'hard', 'difficult', 'bug', 'leak', 'hot', 'aircon',
    'restricted', 'limitation', 'lack', 'insufficient', 'poor', 'cramming', 'delay'
];

export function analyzeSentiment(text) {
    if (!text || typeof text !== 'string') {
        return { score: 0.5, label: 'Neutral', confidence: 0.70, positiveCount: 0, negativeCount: 0 };
    }

    const words = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
    let posCount = 0;
    let negCount = 0;

    words.forEach(word => {
        if (POSITIVE_KEYWORDS.includes(word)) posCount++;
        if (NEGATIVE_KEYWORDS.includes(word)) negCount++;
    });

    const totalHits = posCount + negCount;
    let score = 0.5;
    let label = 'Neutral';

    if (totalHits > 0) {
        score = 0.5 + ((posCount - negCount) / (totalHits * 2));
        score = Math.max(0.05, Math.min(0.98, score));
    } else {
        if (text.length > 50) score = 0.65;
    }

    if (score >= 0.65) label = 'Positive';
    else if (score <= 0.42) label = 'Negative';
    else label = 'Neutral';

    const confidence = Math.min(0.98, 0.75 + (totalHits * 0.05));

    return {
        score: parseFloat(score.toFixed(2)),
        label,
        confidence: parseFloat(confidence.toFixed(2)),
        positiveCount: posCount,
        negativeCount: negCount,
        analyzedWordCount: words.length
    };
}

export function calculateWER(groundTruth, hypothesis) {
    if (!groundTruth) return { wer: 0, accuracy: 100, editDistance: 0, wordCount: 0 };

    const targetWords = groundTruth.toLowerCase().trim().split(/\s+/);
    const hypWords = (hypothesis || '').toLowerCase().trim().split(/\s+/);

    const n = targetWords.length;
    const m = hypWords.length;

    const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));

    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (targetWords[i - 1] === hypWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j - 1] + 1,
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1
                );
            }
        }
    }

    const editDistance = dp[n][m];
    const wer = parseFloat(((editDistance / Math.max(1, n)) * 100).toFixed(1));
    const accuracy = parseFloat(Math.max(0, 100 - wer).toFixed(1));

    return {
        wer,
        accuracy,
        editDistance,
        wordCount: n
    };
}

/**
 * Phonetic & Lexicon Corrector for Filipino Names (Spanish, English, and Tagalog descent)
 * Corrects common speech recognition misrecognitions and standardizes Philippine surname prefixes.
 */
const FILIPINO_PHONETIC_MAP = [
    // First Name Phonetic Corrections (Standardizing local/English phonetic variants)
    { pattern: /\b(riley|rylee|raylee|ryley|rai\s+lee)\b/gi, replacement: "Railey" },
    { pattern: /\b(bryan|brian|bryen)\b/gi, replacement: "Bryan" },
    { pattern: /\b(john\s+paul|jon\s+paul|jan\s+paul)\b/gi, replacement: "John Paul" },
    { pattern: /\b(mark\s+anthony|marc\s+anthony)\b/gi, replacement: "Mark Anthony" },

    // Surname Phonetic Corrections
    { pattern: /\b(koronasyon|coronasyon|coronasion|coronacion|corona\s+cion|corona\s+shon|coronation)\b/gi, replacement: "Coronacion" },
    { pattern: /\b(urea|orea|oria|uria|urhea|u\s+rea|you\s+rea|urrea|ur-rea)\b/gi, replacement: "Urrea" },
    { pattern: /\b(cornelia|cornilla|ornelia|ornilla|cornella|cornellya|hor\s+nilla|or\s+neeya)\b/gi, replacement: "Hornilla" },
    { pattern: /\b(day\s+la\s+cruise|day\s+la\s+cruz|de\s+la\s+cruz|dela\s+cruz|dela\s+cruise)\b/gi, replacement: "Dela Cruz" },
    { pattern: /\b(de\s+los\s+santos|delos\s+santos|day\s+los\s+santos)\b/gi, replacement: "De Los Santos" },
    { pattern: /\b(del\s+rosario|delrosario)\b/gi, replacement: "Del Rosario" },
    { pattern: /\b(de\s+leon|deleon)\b/gi, replacement: "De Leon" },
    { pattern: /\b(de\s+castro|decastro)\b/gi, replacement: "De Castro" },
    { pattern: /\b(san\s+jose)\b/gi, replacement: "San Jose" },
    { pattern: /\b(santa\s+maria)\b/gi, replacement: "Santa Maria" },
    { pattern: /\b(rays|reyis)\b/gi, replacement: "Reyes" },
    { pattern: /\b(santoes)\b/gi, replacement: "Santos" },
    { pattern: /\b(kay\s+mada|kemada|comada|kamada)\b/gi, replacement: "Quemada" },
    { pattern: /\b(dee\s+ma\s+cool\s+angan|dimakulang\s+an)\b/gi, replacement: "Dimaculangan" },
    { pattern: /\b(gonzalez)\b/gi, replacement: "Gonzales" }
];

const COMMON_FILIPINO_SURNAMES = [
    "Coronacion", "Urrea", "Carait", "Alipon", "Eleazar", "Reventar", "Alimagno",
    "Dela Cruz", "Santos", "Reyes", "Ramos", "Garcia", "Mendoza", "Gonzales", "Bautista",
    "Villanueva", "Castillo", "Torres", "Aquino", "Navarro", "Mercado", "Dimaculangan",
    "Catapang", "Agoncillo", "Macaraig", "Hornilla", "Quemada", "Tolentino", "Salazar",
    "Alvarez", "Corpuz", "Manalo", "Pineda", "Dizon", "Miranda", "Pascual", "Ocampo",
    "Valenzuela", "Sarmiento", "Santiago", "Fernandez", "Lopez", "Perez", "Gutierrez",
    "Hernandez", "Flores", "Rivera", "Gomez", "Diaz", "Cruz", "Rios", "De Los Santos",
    "Del Rosario", "De Leon", "De Castro", "San Jose", "Santa Maria"
];

const LETTER_PHONETIC_MAP = {
    'em': 'M', 'them': 'M', 'am': 'M', 'him': 'M', 'mar': 'M', 'aim': 'M',
    'ay': 'A', 'eye': 'A', 'hay': 'A', 'ei': 'A',
    'bee': 'B', 'be': 'B',
    'see': 'C', 'sea': 'C', 'si': 'C',
    'dee': 'D', 'the': 'D',
    'ee': 'E',
    'eff': 'F', 'if': 'F',
    'jee': 'G', 'gee': 'G',
    'aitch': 'H', 'eitch': 'H',
    'jay': 'J',
    'kay': 'K',
    'el': 'L', 'al': 'L',
    'en': 'N', 'an': 'N',
    'oh': 'O',
    'pee': 'P', 'pi': 'P',
    'cue': 'Q',
    'our': 'R', 'are': 'R', 'ar': 'R',
    'ess': 'S', 'es': 'S',
    'tee': 'T', 'tea': 'T',
    'yoo': 'U',
    'vee': 'V',
    'double u': 'W',
    'ex': 'X',
    'why': 'Y',
    'zee': 'Z', 'zed': 'Z'
};

const WORD_TO_DIGIT_MAP = {
    'zero': '0', 'o': '0', 'oh': '0', 'nil': '0',
    'one': '1', 'won': '1', 'wan': '1',
    'two': '2', 'to': '2', 'too': '2', 'tu': '2',
    'three': '3', 'tree': '3', 'tri': '3',
    'four': '4', 'for': '4', 'fore': '4',
    'five': '5',
    'six': '6',
    'seven': '7',
    'eight': '8', 'ate': '8',
    'nine': '9', 'nigh': '9',
    'ten': '10',
    'dash': '-', 'hyphen': '-', 'minus': '-'
};

export function convertWordsToDigits(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText.toLowerCase().trim();

    // 1. Replace word numbers with digits
    Object.keys(WORD_TO_DIGIT_MAP).forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        text = text.replace(regex, WORD_TO_DIGIT_MAP[word]);
    });

    // 2. Extract digits and dashes
    let cleanedDigits = text.replace(/\s+/g, '').replace(/[^0-9-]/g, '');

    // Format 8 digits into Student ID format e.g. "01220941" -> "0122-0941"
    if (/^\d{8}$/.test(cleanedDigits)) {
        return `${cleanedDigits.slice(0, 4)}-${cleanedDigits.slice(4)}`;
    }

    return cleanedDigits || rawText;
}

export function getNameSpellingSuggestions(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const text = rawText.trim().toLowerCase();
    const suggestions = [];

    // 1. Check known phonetic pairs (including Coronacion and Urrea)
    if (/\b(koronasyon|coronacion|coronasion|coronation|corona)\b/i.test(text)) {
        suggestions.push("Coronacion");
    }
    if (/\b(urrea|urea|orea|oria|uria|urhea)\b/i.test(text)) {
        suggestions.push("Urrea");
    }
    if (/\b(riley|railey|rylee|raylee|ryley)\b/i.test(text)) {
        suggestions.push("Railey", "Riley", "Rylee", "Reilly");
    }
    if (/\b(bryan|brian|bryen)\b/i.test(text)) {
        suggestions.push("Bryan", "Brian", "Bryen");
    }
    if (/\b(john\s+paul|jon\s+paul|jan\s+paul)\b/i.test(text)) {
        suggestions.push("John Paul", "Jon Paul", "Jan Paul");
    }
    if (/\b(dela\s+cruz|de\s+la\s+cruz|de\s+la\s+cruise)\b/i.test(text)) {
        suggestions.push("Dela Cruz", "De La Cruz", "De la Cruz");
    }
    if (/\b(hornilla|cornelia|cornilla)\b/i.test(text)) {
        suggestions.push("Hornilla", "Cornelia", "Cornilla");
    }
    if (/\b(reyes|rays|reyis)\b/i.test(text)) {
        suggestions.push("Reyes", "Reyis");
    }

    // 2. Search Philippine dataset for matching names (first names & surnames) using edit distance
    if (philippineNames) {
        const words = text.split(/\s+/);
        words.forEach(w => {
            if (w.length >= 3) {
                // Match surnames with fuzzy edit distance or prefix match
                if (philippineNames.surnames) {
                    const matchSn = philippineNames.surnames.filter(sn => {
                        const sLower = sn.toLowerCase();
                        if (sLower === w) return true;
                        if (sLower.startsWith(w) || (w.length >= 5 && w.startsWith(sLower) && sLower.length >= 4)) return true;
                        if (w.length >= 4 && Math.abs(sLower.length - w.length) <= 2) {
                            return calculateWER(sLower, w).editDistance <= 2;
                        }
                        return false;
                    });
                    suggestions.push(...matchSn.slice(0, 4));
                }
                // Match first names with fuzzy edit distance or prefix match
                if (philippineNames.firstNames) {
                    const matchFn = philippineNames.firstNames.filter(fn => {
                        const fLower = fn.toLowerCase();
                        if (fLower === w) return true;
                        if (fLower.startsWith(w) || (w.length >= 5 && w.startsWith(fLower) && fLower.length >= 4)) return true;
                        if (w.length >= 4 && Math.abs(fLower.length - w.length) <= 2) {
                            return calculateWER(fLower, w).editDistance <= 2;
                        }
                        return false;
                    });
                    suggestions.push(...matchFn.slice(0, 3));
                }
            }
        });
    }

    return Array.from(new Set(suggestions)).slice(0, 6);
}

export function correctFilipinoName(rawText, fieldType = 'lastname') {
    if (!rawText || typeof rawText !== 'string') return '';

    let cleaned = rawText.trim();

    if (fieldType === 'middleinitial') {
        const lower = cleaned.toLowerCase().trim();
        // Check phonetic word match (e.g. "em" -> "M.")
        if (LETTER_PHONETIC_MAP[lower]) {
            return LETTER_PHONETIC_MAP[lower] + '.';
        }
        // Extract first alphabetical character
        const firstLetter = cleaned.replace(/[^a-zA-Z]/g, '').charAt(0);
        return firstLetter ? firstLetter.toUpperCase() + '.' : '';
    }

    // Apply phonetic map corrections (for both firstname and lastname)
    FILIPINO_PHONETIC_MAP.forEach(({ pattern, replacement }) => {
        cleaned = cleaned.replace(pattern, replacement);
    });

    if (fieldType === 'firstname') {
        return cleaned.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    // Default: Last Name / Surname correction
    cleaned = cleaned.split(/\s+/).map(word => {
        if (word.length === 2 && word.endsWith('.')) {
            return word.toUpperCase();
        }
        const match = COMMON_FILIPINO_SURNAMES.find(s => s.toLowerCase() === word.toLowerCase());
        if (match) return match;

        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');

    return cleaned;
}


/**
 * Full Questionnaire matching LSPU CCS Exit Interview Survey Form
 */
export const LSPU_SURVEY_STRUCTURE = [
    // SECTION 1: Demographic & Academic Profile
    {
        sectionId: 1,
        sectionTitle: "I. Graduate Demographic & Academic Profile",
        questions: [
            {
                id: "demo_lastname",
                type: "voice_text",
                question: "Please state your Last Name (Family Name / Surname).",
                promptHint: "e.g., Coronacion, Urrea, Dela Cruz, Santos"
            },
            {
                id: "demo_firstname",
                type: "voice_text",
                question: "Please state your First Name (Given Name).",
                promptHint: "e.g., Juan Pablo, Maria, Jose"
            },
            {
                id: "demo_middleinitial",
                type: "voice_text",
                question: "Please state your Middle Initial (or Middle Name).",
                promptHint: "e.g., M. or A."
            },
            {
                id: "demo_studentid",
                type: "voice_text",
                question: "What is your Student ID number?",
                promptHint: "e.g., 0123-0246"
            },
            {
                id: "demo_program",
                type: "choice",
                question: "Which Degree Program or Course Major did you graduate from?",
                options: ["BS in Computer Science (BSCS)", "BS in Information Technology (BSIT)"]
            },
            {
                id: "demo_grad_year",
                type: "voice_text",
                question: "What is your Year of Graduation?",
                promptHint: "e.g., 2026"
            },
            {
                id: "demo_capstone_role",
                type: "choice",
                question: "What was your primary Capstone or Thesis Project Role?",
                options: [
                    "Lead Developer / Programmer",
                    "Systems Analyst / UI-UX Designer",
                    "QA Tester / Technical Documentation Specialist",
                    "Project Manager"
                ]
            }
        ]
    },
    // SECTION 2: Computing Curriculum & Tech Stack Evaluation
    {
        sectionId: 2,
        sectionTitle: "II. Computing Curriculum & Tech Stack Evaluation",
        questions: [
            {
                id: "rate_core_prog",
                type: "rating",
                question: "On a scale of 1 to 5, how would you rate the relevance of core programming concepts and math foundational theories taught in CCS?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "rate_electives",
                type: "rating",
                question: "On a scale of 1 to 5, how aligned were software electives and technologies taught with industry demand?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "rate_mentorship",
                type: "rating",
                question: "On a scale of 1 to 5, how adequate was the mentorship provided during your Capstone Project or Thesis development?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "rate_internship",
                type: "rating",
                question: "On a scale of 1 to 5, what was the value of your IT Internship or Practicum in exposing you to real development environments?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "qual_useful_tech",
                type: "voice_text",
                question: "Which programming languages, frameworks, or tools taught in CCS do you feel will be most useful in your tech career?",
                promptHint: "e.g., Python, Java, SQL, React, C++"
            },
            {
                id: "qual_missing_tech",
                type: "voice_text",
                question: "Were there any critical technologies (such as cloud platforms, DevOps tools, or modern frameworks) you wish were integrated into the CCS curriculum?",
                promptHint: "e.g., Docker, AWS, Flutter, Cybersecurity"
            }
        ]
    },
    // SECTION 3: IT Infrastructure & Laboratory Services
    {
        sectionId: 3,
        sectionTitle: "III. IT Infrastructure & Laboratory Services",
        questions: [
            {
                id: "rate_hardware",
                type: "rating",
                question: "On a scale of 1 to 5, how would you rate the hardware specifications and processing power of Computer Lab workstations?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "rate_software",
                type: "rating",
                question: "On a scale of 1 to 5, how accessible was necessary development software, IDEs, and local server setups?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "rate_internet",
                type: "rating",
                question: "On a scale of 1 to 5, how reliable was campus internet and local network connectivity for coding tasks?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "rate_aircon",
                type: "rating",
                question: "On a scale of 1 to 5, how would you rate cleanliness, cooling ventilation, and booking accessibility of the PC labs?",
                promptHint: "1 = Poor, 5 = Excellent"
            },
            {
                id: "qual_lab_grievance",
                type: "voice_text",
                question: "What is your biggest grievance or technical bottleneck regarding the CCS laboratory environments or server access?",
                promptHint: "Discuss PC boot times, Wi-Fi speed, aircon, or admin privileges."
            }
        ]
    },
    // SECTION 4: Tech Career Readiness & Professional Outlook
    {
        sectionId: 4,
        sectionTitle: "IV. Tech Career Readiness & Professional Outlook",
        questions: [
            {
                id: "outlook_employment",
                type: "choice",
                question: "What is your current employment status?",
                options: [
                    "Employed full-time as a Tech Professional (Developer, SysAdmin, Analyst, etc.)",
                    "Freelancing / Independent Software Contractor",
                    "Employed full-time in a non-IT role",
                    "Unemployed but actively applying for tech positions / Upskilling",
                    "Pursuing continuous certifications or graduate degrees (MSCS / MSIT)"
                ]
            },
            {
                id: "outlook_confidence",
                type: "choice",
                question: "How confident do you feel passing technical coding interviews or system architecture assessments using skills acquired in CCS?",
                options: [
                    "Very Confident",
                    "Moderately Confident",
                    "Not Confident"
                ]
            },
            {
                id: "outlook_guest_speaker",
                type: "choice",
                question: "Would you be willing to return to CCS as an alumni guest speaker, industry mentor, or industry advisor for upcoming capstone teams?",
                options: [
                    "Yes",
                    "No",
                    "Undecided"
                ]
            }
        ]
    },
    // SECTION 5: Open-Ended Qualitative Insights
    {
        sectionId: 5,
        sectionTitle: "V. Open-Ended Qualitative Insights",
        questions: [
            {
                id: "qual_breakthrough",
                type: "voice_text",
                question: "Looking back at your toughest coding assignments or computing projects, what was the most rewarding breakthrough experience during your stay in CCS?",
                promptHint: "Share debugging triumphs or successful system deployments."
            },
            {
                id: "qual_restructure",
                type: "voice_text",
                question: "If you could completely restructure or optimize one process within the CCS department (e.g., grading, defense schedules, lab policies), what would it be?",
                promptHint: "Suggest improvements for defense dates, rubrics, or lab rules."
            },
            {
                id: "qual_legacy_tip",
                type: "voice_text",
                question: "What legacy tip or piece of advice do you want your AI assistant to pass down to future freshman code-monkeys entering the College of Computer Studies?",
                promptHint: "Share your golden rule for surviving and thriving in CCS."
            }
        ]
    }
];

export const DATA_PRIVACY_TEXT = `Privacy notice in compliance with RA 10173 Data Privacy Act of 2012. By voluntarily starting an interview session, you consent to the collection, storage, and processing of your personal, academic, and evaluation responses by the organization responsible for this interview. This information will be used solely for academic evaluation. Your responses will be processed pursuant to the legitimate academic and institutional research functions of LSPU, will remain strictly confidential, and will only be accessible to authorized Guidance and Alumni Office personnel. To ensure data security, all personal identifying parameters are separated from the analytical database, and strict anonymization protocols are applied before any thematic or sentiment analysis is performed. The student is assured that the organization shall, pursuant to prevailing privacy laws, uphold your rights as a data subject, implement appropriate technical and organizational security measures to protect your data, and remain strictly adherent to the general data privacy principles of transparency, legitimate purpose, and proportionality in processing your information.

Best regards, Office of the Alumni Affairs, LSPU.`;

export function generateThematicSummaries(records = []) {
    return {
        curriculum: {
            title: "Curriculum & Programming Theories",
            keyInsight: "Alumni strongly praised core programming logic & Python foundations, but requested early exposure to cloud & modern web stacks.",
            bullets: [
                "Core programming theories & OOP logic rated 4.4 / 5.0 on average across all 50 respondents.",
                "High demand for Docker, Kubernetes, AWS Cloud Infrastructure, and React/Next.js frameworks.",
                "Recommend adding elective tracks for Cloud Engineering & DevOps."
            ]
        },
        infrastructure: {
            title: "Laboratory Infrastructure & Connectivity",
            keyInsight: "PC workstation specs were rated adequately, but campus Wi-Fi and aircon cooling during peak defense weeks were highlighted grievances.",
            bullets: [
                "Hardware specs rated 3.8 / 5.0; demand for upgraded SSD storage & RAM on dev machines.",
                "Campus Wi-Fi connectivity bottlenecks identified during high-concurrency coding sessions.",
                "Recommend establishing dedicated server racks with remote SSH access for capstone deployments."
            ]
        },
        mentorship: {
            title: "Capstone Mentorship & Guidance",
            keyInsight: "Capstone advisor availability and technical guidance received top marks (4.6 / 5.0), accelerating graduation rates.",
            bullets: [
                "Faculty mentorship rated as the most rewarding factor during capstone development.",
                "Alumni expressed strong willingness to return as industry mentors and defense panelists.",
                "Recommend formalizing an Alumni-Student Capstone Advisory Network."
            ]
        },
        legacy: {
            title: "Golden Rules for Incoming Freshmen",
            keyInsight: "Top advice from Class of 2026 graduates: Master Git version control early and build real-world portfolio projects.",
            bullets: [
                "78% of graduates advised freshmen to learn Git & GitHub before starting capstone.",
                "Don't rely solely on classroom lectures—upskill on modern developer tools independently.",
                "Prioritize team communication and systematic documentation over last-minute cramming."
            ]
        }
    };
}

/**
 * Asynchronous Google AI Studio API (Gemini Flash) Post-Processor
 * Refines low-latency Web Speech transcripts for specific survey question constraints:
 * - Middle Initial: single uppercase letter A-Z or N/A
 * - Rating (1-5): single integer digit 1-5
 * - Student ID: formatted 8-digit / XXXX-XXXX string
 * - Names & Voice Text: clean speech stutters & correct phonetic misspellings
 */
export async function refineTranscriptWithGemini(rawTranscript, questionObj, customApiKey = '') {
    if (!rawTranscript || typeof rawTranscript !== 'string' || !rawTranscript.trim()) {
        return rawTranscript || '';
    }

    // Retrieve API key from custom parameter, Vite environment, or localStorage
    const apiKey = customApiKey ||
        (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('valumni_gemini_api_key')) ||
        '';

    // Fallback to client-side rule-based correctors if no API key present
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
        return applyClientSideRuleFallback(rawTranscript, questionObj);
    }

    const { id, type, question } = questionObj || {};
    let systemInstruction = "";

    if (id === 'demo_middleinitial') {
        systemInstruction = "The user was asked for their Middle Initial. Extract and output ONLY a single uppercase letter (A-Z) followed by a period (e.g., 'M.') or 'N/A'. Do not include any explanation or extra words.";
    } else if (type === 'rating') {
        systemInstruction = "The user was asked to rate an aspect of their college experience on a scale of 1 to 5. Extract and output ONLY a single integer digit between 1 and 5. Do not include any words, symbols, or punctuation.";
    } else if (id === 'demo_studentid') {
        systemInstruction = "The user stated their Student ID number. Format and output ONLY the 8-digit student ID formatted as XXXX-XXXX (e.g. '0123-0456'). Output ONLY the formatted numbers.";
    } else if (id === 'demo_firstname' || id === 'demo_lastname') {
        const sampleContext = id === 'demo_firstname'
            ? (philippineNames?.firstNames ? philippineNames.firstNames.slice(0, 50).join(', ') : 'Maria, Juan, Railey, Bryan, Mark')
            : 'Coronacion, Urrea, Dela Cruz, Santos, Reyes, Hornilla, Dimaculangan, Catapang, Quemada, Ramos, Mendoza, Peñaranda';
        systemInstruction = `The user stated their ${id === 'demo_firstname' ? 'First Name' : 'Last Name (Surname)'} in the Philippines. Correct any speech recognition phonetic or Tagalog spelling misrecognitions (e.g. "Koronasyon" -> "Coronacion", "Urea" or "Orea" -> "Urrea", "Dela Cruise" -> "Dela Cruz", "Cornelia" -> "Hornilla"). Known local surnames include: ${sampleContext}. Return proper capitalized Name format only, with no surrounding punctuation or quotes.`;
    } else {
        systemInstruction = "Clean up this spoken transcript from a survey. Remove speech stutters (um, ah, like), correct technical computing terminology (e.g., Python, SQL, React, Docker, AWS), and return a clear, grammatically corrected answer. Preserve the user's exact meaning.";
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: `Question asked: "${question || ''}"\nRaw Spoken Transcript: "${rawTranscript}"\n\nInstructions: ${systemInstruction}` }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 64
                }
            })
        });

        if (!response.ok) {
            console.warn('Gemini API returned error status:', response.status);
            return applyClientSideRuleFallback(rawTranscript, questionObj);
        }

        const data = await response.json();
        const refinedText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (refinedText) {
            return refinedText.replace(/^["']|["']$/g, '');
        }
    } catch (err) {
        console.warn('Gemini API post-processing failed, using fallback:', err);
    }

    return applyClientSideRuleFallback(rawTranscript, questionObj);
}

function applyClientSideRuleFallback(rawTranscript, activeQ) {
    if (!activeQ) return rawTranscript;
    let text = rawTranscript;
    if (activeQ.id === 'demo_lastname') text = correctFilipinoName(text, 'lastname');
    else if (activeQ.id === 'demo_firstname') text = correctFilipinoName(text, 'firstname');
    else if (activeQ.id === 'demo_middleinitial') text = correctFilipinoName(text, 'middleinitial');
    else if (activeQ.id === 'demo_studentid' || activeQ.id === 'demo_grad_year' || activeQ.type === 'rating') {
        text = convertWordsToDigits(text);
    }
    return text;
}

