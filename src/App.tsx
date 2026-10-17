import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Mountain } from 'lucide-react';
import { GuestView } from './views/GuestView';
import { StaffGate } from './views/StaffGate';

/**
 * Indirizzi (hash, compatibili con GitHub Pages):
 *   #/ospite           area ospite: si entra con il numero di camera
 *   #/ospite/105       link del QR della camera: riconoscimento automatico
 *   #/staff            reception e autista: il PIN decide l'area (anche #/reception e #/autista)
 */
type Route = { area: 'home' } | { area: 'ospite'; auto: { room: string } | null } | { area: 'staff' };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'ospite': {
      const room = decodeURIComponent(parts[1] ?? '').trim();
      return { area: 'ospite', auto: /^[A-Za-z0-9-]{1,20}$/.test(room) ? { room } : null };
    }
    case 'staff':
    case 'reception':
    case 'autista':
      return { area: 'staff' };
    default:
      return { area: 'home' };
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const clearRoomFromUrl = useCallback(() => history.replaceState(null, '', '#/ospite'), []);

  if (route.area === 'ospite') return <GuestView autoLogin={route.auto} onAutoLoginUsed={clearRoomFromUrl} />;
  if (route.area === 'staff') return <StaffGate />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <p className="eyebrow">Chalet Hotel Hartmann</p>
      <h1 className="text-3xl text-gold">Shuttle impianti</h1>
      <a href="#/ospite" className="flex items-center gap-3 rounded-2xl border border-gold bg-gold-soft p-5 text-lg font-bold">
        <Mountain className="text-gold" /> Ospiti · Gäste · Guests
      </a>
      <a href="#/staff" className="flex items-center gap-3 rounded-2xl border border-line p-4 font-bold">
        <KeyRound className="text-muted" /> Staff · reception e autista
      </a>
    </main>
  );
}
