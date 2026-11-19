import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Se publica en GitHub Pages bajo /contratos-web/track-limit/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../../track-limit', emptyOutDir: true },
});
