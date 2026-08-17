import React, { useState, useEffect, useRef } from 'react';
import { LSPU_SURVEY_STRUCTURE, DATA_PRIVACY_TEXT, analyzeSentiment, correctFilipinoName, convertWordsToDigits, refineTranscriptWithGemini, getNameSpellingSuggestions } from '../services/aiService';
import { saveInterviewTranscript } from '../utils/transcriptStorage';
import { Mic, MicOff, Volume2, VolumeX, ShieldCheck, Play, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, RefreshCw, Award, Sparkles, FileText, Lock, Key } from 'lucide-react';

export default function VoiceInterview({ onInterviewComplete }) {
    // Navigation & Flow State: 'landing' -> 'privacy' -> 'survey' -> 'summary'
    const [flowStage, setFlowStage] = useState('landing');
    const [privacyAgreed, setPrivacyAgreed] = useState(false);

    // Survey Question Navigation Indexing
    const allQuestions = LSPU_SURVEY_STRUCTURE.flatMap(sec => sec.questions.map(q => ({ ...q, sectionTitle: sec.sectionTitle, sectionId: sec.sectionId })));
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const currentQuestion = allQuestions[currentQIndex];

    // User Responses Dictionary { questionId: responseTextOrValue }
    const [responses, setResponses] = useState({});

    // Voice Recognition (STT) State
    const [isListening, setIsListening] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [apiKey, setApiKey] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('valumni_gemini_api_key')) || '');
    const [showKeyInput, setShowKeyInput] = useState(false);

    const [liveTranscript, setLiveTranscript] = useState('');
    const [transcriptAccumulated, setTranscriptAccumulated] = useState(''); // Prevents transcript deletion on mic re-press!
    const [speechSupported, setSpeechSupported] = useState(true);
    const [micVolume, setMicVolume] = useState(0); // Live microphone input signal volume (0-100%)

    // Voice Synthesis (TTS) State
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [ttsEnabled, setTtsEnabled] = useState(true);

    // Speech Recognition & Audio Meter Instances
    const recognitionRef = useRef(null);
    const synthRef = useRef(null);
    const currentQuestionRef = useRef(currentQuestion);
    const shouldListenRef = useRef(false);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const streamRef = useRef(null);
    const animFrameRef = useRef(null);

    // Keep currentQuestionRef synchronized with active question
    useEffect(() => {
        currentQuestionRef.current = currentQuestion;
    }, [currentQuestion]);

    // Start Web Audio API Microphone Signal Meter for Laptop Mics
    const startVolumeMeter = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef.current = audioCtx;
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            analyserRef.current = analyser;
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateVolume = () => {
                if (!analyserRef.current) return;
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;
                const volumePercent = Math.min(100, Math.round((average / 128) * 100));
                setMicVolume(volumePercent);
                animFrameRef.current = requestAnimationFrame(updateVolume);
            };
            updateVolume();
        } catch (err) {
            console.log('Mic volume meter start error:', err);
        }
    };

    // Stop Web Audio API Volume Meter
    const stopVolumeMeter = () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch (e) { }
            audioContextRef.current = null;
        }
        setMicVolume(0);
    };

    // Initialize Web Speech API
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setSpeechSupported(false);
        } else {
            const rec = new SpeechRecognition();
            rec.continuous = true;
            rec.interimResults = true;
            // Use Philippine English locale for optimal Filipino name and accent speech recognition
            try {
                rec.lang = 'en-PH';
            } catch (err) {
                rec.lang = 'en-US';
            }

            rec.onstart = () => {
                setIsListening(true);
                shouldListenRef.current = true;
                startVolumeMeter();
            };

            rec.onresult = (event) => {
                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcriptChunk = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        final += transcriptChunk + ' ';
                    } else {
                        interim += transcriptChunk;
                    }
                }

                const activeQ = currentQuestionRef.current;
                let fieldType = null;
                let isNumericField = false;

                if (activeQ) {
                    if (activeQ.id === 'demo_lastname') fieldType = 'lastname';
                    else if (activeQ.id === 'demo_firstname') fieldType = 'firstname';
                    else if (activeQ.id === 'demo_middleinitial') fieldType = 'middleinitial';

                    if (activeQ.id === 'demo_studentid' || activeQ.id === 'demo_grad_year' || activeQ.type === 'rating') {
                        isNumericField = true;
                    }
                }

                setLiveTranscript(() => {
                    let newCommitted = (transcriptAccumulated + ' ' + final + interim).trim();
                    if (fieldType) {
                        newCommitted = correctFilipinoName(newCommitted, fieldType);
                    }
                    if (isNumericField) {
                        newCommitted = convertWordsToDigits(newCommitted);
                    }
                    return newCommitted;
                });

                if (final) {
                    setTranscriptAccumulated(prev => {
                        let updated = (prev + ' ' + final).trim();
                        if (fieldType) {
                            updated = correctFilipinoName(updated, fieldType);
                        }
                        if (isNumericField) {
                            updated = convertWordsToDigits(updated);
                        }
                        return updated;
                    });
                }
            };

            rec.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                if (event.error === 'no-speech' && shouldListenRef.current) {
                    // Ignore no-speech pause and keep listening for laptop mics
                    return;
                }
                stopVolumeMeter();
            };

            rec.onend = () => {
                stopVolumeMeter();
                // Auto-restart Web Speech API if user hasn't explicitly clicked stop (vital for laptop mic pauses)
                if (shouldListenRef.current) {
                    try {
                        rec.start();
                    } catch (e) {
                        setIsListening(false);
                        shouldListenRef.current = false;
                    }
                } else {
                    setIsListening(false);
                }
            };

            recognitionRef.current = rec;
        }

        if ('speechSynthesis' in window) {
            synthRef.current = window.speechSynthesis;
        }

        return () => {
            if (recognitionRef.current) recognitionRef.current.stop();
            if (synthRef.current) synthRef.current.cancel();
        };
    }, []);

    // Update live transcript when question changes or loaded from previous responses
    useEffect(() => {
        if (flowStage === 'survey' && currentQuestion) {
            const existingAnswer = responses[currentQuestion.id] || '';
            setLiveTranscript(existingAnswer);
            setTranscriptAccumulated(existingAnswer);

            // Auto-speak question if TTS is enabled
            if (ttsEnabled && synthRef.current) {
                speakText(currentQuestion.question);
            }
        }
    }, [currentQIndex, flowStage]);

    // TTS Speak Helper
    const speakText = (text) => {
        if (!synthRef.current || !ttsEnabled) return;
        synthRef.current.cancel(); // Stop ongoing speech
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        synthRef.current.speak(utterance);
    };

    // Toggle Voice Recording without deleting previous transcripts
    const toggleListening = () => {
        if (!speechSupported) {
            alert('Web Speech API is not supported in your browser. Please use Google Chrome or Microsoft Edge.');
            return;
        }

        // Cancel any ongoing TTS speech so audio doesn't bleed into mic
        if (synthRef.current) {
            synthRef.current.cancel();
            setIsSpeaking(false);
        }

        if (isListening) {
            shouldListenRef.current = false;
            stopVolumeMeter();
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch (e) { }
            }
            setIsListening(false);
        } else {
            shouldListenRef.current = true;
            setTranscriptAccumulated(liveTranscript);
            try {
                recognitionRef.current.start();
            } catch (err) {
                console.log('Recognition start error:', err);
            }
        }
    };

    // Save current answer and advance to next question with Gemini Flash AI post-processing
    const handleSaveAndNext = async () => {
        shouldListenRef.current = false;
        stopVolumeMeter();
        if (isListening && recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch (e) { }
            setIsListening(false);
        }

        let rawResponseText = liveTranscript.trim();
        let finalResponseText = rawResponseText;

        if (rawResponseText) {
            setIsRefining(true);
            try {
                finalResponseText = await refineTranscriptWithGemini(rawResponseText, currentQuestion, apiKey);
                setLiveTranscript(finalResponseText);
            } catch (err) {
                console.error("Gemini post-processing error:", err);
            } finally {
                setIsRefining(false);
            }
        }

        // Save response for current question
        setResponses(prev => ({
            ...prev,
            [currentQuestion.id]: finalResponseText
        }));

        if (currentQIndex < allQuestions.length - 1) {
            setCurrentQIndex(prev => prev + 1);
        } else {
            // Build final responses including current answer
            const finalResponses = { ...responses, [currentQuestion.id]: finalResponseText };
            setResponses(finalResponses);

            // Persist transcript to localStorage
            const savedRecord = saveInterviewTranscript(finalResponses, allQuestions);
            console.log('Interview transcript saved:', savedRecord);

            setFlowStage('summary');
            if (onInterviewComplete) onInterviewComplete(finalResponses);
        }
    };


    // Previous question
    const handlePrev = () => {
        if (currentQIndex > 0) {
            setCurrentQIndex(prev => prev - 1);
        }
    };

    // Handle choice or rating click
    const handleSelectOption = (value) => {
        setLiveTranscript(value);
        setTranscriptAccumulated(value);
        setResponses(prev => ({
            ...prev,
            [currentQuestion.id]: value
        }));
    };

    // Calculate sentiment analysis on current voice transcript
    const currentSentiment = analyzeSentiment(liveTranscript);

    // --------------------------------------------------------------------------
    // RENDER STAGE 1: LANDING SCREEN WITH START BUTTON
    // --------------------------------------------------------------------------
    if (flowStage === 'landing') {
        return (
            <div className="max-w-4xl mx-auto px-4 py-12">
                <div className="glass-panel rounded-3xl p-8 md:p-12 border border-indigo-500/20 text-center space-y-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl -z-10"></div>
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl -z-10"></div>

                    <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-mono">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>LSPU Alumni Exit Interview Questionnaire (CCS Edition)</span>
                    </div>

                    <div className="space-y-4 max-w-2xl mx-auto">
                        <h1 className="text-3xl md:text-5xl font-black text-white leading-tight">
                            Welcome to the <br />
                            <span className="bg-gradient-to-r from-indigo-400 via-amber-300 to-emerald-400 bg-clip-text text-transparent">
                                VAlumni AI Voice Assistant
                            </span>
                        </h1>
                        <p className="text-slate-300 text-sm md:text-base leading-relaxed">
                            Please complete this voice-assisted exit interview to help evaluate and improve the College of Computer Studies curriculum, laboratory infrastructure, and mentorship for future LSPU students.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left pt-4 max-w-3xl mx-auto">
                        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                            <div className="flex items-center space-x-2 text-indigo-400 font-bold text-xs">
                                <Mic className="w-4 h-4 text-amber-400" />
                                <span>100% Voice-Driven</span>
                            </div>
                            <p className="text-xs text-slate-400">Speak naturally using your browser microphone. No typing required.</p>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                            <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs">
                                <ShieldCheck className="w-4 h-4" />
                                <span>RA 10173 Protected</span>
                            </div>
                            <p className="text-xs text-slate-400">Strict data privacy, confidentiality, and anonymization protocols.</p>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                            <div className="flex items-center space-x-2 text-purple-400 font-bold text-xs">
                                <Award className="w-4 h-4" />
                                <span>Instant Insights</span>
                            </div>
                            <p className="text-xs text-slate-400">Real-time sentiment scoring and thematic curriculum analysis.</p>
                        </div>
                    </div>

                    <div className="pt-4">
                        <button
                            onClick={() => setFlowStage('privacy')}
                            className="inline-flex items-center space-x-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-amber-500 hover:from-indigo-500 hover:to-amber-400 text-white font-extrabold text-base shadow-xl shadow-indigo-600/30 transition-all transform hover:scale-105"
                        >
                            <Play className="w-5 h-5 fill-current" />
                            <span>Start Exit Interview</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --------------------------------------------------------------------------
    // RENDER STAGE 2: DATA PRIVACY ACT CONSENT SCREEN
    // --------------------------------------------------------------------------
    if (flowStage === 'privacy') {
        return (
            <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
                <div className="glass-panel rounded-3xl p-8 border border-indigo-500/20 space-y-6">
                    <div className="flex items-center space-x-3 border-b border-slate-800 pb-4">
                        <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            <ShieldCheck className="w-6 h-6 text-amber-400" />
                        </div>
                        <div>
                            <span className="text-xs font-mono text-indigo-400">Compliance Step</span>
                            <h2 className="text-2xl font-extrabold text-white">RA 10173 Data Privacy Act Notice</h2>
                        </div>
                    </div>

                    {/* Privacy Notice Text Box matching user screenshot */}
                    <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 font-sans text-xs text-slate-300 leading-relaxed whitespace-pre-line space-y-4 max-h-80 overflow-y-auto">
                        {DATA_PRIVACY_TEXT}
                    </div>

                    {/* Consent Checkbox matching user screenshot */}
                    <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center space-x-3">
                        <input
                            type="checkbox"
                            id="privacyConsent"
                            checked={privacyAgreed}
                            onChange={(e) => setPrivacyAgreed(e.target.checked)}
                            className="w-5 h-5 accent-indigo-500 rounded cursor-pointer"
                        />
                        <label htmlFor="privacyConsent" className="text-sm font-semibold text-white cursor-pointer select-none">
                            Yes, I agree and consent to the data processing terms above.
                        </label>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2">
                        <button
                            onClick={() => setFlowStage('landing')}
                            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                        >
                            Back
                        </button>

                        <button
                            onClick={() => setFlowStage('survey')}
                            disabled={!privacyAgreed}
                            className={`flex items-center space-x-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all ${privacyAgreed
                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/25 transform hover:scale-105'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800'
                                }`}
                        >
                            <span>I Consent & Continue to Voice Interview</span>
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --------------------------------------------------------------------------
    // RENDER STAGE 3: VOICE INTERVIEW SURVEY QUESTION WORKFLOW
    // --------------------------------------------------------------------------
    if (flowStage === 'survey') {
        return (
            <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
                {/* Progress Header */}
                <div className="glass-panel rounded-2xl p-4 border border-slate-800 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <span className="text-xs font-mono px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            Section 0{currentQuestion.sectionId} of 05
                        </span>
                        <h3 className="text-xs font-bold text-slate-300 hidden md:block">{currentQuestion.sectionTitle}</h3>
                    </div>

                    <div className="flex items-center space-x-3">
                        <span className="text-xs font-mono text-amber-300 font-bold">
                            Question {currentQIndex + 1} / {allQuestions.length}
                        </span>

                        {/* Google AI Studio Gemini API Key Setting Button */}
                        <button
                            onClick={() => setShowKeyInput(!showKeyInput)}
                            className={`flex items-center space-x-1.5 px-3 py-1 rounded-xl text-xs font-mono border transition-all ${apiKey
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                }`}
                            title="Configure Google AI Studio API Key for Post-Processing"
                        >
                            <Key className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{apiKey ? 'Gemini AI Active' : 'Set Gemini Key'}</span>
                        </button>

                        {/* TTS Mute Toggle */}
                        <button
                            onClick={() => {
                                setTtsEnabled(!ttsEnabled);
                                if (isSpeaking && synthRef.current) synthRef.current.cancel();
                            }}
                            className={`p-2 rounded-xl border transition-all ${ttsEnabled ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' : 'bg-slate-800 text-slate-500 border-slate-800'
                                }`}
                            title={ttsEnabled ? "Mute Voice Assistant" : "Enable Voice Assistant"}
                        >
                            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {/* Gemini API Key Inline Configuration Modal / Bar */}
                {showKeyInput && (
                    <div className="glass-panel rounded-2xl p-4 border border-indigo-500/30 space-y-3 bg-slate-900/90">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-2">
                                <Key className="w-4 h-4 text-amber-400" />
                                Google AI Studio API Key (Gemini Flash Post-Processor)
                            </span>
                            <button
                                onClick={() => setShowKeyInput(false)}
                                className="text-xs text-slate-400 hover:text-white"
                            >
                                ✕ Close
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-300">
                            Paste your Google AI Studio API key below to enable intelligent post-processing for single letters (middle initial), ratings, and student IDs. Your key is saved locally in your browser.
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => {
                                    setApiKey(e.target.value);
                                    if (typeof localStorage !== 'undefined') {
                                        localStorage.setItem('valumni_gemini_api_key', e.target.value);
                                    }
                                }}
                                placeholder="AIzaSy..."
                                className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                            <button
                                onClick={() => setShowKeyInput(false)}
                                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                            >
                                Save Key
                            </button>
                        </div>
                    </div>
                )}


                {/* AI Voice Assistant Prompt Box */}
                <div className="glass-panel rounded-3xl p-6 md:p-8 border border-indigo-500/30 space-y-4 relative overflow-hidden">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center space-x-3">
                            <div className="p-3 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                                <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
                            </div>
                            <div>
                                <span className="text-xs font-mono text-indigo-400">AI Exit Interview Assistant</span>
                                <h2 className="text-lg md:text-xl font-bold text-white leading-snug">{currentQuestion.question}</h2>
                            </div>
                        </div>

                        <button
                            onClick={() => speakText(currentQuestion.question)}
                            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 shrink-0"
                            title="Repeat AI Question Audio"
                        >
                            <Volume2 className={`w-4 h-4 ${isSpeaking ? 'text-amber-400 animate-bounce' : ''}`} />
                        </button>
                    </div>

                    {currentQuestion.promptHint && (
                        <p className="text-xs font-mono text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                            💡 Hint / Format: <span className="text-indigo-300">{currentQuestion.promptHint}</span>
                        </p>
                    )}
                </div>

                {/* Choice or Rating Helper Buttons if applicable */}
                {currentQuestion.type === 'choice' && (
                    <div className="glass-panel rounded-3xl p-6 border border-slate-800 space-y-3">
                        <label className="text-xs font-mono text-slate-400">Select option or speak your response:</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {currentQuestion.options.map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => handleSelectOption(opt)}
                                    className={`p-4 rounded-2xl text-left text-xs font-semibold transition-all border ${liveTranscript === opt
                                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-600/30'
                                        : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                                        }`}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {currentQuestion.type === 'rating' && (
                    <div className="glass-panel rounded-3xl p-6 border border-indigo-500/30 space-y-3">
                        <label className="text-xs font-mono text-indigo-300 font-semibold">👆 Tap your rating below:</label>
                        <div className="grid grid-cols-5 gap-3">
                            {[1, 2, 3, 4, 5].map((val) => (
                                <button
                                    key={val}
                                    onClick={() => handleSelectOption(val.toString())}
                                    className={`p-5 rounded-2xl text-center font-bold text-lg transition-all border ${liveTranscript === val.toString()
                                        ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-lg shadow-amber-500/30 scale-110'
                                        : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 hover:scale-105'
                                        }`}
                                >
                                    {val}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 px-1">
                            <span>1 = Poor</span>
                            <span>5 = Excellent</span>
                        </div>
                        {liveTranscript && (
                            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-center">
                                <span className="text-sm font-bold text-emerald-400">Selected: {liveTranscript}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Quick Letter Selector Grid for Middle Initial */}
                {currentQuestion.id === 'demo_middleinitial' && (
                    <div className="glass-panel rounded-3xl p-5 border border-indigo-500/30 space-y-3">
                        <label className="text-xs font-mono text-indigo-300 font-semibold">👆 Tap your Middle Initial below:</label>
                        <div className="grid grid-cols-7 sm:grid-cols-10 gap-2">
                            {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'N/A'].map((letter) => {
                                const initialVal = letter === 'N/A' ? 'N/A' : letter + '.';
                                return (
                                    <button
                                        key={letter}
                                        onClick={() => handleSelectOption(initialVal)}
                                        className={`p-3 rounded-xl font-bold text-sm transition-all border ${liveTranscript === initialVal
                                            ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md shadow-amber-500/30 scale-110'
                                            : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 hover:scale-105'
                                            }`}
                                    >
                                        {letter}
                                    </button>
                                );
                            })}
                        </div>
                        {liveTranscript && (
                            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-center">
                                <span className="text-sm font-bold text-emerald-400">Selected: {liveTranscript}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* VOICE INPUT DISPLAY CONTAINER — Hidden for rating and middle initial (button-only) */}
                {currentQuestion.type !== 'rating' && currentQuestion.id !== 'demo_middleinitial' && (
                    <div className="glass-panel rounded-3xl p-6 border border-slate-800 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div className="flex items-center space-x-2">
                                <Mic className={`w-4 h-4 ${isListening ? 'text-rose-500 animate-ping' : 'text-indigo-400'}`} />
                                <h4 className="text-xs font-mono text-slate-300 font-semibold">
                                    Transcribed Spoken Voice Response
                                </h4>
                            </div>

                            {/* Clear Transcript Button */}
                            {liveTranscript && (
                                <button
                                    onClick={() => {
                                        setLiveTranscript('');
                                        setTranscriptAccumulated('');
                                    }}
                                    className="text-[11px] font-mono text-rose-400 hover:text-rose-300 underline"
                                >
                                    Clear Audio Transcript
                                </button>
                            )}
                        </div>

                        {/* Voice Display Speech Box (Editable Text Area) */}
                        <div className="space-y-3">
                            <textarea
                                value={liveTranscript}
                                onChange={(e) => {
                                    setLiveTranscript(e.target.value);
                                    setTranscriptAccumulated(e.target.value);
                                }}
                                placeholder="Press the microphone button below to speak, or click here to type/edit your answer..."
                                rows={currentQuestion.id === 'demo_firstname' || currentQuestion.id === 'demo_lastname' ? 2 : 3}
                                className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-sm font-sans text-white leading-relaxed text-center font-medium focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
                            />

                            {/* Name Spelling Suggestion Chips (e.g. Railey, Riley, Bryan, Brian) */}
                            {getNameSpellingSuggestions(liveTranscript).length > 0 && (
                                <div className="p-3 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 space-y-2 text-center">
                                    <span className="text-xs font-mono text-indigo-300 font-semibold block">
                                        ✨ Spelling Suggestions (Tap to select your exact name):
                                    </span>
                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                        {getNameSpellingSuggestions(liveTranscript).map((candidate) => (
                                            <button
                                                key={candidate}
                                                onClick={() => {
                                                    setLiveTranscript(candidate);
                                                    setTranscriptAccumulated(candidate);
                                                }}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${liveTranscript === candidate
                                                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md scale-105'
                                                    : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-indigo-400 hover:bg-indigo-900/60'
                                                    }`}
                                            >
                                                {candidate}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Real-time Voice Recording Button */}
                        <div className="flex flex-col items-center justify-center space-y-3 pt-2">
                            <button
                                onClick={toggleListening}
                                className={`flex items-center space-x-3 px-8 py-4 rounded-2xl font-bold text-sm transition-all shadow-xl ${isListening
                                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30 animate-pulse'
                                    : 'bg-gradient-to-r from-indigo-600 to-amber-500 hover:from-indigo-500 hover:to-amber-400 text-white shadow-indigo-600/30 transform hover:scale-105'
                                    }`}
                            >
                                {isListening ? (
                                    <>
                                        <MicOff className="w-5 h-5" />
                                        <span>Stop Recording Voice</span>
                                    </>
                                ) : (
                                    <>
                                        <Mic className="w-5 h-5" />
                                        <span>Start Voice Response</span>
                                    </>
                                )}
                            </button>

                            {/* Live Laptop Microphone Signal Meter */}
                            {isListening ? (
                                <div className="w-full max-w-xs space-y-1.5 pt-1 text-center">
                                    <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                        <span className="text-slate-400 flex items-center gap-1">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                            </span>
                                            Laptop Mic Signal:
                                        </span>
                                        <span className={`font-bold ${micVolume > 15 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            {micVolume}% {micVolume > 15 ? '✓ Good' : '⚠️ Speak Louder'}
                                        </span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800 flex">
                                        <div
                                            className="h-full bg-gradient-to-r from-amber-500 via-indigo-500 to-emerald-400 transition-all duration-75"
                                            style={{ width: `${Math.max(6, micVolume)}%` }}
                                        />
                                    </div>
                                    <p className="text-[10px] font-mono text-slate-400 italic">
                                        💡 Tip: Face your laptop screen & speak clearly into your built-in mic.
                                    </p>
                                </div>
                            ) : (
                                <span className="text-[10px] font-mono text-slate-500">
                                    Click to record or add to your voice answer.
                                </span>
                            )}
                        </div>

                        {/* Real-time Sentiment Gauge */}
                        {liveTranscript.length > 5 && (
                            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs font-mono">
                                <span className="text-slate-400">Live Voice Sentiment AI:</span>
                                <span className={`font-bold ${currentSentiment.label === 'Positive' ? 'text-emerald-400' : currentSentiment.label === 'Negative' ? 'text-rose-400' : 'text-amber-400'
                                    }`}>
                                    {currentSentiment.label} Polarity ({Math.round(currentSentiment.score * 100)}%)
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Navigation Control Buttons */}
                <div className="flex items-center justify-between pt-4">
                    <button
                        onClick={handlePrev}
                        disabled={currentQIndex === 0}
                        className={`flex items-center space-x-2 px-5 py-3 rounded-2xl text-xs font-bold transition-all ${currentQIndex === 0 ? 'opacity-0 cursor-default' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            }`}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Previous Question</span>
                    </button>

                    <button
                        onClick={handleSaveAndNext}
                        disabled={isRefining}
                        className={`flex items-center space-x-2 px-7 py-3 rounded-2xl text-white text-xs font-extrabold shadow-lg transition-all transform hover:scale-105 ${isRefining
                            ? 'bg-amber-600 animate-pulse cursor-wait shadow-amber-600/30'
                            : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                            }`}
                    >
                        {isRefining ? (
                            <>
                                <Sparkles className="w-4 h-4 animate-spin text-amber-300" />
                                <span>✨ AI Refining Transcript...</span>
                            </>
                        ) : (
                            <>
                                <span>{currentQIndex === allQuestions.length - 1 ? 'Complete Exit Interview' : 'Save & Next Question'}</span>
                                <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    }

    // --------------------------------------------------------------------------
    // RENDER STAGE 4: INTERVIEW COMPLETE SUMMARY CERTIFICATE
    // --------------------------------------------------------------------------
    return (
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
            <div className="glass-panel rounded-3xl p-8 md:p-12 border border-emerald-500/30 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                    <h2 className="text-3xl font-extrabold text-white">Exit Interview Successfully Completed!</h2>
                    <p className="text-slate-300 text-sm max-w-xl mx-auto">
                        Thank you for participating in the VAlumni Voice Exit Interview. Your voice responses have been securely stored in the LSPU Alumni Database pursuant to RA 10173.
                    </p>
                </div>

                {/* Responses Summary Table */}
                <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-4 max-h-96 overflow-y-auto">
                    <h3 className="font-mono text-xs text-indigo-400 font-bold uppercase">Transcribed Exit Interview Log</h3>
                    <div className="divide-y divide-slate-800/80 space-y-3">
                        {allQuestions.map(q => (
                            <div key={q.id} className="pt-3 space-y-1">
                                <p className="text-xs font-semibold text-slate-300">{q.question}</p>
                                <p className="text-xs text-amber-300 font-mono italic">
                                    "{responses[q.id] || 'No verbal response recorded'}"
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 flex justify-center">
                    <button
                        onClick={() => {
                            setFlowStage('landing');
                            setCurrentQIndex(0);
                            setResponses({});
                            setLiveTranscript('');
                        }}
                        className="px-8 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
                    >
                        Complete Interview Session
                    </button>
                </div>
            </div>
        </div>
    );
}
