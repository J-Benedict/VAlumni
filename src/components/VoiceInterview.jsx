import React, { useState, useEffect, useRef } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import { LSPU_SURVEY_STRUCTURE, DATA_PRIVACY_TEXT, analyzeSentiment, correctFilipinoName, convertWordsToDigits, refineTranscriptWithGemini, getNameSpellingSuggestions } from '../services/aiService';
import { Mic, MicOff, Volume2, VolumeX, ShieldCheck, Play, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, RefreshCw, Award, Sparkles, FileText, Lock } from 'lucide-react';

export default function VoiceInterview({ onInterviewComplete, onExitToLanding, initialStage = 'survey' }) {
    // Navigation & Flow State: 'landing' -> 'privacy' -> 'survey' -> 'summary'
    const [flowStage, setFlowStage] = useState(initialStage);
    const [privacyAgreed, setPrivacyAgreed] = useState(true);

    // Survey Question Navigation Indexing with Session Persistence across page refreshes
    const allQuestions = LSPU_SURVEY_STRUCTURE.flatMap(sec => sec.questions.map(q => ({ ...q, sectionTitle: sec.sectionTitle, sectionId: sec.sectionId })));
    const [currentQIndex, setCurrentQIndex] = useState(() => {
        const saved = sessionStorage.getItem('valumni_current_qindex');
        const parsed = saved !== null ? parseInt(saved, 10) : 0;
        return (parsed >= 0 && parsed < allQuestions.length) ? parsed : 0;
    });
    const currentQuestion = allQuestions[currentQIndex];

    // User Responses Dictionary { questionId: responseTextOrValue }
    const [responses, setResponses] = useState(() => {
        try {
            const saved = sessionStorage.getItem('valumni_interview_responses');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    });

    // Voice Recognition (STT) State
    const [isListening, setIsListening] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [showExitModal, setShowExitModal] = useState(false);

    // faster-whisper (Whisper Large-v3-Turbo) State
    const [sttStatus, setSttStatus] = useState({ online: false, model: '', device: '' });
    const [isTranscribingWithWhisper, setIsTranscribingWithWhisper] = useState(false);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);

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

    // Keep currentQuestionRef synchronized with active question & persist session progress
    useEffect(() => {
        currentQuestionRef.current = currentQuestion;
        sessionStorage.setItem('valumni_current_qindex', currentQIndex.toString());
    }, [currentQuestion, currentQIndex]);

    useEffect(() => {
        sessionStorage.setItem('valumni_interview_responses', JSON.stringify(responses));
    }, [responses]);

    // Poll Whisper STT Microservice Status
    useEffect(() => {
        const checkStt = async () => {
            try {
                const res = await fetch('/api/stt/status');
                if (res.ok) {
                    const data = await res.json();
                    setSttStatus(data);
                }
            } catch (e) {
                setSttStatus({ online: false });
            }
        };
        checkStt();
        const interval = setInterval(checkStt, 6000);
        return () => clearInterval(interval);
    }, []);


    // Transcribe recorded audio with Whisper Large-v3-Turbo
    const transcribeWithWhisper = async () => {
        if (!sttStatus.online || audioChunksRef.current.length === 0) {
            setIsTranscribingWithWhisper(false);
            return;
        }
        setIsTranscribingWithWhisper(true);
        const timeoutId = setTimeout(() => setIsTranscribingWithWhisper(false), 4000);
        try {
            const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', blob, 'recording.webm');

            const res = await fetch('/api/stt/transcribe', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success && data.transcript && data.transcript.trim()) {
                    const whisperText = data.transcript.trim();
                    setLiveTranscript(prev => {
                        const base = (prev || transcriptAccumulated || '').trim();
                        if (!base) return whisperText;
                        if (base.toLowerCase().includes(whisperText.toLowerCase())) return base;
                        return `${base} ${whisperText}`.trim();
                    });
                    setTranscriptAccumulated(prev => {
                        const base = (prev || '').trim();
                        if (!base) return whisperText;
                        if (base.toLowerCase().includes(whisperText.toLowerCase())) return base;
                        return `${base} ${whisperText}`.trim();
                    });
                }
            }
        } catch (err) {
            console.error('Whisper transcribe error:', err);
        } finally {
            clearTimeout(timeoutId);
            setIsTranscribingWithWhisper(false);
            audioChunksRef.current = [];
        }
    };

    // Start Web Audio API Microphone Signal Meter & MediaRecorder using System Default Mic
    const startVolumeMeter = async () => {
        if (streamRef.current && streamRef.current.active) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Start MediaRecorder for Whisper STT
            try {
                audioChunksRef.current = [];
                const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
                const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
                recorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) {
                        audioChunksRef.current.push(e.data);
                    }
                };
                recorder.start(250);
                mediaRecorderRef.current = recorder;
            } catch (recorderErr) {
                console.warn('MediaRecorder init note:', recorderErr);
            }

            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioCtxClass();
            audioContextRef.current = audioCtx;

            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            const timeData = new Uint8Array(analyser.fftSize);
            const updateVolume = () => {
                if (!analyserRef.current) return;
                analyser.getByteTimeDomainData(timeData);
                let sumSquares = 0;
                for (let i = 0; i < timeData.length; i++) {
                    const norm = (timeData[i] - 128) / 128;
                    sumSquares += norm * norm;
                }
                const rms = Math.sqrt(sumSquares / timeData.length);
                const volumePercent = Math.min(100, Math.round(rms * 280));
                setMicVolume(volumePercent);
                animFrameRef.current = requestAnimationFrame(updateVolume);
            };
            updateVolume();
            setIsListening(true);
        } catch (err) {
            console.error('System default mic access error:', err);
            stopVolumeMeter();
            setIsListening(false);
            shouldListenRef.current = false;
        }
    };

    // Stop Web Audio API Volume Meter & trigger Whisper STT
    const stopVolumeMeter = () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

        // Stop MediaRecorder and transcribe
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            try {
                mediaRecorderRef.current.stop();
            } catch (e) { }
            setTimeout(() => {
                transcribeWithWhisper();
            }, 150);
        }

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
                if (event.error === 'not-allowed') {
                    console.warn('Browser Web Speech permission was not allowed.');
                }
            };

            rec.onend = () => {
                // Auto-restart Web Speech API if user hasn't explicitly clicked stop (vital for laptop mic pauses)
                // Do NOT call stopVolumeMeter() here so the MediaStream and recorder stay active!
                if (shouldListenRef.current) {
                    try {
                        rec.start();
                    } catch (e) { }
                } else {
                    stopVolumeMeter();
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
    const toggleListening = async () => {
        if (!speechSupported && !sttStatus.online) {
            alert('Voice recording is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
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
            setIsListening(true);
            setTranscriptAccumulated(liveTranscript);

            // Directly initiate microphone capture on user gesture
            await startVolumeMeter();

            if (recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (err) {
                    console.log('Recognition start note:', err);
                }
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
                finalResponseText = await refineTranscriptWithGemini(rawResponseText, currentQuestion);
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
            <div className="min-h-screen flex flex-col bg-cloud-gradient text-slate-800 relative selection:bg-orange-500 selection:text-white overflow-x-hidden">
                {/* Soft Ambient Cloud Highlights for visual depth */}
                <div className="cloud-ambient w-[600px] h-[350px] bg-white top-16 left-1/4 -z-0 pointer-events-none"></div>
                <div className="cloud-ambient w-[500px] h-[300px] bg-amber-200/25 bottom-10 right-10 -z-0 pointer-events-none"></div>

                {/* Top Navigation Bar - Full-width layout matching landing page */}
                <header className="relative z-20 w-full bg-[#d59e66] shadow-md border-b border-[#c28a52]/40">
                    <div className="w-full px-4 sm:px-6 py-2 flex items-center justify-between">
                        {/* Left: CCS Logo 60x60px + College & University Title */}
                        <div className="flex items-center space-x-3">
                            <img 
                                src={ccsLogo} 
                                alt="College of Computer Studies Logo" 
                                style={{ width: '60px', height: '60px' }}
                                className="w-[60px] h-[60px] object-contain drop-shadow-sm shrink-0"
                            />
                            <div>
                                <p className="text-sm sm:text-base font-serif font-bold text-slate-900 leading-tight">
                                    College of Computer Studies
                                </p>
                                <p className="text-[11px] sm:text-xs font-mono text-slate-800/80 tracking-tight">
                                    Laguna State Polytechnic University
                                </p>
                            </div>
                        </div>

                        {/* Right: Sound / TTS Toggle and Exit Button */}
                        <div className="flex items-center space-x-2 sm:space-x-3">
                            {/* TTS Mute Toggle */}
                            <button
                                onClick={() => {
                                    setTtsEnabled(!ttsEnabled);
                                    if (isSpeaking && synthRef.current) synthRef.current.cancel();
                                }}
                                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                                    ttsEnabled 
                                        ? 'bg-black/10 hover:bg-black/15 text-slate-900 border-black/15' 
                                        : 'bg-black/20 text-slate-600 border-black/10'
                                }`}
                                title={ttsEnabled ? "Mute Voice Assistant Audio" : "Enable Voice Assistant Audio"}
                                aria-label="Toggle Voice Assistant Audio"
                            >
                                {ttsEnabled ? <Volume2 className="w-5 h-5 text-slate-900" /> : <VolumeX className="w-5 h-5 text-slate-700" />}
                            </button>

                            {/* Exit Button with custom confirmation modal */}
                            {onExitToLanding && (
                                <button
                                    onClick={() => setShowExitModal(true)}
                                    className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-700 text-white font-mono text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center space-x-1"
                                    title="Exit Interview Session"
                                >
                                    <span>✕ Exit</span>
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                {/* Custom Confirmation Exit Modal */}
                {showExitModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-sm animate-fadeIn">
                        <div className="w-full max-w-md rounded-3xl p-6 sm:p-8 border border-[#d8c8b6] shadow-2xl bg-[#fbf7f0] space-y-6 text-center text-stone-800">
                            <div className="w-14 h-14 rounded-2xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
                                <AlertCircle className="w-8 h-8" />
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-lg font-bold text-stone-900">Exit Interview Session?</h3>
                                <p className="text-sm text-stone-600 leading-relaxed">
                                    Exiting will terminate the current session and will not be saved.
                                </p>
                            </div>

                            <div className="flex items-center justify-center gap-3 pt-2">
                                <button
                                    onClick={() => setShowExitModal(false)}
                                    className="flex-1 px-5 py-3 rounded-xl bg-white hover:bg-[#f3eae0] text-stone-700 text-xs font-bold transition-all border border-[#d8c8b6] cursor-pointer shadow-xs"
                                >
                                    Cancel
                                </button>

                                <button
                                    onClick={() => {
                                        setShowExitModal(false);
                                        if (synthRef.current) synthRef.current.cancel();
                                        if (recognitionRef.current) {
                                            try { recognitionRef.current.stop(); } catch (e) { }
                                        }
                                        stopVolumeMeter();
                                        sessionStorage.removeItem('valumni_current_qindex');
                                        sessionStorage.removeItem('valumni_interview_responses');
                                        sessionStorage.setItem('valumni_active_view', 'landing');
                                        onExitToLanding();
                                    }}
                                    className="flex-1 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-all cursor-pointer"
                                >
                                    Exit
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Interview Body: Unified Whole Card */}
                <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-6 md:py-8 max-w-4xl mx-auto w-full">
                    {/* The Entire Section Made Whole: Complementary Sand & Parchment Palette */}
                    <div className="w-full rounded-3xl overflow-hidden shadow-xl shadow-orange-950/10 border border-[#d8c8b6] bg-[#fbf7f0]/95 backdrop-blur-md text-stone-800 flex flex-col transition-all duration-300">
                        {/* 1. Integrated Progress & Section Header */}
                        <div className="px-6 py-4 bg-[#f3eae0] border-b border-[#e2d4c4] flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center space-x-3">
                                <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-[#d59e66]/20 text-[#8c521f] border border-[#d59e66]/40">
                                    Section 0{currentQuestion.sectionId} of 05
                                </span>
                                <h3 className="text-xs font-bold text-stone-700 hidden sm:block">
                                    {currentQuestion.sectionTitle}
                                </h3>
                            </div>

                            <div className="flex items-center space-x-2">
                                <span className="text-xs font-mono text-[#9a5820] font-bold">
                                    Question {currentQIndex + 1} / {allQuestions.length}
                                </span>
                            </div>
                        </div>

                        {/* Thin Progress Bar Strip */}
                        <div className="w-full h-1.5 bg-[#e4d6c6] overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-[#d59e66] to-[#b97a3f] transition-all duration-300"
                                style={{ width: `${((currentQIndex + 1) / allQuestions.length) * 100}%` }}
                            />
                        </div>

                        {/* 2. AI Voice Assistant Question Prompt Zone */}
                        <div className="p-6 md:p-8 space-y-4 border-b border-[#e6d8c8] bg-white/70">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start space-x-3.5">
                                    <div className="p-3 rounded-2xl bg-[#d59e66]/15 text-[#9a5820] border border-[#d59e66]/30 shrink-0 mt-0.5">
                                        <Sparkles className="w-6 h-6 text-[#9a5820] animate-pulse" />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs font-mono text-[#9a5820] font-bold tracking-wide uppercase">
                                            AI Exit Interview Assistant
                                        </span>
                                        <h2 className="text-lg md:text-2xl font-serif font-bold text-stone-900 leading-snug">
                                            {currentQuestion.question}
                                        </h2>
                                    </div>
                                </div>

                                <button
                                    onClick={() => speakText(currentQuestion.question)}
                                    className="p-2.5 rounded-xl bg-[#f3eae0] hover:bg-[#eae0d4] text-stone-700 border border-[#d8c8b6] hover:border-[#b97a3f] transition-all shrink-0 cursor-pointer shadow-xs"
                                    title="Repeat AI Question Audio"
                                >
                                    <Volume2 className={`w-4 h-4 ${isSpeaking ? 'text-[#9a5820] animate-bounce' : ''}`} />
                                </button>
                            </div>

                            {currentQuestion.promptHint && (
                                <p className="text-xs font-mono text-stone-600 bg-[#f7efe5] p-3 rounded-xl border border-[#dfd0be]">
                                    💡 Hint / Format: <span className="text-[#9a5820] font-semibold">{currentQuestion.promptHint}</span>
                                </p>
                            )}
                        </div>

                        {/* 3. Interactive Response Body */}
                        <div className="p-6 md:p-8 space-y-6 flex-1">
                            {/* Choice Questions */}
                            {currentQuestion.type === 'choice' && (
                                <div className="space-y-3">
                                    <label className="text-xs font-mono text-stone-600 font-semibold">Select option or speak your response:</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {currentQuestion.options.map((opt) => (
                                            <button
                                                key={opt}
                                                onClick={() => handleSelectOption(opt)}
                                                className={`p-4 rounded-2xl text-left text-xs font-semibold transition-all border cursor-pointer ${
                                                    liveTranscript === opt
                                                        ? 'bg-gradient-to-r from-[#d59e66] to-[#c28346] text-white font-bold border-[#b97a3f] shadow-md shadow-[#d59e66]/20 scale-[1.01]'
                                                        : 'bg-white text-stone-800 border-[#d8c8b6] hover:border-[#c28346] hover:bg-[#f7efe5]'
                                                }`}
                                            >
                                                {opt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Rating Questions */}
                            {currentQuestion.type === 'rating' && (
                                <div className="space-y-4">
                                    <label className="text-xs font-mono text-[#9a5820] font-semibold">👆 Tap your rating below:</label>
                                    <div className="grid grid-cols-5 gap-3">
                                        {[1, 2, 3, 4, 5].map((val) => (
                                            <button
                                                key={val}
                                                onClick={() => handleSelectOption(val.toString())}
                                                className={`p-5 rounded-2xl text-center font-bold text-lg transition-all border cursor-pointer ${
                                                    liveTranscript === val.toString()
                                                        ? 'bg-gradient-to-r from-[#d59e66] to-[#c28346] text-white border-[#b97a3f] shadow-md scale-105'
                                                        : 'bg-white text-stone-800 border-[#d8c8b6] hover:border-[#c28346] hover:bg-[#f7efe5] hover:scale-105'
                                                }`}
                                            >
                                                {val}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono text-stone-500 px-1">
                                        <span>1 = Poor</span>
                                        <span>5 = Excellent</span>
                                    </div>
                                    {liveTranscript && (
                                        <div className="p-3 rounded-xl bg-[#f3eae0] border border-[#d59e66]/40 text-center">
                                            <span className="text-sm font-bold text-[#9a5820]">Selected Rating: {liveTranscript}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Middle Initial Selector Grid */}
                            {currentQuestion.id === 'demo_middleinitial' && (
                                <div className="space-y-3">
                                    <label className="text-xs font-mono text-[#9a5820] font-semibold">👆 Tap your Middle Initial below:</label>
                                    <div className="grid grid-cols-7 sm:grid-cols-10 gap-2">
                                        {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'N/A'].map((letter) => {
                                            const initialVal = letter === 'N/A' ? 'N/A' : letter + '.';
                                            return (
                                                <button
                                                    key={letter}
                                                    onClick={() => handleSelectOption(initialVal)}
                                                    className={`p-3 rounded-xl font-bold text-sm transition-all border cursor-pointer ${
                                                        liveTranscript === initialVal
                                                            ? 'bg-[#d59e66] text-white border-[#b97a3f] shadow-sm scale-110'
                                                            : 'bg-white text-stone-800 border-[#d8c8b6] hover:border-[#c28346] hover:bg-[#f7efe5] hover:scale-105'
                                                    }`}
                                                >
                                                    {letter}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {liveTranscript && (
                                        <div className="p-3 rounded-xl bg-[#f3eae0] border border-[#d59e66]/40 text-center">
                                            <span className="text-sm font-bold text-[#9a5820]">Selected: {liveTranscript}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Voice Input Display Container (Standard text questions) */}
                            {currentQuestion.type !== 'rating' && currentQuestion.id !== 'demo_middleinitial' && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between border-b border-[#e6d8c8] pb-2">
                                        <div className="flex items-center space-x-2">
                                            <Mic className={`w-4 h-4 ${isListening ? 'text-rose-500 animate-ping' : 'text-[#d59e66]'}`} />
                                            <h4 className="text-xs font-mono text-stone-700 font-semibold">
                                                Transcribed Spoken Voice Response
                                            </h4>
                                        </div>

                                        {liveTranscript && (
                                            <button
                                                onClick={() => {
                                                    setLiveTranscript('');
                                                    setTranscriptAccumulated('');
                                                }}
                                                className="text-[11px] font-mono text-rose-600 hover:text-rose-700 underline cursor-pointer"
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
                                            className="w-full p-4 rounded-2xl bg-white border border-[#d8c8b6] text-base font-sans text-stone-900 leading-relaxed text-center font-medium focus:outline-none focus:border-[#d59e66] focus:ring-2 focus:ring-[#d59e66]/25 transition-all resize-none shadow-inner placeholder:text-stone-400"
                                        />

                                        {/* Name Spelling Suggestion Chips */}
                                        {getNameSpellingSuggestions(liveTranscript).length > 0 && (
                                            <div className="p-3.5 rounded-2xl bg-[#f7efe5] border border-[#dfd0be] space-y-2 text-center">
                                                <span className="text-xs font-mono text-[#9a5820] font-semibold block">
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
                                                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                                                                liveTranscript === candidate
                                                                    ? 'bg-[#d59e66] text-white border-[#b97a3f] shadow-sm scale-105'
                                                                    : 'bg-white text-stone-800 border-[#d8c8b6] hover:border-[#b97a3f] hover:bg-[#d59e66] hover:text-white'
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
                                    <div className="flex flex-col items-center justify-center space-y-3 pt-1">
                                        <button
                                            onClick={toggleListening}
                                            className={`flex items-center space-x-3 px-8 py-4 rounded-2xl font-extrabold text-sm transition-all shadow-md cursor-pointer ${
                                                isListening
                                                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/25 animate-pulse'
                                                    : 'bg-gradient-to-r from-[#d59e66] to-[#c28346] hover:from-[#c88f55] hover:to-[#b47437] text-white shadow-[#c28346]/25 transform hover:scale-[1.02]'
                                            }`}
                                        >
                                            {isListening ? (
                                                <>
                                                    <MicOff className="w-5 h-5" />
                                                    <span>Stop Recording Voice</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Mic className="w-5 h-5 text-white" />
                                                    <span>Start Voice Response</span>
                                                </>
                                            )}
                                        </button>

                                        {/* Whisper Large-v3-Turbo Transcribing Indicator */}
                                        {isTranscribingWithWhisper && (
                                            <div className="flex items-center justify-center space-x-2 py-2 px-4 rounded-xl bg-[#d59e66]/15 border border-[#d59e66]/35 text-xs font-mono text-[#8c521f] animate-pulse">
                                                <Sparkles className="w-4 h-4 animate-spin text-[#8c521f]" />
                                                <span>⚡ Whisper Large-v3-Turbo Transcribing Audio...</span>
                                            </div>
                                        )}

                                        {/* Live Laptop Microphone Signal Meter */}
                                        {isListening ? (
                                            <div className="w-full max-w-xs space-y-1.5 pt-1 text-center">
                                                <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                    <span className="text-stone-600 flex items-center gap-1">
                                                        <span className="relative flex h-2 w-2">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                                                        </span>
                                                        Mic Signal:
                                                    </span>
                                                    <span className={`font-bold ${micVolume > 8 ? 'text-emerald-700' : 'text-[#9a5820]'}`}>
                                                        {micVolume}% {micVolume > 8 ? '✓ Receiving Voice' : '⚠️ Speak into Mic'}
                                                    </span>
                                                </div>
                                                <div className="h-2.5 w-full bg-[#e6d8c8] rounded-full overflow-hidden border border-[#d8c8b6] flex">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-[#d59e66] to-emerald-600 transition-all duration-75"
                                                        style={{ width: `${Math.max(6, micVolume)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-[11px] font-mono text-stone-500">
                                                Click to record or add to your voice answer.
                                            </span>
                                        )}
                                    </div>

                                    {/* Real-time Sentiment Gauge */}
                                    {liveTranscript.length > 5 && (
                                        <div className="p-3 rounded-xl bg-[#f7efe5] border border-[#dfd0be] flex items-center justify-between text-xs font-mono">
                                            <span className="text-stone-600">Live Voice Sentiment AI:</span>
                                            <span className={`font-bold ${
                                                currentSentiment.label === 'Positive' ? 'text-emerald-700' : currentSentiment.label === 'Negative' ? 'text-rose-600' : 'text-[#9a5820]'
                                            }`}>
                                                {currentSentiment.label} Polarity ({Math.round(currentSentiment.score * 100)}%)
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 4. Unified Navigation Footer inside the card */}
                        <div className="px-6 py-4 bg-[#f3eae0] border-t border-[#e2d4c4] flex items-center justify-between">
                            <button
                                onClick={handlePrev}
                                disabled={currentQIndex === 0}
                                className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                                    currentQIndex === 0 
                                        ? 'opacity-0 cursor-default' 
                                        : 'bg-white hover:bg-[#eae0d4] text-stone-700 border border-[#d8c8b6] cursor-pointer shadow-xs'
                                }`}
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Previous Question</span>
                            </button>

                            <button
                                onClick={handleSaveAndNext}
                                disabled={isRefining}
                                className={`flex items-center space-x-2 px-7 py-3 rounded-xl text-white text-xs font-extrabold shadow-md transition-all transform hover:scale-[1.02] cursor-pointer ${
                                    isRefining
                                        ? 'bg-[#c28346] animate-pulse cursor-wait shadow-[#c28346]/30'
                                        : 'bg-gradient-to-r from-[#d59e66] to-[#c28346] hover:from-[#c88f55] hover:to-[#b47437] shadow-[#c28346]/20'
                                }`}
                            >
                                {isRefining ? (
                                    <>
                                        <Sparkles className="w-4 h-4 animate-spin text-white" />
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
                </main>
            </div>
        );
    }

    // --------------------------------------------------------------------------
    // RENDER STAGE 4: INTERVIEW COMPLETE SUMMARY CERTIFICATE
    // --------------------------------------------------------------------------
    return (
        <div className="min-h-screen flex flex-col bg-cloud-gradient text-slate-800 relative selection:bg-orange-500 selection:text-white overflow-x-hidden">
            {/* Top Navigation Bar with CCS Logo */}
            <header className="relative z-20 w-full bg-[#d59e66] shadow-md border-b border-[#c28a52]/40">
                <div className="w-full px-4 sm:px-6 py-2 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <img 
                            src={ccsLogo} 
                            alt="College of Computer Studies Logo" 
                            style={{ width: '60px', height: '60px' }}
                            className="w-[60px] h-[60px] object-contain drop-shadow-sm shrink-0"
                        />
                        <div>
                            <p className="text-sm sm:text-base font-serif font-bold text-slate-900 leading-tight">
                                College of Computer Studies
                            </p>
                            <p className="text-[11px] sm:text-xs font-mono text-slate-800/80 tracking-tight">
                                Laguna State Polytechnic University
                            </p>
                        </div>
                    </div>

                    {onExitToLanding && (
                        <button
                            onClick={() => {
                                sessionStorage.removeItem('valumni_current_qindex');
                                sessionStorage.removeItem('valumni_interview_responses');
                                sessionStorage.setItem('valumni_active_view', 'landing');
                                onExitToLanding();
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-700 text-white font-mono text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center space-x-1"
                            title="Return to Home"
                        >
                            <span>✕ Return to Home</span>
                        </button>
                    )}
                </div>
            </header>

            <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-4xl mx-auto w-full">
                <div className="w-full rounded-3xl p-8 md:p-12 border border-[#d8c8b6] bg-[#fbf7f0]/95 text-center space-y-6 shadow-xl text-stone-800">
                    <div className="w-16 h-16 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-8 h-8" />
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-3xl font-serif font-extrabold text-stone-900">Exit Interview Successfully Completed!</h2>
                        <p className="text-stone-600 text-sm max-w-xl mx-auto">
                            Thank you for participating in the VAlumni Voice Exit Interview. Your voice responses have been securely stored in the LSPU Alumni Database pursuant to RA 10173.
                        </p>
                    </div>

                    {/* Responses Summary Table */}
                    <div className="p-6 rounded-2xl bg-white border border-[#d8c8b6] text-left space-y-4 max-h-96 overflow-y-auto">
                        <h3 className="font-mono text-xs text-[#9a5820] font-bold uppercase">Transcribed Exit Interview Log</h3>
                        <div className="divide-y divide-[#e8dccf] space-y-3">
                            {allQuestions.map(q => (
                                <div key={q.id} className="pt-3 space-y-1">
                                    <p className="text-xs font-semibold text-stone-800">{q.question}</p>
                                    <p className="text-xs text-[#9a5820] font-mono italic">
                                        "{responses[q.id] || 'No verbal response recorded'}"
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-4 flex justify-center">
                        <button
                            onClick={() => {
                                sessionStorage.removeItem('valumni_current_qindex');
                                sessionStorage.removeItem('valumni_interview_responses');
                                sessionStorage.setItem('valumni_active_view', 'landing');
                                if (onExitToLanding) {
                                    onExitToLanding();
                                } else {
                                    setFlowStage('landing');
                                    setCurrentQIndex(0);
                                    setResponses({});
                                    setLiveTranscript('');
                                }
                            }}
                            className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#d59e66] to-[#c28346] hover:from-[#c88f55] hover:to-[#b47437] text-white font-extrabold text-sm shadow-md shadow-[#c28346]/25 transition-all cursor-pointer"
                        >
                            Finish & Return to Home
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}
