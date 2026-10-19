/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Due build dallo stesso codice, entrambe a file unico (come WelcomeHartmann):
 *  - produzione (default): app.html → dist/app.html → index.html del repository (GitHub Pages + Supabase)
 *  - demo (--mode demo): demo.html → dist-demo/demo.html, dati di esempio in memoria;
 *    React arriva come UMD da cdnjs (vedi scripts/to-artifact.mjs).
 */
/**
 * Content-Security-Policy della pagina di produzione (GitHub Pages non permette intestazioni HTTP).
 * La pagina può parlare solo con sé stessa (presenze.json) e con il progetto Supabase; script e stili
 * restano nel file unico, i caratteri arrivano da Google Fonts. Niente form verso l'esterno, niente plugin.
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  const host = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return '';
    }
  })();
  const policy = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    `connect-src 'self'${host ? ` https://${host} wss://${host}` : ''}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'shuttle-csp',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react({ jsxRuntime: 'classic' }), tailwindcss(), viteSingleFile(), ...(isDemo ? [] : [contentSecurityPolicy(env.VITE_SUPABASE_URL ?? '')])],
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
