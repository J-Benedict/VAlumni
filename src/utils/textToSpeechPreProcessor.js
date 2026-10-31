/**
 * TTS Text Pre-Processor
 *
 * Solves how neural TTS synthesizers pronounce Philippine university & computing acronyms:
 * - Native Filipino voices (fil-PH-AngeloNeural / fil-PH-BlessicaNeural) use Tagalog phonetics
 *   (Abakada vowel values: a=ah, e=eh, i=ee, o=oh, u=oo), where raw or dotted English letters
 *   ("L.S.P.U.", "I.D.") get misread. Mapping them to Filipino phonetic letter names
 *   ("El-Es-Pi-Yu", "Ay-Di", "Bi-Es-Ay-Ti", "Si-Si-Es") produces 100% natural, crystal-clear speech.
 * - English voices (en-PH-JamesNeural / en-PH-RosaNeural) use standard dotted initialisms ("L.S.P.U.").
 */

export function preprocessTextForTts(text, voiceOrLang = 'fil') {
    if (!text || typeof text !== 'string') return '';

    const isFilipinoVoice =
        voiceOrLang.startsWith('fil') ||
        voiceOrLang === 'taglish' ||
        voiceOrLang === 'tl';

    let processed = text;

    // 1. Remove markdown symbols (asterisks, hashtags, backticks, tildes)
    processed = processed.replace(/[*_#`~]/g, '');

    // Remove redundant parenthetical program codes when already written out
    processed = processed.replace(/\(BSIT\)/gi, '');
    processed = processed.replace(/\(BSCS\)/gi, '');

    if (isFilipinoVoice) {
        // 2A. Filipino Phonetic Spellings for fil-PH Neural Voices (Angelo & Blessica)
        processed = processed.replace(/\b(LSPU|L\.S\.P\.U\.|L\.\s*S\.\s*P\.\s*U\.)\b/gi, 'El-Es-Pi-Yu');
        processed = processed.replace(/\b(CCS|C\.C\.S\.|C\.\s*C\.\s*S\.)\b/gi, 'Si-Si-Es');

        processed = processed.replace(/\bBS\s+in\b/gi, 'Bi-Es in');
        processed = processed.replace(/\bBS\s+(?=Information|Computer)\b/gi, 'Bi-Es ');
        processed = processed.replace(/\b(BSIT|B\.S\.I\.T\.)\b/gi, 'Bi-Es-Ay-Ti');
        processed = processed.replace(/\b(BSCS|B\.S\.C\.S\.)\b/gi, 'Bi-Es-Si-Es');
        processed = processed.replace(/\b(MSIT|M\.S\.I\.T\.)\b/gi, 'Em-Es-Ay-Ti');
        processed = processed.replace(/\b(MSCS|M\.S\.C\.S\.)\b/gi, 'Em-Es-Si-Es');

        processed = processed.replace(/\bStudent\s+(ID|I\.D\.|I\.\s*D\.)\b/gi, 'Student Ay-Di');
        processed = processed.replace(/\b(ID|I\.D\.)\s+number\b/gi, 'Ay-Di number');
        processed = processed.replace(/\b(ID|I\.D\.)\b/g, 'Ay-Di');

        processed = processed.replace(/\bIT\b/g, 'Ay-Ti');
        processed = processed.replace(/\bI\.T\.\b/gi, 'Ay-Ti');
        processed = processed.replace(/\b(AI|A\.I\.)\b/g, 'Ey-Ay');
        processed = processed.replace(/\bIDEs\b/g, 'mga Ay-Di-I');
        processed = processed.replace(/\bIDE\b/g, 'Ay-Di-I');
        processed = processed.replace(/\bUI\/UX\b/gi, 'Yu-Ay at Yu-Eks');
        processed = processed.replace(/\bUI-UX\b/gi, 'Yu-Ay at Yu-Eks');
        processed = processed.replace(/\bUI\b/g, 'Yu-Ay');
        processed = processed.replace(/\bUX\b/g, 'Yu-Eks');
        processed = processed.replace(/\bPCs\b/g, 'mga Pi-Si');
        processed = processed.replace(/\bPC\b/gi, 'Pi-Si');
        processed = processed.replace(/\bSQL\b/gi, 'Es-Kyu-El');
        processed = processed.replace(/\bAWS\b/gi, 'Ey-Dabol-Yu-Es');
        processed = processed.replace(/\bPHP\b/gi, 'Pi-Eyts-Pi');
        processed = processed.replace(/\bHTML\b/gi, 'Eyts-Ti-Em-El');
        processed = processed.replace(/\bCSS\b/gi, 'Si-Es-Es');
        processed = processed.replace(/\bQA\b/g, 'Kyu-Ey');
        processed = processed.replace(/\bHDD\b/gi, 'Eyts-Di-Di');
        processed = processed.replace(/\bSSDs\b/gi, 'mga Es-Es-Di');
        processed = processed.replace(/\bSSD\b/gi, 'Es-Es-Di');
        processed = processed.replace(/\bSNS\b/gi, 'Es-En-Es');

        // Spanish-Filipino '-illa' / '-illo' surname pronunciation for fil-PH neural voices
        processed = processed.replace(/\bHornilla\b/gi, 'Hornilya');
        processed = processed.replace(/\bPadilla\b/gi, 'Padilya');
        processed = processed.replace(/\bAgoncillo\b/gi, 'Agonsilyo');
        processed = processed.replace(/\bMontecillo\b/gi, 'Montesilyo');
    } else {
        // 2B. English Dotted Initialisms for en-PH Neural Voices (James & Rosa)
        processed = processed.replace(/\b(LSPU|L\.S\.P\.U\.|L\.\s*S\.\s*P\.\s*U\.)\b/gi, 'L.S.P.U.');
        processed = processed.replace(/\b(CCS|C\.C\.S\.|C\.\s*C\.\s*S\.)\b/gi, 'C.C.S.');

        processed = processed.replace(/\bBS\s+in\b/gi, 'B.S. in');
        processed = processed.replace(/\b(BSIT|B\.S\.I\.T\.)\b/gi, 'B.S.I.T.');
        processed = processed.replace(/\b(BSCS|B\.S\.C\.S\.)\b/gi, 'B.S.C.S.');
        processed = processed.replace(/\b(MSIT|M\.S\.I\.T\.)\b/gi, 'M.S.I.T.');
        processed = processed.replace(/\b(MSCS|M\.S\.C\.S\.)\b/gi, 'M.S.C.S.');

        processed = processed.replace(/\bStudent\s+(ID|I\.D\.|I\.\s*D\.)\b/gi, 'Student I.D.');
        processed = processed.replace(/\b(ID|I\.D\.)\s+number\b/gi, 'I.D. number');
        processed = processed.replace(/\b(ID|I\.D\.)\b/g, 'I.D.');

        processed = processed.replace(/\bIT\b/g, 'I.T.');
        processed = processed.replace(/\bI\.T\.\b/gi, 'I.T.');
        processed = processed.replace(/\b(AI|A\.I\.)\b/g, 'A.I.');
        processed = processed.replace(/\bIDEs\b/g, 'I.D.E.s');
        processed = processed.replace(/\bIDE\b/g, 'I.D.E.');
        processed = processed.replace(/\bUI\/UX\b/gi, 'U.I. and U.X.');
        processed = processed.replace(/\bUI-UX\b/gi, 'U.I. and U.X.');
        processed = processed.replace(/\bUI\b/g, 'U.I.');
        processed = processed.replace(/\bUX\b/g, 'U.X.');
        processed = processed.replace(/\bPCs\b/g, 'P.C.s');
        processed = processed.replace(/\bPC\b/gi, 'P.C.');
        processed = processed.replace(/\bAWS\b/gi, 'A.W.S.');
        processed = processed.replace(/\bPHP\b/gi, 'P.H.P.');
        processed = processed.replace(/\bHTML\b/gi, 'H.T.M.L.');
        processed = processed.replace(/\bCSS\b/gi, 'C.S.S.');
        processed = processed.replace(/\bQA\b/g, 'Q.A.');
        processed = processed.replace(/\bHDD\b/gi, 'H.D.D.');
        processed = processed.replace(/\bSSDs\b/gi, 'S.S.D.s');
        processed = processed.replace(/\bSSD\b/gi, 'S.S.D.');
        processed = processed.replace(/\bSNS\b/gi, 'S.N.S.');
    }

    return processed.replace(/\s{2,}/g, ' ').trim();
}
