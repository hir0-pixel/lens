/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", "class"],
  theme: {
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			accent: {
				'50': '#FAFAF7',
				'100': '#F7F7F4',
				'200': '#EFEEE8',
				'300': '#E6E5E0',
				'400': '#CFCDC4',
				'500': '#F54E00',
				'600': '#D04200',
				'700': '#D04200',
				'800': '#26251E',
				'900': '#26251E',
				DEFAULT: '#F54E00',
				foreground: '#FFFFFF'
  			},
			surface: {
				'0': 'var(--surface-0)',
				'1': 'var(--surface-1)',
				'2': 'var(--surface-2)',
				'3': 'var(--surface-3)',
				'4': 'var(--surface-4)'
			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			sans: [
  				'Inter',
  				'ui-sans-serif',
  				'system-ui',
  				'Helvetica Neue',
  				'Helvetica',
  				'Arial',
  				'sans-serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'Fira Code',
  				'Menlo',
  				'Consolas',
  				'monospace'
  			]
  		},
		borderRadius: {
			sm: 'calc(var(--radius) - 4px)',
			md: 'calc(var(--radius) - 2px)',
			lg: 'var(--radius)',
			xl: 'calc(var(--radius) + 4px)'
		},
		boxShadow: {
			'glow-accent': 'none',
			'float-pop': 'var(--shadow-overlay)',
			'sm': 'var(--shadow-sm)',
			'md': 'var(--shadow-md)',
			'lg': 'var(--shadow-lg)'
		},
		transitionDuration: {
			fast: 'var(--motion-fast)',
			normal: 'var(--motion-normal)',
			slow: 'var(--motion-slow)',
			enter: 'var(--motion-enter)'
		},
		transitionTimingFunction: {
			lens: 'var(--ease-out)'
		},
		zIndex: {
			sticky: 'var(--z-sticky)',
			dropdown: 'var(--z-dropdown)',
			modal: 'var(--z-modal)',
			toast: 'var(--z-toast)',
			tooltip: 'var(--z-tooltip)'
		},
		keyframes: {
			'fade-in': {
				from: { opacity: '0' },
				to: { opacity: '1' }
			},
			'fade-up': {
				from: {
					opacity: '0',
					transform: 'translateY(4px)'
				},
				to: {
					opacity: '1',
					transform: 'translateY(0)'
				}
			},
			'scale-in': {
				from: {
					opacity: '0',
					transform: 'scale(0.98)'
				},
				to: {
					opacity: '1',
					transform: 'scale(1)'
				}
			},
			pulseDot: {
				'0%, 100%': { opacity: '1' },
				'50%': { opacity: '0.35' }
			},
			'accordion-down': {
				from: { height: '0' },
				to: { height: 'var(--radix-accordion-content-height)' }
			},
			'accordion-up': {
				from: { height: 'var(--radix-accordion-content-height)' },
				to: { height: '0' }
			},
			'shimmer': {
				'100%': { transform: 'translateX(100%)' }
			}
		},
		animation: {
			'fade-in': 'fade-in var(--motion-slow) var(--ease-out)',
			'fade-up': 'fade-up var(--motion-enter) var(--ease-out)',
			'scale-in': 'scale-in var(--motion-slow) var(--ease-out)',
			'pulse-dot': 'pulseDot 1.2s ease-in-out infinite',
			'accordion-down': 'accordion-down var(--motion-slow) ease-out',
			'accordion-up': 'accordion-up var(--motion-slow) ease-out',
			shimmer: 'shimmer 1.4s ease-in-out infinite'
		}
  	}
  },
  plugins: [require("@tailwindcss/typography")],
};
