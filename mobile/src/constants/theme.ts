/** The web app's palette (slate and blue), for light and dark mode. */
export const Colors = {
  light: {
    text: '#0f172a',
    textSecondary: '#475569',
    background: '#f8fafc',
    backgroundElement: '#ffffff',
    border: '#e2e8f0',
    tint: '#2563eb',
    onTint: '#ffffff',
    danger: '#dc2626',
    warning: '#b45309',
    track: '#e2e8f0',
  },
  dark: {
    text: '#f1f5f9',
    textSecondary: '#94a3b8',
    background: '#020617',
    backgroundElement: '#0f172a',
    border: '#1e293b',
    tint: '#3b82f6',
    onTint: '#ffffff',
    danger: '#f87171',
    warning: '#fbbf24',
    track: '#1e293b',
  },
} as const;

export type ThemeColors = (typeof Colors)['light'] | (typeof Colors)['dark'];

export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
} as const;

export const Radius = 14;
