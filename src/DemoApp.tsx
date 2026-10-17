import React, { useEffect, useState } from 'react';
import { Car, ConciergeBell, FastForward, RotateCcw, Smartphone } from 'lucide-react';
import type { OffsetClock } from './domain/time';
import type { PresenceSource } from './presence/presence';
import { DEMO_GUEST_ROOM, type DemoHub } from './store/demoStore';
import { AppProvider, Button, cx } from './ui/kit';
import { AlpstayLogo } from './ui/Logo';
import { GuestView } from './views/GuestView';
import { StaffGate } from './views/StaffGate';

type Pane = 'reception' | 'ospite' | 'autista';

const PANES: { id: Pane; label: string; device: string; icon: React.ReactNode }[] = [
  { id: 'reception', label: 'Reception', device: 'PC o tablet al banco', icon: <ConciergeBell size={16} /> },
  { id: 'ospite', label: 'Ospite', device: 'telefono dell’ospite', icon: <Smartphone size={16} /> },
  { id: 'autista', label: 'Autista', device: 'telefono sul mezzo', icon: <Car size={16} /> },
];

const PUBLIC_URL = 'https://alpstay.github.io/ShuttleHartmann/';

/** Prototipo: le tre aree affiancate sugli stessi dati, ognuna come un dispositivo separato. */
export function DemoApp({ hub, clock, presence }: { hub: DemoHub; clock: OffsetClock; presence: PresenceSource }) {
  const [pane, setPane] = useState<Pane>('reception');
  const [offset, setOffset] = useState(clock.offsetMinutes);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => clock.subscribe(() => setOffset(clock.offsetMinutes)), [clock]);

  return (
    <div className="flex min-h-full flex-col bg-surface">
      <header className="border-b border-line bg-bg" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-3 py-3">
          <AlpstayLogo variant="nome" title="AlpStay" className="h-12 w-auto shrink-0 text-fg md:h-16" />
          <div className="mr-auto min-w-0">
            <p className="eyebrow">Chalet Hotel Hartmann</p>
            <h1 className="text-2xl leading-tight">
              Shuttle Hartmann <span className="text-gold">· prototipo</span>
            </h1>
            <p className="hidden max-w-[78ch] text-sm text-muted md:block">
              Dati di esempio: camere vere dell’Hartmann, ospiti e corse inventati. Ospite e autista sono pensati per il telefono. Ogni area è un dispositivo separato: con il lucchetto la blocchi e rientri con il PIN; l’ospite entra con il numero di una camera in casa (es. {DEMO_GUEST_ROOM}).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum text-sm text-muted">Orologio demo {offset ? `+${offset} min` : 'in tempo reale'}</span>
            <Button size="sm" onClick={() => clock.advance(5)} title="Sposta l’orologio avanti di 5 minuti per provare l’attesa all’impianto">
              <FastForward size={16} /> +5 min
            </Button>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => {
                clock.reset();
                hub.reset();
                setResetKey((k) => k + 1);
              }}
            >
              <RotateCcw size={16} /> Ripristina
            </Button>
          </div>
        </div>
        <nav className="mx-auto grid max-w-[1680px] grid-cols-3 gap-1 pb-3 xl:hidden" aria-label="Area">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              aria-current={pane === p.id}
              className={cx('flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold', pane === p.id ? 'bg-fg text-bg' : 'bg-surface text-muted')}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </nav>
      </header>

      <div
        className="mx-auto grid w-full max-w-[1680px] flex-1 grid-cols-1 gap-5 py-5 xl:grid-cols-[minmax(0,1fr)_390px_390px]"
        style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}
      >
        {PANES.map((p) => (
          <section key={p.id} className={cx('min-w-0 flex-col gap-2', pane === p.id ? 'flex' : 'hidden xl:flex')} aria-label={p.label}>
            <p className="hidden items-center gap-1.5 text-sm xl:flex">
              <span className="text-gold">{p.icon}</span>
              <strong>{p.label}</strong>
              <span className="text-muted">· {p.device}</span>
            </p>
            <div
              className={cx(
                'flex flex-col overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-bg shadow-sm xl:h-[min(860px,calc(100dvh-170px))]',
                p.id !== 'reception' && 'xl:rounded-[34px] xl:border-[6px] xl:border-fg/85',
              )}
            >
              <AppProvider value={{ backend: hub.device(`demo-${p.id}`), clock, presence, publicUrl: PUBLIC_URL, isDemo: true }}>
                {p.id === 'ospite' ? (
                  <GuestView key={`g${resetKey}`} sessionKey={`shuttle-demo-guest-${resetKey}`} autoLogin={{ room: DEMO_GUEST_ROOM }} />
                ) : (
                  <StaffGate key={`${p.id}${resetKey}`} title={p.id === 'reception' ? 'Reception' : 'Autista'} />
                )}
              </AppProvider>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
