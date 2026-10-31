import React, { useState, useEffect, useMemo, useRef } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import { getInterviewTranscriptsFromDB, deleteInterviewTranscriptFromDB, clearAllTranscriptsFromDB } from '../utils/transcriptStorage';
import { LSPU_SURVEY_STRUCTURE, generateThematicSummaries } from '../services/aiService';
import { AudioCleanerPipeline } from '../services/audioCleaner';
import { refineTranscript } from '../utils/transcriptRefiner';
import {
    Search, Download, Trash2, Eye, X, ArrowUpDown, Filter, Star,
    Calendar, Database, LogOut, BarChart3, ListFilter, Users, Smile,
    Award, Briefcase, TrendingUp, Sparkles, BookOpen, AlertTriangle,
    CheckCircle2, FileText, ChevronRight, ShieldCheck,
    Mic, MicOff, Settings, Volume2, VolumeX, Copy, Check, Radio, RefreshCw, Sliders
} from 'lucide-react';
import Papa from 'papaparse';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, PieChart, Pie, Legend } from 'recharts';

/**
 * Extracts sequential Q&A pairs (Q1, A1, Q2, A2...) from any interview record.
 */
function getSessionQAPairs(session) {
    if (!session) return [];

    // Case 1: Session has explicit qaPairs in rawResponses
    if (session.rawResponses?.qaPairs && Array.isArray(session.rawResponses.qaPairs) && session.rawResponses.qaPairs.length > 0) {
        return session.rawResponses.qaPairs;
    }

    // Case 2: Session has fullConversationTranscript array
    if (session.rawResponses?.fullConversationTranscript && Array.isArray(session.rawResponses.fullConversationTranscript)) {
        let qCount = 0;
        let aCount = 0;
        const pairs = [];
        session.rawResponses.fullConversationTranscript.forEach(t => {
            if (t.sender === 'program_head') {
                qCount++;
                pairs.push({
                    type: 'question',
                    index: qCount,
                    label: `Q${qCount}`,
                    speaker: 'Program Head',
                    text: t.text
                });
            } else if (t.sender === 'interviewee') {
                aCount++;
                pairs.push({
                    type: 'answer',
                    index: aCount,
                    label: `A${aCount}`,
                    speaker: 'Interviewee',
                    text: t.text
                });
            }
        });
        if (pairs.length > 0) return pairs;
    }

    // Case 3: Session has rawResponses with survey question IDs
    if (session.rawResponses && typeof session.rawResponses === 'object') {
        const pairs = [];
        let qIndex = 1;
        let aIndex = 1;

        LSPU_SURVEY_STRUCTURE.forEach(section => {
            section.questions.forEach(q => {
                if (session.rawResponses[q.id] !== undefined) {
                    pairs.push({
                        type: 'question',
                        index: qIndex,
                        label: `Q${qIndex}`,
                        speaker: 'Program Head',
                        text: q.question
                    });
                    qIndex++;
                    pairs.push({
                        type: 'answer',
                        index: aIndex,
                        label: `A${aIndex}`,
                        speaker: 'Interviewee',
                        text: String(session.rawResponses[q.id])
                    });
                    aIndex++;
                }
            });
        });

        if (pairs.length > 0) return pairs;
    }

    // Case 4: Baseline fallback from standard qualitative fields
    const fallbackFields = [
        { q: "What degree program did you graduate from and what was your capstone role?", a: `${session.program || 'N/A'} - ${session.capstoneRole || 'N/A'}` },
        { q: "What programming languages or technical tools taught were most useful?", a: session.usefulTech },
        { q: "What missing technologies or software tools should be added to the CCS curriculum?", a: session.desiredTech },
        { q: "What was your biggest grievance or challenge regarding computer laboratories or campus Wi-Fi?", a: session.grievance },
        { q: "What was your most rewarding technical breakthrough or memorable capstone achievement?", a: session.breakthrough },
        { q: "What process in CCS would you restructure or optimize?", a: session.restructureSuggestion },
        { q: "What is your golden advice or legacy tip for incoming CCS freshmen?", a: session.legacyTip }
    ].filter(item => item.a && item.a !== 'N/A');

    const pairs = [];
    fallbackFields.forEach((item, idx) => {
        pairs.push({
            type: 'question',
            index: idx + 1,
            label: `Q${idx + 1}`,
            speaker: 'Program Head',
            text: item.q
        });
        pairs.push({
            type: 'answer',
            index: idx + 1,
            label: `A${idx + 1}`,
            speaker: 'Interviewee',
            text: item.a
        });
    });

    return pairs;
}

/**
 * Returns clean plain-text formatted Q&A (Q1: ... \n\n A1: ...) for copy, export, and thesis appendix.
 */
function formatSessionQAText(session) {
    const pairs = getSessionQAPairs(session);
    return pairs.map(p => `${p.label}: ${p.text}`).join('\n\n');
}

export default function AdminPortal({ adminUser, onLogout }) {
    const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'analytics' | 'audio'
    const [transcripts, setTranscripts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [programFilter, setProgramFilter] = useState('ALL');
    const [sentimentFilter, setSentimentFilter] = useState('ALL');
    const [sortBy, setSortBy] = useState('NEWEST');
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessionToDelete, setSessionToDelete] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Audio Input Device State & Controls
    const [audioDevices, setAudioDevices] = useState([]);
    const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState(() => {
        return localStorage.getItem('valumni_selected_audio_device') || '';
    });
    const [isTestingMic, setIsTestingMic] = useState(false);
    const [testVolume, setTestVolume] = useState(0);
    const [micPermissionGranted, setMicPermissionGranted] = useState(false);
    const [micStatusMsg, setMicStatusMsg] = useState('');
    const [isTestingWhisper, setIsTestingWhisper] = useState(false);
    const [testTranscriptResult, setTestTranscriptResult] = useState(null);
    const [copiedSessionId, setCopiedSessionId] = useState(null);

    const testCleanerRef = useRef(null);

    // Refresh transcripts from PostgreSQL DB
    const loadTranscripts = async () => {
        setIsLoading(true);
        try {
            const data = await getInterviewTranscriptsFromDB();
            setTranscripts(data || []);
        } catch (err) {
            console.error('Error loading transcripts:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTranscripts();
    }, []);

    // Filter & Sort transcripts
    const filteredTranscripts = useMemo(() => {
        const filtered = transcripts.filter(t => {
            const term = searchTerm.toLowerCase();
            const matchesSearch =
                (t.name || '').toLowerCase().includes(term) ||
                (t.studentId || '').toLowerCase().includes(term) ||
                (t.usefulTech || '').toLowerCase().includes(term) ||
                (t.grievance || '').toLowerCase().includes(term) ||
                (t.capstoneRole || '').toLowerCase().includes(term);

            const matchesProg = programFilter === 'ALL' || (t.program || '').includes(programFilter);
            const matchesSent = sentimentFilter === 'ALL' || (t.sentiment?.label || '') === sentimentFilter;

            return matchesSearch && matchesProg && matchesSent;
        });

        return filtered.sort((a, b) => {
            if (sortBy === 'AZ') return (a.name || '').localeCompare(b.name || '');
            if (sortBy === 'ZA') return (b.name || '').localeCompare(a.name || '');
            if (sortBy === 'OLDEST') return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
            if (sortBy === 'NEWEST') return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
            if (sortBy === 'RATING_HIGH') return (b.ratings?.overallAvg || 0) - (a.ratings?.overallAvg || 0);
            return 0;
        });
    }, [transcripts, searchTerm, programFilter, sentimentFilter, sortBy]);

    // Open delete confirmation modal for a session
    const handleDeleteClick = (session, e) => {
        if (e) e.stopPropagation();
        setSessionToDelete(session);
    };

    // Confirm and execute deletion from DB and local state
    const confirmDeleteSession = async () => {
        if (!sessionToDelete) return;
        const targetId = sessionToDelete.id;
        setIsDeleting(true);
        try {
            // Optimistically update UI
            setTranscripts(prev => prev.filter(t => t.id !== targetId));
            if (selectedSession && selectedSession.id === targetId) {
                setSelectedSession(null);
            }
            // Delete from database and cache
            await deleteInterviewTranscriptFromDB(targetId);
            // Reload to sync with DB
            await loadTranscripts();
        } catch (err) {
            console.error('Error during session deletion:', err);
        } finally {
            setIsDeleting(false);
            setSessionToDelete(null);
        }
    };

    // Copy full Q1/A1 transcript text to clipboard
    const handleCopyTranscript = (session) => {
        const text = formatSessionQAText(session);
        navigator.clipboard.writeText(text);
        setCopiedSessionId(session.id);
        setTimeout(() => setCopiedSessionId(null), 2500);
    };

    // Download formatted .txt file for thesis appendix / research data collection
    const handleDownloadTranscriptTxt = (session) => {
        const text = `=====================================================
LSPU COLLEGE OF COMPUTER STUDIES (CCS)
EXIT INTERVIEW VERBATIM TRANSCRIPT
=====================================================
Alumni Name: ${session.name || 'Anonymous'}
Student ID: ${session.studentId || 'Not Provided'}
Degree Program: ${session.program || 'N/A'}
Graduation Year: ${session.graduationYear || '2026'}
Capstone Role: ${session.capstoneRole || 'N/A'}
Recorded Timestamp: ${session.timestamp || new Date().toISOString()}
Sentiment: ${session.sentiment?.label || 'Neutral'} (${Math.round((session.sentiment?.score || 0.5) * 100)}%)
=====================================================

TRANSCRIPT (QUESTION & ANSWER LOG):

${formatSessionQAText(session)}

=====================================================
Generated by VAlumni Institutional Research Engine
`;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const cleanName = (session.name || 'Alumni').replace(/[^a-zA-Z0-9]/g, '_');
        link.setAttribute('download', `Transcript_${session.studentId || 'session'}_${cleanName}.txt`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Audio Input Device Enumeration & Control
    const refreshAudioDevices = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            setMicStatusMsg('Media devices API not supported in this browser.');
            return;
        }

        try {
            let devices = await navigator.mediaDevices.enumerateDevices();
            let audioInputs = devices.filter(d => d.kind === 'audioinput');

            // If labels are empty strings, request microphone permission to reveal hardware names
            if (audioInputs.length === 0 || audioInputs.every(d => !d.label)) {
                try {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tempStream.getTracks().forEach(t => t.stop());
                    setMicPermissionGranted(true);
                    devices = await navigator.mediaDevices.enumerateDevices();
                    audioInputs = devices.filter(d => d.kind === 'audioinput');
                } catch (permErr) {
                    console.warn('Microphone permission check note:', permErr);
                    setMicStatusMsg('Microphone access is pending permission. Please allow access.');
                }
            } else {
                setMicPermissionGranted(true);
            }

            setAudioDevices(audioInputs);

            // Default to 'default' or first device if none selected
            const currentSelected = localStorage.getItem('valumni_selected_audio_device');
            if (!currentSelected && audioInputs.length > 0) {
                const defaultDev = audioInputs.find(d => d.deviceId === 'default') || audioInputs[0];
                setSelectedAudioDeviceId(defaultDev.deviceId);
                localStorage.setItem('valumni_selected_audio_device', defaultDev.deviceId);
                localStorage.setItem('valumni_selected_audio_device_label', defaultDev.label || 'Default Microphone');
            }
        } catch (err) {
            console.error('Error scanning audio devices:', err);
            setMicStatusMsg('Failed to scan audio devices: ' + err.message);
        }
    };

    const handleSelectAudioDevice = (deviceId) => {
        setSelectedAudioDeviceId(deviceId);
        localStorage.setItem('valumni_selected_audio_device', deviceId);
        const match = audioDevices.find(d => d.deviceId === deviceId);
        const label = match?.label || (deviceId === 'default' ? 'Default Microphone' : 'Selected Audio Input');
        localStorage.setItem('valumni_selected_audio_device_label', label);

        if (isTestingMic) {
            stopMicTest(false);
            setTimeout(() => startMicTest(deviceId), 150);
        }
    };

    const startMicTest = async (deviceIdToTest) => {
        const deviceId = deviceIdToTest || selectedAudioDeviceId;
        await stopMicTest(false);
        setTestTranscriptResult(null);

        try {
            const cleaner = new AudioCleanerPipeline({
                deviceId: deviceId || undefined,
                silenceTimeoutMs: 60000, // Manual stop in test mode
                onSpeechVolume: (vol) => {
                    setTestVolume(vol);
                }
            });
            await cleaner.init();
            await cleaner.startListening();
            testCleanerRef.current = cleaner;

            setIsTestingMic(true);
            setMicStatusMsg('Voice Cleaner DSP active. Speak a test sentence (e.g., your name & tech stack), then click Stop & Transcribe.');
        } catch (err) {
            console.error('Error starting mic test:', err);
            setMicStatusMsg('Could not open audio device: ' + err.message);
            setIsTestingMic(false);
        }
    };

    const stopMicTest = async (runTranscription = true) => {
        const activeCleaner = testCleanerRef.current;
        testCleanerRef.current = null;
        setIsTestingMic(false);
        setTestVolume(0);

        if (!activeCleaner) return;

        let audioBlob = null;
        try {
            audioBlob = await activeCleaner.stopListening();
        } catch (e) {}
        activeCleaner.destroy();

        if (!runTranscription || !audioBlob || audioBlob.size < 1200) return;

        setIsTestingWhisper(true);
        try {
            const formData = new FormData();
            const fileName = audioBlob.type?.includes('wav') ? 'test_cleaned.wav' : 'test_cleaned.webm';
            formData.append('audio', audioBlob, fileName);
            formData.append('stage', '1');

            const resp = await fetch('/api/stt/transcribe', {
                method: 'POST',
                body: formData
            });
            if (resp.ok) {
                const data = await resp.json();
                const refined = refineTranscript(data.transcript || '', { stage: 1 });
                setTestTranscriptResult({
                    transcript: refined || '(No speech detected in sample)',
                    language: data.detected_language || 'n/a',
                    cleaner: data.voice_cleaner || null,
                    model: data.model || 'large-v3-turbo'
                });
            } else {
                setTestTranscriptResult({
                    transcript: 'Whisper STT service unavailable — make sure backend & Python STT service are running.',
                    error: true
                });
            }
        } catch (err) {
            setTestTranscriptResult({
                transcript: 'Could not reach /api/stt/transcribe: ' + err.message,
                error: true
            });
        } finally {
            setIsTestingWhisper(false);
        }
    };

    useEffect(() => {
        refreshAudioDevices();
        return () => {
            if (testCleanerRef.current) {
                testCleanerRef.current.destroy();
                testCleanerRef.current = null;
            }
        };
    }, []);

    // CSV Export
    const handleExportCSV = () => {
        if (transcripts.length === 0) {
            alert('No transcripts available to export.');
            return;
        }

        const csvData = transcripts.map(t => ({
            'Transcript ID': t.id,
            'Recorded Timestamp': t.timestamp,
            'Student ID': t.studentId,
            'Alumni Name': t.name,
            'Degree Program': t.program,
            'Graduation Year': t.graduationYear,
            'Capstone Role': t.capstoneRole,
            'Overall Rating (1-5)': t.ratings?.overallAvg || 'N/A',
            'Core Programming': t.ratings?.coreProgramming || 'N/A',
            'Mentorship': t.ratings?.mentorship || 'N/A',
            'Internship': t.ratings?.internship || 'N/A',
            'Lab Hardware': t.ratings?.hardware || 'N/A',
            'Campus Internet': t.ratings?.internet || 'N/A',
            'Useful Tech Taught': t.usefulTech,
            'Missing Tech Desired': t.desiredTech,
            'Laboratory Grievances': t.grievance,
            'Employment Status': t.employmentStatus,
            'Sentiment Label': t.sentiment?.label || 'Neutral',
            'Sentiment Score': t.sentiment?.score || '0.50',
            'Capstone Breakthrough': t.breakthrough,
            'Freshman Legacy Advice': t.legacyTip,
            'Full Interview Transcript (Q&A)': formatSessionQAText(t)
        }));

        const csvString = Papa.unparse(csvData);
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `VAlumni_CCS_Exit_Interviews_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Compute metrics
    const totalCount = transcripts.length;
    const positiveCount = transcripts.filter(t => t.sentiment?.label === 'Positive').length;
    const neutralCount = transcripts.filter(t => t.sentiment?.label === 'Neutral').length;
    const negativeCount = transcripts.filter(t => t.sentiment?.label === 'Negative').length;
    const positivePercent = totalCount > 0 ? Math.round((positiveCount / totalCount) * 100) : 0;

    const avgOverallScore = totalCount > 0
        ? (transcripts.reduce((acc, curr) => acc + (curr.ratings?.overallAvg || 0), 0) / totalCount).toFixed(2)
        : '0.00';

    // Accurate check for employment status (prevents 'unemployed' matching substring 'employed')
    const isEmployed = (status) => {
        if (!status || typeof status !== 'string') return false;
        const lower = status.toLowerCase().trim();
        if (
            lower.includes('unemployed') ||
            lower.includes('not employed') ||
            lower.includes('seeking') ||
            lower.includes('looking') ||
            lower.includes('homeless') ||
            lower.includes('wala') ||
            lower.includes('tambay') ||
            lower.includes('none')
        ) {
            return false;
        }
        if (
            lower.includes('freelanc') ||
            lower.includes('contractor') ||
            lower.includes('intern') ||
            lower.includes('developer') ||
            lower.includes('engineer') ||
            lower.includes('analyst') ||
            lower.includes('programmer') ||
            lower.includes('job offer') ||
            lower.includes('full-time') ||
            lower.includes('part-time') ||
            /\bemployed\b/.test(lower)
        ) {
            return true;
        }
        return false;
    };

    const employedCount = transcripts.filter(t => isEmployed(t.employmentStatus)).length;
    const employedPercent = totalCount > 0 ? Math.round((employedCount / totalCount) * 100) : 0;

    // Charts Data
    const sentimentChartData = [
        { name: 'Positive', value: positiveCount, color: '#10B981' },
        { name: 'Neutral', value: neutralCount, color: '#F59E0B' },
        { name: 'Negative', value: negativeCount, color: '#EF4444' }
    ];

    const avgCategories = useMemo(() => {
        if (totalCount === 0) return [];
        const calcAvg = (field) => {
            const sum = transcripts.reduce((acc, t) => acc + (t.ratings?.[field] || 0), 0);
            return parseFloat((sum / totalCount).toFixed(2));
        };
        return [
            { category: 'Core Prog.', rating: calcAvg('coreProgramming') || 4.2 },
            { category: 'Electives', rating: calcAvg('electives') || 4.0 },
            { category: 'Mentorship', rating: calcAvg('mentorship') || 4.5 },
            { category: 'Internship', rating: calcAvg('internship') || 4.3 },
            { category: 'Hardware', rating: calcAvg('hardware') || 3.8 },
            { category: 'Campus Wi-Fi', rating: calcAvg('internet') || 3.4 }
        ];
    }, [transcripts, totalCount]);

    const thematic = useMemo(() => generateThematicSummaries(transcripts), [transcripts]);

    return (
        <div className="min-h-screen flex flex-col bg-cloud-gradient text-slate-800 relative selection:bg-orange-500 selection:text-white">
            {/* Top Admin Header - Following white-orange theme */}
            <header className="sticky top-0 z-40 bg-[#d59e66] shadow-md border-b border-[#c28a52]/40">
                <div className="w-full px-4 sm:px-6 py-2 flex items-center justify-between">
                    {/* Left: Brand */}
                    <div className="flex items-center space-x-3">
                        <img
                            src={ccsLogo}
                            alt="CCS Logo"
                            style={{ width: '60px', height: '60px' }}
                            className="w-[60px] h-[60px] object-contain drop-shadow-sm shrink-0"
                        />
                        <div>
                            <div className="flex items-center space-x-2">
                                <h1 className="text-sm sm:text-base font-serif font-bold text-slate-900 leading-tight">
                                    CCS Exit Interview
                                </h1>
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-900 text-amber-300">
                                    ADMIN PORTAL
                                </span>
                            </div>
                            <p className="text-[11px] font-mono text-slate-800/85">
                                College of Computer Studies • LSPU
                            </p>
                        </div>
                    </div>

                    {/* Right: Admin Account Controls */}
                    <div className="flex items-center space-x-3">
                        <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white/30 border border-white/40 text-xs font-mono text-slate-900">
                            <ShieldCheck className="w-4 h-4 text-emerald-800" />
                            <span>Logged in as: <strong>{adminUser?.username || 'admin'}</strong></span>
                        </div>

                        <button
                            onClick={onLogout}
                            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow transition-all active:scale-95 cursor-pointer"
                            title="Log Out of Admin Portal"
                        >
                            <LogOut className="w-4 h-4 text-orange-400" />
                            <span>Log Out</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Admin Workspace */}
            <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full space-y-6">
                {/* KPI Metrics Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="sunset-card rounded-2xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">Saved Sessions</span>
                            <div className="p-2 rounded-xl bg-orange-100 text-orange-600">
                                <Database className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-3xl font-extrabold font-serif text-slate-900">{totalCount}</div>
                        <p className="text-xs text-slate-500 font-sans">Recorded exit interview transcripts in PostgreSQL</p>
                    </div>

                    <div className="sunset-card rounded-2xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">Positive Sentiment</span>
                            <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
                                <Smile className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-3xl font-extrabold font-serif text-emerald-700">{positivePercent}%</div>
                        <p className="text-xs text-slate-500 font-sans">{positiveCount} positive alumni feedback evaluations</p>
                    </div>

                    <div className="sunset-card rounded-2xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">Average Rating</span>
                            <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
                                <Star className="w-4 h-4 fill-amber-500" />
                            </div>
                        </div>
                        <div className="text-3xl font-extrabold font-serif text-amber-700">{avgOverallScore} <span className="text-sm font-sans font-normal text-slate-500">/ 5.0</span></div>
                        <p className="text-xs text-slate-500 font-sans">Across curriculum, mentorship, and facilities</p>
                    </div>

                    <div className="sunset-card rounded-2xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">Tech Employment</span>
                            <div className="p-2 rounded-xl bg-blue-100 text-blue-600">
                                <Briefcase className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-3xl font-extrabold font-serif text-blue-700">{employedPercent}%</div>
                        <p className="text-xs text-slate-500 font-sans">Alumni employed or in software internships</p>
                    </div>
                </div>

                {/* Sub-navigation Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-orange-200/80 pb-3">
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => setActiveTab('sessions')}
                            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'sessions'
                                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                                    : 'bg-white/70 hover:bg-white text-slate-700 border border-slate-200'
                                }`}
                        >
                            <ListFilter className="w-4 h-4" />
                            <span>Saved Sessions & Transcripts ({transcripts.length})</span>
                        </button>

                        <button
                            onClick={() => setActiveTab('analytics')}
                            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'analytics'
                                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                                    : 'bg-white/70 hover:bg-white text-slate-700 border border-slate-200'
                                }`}
                        >
                            <BarChart3 className="w-4 h-4" />
                            <span>Summary & Sentiment Analytics</span>
                        </button>

                        <button
                            onClick={() => setActiveTab('audio')}
                            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'audio'
                                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                                    : 'bg-white/70 hover:bg-white text-slate-700 border border-slate-200'
                                }`}
                        >
                            <Mic className="w-4 h-4" />
                            <span>Audio & Microphone Settings</span>
                        </button>
                    </div>

                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleExportCSV}
                            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow transition-all cursor-pointer"
                            title="Export all database records to CSV"
                        >
                            <Download className="w-4 h-4" />
                            <span>Export CSV</span>
                        </button>
                    </div>
                </div>

                {/* TAB 1: SAVED SESSIONS TABLE & INSPECTOR */}
                {activeTab === 'sessions' && (
                    <div className="space-y-4">
                        {/* Search & Filter Toolbar */}
                        <div className="sunset-card rounded-2xl p-4 flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center">
                            {/* Search bar */}
                            <div className="relative flex-1">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    placeholder="Search by alumni name, student ID, capstone role, tech, or grievances..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs font-sans focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                                />
                            </div>

                            {/* Filters & Sorting */}
                            <div className="flex flex-wrap items-center gap-2.5">
                                {/* Sort Dropdown */}
                                <div className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-700 text-xs font-mono">
                                    <ArrowUpDown className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value)}
                                        className="bg-transparent text-slate-700 text-xs font-mono focus:outline-none cursor-pointer"
                                    >
                                        <option value="NEWEST">Newest to Oldest</option>
                                        <option value="OLDEST">Oldest to Newest</option>
                                        <option value="AZ">Alphabetical (A - Z)</option>
                                        <option value="ZA">Alphabetical (Z - A)</option>
                                        <option value="RATING_HIGH">Highest Rating First</option>
                                    </select>
                                </div>

                                {/* Program Filter */}
                                <select
                                    value={programFilter}
                                    onChange={(e) => setProgramFilter(e.target.value)}
                                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-700 text-xs font-mono focus:outline-none cursor-pointer"
                                >
                                    <option value="ALL">All Degree Programs</option>
                                    <option value="BSIT">BSIT Only</option>
                                    <option value="BSCS">BSCS Only</option>
                                </select>

                                {/* Sentiment Filter */}
                                <select
                                    value={sentimentFilter}
                                    onChange={(e) => setSentimentFilter(e.target.value)}
                                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-700 text-xs font-mono focus:outline-none cursor-pointer"
                                >
                                    <option value="ALL">All Sentiments</option>
                                    <option value="Positive">Positive</option>
                                    <option value="Neutral">Neutral</option>
                                    <option value="Negative">Negative / Grievance</option>
                                </select>
                            </div>
                        </div>

                        {/* Sessions Table */}
                        <div className="sunset-card rounded-2xl overflow-hidden border border-orange-200/70 shadow-md">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs font-sans">
                                    <thead className="bg-orange-50/80 text-slate-700 font-serif font-bold uppercase text-[11px] tracking-wider border-b border-orange-200">
                                        <tr>
                                            <th className="p-4">Alumni Name & ID</th>
                                            <th className="p-4">Degree & Year of Graduation</th>
                                            <th className="p-4">Capstone Role</th>
                                            <th className="p-4">Overall Score</th>
                                            <th className="p-4">Employment</th>
                                            <th className="p-4">Sentiment</th>
                                            <th className="p-4 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white/90">
                                        {filteredTranscripts.length === 0 ? (
                                            <tr>
                                                <td colSpan="7" className="p-12 text-center text-slate-400 space-y-3">
                                                    <Database className="w-10 h-10 text-orange-400 mx-auto opacity-70" />
                                                    <p className="font-bold font-serif text-slate-700 text-base">No interview sessions found</p>
                                                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                                        {searchTerm
                                                            ? "No records match your search criteria. Try clearing filters."
                                                            : "Complete an exit interview session from the landing page to save entries into PostgreSQL."}
                                                    </p>
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredTranscripts.map((session) => (
                                                <tr key={session.id} className="hover:bg-orange-50/50 transition-colors">
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-900">
                                                            {session.name}
                                                        </div>
                                                        <div className="text-[11px] text-orange-700 font-mono font-medium">
                                                            {session.studentId}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-slate-700 font-mono text-[11px]">
                                                        {session.program} ({session.graduationYear})
                                                    </td>
                                                    <td className="p-4 text-slate-700 font-medium">{session.capstoneRole}</td>
                                                    <td className="p-4 font-mono font-bold text-amber-700">
                                                        {session.ratings?.overallAvg || '0.0'} / 5.0
                                                    </td>
                                                    <td className="p-4 text-slate-700 text-[11px] max-w-xs truncate">
                                                        {session.employmentStatus || 'N/A'}
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${session.sentiment?.label === 'Positive'
                                                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                                                : session.sentiment?.label === 'Negative'
                                                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                                            }`}>
                                                            {session.sentiment?.label || 'Neutral'}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center justify-center space-x-1.5">
                                                            <button
                                                                onClick={() => setSelectedSession(session)}
                                                                className="p-2 rounded-xl bg-orange-100 hover:bg-orange-500 text-orange-800 hover:text-white transition-all cursor-pointer"
                                                                title="Inspect Individual Session & Sentiment"
                                                            >
                                                                <Eye className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleDeleteClick(session, e)}
                                                                className="p-2 rounded-xl bg-slate-100 hover:bg-rose-600 text-slate-500 hover:text-white transition-all cursor-pointer"
                                                                title="Delete Session From Database"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: SUMMARY & SENTIMENT ANALYTICS */}
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Charts Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            {/* Academic Satisfaction Ratings */}
                            <div className="lg:col-span-7 sunset-card rounded-2xl p-6 space-y-4">
                                <div className="flex items-center justify-between border-b border-orange-100 pb-3">
                                    <h3 className="font-serif font-bold text-base text-slate-900 flex items-center space-x-2">
                                        <BookOpen className="w-5 h-5 text-orange-600" />
                                        <span>CCS Academic & Resource Satisfaction (1-5 Scale)</span>
                                    </h3>
                                </div>
                                <div className="h-72 w-full pt-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={avgCategories} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#fed7aa" opacity={0.6} />
                                            <XAxis dataKey="category" stroke="#475569" tick={{ fontSize: 11 }} />
                                            <YAxis domain={[0, 5]} stroke="#475569" tick={{ fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#fdba74', borderRadius: '12px', color: '#1e293b' }}
                                            />
                                            <Bar dataKey="rating" fill="#f97316" radius={[6, 6, 0, 0]}>
                                                {avgCategories.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.rating >= 4.2 ? '#10B981' : entry.rating < 3.6 ? '#F43F5E' : '#F97316'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Overall Sentiment Distribution */}
                            <div className="lg:col-span-5 sunset-card rounded-2xl p-6 space-y-4">
                                <div className="flex items-center justify-between border-b border-orange-100 pb-3">
                                    <h3 className="font-serif font-bold text-base text-slate-900 flex items-center space-x-2">
                                        <Smile className="w-5 h-5 text-amber-600" />
                                        <span>Overall Alumni Sentiment Ratio</span>
                                    </h3>
                                </div>
                                <div className="h-72 w-full flex items-center justify-center">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={sentimentChartData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={90}
                                                paddingAngle={4}
                                                dataKey="value"
                                            >
                                                {sentimentChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#fdba74', borderRadius: '12px' }} />
                                            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '11px', color: '#475569' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* AI Synthesized Thematic Curriculum Recommendations */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-serif font-bold text-slate-900 flex items-center space-x-2">
                                    <Sparkles className="w-5 h-5 text-orange-600" />
                                    <span>AI Synthesized Thematic Curriculum Insights</span>
                                </h3>
                                <span className="text-xs font-mono px-3 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                                    Auto-Synthesized from Session Logs
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {Object.entries(thematic).map(([key, theme]) => (
                                    <div key={key} className="sunset-card rounded-2xl p-6 space-y-3">
                                        <h4 className="text-sm font-bold font-serif text-orange-900">{theme.title}</h4>
                                        <p className="text-xs text-slate-700 bg-orange-50/70 p-3 rounded-xl border border-orange-100 italic leading-relaxed">
                                            "{theme.keyInsight}"
                                        </p>
                                        <ul className="space-y-1.5 text-xs text-slate-600 font-sans">
                                            {theme.bullets.map((bullet, idx) => (
                                                <li key={idx} className="flex items-start space-x-2">
                                                    <span className="text-orange-500 font-bold">•</span>
                                                    <span>{bullet}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                 ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: AUDIO INPUT DEVICE SETTINGS & MICROPHONE TESTING */}
                {activeTab === 'audio' && (
                    <div className="space-y-6 animate-in fade-in duration-150">
                        {/* Audio Settings Header Card */}
                        <div className="sunset-card rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="space-y-1">
                                <h3 className="font-serif font-bold text-lg text-slate-900 flex items-center space-x-2">
                                    <Sliders className="w-5 h-5 text-orange-600" />
                                    <span>Audio Input Device Configuration & Hardware Diagnostics</span>
                                </h3>
                                <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                                    Select which physical microphone or headset interface VAlumni uses for hands-free conversational exit interviews. Test input signals in real time to diagnose and eliminate audio pickup errors.
                                </p>
                            </div>
                            <button
                                onClick={refreshAudioDevices}
                                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-md shadow-orange-500/20 transition-all cursor-pointer shrink-0"
                            >
                                <RefreshCw className="w-4 h-4" />
                                <span>Scan Microphones</span>
                            </button>
                        </div>

                        {/* Two Column Layout: Devices List & Live VU Meter */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            {/* Left: Device Selection List */}
                            <div className="lg:col-span-7 sunset-card rounded-2xl p-6 space-y-4">
                                <div className="flex items-center justify-between border-b border-orange-100 pb-3">
                                    <h4 className="font-serif font-bold text-sm text-slate-900 flex items-center space-x-2">
                                        <Mic className="w-4 h-4 text-orange-600" />
                                        <span>Detected Audio Input Microphones ({audioDevices.length})</span>
                                    </h4>
                                    <span className="text-[11px] font-mono text-slate-500">
                                        Saved locally for exit interviews
                                    </span>
                                </div>

                                {audioDevices.length === 0 ? (
                                    <div className="p-8 text-center rounded-2xl bg-orange-50/50 border border-orange-200/60 space-y-3">
                                        <MicOff className="w-8 h-8 text-slate-400 mx-auto" />
                                        <p className="text-xs text-slate-600">
                                            No audio input devices detected yet or browser permission is pending.
                                        </p>
                                        <button
                                            onClick={refreshAudioDevices}
                                            className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold transition-all cursor-pointer"
                                        >
                                            Grant Permission &amp; Scan Microphones
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {audioDevices.map((device, idx) => {
                                            const isSelected = selectedAudioDeviceId === device.deviceId || (!selectedAudioDeviceId && (device.deviceId === 'default' || idx === 0));
                                            return (
                                                <div
                                                    key={device.deviceId || idx}
                                                    onClick={() => handleSelectAudioDevice(device.deviceId)}
                                                    className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                                        isSelected
                                                            ? 'bg-orange-50/90 border-orange-400 shadow-xs ring-1 ring-orange-400'
                                                            : 'bg-white/80 hover:bg-white border-slate-200 text-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center space-x-3 min-w-0">
                                                        <div className={`p-2 rounded-lg shrink-0 ${
                                                            isSelected ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'
                                                        }`}>
                                                            <Mic className="w-4 h-4" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className={`text-xs font-bold truncate ${
                                                                isSelected ? 'text-orange-950 font-serif' : 'text-slate-800'
                                                            }`}>
                                                                {device.label || `Audio Input Device #${idx + 1}`}
                                                            </p>
                                                            <p className="text-[10px] font-mono text-slate-400 truncate">
                                                                ID: {device.deviceId ? device.deviceId.slice(0, 24) + '...' : 'System Default'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="shrink-0 flex items-center space-x-2">
                                                        {isSelected ? (
                                                            <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-mono font-bold border border-emerald-200">
                                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                                                <span>Active Device</span>
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-orange-100 text-slate-600 hover:text-orange-800 text-[11px] font-medium transition-colors cursor-pointer"
                                                            >
                                                                Select Device
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Right: Live VU Meter & Diagnostics */}
                            <div className="lg:col-span-5 sunset-card rounded-2xl p-6 space-y-5">
                                <div className="flex items-center justify-between border-b border-orange-100 pb-3">
                                    <h4 className="font-serif font-bold text-sm text-slate-900 flex items-center space-x-2">
                                        <Volume2 className="w-4 h-4 text-orange-600" />
                                        <span>Real-time Audio Signal Meter</span>
                                    </h4>
                                    <span className="text-[11px] font-mono text-slate-500">
                                        DSP Hardware Test
                                    </span>
                                </div>

                                {/* Meter Display */}
                                <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-4">
                                    <div className="flex items-center justify-between text-xs font-mono">
                                        <span className="text-slate-400">Input Volume Level:</span>
                                        <span className={`font-bold ${
                                            testVolume > 50 ? 'text-amber-400' : testVolume > 5 ? 'text-emerald-400' : 'text-slate-500'
                                        }`}>
                                            {testVolume}% {testVolume > 5 ? '(Audio Signal Detected)' : '(Silent)'}
                                        </span>
                                    </div>

                                    {/* Visual VU Meter Bar */}
                                    <div className="h-6 w-full bg-slate-800 rounded-full overflow-hidden p-1 flex items-center">
                                        <div
                                            className={`h-full rounded-full transition-all duration-75 ${
                                                testVolume > 65
                                                    ? 'bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500'
                                                    : testVolume > 15
                                                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                                                        : 'bg-emerald-600'
                                            }`}
                                            style={{ width: `${Math.max(2, testVolume)}%` }}
                                        />
                                    </div>

                                    {/* Decibel tick markers */}
                                    <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1">
                                        <span>0% (Quiet)</span>
                                        <span>25%</span>
                                        <span>50%</span>
                                        <span>75%</span>
                                        <span>100% (Peak)</span>
                                    </div>

                                    <div className="pt-2 space-y-3">
                                        {isTestingMic ? (
                                            <button
                                                onClick={() => stopMicTest(true)}
                                                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
                                            >
                                                <MicOff className="w-4 h-4" />
                                                <span>Stop &amp; Transcribe with Voice Cleaner</span>
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => startMicTest()}
                                                disabled={isTestingWhisper}
                                                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
                                            >
                                                <Mic className="w-4 h-4" />
                                                <span>{isTestingWhisper ? 'Cleaning Audio & Transcribing...' : 'Start Live Mic & Voice Cleaner Test'}</span>
                                            </button>
                                        )}

                                        {testTranscriptResult && (
                                            <div className={`p-3 rounded-xl border text-xs font-mono space-y-1.5 ${
                                                testTranscriptResult.error
                                                    ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                                                    : 'bg-slate-800/90 border-emerald-500/40 text-emerald-100'
                                            }`}>
                                                <div className="flex items-center justify-between text-[10px] text-slate-400">
                                                    <span>VoiceCleaner + Whisper ({testTranscriptResult.model || 'large-v3-turbo'})</span>
                                                    {testTranscriptResult.cleaner && !testTranscriptResult.cleaner.is_silent && (
                                                        <span className="text-emerald-400">
                                                            SNR: {testTranscriptResult.cleaner.raw_snr_db}dB → {testTranscriptResult.cleaner.cleaned_snr_db}dB
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-white font-sans text-xs leading-relaxed">
                                                    "{testTranscriptResult.transcript}"
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Audio Troubleshooting Checklist */}
                                <div className="space-y-2.5 pt-1">
                                    <h5 className="text-xs font-serif font-bold text-slate-800 flex items-center space-x-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                        <span>Troubleshooting Audio Input Pickup:</span>
                                    </h5>
                                    <ul className="text-xs text-slate-600 space-y-1.5 font-sans leading-relaxed pl-1">
                                        <li className="flex items-start space-x-1.5">
                                            <span className="text-orange-500 font-bold">•</span>
                                            <span><strong>If no sound is picked up:</strong> Click "Start Live Microphone Test" and check if the meter moves when you speak.</span>
                                        </li>
                                        <li className="flex items-start space-x-1.5">
                                            <span className="text-orange-500 font-bold">•</span>
                                            <span><strong>Multiple microphones:</strong> If you use a USB headset or external mic, click its card to select it directly.</span>
                                        </li>
                                        <li className="flex items-start space-x-1.5">
                                            <span className="text-orange-500 font-bold">•</span>
                                            <span><strong>Hardware Mute:</strong> Verify any physical mute switch / button on your headset cable or keyboard (F4/Fn mute).</span>
                                        </li>
                                        <li className="flex items-start space-x-1.5">
                                            <span className="text-orange-500 font-bold">•</span>
                                            <span><strong>Windows Privacy:</strong> Verify Windows Settings &gt; Privacy &amp; Security &gt; Microphone is enabled for browsers.</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* INDIVIDUAL SESSION INSPECTOR MODAL */}
                {selectedSession && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div
                            className="relative w-full max-w-3xl h-[88vh] max-h-[750px] rounded-3xl bg-white/95 backdrop-blur-xl p-6 md:p-8 border border-orange-200 shadow-2xl shadow-orange-950/20 text-slate-800 flex flex-col space-y-5 overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-start justify-between border-b border-orange-100 pb-4 shrink-0">
                                <div>
                                    <h3 className="text-2xl font-serif font-bold text-slate-900">{selectedSession.name}</h3>
                                    <p className="text-xs text-orange-700 font-mono mt-1">
                                        Student ID: {selectedSession.studentId} • Program: {selectedSession.program} ({selectedSession.graduationYear})
                                    </p>
                                    {selectedSession.timestamp && (
                                        <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-1">
                                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                            Recorded on: {new Date(selectedSession.timestamp).toLocaleString()}
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center space-x-2">
                                    <button
                                        type="button"
                                        onClick={() => handleCopyTranscript(selectedSession)}
                                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-900 text-xs font-mono font-semibold transition-all cursor-pointer"
                                        title="Copy sequential Q&A transcript (Q1, A1, Q2, A2...) to clipboard"
                                    >
                                        {copiedSessionId === selectedSession.id ? (
                                            <>
                                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                                <span>Copied!</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="w-3.5 h-3.5 text-orange-700" />
                                                <span>Copy Q&amp;A</span>
                                            </>
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleDownloadTranscriptTxt(selectedSession)}
                                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-mono font-semibold transition-all cursor-pointer shadow-xs"
                                        title="Download full verbatim transcript as .txt file"
                                    >
                                        <Download className="w-3.5 h-3.5 text-amber-300" />
                                        <span>Download .txt</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setSelectedSession(null)}
                                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-orange-50 cursor-pointer"
                                        title="Close Preview"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Session Quick Metrics */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs shrink-0">
                                <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-100">
                                    <div className="text-slate-500 text-[10px] uppercase">Overall Score:</div>
                                    <div className="text-amber-700 font-bold text-base flex items-center gap-1">
                                        <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                                        {selectedSession.ratings?.overallAvg || '0.0'} / 5.0
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-100">
                                    <div className="text-slate-500 text-[10px] uppercase">Capstone Role:</div>
                                    <div className="text-slate-900 font-bold text-sm truncate">{selectedSession.capstoneRole}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-100">
                                    <div className="text-slate-500 text-[10px] uppercase">Employment:</div>
                                    <div className={`font-bold text-sm truncate ${isEmployed(selectedSession.employmentStatus) ? 'text-emerald-700' : 'text-slate-700'
                                        }`}>
                                        {selectedSession.employmentStatus}
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-100">
                                    <div className="text-slate-500 text-[10px] uppercase">Sentiment Analysis:</div>
                                    <div className={`font-bold text-sm ${selectedSession.sentiment?.label === 'Positive'
                                            ? 'text-emerald-700'
                                            : selectedSession.sentiment?.label === 'Negative'
                                                ? 'text-rose-700'
                                                : 'text-amber-700'
                                        }`}>
                                        {selectedSession.sentiment?.label || 'Neutral'} ({Math.round((selectedSession.sentiment?.score || 0.5) * 100)}%)
                                    </div>
                                </div>
                            </div>

                            {/* Sentiment Gauge Card */}
                            <div className="p-4 rounded-2xl bg-orange-50/40 border border-orange-200/60 space-y-2 shrink-0">
                                <div className="flex items-center justify-between text-xs font-mono">
                                    <span className="font-bold text-slate-700">Sentiment Polarity Gauge:</span>
                                    <span className="font-bold text-orange-700">
                                        {selectedSession.sentiment?.label || 'Neutral'} ({selectedSession.sentiment?.score ? (selectedSession.sentiment.score * 100).toFixed(0) : 50}% Positivity)
                                    </span>
                                </div>
                                <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden flex">
                                    <div
                                        className="h-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all duration-300"
                                        style={{ width: `${Math.max(8, Math.min(100, (selectedSession.sentiment?.score || 0.5) * 100))}%` }}
                                    />
                                </div>
                            </div>

                            {/* Complete Question-by-Question Transcribed Q&A Log */}
                            <div className="flex-1 min-h-0 flex flex-col space-y-3 pt-1">
                                <div className="flex items-center justify-between border-b border-orange-100 pb-2 shrink-0">
                                    <div className="flex items-center space-x-2 text-xs font-mono text-orange-800">
                                        <FileText className="w-4 h-4 text-orange-600" />
                                        <span className="font-bold uppercase tracking-wider">Verbatim Transcribed Interview Log</span>
                                    </div>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                                        Sequential Q&amp;A Data Collection
                                    </span>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto pr-1.5 space-y-3">
                                    {(() => {
                                        const qaList = getSessionQAPairs(selectedSession);
                                        if (qaList.length > 0) {
                                            return qaList.map((turn, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`p-3.5 rounded-xl border space-y-1.5 transition-all ${
                                                        turn.type === 'question'
                                                            ? 'bg-amber-50/70 border-amber-200/80 text-slate-800'
                                                            : 'bg-white border-orange-200 text-slate-900 shadow-xs'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span
                                                            className={`font-mono font-bold text-[11px] px-2.5 py-0.5 rounded-md ${
                                                                turn.type === 'question'
                                                                    ? 'bg-amber-200 text-amber-900'
                                                                    : 'bg-orange-500 text-white'
                                                            }`}
                                                        >
                                                            {turn.label} • {turn.speaker}
                                                        </span>
                                                        {turn.timestamp && (
                                                            <span className="text-[10px] font-mono text-slate-400">
                                                                {turn.timestamp}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className={`text-xs leading-relaxed pt-1 ${
                                                        turn.type === 'answer' ? 'font-medium text-slate-900' : 'text-slate-700'
                                                    }`}>
                                                        {turn.text}
                                                    </p>
                                                </div>
                                            ));
                                        }

                                        return (
                                            <div className="space-y-2 text-xs">
                                                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                                    <span className="font-semibold text-orange-800">Useful Tech Taught: </span>
                                                    <span className="text-slate-700 font-mono">{selectedSession.usefulTech}</span>
                                                </div>
                                                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                                    <span className="font-semibold text-orange-800">Missing Tech Desired: </span>
                                                    <span className="text-slate-700 font-mono">{selectedSession.desiredTech}</span>
                                                </div>
                                                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                                    <span className="font-semibold text-rose-800">Laboratory Grievance: </span>
                                                    <span className="text-slate-700 italic">"{selectedSession.grievance}"</span>
                                                </div>
                                                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                                    <span className="font-semibold text-amber-800">Legacy Tip For Freshmen: </span>
                                                    <span className="text-slate-700 italic">"{selectedSession.legacyTip}"</span>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* CUSTOM DELETE CONFIRMATION MODAL */}
                {sessionToDelete && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn">
                        <div
                            className="w-full max-w-md rounded-3xl p-6 sm:p-8 border border-orange-200 shadow-2xl bg-white space-y-5 text-center text-slate-800"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="w-14 h-14 rounded-2xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-xs">
                                <Trash2 className="w-7 h-7" />
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-lg font-serif font-bold text-slate-900">Delete Interview Session?</h3>
                                <p className="text-xs text-slate-600 leading-relaxed">
                                    Are you sure you want to delete the interview session for <strong className="text-slate-900">{sessionToDelete.name}</strong> ({sessionToDelete.studentId})? This will permanently remove the record from PostgreSQL.
                                </p>
                            </div>

                            <div className="flex items-center justify-center gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setSessionToDelete(null)}
                                    disabled={isDeleting}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all border border-slate-200 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmDeleteSession}
                                    disabled={isDeleting}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                                >
                                    {isDeleting ? (
                                        <span>Deleting...</span>
                                    ) : (
                                        <>
                                            <Trash2 className="w-3.5 h-3.5" />
                                            <span>Confirm Delete</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
