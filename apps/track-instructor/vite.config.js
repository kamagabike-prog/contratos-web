import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Se publica en GitHub Pages bajo /contratos-web/track-instructor/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../../track-instructor', emptyOutDir: true },
});
