import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, BellRing, Car, Check, ChevronDown, ChevronRight, Lock, MapPin, Navigation, Play, TrafficCone, UserX } from 'lucide-react';
import {
  DEPART_ALERT_MINUTES,
  HOTEL_PICKUP,
  compareRides,
  departLabel,
  departState,
  groupTrips,
  isExtra,
  isOpen,
  rideConflicts,
  rideWho,
  waitState,
  type Trip,
} from '../domain/rules';
import { addDays, romeDate } from '../domain/time';
import type { DriverMessageKind, Ride, RideStatus, ShuttleSettings } from '../domain/types';
import { PresenceError, type PresenceErrorCode } from '../presence/presence';
import { destinationColor, hasMeetingPoint, mapHref } from '../ui/destinations';
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

/**
 * Nome dell'ospite («Cognome N.») di una corsa, dalle presenze cifrate di La Scatola. Si abbina solo con il
 * reservation_id di Slope (invariato): una corsa senza prenotazione collegata mostra la sola camera, così
 * non compare mai il nome di un altro ospite della stessa camera.
 */
type NameOf = (r: Ride) => string | null;
const NamesContext = createContext<NameOf>(() => null);
const useNameOf = (): NameOf => useContext(NamesContext);
/** Nome scritto dalla reception per una corsa extra (prima parte della nota). */
const extraNameOf = (r: Ride): string => (r.note ?? '').split(' · ')[0]?.trim() ?? '';
/** «105 Meyer S.», «105» senza nome, «Extra · Rossi» per chi non è ospite. */
const labelOf = (r: Ride, nameOf: NameOf): string => {
  if (isExtra(r)) return rideWho(r);
  const name = nameOf(r);
  return name ? `${r.room} ${name}` : r.room;
};
const roomsOf = (t: Trip, nameOf: NameOf): string => t.rides.map((r) => labelOf(r, nameOf)).join(' · ');
/** Per avvisi e messaggi: «camera 105 Meyer S.» oppure «Extra · Rossi». */
const whoLong = (r: Ride, nameOf: NameOf): string => (isExtra(r) ? rideWho(r) : `camera ${labelOf(r, nameOf)}`);
const roomsWord = (t: Trip): string => (t.rides.every(isExtra) ? '' : t.rides.length > 1 ? 'camere ' : 'camera ');

/** Camere del viaggio nell'elenco: numero in grassetto pieno e, accanto, il nome dell'ospite. */
function WhoInline({ rides }: { rides: Ride[] }) {
  const nameOf = useNameOf();
  return (
    <>
      {/* Una riga per camera: con più camere nello stesso viaggio numero e nome restano sempre insieme. */}
      {rides.map((r) => (
        <span key={r.id} className="block break-words">
          <span className="font-black">{isExtra(r) ? 'Extra' : r.room}</span>
          {isExtra(r) ? (extraNameOf(r) ? <span className="font-bold"> {extraNameOf(r)}</span> : null) : nameOf(r) ? <span className="font-bold"> {nameOf(r)}</span> : null}
        </span>
      ))}
    </>
  );
}
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Nell'elenco basta il nome corto: «Col Raiser (Gardena Ronda/Saslong)» → «Col Raiser». */
const short = (name: string): string => name.replace(/\s*\(.*\)\s*$/, '') || name;

/**
 * Area autista, pensata per il telefono sul mezzo: un viaggio alla volta, grande e colorato, con le sole
 * azioni del momento. Le camere con lo stesso orario e lo stesso punto di ritiro formano un unico viaggio
 * (un tocco avvisa tutti). Due viaggi troppo vicini in posti diversi vengono segnalati.
 */
export function DriverView({ onSignOut }: { onSignOut?: () => void }) {
  const { backend, presence } = useApp();
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
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [toast, showToast] = useToast();
  useWakeLock(started); // schermo sempre acceso durante il turno
  const soundOn = useRef(false);

  // Nomi degli ospiti dalle presenze (oggi e domani), riletti ogni 5 minuti come in reception.
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [namesError, setNamesError] = useState<PresenceErrorCode | null>(null);
  const [pwTick, setPwTick] = useState(0);
  useEffect(() => {
    if (!presence) return;
    let alive = true;
    const load = async () => {
      if (presence.needsPassword && !presence.hasPassword()) {
        setNamesError('password_mancante');
        return;
      }
      const map = new Map<string, string>();
      let error: PresenceErrorCode | null = null;
      for (const d of [today, tomorrow]) {
        try {
          const snap = await presence.load(d);
          // reservation_id di Slope usato così com'è, come chiave.
          for (const s of snap.stays) if (s.name) map.set(s.reservationId, s.name);
        } catch (e) {
          error ??= e instanceof PresenceError ? e.code : 'rete';
        }
      }
      if (!alive) return;
      // Senza rete si tengono i nomi già letti; con la password sbagliata si svuota e si chiede di nuovo.
      if (map.size || error === 'password_errata') setNames(map);
      setNamesError(map.size ? null : error);
    };
    void load();
    const id = window.setInterval(() => void load(), 5 * 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [presence, today, tomorrow, pwTick]);
  const nameOf = useCallback<NameOf>((r) => (r.reservationId ? (names.get(r.reservationId) ?? null) : null), [names]);
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;

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
          if (prev === undefined && r.status === 'richiesta') fresh.push({ id: r.id, tripKey: key, tone: 'nuova', text: `${when}${r.time} · ${whoLong(r, nameRef.current)} · ${where}` });
          if (prev && prev !== 'annullata' && r.status === 'annullata') {
            const who = r.cancelledBy === 'ospite' ? 'Cancellata dall’ospite' : 'Annullata dalla reception';
            fresh.push({ id: `${r.id}-x`, tripKey: null, tone: 'annullata', text: `${who}: ${when}${r.time} · ${whoLong(r, nameRef.current)} · ${where}` });
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

  const act: Act = async (fn, ok) => {
    try {
      await fn();
      if (ok) showToast(ok);
    } catch (e) {
      showToast((e as Error).message, 'bad');
    }
  };

  // Viaggi di oggi ancora da fare, in ordine di orario.
  const trips = useMemo(() => groupTrips(todayRides.filter((r) => isOpen(r.status))), [todayRides]);
  const conflicts = useMemo(() => (settings ? rideConflicts(todayRides, settings) : new Map<string, Ride[]>()), [todayRides, settings]);
  const clashOf = (t: Trip): Ride[] => {
    const inTrip = new Set(t.rides.map((r) => r.id));
    const others = t.rides.flatMap((r) => conflicts.get(r.id) ?? []).filter((o) => !inTrip.has(o.id));
    return [...new Map(others.map((o) => [o.id, o])).values()].sort(compareRides);
  };
  const done = todayRides.filter((r) => !isOpen(r.status));
  const tomorrowTrips = groupTrips(tomorrowRides.filter((r) => isOpen(r.status)));
  // Un solo elenco per orario: i viaggi da fare e, al loro posto, le corse già chiuse con la spunta.
  const entries: Entry[] = [...trips.map((t): Entry => ({ kind: 'trip', time: t.time, trip: t })), ...done.map((r): Entry => ({ kind: 'closed', time: r.time, ride: r }))].sort(
    (a, b) => a.time.localeCompare(b.time) || (a.kind === b.kind ? 0 : a.kind === 'closed' ? -1 : 1),
  );
  // La scheda grande si apre solo toccando un viaggio; chiuso il viaggio, si torna all'elenco.
  const focus = focusKey ? (trips.find((t) => t.key === focusKey) ?? null) : null;
  const doneTrip = (t: Trip) =>
    act(async () => {
      for (const r of t.rides) if (r.status === 'confermata' || r.status === 'sul_posto') await staff.driverDone(r.id);
    }, `Fatto: ${roomsWord(t)}${roomsOf(t, nameOf)}.`);

  // «Parti ora»: 7 minuti prima dell'orario, una sola volta per viaggio (e di nuovo se l'orario cambia).
  const departAlerted = useRef(new Set<string>());
  useEffect(() => {
    if (!started) return;
    const fresh: Alert[] = [];
    for (const t of trips) {
      if (departAlerted.current.has(t.key) || !t.rides.some((r) => departState(r, now))) continue;
      departAlerted.current.add(t.key);
      fresh.push({ id: `${t.key}-via`, tripKey: t.key, tone: 'partenza', text: `${t.time} · ${roomsWord(t)}${roomsOf(t, nameRef.current)} · pick-up ${pickupOf(t)}` });
    }
    if (!fresh.length) return;
    setAlerts((x) => [...fresh, ...x.filter((a) => !fresh.some((f) => f.id === a.id))].slice(0, 3));
    if (soundOn.current) chime('partenza');
    else vibrate([300, 120, 300, 120, 300]);
  }, [started, trips, now]);
  const askPassword = !!presence?.needsPassword && (namesError === 'password_mancante' || namesError === 'password_errata');

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
        {askPassword && presence ? (
          <NamesPassword
            wrong={namesError === 'password_errata'}
            onSave={(pw) => {
              presence.setPassword(pw);
              setPwTick((n) => n + 1);
            }}
          />
        ) : null}
        {onSignOut ? (
          <button type="button" onClick={onSignOut} className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-bold text-[var(--d-on-bg-soft)]">
            <Lock size={16} /> Blocca
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <NamesContext.Provider value={nameOf}>
    <div className="driver-theme flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-[var(--d-bg-2)] px-4 py-2.5">
        <AlpstayLogo variant="simbolo" className="h-7 w-auto shrink-0" />
        <h1 className="mr-auto font-text text-xl font-black uppercase tracking-[0.12em]">Autista</h1>
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

      {focus ? (
        <main className="flex flex-1 flex-col gap-4 px-4 py-4">
          <button type="button" onClick={() => setFocusKey(null)} className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-white/10 px-4 font-black text-[var(--d-cream)] active:scale-[0.98]">
            <ArrowLeft size={20} /> Elenco
          </button>
          <TripCard key={focus.key} trip={focus} clash={clashOf(focus)} settings={settings} now={now} act={act} />
        </main>
      ) : (
        <main className="flex flex-1 flex-col gap-4 px-4 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-text text-2xl font-black">Oggi</h2>
            <span className="tnum text-sm font-bold text-[var(--d-on-bg-soft)]">
              {trips.length} da fare · {done.filter((r) => r.status === 'completata').length} fatte
            </span>
          </div>
          {entries.length ? (
            <ul className="flex flex-col gap-2" aria-label="Viaggi di oggi">
              {entries.map((e) =>
                e.kind === 'trip' ? (
                  <TripRow key={e.trip.key} trip={e.trip} settings={settings} now={now} clash={clashOf(e.trip).length > 0} onOpen={() => setFocusKey(e.trip.key)} onDone={() => void doneTrip(e.trip)} />
                ) : (
                  <ClosedRow key={e.ride.id} ride={e.ride} settings={settings} />
                ),
              )}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-[28px] bg-[var(--d-card)] px-4 py-12 text-center text-[var(--d-ink)]">
              <span className="flex size-14 items-center justify-center rounded-full bg-[var(--d-ok)] text-[var(--d-cream)]">
                <Check size={30} strokeWidth={3} aria-hidden />
              </span>
              <p className="text-2xl font-black">Nessuna corsa oggi</p>
              <p className="text-[var(--d-ink-soft)]">Le nuove richieste arrivano qui con un avviso.</p>
            </div>
          )}

          {tomorrowTrips.length ? (
            <Collapsible label={`Domani · ${tomorrowTrips.length}`} open={showTomorrow} onToggle={() => setShowTomorrow(!showTomorrow)}>
              {tomorrowTrips.map((t) => (
                <li key={t.key}>
                  <TripLine trip={t} settings={settings} />
                </li>
              ))}
            </Collapsible>
          ) : null}
          {askPassword && presence ? (
            <NamesPassword
              wrong={namesError === 'password_errata'}
              onSave={(pw) => {
                presence.setPassword(pw);
                setPwTick((n) => n + 1);
              }}
            />
          ) : null}
        </main>
      )}
    </div>
    </NamesContext.Provider>
  );
}

/**
 * Password delle presenze, una volta sola su questo telefono: serve solo a mostrare il nome degli ospiti
 * accanto alla camera. È facoltativa: senza, l'autista vede le camere come prima.
 */
function NamesPassword({ wrong, onSave }: { wrong: boolean; onSave: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <form
      className="flex w-full max-w-sm flex-col gap-2 rounded-2xl bg-white/10 p-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (pw.trim()) onSave(pw.trim());
      }}
    >
      <label htmlFor="driver-presenze-pw" className="text-sm font-black">
        {wrong ? 'Password non corretta: riprova.' : 'Nomi degli ospiti accanto alla camera: password presenze (una volta su questo telefono, facoltativa)'}
      </label>
      <div className="flex gap-2">
        <input
          id="driver-presenze-pw"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-[var(--d-cream)] px-3 text-lg text-[var(--d-ink)]"
        />
        <button type="submit" className="min-h-12 rounded-xl bg-[var(--d-cream)] px-4 font-black text-[var(--d-bg)]">
          Sblocca
        </button>
      </div>
    </form>
  );
}

type Entry = { kind: 'trip'; time: string; trip: Trip } | { kind: 'closed'; time: string; ride: Ride };

/**
 * Riga dell'elenco: orario, punto di ritiro, camere e la spunta per segnare «fatto» (due tocchi, per non
 * sbagliare). Toccando la riga si apre la scheda grande con i messaggi per l'ospite.
 */
function TripRow({ trip: t, settings, now, clash, onOpen, onDone }: { trip: Trip; settings: ShuttleSettings; now: number; clash: boolean; onOpen: () => void; onDone: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);
  const unread = t.rides.some((r) => r.status === 'richiesta');
  const arrivedRides = t.rides.filter((r) => r.status === 'sul_posto');
  const firstArrived = [...arrivedRides].sort((a, b) => (a.arrivedAt ?? '').localeCompare(b.arrivedAt ?? ''))[0];
  const wait = firstArrived ? waitState(firstArrived, settings, now) : null;
  const depart = t.rides.map((r) => departState(r, now)).find(Boolean) ?? null;
  const nameOf = useNameOf();
  return (
    <li className={cx('flex items-stretch overflow-hidden rounded-2xl bg-[var(--d-card)] text-[var(--d-ink)]', clash && 'ring-4 ring-[var(--d-warn)]')} data-trip={t.key}>
      <button type="button" onClick={onOpen} aria-label={`Apri il viaggio delle ${t.time}, ${roomsWord(t)}${roomsOf(t, nameOf)}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left active:bg-black/5">
        <span className="tnum w-[4.6rem] shrink-0 text-[1.75rem] font-black leading-none">{t.time}</span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          {depart ? (
            <span className="blink-place inline-flex min-h-8 max-w-full items-center gap-1 rounded-[1.25rem] px-3 py-1 text-sm font-black leading-tight" aria-label={`Parti ora: pick-up ${pickupOf(t)}`}>
              <MapPin size={14} className="shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{short(pickupOf(t))}</span>
            </span>
          ) : (
            <PlacePill id={t.pickup} name={short(pickupOf(t))} settings={settings} size="sm" />
          )}
          <span className="text-base leading-snug">
            <WhoInline rides={t.rides} />
            <span className="block text-sm font-bold text-[var(--d-ink-soft)]">{t.persons} pers.</span>
          </span>
          {unread ? (
            <StatusChip status="richiesta" />
          ) : wait ? (
            <span className="tnum text-sm font-black text-[#a55a00]">{wait.expired ? 'Attesa finita' : <>Sul posto · <Countdown ms={wait.remainingMs} /></>}</span>
          ) : (
            <span className="text-sm font-bold text-[var(--d-ink-soft)]">Sto andando</span>
          )}
        </span>
        {clash ? <AlertTriangle size={24} className="shrink-0 text-[var(--d-warn)]" aria-label="Conflitto di orario" /> : null}
      </button>
      {unread ? (
        <span className="flex w-16 shrink-0 items-center justify-center border-l-2 border-[var(--d-card-2)] text-[var(--d-ink-soft)]" aria-hidden>
          <ChevronRight size={26} />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => (armed ? (setArmed(false), onDone()) : setArmed(true))}
          aria-label={armed ? 'Conferma: fatto' : `Segna fatto: ${roomsWord(t)}${roomsOf(t, nameOf)}`}
          className={cx('flex w-20 shrink-0 flex-col items-center justify-center gap-1 border-l-2 border-[var(--d-card-2)] font-black transition-colors', armed ? 'bg-[var(--d-ok)] text-white' : 'active:bg-black/5')}
        >
          {armed ? (
            <>
              <Check size={30} strokeWidth={3} aria-hidden />
              <span className="text-xs uppercase">Conferma</span>
            </>
          ) : (
            <span className="size-11 rounded-full border-[3px] border-[var(--d-ink)]" aria-hidden />
          )}
        </button>
      )}
    </li>
  );
}

/** Corsa già chiusa, al suo orario: spunta verde se fatta, croce rossa se non presentato. */
function ClosedRow({ ride: r, settings }: { ride: Ride; settings: ShuttleSettings }) {
  const pickup = r.direction === 'andata' ? HOTEL_PICKUP : r.destinationId;
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-[var(--d-card)]/75 px-3 py-2.5 text-[var(--d-ink)]">
      <span className={cx('tnum w-[4.6rem] shrink-0 text-[1.75rem] font-black leading-none', r.status === 'annullata' && 'line-through opacity-60')}>{r.time}</span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1 opacity-80">
        <PlacePill id={pickup} name={r.direction === 'andata' ? 'Hotel' : short(r.destinationName)} settings={settings} size="sm" />
        <span className="text-base leading-snug">
          <WhoInline rides={[r]} />
          <span className="block text-sm font-bold text-[var(--d-ink-soft)]">{r.persons} pers.</span>
        </span>
      </span>
      <span className="flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 text-xs font-black uppercase" aria-label={CHIP[r.status].label}>
        {r.status === 'completata' ? (
          <span className="flex size-11 items-center justify-center rounded-full bg-[var(--d-ok)] text-white">
            <Check size={26} strokeWidth={3} aria-hidden />
          </span>
        ) : r.status === 'no_show' ? (
          <span className="flex size-11 items-center justify-center rounded-full bg-[var(--d-bad)] text-white">
            <UserX size={22} aria-hidden />
          </span>
        ) : (
          <StatusChip status={r.status} />
        )}
      </span>
    </li>
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
  const content = (
    <>
      <span className="tnum w-16 shrink-0 text-2xl font-black">{t.time}</span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {depart ? (
          <span className="blink-place inline-flex min-h-8 max-w-full items-center gap-1 rounded-[1.25rem] px-3 py-1 text-sm font-black leading-tight" aria-label={`Parti ora: pick-up ${pickupOf(t)}`}>
            <MapPin size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{pickupOf(t)}</span>
          </span>
        ) : (
          <PlacePill id={t.pickup} name={short(pickupOf(t))} settings={settings} size="sm" />
        )}
        <span className="text-base leading-snug">
          <WhoInline rides={t.rides} />
            <span className="block text-sm font-bold text-[var(--d-ink-soft)]">{t.persons} pers.</span>
        </span>
      </span>
      {clash ? <AlertTriangle size={24} className="shrink-0 text-[var(--d-warn)]" aria-label="Conflitto di orario" /> : null}
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

/** Pulsante grande: uno solo per ogni momento del viaggio. */
function BigButton({ tone, onClick, children }: { tone: 'go' | 'done'; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex min-h-20 w-full items-center justify-center gap-3 rounded-full text-2xl font-black text-white shadow-md active:scale-[0.98]',
        tone === 'go' ? 'bg-[var(--d-primary)]' : 'bg-[var(--d-ok)]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Un viaggio, ridotto all'essenziale per chi guida: orario, dove ritirare, camere e un solo pulsante grande
 * che cambia a ogni passo. Sto andando (l'ospite legge «arrivo fra 7 minuti») → Sono arrivato → Fatto!
 */
function TripCard({ trip: t, clash, settings, now, act }: { trip: Trip; clash: Ride[]; settings: ShuttleSettings; now: number; act: Act }) {
  const { backend } = useApp();
  const staff = backend.staff;
  const nameOf = useNameOf();
  const [askNoShow, setAskNoShow] = useState<string | null>(null);
  const many = t.rides.length > 1;
  const arrivedRides = t.rides.filter((r) => r.status === 'sul_posto');
  const arrived = arrivedRides.length > 0;
  const pending = t.rides.filter((r) => r.status === 'richiesta' || r.status === 'confermata');
  const unread = t.rides.some((r) => r.status === 'richiesta');
  const depart = t.rides.map((r) => departState(r, now)).find(Boolean) ?? null;
  const firstArrived = [...arrivedRides].sort((a, b) => (a.arrivedAt ?? '').localeCompare(b.arrivedAt ?? ''))[0];
  const wait = firstArrived ? waitState(firstArrived, settings, now) : null;
  const notes = t.rides.filter((r) => r.note);
  // Impianto del viaggio: il ritiro al ritorno, l'arrivo all'andata (se tutti vanno allo stesso impianto).
  const liftId = t.direction === 'ritorno' ? t.pickup : new Set(t.rides.map((r) => r.destinationId)).size === 1 ? t.rides[0]!.destinationId : null;
  const lift = liftId ? settings.destinations.find((d) => d.id === liftId) : undefined;
  const meeting = lift && (hasMeetingPoint(lift) || t.direction === 'ritorno') ? lift : null;
  const drops = dropsOf(t)
    .map((d) => d.name)
    .join(', ');

  const send = (kind: DriverMessageKind, ok: string) =>
    act(async () => {
      for (const r of pending) await staff.driverMessage(r.id, kind);
    }, ok);
  const finish = () =>
    act(async () => {
      for (const r of arrivedRides) await staff.driverDone(r.id);
    }, many ? 'Viaggio completato.' : 'Corsa completata.');
  const noShow = (r: Ride) => act(() => staff.driverNoShow(r.id), `${capital(whoLong(r, nameOf))}: segnalata alla reception come non presentata.`);

  return (
    <article
      className={cx('flex flex-col gap-4 rounded-[28px] bg-[var(--d-card)] p-5 text-[var(--d-ink)] shadow-xl', unread && 'pulse', clash.length > 0 && 'ring-4 ring-[var(--d-warn)]')}
      aria-label={`Viaggio delle ${t.time} da ${pickupOf(t)}, ${roomsWord(t)}${roomsOf(t, nameOf)}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="tnum text-[4.5rem] font-black leading-none tracking-tight">{t.time}</p>
        {depart ? (
          // Da 7 minuti prima dell'orario lampeggia finché l'autista non è sul posto.
          <p className="blink-place shrink-0 rounded-full px-4 py-2 text-lg font-black" role="status" aria-label={`Parti ora: pick-up ${pickupOf(t)} ${departLabel(depart.minutesLeft)}`}>
            Parti ora · {departLabel(depart.minutesLeft)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PlacePill id={t.pickup} name={pickupOf(t)} settings={settings} size="lg" />
        <span className="inline-flex items-center gap-1 text-lg font-black text-[var(--d-ink-soft)]">
          <ArrowRight size={20} aria-label="poi a" /> {drops}
        </span>
      </div>

      {/* Chi prendere: una riga per camera, numero grande e nome dell'ospite accanto. */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--d-ink-soft)]">
          Da prendere{many ? ` · ${t.persons} pers.` : ''}
        </p>
        <ul className="flex flex-col gap-1">
          {t.rides.map((r) => {
            const name = isExtra(r) ? extraNameOf(r) : nameOf(r);
            return (
              <li key={r.id} className="flex items-baseline gap-2.5 leading-tight">
                <span className="tnum shrink-0 text-[1.75rem] font-black">{isExtra(r) ? 'Extra' : r.room}</span>
                <span className="min-w-0 flex-1 break-words text-xl font-black">{name ?? ''}</span>
                <span className="shrink-0 whitespace-nowrap text-xl font-bold text-[var(--d-ink-soft)]">{r.persons} pers.</span>
              </li>
            );
          })}
        </ul>
      </div>

      {meeting ? (
        // Meeting point all'impianto: dove caricare (ritorno) o lasciare (andata) gli ospiti, con la navigazione.
        <div className="flex items-center gap-3 rounded-2xl bg-[var(--d-card-2)] p-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-[var(--d-ink-soft)]">Meeting point {meeting.name}</span>
            <span className="font-black leading-snug">{meeting.meetingPoint?.trim() || `${meeting.name}, ${meeting.place}`}</span>
          </span>
          <a href={mapHref(meeting)} target="_blank" rel="noopener noreferrer" className="flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-[var(--d-ink)] px-4 font-black text-[var(--d-cream)] active:scale-[0.98]">
            <Navigation size={18} aria-hidden /> Naviga
          </a>
        </div>
      ) : null}

      {notes.map((r) => {
        const text = r.room === 'EXTRA' ? (r.note ?? '').split(' · ').slice(1).join(' · ') : r.note;
        return text ? (
          <p key={r.id} className="-mt-2 italic text-[var(--d-ink-soft)]">
            {many ? `${labelOf(r, nameOf)}: ` : ''}“{text}”
          </p>
        ) : null;
      })}

      {clash.length ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-[var(--d-warn)] px-4 py-3 font-black">
          <AlertTriangle size={22} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Alle {clash.map((o) => `${o.time} anche ${o.direction === 'andata' ? 'Hotel' : o.destinationName} (${labelOf(o, nameOf)})`).join(', ')}: chiama la reception.
          </span>
        </p>
      ) : null}

      {!arrived ? (
        <div className="flex flex-col gap-2">
          {unread ? (
            <BigButton tone="go" onClick={() => void send('sette_minuti', 'Ospite avvisato: arrivi fra 7 minuti.')}>
              <Car size={28} /> Sto andando
            </BigButton>
          ) : (
            <>
              <BigButton tone="go" onClick={() => void send('arrivato', 'Ospite avvisato: sei arrivato.')}>
                <MapPin size={28} /> Sono arrivato
              </BigButton>
              <button type="button" onClick={() => void send('traffico', 'Ospite avvisato: c’è traffico.')} className="flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-[var(--d-ink)] font-black active:scale-[0.98]">
                <TrafficCone size={20} /> C’è traffico
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {wait ? (
            <p className="flex items-baseline justify-between rounded-2xl bg-[var(--d-card-2)] px-4 py-3">
              <span className="text-lg font-black">{wait.expired ? 'Attesa finita' : 'Attesa'}</span>
              <span className="tnum text-5xl font-black">{wait.expired ? `${settings.waitMinutes}:00` : <Countdown ms={wait.remainingMs} />}</span>
            </p>
          ) : null}
          <BigButton tone="done" onClick={() => void finish()}>
            <Check size={30} strokeWidth={3} /> Fatto!
          </BigButton>
          {pending.length ? (
            <button type="button" onClick={() => void send('arrivato', 'Ospite avvisato: sei arrivato.')} className="flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-[var(--d-ink)] font-black">
              <MapPin size={18} /> Sono arrivato anche per {pending.map((r) => labelOf(r, nameOf)).join(', ')}
            </button>
          ) : null}
          {wait?.expired ? (
            askNoShow ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-[var(--d-card-2)] p-3" role="alertdialog" aria-label="Conferma ospite non presentato">
                <p className="font-black">{capital(whoLong(t.rides.find((r) => r.id === askNoShow) ?? t.rides[0]!, nameOf))} non presentata: ripartire?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const r = t.rides.find((x) => x.id === askNoShow);
                      setAskNoShow(null);
                      if (r) void noShow(r);
                    }}
                    className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-[var(--d-bad)] font-black text-white"
                  >
                    Sì, riparto
                  </button>
                  <button type="button" onClick={() => setAskNoShow(null)} className="flex min-h-12 flex-1 items-center justify-center rounded-full border-2 border-[var(--d-ink)] font-black">
                    Aspetto ancora
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {arrivedRides.map((r) => (
                  <button key={r.id} type="button" onClick={() => setAskNoShow(r.id)} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border-2 border-[var(--d-bad)] px-3 font-black text-[var(--d-bad)]">
                    <UserX size={20} /> {many ? `${labelOf(r, nameOf)} non c’è` : 'Non si è presentato'}
                  </button>
                ))}
              </div>
            )
          ) : (
            <p className="text-center text-sm font-bold text-[var(--d-ink-soft)]">Dopo {settings.waitMinutes} minuti puoi segnalare chi non si presenta.</p>
          )}
        </div>
      )}
    </article>
  );
}
