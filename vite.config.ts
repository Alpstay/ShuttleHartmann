/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Due build dallo stesso codice, entrambe a file unico (come WelcomeHartmann):
 *  - produzione (default): app.html → dist/app.html → index.html del repository (GitHub Pages + Supabase)
 *  - demo (--mode demo): demo.html → dist-demo/demo.html, dati di esempio in memoria;
 *    React arriva come UMD da cdnjs (vedi scripts/to-artifact.mjs).
 */
export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  return {
    base: './',
    plugins: [react({ jsxRuntime: 'classic' }), tailwindcss(), viteSingleFile()],
    build: isDemo
      ? {
          outDir: 'dist-demo',
          emptyOutDir: true,
          rollupOptions: {
            input: 'demo.html',
            external: ['react', 'react-dom', 'react-dom/client'],
            output: {
              format: 'iife',
              globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
            },
          },
        }
      : { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: 'app.html' } },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
