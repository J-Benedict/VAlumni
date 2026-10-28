import { preprocessTextForTts } from '../utils/textToSpeechPreProcessor';

/**
 * VAlumni Natural Text-to-Speech (TTS) Service with Real-Time Word-Level Synchronization
 *
 * Primary engine: Microsoft Edge Neural voices (via backend /api/tts/generate)
 *   - fil-PH-AngeloNeural / fil-PH-BlessicaNeural : native Filipino speakers (Tagalog + Taglish)
 *   - en-PH-JamesNeural / en-PH-RosaNeural        : Philippine English speakers (English only)
 *
 * Word-level synchronization:
 *   - Pre-calculates prosody & syllable-weighted timing thresholds across tokens (accounting for
 *     Tagalog/English syllable counts, acronym expansions, comma pauses, and sentence breath pauses).
 *   - Drives word reveal at 60 FPS directly from HTMLAudioElement.currentTime / duration so voice
 *     and on-screen text start at the exact same millisecond and flow synchronously word-by-word.
 */

export const NEURAL_VOICES = {
    'fil-PH-AngeloNeural': { lang: 'fil', gender: 'male', label: 'Angelo — Filipino Male (Tagalog/Taglish)' },
    'fil-PH-BlessicaNeural': { lang: 'fil', gender: 'female', label: 'Blessica — Filipino Female (Tagalog/Taglish)' },
    'en-PH-JamesNeural': { lang: 'en', gender: 'male', label: 'James — Philippine English Male (English only)' },
    'en-PH-RosaNeural': { lang: 'en', gender: 'female', label: 'Rosa — Philippine English Female (English only)' }
};

const FILIPINO_FOR_GENDER = { male: 'fil-PH-AngeloNeural', female: 'fil-PH-BlessicaNeural' };

const TAGALOG_INDICATORS = new Set([
    'ang', 'ng', 'mga', 'sa', 'opo', 'po', 'hindi', 'oo', 'kumusta', 'kamusta', 'natin', 'inyo',
    'iyong', 'lahat', 'magandang', 'araw', 'salamat', 'kami', 'tayo', 'para', 'pero', 'naman',
    'talaga', 'tapos', 'naging', 'dahil', 'kung', 'bakit', 'maraming', 'wala', 'meron', 'mayroon',
    'ninyo', 'ating', 'ako', 'ikaw', 'ito', 'iyan', 'niyan', 'mo', 'ko', 'ka', 'ba', 'na', 'pa',
    'nang', 'din', 'rin', 'lang', 'sino', 'ano', 'paano', 'gaano', 'aling', 'bilang', 'upang',
    'maaari', 'bang', 'sabihin', 'pangalan', 'iyo', 'nais', 'naming', 'marinig', 'karanasan'
]);

const NEURAL_TIMEOUT_MS = 25000;

/**
 * Splits display text into word tokens while preserving trailing whitespace/newlines.
 */
export function tokenizeTextForSync(text = '') {
    if (!text || typeof text !== 'string') return [];
    return text.match(/\S+\s*/g) || [];
}

/**
 * Builds a prosody-weighted normalized timeline [0..1] for each word token so on-screen
 * word reveal matches human/neural cadence, acronym pronunciation length, and punctuation pauses.
 */
export function buildWordSyncSchedule(text = '') {
    const tokens = tokenizeTextForSync(text);
    const count = tokens.length;
    if (count === 0) {
        return { tokens: [], startThresholds: [], estimatedDurationSec: 0.5, getVisibleCount: () => 0 };
    }

    const speakWeights = [];
    const pauseWeights = [];
    let totalSyllables = 0;

    for (let i = 0; i < count; i++) {
        const raw = tokens[i].trim();
        const core = raw.replace(/^[^A-Za-z0-9Ññ]+|[^A-Za-z0-9Ññ]+$/g, '');

        let speakWeight = 3.0;
        if (/^(LSPU|BSIT|BSCS|MSIT|MSCS|HTML|AWS)$/i.test(core)) {
            speakWeight = 11.0; // 4-syllable initialisms ("El-Es-Pi-Yu")
            totalSyllables += 4;
        } else if (/^(CCS|IDE|IDEs|SQL|PHP|CSS|HDD|SSD|SSDs|SNS)$/i.test(core)) {
            speakWeight = 8.5;  // 3-syllable initialisms ("Si-Si-Es")
            totalSyllables += 3;
        } else if (/^(ID|IT|AI|UI|UX|PC|PCs|QA|BS)$/i.test(core)) {
            speakWeight = 5.6;  // 2-syllable initialisms ("Ay-Di")
            totalSyllables += 2;
        } else if (/^UI[\/-]UX$/i.test(core)) {
            speakWeight = 12.5; // "Yu-Ay at Yu-Eks"
            totalSyllables += 5;
        } else if (/^\d+$/.test(core)) {
            speakWeight = Math.max(4.2, core.length * 4.2);
            totalSyllables += Math.max(1, core.length);
        } else {
            const vowelGroups = (core.match(/[aeiouyáéíóú]+/gi) || []).length || 1;
            totalSyllables += vowelGroups;
            speakWeight = Math.max(2.4, vowelGroups * 2.5 + core.length * 0.35);
        }

        // Natural breath pauses after punctuation
        let pauseWeight = 0.55;
        if (i === count - 1) {
            pauseWeight = 1.8;
        } else if (/[.!?]["')\]]*$/.test(raw)) {
            pauseWeight = 11.0; // Sentence boundary pause (~400ms)
        } else if (/[:;—]["')\]]*$/.test(raw) || raw.includes('—')) {
            pauseWeight = 6.8;  // Clause / em-dash pause (~250ms)
        } else if (/[,]["')\]]*$/.test(raw)) {
            pauseWeight = 5.2;  // Comma pause (~190ms)
        }

        speakWeights.push(speakWeight);
        pauseWeights.push(pauseWeight);
    }

    const totalWeight = speakWeights.reduce((acc, w, idx) => acc + w + pauseWeights[idx], 0) || 1;
    const startThresholds = [];
    let cumulative = 0;

    for (let i = 0; i < count; i++) {
        startThresholds.push(cumulative / totalWeight);
        cumulative += speakWeights[i] + pauseWeights[i];
    }

    const estimatedDurationSec = Math.max(1.2, totalSyllables / 4.8);

    const getVisibleCount = (progress) => {
        if (progress <= 0) return 1;
        if (progress >= 0.995) return count;
        let visible = 1;
        for (let i = 0; i < count; i++) {
            if (progress >= startThresholds[i]) {
                visible = i + 1;
            } else {
                break;
            }
        }
        return visible;
    };

    return {
        tokens,
        startThresholds,
        estimatedDurationSec,
        getVisibleCount
    };
}

class TtsService {
    constructor() {
        this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
        this.voices = [];
        this.isSpeaking = false;
        this.activeAudio = null;
        this.syncRafId = null;
        this.browserSyncTimer = null;
        this.audioCache = new Map();
        this.inflightFetches = new Map();
        this.lastEngine = null; // 'neural' | 'browser' | 'none'
        this.onEngineStatus = null;

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

    detectLanguage(text) {
        if (!text) return 'en';
        const words = text.toLowerCase().match(/\b[a-zñ]+\b/g) || [];
        let tagalogWordCount = 0;
        words.forEach(w => { if (TAGALOG_INDICATORS.has(w)) tagalogWordCount++; });

        const ratio = tagalogWordCount / Math.max(1, words.length);
        if (ratio > 0.2) return 'fil';
        if (tagalogWordCount >= 2) return 'taglish';
        return 'en';
    }

    resolveVoice(requestedVoice, lang) {
        const meta = NEURAL_VOICES[requestedVoice];
        if (!meta) {
            return lang === 'en' ? 'en-PH-JamesNeural' : 'fil-PH-AngeloNeural';
        }
        if ((lang === 'fil' || lang === 'taglish') && meta.lang === 'en') {
            return FILIPINO_FOR_GENDER[meta.gender];
        }
        return requestedVoice;
    }

    reportEngine(status) {
        this.lastEngine = status;
        if (typeof this.onEngineStatus === 'function') {
            try { this.onEngineStatus(status); } catch (e) {}
        }
    }

    getMatchingBrowserVoice(lang) {
        if (this.voices.length === 0) this.loadVoices();

        if (lang === 'fil' || lang === 'taglish') {
            return this.voices.find(v =>
                v.lang.toLowerCase().startsWith('fil') ||
                v.lang.toLowerCase().startsWith('tl') ||
                /filipino|tagalog/i.test(v.name)
            ) || null;
        }

        const phEnglish = this.voices.find(v => v.lang.toLowerCase() === 'en-ph');
        if (phEnglish) return phEnglish;
        const natural = this.voices.find(v => v.lang.startsWith('en') && /Natural|Neural|Online|Google/i.test(v.name));
        if (natural) return natural;
        return this.voices.find(v => v.lang.startsWith('en') && !/desktop/i.test(v.name)) || null;
    }

    clearSyncLoops() {
        if (this.syncRafId) {
            cancelAnimationFrame(this.syncRafId);
            this.syncRafId = null;
        }
        if (this.browserSyncTimer) {
            clearInterval(this.browserSyncTimer);
            this.browserSyncTimer = null;
        }
    }

    playAudioUrl(url, schedule, { onStart, onProgress, onEnd, onFail }) {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.preload = 'auto';
            audio.src = url;
            this.activeAudio = audio;
            let settled = false;
            let lastEmittedCount = 0;

            const totalWords = schedule.tokens.length;

            const startSyncLoop = () => {
                const tick = () => {
                    if (settled || this.activeAudio !== audio) return;

                    const rawDuration = (Number.isFinite(audio.duration) && audio.duration > 0.2)
                        ? audio.duration
                        : schedule.estimatedDurationSec;

                    // Trim ~50ms leading MP3 pad and ~140ms trailing MP3 silence for tight lip/word sync
                    const effectiveElapsed = Math.max(0, audio.currentTime - 0.045);
                    const effectiveDuration = Math.max(0.35, rawDuration - 0.16);
                    const progress = Math.min(1, effectiveElapsed / effectiveDuration);
                    const visibleWordCount = schedule.getVisibleCount(progress);

                    if (visibleWordCount > lastEmittedCount) {
                        lastEmittedCount = visibleWordCount;
                        onProgress({
                            visibleWordCount,
                            totalWords,
                            tokens: schedule.tokens,
                            progress
                        });
                    }

                    this.syncRafId = requestAnimationFrame(tick);
                };

                this.syncRafId = requestAnimationFrame(tick);
            };

            audio.onplay = () => {
                this.isSpeaking = true;
                lastEmittedCount = 1;
                onStart({ tokens: schedule.tokens, totalWords });
                onProgress({
                    visibleWordCount: 1,
                    totalWords,
                    tokens: schedule.tokens,
                    progress: 0
                });
                startSyncLoop();
            };

            audio.onended = () => {
                this.clearSyncLoops();
                this.isSpeaking = false;
                this.activeAudio = null;
                if (!settled) {
                    settled = true;
                    onProgress({
                        visibleWordCount: totalWords,
                        totalWords,
                        tokens: schedule.tokens,
                        progress: 1
                    });
                    onEnd();
                    resolve(true);
                }
            };

            audio.onerror = () => {
                this.clearSyncLoops();
                this.isSpeaking = false;
                this.activeAudio = null;
                if (!settled) {
                    settled = true;
                    onFail();
                    resolve(false);
                }
            };

            const beginPlayback = () => {
                audio.play().catch(() => {
                    this.clearSyncLoops();
                    if (!settled) {
                        settled = true;
                        onFail();
                        resolve(false);
                    }
                });
            };

            // Ensure MP3 duration metadata is parsed before firing play() so frame-1 sync is exact
            if (audio.readyState >= 1) {
                beginPlayback();
            } else {
                let started = false;
                const onceReady = () => {
                    if (!started && !settled) {
                        started = true;
                        beginPlayback();
                    }
                };
                audio.addEventListener('loadedmetadata', onceReady, { once: true });
                setTimeout(onceReady, 120);
            }
        });
    }

    /**
     * Fetches or reuses an in-flight/cached neural audio Blob URL.
     */
    async getOrFetchNeuralUrl(processedText, neuralVoice) {
        const cacheKey = `${neuralVoice}:${processedText}`;
        if (this.audioCache.has(cacheKey)) {
            return this.audioCache.get(cacheKey);
        }
        if (this.inflightFetches.has(cacheKey)) {
            return this.inflightFetches.get(cacheKey);
        }

        const fetchPromise = this.fetchNeuralAudio(processedText, neuralVoice)
            .then((url) => {
                if (url) this.audioCache.set(cacheKey, url);
                return url;
            })
            .finally(() => {
                this.inflightFetches.delete(cacheKey);
            });

        this.inflightFetches.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    /**
     * Speaks the Program Head's dialogue with synchronized word-by-word progress callbacks.
     */
    async speak(text, options = {}) {
        const {
            voice,
            onStart = () => {},
            onProgress = () => {},
            onEnd = () => {}
        } = options;

        if (!text || !text.trim()) {
            onEnd();
            return;
        }

        this.stop();

        const schedule = buildWordSyncSchedule(text);
        const lang = this.detectLanguage(text);
        const neuralVoice = this.resolveVoice(voice, lang);
        const processedText = preprocessTextForTts(text, neuralVoice);
        const fallback = () => this.speakWithBrowserVoice(processedText, schedule, lang, onStart, onProgress, onEnd);

        try {
            const url = await this.getOrFetchNeuralUrl(processedText, neuralVoice);
            if (url) {
                this.reportEngine('neural');
                await this.playAudioUrl(url, schedule, {
                    onStart,
                    onProgress,
                    onEnd,
                    onFail: fallback
                });
                return;
            }
        } catch (e) {
            console.warn('Neural TTS unavailable:', e);
        }

        fallback();
    }

    async fetchNeuralAudio(text, voice) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NEURAL_TIMEOUT_MS);
        try {
            const resp = await fetch('/api/tts/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice }),
                signal: controller.signal
            });
            if (!resp.ok) {
                console.warn('Neural TTS endpoint returned', resp.status);
                return null;
            }
            const blob = await resp.blob();
            if (!blob || blob.size < 500) return null;
            return URL.createObjectURL(blob);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Pre-generates and caches audio in the background so upcoming stages start with 0ms delay.
     */
    async prefetch(text, voice) {
        if (!text) return;
        const lang = this.detectLanguage(text);
        const neuralVoice = this.resolveVoice(voice, lang);
        const processedText = preprocessTextForTts(text, neuralVoice);
        try {
            await this.getOrFetchNeuralUrl(processedText, neuralVoice);
        } catch (e) { /* prefetch is best-effort */ }
    }

    speakWithBrowserVoice(processedText, schedule, lang, onStart, onProgress, onEnd) {
        const selectedVoice = this.synth ? this.getMatchingBrowserVoice(lang) : null;
        const totalWords = schedule.tokens.length;

        if (!selectedVoice) {
            // Neural TTS offline and no matching browser voice: smoothly stream text word-by-word at reading speed
            console.warn(`No browser voice for '${lang}'. Streaming text smoothly.`);
            this.reportEngine('none');
            onStart({ tokens: schedule.tokens, totalWords });
            let visible = 1;
            onProgress({ visibleWordCount: 1, totalWords, tokens: schedule.tokens, progress: 0 });
            const stepMs = Math.max(45, Math.min(110, Math.round((schedule.estimatedDurationSec * 1000) / Math.max(1, totalWords))));
            this.browserSyncTimer = setInterval(() => {
                visible += 1;
                if (visible >= totalWords) {
                    this.clearSyncLoops();
                    onProgress({ visibleWordCount: totalWords, totalWords, tokens: schedule.tokens, progress: 1 });
                    onEnd();
                } else {
                    onProgress({ visibleWordCount: visible, totalWords, tokens: schedule.tokens, progress: visible / totalWords });
                }
            }, stepMs);
            return;
        }

        this.reportEngine('browser');
        const utterance = new SpeechSynthesisUtterance(processedText);
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        let startedAt = 0;

        utterance.onstart = () => {
            this.isSpeaking = true;
            startedAt = performance.now();
            onStart({ tokens: schedule.tokens, totalWords });
            onProgress({ visibleWordCount: 1, totalWords, tokens: schedule.tokens, progress: 0 });

            this.browserSyncTimer = setInterval(() => {
                const elapsedSec = (performance.now() - startedAt) / 1000;
                const progress = Math.min(0.98, elapsedSec / schedule.estimatedDurationSec);
                const visibleWordCount = schedule.getVisibleCount(progress);
                onProgress({ visibleWordCount, totalWords, tokens: schedule.tokens, progress });
            }, 40);
        };

        utterance.onboundary = (event) => {
            if (event.name === 'word' && processedText.length > 0) {
                const progress = Math.min(1, event.charIndex / processedText.length);
                const visibleWordCount = schedule.getVisibleCount(progress);
                onProgress({ visibleWordCount, totalWords, tokens: schedule.tokens, progress });
            }
        };

        utterance.onend = () => {
            this.clearSyncLoops();
            this.isSpeaking = false;
            onProgress({ visibleWordCount: totalWords, totalWords, tokens: schedule.tokens, progress: 1 });
            onEnd();
        };

        utterance.onerror = (e) => {
            console.warn('SpeechSynthesis error:', e);
            this.clearSyncLoops();
            this.isSpeaking = false;
            onProgress({ visibleWordCount: totalWords, totalWords, tokens: schedule.tokens, progress: 1 });
            onEnd();
        };

        this.synth.speak(utterance);
    }

    stop() {
        this.clearSyncLoops();
        this.isSpeaking = false;
        if (this.activeAudio) {
            this.activeAudio.onplay = null;
            this.activeAudio.onended = null;
            this.activeAudio.onerror = null;
            this.activeAudio.pause();
            this.activeAudio = null;
        }
        if (this.synth) {
            this.synth.cancel();
        }
    }
}

export const ttsService = new TtsService();
