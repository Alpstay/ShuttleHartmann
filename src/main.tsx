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

// Lo shuttle non si apre dentro pagine altrui (iframe): nessuno può nascondere i pulsanti sotto un'altra grafica.
const framed = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();

if (el && framed) {
  el.innerHTML =
    '<main style="padding:24px;font-family:Lato,system-ui,sans-serif"><h1>Shuttle Hartmann</h1><p>Per sicurezza la pagina si apre solo in una finestra a sé: <a href="https://alpstay.github.io/ShuttleHartmann/" target="_top" rel="noopener">apri lo shuttle</a>.</p></main>';
} else if (el && (!env.supabaseUrl || !env.supabaseAnonKey)) {
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
