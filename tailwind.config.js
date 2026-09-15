/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                serif: ['Merriweather', 'Playfair Display', 'Cinzel', 'Georgia', 'serif'],
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            colors: {
                lspu: {
                    blue: '#0F2C59',
                    gold: '#FFD700',
                    navy: '#0B192C',
                    accent: '#1E56A0',
                    emerald: '#10B981',
                    rose: '#F43F5E',
                    purple: '#8B5CF6'
                },
                sunset: {
                    header: '#d89b65',
                    headerHover: '#c88a53',
                    card: '#d9d9d9',
                    btn: '#d69e62',
                    btnHover: '#c2874a',
                    50: '#fff7ed',
                    100: '#ffedd5',
                    200: '#fed7aa',
                    300: '#fdba74',
                    400: '#fb923c',
                    500: '#f97316',
                    600: '#ea580c',
                    700: '#c2410c',
                    800: '#9a3412',
                    900: '#7c2d12',
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
