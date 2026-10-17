import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import type { ShuttleError } from '../domain/types';
import type { StaffUser } from '../store/ShuttleStore';
import { useApp } from '../ui/kit';
import { AlpstayLogo } from '../ui/Logo';
import { PinPad } from '../ui/PinPad';
import { DriverView } from './DriverView';
import { ReceptionView } from './ReceptionView';

/**
 * Ingresso dello staff: il PIN decide l'area (reception o autista).
 * Il dispositivo resta collegato finché non si blocca, si cambia il PIN o la reception lo scollega.
 */
export function StaffGate({ title = 'Shuttle · Staff' }: { title?: string }) {
  const { backend } = useApp();
  const [user, setUser] = useState<StaffUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      setUser(await backend.auth.current());
    } catch {
      /* rete assente: si resta nello stato attuale */
    }
  }, [backend]);

  // Ricontrollo periodico: se la reception cambia il PIN o scollega il dispositivo, si torna al tastierino.
  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), backend.guestPollMs < 5000 ? 2000 : 60000);
    const onVis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [backend, check]);

  const lock = useCallback(async () => {
    await backend.auth.signOut();
    setUser(null);
  }, [backend]);

  if (user === undefined) return <div className="p-6 text-muted">Caricamento…</div>;
  if (user?.role === 'reception') return <ReceptionView onSignOut={lock} />;
  if (user?.role === 'autista') return <DriverView onSignOut={lock} />;

  return (
    <main className="flex min-h-full flex-col items-center gap-6 bg-bg px-4 py-10">
      <div className="flex flex-col items-center gap-5 text-center">
        <AlpstayLogo variant="completo" title="AlpStay · Be free. Stay true" className="h-auto w-52 text-fg" />
        <div>
          <p className="eyebrow">Chalet Hotel Hartmann</p>
          <h1 className="flex items-center justify-center gap-2 text-3xl text-gold">
            <Lock size={22} aria-hidden /> {title}
          </h1>
        </div>
      </div>
      <PinPad
        id="staff-pin"
        label="Inserisci il PIN"
        hint="Reception o autista"
        length={4}
        masked
        submitLabel="Entra"
        busy={busy}
        error={error}
        onSubmit={async (pin) => {
          setBusy(true);
          setError(null);
          try {
            setUser(await backend.auth.signInWithPin(pin));
          } catch (e) {
            setError((e as ShuttleError).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </main>
  );
}
