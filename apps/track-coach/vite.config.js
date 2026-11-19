import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Se publica en GitHub Pages bajo /contratos-web/track-coach/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../../track-coach', emptyOutDir: true },
});
