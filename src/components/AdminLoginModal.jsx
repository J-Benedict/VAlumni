import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, User, KeyRound, AlertCircle, X, ShieldCheck, Loader2 } from 'lucide-react';

export default function AdminLoginModal({ isOpen, onClose, onLoginSuccess }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [isInputReady, setIsInputReady] = useState(false);
    const usernameRef = useRef(null);

    const clearFields = useCallback(() => {
        setUsername('');
        setPassword('');
        setErrorMsg('');
        setIsLoading(false);
        setIsInputReady(false);
    }, []);

    // Always wipe any typed credentials whenever the modal opens, closes, or unmounts,
    // and briefly hold readOnly on mount so browser password autofill cannot pre-populate saved inputs.
    useEffect(() => {
        clearFields();
        if (!isOpen) return undefined;

        const timer = setTimeout(() => {
            setUsername('');
            setPassword('');
            setIsInputReady(true);
            usernameRef.current?.focus();
        }, 120);

        return () => {
            clearTimeout(timer);
            clearFields();
        };
    }, [isOpen, clearFields]);

    const handleClose = useCallback(() => {
        clearFields();
        if (onClose) onClose();
    }, [clearFields, onClose]);

    // Support Escape key to close and clear inputs
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                handleClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, handleClose]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');

        const submittedUsername = username.trim();
        const submittedPassword = password;

        if (!submittedUsername || !submittedPassword) {
            setErrorMsg('Please enter both Admin username and password.');
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: submittedUsername,
                    password: submittedPassword
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                // Immediately wipe credentials before transitioning to Admin Portal
                clearFields();
                if (onLoginSuccess) {
                    onLoginSuccess(data.user);
                }
                if (onClose) onClose();
            } else {
                setPassword('');
                setErrorMsg(data.message || 'Invalid username or password.');
                setIsLoading(false);
            }
        } catch (err) {
            console.error('Login request failed:', err);
            setErrorMsg('Could not connect to authentication server. Please check your backend.');
            setIsLoading(false);
        }
    };

    return (
        <div
            onClick={handleClose}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
        >
            <div 
                className="relative w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-xl p-8 border border-orange-200/80 shadow-2xl shadow-orange-950/20 text-slate-800 space-y-6"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close Button */}
                <button
                    type="button"
                    onClick={handleClose}
                    className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-orange-50 transition-colors cursor-pointer"
                    title="Close Login Modal"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Header */}
                <div className="text-center space-y-2 pt-2">
                    <div className="inline-flex p-3 rounded-2xl bg-orange-100/80 text-orange-600 border border-orange-200 mb-1">
                        <ShieldCheck className="w-7 h-7 text-orange-600" />
                    </div>
                    <h3 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Admin Portal Access</h3>
                    <p className="text-xs text-slate-500 font-sans max-w-xs mx-auto">
                        Sign in with your verified administrative credentials to inspect and manage saved exit interviews.
                    </p>
                </div>

                {/* Error Banner */}
                {errorMsg && (
                    <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-sans flex items-start space-x-2.5 animate-in fade-in">
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>{errorMsg}</span>
                    </div>
                )}

                {/* Login Form */}
                <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4 font-sans text-sm">
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-orange-600" />
                            Admin Username
                        </label>
                        <input
                            ref={usernameRef}
                            type="text"
                            name="valumni_portal_user"
                            required
                            readOnly={!isInputReady}
                            onPointerDown={() => setIsInputReady(true)}
                            onKeyDown={() => setIsInputReady(true)}
                            autoComplete="off"
                            data-lpignore="true"
                            data-form-type="other"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter admin username"
                            className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 transition-all"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                            <KeyRound className="w-3.5 h-3.5 text-orange-600" />
                            Admin Password
                        </label>
                        <input
                            type="password"
                            name="valumni_portal_secret"
                            required
                            readOnly={!isInputReady}
                            onPointerDown={() => setIsInputReady(true)}
                            onKeyDown={() => setIsInputReady(true)}
                            autoComplete="new-password"
                            data-lpignore="true"
                            data-form-type="other"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 transition-all"
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold text-sm shadow-lg shadow-orange-500/25 transition-all transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-60 cursor-pointer"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Verifying Credentials...</span>
                                </>
                            ) : (
                                <>
                                    <Lock className="w-4 h-4" />
                                    <span>Sign In as Administrator</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
