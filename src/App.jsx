import React, { useState } from 'react';
import Navbar from './components/Navbar';
import VoiceInterview from './components/VoiceInterview';
import WorkflowVisualizer from './components/WorkflowVisualizer';
import Dashboard from './components/Dashboard';
import TestingSuite from './components/TestingSuite';
import DatasetTable from './components/DatasetTable';
import { ShieldCheck, Heart } from 'lucide-react';

export default function App() {
    const [activeTab, setActiveTab] = useState('interview');
    const [sessionCount, setSessionCount] = useState(1);

    const handleInterviewComplete = (interviewData) => {
        console.log('Exit interview data captured:', interviewData);
        setSessionCount(prev => prev + 1);
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans antialiased">
            {/* Navigation Header */}
            <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

            {/* Main Content View Switcher */}
            <main className="flex-1 pb-16">
                {activeTab === 'interview' && (
                    <VoiceInterview onInterviewComplete={handleInterviewComplete} />
                )}
                {activeTab === 'workflow' && (
                    <WorkflowVisualizer />
                )}
                {activeTab === 'dashboard' && (
                    <Dashboard setActiveTab={setActiveTab} />
                )}
                {activeTab === 'testing' && (
                    <TestingSuite />
                )}
                {activeTab === 'dataset' && (
                    <DatasetTable />
                )}
            </main>

            {/* Footer */}
            <footer className="glass-panel border-t border-slate-800/80 py-6">
                <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
                    <div className="flex items-center justify-center space-x-2 text-xs font-mono text-slate-400">
                        <span>VAlumni System v1.0</span>
                        <span>•</span>
                        <span className="text-amber-400 font-semibold">LSPU College of Computer Studies</span>
                        <span>•</span>
                        <span className="text-indigo-400">Group CS3B-09</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
