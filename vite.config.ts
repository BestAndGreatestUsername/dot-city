import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built game works from any folder (GitHub Pages serves it
  // under /dot-city/).
  base: './',
  server: { port: 5173, strictPort: true },
});
