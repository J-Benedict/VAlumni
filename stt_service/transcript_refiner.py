"""
Context-Aware ASR Transcript & Philippine Name Refiner for VAlumni

Works alongside faster-whisper + VoiceCleaner to correct:
  1. Whisper silent-room / subtitle hallucinations & decoder repetition loops
  2. Taglish computing, curriculum, & LSPU CCS phonetic confusions
     (e.g., "selectives" -> "electives", "tech stock" -> "tech stack",
      "HTML, CCS" -> "HTML, CSS", spoken letter-by-letter initialisms -> acronyms)
  3. Filipino, Spanish-Filipino, & English given names and surnames within
     introduction spans using philippineNames.json + Philippine phonetic keys
"""

import json
import os
import re
from typing import Dict, List, Optional, Tuple

# Locate shared philippineNames.json dataset
_NAMES_JSON_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "src", "data", "philippineNames.json")
)

FIRST_NAMES: List[str] = []
SURNAMES: List[str] = []
FIRST_NAME_LOWER_MAP: Dict[str, str] = {}
SURNAME_LOWER_MAP: Dict[str, str] = {}
FIRST_PHONETIC_INDEX: Dict[str, List[str]] = {}
SURNAME_PHONETIC_INDEX: Dict[str, List[str]] = {}


def ph_phonetic_key(word: str) -> str:
    """
    Computes a Philippine Spanish/Tagalog/English phonetic skeleton so acoustically
    identical spellings (e.g. 'Coronacion' vs 'Koronasyon', 'Urrea' vs 'Orea',
    'Hornilla' vs 'Ornilla'/'Hornilya', 'Villanueva' vs 'Bilyanweba') map together.
    """
    if not word:
        return ""
    s = word.lower().strip()
    s = (
        s.replace("ñ", "ny")
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    s = re.sub(r"[^a-z]", "", s)
    if not s:
        return ""

    # Leading 'h' is frequently unaspirated/dropped in Filipino-Spanish names (Hornilla / Ornilla)
    s = re.sub(r"^h(?=[aeiou])", "", s)

    # Spanish / Tagalog palatal & sibilant normalizations
    s = re.sub(r"(?:cion|sion|shon|syon|chon)$", "syun", s)
    s = re.sub(r"ll", "ly", s)
    s = re.sub(r"li(?=[aeiou])", "ly", s)
    s = re.sub(r"ni(?=[aeiou])", "ny", s)
    s = re.sub(r"qu(?=[ei])", "k", s)
    s = re.sub(r"gue", "ge", s)
    s = re.sub(r"gui", "gi", s)
    s = re.sub(r"c(?=[ei])", "s", s)
    s = s.replace("ch", "ts")
    s = s.replace("ph", "p")
    s = s.replace("ck", "k")
    s = s.replace("c", "k")
    s = s.replace("q", "k")
    s = s.replace("v", "b")
    s = s.replace("f", "p")
    s = s.replace("z", "s")
    s = s.replace("x", "ks")

    # Normalize unstressed Philippine vowel pairs (e/i and o/u)
    s = s.replace("e", "i").replace("o", "u")

    # Collapse geminate / repeated letters (Urrea -> Uria -> Urya)
    s = re.sub(r"ia$", "ya", s)
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def _load_name_lexicon() -> None:
    global FIRST_NAMES, SURNAMES
    if FIRST_NAMES or SURNAMES:
        return
    try:
        with open(_NAMES_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        FIRST_NAMES = data.get("firstNames", [])
        SURNAMES = data.get("surnames", [])
    except Exception:
        FIRST_NAMES = ["Benedict", "Juan", "Maria", "Mark", "John", "Railey", "Gabriel", "Patricia", "Kathleen"]
        SURNAMES = ["Hornilla", "Coronacion", "Urrea", "Dela Cruz", "Santos", "Reyes", "Bautista", "Villanueva"]

    for fn in FIRST_NAMES:
        clean = fn.strip()
        if clean:
            FIRST_NAME_LOWER_MAP[clean.lower()] = clean
            if " " not in clean:
                key = ph_phonetic_key(clean)
                if key:
                    FIRST_PHONETIC_INDEX.setdefault(key, []).append(clean)

    for sn in SURNAMES:
        clean = sn.strip()
        if clean:
            # Canonicalize 'dela Cruz' -> 'Dela Cruz' for formal transcript display
            titled = " ".join(w[0].upper() + w[1:] if w else "" for w in clean.split())
            SURNAME_LOWER_MAP[clean.lower()] = titled
            if " " not in clean:
                key = ph_phonetic_key(clean)
                if key:
                    SURNAME_PHONETIC_INDEX.setdefault(key, []).append(titled)


_load_name_lexicon()

# Words that must NEVER be fuzzy-snapped to a person's name
COMMON_NON_NAME_WORDS = {
    "ako", "ikaw", "siya", "kami", "tayo", "kayo", "sila", "opo", "po", "oo", "hindi", "wala",
    "aking", "iyong", "kanyang", "aming", "ating", "inyong", "kanilang",
    "ko", "mo", "niya", "namin", "natin", "ninyo", "nila",
    "yung", "iyung", "ito", "iyan", "iyon", "dito", "doon", "lang", "din", "rin", "naman",
    "siguro", "parang", "medyo", "pwede", "puwede", "meron", "mayroon", "kaya",
    "magandang", "umaga", "hapon", "gabi", "araw", "good", "morning", "afternoon", "evening", "day",
    "hello", "hi", "hey", "sir", "maam", "madam", "doc", "dean", "program", "head",
    "ang", "mga", "ng", "sa", "na", "pa", "ay", "at", "si", "ni", "kay", "para", "pero", "kasi",
    "my", "name", "full", "is", "am", "im", "the", "and", "or", "from", "of", "in", "to", "for", "with",
    "pangalan", "apelyido", "gitnang", "middle", "initial", "first", "last", "surname", "given",
    "student", "id", "number", "num", "code", "maalala", "nakalimutan", "remember", "forgot",
    "graduate", "graduated", "alumnus", "alumni", "batch", "year", "class", "course", "degree", "major",
    "bsit", "bscs", "msit", "mscs", "ccs", "lspu", "laguna", "state", "polytechnic", "university",
    "college", "computer", "studies", "science", "information", "technology",
    "capstone", "thesis", "role", "project", "lead", "developer", "programmer", "manager", "analyst",
    "system", "systems", "designer", "tester", "documentation", "specialist", "frontend", "backend",
    "salamat", "thank", "thanks", "okay", "ok", "yes", "no", "none", "skip", "pass", "not", "provided",
}

# High-certainty multi-word & phonetic surname normalizations
EXPLICIT_NAME_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"\b(?:koronasyon|coronasyon|coronasion|corona\s+cion|corona\s+shon|coronation)\b", re.I), "Coronacion"),
    (re.compile(r"\b(?:urea|orea|oria|uria|urhea|u\s+rea|you\s+rea|ur-rea)\b", re.I), "Urrea"),
    (re.compile(r"\b(?:cornilla|ornilla|ornelia|honilla|fornilla|panilla|cornella|cornellya|hornila|ornila|hor\s*nilla|hor\s*neeya|or\s*neeya|hornilya|horniya)\b", re.I), "Hornilla"),
    (re.compile(r"\b(?:day\s+la\s+cruise|day\s+la\s+cruz|de\s+la\s+cruise|dela\s+cruise|de\s+la\s+cruz|dela\s+cruz)\b", re.I), "Dela Cruz"),
    (re.compile(r"\b(?:day\s+los\s+santos|de\s+los\s+santos|delos\s+santos)\b", re.I), "Delos Santos"),
    (re.compile(r"\b(?:de\s+los\s+reyes|delos\s+reyes)\b", re.I), "Delos Reyes"),
    (re.compile(r"\b(?:del\s+rosario|delrosario)\b", re.I), "Del Rosario"),
    (re.compile(r"\b(?:de\s+leon|deleon)\b", re.I), "De Leon"),
    (re.compile(r"\b(?:de\s+guzman|deguzman)\b", re.I), "De Guzman"),
    (re.compile(r"\b(?:de\s+castro|decastro)\b", re.I), "De Castro"),
    (re.compile(r"\b(?:de\s+chavez|dechavez)\b", re.I), "De Chavez"),
    (re.compile(r"\b(?:dela\s+pena|de\s+la\s+pena|dela\s+peña|de\s+la\s+peña)\b", re.I), "Dela Peña"),
    (re.compile(r"\b(?:penaranda|peña\s*randa|pena\s*randa)\b", re.I), "Peñaranda"),
    (re.compile(r"\b(?:castaneda|casta\s*neda)\b", re.I), "Castañeda"),
    (re.compile(r"\b(?:canete|ca\s*nete)\b", re.I), "Cañete"),
    (re.compile(r"\b(?:dimakulangan|dee\s*ma\s*cool\s*angan|dima\s+culangan)\b", re.I), "Dimaculangan"),
    (re.compile(r"\b(?:makaraig|maca\s+raig)\b", re.I), "Macaraig"),
    (re.compile(r"\b(?:agonsilyo|agon\s+cillo|agoncilyo)\b", re.I), "Agoncillo"),
    (re.compile(r"\b(?:montesilyo|monte\s+cillo)\b", re.I), "Montecillo"),
    (re.compile(r"\b(?:bilyanweba|bilyanueba|villa\s+nueva)\b", re.I), "Villanueva"),
    (re.compile(r"\b(?:kay\s+mada|kemada|comada|kamada)\b", re.I), "Quemada"),
    (re.compile(r"\b(?:riley|rylee|raylee|ryley|rayleigh|reilly|rai\s+lee)\b", re.I), "Railey"),
]

# Known silent-room / subtitle watermark hallucinations produced by Whisper models
HALLUCINATION_EXACT_PATTERNS = [
    re.compile(r"^(?:thank\s+you\s+for\s+watching|thanks\s+for\s+watching|please\s+subscribe|like\s+and\s+subscribe)[.!?\s]*$", re.I),
    re.compile(r"^(?:subtitles?\s+by|translated\s+by|amara\.org|mbc\s+news|salamat\s+sa\s+panonood)[.!?\s]*$", re.I),
    re.compile(r"^[\W_]+$"),
]

HALLUCINATION_TAIL_PATTERNS = [
    re.compile(r"\s*(?:subtitles?\s+by\s+.*|amara\.org.*|thank\s+you\s+for\s+watching\.?|(?:surnames|names)\s*:\s*hornilla.*)$", re.I),
]

# Domain-specific computing, curriculum, & institutional corrections (context-guarded)
DOMAIN_TERM_PATTERNS: List[Tuple[re.Pattern, str]] = [
    # Real CCS curriculum confusions ("selectives" -> "electives", "tech stock" -> "tech stack")
    (re.compile(r"\bselectives\b", re.I), "electives"),
    (re.compile(r"\bselective\s+(?=subjects?|courses?|tracks?)\b", re.I), "elective "),
    (re.compile(r"\b(?:tech\s+stock|text\s+stack|tex\s+stack|tech\s+stuck|tek\s+stack|tech\s+stak)\b", re.I), "tech stack"),

    # Disambiguate CSS vs CCS and fast-spoken HTML ("Gmail, at CSS") when paired with web frontend technologies
    (re.compile(r"(\bHTML\s*(?:,|at|and|&|\/|\s)\s*)CCS\b", re.I), r"\1CSS"),
    (re.compile(r"\bCCS(\s*(?:,|at|and|&|\/)\s*(?:HTML|JavaScript|JS|Tailwind|Bootstrap)\b)", re.I), r"CSS\1"),
    (re.compile(r"\b(?:Gmail|HML)(\s*(?:,|at|and|&|\/)\s*CSS\b)", re.I), r"HTML\1"),

    # Re-assemble spoken phonetic initialisms & noisy-tail LSPU truncations back into standard acronyms
    (re.compile(r"\b(?:el[\s-]*es[\s-]*pi[\s-]*yu|l\.?\s+s\.?\s+p\.?\s+u\.?)\b", re.I), "LSPU"),
    (re.compile(r"\b(sa|ng|from|at)\s+(?:LST|LSU|LSP)\b", re.I), r"\1 LSPU"),
    (re.compile(r"\b(?:si[\s-]*si[\s-]*es|c\.?\s+c\.?\s+s\.?)\b", re.I), "CCS"),
    (re.compile(r"\b(?:bi[\s-]*es[\s-]*ay[\s-]*ti|b\.?\s*s\.?\s*i\.?\s*t\.?|bs\s+it|bsip)\b", re.I), "BSIT"),
    (re.compile(r"\b(?:bi[\s-]*es[\s-]*si[\s-]*es|b\.?\s*s\.?\s*c\.?\s*s\.?|bs\s+cs|com\s*sci)\b", re.I), "BSCS"),
    (re.compile(r"\b(?:eyts[\s-]*ti[\s-]*em[\s-]*el|h\.?\s+t\.?\s+m\.?\s+l\.?)\b", re.I), "HTML"),
    (re.compile(r"\b(?:si[\s-]*es[\s-]*es|c\.?\s+s\.?\s+s\.?)\b", re.I), "CSS"),
    (re.compile(r"\b(?:es[\s-]*kyu[\s-]*el|s\.?\s+q\.?\s+l\.?)\b", re.I), "SQL"),
    (re.compile(r"\b(?:pi[\s-]*eyts[\s-]*pi|p\.?\s+h\.?\s+p\.?)\b", re.I), "PHP"),
    (re.compile(r"\b(?:yu[\s-]*ay\s*(?:at|and|\/|-)?\s*yu[\s-]*eks|u\.?\s*i\.?\s*\/?\s*u\.?\s*x\.?|ui\s+ux)\b", re.I), "UI/UX"),

    # Programming languages, frameworks, & lab infrastructure terms
    (re.compile(r"\b(?:phyton|payton|piton)\b", re.I), "Python"),
    (re.compile(r"\bjava\s+script\b", re.I), "JavaScript"),
    (re.compile(r"\btype\s+script\b", re.I), "TypeScript"),
    (re.compile(r"\b(?:react\s*\.?\s*js|reactjs)\b", re.I), "React.js"),
    (re.compile(r"\b(?:node\s*\.?\s*js|nodejs)\b", re.I), "Node.js"),
    (re.compile(r"\b(?:next\s*\.?\s*js|nextjs)\b", re.I), "Next.js"),
    (re.compile(r"\b(?:vue\s*\.?\s*js|vuejs)\b", re.I), "Vue.js"),
    (re.compile(r"\b(?:my\s+sequel|my\s+sql)\b", re.I), "MySQL"),
    (re.compile(r"\b(?:post\s*gres|postgre\s*sql|postgres\s*ql)\b", re.I), "PostgreSQL"),
    (re.compile(r"\bc\s+sharp\b", re.I), "C#"),
    (re.compile(r"\bc\s+plus\s+plus\b", re.I), "C++"),
    (re.compile(r"\b(?:git\s+hub|githab)\b", re.I), "GitHub"),
    (re.compile(r"\b(?:vs\s+code|visual\s+studio\s+code)\b", re.I), "VS Code"),
    (re.compile(r"\b(?:dev\s+ops|deb\s+ops)\b", re.I), "DevOps"),
    (re.compile(r"\b(?:wi[\s-]*fi|why\s+fi|wai\s+fai)\b", re.I), "Wi-Fi"),
    (re.compile(r"\b(?:air\s+con|airkon)\b", re.I), "aircon"),
    # Format 8-digit LSPU Student IDs (e.g. "01220345" or "0122 0345" -> "0122-0345")
    (re.compile(r"\b(0\d{3})\s*(\d{4})\b"), r"\1-\2"),
]


def _match_single_name_token(token: str, is_surname_slot: bool) -> str:
    """
    Matches a single candidate name word against philippineNames.json using exact
    lookup first, then strict Philippine phonetic skeleton + bounded edit distance.
    """
    stripped = token.strip()
    if not stripped:
        return token

    # Preserve middle initials like "M." or "A."
    if re.match(r"^[A-Za-z]\.?$", stripped):
        return stripped[0].upper() + ("." if stripped.endswith(".") else "")

    lower = stripped.lower()
    if lower in COMMON_NON_NAME_WORDS:
        return stripped

    # Surname-slot special phonetic disambiguation: "Cornelia" spoken as surname -> "Hornilla"
    if is_surname_slot and lower == "cornelia":
        return "Hornilla"

    # 1. Exact case-insensitive dictionary hit (respects slot priority first)
    if is_surname_slot:
        if lower in SURNAME_LOWER_MAP:
            return SURNAME_LOWER_MAP[lower]
        if lower in FIRST_NAME_LOWER_MAP:
            return FIRST_NAME_LOWER_MAP[lower]
    else:
        if lower in FIRST_NAME_LOWER_MAP:
            return FIRST_NAME_LOWER_MAP[lower]
        if lower in SURNAME_LOWER_MAP:
            return SURNAME_LOWER_MAP[lower]

    # Only attempt phonetic snap on alphabetic tokens >= 4 chars
    if len(lower) < 4 or not re.match(r"^[a-zñáéíóú\-]+$", lower):
        return stripped[0].upper() + stripped[1:] if stripped else stripped

    pkey = ph_phonetic_key(lower)
    if not pkey:
        return stripped[0].upper() + stripped[1:]

    primary_index = SURNAME_PHONETIC_INDEX if is_surname_slot else FIRST_PHONETIC_INDEX
    secondary_index = FIRST_PHONETIC_INDEX if is_surname_slot else SURNAME_PHONETIC_INDEX

    # 2. Exact Philippine phonetic skeleton match ONLY (prevents false surname drift like Panilla -> Padilla)
    for index in (primary_index, secondary_index):
        candidates = index.get(pkey)
        if candidates:
            best = min(candidates, key=lambda c: _levenshtein(lower, c.lower()))
            if _levenshtein(lower, best.lower()) <= 3:
                return best

    return stripped[0].upper() + stripped[1:]


def refine_name_span(name_span: str, mode: str = "fullname") -> str:
    """
    Refines a name phrase (e.g. 'benedict cornelia', 'riley koronasyon', 'juan dela cruise').
    mode: 'fullname' | 'firstname' | 'lastname'
    """
    if not name_span or not name_span.strip():
        return name_span

    text = name_span.strip()
    for pattern, replacement in EXPLICIT_NAME_PATTERNS:
        text = pattern.sub(replacement, text)

    # Protect multi-word surnames so they aren't split apart during token pass
    protected_compounds = [
        "Dela Cruz", "Delos Santos", "Delos Reyes", "Del Rosario",
        "De Leon", "De Guzman", "De Castro", "De Chavez", "Dela Peña",
        "San Jose", "Santa Maria", "John Paul", "Mark Anthony", "John Mark",
    ]
    placeholders: Dict[str, str] = {}
    for idx, comp in enumerate(protected_compounds):
        pat = re.compile(rf"\b{re.escape(comp)}\b", re.I)
        if pat.search(text):
            ph = f"__COMPNAME{idx}__"
            placeholders[ph] = comp
            text = pat.sub(ph, text)

    tokens = text.split()
    if not tokens:
        return name_span

    refined_tokens: List[str] = []
    num_tokens = len(tokens)
    for i, tok in enumerate(tokens):
        if tok in placeholders:
            refined_tokens.append(placeholders[tok])
            continue

        # Strip trailing punctuation temporarily
        m = re.match(r"^([A-Za-zÑñÁÉÍÓÚáéíóú.\-]+)([,.;:!?]*)$", tok)
        if not m:
            refined_tokens.append(tok)
            continue

        core, punct = m.group(1), m.group(2)
        if mode == "lastname":
            is_surname = True
        elif mode == "firstname":
            is_surname = False
        else:
            # In a full name ("Benedict Hornilla" or "Benedict M. Hornilla"), final name token is surname
            is_surname = (i == num_tokens - 1 and num_tokens >= 2)

        matched = _match_single_name_token(core, is_surname_slot=is_surname)
        refined_tokens.append(matched + punct)

    return " ".join(refined_tokens)


# Regex capturing explicit self-introduction spans in Taglish / Filipino / English
_INTRO_SPAN_REGEX = re.compile(
    r"(\b(?:ako\s+(?:po\s+)?si|ang\s+pangalan\s+ko\s+(?:po\s+)?ay|pangalan\s+ko\s+(?:po\s+)?ay|"
    r"my\s+(?:full\s+)?name\s+is|i\s+am|i'm)\s+)"
    r"([A-Za-zÑñÁÉÍÓÚáéíóú.\-\s]{2,48}?)"
    r"(?=\s*(?:,|;|\.|!|\?|\bat\b|\band\b|\bang\b|\bmy\b|\bstudent\b|\bid\b|\bi\.d\b|"
    r"\bfrom\b|\btaking\b|\bgraduate\b|\bgraduated\b|\balumnus\b|\bbsit\b|\bbscs\b|\bwala\b|\bhindi\b|\d|$))",
    re.I,
)


def _collapse_repetitions(text: str) -> str:
    """Collapses accidental Whisper phrase/word stutter loops (4+ consecutive repeats)."""
    return re.sub(r"\b(\w+)(?:\s+\1){3,}\b", r"\1", text, flags=re.I)


def refine_transcript(
    raw_text: str,
    stage: Optional[int] = None,
    field_hint: Optional[str] = None,
) -> str:
    """
    Main post-ASR refinement pipeline applied to faster-whisper output.
    """
    if not raw_text or not isinstance(raw_text, str):
        return ""

    text = raw_text.strip()
    if not text:
        return ""

    # 1. Filter out silent-room Whisper hallucinations
    for h_pat in HALLUCINATION_EXACT_PATTERNS:
        if h_pat.match(text):
            return ""
    for tail_pat in HALLUCINATION_TAIL_PATTERNS:
        text = tail_pat.sub("", text).strip()

    text = _collapse_repetitions(text)
    if not text:
        return ""

    # 2. Apply context-guarded computing, curriculum, & LSPU CCS term fixes
    for pattern, replacement in DOMAIN_TERM_PATTERNS:
        text = pattern.sub(replacement, text)

    # 3. Structured single-field hints (for VoiceInterview form mode)
    hint = (field_hint or "").strip().lower()
    if hint in ("lastname", "demo_lastname"):
        return refine_name_span(text, mode="lastname")
    if hint in ("firstname", "demo_firstname"):
        return refine_name_span(text, mode="firstname")

    # 4. Conversational name introduction refinement (explicit cue anywhere, or direct Stage 1 answer)
    matched_intro = False

    def _replace_intro(match: re.Match) -> str:
        nonlocal matched_intro
        matched_intro = True
        prefix = match.group(1)
        span = match.group(2)
        return prefix + refine_name_span(span, mode="fullname")

    text = _INTRO_SPAN_REGEX.sub(_replace_intro, text)

    # If Stage 1 and alumnus answered directly with their name without "Ako po si" (e.g. "Benedict Cornelia po, BSIT")
    if stage == 1 and not matched_intro:
        clauses = re.split(r"([,.;!?])", text, maxsplit=1)
        first_clause = clauses[0].strip()
        if not re.search(r"\bstudent\s*id\b|\d", first_clause, re.I):
            words = first_clause.split()
            non_stop = [w for w in words if w.lower().strip(".") not in COMMON_NON_NAME_WORDS and not any(ch.isdigit() for ch in w)]
            if 1 <= len(non_stop) <= 4 and len(words) <= 6:
                refined_first = refine_name_span(first_clause, mode="fullname")
                text = refined_first + "".join(clauses[1:])

    return re.sub(r"\s{2,}", " ", text).strip()

