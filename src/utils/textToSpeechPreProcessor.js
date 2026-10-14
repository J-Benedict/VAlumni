/**
 * TTS Text Pre-Processor
 * Solves the issue where neural TTS synthesizers pronounce acronyms
 * as single words (e.g. "LSPU" -> "Els-poo", "ID" -> "id", "CCS" -> "Cks").
 * Formats acronyms with spaced periods or phonetic letter spellings so they
 * are articulated crystal-clear letter-by-letter.
 */

export function preprocessTextForTts(text) {
    if (!text || typeof text !== 'string') return '';

    let processed = text;

    // 1. Remove markdown symbols (asterisks, hashtags, backticks, tildes)
    processed = processed.replace(/[*_#`~]/g, '');

    // 2. University & Department Acronyms (Forces letter-by-letter pronunciation: L - S - P - U)
    processed = processed.replace(/\b(LSPU|L\.S\.P\.U\.|L\.\s*S\.\s*P\.\s*U\.)\b/gi, 'L-S-P-U');
    processed = processed.replace(/\b(CCS|C\.C\.S\.|C\.\s*C\.\s*S\.)\b/gi, 'C-C-S');

    // 3. Degree Programs
    processed = processed.replace(/\b(BSIT|B\.S\.I\.T\.)\b/gi, 'B-S-I-T');
    processed = processed.replace(/\b(BSCS|B\.S\.C\.S\.)\b/gi, 'B-S-C-S');
    processed = processed.replace(/\b(MSIT|M\.S\.I\.T\.)\b/gi, 'M-S-I-T');
    processed = processed.replace(/\b(MSCS|M\.S\.C\.S\.)\b/gi, 'M-S-C-S');

    // 4. Student Identification & ID (Forces letter-by-letter: I - D or Eye-Dee instead of the psychological "id")
    processed = processed.replace(/\bStudent\s+(ID|I\.D\.|I\.\s*D\.)\b/gi, 'Student I-D');
    processed = processed.replace(/\b(ID|I\.D\.)\s+number\b/gi, 'I-D number');
    processed = processed.replace(/\b(ID|I\.D\.)\b/g, 'I-D');

    // 5. IT / Tech Acronyms
    // Match "IT" as standalone uppercase word (avoids English pronoun "it")
    processed = processed.replace(/\bIT\b/g, 'I-T');
    processed = processed.replace(/\bI\.T\.\b/gi, 'I-T');
    processed = processed.replace(/\b(AI|A\.I\.)\b/g, 'A-I');
    processed = processed.replace(/\bUI\/UX\b/gi, 'U-I U-X');
    processed = processed.replace(/\bUI-UX\b/gi, 'U-I U-X');
    processed = processed.replace(/\bUI\b/g, 'U-I');
    processed = processed.replace(/\bUX\b/g, 'U-X');
    processed = processed.replace(/\bPC\b/gi, 'P-C');
    processed = processed.replace(/\bPCs\b/gi, 'P-C-s');
    processed = processed.replace(/\bSQL\b/gi, 'S-Q-L');
    processed = processed.replace(/\bAWS\b/gi, 'A-W-S');
    processed = processed.replace(/\bPHP\b/gi, 'P-H-P');
    processed = processed.replace(/\bHTML\b/gi, 'H-T-M-L');
    processed = processed.replace(/\bCSS\b/gi, 'C-S-S');
    processed = processed.replace(/\bQA\b/gi, 'Q-A');
    processed = processed.replace(/\bHDD\b/gi, 'H-D-D');
    processed = processed.replace(/\bSSD\b/gi, 'S-D-D');
    processed = processed.replace(/\bSSDs\b/gi, 'S-D-Ds');
    processed = processed.replace(/\bWi-?Fi\b/gi, 'Wai-Fai');
    processed = processed.replace(/\bSNS\b/gi, 'S-N-S');

    return processed.trim();
}
