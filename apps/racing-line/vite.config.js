import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Se publica en GitHub Pages bajo /contratos-web/racing/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../../racing', emptyOutDir: true },
});
