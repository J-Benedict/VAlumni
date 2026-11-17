import React from 'react';

/**
 * High-fidelity SVG Avatars matching the design mockup:
 * - Program Head: CCS faculty attire, adapts Male (Angelo) or Female (Rose) based on selected TTS voice
 * - Interviewee: Gender-neutral graduating student (mortarboard cap with gold tassel, dark graduation gown)
 * Both avatars feature dynamic speaking/listening wave animations and live volume reactivity.
 */

export function ProgramHeadAvatar({ isSpeaking = false, isThinking = false, size = 180, gender = 'male' }) {
    const isFemale = gender === 'female';

    return (
        <div className="flex flex-col items-center select-none group">
            {/* Avatar Container with Animated Aura */}
            <div 
                className="relative flex items-center justify-center transition-transform duration-300"
                style={{ width: `${size}px`, height: `${size}px` }}
            >
                {/* Speaking Wave Ripple Ring */}
                {isSpeaking && (
                    <>
                        <div className="absolute inset-0 rounded-full border-4 border-blue-400/50 animate-ping pointer-events-none" />
                        <div className="absolute -inset-2 rounded-full border-2 border-indigo-400/40 animate-pulse pointer-events-none" />
                    </>
                )}

                {/* Thinking Glow Ring */}
                {isThinking && (
                    <div className="absolute -inset-1.5 rounded-full border-2 border-amber-400/60 animate-spin border-t-transparent pointer-events-none" />
                )}

                {/* SVG Illustration of CCS Program Head (Male or Female) */}
                <svg
                    viewBox="0 0 200 200"
                    width={size}
                    height={size}
                    className={`drop-shadow-2xl transition-all duration-300 ${isSpeaking ? 'scale-105' : ''}`}
                >
                    <defs>
                        <radialGradient id="phSkinGrad" cx="50%" cy="40%" r="55%">
                            <stop offset="0%" stopColor="#FFE082" />
                            <stop offset="70%" stopColor="#FFCA28" />
                            <stop offset="100%" stopColor="#FFB300" />
                        </radialGradient>
                        <linearGradient id="phSuitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#3F51B5" />
                            <stop offset="50%" stopColor="#283593" />
                            <stop offset="100%" stopColor="#1A237E" />
                        </linearGradient>
                        <linearGradient id="phTieGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#EF5350" />
                            <stop offset="100%" stopColor="#C62828" />
                        </linearGradient>
                        <filter id="phShadow" x="-10%" y="-10%" width="120%" height="120%">
                            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.25" />
                        </filter>
                    </defs>

                    {/* Long Dark Hair Back Layer (Female / Rose) */}
                    {isFemale && (
                        <g>
                            <path
                                d="M 48 88 C 44 128 48 162 58 175 L 142 175 C 152 162 156 128 152 88 C 150 48 128 34 100 34 C 72 34 50 48 48 88 Z"
                                fill="#263238"
                            />
                            <path
                                d="M 54 96 C 50 132 54 158 64 170 L 136 170 C 146 158 150 132 146 96 Z"
                                fill="#37474F"
                                opacity="0.55"
                            />
                        </g>
                    )}

                    {/* Suit Body / Shoulders */}
                    <g filter="url(#phShadow)">
                        {/* Suit Shoulders */}
                        <path
                            d="M 30 195 C 32 145 65 130 100 130 C 135 130 168 145 170 195 Z"
                            fill="url(#phSuitGrad)"
                        />
                        {/* White Dress Shirt / Blouse V-Neck */}
                        <polygon
                            points="82,130 118,130 100,172"
                            fill="#FFFFFF"
                        />
                        {/* Crisp Shirt Collar Flaps */}
                        <polygon
                            points="78,130 100,154 94,130"
                            fill="#ECEFF1"
                        />
                        <polygon
                            points="122,130 100,154 106,130"
                            fill="#ECEFF1"
                        />
                        {isFemale ? (
                            /* Neat Crimson Faculty Ascot / Ribbon Bow (Female / Rose) */
                            <g>
                                <polygon
                                    points="88,144 100,152 86,162"
                                    fill="url(#phTieGrad)"
                                />
                                <polygon
                                    points="112,144 100,152 114,162"
                                    fill="url(#phTieGrad)"
                                />
                                <polygon
                                    points="96,154 104,154 106,174 100,178 94,174"
                                    fill="#C62828"
                                />
                                <circle cx="100" cy="151" r="5" fill="#B71C1C" />
                            </g>
                        ) : (
                            /* Classic Red Necktie (Male / Angelo) */
                            <g>
                                <polygon
                                    points="94,146 106,146 103,158 97,158"
                                    fill="#B71C1C"
                                />
                                <polygon
                                    points="96,158 104,158 107,195 100,200 93,195"
                                    fill="url(#phTieGrad)"
                                />
                            </g>
                        )}
                        {/* Suit Lapel Left */}
                        <path
                            d="M 68 135 L 85 168 L 78 195 L 42 195 C 46 160 58 142 68 135 Z"
                            fill="#283593"
                        />
                        {/* Suit Lapel Right */}
                        <path
                            d="M 132 135 L 115 168 L 122 195 L 158 195 C 154 160 142 142 132 135 Z"
                            fill="#283593"
                        />
                        {/* Small Golden CCS Faculty Lapel Pin */}
                        <circle cx="68" cy="155" r="4" fill="#FFD54F" stroke="#FFA000" strokeWidth="1" />
                    </g>

                    {/* Neck */}
                    <rect x="88" y="112" width="24" height="26" rx="6" fill="#FFA000" opacity="0.3" />
                    <rect x="90" y="110" width="20" height="24" rx="5" fill="#FFCA28" />

                    {/* Ears */}
                    <circle cx="58" cy="88" r="10" fill="#FFB300" />
                    <circle cx="58" cy="88" r="6" fill="#FFA000" opacity="0.4" />
                    <circle cx="142" cy="88" r="10" fill="#FFB300" />
                    <circle cx="142" cy="88" r="6" fill="#FFA000" opacity="0.4" />

                    {/* Head / Face */}
                    <circle cx="100" cy="88" r="44" fill="url(#phSkinGrad)" filter="url(#phShadow)" />

                    {/* Eyes */}
                    <circle cx="82" cy="86" r="5" fill="#212121" />
                    <circle cx="84" cy="84" r="1.5" fill="#FFFFFF" />
                    <circle cx="118" cy="86" r="5" fill="#212121" />
                    <circle cx="116" cy="84" r="1.5" fill="#FFFFFF" />

                    {/* Subtle Eyelashes & Arched Eyebrows for Female (Rose) */}
                    {isFemale ? (
                        <g>
                            <path d="M 76 82 L 79 84 M 124 82 L 121 84" stroke="#212121" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M 74 75 Q 82 69 91 74" stroke="#37474F" strokeWidth="2.2" strokeLinecap="round" fill="none" />
                            <path d="M 109 74 Q 118 69 126 75" stroke="#37474F" strokeWidth="2.2" strokeLinecap="round" fill="none" />
                        </g>
                    ) : (
                        <g>
                            <path d="M 75 76 Q 82 72 90 76" stroke="#37474F" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                            <path d="M 110 76 Q 118 72 125 76" stroke="#37474F" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                        </g>
                    )}

                    {/* Pleasant Smile / Speaking Mouth */}
                    {isSpeaking ? (
                        <g className="animate-pulse">
                            <ellipse cx="100" cy="106" rx="8" ry="6" fill="#B71C1C" />
                            <path d="M 94 104 Q 100 107 106 104" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="none" />
                        </g>
                    ) : (
                        <path d="M 91 104 Q 100 112 109 104" stroke="#8D6E63" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                    )}

                    {/* Hair Front Layer */}
                    {isFemale ? (
                        <g>
                            {/* Styled Swept Feminine Front Bangs Framing Forehead & Temples */}
                            <path
                                d="M 55 86 C 54 48 75 36 100 36 C 125 36 146 48 145 86 C 142 70 132 58 112 56 C 95 62 72 64 55 86 Z"
                                fill="#263238"
                            />
                            <path
                                d="M 58 80 C 66 52 90 44 120 46 C 102 52 80 62 64 78 Z"
                                fill="#37474F"
                            />
                        </g>
                    ) : (
                        <g>
                            {/* Neat Professional Side-part (Male / Angelo) */}
                            <path
                                d="M 56 80 C 56 46 75 38 100 38 C 125 38 144 46 144 80 C 138 68 128 60 110 60 C 85 60 70 66 56 80 Z"
                                fill="#263238"
                            />
                            <path
                                d="M 58 76 C 65 52 88 44 114 46 C 98 48 80 58 74 72 Z"
                                fill="#37474F"
                            />
                        </g>
                    )}
                </svg>

                {/* Live Speech Wave Indicator */}
                {isSpeaking && (
                    <div className="absolute -top-3 right-2 flex items-center space-x-0.5 bg-blue-600/90 text-white px-2 py-0.5 rounded-full text-[10px] font-mono shadow-md backdrop-blur-sm animate-bounce">
                        <span className="w-1 h-2 bg-white rounded-full animate-pulse" />
                        <span className="w-1 h-3.5 bg-white rounded-full animate-pulse delay-75" />
                        <span className="w-1 h-2 bg-white rounded-full animate-pulse delay-150" />
                        <span className="ml-1 text-[9px] font-bold">SPEAKING</span>
                    </div>
                )}
            </div>

            {/* Label Underneath */}
            <span className="mt-3 text-lg md:text-xl font-bold font-sans tracking-wide text-white drop-shadow-md">
                AI Interview Assistant
            </span>
            <span className="text-[11px] font-mono text-slate-400">
                CCS Exit Interviewer
            </span>
        </div>
    );
}

export function IntervieweeAvatar({ isListening = false, volumeLevel = 0, size = 180 }) {
    // Dynamic mic wave scaling based on volumeLevel (0-100)
    const normalizedVolume = Math.min(100, Math.max(0, volumeLevel));
    const waveScale = isListening ? 1 + (normalizedVolume / 200) : 1;

    return (
        <div className="flex flex-col items-center select-none group">
            {/* Avatar Container */}
            <div 
                className="relative flex items-center justify-center transition-transform duration-200"
                style={{ 
                    width: `${size}px`, 
                    height: `${size}px`,
                    transform: `scale(${waveScale})`
                }}
            >
                {/* Active Listening Glowing Aura */}
                {isListening && (
                    <>
                        <div 
                            className="absolute inset-0 rounded-full border-4 border-emerald-400/60 transition-all duration-150 pointer-events-none"
                            style={{ 
                                boxShadow: `0 0 ${12 + (normalizedVolume / 4)}px rgba(52, 211, 153, 0.6)`,
                                opacity: 0.6 + (normalizedVolume / 200)
                            }}
                        />
                        <div className="absolute -inset-2 rounded-full border-2 border-teal-300/40 animate-ping pointer-events-none" />
                    </>
                )}

                {/* SVG Illustration of Graduate Student / Interviewee */}
                <svg
                    viewBox="0 0 200 200"
                    width={size}
                    height={size}
                    className="drop-shadow-2xl transition-all duration-200"
                >
                    <defs>
                        <radialGradient id="ieSkinGrad" cx="50%" cy="40%" r="55%">
                            <stop offset="0%" stopColor="#FFE082" />
                            <stop offset="70%" stopColor="#FFCA28" />
                            <stop offset="100%" stopColor="#FFB300" />
                        </radialGradient>
                        <linearGradient id="ieGownGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#37474F" />
                            <stop offset="50%" stopColor="#263238" />
                            <stop offset="100%" stopColor="#1C252A" />
                        </linearGradient>
                        <linearGradient id="ieCapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#263238" />
                            <stop offset="100%" stopColor="#10171B" />
                        </linearGradient>
                        <linearGradient id="ieTasselGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#FFD54F" />
                            <stop offset="50%" stopColor="#FFC107" />
                            <stop offset="100%" stopColor="#FFA000" />
                        </linearGradient>
                        <filter id="ieShadow" x="-10%" y="-10%" width="120%" height="120%">
                            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.3" />
                        </filter>
                    </defs>

                    {/* Academic Graduation Gown (Toga) */}
                    <g filter="url(#ieShadow)">
                        <path
                            d="M 32 195 C 34 146 66 132 100 132 C 134 132 166 146 168 195 Z"
                            fill="url(#ieGownGrad)"
                        />
                        {/* Inner Stole / Academic Ribbon V */}
                        <polygon
                            points="86,132 114,132 100,170"
                            fill="#FFC107"
                            opacity="0.85"
                        />
                        <polygon
                            points="92,132 108,132 100,162"
                            fill="#1A237E"
                            opacity="0.9"
                        />
                        {/* Gown Fold Lines */}
                        <path d="M 68 145 L 60 195" stroke="#1C252A" strokeWidth="2.5" opacity="0.6" />
                        <path d="M 132 145 L 140 195" stroke="#1C252A" strokeWidth="2.5" opacity="0.6" />
                    </g>

                    {/* Neck */}
                    <rect x="90" y="112" width="20" height="24" rx="5" fill="#FFCA28" />

                    {/* Ears */}
                    <circle cx="60" cy="94" r="9" fill="#FFB300" />
                    <circle cx="140" cy="94" r="9" fill="#FFB300" />

                    {/* Head / Face (Gender-Neutral Graduate Silhouette) */}
                    <circle cx="100" cy="96" r="42" fill="url(#ieSkinGrad)" filter="url(#ieShadow)" />

                    {/* Clean Neutral Eyes */}
                    <circle cx="82" cy="94" r="5" fill="#212121" />
                    <circle cx="84" cy="92" r="1.5" fill="#FFFFFF" />

                    <circle cx="118" cy="94" r="5" fill="#212121" />
                    <circle cx="116" cy="92" r="1.5" fill="#FFFFFF" />

                    {/* Balanced Neutral Eyebrows */}
                    <path d="M 75 83 Q 82 80 89 83" stroke="#37474F" strokeWidth="2.4" strokeLinecap="round" fill="none" />
                    <path d="M 111 83 Q 118 80 125 83" stroke="#37474F" strokeWidth="2.4" strokeLinecap="round" fill="none" />

                    {/* Gentle Smile / Neutral Speaking Mouth */}
                    {isListening && normalizedVolume > 15 ? (
                        <g>
                            <ellipse cx="100" cy="112" rx="7.5" ry="5.5" fill="#B71C1C" />
                            <path d="M 94 110 Q 100 113 106 110" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                        </g>
                    ) : (
                        <path d="M 91 110 Q 100 118 109 110" stroke="#8D6E63" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                    )}

                    {/* Mortarboard Graduation Cap (Black Diamond) */}
                    <g filter="url(#ieShadow)">
                        {/* Cap Skull Base */}
                        <path
                            d="M 64 72 C 66 50 134 50 136 72 C 126 76 74 76 64 72 Z"
                            fill="#1A2024"
                        />
                        {/* Flat Top Diamond Diamond */}
                        <polygon
                            points="100,22 165,46 100,68 35,46"
                            fill="url(#ieCapGrad)"
                            stroke="#37474F"
                            strokeWidth="1.5"
                        />
                        {/* Center Button */}
                        <circle cx="100" cy="46" r="4.5" fill="#FFC107" />

                        {/* Gold Tassel Hanging to the Left of Cap */}
                        <path
                            d="M 100 46 Q 60 48 44 65 L 44 95"
                            stroke="url(#ieTasselGrad)"
                            strokeWidth="3"
                            fill="none"
                            strokeLinecap="round"
                        />
                        {/* Tassel Golden Bead */}
                        <circle cx="44" cy="94" r="3.5" fill="#FFD54F" />
                        {/* Tassel Fringe */}
                        <polygon
                            points="40,95 48,95 50,118 38,118"
                            fill="url(#ieTasselGrad)"
                        />
                    </g>
                </svg>

                {/* Live Microphone Status Indicator */}
                {isListening && (
                    <div className="absolute -top-3 left-2 flex items-center space-x-1 bg-emerald-600 text-white px-2.5 py-0.5 rounded-full text-[10px] font-mono shadow-md backdrop-blur-sm animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-emerald-200 animate-ping" />
                        <span className="font-bold text-[9px]">MIC LISTENING</span>
                    </div>
                )}
            </div>

            {/* Label Underneath */}
            <span className="mt-3 text-lg md:text-xl font-bold font-sans tracking-wide text-white drop-shadow-md">
                Interviewee
            </span>
            <span className="text-[11px] font-mono text-emerald-400">
                LSPU CCS Alumni
            </span>
        </div>
    );
}
