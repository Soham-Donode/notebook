import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'notebook-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch (err) {
    console.warn('Could not read stored theme:', err);
  }
  return 'light';
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// Initialize on script load
const initialTheme = getInitialTheme();
applyThemeToDocument(initialTheme);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
    applyThemeToDocument(theme);
    set({ theme });
  },
  toggleTheme: () => {
    set((state) => {
      const nextTheme: Theme = state.theme === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(STORAGE_KEY, nextTheme);
      } catch {}
      applyThemeToDocument(nextTheme);
      return { theme: nextTheme };
    });
  },
}));
