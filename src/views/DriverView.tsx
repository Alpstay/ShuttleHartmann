import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, BellRing, Check, ChevronDown, Clock, Lock, MapPin, Navigation, Play, Sun, TrafficCone, UserX, Users, Volume2 } from 'lucide-react';
import {
  DEPART_ALERT_MINUTES,
  DRIVER_MESSAGE_LABEL,
  HOTEL_PICKUP,
  compareRides,
  departLabel,
  departState,
  groupTrips,
  isOpen,
  rideConflicts,
  waitState,
  type Trip,
} from '../domain/rules';
import { addDays, romeDate, romeTimeOf } from '../domain/time';
import type { DriverMessageKind, Ride, RideStatus, ShuttleSettings } from '../domain/types';
import { destinationColor } from '../ui/destinations';
import { Countdown, chime, cx, unlockSound, useApp, useNow, useToast, useWakeLock, vibrate } from '../ui/kit';
import { AlpstayLogo } from '../ui/Logo';

interface Alert {
  id: string;
  /** Viaggio da aprire toccando l'avviso. */
  tripKey: string | null;
  text: string;
  tone: 'nuova' | 'annullata' | 'partenza';
}

const ALERT_STYLE: Record<Alert['tone'], string> = {
  nuova: 'bg-[#f2c94c] text-[var(--d-ink)]',
  annullata: 'bg-[var(--d-bad)] text-[var(--d-cream)]',
  partenza: 'bg-[var(--d-warn)] text-[var(--d-ink)]',
};

const ALERT_PREFIX: Record<Alert['tone'], string> = {
  nuova: 'Nuova corsa: ',
  annullata: '',
  partenza: 'Parti ora: ',
};

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/** Punto di ritiro, punti di arrivo e camere di un viaggio, in parole semplici. */
const pickupOf = (t: Trip): string => (t.pickup === HOTEL_PICKUP ? 'Hotel' : (t.rides[0]?.destinationName ?? t.pickup));
const dropsOf = (t: Trip): { id: string; name: string }[] =>
  t.direction === 'ritorno'
    ? [{ id: HOTEL_PICKUP, name: 'Hotel' }]
    : [...new Map(t.rides.map((r) => [r.destinationId, { id: r.destinationId, name: r.destinationName }])).values()];
const roomsOf = (t: Trip): string => t.rides.map((r) => r.room).join(' · ');
/** «105», «105 e 107», «105, 107 e 108»: le camere come si direbbero a voce. */
const roomsSpoken = (t: Trip): string => {
  const rooms = t.rides.map((r) => r.room);
  return rooms.length < 2 ? (rooms[0] ?? '') : `${rooms.slice(0, -1).join(', ')} e ${rooms[rooms.length - 1]}`;
};

/**
 * Area autista, pensata per il telefono sul mezzo: un viaggio alla volta, grande e colorato, con le sole
 * azioni del momento. Le camere con lo stesso orario e lo stesso punto di ritiro formano un unico viaggio
 * (un tocco avvisa tutti). Due viaggi troppo vicini in posti diversi vengono segnalati.
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
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [toast, showToast] = useToast();
  const wakeActive = useWakeLock(started);
  const soundOn = useRef(false);

  // Regole del servizio (attesa, tempo tra viaggi…) ricaricate ogni minuto: le modifiche della reception arrivano da sole.
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
          const key = `${r.serviceDate}|${r.time}|${r.direction === 'andata' ? HOTEL_PICKUP : r.destinationId}`;
          if (prev === undefined && r.status === 'richiesta') fresh.push({ id: r.id, tripKey: key, tone: 'nuova', text: `${when}${r.time} · camera ${r.room} · ${where}` });
          if (prev && prev !== 'annullata' && r.status === 'annullata') {
            const who = r.cancelledBy === 'ospite' ? 'Cancellata dall’ospite' : 'Annullata dalla reception';
            fresh.push({ id: `${r.id}-x`, tripKey: null, tone: 'annullata', text: `${who}: ${when}${r.time} · camera ${r.room} · ${where}` });
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

  // Viaggi di oggi ancora da fare: prima quello in cui l'autista è già sul posto, poi per orario.
  const trips = useMemo(
    () =>
      groupTrips(todayRides.filter((r) => isOpen(r.status))).sort(
        (x, y) =>
          Number(y.rides.some((r) => r.status === 'sul_posto')) - Number(x.rides.some((r) => r.status === 'sul_posto')) ||
          x.time.localeCompare(y.time) ||
          x.direction.localeCompare(y.direction),
      ),
    [todayRides],
  );
  const conflicts = useMemo(() => (settings ? rideConflicts(todayRides, settings) : new Map<string, Ride[]>()), [todayRides, settings]);
  const clashOf = (t: Trip): Ride[] => {
    const inTrip = new Set(t.rides.map((r) => r.id));
    const others = t.rides.flatMap((r) => conflicts.get(r.id) ?? []).filter((o) => !inTrip.has(o.id));
    return [...new Map(others.map((o) => [o.id, o])).values()].sort(compareRides);
  };
  const done = todayRides.filter((r) => !isOpen(r.status)).sort((x, y) => compareRides(y, x));
  const tomorrowTrips = groupTrips(tomorrowRides.filter((r) => isOpen(r.status)));
  const focus = trips.find((t) => t.key === focusKey) ?? trips[0] ?? null;
  const rest = trips.filter((t) => t.key !== focus?.key);

  // «Parti ora»: 7 minuti prima dell'orario, una sola volta per viaggio (e di nuovo se l'orario cambia).
  const departAlerted = useRef(new Set<string>());
  useEffect(() => {
    if (!started) return;
    const fresh: Alert[] = [];
    for (const t of trips) {
      if (departAlerted.current.has(t.key) || !t.rides.some((r) => departState(r, now))) continue;
      departAlerted.current.add(t.key);
      fresh.push({ id: `${t.key}-via`, tripKey: t.key, tone: 'partenza', text: `${t.time} · ${t.rides.length > 1 ? 'camere' : 'camera'} ${roomsOf(t)} · pick-up ${pickupOf(t)}` });
    }
    if (!fresh.length) return;
    setAlerts((x) => [...fresh, ...x.filter((a) => !fresh.some((f) => f.id === a.id))].slice(0, 3));
    if (soundOn.current) chime('partenza');
    else vibrate([300, 120, 300, 120, 300]);
  }, [started, trips, now]);

  const act: Act = async (fn, ok) => {
    try {
      await fn();
      if (ok) showToast(ok);
    } catch (e) {
      showToast((e as Error).message, 'bad');
    }
  };

  if (!settings) return <div className="driver-theme min-h-full p-6 text-[var(--d-on-bg-soft)]">Caricamento…</div>;

  if (!started) {
    const rooms = trips.reduce((n, t) => n + t.rides.length, 0);
    return (
      <main className="driver-theme flex min-h-full flex-col items-center justify-center gap-7 px-6 py-10 text-center">
        <AlpstayLogo variant="completo" title="AlpStay · Be free. Stay true" className="h-auto w-44 text-[var(--d-cream)]" />
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--d-on-bg-soft)]">Shuttle Hartmann</p>
          <h1 className="font-text text-5xl font-black tracking-tight">Autista</h1>
        </div>
        <p className="tnum text-xl">
          Oggi <strong className="font-black">{trips.length}</strong> {trips.length === 1 ? 'viaggio' : 'viaggi'} · <strong className="font-black">{rooms}</strong> {rooms === 1 ? 'camera' : 'camere'}
        </p>
        <button
          type="button"
          onClick={() => {
            soundOn.current = unlockSound();
            if (soundOn.current) chime('nuova');
            setStarted(true);
          }}
          className="flex min-h-20 w-full max-w-xs items-center justify-center gap-3 rounded-full bg-[var(--d-cream)] text-2xl font-black text-[var(--d-bg)] shadow-lg active:scale-[0.98]"
        >
          <Play size={26} fill="currentColor" /> Inizia il turno
        </button>
        <p className="max-w-xs text-sm text-[var(--d-on-bg-soft)]">
          Attiva il suono degli avvisi e tiene lo schermo acceso. {DEPART_ALERT_MINUTES} minuti prima di ogni corsa suona «Parti ora» e il luogo del pick-up lampeggia. Tieni la pagina aperta durante il turno.
        </p>
        {onSignOut ? (
          <button type="button" onClick={onSignOut} className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-bold text-[var(--d-on-bg-soft)]">
            <Lock size={16} /> Blocca
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <div className="driver-theme flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-[var(--d-bg-2)] px-4 py-2.5">
        <AlpstayLogo variant="simbolo" className="h-7 w-auto shrink-0" />
        <h1 className="mr-auto font-text text-xl font-black uppercase tracking-[0.12em]">Autista</h1>
        <span className="flex items-center gap-1.5" aria-label={`Suono ${soundOn.current ? 'attivo' : 'non disponibile'}, schermo ${wakeActive ? 'sempre acceso' : 'normale'}`}>
          <Volume2 size={18} className={soundOn.current ? 'text-[#7ee0a9]' : 'text-[var(--d-on-bg-soft)]'} aria-hidden />
          <Sun size={18} className={wakeActive ? 'text-[#7ee0a9]' : 'text-[var(--d-on-bg-soft)]'} aria-hidden />
        </span>
        {onSignOut ? (
          <button type="button" aria-label="Blocca" title="Blocca (serve il PIN per rientrare)" onClick={onSignOut} className="flex size-11 items-center justify-center rounded-full text-[var(--d-cream)] active:bg-white/10">
            <Lock size={18} />
          </button>
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
                if (a.tripKey) setFocusKey(a.tripKey);
              }}
              className={cx('slide-in flex items-center gap-2 rounded-2xl p-3.5 text-left text-base font-black shadow-md', ALERT_STYLE[a.tone])}
            >
              {a.tone === 'partenza' ? <Navigation size={20} aria-hidden /> : <BellRing size={20} aria-hidden />}
              <span className="mr-auto leading-snug">
                {ALERT_PREFIX[a.tone]}
                {a.text}
              </span>
              <span className="rounded-full bg-black/10 px-2.5 py-1 text-xs">OK</span>
            </button>
          ))}
        </div>
      ) : null}

      <main className="flex flex-1 flex-col gap-5 px-4 py-4">
        {focus ? (
          <TripCard key={focus.key} trip={focus} clash={clashOf(focus)} settings={settings} now={now} act={act} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-[28px] bg-[var(--d-card)] px-4 py-12 text-center text-[var(--d-ink)]">
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--d-ok)] text-[var(--d-cream)]">
              <Check size={30} strokeWidth={3} aria-hidden />
            </span>
            <p className="text-2xl font-black">Nessuna corsa da fare</p>
            <p className="text-[var(--d-ink-soft)]">Le nuove richieste arrivano qui con un avviso.</p>
          </div>
        )}

        {rest.length ? (
          <section aria-labelledby="poi" className="flex flex-col gap-2">
            <h2 id="poi" className="font-text text-xs font-black uppercase tracking-[0.2em] text-[var(--d-on-bg-soft)]">
              Poi · {rest.length}
            </h2>
            <ul className="flex flex-col gap-2">
              {rest.map((t) => (
                <li key={t.key}>
                  <TripLine trip={t} settings={settings} now={now} clash={clashOf(t).length > 0} onClick={() => setFocusKey(t.key)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tomorrowTrips.length ? (
          <Collapsible label={`Domani · ${tomorrowTrips.length}`} open={showTomorrow} onToggle={() => setShowTomorrow(!showTomorrow)}>
            {tomorrowTrips.map((t) => (
              <li key={t.key}>
                <TripLine trip={t} settings={settings} />
              </li>
            ))}
          </Collapsible>
        ) : null}

        {done.length ? (
          <Collapsible label={`Chiuse oggi · ${done.length}`} open={showDone} onToggle={() => setShowDone(!showDone)}>
            {done.map((r) => (
              <li key={r.id} className="flex min-h-14 items-center gap-3 rounded-2xl bg-[var(--d-card)] px-3 text-[var(--d-ink)]">
                <span className="tnum w-16 text-xl font-black">{r.time}</span>
                <span className="tnum flex h-9 min-w-12 items-center justify-center rounded-lg bg-[var(--d-ink)] px-2 font-black text-[var(--d-cream)]">{r.room}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.direction === 'andata' ? `→ ${r.destinationName}` : `${r.destinationName} →`}</span>
                <StatusChip status={r.status} />
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
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 items-center gap-1.5 self-start text-xs font-black uppercase tracking-[0.2em] text-[var(--d-on-bg-soft)]">
        {label} <ChevronDown size={16} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? <ul className="flex flex-col gap-2">{children}</ul> : null}
    </section>
  );
}

/** Etichetta colorata del punto: un colore per impianto, l'hotel in oro. */
function PlacePill({ id, name, settings, size = 'md', className }: { id: string; name: string; settings: ShuttleSettings | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={cx(
        // I nomi lunghi (es. «Col Raiser (Gardena Ronda/Saslong)») vanno a capo invece di essere tagliati.
        'inline-flex max-w-full items-center gap-1.5 rounded-[1.25rem] font-black leading-tight text-white',
        size === 'sm' && 'min-h-8 px-3 py-1 text-sm',
        size === 'md' && 'min-h-10 px-4 py-1.5 text-base',
        size === 'lg' && 'min-h-12 px-5 py-2 text-xl',
        className,
      )}
      style={{ backgroundColor: destinationColor(id, settings) }}
    >
      <MapPin size={size === 'lg' ? 20 : 16} className="shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{name}</span>
    </span>
  );
}

const CHIP: Record<RideStatus, { label: string; cls: string }> = {
  richiesta: { label: 'Nuova', cls: 'bg-[#f2c94c] text-[var(--d-ink)]' },
  // Dopo «arrivo fra 7 minuti» o «c'è traffico» l'autista è in viaggio verso il ritiro.
  confermata: { label: 'Sto andando', cls: 'bg-[#d2efe3] text-[#0c5a45]' },
  sul_posto: { label: 'Sul posto', cls: 'bg-[var(--d-warn)] text-[var(--d-ink)]' },
  completata: { label: 'Fatto', cls: 'bg-[var(--d-ok)] text-white' },
  no_show: { label: 'Non presentato', cls: 'bg-[var(--d-bad)] text-white' },
  annullata: { label: 'Annullata', cls: 'bg-[var(--d-card-2)] text-[var(--d-ink-soft)] line-through' },
};

function StatusChip({ status }: { status: RideStatus }) {
  const c = CHIP[status];
  return <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wide', c.cls)}>{c.label}</span>;
}

function TripLine({ trip: t, settings, now, clash, onClick }: { trip: Trip; settings: ShuttleSettings | null; now?: number; clash?: boolean; onClick?: () => void }) {
  const depart = now === undefined ? null : (t.rides.map((r) => departState(r, now)).find(Boolean) ?? null);
  const unread = t.rides.some((r) => r.status === 'richiesta');
  const content = (
    <>
      <span className="tnum w-16 shrink-0 text-2xl font-black">{t.time}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {depart ? (
          <span className="blink-place inline-flex min-h-8 max-w-full items-center gap-1 self-start rounded-[1.25rem] px-3 py-1 text-sm font-black leading-tight" aria-label={`Parti ora: pick-up ${pickupOf(t)}`}>
            <Navigation size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{pickupOf(t)}</span>
          </span>
        ) : (
          <PlacePill id={t.pickup} name={pickupOf(t)} settings={settings} size="sm" className="self-start" />
        )}
        <span className="text-sm font-bold text-[var(--d-ink-soft)]">
          {t.rides.length > 1 ? 'Camere' : 'Camera'} {roomsOf(t)} · <Users size={13} className="inline" aria-hidden /> {t.persons}
        </span>
      </span>
      {clash || unread ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {unread ? <StatusChip status="richiesta" /> : null}
          {clash ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--d-warn)] px-2 py-0.5 text-xs font-black uppercase" aria-label="Conflitto di orario">
              <AlertTriangle size={13} aria-hidden /> Conflitto
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
  const cls = 'flex min-h-16 w-full items-center gap-3 rounded-2xl bg-[var(--d-card)] px-3 py-2 text-left text-[var(--d-ink)]';
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'active:scale-[0.99]')}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/** Testo dei pulsanti: dice all'autista che cosa succede, cioè che l'ospite riceve l'avviso. */
const ACTION_LABEL: Record<DriverMessageKind, [one: string, many: string]> = {
  arrivato: ['Avvisa l’ospite che sei arrivato', 'Avvisa gli ospiti che sei arrivato'],
  sette_minuti: ['Avvisa l’ospite: arrivo fra 7 minuti', 'Avvisa gli ospiti: arrivo fra 7 minuti'],
  traffico: ['Avvisa l’ospite: c’è traffico', 'Avvisa gli ospiti: c’è traffico'],
};

const MESSAGE_ICON: Record<DriverMessageKind, React.ReactNode> = {
  arrivato: <MapPin size={24} />,
  sette_minuti: <Clock size={24} />,
  traffico: <TrafficCone size={24} />,
};

function TripCard({ trip: t, clash, settings, now, act }: { trip: Trip; clash: Ride[]; settings: ShuttleSettings; now: number; act: Act }) {
  const { backend } = useApp();
  const staff = backend.staff;
  const [noShowFor, setNoShowFor] = useState<string | null>(null);
  const many = t.rides.length > 1;
  const arrivedRides = t.rides.filter((r) => r.status === 'sul_posto');
  const arrived = arrivedRides.length > 0;
  const unread = t.rides.some((r) => r.status === 'richiesta');
  const toNotify = t.rides.filter((r) => r.status === 'richiesta' || r.status === 'confermata');
  const depart = t.rides.map((r) => departState(r, now)).find(Boolean) ?? null;
  const firstArrived = [...arrivedRides].sort((a, b) => (a.arrivedAt ?? '').localeCompare(b.arrivedAt ?? ''))[0];
  const wait = firstArrived ? waitState(firstArrived, settings, now) : null;
  const last = t.rides.filter((r) => r.lastMessageAt).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))[0];
  const drops = dropsOf(t);
  const first = t.rides[0]!;

  const notifyAll = (kind: DriverMessageKind) =>
    act(
      async () => {
        for (const r of toNotify) await staff.driverMessage(r.id, kind);
      },
      unread ? (many ? 'Lettura confermata, ospiti avvisati.' : 'Lettura confermata, ospite avvisato.') : many ? 'Ospiti avvisati.' : 'Ospite avvisato.',
    );
  const doneAll = () =>
    act(
      async () => {
        for (const r of arrivedRides) await staff.driverDone(r.id);
      },
      many ? `Viaggio completato: ${arrivedRides.length} ${arrivedRides.length === 1 ? 'camera' : 'camere'}.` : 'Corsa completata.',
    );

  return (
    <article
      className={cx('flex flex-col gap-4 rounded-[28px] bg-[var(--d-card)] p-4 text-[var(--d-ink)] shadow-xl', unread && 'pulse', clash.length > 0 && 'ring-4 ring-[var(--d-warn)]')}
      aria-label={`Viaggio delle ${t.time} da ${pickupOf(t)}, ${many ? 'camere' : 'camera'} ${roomsOf(t)}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--d-ink-soft)]">{unread ? 'Nuova · conferma la lettura' : arrived ? 'Sul posto' : depart ? 'Parti ora' : 'Adesso'}</p>
          <p className="tnum text-[4.5rem] font-black leading-[0.95] tracking-tight">{t.time}</p>
        </div>
        <span className="ml-auto mt-1 shrink-0 rounded-full border-2 border-[var(--d-ink)] px-3 py-0.5 text-sm font-black uppercase tracking-wide">{t.direction === 'andata' ? 'Andata' : 'Ritorno'}</span>
      </div>

      {/* La risposta a «chi devo andare a prendere?», scritta per esteso: chi, dove, dove portarli. */}
      <div className="flex flex-col gap-2.5 rounded-2xl bg-[var(--d-card-2)] p-3.5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--d-ink-soft)]">Vai a prendere</p>
        <div>
          <p className="text-[1.65rem] font-black leading-tight">
            {many ? 'Camere' : 'Camera'} {roomsSpoken(t)}
          </p>
          <p className="inline-flex items-center gap-1.5 text-lg font-black">
            <Users size={20} aria-hidden /> {t.persons} {t.persons === 1 ? 'persona' : 'persone'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="w-20 shrink-0 text-xs font-black uppercase tracking-[0.18em] text-[var(--d-ink-soft)]">Ritiro</span>
          <PlacePill id={t.pickup} name={pickupOf(t)} settings={settings} size="lg" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex w-20 shrink-0 items-center gap-1 text-xs font-black uppercase tracking-[0.18em] text-[var(--d-ink-soft)]">
            Portali <ArrowRight size={14} aria-hidden />
          </span>
          {drops.map((d) => (
            <PlacePill key={d.id} id={d.id} name={d.name} settings={settings} size="md" />
          ))}
        </div>
      </div>

      {depart ? (
        // Da 7 minuti prima dell'orario: il luogo del pick-up lampeggia finché l'autista non è sul posto.
        <p className="blink-place flex items-center gap-3 rounded-2xl px-4 py-3 font-black" role="status" aria-label={`Parti ora: pick-up ${pickupOf(t)} ${departLabel(depart.minutesLeft)}`}>
          <Navigation size={26} className="shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-[0.18em]">Parti ora · pick-up</span>
            <span className="block truncate text-2xl leading-tight">{pickupOf(t)}</span>
          </span>
          <span className="tnum ml-auto shrink-0 text-right text-lg">{departLabel(depart.minutesLeft)}</span>
        </p>
      ) : null}

      {clash.length ? (
        <div role="alert" className="flex flex-col gap-1.5 rounded-2xl bg-[var(--d-warn)] px-4 py-3">
          <p className="flex items-center gap-2 text-lg font-black">
            <AlertTriangle size={22} className="shrink-0" aria-hidden /> Due viaggi nella stessa fascia
          </p>
          <ul className="flex flex-col gap-0.5 font-bold">
            {clash.map((o) => (
              <li key={o.id} className="tnum">
                {o.time} · ritiro {o.direction === 'andata' ? 'Hotel' : o.destinationName} · camera {o.room}
              </li>
            ))}
          </ul>
          <p className="text-sm font-bold">Il mezzo non può essere in due posti: avvisa uno dei due ospiti («c’è traffico») e chiama la reception.</p>
        </div>
      ) : null}

      {/* Camere del viaggio. */}
      <ul className="flex flex-col divide-y-2 divide-[var(--d-card-2)] rounded-2xl border-2 border-[var(--d-card-2)]">
        {t.rides.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-3">
              <span className="tnum flex h-12 min-w-14 items-center justify-center rounded-xl bg-[var(--d-ink)] px-2 text-2xl font-black text-[var(--d-cream)]" aria-label={`Camera ${r.room}`}>
                {r.room}
              </span>
              {/* Persone e stato una sotto l'altro: restano leggibili anche sui telefoni stretti. */}
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="whitespace-nowrap text-lg font-black leading-tight">
                  {r.persons} {r.persons === 1 ? 'persona' : 'persone'}
                  {t.direction === 'andata' && drops.length > 1 ? <span className="text-sm font-bold text-[var(--d-ink-soft)]"> → {r.destinationName}</span> : null}
                </span>
                <StatusChip status={r.status} />
              </span>
            </div>
            {r.note ? <p className="rounded-xl bg-[var(--d-card-2)] px-3 py-2 italic">“{r.note}”</p> : null}
            {arrived && many ? (
              r.status === 'sul_posto' ? (
                noShowFor === r.id ? (
                  <ConfirmRow
                    question={`Camera ${r.room} non presentata?`}
                    yes="Sì, non presentata"
                    no="Aspetto ancora"
                    onNo={() => setNoShowFor(null)}
                    onYes={() => {
                      setNoShowFor(null);
                      void act(() => staff.driverNoShow(r.id), `Camera ${r.room}: segnalata alla reception come non presentata.`);
                    }}
                  />
                ) : (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void act(() => staff.driverDone(r.id), `Camera ${r.room} a bordo.`)} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--d-ok)] font-black text-white active:scale-[0.98]">
                      <Check size={20} strokeWidth={3} /> A bordo
                    </button>
                    {wait?.expired ? (
                      <button type="button" onClick={() => setNoShowFor(r.id)} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border-2 border-[var(--d-bad)] font-black text-[var(--d-bad)] active:scale-[0.98]">
                        <UserX size={20} /> Non presentato
                      </button>
                    ) : null}
                  </div>
                )
              ) : r.status === 'richiesta' || r.status === 'confermata' ? (
                <button type="button" onClick={() => void act(() => staff.driverMessage(r.id, 'arrivato'), `Camera ${r.room} avvisata.`)} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--d-primary)] font-black text-white">
                  <MapPin size={18} /> Avvisa anche questa camera
                </button>
              ) : null
            ) : null}
          </li>
        ))}
      </ul>

      {last?.lastMessage ? (
        <p className="text-sm font-bold text-[var(--d-ink-soft)]">
          {many ? 'Ospiti avvisati' : 'Ospite avvisato'} alle <span className="tnum">{romeTimeOf(last.lastMessageAt)}</span>: «{DRIVER_MESSAGE_LABEL[last.lastMessage]}»
        </p>
      ) : null}

      {!arrived ? (
        // Prima dell'arrivo: i tre messaggi per gli ospiti (il primo tocco vale come conferma di lettura).
        <div className="flex flex-col gap-2.5">
          {(['arrivato', 'sette_minuti', 'traffico'] as DriverMessageKind[]).map((k, i) => (
            <button
              key={k}
              type="button"
              onClick={() => void notifyAll(k)}
              className={cx(
                'flex min-h-16 items-center gap-3 rounded-full px-5 text-left text-lg font-black leading-snug active:scale-[0.98]',
                i === 0 ? 'bg-[var(--d-primary)] text-white shadow-md' : last?.lastMessage === k ? 'bg-[var(--d-ink)] text-[var(--d-cream)]' : 'border-2 border-[var(--d-ink)] bg-transparent text-[var(--d-ink)]',
              )}
            >
              {MESSAGE_ICON[k]} <span>{ACTION_LABEL[k][many ? 1 : 0]}</span>
            </button>
          ))}
        </div>
      ) : (
        // Sul posto: attesa, poi «Fatto!» alla consegna; dopo l'attesa massima, «non presentato».
        <div className="flex flex-col gap-3">
          {wait ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-[var(--d-card-2)] p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-black">{wait.expired ? 'Attesa massima trascorsa' : 'Attesa'}</span>
                <span className="tnum text-5xl font-black">{wait.expired ? `${settings.waitMinutes}:00` : <Countdown ms={wait.remainingMs} />}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[var(--d-card)]" aria-hidden>
                <div className="h-full bg-[var(--d-primary)] transition-[width] duration-1000" style={{ width: `${100 - (wait.remainingMs / (settings.waitMinutes * 60000)) * 100}%` }} />
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => void doneAll()} className="flex min-h-20 items-center justify-center gap-3 rounded-full bg-[var(--d-ok)] text-2xl font-black text-white shadow-md active:scale-[0.98]">
            <Check size={30} strokeWidth={3} /> {many ? 'Fatto! Tutti a bordo' : 'Fatto!'}
          </button>
          {!many ? (
            wait?.expired ? (
              noShowFor ? (
                <ConfirmRow
                  question={`Camera ${first.room} non presentata: ripartire?`}
                  yes="Sì, riparto"
                  no="Aspetto ancora"
                  onNo={() => setNoShowFor(null)}
                  onYes={() => {
                    setNoShowFor(null);
                    void act(() => staff.driverNoShow(first.id), 'Segnalato alla reception: ospite non presentato.');
                  }}
                />
              ) : (
                <button type="button" onClick={() => setNoShowFor(first.id)} className="flex min-h-14 items-center justify-center gap-2 rounded-full border-2 border-[var(--d-bad)] text-lg font-black text-[var(--d-bad)] active:scale-[0.98]">
                  <UserX size={22} /> Ospite non presentato · riparto
                </button>
              )
            ) : (
              <p className="text-center text-sm font-bold text-[var(--d-ink-soft)]">Dopo {settings.waitMinutes} minuti potrai segnalare l’ospite come non presentato.</p>
            )
          ) : (
            <p className="text-center text-sm font-bold text-[var(--d-ink-soft)]">
              {wait?.expired ? 'Segna «a bordo» chi è salito e «non presentato» chi manca.' : `Dopo ${settings.waitMinutes} minuti potrai segnalare chi non si presenta.`}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function ConfirmRow({ question, yes, no, onYes, onNo }: { question: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-[var(--d-card-2)] p-3" role="alertdialog" aria-label={question}>
      <p className="font-black">{question}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onYes} className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-[var(--d-bad)] font-black text-white">
          {yes}
        </button>
        <button type="button" onClick={onNo} className="flex min-h-12 flex-1 items-center justify-center rounded-full border-2 border-[var(--d-ink)] font-black">
          {no}
        </button>
      </div>
    </div>
  );
}
