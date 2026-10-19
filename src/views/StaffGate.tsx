import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { STAFF_PIN_MAX } from '../domain/rules';
import type { ShuttleError } from '../domain/types';
import type { StaffRole, StaffUser } from '../store/ShuttleStore';
import { useApp } from '../ui/kit';
import { AlpstayLogo } from '../ui/Logo';
import { PinPad } from '../ui/PinPad';
import { DriverView } from './DriverView';
import { ReceptionView } from './ReceptionView';

/** Ogni area dello staff ha il suo indirizzo: su quello si entra solo con il PIN di quell'area. */
export const STAFF_AREA: Record<StaffRole, { title: string; hint: string; hash: string; label: string }> = {
  reception: { title: 'Shuttle · Reception', hint: 'PIN della reception', hash: '#/reception', label: 'reception' },
  autista: { title: 'Shuttle · Autista', hint: 'PIN dell’autista', hash: '#/autista', label: 'autista' },
};

/**
 * Ingresso dello staff. Con `area` (indirizzi #/reception e #/autista) accetta solo il PIN di quell'area;
 * senza (#/staff) il PIN decide l'area.
 * Il dispositivo resta collegato finché non si blocca, si cambia il PIN o la reception lo scollega.
 */
export function StaffGate({ area, title }: { area?: StaffRole; title?: string }) {
  const { backend } = useApp();
  const [user, setUser] = useState<StaffUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [wrongArea, setWrongArea] = useState<StaffRole | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = title ?? (area ? STAFF_AREA[area].title : 'Shuttle · Staff');

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
  const inArea = !!user && (!area || user.role === area);
  if (inArea && user?.role === 'reception') return <ReceptionView onSignOut={lock} />;
  if (inArea && user?.role === 'autista') return <DriverView onSignOut={lock} />;
  // Dispositivo collegato all'altra area (es. il telefono dell'autista che apre l'indirizzo della reception).
  const otherRole = user && area && user.role !== area ? user.role : null;

  return (
    <main className="flex min-h-full flex-col items-center gap-6 bg-bg px-4 py-10">
      <div className="flex flex-col items-center gap-5 text-center">
        <AlpstayLogo variant="completo" title="AlpStay · Be free. Stay true" className="h-auto w-52 text-fg" />
        <div>
          <p className="eyebrow">Chalet Hotel Hartmann</p>
          <h1 className="flex items-center justify-center gap-2 text-3xl text-gold">
            <Lock size={22} aria-hidden /> {heading}
          </h1>
        </div>
      </div>
      {otherRole ? (
        <p className="max-w-xs rounded-xl bg-surface px-3 py-2 text-center text-sm text-muted">
          Questo dispositivo è collegato come {STAFF_AREA[otherRole].label}. Con il {area ? STAFF_AREA[area].hint : 'PIN'} passa a quest’area, oppure{' '}
          <a className="font-bold text-gold underline" href={STAFF_AREA[otherRole].hash}>
            torna all’area {STAFF_AREA[otherRole].label}
          </a>
          .
        </p>
      ) : null}
      <PinPad
        id="staff-pin"
        label="Inserisci il PIN"
        hint={area ? STAFF_AREA[area].hint : 'Reception o autista'}
        maxLength={STAFF_PIN_MAX}
        masked
        submitLabel="Entra"
        busy={busy}
        error={error}
        onSubmit={async (pin) => {
          setBusy(true);
          setError(null);
          setWrongArea(null);
          try {
            const signed = await backend.auth.signInWithPin(pin);
            if (area && signed.role !== area) {
              // PIN giusto ma dell'altra area: non si entra da qui, si indica l'indirizzo corretto.
              await backend.auth.signOut();
              setUser(null);
              setWrongArea(signed.role);
              setError(`Questo è il PIN dell’area ${STAFF_AREA[signed.role].label}: qui serve il ${STAFF_AREA[area].hint}.`);
            } else {
              setUser(signed);
            }
          } catch (e) {
            setError((e as ShuttleError).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {wrongArea ? (
        <a href={STAFF_AREA[wrongArea].hash} className="font-bold text-gold underline">
          Apri l’area {STAFF_AREA[wrongArea].label}
        </a>
      ) : null}
    </main>
  );
}
