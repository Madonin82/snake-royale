import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  // GitHub Pages serves this repo at /snake-royale/; local dev stays at /.
  // The Pages workflow sets GITHUB_PAGES=true for its build only.
  base: process.env.GITHUB_PAGES === 'true' ? '/snake-royale/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
