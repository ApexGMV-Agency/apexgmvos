import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Shared with the anti-flash bootstrap script in index.html — keep in sync. */
export const THEME_STORAGE_KEY = 'ac_theme';

const DEFAULT_THEME: Theme = 'light';

/** Matches the --ac-surface-base of each theme, so the mobile browser chrome
 *  and the PWA status bar track the page instead of staying black. */
const THEME_COLOR: Record<Theme, string> = {
  light: '#f5f6f8',
  dark: '#000000',
};

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* Safari in private mode throws on localStorage access — fall through. */
  }
  return DEFAULT_THEME;
}

/** Single place that mutates the document. index.html runs the same two
 *  attribute writes inline before first paint; this keeps them identical. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Bootstrap keys its own internals (select chevrons, close-button filters)
  // off data-bs-theme, so it has to track data-theme.
  root.setAttribute('data-bs-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* Non-persisting session — the theme still applies for this tab. */
    }
  }, [theme]);

  // Keep tabs in the same browser in sync; `storage` only fires on OTHER tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState(t => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
