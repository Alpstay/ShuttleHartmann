import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, BellRing, Check, Circle, CircleX, Download, KeyRound, Lock, Plus, RefreshCw, Settings, Trash2, UserX, X } from 'lucide-react';
import { GUEST_STRINGS } from '../domain/i18n';
import { CHARGE_LABEL, DRIVER_MESSAGE_LABEL, EXTRA_ROOM, compareRides, isOpen, isStayValid, rideConflicts, rideWho, ridesToCsv, waitState, whoText } from '../domain/rules';
import { addDays, formatLongDate, formatShortDate, romeDate, romeMinutesOfDay, romeTimeOf, toMinutes } from '../domain/time';
import type { Direction, IsoDate, PresenceSnapshot, Ride, RideEvent, ShuttleSettings, ShuttleStay } from '../domain/types';
import { PresenceError, roomPresences, roomsToSync, type RoomPresence } from '../presence/presence';
import { Button, Countdown, FieldLabel, InlineConfirm, Stepper, chime, cx, unlockSound, useApp, useNow, useToast } from '../ui/kit';
import { AlpstayLogo } from '../ui/Logo';
import { RoomCard } from '../ui/PinCard';
import { RideForm } from '../ui/RideForm';
import { SettingsView } from './SettingsView';

/**
 * Reception: una sola lista con le camere della struttura. Per ogni camera, andata e ritorno con la
 * spunta «fatto» o «non fatto» e i dati della corsa. Storico, annullamento, QR e attivazione si aprono
 * solo toccando la riga.
 */
export function ReceptionView({ onSignOut }: { onSignOut?: () => void }) {
  const { backend, presence, publicUrl, isDemo, clock } = useApp();
  const staff = backend.staff;
  const now = useNow(1000);
  const today = romeDate(now);
  const [date, setDate] = useState<IsoDate>(today);
  const [rides, setRides] = useState<Ride[]>([]);
  const [stays, setStays] = useState<ShuttleStay[]>([]);
  const [settings, setSettings] = useState<ShuttleSettings | null>(null);
  const [snap, setSnap] = useState<PresenceSnapshot | null>(null);
  const [presenceError, setPresenceError] = useState<PresenceError | null>(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ room: string } | null>(null);
  const [toast, showToast] = useToast();
  const [alerts, setAlerts] = useState<{ id: string; text: string }[]>([]);

  useEffect(() => staff.watchRides(date, setRides, (e) => showToast(e.message, 'bad')), [staff, date, showToast]);
  // Il mezzo è uno solo: corse del giorno in viaggi sovrapposti (stessa fascia, posti diversi) o oltre i posti.
  const conflicts = useMemo(() => (settings ? rideConflicts(rides, settings) : new Map<string, Ride[]>()), [rides, settings]);

  // Il suono degli avvisi si sblocca al primo tocco sulla pagina (i browser bloccano l'audio non richiesto).
  useEffect(() => {
    const unlock = () => unlockSound();
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);

  // Avviso quando un ospite cancella una corsa di oggi o di domani, qualunque giorno si stia guardando.
  useEffect(() => {
    const seen = new Map<string, Ride['status']>();
    const lists: Record<string, Ride[] | null> = { a: null, b: null };
    let first = true;
    const handle = () => {
      if (!lists.a || !lists.b) return;
      const all = [...lists.a, ...lists.b];
      if (!first) {
        const fresh = all.filter((r) => r.status === 'annullata' && r.cancelledBy === 'ospite' && seen.get(r.id) && seen.get(r.id) !== 'annullata');
        if (fresh.length) {
          setAlerts((x) => [
            ...fresh.map((r) => ({
              id: r.id,
              text: `Camera ${r.room} ha cancellato la corsa ${r.serviceDate === today ? 'di oggi' : 'di domani'} delle ${r.time} · ${r.direction === 'andata' ? `Hotel → ${r.destinationName}` : `${r.destinationName} → Hotel`} (alle ${romeTimeOf(r.cancelledAt)})`,
            })),
            ...x,
          ]);
          chime('allarme');
        }
      }
      all.forEach((r) => seen.set(r.id, r.status));
      first = false;
    };
    const offA = staff.watchRides(today, (l) => ((lists.a = l), handle()));
    const offB = staff.watchRides(addDays(today, 1), (l) => ((lists.b = l), handle()));
    return () => {
      offA();
      offB();
    };
  }, [staff, today]);
  useEffect(() => staff.watchStays(setStays, (e) => showToast(e.message, 'bad')), [staff, showToast]);
  useEffect(() => {
    staff.getSettings().then(setSettings, (e: Error) => showToast(e.message, 'bad'));
  }, [staff, showToast]);

  const roomList = settings?.rooms;
  const lastSync = useRef('');
  /**
   * Presenze: quelle di oggi attivano da sole le camere (l'ospite entra con il numero di camera solo se
   * la camera ha ospiti in casa); quelle del giorno mostrato danno nome e stato nella lista.
   */
  const loadPresence = useCallback(async () => {
    if (!presence || !roomList) return;
    setPresenceLoading(true);
    try {
      const todaySnap = await presence.load(today);
      const items = roomsToSync(roomPresences(roomList, todaySnap));
      const complete = !!todaySnap.generatedAt && clock.now() - Date.parse(todaySnap.generatedAt) < 3 * 3600000;
      const key = JSON.stringify([items, complete]);
      if (key !== lastSync.current) {
        await staff.syncRooms(items, complete);
        lastSync.current = key;
      }
      setSnap(date === today ? todaySnap : await presence.load(date));
      setPresenceError(null);
    } catch (e) {
      setSnap(null);
      setPresenceError(e instanceof PresenceError ? e : new PresenceError('rete', (e as Error).message));
    } finally {
      setPresenceLoading(false);
    }
  }, [presence, date, today, roomList, staff, clock]);

  useEffect(() => {
    void loadPresence();
    const id = window.setInterval(() => void loadPresence(), 5 * 60000);
    return () => window.clearInterval(id);
  }, [loadPresence]);

  const rooms = useMemo(() => roomPresences(roomList ?? [], snap), [snap, roomList]);

  if (!settings) return <div className="p-6 text-muted">Caricamento…</div>;

  const visible = rides.filter((r) => r.status !== 'annullata');
  const done = visible.filter((r) => r.status === 'completata').length;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) showToast(ok);
    } catch (e) {
      showToast((e as Error).message, 'bad');
    }
  };

  const exportCsv = () => {
    const blob = new Blob(['﻿', ridesToCsv(rides)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shuttle-hartmann-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="@container flex min-h-full flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="mr-auto flex items-center gap-2.5">
          <AlpstayLogo variant="simbolo" className="h-9 w-auto shrink-0" />
          <h1 className="text-[1.6rem] leading-tight text-gold">Shuttle · Reception</h1>
        </div>
        {!showSettings ? (
          <Button tone="gold" onClick={() => setCreating({ room: '' })}>
            <Plus size={18} /> Nuova corsa
          </Button>
        ) : null}
        <Button tone={showSettings ? 'dark' : 'soft'} aria-label="Impostazioni" title="Impostazioni" onClick={() => setShowSettings(!showSettings)}>
          <Settings size={18} />
        </Button>
        {onSignOut ? (
          <Button tone="ghost" aria-label="Blocca" title="Blocca (serve il PIN per rientrare)" onClick={onSignOut}>
            <Lock size={18} />
          </Button>
        ) : null}
      </header>

      {toast}

      {showSettings ? (
        <main className="flex flex-col gap-3 px-4 py-4">
          <Button size="sm" tone="ghost" className="self-start" onClick={() => setShowSettings(false)}>
            <ArrowLeft size={16} /> Torna alla lista
          </Button>
          <SettingsView settings={settings} onSaved={setSettings} notify={showToast} />
          {!isDemo ? (
            <Button size="sm" className="self-start" onClick={exportCsv}>
              <Download size={16} /> Esporta le corse del {formatShortDate(date)} (CSV)
            </Button>
          ) : null}
        </main>
      ) : (
        <main className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="group" aria-label="Giorno">
              {[
                { d: today, label: 'Oggi' },
                { d: addDays(today, 1), label: 'Domani' },
              ].map((o) => (
                <button
                  key={o.d}
                  type="button"
                  aria-pressed={date === o.d}
                  onClick={() => setDate(o.d)}
                  className={cx('min-h-10 rounded-lg px-5 font-bold', date === o.d ? 'bg-bg shadow-sm ring-1 ring-line' : 'text-muted')}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="font-bold capitalize">{formatLongDate(date)}</span>
            <span className="tnum ml-auto text-sm text-muted">
              {done} di {visible.length} {visible.length === 1 ? 'corsa fatta' : 'corse fatte'}
            </span>
          </div>

          {alerts.length ? (
            <div className="flex flex-col gap-2" aria-live="assertive">
              {alerts.map((a) => (
                <div key={a.id} className="slide-in flex items-center gap-3 rounded-xl border border-bad/40 bg-bad-soft p-3">
                  <BellRing size={18} className="shrink-0 text-bad" aria-hidden />
                  <p className="mr-auto text-sm">
                    <strong className="text-bad">Corsa cancellata dall’ospite.</strong> {a.text}. L’autista è stato avvisato.
                  </p>
                  <Button size="sm" tone="ghost" onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>
                    OK
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {presence?.needsPassword && (!presence.hasPassword() || presenceError?.code === 'password_errata') ? (
            <PasswordPrompt
              wrong={presenceError?.code === 'password_errata'}
              onSave={(pw) => {
                presence.setPassword(pw);
                void loadPresence();
              }}
            />
          ) : null}

          {creating ? (
            <NewRidePanel
              settings={settings}
              now={now}
              rooms={rooms}
              stays={stays}
              initialRoom={creating.room}
              onClose={() => setCreating(null)}
              onCreated={(r) => {
                setCreating(null);
                if (r.serviceDate !== date) setDate(r.serviceDate);
                showToast(`Corsa inserita: ${whoText(r)} alle ${r.time}.`);
              }}
            />
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-line">
            <div className="hidden grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-line bg-surface px-3 py-2 @xl:grid">
              <span className="eyebrow">Camera</span>
              <span className="eyebrow inline-flex items-center gap-1">
                <ArrowUpRight size={13} aria-hidden /> Andata · agli impianti
              </span>
              <span className="eyebrow inline-flex items-center gap-1">
                <ArrowDownLeft size={13} aria-hidden /> Ritorno · in hotel
              </span>
            </div>
            <ul className="divide-y divide-line">
              {rooms.map((rp) => (
                <RoomLine
                  key={rp.room}
                  rp={rp}
                  date={date}
                  now={now}
                  settings={settings}
                  rides={rides.filter((r) => r.room === rp.room).sort(compareRides)}
                  conflicts={conflicts}
                  stay={stays.find((s) => s.room === rp.room && !s.revokedAt && isStayValid(s, now)) ?? null}
                  open={openRow === rp.room}
                  onToggle={() => setOpenRow(openRow === rp.room ? null : rp.room)}
                  publicUrl={publicUrl}
                  canPrint={!isDemo}
                  act={act}
                  onNewRide={() => setCreating({ room: rp.room })}
                />
              ))}
              {/* Corse extra per chi non è ospite dell'Hartmann, in una riga a parte. */}
              {rides.some((r) => r.room === EXTRA_ROOM) ? (
                <RoomLine
                  key={EXTRA_ROOM}
                  extra
                  rp={{ room: EXTRA_ROOM, current: null, leaving: null }}
                  date={date}
                  now={now}
                  settings={settings}
                  rides={rides.filter((r) => r.room === EXTRA_ROOM).sort(compareRides)}
                  conflicts={conflicts}
                  stay={null}
                  open={false}
                  onToggle={() => setCreating({ room: EXTRA_ROOM })}
                  publicUrl={publicUrl}
                  canPrint={false}
                  act={act}
                  onNewRide={() => setCreating({ room: EXTRA_ROOM })}
                />
              ) : null}
            </ul>
          </div>

          <PresenceFooter snap={snap} error={presenceError} now={now} loading={presenceLoading} onRefresh={() => void loadPresence()} />
        </main>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riga camera
// ---------------------------------------------------------------------------

const STATE_TEXT: Record<string, string> = { in_casa: '', arriva: 'Arriva oggi', parte: 'Parte oggi', partito: 'Partito' };

function RoomLine({
  rp,
  date,
  now,
  settings,
  rides,
  conflicts,
  stay,
  open,
  onToggle,
  publicUrl,
  canPrint,
  act,
  onNewRide,
  extra,
}: {
  rp: RoomPresence;
  date: IsoDate;
  now: number;
  settings: ShuttleSettings;
  rides: Ride[];
  conflicts: Map<string, Ride[]>;
  stay: ShuttleStay | null;
  open: boolean;
  onToggle: () => void;
  publicUrl: string;
  canPrint: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  onNewRide: () => void;
  /** Riga delle corse extra (non ospiti): niente QR né attivazione, un tocco apre una nuova corsa extra. */
  extra?: boolean;
}) {
  const p = rp.current ?? rp.leaving;
  const empty = !p && rides.length === 0;
  const stateText = rp.leaving && rp.current ? 'Cambio ospite' : p ? STATE_TEXT[p.state] : 'Libera';
  const cell = (dir: Direction) => {
    const list = rides.filter((r) => r.direction === dir);
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="eyebrow inline-flex items-center gap-1 @xl:hidden">
          {dir === 'andata' ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownLeft size={12} aria-hidden />}
          {dir === 'andata' ? 'Andata' : 'Ritorno'}
        </span>
        {list.length ? (
          list.map((r) => <RideCell key={r.id} ride={r} settings={settings} now={now} date={date} act={act} clash={conflicts.get(r.id)} who={extra ? rideWho(r).replace(/^Extra · /, '') : undefined} />)
        ) : (
          <span className="flex min-h-11 items-center text-muted" aria-label="Nessuna corsa">
            —
          </span>
        )}
      </div>
    );
  };

  return (
    <li className={cx(empty && 'bg-surface/60')}>
      <div className="grid grid-cols-1 gap-3 px-3 py-3 @xl:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)]">
        {extra ? (
          <button type="button" onClick={onNewRide} className="flex items-start gap-2 text-left @xl:flex-col @xl:gap-0.5">
            <span className="font-title text-3xl leading-none text-gold">Extra</span>
            <span className="text-xs text-muted">Non ospiti dell’Hartmann · tocca per una nuova corsa</span>
          </button>
        ) : (
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-start gap-2 text-left @xl:flex-col @xl:gap-0.5">
          <span className={cx('tnum font-title text-3xl leading-none', empty && 'text-muted')}>{rp.room}</span>
          <span className="flex min-w-0 flex-col">
            {p?.name ? <span className="truncate text-sm font-bold">{p.name}</span> : null}
            <span className="text-xs text-muted">
              {[stateText, p ? `${p.adults + p.children} pers.` : null].filter(Boolean).join(' · ')}
            </span>
            {p && !stay && p.state !== 'partito' ? <span className="text-xs font-bold text-warn">Shuttle non attivo</span> : null}
          </span>
        </button>
        )}
        <div className="grid grid-cols-2 gap-3 @xl:contents">
          {cell('andata')}
          {cell('ritorno')}
        </div>
      </div>

      {open ? (
        <RoomDrawer rp={rp} stay={stay} now={now} date={date} publicUrl={publicUrl} canPrint={canPrint} act={act} onNewRide={onNewRide} />
      ) : null}
    </li>
  );
}

/** Spunta della corsa: fatto, non fatto (con lo stato del momento) o non presentato. */
function RideCell({ ride: r, settings, now, date, act, clash, who }: { ride: Ride; settings: ShuttleSettings; now: number; date: IsoDate; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; clash?: Ride[]; who?: string }) {
  const { backend } = useApp();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<RideEvent[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const done = r.status === 'completata';
  const noShow = r.status === 'no_show';
  const cancelled = r.status === 'annullata';
  const wait = r.status === 'sul_posto' ? waitState(r, settings, now) : null;
  // Non ancora letta a meno di 15 minuti dall'orario: va segnalata all'autista.
  const late = r.status === 'richiesta' && date === romeDate(now) && toMinutes(r.time) - romeMinutesOfDay(now) <= 15;

  const sub = cancelled
    ? `${r.cancelledBy === 'ospite' ? 'Cancellata dall’ospite' : 'Annullata dalla reception'} alle ${romeTimeOf(r.cancelledAt)}`
    : done
    ? `Fatto alle ${romeTimeOf(r.completedAt)}`
    : noShow
      ? r.chargeDecision && r.chargeDecision !== 'da_valutare'
        ? `Non presentato · ${CHARGE_LABEL[r.chargeDecision].toLowerCase()}`
        : 'Non presentato'
      : r.status === 'richiesta'
        ? late
          ? 'Non ancora letta: avvisa l’autista'
          : 'Non letta dall’autista'
        : r.status === 'sul_posto'
          ? null
          : r.lastMessage
            ? `«${DRIVER_MESSAGE_LABEL[r.lastMessage]}»`
            : 'Confermata';

  return (
    <div className={cx('flex flex-col rounded-xl border', cancelled ? 'border-dashed border-line bg-surface opacity-75' : done ? 'border-ok/30 bg-ok-soft' : noShow ? 'border-bad/30 bg-bad-soft' : late || clash ? 'border-warn/60 bg-warn-soft' : 'border-line bg-bg')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={async () => {
          const next = !open;
          setOpen(next);
          if (next && !events) setEvents(await backend.staff.rideEvents(r.id).catch(() => []));
        }}
        className="flex min-h-11 items-start gap-2 p-2 text-left"
      >
        <span className="mt-0.5 shrink-0" aria-label={cancelled ? 'Cancellata' : done ? 'Fatto' : noShow ? 'Non presentato' : 'Non fatto'}>
          {cancelled ? (
            <CircleX size={24} className="text-muted" />
          ) : done ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-ok text-bg">
              <Check size={16} strokeWidth={3} />
            </span>
          ) : noShow ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-bad text-bg">
              <UserX size={14} strokeWidth={2.5} />
            </span>
          ) : (
            <Circle size={24} className={late ? 'text-warn' : 'text-line'} strokeWidth={2.5} />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate">
            <span className={cx('tnum font-bold', cancelled && 'line-through')}>{r.time}</span> {who ? <strong>{who} · </strong> : null}
            {r.destinationName} <span className="text-muted">· {r.persons} pers.</span>
          </span>
          <span className={cx('truncate text-xs', done ? 'text-ok' : noShow ? 'font-bold text-bad' : late ? 'font-bold text-warn' : 'text-muted')}>
            {wait ? (
              wait.expired ? (
                'Attesa scaduta'
              ) : (
                <span className="font-bold text-gold-strong">
                  Autista sul posto · <Countdown ms={wait.remainingMs} />
                </span>
              )
            ) : (
              sub
            )}
          </span>
        </span>
      </button>

      {clash?.length ? (
        <p className="flex items-start gap-1.5 px-2 pb-2 text-xs font-bold text-warn">
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
          <span>
            Mezzo già impegnato:{' '}
            {clash.map((o) => `${o.time} ${whoText(o)} (${o.direction === 'andata' ? `Hotel → ${o.destinationName}` : `da ${o.destinationName}`})`).join(' · ')}
          </span>
        </p>
      ) : null}

      {noShow && r.chargeDecision === 'da_valutare' ? (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          <Button size="sm" tone="bad" onClick={() => act(() => backend.staff.setCharge(r.id, 'addebitare'), 'Segnata da addebitare: registrala in Slope.')}>
            Addebita
          </Button>
          <Button size="sm" tone="ghost" onClick={() => act(() => backend.staff.setCharge(r.id, 'non_addebitare'), 'Nessun addebito.')}>
            Nessun addebito
          </Button>
        </div>
      ) : null}

      {open ? (
        <div className="slide-in flex flex-col gap-2 border-t border-line/70 p-2">
          {r.note ? <p className="text-sm italic">“{r.note}”</p> : null}
          <ol className="flex flex-col gap-0.5 text-xs">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="tnum w-11 text-muted">{romeTimeOf(e.at)}</span>
                <span>
                  {EVENT_LABEL[e.kind]}
                  {e.message ? ` · ${DRIVER_MESSAGE_LABEL[e.message]}` : ''}
                  {e.chargeDecision ? ` · ${CHARGE_LABEL[e.chargeDecision]}` : ''}
                </span>
              </li>
            ))}
          </ol>
          {isOpen(r.status) ? (
            confirm ? (
              <InlineConfirm
                question={`Annullare la corsa delle ${r.time}?`}
                confirmLabel="Annulla corsa"
                cancelLabel="No"
                onCancel={() => setConfirm(false)}
                onConfirm={() => {
                  setConfirm(false);
                  void act(() => backend.staff.cancelRide(r.id), 'Corsa annullata.');
                }}
              />
            ) : (
              <Button size="sm" tone="ghost" className="self-start" onClick={() => setConfirm(true)}>
                <Trash2 size={14} /> Annulla corsa
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const EVENT_LABEL: Record<RideEvent['kind'], string> = {
  creata: 'Richiesta inserita',
  messaggio: 'Autista',
  completata: 'Fatto',
  no_show: 'Non presentato',
  annullata: 'Annullata',
  addebito: 'Addebito',
};

/** Pannello della camera, aperto toccando il numero: QR, attivazione shuttle, nuova corsa. */
function RoomDrawer({
  rp,
  stay,
  now,
  date,
  publicUrl,
  canPrint,
  act,
  onNewRide,
}: {
  rp: RoomPresence;
  stay: ShuttleStay | null;
  now: number;
  date: IsoDate;
  publicUrl: string;
  canPrint: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  onNewRide: () => void;
}) {
  const { backend } = useApp();
  const [manual, setManual] = useState<{ until: IsoDate; persons: number } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const today = romeDate(now);
  const enable = (input: { room: string; persons: number | null; validUntil: IsoDate }) => act(() => backend.staff.enableRoom(input), `Camera ${rp.room} attiva per lo shuttle.`);

  return (
    <div className="slide-in flex flex-col gap-3 border-t border-line bg-surface px-3 py-3 @xl:flex-row @xl:items-start">
      <div className="@xl:w-[340px] @xl:shrink-0">
        <RoomCard room={rp.room} validUntil={stay?.validUntil ?? null} publicUrl={publicUrl} canPrint={canPrint} />
      </div>
      <div className="flex flex-col gap-2">
        <p className={cx('inline-flex items-center gap-1.5 text-sm font-bold', stay ? 'text-ok' : 'text-warn')}>
          <KeyRound size={14} aria-hidden />
          {stay ? `Shuttle attivo fino al ${formatShortDate(stay.validUntil)}${stay.source === 'manuale' ? ' (attivato a mano)' : ''}` : 'Shuttle non attivo per questa camera'}
        </p>
        {stay ? (
          confirmOff ? (
            <InlineConfirm
              question={`L’ospite della camera ${rp.room} non potrà più prenotare.`}
              confirmLabel="Disattiva"
              cancelLabel="No"
              onCancel={() => setConfirmOff(false)}
              onConfirm={() => {
                setConfirmOff(false);
                void act(() => backend.staff.revokeStay(stay.id), `Camera ${rp.room} disattivata per lo shuttle.`);
              }}
            />
          ) : (
            <Button size="sm" tone="ghost" className="self-start" onClick={() => setConfirmOff(true)}>
              <X size={16} /> Disattiva
            </Button>
          )
        ) : manual ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void enable({ room: rp.room, persons: manual.persons, validUntil: manual.until });
              setManual(null);
            }}
          >
            <div>
              <FieldLabel htmlFor={`until-${rp.room}`}>Partenza</FieldLabel>
              <input id={`until-${rp.room}`} type="date" min={today} value={manual.until} onChange={(e) => setManual({ ...manual, until: e.target.value })} className="min-h-11 rounded-lg border border-line bg-bg px-3" />
            </div>
            <Stepper label="Persone" value={manual.persons} min={1} max={8} onChange={(v) => setManual({ ...manual, persons: v })} />
            <Button type="submit" tone="gold">
              <KeyRound size={16} /> Attiva shuttle
            </Button>
          </form>
        ) : (
          <Button
            tone="gold"
            className="self-start"
            onClick={() =>
              rp.current
                ? void enable({ room: rp.room, persons: rp.current.adults + rp.current.children, validUntil: rp.current.departure })
                : setManual({ until: addDays(today, 1), persons: 2 })
            }
          >
            <KeyRound size={16} /> Attiva shuttle{rp.current ? ` fino al ${formatShortDate(rp.current.departure)}` : ''}
          </Button>
        )}
        <Button size="sm" className="self-start" onClick={onNewRide}>
          <Plus size={16} /> Corsa per la camera {rp.room}
        </Button>
        {date !== today ? <p className="text-xs text-muted">L’attivazione vale da oggi.</p> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presenze
// ---------------------------------------------------------------------------

function PresenceFooter({ snap, error, now, loading, onRefresh }: { snap: PresenceSnapshot | null; error: PresenceError | null; now: number; loading: boolean; onRefresh: () => void }) {
  const late = snap?.generatedAt ? now - Date.parse(snap.generatedAt) > 90 * 60000 : false;
  const text =
    error && error.code !== 'password_mancante' && error.code !== 'password_errata'
      ? error.message
      : snap
        ? `Presenze La Scatola delle ${romeTimeOf(snap.dataAsOf)}${late ? ' · aggiornamento in ritardo' : ''}`
        : null;
  if (!text) return null;
  return (
    <p className={cx('flex items-center gap-2 text-xs', error || late ? 'text-warn' : 'text-muted')}>
      {text}
      <button type="button" onClick={onRefresh} disabled={loading} aria-label="Aggiorna presenze" className="rounded p-1 hover:bg-surface">
        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
      </button>
    </p>
  );
}

function PasswordPrompt({ wrong, onSave }: { wrong: boolean; onSave: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-gold/40 bg-gold-soft p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pw.trim()) onSave(pw.trim());
      }}
    >
      <label htmlFor="presenze-pw" className="text-sm font-bold">
        {wrong ? 'Password non corretta: riprova.' : 'Password presenze (una volta su questo dispositivo)'}
      </label>
      <div className="flex gap-2">
        <input id="presenze-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3" />
        <Button type="submit" tone="dark">
          Sblocca
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Nuova corsa dalla reception (ospite al banco o al telefono)
// ---------------------------------------------------------------------------

function NewRidePanel({
  settings,
  now,
  rooms,
  stays,
  initialRoom,
  onClose,
  onCreated,
}: {
  settings: ShuttleSettings;
  now: number;
  rooms: RoomPresence[];
  stays: ShuttleStay[];
  initialRoom: string;
  onClose: () => void;
  onCreated: (r: Ride) => void;
}) {
  const { backend } = useApp();
  const [room, setRoom] = useState(initialRoom);
  const [error, setError] = useState<string | null>(null);
  // Corsa extra per chi non è ospite dell'Hartmann: nome o riferimento obbligatorio, telefono facoltativo.
  const isExtraRide = room === EXTRA_ROOM;
  const [extraName, setExtraName] = useState('');
  const [extraPhone, setExtraPhone] = useState('');
  // Corse di oggi e domani, per avvisare dei viaggi sovrapposti mentre si sceglie l'orario.
  const today = romeDate(now);
  const tomorrow = addDays(today, 1);
  const [dayRides, setDayRides] = useState<Record<string, Ride[]>>({});
  useEffect(() => {
    const offA = backend.staff.watchRides(today, (l) => setDayRides((m) => ({ ...m, [today]: l })));
    const offB = backend.staff.watchRides(tomorrow, (l) => setDayRides((m) => ({ ...m, [tomorrow]: l })));
    return () => {
      offA();
      offB();
    };
  }, [backend, today, tomorrow]);
  const rp = rooms.find((r) => r.room === room);
  const stay = stays.find((s) => s.room === room && !s.revokedAt && isStayValid(s, now)) ?? null;
  const persons = rp?.current ? rp.current.adults + rp.current.children : stay?.persons ?? null;
  return (
    <section className="slide-in rounded-2xl border border-gold/50 bg-bg p-4 shadow-lg" aria-label="Nuova corsa">
      <div className="mb-3 flex items-center">
        <h2 className="mr-auto text-xl text-gold">Nuova corsa</h2>
        <Button size="sm" tone="ghost" aria-label="Chiudi" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>
      <div className="@container">
        <RideForm
          key={room}
          settings={settings}
          nowMs={now}
          strings={GUEST_STRINGS.it}
          actor="reception"
          defaultPersons={isExtraRide ? 2 : persons}
          submitLabel={isExtraRide ? 'Inserisci corsa extra' : 'Inserisci corsa'}
          blocked={!room || (isExtraRide && !extraName.trim())}
          rides={[...(dayRides[today] ?? []), ...(dayRides[tomorrow] ?? [])]}
          header={
            <fieldset>
              <legend className="eyebrow mb-1.5">Camera</legend>
              <div className="flex flex-wrap gap-1.5">
                {rooms.map((r) => (
                  <button
                    key={r.room}
                    type="button"
                    onClick={() => setRoom(r.room)}
                    aria-pressed={room === r.room}
                    className={cx('tnum min-h-11 min-w-14 rounded-xl border px-3 font-title text-lg', room === r.room ? 'border-gold bg-gold-soft' : 'border-line', !r.current && !r.leaving && 'text-muted')}
                  >
                    {r.room}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setRoom(EXTRA_ROOM)}
                  aria-pressed={isExtraRide}
                  className={cx('min-h-11 rounded-xl border px-3 text-sm font-bold', isExtraRide ? 'border-gold bg-gold-soft' : 'border-dashed border-line')}
                >
                  + Extra (non ospite)
                </button>
              </div>
              {room && rp?.current?.name ? <p className="mt-1.5 text-sm text-muted">{rp.current.name}</p> : null}
              {isExtraRide ? (
                <div className="mt-2 grid grid-cols-1 gap-2 @md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-bold text-muted">
                    Nome o riferimento *
                    <input id="extra-name" value={extraName} maxLength={60} onChange={(e) => setExtraName(e.target.value)} placeholder="es. Rossi – Hotel Acadia" className="min-h-11 rounded-lg border border-line bg-bg px-3 text-base font-normal text-fg" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-bold text-muted">
                    Telefono (facoltativo)
                    <input id="extra-phone" type="tel" value={extraPhone} maxLength={30} onChange={(e) => setExtraPhone(e.target.value)} className="min-h-11 rounded-lg border border-line bg-bg px-3 text-base font-normal text-fg" />
                  </label>
                </div>
              ) : null}
            </fieldset>
          }
          onSubmit={async (input) => {
            setError(null);
            try {
              const r = isExtraRide
                ? await backend.staff.createRide({
                    ...input,
                    room: EXTRA_ROOM,
                    stayId: null,
                    reservationId: null,
                    // Il nome apre la nota: reception e autista lo vedono al posto del numero di camera.
                    note: [extraName.trim().replace(/ · /g, ' - '), extraPhone.trim(), input.note?.trim()].filter(Boolean).join(' · ').slice(0, 200),
                  })
                : await backend.staff.createRide({ ...input, room, stayId: stay?.id ?? null, reservationId: stay?.reservationId ?? rp?.current?.reservationId ?? null });
              onCreated(r);
            } catch (e) {
              if ((e as { code?: string }).code === 'non_valida') throw e;
              setError((e as Error).message);
            }
          }}
        />
      </div>
      {error ? <p className="mt-2 text-sm font-bold text-bad">{error}</p> : null}
    </section>
  );
}
