import React, { useCallback, useEffect, useState } from 'react';
import { Car, ConciergeBell, Mountain } from 'lucide-react';
import type { StaffRole } from './store/ShuttleStore';
import { AlpstayLogo } from './ui/Logo';
import { GuestView } from './views/GuestView';
import { STAFF_AREA, StaffGate } from './views/StaffGate';

/**
 * Indirizzi (hash, compatibili con GitHub Pages):
 *   #/ospite           area ospite: si entra con il numero di camera
 *   #/ospite/105       link del QR della camera: riconoscimento automatico
 *   #/reception        reception: solo con il PIN della reception
 *   #/autista          autista: solo con il PIN dell'autista
 *   #/staff            reception o autista: il PIN decide l'area
 * Le cartelle /ospite/, /reception/ e /autista/ del repository rimandano a questi indirizzi.
 */
type Route = { area: 'home' } | { area: 'ospite'; auto: { room: string } | null } | { area: 'staff'; role: StaffRole | null };

const TITLE: Record<'home' | 'ospite' | 'staff', string> = { home: 'Shuttle Hartmann', ospite: 'Shuttle · Ospiti', staff: 'Shuttle · Staff' };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'ospite': {
      const room = decodeURIComponent(parts[1] ?? '').trim();
      return { area: 'ospite', auto: /^[A-Za-z0-9-]{1,20}$/.test(room) ? { room } : null };
    }
    case 'reception':
    case 'autista':
      return { area: 'staff', role: parts[0] };
    case 'staff':
      return { area: 'staff', role: null };
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

  // Titolo della scheda (e dell'icona sulla schermata Home del telefono) diverso per ogni area.
  useEffect(() => {
    document.title = route.area === 'staff' && route.role ? STAFF_AREA[route.role].title : TITLE[route.area];
  }, [route]);

  const clearRoomFromUrl = useCallback(() => history.replaceState(null, '', '#/ospite'), []);

  if (route.area === 'ospite') return <GuestView autoLogin={route.auto} onAutoLoginUsed={clearRoomFromUrl} />;
  if (route.area === 'staff') return <StaffGate key={route.role ?? 'staff'} area={route.role ?? undefined} />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <AlpstayLogo variant="completo" title="AlpStay · Be free. Stay true" className="mb-2 h-auto w-44 self-center text-fg" />
      <p className="eyebrow">Chalet Hotel Hartmann</p>
      <h1 className="text-3xl text-gold">Shuttle impianti</h1>
      <a href="#/ospite" className="flex items-center gap-3 rounded-2xl border border-gold bg-gold-soft p-5 text-lg font-bold">
        <Mountain className="text-gold" /> Ospiti · Gäste · Guests
      </a>
      <a href="#/reception" className="flex items-center gap-3 rounded-2xl border border-line p-4 font-bold">
        <ConciergeBell className="text-muted" /> Reception
      </a>
      <a href="#/autista" className="flex items-center gap-3 rounded-2xl border border-line p-4 font-bold">
        <Car className="text-muted" /> Autista
      </a>
    </main>
  );
}
