import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { Panel } from './Panel';

/**
 * The side panel is a normal document, so it follows the OS theme rather than
 * forcing dark the way the content-script composer does.
 */
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (matches: boolean) =>
  document.documentElement.classList.toggle('dark', matches);

applyTheme(dark.matches);
dark.addEventListener('change', (e) => applyTheme(e.matches));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel />
  </StrictMode>
);
