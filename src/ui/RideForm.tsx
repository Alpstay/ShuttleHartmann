import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Mountain, Send } from 'lucide-react';
import type { GuestStrings } from '../domain/i18n';
import { busySlots, earliestSlot, isOpen, pickupKey, suggestTimes, suggestedTime, tripClashes, validateRideInput, type RideInputProblem } from '../domain/rules';
import { addDays, fromMinutes, romeDate, toMinutes } from '../domain/time';
import type { Direction, IsoDate, Ride, RideInput, ShuttleSettings } from '../domain/types';
import { Button, FieldLabel, InlineConfirm, Segmented, Stepper, cx } from './kit';

export interface RideFormProps {
  settings: ShuttleSettings;
  nowMs: number;
  strings: GuestStrings;
  actor: 'ospite' | 'reception';
  defaultPersons: number | null;
  /** Ultimo giorno del soggiorno: oltre non si prenota. */
  validUntil?: IsoDate | null;
  /** Campo aggiuntivo in testa (la reception sceglie la camera). */
  header?: React.ReactNode;
  submitLabel?: string;
  /** Disabilita l'invio finché manca un dato esterno (es. la camera). */
  blocked?: boolean;
  /** Corse già inserite (oggi e domani): il mezzo è uno solo, la reception viene avvisata dei viaggi sovrapposti. */
  rides?: Ride[];
  onSubmit: (input: RideInput) => Promise<void>;
}

export function RideForm({ settings, nowMs, strings: t, actor, defaultPersons, validUntil, header, submitLabel, blocked, rides = [], onSubmit }: RideFormProps) {
  const today = romeDate(nowMs);
  const tomorrow = addDays(today, 1);
  const todayOpen = earliestSlot(settings, nowMs, today, actor) !== null;
  const tomorrowOpen = !validUntil || tomorrow <= validUntil;

  const [direction, setDirection] = useState<Direction>('andata');
  const [serviceDate, setServiceDate] = useState<IsoDate>(todayOpen ? today : tomorrow);
  const [time, setTime] = useState<string>(() => suggestedTime(settings, nowMs, todayOpen ? today : tomorrow, 'andata', actor) ?? settings.serviceStart);
  const [destinationId, setDestinationId] = useState<string>('');
  const [persons, setPersons] = useState<number>(Math.min(settings.seats, Math.max(1, defaultPersons ?? 2)));
  const [note, setNote] = useState('');
  const [accepted, setAccepted] = useState(actor === 'reception');
  const [busy, setBusy] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [serverProblems, setServerProblems] = useState<RideInputProblem[]>([]);

  // Se il giorno di oggi si chiude mentre la pagina è aperta, passa a domani.
  useEffect(() => {
    if (serviceDate === today && !todayOpen && tomorrowOpen) setServiceDate(tomorrow);
    if (serviceDate < today) setServiceDate(todayOpen ? today : tomorrow);
  }, [today, todayOpen, tomorrowOpen, serviceDate, tomorrow]);

  // Riallinea l'orario quando cambiano giorno o direzione, o quando esce dalla finestra prenotabile.
  const earliest = earliestSlot(settings, nowMs, serviceDate, actor);
  useEffect(() => {
    if (!earliest) return;
    if (toMinutes(time) < toMinutes(earliest) || toMinutes(time) > toMinutes(settings.serviceEnd)) {
      setTime(suggestedTime(settings, nowMs, serviceDate, direction, actor) ?? earliest);
    }
  }, [earliest, serviceDate, direction]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeDirection = (d: Direction) => {
    setDirection(d);
    setTime(suggestedTime(settings, nowMs, serviceDate, d, actor) ?? time);
  };
  const changeDate = (d: IsoDate) => {
    setServiceDate(d);
    setTime(suggestedTime(settings, nowMs, d, direction, actor) ?? time);
  };

  const input: RideInput = { serviceDate, time, direction, destinationId, persons, note: note.trim() || null, conditionsAccepted: accepted };
  const problems = useMemo(
    () => validateRideInput(input, { settings, nowMs, actor, stay: validUntil ? { validFrom: today, validUntil } : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceDate, time, direction, destinationId, persons, accepted, settings, nowMs, actor, validUntil, today],
  );
  const shown = showProblems ? [...new Set([...problems, ...serverProblems])] : serverProblems;
  const active = settings.destinations.filter((d) => d.active);

  // Il mezzo è uno solo: viaggi già previsti troppo vicini (o lo stesso viaggio già pieno).
  const dayRides = rides.filter((r) => r.serviceDate === serviceDate && isOpen(r.status));
  const taken = busySlots(dayRides, serviceDate);
  const tripReady = direction === 'andata' || !!destinationId;
  const trip = tripReady ? tripClashes(input, taken, settings) : { problem: null, clashes: [] };
  const clashRides = trip.problem ? dayRides.filter((r) => trip.clashes.some((c) => c.time === r.time && c.pickup === pickupKey(r))) : [];
  const suggestions = trip.problem ? suggestTimes(input, taken, settings, nowMs, actor) : [];
  const [askTrip, setAskTrip] = useState(false);
  useEffect(() => setAskTrip(false), [serviceDate, time, direction, destinationId, persons]);

  const submit = async (e?: React.FormEvent, force = false) => {
    e?.preventDefault();
    setShowProblems(true);
    if (problems.length || blocked) return;
    if (trip.problem && !force) {
      setAskTrip(true);
      return;
    }
    setAskTrip(false);
    setBusy(true);
    setServerProblems([]);
    try {
      await onSubmit(input);
      setNote('');
      setDestinationId('');
      setShowProblems(false);
      if (actor === 'ospite') setAccepted(false);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const codes = msg.split(',').filter((c): c is RideInputProblem => c in t.problems);
      // Gli altri errori (rete, sessione) li mostra chi ha chiamato il modulo.
      if (codes.length) setServerProblems(codes);
    } finally {
      setBusy(false);
    }
  };

  const ids = { note: `${actor}-note`, accept: `${actor}-accept` };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {header}

      <Segmented<Direction>
        name={t.newRide}
        value={direction}
        onChange={changeDirection}
        options={[
          { value: 'andata', label: <span className="inline-flex items-center gap-1.5"><ArrowUpRight size={16} />{t.toLift}</span>, hint: t.toLiftHint },
          { value: 'ritorno', label: <span className="inline-flex items-center gap-1.5"><ArrowDownLeft size={16} />{t.toHotel}</span>, hint: t.toHotelHint },
        ]}
      />

      <fieldset>
        <legend className="eyebrow mb-1.5">{direction === 'andata' ? t.destination : t.pickupAt}</legend>
        <div className="grid grid-cols-1 gap-2 @sm:grid-cols-2">
          {active.map((d) => (
            <label
              key={d.id}
              className={cx(
                'flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
                destinationId === d.id ? 'border-gold bg-gold-soft' : 'border-line hover:bg-surface',
              )}
            >
              <input type="radio" name={`${actor}-dest`} value={d.id} checked={destinationId === d.id} onChange={() => setDestinationId(d.id)} className="sr-only" />
              <Mountain size={20} className={destinationId === d.id ? 'text-gold' : 'text-muted'} aria-hidden />
              <span className="flex flex-col leading-tight">
                <span className="font-bold">{d.name}</span>
                <span className="text-xs text-muted">{d.place}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-5 @md:grid-cols-2">
        <div>
          <FieldLabel>{t.day}</FieldLabel>
          <Segmented<IsoDate>
            name={t.day}
            value={serviceDate}
            onChange={changeDate}
            options={[
              { value: today, label: t.today },
              { value: tomorrow, label: t.tomorrow },
            ].filter((o) => (o.value === today ? todayOpen : tomorrowOpen))}
          />
          {!todayOpen ? <p className="mt-1.5 text-xs text-muted">{t.noSlots}</p> : null}
        </div>
        <div>
          <FieldLabel>{t.persons}</FieldLabel>
          <Stepper label={t.persons} value={persons} min={1} max={settings.seats} onChange={setPersons} />
        </div>
      </div>

      <div>
        <FieldLabel>{t.time}</FieldLabel>
        {earliest ? (
          <Stepper
            label={t.time}
            value={toMinutes(time)}
            min={toMinutes(earliest)}
            max={toMinutes(settings.serviceEnd)}
            steps={[5, 30]}
            onChange={(m) => setTime(fromMinutes(m))}
            format={(m) => fromMinutes(m)}
          />
        ) : (
          <p className="text-sm text-muted">{t.noSlots}</p>
        )}
        <p className="mt-1.5 text-xs text-muted">
          {settings.serviceStart}–{settings.serviceEnd}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor={ids.note}>{t.note}</FieldLabel>
        <input
          id={ids.note}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.notePlaceholder}
          className="min-h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base placeholder:text-muted"
        />
      </div>

      {actor === 'ospite' ? (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="eyebrow mb-1">{t.conditionsTitle}</p>
          <p className="text-sm leading-relaxed">{t.conditions(settings.waitMinutes)}</p>
          <label htmlFor={ids.accept} className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 font-bold">
            <input id={ids.accept} type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="size-5 accent-[var(--gold)]" />
            {t.accept}
          </label>
        </div>
      ) : null}

      {trip.problem ? (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border-2 border-warn bg-warn-soft p-3 text-sm">
          <p className="flex items-start gap-2 font-bold text-warn">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
            {trip.problem === 'posti_esauriti' ? `Il viaggio delle ${time} è già pieno (${settings.seats} posti).` : `Il mezzo è già impegnato: due viaggi devono stare ad almeno ${settings.pickupGapMinutes} minuti.`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {clashRides.map((r) => (
              <li key={r.id} className="tnum">
                <strong>{r.time}</strong> · {r.direction === 'andata' ? `Hotel → ${r.destinationName}` : `${r.destinationName} → Hotel`} · camera {r.room} ({r.persons} pers.)
              </li>
            ))}
          </ul>
          {suggestions.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted">Orari liberi:</span>
              {suggestions.map((s) => (
                <button key={s.time} type="button" onClick={() => setTime(s.time)} className="tnum min-h-9 rounded-lg border border-line bg-bg px-2.5 font-bold">
                  {s.time}
                  {s.join ? <span className="ml-1 text-xs font-normal text-muted">insieme</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted">Puoi inserirla comunque (per esempio con un taxi): l’autista vedrà l’avviso di conflitto.</p>
        </div>
      ) : null}

      {askTrip ? (
        <InlineConfirm
          question="Il mezzo è già impegnato a quell’ora. Inserire comunque la corsa?"
          confirmLabel="Inserisci comunque"
          cancelLabel="Cambio orario"
          onCancel={() => setAskTrip(false)}
          onConfirm={() => void submit(undefined, true)}
        />
      ) : null}

      {shown.length ? (
        <ul className="slide-in flex flex-col gap-1 rounded-xl bg-bad-soft p-3 text-sm font-bold text-bad" role="alert">
          {shown.map((p) => (
            <li key={p}>{t.problems[p]}</li>
          ))}
        </ul>
      ) : null}

      <Button type="submit" tone="gold" size="lg" disabled={busy || blocked || !earliest}>
        <Send size={18} />
        {busy ? t.sending : submitLabel ?? t.send}
      </Button>
    </form>
  );
}
