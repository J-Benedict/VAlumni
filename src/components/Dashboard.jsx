import React, { useMemo } from 'react';
import { parseLSPUDataset, computeDatasetSummary } from '../utils/datasetLoader';
import { generateThematicSummaries } from '../services/aiService';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { Users, Smile, Award, Briefcase, Server, BookOpen, MessageSquareQuote, TrendingUp, Sparkles, AlertTriangle, ArrowUpRight } from 'lucide-react';

export default function Dashboard({ setActiveTab }) {
    const records = useMemo(() => parseLSPUDataset(), []);
    const summary = useMemo(() => computeDatasetSummary(records), [records]);
    const thematic = useMemo(() => generateThematicSummaries(records), [records]);

    // Chart Color Schemes
    const SENTIMENT_COLORS = ['#10B981', '#F59E0B', '#EF4444']; // Green, Yellow, Red
    const PROGRAM_COLORS = ['#6366F1', '#3B82F6', '#8B5CF6', '#EC4899'];

    const sentimentData = [
        { name: 'Positive Sentiment', value: summary.sentimentCounts.positive },
        { name: 'Neutral Sentiment', value: summary.sentimentCounts.neutral },
        { name: 'Negative / Grievances', value: summary.sentimentCounts.negative }
    ];

    const ratingData = [
        { category: 'Core Prog.', rating: summary.averageRatings.coreProgramming },
        { category: 'Electives', rating: summary.averageRatings.electives },
        { category: 'Mentorship', rating: summary.averageRatings.mentorship },
        { category: 'Internship', rating: summary.averageRatings.internship },
        { category: 'Lab Hardware', rating: summary.averageRatings.hardware },
        { category: 'Campus Wi-Fi', rating: summary.averageRatings.internet }
    ];

    const employmentData = [
        { name: 'Employed Full-time', value: summary.employmentCounts.fullTime },
        { name: 'Actively Upskilling', value: summary.employmentCounts.upskilling },
        { name: 'Part-time / Freelance', value: summary.employmentCounts.freelance }
    ];

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
            {/* Executive Welcome & Title */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 glass-panel rounded-3xl border border-indigo-500/20">
                <div>
                    <div className="flex items-center space-x-2 text-xs font-mono text-indigo-400 mb-1">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>Alumni Office System Analytics</span>
                    </div>
                    <h2 className="text-2xl font-extrabold text-white">LSPU CCS Alumni Exit Interview Dashboard</h2>
                    <p className="text-slate-400 text-sm mt-1">
                        Real-time analytics synthesized from {summary.totalRecords} exit interview records (Class of 2026).
                    </p>
                </div>

                <button
                    onClick={() => setActiveTab('interview')}
                    className="flex items-center space-x-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all transform hover:scale-105"
                >
                    <span>Launch AI Voice Interview</span>
                    <ArrowUpRight className="w-4 h-4" />
                </button>
            </div>

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="glass-card glass-card-hover rounded-2xl p-5 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-400">Total Interviews</span>
                        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            <Users className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="text-3xl font-extrabold text-white">{summary.totalRecords}</div>
                    <div className="text-xs text-slate-400 flex items-center justify-between">
                        <span>BSIT: <strong className="text-indigo-300">{summary.bsitCount}</strong></span>
                        <span>•</span>
                        <span>BSCS: <strong className="text-purple-300">{summary.bscsCount}</strong></span>
                    </div>
                </div>

                <div className="glass-card glass-card-hover rounded-2xl p-5 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-400">Positive Sentiment</span>
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Smile className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="text-3xl font-extrabold text-emerald-400">{summary.sentimentCounts.positivePct}%</div>
                    <div className="text-xs text-slate-400">
                        <strong className="text-emerald-400">{summary.sentimentCounts.positive}</strong> positive alumni evaluations
                    </div>
                </div>

                <div className="glass-card glass-card-hover rounded-2xl p-5 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-400">Mentorship Score</span>
                        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Award className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="text-3xl font-extrabold text-amber-300">{summary.averageRatings.mentorship} / 5.0</div>
                    <div className="text-xs text-slate-400">
                        Capstone mentorship approval rating
                    </div>
                </div>

                <div className="glass-card glass-card-hover rounded-2xl p-5 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-400">Full-time Tech Employed</span>
                        <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Briefcase className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="text-3xl font-extrabold text-white">
                        {Math.round((summary.employmentCounts.fullTime / summary.totalRecords) * 100)}%
                    </div>
                    <div className="text-xs text-slate-400">
                        <strong className="text-indigo-300">{summary.employmentCounts.fullTime} graduates</strong> working in tech
                    </div>
                </div>
            </div>

            {/* Visual Analytics Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Academic Satisfaction Ratings Bar Chart */}
                <div className="lg:col-span-7 glass-panel rounded-3xl p-6 border border-slate-800 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <h3 className="font-bold text-white text-base flex items-center space-x-2">
                            <BookOpen className="w-5 h-5 text-indigo-400" />
                            <span>CCS Academic & Resource Satisfaction (1-5 Scale)</span>
                        </h3>
                    </div>

                    <div className="h-72 w-full pt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={ratingData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                                <XAxis dataKey="category" stroke="#94A3B8" tick={{ fontSize: 11 }} />
                                <YAxis domain={[0, 5]} stroke="#94A3B8" tick={{ fontSize: 11 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF' }}
                                />
                                <Bar dataKey="rating" fill="#6366F1" radius={[6, 6, 0, 0]}>
                                    {ratingData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.rating >= 4.2 ? '#10B981' : entry.rating < 3.5 ? '#F43F5E' : '#6366F1'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Sentiment Distribution Donut Chart */}
                <div className="lg:col-span-5 glass-panel rounded-3xl p-6 border border-slate-800 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <h3 className="font-bold text-white text-base flex items-center space-x-2">
                            <Smile className="w-5 h-5 text-amber-400" />
                            <span>Overall Alumni Sentiment</span>
                        </h3>
                    </div>

                    <div className="h-72 w-full flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={sentimentData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={90}
                                    paddingAngle={4}
                                    dataKey="value"
                                >
                                    {sentimentData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={SENTIMENT_COLORS[index % SENTIMENT_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px' }} />
                                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '11px', color: '#94A3B8' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Desired Tech Stack Demand */}
            <div className="glass-panel rounded-3xl p-6 border border-slate-800 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="font-bold text-white text-lg flex items-center space-x-2">
                        <TrendingUp className="w-5 h-5 text-emerald-400" />
                        <span>High-Demand Missing Technologies in CCS Curriculum</span>
                    </h3>
                    <span className="text-xs font-mono text-slate-400">Based on Alumni Feedback</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {summary.desiredTech.map((tech) => (
                        <div key={tech.name} className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                            <div>
                                <h4 className="font-semibold text-white text-sm">{tech.name}</h4>
                                <p className="text-xs text-slate-400 mt-0.5">{tech.count} alumni recommendations</p>
                            </div>
                            <div className="text-lg font-extrabold text-amber-400 font-mono">
                                {Math.round((tech.count / summary.totalRecords) * 100)}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Panel Directive Requirement #1 & Summaries: AI Synthesized Thematic Recommendations */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-xl font-extrabold text-white flex items-center space-x-2">
                        <Sparkles className="w-5 h-5 text-amber-400" />
                        <span>AI Synthesized Thematic Recommendations</span>
                    </h3>
                    <span className="text-xs font-mono px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        Auto-Generated Summary
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {Object.entries(thematic).map(([key, theme]) => (
                        <div key={key} className="glass-panel rounded-3xl p-6 border border-slate-800 space-y-4 hover:border-indigo-500/40 transition-all">
                            <h4 className="text-base font-bold text-indigo-300">{theme.title}</h4>
                            <p className="text-xs text-slate-300 bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 italic leading-relaxed">
                                "{theme.keyInsight}"
                            </p>
                            <ul className="space-y-2 text-xs text-slate-400">
                                {theme.bullets.map((b, idx) => (
                                    <li key={idx} className="flex items-start space-x-2">
                                        <span className="text-amber-400 font-bold">•</span>
                                        <span>{b}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
