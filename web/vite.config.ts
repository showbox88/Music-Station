import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In dev, /api/* is proxied to the Express server on :3002 so the
    // frontend code can call relative URLs and not care about CORS.
    proxy: {
      '/api': 'http://127.0.0.1:3002',
    },
  },
});
