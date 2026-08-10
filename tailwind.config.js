/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                lspu: {
                    blue: '#0F2C59',
                    gold: '#FFD700',
                    navy: '#0B192C',
                    accent: '#1E56A0',
                    emerald: '#10B981',
                    rose: '#F43F5E',
                    purple: '#8B5CF6'
                }
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'wave': 'wave 1.5s ease-in-out infinite',
                'float': 'float 4s ease-in-out infinite'
            },
            keyframes: {
                wave: {
                    '0%, 100%': { transform: 'scaleY(0.4)' },
                    '50%': { transform: 'scaleY(1.0)' }
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%': { transform: 'translateY(-8px)' }
                }
            }
        },
    },
    plugins: [],
}
