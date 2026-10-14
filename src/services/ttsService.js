import { preprocessTextForTts } from '../utils/textToSpeechPreProcessor';

/**
 * VAlumni Natural Text-to-Speech (TTS) Service
 * 
 * Supports:
 * 1. OmniVoice / Azure Neural Voices (AngeloNeural / JamesNeural):
 *    - Native Filipino & Philippine English voices
 *    - Built-in phonetic pre-processing for university acronyms (LSPU, CCS, ID, BSIT, BSCS)
 * 2. High-Fidelity Browser SpeechSynthesis Fallback:
 *    - Automatically selects natural regional voices
 *    - Program Head vocal cadence: slightly lowered pitch (0.95), measured rate (0.95)
 */

class TtsService {
    constructor() {
        this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
        this.voices = [];
        this.isSpeaking = false;
        this.activeAudio = null;
        this.cachedPreferredVoices = null;

        if (this.synth) {
            this.loadVoices();
            if (this.synth.onvoiceschanged !== undefined) {
                this.synth.onvoiceschanged = () => this.loadVoices();
            }
        }
    }

    loadVoices() {
        if (!this.synth) return;
        this.voices = this.synth.getVoices() || [];
    }

    /**
     * Detects primary language / dialect from text (English, Tagalog, or Taglish).
     */
    detectLanguage(text) {
        if (!text) return 'en';
        const lower = text.toLowerCase();

        const tagalogIndicators = [
            'ang', 'ng', 'mga', 'sa', 'at', 'opo', 'po', 'hindi', 'oo', 'kumusta', 'kamusta',
            'natin', 'inyo', 'iyong', 'lahat', 'magandang', 'araw', 'salamat', 'kami', 'tayo',
            'para', 'pero', 'naman', 'talaga', 'tapos', 'naging', 'dahil', 'kung', 'bakit',
            'maraming', 'wala', 'meron', 'mayroon', 'ninyo', 'ating'
        ];

        let tagalogWordCount = 0;
        const words = lower.match(/\b[a-zñ]+\b/g) || [];
        words.forEach(w => {
            if (tagalogIndicators.includes(w)) tagalogWordCount++;
        });

        const ratio = tagalogWordCount / Math.max(1, words.length);
        if (ratio > 0.25) return 'fil';
        if (tagalogWordCount > 0) return 'taglish';
        return 'en';
    }

    /**
     * Finds the most natural voice for the detected language.
     */
    getBestVoice(lang = 'en') {
        if (this.voices.length === 0) this.loadVoices();

        // 1. If Tagalog / Taglish: Prefer Filipino / Philippine English voices
        if (lang === 'fil' || lang === 'taglish') {
            const filipinoVoice = this.voices.find(v => 
                v.lang.toLowerCase().startsWith('fil') || 
                v.lang.toLowerCase().startsWith('tl') ||
                v.name.toLowerCase().includes('filipino') ||
                v.name.toLowerCase().includes('tagalog') ||
                v.name.toLowerCase().includes('blessica') ||
                v.name.toLowerCase().includes('angelo')
            );
            if (filipinoVoice) return filipinoVoice;

            // Secondary preference: Philippine English (en-PH)
            const phEnglishVoice = this.voices.find(v => 
                v.lang.toLowerCase().includes('en-ph') || 
                v.name.toLowerCase().includes('philippines') ||
                v.name.toLowerCase().includes('rosa')
            );
            if (phEnglishVoice) return phEnglishVoice;
        }

        // 2. English / Default: Look for high quality Natural / Neural / Online voices (avoiding old robotic SAPI Desktop voices)
        const naturalEnglish = this.voices.find(v => 
            (v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Online')))
        );
        if (naturalEnglish) return naturalEnglish;

        // Filter out legacy robotic Windows SAPI5 voices like "Desktop David" or "Desktop Zira"
        const smoothVoices = this.voices.filter(v => !v.name.toLowerCase().includes('desktop'));
        const standardEnglish = smoothVoices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en'));
        return standardEnglish || smoothVoices[0] || this.voices[0] || null;
    }

    /**
     * Speaks the Program Head's dialogue.
     * Attempts OmniVoice backend first (if available), then falls back to Web Speech API.
     */
    async speak(text, options = {}) {
        const {
            voice,
            onStart = () => {},
            onEnd = () => {},
            onError = () => {}
        } = options;

        if (!text || !text.trim()) {
            onEnd();
            return;
        }

        this.stop(); // Stop any currently active speech

        // Preprocess text to pronounce acronyms like LSPU, ID, CCS, BSIT letter-by-letter
        const processedText = preprocessTextForTts(text);
        const lang = this.detectLanguage(processedText);

        // Preferred Neural Voice based on option or detected language
        const preferredVoice = voice || ((lang === 'en') ? 'en-PH-JamesNeural' : 'fil-PH-AngeloNeural');

        // 1. Check in-memory audio cache for instant playback
        if (!this.audioCache) this.audioCache = new Map();
        const cacheKey = `${preferredVoice}:${processedText}`;

        if (this.audioCache.has(cacheKey)) {
            const cachedAudioUrl = this.audioCache.get(cacheKey);
            const audio = new Audio(cachedAudioUrl);
            this.activeAudio = audio;

            audio.onplay = () => {
                this.isSpeaking = true;
                onStart();
            };
            audio.onended = () => {
                this.isSpeaking = false;
                this.activeAudio = null;
                onEnd();
            };
            audio.onerror = () => {
                this.speakWithWebSpeech(processedText, lang, onStart, onEnd, onError);
            };

            await audio.play().catch(() => {
                this.speakWithWebSpeech(processedText, lang, onStart, onEnd, onError);
            });
            return;
        }

        // 2. Request Natural Human Neural Audio (AngeloNeural / JamesNeural) from Backend
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // Generous timeout for high-quality audio

            const resp = await fetch('/api/tts/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: processedText,
                    voice: preferredVoice
                }),
                signal: controller.signal
            }).catch(() => null);

            clearTimeout(timeoutId);

            if (resp && resp.ok) {
                const audioBlob = await resp.blob();
                const audioUrl = URL.createObjectURL(audioBlob);
                this.audioCache.set(cacheKey, audioUrl);

                const audio = new Audio(audioUrl);
                this.activeAudio = audio;

                audio.onplay = () => {
                    this.isSpeaking = true;
                    onStart();
                };
                audio.onended = () => {
                    this.isSpeaking = false;
                    this.activeAudio = null;
                    onEnd();
                };
                audio.onerror = () => {
                    this.isSpeaking = false;
                    this.activeAudio = null;
                    this.speakWithWebSpeech(processedText, lang, onStart, onEnd, onError);
                };

                await audio.play();
                return;
            }
        } catch (e) {
            console.warn('Neural TTS endpoint note:', e);
        }

        // 3. Fallback to Web Speech API (filtering out old robotic desktop SAPI voices)
        this.speakWithWebSpeech(processedText, lang, onStart, onEnd, onError);
    }

    speakWithWebSpeech(text, lang, onStart, onEnd, onError) {
        if (!this.synth) {
            onEnd();
            return;
        }

        // Clean and expand acronyms before speaking
        const spokenText = preprocessTextForTts(text);

        const utterance = new SpeechSynthesisUtterance(spokenText);
        const selectedVoice = this.getBestVoice(lang);

        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang;
        }

        // Program Head Cadence Tuning
        utterance.rate = 0.96;  // Measured, clear academic cadence
        utterance.pitch = 0.95; // Dignified, calm tone
        utterance.volume = 1.0;

        utterance.onstart = () => {
            this.isSpeaking = true;
            onStart();
        };

        utterance.onend = () => {
            this.isSpeaking = false;
            onEnd();
        };

        utterance.onerror = (e) => {
            console.warn('SpeechSynthesis error:', e);
            this.isSpeaking = false;
            onEnd(); // Continue interview flow gracefully even if synthesis encountered an issue
        };

        this.synth.speak(utterance);
    }

    stop() {
        this.isSpeaking = false;
        if (this.activeAudio) {
            this.activeAudio.pause();
            this.activeAudio = null;
        }
        if (this.synth) {
            this.synth.cancel();
        }
    }
}

export const ttsService = new TtsService();
