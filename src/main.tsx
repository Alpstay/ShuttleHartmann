import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { readEnv } from './config';
import { systemClock } from './domain/time';
import { FEED_FILE } from './feed/presenzeFeed';
import { FeedPresenceSource } from './presence/presence';
import { createSupabaseBackend } from './store/supabaseStore';
import { AppProvider } from './ui/kit';

const env = readEnv();
const el = document.getElementById('root');

if (el && (!env.supabaseUrl || !env.supabaseAnonKey)) {
  el.innerHTML =
    '<main style="padding:24px;font-family:Lato,system-ui,sans-serif"><h1>Configurazione mancante</h1><p>Imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env e ricostruisci (npm run build).</p></main>';
} else if (el) {
  const backend = createSupabaseBackend(env.supabaseUrl, env.supabaseAnonKey);
  // presenze.json sta accanto alla pagina: lo pubblica l'attività pianificata (tools/AGGIORNA.md).
  const presence = new FeedPresenceSource(FEED_FILE);
  createRoot(el).render(
    <AppProvider value={{ backend, clock: systemClock, presence, publicUrl: env.publicUrl, isDemo: false }}>
      <App />
    </AppProvider>,
  );
}
