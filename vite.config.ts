import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    target: 'esnext',
    // Content scripts are injected as classic scripts, so every chunk they
    // reach must be self-contained. crxjs handles the IIFE wrapping; keeping
    // module preload off avoids it emitting <link rel=modulepreload> for pages
    // that are loaded from chrome-extension:// with a strict CSP.
    modulePreload: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
