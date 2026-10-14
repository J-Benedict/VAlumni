import React, { useState, useEffect, useRef } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import { ProgramHeadAvatar, IntervieweeAvatar } from './InterviewAvatars';
import { AudioCleanerPipeline } from '../services/audioCleaner';
import { ttsService } from '../services/ttsService';
import { 
    INTERVIEW_DOMAINS, 
    generateProgramHeadReply, 
    extractAndSaveInterviewSession,
    getInstitutionalKnowledge 
} from '../services/conversationalAiService';
import { 
    Volume2, 
    VolumeX, 
    Sparkles, 
    Award, 
    CheckCircle2, 
    AlertCircle, 
    Activity, 
    Database, 
    ArrowRight,
    GraduationCap
} from 'lucide-react';

export default function ConversationalInterview({ onInterviewComplete, onExitToLanding }) {
    // Conversational Chat Messages: [{ id, sender: 'program_head' | 'interviewee', text, timestamp }]
    const [messages, setMessages] = useState([]);
    const [currentStage, setCurrentStage] = useState(1);
    
    // Turn State: 'ai_speaking' | 'user_listening' | 'user_processing' | 'ai_thinking' | 'completed'
    const [turnState, setTurnState] = useState('ai_speaking');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [micVolume, setMicVolume] = useState(0);
    const [ttsEnabled, setTtsEnabled] = useState(true);
    const [selectedVoice, setSelectedVoice] = useState('fil-PH-AngeloNeural');
    const [showExitModal, setShowExitModal] = useState(false);
    const [completionRecord, setCompletionRecord] = useState(null);
    const [sttStatus, setSttStatus] = useState({ online: false });

    // References for pipelines & auto-scroll
    const chatEndRef = useRef(null);
    const audioCleanerRef = useRef(null);
    const webSpeechRecRef = useRef(null);
    const turnStateRef = useRef(turnState);
    const liveTranscriptRef = useRef('');
    const ttsEnabledRef = useRef(ttsEnabled);
    const selectedVoiceRef = useRef(selectedVoice);
    const speechEndTimeoutRef = useRef(null);

    useEffect(() => {
        selectedVoiceRef.current = selectedVoice;
    }, [selectedVoice]);

    // Sync refs
    useEffect(() => {
        turnStateRef.current = turnState;
    }, [turnState]);

    useEffect(() => {
        liveTranscriptRef.current = liveTranscript;
    }, [liveTranscript]);

    useEffect(() => {
        ttsEnabledRef.current = ttsEnabled;
    }, [ttsEnabled]);

    // Auto-scroll chat feed to bottom
    const scrollToBottom = () => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, liveTranscript, turnState]);

    // Check STT microservice on mount
    useEffect(() => {
        fetch('/api/stt/status')
            .then(res => res.json())
            .then(data => setSttStatus(data))
            .catch(() => setSttStatus({ online: false }));
    }, []);

    // -------------------------------------------------------------------------
    // INITIALIZATION: Start Hands-Free Session Immediately
    // -------------------------------------------------------------------------
    useEffect(() => {
        let isCancelled = false;

        const startSession = async () => {
            // 1. Initialize Web Audio DSP Noise Reduction Pipeline
            try {
                audioCleanerRef.current = new AudioCleanerPipeline({
                    silenceTimeoutMs: 2000,
                    speechThreshold: 12,
                    minSpeechDurationMs: 600,
                    onSpeechStart: () => {
                        console.log('🎤 Speech detected from Interviewee');
                    },
                    onSpeechVolume: (vol) => {
                        setMicVolume(vol);
                    },
                    onSilenceDetected: () => {
                        console.log('🔇 Silence timeout detected - auto-saving response turn');
                        handleUserTurnComplete();
                    }
                });

                await audioCleanerRef.current.init();
            } catch (err) {
                console.warn('Microphone DSP initialization note:', err);
            }

            if (isCancelled) return;

            // 2. Program Head Delivers First Welcoming Question
            const initialQuestion = INTERVIEW_DOMAINS[0].starterMessage;
            const initialMsg = {
                id: 'msg_0',
                sender: 'program_head',
                text: initialQuestion,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            setMessages([initialMsg]);
            setTurnState('ai_speaking');

            // 3. Speak the initial question aloud with selected Neural Voice
            if (ttsEnabledRef.current) {
                await ttsService.speak(initialQuestion, {
                    voice: selectedVoiceRef.current,
                    onStart: () => setTurnState('ai_speaking'),
                    onEnd: () => {
                        if (!isCancelled) {
                            startIntervieweeListening();
                        }
                    }
                });
            } else {
                startIntervieweeListening();
            }
        };

        startSession();

        return () => {
            isCancelled = true;
            ttsService.stop();
            if (audioCleanerRef.current) {
                audioCleanerRef.current.destroy();
            }
            if (webSpeechRecRef.current) {
                try { webSpeechRecRef.current.stop(); } catch (e) {}
            }
        };
    }, []);

    // Keyboard shortcut (Space or Enter) to instantly advance turn if desired
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Only trigger if active tag is not an input or textarea
            if (['input', 'textarea', 'select'].includes(document.activeElement?.tagName?.toLowerCase())) return;
            if ((e.code === 'Space' || e.key === 'Enter') && turnStateRef.current === 'user_listening') {
                e.preventDefault();
                console.log('User manually triggered turn advance via keyboard shortcut (Space/Enter)');
                handleUserTurnComplete();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // -------------------------------------------------------------------------
    // HANDS-FREE VOICE LOOP: Step A - Start Listening to Interviewee
    // -------------------------------------------------------------------------
    const startIntervieweeListening = () => {
        setTurnState('user_listening');
        setLiveTranscript('');
        liveTranscriptRef.current = '';
        if (speechEndTimeoutRef.current) {
            clearTimeout(speechEndTimeoutRef.current);
            speechEndTimeoutRef.current = null;
        }

        // Start cleaned DSP recording & VAD loop
        if (audioCleanerRef.current) {
            audioCleanerRef.current.startListening();
        }

        // Start parallel Web Speech API for real-time live transcript preview & silence detection
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRec) {
            try {
                if (webSpeechRecRef.current) {
                    try { webSpeechRecRef.current.stop(); } catch (e) {}
                }

                const rec = new SpeechRec();
                rec.continuous = true;
                rec.interimResults = true;
                rec.lang = 'en-PH'; // Supports Philippine English, Tagalog, and Taglish accents

                rec.onresult = (event) => {
                    let interim = '';
                    let hasFinal = false;

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        interim += event.results[i][0].transcript;
                        if (event.results[i].isFinal) hasFinal = true;
                    }

                    if (interim.trim()) {
                        setLiveTranscript(interim.trim());
                        liveTranscriptRef.current = interim.trim();

                        // Multi-layered auto-advance: 1.8s rolling silence after last spoken word
                        if (speechEndTimeoutRef.current) clearTimeout(speechEndTimeoutRef.current);
                        speechEndTimeoutRef.current = setTimeout(() => {
                            console.log('Rolling transcript silence detected: auto-advancing turn');
                            handleUserTurnComplete();
                        }, hasFinal ? 1200 : 1900);
                    }
                };

                rec.onspeechend = () => {
                    if (liveTranscriptRef.current && liveTranscriptRef.current.trim().length > 0) {
                        if (speechEndTimeoutRef.current) clearTimeout(speechEndTimeoutRef.current);
                        speechEndTimeoutRef.current = setTimeout(() => {
                            handleUserTurnComplete();
                        }, 1000);
                    }
                };

                rec.onend = () => {
                    // Resurrect SpeechRecognition if turn is still active
                    if (turnStateRef.current === 'user_listening') {
                        try { rec.start(); } catch (e) {}
                    }
                };

                rec.onerror = (e) => {
                    console.warn('SpeechRecognition interim warning:', e.error);
                };

                rec.start();
                webSpeechRecRef.current = rec;
            } catch (e) {
                console.warn('SpeechRecognition start fallback note:', e);
            }
        }
    };

    // -------------------------------------------------------------------------
    // HANDS-FREE VOICE LOOP: Step B - User Finished Speaking (Silence Detected)
    // -------------------------------------------------------------------------
    const handleUserTurnComplete = async () => {
        if (speechEndTimeoutRef.current) {
            clearTimeout(speechEndTimeoutRef.current);
            speechEndTimeoutRef.current = null;
        }
        if (turnStateRef.current !== 'user_listening') return;
        setTurnState('user_processing');

        // 1. Stop Web Speech recognition
        if (webSpeechRecRef.current) {
            try { webSpeechRecRef.current.stop(); } catch (e) {}
            webSpeechRecRef.current = null;
        }

        // 2. Stop cleaned DSP recorder and obtain pristine audio blob
        let audioBlob = null;
        if (audioCleanerRef.current) {
            audioBlob = await audioCleanerRef.current.stopListening();
        }

        let finalTranscriptText = (liveTranscriptRef.current || '').trim();

        // 3. If faster-whisper microservice is online, send the cleaned audio for high-precision transcription
        if (sttStatus.online && audioBlob && audioBlob.size > 2000) {
            try {
                const formData = new FormData();
                formData.append('audio', audioBlob, 'cleaned_speech.webm');
                const whisperResp = await fetch('/api/stt/transcribe', {
                    method: 'POST',
                    body: formData
                });
                if (whisperResp.ok) {
                    const whisperData = await whisperResp.json();
                    if (whisperData.success && whisperData.transcript && whisperData.transcript.trim()) {
                        finalTranscriptText = whisperData.transcript.trim();
                    }
                }
            } catch (err) {
                console.warn('Whisper transcription fallback to Web Speech:', err);
            }
        }

        // Default answer if mic captured no spoken words
        if (!finalTranscriptText) {
            finalTranscriptText = "Opo, naiintindihan ko po.";
        }

        // 4. Append Interviewee's Answer to chat feed
        const userMsg = {
            id: `msg_user_${Date.now()}`,
            sender: 'interviewee',
            text: finalTranscriptText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        const updatedMessages = [...messages, userMsg];
        setMessages(updatedMessages);
        setLiveTranscript('');
        liveTranscriptRef.current = '';

        // 5. Check if next stage is final completion
        const nextStage = currentStage + 1;
        setCurrentStage(nextStage);

        // 6. Program Head processes student's answer & learns from database
        setTurnState('ai_thinking');

        try {
            const aiReply = await generateProgramHeadReply({
                conversationHistory: updatedMessages,
                currentStage: nextStage
            });

            const aiMsg = {
                id: `msg_ai_${Date.now()}`,
                sender: 'program_head',
                text: aiReply,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            const fullConversation = [...updatedMessages, aiMsg];
            setMessages(fullConversation);

            // 7. Check if interview is now complete (Reached stage 7)
            if (nextStage >= INTERVIEW_DOMAINS.length) {
                // Speak final congratulatory blessing with selected Neural Voice
                if (ttsEnabledRef.current) {
                    await ttsService.speak(aiReply, {
                        voice: selectedVoiceRef.current,
                        onStart: () => setTurnState('ai_speaking'),
                        onEnd: async () => {
                            setTurnState('completed');
                            // Automatic database persistence
                            const savedRecord = await extractAndSaveInterviewSession(fullConversation);
                            setCompletionRecord(savedRecord);
                            if (onInterviewComplete) onInterviewComplete(savedRecord);
                        }
                    });
                } else {
                    setTurnState('completed');
                    const savedRecord = await extractAndSaveInterviewSession(fullConversation);
                    setCompletionRecord(savedRecord);
                    if (onInterviewComplete) onInterviewComplete(savedRecord);
                }
            } else {
                // Speak next question and cycle back to interviewee listening
                if (ttsEnabledRef.current) {
                    await ttsService.speak(aiReply, {
                        voice: selectedVoiceRef.current,
                        onStart: () => setTurnState('ai_speaking'),
                        onEnd: () => {
                            startIntervieweeListening();
                        }
                    });
                } else {
                    startIntervieweeListening();
                }
            }
        } catch (err) {
            console.error('Error generating AI reply:', err);
            startIntervieweeListening();
        }
    };

    const isAiSpeaking = turnState === 'ai_speaking';
    const isUserListening = turnState === 'user_listening';
    const isAiThinking = turnState === 'ai_thinking';

    return (
        <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-col bg-[#1e1e1e] text-slate-100 select-none relative font-sans">
            {/* Top Navigation Bar */}
            <header className="relative z-20 w-full bg-[#161616] border-b border-white/10 px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0 shadow-md">
                {/* Left: CCS Logo & Department Title */}
                <div className="flex items-center space-x-3">
                    <img
                        src={ccsLogo}
                        alt="LSPU CCS Logo"
                        className="w-10 h-10 object-contain drop-shadow-sm shrink-0"
                    />
                    <div>
                        <h1 className="text-sm sm:text-base font-serif font-bold text-white tracking-wide leading-tight">
                            College of Computer Studies
                        </h1>
                        <p className="text-[10px] sm:text-xs font-mono text-slate-400">
                            Laguna State Polytechnic University • Exit Interview AI
                        </p>
                    </div>
                </div>

                {/* Center: Stage Progress Tracker */}
                <div className="hidden md:flex items-center space-x-2 bg-white/5 border border-white/10 px-3.5 py-1 rounded-full text-xs font-mono">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-slate-300">
                        Topic {Math.min(currentStage, INTERVIEW_DOMAINS.length)} of {INTERVIEW_DOMAINS.length}:
                    </span>
                    <span className="text-blue-300 font-bold">
                        {INTERVIEW_DOMAINS[Math.min(currentStage, INTERVIEW_DOMAINS.length) - 1]?.name || 'Exit Interview'}
                    </span>
                </div>

                {/* Right: Sound Toggle, Hands-free Badge, and Exit */}
                <div className="flex items-center space-x-2 sm:space-x-3">
                    {/* OmniVoice / Whisper STT Indicator */}
                    <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-slate-300">
                        <Database className="w-3.5 h-3.5 text-blue-400" />
                        <span>AI Learning Active</span>
                    </div>

                    {/* Neural Voice Model Selector */}
                    <div className="hidden lg:flex items-center space-x-1.5 bg-white/5 border border-white/10 px-2.5 py-1 rounded-xl text-xs font-mono">
                        <span className="text-slate-400">Voice:</span>
                        <select
                            value={selectedVoice}
                            onChange={(e) => setSelectedVoice(e.target.value)}
                            className="bg-transparent text-blue-300 font-semibold focus:outline-none cursor-pointer text-xs"
                        >
                            <option value="fil-PH-AngeloNeural" className="bg-[#242424] text-white">Angelo (Filipino Male - Program Head)</option>
                            <option value="en-PH-JamesNeural" className="bg-[#242424] text-white">James (Philippine English Male)</option>
                            <option value="fil-PH-BlessicaNeural" className="bg-[#242424] text-white">Blessica (Filipino Female)</option>
                            <option value="en-PH-RosaNeural" className="bg-[#242424] text-white">Rosa (Philippine English Female)</option>
                        </select>
                    </div>

                    {/* TTS Mute Toggle */}
                    <button
                        onClick={() => {
                            const next = !ttsEnabled;
                            setTtsEnabled(next);
                            if (!next) ttsService.stop();
                        }}
                        className={`p-2 rounded-xl border transition-all cursor-pointer ${
                            ttsEnabled 
                                ? 'bg-white/10 hover:bg-white/15 text-white border-white/15' 
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}
                        title={ttsEnabled ? "Mute Voice Audio" : "Unmute Voice Audio"}
                        aria-label="Toggle Voice Audio"
                    >
                        {ttsEnabled ? <Volume2 className="w-4 h-4 text-white" /> : <VolumeX className="w-4 h-4 text-rose-300" />}
                    </button>

                    {/* Exit Session Button */}
                    <button
                        onClick={() => setShowExitModal(true)}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-rose-600/80 text-white font-mono text-xs font-semibold border border-white/15 transition-all cursor-pointer"
                        title="Exit Interview Session"
                    >
                        ✕ Exit
                    </button>
                </div>
            </header>

            {/* Hands-Free Real-time Status Banner */}
            <div className="relative z-10 w-full bg-[#121212] border-b border-white/5 px-4 py-1.5 flex items-center justify-center shrink-0">
                {isAiSpeaking && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-blue-400 animate-pulse">
                        <Activity className="w-4 h-4 text-blue-400 animate-spin" />
                        <span>Program Head is speaking... Please listen.</span>
                    </div>
                )}
                {isUserListening && (
                    <div className="flex items-center space-x-3 text-xs font-mono text-emerald-400 flex-wrap justify-center gap-y-1">
                        <div className="flex items-center space-x-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                            <span className="font-bold">Microphone is active — Speak naturally in English, Filipino, or Taglish...</span>
                            <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden border border-emerald-500/30 ml-1">
                                <div 
                                    className="h-full bg-emerald-400 transition-all duration-75"
                                    style={{ width: `${micVolume}%` }}
                                />
                            </div>
                        </div>

                        {/* Instant Advance / Done Speaking Action Button */}
                        <button
                            onClick={handleUserTurnComplete}
                            className="px-3 py-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-xs flex items-center space-x-1.5 shadow-lg shadow-emerald-500/25 transition-all cursor-pointer border border-emerald-300"
                            title="Click or press Spacebar / Enter when you finish speaking"
                        >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Done Speaking / Next</span>
                            <span className="text-[10px] bg-black/20 px-1 py-0.5 rounded font-mono hidden sm:inline">Space ↵</span>
                            <ArrowRight className="w-3 h-3 ml-0.5" />
                        </button>
                    </div>
                )}
                {turnState === 'user_processing' && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-amber-400">
                        <Sparkles className="w-4 h-4 text-amber-400 animate-spin" />
                        <span>Silence detected. Automatically transcribing and saving response...</span>
                    </div>
                )}
                {isAiThinking && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-purple-400 animate-pulse">
                        <Database className="w-4 h-4 text-purple-400 animate-bounce" />
                        <span>Program Head is reflecting & learning from past alumni sessions...</span>
                    </div>
                )}
                {turnState === 'completed' && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-emerald-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Interview successfully completed and automatically saved to database!</span>
                    </div>
                )}
            </div>

            {/* MAIN STAGE: Frame matching User Image (Program Head on Left, Chat in Middle, Interviewee on Right) */}
            <main className="flex-1 min-h-0 flex items-stretch justify-between px-3 sm:px-6 md:px-8 py-4 sm:py-6 relative overflow-hidden">
                
                {/* 1. LEFT SIDE: Program Head Avatar Column */}
                <div className="w-52 md:w-64 lg:w-72 shrink-0 flex flex-col justify-end items-center pb-6 md:pb-10 pl-2">
                    <ProgramHeadAvatar 
                        isSpeaking={isAiSpeaking} 
                        isThinking={isAiThinking}
                        size={170} 
                    />
                </div>

                {/* 2. MIDDLE: SNS-Style Messaging Conversation Feed */}
                <div className="flex-1 max-w-3xl mx-2 sm:mx-4 flex flex-col rounded-3xl bg-[#2d2d2d] border border-white/10 shadow-2xl overflow-hidden">
                    {/* Inner Chat Stream */}
                    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5 custom-scrollbar">
                        {messages.map((msg) => {
                            const isProgramHead = msg.sender === 'program_head';

                            return (
                                <div
                                    key={msg.id}
                                    className={`flex w-full ${isProgramHead ? 'justify-start' : 'justify-end'} animate-in fade-in duration-300`}
                                >
                                    {/* Speech Bubble Container with directional pointer tail matching mockup */}
                                    <div
                                        className={`relative max-w-[85%] sm:max-w-[78%] px-5 py-4 rounded-3xl text-sm sm:text-base leading-relaxed tracking-normal font-sans shadow-lg transition-all ${
                                            isProgramHead
                                                ? 'bg-[#3e3e3e] text-white rounded-tl-sm border border-white/10'
                                                : 'bg-[#4a4a4a] text-white rounded-tr-sm border border-emerald-500/20'
                                        }`}
                                    >
                                        {/* Speaker Header */}
                                        <div className="flex items-center justify-between space-x-2 mb-1.5 opacity-70 text-[11px] font-mono">
                                            <span className={`font-bold ${isProgramHead ? 'text-blue-300' : 'text-emerald-300'}`}>
                                                {isProgramHead ? 'Program Head (CCS)' : 'Interviewee'}
                                            </span>
                                            <span>{msg.timestamp}</span>
                                        </div>

                                        {/* Message Body */}
                                        <p className="whitespace-pre-line text-slate-100 font-medium">
                                            {msg.text}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Real-time Interim Voice Speech Preview Bubble */}
                        {isUserListening && (
                            <div className="flex w-full justify-end animate-in fade-in duration-150">
                                <div className="max-w-[88%] sm:max-w-[82%] px-5 py-4 rounded-3xl bg-[#2b3c32] text-emerald-100 rounded-tr-sm border border-emerald-400/40 shadow-xl space-y-2">
                                    <div className="flex items-center justify-between space-x-2 text-[11px] font-mono text-emerald-300">
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                                            <span className="font-semibold">
                                                {liveTranscript ? 'Hearing your response...' : 'Listening to your microphone...'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={handleUserTurnComplete}
                                            className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-xs flex items-center space-x-1 cursor-pointer transition-all shadow"
                                            title="Click when finished speaking"
                                        >
                                            <span>✓ Done Speaking</span>
                                            <ArrowRight className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <p className="italic text-sm sm:text-base text-emerald-50 font-medium">
                                        {liveTranscript ? `"${liveTranscript}"` : "Speak freely into your mic. The system will auto-advance on silence, or click Done Speaking when finished."}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Program Head Typing / Thinking Bubble */}
                        {isAiThinking && (
                            <div className="flex w-full justify-start animate-in fade-in duration-200">
                                <div className="px-5 py-3 rounded-2xl bg-[#3e3e3e] border border-white/10 text-slate-300 flex items-center space-x-2">
                                    <span className="text-xs font-mono text-blue-300">Program Head is formulating response...</span>
                                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-100" />
                                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-200" />
                                </div>
                            </div>
                        )}

                        {/* Auto-scroll target */}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Bottom Status / Advance Control Notice */}
                    <div className="bg-[#242424] border-t border-white/10 px-4 py-3 flex items-center justify-between text-xs font-mono text-slate-400">
                        <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold">
                                100% HANDS-FREE
                            </span>
                            <span>Automatic silence detection (1.8s) • Or tap Done Speaking / Spacebar</span>
                        </div>
                        {isUserListening && (
                            <button
                                onClick={handleUserTurnComplete}
                                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-emerald-500 hover:text-slate-950 text-emerald-300 font-semibold text-xs border border-white/15 transition-all cursor-pointer flex items-center space-x-1"
                            >
                                <span>Next Turn →</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* 3. RIGHT SIDE: Interviewee Avatar Column */}
                <div className="w-52 md:w-64 lg:w-72 shrink-0 flex flex-col justify-end items-center pb-6 md:pb-10 pr-2">
                    <IntervieweeAvatar 
                        isListening={isUserListening} 
                        volumeLevel={micVolume}
                        size={170} 
                    />
                </div>
            </main>

            {/* COMPLETION MODAL: Triggered Automatically When Interview Finishes */}
            {turnState === 'completed' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="w-full max-w-xl rounded-3xl p-6 sm:p-8 bg-[#282828] border border-emerald-500/30 shadow-2xl space-y-6 text-center text-white">
                        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
                            <GraduationCap className="w-10 h-10" />
                        </div>

                        <div className="space-y-2">
                            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-mono font-bold">
                                Interview Complete & Persisted
                            </span>
                            <h2 className="text-2xl font-serif font-bold text-white">
                                Congratulations, LSPU CCS Graduate!
                            </h2>
                            <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
                                Your entire exit interview conversation and valuable insights have been automatically saved to the database. The AI has learned from your feedback to improve future curriculum and laboratory services.
                            </p>
                        </div>

                        {/* Summary Pill Box */}
                        {completionRecord && (
                            <div className="p-4 rounded-2xl bg-[#1e1e1e] border border-white/10 text-left text-xs font-mono space-y-1.5 text-slate-300">
                                <p><span className="text-slate-500">Student:</span> <strong className="text-white">{completionRecord.name}</strong> ({completionRecord.studentId})</p>
                                <p><span className="text-slate-500">Program:</span> {completionRecord.program}</p>
                                <p><span className="text-slate-500">Sentiment:</span> <span className="text-emerald-400 font-bold">{completionRecord.sentiment?.label}</span> ({completionRecord.sentiment?.score})</p>
                                <p><span className="text-slate-500">Database ID:</span> {completionRecord.id}</p>
                            </div>
                        )}

                        <div className="pt-2">
                            <button
                                onClick={() => {
                                    if (onExitToLanding) onExitToLanding();
                                }}
                                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-bold text-sm shadow-xl transition-all cursor-pointer transform hover:scale-[1.02]"
                            >
                                Return to Home Page
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* EXIT CONFIRMATION MODAL */}
            {showExitModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="w-full max-w-md rounded-3xl p-6 sm:p-8 border border-white/10 bg-[#282828] space-y-6 text-center text-white">
                        <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
                            <AlertCircle className="w-8 h-8" />
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-lg font-bold text-white">Exit Interview Session?</h3>
                            <p className="text-sm text-slate-300 leading-relaxed">
                                Exiting now will terminate the active conversational interview session.
                            </p>
                        </div>

                        <div className="flex items-center justify-center gap-3 pt-2">
                            <button
                                onClick={() => setShowExitModal(false)}
                                className="flex-1 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-bold transition-all border border-white/10 cursor-pointer"
                            >
                                Cancel
                            </button>

                            <button
                                onClick={() => {
                                    setShowExitModal(false);
                                    ttsService.stop();
                                    if (audioCleanerRef.current) {
                                        audioCleanerRef.current.destroy();
                                    }
                                    if (webSpeechRecRef.current) {
                                        try { webSpeechRecRef.current.stop(); } catch (e) {}
                                    }
                                    if (onExitToLanding) onExitToLanding();
                                }}
                                className="flex-1 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/30 transition-all cursor-pointer"
                            >
                                Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
