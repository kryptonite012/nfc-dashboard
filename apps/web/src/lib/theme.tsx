import type { ThemePreference } from '@vaultledger/shared';
import * as React from 'react';
import { IS_CLAUDE_EDITION } from './edition';

const STORAGE_KEY = 'vl-theme';

interface ThemeContextValue {
  theme: ThemePreference;
  resolved: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * In the Claude edition the host app sets data-theme="light" | "dark" on the root element when the
 * viewer picked a theme in claude.ai; "system" then follows that choice, otherwise the OS setting.
 */
function hostTheme(): 'light' | 'dark' | null {
  if (!IS_CLAUDE_EDITION || typeof document === 'undefined') return null;
  const value = document.documentElement.getAttribute('data-theme');
  return value === 'light' || value === 'dark' ? value : null;
}

function systemPrefersDark(): boolean {
  const host = hostTheme();
  if (host) return host === 'dark';
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Theme preference: stored per device for instant paint, synced with the account setting when signed in. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>(readStoredTheme);
  const [systemDark, setSystemDark] = React.useState(systemPrefersDark);

  React.useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const listener = () => setSystemDark(systemPrefersDark());
    media.addEventListener('change', listener);
    const observer = IS_CLAUDE_EDITION ? new MutationObserver(listener) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', listener);
      observer?.disconnect();
    };
  }, []);

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    // The host owns data-theme in the Claude edition.
    if (!IS_CLAUDE_EDITION) root.setAttribute('data-theme', resolved);
  }, [resolved]);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
  }, []);

  const value = React.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
