import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    // Explicit config path so vite picks the right tailwind.config.js
    // regardless of where it's invoked from.
    tailwindcss: { config: resolve(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
