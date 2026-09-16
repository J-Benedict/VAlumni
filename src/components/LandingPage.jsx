import React, { useState } from 'react';
import ccsLogo from '../../assets/ccs_logo.png';
import lspuLogo from '../../assets/lspu_logo.png';
import { DATA_PRIVACY_TEXT } from '../services/aiService';
import { ShieldCheck, CheckCircle, ArrowRight, FileText } from 'lucide-react';

export default function LandingPage({ onStartSession, onOpenAdminLogin }) {
    const [agreedToTos, setAgreedToTos] = useState(true);

    return (
        <div className="h-screen max-h-screen overflow-hidden flex flex-col bg-cloud-gradient text-slate-800 relative selection:bg-orange-500 selection:text-white">
            {/* Soft Ambient Cloud Highlights for depth */}
            <div className="cloud-ambient w-[600px] h-[350px] bg-white top-10 left-1/4 -z-0"></div>
            <div className="cloud-ambient w-[500px] h-[300px] bg-orange-200/40 bottom-10 right-10 -z-0"></div>
            <div className="cloud-ambient w-[700px] h-[400px] bg-orange-300/30 -bottom-20 left-10 -z-0"></div>

            {/* Top Navigation Bar - Clean, balanced dual-logo header */}
            <header className="relative z-20 w-full bg-[#d59e66] shadow-md border-b border-[#c28a52]/40 shrink-0">
                <div className="w-full px-4 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between">
                    {/* Left: CCS Logo + College & University Title */}
                    <div className="flex items-center space-x-3">
                        <img
                            src={ccsLogo}
                            alt="College of Computer Studies Logo"
                            className="w-10 h-10 sm:w-12 sm:h-12 md:w-[50px] md:h-[50px] object-contain drop-shadow-sm shrink-0"
                        />
                        <div>
                            <p className="text-sm sm:text-base font-serif font-bold text-slate-900 leading-tight">
                                College of Computer Studies
                            </p>
                            <p className="text-[10px] sm:text-xs font-mono text-slate-800/80 tracking-tight">
                                Laguna State Polytechnic University
                            </p>
                        </div>
                    </div>

                    {/* Right: LSPU Logo button that reveals Admin Login */}
                    <button
                        onClick={onOpenAdminLogin}
                        className="p-1 rounded-full hover:bg-black/10 active:scale-95 transition-all flex items-center justify-center cursor-pointer group focus:outline-none"
                        title="Admin Account Access (LSPU)"
                        aria-label="Admin Account Access (LSPU)"
                    >
                        <img
                            src={lspuLogo}
                            alt="Laguna State Polytechnic University Seal - Click for Admin Access"
                            className="w-10 h-10 sm:w-12 sm:h-12 md:w-[50px] md:h-[50px] object-contain drop-shadow-sm transition-transform group-hover:scale-105"
                        />
                    </button>
                </div>
            </header>

            {/* Main Center Content - Adapts vertically and horizontally to fit exactly in 1 screen */}
            <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-6 md:px-8 py-3 sm:py-4 md:py-6 max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto w-full">
                {/* Title Section (shrink-0) */}
                <div className="text-center space-y-0.5 sm:space-y-1 mb-3 sm:mb-4 shrink-0 animate-in fade-in slide-in-from-top-4 duration-500">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-[40px] font-serif text-slate-900 tracking-tight leading-tight">
                        Laguna State Polytechnic University
                    </h1>
                    <h2 className="text-sm sm:text-base md:text-lg lg:text-xl font-serif text-slate-700 font-medium tracking-normal">
                        CCS Exit Interview
                    </h2>
                </div>

                {/* Terms of Service & Privacy Notice Container - Naturally hugs content without excess whitespace */}
                <div className="w-full max-w-4xl lg:max-w-5xl rounded-2xl bg-[#dcdcdc]/95 backdrop-blur-md border border-slate-300 shadow-2xl shadow-orange-950/15 p-5 sm:p-6 md:p-7 space-y-3.5 sm:space-y-4 animate-in fade-in duration-500 shrink-0">
                    {/* Card Header without RA 10173 badge */}
                    <div className="flex items-center space-x-2.5 sm:space-x-3 border-b border-slate-300/80 pb-2.5 sm:pb-3 shrink-0">
                        <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-orange-700 shrink-0" />
                        <h3 className="font-serif font-bold text-base sm:text-lg md:text-xl text-slate-900">
                            Terms of Service & Privacy Notice
                        </h3>
                    </div>

                    {/* Privacy Policy & TOS Content - Hugs content naturally, scrolls only if screen height is constrained */}
                    <div className="max-h-[46vh] overflow-y-auto space-y-2.5 sm:space-y-3 font-sans text-xs sm:text-sm md:text-[14.5px] text-slate-700 leading-relaxed bg-white/90 p-4 sm:p-5 md:p-6 rounded-xl border border-slate-200/90 shadow-inner pr-2.5 sm:pr-4">
                        <p className="font-semibold text-xs sm:text-sm md:text-base text-slate-900">
                            In compliance with Republic Act No. 10173 (Data Privacy Act of 2012):
                        </p>
                        <p>
                            By accomplishing and participating in this exit interview, you consent to the collection, storage, and processing of your personal, academic, and evaluation responses by authorized personnel and faculty of the College of Computer Studies at Laguna State Polytechnic University.
                        </p>
                        <p>
                            This platform, <strong className="font-bold text-slate-900">VAlumni AI Interview Assistant</strong>, utilizes browser-based speech recognition strictly for academic evaluation, software quality assessment, and curriculum improvement.
                        </p>
                        <p>
                            Your responses will remain strictly confidential and accessible solely to accredited Guidance and Alumni Affairs personnel. All personal identifying parameters are separated before thematic and sentiment analysis is performed.
                        </p>
                    </div>

                    {/* Consent Checkbox */}
                    <div className="flex items-center space-x-2.5 sm:space-x-3 pt-0.5 shrink-0">
                        <input
                            type="checkbox"
                            id="agreeTos"
                            checked={agreedToTos}
                            onChange={(e) => setAgreedToTos(e.target.checked)}
                            className="w-4 h-4 sm:w-5 sm:h-5 rounded border-slate-400 text-orange-600 focus:ring-orange-500 cursor-pointer transition-all shrink-0"
                        />
                        <label
                            htmlFor="agreeTos"
                            className="text-xs sm:text-sm md:text-base font-medium text-slate-800 cursor-pointer select-none leading-snug"
                        >
                            I have read, understood, and agree to the Terms of Service and Data Privacy Notice.
                        </label>
                    </div>
                </div>

                {/* Start Session Button Area (shrink-0) */}
                <div className="mt-4 sm:mt-5 shrink-0 flex flex-col items-center space-y-1">
                    <button
                        onClick={onStartSession}
                        disabled={!agreedToTos}
                        className={`px-12 sm:px-14 md:px-16 py-3 sm:py-3.5 rounded-xl font-serif font-bold text-base sm:text-lg md:text-xl shadow-lg transition-all duration-200 transform ${agreedToTos
                            ? 'bg-[#d59e66] hover:bg-[#c48c54] active:scale-98 text-slate-900 hover:shadow-xl cursor-pointer'
                            : 'bg-slate-300 text-slate-500 cursor-not-allowed border border-slate-300'
                            }`}
                    >
                        Start Session
                    </button>
                    {!agreedToTos && (
                        <p className="text-[11px] sm:text-xs md:text-sm font-sans text-rose-700 bg-rose-50 px-3.5 py-1 rounded-full border border-rose-200">
                            Please check the agreement box above to begin.
                        </p>
                    )}
                </div>
            </main>

            {/* Subtle Footer (shrink-0) */}
            <footer className="relative z-10 py-1.5 sm:py-2 text-center text-[10px] sm:text-xs font-serif text-slate-800/80 shrink-0">
                <p>© {new Date().getFullYear()} Laguna State Polytechnic University • College of Computer Studies</p>
            </footer>
        </div>
    );
}
