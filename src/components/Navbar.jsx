import React from 'react';
import { Mic, BarChart3, GitBranch, TestTube2, Database, ShieldCheck, Sparkles } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab }) {
    const navItems = [
        { id: 'interview', label: 'AI Voice Interview', icon: Mic, badge: 'Interactive' },
        { id: 'workflow', label: 'Voice Workflow', icon: GitBranch, badge: 'Pipeline' },
        { id: 'dashboard', label: 'Analytics Dashboard', icon: BarChart3, badge: 'LSPU 50 Data' },
        { id: 'testing', label: 'Testing & AI Metrics', icon: TestTube2, badge: 'UAT & WER' },
        { id: 'dataset', label: 'Alumni Directory', icon: Database, badge: '50 Records' }
    ];

    return (
        <header className="sticky top-0 z-50 glass-panel border-b border-slate-800/80">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo & University Title */}
                    <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('interview')}>
                        <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-amber-400 p-0.5 shadow-lg shadow-indigo-500/20">
                                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-amber-400 animate-pulse-slow" />
                                </div>
                            </div>
                            <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                            </span>
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-indigo-300 via-white to-amber-300 bg-clip-text text-transparent">
                                    VAlumni
                                </span>
                                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                    AI Voice Assistant
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium tracking-wide">
                                LSPU Alumni Office Exit Interview System
                            </p>
                        </div>
                    </div>

                    {/* Navigation Links */}
                    <nav className="hidden md:flex items-center space-x-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = activeTab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveTab(item.id)}
                                    className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isActive
                                            ? 'bg-gradient-to-r from-indigo-600/90 to-indigo-700/90 text-white shadow-lg shadow-indigo-600/25 border border-indigo-400/30'
                                            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                                        }`}
                                >
                                    <Icon className={`w-4 h-4 ${isActive ? 'text-amber-300' : 'text-slate-400'}`} />
                                    <span>{item.label}</span>
                                </button>
                            );
                        })}
                    </nav>

                    {/* Thesis Group Badge */}
                    <div className="hidden lg:flex items-center space-x-3 text-xs font-mono">
                        <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>CS3B-09</span>
                            <span className="text-slate-500">|</span>
                            <span className="text-amber-400 font-semibold">LSPU CCS</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Mobile Bar */}
            <div className="md:hidden flex overflow-x-auto py-2 px-4 space-x-2 border-t border-slate-800/60 bg-slate-950/90">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap font-medium transition-all ${isActive
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-900 text-slate-300'
                                }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </header>
    );
}
