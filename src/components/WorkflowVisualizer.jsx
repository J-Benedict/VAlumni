import React, { useState } from 'react';
import { Mic, Radio, Cpu, Database, Volume2, ArrowRight, Play, CheckCircle2, Zap, Layers, Activity, FileText, Info } from 'lucide-react';

export default function WorkflowVisualizer() {
    const [activeStep, setActiveStep] = useState(2); // Default to NLP step
    const [isSimulating, setIsSimulating] = useState(false);

    const steps = [
        {
            id: 1,
            name: "Audio Input Stream",
            shortLabel: "Web Audio Input",
            icon: Mic,
            color: "text-amber-400",
            bgColor: "bg-amber-500/10",
            borderColor: "border-amber-500/30",
            techSpecs: {
                samplingRate: "16,000 Hz (Mono)",
                encoding: "PCM / WebAudio MediaRecorder",
                bufferSize: "2048 samples / frame",
                latency: "15 ms"
            },
            description: "Captures spoken voice input from alumni microphone using browser MediaStream API or HTML5 audio input buffer.",
            sampleData: `{
  "stream": "MediaStreamTrack (Audio)",
  "bitrate": "128 kbps",
  "noiseSuppression": true,
  "echoCancellation": true
}`
        },
        {
            id: 2,
            name: "Speech-to-Text (STT)",
            shortLabel: "ASR Transcriber",
            icon: Radio,
            color: "text-indigo-400",
            bgColor: "bg-indigo-500/10",
            borderColor: "border-indigo-500/30",
            techSpecs: {
                engine: "Web Speech ASR / Whisper Local",
                acousticModel: "Deep Neural Network (DNN)",
                language: "en-US / Taglish",
                latency: "140 ms"
            },
            description: "Converts raw acoustic speech waveforms into structured text transcripts in real-time with word-level confidence metrics.",
            sampleData: `{
  "rawTranscript": "I felt the core programming theories in Python were solid.",
  "confidence": 0.94,
  "isFinal": true,
  "words": ["I", "felt", "the", "core", "programming", "theories"]
}`
        },
        {
            id: 3,
            name: "NLP & Sentiment Engine",
            shortLabel: "AI Polarity Analyzer",
            icon: Cpu,
            color: "text-emerald-400",
            bgColor: "bg-emerald-500/10",
            borderColor: "border-emerald-500/30",
            techSpecs: {
                model: "Rule-assisted Lexicon + Transformer",
                features: "Keyword Extraction & Polarity Scoring",
                outputClasses: "Positive, Neutral, Negative",
                latency: "85 ms"
            },
            description: "Evaluates sentiment polarity, computes compound sentiment score (0.0 to 1.0), and tags domain keywords (e.g. Docker, Lab Aircon, Git).",
            sampleData: `{
  "sentiment": "Positive",
  "compoundScore": 0.88,
  "detectedTopics": ["Programming Theories", "Python", "Capstone Mentorship"],
  "keywordHits": { "positive": ["solid", "great"], "negative": [] }
}`
        },
        {
            id: 4,
            name: "Analytics DB & Summarizer",
            shortLabel: "LSPU Database",
            icon: Database,
            color: "text-purple-400",
            bgColor: "bg-purple-500/10",
            borderColor: "border-purple-500/30",
            techSpecs: {
                storage: "JSON / PostgreSQL Structured DB",
                aggregations: "Thematic Grievance & Curriculum Summaries",
                anonymization: "RA 10173 Data Privacy Compliant",
                latency: "40 ms"
            },
            description: "Stores anonymized alumni exit interview responses, computes college-wide satisfaction metrics, and compiles thematic recommendation summaries.",
            sampleData: `{
  "studentId": "0122-0941",
  "program": "BSIT",
  "interviewCompletedAt": "2026-08-10T17:28:00Z",
  "storedFields": 5,
  "privacyAnonymized": true
}`
        },
        {
            id: 5,
            name: "Text-to-Speech (TTS)",
            shortLabel: "Voice Synthesizer",
            icon: Volume2,
            color: "text-rose-400",
            bgColor: "bg-rose-500/10",
            borderColor: "border-rose-500/30",
            techSpecs: {
                synthesisEngine: "Web SpeechSynthesis API",
                voiceType: "Natural English Female/Male",
                pitchRate: "Pitch: 1.0, Speed: 1.05",
                latency: "60 ms"
            },
            description: "Synthesizes AI voice responses to ask follow-up questions and confirm receipt of alumni exit interview answers.",
            sampleData: `{
  "speechOutput": "Thank you! Your feedback on curriculum alignment has been saved.",
  "audioBufferReady": true,
  "playbackState": "Speaking"
}`
        }
    ];

    const handleSimulate = () => {
        setIsSimulating(true);
        let step = 1;
        setActiveStep(1);

        const interval = setInterval(() => {
            step++;
            if (step <= 5) {
                setActiveStep(step);
            } else {
                clearInterval(interval);
                setIsSimulating(false);
            }
        }, 1200);
    };

    const selected = steps.find(s => s.id === activeStep) || steps[0];

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
            {/* Title & Banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 glass-panel rounded-3xl border border-indigo-500/20">
                <div>
                    <div className="flex items-center space-x-2 text-xs font-mono text-indigo-400 mb-1">
                        <Layers className="w-4 h-4 text-amber-400" />
                        <span>Panel Directive Requirement #2</span>
                    </div>
                    <h2 className="text-2xl font-bold text-white">Complete Voice Processing Workflow</h2>
                    <p className="text-slate-400 text-sm mt-1 max-w-2xl">
                        End-to-end architecture illustrating audio signal capture, speech recognition (STT), NLP sentiment classification, database persistence, and text-to-speech (TTS) synthesis.
                    </p>
                </div>

                <button
                    onClick={handleSimulate}
                    disabled={isSimulating}
                    className={`flex items-center space-x-2 px-5 py-3 rounded-2xl font-semibold text-sm transition-all shadow-lg ${isSimulating
                            ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                            : 'bg-gradient-to-r from-indigo-600 to-amber-500 text-white shadow-indigo-600/30 hover:scale-105'
                        }`}
                >
                    <Play className={`w-4 h-4 ${isSimulating ? 'animate-spin' : ''}`} />
                    <span>{isSimulating ? 'Simulating Pipeline Data...' : 'Run Pipeline Simulation'}</span>
                </button>
            </div>

            {/* Interactive Workflow Node Pipeline */}
            <div className="glass-panel rounded-3xl p-8 border border-slate-800 space-y-8">
                <h3 className="text-sm font-semibold text-slate-300 font-mono flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span>Interactive Audio Processing Pipeline (Click any stage to inspect details)</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative">
                    {steps.map((step, idx) => {
                        const Icon = step.icon;
                        const isSelected = activeStep === step.id;

                        return (
                            <div key={step.id} className="relative flex flex-col items-center">
                                {/* Node Box */}
                                <div
                                    onClick={() => setActiveStep(step.id)}
                                    className={`w-full p-5 rounded-2xl border cursor-pointer transition-all duration-300 ${step.bgColor} ${step.borderColor} ${isSelected
                                            ? 'ring-2 ring-indigo-400 shadow-xl scale-105 bg-slate-900'
                                            : 'hover:scale-[1.02] opacity-80 hover:opacity-100 bg-slate-950/60'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                                            Stage 0{step.id}
                                        </span>
                                        <Icon className={`w-5 h-5 ${step.color}`} />
                                    </div>

                                    <h4 className="font-bold text-white text-sm leading-tight">{step.shortLabel}</h4>
                                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{step.name}</p>

                                    {/* Active Data Pulse Indicator */}
                                    {isSimulating && activeStep === step.id && (
                                        <div className="mt-3 flex items-center space-x-1 text-[10px] font-mono text-emerald-400">
                                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                                            <span>Processing...</span>
                                        </div>
                                    )}
                                </div>

                                {/* Arrow Connector for Desktop */}
                                {idx < steps.length - 1 && (
                                    <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                                        <ArrowRight className="w-5 h-5 text-slate-600" />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Selected Stage Detail Inspector */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Specifications & Description */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="glass-panel rounded-3xl p-8 border border-slate-800 space-y-6">
                        <div className="flex items-center space-x-3">
                            <div className={`p-3 rounded-2xl ${selected.bgColor} border ${selected.borderColor}`}>
                                <selected.icon className={`w-6 h-6 ${selected.color}`} />
                            </div>
                            <div>
                                <span className="text-xs font-mono text-indigo-400">Stage 0{selected.id} Specifications</span>
                                <h3 className="text-xl font-bold text-white">{selected.name}</h3>
                            </div>
                        </div>

                        <p className="text-slate-300 text-sm leading-relaxed">
                            {selected.description}
                        </p>

                        {/* Technical Specification Grid */}
                        <div className="grid grid-cols-2 gap-4 text-xs font-mono pt-4 border-t border-slate-800">
                            {Object.entries(selected.techSpecs).map(([key, val]) => (
                                <div key={key} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                                    <div className="text-slate-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
                                    <div className="text-amber-300 font-semibold">{val}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Live Data Payload Viewer */}
                <div className="lg:col-span-5">
                    <div className="glass-panel rounded-3xl p-6 border border-slate-800 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <h4 className="font-semibold text-white text-sm flex items-center space-x-2">
                                <FileText className="w-4 h-4 text-indigo-400" />
                                <span>Payload Data Schema</span>
                            </h4>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                JSON Output
                            </span>
                        </div>

                        <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs text-indigo-300 overflow-x-auto leading-relaxed">
                            {selected.sampleData}
                        </pre>

                        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 font-mono flex items-center space-x-2">
                            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                            <span>Data schema conforms to LSPU AI Exit Interview Research Protocols.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
