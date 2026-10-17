import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BellRing, Check, ChevronDown, Clock, Lock, MapPin, Navigation, Play, Sun, TrafficCone, UserX, Users, Volume2 } from 'lucide-react';
import { DEPART_ALERT_MINUTES, DRIVER_MESSAGE_LABEL, STATUS_LABEL, compareRides, departLabel, departState, isOpen, pickupPlace, waitState } from '../domain/rules';
import { addDays, romeDate, romeTimeOf } from '../domain/time';
import type { DriverMessageKind, Ride, ShuttleSettings } from '../domain/types';
import { Button, Countdown, InlineConfirm, Pill, STATUS_TONE, chime, cx, unlockSound, useApp, useNow, useToast, useWakeLock, vibrate } from '../ui/kit';
import { AlpstayLogo } from '../ui/Logo';

interface Alert {
  id: string;
  rideId: string;
  text: string;
  tone: 'nuova' | 'annullata' | 'partenza';
}

const ALERT_STYLE: Record<Alert['tone'], string> = {
  nuova: 'bg-gold text-on-gold',
  annullata: 'bg-bad text-bg',
  partenza: 'bg-warn text-bg',
};

const ALERT_PREFIX: Record<Alert['tone'], string> = {
  nuova: 'Nuova corsa: ',
  annullata: '',
  partenza: 'Parti ora: ',
};

/**
 * Area autista, pensata per il telefono sul mezzo: una corsa alla volta a tutto schermo con le sole
 * azioni del momento, le successive in un elenco compatto. Si inizia il turno con un tocco
 * (attiva il suono degli avvisi e tiene lo schermo acceso).
 */
export function DriverView({ onSignOut }: { onSignOut?: () => void }) {
  const { backend } = useApp();
  const staff = backend.staff;
  const now = useNow(1000);
  const today = romeDate(now);
  const tomorrow = addDays(today, 1);
  const [started, setStarted] = useState(false);
  const [todayRides, setTodayRides] = useState<Ride[]>([]);
  const [tomorrowRides, setTomorrowRides] = useState<Ride[]>([]);
  const [settings, setSettings] = useState<ShuttleSettings | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [toast, showToast] = useToast();
  const wakeActive = useWakeLock(started);
  const soundOn = useRef(false);

  // Regole del servizio (es. attesa massima) ricaricate ogni minuto: le modifiche della reception arrivano da sole.
  useEffect(() => {
    const load = () => staff.getSettings().then(setSettings, (e: Error) => showToast(e.message, 'bad'));
    void load();
    const id = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(id);
  }, [staff, showToast]);

  // Oggi e domani insieme: una corsa nuova va segnalata anche se è per domani mattina.
  useEffect(() => {
    const seen = new Map<string, Ride['status']>();
    let first = true;
    let a: Ride[] | null = null;
    let b: Ride[] | null = null;
    const handle = () => {
      if (!a || !b) return;
      const list = [...a, ...b];
      if (!first) {
        const fresh: Alert[] = [];
        for (const r of list) {
          const prev = seen.get(r.id);
          const when = r.serviceDate === today ? '' : 'domani ';
          const where = r.direction === 'andata' ? `Hotel → ${r.destinationName}` : `${r.destinationName} → Hotel`;
          if (prev === undefined && r.status === 'richiesta') fresh.push({ id: r.id, rideId: r.id, tone: 'nuova', text: `${when}${r.time} · camera ${r.room} · ${where}` });
          if (prev && prev !== 'annullata' && r.status === 'annullata') {
            const who = r.cancelledBy === 'ospite' ? 'Cancellata dall’ospite' : 'Annullata dalla reception';
            fresh.push({ id: `${r.id}-x`, rideId: r.id, tone: 'annullata', text: `${who}: ${when}${r.time} · camera ${r.room} · ${where}` });
          }
        }
        if (fresh.length) {
          setAlerts((x) => [...fresh, ...x].slice(0, 3));
          // Una cancellazione suona come allarme: l'autista potrebbe essere già in viaggio.
          if (soundOn.current) chime(fresh.some((f) => f.tone === 'annullata') ? 'allarme' : 'nuova');
          else vibrate(fresh.some((f) => f.tone === 'annullata') ? [200, 100, 200, 100, 200] : undefined);
        }
      }
      list.forEach((r) => seen.set(r.id, r.status));
      first = false;
    };
    const offA = staff.watchRides(today, (l) => ((a = l), setTodayRides(l), handle()), (e) => showToast(e.message, 'bad'));
    const offB = staff.watchRides(tomorrow, (l) => ((b = l), setTomorrowRides(l), handle()), (e) => showToast(e.message, 'bad'));
    return () => {
      offA();
      offB();
    };
  }, [staff, today, tomorrow, showToast]);

  const open = useMemo(
    () =>
      todayRides
        .filter((r) => isOpen(r.status))
        // Prima la corsa in cui l'autista è già sul posto, poi in ordine di orario.
        .sort((x, y) => Number(y.status === 'sul_posto') - Number(x.status === 'sul_posto') || compareRides(x, y)),
    [todayRides],
  );
  const done = todayRides.filter((r) => !isOpen(r.status)).sort((x, y) => compareRides(y, x));
  const tomorrowOpen = tomorrowRides.filter((r) => isOpen(r.status)).sort(compareRides);
  // Avviso di partenza: 7 minuti prima dell'orario, una sola volta per corsa (e di nuovo se l'orario cambia).
  const departAlerted = useRef(new Set<string>());
  useEffect(() => {
    if (!started) return;
    const fresh: Alert[] = [];
    for (const r of open) {
      const key = `${r.id}@${r.serviceDate}T${r.time}`;
      if (departAlerted.current.has(key) || !departState(r, now)) continue;
      departAlerted.current.add(key);
      fresh.push({ id: `${key}-via`, rideId: r.id, tone: 'partenza', text: `${r.time} · camera ${r.room} · pick-up ${pickupPlace(r)}` });
    }
    if (!fresh.length) return;
    setAlerts((x) => [...fresh, ...x.filter((a) => !fresh.some((f) => f.id === a.id))].slice(0, 3));
    if (soundOn.current) chime('partenza');
    else vibrate([300, 120, 300, 120, 300]);
  }, [started, open, now]);

  const focus = open.find((r) => r.id === focusId) ?? open[0] ?? null;
  const rest = open.filter((r) => r.id !== focus?.id);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) showToast(ok);
    } catch (e) {
      showToast((e as Error).message, 'bad');
    }
  };

  if (!settings) return <div className="p-6 text-muted">Caricamento…</div>;

  if (!started) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-6 bg-bg px-6 py-10 text-center">
        <AlpstayLogo variant="completo" title="AlpStay · Be free. Stay true" className="h-auto w-44 text-fg" />
        <div>
          <p className="eyebrow">Shuttle Hartmann</p>
          <h1 className="text-3xl">Autista</h1>
        </div>
        <p className="tnum text-lg">
          Oggi <strong>{open.length}</strong> {open.length === 1 ? 'corsa da fare' : 'corse da fare'}
        </p>
        <Button
          tone="gold"
          size="xl"
          className="w-full max-w-xs"
          onClick={() => {
            soundOn.current = unlockSound();
            if (soundOn.current) chime('nuova');
            setStarted(true);
          }}
        >
          <Play size={22} /> Inizia il turno
        </Button>
        <p className="max-w-xs text-sm text-muted">
          Attiva il suono degli avvisi e tiene lo schermo acceso. {DEPART_ALERT_MINUTES} minuti prima di ogni corsa suona «Parti ora» e il luogo del pick-up lampeggia. Tieni la pagina aperta durante il turno.
        </p>
        {onSignOut ? (
          <Button size="sm" tone="ghost" onClick={onSignOut}>
            <Lock size={16} /> Blocca
          </Button>
        ) : null}
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg px-4 py-2.5">
        <AlpstayLogo variant="simbolo" className="h-7 w-auto shrink-0" />
        <h1 className="mr-auto text-xl">Autista</h1>
        <span className="flex items-center gap-1.5 text-muted" aria-label={`Suono ${soundOn.current ? 'attivo' : 'non disponibile'}, schermo ${wakeActive ? 'sempre acceso' : 'normale'}`}>
          <Volume2 size={16} className={soundOn.current ? 'text-ok' : ''} aria-hidden />
          <Sun size={16} className={wakeActive ? 'text-ok' : ''} aria-hidden />
        </span>
        {onSignOut ? (
          <Button size="sm" tone="ghost" aria-label="Blocca" title="Blocca (serve il PIN per rientrare)" onClick={onSignOut}>
            <Lock size={16} />
          </Button>
        ) : null}
      </header>

      {toast}

      {alerts.length ? (
        <div className="flex flex-col gap-2 px-4 pt-3" aria-live="assertive">
          {alerts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAlerts((l) => l.filter((x) => x.id !== a.id));
                if (a.tone !== 'annullata') setFocusId(a.rideId);
              }}
              className={cx('slide-in flex items-center gap-2 rounded-xl p-3 text-left text-sm font-bold', ALERT_STYLE[a.tone])}
            >
              {a.tone === 'partenza' ? <Navigation size={18} aria-hidden /> : <BellRing size={18} aria-hidden />}
              <span className="mr-auto">
                {ALERT_PREFIX[a.tone]}
                {a.text}
              </span>
              <span className="text-xs underline">OK</span>
            </button>
          ))}
        </div>
      ) : null}

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {focus ? (
          <FocusRide key={focus.id} ride={focus} settings={settings} now={now} act={act} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-12 text-center">
            <Check size={32} className="text-ok" aria-hidden />
            <p className="text-lg font-bold">Nessuna corsa da fare</p>
            <p className="text-sm text-muted">Le nuove richieste arrivano qui con un avviso.</p>
          </div>
        )}

        {rest.length ? (
          <section aria-labelledby="poi" className="flex flex-col gap-2">
            <h2 id="poi" className="eyebrow">
              Poi · {rest.length}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
              {rest.map((r) => (
                <li key={r.id}>
                  <RideLine ride={r} now={now} onClick={() => setFocusId(r.id)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tomorrowOpen.length ? (
          <Collapsible label={`Domani · ${tomorrowOpen.length}`} open={showTomorrow} onToggle={() => setShowTomorrow(!showTomorrow)}>
            {tomorrowOpen.map((r) => (
              <li key={r.id}>
                <RideLine ride={r} />
              </li>
            ))}
          </Collapsible>
        ) : null}

        {done.length ? (
          <Collapsible label={`Chiuse oggi · ${done.length}`} open={showDone} onToggle={() => setShowDone(!showDone)}>
            {done.map((r) => (
              <li key={r.id}>
                <RideLine ride={r} />
              </li>
            ))}
          </Collapsible>
        ) : null}
      </main>
    </div>
  );
}

function Collapsible({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="eyebrow flex min-h-9 items-center gap-1 self-start">
        {label} <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">{children}</ul> : null}
    </section>
  );
}

function RideLine({ ride: r, now, onClick }: { ride: Ride; now?: number; onClick?: () => void }) {
  const depart = now === undefined ? null : departState(r, now);
  const content = (
    <>
      <span className="tnum w-14 font-title text-xl">{r.time}</span>
      <span className="tnum w-11 font-title text-xl">{r.room}</span>
      {depart ? (
        <span className="blink-place flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-sm font-bold" aria-label={`Parti ora: pick-up ${pickupPlace(r)}`}>
          <Navigation size={13} className="shrink-0" aria-hidden />
          <span className="truncate">{pickupPlace(r)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{r.direction === 'andata' ? `→ ${r.destinationName}` : `${r.destinationName} →`}</span>
      )}
      <span className="inline-flex items-center gap-0.5 text-sm text-muted">
        <Users size={13} aria-hidden />
        {r.persons}
      </span>
      <Pill className={STATUS_TONE[r.status]}>{r.status === 'richiesta' ? 'Nuova' : STATUS_LABEL[r.status]}</Pill>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-2 px-3 text-left">
      {content}
    </button>
  ) : (
    <div className="flex min-h-14 items-center gap-2 px-3">{content}</div>
  );
}

/** Testo dei pulsanti: dice all'autista che cosa succede, cioè che l'ospite riceve l'avviso. */
const DRIVER_ACTION_LABEL: Record<DriverMessageKind, string> = {
  arrivato: 'Avvisa l’ospite che sei arrivato',
  sette_minuti: 'Avvisa l’ospite: arrivo fra 7 minuti',
  traffico: 'Avvisa l’ospite: c’è traffico',
};

const MESSAGE_ICON: Record<DriverMessageKind, React.ReactNode> = {
  arrivato: <MapPin size={22} />,
  sette_minuti: <Clock size={22} />,
  traffico: <TrafficCone size={22} />,
};

function FocusRide({ ride: r, settings, now, act }: { ride: Ride; settings: ShuttleSettings; now: number; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const { backend } = useApp();
  const staff = backend.staff;
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  const wait = waitState(r, settings, now);
  const depart = departState(r, now);
  const unread = r.status === 'richiesta';
  const arrived = r.status === 'sul_posto';
  const from = pickupPlace(r);
  const to = r.direction === 'andata' ? r.destinationName : 'Hotel';

  return (
    <article className={cx('flex flex-col gap-4 rounded-2xl border-2 p-4', unread ? 'pulse border-gold' : depart ? 'border-warn' : 'border-fg/70')} aria-label={`Corsa delle ${r.time}, camera ${r.room}`}>
      <div className="flex items-start">
        <div>
          <p className="eyebrow">{unread ? 'Nuova · conferma la lettura' : arrived ? 'Sul posto' : depart ? 'Parti ora' : 'Adesso'}</p>
          <p className="tnum font-title text-6xl leading-none">{r.time}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="eyebrow">Camera</p>
          <p className="tnum font-title text-5xl leading-none">{r.room}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-lg font-bold">
            <Users size={18} aria-hidden /> {r.persons}
          </p>
        </div>
      </div>

      {depart ? (
        // Da 7 minuti prima dell'orario: il luogo del pick-up lampeggia finché l'autista non è sul posto.
        <p className="blink-place flex items-center gap-2 rounded-xl px-3 py-2.5 font-bold" role="status" aria-label={`Parti ora: pick-up ${from} ${departLabel(depart.minutesLeft)}`}>
          <Navigation size={22} className="shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-wider">Parti ora · pick-up</span>
            <span className="block truncate font-title text-2xl leading-tight">{from}</span>
          </span>
          <span className="tnum ml-auto shrink-0 text-right text-base">{departLabel(depart.minutesLeft)}</span>
        </p>
      ) : null}

      <p className="flex items-center gap-2 text-2xl font-bold leading-tight">
        {r.direction === 'andata' ? <ArrowUpRight size={26} className="shrink-0 text-gold" aria-hidden /> : <ArrowDownLeft size={26} className="shrink-0 text-gold" aria-hidden />}
        <span>
          {from} → {to}
        </span>
      </p>
      {r.note ? <p className="rounded-xl bg-surface px-3 py-2 italic">“{r.note}”</p> : null}
      {r.lastMessage ? (
        <p className="text-sm text-muted">
          Ospite avvisato alle <span className="tnum">{romeTimeOf(r.lastMessageAt)}</span>: «{DRIVER_MESSAGE_LABEL[r.lastMessage]}»
        </p>
      ) : null}

      {!arrived ? (
        // Prima dell'arrivo: i tre messaggi per l'ospite (il primo vale come conferma di lettura).
        <div className="flex flex-col gap-2">
          {(['arrivato', 'sette_minuti', 'traffico'] as DriverMessageKind[]).map((k, i) => (
            <Button
              key={k}
              size="xl"
              tone={i === 0 ? 'dark' : r.lastMessage === k ? 'gold' : 'soft'}
              className="justify-start"
              onClick={() => act(() => staff.driverMessage(r.id, k), unread ? 'Lettura confermata, ospite avvisato.' : 'Ospite avvisato.')}
            >
              {MESSAGE_ICON[k]} <span className="text-left leading-snug">{DRIVER_ACTION_LABEL[k]}</span>
            </Button>
          ))}
        </div>
      ) : (
        // Sul posto: attesa, poi «Fatto!» alla consegna; dopo l'attesa massima, «non presentato».
        <div className="flex flex-col gap-3">
          {wait ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-gold-soft p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-bold">{wait.expired ? 'Attesa massima trascorsa' : 'Attesa'}</span>
                <span className="tnum font-title text-4xl">{wait.expired ? `${settings.waitMinutes}:00` : <Countdown ms={wait.remainingMs} />}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-bg" aria-hidden>
                <div className="h-full bg-gold transition-[width] duration-1000" style={{ width: `${100 - (wait.remainingMs / (settings.waitMinutes * 60000)) * 100}%` }} />
              </div>
            </div>
          ) : null}
          <Button tone="ok" size="xl" className="min-h-20 text-2xl" onClick={() => act(() => staff.driverDone(r.id), 'Corsa completata.')}>
            <Check size={30} strokeWidth={3} /> Fatto!
          </Button>
          {wait?.expired ? (
            confirmNoShow ? (
              <InlineConfirm
                question={`Camera ${r.room} non presentata: ripartire?`}
                confirmLabel="Sì, riparto"
                cancelLabel="Aspetto ancora"
                onCancel={() => setConfirmNoShow(false)}
                onConfirm={() => {
                  setConfirmNoShow(false);
                  void act(() => staff.driverNoShow(r.id), 'Segnalato alla reception: ospite non presentato.');
                }}
              />
            ) : (
              <Button tone="bad" size="lg" onClick={() => setConfirmNoShow(true)}>
                <UserX size={20} /> Ospite non presentato · riparto
              </Button>
            )
          ) : (
            <p className="text-center text-sm text-muted">Dopo {settings.waitMinutes} minuti potrai segnalare l’ospite come non presentato.</p>
          )}
        </div>
      )}
    </article>
  );
}
