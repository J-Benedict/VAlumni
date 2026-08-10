import React, { useState, useMemo, useEffect } from 'react';
import { parseLSPUDataset } from '../utils/datasetLoader';
import { getInterviewTranscripts, deleteInterviewTranscript } from '../utils/transcriptStorage';
import { LSPU_SURVEY_STRUCTURE } from '../services/aiService';
import { Search, Download, Filter, User, Eye, X, CheckCircle2, AlertTriangle, FileSpreadsheet, Mic, Trash2, FileText, Calendar, Award, Star } from 'lucide-react';
import Papa from 'papaparse';

// Flatten survey structure into question lookup map
const QUESTION_MAP = {};
LSPU_SURVEY_STRUCTURE.forEach(section => {
    section.questions.forEach(q => {
        QUESTION_MAP[q.id] = {
            question: q.question,
            sectionTitle: section.sectionTitle
        };
    });
});

export default function DatasetTable() {
    const csvRecords = useMemo(() => parseLSPUDataset(), []);
    const [voiceRecords, setVoiceRecords] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [programFilter, setProgramFilter] = useState('ALL');
    const [sentimentFilter, setSentimentFilter] = useState('ALL');
    const [selectedRecord, setSelectedRecord] = useState(null);

    // Load voice records on mount and refresh
    const refreshVoiceRecords = () => {
        setVoiceRecords(getInterviewTranscripts());
    };

    useEffect(() => {
        refreshVoiceRecords();
    }, []);

    // Merge CSV records + localStorage voice interviews
    const records = useMemo(() => {
        const voiceMapped = voiceRecords.map((v, i) => ({
            ...v,
            realId: v.id, // preserved localStorage ID
            id: v.id || `voice_${i + 1}`,
            email: v.email || 'voice-interview@lspu.edu.ph',
            source: 'voice_interview'
        }));
        return [...voiceMapped, ...csvRecords];
    }, [csvRecords, voiceRecords]);

    // Handle delete
    const handleDeleteRecord = (record, e) => {
        if (e) e.stopPropagation();
        if (!window.confirm(`Are you sure you want to delete the interview entry for "${record.name}"?`)) {
            return;
        }
        deleteInterviewTranscript(record.realId || record.id);
        refreshVoiceRecords();
        if (selectedRecord && (selectedRecord.id === record.id || selectedRecord.realId === record.realId)) {
            setSelectedRecord(null);
        }
    };

    // Filter logic
    const filteredRecords = useMemo(() => {
        return records.filter(r => {
            const matchesSearch =
                (r.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (r.studentId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (r.usefulTech || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (r.grievance || '').toLowerCase().includes(searchTerm.toLowerCase());

            const matchesProgram = programFilter === 'ALL' || (r.program || '').includes(programFilter);
            const matchesSentiment = sentimentFilter === 'ALL' || (r.sentiment?.label || '') === sentimentFilter;

            return matchesSearch && matchesProgram && matchesSentiment;
        });
    }, [records, searchTerm, programFilter, sentimentFilter]);

    // CSV Export
    const exportCSV = () => {
        const csvStr = Papa.unparse(records.map(r => ({
            'Student ID': r.studentId,
            'Full Name': r.name,
            'Degree Program': r.program,
            'Graduation Year': r.graduationYear,
            'Capstone Role': r.capstoneRole,
            'Overall Rating (1-5)': r.ratings.overallAvg,
            'Core Programming Rating': r.ratings.coreProgramming,
            'Mentorship Rating': r.ratings.mentorship,
            'Useful Tech Taught': r.usefulTech,
            'Missing Tech Desired': r.desiredTech,
            'Lab Grievance': r.grievance,
            'Employment Status': r.employmentStatus,
            'Sentiment Label': r.sentiment.label,
            'Legacy Tip For Freshmen': r.legacyTip
        })));

        const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `VAlumni_LSPU_Exit_Interviews_Dataset.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
            {/* Header Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 glass-panel rounded-3xl border border-indigo-500/20">
                <div>
                    <div className="flex items-center space-x-2 text-xs font-mono text-indigo-400 mb-1">
                        <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                        <span>LSPU Alumni Office Dataset</span>
                    </div>
                    <h2 className="text-2xl font-bold text-white">{records.length} Exit Interview Dataset Directory</h2>
                    <p className="text-slate-400 text-sm mt-1">
                        Search, filter, inspect, and manage exit interview transcripts from the College of Computer Studies.
                    </p>
                </div>

                <button
                    onClick={exportCSV}
                    className="flex items-center space-x-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm shadow-lg shadow-emerald-600/20 transition-all hover:scale-105"
                >
                    <Download className="w-4 h-4" />
                    <span>Export Dataset to CSV</span>
                </button>
            </div>

            {/* Search & Filter Controls */}
            <div className="glass-panel rounded-2xl p-4 border border-slate-800 flex flex-col md:flex-row gap-4 justify-between">
                <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search alumni name, student ID, tech skills, or grievances..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-sans focus:outline-none focus:border-indigo-500"
                    />
                </div>

                <div className="flex items-center space-x-3">
                    {/* Program Filter */}
                    <select
                        value={programFilter}
                        onChange={(e) => setProgramFilter(e.target.value)}
                        className="px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-mono focus:outline-none"
                    >
                        <option value="ALL">All Programs</option>
                        <option value="BSIT">BSIT Only</option>
                        <option value="BSCS">BSCS Only</option>
                    </select>

                    {/* Sentiment Filter */}
                    <select
                        value={sentimentFilter}
                        onChange={(e) => setSentimentFilter(e.target.value)}
                        className="px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-mono focus:outline-none"
                    >
                        <option value="ALL">All Sentiments</option>
                        <option value="Positive">Positive</option>
                        <option value="Neutral">Neutral</option>
                        <option value="Negative">Negative / Grievances</option>
                    </select>
                </div>
            </div>

            {/* Table of Records */}
            <div className="glass-panel rounded-3xl border border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-sans">
                        <thead className="bg-slate-900 text-slate-400 font-mono">
                            <tr>
                                <th className="p-4">Alumni</th>
                                <th className="p-4">Program</th>
                                <th className="p-4">Capstone Role</th>
                                <th className="p-4">Overall Score</th>
                                <th className="p-4">Employment</th>
                                <th className="p-4">Sentiment</th>
                                <th className="p-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                            {filteredRecords.map((r) => (
                                <tr key={r.id} className="hover:bg-slate-900/50 transition-colors">
                                    <td className="p-4">
                                        <div className="font-bold text-white flex items-center gap-1.5">
                                            {r.name}
                                            {r.source === 'voice_interview' && (
                                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-mono">🎙️ Voice</span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-indigo-400 font-mono">{r.studentId}</div>
                                    </td>
                                    <td className="p-4 text-slate-300 font-mono text-[11px]">
                                        {r.program.includes('BSIT') ? 'BSIT' : r.program.includes('BSCS') ? 'BSCS' : r.program} ({r.graduationYear})
                                    </td>
                                    <td className="p-4 text-slate-300">{r.capstoneRole}</td>
                                    <td className="p-4 font-mono font-bold text-amber-300">
                                        {r.ratings.overallAvg} / 5.0
                                    </td>
                                    <td className="p-4 text-slate-300 text-[11px]">
                                        <span className="line-clamp-1">{r.employmentStatus}</span>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${r.sentiment.label === 'Positive'
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                            : r.sentiment.label === 'Negative'
                                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                            }`}>
                                            {r.sentiment.label}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="flex items-center justify-center space-x-1.5">
                                            <button
                                                onClick={() => setSelectedRecord(r)}
                                                className="p-2 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition-all"
                                                title="Inspect Full Transcript"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            {r.source === 'voice_interview' && (
                                                <button
                                                    onClick={(e) => handleDeleteRecord(r, e)}
                                                    className="p-2 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white transition-all"
                                                    title="Delete Voice Transcript Entry"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Selected Record Modal / Full Transcript Viewer */}
            {selectedRecord && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
                    <div className="glass-panel w-full max-w-3xl rounded-3xl p-6 md:p-8 border border-slate-700 space-y-6 max-h-[90vh] overflow-y-auto">
                        {/* Modal Header */}
                        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                            <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                    <h3 className="text-xl font-bold text-white">{selectedRecord.name}</h3>
                                    {selectedRecord.source === 'voice_interview' && (
                                        <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-mono">
                                            🎙️ Live Voice Recording
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-indigo-400 font-mono">
                                    Student ID: {selectedRecord.studentId} • Program: {selectedRecord.program} ({selectedRecord.graduationYear})
                                </p>
                                {selectedRecord.timestamp && (
                                    <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 pt-1">
                                        <Calendar className="w-3 h-3 text-slate-500" />
                                        Recorded on: {new Date(selectedRecord.timestamp).toLocaleString()}
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center space-x-2">
                                {selectedRecord.source === 'voice_interview' && (
                                    <button
                                        onClick={(e) => handleDeleteRecord(selectedRecord, e)}
                                        className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold transition-all"
                                        title="Delete Entry"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Delete</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedRecord(null)}
                                    className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Quick Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <div className="text-slate-400 text-[10px]">Overall Rating:</div>
                                <div className="text-amber-300 font-bold text-sm flex items-center gap-1">
                                    <Star className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                                    {selectedRecord.ratings?.overallAvg || 'N/A'} / 5.0
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <div className="text-slate-400 text-[10px]">Capstone Role:</div>
                                <div className="text-white font-bold truncate">{selectedRecord.capstoneRole}</div>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <div className="text-slate-400 text-[10px]">Employment:</div>
                                <div className="text-emerald-400 font-bold truncate">{selectedRecord.employmentStatus}</div>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <div className="text-slate-400 text-[10px]">Sentiment Score:</div>
                                <div className={`font-bold ${selectedRecord.sentiment?.label === 'Positive' ? 'text-emerald-400' : selectedRecord.sentiment?.label === 'Negative' ? 'text-rose-400' : 'text-amber-400'}`}>
                                    {selectedRecord.sentiment?.label || 'Neutral'} ({Math.round((selectedRecord.sentiment?.score || 0.5) * 100)}%)
                                </div>
                            </div>
                        </div>

                        {/* Complete Transcribed Q&A Log */}
                        {selectedRecord.rawResponses ? (
                            <div className="space-y-4">
                                <div className="flex items-center space-x-2 text-xs font-mono text-indigo-400 border-b border-slate-800 pb-2">
                                    <FileText className="w-4 h-4 text-indigo-400" />
                                    <span className="font-bold uppercase">Complete Transcribed Interview Log</span>
                                </div>

                                <div className="space-y-3 bg-slate-950 p-4 md:p-6 rounded-2xl border border-slate-800 max-h-96 overflow-y-auto divide-y divide-slate-800/80">
                                    {LSPU_SURVEY_STRUCTURE.map((section) => {
                                        const sectionQuestions = section.questions.filter(q => selectedRecord.rawResponses[q.id] !== undefined);
                                        if (sectionQuestions.length === 0) return null;

                                        return (
                                            <div key={section.sectionId} className="pt-3 first:pt-0 space-y-3">
                                                <h4 className="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider">
                                                    {section.sectionTitle}
                                                </h4>
                                                <div className="space-y-3 pl-2">
                                                    {sectionQuestions.map((q) => (
                                                        <div key={q.id} className="space-y-1">
                                                            <p className="text-xs font-medium text-slate-300">
                                                                <span className="text-indigo-400 font-mono text-[10px] mr-1 font-bold">[{q.id}]</span>
                                                                {q.question}
                                                            </p>
                                                            <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-mono text-amber-200 italic">
                                                                "{selectedRecord.rawResponses[q.id] || 'No response recorded'}"
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            /* Fallback standard view for embedded dataset records */
                            <div className="space-y-4 text-xs">
                                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                                    <div className="font-semibold text-indigo-300">Useful Tech Taught in CCS:</div>
                                    <div className="text-slate-200 font-mono">{selectedRecord.usefulTech}</div>
                                </div>

                                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                                    <div className="font-semibold text-indigo-300">Desired Tech Not Taught:</div>
                                    <div className="text-slate-200 font-mono">{selectedRecord.desiredTech}</div>
                                </div>

                                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                                    <div className="font-semibold text-rose-300">Biggest Laboratory Grievance:</div>
                                    <div className="text-slate-200 italic">"{selectedRecord.grievance}"</div>
                                </div>

                                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                                    <div className="font-semibold text-indigo-300">Rewarding Capstone Breakthrough:</div>
                                    <div className="text-slate-200 italic">"{selectedRecord.breakthrough}"</div>
                                </div>

                                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                                    <div className="font-semibold text-amber-300">Legacy Advice for Freshmen:</div>
                                    <div className="text-slate-200 italic">"{selectedRecord.legacyTip}"</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

