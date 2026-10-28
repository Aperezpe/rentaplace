'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';

/** Saved choice: 'light' or 'dark'. Without one, the page follows the system setting. */
export const THEME_KEY = 'rentaplace-theme';
export type Theme = 'light' | 'dark';

/** Runs before the first paint (see app/layout.tsx), so a saved or system dark theme never flashes light. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t}catch(e){}`;

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const system = matchMedia('(prefers-color-scheme: dark)');
  const followSystem = () => {
    if (!localStorage.getItem(THEME_KEY)) apply(system.matches ? 'dark' : 'light');
  };
  system.addEventListener('change', followSystem);
  return () => {
    observer.disconnect();
    system.removeEventListener('change', followSystem);
  };
}

const current = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => 'light');
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  apply(theme);
}

export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 rounded-full"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-theme-current={theme}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}
