import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import ConversationalInterview from './components/ConversationalInterview';
import AdminPortal from './components/AdminPortal';
import AdminLoginModal from './components/AdminLoginModal';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('App ErrorBoundary caught error:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center p-6 bg-slate-900 text-white font-sans text-center">
                    <div className="max-w-md p-8 rounded-3xl bg-slate-800 border border-slate-700 space-y-4">
                        <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 mx-auto flex items-center justify-center font-bold text-xl">⚠️</div>
                        <h2 className="text-xl font-bold font-serif text-white">Interface Notice</h2>
                        <p className="text-xs text-slate-400 leading-relaxed font-mono">
                            {this.state.error?.message || 'An unexpected rendering error occurred.'}
                        </p>
                        <button
                            onClick={() => {
                                sessionStorage.clear();
                                window.location.reload();
                            }}
                            className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs transition-all cursor-pointer"
                        >
                            Reset & Reload Portal
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function App() {
    // Current Active View: 'landing' | 'interview' | 'admin'
    const [view, setView] = useState(() => {
        const savedAdmin = sessionStorage.getItem('valumni_admin_user');
        if (savedAdmin) return 'admin';
        const savedView = sessionStorage.getItem('valumni_active_view');
        return savedView || 'landing';
    });

    const [adminUser, setAdminUser] = useState(() => {
        try {
            const saved = sessionStorage.getItem('valumni_admin_user');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);

    // Reliable view navigation that survives page refreshes
    const navigateTo = (nextView) => {
        setView(nextView);
        sessionStorage.setItem('valumni_active_view', nextView);
    };

    // Handle successful admin authentication
    const handleLoginSuccess = (user) => {
        setIsAdminLoginOpen(false);
        setAdminUser(user);
        sessionStorage.setItem('valumni_admin_user', JSON.stringify(user));
        navigateTo('admin');
    };

    // Handle admin logout
    const handleLogout = () => {
        setIsAdminLoginOpen(false);
        setAdminUser(null);
        sessionStorage.removeItem('valumni_admin_user');
        navigateTo('landing');
    };

    const handleInterviewComplete = (interviewData) => {
        console.log('Exit interview completed and persisted:', interviewData);
    };

    return (
        <ErrorBoundary>
            <div className={`bg-cloud-gradient font-sans antialiased text-slate-800 ${view === 'landing' ? 'h-screen max-h-screen overflow-hidden' : 'min-h-screen'}`}>
                {/* View 1: Landing Page (Public Student View) */}
                {view === 'landing' && (
                    <LandingPage
                        onStartSession={() => navigateTo('interview')}
                        onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                    />
                )}

                {/* View 2: Active Conversational Character.ai Voice Interview Session */}
                {view === 'interview' && (
                    <div className="h-screen max-h-screen overflow-hidden flex flex-col">
                        <ConversationalInterview
                            onInterviewComplete={handleInterviewComplete}
                            onExitToLanding={() => navigateTo('landing')}
                        />
                    </div>
                )}

                {/* View 3: Admin Portal */}
                {view === 'admin' && (
                    <AdminPortal
                        adminUser={adminUser}
                        onLogout={handleLogout}
                    />
                )}

                {/* Admin Login Dialog Modal (unmounts completely when closed so inputs never persist) */}
                {isAdminLoginOpen && (
                    <AdminLoginModal
                        isOpen={isAdminLoginOpen}
                        onClose={() => setIsAdminLoginOpen(false)}
                        onLoginSuccess={handleLoginSuccess}
                    />
                )}
            </div>
        </ErrorBoundary>
    );
}
