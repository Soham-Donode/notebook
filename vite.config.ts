import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // [HARD] pdfjs-dist is ESM-first and uses top-level await.
  // Vite 8's Rolldown optimizer handles TLA natively, so it only needs to be
  // explicitly pre-bundled. (The old esbuildOptions override is deprecated.)
  optimizeDeps: {
    include: ['pdfjs-dist'],
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
