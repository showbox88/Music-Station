import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  root: resolve(__dirname),
  // Production: mounted at /app/ behind Tailscale serve.
  // Dev: served at root by Vite dev server, no prefix needed.
  base: command === 'build' ? '/app/' : '/',
  plugins: [react()],
  // Build-time constants exposed to the app. Header.tsx reads them
  // to show "what version am I looking at right now?". Both are
  // wrapped in JSON.stringify so they show up as string literals in
  // the bundled JS.
  define: {
    __BUILD_HASH__: JSON.stringify(gitShortHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In dev, /api/* is proxied to the Express backend so the frontend can
    // call relative URLs and not care about CORS.
    //
    // Default: localhost — works if you have the backend running locally
    // (requires native better-sqlite3 build → needs VS Build Tools on Windows).
    //
    // Override with env var to develop against a deployed backend instead:
    //   VITE_API_TARGET=http://192.168.1.16:3002 npm run dev:web
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3002',
    },
  },
}));
