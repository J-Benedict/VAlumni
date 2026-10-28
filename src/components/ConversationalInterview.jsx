import React, { useState, useEffect, useRef } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import { ProgramHeadAvatar, IntervieweeAvatar } from './InterviewAvatars';
import { AudioCleanerPipeline } from '../services/audioCleaner';
import { ttsService, tokenizeTextForSync } from '../services/ttsService';
import { 
    INTERVIEW_DOMAINS, 
    generateProgramHeadReply, 
    extractAndSaveInterviewSession
} from '../services/conversationalAiService';
import { 
    Volume2, 
    VolumeX, 
    Sparkles, 
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
    const [turnState, setTurnState] = useState('ai_thinking');
    // Real-time word-by-word sync state: { msgId, tokens, visibleWordCount, totalWords } | null
    const [streamingSpeech, setStreamingSpeech] = useState(null);
    const [liveTranscript, setLiveTranscript] = useState('');
    const [micNotice, setMicNotice] = useState('');
    const [micVolume, setMicVolume] = useState(0);
    const [ttsEnabled, setTtsEnabled] = useState(true);
    const [ttsEngine, setTtsEngine] = useState('neural');
    const [selectedVoice, setSelectedVoice] = useState(() => {
        return localStorage.getItem('valumni_selected_tts_voice') || 'fil-PH-AngeloNeural';
    });
    const [showExitModal, setShowExitModal] = useState(false);
    const [completionRecord, setCompletionRecord] = useState(null);
    const [sttStatus, setSttStatus] = useState({ online: false });

    // Refs to prevent stale closures in async audio/VAD/keyboard callbacks
    const chatStreamRef = useRef(null);
    const chatEndRef = useRef(null);
    const audioCleanerRef = useRef(null);
    const webSpeechRecRef = useRef(null);
    const accumulatedSpeechRef = useRef('');
    const turnStateRef = useRef(turnState);
    const messagesRef = useRef(messages);
    const currentStageRef = useRef(currentStage);
    const sttStatusRef = useRef(sttStatus);
    const liveTranscriptRef = useRef('');
    const ttsEnabledRef = useRef(ttsEnabled);
    const selectedVoiceRef = useRef(selectedVoice);
    const speechEndTimeoutRef = useRef(null);
    const mutedStreamTimerRef = useRef(null);
    const pendingTurnCommitRef = useRef(null);
    const isSubmittingTurnRef = useRef(false);
    const isUnmountedRef = useRef(false);
    const handleUserTurnCompleteRef = useRef(null);

    // Sync state -> refs
    useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
    useEffect(() => { turnStateRef.current = turnState; }, [turnState]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { currentStageRef.current = currentStage; }, [currentStage]);
    useEffect(() => { sttStatusRef.current = sttStatus; }, [sttStatus]);
    useEffect(() => { liveTranscriptRef.current = liveTranscript; }, [liveTranscript]);
    useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

    // Subscribe to TTS engine status updates
    useEffect(() => {
        ttsService.onEngineStatus = (engine) => setTtsEngine(engine);
        return () => { ttsService.onEngineStatus = null; };
    }, []);

    // Smoothly scroll on new bubbles
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages.length, liveTranscript, turnState, micNotice]);

    // Instant non-jittery scroll pin while words flow in at 60 FPS
    useEffect(() => {
        if (streamingSpeech && chatStreamRef.current) {
            const el = chatStreamRef.current;
            el.scrollTop = el.scrollHeight;
        }
    }, [streamingSpeech?.visibleWordCount]);

    // Poll Whisper STT microservice status (retries automatically while model loads into RAM)
    useEffect(() => {
        let cancelled = false;
        let attempts = 0;
        let timerId = null;

        const checkStt = async () => {
            attempts += 1;
            try {
                const res = await fetch('/api/stt/status');
                const data = await res.json();
                if (cancelled) return;
                setSttStatus(data);
                if (!data.online && attempts < 15) {
                    timerId = setTimeout(checkStt, 3000);
                }
            } catch (e) {
                if (!cancelled && attempts < 15) {
                    timerId = setTimeout(checkStt, 3000);
                }
            }
        };

        checkStt();
        return () => {
            cancelled = true;
            if (timerId) clearTimeout(timerId);
        };
    }, []);

    // Background prefetch helper so deterministic upcoming stages start speaking in 0ms
    const prefetchStagesInBackground = async (stages = [], voice = selectedVoiceRef.current, history = []) => {
        for (const stg of stages) {
            if (isUnmountedRef.current) return;
            try {
                const promptText = stg === 1
                    ? INTERVIEW_DOMAINS[0]?.starterMessage
                    : await generateProgramHeadReply({ conversationHistory: history, currentStage: stg });
                if (promptText && !isUnmountedRef.current) {
                    await ttsService.prefetch(promptText, voice);
                }
            } catch (e) { /* best-effort background warmup */ }
        }
    };

    /**
     * Unified Program Head turn delivery:
     * Holds message display until the exact millisecond voice audio begins playing (eliminating silent pre-display),
     * then streams the question words one-by-one in real-time lockstep with the TTS voice.
     */
    const deliverProgramHeadTurn = async (aiMsg, baseMessages, onComplete) => {
        const fullConversation = [...baseMessages, aiMsg];
        pendingTurnCommitRef.current = { fullConversation, onComplete };

        if (mutedStreamTimerRef.current) {
            clearInterval(mutedStreamTimerRef.current);
            mutedStreamTimerRef.current = null;
        }

        // Case A: Voice audio is enabled -> synthesize/fetch while in 'ai_thinking', reveal bubble + stream words on 'onStart'
        if (ttsEnabledRef.current) {
            setTurnState('ai_thinking');
            turnStateRef.current = 'ai_thinking';

            let revealedBubble = false;

            await ttsService.speak(aiMsg.text, {
                voice: selectedVoiceRef.current,
                onStart: ({ tokens, totalWords }) => {
                    if (isUnmountedRef.current) return;
                    revealedBubble = true;
                    setMessages(fullConversation);
                    messagesRef.current = fullConversation;
                    setStreamingSpeech({
                        msgId: aiMsg.id,
                        tokens,
                        visibleWordCount: 1,
                        totalWords
                    });
                    setTurnState('ai_speaking');
                    turnStateRef.current = 'ai_speaking';
                },
                onProgress: ({ visibleWordCount, totalWords, tokens }) => {
                    if (isUnmountedRef.current) return;
                    setStreamingSpeech({
                        msgId: aiMsg.id,
                        tokens,
                        visibleWordCount,
                        totalWords
                    });
                },
                onEnd: () => {
                    if (isUnmountedRef.current) return;
                    if (!revealedBubble) {
                        setMessages(fullConversation);
                        messagesRef.current = fullConversation;
                    }
                    pendingTurnCommitRef.current = null;
                    setStreamingSpeech(null);
                    if (onComplete) onComplete(fullConversation);
                }
            });
            return;
        }

        // Case B: User muted audio -> stream words smoothly at natural reading cadence
        const tokens = tokenizeTextForSync(aiMsg.text);
        const totalWords = tokens.length;
        setMessages(fullConversation);
        messagesRef.current = fullConversation;

        if (totalWords === 0) {
            pendingTurnCommitRef.current = null;
            if (onComplete) onComplete(fullConversation);
            return;
        }

        setTurnState('ai_speaking');
        turnStateRef.current = 'ai_speaking';
        let visible = 1;
        setStreamingSpeech({ msgId: aiMsg.id, tokens, visibleWordCount: 1, totalWords });

        await new Promise((resolve) => {
            mutedStreamTimerRef.current = setInterval(() => {
                if (isUnmountedRef.current) {
                    clearInterval(mutedStreamTimerRef.current);
                    mutedStreamTimerRef.current = null;
                    resolve();
                    return;
                }
                visible += 1;
                if (visible >= totalWords) {
                    clearInterval(mutedStreamTimerRef.current);
                    mutedStreamTimerRef.current = null;
                    pendingTurnCommitRef.current = null;
                    setStreamingSpeech(null);
                    resolve();
                } else {
                    setStreamingSpeech({ msgId: aiMsg.id, tokens, visibleWordCount: visible, totalWords });
                }
            }, 55);
        });

        if (!isUnmountedRef.current && onComplete) {
            onComplete(fullConversation);
        }
    };

    // Interrupt / skip active Program Head speech cleanly while committing the full question text
    const skipCurrentSpeechAndListen = () => {
        if (mutedStreamTimerRef.current) {
            clearInterval(mutedStreamTimerRef.current);
            mutedStreamTimerRef.current = null;
        }
        ttsService.stop();
        setStreamingSpeech(null);

        if (pendingTurnCommitRef.current) {
            const { fullConversation, onComplete } = pendingTurnCommitRef.current;
            pendingTurnCommitRef.current = null;
            setMessages(fullConversation);
            messagesRef.current = fullConversation;
            if (onComplete) {
                onComplete(fullConversation);
                return;
            }
        }

        if (currentStageRef.current < INTERVIEW_DOMAINS.length) {
            startIntervieweeListening();
        }
    };

    // -------------------------------------------------------------------------
    // HANDS-FREE VOICE LOOP: Step A - Start Listening to Interviewee
    // -------------------------------------------------------------------------
    const startIntervieweeListening = async () => {
        if (isUnmountedRef.current) return;
        isSubmittingTurnRef.current = false;
        setStreamingSpeech(null);
        setTurnState('user_listening');
        turnStateRef.current = 'user_listening';
        setLiveTranscript('');
        liveTranscriptRef.current = '';
        accumulatedSpeechRef.current = '';

        if (speechEndTimeoutRef.current) {
            clearTimeout(speechEndTimeoutRef.current);
            speechEndTimeoutRef.current = null;
        }

        // Start cleaned DSP recording & VAD loop on the selected microphone
        let hasDspVad = false;
        if (audioCleanerRef.current) {
            await audioCleanerRef.current.startListening();
            hasDspVad = Boolean(audioCleanerRef.current.cleanStream);
        }

        // Start parallel Web Speech API in Filipino/Taglish mode for live interim visual preview
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRec) {
            try {
                if (webSpeechRecRef.current) {
                    try {
                        webSpeechRecRef.current.onend = null;
                        webSpeechRecRef.current.stop();
                    } catch (e) {}
                }

                const rec = new SpeechRec();
                rec.continuous = true;
                rec.interimResults = true;
                rec.lang = 'fil-PH'; // Native bilingual Filipino + Philippine English (Taglish) recognition

                rec.onresult = (event) => {
                    let finalizedInSession = '';
                    let interimInSession = '';

                    for (let i = 0; i < event.results.length; ++i) {
                        const piece = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            finalizedInSession += piece + ' ';
                        } else {
                            interimInSession += piece;
                        }
                    }

                    const combined = `${accumulatedSpeechRef.current} ${finalizedInSession} ${interimInSession}`
                        .replace(/\s{2,}/g, ' ')
                        .trim();

                    if (combined) {
                        setMicNotice('');
                        setLiveTranscript(combined);
                        liveTranscriptRef.current = combined;

                        // Only rely on Web Speech silence timer if AudioCleaner DSP VAD could not initialize
                        if (!hasDspVad) {
                            if (speechEndTimeoutRef.current) clearTimeout(speechEndTimeoutRef.current);
                            speechEndTimeoutRef.current = setTimeout(() => {
                                handleUserTurnCompleteRef.current?.();
                            }, 2800);
                        }
                    }
                };

                rec.onend = () => {
                    // Preserve finalized transcript across automatic browser SpeechRecognition restarts
                    if (liveTranscriptRef.current) {
                        accumulatedSpeechRef.current = liveTranscriptRef.current;
                    }
                    if (turnStateRef.current === 'user_listening' && !isSubmittingTurnRef.current) {
                        try { rec.start(); } catch (e) {}
                    }
                };

                rec.onerror = (e) => {
                    if (e.error !== 'no-speech' && e.error !== 'aborted') {
                        console.warn('SpeechRecognition interim note:', e.error);
                    }
                };

                rec.start();
                webSpeechRecRef.current = rec;
            } catch (e) {
                console.warn('SpeechRecognition start fallback note:', e);
            }
        }
    };

    // -------------------------------------------------------------------------
    // HANDS-FREE VOICE LOOP: Step B - User Finished Speaking
    // -------------------------------------------------------------------------
    const handleUserTurnComplete = async () => {
        if (isSubmittingTurnRef.current) return;
        if (turnStateRef.current !== 'user_listening') return;

        isSubmittingTurnRef.current = true;

        if (speechEndTimeoutRef.current) {
            clearTimeout(speechEndTimeoutRef.current);
            speechEndTimeoutRef.current = null;
        }

        setTurnState('user_processing');
        turnStateRef.current = 'user_processing';

        // 1. Stop Web Speech recognition cleanly
        if (webSpeechRecRef.current) {
            try {
                webSpeechRecRef.current.onend = null;
                webSpeechRecRef.current.stop();
            } catch (e) {}
            webSpeechRecRef.current = null;
        }

        // 2. Stop cleaned DSP recorder and obtain audio blob
        const hadGenuineMicSpeech = audioCleanerRef.current?.hasGenuineSpeech?.() || false;
        let audioBlob = null;
        if (audioCleanerRef.current) {
            audioBlob = await audioCleanerRef.current.stopListening();
        }

        let finalTranscriptText = '';

        // 3. Primary STT: Send cleaned microphone recording to faster-whisper (supports Tagalog, English, Taglish & custom deviceId)
        if (audioBlob && audioBlob.size > 1200) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 25000);
                const formData = new FormData();
                formData.append('audio', audioBlob, 'cleaned_speech.webm');

                const whisperResp = await fetch('/api/stt/transcribe', {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (whisperResp.ok) {
                    const whisperData = await whisperResp.json();
                    if (!sttStatusRef.current.online) {
                        setSttStatus({ online: true, model: whisperData.model, device: whisperData.device });
                    }
                    if (whisperData.success && whisperData.transcript && whisperData.transcript.trim()) {
                        finalTranscriptText = whisperData.transcript.trim();
                    }
                }
            } catch (err) {
                console.warn('Whisper STT unavailable, falling back to browser speech transcript:', err);
            }
        }

        // 4. Fallback STT: Browser live transcript if Whisper returned empty or was offline
        if (!finalTranscriptText && liveTranscriptRef.current && liveTranscriptRef.current.trim()) {
            finalTranscriptText = liveTranscriptRef.current.trim();
        }

        // 5. NEVER insert a predetermined answer! If no speech was captured, prompt user & keep listening on the same stage.
        if (!finalTranscriptText) {
            setMicNotice(
                hadGenuineMicSpeech
                    ? 'Hindi po narinig nang malinaw ang iyong sinabi. Pakisubukan pong magsalita muli nang malapit sa mikropono.'
                    : 'Wala pong na-detect na boses mula sa iyong mikropono. Pakisubukan pong magsalita muli.'
            );
            isSubmittingTurnRef.current = false;
            await startIntervieweeListening();
            return;
        }

        setMicNotice('');

        // 6. Append Interviewee's real transcribed answer to chat feed
        const userMsg = {
            id: `msg_user_${Date.now()}`,
            sender: 'interviewee',
            text: finalTranscriptText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        const updatedMessages = [...messagesRef.current, userMsg];
        setMessages(updatedMessages);
        messagesRef.current = updatedMessages;
        setLiveTranscript('');
        liveTranscriptRef.current = '';
        accumulatedSpeechRef.current = '';

        // 7. Advance interview stage
        const nextStage = currentStageRef.current + 1;
        setCurrentStage(nextStage);
        currentStageRef.current = nextStage;

        // 8. Program Head processes alumnus's answer & prepares audio BEFORE displaying bubble
        setTurnState('ai_thinking');
        turnStateRef.current = 'ai_thinking';

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

            isSubmittingTurnRef.current = false;

            // Once Stage 1 profile answer is captured, pre-warm personalized Stage 7 closing in the background
            if (nextStage === 2 && ttsEnabledRef.current) {
                setTimeout(() => {
                    prefetchStagesInBackground([7], selectedVoiceRef.current, updatedMessages);
                }, 1500);
            }

            // 9. Deliver Program Head speech + synchronous word-by-word text flow
            if (nextStage >= INTERVIEW_DOMAINS.length) {
                await deliverProgramHeadTurn(aiMsg, updatedMessages, async (fullConversation) => {
                    setTurnState('completed');
                    turnStateRef.current = 'completed';
                    const savedRecord = await extractAndSaveInterviewSession(fullConversation);
                    setCompletionRecord(savedRecord);
                    if (onInterviewComplete) onInterviewComplete(savedRecord);
                });
            } else {
                await deliverProgramHeadTurn(aiMsg, updatedMessages, () => {
                    startIntervieweeListening();
                });
            }
        } catch (err) {
            console.error('Error generating AI reply:', err);
            isSubmittingTurnRef.current = false;
            await startIntervieweeListening();
        }
    };

    // Keep latest handler in ref so VAD & keyboard callbacks never use stale state
    useEffect(() => {
        handleUserTurnCompleteRef.current = handleUserTurnComplete;
    });

    // -------------------------------------------------------------------------
    // INITIALIZATION: Start Hands-Free Session Immediately
    // -------------------------------------------------------------------------
    useEffect(() => {
        isUnmountedRef.current = false;

        const startSession = async () => {
            const initialQuestion = INTERVIEW_DOMAINS[0].starterMessage;

            // Ensure Stage 1 audio is warming in parallel while microphone initializes
            if (ttsEnabledRef.current) {
                ttsService.prefetch(initialQuestion, selectedVoiceRef.current);
            }

            // 1. Initialize Web Audio DSP Noise Reduction Pipeline
            try {
                audioCleanerRef.current = new AudioCleanerPipeline({
                    silenceTimeoutMs: 2600,
                    speechThreshold: 16,
                    minSpeechDurationMs: 800,
                    onSpeechStart: () => {
                        setMicNotice('');
                    },
                    onSpeechVolume: (vol) => {
                        setMicVolume(vol);
                    },
                    onSilenceDetected: () => {
                        handleUserTurnCompleteRef.current?.();
                    }
                });

                await audioCleanerRef.current.init();
            } catch (err) {
                console.warn('Microphone DSP initialization note:', err);
            }

            if (isUnmountedRef.current) return;

            // Pre-synthesize deterministic middle stages (3, 4, 5, 6) in background after Stage 1 starts
            if (ttsEnabledRef.current) {
                setTimeout(() => {
                    prefetchStagesInBackground([3, 4, 5, 6], selectedVoiceRef.current, []);
                }, 1200);
            }

            // 2. Program Head delivers welcoming question: bubble + words appear at exact audio start
            const initialMsg = {
                id: 'msg_0',
                sender: 'program_head',
                text: initialQuestion,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            await deliverProgramHeadTurn(initialMsg, [], () => {
                startIntervieweeListening();
            });
        };

        startSession();

        return () => {
            isUnmountedRef.current = true;
            ttsService.stop();
            if (mutedStreamTimerRef.current) {
                clearInterval(mutedStreamTimerRef.current);
            }
            if (speechEndTimeoutRef.current) {
                clearTimeout(speechEndTimeoutRef.current);
            }
            if (audioCleanerRef.current) {
                audioCleanerRef.current.destroy();
            }
            if (webSpeechRecRef.current) {
                try {
                    webSpeechRecRef.current.onend = null;
                    webSpeechRecRef.current.stop();
                } catch (e) {}
            }
        };
    }, []);

    // Keyboard shortcut (Space) to finish speaking turn
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (['input', 'textarea', 'select', 'button'].includes(document.activeElement?.tagName?.toLowerCase())) return;
            if (e.code === 'Space' && turnStateRef.current === 'user_listening') {
                e.preventDefault();
                handleUserTurnCompleteRef.current?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Handle switching voice mid-session (immediately re-speaks + re-streams words in sync!)
    const handleVoiceChange = async (newVoice) => {
        setSelectedVoice(newVoice);
        selectedVoiceRef.current = newVoice;
        localStorage.setItem('valumni_selected_tts_voice', newVoice);

        // Warm upcoming stages for the newly selected voice
        setTimeout(() => {
            prefetchStagesInBackground([3, 4, 5, 6], newVoice, messagesRef.current);
        }, 1000);

        if (ttsEnabledRef.current && (turnStateRef.current === 'ai_speaking' || pendingTurnCommitRef.current)) {
            const pending = pendingTurnCommitRef.current;
            const lastAiMsg = pending
                ? pending.fullConversation[pending.fullConversation.length - 1]
                : [...messagesRef.current].reverse().find(m => m.sender === 'program_head');

            if (lastAiMsg) {
                setTurnState('ai_thinking');
                turnStateRef.current = 'ai_thinking';
                setStreamingSpeech(null);

                await ttsService.speak(lastAiMsg.text, {
                    voice: newVoice,
                    onStart: ({ tokens, totalWords }) => {
                        if (pending) {
                            setMessages(pending.fullConversation);
                            messagesRef.current = pending.fullConversation;
                        }
                        setStreamingSpeech({
                            msgId: lastAiMsg.id,
                            tokens,
                            visibleWordCount: 1,
                            totalWords
                        });
                        setTurnState('ai_speaking');
                        turnStateRef.current = 'ai_speaking';
                    },
                    onProgress: ({ visibleWordCount, totalWords, tokens }) => {
                        setStreamingSpeech({
                            msgId: lastAiMsg.id,
                            tokens,
                            visibleWordCount,
                            totalWords
                        });
                    },
                    onEnd: () => {
                        pendingTurnCommitRef.current = null;
                        setStreamingSpeech(null);
                        if (pending?.onComplete) {
                            pending.onComplete(pending.fullConversation);
                        } else if (currentStageRef.current < INTERVIEW_DOMAINS.length) {
                            startIntervieweeListening();
                        }
                    }
                });
            }
        }
    };

    // Replay any Program Head question on demand with synchronized word-by-word flow
    const handleReplayMessage = async (msg) => {
        if (!msg?.text) return;
        if (!ttsEnabledRef.current) {
            setTtsEnabled(true);
            ttsEnabledRef.current = true;
        }
        // Pause mic recording while replaying so AI voice isn't recorded into user mic
        const wasListening = turnStateRef.current === 'user_listening';
        if (wasListening) {
            if (webSpeechRecRef.current) {
                try {
                    webSpeechRecRef.current.onend = null;
                    webSpeechRecRef.current.stop();
                } catch (e) {}
            }
            if (audioCleanerRef.current) {
                await audioCleanerRef.current.stopListening();
            }
        }

        setTurnState('ai_thinking');
        turnStateRef.current = 'ai_thinking';

        await ttsService.speak(msg.text, {
            voice: selectedVoiceRef.current,
            onStart: ({ tokens, totalWords }) => {
                setStreamingSpeech({
                    msgId: msg.id,
                    tokens,
                    visibleWordCount: 1,
                    totalWords
                });
                setTurnState('ai_speaking');
                turnStateRef.current = 'ai_speaking';
            },
            onProgress: ({ visibleWordCount, totalWords, tokens }) => {
                setStreamingSpeech({
                    msgId: msg.id,
                    tokens,
                    visibleWordCount,
                    totalWords
                });
            },
            onEnd: () => {
                setStreamingSpeech(null);
                if (wasListening || currentStageRef.current < INTERVIEW_DOMAINS.length) {
                    startIntervieweeListening();
                }
            }
        });
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
                            Laguna State Polytechnic University • Alumni Exit Interview AI
                        </p>
                    </div>
                </div>

                {/* Right: Voice Selector, Mute, and Exit */}
                <div className="flex items-center space-x-2 sm:space-x-2.5">
                    {/* Neural Voice Model Selector */}
                    <div className="flex items-center space-x-1.5 bg-white/5 border border-white/10 px-2.5 py-1 rounded-xl text-xs font-mono">
                        <span className="text-slate-400 hidden sm:inline">Voice:</span>
                        <select
                            value={selectedVoice}
                            onChange={(e) => handleVoiceChange(e.target.value)}
                            className="bg-transparent text-blue-300 font-semibold focus:outline-none cursor-pointer text-xs"
                            title={ttsEngine === 'neural' ? 'Microsoft Edge Neural Voice Active' : 'TTS Voice Selection'}
                        >
                            <option value="fil-PH-AngeloNeural" className="bg-[#242424] text-white">Angelo (Filipino/Taglish Male)</option>
                            <option value="fil-PH-BlessicaNeural" className="bg-[#242424] text-white">Blessica (Filipino/Taglish Female)</option>
                            <option value="en-PH-JamesNeural" className="bg-[#242424] text-white">James (PH English Male • Auto-Fil)</option>
                            <option value="en-PH-RosaNeural" className="bg-[#242424] text-white">Rosa (PH English Female • Auto-Fil)</option>
                        </select>
                    </div>

                    {/* TTS Mute Toggle */}
                    <button
                        onClick={() => {
                            const next = !ttsEnabled;
                            setTtsEnabled(next);
                            ttsEnabledRef.current = next;
                            if (!next && (turnStateRef.current === 'ai_speaking' || pendingTurnCommitRef.current)) {
                                skipCurrentSpeechAndListen();
                            }
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
                    <div className="flex items-center space-x-3 text-xs font-mono text-blue-400">
                        <div className="flex items-center space-x-2 animate-pulse">
                            <Activity className="w-4 h-4 text-blue-400" />
                            <span>Program Head is speaking ({ttsEngine === 'neural' ? 'Edge Neural HD' : 'Voice'})...</span>
                        </div>
                        {currentStage < INTERVIEW_DOMAINS.length && (
                            <button
                                onClick={skipCurrentSpeechAndListen}
                                className="px-2.5 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] border border-white/15 cursor-pointer transition-all"
                            >
                                Skip Audio → Answer Now
                            </button>
                        )}
                    </div>
                )}
                {isUserListening && (
                    <div className="flex items-center space-x-3 text-xs font-mono text-emerald-400 flex-wrap justify-center gap-y-1">
                        <div className="flex items-center space-x-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                            <span className="font-bold">Microphone active — Speak in Filipino, English, or Taglish...</span>
                            <div className="w-20 h-2 bg-slate-800 rounded-full overflow-hidden border border-emerald-500/30 ml-1" title={`Mic Input Level: ${micVolume}%`}>
                                <div 
                                    className="h-full bg-emerald-400 transition-all duration-75"
                                    style={{ width: `${micVolume}%` }}
                                />
                            </div>
                        </div>

                        {/* Instant Advance / Done Speaking Action Button */}
                        <button
                            onClick={() => handleUserTurnComplete()}
                            className="px-3 py-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-xs flex items-center space-x-1.5 shadow-lg shadow-emerald-500/25 transition-all cursor-pointer border border-emerald-300"
                            title="Click or press Spacebar when you finish speaking"
                        >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Done Speaking</span>
                            <span className="text-[10px] bg-black/20 px-1 py-0.5 rounded font-mono hidden sm:inline">Space</span>
                            <ArrowRight className="w-3 h-3 ml-0.5" />
                        </button>
                    </div>
                )}
                {turnState === 'user_processing' && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-amber-400">
                        <Sparkles className="w-4 h-4 text-amber-400 animate-spin" />
                        <span>Transcribing your voice response accurately...</span>
                    </div>
                )}
                {isAiThinking && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-purple-400 animate-pulse">
                        <Database className="w-4 h-4 text-purple-400 animate-bounce" />
                        <span>Program Head is preparing response...</span>
                    </div>
                )}
                {turnState === 'completed' && (
                    <div className="flex items-center space-x-2 text-xs font-mono text-emerald-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Interview successfully completed and saved to database!</span>
                    </div>
                )}
            </div>

            {/* MAIN STAGE: Program Head on Left, Chat in Middle, Interviewee on Right */}
            <main className="flex-1 min-h-0 flex items-stretch justify-between px-3 sm:px-6 md:px-8 py-4 sm:py-6 relative overflow-hidden">
                
                {/* 1. LEFT SIDE: Program Head Avatar Column */}
                <div className="hidden sm:flex w-44 md:w-60 lg:w-72 shrink-0 flex-col justify-end items-center pb-6 md:pb-10 pl-2">
                    <ProgramHeadAvatar 
                        isSpeaking={isAiSpeaking} 
                        isThinking={isAiThinking}
                        size={170} 
                    />
                </div>

                {/* 2. MIDDLE: Messaging Conversation Feed */}
                <div className="flex-1 max-w-3xl mx-auto sm:mx-4 flex flex-col rounded-3xl bg-[#2d2d2d] border border-white/10 shadow-2xl overflow-hidden">
                    {/* Inner Chat Stream */}
                    <div
                        ref={chatStreamRef}
                        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5 custom-scrollbar select-text"
                    >
                        {messages.map((msg) => {
                            const isProgramHead = msg.sender === 'program_head';
                            const isStreamingThis =
                                isProgramHead &&
                                streamingSpeech &&
                                streamingSpeech.msgId === msg.id &&
                                Array.isArray(streamingSpeech.tokens);

                            return (
                                <div
                                    key={msg.id}
                                    className={`flex w-full ${isProgramHead ? 'justify-start' : 'justify-end'}`}
                                >
                                    <div
                                        className={`relative max-w-[88%] sm:max-w-[80%] px-5 py-4 rounded-3xl text-sm sm:text-base leading-relaxed tracking-normal font-sans shadow-lg transition-all ${
                                            isProgramHead
                                                ? 'bg-[#3e3e3e] text-white rounded-tl-sm border border-white/10'
                                                : 'bg-[#244335] text-white rounded-tr-sm border border-emerald-500/30'
                                        }`}
                                    >
                                        {/* Speaker Header */}
                                        <div className="flex items-center justify-between space-x-3 mb-1.5 opacity-80 text-[11px] font-mono">
                                            <span className={`font-bold ${isProgramHead ? 'text-blue-300' : 'text-emerald-300'}`}>
                                                {isProgramHead ? 'Program Head (CCS)' : 'Interviewee (You)'}
                                            </span>
                                            <div className="flex items-center space-x-2">
                                                {isProgramHead && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleReplayMessage(msg)}
                                                        className="text-slate-300 hover:text-blue-300 transition-colors cursor-pointer flex items-center space-x-1"
                                                        title="Replay question audio"
                                                    >
                                                        <Volume2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                <span>{msg.timestamp}</span>
                                            </div>
                                        </div>

                                        {/* Message Body: Word-by-word synchronous stream when Program Head is speaking */}
                                        <p className="whitespace-pre-line text-slate-100 font-medium">
                                            {isStreamingThis ? (
                                                <>
                                                    {streamingSpeech.tokens
                                                        .slice(0, streamingSpeech.visibleWordCount)
                                                        .map((wordToken, wIdx) => (
                                                            <span key={wIdx} className="tts-word-flow">
                                                                {wordToken}
                                                            </span>
                                                        ))}
                                                    {streamingSpeech.visibleWordCount < streamingSpeech.totalWords && (
                                                        <span className="tts-speaking-caret" aria-hidden="true" />
                                                    )}
                                                </>
                                            ) : (
                                                msg.text
                                            )}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Microphone Retry Notice (shown instead of fake predetermined text if mic heard no words) */}
                        {micNotice && isUserListening && (
                            <div className="flex w-full justify-center">
                                <div className="max-w-[90%] px-4 py-2.5 rounded-2xl bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs font-mono flex items-center space-x-2">
                                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                                    <span>{micNotice}</span>
                                </div>
                            </div>
                        )}

                        {/* Real-time Interim Voice Speech Preview Bubble */}
                        {isUserListening && (
                            <div className="flex w-full justify-end">
                                <div className="max-w-[88%] sm:max-w-[82%] px-5 py-4 rounded-3xl bg-[#2b3c32] text-emerald-100 rounded-tr-sm border border-emerald-400/40 shadow-xl space-y-2">
                                    <div className="flex items-center justify-between space-x-3 text-[11px] font-mono text-emerald-300">
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                                            <span className="font-semibold">
                                                {liveTranscript
                                                    ? 'Hearing your voice...'
                                                    : (sttStatus.online ? 'Recording for Whisper AI STT...' : 'Listening to your microphone...')}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleUserTurnComplete()}
                                            className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-xs flex items-center space-x-1 cursor-pointer transition-all shadow"
                                            title="Click when finished speaking"
                                        >
                                            <span>✓ Done Speaking</span>
                                            <ArrowRight className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <p className="italic text-sm sm:text-base text-emerald-50 font-medium">
                                        {liveTranscript
                                            ? `"${liveTranscript}"`
                                            : 'Speak naturally into your microphone. Auto-submits after 2.6s of silence once you finish speaking, or click Done Speaking.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Transcribing Indicator Bubble */}
                        {turnState === 'user_processing' && (
                            <div className="flex w-full justify-end">
                                <div className="px-5 py-3 rounded-2xl bg-[#2b3c32] border border-emerald-400/30 text-emerald-200 flex items-center space-x-2 text-xs font-mono">
                                    <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
                                    <span>{sttStatus.online ? 'Transcribing audio with faster-whisper...' : 'Processing speech transcript...'}</span>
                                </div>
                            </div>
                        )}

                        {/* Program Head Preparing Bubble (shown briefly only until voice audio begins playing) */}
                        {isAiThinking && (
                            <div className="flex w-full justify-start">
                                <div className="px-5 py-3 rounded-2xl bg-[#3e3e3e] border border-white/10 text-slate-300 flex items-center space-x-2">
                                    <span className="text-xs font-mono text-blue-300">Program Head is preparing to speak...</span>
                                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-100" />
                                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-200" />
                                </div>
                            </div>
                        )}

                        {/* Auto-scroll target */}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Bottom Hands-Free Voice Status Bar (Voice Input Only) */}
                    <div className="bg-[#242424] border-t border-white/10 px-4 py-3 flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold">
                                100% HANDS-FREE VOICE
                            </span>
                            <span className="hidden sm:inline">Automatic silence detection (2.6s) after speech • Spacebar to finish speaking</span>
                        </div>
                        {isUserListening && (
                            <button
                                type="button"
                                onClick={() => handleUserTurnComplete()}
                                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-emerald-500 hover:text-slate-950 text-emerald-300 font-semibold text-xs border border-white/15 transition-all cursor-pointer"
                            >
                                Done Speaking →
                            </button>
                        )}
                    </div>
                </div>

                {/* 3. RIGHT SIDE: Interviewee Avatar Column */}
                <div className="hidden sm:flex w-44 md:w-60 lg:w-72 shrink-0 flex-col justify-end items-center pb-6 md:pb-10 pr-2">
                    <IntervieweeAvatar 
                        isListening={isUserListening} 
                        volumeLevel={micVolume}
                        size={170} 
                    />
                </div>
            </main>

            {/* COMPLETION MODAL: Triggered Automatically When Interview Finishes */}
            {turnState === 'completed' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="w-full max-w-xl rounded-3xl p-6 sm:p-8 bg-[#282828] border border-emerald-500/30 shadow-2xl space-y-6 text-center text-white">
                        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
                            <GraduationCap className="w-10 h-10" />
                        </div>

                        <div className="space-y-2">
                            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-mono font-bold">
                                Interview Complete & Persisted
                            </span>
                            <h2 className="text-2xl font-serif font-bold text-white">
                                Thank You, LSPU CCS Alumnus!
                            </h2>
                            <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
                                Your entire alumni exit interview conversation and verbatim insights have been saved to the database.
                            </p>
                        </div>

                        {/* Summary Pill Box */}
                        {completionRecord && (
                            <div className="p-4 rounded-2xl bg-[#1e1e1e] border border-white/10 text-left text-xs font-mono space-y-1.5 text-slate-300">
                                <p><span className="text-slate-500">Alumnus:</span> <strong className="text-white">{completionRecord.name}</strong> ({completionRecord.studentId})</p>
                                <p><span className="text-slate-500">Program:</span> {completionRecord.program}</p>
                                <p><span className="text-slate-500">Overall Rating:</span> <strong className="text-amber-300">{completionRecord.ratings?.overallAvg} / 5.0</strong></p>
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
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
                                        try {
                                            webSpeechRecRef.current.onend = null;
                                            webSpeechRecRef.current.stop();
                                        } catch (e) {}
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
