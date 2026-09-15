import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import VoiceInterview from './components/VoiceInterview';
import AdminPortal from './components/AdminPortal';
import AdminLoginModal from './components/AdminLoginModal';

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
        setAdminUser(user);
        sessionStorage.setItem('valumni_admin_user', JSON.stringify(user));
        navigateTo('admin');
    };

    // Handle admin logout
    const handleLogout = () => {
        setAdminUser(null);
        sessionStorage.removeItem('valumni_admin_user');
        navigateTo('landing');
    };

    const handleInterviewComplete = (interviewData) => {
        console.log('Exit interview completed and persisted:', interviewData);
    };

    return (
        <div className="min-h-screen bg-cloud-gradient font-sans antialiased text-slate-800">
            {/* View 1: Landing Page (Public Student View) */}
            {view === 'landing' && (
                <LandingPage
                    onStartSession={() => navigateTo('interview')}
                    onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                />
            )}

            {/* View 2: Active Voice Interview Session */}
            {view === 'interview' && (
                <div className="min-h-screen bg-cloud-gradient flex flex-col">
                    <VoiceInterview
                        initialStage="survey"
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

            {/* Admin Login Dialog Modal */}
            <AdminLoginModal
                isOpen={isAdminLoginOpen}
                onClose={() => setIsAdminLoginOpen(false)}
                onLoginSuccess={handleLoginSuccess}
            />
        </div>
    );
}
