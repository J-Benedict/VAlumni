/**
 * Client-Side Context-Aware Transcript & Philippine Name Refiner
 *
 * Mirrors stt_service/transcript_refiner.py so both live browser interim previews,
 * offline Web Speech fallbacks, and structured survey name extractors share the exact
 * same Philippine phonetic skeleton + CCS computing vocabulary corrections.
 */

import philippineNames from '../data/philippineNames.json';

const FIRST_NAMES = philippineNames?.firstNames || [];
const SURNAMES = philippineNames?.surnames || [];

const FIRST_NAME_LOWER_MAP = new Map();
const SURNAME_LOWER_MAP = new Map();
const FIRST_PHONETIC_INDEX = new Map();
const SURNAME_PHONETIC_INDEX = new Map();

export function phPhoneticKey(word = '') {
    if (!word || typeof word !== 'string') return '';
    let s = word
        .toLowerCase()
        .trim()
        .replace(/ñ/g, 'ny')
        .replace(/[áàâ]/g, 'a')
        .replace(/[éèê]/g, 'e')
        .replace(/[íìî]/g, 'i')
        .replace(/[óòô]/g, 'o')
        .replace(/[úùû]/g, 'u')
        .replace(/[^a-z]/g, '');

    if (!s) return '';

    // Unaspirated leading 'h' before vowel (Hornilla / Ornilla)
    s = s.replace(/^h(?=[aeiou])/, '');

    // Spanish / Tagalog palatal & sibilant normalizations
    s = s.replace(/(?:cion|sion|shon|syon|chon)$/, 'syun');
    s = s.replace(/ll/g, 'ly');
    s = s.replace(/li(?=[aeiou])/g, 'ly');
    s = s.replace(/ni(?=[aeiou])/g, 'ny');
    s = s.replace(/qu(?=[ei])/g, 'k');
    s = s.replace(/gue/g, 'ge').replace(/gui/g, 'gi');
    s = s.replace(/c(?=[ei])/g, 's');
    s = s.replace(/ch/g, 'ts');
    s = s.replace(/ph/g, 'p');
    s = s.replace(/ck/g, 'k');
    s = s.replace(/[cq]/g, 'k');
    s = s.replace(/v/g, 'b');
    s = s.replace(/f/g, 'p');
    s = s.replace(/z/g, 's');
    s = s.replace(/x/g, 'ks');

    // Unstressed Philippine vowel pair merging
    s = s.replace(/e/g, 'i').replace(/o/g, 'u');
    s = s.replace(/ia$/, 'ya');
    s = s.replace(/(.)\1+/g, '$1');
    return s;
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
        }
        prev = curr;
    }
    return prev[b.length];
}

function initNameLexicon() {
    if (FIRST_NAME_LOWER_MAP.size > 0) return;

    FIRST_NAMES.forEach((fn) => {
        const clean = (fn || '').trim();
        if (!clean) return;
        FIRST_NAME_LOWER_MAP.set(clean.toLowerCase(), clean);
        if (!clean.includes(' ')) {
            const key = phPhoneticKey(clean);
            if (key) {
                if (!FIRST_PHONETIC_INDEX.has(key)) FIRST_PHONETIC_INDEX.set(key, []);
                FIRST_PHONETIC_INDEX.get(key).push(clean);
            }
        }
    });

    SURNAMES.forEach((sn) => {
        const clean = (sn || '').trim();
        if (!clean) return;
        const titled = clean
            .split(/\s+/)
            .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
            .join(' ');
        SURNAME_LOWER_MAP.set(clean.toLowerCase(), titled);
        if (!clean.includes(' ')) {
            const key = phPhoneticKey(clean);
            if (key) {
                if (!SURNAME_PHONETIC_INDEX.has(key)) SURNAME_PHONETIC_INDEX.set(key, []);
                SURNAME_PHONETIC_INDEX.get(key).push(titled);
            }
        }
    });
}

initNameLexicon();

const COMMON_NON_NAME_WORDS = new Set([
    'ako', 'ikaw', 'siya', 'kami', 'tayo', 'kayo', 'sila', 'opo', 'po', 'oo', 'hindi', 'wala',
    'aking', 'iyong', 'kanyang', 'aming', 'ating', 'inyong', 'kanilang',
    'ko', 'mo', 'niya', 'namin', 'natin', 'ninyo', 'nila',
    'yung', 'iyung', 'ito', 'iyan', 'iyon', 'dito', 'doon', 'lang', 'din', 'rin', 'naman',
    'siguro', 'parang', 'medyo', 'pwede', 'puwede', 'meron', 'mayroon', 'kaya',
    'magandang', 'umaga', 'hapon', 'gabi', 'araw', 'good', 'morning', 'afternoon', 'evening', 'day',
    'hello', 'hi', 'hey', 'sir', 'maam', 'madam', 'doc', 'dean', 'program', 'head',
    'ang', 'mga', 'ng', 'sa', 'na', 'pa', 'ay', 'at', 'si', 'ni', 'kay', 'para', 'pero', 'kasi',
    'my', 'name', 'full', 'is', 'am', 'im', 'the', 'and', 'or', 'from', 'of', 'in', 'to', 'for', 'with',
    'pangalan', 'apelyido', 'gitnang', 'middle', 'initial', 'first', 'last', 'surname', 'given',
    'student', 'id', 'number', 'num', 'code', 'maalala', 'nakalimutan', 'remember', 'forgot',
    'graduate', 'graduated', 'alumnus', 'alumni', 'batch', 'year', 'class', 'course', 'degree', 'major',
    'bsit', 'bscs', 'msit', 'mscs', 'ccs', 'lspu', 'laguna', 'state', 'polytechnic', 'university',
    'college', 'computer', 'studies', 'science', 'information', 'technology',
    'capstone', 'thesis', 'role', 'project', 'lead', 'developer', 'programmer', 'manager', 'analyst',
    'system', 'systems', 'designer', 'tester', 'documentation', 'specialist', 'frontend', 'backend',
    'salamat', 'thank', 'thanks', 'okay', 'ok', 'yes', 'no', 'none', 'skip', 'pass', 'not', 'provided'
]);

const EXPLICIT_NAME_PATTERNS = [
    { pattern: /\b(?:koronasyon|coronasyon|coronasion|corona\s+cion|corona\s+shon|coronation)\b/gi, replacement: 'Coronacion' },
    { pattern: /\b(?:urea|orea|oria|uria|urhea|u\s+rea|you\s+rea|ur-rea)\b/gi, replacement: 'Urrea' },
    { pattern: /\b(?:cornilla|ornilla|ornelia|honilla|fornilla|panilla|cornella|cornellya|hornila|ornila|hor\s*nilla|hor\s*neeya|or\s*neeya|hornilya|horniya)\b/gi, replacement: 'Hornilla' },
    { pattern: /\b(?:day\s+la\s+cruise|day\s+la\s+cruz|de\s+la\s+cruise|dela\s+cruise|de\s+la\s+cruz|dela\s+cruz)\b/gi, replacement: 'Dela Cruz' },
    { pattern: /\b(?:day\s+los\s+santos|de\s+los\s+santos|delos\s+santos)\b/gi, replacement: 'Delos Santos' },
    { pattern: /\b(?:de\s+los\s+reyes|delos\s+reyes)\b/gi, replacement: 'Delos Reyes' },
    { pattern: /\b(?:del\s+rosario|delrosario)\b/gi, replacement: 'Del Rosario' },
    { pattern: /\b(?:de\s+leon|deleon)\b/gi, replacement: 'De Leon' },
    { pattern: /\b(?:de\s+guzman|deguzman)\b/gi, replacement: 'De Guzman' },
    { pattern: /\b(?:de\s+castro|decastro)\b/gi, replacement: 'De Castro' },
    { pattern: /\b(?:de\s+chavez|dechavez)\b/gi, replacement: 'De Chavez' },
    { pattern: /\b(?:dela\s+pena|de\s+la\s+pena|dela\s+peña|de\s+la\s+peña)\b/gi, replacement: 'Dela Peña' },
    { pattern: /\b(?:penaranda|peña\s*randa|pena\s*randa)\b/gi, replacement: 'Peñaranda' },
    { pattern: /\b(?:castaneda|casta\s*neda)\b/gi, replacement: 'Castañeda' },
    { pattern: /\b(?:canete|ca\s*nete)\b/gi, replacement: 'Cañete' },
    { pattern: /\b(?:dimakulangan|dee\s*ma\s*cool\s*angan|dima\s+culangan)\b/gi, replacement: 'Dimaculangan' },
    { pattern: /\b(?:makaraig|maca\s+raig)\b/gi, replacement: 'Macaraig' },
    { pattern: /\b(?:agonsilyo|agon\s+cillo|agoncilyo)\b/gi, replacement: 'Agoncillo' },
    { pattern: /\b(?:montesilyo|monte\s+cillo)\b/gi, replacement: 'Montecillo' },
    { pattern: /\b(?:bilyanweba|bilyanueba|villa\s+nueva)\b/gi, replacement: 'Villanueva' },
    { pattern: /\b(?:kay\s+mada|kemada|comada|kamada)\b/gi, replacement: 'Quemada' },
    { pattern: /\b(?:riley|rylee|raylee|ryley|rayleigh|reilly|rai\s+lee)\b/gi, replacement: 'Railey' }
];

const DOMAIN_TERM_PATTERNS = [
    { pattern: /\bselectives\b/gi, replacement: 'electives' },
    { pattern: /\bselective\s+(?=subjects?|courses?|tracks?)\b/gi, replacement: 'elective ' },
    { pattern: /\b(?:tech\s+stock|text\s+stack|tex\s+stack|tech\s+stuck|tek\s+stack|tech\s+stak)\b/gi, replacement: 'tech stack' },

    // Disambiguate CSS vs CCS and fast-spoken HTML when adjacent to web frontend terms
    { pattern: /(\bHTML\s*(?:,|at|and|&|\/|\s)\s*)CCS\b/gi, replacement: '$1CSS' },
    { pattern: /\bCCS(\s*(?:,|at|and|&|\/)\s*(?:HTML|JavaScript|JS|Tailwind|Bootstrap)\b)/gi, replacement: 'CSS$1' },
    { pattern: /\b(?:Gmail|HML)(\s*(?:,|at|and|&|\/)\s*CSS\b)/gi, replacement: 'HTML$1' },

    // Re-assemble spoken initialisms & noisy-tail LSPU truncations
    { pattern: /\b(?:el[\s-]*es[\s-]*pi[\s-]*yu|l\.?\s+s\.?\s+p\.?\s+u\.?)\b/gi, replacement: 'LSPU' },
    { pattern: /\b(sa|ng|from|at)\s+(?:LST|LSU|LSP)\b/gi, replacement: '$1 LSPU' },
    { pattern: /\b(?:si[\s-]*si[\s-]*es|c\.?\s+c\.?\s+s\.?)\b/gi, replacement: 'CCS' },
    { pattern: /\b(?:bi[\s-]*es[\s-]*ay[\s-]*ti|b\.?\s*s\.?\s*i\.?\s*t\.?|bs\s+it|bsip)\b/gi, replacement: 'BSIT' },
    { pattern: /\b(?:bi[\s-]*es[\s-]*si[\s-]*es|b\.?\s*s\.?\s*c\.?\s*s\.?|bs\s+cs|com\s*sci)\b/gi, replacement: 'BSCS' },
    { pattern: /\b(?:eyts[\s-]*ti[\s-]*em[\s-]*el|h\.?\s+t\.?\s+m\.?\s+l\.?)\b/gi, replacement: 'HTML' },
    { pattern: /\b(?:si[\s-]*es[\s-]*es|c\.?\s+s\.?\s+s\.?)\b/gi, replacement: 'CSS' },
    { pattern: /\b(?:es[\s-]*kyu[\s-]*el|s\.?\s+q\.?\s+l\.?)\b/gi, replacement: 'SQL' },
    { pattern: /\b(?:pi[\s-]*eyts[\s-]*pi|p\.?\s+h\.?\s+p\.?)\b/gi, replacement: 'PHP' },
    { pattern: /\b(?:yu[\s-]*ay\s*(?:at|and|\/|-)?\s*yu[\s-]*eks|u\.?\s*i\.?\s*\/?\s*u\.?\s*x\.?|ui\s+ux)\b/gi, replacement: 'UI/UX' },

    // Standard tech stack & CCS terms
    { pattern: /\b(?:phyton|payton|piton)\b/gi, replacement: 'Python' },
    { pattern: /\bjava\s+script\b/gi, replacement: 'JavaScript' },
    { pattern: /\btype\s+script\b/gi, replacement: 'TypeScript' },
    { pattern: /\b(?:react\s*\.?\s*js|reactjs)\b/gi, replacement: 'React.js' },
    { pattern: /\b(?:node\s*\.?\s*js|nodejs)\b/gi, replacement: 'Node.js' },
    { pattern: /\b(?:next\s*\.?\s*js|nextjs)\b/gi, replacement: 'Next.js' },
    { pattern: /\b(?:vue\s*\.?\s*js|vuejs)\b/gi, replacement: 'Vue.js' },
    { pattern: /\b(?:my\s+sequel|my\s+sql)\b/gi, replacement: 'MySQL' },
    { pattern: /\b(?:post\s*gres|postgre\s*sql|postgres\s*ql)\b/gi, replacement: 'PostgreSQL' },
    { pattern: /\bc\s+sharp\b/gi, replacement: 'C#' },
    { pattern: /\bc\s+plus\s+plus\b/gi, replacement: 'C++' },
    { pattern: /\b(?:git\s+hub|githab)\b/gi, replacement: 'GitHub' },
    { pattern: /\b(?:vs\s+code|visual\s+studio\s+code)\b/gi, replacement: 'VS Code' },
    { pattern: /\b(?:dev\s+ops|deb\s+ops)\b/gi, replacement: 'DevOps' },
    { pattern: /\b(?:wi[\s-]*fi|why\s+fi|wai\s+fai)\b/gi, replacement: 'Wi-Fi' },
    { pattern: /\b(?:air\s+con|airkon)\b/gi, replacement: 'aircon' },
    { pattern: /\b(0\d{3})\s*(\d{4})\b/g, replacement: '$1-$2' }
];

function matchSingleNameToken(token, isSurnameSlot) {
    const stripped = (token || '').trim();
    if (!stripped) return token;

    if (/^[A-Za-z]\.?$/.test(stripped)) {
        return stripped.charAt(0).toUpperCase() + (stripped.endsWith('.') ? '.' : '');
    }

    const lower = stripped.toLowerCase();
    if (COMMON_NON_NAME_WORDS.has(lower)) return stripped;

    if (isSurnameSlot && lower === 'cornelia') return 'Hornilla';

    if (isSurnameSlot) {
        if (SURNAME_LOWER_MAP.has(lower)) return SURNAME_LOWER_MAP.get(lower);
        if (FIRST_NAME_LOWER_MAP.has(lower)) return FIRST_NAME_LOWER_MAP.get(lower);
    } else {
        if (FIRST_NAME_LOWER_MAP.has(lower)) return FIRST_NAME_LOWER_MAP.get(lower);
        if (SURNAME_LOWER_MAP.has(lower)) return SURNAME_LOWER_MAP.get(lower);
    }

    if (lower.length < 4 || !/^[a-zñáéíóú\-]+$/i.test(lower)) {
        return stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }

    const pkey = phPhoneticKey(lower);
    if (!pkey) return stripped.charAt(0).toUpperCase() + stripped.slice(1);

    const indices = isSurnameSlot
        ? [SURNAME_PHONETIC_INDEX, FIRST_PHONETIC_INDEX]
        : [FIRST_PHONETIC_INDEX, SURNAME_PHONETIC_INDEX];

    for (const index of indices) {
        const candidates = index.get(pkey);
        if (candidates && candidates.length > 0) {
            let best = candidates[0];
            let bestDist = levenshtein(lower, best.toLowerCase());
            for (let i = 1; i < candidates.length; i++) {
                const d = levenshtein(lower, candidates[i].toLowerCase());
                if (d < bestDist) {
                    bestDist = d;
                    best = candidates[i];
                }
            }
            if (bestDist <= 3) return best;
        }
    }

    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function refineNameSpan(nameSpan = '', mode = 'fullname') {
    if (!nameSpan || !nameSpan.trim()) return nameSpan;

    let text = nameSpan.trim();
    EXPLICIT_NAME_PATTERNS.forEach(({ pattern, replacement }) => {
        text = text.replace(pattern, replacement);
    });

    const protectedCompounds = [
        'Dela Cruz', 'Delos Santos', 'Delos Reyes', 'Del Rosario',
        'De Leon', 'De Guzman', 'De Castro', 'De Chavez', 'Dela Peña',
        'San Jose', 'Santa Maria', 'John Paul', 'Mark Anthony', 'John Mark'
    ];
    const placeholders = new Map();
    protectedCompounds.forEach((comp, idx) => {
        const escaped = comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pat = new RegExp(`\\b${escaped}\\b`, 'gi');
        if (pat.test(text)) {
            const ph = `__COMPNAME${idx}__`;
            placeholders.set(ph, comp);
            text = text.replace(pat, ph);
        }
    });

    const tokens = text.split(/\s+/).filter(Boolean);
    const numTokens = tokens.length;

    return tokens
        .map((tok, i) => {
            if (placeholders.has(tok)) return placeholders.get(tok);
            const m = tok.match(/^([A-Za-zÑñÁÉÍÓÚáéíóú.\-]+)([,.;:!?]*)$/);
            if (!m) return tok;
            const [, core, punct] = m;
            const isSurname =
                mode === 'lastname'
                    ? true
                    : mode === 'firstname'
                        ? false
                        : i === numTokens - 1 && numTokens >= 2;
            return matchSingleNameToken(core, isSurname) + punct;
        })
        .join(' ');
}

const INTRO_SPAN_REGEX = /(\b(?:ako\s+(?:po\s+)?si|ang\s+pangalan\s+ko\s+(?:po\s+)?ay|pangalan\s+ko\s+(?:po\s+)?ay|my\s+(?:full\s+)?name\s+is|i\s+am|i'm)\s+)([A-Za-zÑñÁÉÍÓÚáéíóú.\-\s]{2,48}?)(?=\s*(?:,|;|\.|!|\?|\bat\b|\band\b|\bang\b|\bmy\b|\bstudent\b|\bid\b|\bi\.d\b|\bfrom\b|\btaking\b|\bgraduate\b|\bgraduated\b|\balumnus\b|\bbsit\b|\bbscs\b|\bwala\b|\bhindi\b|\d|$))/gi;

export function refineTranscript(rawText = '', { stage = null, fieldHint = null } = {}) {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText.trim();
    if (!text) return '';

    if (/^(?:thank\s+you\s+for\s+watching|thanks\s+for\s+watching|please\s+subscribe|subtitles?\s+by|amara\.org)[.!?\s]*$/i.test(text)) {
        return '';
    }
    text = text.replace(/\s*(?:subtitles?\s+by\s+.*|amara\.org.*|thank\s+you\s+for\s+watching\.?|(?:surnames|names)\s*:\s*hornilla.*)$/i, '').trim();
    text = text.replace(/\b(\w+)(?:\s+\1){3,}\b/gi, '$1');
    if (!text) return '';

    DOMAIN_TERM_PATTERNS.forEach(({ pattern, replacement }) => {
        text = text.replace(pattern, replacement);
    });

    const hint = (fieldHint || '').trim().toLowerCase();
    if (hint === 'lastname' || hint === 'demo_lastname') {
        return refineNameSpan(text, 'lastname');
    }
    if (hint === 'firstname' || hint === 'demo_firstname') {
        return refineNameSpan(text, 'firstname');
    }

    let matchedIntro = false;
    text = text.replace(INTRO_SPAN_REGEX, (_, prefix, span) => {
        matchedIntro = true;
        return prefix + refineNameSpan(span, 'fullname');
    });

    if (stage === 1 && !matchedIntro) {
        const firstSplit = text.match(/^([^,.;!?]+)([,.;!?][\s\S]*)?$/);
        if (firstSplit) {
            const firstClause = firstSplit[1].trim();
            const rest = firstSplit[2] || '';
            if (!/\bstudent\s*id\b|\d/i.test(firstClause)) {
                const words = firstClause.split(/\s+/).filter(Boolean);
                const nonStop = words.filter(
                    (w) => !COMMON_NON_NAME_WORDS.has(w.toLowerCase().replace(/\./g, '')) && !/\d/.test(w)
                );
                if (nonStop.length >= 1 && nonStop.length <= 4 && words.length <= 6) {
                    text = refineNameSpan(firstClause, 'fullname') + rest;
                }
            }
        }
    }

    return text.replace(/\s{2,}/g, ' ').trim();
}

