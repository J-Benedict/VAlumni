import React, { useState } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import { DATA_PRIVACY_TEXT } from '../services/aiService';
import { User, ShieldCheck, CheckCircle, ArrowRight, FileText } from 'lucide-react';

export default function LandingPage({ onStartSession, onOpenAdminLogin }) {
    const [agreedToTos, setAgreedToTos] = useState(true);

    return (
        <div className="min-h-screen flex flex-col bg-cloud-gradient text-slate-800 relative selection:bg-orange-500 selection:text-white overflow-x-hidden">
            {/* Soft Ambient Cloud Highlights for depth */}
            <div className="cloud-ambient w-[600px] h-[350px] bg-white top-10 left-1/4 -z-0"></div>
            <div className="cloud-ambient w-[500px] h-[300px] bg-orange-200/40 bottom-10 right-10 -z-0"></div>
            <div className="cloud-ambient w-[700px] h-[400px] bg-orange-300/30 -bottom-20 left-10 -z-0"></div>

            {/* Top Navigation Bar - Full-width layout */}
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

                    {/* Right: Admin Account Login Icon on rightmost side */}
                    <button
                        onClick={onOpenAdminLogin}
                        className="p-2 rounded-full text-slate-800 hover:text-slate-950 hover:bg-black/10 active:scale-95 transition-all flex items-center cursor-pointer group"
                        title="Admin Account Login"
                        aria-label="Admin Account Login"
                    >
                        <User className="w-6 h-6 stroke-[1.75] transition-transform group-hover:scale-110" />
                    </button>
                </div>
            </header>

            {/* Main Center Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-6 md:py-8 max-w-5xl mx-auto w-full">
                {/* Title Section */}
                <div className="text-center space-y-1.5 mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif text-slate-900 tracking-tight leading-tight">
                        Laguna State Polytechnic University
                    </h1>
                    <h2 className="text-xl sm:text-2xl md:text-3xl font-serif text-slate-800 font-medium tracking-normal">
                        CCS Exit Interview
                    </h2>
                </div>

                {/* Terms of Service & Privacy Notice Container - Fitting Entirely */}
                <div className="w-full max-w-3xl rounded-2xl bg-[#dcdcdc]/95 backdrop-blur-md border border-slate-300 shadow-xl shadow-orange-950/10 p-6 md:p-7 space-y-3.5 animate-in fade-in duration-500">
                    <div className="flex items-center justify-between border-b border-slate-300/80 pb-2.5">
                        <div className="flex items-center space-x-2">
                            <FileText className="w-4 h-4 text-orange-700" />
                            <h3 className="font-serif font-bold text-base md:text-lg text-slate-900">
                                Terms of Service & Privacy Notice
                            </h3>
                        </div>
                        <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                            RA 10173 Compliant
                        </span>
                    </div>

                    {/* Privacy Policy & TOS Content - Fits entirely without scroll cutoff */}
                    <div className="space-y-2.5 font-sans text-xs md:text-[13px] text-slate-700 leading-relaxed bg-white/80 p-4 md:p-5 rounded-xl border border-slate-200 shadow-inner">
                        <p className="font-semibold text-slate-900">
                            In compliance with Republic Act No. 10173 (Data Privacy Act of 2012):
                        </p>
                        <p>
                            By accomplishing and participating in this exit interview, you consent to the collection, storage, and processing of your personal, academic, and evaluation responses by authorized researchers and faculty of the College of Computer Studies at Laguna State Polytechnic University.
                        </p>
                        <p>
                            This platform, <strong>VAlumni AI Voice Assistant</strong>, utilizes browser-based speech recognition strictly for academic evaluation, software quality assessment, and curriculum improvement.
                        </p>
                        <p>
                            Your responses will remain strictly confidential and accessible solely to accredited researchers and Alumni Affairs personnel. All personal identifying parameters are separated before thematic and sentiment analysis is performed.
                        </p>
                    </div>

                    {/* Consent Checkbox */}
                    <div className="flex items-center space-x-2.5 pt-1">
                        <input
                            type="checkbox"
                            id="agreeTos"
                            checked={agreedToTos}
                            onChange={(e) => setAgreedToTos(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-400 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                        <label 
                            htmlFor="agreeTos" 
                            className="text-xs md:text-sm font-medium text-slate-800 cursor-pointer select-none"
                        >
                            I have read, understood, and agree to the Terms of Service and Data Privacy Notice.
                        </label>
                    </div>
                </div>

                {/* Start Session Button - Positioned directly below TOS as in mockup */}
                <div className="mt-5 flex flex-col items-center space-y-2">
                    <button
                        onClick={onStartSession}
                        disabled={!agreedToTos}
                        className={`px-12 py-3.5 rounded-lg font-serif font-bold text-base md:text-lg shadow-md transition-all duration-200 transform ${
                            agreedToTos
                                ? 'bg-[#d59e66] hover:bg-[#c48c54] active:scale-98 text-slate-900 hover:shadow-lg cursor-pointer'
                                : 'bg-slate-300 text-slate-500 cursor-not-allowed border border-slate-300'
                        }`}
                    >
                        Start Session
                    </button>
                    {!agreedToTos && (
                        <p className="text-xs font-sans text-rose-700 bg-rose-50 px-3 py-1 rounded-full border border-rose-200">
                            Please check the agreement box above to begin.
                        </p>
                    )}
                </div>
            </main>

            {/* Subtle Footer */}
            <footer className="relative z-10 py-4 text-center text-xs font-serif text-slate-800/80">
                <p>© {new Date().getFullYear()} Laguna State Polytechnic University • College of Computer Studies</p>
            </footer>
        </div>
    );
}
