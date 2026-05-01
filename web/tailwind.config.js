import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  // Absolute paths so the config works regardless of where vite is invoked
  // from (e.g. project root vs web/ subdir).
  content: [resolve(here, 'index.html'), resolve(here, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {},
  },
  plugins: [],
};
