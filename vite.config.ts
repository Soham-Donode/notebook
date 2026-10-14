import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // [HARD] pdfjs-dist v5 is ESM-first and uses top-level await.
  // Without these two blocks the dev server 500s on the first import.
  optimizeDeps: {
    include: ['pdfjs-dist'],
    esbuildOptions: { target: 'esnext', supported: { 'top-level-await': true } },
  },
  build: { target: 'esnext' },

  // Tauri expects a fixed port and wants Vite's own errors visible
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
}));
