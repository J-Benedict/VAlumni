import React, { useState, useEffect, useMemo } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import { getInterviewTranscriptsFromDB, deleteInterviewTranscriptFromDB, clearAllTranscriptsFromDB } from '../utils/transcriptStorage';
import { LSPU_SURVEY_STRUCTURE, generateThematicSummaries } from '../services/aiService';
import { 
    Search, Download, Trash2, Eye, X, ArrowUpDown, Filter, Star, 
    Calendar, Database, LogOut, BarChart3, ListFilter, Users, Smile, 
    Award, Briefcase, TrendingUp, Sparkles, BookOpen, AlertTriangle, 
    CheckCircle2, FileText, ChevronRight, ShieldCheck
} from 'lucide-react';
import Papa from 'papaparse';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, PieChart, Pie, Legend } from 'recharts';

export default function AdminPortal({ adminUser, onLogout }) {
    const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'analytics'
    const [transcripts, setTranscripts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [programFilter, setProgramFilter] = useState('ALL');
    const [sentimentFilter, setSentimentFilter] = useState('ALL');
    const [sortBy, setSortBy] = useState('NEWEST');
    const [selectedSession, setSelectedSession] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

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

    // Handle delete single transcript
    const handleDeleteSession = async (session, e) => {
        if (e) e.stopPropagation();
        if (!window.confirm(`Are you sure you want to delete the interview session for "${session.name}"?`)) {
            return;
        }

        await deleteInterviewTranscriptFromDB(session.id);
        await loadTranscripts();
        if (selectedSession && selectedSession.id === session.id) {
            setSelectedSession(null);
        }
    };

    // Handle delete all transcripts
    const handleClearAll = async () => {
        if (!window.confirm("WARNING: Are you sure you want to delete ALL saved interview sessions from the database? This cannot be undone.")) {
            return;
        }
        await clearAllTranscriptsFromDB();
        await loadTranscripts();
        setSelectedSession(null);
    };

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
            'Freshman Legacy Advice': t.legacyTip
        }));

        const csvString = Papa.unparse(csvData);
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `VAlumni_CCS_Exit_Interviews_${new Date().toISOString().slice(0,10)}.csv`);
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

    const employedCount = transcripts.filter(t => (t.employmentStatus || '').toLowerCase().includes('employed') || (t.employmentStatus || '').toLowerCase().includes('offer')).length;
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
                            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                                activeTab === 'sessions'
                                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                                    : 'bg-white/70 hover:bg-white text-slate-700 border border-slate-200'
                            }`}
                        >
                            <ListFilter className="w-4 h-4" />
                            <span>Saved Sessions & Transcripts ({transcripts.length})</span>
                        </button>

                        <button
                            onClick={() => setActiveTab('analytics')}
                            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                                activeTab === 'analytics'
                                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                                    : 'bg-white/70 hover:bg-white text-slate-700 border border-slate-200'
                            }`}
                        >
                            <BarChart3 className="w-4 h-4" />
                            <span>Summary & Sentiment Analytics</span>
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

                        {transcripts.length > 0 && (
                            <button
                                onClick={handleClearAll}
                                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition-all cursor-pointer"
                                title="Clear all saved transcripts"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Clear DB</span>
                            </button>
                        )}
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
                                            <th className="p-4">Degree & Year</th>
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
                                                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                                            {session.name}
                                                            {session.source === 'voice_interview' && (
                                                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-100 text-orange-800 font-mono">
                                                                    🎙️ Voice
                                                                </span>
                                                            )}
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
                                                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                                            session.sentiment?.label === 'Positive'
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
                                                                onClick={(e) => handleDeleteSession(session, e)}
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

                {/* INDIVIDUAL SESSION INSPECTOR MODAL */}
                {selectedSession && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div 
                            className="relative w-full max-w-3xl rounded-3xl bg-white/95 backdrop-blur-xl p-6 md:p-8 border border-orange-200 shadow-2xl shadow-orange-950/20 text-slate-800 space-y-6 max-h-[90vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-start justify-between border-b border-orange-100 pb-4">
                                <div>
                                    <div className="flex items-center space-x-2">
                                        <h3 className="text-2xl font-serif font-bold text-slate-900">{selectedSession.name}</h3>
                                        <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-800 border border-orange-200 font-mono">
                                            🎙️ Individual Session Log
                                        </span>
                                    </div>
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
                                        onClick={(e) => handleDeleteSession(selectedSession, e)}
                                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-600 hover:text-white text-rose-700 text-xs font-bold transition-all cursor-pointer"
                                        title="Delete this session from database"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Delete</span>
                                    </button>
                                    <button
                                        onClick={() => setSelectedSession(null)}
                                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-orange-50 cursor-pointer"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Session Quick Metrics */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
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
                                    <div className="text-emerald-700 font-bold text-sm truncate">{selectedSession.employmentStatus}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-100">
                                    <div className="text-slate-500 text-[10px] uppercase">Sentiment Analysis:</div>
                                    <div className={`font-bold text-sm ${
                                        selectedSession.sentiment?.label === 'Positive'
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
                            <div className="p-4 rounded-2xl bg-orange-50/40 border border-orange-200/60 space-y-2">
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
                            <div className="space-y-3">
                                <div className="flex items-center space-x-2 text-xs font-mono text-orange-800 border-b border-orange-100 pb-2">
                                    <FileText className="w-4 h-4 text-orange-600" />
                                    <span className="font-bold uppercase tracking-wider">Verbatim Transcribed Interview Log</span>
                                </div>

                                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                                    {selectedSession.rawResponses ? (
                                        LSPU_SURVEY_STRUCTURE.map((section) => {
                                            const sectionQs = section.questions.filter(q => selectedSession.rawResponses[q.id] !== undefined);
                                            if (sectionQs.length === 0) return null;

                                            return (
                                                <div key={section.sectionId} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                                                    <h5 className="text-[11px] font-mono font-bold text-orange-800 uppercase tracking-wider">
                                                        {section.sectionTitle}
                                                    </h5>
                                                    <div className="space-y-2 pl-1">
                                                        {sectionQs.map(q => (
                                                            <div key={q.id} className="text-xs space-y-1">
                                                                <p className="font-semibold text-slate-800">
                                                                    <span className="font-mono text-orange-600 text-[10px] mr-1">[{q.id}]</span>
                                                                    {q.question}
                                                                </p>
                                                                <div className="p-2.5 rounded-lg bg-white border border-orange-100 text-slate-700 italic font-mono text-[11px]">
                                                                    "{selectedSession.rawResponses[q.id] || 'No verbal response recorded'}"
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        /* Fallback for qualitative summary fields */
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
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
